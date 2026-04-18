import { useReducer, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { initGame, applyMove, getCurrentValidMoves, eliminateCurrentPlayer } from './game/logic';
import { PLAYERS, TURN_TAUNTS, TURN_TIME } from './game/constants';
import StartScreen from './components/StartScreen';
import GameBoard from './components/GameBoard';
import TurnIndicator from './components/TurnIndicator';
import PlayerPanel from './components/PlayerPanel';
import GameOverScreen from './components/GameOverScreen';
import './App.css';

function gameReducer(state, action) {
  switch (action.type) {
    case 'START':
      return initGame(action.magicItems);
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
  const [magicItems, setMagicItems] = useState(false);
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);

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

  function handleStart() {
    dispatch({ type: 'START', magicItems });
    setScreen('game');
  }

  function handleRestart() {
    dispatch({ type: 'START', magicItems });
    // stay on 'game' screen — AnimatePresence handles gameover→game transition
  }

  function handleBackToStart() {
    setScreen('start');
  }

  function handleMove(row, col) {
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
      <AnimatePresence mode="wait">

        {screen === 'start' && (
          <motion.div key="start" style={{ width: '100%' }} {...fadeSlide}>
            <StartScreen
              onStart={handleStart}
              magicItems={magicItems}
              onToggleMagicItems={() => setMagicItems((v) => !v)}
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
            />
            <div className="game-center">
              <PlayerPanel
                players={gameState.players}
                currentPlayerIndex={gameState.currentPlayerIndex}
              />
              <GameBoard
                grid={gameState.grid}
                players={gameState.players}
                validMoveSet={validMoveSet}
                onCellClick={handleMove}
                currentPlayerIndex={gameState.currentPlayerIndex}
                items={gameState.items}
                portalActive={gameState.portalActive}
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
