// Playing-phase disconnect grace.
//
// Mirrors the lobby-phase grace policy but kicks in after START. Pre-#22 the
// server eliminated a disconnected player immediately; that broke single-
// phone-two-browsers testing (focusing one browser kills the other within
// seconds of START) and also penalised real users for tab switches mid-game.
// Now: an abnormal close marks the seat with `disconnectedAt`, holds it for
// PLAYING_GRACE_MS, and lets a re-HELLO with the same displayName reattach
// + receive a fresh GAME_STATE. Grace expiry runs the existing eliminate
// path. Code 1000 still eliminates immediately (deliberate exit-to-menu).
//
// Cases covered here:
//   a) Abnormal close mid-game holds the seat (no isEliminated flip).
//   b) Re-HELLO with the same name reattaches + sends GAME_STATE.
//   c) Grace expiry via alarm eliminates the seat.
//   d) Clean close (code 1000) still eliminates immediately (regression).

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
  timeoutMs = 2000,
): Promise<InboundMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout waiting for inbox entry');
}

// Close a tracked socket with a non-1000 code so the server treats it as
// transient (the lobby/playing-phase grace branch). 4000 is application-
// defined and trips the same "not 1000" path as iOS suspension's 1006.
function abnormalClose(ws: WebSocket): void {
  const i = openSockets.indexOf(ws);
  if (i >= 0) openSockets.splice(i, 1);
  try {
    ws.close(4000, 'simulated suspend');
  } catch {
    // already closed — harmless
  }
}

// Backdate a player's `disconnectedAt` past the grace window so the alarm
// will pick them up on the next fire. Keeps tests fast.
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

// Open N humans and START. Returns code + per-seat handles.
async function startGameWithHumans(
  names: string[],
): Promise<{ code: string; seats: Array<{ ws: WebSocket; inbox: InboundMsg[] }> }> {
  const code = await createRoom();
  const seats: Array<{ ws: WebSocket; inbox: InboundMsg[] }> = [];
  for (let i = 0; i < names.length; i++) {
    const seat = await openWs(code);
    seats.push(seat);
    await hello(seat.ws, names[i]);
    await waitForInbox(
      seat.inbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === i + 1,
    );
  }
  seats[0].ws.send(JSON.stringify({ type: 'START', magicItems: false }));
  for (const s of seats) {
    await waitForInbox(s.inbox, (m) => m.type === 'GAME_STATE');
  }
  return { code, seats };
}

// ---------- Cases ----------

describe('abnormal close mid-game holds the seat', () => {
  it('does NOT mark the player eliminated; sets disconnectedAt instead', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob']);

    abnormalClose(seats[1].ws);

    // Wait for the close handler to flip disconnectedAt.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    for (let i = 0; i < 50; i++) {
      const flagged = await runInDurableObject(stub, async (_x, state) => {
        const l = (await state.storage.get('lobby')) as {
          players: Array<{ id: number; disconnectedAt: number | null }>;
        };
        return l.players.find((p) => p.id === 1)?.disconnectedAt !== null;
      });
      if (flagged) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    const snap = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; disconnectedAt: number | null }>;
      },
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
      alarm: await state.storage.getAlarm(),
    }));

    // Bob's seat is flagged disconnected …
    expect(snap.lobby.players.find((p) => p.id === 1)?.disconnectedAt).not.toBeNull();
    // … but not yet eliminated in the game state.
    expect(snap.game.players.find((p) => p.id === 1)?.isEliminated).toBe(false);
    // Alarm scheduled for the grace deadline (or sooner if a turn is up).
    expect(snap.alarm).not.toBeNull();
  });
});

