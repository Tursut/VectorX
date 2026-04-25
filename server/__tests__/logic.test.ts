// Server-side tests for the shared game module (src/game/logic.js + ai.js).
// This is now a security boundary — the client can send any MOVE payload and
// the server must validate before applying. Tests cover:
//   - happy-path shape (initGame, applyMove, getCurrentValidMoves, getValidMoves)
//   - elimination + game-over transition (completeTurn is internal, tested via
//     eliminateCurrentPlayer which calls it)
//   - validateMove security cases: not-your-turn, phase=gameover, OOB,
//     already-claimed, non-adjacent
//   - getGremlinMove output always passes validateMove
//
// We run inside the Workers pool like other server tests, but this file
// doesn't touch SELF / env / DOs — it's pure logic validation.

import { describe, it, expect } from 'vitest';
import {
  initGame,
  applyMove,
  eliminateCurrentPlayer,
  getCurrentValidMoves,
  getValidMoves,
  validateMove,
} from '../../src/game/logic';
import { getGremlinMove } from '../../src/game/ai';
import { GRID_SIZE, PLAYERS } from '../../src/game/constants';

// ---------- initGame ----------

describe('initGame', () => {
  it('produces a 10×10 grid', () => {
    const s = initGame(false, 0);
    expect(s.grid).toHaveLength(GRID_SIZE);
    expect(s.grid[0]).toHaveLength(GRID_SIZE);
  });

  it('creates 4 players in the corners with matching ids', () => {
    const s = initGame(false, 0);
    expect(s.players).toHaveLength(PLAYERS.length);
    for (const p of s.players) {
      const def = PLAYERS[p.id];
      expect(p.row).toBe(def.startRow);
      expect(p.col).toBe(def.startCol);
      expect(p.isEliminated).toBe(false);
      expect(p.deathCell).toBeNull();
      expect(s.grid[p.row][p.col].owner).toBe(p.id);
    }
  });

  it('sets sane initial phase/winner/turnCount', () => {
    const s = initGame(false, 0);
    expect(s.phase).toBe('playing');
    expect(s.winner).toBeNull();
    expect(s.turnCount).toBe(0);
  });

  it('picks a random currentPlayerIndex in range', () => {
    for (let i = 0; i < 10; i++) {
      const s = initGame(false, 0);
      expect(s.currentPlayerIndex).toBeGreaterThanOrEqual(0);
      expect(s.currentPlayerIndex).toBeLessThan(PLAYERS.length);
    }
  });

  it('respects the magicItems flag', () => {
    expect(initGame(false, 0).magicItems).toBe(false);
    expect(initGame(true, 0).magicItems).toBe(true);
  });

  it('initialises freeze fields to defaults', () => {
    const s = initGame(false, 0);
    expect(s.freezeSelectActive).toBe(false);
    expect(s.frozenPlayerId).toBeNull();
    expect(s.frozenTurnsLeft).toBe(0);
  });
});

// ---------- getValidMoves / getCurrentValidMoves ----------

describe('getValidMoves (by coordinate)', () => {
  it('returns in-bounds empty cells within 8-way adjacency', () => {
    const s = initGame(false, 0);
    const p = s.players[0];
    const moves = getValidMoves(s.grid, p.row, p.col);
    for (const m of moves) {
      expect(Math.abs(m.row - p.row)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.col - p.col)).toBeLessThanOrEqual(1);
      expect(s.grid[m.row][m.col].owner).toBeNull();
      expect(m.row).toBeGreaterThanOrEqual(0);
      expect(m.row).toBeLessThan(GRID_SIZE);
    }
  });
});

describe('getCurrentValidMoves', () => {
  it('returns neighbours of the current player in normal mode', () => {
    const s = initGame(false, 0);
    const moves = getCurrentValidMoves(s);
    const p = s.players[s.currentPlayerIndex];
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(8);
    for (const m of moves) {
      expect(Math.abs(m.row - p.row)).toBeLessThanOrEqual(1);
      expect(Math.abs(m.col - p.col)).toBeLessThanOrEqual(1);
    }
  });

  it('returns other players\' cells when freezeSelectActive is true', () => {
    const base = initGame(false, 0);
    const s = { ...base, freezeSelectActive: true };
    const moves = getCurrentValidMoves(s);
    const currentId = s.players[s.currentPlayerIndex].id;
    const otherIds = s.players.filter((p: { id: number }) => p.id !== currentId).map((p: { id: number }) => p.id);
    expect(moves.length).toBe(otherIds.length);
  });
});

// ---------- applyMove ----------

