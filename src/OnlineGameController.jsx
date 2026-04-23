// Online multiplayer shell (Step 16). Replaces the Step-3 stub.
//
// State machine (internal `screen`):
//   'home'     → choose Create Room or Join Room
//   'creating' → POST /rooms in flight
//   'create-naming' → room code in hand, show JoinScreen with defaultCode
//   'joining'  → JoinScreen (empty defaultCode), user types code + name
//   'connected' → mount <OnlineRoom/>; WebSocket + useNetworkGame take over
//
// OnlineRoom is split out so React's hooks-can't-be-conditional rule doesn't
// stop us mounting useNetworkGame only once we have a URL to connect to.

import { useEffect, useRef, useState } from 'react';
import { SERVER_URL, wsUrl } from './config';
import { useNetworkGame } from './net/useNetworkGame';
import { getCurrentValidMoves } from './game/logic';
import { PLAYERS, TURN_TIME } from './game/constants';
import JoinScreen from './components/JoinScreen';
import Lobby from './components/Lobby';
import PlayerPanel from './components/PlayerPanel';
import TurnIndicator from './components/TurnIndicator';
import GameBoard from './components/GameBoard';
import GameOverScreen from './components/GameOverScreen';

export default function OnlineGameController({ onExit }) {
  const [screen, setScreen] = useState('home');
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [createError, setCreateError] = useState(null);

  async function handleCreate() {
    setCreateError(null);
    setScreen('creating');
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = await res.json();
      setRoomCode(body.code);
      setScreen('create-naming');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
      setScreen('home');
    }
  }

  function handleJoinSubmit({ code, displayName: name }) {
    setRoomCode(code);
    setDisplayName(name);
    setScreen('connected');
  }

  function handleRoomExit() {
    // Returning from inside a live room → back to the online home screen,
    // not all the way to the hotseat menu. Caller can hit ← Menu again.
    setScreen('home');
    setRoomCode('');
    setDisplayName('');
  }

  if (screen === 'connected') {
    return (
      <OnlineRoom
        code={roomCode}
        displayName={displayName}
        onLeaveRoom={handleRoomExit}
        onBackToMenu={onExit}
      />
    );
  }

  if (screen === 'joining' || screen === 'create-naming') {
    return (
      <JoinScreen
        defaultCode={screen === 'create-naming' ? roomCode : ''}
        onSubmit={handleJoinSubmit}
        onCancel={() => setScreen('home')}
      />
    );
  }

  // screen === 'home' or 'creating'
  return (
    <div className="online-home">
      <button className="online-back-btn" onClick={onExit}>← Menu</button>
      <h1 className="online-home-title">Play online</h1>
      <p className="online-home-sub">
        Create a room and share the link, or paste a friend's code.
      </p>

      <div className="online-home-actions">
        <button
          className="online-home-btn"
          onClick={handleCreate}
          disabled={screen === 'creating'}
        >
          {screen === 'creating' ? 'Creating…' : 'Create Room'}
        </button>
        <button
          className="online-home-btn"
          onClick={() => setScreen('joining')}
          disabled={screen === 'creating'}
        >
          Join Room
        </button>
      </div>

      {createError && (
        <p className="online-error" role="alert">
          Couldn't create a room: {createError}
        </p>
      )}
    </div>
  );
}

// ---------- OnlineRoom ----------

