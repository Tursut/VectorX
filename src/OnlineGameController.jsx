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
import * as sounds from './game/sounds';
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
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Send HELLO exactly once when the socket first becomes OPEN.
  const helloSent = useRef(false);
  useEffect(() => {
    if (connectionState === 'open' && !helloSent.current) {
      helloSent.current = true;
      join(displayName);
    }
  }, [connectionState, displayName, join]);

  // iOS audio recovery: resume context on any user interaction.
  useEffect(() => {
    const resume = () => sounds.resumeAudio();
    document.addEventListener('touchstart', resume, { passive: true });
    document.addEventListener('touchend',   resume, { passive: true });
    document.addEventListener('click',      resume);
    return () => {
      document.removeEventListener('touchstart', resume, { passive: true });
      document.removeEventListener('touchend',   resume, { passive: true });
      document.removeEventListener('click',      resume);
    };
  }, []);

  // Background theme — starts when game is playing, stops otherwise.
  useEffect(() => {
    if (gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
  }, [gameState?.phase]);

  // Freeze / swap sounds — fire whenever lastEvent changes to a new event.
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev) return;
    if (ev.type === 'freeze') sounds.playFreeze();
    else if (ev.type === 'swap') sounds.playSwap();
  }, [gameState?.lastEvent]);

  // Move + your-turn sounds — fire on each turn change.
  const prevTurnRef = useRef(null);
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const seat = gameState.currentPlayerIndex;
    if (prevTurnRef.current !== null && prevTurnRef.current !== seat) {
      const prevIsBot = gameState.players[prevTurnRef.current]?.isBot === true;
      sounds.playMove(prevIsBot);
      setTimeout(() => sounds.playClaim(), 200);
    }
    prevTurnRef.current = seat;
    if (mySeatId !== null && seat === mySeatId) sounds.playYourTurn();
  }, [gameState?.currentPlayerIndex, gameState?.phase, mySeatId]);

  // Elimination sound — fires when any player transitions to eliminated.
  const prevPlayersRef = useRef(null);
  useEffect(() => {
    if (!gameState?.players) { prevPlayersRef.current = null; return; }
    if (prevPlayersRef.current) {
      const newlyEliminated = gameState.players.some(
        (p, i) => p.isEliminated && !prevPlayersRef.current[i]?.isEliminated,
      );
      if (newlyEliminated) sounds.playElimination();
    }
    prevPlayersRef.current = gameState.players;
  }, [gameState?.players]);

  // Game-over sound.
  useEffect(() => {
    if (gameState?.phase !== 'gameover') return;
    if (gameState.winner !== null) sounds.playWin();
    else sounds.playDraw();
  }, [gameState?.phase]);

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sounds.setMuted(!next);
  }

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
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
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
