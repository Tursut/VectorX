// Step 10 — server-authoritative turn loop tests.
//
// Covers: START boots initGame + broadcasts GAME_STATE; MOVE runs
// validateMove + applyMove + broadcasts; illegal moves return typed ERRORs
// (NOT_YOUR_TURN / INVALID_MOVE) and leave state unchanged.
//
// All tests use 4 humans — Step 11 will add bot fill and tests for partial
// rosters. Same SELF.fetch + Response.webSocket + waitForInbox pattern we
// established in room-lobby.test.ts.

import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

// ---------- Harness (same shape as room-lobby.test.ts) ----------

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
  ws.accept();
  openSockets.push(ws);
  return ws;
}

type InboundMsg = { type: string; [k: string]: unknown };

type SeatInbox = {
  ws: WebSocket;
  inbox: InboundMsg[];
};

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

// Open N sockets, HELLO each, START, wait for GAME_STATE on all. Returns
// an array of {ws, inbox} keyed by seat (seatId === array index).
async function startGameWithHumans(
  names: string[],
  magicItems: boolean,
): Promise<{ code: string; seats: SeatInbox[] }> {
  const code = await createRoom();
  const seats: SeatInbox[] = [];

  for (let i = 0; i < names.length; i++) {
    const ws = await openWs(code);
    const inbox: InboundMsg[] = [];
    ws.addEventListener('message', (e) => {
      inbox.push(JSON.parse(e.data as string) as InboundMsg);
    });
    seats.push({ ws, inbox });

    ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName: names[i] }));
    // Wait for each HELLO's LOBBY_STATE to land so seat ids stay deterministic.
    await waitForInbox(
      inbox,
      (m) =>
        m.type === 'LOBBY_STATE' &&
        Array.isArray(m.players) &&
        (m.players as unknown[]).length === i + 1,
    );
  }

  // Host (seat 0) starts.
  seats[0].ws.send(JSON.stringify({ type: 'START', magicItems }));

  // All seats should receive GAME_STATE.
  for (const s of seats) {
    await waitForInbox(s.inbox, (m) => m.type === 'GAME_STATE');
  }

  return { code, seats };
}

// Latest GAME_STATE on a given seat.
function latestGameState(inbox: InboundMsg[]): InboundMsg | undefined {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].type === 'GAME_STATE') return inbox[i];
  }
  return undefined;
}

// Read the game state from the DO directly — used to verify rejected moves
// didn't mutate server state.
async function peekGame(code: string): Promise<unknown> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runInDurableObject(stub, async (_instance, state) => {
    return state.storage.get('game');
  });
}

// ---------- Cases ----------

describe('START — boots initGame and broadcasts GAME_STATE', () => {
  it('all 4 sockets receive a well-formed GAME_STATE', async () => {
    const { seats } = await startGameWithHumans(
      ['Alice', 'Bob', 'Cat', 'Dan'],
      false,
    );

    for (const s of seats) {
      const gs = latestGameState(s.inbox)!;
      expect(gs).toBeDefined();
      expect(gs.type).toBe('GAME_STATE');
      expect(gs.phase).toBe('playing');
      expect(gs.winner).toBeNull();
      expect(gs.turnCount).toBe(0);
      expect(gs.magicItems).toBe(false);
      expect((gs.grid as unknown[][]).length).toBe(10);
      expect((gs.grid as unknown[][])[0].length).toBe(10);
      expect((gs.players as unknown[]).length).toBe(4);
    }
  });

  it('players array has correct identity merged from the lobby', async () => {
    const { seats } = await startGameWithHumans(
      ['Alice', 'Bob', 'Cat', 'Dan'],
      true,
    );

    const gs = latestGameState(seats[0].inbox)!;
    const players = gs.players as Array<{
      id: number;
      displayName: string;
      isBot: boolean;
      isHost: boolean;
    }>;

    expect(players.find((p) => p.id === 0)).toMatchObject({
      displayName: 'Alice',
      isBot: false,
      isHost: true,
    });
    expect(players.find((p) => p.id === 1)).toMatchObject({
      displayName: 'Bob',
      isBot: false,
      isHost: false,
    });
    expect(players.find((p) => p.id === 3)).toMatchObject({
      displayName: 'Dan',
      isBot: false,
      isHost: false,
    });
  });

  it('magicItems flag is carried through to GAME_STATE', async () => {
    const { seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], true);
    const gs = latestGameState(seats[0].inbox)!;
    expect(gs.magicItems).toBe(true);
  });

  it('storage has lobby.phase=playing and a separate game key', async () => {
    const { code } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    await runInDurableObject(stub, async (_instance, state) => {
      const lobby = (await state.storage.get('lobby')) as { phase: string };
      const game = (await state.storage.get('game')) as {
        phase: string;
        turnCount: number;
      };
      expect(lobby.phase).toBe('playing');
      expect(game).toBeDefined();
      expect(game.phase).toBe('playing');
      expect(game.turnCount).toBe(0);
    });
  });
});

// ---------- MOVE ----------

