import { useReducer, useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { initGame, initSandboxGame, applyMove, getCurrentValidMoves, eliminateCurrentPlayer, placeSandboxItem } from './game/logic';
import { getGremlinMove } from './game/ai';
import { PLAYERS, TURN_TIME } from './game/constants';
import { useDerivedAnimations } from './game/useDerivedAnimations';
import { useTrapChain } from './game/useTrapChain';
import { useGameplaySounds } from './game/useGameplaySounds';
import { useBackGuard } from './useBackGuard';
import * as sounds from './game/sounds';
import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';
import GameBoard from './components/GameBoard';
import PlayerPanel from './components/PlayerPanel';
import GameOverScreen from './components/GameOverScreen';
import EventToast from './components/EventToast';
import SandboxPanel from './components/SandboxPanel';

function gameReducer(state, action) {
  switch (action.type) {
    case 'START':
      return initGame(action.magicItems, action.gremlinCount ?? 0);
    case 'SANDBOX_START':
      return initSandboxGame();
    case 'SANDBOX_GIVE_ITEM':
      return placeSandboxItem(state, action.itemType);
    case 'MOVE':
      return applyMove(state, action.row, action.col);
    case 'TIMEOUT':
      if (state.currentPlayerIndex !== action.playerIndex) return state;
      if (state.phase !== 'playing') return state;
      return eliminateCurrentPlayer(state);
    case 'RESET':
      return null;
    default:
      return state;
  }
}

const fadeSlide = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.22 },
};

// Seats this client controls in hotseat: every non-bot seat.
function humanSeats(gameState) {
  if (!gameState) return [];
  return gameState.players
    .map((p, i) => [p, i])
    .filter(([p]) => p.id < PLAYERS.length - (gameState.gremlinCount ?? 0))
    .map(([, i]) => i);
}

