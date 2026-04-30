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
import { TURN_TIME } from './game/constants';
import { useNetworkGame } from './net/useNetworkGame';
import { useDerivedAnimations } from './game/useDerivedAnimations';
import { useTrapChain } from './game/useTrapChain';
import { useWinnerHero } from './game/useWinnerHero';
import { useGameplaySounds } from './game/useGameplaySounds';
import { useBackGuard } from './useBackGuard';
import * as sounds from './game/sounds';
import { useBgHidden } from './game/useBgHidden';
import Lobby from './components/Lobby';
import GameScreen from './components/GameScreen';
import AudioDebugOverlay from './components/AudioDebugOverlay';

// Server-side ERROR codes that mean "user got something wrong on the start
// screen" — App.jsx routes these back to the join form with the inputs
// preserved instead of us showing a full-screen error panel here.
const ROUTABLE_JOIN_ERROR_CODES = new Set([
  'DUPLICATE_NAME',
  'ROOM_FULL',
  'ALREADY_STARTED',
]);

export default function OnlineGameController({
  code,
  displayName,
  initialMagicItems = false,
  onExit,
  onJoinFailed,
  audioDebugEnabled = false,
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
    restartRoom,
    move,
    clearError,
  } = useNetworkGame({ url });

  // setter isn't wired up yet — the host's magic-toggle UI in the lobby would
  // own it; for now we just lock the value from the prop at mount.
  const [magicItems] = useState(initialMagicItems);
  const [soundEnabled, setSoundEnabled] = useState(() => !sounds.loadMutedPreference());
  const [exitConfirm, setExitConfirm] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);
  const [showLobbyFromGameOver, setShowLobbyFromGameOver] = useState(false);

  // Pre-game 3-2-1-GO countdown (issue #26). Starts the moment we
  // observe the first GAME_STATE with phase==='playing'; runs purely
  // client-side, same timing + sounds as LocalGameController so both
  // clients render the same beats on top of an otherwise-already-live
  // server. The bot's first-turn delay (~1 s) and the human turn timer
  // (10 s) start ticking on the server immediately, but the visual
  // overlay still serves the request: a clear "the game is about to
  // start" signal so the user is ready to look at the board.
  const [countdown, setCountdown] = useState(null);
  const countdownShownRef = useRef(false);
  const cdSoundTimerRef = useRef(null);

  // Debug panel context. Tracked via refs so writing them doesn't trigger
  // re-renders. Surfaced on any fatal-error StatusScreen so we can see why
  // a real-world reconnect bounce happened. NOT shown for clean
  // "Connecting…" or "Reconnecting…" overlays.
  const mountAtRef = useRef(Date.now());
  const stateHistoryRef = useRef(/** @type {string[]} */([]));
  useEffect(() => {
    if (!connectionState) return;
    const now = Date.now();
    const stamp = ((now - mountAtRef.current) / 1000).toFixed(1);
    stateHistoryRef.current.push(`+${stamp}s ${connectionState}`);
    if (stateHistoryRef.current.length > 8) stateHistoryRef.current.shift();
  }, [connectionState]);

  // Derived animation overlays + item-pickup sounds; fed to GameScreen.
  const { bombBlast, portalJump, swapFlash, flyingFreeze, roulettePlayerId, rouletteRevealing, pendingSwap, rouletteActor, rouletteActive } = useDerivedAnimations(gameState);

  // Trap / death chain (issue #36) — owns the elimination sound + the
  // queue that drains one death per ~3 s window. Reaches GameScreen
  // via props; the local turn timer pauses on `trapPlaying` so the
  // human's clock doesn't tick while the previous death is winding
  // down.
  const { trappedPlayers, trapPlaying } = useTrapChain(gameState);

  // Winner hero phase (#60). See LocalGameController for rationale.
  const { heroPlaying, dismissHero } = useWinnerHero(gameState, trapPlaying);

  // Turn-timer visualization. The server is authoritative — it schedules the
  // real alarm and forfeits the seat on expiry — we just drive the indicator
  // bar with a client-local tick so the player can see time running down.
  // Mirrors LocalGameController's pattern; no TIMEOUT dispatch since the
  // server owns that. Tick sound plays only on my own turn's last 3 seconds.
  // Held while the pre-game countdown is up (issue #35) so the timer
  // bar doesn't drain under the GO overlay; the server's first-turn
  // alarm is bumped by COUNTDOWN_DELAY_MS to match.
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (countdown !== null) return;
    if (trapPlaying) return;
    setTimeLeft(TURN_TIME);
    const isMyTurn = mySeatId !== null && mySeatId !== undefined
      && gameState.currentPlayerIndex === mySeatId;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (isMyTurn && t <= 3 && t > 1) sounds.playTick((4 - t) / 3);
        if (t <= 1) {
          clearInterval(interval);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState?.currentPlayerIndex, gameState?.phase, mySeatId, countdown, trapPlaying]);

  // Gameplay sound effects (bg theme, move/claim/your-turn chime, freeze/swap).
  // `enabled` is gated on the countdown so the bg theme + your-turn
  // chime hold until the GO overlay clears (issue #35).
  useGameplaySounds(
    gameState,
    mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [],
    { enabled: countdown === null, trapPlaying, heroPlaying },
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

  // If the server rejects HELLO with a routable code (DUPLICATE_NAME et al.),
  // bounce up to App.jsx so it can re-render the start screen with the user's
  // inputs preserved. Once-only via the ref guard so a re-render doesn't
  // cause a second handleJoinFailed call.
  const joinFailedFired = useRef(false);
  useEffect(() => {
    if (joinFailedFired.current) return;
    if (!lastError || !ROUTABLE_JOIN_ERROR_CODES.has(lastError.code)) return;
    if (typeof onJoinFailed !== 'function') return;
    joinFailedFired.current = true;
    onJoinFailed(lastError);
  }, [lastError, onJoinFailed]);

  // Lobby-phase UNAUTHORIZED is recoverable: the user tapped START during a
  // reconnect race and the server rejected because their socket arrived
  // pre-HELLO, OR they lost host status mid-grace-expiry and the queued
  // START found them as a non-host on the new seat. Either way, the right
  // recovery is to drop the error and stay in the lobby — the next
  // LOBBY_STATE will repaint with the correct host + seat assignment.
  // Once gameState exists (game has actually started), UNAUTHORIZED is a
  // real "your session ended" signal and stays fatal.
  useEffect(() => {
    if (!lastError || lastError.code !== 'UNAUTHORIZED') return;
    if (gameState) return;
    console.warn('[OnlineGameController] recovering from lobby-phase UNAUTHORIZED');
    clearError();
  }, [lastError, gameState, clearError]);

  // Trigger the pre-game countdown the first time GAME_STATE arrives
  // with phase==='playing'. The ref guard means a reconnect mid-game
  // (which also delivers a fresh GAME_STATE) won't re-show the
  // countdown. turnCount===0 is a belt-and-braces second check —
  // mid-game reconnects always have turnCount > 0 by the time the
  // server's first turn alarm has fired.
  useEffect(() => {
    if (countdownShownRef.current) return;
    if (!gameState || gameState.phase !== 'playing') return;
    if ((gameState.turnCount ?? 0) > 0) {
      // We joined / reconnected after the first turn already started —
      // skip the countdown but mark it shown so a later state update
      // doesn't re-fire it either.
      countdownShownRef.current = true;
      return;
    }
    countdownShownRef.current = true;
    setCountdown(3);
  }, [gameState?.phase, gameState?.turnCount]);

  useEffect(() => {
    if (gameState?.phase === 'playing') {
      setShowLobbyFromGameOver(false);
    }
  }, [gameState?.phase]);

  // Drives the 3 → 2 → 1 → GO → null transition + click/go sounds.
  // Same timing as LocalGameController so the cadence is identical.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown < 0) {
      setCountdown(null);
      return;
    }
    cdSoundTimerRef.current = setTimeout(() => {
      if (countdown === 0) sounds.playCountdownGo();
      else sounds.playCountdownBeat();
    }, 200);
    const delays = { 3: 1200, 2: 1200, 1: 1200, 0: 2400 };
    const t = setTimeout(() => setCountdown((c) => c - 1), delays[countdown] ?? 850);
    return () => { clearTimeout(t); clearTimeout(cdSoundTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sounds.setMuted(!next);
  }

  // Browser back-button guard (issue #29). Active iff we're rendering
  // the lobby or an active game — NOT any of the StatusScreen variants
  // (connect / closed / fatal / joining) where back should leave
  // naturally, and NOT gameover where the result is final.
  const guardActive =
    connectionState === 'open' &&
    helloSent.current &&
    !lastError &&
    lobby !== null &&
    (!gameState || gameState.phase === 'playing');
  useBackGuard(guardActive, () => setExitConfirm(true));

  // Hide the App-level MenuAvatarStage on screens that need full focus:
  //   - active game board (the bubbles would compete with the grid)
  //   - fatal error (we want the user to read the message)
  // Connecting / joining / reconnecting StatusScreens and the lobby keep the
  // bg visible — they're "waiting" surfaces and the drift signals "still
  // alive". Gameover keeps the bg too — GameScreen swaps to GameOverScreen
  // once `phase === 'gameover' && !trapPlaying`.
  const isFatalError =
    !!lastError &&
    !(ROUTABLE_JOIN_ERROR_CODES.has(lastError.code) && typeof onJoinFailed === 'function');
  const inActiveOnlineGame = !!lobby && !!gameState && (gameState.phase === 'playing' || trapPlaying);
  useBgHidden(isFatalError || inActiveOnlineGame);

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
    // Routable errors are being bounced upward via onJoinFailed (parent will
    // unmount us in the next render). Render nothing in the meantime so we
    // don't flash a full-screen error panel for one frame.
    if (ROUTABLE_JOIN_ERROR_CODES.has(lastError.code) && typeof onJoinFailed === 'function') {
      return null;
    }
    const debug = {
      code: lastError.code,
      message: lastError.message,
      room: code,
      displayName,
      mySeatId,
      stateHistory: stateHistoryRef.current.slice(),
      lifetimeSec: ((Date.now() - mountAtRef.current) / 1000).toFixed(1),
    };
    return (
      <StatusScreen
        label={fatalErrorLabel(lastError)}
        onBack={onExit}
        debug={debug}
      />
    );
  }

  if (!lobby) {
    return <StatusScreen label={`Joining room ${code}…`} onBack={onExit} />;
  }

  // Exit confirm gate. Skip on gameover — the game is already over, nothing
  // to warn about. Mirrors LocalGameController's pattern.
  const inGameover = gameState?.phase === 'gameover';
  const requestExit = inGameover ? onExit : () => setExitConfirm(true);

  const iAmHost = mySeatId !== null && mySeatId !== undefined && lobby?.hostId === mySeatId;
  const onlineGameOver = gameState?.phase === 'gameover';
  const roomRestarted = onlineGameOver && lobby?.phase === 'lobby';
  // Host auto-transitions to lobby once the server confirms the restart
  // (lobby.phase flips to 'lobby'). Joiners need an explicit "JOIN ROOM" click.
  const showLobbyNow = roomRestarted && (iAmHost || showLobbyFromGameOver);

  let restartLabel = 'PLAY AGAIN';
  let restartDisabled = false;
  let handleRestart = undefined;
  if (onlineGameOver) {
    if (iAmHost) {
      restartLabel = 'RESTART ROOM';
      restartDisabled = roomRestarted;
      handleRestart = () => {
        sounds.logAudioDebugEvent('gesture-online-restart');
        sounds.resumeAudio();
        restartRoom();
        setShowLobbyFromGameOver(true);
      };
    } else {
      restartLabel = roomRestarted ? 'JOIN ROOM' : 'WAITING FOR HOST';
      restartDisabled = !roomRestarted;
      handleRestart = roomRestarted ? () => setShowLobbyFromGameOver(true) : undefined;
    }
  }
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
              <button
                className="exit-confirm-yes"
                onClick={() => { sounds.playClick(); onExit(); }}
              >
                Yes, exit
              </button>
              <button
                className="exit-confirm-no"
                onClick={() => { sounds.playClick(); setExitConfirm(false); }}
              >
                Keep playing
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ---------- In-game ----------

  if (
    gameState &&
    gameState.phase === 'playing' &&
    !showLobbyNow
  ) {
    const mySeats = mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [];
    return (
      <div className="online-game-layout">
        <GameScreen
          gameState={gameState}
          mySeats={mySeats}
          onMove={move}
          onExit={requestExit}
          onRestart={handleRestart}
          restartLabel={restartLabel}
          restartDisabled={restartDisabled}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          timeLeft={timeLeft}
          totalTime={TURN_TIME}
          bombBlast={bombBlast}
          portalJump={portalJump}
          swapFlash={swapFlash}
          flyingFreeze={flyingFreeze}
          roulettePlayerId={roulettePlayerId}
          rouletteRevealing={rouletteRevealing}
          pendingSwap={pendingSwap}
          rouletteActor={rouletteActor}
          rouletteActive={rouletteActive}
          trappedPlayers={trappedPlayers}
          trapPlaying={trapPlaying}
          heroPlaying={heroPlaying}
          onHeroDismiss={dismissHero}
        />
        {exitConfirmModal}
        <AudioDebugOverlay enabled={audioDebugEnabled} />
        {/* Pre-game countdown — same overlay LocalGameController uses,
            same CSS classes, same beats (3 / 2 / 1 / GO message). */}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div
              key="countdown-overlay"
              className="countdown-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={countdown}
                  className={countdown === 0 ? 'countdown-message' : 'countdown-number'}
                  initial={{ scale: 1.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.18 } }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                >
                  {countdown === 0 ? 'MAY THE BEST STRATEGY WIN.' : countdown}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (gameState && gameState.phase === 'gameover' && !showLobbyNow) {
    const mySeats = mySeatId !== null && mySeatId !== undefined ? [mySeatId] : [];
    return (
      <div className="online-game-layout">
        <GameScreen
          gameState={gameState}
          mySeats={mySeats}
          onMove={move}
          onExit={requestExit}
          onRestart={handleRestart}
          restartLabel={restartLabel}
          restartDisabled={restartDisabled}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          timeLeft={timeLeft}
          totalTime={TURN_TIME}
          bombBlast={bombBlast}
          portalJump={portalJump}
          swapFlash={swapFlash}
          flyingFreeze={flyingFreeze}
          roulettePlayerId={roulettePlayerId}
          rouletteRevealing={rouletteRevealing}
          pendingSwap={pendingSwap}
          rouletteActor={rouletteActor}
          rouletteActive={rouletteActive}
          trappedPlayers={trappedPlayers}
          trapPlaying={trapPlaying}
          heroPlaying={heroPlaying}
          onHeroDismiss={dismissHero}
        />
        {exitConfirmModal}
        <AudioDebugOverlay enabled={audioDebugEnabled} />
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
        onStart={() => {
          sounds.logAudioDebugEvent('gesture-online-lobby-start');
          sounds.resumeAudio();
          start(magicItems);
        }}
        onLeave={() => setExitConfirm(true)}
      />
      {exitConfirmModal}
      <AudioDebugOverlay enabled={audioDebugEnabled} />
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
//
// `debug`, when present, renders a monospace context block under the label.
// Surfaced only on fatal-error landings (not on the routine "Connecting…"
// transitions) so we have something to inspect when a real-world reconnect
// is rejected. The server attaches a diagnostic `message` to ALREADY_STARTED
// (current lobby roster + per-player grace-age) — that, plus the client-
// side state-history log, should be enough to figure out why the server
// didn't accept the recovery.
function StatusScreen({ label, onBack, debug }) {
  return (
    <div className="online-status">
      <p>{label}</p>
      {debug && (
        <pre className="online-status-debug" aria-label="Debug context">
{`code:        ${debug.code}
message:     ${debug.message ?? '(none)'}
room:        ${debug.room}
displayName: ${debug.displayName}
mySeatId:    ${debug.mySeatId === null || debug.mySeatId === undefined ? '(none)' : debug.mySeatId}
lifetime:    ${debug.lifetimeSec}s
states:
  ${debug.stateHistory.length ? debug.stateHistory.join('\n  ') : '(empty)'}`}
        </pre>
      )}
      {onBack && (
        <button className="online-back-btn" onClick={onBack}>
          ← Back
        </button>
      )}
    </div>
  );
}
