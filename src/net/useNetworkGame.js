// React hook exposing a server-driven game as a `gameState` value that is
// shape-compatible with the hotseat path's `useReducer(gameReducer, null)`.
//
// The compatibility is the contract: every field the local reducer produces
// via `initGame(magicItems, gremlinCount)` also appears on `hook.gameState`
// after the first `GAME_STATE` broadcast arrives. Extra per-player fields
// (`displayName`, `isBot`, `isHost`, `finishTurn`) are added by the server
// and come along for free — the existing UI components ignore them because
// they read identity from `PLAYERS` in `src/game/constants.js`.
//
// Also exposes lobby state, connection state, the caller's seat id, last
// server error, and imperative senders (`join`, `start`, `move`).
//
// This hook is the bridge Step 16 uses to wire `OnlineGameController` to the
// real server. It owns one `createClient` instance for its lifetime; the
// effect cleans up on unmount.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from './client.js';

/**
 * @param {{ url: string }} opts
 */
export function useNetworkGame({ url }) {
  const [gameState, setGameState] = useState(null);
  const [lobby, setLobby] = useState(null);
  const [connectionState, setConnectionState] = useState('connecting');
  const [mySeatId, setMySeatId] = useState(null);
  const [lastError, setLastError] = useState(null);

  // Client instance survives re-renders; lives in a ref so callbacks don't
  // need to be re-memoised on every render.
  const clientRef = useRef(null);
  // The displayName we sent in HELLO — used to discover mySeatId from the
  // next LOBBY_STATE (server rejects duplicates, so exact-match is safe).
  const myNameRef = useRef(null);
  // Cache of mySeatId so we can stop searching once it's known.
  const mySeatIdRef = useRef(null);

  useEffect(() => {
    mySeatIdRef.current = null;
    myNameRef.current = null;

    const client = createClient({
      url,
      // Bootstrap fires on EVERY WS open (initial + every reconnect) BEFORE
      // any queued message flushes. Returning HELLO from here guarantees
      // the server always sees HELLO first on a fresh socket — without it,
      // a user tap queued during a disconnect would race to the wire ahead
      // of HELLO and the server's UNAUTHORIZED check would fire (#22).
      // Returning null pre-join is fine; the bootstrap is a no-op.
      bootstrap: () => {
        const want = myNameRef.current;
        if (!want) return null;
        return { type: 'HELLO', version: 1, displayName: want };
      },
      onStateChange: (s) => {
        // Anything other than 'open' means our seat assignment may no
        // longer be authoritative — the next 'open' will trigger a fresh
        // HELLO via bootstrap, the server may give us a different seat
        // (grace expired, etc.), and we re-discover from the next
        // LOBBY_STATE. Without resetting here, the one-shot guard in
        // tryDiscoverSeat would freeze mySeatId on the stale value.
        if (s !== 'open') {
          mySeatIdRef.current = null;
          setMySeatId(null);
        }
        setConnectionState(s);
      },
      onMessage: (msg) => {
        switch (msg.type) {
          case 'LOBBY_STATE': {
            setLobby(msg);
            tryDiscoverSeat(msg.players);
            return;
          }
          case 'JOIN': {
            // Append to local lobby cache if we have one; the authoritative
            // snapshot is the next LOBBY_STATE.
            setLobby((prev) => {
              if (!prev) return prev;
              if (prev.players.some((p) => p.id === msg.player.id)) return prev;
              return { ...prev, players: [...prev.players, msg.player] };
            });
            tryDiscoverSeat([msg.player]);
            return;
          }
          case 'GAME_STATE': {
            // Strip the `type` discriminator — `gameState` is meant to be
            // shape-compatible with `initGame()` output, which has no type.
            // Destructure on the fly.
            const { type: _type, ...state } = msg;
            setGameState(state);
            // Also re-discover our seat from the GAME_STATE player roster.
            // The mid-game silent-tab-kill recovery path on the server only
            // pushes GAME_STATE (no fresh LOBBY_STATE), so without this the
            // client wouldn't pick the seat back up after a reconnect →
            // myTurn stays false, validMoves is empty, the user can see
            // the board but can't click any cell.
            tryDiscoverSeat(msg.players);
            return;
          }
          case 'ELIMINATED':
          case 'GAME_OVER': {
            // Authoritative state change lands in the next GAME_STATE
            // broadcast right after. No UI-visible work here yet.
            return;
          }
          case 'ERROR': {
            // NOT_YOUR_TURN / INVALID_MOVE are routine races between a client
            // click and a server broadcast that already advanced the turn.
            // The server's next GAME_STATE resyncs us; no user-visible work.
            if (msg.code === 'NOT_YOUR_TURN' || msg.code === 'INVALID_MOVE') {
              console.warn(`[useNetworkGame] transient ${msg.code}`, msg.message ?? '');
              return;
            }
            setLastError({ code: msg.code, message: msg.message });
            return;
          }
          default:
            return;
        }
      },
    });

    clientRef.current = client;

    function tryDiscoverSeat(candidates) {
      if (mySeatIdRef.current !== null) return;
      const want = myNameRef.current;
      if (!want) return;
      const hit = candidates.find((p) => p.displayName === want);
      if (hit) {
        mySeatIdRef.current = hit.id;
        setMySeatId(hit.id);
      }
    }

    return () => {
      clientRef.current = null;
      client.close();
    };
  }, [url]);

  const join = useCallback((displayName) => {
    myNameRef.current = displayName;
    clientRef.current?.send({ type: 'HELLO', version: 1, displayName });
  }, []);

  // Drop the last server error. Used by OnlineGameController to recover from
  // recoverable codes (e.g. lobby-phase UNAUTHORIZED — the user pressed
  // START while their socket was reconnecting and lost host status during
  // the grace expiry; the next render of the lobby is fine to show).
  const clearError = useCallback(() => setLastError(null), []);

  const start = useCallback((magicItems) => {
    clientRef.current?.send({ type: 'START', magicItems });
  }, []);

  const restartRoom = useCallback(() => {
    clientRef.current?.send({ type: 'RESTART_ROOM' });
  }, []);

  const move = useCallback((row, col) => {
    clientRef.current?.send({ type: 'MOVE', row, col });
  }, []);

  return {
    gameState,
    lobby,
    connectionState,
    mySeatId,
    lastError,
    join,
    start,
    restartRoom,
    move,
    clearError,
  };
}