// Find a legal move target for the current player by reading GAME_STATE.
// Uses the same 8-way adjacency rule the server enforces. Guards against
// portal/swap/freeze-select modes (which have different legal-move sets) —
// at turnCount=0 no items have spawned yet, so we always get the adjacent-
// cells branch.
function firstAdjacentEmpty(gs: InboundMsg): { row: number; col: number } {
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

describe('MOVE — legal move from current player', () => {
  it('advances the game and broadcasts updated GAME_STATE to all', async () => {
    const { seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    const gs0 = latestGameState(seats[0].inbox)!;
    const currentSeat = gs0.currentPlayerIndex as number;
    const target = firstAdjacentEmpty(gs0);

    seats[currentSeat].ws.send(
      JSON.stringify({ type: 'MOVE', row: target.row, col: target.col }),
    );

    // All sockets receive a GAME_STATE with turnCount=1.
    for (const s of seats) {
      await waitForInbox(
        s.inbox,
        (m) => m.type === 'GAME_STATE' && m.turnCount === 1,
      );
    }

    const gs1 = latestGameState(seats[0].inbox)!;
    const grid = gs1.grid as Array<Array<{ owner: number | null }>>;
    expect(grid[target.row][target.col].owner).toBe(currentSeat);
    expect(gs1.currentPlayerIndex).not.toBe(currentSeat);
  });
});

describe('MOVE — security rejections', () => {
  it('NOT_YOUR_TURN when a non-current seat sends MOVE', async () => {
    const { code, seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    const gs = latestGameState(seats[0].inbox)!;
    const currentSeat = gs.currentPlayerIndex as number;
    const wrongSeat = (currentSeat + 1) % 4;
    const target = firstAdjacentEmpty(gs);

    seats[wrongSeat].ws.send(
      JSON.stringify({ type: 'MOVE', row: target.row, col: target.col }),
    );
    const err = await waitForInbox(seats[wrongSeat].inbox, (m) => m.type === 'ERROR');
    expect(err.code).toBe('NOT_YOUR_TURN');

    // Server state unchanged (turnCount still 0).
    const game = (await peekGame(code)) as { turnCount: number };
    expect(game.turnCount).toBe(0);
  });

  it('INVALID_MOVE for out-of-bounds coords (row=99 bypasses zod at -1 via validateMove)', async () => {
    // Zod's Coord schema (min 0, max 9, int) rejects 99 before the handler
    // ever sees it — handler returns BAD_PAYLOAD, not INVALID_MOVE. To exercise
    // the INVALID_MOVE path we need a well-formed coord that's simply not a
    // legal move. Use a distant empty cell that's in-bounds but non-adjacent.
    const { code, seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    const gs = latestGameState(seats[0].inbox)!;
    const currentSeat = gs.currentPlayerIndex as number;
    // (4, 4) is the center — empty (corners only), non-adjacent to any corner.
    seats[currentSeat].ws.send(
      JSON.stringify({ type: 'MOVE', row: 4, col: 4 }),
    );
    const err = await waitForInbox(seats[currentSeat].inbox, (m) => m.type === 'ERROR');
    expect(err.code).toBe('INVALID_MOVE');

    const game = (await peekGame(code)) as { turnCount: number };
    expect(game.turnCount).toBe(0);
  });

  it('INVALID_MOVE for already-claimed cell', async () => {
    const { code, seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    const gs = latestGameState(seats[0].inbox)!;
    const currentSeat = gs.currentPlayerIndex as number;
    // Target: another player's starting cell (already claimed).
    const players = gs.players as Array<{ id: number; row: number; col: number }>;
    const otherSeat = currentSeat === 0 ? 1 : 0;
    const other = players[otherSeat];
    seats[currentSeat].ws.send(
      JSON.stringify({ type: 'MOVE', row: other.row, col: other.col }),
    );
    const err = await waitForInbox(seats[currentSeat].inbox, (m) => m.type === 'ERROR');
    expect(err.code).toBe('INVALID_MOVE');

    const game = (await peekGame(code)) as { turnCount: number };
    expect(game.turnCount).toBe(0);
  });

  it('UNAUTHORIZED when a socket that never HELLO\'d sends MOVE mid-game', async () => {
    const { code, seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);
    void seats; // just to keep the started game running

    // New socket joins (WS upgrade succeeds), sends MOVE without HELLO.
    const rogue = await openWs(code);
    const rogueInbox: InboundMsg[] = [];
    rogue.addEventListener('message', (e) => {
      rogueInbox.push(JSON.parse(e.data as string) as InboundMsg);
    });
    rogue.send(JSON.stringify({ type: 'MOVE', row: 0, col: 1 }));
    const err = await waitForInbox(rogueInbox, (m) => m.type === 'ERROR');
    expect(err.code).toBe('UNAUTHORIZED');
  });
});

// ---------- Cycling ----------

describe('MOVE — turn cycling', () => {
  it('four legal moves land the game at turnCount=4', async () => {
    const { seats } = await startGameWithHumans(['A', 'B', 'C', 'D'], false);

    for (let moveNum = 1; moveNum <= 4; moveNum++) {
      const gs = latestGameState(seats[0].inbox)!;
      const currentSeat = gs.currentPlayerIndex as number;
      const target = firstAdjacentEmpty(gs);
      seats[currentSeat].ws.send(
        JSON.stringify({ type: 'MOVE', row: target.row, col: target.col }),
      );
      // Wait for the NEW GAME_STATE with the expected turnCount on seat 0.
      await waitForInbox(
        seats[0].inbox,
        (m) => m.type === 'GAME_STATE' && m.turnCount === moveNum,
      );
    }

    // All four sockets should be at turnCount=4.
    for (const s of seats) {
      const gs = latestGameState(s.inbox)!;
      expect(gs.turnCount).toBe(4);
    }
  });
});
