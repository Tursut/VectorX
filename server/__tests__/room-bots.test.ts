// Step 11 — bot driver tests.
//
// Covers:
//   1. Identity: bots in a 1h3b room appear with 🤖 shortName display names.
//   2. Alarm scheduling + advance: after START (and after a human move when
//      the next seat is a bot), a DO alarm is scheduled; triggering it
//      advances the game and broadcasts a fresh GAME_STATE.
//   3. All-bots simulation (the plan's verify gate): seed a 0-human,
//      4-bot room and drive the alarm forward until GAME_OVER.
//   4. Seat recycling invariant: humans always occupy dense seat ids
//      0..N-1. Locks the Step 11 assumption that
//      `gremlinCount = 4 - N` correctly maps to empty seats at START.

import {
  SELF,
  env,
  runInDurableObject,
  runDurableObjectAlarm,
} from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { initGame } from '../../src/game/logic';

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

type InboundMsg = { type: string; [k: string]: unknown };

async function waitForInbox(
  inbox: InboundMsg[],
  predicate: (msg: InboundMsg) => boolean,
  timeoutMs = 1500,
): Promise<InboundMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout waiting for inbox entry');
}

function latestGameState(inbox: InboundMsg[]): InboundMsg | undefined {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].type === 'GAME_STATE') return inbox[i];
  }
  return undefined;
}

async function peekGameAndAlarm(code: string): Promise<{
  game: { phase: string; currentPlayerIndex: number; turnCount: number; winner: number | null; players: Array<{ id: number; isEliminated: boolean }> } | undefined;
  lobby: { players: Array<{ id: number }>; phase: string } | undefined;
  alarm: number | null;
}> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runInDurableObject(stub, async (_i, state) => ({
    game: (await state.storage.get('game')) as never,
    lobby: (await state.storage.get('lobby')) as never,
    alarm: await state.storage.getAlarm(),
  }));
}

async function triggerAlarm(code: string): Promise<boolean> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runDurableObjectAlarm(stub);
}

async function firstAdjacentEmpty(
  gs: InboundMsg,
): Promise<{ row: number; col: number }> {
  const players = gs.players as Array<{ id: number; row: number; col: number }>;
  const grid = gs.grid as Array<Array<{ owner: number | null }>>;
  const cp = players[gs.currentPlayerIndex as number];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = cp.row + dr;
      const nc = cp.col + dc;
      if (nr < 0 || nr > 9 || nc < 0 || nc > 9) continue;
      if (grid[nr][nc].owner === null) return { row: nr, col: nc };
    }
  }
  throw new Error('no adjacent empty cell');
}

async function hello(ws: WebSocket, displayName: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName }));
}

// ---------- Tests ----------

describe('bot fill: identity in GAME_STATE', () => {
  it('1h3b room marks seats 1..3 as bots with 🤖 shortName display names', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');

    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    const gs = await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    const players = gs.players as Array<{
      id: number;
      displayName: string;
      isBot: boolean;
      isHost: boolean;
    }>;
    expect(players).toHaveLength(4);
    expect(players[0]).toMatchObject({
      displayName: 'Alice',
      isBot: false,
      isHost: true,
    });
    expect(players[1]).toMatchObject({
      displayName: '🤖 Gerald',
      isBot: true,
      isHost: false,
    });
    expect(players[2]).toMatchObject({
      displayName: '🤖 Bluebot',
      isBot: true,
      isHost: false,
    });
    expect(players[3]).toMatchObject({
      displayName: '🤖 Buzzilda',
      isBot: true,
      isHost: false,
    });
  });
});

