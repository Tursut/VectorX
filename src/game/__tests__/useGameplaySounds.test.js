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
    gremlinCount: 3,
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

// freeze / swap apply sounds moved to useDerivedAnimations#fireImmediate
// in #30 so they line up with the deferred fly-in / flash visual after
// the bot-pick roulette. Coverage now lives in
// useDerivedAnimations.roulette.test.js.

describe('useGameplaySounds — move/claim suppression during bot freeze/swap roulette (issue #31)', () => {
  it('skips the move + claim thump when a bot-driven freeze advances the turn (roulette will play)', () => {
    // gremlinCount 3 → ids 1, 2, 3 are bots, id 0 is human. Bot 1 just
    // applied a freeze → currentPlayerIndex advances to seat 2; the
    // client will run the roulette over this lastEvent, so the
    // per-turn move thump must NOT fire.
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState({ currentPlayerIndex: 1 }), seats: [0] },
    });
    rerender({
      s: baseState({
        currentPlayerIndex: 2,
        turnCount: 1,
        lastEvent: { type: 'freeze', byId: 1, targetId: 0 },
      }),
      seats: [0],
    });
    expect(sounds.playMove).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(sounds.playClaim).not.toHaveBeenCalled();
  });

  it('skips the thump for a bot-driven swap with ≥ 2 alive opponents and a human alive', () => {
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState({ currentPlayerIndex: 1 }), seats: [0] },
    });
    rerender({
      s: baseState({
        currentPlayerIndex: 2,
        turnCount: 1,
        lastEvent: { type: 'swap', byId: 1, targetId: 2 },
      }),
      seats: [0],
    });
    expect(sounds.playMove).not.toHaveBeenCalled();
  });

  it('still fires the thump for a HUMAN-driven freeze (no roulette, normal turn cadence)', () => {
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState({ currentPlayerIndex: 0 }), seats: [0] },
    });
    rerender({
      s: baseState({
        currentPlayerIndex: 1,
        turnCount: 1,
        lastEvent: { type: 'freeze', byId: 0, targetId: 1 },
      }),
      seats: [0],
    });
    expect(sounds.playMove).toHaveBeenCalledOnce();
  });

  it('still fires the thump when only one alive opponent remains (roulette skipped, regular cadence)', () => {
    const oneAlive = baseState({
      currentPlayerIndex: 1,
      players: [
        { id: 0, row: 0, col: 0, isEliminated: false },
        { id: 1, row: 0, col: 9, isEliminated: false },
        { id: 2, row: 9, col: 0, isEliminated: true },
        { id: 3, row: 9, col: 9, isEliminated: true },
      ],
    });
    const next = {
      ...oneAlive,
      currentPlayerIndex: 0,
      turnCount: 1,
      lastEvent: { type: 'freeze', byId: 1, targetId: 0 },
    };
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: oneAlive, seats: [0] },
    });
    rerender({ s: next, seats: [0] });
    expect(sounds.playMove).toHaveBeenCalledOnce();
  });

  it('still fires the thump for a regular bot move (no lastEvent)', () => {
    const { rerender } = renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState({ currentPlayerIndex: 1 }), seats: [0] },
    });
    rerender({
      s: baseState({ currentPlayerIndex: 2, turnCount: 1 }),
      seats: [0],
    });
    expect(sounds.playMove).toHaveBeenCalledOnce();
  });
});
