// Step 14 — useNetworkGame hook tests.
//
// The load-bearing tests are the two contract checks: after a GAME_STATE
// broadcast arrives, the hook's `gameState` value has every key the local
// reducer's `initGame()` produces (top-level + per-player). That's what
// makes Step 16's swap of useReducer → useNetworkGame in
// OnlineGameController work without any UI changes.
//
// We mock `../client.js` entirely and capture the `onMessage` +
// `onStateChange` callbacks so the test can fire server frames manually and
// observe hook state transitions.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initGame } from '../../game/logic';

// ---------- Mock ../client.js ----------
//
// The mock replaces `createClient` with a vi.fn that:
//   - returns a stub { send, close, getState }
//   - captures the latest { onMessage, onStateChange } so tests can drive
//     the hook

let mockClient;
let capturedOnMessage;
let capturedOnStateChange;
let capturedBootstrap;

vi.mock('../client.js', () => ({
  createClient: vi.fn((opts) => {
    capturedOnMessage = opts.onMessage;
    capturedOnStateChange = opts.onStateChange;
    capturedBootstrap = opts.bootstrap;
    mockClient = {
      send: vi.fn(),
      close: vi.fn(),
      getState: vi.fn(() => 'open'),
    };
    return mockClient;
  }),
}));

// Import AFTER vi.mock so the mock is in place.
import { useNetworkGame } from '../useNetworkGame.js';

beforeEach(() => {
  mockClient = undefined;
  capturedOnMessage = undefined;
  capturedOnStateChange = undefined;
  capturedBootstrap = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------- Helpers ----------

// Build a wire-shape GAME_STATE message wrapping an initGame()-style state.
// initGame produces players without displayName/isBot/isHost/finishTurn;
// the zod schema on the server adds those at buildGameState time. We do the
// same transform here so the contract test can compare apples to apples.
function wireGameStateFrom(localState) {
  return {
    type: 'GAME_STATE',
    ...localState,
    players: localState.players.map((p) => ({
      ...p,
      displayName: `P${p.id}`,
      isBot: p.id > 0,
      isHost: p.id === 0,
      finishTurn: null,
    })),
  };
}

// ---------- Tests ----------

describe('useNetworkGame — contract: top-level shape', () => {
  it('exposes every field initGame() produces on gameState after GAME_STATE', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));
    const localInit = initGame(false, 3);

    act(() => capturedOnMessage(wireGameStateFrom(localInit)));

    for (const key of Object.keys(localInit)) {
      expect(result.current.gameState).toHaveProperty(key);
    }
    // And the discriminator is NOT leaked — gameState is shape-compatible
    // with the reducer's state, which has no `type` field.
    expect(result.current.gameState).not.toHaveProperty('type');
  });
});

describe('useNetworkGame — contract: per-player shape', () => {
  it('every local-reducer Player field is present on each hook player', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));
    const localInit = initGame(false, 3);

    act(() => capturedOnMessage(wireGameStateFrom(localInit)));

    for (const [i, localPlayer] of localInit.players.entries()) {
      const hookPlayer = result.current.gameState.players[i];
      for (const key of Object.keys(localPlayer)) {
        expect(hookPlayer).toHaveProperty(key);
      }
      expect(hookPlayer.id).toBe(localPlayer.id);
      expect(hookPlayer.row).toBe(localPlayer.row);
      expect(hookPlayer.col).toBe(localPlayer.col);
    }
  });
});

describe('useNetworkGame — lobby tracking', () => {
  it('sets lobby from the first LOBBY_STATE', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));
    const lobbyMsg = {
      type: 'LOBBY_STATE',
      code: 'ABCDE',
      players: [{ id: 0, displayName: 'Alice', isBot: false, isHost: true }],
      hostId: 0,
      magicItems: false,
    };

    act(() => capturedOnMessage(lobbyMsg));

    expect(result.current.lobby).toEqual(lobbyMsg);
  });
});

describe('useNetworkGame — mySeatId discovery', () => {
  it('infers mySeatId from the LOBBY_STATE player matching the HELLO name', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.join('Alice'));

    act(() =>
      capturedOnMessage({
        type: 'LOBBY_STATE',
        code: 'ABCDE',
        players: [
          { id: 0, displayName: 'Bob', isBot: false, isHost: true },
          { id: 1, displayName: 'Cat', isBot: false, isHost: false },
          { id: 2, displayName: 'Alice', isBot: false, isHost: false },
        ],
        hostId: 0,
        magicItems: false,
      }),
    );

    expect(result.current.mySeatId).toBe(2);
  });

  it('leaves mySeatId null if the name is not in the roster', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.join('Ghost'));
    act(() =>
      capturedOnMessage({
        type: 'LOBBY_STATE',
        code: 'ABCDE',
        players: [{ id: 0, displayName: 'Alice', isBot: false, isHost: true }],
        hostId: 0,
        magicItems: false,
      }),
    );

    expect(result.current.mySeatId).toBeNull();
  });
});

