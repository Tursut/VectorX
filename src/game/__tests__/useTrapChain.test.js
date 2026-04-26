// Tests for the trap-chain queue + drain hook (issue #36).
//
// Drives the hook through gameState transitions with vi.useFakeTimers
// so the 450 ms wind-up + 2500 ms settle can be advanced
// deterministically. The headline assertion is that two deaths on
// consecutive turns each get their full ~3 s beat (queueing) instead
// of the second replacing the first mid-animation.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  playElimination: vi.fn(),
}));

import { useTrapChain } from '../useTrapChain';
import * as sounds from '../sounds';

const TRAP_WINDUP_MS = 450;
const TRAP_SETTLE_MS = 2500;
const TRAP_TOTAL_MS = TRAP_WINDUP_MS + TRAP_SETTLE_MS;

// 4-seat hotseat fixture: human (id 0) + 3 bots (ids 1, 2, 3).
function baseState(overrides = {}) {
  return {
    phase: 'playing',
    turnCount: 0,
    currentPlayerIndex: 0,
    gremlinCount: 3,
    players: [
      { id: 0, row: 0, col: 0, isEliminated: false, deathCell: null },
      { id: 1, row: 0, col: 9, isEliminated: false, deathCell: null },
      { id: 2, row: 9, col: 0, isEliminated: false, deathCell: null },
      { id: 3, row: 9, col: 9, isEliminated: false, deathCell: null },
    ],
    ...overrides,
  };
}

