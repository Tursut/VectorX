import { useReducer, useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { initGame, initSandboxGame, applyMove, getCurrentValidMoves, eliminateCurrentPlayer, placeSandboxItem, getValidMoves } from './game/logic';
import { getGremlinMove } from './game/ai';
import { PLAYERS, TURN_TAUNTS, TURN_TIME, GRID_SIZE } from './game/constants';
import * as sounds from './game/sounds';
import StartScreen from './components/StartScreen';
import GameBoard from './components/GameBoard';
import TurnIndicator from './components/TurnIndicator';
import PlayerPanel from './components/PlayerPanel';
import GameOverScreen from './components/GameOverScreen';
import EventToast from './components/EventToast';
import SandboxPanel from './components/SandboxPanel';
import './App.css';

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

export default function App() {
  const [screen, setScreen] = useState('start');
  const [magicItems, setMagicItems] = useState(true);
  const [gremlinCount, setGremlinCount] = useState(3);
  const [isThinking, setIsThinking] = useState(false);
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);
  const [bombBlast, setBombBlast] = useState(null);
  const [portalJump, setPortalJump] = useState(null);
  const [swapFlash, setSwapFlash] = useState(null);
  const [eventToast, setEventToast] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [trappedPlayers, setTrappedPlayers] = useState([]);
  const [exitConfirm, setExitConfirm] = useState(false);
  const prevPlayersRef = useRef(null);
  const trappedTimerRef = useRef(null);

  // iOS audio recovery: resume context on any user interaction after backgrounding
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

  useEffect(() => {
    if (!bombBlast) return;
    const t = setTimeout(() => setBombBlast(null), 700);
    return () => clearTimeout(t);
  }, [bombBlast]);

  useEffect(() => {
    if (!portalJump) return;
    const t = setTimeout(() => setPortalJump(null), 800);
    return () => clearTimeout(t);
  }, [portalJump]);

  useEffect(() => {
    if (!swapFlash) return;
    const t = setTimeout(() => setSwapFlash(null), 800);
    return () => clearTimeout(t);
  }, [swapFlash]);

  // Freeze / swap toast + sound
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev) return;
    if (ev.type === 'freeze') {
      sounds.playFreeze();
      const gc = gameState.gremlinCount ?? 0;
      const humanAlive = gameState.players.some(p => !p.isEliminated && p.id < PLAYERS.length - gc);
      if (humanAlive) {
        setEventToast({
          id: Date.now(),
          type: 'freeze',
          by: PLAYERS[ev.byId],
          target: ev.targetId != null ? PLAYERS[ev.targetId] : null,
        });
      }
    } else if (ev.type === 'swap') {
      sounds.playSwap();
    }
  }, [gameState?.lastEvent]);

  // Dismiss toast after its display duration — decoupled from gameState changes
  useEffect(() => {
    if (!eventToast) return;
    const duration = eventToast.type === 'freeze' ? 2000 : 1400;
    const t = setTimeout(() => setEventToast(null), duration);
    return () => clearTimeout(t);
  }, [eventToast?.id]);

  // Timer — ticks on last 3s for human turns only
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (gameState.sandboxMode) return; // no timer in sandbox
    if (trappedPlayers.length > 0) return; // paused during trap animation
    if (exitConfirm) return; // paused during exit confirmation
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
  }, [gameState?.currentPlayerIndex, gameState?.phase, gameState?.portalActive, trappedPlayers, exitConfirm]);

  // Your-turn chime — plays when it becomes a human's turn
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (gameState.sandboxMode) return;
    const gc = gameState.gremlinCount ?? 0;
    const isHuman = gameState.players[gameState.currentPlayerIndex].id < PLAYERS.length - gc;
    if (isHuman) sounds.playYourTurn();
  }, [gameState?.currentPlayerIndex, gameState?.phase]);

  // Elimination animation + sound + moment — detects the false→true transition per player
  useEffect(() => {
    if (!gameState?.players) { prevPlayersRef.current = null; return; }
    if (prevPlayersRef.current) {
      const gc = gameState.gremlinCount ?? 0;
      const newlyTrapped = [];
      gameState.players.forEach((p, i) => {
        const prev = prevPlayersRef.current[i];
        if (prev && p.isEliminated && !prev.isEliminated) {
          const isHuman = p.id < PLAYERS.length - gc;
          const humanAlive = gameState.players.some(q => !q.isEliminated && q.id < PLAYERS.length - gc);
          if (isHuman || humanAlive) {
            newlyTrapped.push({ id: p.id, row: p.deathCell?.row ?? prev.row, col: p.deathCell?.col ?? prev.col });
          }
        }
      });
      if (newlyTrapped.length > 0) {
        clearTimeout(trappedTimerRef.current);
        trappedTimerRef.current = setTimeout(() => {
          setTrappedPlayers(newlyTrapped);
          sounds.playElimination();
          trappedTimerRef.current = setTimeout(() => {
            setTrappedPlayers([]);
          }, 2500);
        }, 450);
      }
    }
    prevPlayersRef.current = gameState.players;
  }, [gameState?.players]);

  // Background theme — starts with game, stops on game over
  useEffect(() => {
    if (gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
  }, [gameState?.phase]);

  // Game-over sound — waits for any death animation to finish first
  useEffect(() => {
    if (gameState?.phase !== 'gameover') return;
    if (trappedPlayers.length > 0) return;
    if (gameState.winner !== null) sounds.playWin();
    else sounds.playDraw();
  }, [gameState?.phase, trappedPlayers]);

  // Gremlin auto-move
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    if (trappedPlayers.length > 0) return; // pause bots during trap animation
    if (exitConfirm) return; // pause bots during exit confirmation
    const gc = gameState.gremlinCount ?? 0;
    if (gc === 0) return;
    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    if (currentPlayerId < PLAYERS.length - gc) return; // human turn

    // Defer setIsThinking so the browser paints first — this gives Framer Motion
    // time to snapshot layout positions before the re-render (fixes swap avatar bug)
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
  }, [gameState?.currentPlayerIndex, gameState?.turnCount, gameState?.phase, gameState?.portalActive, gameState?.swapActive, trappedPlayers, exitConfirm]);

  // Countdown sounds + logic
  const cdSoundRef = useRef(null);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown < 0) {
      setCountdown(null);
      dispatch({ type: 'START', magicItems, gremlinCount });
      setScreen('game');
      return;
    }
    // Delay sound ~200ms so it lands when the number peaks on screen
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
    setCountdown(3);
  }

  function handleSandboxStart() {
    dispatch({ type: 'SANDBOX_START' });
    setScreen('sandbox');
  }

  function handleSandboxReset() {
    dispatch({ type: 'SANDBOX_START' });
    setBombBlast(null);
    setPortalJump(null);
    setSwapFlash(null);
    setEventToast(null);
  }

  function handleRestart() {
    setCountdown(3);
  }

  function handleBackToStart() {
    setExitConfirm(false);
    setScreen('start');
  }

  function handleMove(row, col) {
    const gc = gameState?.gremlinCount ?? 0;
    const isBot = gameState?.players[gameState.currentPlayerIndex].id >= PLAYERS.length - gc;
    sounds.playMove(isBot);
    setTimeout(() => sounds.playClaim(), 200);

    if (gameState?.magicItems) {
      const item = gameState.items.find(i => i.row === row && i.col === col);
      if (item?.type === 'bomb') {
        const cleared = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = row + dr, nc = col + dc;
            if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
              cleared.push({ row: nr, col: nc });
            }
          }
        }
        setBombBlast({ origin: { row, col }, cleared });
        sounds.playBomb();
      } else if (item?.type === 'portal') {
        sounds.playPortal(); // item pickup
      } else if (item?.type === 'swap') {
        sounds.playSwapActivate();
      }
      // freeze → playFreeze() fires via lastEvent effect
    }

    if (gameState?.portalActive) {
      const p = gameState.players[gameState.currentPlayerIndex];
      setPortalJump({ from: { row: p.row, col: p.col }, to: { row, col } });
      sounds.playPortalJump();
    }

    if (gameState?.swapActive) {
      const p = gameState.players[gameState.currentPlayerIndex];
      setSwapFlash({ pos1: { row: p.row, col: p.col }, pos2: { row, col } });
    }

    dispatch({ type: 'MOVE', row, col });
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    sounds.setMuted(!next);
  }

  // Only show valid-move hints on human turns — bots don't need them and the
  // swap-target animation creates a stacking context that hides the icon layer.
  const isGremlinTurn = gameState
    ? gameState.players[gameState.currentPlayerIndex].id >= PLAYERS.length - (gameState.gremlinCount ?? 0)
    : false;
  const validMoves = gameState && !isGremlinTurn ? getCurrentValidMoves(gameState) : [];
  const validMoveSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));

  const currentTaunt =
    gameState
      ? TURN_TAUNTS[gameState.turnCount % TURN_TAUNTS.length](
          PLAYERS[gameState.currentPlayerIndex].shortName
        )
      : '';

  const gc = gameState?.gremlinCount ?? 0;
  const isHumanWin = gameState?.winner != null && gameState.winner < PLAYERS.length - gc;
  const winnerPlayer = (trappedPlayers.length > 0 && isHumanWin)
    ? gameState.players.find(p => p.id === gameState.winner)
    : null;

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
            />
          </motion.div>
        )}

        {screen === 'game' && (gameState?.phase === 'playing' || (gameState?.phase === 'gameover' && trappedPlayers.length > 0)) && (
          <motion.div
            key="playing"
            className="game-layout"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            <div className="game-center">
              <PlayerPanel
                players={gameState.players}
                currentPlayerIndex={gameState.currentPlayerIndex}
                gremlinCount={gameState.gremlinCount ?? 0}
              />
              <div className="board-column">
                <TurnIndicator
                  player={PLAYERS[gameState.currentPlayerIndex]}
                  taunt={currentTaunt}
                  timeLeft={timeLeft}
                  totalTime={TURN_TIME}
                  portalActive={gameState.portalActive}
                  swapActive={gameState.swapActive}
                  lastEvent={gameState.lastEvent}
                  isGremlin={gameState.players[gameState.currentPlayerIndex].id >= PLAYERS.length - (gameState.gremlinCount ?? 0)}
                  isThinking={isThinking}
                  soundEnabled={soundEnabled}
                  onToggleSound={toggleSound}
                />
                <GameBoard
                  grid={gameState.grid}
                  players={gameState.players}
                  validMoveSet={validMoveSet}
                  onCellClick={handleMove}
                  currentPlayerIndex={gameState.currentPlayerIndex}
                  items={gameState.items}
                  portalActive={gameState.portalActive}
                  swapActive={gameState.swapActive}
                  isGremlinTurn={isGremlinTurn}
                  bombBlast={bombBlast}
                  portalJump={portalJump}
                  swapFlash={swapFlash}
                  trappedPlayers={trappedPlayers}
                  winnerPlayer={winnerPlayer}
                />
                <button className="exit-game-btn" onClick={() => setExitConfirm(true)}>
                  ← Exit to menu
                </button>
              </div>
            </div>

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

        {screen === 'game' && gameState?.phase === 'gameover' && trappedPlayers.length === 0 && (
          <motion.div key="gameover" style={{ width: '100%' }} {...fadeSlide}>
            <GameOverScreen
              winner={gameState.winner !== null ? PLAYERS[gameState.winner] : null}
              players={gameState.players}
              onRestart={handleRestart}
              onMenu={handleBackToStart}
            />
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
              onExit={() => setScreen('start')}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
            />
            <div className="game-center">
              <PlayerPanel
                players={gameState.players}
                currentPlayerIndex={gameState.currentPlayerIndex}
                gremlinCount={gameState.gremlinCount ?? 0}
              />
              <GameBoard
                grid={gameState.grid}
                players={gameState.players}
                validMoveSet={validMoveSet}
                onCellClick={handleMove}
                currentPlayerIndex={gameState.currentPlayerIndex}
                items={gameState.items}
                portalActive={gameState.portalActive}
                swapActive={gameState.swapActive}
                isGremlinTurn={isGremlinTurn}
                bombBlast={bombBlast}
                portalJump={portalJump}
                swapFlash={swapFlash}
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
