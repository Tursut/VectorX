// Tests for the winner hero phase (issue #60). Drives the hook through
// gameState transitions + the trap-chain's `trapPlaying` boolean to
// confirm the 1 s spotlight fires once per game-over with a winner.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  playWinStinger: vi.fn(),
}));

import { useWinnerHero } from '../useWinnerHero';
import * as sounds from '../sounds';

const HERO_HOLD_MS = 2000;

function gs(overrides = {}) {
  return {
    phase: 'playing',
    winner: null,
    players: [
      { id: 0, isEliminated: false },
      { id: 1, isEliminated: false },
    ],
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

describe('useWinnerHero — happy path', () => {
  it('fires hero + win sound when phase=gameover with a winner and trap is done', () => {
    const playing = gs();
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: playing, t: false } },
    );
    expect(result.current.heroPlaying).toBe(false);

    // Trap is still running on the gameover transition — hero waits.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: true });
    expect(result.current.heroPlaying).toBe(false);
    expect(sounds.playWinStinger).not.toHaveBeenCalled();

    // Trap finishes → hero starts immediately and the win sound fires once.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(1);

    // Hero holds for HERO_HOLD_MS, then flips back off.
    act(() => { vi.advanceTimersByTime(HERO_HOLD_MS - 1); });
    expect(result.current.heroPlaying).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.heroPlaying).toBe(false);
  });
});

describe('useWinnerHero — skip cases', () => {
  it('does not fire on a draw (winner is null)', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: null }), t: false });
    expect(result.current.heroPlaying).toBe(false);
    expect(sounds.playWinStinger).not.toHaveBeenCalled();
  });

  it('does not fire while trap is still playing', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: true });
    expect(result.current.heroPlaying).toBe(false);
    expect(sounds.playWinStinger).not.toHaveBeenCalled();
  });
});

describe('useWinnerHero — single-fire latch', () => {
  it('only plays the win sound once even if gameState references churn', () => {
    const { rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(1);

    // Same logical state, fresh object reference — should not re-fire.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(1);
  });

  it('resets when phase moves away from gameover (restart)', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(HERO_HOLD_MS); });
    expect(result.current.heroPlaying).toBe(false);

    // Restart: phase moves back to playing → latch resets.
    rerender({ s: gs({ phase: 'playing', winner: null }), t: false });
    // Next gameover should fire again.
    rerender({ s: gs({ phase: 'gameover', winner: 1 }), t: false });
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(2);
    expect(result.current.heroPlaying).toBe(true);
  });
});

describe('useWinnerHero — robustness during the hold', () => {
  it('still ends the hero phase even if dependent props churn during the 1 s hold', () => {
    // Regression: the previous implementation kept the hold-end timer
    // inside the same effect that triggered the hero, with deps that
    // re-ran on phase / trap churn. Any benign re-render during the hold
    // — gameState reference changes, parent state updates — would cancel
    // the timer without rescheduling it, leaving heroPlaying stuck true
    // and GameOverScreen never mounting.
    const winState = gs({ phase: 'gameover', winner: 0 });
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: winState, t: false });
    expect(result.current.heroPlaying).toBe(true);

    // Simulate a re-render that passes a fresh gameState reference but
    // logically identical state — the kind of churn React triggers on
    // any unrelated prop or parent state update.
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });

    // Timer should still fire on schedule.
    act(() => { vi.advanceTimersByTime(HERO_HOLD_MS); });
    expect(result.current.heroPlaying).toBe(false);
  });
});

describe('useWinnerHero — cleanup', () => {
  it('cancels the hold timer on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
    unmount();
    // Advancing the clock past HERO_HOLD_MS shouldn't throw or warn —
    // the cleanup canceled the setTimeout.
    expect(() => act(() => { vi.advanceTimersByTime(HERO_HOLD_MS * 2); })).not.toThrow();
  });
});
