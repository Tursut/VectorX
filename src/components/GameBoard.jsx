import { PLAYERS } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex, items, portalActive }) {
  const playerPositions = {};
  const deathCells = {};
  const itemMap = {};

  players.forEach((p) => {
    if (!p.isEliminated) {
      playerPositions[`${p.row},${p.col}`] = PLAYERS[p.id];
    } else if (p.deathCell) {
      deathCells[`${p.deathCell.row},${p.deathCell.col}`] = PLAYERS[p.id];
    }
  });

  (items || []).forEach((item) => {
    itemMap[`${item.row},${item.col}`] = item;
  });

  const currentPlayer = players[currentPlayerIndex];

  return (
    <div className="board">
      {grid.map((row, ri) =>
        row.map((cell, ci) => {
          const key = `${ri},${ci}`;
          return (
            <Cell
              key={key}
              row={ri}
              col={ci}
              cell={cell}
              isValidMove={validMoveSet.has(key)}
              isCurrentPlayer={currentPlayer && currentPlayer.row === ri && currentPlayer.col === ci}
              playerHere={playerPositions[key] || null}
              deathHere={deathCells[key] || null}
              itemHere={itemMap[key] || null}
              portalActive={portalActive}
              onCellClick={onCellClick}
            />
          );
        })
      )}
    </div>
  );
}
