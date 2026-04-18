import { PLAYERS, GRID_SIZE } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex }) {
  const playerPositions = {};
  players.forEach((p) => {
    if (!p.isEliminated) {
      playerPositions[`${p.row},${p.col}`] = PLAYERS[p.id];
    }
  });

  const currentPlayer = players[currentPlayerIndex];

  return (
    <div className="board">
      {grid.map((row, ri) =>
        row.map((cell, ci) => {
          const key = `${ri},${ci}`;
          const playerHere = playerPositions[key] || null;
          const isCurrentPlayer =
            currentPlayer &&
            currentPlayer.row === ri &&
            currentPlayer.col === ci;

          return (
            <Cell
              key={key}
              row={ri}
              col={ci}
              cell={cell}
              isValidMove={validMoveSet.has(key)}
              isCurrentPlayer={isCurrentPlayer}
              playerHere={playerHere}
              onCellClick={onCellClick}
            />
          );
        })
      )}
    </div>
  );
}
