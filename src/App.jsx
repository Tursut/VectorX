import { useReducer, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { initGame, applyMove, getCurrentValidMoves, eliminateCurrentPlayer } from './game/logic';
import { getGremlinMove } from './game/ai';
import { PLAYERS, TURN_TAUNTS, TURN_TIME, GRID_SIZE } from './game/constants';
import StartScreen from './components/StartScreen';
import GameBoard from './components/GameBoard';
import TurnIndicator from './components/TurnIndicator';
import PlayerPanel from './components/PlayerPanel';
import GameOverScreen from './components/GameOverScreen';
import EventToast from './components/EventToast';
import './App.css';

function gameReducer(state, action) {
  switch (action.type) {
    case 'START':
      return initGame(action.magicItems, action.gremlinCount ?? 0);
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
  const [eventToast, setEventToast] = useState(null);
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (!bombBlast) return;
    const t = setTimeout(() => setBombBlast(null), 700);
    return () => clearTimeout(t);
  }, [bombBlast]);

  // Boost toast — fires when bonusMoveActive turns true
  useEffect(() => {
    if (!gameState?.bonusMoveActive) return;
    const id = Date.now();
    setEventToast({ id, type: 'boost', player: PLAYERS[gameState.currentPlayerIndex] });
  }, [gameState?.bonusMoveActive]);

  // Freeze toast — fires when lastEvent becomes a freeze event
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev || ev.type !== 'freeze') return;
    const id = Date.now();
    setEventToast({
      id,
      type: 'freeze',
      by: PLAYERS[ev.byId],
      target: ev.targetId != null ? PLAYERS[ev.targetId] : null,
    });
  }, [gameState?.lastEvent]);

  // Dismiss toast after its display duration — decoupled from gameState changes
  useEffect(() => {
    if (!eventToast) return;
    const duration = eventToast.type === 'freeze' ? 2000 : 1400;
    const t = setTimeout(() => setEventToast(null), duration);
    return () => clearTimeout(t);
  }, [eventToast?.id]);

  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const playerIndex = gameState.currentPlayerIndex;
    setTimeLeft(TURN_TIME);

    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(interval);
          dispatch({ type: 'TIMEOUT', playerIndex });
          return TURN_TIME;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [gameState?.currentPlayerIndex, gameState?.phase, gameState?.bonusMoveActive, gameState?.portalActive]);

  // Gremlin auto-move
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const gc = gameState.gremlinCount ?? 0;
    if (gc === 0) return;
    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;
    if (currentPlayerId < PLAYERS.length - gc) return; // human turn

    setIsThinking(true);
    const humanCount = PLAYERS.length - gc;
    const anyHumanAlive = gameState.players.some(p => !p.isEliminated && p.id < humanCount);
    const delay = anyHumanAlive ? 800 + Math.random() * 600 : 120 + Math.random() * 80;
    const t = setTimeout(() => {
      setIsThinking(false);
      const move = getGremlinMove(gameState);
      if (move) {
        handleMove(move.row, move.col);
      } else {
        dispatch({ type: 'TIMEOUT', playerIndex: gameState.currentPlayerIndex });
      }
    }, delay);
    return () => { clearTimeout(t); setIsThinking(false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.currentPlayerIndex, gameState?.phase, gameState?.bonusMoveActive, gameState?.portalActive]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown < 0) {
      setCountdown(null);
      dispatch({ type: 'START', magicItems, gremlinCount });
      setScreen('game');
      return;
    }
    const delays = { 3: 850, 2: 1200, 1: 1200, 0: 2400 };
    const t = setTimeout(() => setCountdown((c) => c - 1), delays[countdown] ?? 850);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  function handleStart() {
    setCountdown(3);
  }

  function handleRestart() {
    dispatch({ type: 'START', magicItems, gremlinCount });
    // stay on 'game' screen — AnimatePresence handles gameover→game transition
  }

  function handleBackToStart() {
    setScreen('start');
  }

  function handleMove(row, col) {
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
      }
    }
    dispatch({ type: 'MOVE', row, col });
  }

  const validMoves = gameState ? getCurrentValidMoves(gameState) : [];
  const validMoveSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));

  const currentTaunt =
    gameState
      ? TURN_TAUNTS[gameState.turnCount % TURN_TAUNTS.length](
          PLAYERS[gameState.currentPlayerIndex].shortName
        )
      : '';

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
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                {countdown === 0 ? 'MAY THE BEST MOVER WIN.' : countdown}
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
              magicItems={magicItems}
              onToggleMagicItems={() => setMagicItems((v) => !v)}
              gremlinCount={gremlinCount}
              onChangeGremlinCount={setGremlinCount}
            />
          </motion.div>
        )}

        {screen === 'game' && gameState?.phase === 'playing' && (
          <motion.div
            key="playing"
            className="game-layout"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            <TurnIndicator
              player={PLAYERS[gameState.currentPlayerIndex]}
              taunt={currentTaunt}
              timeLeft={timeLeft}
              totalTime={TURN_TIME}
              bonusMoveActive={gameState.bonusMoveActive}
              portalActive={gameState.portalActive}
              lastEvent={gameState.lastEvent}
              isGremlin={gameState.players[gameState.currentPlayerIndex].id >= PLAYERS.length - (gameState.gremlinCount ?? 0)}
              isThinking={isThinking}
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
                bombBlast={bombBlast}
              />
            </div>
          </motion.div>
        )}

        {screen === 'game' && gameState?.phase === 'gameover' && (
          <motion.div key="gameover" style={{ width: '100%' }} {...fadeSlide}>
            <GameOverScreen
              winner={gameState.winner !== null ? PLAYERS[gameState.winner] : null}
              players={gameState.players}
              onRestart={handleRestart}
              onMenu={handleBackToStart}
            />
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
