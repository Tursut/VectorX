// Online multiplayer game renderer.
//
// Receives an already-established room (`code`) + the joining user's chosen
// identity (`displayName` + `initialMagicItems`) from the parent (App.jsx).
// Owns the WebSocket lifetime via useNetworkGame. Routes on connection state
// + game phase:
//
//   connecting / waiting for HELLO → StatusScreen
//   lobby phase (no GAME_STATE yet) → Lobby
//   playing → PlayerPanel + TurnIndicator + GameBoard
//   gameover → GameOverScreen
//
// The Step-16 "home / creating / JoinScreen" outer state machine moved to
// StartScreen after the UX merge — this file is now just the in-room view.

import { useEffect, useRef, useState } from 'react';
import { wsUrl } from './config';
import { useNetworkGame } from './net/useNetworkGame';
import { getCurrentValidMoves } from './game/logic';
import { PLAYERS, TURN_TIME } from './game/constants';
import Lobby from './components/Lobby';
import PlayerPanel from './components/PlayerPanel';
import TurnIndicator from './components/TurnIndicator';
import GameBoard from './components/GameBoard';
import GameOverScreen from './components/GameOverScreen';

export default function OnlineGameController({
  code,
  displayName,
  initialMagicItems = false,
  onExit,
}) {
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

  // Host-local magic-items choice. Seeded from StartScreen. Post-START the
  // server broadcasts the authoritative value inside gameState.magicItems.
  const [magicItems, setMagicItems] = useState(initialMagicItems);

  // Send HELLO exactly once when the socket first becomes OPEN.
  const helloSent = useRef(false);
  useEffect(() => {
    if (connectionState === 'open' && !helloSent.current) {
      helloSent.current = true;
      join(displayName);
    }
  }, [connectionState, displayName, join]);

  // ---------- Status screens ----------

  if (connectionState === 'connecting' || !helloSent.current) {
    return <StatusScreen label={`Connecting to room ${code}…`} onBack={onExit} />;
  }

  if (lastError) {
    return (
      <StatusScreen
        label={`Error: ${lastError.code}${lastError.message ? ` — ${lastError.message}` : ''}`}
        onBack={onExit}
      />
    );
  }

  if (connectionState === 'closed' || connectionState === 'destroyed') {
    return <StatusScreen label="Connection lost. Reconnecting…" onBack={onExit} />;
  }

  if (!lobby) {
    return <StatusScreen label={`Joining room ${code}…`} onBack={onExit} />;
  }

  // ---------- Game phases ----------

  if (gameState && gameState.phase === 'playing') {
    const currentSeat = gameState.currentPlayerIndex;
    const myTurn = mySeatId !== null && currentSeat === mySeatId;
    const currentIsBot = gameState.players[currentSeat]?.isBot === true;

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
              player={{
                ...PLAYERS[currentSeat],
                name: gameState.players[currentSeat]?.displayName ?? PLAYERS[currentSeat].name,
              }}
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
            <button className="exit-game-btn" onClick={onExit}>
              ← Exit to menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState && gameState.phase === 'gameover') {
    const winnerPlayer =
      gameState.winner !== null ? PLAYERS[gameState.winner] : null;
    return (
      <GameOverScreen
        winner={winnerPlayer}
        players={gameState.players}
        onRestart={null /* rematch is a future feature */}
        onMenu={onExit}
      />
    );
  }

  // Lobby phase (pre-START)
  return (
    <Lobby
      code={code}
      players={lobby.players}
      hostId={lobby.hostId}
      mySeatId={mySeatId}
      magicItems={magicItems}
      onToggleMagicItems={setMagicItems}
      onStart={() => start(magicItems)}
      onLeave={onExit}
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
