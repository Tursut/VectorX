// Cloudflare Worker + RoomDurableObject.
// Step 4 shipped /ping. Step 5 adds the room-lifecycle plumbing: POST /rooms
// mints a 5-char base32 code, seeds the DO's storage with {code, createdAt},
// and returns the code. No WebSocket, lobby, or game logic yet — those land
// in Steps 6–12.

import { DurableObject } from 'cloudflare:workers';

interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
}

// Base32 excluding visually-confusable chars (0/O/1/I). 32 symbols → 5 bits
// per char → 32⁵ ≈ 33.5M combinations over 5 chars. Random picks still need
// collision handling (birthday paradox: ~1.5% across 1000 samples) — the DO's
// atomic put-if-empty + the Worker's retry loop below are what make this safe.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

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

    return new Response('Not Found', { status: 404 });
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

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
