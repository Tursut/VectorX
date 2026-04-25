// Lobby-phase disconnect grace.
//
// iOS Safari aggressively suspends backgrounded tabs, which closes the
// WebSocket without a clean 1000 frame. To stop a host from being demoted
// (or a joiner from being phantom-evicted) every time the user switches
// browsers, the server holds the seat for LOBBY_GRACE_MS after an abnormal
// close. A re-HELLO with the same displayName resumes the same seat; the
// alarm sweeps any seats whose grace expired and broadcasts the cleaned-up
// LOBBY_STATE.
//
// Cases:
//   a) Abnormal close (code != 1000) during lobby holds the seat for
//      observers — no LOBBY_STATE broadcast, no host change, alarm scheduled.
//   b) Re-HELLO with the same displayName resumes the seat. Host doesn't
//      change. New socket gets LOBBY_STATE; other clients see no change.
//   c) Grace expiry via alarm removes the seat and reassigns host.
//   d) Clean close (code 1000) still removes immediately (regression).

import {
  SELF,
  env,
  runInDurableObject,
  runDurableObjectAlarm,
} from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

// ---------- Harness ----------

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

type InboundMsg = { type: string; [k: string]: unknown };

async function openWs(
  code: string,
): Promise<{ ws: WebSocket; inbox: InboundMsg[] }> {
  const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const inbox: InboundMsg[] = [];
  ws.addEventListener('message', (e) => {
    inbox.push(JSON.parse(e.data as string) as InboundMsg);
  });
  openSockets.push(ws);
  return { ws, inbox };
}

async function hello(ws: WebSocket, displayName: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName }));
}

async function waitForInbox(
  inbox: InboundMsg[],
  predicate: (msg: InboundMsg) => boolean,
  timeoutMs = 1000,
): Promise<InboundMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout waiting for inbox entry');
}

// Close a socket with a non-1000 code so the server treats it as iOS-like
// suspension. 1006 is the canonical "abnormal closure" code; the runtime
// rejects it from ws.close() (only 1000 + 3000–4999 are app-allowed), so we
// use 4000 — anything in the 4000–4999 application-defined range trips the
// server's "not 1000 → grace" branch identically.
function abnormalClose(ws: WebSocket): void {
  const i = openSockets.indexOf(ws);
  if (i >= 0) openSockets.splice(i, 1);
  try {
    ws.close(4000, 'simulated suspend');
  } catch {
    // already closed — harmless
  }
}

// Backdate a disconnected player's `disconnectedAt` past the grace window so
// `runDurableObjectAlarm` will sweep them on the next tick. Keeps tests fast
// (no 20s wait).
async function expireGrace(code: string, seatId: number): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  await runInDurableObject(stub, async (_i, state) => {
    const lobby = (await state.storage.get('lobby')) as {
      players: Array<{ id: number; disconnectedAt: number | null }>;
    };
    const players = lobby.players.map((p) =>
      p.id === seatId ? { ...p, disconnectedAt: 1 } : p,
    );
    await state.storage.put('lobby', { ...lobby, players });
  });
}

// ---------- Cases ----------

describe('abnormal close during lobby — seat held for grace', () => {
  it('observers see no LOBBY_STATE update, host unchanged, alarm scheduled', async () => {
    const code = await createRoom();
    const { ws: a, inbox: aInbox } = await openWs(code);
    await hello(a, 'Alice');
    await waitForInbox(aInbox, (m) => m.type === 'LOBBY_STATE');

    const { ws: b, inbox: bInbox } = await openWs(code);
    await hello(b, 'Bob');
    await waitForInbox(
      aInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    const aBaseline = aInbox.length;
    abnormalClose(b);

    // Settle: any erroneous broadcast would have arrived by now.
    await new Promise((r) => setTimeout(r, 100));

    // No new LOBBY_STATE messages reached Alice — Bob still appears in the
    // lobby from her view.
    const newAFor = aInbox.slice(aBaseline);
    expect(newAFor.filter((m) => m.type === 'LOBBY_STATE')).toHaveLength(0);

    // Server-side: Bob's seat is flagged disconnected, host is still Alice,
    // and a grace alarm is queued.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const snap = await runInDurableObject(stub, async (_i, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; displayName: string; disconnectedAt: number | null }>;
        hostId: number | null;
      },
      alarm: await state.storage.getAlarm(),
    }));
    expect(snap.lobby.hostId).toBe(0);
    expect(snap.lobby.players).toHaveLength(2);
    const bob = snap.lobby.players.find((p) => p.displayName === 'Bob')!;
    expect(bob.disconnectedAt).not.toBeNull();
    expect(snap.alarm).not.toBeNull();
  });
});

