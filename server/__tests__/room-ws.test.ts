import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

// Track sockets opened during each test so an errant `.close()` or an exception
// doesn't leave them hanging past test end — that's the WebSocket analogue of
// the parallel-fetch destabilisation we hit in Step 5.
const openSockets: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(openSockets.splice(0).map((ws) => drain(ws)));
});

async function drain(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
  try {
    ws.close(1000);
  } catch {
    return;
  }
  await Promise.race([closed, new Promise((r) => setTimeout(r, 200))]);
}

async function createRoom(): Promise<string> {
  const res = await SELF.fetch('http://example.com/rooms', { method: 'POST' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

async function openWs(code: string): Promise<WebSocket> {
  const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept(); // client side — missing this silently swallows inbound frames
  openSockets.push(ws);
  return ws;
}

describe('GET /rooms/:code/ws — hibernation dispatch', () => {
  // Step 6 originally asserted that the server echoes any frame back. Step 9
  // replaced the echo with a protocol dispatcher, so any non-protocol frame
  // now comes back as ERROR BAD_PAYLOAD. Retaining the assertion in this
  // shape proves the hibernation wiring (message → DO handler → back to
  // client) still works; lobby-specific behaviour is covered by
  // room-lobby.test.ts.
  it('delivers a round-trip through the hibernated DO', async () => {
    const code = await createRoom();
    const ws = await openWs(code);

    const received = new Promise<string>((resolve) => {
      ws.addEventListener(
        'message',
        (e) => resolve(e.data as string),
        { once: true },
      );
    });
    ws.send('not-valid-json');
    const parsed = JSON.parse(await received) as { type: string; code: string };
    expect(parsed.type).toBe('ERROR');
    expect(parsed.code).toBe('BAD_PAYLOAD');
  });

  it('returns 404 for an uninitialised room code', async () => {
    // Valid alphabet, but never created via POST /rooms.
    const res = await SELF.fetch('http://example.com/rooms/ABCDE/ws', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
  });

  it('returns 426 when the Upgrade header is missing', async () => {
    const code = await createRoom();
    const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`);
    expect(res.status).toBe(426);
    expect(res.headers.get('upgrade')).toBe('websocket');
  });

  it('returns 400 for a malformed code', async () => {
    // Path regex requires 5 chars; "ABC" is 3 → 404 (falls through). Test a
    // 5-char path that sneaks past the path regex but fails the alphabet
    // regex. Path regex is [A-Z2-9], alphabet excludes O and I.
    // Hit the alphabet check with ABCDO (has O) — but path regex disallows O too.
    // The only way to reach the 400 branch is with a code that matches
    // [A-Z2-9]{5} but not [23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}, i.e. it
    // contains I or O. Both are in [A-Z]. Use "ABCDO".
    const res = await SELF.fetch('http://example.com/rooms/ABCDO/ws', {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 405 for a non-GET method on /rooms/:code/ws', async () => {
    const code = await createRoom();
    const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });
});