function withEliminated(state, ...ids) {
  return {
    ...state,
    players: state.players.map((p) =>
      ids.includes(p.id)
        ? { ...p, isEliminated: true, deathCell: { row: p.row, col: p.col } }
        : p,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTrapChain — single death', () => {
  it('plays through a full 3 s beat: idle → wind-up → show + sound → clear', () => {
    const initial = baseState();
    const { result, rerender } = renderHook(
      ({ s }) => useTrapChain(s),
      { initialProps: { s: initial } },
    );
    expect(result.current.trapPlaying).toBe(false);
    expect(result.current.trappedPlayers).toEqual([]);

    // Bot 1 gets eliminated.
    rerender({ s: withEliminated(initial, 1) });
    // Queue is non-empty → trapPlaying is true immediately.
    expect(result.current.trapPlaying).toBe(true);
    // Wind-up isn't done yet, so trappedPlayers is still empty.
    expect(result.current.trappedPlayers).toEqual([]);
    expect(sounds.playElimination).not.toHaveBeenCalled();

    // After the 450 ms wind-up: trappedPlayers populated + sound fired.
    act(() => { vi.advanceTimersByTime(TRAP_WINDUP_MS); });
    expect(result.current.trappedPlayers).toHaveLength(1);
    expect(result.current.trappedPlayers[0].id).toBe(1);
    expect(sounds.playElimination).toHaveBeenCalledOnce();

    // After the 2500 ms settle: clears + queue drains → idle.
    act(() => { vi.advanceTimersByTime(TRAP_SETTLE_MS); });
    expect(result.current.trappedPlayers).toEqual([]);
    expect(result.current.trapPlaying).toBe(false);
  });
});

describe('useTrapChain — same-tick batched deaths', () => {
  it('animates simultaneous eliminations in a single shared 2.5 s window', () => {
    // One bomb killing two bots arrives in a single gameState transition.
    const initial = baseState();
    const { result, rerender } = renderHook(
      ({ s }) => useTrapChain(s),
      { initialProps: { s: initial } },
    );
    rerender({ s: withEliminated(initial, 1, 2) });

    act(() => { vi.advanceTimersByTime(TRAP_WINDUP_MS); });
    expect(result.current.trappedPlayers).toHaveLength(2);
    expect(new Set(result.current.trappedPlayers.map((p) => p.id))).toEqual(new Set([1, 2]));
    // One sound call for the batch, not one per player.
    expect(sounds.playElimination).toHaveBeenCalledOnce();

    // Both clear together at the end of the shared window.
    act(() => { vi.advanceTimersByTime(TRAP_SETTLE_MS); });
    expect(result.current.trappedPlayers).toEqual([]);
    expect(result.current.trapPlaying).toBe(false);
  });
});

describe('useTrapChain — back-to-back deaths queue + drain', () => {
  it('plays bot 1\'s full beat before starting bot 2\'s, when the second arrives mid-window', () => {
    const initial = baseState();
    const { result, rerender } = renderHook(
      ({ s }) => useTrapChain(s),
      { initialProps: { s: initial } },
    );

    // Bot 1 dies first.
    rerender({ s: withEliminated(initial, 1) });
    // Halfway through bot 1's settle: bot 2 also dies (next turn).
    act(() => { vi.advanceTimersByTime(TRAP_WINDUP_MS + TRAP_SETTLE_MS / 2); });
    expect(result.current.trappedPlayers.map((p) => p.id)).toEqual([1]);

    rerender({ s: withEliminated(initial, 1, 2) });

    // Bot 1 should still be the visible one — bot 2 is queued.
    expect(result.current.trappedPlayers.map((p) => p.id)).toEqual([1]);
    expect(result.current.trapPlaying).toBe(true);

    // Finish bot 1's settle. Bot 1 clears, queue drains, bot 2's
    // wind-up starts immediately.
    act(() => { vi.advanceTimersByTime(TRAP_SETTLE_MS / 2); });
    expect(result.current.trappedPlayers).toEqual([]);
    expect(result.current.trapPlaying).toBe(true);   // bot 2 is queued

    // Bot 2's wind-up.
    act(() => { vi.advanceTimersByTime(TRAP_WINDUP_MS); });
    expect(result.current.trappedPlayers.map((p) => p.id)).toEqual([2]);
    expect(sounds.playElimination).toHaveBeenCalledTimes(2);

    // Bot 2's settle finishes the chain.
    act(() => { vi.advanceTimersByTime(TRAP_SETTLE_MS); });
    expect(result.current.trappedPlayers).toEqual([]);
    expect(result.current.trapPlaying).toBe(false);
  });

  it('drains a 3-bot trap cascade in arrival order', () => {
    const initial = baseState();
    const { result, rerender } = renderHook(
      ({ s }) => useTrapChain(s),
      { initialProps: { s: initial } },
    );

    rerender({ s: withEliminated(initial, 1) });
    rerender({ s: withEliminated(initial, 1, 2) });
    rerender({ s: withEliminated(initial, 1, 2, 3) });

    const visited = [];
    for (let i = 0; i < 3; i++) {
      act(() => { vi.advanceTimersByTime(TRAP_WINDUP_MS); });
      visited.push(result.current.trappedPlayers.map((p) => p.id));
      act(() => { vi.advanceTimersByTime(TRAP_SETTLE_MS); });
    }

    expect(visited).toEqual([[1], [2], [3]]);
    expect(sounds.playElimination).toHaveBeenCalledTimes(3);
    expect(result.current.trapPlaying).toBe(false);
  });
});

describe('useTrapChain — bots-only endgame', () => {
  it('skips eliminations when no humans are alive (matches the existing speed-run skip)', () => {
    // Eliminate the human first (separate transition before any bots).
    const start = baseState();
    const humanGone = withEliminated(start, 0);
    const { result, rerender } = renderHook(
      ({ s }) => useTrapChain(s),
      { initialProps: { s: start } },
    );
    rerender({ s: humanGone });

    // Drain the human's death first.
    act(() => { vi.advanceTimersByTime(TRAP_TOTAL_MS); });
    expect(result.current.trapPlaying).toBe(false);
    expect(sounds.playElimination).toHaveBeenCalledOnce();

    // Now a bot dies in the bots-only endgame — should be skipped.
    rerender({ s: withEliminated(humanGone, 1) });
    act(() => { vi.advanceTimersByTime(TRAP_TOTAL_MS); });
    expect(result.current.trapPlaying).toBe(false);
    expect(result.current.trappedPlayers).toEqual([]);
    // No second elimination sound.
    expect(sounds.playElimination).toHaveBeenCalledOnce();
  });
});
