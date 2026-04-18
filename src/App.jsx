import { useReducer, useState } from 'react';
import { initGame, applyMove, getCurrentValidMoves } from './game/logic';
import { PLAYERS, TURN_TAUNTS } from './game/constants';
import StartScreen from './components/StartScreen';
import GameBoard from './components/GameBoard';
import TurnIndicator from './components/TurnIndicator';
import PlayerPanel from './components/PlayerPanel';
import GameOverScreen from './components/GameOverScreen';
import './App.css';

function gameReducer(state, action) {
  switch (action.type) {
    case 'START':
      return initGame();
    case 'MOVE':
      return applyMove(state, action.row, action.col);
    default:
      return state;
  }
}

export default function App() {
  const [screen, setScreen] = useState('start');
  const [gameState, dispatch] = useReducer(gameReducer, null);

  function handleStart() {
    dispatch({ type: 'START' });
    setScreen('game');
  }

  function handleRestart() {
    dispatch({ type: 'START' });
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
      {screen === 'start' && <StartScreen onStart={handleStart} />}

      {screen === 'game' && gameState && gameState.phase === 'playing' && (
        <div className="game-layout">
          <TurnIndicator
            player={PLAYERS[gameState.currentPlayerIndex]}
            taunt={currentTaunt}
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