describe('re-HELLO same name during grace — resume same seat', () => {
  it('reattaches to the previously-held seat; host unchanged', async () => {
    const code = await createRoom();
    const { ws: a } = await openWs(code);
    await hello(a, 'Alice');

    const { ws: b1, inbox: b1Inbox } = await openWs(code);
    await hello(b1, 'Bob');
    await waitForInbox(
      b1Inbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    abnormalClose(b1);

    // Bob reconnects on a fresh socket within the grace window.
    const { ws: b2, inbox: b2Inbox } = await openWs(code);
    await hello(b2, 'Bob');
    const lobby = await waitForInbox(
      b2Inbox,
      (m) => m.type === 'LOBBY_STATE',
    );

    // Resumed his original seat (id 1) and the original host (Alice, id 0)
    // is still host. Two players, no duplicates.
    expect(lobby).toMatchObject({
      type: 'LOBBY_STATE',
      hostId: 0,
      players: [
        { id: 0, displayName: 'Alice', isHost: true },
        { id: 1, displayName: 'Bob', isHost: false },
      ],
    });

    // Server-side: Bob's disconnectedAt cleared, no alarm pending.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const snap = await runInDurableObject(stub, async (_i, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ displayName: string; disconnectedAt: number | null }>;
      },
      alarm: await state.storage.getAlarm(),
    }));
    const bob = snap.lobby.players.find((p) => p.displayName === 'Bob')!;
    expect(bob.disconnectedAt).toBeNull();
    expect(snap.alarm).toBeNull();
  });

  it('host re-HELLO during grace resumes host role (no demotion)', async () => {
    const code = await createRoom();
    const { ws: a1, inbox: a1Inbox } = await openWs(code);
    await hello(a1, 'Alice');
    await waitForInbox(a1Inbox, (m) => m.type === 'LOBBY_STATE');

    const { ws: b, inbox: bInbox } = await openWs(code);
    await hello(b, 'Bob');
    await waitForInbox(
      bInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    // Alice (the host) suspends.
    abnormalClose(a1);

    // Bob's view shouldn't have changed — Alice is still listed as host.
    await new Promise((r) => setTimeout(r, 50));
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const midSnap = await runInDurableObject(stub, async (_i, state) => ({
      lobby: (await state.storage.get('lobby')) as { hostId: number | null },
    }));
    expect(midSnap.lobby.hostId).toBe(0);

    // Alice reconnects — still host.
    const { ws: a2, inbox: a2Inbox } = await openWs(code);
    await hello(a2, 'Alice');
    const lobby = await waitForInbox(
      a2Inbox,
      (m) => m.type === 'LOBBY_STATE',
    );
    expect(lobby).toMatchObject({ type: 'LOBBY_STATE', hostId: 0 });
  });
});

describe('grace expiry via alarm — seat dropped, host reassigned', () => {
  it('expired host disconnect promotes the next-lowest player', async () => {
    const code = await createRoom();
    const { ws: a, inbox: aInbox } = await openWs(code);
    await hello(a, 'Alice');
    await waitForInbox(aInbox, (m) => m.type === 'LOBBY_STATE');

    const { ws: b, inbox: bInbox } = await openWs(code);
    await hello(b, 'Bob');
    await waitForInbox(
      bInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    abnormalClose(a);
    // Wait for the close handler to mark Alice's seat disconnected before
    // we backdate the timestamp — otherwise our mutation can race the
    // close-side write and lose to it.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    for (let i = 0; i < 50; i++) {
      const flagged = await runInDurableObject(stub, async (_x, state) => {
        const l = (await state.storage.get('lobby')) as {
          players: Array<{ id: number; disconnectedAt: number | null }>;
        };
        return l.players.find((p) => p.id === 0)?.disconnectedAt !== null;
      });
      if (flagged) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    // Backdate Alice's disconnect so the alarm sweeps her right away.
    await expireGrace(code, 0);

    const updated = waitForInbox(
      bInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 1,
      3000,
    );
    const fired = await runDurableObjectAlarm(stub);
    expect(fired).toBe(true);

    const lobby = await updated;
    expect(lobby).toMatchObject({
      type: 'LOBBY_STATE',
      hostId: 1,
      players: [{ id: 1, displayName: 'Bob', isHost: true }],
    });
  });
});

describe('clean close (code 1000) during lobby — immediate removal', () => {
  it('still drops the seat and broadcasts LOBBY_STATE without a grace wait', async () => {
    const code = await createRoom();
    const { ws: a, inbox: aInbox } = await openWs(code);
    await hello(a, 'Alice');
    await waitForInbox(aInbox, (m) => m.type === 'LOBBY_STATE');

    const { ws: b } = await openWs(code);
    await hello(b, 'Bob');
    await waitForInbox(
      aInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    const removed = waitForInbox(
      aInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 1,
    );
    // Deliberate close — code 1000.
    const i = openSockets.indexOf(b);
    if (i >= 0) openSockets.splice(i, 1);
    b.close(1000);

    const lobby = await removed;
    expect(lobby).toMatchObject({
      type: 'LOBBY_STATE',
      hostId: 0,
      players: [{ id: 0, displayName: 'Alice', isHost: true }],
    });
  });
});