describe('applyMove', () => {
  it('claims the target cell for the current player', () => {
    const s = initGame(false, 0);
    const m = getCurrentValidMoves(s)[0];
    const currentId = s.players[s.currentPlayerIndex].id;
    const s2 = applyMove(s, m.row, m.col);
    expect(s2.grid[m.row][m.col].owner).toBe(currentId);
  });

  it('advances the turn counter', () => {
    const s = initGame(false, 0);
    const m = getCurrentValidMoves(s)[0];
    const s2 = applyMove(s, m.row, m.col);
    expect(s2.turnCount).toBe(1);
  });

  it('advances currentPlayerIndex to another (alive) player', () => {
    const s = initGame(false, 0);
    const beforeIdx = s.currentPlayerIndex;
    const m = getCurrentValidMoves(s)[0];
    const s2 = applyMove(s, m.row, m.col);
    expect(s2.currentPlayerIndex).not.toBe(beforeIdx);
  });

  it('does not mutate the input state', () => {
    const s = initGame(false, 0);
    const snapshot = JSON.stringify(s);
    const m = getCurrentValidMoves(s)[0];
    applyMove(s, m.row, m.col);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

// ---------- eliminateCurrentPlayer + completeTurn (indirect) ----------

describe('eliminateCurrentPlayer', () => {
  it('marks the current player eliminated and captures a deathCell', () => {
    const s = initGame(false, 0);
    const idx = s.currentPlayerIndex;
    const s2 = eliminateCurrentPlayer(s);
    expect(s2.players[idx].isEliminated).toBe(true);
    expect(s2.players[idx].deathCell).toEqual({ row: s.players[idx].row, col: s.players[idx].col });
  });

  it('transitions to gameover with a winner when only one player remains', () => {
    let s = initGame(false, 0);
    s = eliminateCurrentPlayer(s);
    s = eliminateCurrentPlayer(s);
    s = eliminateCurrentPlayer(s);
    expect(s.phase).toBe('gameover');
    const alive = s.players.filter((p: { isEliminated: boolean }) => !p.isEliminated);
    expect(alive).toHaveLength(1);
    expect(s.winner).toBe(alive[0].id);
  });
});

// ---------- validateMove — security boundary ----------

describe('validateMove', () => {
  it('accepts a legal move from the current player', () => {
    const s = initGame(false, 0);
    const m = getCurrentValidMoves(s)[0];
    const currentId = s.players[s.currentPlayerIndex].id;
    expect(validateMove(s, currentId, m.row, m.col)).toEqual({ ok: true });
  });

  it('rejects moves from a non-current player as NOT_YOUR_TURN', () => {
    const s = initGame(false, 0);
    const m = getCurrentValidMoves(s)[0];
    const currentId = s.players[s.currentPlayerIndex].id;
    const wrongId = (currentId + 1) % PLAYERS.length;
    expect(validateMove(s, wrongId, m.row, m.col)).toEqual({
      ok: false,
      reason: 'NOT_YOUR_TURN',
    });
  });

  it('rejects any move when phase is gameover', () => {
    const base = initGame(false, 0);
    const s = { ...base, phase: 'gameover', winner: 0 };
    const currentId = s.players[s.currentPlayerIndex].id;
    const m = getCurrentValidMoves(base)[0];
    expect(validateMove(s, currentId, m.row, m.col)).toEqual({
      ok: false,
      reason: 'NOT_YOUR_TURN',
    });
  });

  it('rejects out-of-bounds coordinates as INVALID_MOVE', () => {
    const s = initGame(false, 0);
    const currentId = s.players[s.currentPlayerIndex].id;
    expect(validateMove(s, currentId, 99, 99)).toEqual({
      ok: false,
      reason: 'INVALID_MOVE',
    });
    expect(validateMove(s, currentId, -1, 0)).toEqual({
      ok: false,
      reason: 'INVALID_MOVE',
    });
    expect(validateMove(s, currentId, 0, GRID_SIZE)).toEqual({
      ok: false,
      reason: 'INVALID_MOVE',
    });
  });

  it('rejects already-claimed cells as INVALID_MOVE', () => {
    const s = initGame(false, 0);
    const currentId = s.players[s.currentPlayerIndex].id;
    // every player's starting cell is owned by them — pick any
    const claimed = s.players[0];
    expect(validateMove(s, currentId, claimed.row, claimed.col)).toEqual({
      ok: false,
      reason: 'INVALID_MOVE',
    });
  });

  it('rejects non-adjacent empty cells as INVALID_MOVE', () => {
    const s = initGame(false, 0);
    const currentId = s.players[s.currentPlayerIndex].id;
    // (4, 4) is center-ish — guaranteed empty at init (corners only) and
    // guaranteed non-adjacent to any corner.
    expect(validateMove(s, currentId, 4, 4)).toEqual({
      ok: false,
      reason: 'INVALID_MOVE',
    });
  });
});

// ---------- freeze counter through trap-elimination cascade (#23) ----------

describe('freeze interacts correctly with intermediate trap-elimination', () => {
  // Repro: bot frozen for N turns, the seat BEFORE them dies of no-valid-
  // moves on the same completeTurn() call. Pre-fix, the freeze check ran
  // once on the pre-elimination nextIndex (which wasn't the frozen seat),
  // and the trap-elimination loop then advanced nextIndex to the frozen
  // seat — bypassing the skip. Frozen player would take a "free" turn,
  // counter unchanged. Combined-loop fix re-checks freeze on every step.
  function trapSeatOne(s: ReturnType<typeof initGame>) {
    // Seat 1 starts at (0, GRID_SIZE - 1). Surround its 3 neighbours.
    const r = 0;
    const c = GRID_SIZE - 1;
    s.grid[r][c - 1] = { owner: 0 };
    s.grid[r + 1][c - 1] = { owner: 0 };
    s.grid[r + 1][c] = { owner: 0 };
    return s;
  }

  it('skips the frozen seat 2 when the seat 1 in front of them gets trap-eliminated', () => {
    const s = trapSeatOne(initGame(false, 0));
    s.currentPlayerIndex = 0;
    s.frozenPlayerId = 2;
    s.frozenTurnsLeft = 2;

    // Seat 0 makes a valid move (anywhere it can reach from (0,0)).
    const move = getCurrentValidMoves(s)[0];
    const next = applyMove(s, move.row, move.col);

    // Seat 1 — no valid moves, eliminated by the trap-cascade.
    expect(next.players[1].isEliminated).toBe(true);
    // Seat 2 — frozen, should be SKIPPED, not playing on this advance.
    expect(next.currentPlayerIndex).toBe(3);
    // Freeze counter ticks down by exactly one for that skip.
    expect(next.frozenPlayerId).toBe(2);
    expect(next.frozenTurnsLeft).toBe(1);
    // Seat 2 stays alive (was never eligible to move).
    expect(next.players[2].isEliminated).toBe(false);
  });

  it('does not skip the frozen seat when freeze counter has already hit zero', () => {
    // After all skips are exhausted, frozenTurnsLeft is 0 and the next
    // time the frozen seat's turn arrives they actually play. Make sure
    // the trap-cascade landing on the frozen seat with counter=0 still
    // lets them play (and clears the marker), instead of double-skipping.
    const s = trapSeatOne(initGame(false, 0));
    s.currentPlayerIndex = 0;
    s.frozenPlayerId = 2;
    s.frozenTurnsLeft = 0;

    const move = getCurrentValidMoves(s)[0];
    const next = applyMove(s, move.row, move.col);

    expect(next.players[1].isEliminated).toBe(true);
    // Seat 2 is the next active player and the freeze is over.
    expect(next.currentPlayerIndex).toBe(2);
    expect(next.frozenPlayerId).toBeNull();
    expect(next.frozenTurnsLeft).toBe(0);
  });

  it('clears the freeze marker if the frozen player was already eliminated externally', () => {
    // Bomb / swap / disconnect can eliminate the frozen player before
    // their next turn arrives. completeTurn's pre-loop cleanup should
    // drop the freeze fields so the marker doesn't stick around as a
    // ghost on a now-dead seat.
    const s = trapSeatOne(initGame(false, 0));
    s.currentPlayerIndex = 0;
    s.frozenPlayerId = 2;
    s.frozenTurnsLeft = 3;
    // Pre-eliminate seat 2 (e.g. caught in a bomb).
    s.players[2] = { ...s.players[2], isEliminated: true };

    const move = getCurrentValidMoves(s)[0];
    const next = applyMove(s, move.row, move.col);

    expect(next.frozenPlayerId).toBeNull();
    expect(next.frozenTurnsLeft).toBe(0);
  });
});

// ---------- ai.js — getGremlinMove ----------

describe('getGremlinMove', () => {
  it('returns a move that passes validateMove', () => {
    const s = initGame(false, 0);
    const move = getGremlinMove(s, 1);
    expect(move).not.toBeNull();
    const currentId = s.players[s.currentPlayerIndex].id;
    expect(validateMove(s, currentId, move.row, move.col)).toEqual({ ok: true });
  });

  it('returns a move that also passes validateMove on a mid-game state', () => {
    let s = initGame(true, 0);
    // advance the game a few turns to move off starting positions
    for (let i = 0; i < 4; i++) {
      const m = getCurrentValidMoves(s)[0];
      s = applyMove(s, m.row, m.col);
    }
    const move = getGremlinMove(s, 1);
    expect(move).not.toBeNull();
    const currentId = s.players[s.currentPlayerIndex].id;
    expect(validateMove(s, currentId, move.row, move.col)).toEqual({ ok: true });
  });
});
