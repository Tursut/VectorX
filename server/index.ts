// Cloudflare Worker + RoomDurableObject.
// Step 4: /ping. Step 5: POST /rooms + DO init. Step 6: /rooms/:code/ws echo.
// Step 7: zod schemas in protocol.ts. Step 8: shared game logic + validateMove.
// Step 9: replace echo with a real lobby dispatcher (HELLO/START + LOBBY_STATE
// broadcasts). Gameplay (initGame, GAME_STATE) arrives in Step 10.

import { DurableObject } from 'cloudflare:workers';
import {
  parseClientMsg,
  type HelloMsg,
  type JoinMsg,
  type LobbyStateMsg,
  type ServerMsg,
  type StartMsg,
} from './protocol';

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

const MAX_PLAYERS = 4;

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let out = '';
  for (const b of bytes) {
    out += CODE_ALPHABET[b & 0x1f];
  }
  return out;
}

// Storage shape (single `lobby` key). `isHost` is NOT stored — it's derived at
// broadcast time from `hostId` so host reassignment on disconnect is a single
// field update instead of N per-player flag updates.
type LobbyStorage = {
  players: Array<{ id: number; displayName: string; isBot: boolean }>;
  hostId: number | null;
  phase: 'lobby' | 'playing';
  magicItems: boolean;
};

