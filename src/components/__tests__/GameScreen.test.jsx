// Tests for the shared <GameScreen> surface used by both controllers.
//
// We mock the big rendering children (PlayerPanel/TurnIndicator/GameBoard/
// GameOverScreen) so we can assert the routing + prop plumbing + mySeats
// click-gating without pulling their full implementations into the test.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// getCurrentValidMoves walks the grid; tests don't care about its output
// (cell rendering is mocked), so stub it with an empty array.
vi.mock('../../game/logic', () => ({
  getCurrentValidMoves: vi.fn(() => []),
}));

vi.mock('../../game/sounds', () => ({
  resumeAudio: vi.fn(),
  startBgTheme: vi.fn(),
  stopBgTheme: vi.fn(),
  playMove: vi.fn(),
  playClaim: vi.fn(),
  playYourTurn: vi.fn(),
  playFreeze: vi.fn(),
  playSwap: vi.fn(),
  playElimination: vi.fn(),
  playWin: vi.fn(),
  playDraw: vi.fn(),
}));

vi.mock('../PlayerPanel', () => ({
  default: ({ currentPlayerIndex }) => (
    <div data-testid="player-panel">current={currentPlayerIndex}</div>
  ),
}));
vi.mock('../TurnIndicator', () => ({
  default: ({ player }) => <div data-testid="turn-indicator">{player?.name}</div>,
}));
vi.mock('../GameBoard', () => ({
  default: ({ onCellClick }) => (
    <button data-testid="cell" onClick={() => onCellClick(2, 3)}>cell</button>
  ),
}));
vi.mock('../GameOverScreen', () => ({
  default: ({ onMenu, onRestart }) => (
    <div data-testid="gameover">
      <button data-testid="menu" onClick={onMenu}>menu</button>
      {onRestart && <button data-testid="restart" onClick={onRestart}>restart</button>}
    </div>
  ),
}));

import GameScreen from '../GameScreen';
import * as sounds from '../../game/sounds';

function baseState(overrides = {}) {
  return {
    phase: 'playing',
    turnCount: 0,
    currentPlayerIndex: 0,
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    lastEvent: null,
    winner: null,
    items: [],
    grid: [],
    gremlinCount: 0,
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
  cleanup();
  vi.useRealTimers();
});

// ---------- Rendering branches ----------

describe('GameScreen — rendering', () => {
  it('renders nothing when gameState is null', () => {
    const { container } = render(<GameScreen gameState={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the playing board for phase="playing"', () => {
    render(<GameScreen gameState={baseState()} mySeats={[0]} onMove={() => {}} />);
    expect(screen.getByTestId('player-panel')).toBeInTheDocument();
    expect(screen.getByTestId('turn-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('cell')).toBeInTheDocument();
    expect(screen.queryByTestId('gameover')).toBeNull();
  });

  it('renders GameOverScreen for phase="gameover" (no trap in progress)', () => {
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    expect(screen.getByTestId('gameover')).toBeInTheDocument();
    expect(screen.queryByTestId('cell')).toBeNull();
  });
});

// ---------- mySeats click gating ----------

describe('GameScreen — mySeats click gating', () => {
  it('calls onMove when currentPlayerIndex is in mySeats', () => {
    const onMove = vi.fn();
    render(<GameScreen gameState={baseState()} mySeats={[0]} onMove={onMove} />);
    fireEvent.click(screen.getByTestId('cell'));
    expect(onMove).toHaveBeenCalledWith(2, 3);
  });

  it('does NOT call onMove when currentPlayerIndex is not in mySeats', () => {
    const onMove = vi.fn();
    // currentPlayerIndex = 0, mySeats = [1] → not my turn.
    render(<GameScreen gameState={baseState()} mySeats={[1]} onMove={onMove} />);
    fireEvent.click(screen.getByTestId('cell'));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('does NOT call onMove when mySeats is empty (spectator)', () => {
    const onMove = vi.fn();
    render(<GameScreen gameState={baseState()} mySeats={[]} onMove={onMove} />);
    fireEvent.click(screen.getByTestId('cell'));
    expect(onMove).not.toHaveBeenCalled();
  });
});

// ---------- Callbacks ----------

describe('GameScreen — callbacks', () => {
  it('onExit fires from the GameOver menu button', () => {
    const onExit = vi.fn();
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} onExit={onExit} />);
    fireEvent.click(screen.getByTestId('menu'));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('onRestart is omitted when not provided (online has no rematch yet)', () => {
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    expect(screen.queryByTestId('restart')).toBeNull();
  });

  it('onRestart is wired when provided (local hotseat)', () => {
    const onRestart = vi.fn();
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(
      <GameScreen
        gameState={state}
        mySeats={[0]}
        onMove={() => {}}
        onRestart={onRestart}
      />,
    );
    fireEvent.click(screen.getByTestId('restart'));
    expect(onRestart).toHaveBeenCalledOnce();
  });
});

// ---------- Sound effects ----------
//
// NOTE: Most gameplay sounds (bg theme, move/claim, your-turn chime,
// freeze/swap event sounds) now live in useGameplaySounds and are called
// from the outer controllers, not from GameScreen. They are tested in
// src/game/__tests__/useGameplaySounds.test.js.
//
// GameScreen still owns win/draw (gated on the trap animation state it owns)
// so those tests stay here.

describe('GameScreen — sound effects', () => {
  it('plays the win sound on gameover with a winner', () => {
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    expect(sounds.playWin).toHaveBeenCalledOnce();
    expect(sounds.playDraw).not.toHaveBeenCalled();
  });

  it('plays the draw sound on gameover with no winner', () => {
    const state = baseState({ phase: 'gameover', winner: null });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    expect(sounds.playDraw).toHaveBeenCalledOnce();
    expect(sounds.playWin).not.toHaveBeenCalled();
  });

  it('does NOT fire your-turn chime when currentPlayerIndex is not in mySeats', () => {
    render(<GameScreen gameState={baseState()} mySeats={[1]} onMove={() => {}} />);
    expect(sounds.playYourTurn).not.toHaveBeenCalled();
  });
});
