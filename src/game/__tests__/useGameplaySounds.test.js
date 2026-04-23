// Tests for the shared useGameplaySounds hook. Verifies bg theme, move/claim,
// your-turn chime, and freeze/swap event sounds fire correctly. Called from
// LocalGameController (incl. sandbox) and OnlineGameController so sandbox
// gets the same sound polish as regular gameplay.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sounds', () => ({
  resumeAudio: vi.fn(),
  startBgTheme: vi.fn(),
  stopBgTheme: vi.fn(),
  playMove: vi.fn(),
  playClaim: vi.fn(),
  playYourTurn: vi.fn(),
  playFreeze: vi.fn(),
  playSwap: vi.fn(),
}));

import { useGameplaySounds } from '../useGameplaySounds';
import * as sounds from '../sounds';

function baseState(overrides = {}) {
  return {
    phase: 'playing',
    turnCount: 0,
    currentPlayerIndex: 0,
    lastEvent: null,
    winner: null,
    players: [
      { id: 0, row: 0, col: 0, isEliminated: false },
      { id: 1, row: 0, col: 9, isEliminated: false },
      { id: 2, row: 9, col: 0, isEliminated: false },
      { id: 3, row: 9, col: 9, isEliminated: false },
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

describe('useGameplaySounds — bg theme', () => {
  it('starts bg theme when phase is "playing"', () => {
    renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState(), seats: [0] },
    });
    expect(sounds.startBgTheme).toHaveBeenCalled();
  });

  it('stops bg theme when phase transitions to gameover', () => {
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState(), seats: [0] },
    });
    rerender({ s: baseState({ phase: 'gameover', winner: 0 }), seats: [0] });
    expect(sounds.stopBgTheme).toHaveBeenCalled();
  });
});

describe('useGameplaySounds — move + claim + your-turn', () => {
  it('fires move + claim on turn-index change', () => {
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState(), seats: [0] },
    });
    expect(sounds.playMove).not.toHaveBeenCalled();

    rerender({ s: baseState({ currentPlayerIndex: 1, turnCount: 1 }), seats: [0] });
    expect(sounds.playMove).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(200); });
    expect(sounds.playClaim).toHaveBeenCalledOnce();
  });

  it('fires your-turn chime on fresh mount when currentPlayerIndex is in mySeats', () => {
    renderHook(() => useGameplaySounds(baseState(), [0]));
    expect(sounds.playYourTurn).toHaveBeenCalledOnce();
  });

  it('does NOT fire your-turn chime when currentPlayerIndex is not in mySeats', () => {
    renderHook(() => useGameplaySounds(baseState(), [1]));
    expect(sounds.playYourTurn).not.toHaveBeenCalled();
  });
});

describe('useGameplaySounds — event sounds', () => {
  it('plays freeze sound when lastEvent is a freeze event', () => {
    const { rerender } = renderHook(({ s }) => useGameplaySounds(s, []), {
      initialProps: { s: baseState() },
    });
    rerender({ s: baseState({ lastEvent: { type: 'freeze', byId: 0, targetId: 1 } }) });
    expect(sounds.playFreeze).toHaveBeenCalledOnce();
    expect(sounds.playSwap).not.toHaveBeenCalled();
  });

  it('plays swap sound when lastEvent is a swap event', () => {
    const { rerender } = renderHook(({ s }) => useGameplaySounds(s, []), {
      initialProps: { s: baseState() },
    });
    rerender({ s: baseState({ lastEvent: { type: 'swap', byId: 0, targetId: 1 } }) });
    expect(sounds.playSwap).toHaveBeenCalledOnce();
    expect(sounds.playFreeze).not.toHaveBeenCalled();
  });
});
