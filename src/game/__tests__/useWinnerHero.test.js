// Tests for the winner hero phase (issue #60). Drives the hook through
// gameState transitions + the trap-chain's `trapPlaying` boolean.
// As of the user-tap-to-continue change, hero stays up indefinitely
// until dismissHero() is called — no auto-end timer.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  playWinStinger: vi.fn(),
}));

import { useWinnerHero } from '../useWinnerHero';
import * as sounds from '../sounds';

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
});

describe('useWinnerHero — happy path', () => {
  it('fires the stinger and stays up when phase=gameover with a winner', () => {
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

    // Trap finishes → hero starts immediately and the stinger fires once.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(1);

    // Hero stays up indefinitely — no auto-dismiss.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
  });

  it('dismissHero ends the hero phase synchronously', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);

    act(() => result.current.dismissHero());
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
  it('only plays the stinger once even if gameState references churn', () => {
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
    act(() => result.current.dismissHero());
    expect(result.current.heroPlaying).toBe(false);

    // Restart: phase moves back to playing → latch resets.
    rerender({ s: gs({ phase: 'playing', winner: null }), t: false });
    // Next gameover should fire again.
    rerender({ s: gs({ phase: 'gameover', winner: 1 }), t: false });
    expect(sounds.playWinStinger).toHaveBeenCalledTimes(2);
    expect(result.current.heroPlaying).toBe(true);
  });
});
