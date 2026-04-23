// Unit tests for the animation state-diff hook.
//
// Simulates a sequence of (prev → current) gameState transitions by calling
// renderHook().rerender with successive gameState objects. Each assertion
// covers one kind of transition that fires an overlay + its item-pickup sound.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  playBomb: vi.fn(),
  playPortal: vi.fn(),
  playSwapActivate: vi.fn(),
  playPortalJump: vi.fn(),
}));

// Import AFTER the mock is in place.
import { useDerivedAnimations } from '../useDerivedAnimations';
import * as sounds from '../sounds';

// ---------- Test fixtures ----------
//
// A minimal valid-shape gameState. Tests clone + mutate this per transition.
function baseState() {
  return {
    phase: 'playing',
    turnCount: 0,
    currentPlayerIndex: 0,
    portalActive: false,
    swapActive: false,
    lastEvent: null,
    items: [],
    players: [
      { id: 0, row: 0, col: 0, isEliminated: false, deathCell: null },
      { id: 1, row: 0, col: 9, isEliminated: false, deathCell: null },
      { id: 2, row: 9, col: 0, isEliminated: false, deathCell: null },
      { id: 3, row: 9, col: 9, isEliminated: false, deathCell: null },
    ],
  };
}

// Apply a move by player at currentPlayerIndex: updates their position, bumps
// turnCount, and advances currentPlayerIndex. Does not touch items/portalActive.
function withMove(state, toRow, toCol, overrides = {}) {
  const i = state.currentPlayerIndex;
  const players = state.players.map((p, idx) =>
    idx === i ? { ...p, row: toRow, col: toCol } : p,
  );
  return {
    ...state,
    players,
    currentPlayerIndex: (i + 1) % state.players.length,
    turnCount: state.turnCount + 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------- No-op paths ----------

describe('useDerivedAnimations — no-op paths', () => {
  it('returns null animations for a null gameState', () => {
    const { result } = renderHook(({ gameState }) => useDerivedAnimations(gameState), {
      initialProps: { gameState: null },
    });
    expect(result.current).toEqual({
      bombBlast: null,
      portalJump: null,
      swapFlash: null,
      flyingFreeze: null,
    });
  });

  it('does not fire animations on first gameState (no prev to diff)', () => {
    const { result } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: baseState() } },
    );
    expect(result.current.bombBlast).toBeNull();
    expect(result.current.portalJump).toBeNull();
    expect(sounds.playBomb).not.toHaveBeenCalled();
  });

  it('does not fire animations if turnCount is unchanged', () => {
    const prev = baseState();
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    // Same turnCount = no move happened → no diff applied.
    rerender({ gameState: { ...prev, items: [{ id: 'x', type: 'bomb', row: 5, col: 5 }] } });
    expect(result.current.bombBlast).toBeNull();
    expect(sounds.playBomb).not.toHaveBeenCalled();
  });
});

// ---------- Bomb pickup ----------

describe('useDerivedAnimations — bomb pickup', () => {
  it('fires bombBlast + playBomb when player lands on a bomb', () => {
    const prev = {
      ...baseState(),
      items: [{ id: 'b1', type: 'bomb', row: 0, col: 1 }],
    };
    const next = withMove(prev, 0, 1, { items: [] });
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.bombBlast).toMatchObject({
      origin: { row: 0, col: 1 },
    });
    // 8 neighbors, minus those out of bounds (at (0,1) we lose the top 3).
    expect(result.current.bombBlast.cleared.length).toBe(5);
    expect(sounds.playBomb).toHaveBeenCalledOnce();
  });

  it('auto-clears bombBlast after 700ms', () => {
    const prev = {
      ...baseState(),
      items: [{ id: 'b1', type: 'bomb', row: 0, col: 1 }],
    };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: withMove(prev, 0, 1, { items: [] }) });
    expect(result.current.bombBlast).not.toBeNull();
    act(() => { vi.advanceTimersByTime(700); });
    expect(result.current.bombBlast).toBeNull();
  });
});

// ---------- Portal / swap item pickups ----------