// Mounted only once we have a room code + displayName. Owns the WebSocket
// connection for its entire lifetime; useNetworkGame closes it on unmount.
function OnlineRoom({ code, displayName, onLeaveRoom, onBackToMenu }) {
  const url = wsUrl(code);
  const {
    gameState,
    lobby,
    connectionState,
    mySeatId,
    lastError,
    join,
    start,
    move,
  } = useNetworkGame({ url });

  // Host-local magic-items toggle. The authoritative value lives on the
  // server post-START (in lobby.magicItems, reflected into gameState.magicItems).
  const [magicItems, setMagicItems] = useState(false);

  // Send HELLO exactly once when the socket first becomes OPEN. useRef so
  // a re-render after setState doesn't re-trigger it.
  const helloSent = useRef(false);
  useEffect(() => {
    if (connectionState === 'open' && !helloSent.current) {
      helloSent.current = true;
      join(displayName);
    }
  }, [connectionState, displayName, join]);

  // ---------- Status screens ----------

  if (connectionState === 'connecting' || !helloSent.current) {
    return <StatusScreen label={`Connecting to room ${code}…`} onBack={onLeaveRoom} />;
  }

  if (lastError) {
    return (
      <StatusScreen
        label={`Error: ${lastError.code}${lastError.message ? ` — ${lastError.message}` : ''}`}
        onBack={onLeaveRoom}
      />
    );
  }

  if (connectionState === 'closed' || connectionState === 'destroyed') {
    return <StatusScreen label="Connection lost. Reconnecting…" onBack={onLeaveRoom} />;
  }

  if (!lobby) {
    return <StatusScreen label={`Joining room ${code}…`} onBack={onLeaveRoom} />;
  }

  // ---------- Game phases ----------

  // Playing: full game board
  if (gameState && gameState.phase === 'playing') {
    const currentSeat = gameState.currentPlayerIndex;
    const myTurn = mySeatId !== null && currentSeat === mySeatId;
    const currentIsBot = gameState.players[currentSeat]?.isBot === true;

    // Valid-move hints only when it's our turn. getCurrentValidMoves handles
    // normal-mode, portalActive, swapActive, and freezeSelectActive.
    const validMoves = myTurn ? getCurrentValidMoves(gameState) : [];
    const validMoveSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));

    return (
      <div className="game-layout online-game-layout">
        <div className="game-center">
          <PlayerPanel
            players={gameState.players}
            currentPlayerIndex={currentSeat}
            gremlinCount={0}
            frozenPlayerId={gameState.frozenPlayerId}
            frozenTurnsLeft={gameState.frozenTurnsLeft}
          />
          <div className="board-column">
            <TurnIndicator
              player={PLAYERS[currentSeat]}
              taunt={''}
              timeLeft={TURN_TIME}
              totalTime={TURN_TIME}
              portalActive={gameState.portalActive}
              swapActive={gameState.swapActive}
              freezeSelectActive={gameState.freezeSelectActive}
              lastEvent={gameState.lastEvent}
              isGremlin={currentIsBot}
              isThinking={false}
              soundEnabled={true}
              onToggleSound={() => {}}
            />
            <GameBoard
              grid={gameState.grid}
              players={gameState.players}
              validMoveSet={validMoveSet}
              onCellClick={(row, col) => {
                if (myTurn) move(row, col);
              }}
              currentPlayerIndex={currentSeat}
              items={gameState.items}
              portalActive={gameState.portalActive}
              swapActive={gameState.swapActive}
              freezeSelectActive={gameState.freezeSelectActive}
              isGremlinTurn={currentIsBot}
              frozenPlayerId={gameState.frozenPlayerId}
              frozenTurnsLeft={gameState.frozenTurnsLeft}
            />
            <button className="exit-game-btn" onClick={onBackToMenu}>
              ← Exit to menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Game over: winner screen
  if (gameState && gameState.phase === 'gameover') {
    const winnerPlayer =
      gameState.winner !== null ? PLAYERS[gameState.winner] : null;
    return (
      <GameOverScreen
        winner={winnerPlayer}
        players={gameState.players}
        onRestart={null /* rematch is a future feature */}
        onMenu={onBackToMenu}
      />
    );
  }

  // Lobby phase (no GAME_STATE yet)
  return (
    <Lobby
      code={code}
      players={lobby.players}
      hostId={lobby.hostId}
      mySeatId={mySeatId}
      magicItems={magicItems}
      onToggleMagicItems={setMagicItems}
      onStart={() => start(magicItems)}
      onLeave={onBackToMenu}
    />
  );
}

// Tiny "waiting" screen used for connection transitions.
function StatusScreen({ label, onBack }) {
  return (
    <div className="online-status">
      <p>{label}</p>
      {onBack && (
        <button className="online-back-btn" onClick={onBack}>
          ← Back
        </button>
      )}
    </div>
  );
}
