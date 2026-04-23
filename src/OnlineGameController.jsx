// Online multiplayer game renderer.
//
// Receives an already-established room (`code`) + the joining user's chosen
// identity (`displayName` + `initialMagicItems`) from the parent (App.jsx).
// Owns the WebSocket lifetime via useNetworkGame. Routes on connection state
// + game phase:
//
//   connecting / waiting for HELLO → StatusScreen
//   lobby phase (no GAME_STATE yet) → Lobby
//   playing / gameover              → <GameScreen>
//
// All in-game rendering + sound/animation lives in <GameScreen>, shared with
// LocalGameController. This component only owns the socket + lobby shell.

import { useEffect, useRef, useState } from 'react';
import { wsUrl } from './config';
import { useNetworkGame } from './net/useNetworkGame';
import * as sounds from './game/sounds';
import Lobby from './components/Lobby';
import GameScreen from './components/GameScreen';

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

  // ---------- In-game ----------

  if (gameState && (gameState.phase === 'playing' || gameState.phase === 'gameover')) {
    const mySeats = mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [];
    return (
      <div className="online-game-layout">
        <GameScreen
          gameState={gameState}
          mySeats={mySeats}
          onMove={move}
          onExit={onExit}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
        />
      </div>
    );
  }

  // ---------- Lobby (pre-START) ----------

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