describe('useDerivedAnimations — item pickup sounds', () => {
  // Portal and swap/freeze pickups do NOT advance turnCount in the game reducer
  // (completeTurn is called only on the subsequent move). The hook must detect
  // these via the flag transition (portalActive/swapActive/freezeSelectActive
  // flipping to true), not via turnCount. These tests reflect that reality.

  it('fires playPortal when player lands on a portal item (turnCount unchanged)', () => {
    const prev = {
      ...baseState(),
      items: [{ id: 'p1', type: 'portal', row: 0, col: 1 }],
    };
    // Simulate the real game: player moves to item cell, item removed, portalActive
    // set — but turnCount stays the same because completeTurn hasn't fired yet.
    const next = {
      ...prev,
      players: prev.players.map((p, i) => i === 0 ? { ...p, row: 0, col: 1 } : p),
      items: [],
      portalActive: true,
      // turnCount deliberately NOT incremented
    };
    const { rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(sounds.playPortal).toHaveBeenCalledOnce();
  });

  it('fires playSwapActivate when player lands on a swap item (turnCount unchanged)', () => {
    const prev = {
      ...baseState(),
      items: [{ id: 's1', type: 'swap', row: 0, col: 1 }],
    };
    const next = {
      ...prev,
      players: prev.players.map((p, i) => i === 0 ? { ...p, row: 0, col: 1 } : p),
      items: [],
      swapActive: true,
      // turnCount deliberately NOT incremented
    };
    const { rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(sounds.playSwapActivate).toHaveBeenCalledOnce();
  });

  it('does not fire pickup sounds when the item is still there', () => {
    const prev = {
      ...baseState(),
      items: [{ id: 'b1', type: 'bomb', row: 5, col: 5 }],
    };
    // Move to a different cell than the bomb — item still exists post-move.
    const next = withMove(prev, 0, 1, { items: prev.items });
    const { rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(sounds.playBomb).not.toHaveBeenCalled();
  });
});

// ---------- Portal jump (teleport) ----------

describe('useDerivedAnimations — portal jump', () => {
  it('fires portalJump + playPortalJump when portalActive flips off with >1 cell move', () => {
    const prev = { ...baseState(), portalActive: true };
    // Teleport from (0,0) to (5,5) — Chebyshev distance 5.
    const next = withMove(prev, 5, 5, { portalActive: false });
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.portalJump).toEqual({
      from: { row: 0, col: 0 },
      to: { row: 5, col: 5 },
    });
    expect(sounds.playPortalJump).toHaveBeenCalledOnce();
  });

  it('does not fire portalJump for a normal 1-cell move after portalActive clears', () => {
    const prev = { ...baseState(), portalActive: true };
    const next = withMove(prev, 0, 1, { portalActive: false });
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.portalJump).toBeNull();
    expect(sounds.playPortalJump).not.toHaveBeenCalled();
  });
});

// ---------- Swap flash ----------

describe('useDerivedAnimations — swap flash', () => {
  it('fires swapFlash when two players exchange positions', () => {
    const prev = { ...baseState(), swapActive: true };
    // Player 0 at (0,0) swaps with player 3 at (9,9).
    const nextPlayers = prev.players.map((p) => {
      if (p.id === 0) return { ...p, row: 9, col: 9 };
      if (p.id === 3) return { ...p, row: 0, col: 0 };
      return p;
    });
    const next = {
      ...prev,
      players: nextPlayers,
      currentPlayerIndex: 1,
      turnCount: 1,
      swapActive: false,
    };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.swapFlash).toEqual({
      pos1: { row: 0, col: 0 },
      pos2: { row: 9, col: 9 },
    });
  });
});

// ---------- Flying freeze ----------

describe('useDerivedAnimations — flying freeze', () => {
  it('fires flyingFreeze from lastEvent = freeze', () => {
    const prev = baseState();
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({
      gameState: { ...prev, lastEvent: { type: 'freeze', byId: 0, targetId: 3 } },
    });
    expect(result.current.flyingFreeze).toEqual({
      fromRow: 0, fromCol: 0,
      toRow: 9, toCol: 9,
    });
  });

  it('does not fire flyingFreeze for a swap lastEvent', () => {
    const prev = baseState();
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({
      gameState: { ...prev, lastEvent: { type: 'swap', byId: 0, targetId: 3 } },
    });
    expect(result.current.flyingFreeze).toBeNull();
  });
});
