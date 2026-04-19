
import { PLAYERS } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex, items, portalActive, swapActive, bombBlast, portalJump, swapFlash }) {
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
  const playerColor = PLAYERS[currentPlayerIndex].color;

  const bombOriginKey = bombBlast ? `${bombBlast.origin.row},${bombBlast.origin.col}` : null;
  const bombClearedSet = bombBlast ? new Set(bombBlast.cleared.map(c => `${c.row},${c.col}`)) : null;
  const portalFromKey = portalJump ? `${portalJump.from.row},${portalJump.from.col}` : null;
  const portalToKey   = portalJump ? `${portalJump.to.row},${portalJump.to.col}`   : null;
  const swapFlashSet  = swapFlash
    ? new Set([`${swapFlash.pos1.row},${swapFlash.pos1.col}`, `${swapFlash.pos2.row},${swapFlash.pos2.col}`])
    : null;

  return (
    <div className="board" style={{ '--player-color': playerColor }}>
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
              swapActive={swapActive}
              playerColor={playerColor}
              onCellClick={onCellClick}
              isBombOrigin={bombOriginKey === key}
              isBombCleared={bombClearedSet ? bombClearedSet.has(key) : false}
              isPortalOrigin={portalFromKey === key}
              isPortalDest={portalToKey === key}
              isSwapFlash={swapFlashSet ? swapFlashSet.has(key) : false}
            />
          );
        })
      )}
    </div>
  );
}
