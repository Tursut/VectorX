// Tests for the GameOverScreen leaderboard.
//
// As of #60 the win sequence is three sequential screens (death →
// hero → leaderboard). The hero screen owns the short stinger;
// GameOverScreen owns the full fanfare and fires it once on mount.
// Draws skip the hero entirely so the draw sound also fires on mount
// here.

import { cleanup, render, screen } from '@testing-library/react';
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
  it('plays the win fanfare exactly once on mount when there is a winner', () => {
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

describe('GameOverScreen — leaderboard naming', () => {
  it('renders winner and eliminated rows from runtime display names', () => {
    const runtimePlayers = [
      { id: 0, displayName: 'Andreas', isEliminated: false, finishTurn: null },
      { id: 1, displayName: 'Mia', isEliminated: true, finishTurn: 12 },
      { id: 2, displayName: 'Bo', isEliminated: true, finishTurn: 9 },
      { id: 3, displayName: 'Kai', isEliminated: true, finishTurn: 4 },
    ];
    const winner = {
      ...PLAYERS[0],
      name: 'Andreas',
      shortName: 'Andreas',
    };

    render(<GameOverScreen winner={winner} players={runtimePlayers} onMenu={() => {}} />);

    expect(screen.getByText('ANDREAS WINS!')).toBeInTheDocument();
    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText('Bo')).toBeInTheDocument();
    expect(screen.getByText('Kai')).toBeInTheDocument();
  });

  it('falls back to static shortName when displayName is missing', () => {
    const runtimePlayers = [
      { id: 0, displayName: 'Andreas', isEliminated: false, finishTurn: null },
      { id: 1, isEliminated: true, finishTurn: 12 },
      { id: 2, isEliminated: true, finishTurn: 9 },
      { id: 3, isEliminated: true, finishTurn: 4 },
    ];
    const winner = {
      ...PLAYERS[0],
      name: 'Andreas',
      shortName: 'Andreas',
    };

    render(<GameOverScreen winner={winner} players={runtimePlayers} onMenu={() => {}} />);

    expect(screen.getByText(PLAYERS[1].shortName)).toBeInTheDocument();
  });
});
