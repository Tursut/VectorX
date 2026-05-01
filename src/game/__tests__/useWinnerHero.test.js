// Tests for the winner hero phase (issue #60). Drives the hook through
// gameState transitions + the trap-chain's `trapPlaying` boolean.
// As of the user-tap-to-continue change, hero stays up indefinitely
// until dismissHero() is called — no auto-end timer.
//
// heroPlaying is gated behind a readyForHero state that becomes true one
// macrotask (setTimeout 0) after phase becomes 'gameover'. This prevents a
// brief early mount caused by the one-render window where useTrapChain's
// detection effect hasn't queued the death yet (trapPlaying still false).

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { useWinnerHero } from '../useWinnerHero';

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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWinnerHero — happy path', () => {
  it('starts after the readyForHero macrotask fires, stays up until dismissed', () => {
    const playing = gs();
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: playing, t: false } },
    );
    expect(result.current.heroPlaying).toBe(false);

    // Trap is still running — hero waits even after macrotask.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: true });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(false);

    // Trap finishes → hero starts on next render (readyForHero already set).
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);

    // Hero stays up indefinitely — no auto-dismiss.
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
  });

  it('does not show hero before the readyForHero macrotask fires', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    // readyForHero timer not yet fired — hero must stay hidden.
    expect(result.current.heroPlaying).toBe(false);
    // After the macrotask fires, hero shows.
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(true);
  });

  it('dismissHero ends the hero phase synchronously', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(true);

    act(() => result.current.dismissHero());
    expect(result.current.heroPlaying).toBe(false);
  });
});

describe('useWinnerHero — skip cases', () => {
  it('does not show hero on a draw (winner is null)', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: null }), t: false });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(false);
  });

  it('does not show hero while trap is still playing', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: true });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(false);
  });
});

describe('useWinnerHero — state stability', () => {
  it('keeps heroPlaying true even if gameState references churn', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(true);

    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    expect(result.current.heroPlaying).toBe(true);
  });

  it('resets correctly when phase moves away from gameover (restart)', () => {
    const { result, rerender } = renderHook(
      ({ s, t }) => useWinnerHero(s, t),
      { initialProps: { s: gs(), t: false } },
    );
    rerender({ s: gs({ phase: 'gameover', winner: 0 }), t: false });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(true);
    act(() => result.current.dismissHero());
    expect(result.current.heroPlaying).toBe(false);

    // Restart: phase moves back to playing → latches reset.
    rerender({ s: gs({ phase: 'playing', winner: null }), t: false });
    // Next gameover needs its own macrotask to become ready.
    rerender({ s: gs({ phase: 'gameover', winner: 1 }), t: false });
    expect(result.current.heroPlaying).toBe(false);
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current.heroPlaying).toBe(true);
  });
});
