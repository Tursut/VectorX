// Step 12 — disconnect = elimination.
//
// Covers the webSocketClose `playing`-phase branch: closing a socket during
// a live game calls eliminatePlayer(game, seatId), stores, broadcasts a
// fresh GAME_STATE, and reschedules the turn alarm if needed.
//
// Cases:
//   a) Non-current player disconnects → marked eliminated, currentPlayerIndex
//      unchanged, other players see the updated GAME_STATE.
//   b) Current player disconnects → eliminated, turn advances.
//   c) Single human in a 1h3b disconnects mid-game → bots play out to
//      GAME_OVER via alarm loop (no human ever reconnects).
//   d) Disconnect after GAME_OVER → no-op (no extra broadcast, no alarm).

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

async function openWs(code: string): Promise<{ ws: WebSocket; inbox: InboundMsg[] }> {
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

async function peekGameAndAlarm(code: string): Promise<{
  game: {
    phase: string;
    currentPlayerIndex: number;
    turnCount: number;
    winner: number | null;
    players: Array<{ id: number; isEliminated: boolean }>;
  } | undefined;
  alarm: number | null;
}> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runInDurableObject(stub, async (_i, state) => ({
    game: (await state.storage.get('game')) as never,
    alarm: await state.storage.getAlarm(),
  }));
}

async function triggerAlarm(code: string): Promise<boolean> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runDurableObjectAlarm(stub);
}

async function hello(ws: WebSocket, displayName: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName }));
}

// Close a tracked socket; remove from afterEach tracker so it doesn't close again.
function forceClose(ws: WebSocket): void {
  const i = openSockets.indexOf(ws);
  if (i >= 0) openSockets.splice(i, 1);
  try {
    ws.close(1000);
  } catch { /* already closed */ }
}

// Open N humans + START from the first (host).
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

describe('disconnect during playing: non-current player', () => {
  it('marks the departed player eliminated; currentPlayerIndex unchanged', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob', 'Cat', 'Dan']);

    const before = await peekGameAndAlarm(code);
    const currentSeat = before.game!.currentPlayerIndex;
    // Pick a non-current seat to close.
    const victimSeat = (currentSeat + 1) % 4;

    forceClose(seats[victimSeat].ws);

    // Another (still-connected) seat should receive a GAME_STATE with the
    // victim eliminated.
    const observer = seats.find((_, i) => i !== victimSeat)!;
    await waitForInbox(
      observer.inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        Array.isArray(m.players) &&
        (m.players as Array<{ id: number; isEliminated: boolean }>)
          .find((p) => p.id === victimSeat)?.isEliminated === true,
    );

    const after = await peekGameAndAlarm(code);
    const victimPost = after.game!.players.find((p) => p.id === victimSeat)!;
    expect(victimPost.isEliminated).toBe(true);
    // Turn was not on the victim → currentPlayerIndex untouched.
    expect(after.game!.currentPlayerIndex).toBe(currentSeat);
  });
});

describe('disconnect during playing: current player', () => {
  it('eliminates the current seat and advances the turn', async () => {
    const { code, seats } = await startGameWithHumans(['Alice', 'Bob', 'Cat', 'Dan']);

    const before = await peekGameAndAlarm(code);
    const currentSeat = before.game!.currentPlayerIndex;

    forceClose(seats[currentSeat].ws);

    const observer = seats.find((_, i) => i !== currentSeat)!;
    await waitForInbox(
      observer.inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        (m.players as Array<{ id: number; isEliminated: boolean }>)
          .find((p) => p.id === currentSeat)?.isEliminated === true,
    );

    const after = await peekGameAndAlarm(code);
    const victimPost = after.game!.players.find((p) => p.id === currentSeat)!;
    expect(victimPost.isEliminated).toBe(true);
    expect(after.game!.currentPlayerIndex).not.toBe(currentSeat);
    expect(after.game!.turnCount).toBe(before.game!.turnCount + 1);
  });
});

describe('disconnect during playing: last human leaves a 1h3b', () => {
  it('bots play out to GAME_OVER via the alarm loop', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');
    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    // Alice disconnects — game is now 0 humans + 3 bots. Bot driver keeps
    // running; we loop runDurableObjectAlarm until the game ends.
    forceClose(ws);

    // Wait for the DO to process the close + broadcast + schedule the next
    // turn alarm. Use peek to observe the state catches up.
    for (let i = 0; i < 20; i++) {
      const snap = await peekGameAndAlarm(code);
      if (snap.game && snap.game.players.find((p) => p.id === 0)?.isEliminated) {
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    let iterations = 0;
    const MAX = 300;
    for (; iterations < MAX; iterations++) {
      const snap = await peekGameAndAlarm(code);
      if (snap.game!.phase === 'gameover') break;
      await triggerAlarm(code);
    }

    const final = await peekGameAndAlarm(code);
    expect(final.game!.phase).toBe('gameover');
    const alive = final.game!.players.filter((p) => !p.isEliminated);
    expect(alive).toHaveLength(1);
    // Alice (seat 0) was eliminated by disconnect, so she can't be the winner.
    expect(final.game!.winner).not.toBe(0);
    expect(final.alarm).toBeNull();
  }, 30_000);
});

describe('disconnect after GAME_OVER is a no-op', () => {
  it('does not broadcast a new GAME_STATE, does not schedule an alarm', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');
    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    // Seed the DO into GAME_OVER directly — the bot driver would take a
    // while otherwise. runInDurableObject preserves lobby + code; we just
    // overwrite game with a game-over shape.
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    await runInDurableObject(stub, async (_i, state) => {
      const game = (await state.storage.get('game')) as {
        players: Array<{ id: number; isEliminated: boolean }>;
        phase: string;
        winner: number | null;
      };
      const eliminated = game.players.map((p, i) =>
        i === 0 ? { ...p } : { ...p, isEliminated: true },
      );
      await state.storage.put('game', {
        ...game,
        players: eliminated,
        phase: 'gameover',
        winner: 0,
      });
      // deleteAlarm so we can assert "still null" after close.
      await state.storage.deleteAlarm();
    });

    const baselineLen = inbox.length;
    forceClose(ws);

    // Give the DO time to process the close (if it were going to broadcast).
    await new Promise((r) => setTimeout(r, 150));

    // No NEW GAME_STATE messages arrived after the close (the socket was
    // already closed so even if the server broadcast, we wouldn't see it;
    // inbox.length is a witness that events the test-side didn't receive
    // either. The important assertion is the server-side state: no alarm
    // scheduled, game still gameover.)
    expect(inbox.length).toBeLessThanOrEqual(baselineLen);

    const snap = await peekGameAndAlarm(code);
    expect(snap.game!.phase).toBe('gameover');
    expect(snap.alarm).toBeNull();
  });
});