const EMPTY_LOBBY: LobbyStorage = {
  players: [],
  hostId: null,
  phase: 'lobby',
  magicItems: false,
};

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
      await this.ctx.storage.put({
        code,
        createdAt: Date.now(),
        lobby: EMPTY_LOBBY,
      });
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

  // Hibernation dispatch. Parse → parseClientMsg → route.
  override async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    // Binary frames aren't part of the text-JSON protocol.
    if (typeof raw !== 'string') {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    const result = parseClientMsg(parsed);
    if (!result.ok) {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    const msg = result.msg;
    switch (msg.type) {
      case 'HELLO':
        await this.handleHello(ws, msg);
        return;
      case 'START':
        await this.handleStart(ws, msg);
        return;
      case 'MOVE':
        // Step 10 replaces this with real validation + applyMove + broadcast.
        // For Step 9, a MOVE is meaningless; the game hasn't started.
        this.sendError(ws, 'INVALID_MOVE', 'Game not started');
        return;
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // Wrap the whole body: DO teardown races during tests can throw storage
    // reads; we always want to attempt ws.close() at the end.
    try {
      const seatId = this.getAttachedSeatId(ws);
      if (seatId === null) return;

      const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');
      if (!lobby) return;

      if (lobby.phase === 'lobby') {
        const players = lobby.players.filter((p) => p.id !== seatId);
        let hostId = lobby.hostId;
        if (hostId === seatId) {
          // Reassign to lowest-id remaining player, or null if room emptied.
          hostId = players.length > 0 ? players[0].id : null;
        }
        const updated: LobbyStorage = { ...lobby, players, hostId };
        await this.ctx.storage.put('lobby', updated);

        const storedCode = await this.ctx.storage.get<string>('code');
        if (storedCode) {
          this.broadcast(this.buildLobbyState(storedCode, updated));
        }
      }
      // phase === 'playing': Step 12 handles elimination + broadcast.
    } catch {
      // DO/storage may be torn down; ignore and still close the socket below.
    }
    try {
      ws.close(code, reason);
    } catch {
      // already closed — harmless
    }
  }

  override webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed — harmless
    }
  }

  // ----- Handlers -----

  private async handleHello(ws: WebSocket, msg: HelloMsg): Promise<void> {
    const storedCode = await this.ctx.storage.get<string>('code');
    const lobby = (await this.ctx.storage.get<LobbyStorage>('lobby')) ?? EMPTY_LOBBY;
    if (!storedCode) {
      // Shouldn't happen — room has to be initialised before /ws accepts.
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    if (lobby.phase !== 'lobby') {
      this.sendError(ws, 'ALREADY_STARTED');
      return;
    }

    // Idempotent re-HELLO: if the socket already has an attached seat that
    // still matches a live player, just resend LOBBY_STATE. If the attachment
    // is stale (player was removed while socket was in flight), fall through
    // to fresh-join behaviour.
    const attached = this.getAttachedSeatId(ws);
    if (attached !== null && lobby.players.some((p) => p.id === attached)) {
      ws.send(JSON.stringify(this.buildLobbyState(storedCode, lobby)));
      return;
    }

    if (lobby.players.length >= MAX_PLAYERS) {
      this.sendError(ws, 'ROOM_FULL');
      return;
    }

    if (lobby.players.some((p) => p.displayName === msg.displayName)) {
      this.sendError(ws, 'DUPLICATE_NAME');
      return;
    }

    const newId = lowestUnusedId(lobby.players.map((p) => p.id));
    const newPlayer = {
      id: newId,
      displayName: msg.displayName,
      isBot: false,
    };
    const updated: LobbyStorage = {
      ...lobby,
      players: [...lobby.players, newPlayer],
      hostId: lobby.hostId ?? newId,
    };
    await this.ctx.storage.put('lobby', updated);

    ws.serializeAttachment({ seatId: newId });

    const joinMsg: JoinMsg = {
      type: 'JOIN',
      player: { ...newPlayer, isHost: newPlayer.id === updated.hostId },
    };
    this.broadcast(joinMsg); // includes joiner — client symmetry
    this.broadcast(this.buildLobbyState(storedCode, updated));
  }

  private async handleStart(ws: WebSocket, msg: StartMsg): Promise<void> {
    const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');
    if (!lobby) {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    // Phase check BEFORE host check: ALREADY_STARTED is more informative than
    // UNAUTHORIZED for a duplicate/late START, even from a non-host.
    if (lobby.phase !== 'lobby') {
      this.sendError(ws, 'ALREADY_STARTED');
      return;
    }

    const seatId = this.getAttachedSeatId(ws);
    if (seatId === null || seatId !== lobby.hostId) {
      this.sendError(ws, 'UNAUTHORIZED');
      return;
    }

    const updated: LobbyStorage = {
      ...lobby,
      phase: 'playing',
      magicItems: msg.magicItems,
    };
    await this.ctx.storage.put('lobby', updated);
    // Step 10: broadcast GAME_STATE here after initGame.
  }

  // ----- Helpers -----

  private broadcast(msg: ServerMsg, opts?: { excludeSeatId?: number }): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      // Skip terminal states only — hibernation-accepted sockets may not report
      // readyState === OPEN even when they're perfectly live. The try/catch
      // below handles any "send on closed socket" edge cases.
      if (
        ws.readyState === WebSocket.CLOSING ||
        ws.readyState === WebSocket.CLOSED
      ) {
        continue;
      }
      if (opts?.excludeSeatId !== undefined) {
        const a = this.getAttachedSeatId(ws);
        if (a === opts.excludeSeatId) continue;
      }
      try {
        ws.send(raw);
      } catch {
        // One misbehaving socket shouldn't abort the broadcast.
      }
    }
  }

  private buildLobbyState(code: string, lobby: LobbyStorage): LobbyStateMsg {
    return {
      type: 'LOBBY_STATE',
      code,
      players: lobby.players.map((p) => ({
        ...p,
        isHost: p.id === lobby.hostId,
      })),
      hostId: lobby.hostId,
      magicItems: lobby.magicItems,
    };
  }

  private getAttachedSeatId(ws: WebSocket): number | null {
    try {
      const a = ws.deserializeAttachment() as { seatId?: number } | null;
      return a?.seatId ?? null;
    } catch {
      return null;
    }
  }

  private sendError(
    ws: WebSocket,
    code:
      | 'NOT_YOUR_TURN'
      | 'INVALID_MOVE'
      | 'ROOM_FULL'
      | 'DUPLICATE_NAME'
      | 'UNAUTHORIZED'
      | 'BAD_PAYLOAD'
      | 'ALREADY_STARTED',
    message?: string,
  ): void {
    const payload: ServerMsg = message
      ? { type: 'ERROR', code, message }
      : { type: 'ERROR', code };
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // socket gone — nothing to do
    }
  }
}

function lowestUnusedId(used: number[]): number {
  const taken = new Set(used);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!taken.has(i)) return i;
  }
  // Caller is responsible for capacity check; this should never fire.
  throw new Error('no free seat');
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
