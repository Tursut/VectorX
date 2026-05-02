import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const initGameMock = vi.fn((magicItems, gremlinCount) => ({
  phase: 'playing',
  grid: [],
  players: [
    { id: 0, isEliminated: false },
    { id: 1, isEliminated: false },
    { id: 2, isEliminated: false },
    { id: 3, isEliminated: false },
  ],
  currentPlayerIndex: 0,
  gremlinCount,
  sandboxMode: false,
  items: [],
  portalActive: false,
  freezeSelectActive: false,
  swapActive: false,
}));

vi.mock('../game/logic', () => ({
  initGame: (...args) => initGameMock(...args),
  initSandboxGame: vi.fn(),
  applyMove: vi.fn((state) => state),
  getCurrentValidMoves: vi.fn(() => []),
  eliminateCurrentPlayer: vi.fn((state) => state),
  placeSandboxItem: vi.fn((state) => state),
}));

vi.mock('../components/StartScreen', () => ({
  default: ({ onStart, onQuickPlay, onChangeGremlinCount, gremlinCount }) => (
    <div>
      <div data-testid="gremlin-count">{gremlinCount}</div>
      <button type="button" data-testid="set-gremlins-zero" onClick={() => onChangeGremlinCount(0)}>
        Set all humans
      </button>
      <button type="button" data-testid="start-local" onClick={onStart}>
        Start local
      </button>
      <button type="button" data-testid="quick-play" onClick={onQuickPlay}>
        Quick play
      </button>
    </div>
  ),
}));

vi.mock('../components/GameScreen', () => ({
  default: ({ gameState }) => <div data-testid="game-screen">gremlins:{gameState.gremlinCount}</div>,
}));

vi.mock('../components/GameBoard', () => ({ default: () => null }));
vi.mock('../components/PlayerPanel', () => ({ default: () => null }));
vi.mock('../components/GameOverScreen', () => ({ default: () => null }));
vi.mock('../components/EventToast', () => ({ default: () => null }));
vi.mock('../components/SandboxPanel', () => ({ default: () => null }));
vi.mock('../components/AudioDebugOverlay', () => ({ default: () => null }));
vi.mock('../game/useDerivedAnimations', () => ({
  useDerivedAnimations: () => ({
    bombBlast: null,
    portalJump: null,
    swapFlash: null,
    flyingFreeze: null,
    roulettePlayerId: null,
    rouletteRevealing: false,
    pendingSwap: null,
    rouletteActor: null,
    rouletteActive: false,
  }),
}));
vi.mock('../game/useTrapChain', () => ({
  useTrapChain: () => ({ trappedPlayers: [], trapPlaying: false }),
}));
vi.mock('../game/useWinnerHero', () => ({
  useWinnerHero: () => ({ heroPlaying: false, heroEnded: false, dismissHero: () => {} }),
}));
vi.mock('../game/useGameplaySounds', () => ({ useGameplaySounds: () => {} }));
vi.mock('../useBackGuard', () => ({ useBackGuard: () => {} }));
vi.mock('../game/useBgHidden', () => ({ useBgHidden: () => {} }));
vi.mock('../game/sounds', () => ({
  loadMutedPreference: () => false,
  logAudioDebugEvent: () => {},
  resumeAudio: () => {},
  setMuted: () => {},
  playTick: () => {},
  playCountdownBeat: () => {},
  playCountdownGo: () => {},
}));

import LocalGameController from '../LocalGameController';

describe('LocalGameController quick play', () => {
  beforeEach(() => {
    initGameMock.mockClear();
  });

  it('resets local player composition to 1 human and 3 bots', () => {
    render(<LocalGameController />);

    fireEvent.click(screen.getByTestId('set-gremlins-zero'));
    expect(screen.getByTestId('gremlin-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByTestId('quick-play'));
    expect(screen.getByTestId('gremlin-count')).toHaveTextContent('3');
  });
});
