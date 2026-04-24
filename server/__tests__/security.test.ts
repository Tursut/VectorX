// Step 20: abuse hardening — origin allow-list, per-IP rate limits, WS frame
// size cap, and post-GAME_OVER storage reaper. These defences protect the
// free-tier quotas from a casual griefer; without them, anyone who finds the
// worker URL could spam POST /rooms or WS handshakes and exhaust our budget.

import { env, runInDurableObject, runDurableObjectAlarm, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetRateLimiters } from '../index';

// Module-level rate-limit map is isolate-local and persists across tests.
// Reset between tests so caps are predictable.
beforeEach(() => _resetRateLimiters());

const openSockets: WebSocket[] = [];
afterEach(async () => {
  await Promise.all(openSockets.splice(0).map((ws) => drain(ws)));
});

async function drain(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
  try { ws.close(1000); } catch { return; }
  await Promise.race([closed, new Promise((r) => setTimeout(r, 200))]);
}

async function createRoom(): Promise<string> {
  const res = await SELF.fetch('http://example.com/rooms', { method: 'POST' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

// ---------------------------------------------------------------------------
// 1. Origin allow-list
// ---------------------------------------------------------------------------
describe('security — Origin allow-list', () => {
  it('allows POST /rooms with no Origin header (CLI / server-side fetch)', async () => {
    const res = await SELF.fetch('http://example.com/rooms', { method: 'POST' });
    expect(res.status).toBe(201);
  });

  it('allows POST /rooms from an allowlisted Origin', async () => {
    const res = await SELF.fetch('http://example.com/rooms', {
      method: 'POST',
      headers: { Origin: 'https://tursut.github.io' },
    });
    expect(res.status).toBe(201);
  });

  it('403s POST /rooms from a non-allowlisted Origin', async () => {
    const res = await SELF.fetch('http://example.com/rooms', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('403s WS upgrade from a non-allowlisted Origin', async () => {
    const code = await createRoom();
    const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 2. Per-IP rate limits
// ---------------------------------------------------------------------------
describe('security — per-IP rate limits', () => {
  it('rate-limits the 11th POST /rooms from the same IP within a minute', async () => {
    const headers = { 'CF-Connecting-IP': '198.51.100.42' };
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch('http://x/rooms', { method: 'POST', headers });
      expect(res.status).toBe(201);
    }
    const res = await SELF.fetch('http://x/rooms', { method: 'POST', headers });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('does not cross-contaminate between IPs', async () => {
    // Burn the budget for IP A.
    for (let i = 0; i < 10; i++) {
      const res = await SELF.fetch('http://x/rooms', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.1' },
      });
      expect(res.status).toBe(201);
    }
    // IP B still gets served.
    const res = await SELF.fetch('http://x/rooms', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.2' },
    });
    expect(res.status).toBe(201);
  });

  it('POST /rooms and WS handshake buckets are independent', async () => {
    const ip = { 'CF-Connecting-IP': '198.51.100.3' };
    // Burn 10 room creations for this IP.
    for (let i = 0; i < 10; i++) {
      await SELF.fetch('http://x/rooms', { method: 'POST', headers: ip });
    }
    // WS handshake scope is independent; should still succeed.
    const code = await createRoom(); // uses a different (no-IP) caller
    const res = await SELF.fetch(`http://x/rooms/${code}/ws`, {
      headers: { ...ip, Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    res.webSocket?.accept();
    if (res.webSocket) openSockets.push(res.webSocket);
  });
});

// ---------------------------------------------------------------------------
// 3. WS frame size cap
// ---------------------------------------------------------------------------
describe('security — WS frame size cap', () => {
  it('closes the socket with code 1009 when an oversized frame is sent', async () => {
    const code = await createRoom();
    const res = await SELF.fetch(`http://x/rooms/${code}/ws`, {
      headers: { Upgrade: 'websocket' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    openSockets.push(ws);

    const closed = new Promise<{ code: number }>((resolve) => {
      ws.addEventListener(
        'close',
        (e) => resolve({ code: (e as CloseEvent).code }),
        { once: true },
      );
    });

    // 5 KiB payload — well over the 4 KiB cap.
    ws.send('x'.repeat(5 * 1024));

    const result = await Promise.race([
      closed,
      new Promise<{ code: number }>((_, r) =>
        setTimeout(() => r(new Error('close event timeout')), 500),
      ),
    ]);
    expect(result.code).toBe(1009);
  });
});

// ---------------------------------------------------------------------------
// 4. Room reaper after GAME_OVER
// ---------------------------------------------------------------------------
describe('security — post-GAME_OVER storage reaper', () => {
  it('deleteAll()s storage when the reaper alarm fires after 10 min', async () => {
    const code = await createRoom();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));

    // Seed reaperAt in the past but set the alarm far enough in the future
    // that workerd doesn't auto-fire it before runDurableObjectAlarm gets to
    // trigger the handler. When the handler runs, it checks reaperAt vs now
    // and takes the reap branch because reaperAt < now.
    await runInDurableObject(stub, async (_i, state) => {
      await state.storage.put('reaperAt', Date.now() - 1000);
      await state.storage.setAlarm(Date.now() + 60_000);
    });

    const fired = await runDurableObjectAlarm(stub);
    expect(fired).toBe(true);

    // After the reaper, storage should be empty — the `code` key is gone,
    // which is what makes subsequent WS upgrades 404 for this room.
    const snap = await runInDurableObject(stub, async (_i, state) => {
      const list = await state.storage.list();
      return { size: list.size, alarm: await state.storage.getAlarm() };
    });
    expect(snap.size).toBe(0);
    expect(snap.alarm).toBeNull();
  });

  // Note: the "reaper alarm is scheduled when a real game ends" invariant is
  // covered by the updated assertions in room-bots.test.ts and
  // room-disconnect.test.ts — both assert the alarm is ~10 min out after a
  // genuine gameover transition. This file covers the reap action itself.
});
