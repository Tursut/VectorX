import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_TIME } from '../game/constants';

let mockRouletteActive = false;
const mockMove = vi.fn();

function createDefaultNetworkMock() {
  return {
    gameState: {
      phase: 'playing',
      turnCount: 1,
      currentPlayerIndex: 0,
      players: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
    },
    lobby: {
      phase: 'playing',
      players: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      hostId: 0,
    },
    connectionState: 'open',
    mySeatId: 0,
    lastError: null,
    join: vi.fn(),
    start: vi.fn(),
    restartRoom: vi.fn(),
    move: mockMove,
    clearError: vi.fn(),
  };
}

/** @type {ReturnType<typeof createDefaultNetworkMock>} */
let mockNetwork = createDefaultNetworkMock();

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('../net/useNetworkGame', () => ({
  useNetworkGame: () => mockNetwork,
}));

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
    rouletteActive: mockRouletteActive,
  }),
}));

vi.mock('../game/useTrapChain', () => ({
  useTrapChain: () => ({ trappedPlayers: [], trapPlaying: false }),
}));

vi.mock('../game/useWinnerHero', () => ({
  useWinnerHero: () => ({ heroPlaying: false, dismissHero: vi.fn() }),
}));

vi.mock('../game/useGameplaySounds', () => ({
  useGameplaySounds: vi.fn(),
}));

vi.mock('../useBackGuard', () => ({
  useBackGuard: vi.fn(),
}));

vi.mock('../game/useBgHidden', () => ({
  useBgHidden: vi.fn(),
}));

vi.mock('../components/Lobby', () => ({
  default: () => <div data-testid="lobby" />,
}));

vi.mock('../components/AudioDebugOverlay', () => ({
  default: () => null,
}));

vi.mock('../components/GameScreen', () => ({
  default: ({ timeLeft }) => <div data-testid="time-left">{timeLeft}</div>,
}));

vi.mock('../game/sounds', () => ({
  loadMutedPreference: vi.fn(() => false),
  playTick: vi.fn(),
  playCountdownGo: vi.fn(),
  playCountdownBeat: vi.fn(),
  setMuted: vi.fn(),
  logAudioDebugEvent: vi.fn(),
  resumeAudio: vi.fn(),
}));

import OnlineGameController from '../OnlineGameController';
import { useBackGuard } from '../useBackGuard';

describe('OnlineGameController timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRouletteActive = false;
    mockNetwork = createDefaultNetworkMock();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('pauses countdown while roulette is active, then resumes when it ends', () => {
    mockRouletteActive = true;
    const { rerender } = render(
      <OnlineGameController code="ABCDE" displayName="Andreas" onExit={() => {}} />,
    );
    rerender(<OnlineGameController code="ABCDE" displayName="Andreas" onExit={() => {}} />);

    expect(screen.getByTestId('time-left')).toHaveTextContent(String(TURN_TIME));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('time-left')).toHaveTextContent(String(TURN_TIME));

    mockRouletteActive = false;
    act(() => {
      rerender(<OnlineGameController code="ABCDE" displayName="Andreas" onExit={() => {}} />);
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('time-left')).toHaveTextContent(String(TURN_TIME - 1));
  });
});

describe('OnlineGameController browser back guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetwork = createDefaultNetworkMock();
  });

  afterEach(() => {
    cleanup();
  });

  it('activates useBackGuard when host is in post-restart lobby (gameover + lobby phase)', () => {
    mockNetwork = {
      ...createDefaultNetworkMock(),
      gameState: {
        phase: 'gameover',
        turnCount: 3,
        currentPlayerIndex: 0,
        winner: 0,
        players: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      },
      lobby: {
        phase: 'lobby',
        hostId: 0,
        players: [{ id: 0, displayName: 'Host', isBot: false, isHost: true }],
      },
      mySeatId: 0,
    };
    const { rerender } = render(
      <OnlineGameController code="ABCDE" displayName="Host" onExit={() => {}} />,
    );
    rerender(<OnlineGameController code="ABCDE" displayName="Host" onExit={() => {}} />);

    expect(screen.getByTestId('lobby')).toBeInTheDocument();
    expect(vi.mocked(useBackGuard).mock.calls.some(([active]) => active === true)).toBe(true);
  });

  it('does not activate useBackGuard for joiner on gameover board before they tap JOIN ROOM', () => {
    mockNetwork = {
      ...createDefaultNetworkMock(),
      gameState: {
        phase: 'gameover',
        turnCount: 3,
        currentPlayerIndex: 0,
        winner: 0,
        players: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      },
      lobby: {
        phase: 'lobby',
        hostId: 0,
        players: [
          { id: 0, displayName: 'Host', isBot: false, isHost: true },
          { id: 1, displayName: 'Joiner', isBot: false, isHost: false },
        ],
      },
      mySeatId: 1,
    };
    const { rerender } = render(
      <OnlineGameController code="ABCDE" displayName="Joiner" onExit={() => {}} />,
    );
    rerender(<OnlineGameController code="ABCDE" displayName="Joiner" onExit={() => {}} />);

    expect(screen.getByTestId('time-left')).toBeInTheDocument();
    expect(vi.mocked(useBackGuard).mock.calls.every(([active]) => active === false)).toBe(true);
  });
});

describe('OnlineGameController status suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetwork = {
      ...createDefaultNetworkMock(),
      gameState: null,
      lobby: null,
      connectionState: 'connecting',
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('hides connecting status while suppressStatusScreens is true', () => {
    render(
      <OnlineGameController
        code="ABCDE"
        displayName="Andreas"
        onExit={() => {}}
        suppressStatusScreens
      />,
    );

    expect(screen.queryByText(/connecting to room/i)).toBeNull();
  });

  it('shows connecting status while suppressStatusScreens is false', () => {
    render(
      <OnlineGameController
        code="ABCDE"
        displayName="Andreas"
        onExit={() => {}}
      />,
    );

    expect(screen.getByText(/connecting to room/i)).toBeInTheDocument();
  });
});
