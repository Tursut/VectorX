// Roulette-suspense tests for useDerivedAnimations (issue #30).
//
// Drives the hook with bot-vs-human mixes of `lastEvent` payloads to verify
// the skip / engage logic and the deferred-handoff timing.
//
// `vi.useFakeTimers()` lets us advance through the hop schedule
// deterministically: hops are scheduled with `setTimeout` so each
// `vi.advanceTimersByTime` step crosses one (or more) hop boundaries.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  playBomb: vi.fn(),
  playPortal: vi.fn(),
  playSwapActivate: vi.fn(),
  playPortalJump: vi.fn(),
  playFreeze: vi.fn(),
  playTick: vi.fn(),
}));

import { useDerivedAnimations } from '../useDerivedAnimations';
import * as sounds from '../sounds';

// Total time for the 8-hop schedule + 250ms hold.
// Hop durations: 60+70+90+120+160+220+290+380 = 1390ms, + 250ms hold = 1640ms.
const ROULETTE_TOTAL_MS = 60 + 70 + 90 + 120 + 160 + 220 + 290 + 380 + 250;

// 4-player state: human (id 0) + 3 bots (ids 1, 2, 3) via gremlinCount = 3.
function baseState({ gremlinCount = 3 } = {}) {
  return {
    phase: 'playing',
    turnCount: 0,
    currentPlayerIndex: 0,
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    lastEvent: null,
    items: [],
    gremlinCount,
    players: [
      { id: 0, row: 0, col: 0, isEliminated: false, deathCell: null },
      { id: 1, row: 0, col: 9, isEliminated: false, deathCell: null },
      { id: 2, row: 9, col: 0, isEliminated: false, deathCell: null },
      { id: 3, row: 9, col: 9, isEliminated: false, deathCell: null },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Deterministic Math.random so the hop schedule is repeatable.
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('roulette — skip cases (immediate fire, pre-#30 timing)', () => {
  it('skips roulette for a human-driven freeze (collector is not a bot)', () => {
    // gremlinCount 0 → all 4 players are humans. byId 0 = human pick.
    const prev = baseState({ gremlinCount: 0 });
    const next = { ...prev, lastEvent: { type: 'freeze', byId: 0, targetId: 3 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.flyingFreeze).toEqual({
      fromRow: 0, fromCol: 0, toRow: 9, toCol: 9,
    });
    expect(result.current.roulettePlayerId).toBeNull();
    expect(sounds.playTick).not.toHaveBeenCalled();
  });

  it('skips roulette when only one alive opponent remains (1v1)', () => {
    // 1 human + 1 bot setup: id 0 human, id 3 bot, others eliminated.
    const prev = baseState({ gremlinCount: 1 });
    prev.players = prev.players.map((p) =>
      p.id === 1 || p.id === 2 ? { ...p, isEliminated: true } : p,
    );
    // Bot (id 3) freezes the only alive opponent (id 0).
    const next = { ...prev, lastEvent: { type: 'freeze', byId: 3, targetId: 0 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.flyingFreeze).not.toBeNull();
    expect(result.current.roulettePlayerId).toBeNull();
  });

  it('skips roulette when no humans are alive (bots-only endgame keeps speed-run pace)', () => {
    // gremlinCount 3 → ids 1,2,3 are bots, id 0 is human. Eliminate the
    // human, leaving 3 bots fighting it out.
    const prev = baseState({ gremlinCount: 3 });
    prev.players = prev.players.map((p) =>
      p.id === 0 ? { ...p, isEliminated: true } : p,
    );
    // Bot id 1 freezes bot id 3 — opponents (alive non-byId) is [bot 2, bot 3]
    // (length 2), so the only thing keeping us out of the roulette is
    // "no humans alive."
    const next = { ...prev, lastEvent: { type: 'freeze', byId: 1, targetId: 3 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });
    expect(result.current.flyingFreeze).not.toBeNull();
    expect(result.current.roulettePlayerId).toBeNull();
    expect(sounds.playTick).not.toHaveBeenCalled();
  });
});

describe('roulette — engaged path', () => {
  it('runs the hop schedule for a bot freeze (≥2 opponents, ≥1 alive human)', () => {
    const prev = baseState({ gremlinCount: 3 });
    // Bot id 1 freezes a target (the human id 0). Opponents = [0, 2, 3].
    const next = { ...prev, lastEvent: { type: 'freeze', byId: 1, targetId: 0 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });

    // The first hop is scheduled at t=0. Tick once to flush it onto state.
    act(() => { vi.advanceTimersByTime(0); });
    // After the first hop fires, roulettePlayerId is set to a non-bot-self
    // opponent. flyingFreeze is still deferred.
    expect(result.current.roulettePlayerId).not.toBeNull();
    expect([0, 2, 3]).toContain(result.current.roulettePlayerId);
    expect(result.current.flyingFreeze).toBeNull();
    expect(sounds.playTick).toHaveBeenCalled();

    // Advance to the end of the hop schedule + hold. Final hop lands on
    // the actual target (id 0); then 250ms later roulette clears and the
    // deferred flyingFreeze fires.
    act(() => { vi.advanceTimersByTime(ROULETTE_TOTAL_MS); });
    expect(result.current.roulettePlayerId).toBeNull();
    expect(result.current.flyingFreeze).toEqual({
      fromRow: 0, fromCol: 9, toRow: 0, toCol: 0,
    });
    // 8 hops → 8 ticks.
    expect(sounds.playTick).toHaveBeenCalledTimes(8);
  });

  it('runs the hop schedule for a bot swap and only fires swapFlash on resolution', () => {
    const prev = baseState({ gremlinCount: 3 });
    const next = { ...prev, lastEvent: { type: 'swap', byId: 1, targetId: 0 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });

    // Mid-roulette: roulettePlayerId set, swapFlash still deferred.
    act(() => { vi.advanceTimersByTime(60 + 70 + 90); });
    expect(result.current.roulettePlayerId).not.toBeNull();
    expect(result.current.swapFlash).toBeNull();

    // Past the schedule: roulette clears, swapFlash fires.
    act(() => { vi.advanceTimersByTime(ROULETTE_TOTAL_MS); });
    expect(result.current.roulettePlayerId).toBeNull();
    expect(result.current.swapFlash).not.toBeNull();
  });

  it('lands on the actual target on the final hop and never repeats consecutive opponents', () => {
    // Use a non-zero Math.random so we don't always pick the first choice.
    Math.random.mockRestore();
    let i = 0;
    const seq = [0.1, 0.6, 0.3, 0.9, 0.4, 0.2, 0.7];
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const prev = baseState({ gremlinCount: 3 });
    const next = { ...prev, lastEvent: { type: 'freeze', byId: 1, targetId: 0 } };
    const { result, rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: next });

    // Drive each hop one by one, recording roulettePlayerId after each.
    const visited = [];
    const durations = [60, 70, 90, 120, 160, 220, 290, 380];
    durations.forEach((d, idx) => {
      // The first hop is at t=0 — flush it immediately, then advance to
      // the next.
      if (idx === 0) {
        act(() => { vi.advanceTimersByTime(0); });
      } else {
        act(() => { vi.advanceTimersByTime(durations[idx - 1]); });
      }
      visited.push(result.current.roulettePlayerId);
    });

    // No two consecutive duplicates.
    for (let k = 1; k < visited.length; k++) {
      expect(visited[k]).not.toBe(visited[k - 1]);
    }
    // Final hop lands on the actual target.
    expect(visited[visited.length - 1]).toBe(0);
    // No hop ever lands on the actor (bot id 1).
    expect(visited).not.toContain(1);
  });

  it('does not re-fire when the same lastEvent reference is seen again', () => {
    const prev = baseState({ gremlinCount: 3 });
    const ev = { type: 'freeze', byId: 1, targetId: 0 };
    const stateA = { ...prev, lastEvent: ev };
    const { rerender } = renderHook(
      ({ gameState }) => useDerivedAnimations(gameState),
      { initialProps: { gameState: prev } },
    );
    rerender({ gameState: stateA });
    act(() => { vi.advanceTimersByTime(ROULETTE_TOTAL_MS); });
    expect(sounds.playTick).toHaveBeenCalledTimes(8);

    // Re-render with the same lastEvent reference (e.g. reconnect-driven
    // GAME_STATE replay). Should not re-trigger the roulette.
    const stateB = { ...stateA, turnCount: stateA.turnCount + 1 };
    rerender({ gameState: stateB });
    act(() => { vi.advanceTimersByTime(ROULETTE_TOTAL_MS); });
    expect(sounds.playTick).toHaveBeenCalledTimes(8);
  });
});