export default function LocalGameController({
  onCreateOnline,
  onJoinOnline,
  defaultMode,
  defaultCode,
  defaultDisplayName,
  onlineError,
  onlineErrorDebug,
} = {}) {
  const [screen, setScreen] = useState('start');
  const [magicItems, setMagicItems] = useState(true);
  const [gremlinCount, setGremlinCount] = useState(3);
  const [isThinking, setIsThinking] = useState(false);
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);
  const [eventToast, setEventToast] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [exitConfirm, setExitConfirm] = useState(false);

  // Animation overlays derived from gameState diffs (also fires item-pickup
  // sounds). Passed down to GameScreen / sandbox GameBoard.
  const { bombBlast, portalJump, swapFlash, flyingFreeze, roulettePlayerId, rouletteRevealing, pendingSwap, rouletteActor, rouletteActive } = useDerivedAnimations(gameState);

  // Trap / death animation chain (issue #36). Owns the elimination
  // sound + the queue that drains one death per ~3 s window so
  // back-to-back trappings each get their full beat.
  const { trappedPlayers, trapPlaying } = useTrapChain(gameState);

  // Dismiss toast after its display duration.
  useEffect(() => {
    if (!eventToast) return;
    const duration = eventToast.type === 'freeze' ? 2000 : 1400;
    const t = setTimeout(() => setEventToast(null), duration);
    return () => clearTimeout(t);
  }, [eventToast?.id]);

  // Turn timer — ticks on last 3s for human turns only; dispatches TIMEOUT at 0.
  // Paused during the freeze/swap roulette (issue #30) so the human isn't
  // burning their 10 s while the wheel rolls. Also paused while the trap
  // chain is still draining (issue #36) — the next turn shouldn't be
  // ticking down while we're showing the previous death's animation.
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (gameState.sandboxMode) return;
    if (exitConfirm) return;
    if (rouletteActive) return;
    if (trapPlaying) return;
    const playerIndex = gameState.currentPlayerIndex;
    const gc = gameState.gremlinCount ?? 0;
    const isHuman = gameState.players[playerIndex].id < PLAYERS.length - gc;
    setTimeLeft(TURN_TIME);

    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (isHuman && t <= 3 && t > 1) sounds.playTick((4 - t) / 3);
        if (t <= 1) {
          clearInterval(interval);
          dispatch({ type: 'TIMEOUT', playerIndex });
          return TURN_TIME;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState?.currentPlayerIndex, gameState?.phase, gameState?.portalActive, gameState?.freezeSelectActive, rouletteActive, trapPlaying, exitConfirm]);

  // Gremlin auto-move.
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (exitConfirm) return;
    // Hold the next bot's turn while the freeze/swap roulette is still
    // rolling (issue #30) or the trap-chain queue is still draining
    // (issue #36). Adding both flags to the deps means this effect
    // re-runs the moment they flip false and schedules the pending
    // bot's thinking delay (or 80 ms fast-elim) then.
    if (rouletteActive) return;
    if (trapPlaying) return;
    const gc = gameState.gremlinCount ?? 0;
    if (gc === 0) return;
    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    if (currentPlayerId < PLAYERS.length - gc) return; // human turn

    // Trapped bot: skip the fake-thinking delay and eliminate on the next paint.
    if (getCurrentValidMoves(gameState).length === 0) {
      const t = setTimeout(() => {
        dispatch({ type: 'TIMEOUT', playerIndex: gameState.currentPlayerIndex });
      }, 80);
      return () => clearTimeout(t);
    }

    const rafId = requestAnimationFrame(() => setIsThinking(true));
    const humanCount = PLAYERS.length - gc;
    const anyHumanAlive = gameState.players.some(p => !p.isEliminated && p.id < humanCount);
    const delay = gameState.sandboxMode
      ? 700 + Math.random() * 200
      : anyHumanAlive ? 1600 + Math.random() * 600 : 120 + Math.random() * 80;
    const t = setTimeout(() => {
      setIsThinking(false);
      const move = getGremlinMove(gameState, 1);
      if (move) {
        handleMove(move.row, move.col);
      } else {
        dispatch({ type: 'TIMEOUT', playerIndex: gameState.currentPlayerIndex });
      }
    }, delay);
    return () => { cancelAnimationFrame(rafId); clearTimeout(t); setIsThinking(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.currentPlayerIndex, gameState?.turnCount, gameState?.phase, gameState?.portalActive, gameState?.swapActive, gameState?.freezeSelectActive, rouletteActive, trapPlaying, exitConfirm]);

  // Countdown sounds + logic.
  const cdSoundRef = useRef(null);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown < 0) {
      setCountdown(null);
      dispatch({ type: 'START', magicItems, gremlinCount });
      setScreen('game');
      return;
    }
    cdSoundRef.current = setTimeout(() => {
      if (countdown === 0) sounds.playCountdownGo();
      else sounds.playCountdownBeat();
    }, 200);
    const delays = { 3: 1200, 2: 1200, 1: 1200, 0: 2400 };
    const t = setTimeout(() => setCountdown((c) => c - 1), delays[countdown] ?? 850);
    return () => { clearTimeout(t); clearTimeout(cdSoundRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function handleStart() {
    sounds.resumeAudio();
    setCountdown(3);
  }

  function handleSandboxStart() {
    dispatch({ type: 'SANDBOX_START' });
    setScreen('sandbox');
  }

  function handleSandboxReset() {
    dispatch({ type: 'SANDBOX_START' });
    setEventToast(null);
  }

  function handleRestart() {
    setCountdown(3);
  }

  function handleBackToStart() {
    setExitConfirm(false);
    setScreen('start');
    dispatch({ type: 'RESET' });
  }

  function handleMove(row, col) {
    dispatch({ type: 'MOVE', row, col });
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sounds.setMuted(!next);
  }

  const mySeats = humanSeats(gameState);

  // Browser back-button guard (issue #29). Mid-game in-progress play
  // routes through the same exit-confirm modal the in-app "Exit to
  // menu" button uses. Sandbox routes straight back to the start
  // screen (no confirm — sandbox is throwaway tooling). Start screen
  // is unguarded so back leaves the SPA naturally. Gameover is also
  // unguarded — the result is final, no state to lose.
  const backGuardActive =
    (screen === 'game' && gameState?.phase === 'playing') ||
    screen === 'sandbox';
  useBackGuard(backGuardActive, () => {
    if (screen === 'game') {
      setExitConfirm(true);
    } else if (screen === 'sandbox') {
      setScreen('start');
      dispatch({ type: 'RESET' });
    }
  });

  // Gameplay sound effects — called at controller level so sandbox mode (which
  // doesn't mount GameScreen) gets bg theme, move/claim, your-turn chime, and
  // freeze/swap event sounds.
  useGameplaySounds(gameState, mySeats, { enabled: countdown === null });

  // Sandbox uses its own layout (SandboxPanel sidebar), not GameScreen.
  const sandboxIsGremlinTurn = gameState?.sandboxMode
    ? gameState.players[gameState.currentPlayerIndex].id >= PLAYERS.length - (gameState.gremlinCount ?? 0)
    : false;
  const sandboxValidMoves = gameState?.sandboxMode && !sandboxIsGremlinTurn && !rouletteActive ? getCurrentValidMoves(gameState) : [];
  const sandboxValidMoveSet = new Set(sandboxValidMoves.map((m) => `${m.row},${m.col}`));

  return (
    <div className="app">
      <AnimatePresence>
        {eventToast && <EventToast key={eventToast.id} toast={eventToast} />}
      </AnimatePresence>
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
      <AnimatePresence mode="wait">

        {screen === 'start' && (
          <motion.div key="start" style={{ width: '100%' }} {...fadeSlide}>
            <StartScreen
              onStart={handleStart}
              onSandbox={handleSandboxStart}
              magicItems={magicItems}
              onToggleMagicItems={() => setMagicItems((v) => !v)}
              gremlinCount={gremlinCount}
              onChangeGremlinCount={setGremlinCount}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
              onCreateOnline={onCreateOnline}
              onJoinOnline={onJoinOnline}
              defaultMode={defaultMode}
              defaultCode={defaultCode}
              defaultDisplayName={defaultDisplayName}
              onlineError={onlineError}
              onlineErrorDebug={onlineErrorDebug}
            />
          </motion.div>
        )}

        {screen === 'game' && gameState && (
          <motion.div key="game" style={{ width: '100%' }} {...fadeSlide}>
            <GameScreen
              gameState={gameState}
              mySeats={mySeats}
              onMove={handleMove}
              onExit={gameState?.phase === 'gameover' ? handleBackToStart : () => setExitConfirm(true)}
              onRestart={handleRestart}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
              isThinking={isThinking}
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
            />
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
                    <p className="exit-confirm-sub">Your current game will be lost.</p>
                    <div className="exit-confirm-btns">
                      <button className="exit-confirm-yes" onClick={handleBackToStart}>Yes, exit</button>
                      <button className="exit-confirm-no" onClick={() => setExitConfirm(false)}>Keep playing</button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {screen === 'sandbox' && gameState?.phase === 'playing' && (
          <motion.div
            key="sandbox"
            className="game-layout"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            <SandboxPanel
              currentPlayer={PLAYERS[gameState.players[gameState.currentPlayerIndex].id]}
              isThinking={isThinking}
              portalActive={gameState.portalActive}
              swapActive={gameState.swapActive}
              onPlaceItem={(type) => dispatch({ type: 'SANDBOX_GIVE_ITEM', itemType: type })}
              onReset={handleSandboxReset}
              onExit={() => { setScreen('start'); dispatch({ type: 'RESET' }); }}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
            />
            <div className="game-center">
              <PlayerPanel
                players={gameState.players}
                currentPlayerIndex={gameState.currentPlayerIndex}
                gremlinCount={gameState.gremlinCount ?? 0}
                frozenPlayerId={gameState?.frozenPlayerId ?? null}
                frozenTurnsLeft={gameState?.frozenTurnsLeft ?? 0}
              />
              <GameBoard
                grid={gameState.grid}
                players={gameState.players}
                validMoveSet={sandboxValidMoveSet}
                onCellClick={handleMove}
                currentPlayerIndex={gameState.currentPlayerIndex}
                items={gameState.items}
                portalActive={gameState.portalActive}
                swapActive={gameState.swapActive}
                freezeSelectActive={gameState.freezeSelectActive}
                isGremlinTurn={sandboxIsGremlinTurn}
                bombBlast={bombBlast}
                portalJump={portalJump}
                swapFlash={swapFlash}
                flyingFreeze={flyingFreeze}
                roulettePlayerId={roulettePlayerId}
                rouletteRevealing={rouletteRevealing}
                pendingSwap={pendingSwap}
                rouletteActor={rouletteActor}
                trappedPlayers={trappedPlayers}
                frozenPlayerId={gameState?.frozenPlayerId ?? null}
                frozenTurnsLeft={gameState?.frozenTurnsLeft ?? 0}
              />
            </div>
          </motion.div>
        )}

        {screen === 'sandbox' && gameState?.phase === 'gameover' && (
          <motion.div key="sandbox-over" style={{ width: '100%' }} {...fadeSlide}>
            <GameOverScreen
              winner={gameState.winner !== null ? PLAYERS[gameState.winner] : null}
              players={gameState.players}
              onRestart={handleSandboxReset}
              onMenu={() => setScreen('start')}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
