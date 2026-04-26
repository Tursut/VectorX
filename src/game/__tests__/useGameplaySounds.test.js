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
  startMenuTheme: vi.fn(),
  stopMenuTheme: vi.fn(),
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

  // enabled gate (issue #35) — used by OnlineGameController to hold
  // the bg theme + your-turn chime until the 3-2-1-GO countdown
  // clears.
  it('does NOT start bg theme while enabled is false', () => {
    renderHook(({ s, seats, opts }) => useGameplaySounds(s, seats, opts), {
      initialProps: { s: baseState(), seats: [0], opts: { enabled: false } },
    });
    expect(sounds.startBgTheme).not.toHaveBeenCalled();
  });

  it('starts bg theme the moment enabled flips true', () => {
    const { rerender } = renderHook(
      ({ s, seats, opts }) => useGameplaySounds(s, seats, opts),
      { initialProps: { s: baseState(), seats: [0], opts: { enabled: false } } },
    );
    expect(sounds.startBgTheme).not.toHaveBeenCalled();
    rerender({ s: baseState(), seats: [0], opts: { enabled: true } });
    expect(sounds.startBgTheme).toHaveBeenCalledOnce();
  });
});

describe('useGameplaySounds — menu vs in-game theme', () => {
  it('starts the menu theme on the start screen (gameState is null)', () => {
    renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: null, seats: [] },
    });
    expect(sounds.startMenuTheme).toHaveBeenCalledOnce();
    expect(sounds.startBgTheme).not.toHaveBeenCalled();
  });

  it('starts the menu theme during the lobby (phase !== "playing")', () => {
    renderHook(({ s, seats }) => useGameplaySounds(s, seats), {
      initialProps: { s: baseState({ phase: 'lobby' }), seats: [0] },
    });
    expect(sounds.startMenuTheme).toHaveBeenCalledOnce();
    expect(sounds.startBgTheme).not.toHaveBeenCalled();
  });

  it('switches menu → in-game when the game starts (phase becomes "playing")', () => {
    const { rerender } = renderHook(
      ({ s, seats }) => useGameplaySounds(s, seats),
      { initialProps: { s: null, seats: [0] } },
    );
    expect(sounds.startMenuTheme).toHaveBeenCalledOnce();
    rerender({ s: baseState({ phase: 'playing' }), seats: [0] });
    expect(sounds.stopMenuTheme).toHaveBeenCalled();
    expect(sounds.startBgTheme).toHaveBeenCalledOnce();
  });

  it('defers the menu loop past the win sound when the game ends (issue: menu used to kick over the fanfare)', () => {
    const { rerender } = renderHook(
      ({ s, seats }) => useGameplaySounds(s, seats),
      { initialProps: { s: baseState({ phase: 'playing' }), seats: [0] } },
    );
    expect(sounds.startBgTheme).toHaveBeenCalledOnce();
    rerender({ s: baseState({ phase: 'gameover', winner: 0 }), seats: [0] });
    expect(sounds.stopBgTheme).toHaveBeenCalled();
    // Win sound just started — menu loop must NOT have kicked in yet.
    expect(sounds.startMenuTheme).not.toHaveBeenCalled();
    // After the deferred-resume timer (3.5 s), menu loop fires.
    act(() => { vi.advanceTimersByTime(3500); });
    expect(sounds.startMenuTheme).toHaveBeenCalledOnce();
  });

  it('keeps menu silent while trap chain is still drawing (trapPlaying=true)', () => {
    const { rerender } = renderHook(
      ({ s, seats, opts }) => useGameplaySounds(s, seats, opts),
      {
        initialProps: {
          s: baseState({ phase: 'playing' }),
          seats: [0],
          opts: { trapPlaying: false },
        },
      },
    );
    rerender({
      s: baseState({ phase: 'gameover', winner: 0 }),
      seats: [0],
      opts: { trapPlaying: true },
    });
    // Trap is still drawing — menu must NOT start, even with the
    // post-gameover delay timer.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(sounds.startMenuTheme).not.toHaveBeenCalled();

    // Trap drains. NOW the gameover delay timer should be set up.
    rerender({
      s: baseState({ phase: 'gameover', winner: 0 }),
      seats: [0],
      opts: { trapPlaying: false },
    });
    expect(sounds.startMenuTheme).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3500); });
    expect(sounds.startMenuTheme).toHaveBeenCalledOnce();
  });

  it('keeps both themes silent while the pre-game countdown is up (enabled=false)', () => {
    renderHook(({ s, seats, opts }) => useGameplaySounds(s, seats, opts), {
      initialProps: {
        s: baseState({ phase: 'playing' }),
        seats: [0],
        opts: { enabled: false },
      },
    });
    expect(sounds.startBgTheme).not.toHaveBeenCalled();
    expect(sounds.startMenuTheme).not.toHaveBeenCalled();
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

  it('does NOT fire your-turn chime while enabled is false (issue #35 — countdown holds it back)', () => {
    renderHook(() => useGameplaySounds(baseState(), [0], { enabled: false }));
    expect(sounds.playYourTurn).not.toHaveBeenCalled();
  });

  it('does NOT fire move + claim on turn change while enabled is false', () => {
    const { rerender } = renderHook(
      ({ s, seats, opts }) => useGameplaySounds(s, seats, opts),
      { initialProps: { s: baseState(), seats: [0], opts: { enabled: false } } },
    );
    rerender({
      s: baseState({ currentPlayerIndex: 1, turnCount: 1 }),
      seats: [0],
      opts: { enabled: false },
    });
    expect(sounds.playMove).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(sounds.playClaim).not.toHaveBeenCalled();
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
