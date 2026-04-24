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
import { AnimatePresence, motion } from 'framer-motion';
import { wsUrl } from './config';
import { useNetworkGame } from './net/useNetworkGame';
import { useDerivedAnimations } from './game/useDerivedAnimations';
import { useGameplaySounds } from './game/useGameplaySounds';
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
  const [exitConfirm, setExitConfirm] = useState(false);

  // Derived animation overlays + item-pickup sounds; fed to GameScreen.
  const { bombBlast, portalJump, swapFlash, flyingFreeze } = useDerivedAnimations(gameState);

  // Gameplay sound effects (bg theme, move/claim/your-turn chime, freeze/swap).
  useGameplaySounds(
    gameState,
    mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [],
  );

  // Send HELLO on every transition INTO 'open'. The ref is reset on any other
  // state so auto-reconnects (wifi blip, mobile Safari tab-backgrounding) get
  // re-authenticated — the underlying WS is new, and the server gave the old
  // socket's seat up when it closed. Without this, the first MOVE after a
  // reconnect hits UNAUTHORIZED.
  const helloSent = useRef(false);
  useEffect(() => {
    if (connectionState !== 'open') {
      helloSent.current = false;
      return;
    }
    if (!helloSent.current) {
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
  // Priority: initial connect → reconnecting → fatal error → joining.
  // `lastError` comes AFTER the reconnect check so a stray non-transient error
  // during a reconnect doesn't hide the "Reconnecting…" status.

  if (connectionState === 'connecting' || !helloSent.current) {
    return <StatusScreen label={`Connecting to room ${code}…`} onBack={onExit} />;
  }

  if (connectionState === 'closed' || connectionState === 'destroyed') {
    return <StatusScreen label="Connection lost. Reconnecting…" onBack={onExit} />;
  }

  if (lastError) {
    return <StatusScreen label={fatalErrorLabel(lastError)} onBack={onExit} />;
  }

  if (!lobby) {
    return <StatusScreen label={`Joining room ${code}…`} onBack={onExit} />;
  }

  // Exit confirm gate. Skip on gameover — the game is already over, nothing
  // to warn about. Mirrors LocalGameController's pattern.
  const inGameover = gameState?.phase === 'gameover';
  const requestExit = inGameover ? onExit : () => setExitConfirm(true);
  const exitConfirmModal = (
    <AnimatePresence>
      {exitConfirm && (
        <motion.div
          className="exit-confirm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="exit-confirm-card"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 26 }}
          >
            <p className="exit-confirm-title">Exit to menu?</p>
            <p className="exit-confirm-sub">
              {gameState ? 'Your current game will be lost.' : "You'll leave this room."}
            </p>
            <div className="exit-confirm-btns">
              <button className="exit-confirm-yes" onClick={onExit}>Yes, exit</button>
              <button className="exit-confirm-no" onClick={() => setExitConfirm(false)}>Keep playing</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ---------- In-game ----------

  if (gameState && (gameState.phase === 'playing' || gameState.phase === 'gameover')) {
    const mySeats = mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [];
    return (
      <div className="online-game-layout">
        <GameScreen
          gameState={gameState}
          mySeats={mySeats}
          onMove={move}
          onExit={requestExit}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          bombBlast={bombBlast}
          portalJump={portalJump}
          swapFlash={swapFlash}
          flyingFreeze={flyingFreeze}
        />
        {exitConfirmModal}
      </div>
    );
  }

  // ---------- Lobby (pre-START) ----------

  return (
    <>
      <Lobby
        code={code}
        players={lobby.players}
        hostId={lobby.hostId}
        mySeatId={mySeatId}
        onStart={() => { sounds.resumeAudio(); start(magicItems); }}
        onLeave={() => setExitConfirm(true)}
      />
      {exitConfirmModal}
    </>
  );
}

// Map a server-side ERROR payload to a readable status line. Transient codes
// (NOT_YOUR_TURN, INVALID_MOVE) are filtered upstream in useNetworkGame and
// never reach this function.
function fatalErrorLabel({ code, message }) {
  switch (code) {
    case 'UNAUTHORIZED':     return 'Your session ended. Return to menu.';
    case 'ROOM_FULL':        return 'This room is full.';
    case 'DUPLICATE_NAME':   return 'That name is already taken in this room.';
    case 'ALREADY_STARTED':  return 'This game has already started.';
    case 'BAD_PAYLOAD':      return 'Unexpected message from the server.';
    default:                 return `Error: ${code}${message ? ` — ${message}` : ''}`;
  }
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