describe('re-HELLO mid-game during grace reattaches the seat', () => {
  it('clears disconnectedAt and pushes a fresh GAME_STATE to the recovering socket', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob']);

    abnormalClose(seats[1].ws);

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    for (let i = 0; i < 50; i++) {
      const flagged = await runInDurableObject(stub, async (_x, state) => {
        const l = (await state.storage.get('lobby')) as {
          players: Array<{ id: number; disconnectedAt: number | null }>;
        };
        return l.players.find((p) => p.id === 1)?.disconnectedAt !== null;
      });
      if (flagged) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // Bob reconnects on a fresh socket.
    const { ws: bobReconnect, inbox: bobInbox } = await openWs(code);
    await hello(bobReconnect, 'Bob');

    // Server pushes a GAME_STATE specifically to the recovering socket.
    const gs = await waitForInbox(bobInbox, (m) => m.type === 'GAME_STATE');
    expect(gs).toMatchObject({ type: 'GAME_STATE' });

    // disconnectedAt cleared on Bob's seat. Bob still alive in game.
    const snap = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; disconnectedAt: number | null }>;
      },
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
    }));
    expect(snap.lobby.players.find((p) => p.id === 1)?.disconnectedAt).toBeNull();
    expect(snap.game.players.find((p) => p.id === 1)?.isEliminated).toBe(false);
  });

  it('returns ALREADY_STARTED for a fresh-name HELLO mid-game (regression)', async () => {
    const { code } = await startGameWithHumans(['Alice', 'Bob']);

    const { ws: latecomer, inbox: latecomerInbox } = await openWs(code);
    await hello(latecomer, 'Charlie');

    const err = await waitForInbox(latecomerInbox, (m) => m.type === 'ERROR');
    expect(err).toMatchObject({ type: 'ERROR', code: 'ALREADY_STARTED' });
  });
});

describe('grace expiry mid-game eliminates the seat', () => {
  it('alarm fires after grace; seat flips to isEliminated, GAME_STATE broadcasts', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob']);

    abnormalClose(seats[1].ws);

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    for (let i = 0; i < 50; i++) {
      const flagged = await runInDurableObject(stub, async (_x, state) => {
        const l = (await state.storage.get('lobby')) as {
          players: Array<{ id: number; disconnectedAt: number | null }>;
        };
        return l.players.find((p) => p.id === 1)?.disconnectedAt !== null;
      });
      if (flagged) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    await expireGrace(code, 1);

    // Watch Alice's inbox for the elimination broadcast.
    const updated = waitForInbox(
      seats[0].inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        Array.isArray(m.players) &&
        (m.players as Array<{ id: number; isEliminated: boolean }>)
          .find((p) => p.id === 1)?.isEliminated === true,
      3000,
    );

    const fired = await runDurableObjectAlarm(stub);
    expect(fired).toBe(true);
    await updated;

    // Server-side: Bob is eliminated, disconnectedAt cleared.
    const snap = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; disconnectedAt: number | null }>;
      },
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
    }));
    expect(snap.lobby.players.find((p) => p.id === 1)?.disconnectedAt).toBeNull();
    expect(snap.game.players.find((p) => p.id === 1)?.isEliminated).toBe(true);
  });
});

describe('player disconnected in lobby survives across START', () => {
  // The exact repro the issue surfaced: host on Chrome creates the room,
  // joiner on Safari joins, user switches back to Chrome to tap START.
  // Safari's tab is now backgrounded → its WS suspends → the joiner is
  // marked disconnected in lobby. Pre-fix, handleStart filtered them out
  // and the playing-phase recovery had no seat to match against. Now the
  // seat carries through with a refreshed disconnectedAt.
  it('reconnect after START reattaches the carried-over disconnected seat', async () => {
    const code = await createRoom();

    const { ws: alice, inbox: aliceInbox } = await openWs(code);
    await hello(alice, 'Alice');
    await waitForInbox(aliceInbox, (m) => m.type === 'LOBBY_STATE');

    const { ws: bob, inbox: bobInbox } = await openWs(code);
    await hello(bob, 'Bob');
    await waitForInbox(
      bobInbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === 2,
    );

    // Bob's tab backgrounds in lobby — abnormal close keeps the seat in
    // grace.
    abnormalClose(bob);

    // Wait for the close to land server-side.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    for (let i = 0; i < 50; i++) {
      const flagged = await runInDurableObject(stub, async (_x, state) => {
        const l = (await state.storage.get('lobby')) as {
          players: Array<{ id: number; disconnectedAt: number | null }>;
        };
        return l.players.find((p) => p.id === 1)?.disconnectedAt !== null;
      });
      if (flagged) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // Alice (host) taps START. Bob's seat must NOT be filtered out.
    alice.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(aliceInbox, (m) => m.type === 'GAME_STATE');

    // Server: Bob's seat carried through with fresh disconnectedAt; his
    // game.players entry is alive (not eliminated).
    const startSnap = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; displayName: string; disconnectedAt: number | null }>;
      },
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
    }));
    const bobLobby = startSnap.lobby.players.find((p) => p.displayName === 'Bob');
    expect(bobLobby).toBeDefined();
    expect(bobLobby!.disconnectedAt).not.toBeNull();
    expect(startSnap.game.players.find((p) => p.id === bobLobby!.id)?.isEliminated).toBe(false);

    // Bob comes back: new socket, same name → reattach + GAME_STATE.
    const { ws: bobReconnect, inbox: bobReconnectInbox } = await openWs(code);
    await hello(bobReconnect, 'Bob');
    const gs = await waitForInbox(bobReconnectInbox, (m) => m.type === 'GAME_STATE');
    expect(gs).toMatchObject({ type: 'GAME_STATE' });

    // After reconnect: Bob's flag cleared, still alive in the game.
    const recoveredSnap = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; displayName: string; disconnectedAt: number | null }>;
      },
    }));
    const bobAfter = recoveredSnap.lobby.players.find((p) => p.displayName === 'Bob');
    expect(bobAfter!.disconnectedAt).toBeNull();
  });
});

