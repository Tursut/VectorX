// Tests for the GameOverScreen leaderboard.
//
// The headline-grabbing assertion here is the win/draw sound: it fires once
// when the leaderboard mounts, regardless of how many times the parent
// re-renders with the same gameover state. Used to live in GameScreen but
// fired twice — once during the wind-down on the board, once when the
// leaderboard appeared — see issue #34.

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../game/sounds', () => ({
  playWin: vi.fn(),
  playDraw: vi.fn(),
}));

import GameOverScreen from '../GameOverScreen';
import { PLAYERS } from '../../game/constants';
import * as sounds from '../../game/sounds';

const players = [
  { id: 0, isEliminated: false, finishTurn: null },
  { id: 1, isEliminated: true,  finishTurn: 12 },
  { id: 2, isEliminated: true,  finishTurn: 9  },
  { id: 3, isEliminated: true,  finishTurn: 4  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('GameOverScreen — win/draw sound', () => {
  it('plays the win sound exactly once on mount when there is a winner', () => {
    render(<GameOverScreen winner={PLAYERS[0]} players={players} onMenu={() => {}} />);
    expect(sounds.playWin).toHaveBeenCalledOnce();
    expect(sounds.playDraw).not.toHaveBeenCalled();
  });

  it('plays the draw sound exactly once on mount when there is no winner', () => {
    render(<GameOverScreen winner={null} players={players} onMenu={() => {}} />);
    expect(sounds.playDraw).toHaveBeenCalledOnce();
    expect(sounds.playWin).not.toHaveBeenCalled();
  });

  it('does NOT fire the win sound a second time when the parent re-renders with the same props', () => {
    const { rerender } = render(
      <GameOverScreen winner={PLAYERS[0]} players={players} onMenu={() => {}} />,
    );
    rerender(<GameOverScreen winner={PLAYERS[0]} players={players} onMenu={() => {}} />);
    rerender(<GameOverScreen winner={PLAYERS[0]} players={players} onMenu={() => {}} />);
    expect(sounds.playWin).toHaveBeenCalledOnce();
  });
});
