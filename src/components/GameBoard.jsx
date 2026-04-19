import { motion, AnimatePresence } from 'framer-motion';
import { PLAYERS } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex, items, portalActive, swapActive, isGremlinTurn, bombBlast, portalJump, swapFlash, trappedPlayers = [] }) {
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
  const playerColor = PLAYERS[players[currentPlayerIndex].id].color;

  const bombOriginKey = bombBlast ? `${bombBlast.origin.row},${bombBlast.origin.col}` : null;
  const bombClearedSet = bombBlast ? new Set(bombBlast.cleared.map(c => `${c.row},${c.col}`)) : null;
  const portalFromKey = portalJump ? `${portalJump.from.row},${portalJump.from.col}` : null;
  const portalToKey   = portalJump ? `${portalJump.to.row},${portalJump.to.col}`   : null;
  const swapFlashSet  = swapFlash
    ? new Set([`${swapFlash.pos1.row},${swapFlash.pos1.col}`, `${swapFlash.pos2.row},${swapFlash.pos2.col}`])
    : null;

  return (
    <div className="board" style={{ '--player-color': playerColor, position: 'relative' }}>
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
              isBotTurn={isGremlinTurn && currentPlayer && currentPlayer.row === ri && currentPlayer.col === ci}
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
              isTrapped={trappedPlayers.some(tp => tp.row === ri && tp.col === ci)}
            />
          );
        })
      )}

      {/* ── Trapped-player dying animation layer ── */}
      {trappedPlayers.map(tp => (
        <motion.div
          key={`trapped-${tp.id}`}
          style={{
            position: 'absolute',
            left: `calc(4px + ${tp.col} * (var(--cell-size) + var(--board-gap)))`,
            top:  `calc(4px + ${tp.row} * (var(--cell-size) + var(--board-gap)))`,
            width: 'var(--cell-size)',
            height: 'var(--cell-size)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 3,
          }}
          animate={{
            rotate:  [0, -18, 18, -18, 18, -18, 360],
            scale:   [1, 1.25, 1.25, 1.25, 1.25, 1.25, 0],
            opacity: [1, 1,    1,    1,    1,    1,    0],
          }}
          transition={{ duration: 1.8, times: [0, 0.10, 0.22, 0.38, 0.52, 0.65, 1] }}
        >
          <span className="player-icon">{PLAYERS[tp.id].icon}</span>
        </motion.div>
      ))}

      {/* ── Player icon layer — one persistent element per player, animated via layout ── */}
      <AnimatePresence>
        {players.filter(p => !p.isEliminated).map(p => (
          <motion.div
            key={`icon-${p.id}`}
            layout
            style={{
              position: 'absolute',
              left: `calc(4px + ${p.col} * (var(--cell-size) + var(--board-gap)))`,
              top: `calc(4px + ${p.row} * (var(--cell-size) + var(--board-gap)))`,
              width: 'var(--cell-size)',
              height: 'var(--cell-size)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 2,
            }}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <span className="player-icon">{PLAYERS[p.id].icon}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