describe('silent-tab-kill: name match recovers even without a close event', () => {
  // Real-world failure mode debug-panel'd back to us: iOS sometimes kills
  // a backgrounded Safari tab without the WebSocket emitting a close
  // frame. Server's webSocketClose never runs, so the seat stays
  // disconnectedAt: null. When the tab reopens and re-HELLOs, the older
  // strict-recovery check (disconnectedAt !== null) bounced with
  // ALREADY_STARTED. Now name-only match is sufficient mid-game; the
  // stale server-side socket gets explicitly replaced.
  it('reattaches by name even when server-side seat shows disconnectedAt: null', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob']);

    // Confirm the lobby reports Bob as connected (no grace state yet).
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const before = await runInDurableObject(stub, async (_x, state) => ({
      lobby: (await state.storage.get('lobby')) as {
        players: Array<{ id: number; displayName: string; disconnectedAt: number | null }>;
      },
    }));
    expect(before.lobby.players.find((p) => p.displayName === 'Bob')!.disconnectedAt).toBeNull();

    // Bob "comes back" on a fresh socket. The old socket is still alive
    // server-side (seats[1].ws); we never closed it. New HELLO with the
    // same name should still recover.
    const { ws: bobNew, inbox: bobNewInbox } = await openWs(code);
    await hello(bobNew, 'Bob');

    const gs = await waitForInbox(bobNewInbox, (m) => m.type === 'GAME_STATE');
    expect(gs).toMatchObject({ type: 'GAME_STATE' });

    // The old socket got explicitly closed by the server; remove it from
    // afterEach's drain queue so it doesn't double-close.
    const i = openSockets.indexOf(seats[1].ws);
    if (i >= 0) openSockets.splice(i, 1);

    // Bob's seat in the game is still alive (NOT eliminated by the
    // replacement-close — we cleared the attachment before closing).
    const after = await runInDurableObject(stub, async (_x, state) => ({
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
    }));
    expect(after.game.players.find((p) => p.id === 1)?.isEliminated).toBe(false);
  });
});

describe('clean close (code 1000) mid-game eliminates immediately', () => {
  it('still flips isEliminated on close; matches pre-grace behaviour for deliberate exits', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob']);

    // Code 1000: deliberate close (the wrapper's client.close()).
    const idx = openSockets.indexOf(seats[1].ws);
    if (idx >= 0) openSockets.splice(idx, 1);
    seats[1].ws.close(1000);

    // Alice's inbox should see Bob eliminated without waiting on grace.
    await waitForInbox(
      seats[0].inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        Array.isArray(m.players) &&
        (m.players as Array<{ id: number; isEliminated: boolean }>)
          .find((p) => p.id === 1)?.isEliminated === true,
    );

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const snap = await runInDurableObject(stub, async (_x, state) => ({
      game: (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
      },
    }));
    expect(snap.game.players.find((p) => p.id === 1)?.isEliminated).toBe(true);
  });
});