describe('useNetworkGame — imperative senders', () => {
  it('move(row, col) sends MOVE', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.move(3, 4));

    expect(mockClient.send).toHaveBeenCalledWith({ type: 'MOVE', row: 3, col: 4 });
  });

  it('start(magicItems) sends START', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.start(true));

    expect(mockClient.send).toHaveBeenCalledWith({ type: 'START', magicItems: true });
  });

  it('join(displayName) sends HELLO with the protocol version stamp', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.join('Alice'));

    expect(mockClient.send).toHaveBeenCalledWith({
      type: 'HELLO',
      version: 1,
      displayName: 'Alice',
    });
  });
});

describe('useNetworkGame — last error', () => {
  it('sets lastError from a fatal ERROR message', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() =>
      capturedOnMessage({ type: 'ERROR', code: 'ROOM_FULL' }),
    );

    expect(result.current.lastError).toEqual({ code: 'ROOM_FULL', message: undefined });
  });

  it('ignores transient NOT_YOUR_TURN and INVALID_MOVE errors', () => {
    // Server-authoritative state sync corrects the client via the next
    // GAME_STATE broadcast — no need to surface a full-screen error.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => capturedOnMessage({ type: 'ERROR', code: 'NOT_YOUR_TURN' }));
    expect(result.current.lastError).toBeNull();

    act(() => capturedOnMessage({ type: 'ERROR', code: 'INVALID_MOVE' }));
    expect(result.current.lastError).toBeNull();

    // A fatal error after transient ones is still surfaced.
    act(() => capturedOnMessage({ type: 'ERROR', code: 'UNAUTHORIZED' }));
    expect(result.current.lastError).toEqual({ code: 'UNAUTHORIZED', message: undefined });

    warn.mockRestore();
  });
});

describe('useNetworkGame — connection state', () => {
  it('reflects the wrapper onStateChange', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => capturedOnStateChange('open'));
    expect(result.current.connectionState).toBe('open');

    act(() => capturedOnStateChange('closed'));
    expect(result.current.connectionState).toBe('closed');
  });
});

describe('useNetworkGame — cleanup', () => {
  it('closes the client on unmount', () => {
    const { unmount } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    unmount();

    expect(mockClient.close).toHaveBeenCalled();
  });
});

describe('useNetworkGame — resilience (#22)', () => {
  it('passes a bootstrap callback that returns HELLO once a name is known', () => {
    // The client wrapper invokes bootstrap on every WS open BEFORE flushing
    // the queue; this is what guarantees HELLO is the first frame on every
    // reconnect (otherwise a queued user tap could race ahead).
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    expect(typeof capturedBootstrap).toBe('function');
    // No name yet → bootstrap returns null (no HELLO sent).
    expect(capturedBootstrap()).toBeNull();

    // After join() seeds the name, bootstrap returns HELLO.
    act(() => result.current.join('Alice'));
    expect(capturedBootstrap()).toEqual({
      type: 'HELLO',
      version: 1,
      displayName: 'Alice',
    });
  });

  it('resets mySeatId whenever the connection leaves OPEN', () => {
    // After a reconnect the server may give us a fresh seat (grace expired);
    // freezing mySeatId to its pre-disconnect value silently lies about
    // host status and current-player checks. We re-discover from the next
    // LOBBY_STATE.
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => result.current.join('Alice'));
    act(() =>
      capturedOnMessage({
        type: 'LOBBY_STATE',
        code: 'ABCDE',
        players: [{ id: 0, displayName: 'Alice', isBot: false, isHost: true }],
        hostId: 0,
        magicItems: false,
      }),
    );
    expect(result.current.mySeatId).toBe(0);

    act(() => capturedOnStateChange('closed'));
    expect(result.current.mySeatId).toBeNull();

    // Reconnect: a different seat assignment lands; we pick it up from the
    // next LOBBY_STATE rather than sticking to the stale 0.
    act(() => capturedOnStateChange('open'));
    act(() =>
      capturedOnMessage({
        type: 'LOBBY_STATE',
        code: 'ABCDE',
        players: [
          { id: 0, displayName: 'Bob', isBot: false, isHost: true },
          { id: 1, displayName: 'Alice', isBot: false, isHost: false },
        ],
        hostId: 0,
        magicItems: false,
      }),
    );
    expect(result.current.mySeatId).toBe(1);
  });

  it('clearError() drops lastError so OnlineGameController can recover from transient codes', () => {
    const { result } = renderHook(() => useNetworkGame({ url: 'ws://x/y' }));

    act(() => capturedOnMessage({ type: 'ERROR', code: 'UNAUTHORIZED' }));
    expect(result.current.lastError).toEqual({ code: 'UNAUTHORIZED', message: undefined });

    act(() => result.current.clearError());
    expect(result.current.lastError).toBeNull();
  });
});
