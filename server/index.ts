// Cloudflare Worker + RoomDurableObject.
// Step 4: `/ping`. Step 5: `POST /rooms` + DO init.
// Step 6: `GET /rooms/:code/ws` — WebSocket upgrade using the Hibernation API
// (DO sleeps between messages; `webSocketMessage` is dispatched by the runtime).
// No protocol yet — just echo. Step 7 adds zod schemas; Step 9 starts
// interpreting messages as lobby/game actions.

import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
}

// Base32 excluding visually-confusable chars (0/O/1/I). 32 symbols → 5 bits
// per char → 32⁵ ≈ 33.5M combinations over 5 chars. Random picks still need
// collision handling (birthday paradox: ~1.5% across 1000 samples) — the DO's
// atomic put-if-empty + the Worker's retry loop below are what make this safe.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

// Looser path regex than CODE_RE on purpose: it rejects obvious garbage paths
// (`/rooms/abc/ws`, `/rooms//ws`) fast, and any surviving non-alphabet value
// falls into the 400 branch below. Two cheap checks keep the alphabet
// invariant local to one place.
const WS_PATH_RE = /^\/rooms\/([A-Z2-9]{5})\/ws$/;

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let out = '';
  for (const b of bytes) {
    out += CODE_ALPHABET[b & 0x1f];
  }
  return out;
}

export class RoomDurableObject extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rooms' && request.method === 'POST') {
      // First-time init only. Second caller gets 409 so the Worker can pick
      // a different random code. This atomic check-and-write is what makes
      // the Worker's retry loop race-safe against concurrent inits.
      const existing = await this.ctx.storage.get<string>('code');
      if (existing !== undefined) {
        return new Response('conflict', { status: 409 });
      }
      const { code } = (await request.json()) as { code: string };
      await this.ctx.storage.put({ code, createdAt: Date.now() });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/ws' && request.method === 'GET') {
      // Reject pre-upgrade if the room was never initialised. Keeps the
      // contract: clients only reach `/ws` via a code that `POST /rooms`
      // minted. No half-open sockets.
      const code = await this.ctx.storage.get<string>('code');
      if (code === undefined) {
        return new Response('Room not found', { status: 404 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Hibernation entry point. Replaces `server.accept()` — the runtime
      // tracks this socket and dispatches inbound frames to
      // `webSocketMessage` below, allowing the DO to hibernate between them.
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not Found', { status: 404 });
  }

  // Hibernation lifecycle. Step 6 just echoes; Step 9 will parse the payload
  // as a zod-validated protocol message and dispatch to lobby/game handlers.
  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    ws.send(message);
  }

  override webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed — harmless
    }
  }

  // Not strictly required for echo, but prevents workerd's
  // "unhandled socket error" noise from racing Vitest teardown (same class
  // of issue that destabilised the parallel-fetch experiment in Step 5).
  override webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed — harmless
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ping') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { allow: 'GET' } });
      }
      return new Response('pong', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname === '/rooms') {
      if (request.method !== 'POST') {
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      }
      // Up to 5 retries on DO 409 (collision). With 33.5M space and a clean
      // uniform generator, this branch effectively never re-loops in practice.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const initRes = await stub.fetch('http://do/rooms', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        if (initRes.status === 204) {
          return new Response(JSON.stringify({ code }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (initRes.status !== 409) {
          return new Response('Room init failed', { status: 502 });
        }
      }
      return new Response('Exhausted room code retries', { status: 500 });
    }

    const wsMatch = WS_PATH_RE.exec(url.pathname);
    if (wsMatch) {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { allow: 'GET' } });
      }
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Upgrade Required', {
          status: 426,
          headers: { upgrade: 'websocket' },
        });
      }
      const code = wsMatch[1];
      // Belt and braces: path regex allows [A-Z2-9] but the alphabet excludes
      // O, I. Anything that slips through the path pattern but fails the
      // alphabet check is a malformed code.
      if (!CODE_RE.test(code)) {
        return new Response('Malformed code', { status: 400 });
      }
      // Forward to the DO with a rewritten internal URL. `new Request(url,
      // init)` preserves method, headers (Upgrade, Sec-WebSocket-Key, …)
      // and body — everything the handshake needs.
      const doReq = new Request('http://do/ws', request);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(doReq);
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
