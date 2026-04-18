import { useReducer, useState, useEffect } from 'react';
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

export default function App() {
  const [screen, setScreen] = useState('start');
  const [magicItems, setMagicItems] = useState(false);
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [timeLeft, setTimeLeft] = useState(TURN_TIME);

  // Reset timer on each new turn, and when bonus/portal activates
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
    setScreen('game');
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
      {screen === 'start' && (
        <StartScreen
          onStart={handleStart}
          magicItems={magicItems}
          onToggleMagicItems={() => setMagicItems((v) => !v)}
        />
      )}

      {screen === 'game' && gameState && gameState.phase === 'playing' && (
        <div className="game-layout">
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
        </div>
      )}

      {screen === 'game' && gameState && gameState.phase === 'gameover' && (
        <GameOverScreen
          winner={gameState.winner !== null ? PLAYERS[gameState.winner] : null}
          players={gameState.players}
          onRestart={handleRestart}
          onMenu={handleBackToStart}
        />
      )}
    </div>
  );
}