describe('bot driver: alarm scheduling + advance', () => {
  it('after START, if current seat is a bot, an alarm is scheduled; firing it advances the game', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');

    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    // If the first turn landed on Alice (seat 0, human), play one move so the
    // next turn is a bot's. Otherwise the first turn is already a bot's.
    let snap = await peekGameAndAlarm(code);
    if (snap.game!.currentPlayerIndex === 0) {
      const gs = latestGameState(inbox)!;
      const target = await firstAdjacentEmpty(gs);
      ws.send(JSON.stringify({ type: 'MOVE', row: target.row, col: target.col }));
      await waitForInbox(
        inbox,
        (m) => m.type === 'GAME_STATE' && m.turnCount === 1,
      );
      snap = await peekGameAndAlarm(code);
    }

    // Now the current seat must be a bot (seat id > 0), and the DO should have
    // scheduled an alarm to drive it.
    expect(snap.game!.currentPlayerIndex).not.toBe(0);
    expect(snap.alarm).not.toBeNull();

    const turnBefore = snap.game!.turnCount;
    const ran = await triggerAlarm(code);
    expect(ran).toBe(true);

    // The bot move produced a new GAME_STATE broadcast.
    await waitForInbox(
      inbox,
      (m) => m.type === 'GAME_STATE' && m.turnCount === turnBefore + 1,
    );
    const snap2 = await peekGameAndAlarm(code);
    expect(snap2.game!.turnCount).toBe(turnBefore + 1);
  });
});

describe('all-bots simulation', () => {
  it('seed 4 bots → drive alarms until GAME_OVER → exactly one winner', async () => {
    const code = await createRoom();
    const stub = env.ROOM.get(env.ROOM.idFromName(code));

    // Seed the DO into a post-START-with-zero-humans shape. This mirrors what
    // handleStart would produce if a 0-human START were reachable.
    // COUPLING: if handleStart starts writing more fields (e.g. startedAt),
    // this seed has to keep up. Don't let the two shapes diverge silently.
    await runInDurableObject(stub, async (_i, state) => {
      await state.storage.put({
        lobby: {
          players: [],
          hostId: null,
          phase: 'playing',
          magicItems: false,
        },
        game: initGame(false, 4),
      });
      await state.storage.setAlarm(Date.now());
    });

    // Drive the alarm forward. Each trigger runs one bot turn and
    // reschedules. Break early when the game ends.
    let iterations = 0;
    const MAX_ITERATIONS = 300;
    try {
      for (iterations = 0; iterations < MAX_ITERATIONS; iterations++) {
        const snap = await peekGameAndAlarm(code);
        if (snap.game!.phase === 'gameover') break;
        await triggerAlarm(code);
      }
    } catch (err) {
      throw new Error(
        `all-bots simulation threw at iteration ${iterations}: ${(err as Error).message}`,
      );
    }

    const final = await peekGameAndAlarm(code);
    expect(final.game!.phase).toBe('gameover');
    // Post-GAME_OVER the server schedules a reaper alarm 10 min out so stale
    // rooms don't accumulate. Assert it's roughly that far in the future, not
    // that it's null.
    expect(final.alarm).not.toBeNull();
    expect(final.alarm! - Date.now()).toBeGreaterThan(9 * 60 * 1000);

    const alive = final.game!.players.filter((p) => !p.isEliminated);
    // Winner is the lone survivor; winner field on game state matches.
    expect(alive).toHaveLength(1);
    expect(final.game!.winner).toBe(alive[0].id);
  }, 30_000);
});

describe('seat recycling invariant', () => {
  it('vacated slot is reclaimed by next HELLO (dense 0..N-1 ids)', async () => {
    const code = await createRoom();
    const sockets: Array<{ ws: WebSocket; inbox: InboundMsg[] }> = [];
    for (let i = 0; i < 4; i++) {
      const entry = await openWs(code);
      sockets.push(entry);
      await hello(entry.ws, `Player${i}`);
      await waitForInbox(
        entry.inbox,
        (m) =>
          m.type === 'LOBBY_STATE' &&
          Array.isArray(m.players) &&
          (m.players as unknown[]).length === i + 1,
      );
    }

    // Close seat 2's socket and wait for remaining sockets to see it.
    const leaver = sockets[2];
    leaver.ws.close(1000);
    const leaverIdx = openSockets.indexOf(leaver.ws);
    if (leaverIdx >= 0) openSockets.splice(leaverIdx, 1);
    await waitForInbox(
      sockets[0].inbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        (m.players as unknown[]).length === 3,
    );

    // A fresh socket joins. It should land on the reclaimed slot 2, not 4.
    const newEntry = await openWs(code);
    await hello(newEntry.ws, 'Eve');
    await waitForInbox(
      newEntry.inbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        (m.players as unknown[]).length === 4,
    );

    const snap = await peekGameAndAlarm(code);
    const ids = snap.lobby!.players.map((p) => p.id).sort();
    expect(ids).toEqual([0, 1, 2, 3]);
  });
});
