// Tests for the shared <GameScreen> surface used by both controllers.
//
// We mock the big rendering children (PlayerPanel/TurnIndicator/GameBoard/
// GameOverScreen) so we can assert the routing + prop plumbing + mySeats
// click-gating without pulling their full implementations into the test.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// As of #60, GameScreen receives heroPlaying as a prop from the
// controller. These tests don't pass it (defaults to false), so the
// hero overlay is skipped and GameOverScreen renders immediately on
// phase=gameover. The hook tests cover the hero phase in isolation.

// getCurrentValidMoves walks the grid; tests don't care about its output
// (cell rendering is mocked), so stub it with an empty array.
vi.mock('../../game/logic', () => ({
  getCurrentValidMoves: vi.fn(() => []),
}));

vi.mock('../../game/sounds', () => ({
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
  playWin: vi.fn(),
  playWinStinger: vi.fn(),
  playDraw: vi.fn(),
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
  default: ({ onCellClick, currentPlayerIndex, isOpponentTurn, heldItemActor }) => (
    <button
      data-testid="cell"
      data-current={currentPlayerIndex}
      data-opponent-turn={String(Boolean(isOpponentTurn))}
      data-held-actor={heldItemActor ? `${heldItemActor.playerId}:${heldItemActor.itemKind}` : ''}
      onClick={() => onCellClick(2, 3)}
    >cell</button>
  ),
}));
vi.mock('../GameOverScreen', () => ({
  default: ({ winner, onMenu, onRestart, restartLabel, restartDisabled }) => (
    <div data-testid="gameover">
      <div
        data-testid="winner-name"
        data-name={winner?.name ?? ''}
        data-short-name={winner?.shortName ?? ''}
      />
      <button data-testid="menu" onClick={onMenu}>menu</button>
      {onRestart && (
        <button data-testid="restart" disabled={restartDisabled} onClick={onRestart}>
          {restartLabel ?? 'restart'}
        </button>
      )}
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

  it('renders GameOverScreen for phase="gameover" once the hero phase ends', () => {
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    // Hero phase fires for HERO_HOLD_MS, then GameOverScreen takes
    // over. We just assert the end-state here — the hook tests cover
    // the hero phase timing in isolation.
    expect(screen.getByTestId('gameover')).toBeInTheDocument();
  });

  it('keeps the board visible during trap playback even after gameover lands', () => {
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(
      <GameScreen
        gameState={state}
        mySeats={[0]}
        onMove={() => {}}
        trapPlaying
        trappedPlayers={[{ id: 1, row: 0, col: 9 }]}
      />,
    );
    expect(screen.queryByTestId('gameover')).toBeNull();
    expect(screen.getByTestId('cell')).toBeInTheDocument();
  });

  it('passes runtime displayName to GameOver winner identity', () => {
    const state = baseState({
      phase: 'gameover',
      winner: 0,
      players: [
        { id: 0, displayName: 'Hugo', isEliminated: false },
        { id: 1, isEliminated: true, finishTurn: 12 },
        { id: 2, isEliminated: true, finishTurn: 8 },
        { id: 3, isEliminated: true, finishTurn: 3 },
      ],
    });
    render(<GameScreen gameState={state} mySeats={[0]} onMove={() => {}} />);
    expect(screen.getByTestId('winner-name')).toHaveAttribute('data-name', 'Hugo');
    expect(screen.getByTestId('winner-name')).toHaveAttribute('data-short-name', 'Hugo');
  });
});

// ---------- Roulette override (issue #39) ----------

describe('GameScreen — roulette overrides displayed current player', () => {
  // Setup: bot at seat 2 just used freeze on the human at seat 0.
  // The reducer has already advanced currentPlayerIndex to seat 3
  // (the next bot), but the 6-second roulette animation is rolling
  // for seat 2's pick. The on-board pulse + PlayerPanel banner must
  // stay on seat 2 (the actor) until the wheel resolves.
  const ROULETTE_PROPS = {
    gameState: baseState({ currentPlayerIndex: 3, gremlinCount: 3 }),
    mySeats: [0],
    onMove: () => {},
    rouletteActive: true,
    rouletteActor: { playerId: 2, itemKind: 'freeze' },
  };

  it('routes the actor to PlayerPanel as current while rolling', () => {
    render(<GameScreen {...ROULETTE_PROPS} />);
    expect(screen.getByTestId('player-panel')).toHaveTextContent('current=2');
  });

  it('routes the actor to GameBoard as current while rolling', () => {
    render(<GameScreen {...ROULETTE_PROPS} />);
    expect(screen.getByTestId('cell')).toHaveAttribute('data-current', '2');
  });

  it('keeps isOpponentTurn=true so the cell pulse renders on the actor', () => {
    // Even though the next-up seat (3) is a bot — i.e. the current
    // gameState.currentPlayerIndex is "not my turn" anyway — the
    // pulse must drive off the *displayed* seat (2), which is also
    // not in mySeats. So the flag stays true regardless of who's
    // technically up next. The bug surface this prevents: if the
    // next-up seat happened to be the local human, the original
    // !myTurn computation would flip false and the pulse would
    // disappear during the roulette.
    render(
      <GameScreen
        {...ROULETTE_PROPS}
        gameState={baseState({ currentPlayerIndex: 0, gremlinCount: 3 })}
        mySeats={[0]}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-opponent-turn', 'true');
    expect(screen.getByTestId('cell')).toHaveAttribute('data-current', '2');
  });

  it('falls back to currentPlayerIndex when the roulette is not active', () => {
    render(
      <GameScreen
        {...ROULETTE_PROPS}
        rouletteActive={false}
        rouletteActor={null}
      />,
    );
    expect(screen.getByTestId('player-panel')).toHaveTextContent('current=3');
    expect(screen.getByTestId('cell')).toHaveAttribute('data-current', '3');
  });
});

// ---------- heldItemActor across pickup + roulette (issue #41) ----------

describe('GameScreen — heldItemActor spans pickup + roulette', () => {
  // Bot at seat 2 just stepped onto a freeze item. State has
  // freezeSelectActive=true; currentPlayerIndex is still seat 2 (the
  // bot picks a target on its NEXT move, after a ~1.6 s thinking
  // delay). During that whole window the icon should be visible.
  it('emits heldItemActor while a bot is in the freezeSelectActive pickup phase', () => {
    render(
      <GameScreen
        gameState={baseState({
          currentPlayerIndex: 2,
          freezeSelectActive: true,
          gremlinCount: 3, // seats 1-3 are bots, seat 0 is human
        })}
        mySeats={[0]}
        onMove={() => {}}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '2:freeze');
  });

  it('emits heldItemActor while a bot is in the swapActive pickup phase', () => {
    render(
      <GameScreen
        gameState={baseState({
          currentPlayerIndex: 2,
          swapActive: true,
          gremlinCount: 3,
        })}
        mySeats={[0]}
        onMove={() => {}}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '2:swap');
  });

  it('does NOT emit heldItemActor when the human is in pickup phase (humans select targets, no roulette)', () => {
    render(
      <GameScreen
        gameState={baseState({
          currentPlayerIndex: 0,
          freezeSelectActive: true,
          gremlinCount: 3,
        })}
        mySeats={[0]}
        onMove={() => {}}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '');
  });

  it('routes the rouletteActor through heldItemActor while the wheel is rolling', () => {
    render(
      <GameScreen
        gameState={baseState({ currentPlayerIndex: 3, gremlinCount: 3 })}
        mySeats={[0]}
        onMove={() => {}}
        rouletteActive
        rouletteActor={{ playerId: 2, itemKind: 'freeze' }}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '2:freeze');
  });

  it('rouletteActor takes precedence over a concurrent pickup (defence-in-depth)', () => {
    // In practice these two states don't co-occur (the reducer flips
    // freezeSelectActive=false when the freeze applies). But if they
    // ever did, the roulette is the more specific signal.
    render(
      <GameScreen
        gameState={baseState({
          currentPlayerIndex: 2,
          freezeSelectActive: true,
          gremlinCount: 3,
        })}
        mySeats={[0]}
        onMove={() => {}}
        rouletteActive
        rouletteActor={{ playerId: 1, itemKind: 'swap' }}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '1:swap');
  });

  it('emits null when neither pickup nor roulette is active', () => {
    render(
      <GameScreen
        gameState={baseState({ currentPlayerIndex: 2, gremlinCount: 3 })}
        mySeats={[0]}
        onMove={() => {}}
      />,
    );
    expect(screen.getByTestId('cell')).toHaveAttribute('data-held-actor', '');
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

  it('passes restartLabel and restartDisabled through to GameOverScreen', () => {
    const onRestart = vi.fn();
    const state = baseState({ phase: 'gameover', winner: 0 });
    render(
      <GameScreen
        gameState={state}
        mySeats={[0]}
        onMove={() => {}}
        onRestart={onRestart}
        restartLabel="WAITING FOR HOST"
        restartDisabled
      />,
    );
    expect(screen.getByTestId('restart')).toHaveTextContent('WAITING FOR HOST');
    expect(screen.getByTestId('restart')).toBeDisabled();
  });
});

// ---------- Sound effects ----------
//
// Most gameplay sounds (bg theme, move/claim, your-turn chime, freeze/swap
// apply) now live in useGameplaySounds and are called from the outer
// controllers, not from GameScreen — covered in
// src/game/__tests__/useGameplaySounds.test.js.
//
// Win/draw moved to GameOverScreen's mount effect (issue #34) — covered in
// src/components/__tests__/GameOverScreen.test.jsx.

describe('GameScreen — sound effects', () => {
  it('does NOT fire your-turn chime when currentPlayerIndex is not in mySeats', () => {
    render(<GameScreen gameState={baseState()} mySeats={[1]} onMove={() => {}} />);
    expect(sounds.playYourTurn).not.toHaveBeenCalled();
  });
});
