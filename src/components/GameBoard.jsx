import { motion, AnimatePresence } from 'framer-motion';
import { PLAYERS } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex, items, portalActive, swapActive, isGremlinTurn, bombBlast, portalJump, swapFlash, trappedPlayers = [], winnerPlayer = null, flyingFreeze = null, frozenPlayerId = null }) {
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

  const frozenPlayerData = frozenPlayerId !== null
    ? players.find(p => p.id === frozenPlayerId && !p.isEliminated)
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

      {/* ── Flying ❄️ — travels from collector cell center to frozen player's badge corner ── */}
      <AnimatePresence>
        {flyingFreeze && (
          <motion.div
            key="flying-freeze"
            style={{
              position: 'absolute',
              left: `calc(4px + ${flyingFreeze.toCol} * (var(--cell-size) + var(--board-gap)) + var(--cell-size) * 0.52)`,
              top:  `calc(4px + ${flyingFreeze.toRow} * (var(--cell-size) + var(--board-gap)))`,
              width: 'calc(var(--cell-size) * 0.48)',
              height: 'calc(var(--cell-size) * 0.48)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 20, 50, 0.72)',
              borderRadius: '50%',
              pointerEvents: 'none',
              zIndex: 10,
            }}
            initial={{
              x: `calc(${flyingFreeze.fromCol - flyingFreeze.toCol} * (var(--cell-size) + var(--board-gap)) - var(--cell-size) * 0.26)`,
              y: `calc(${flyingFreeze.fromRow - flyingFreeze.toRow} * (var(--cell-size) + var(--board-gap)) + var(--cell-size) * 0.26)`,
              scale: 1.5,
              opacity: 0,
            }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.55, type: 'spring', stiffness: 180, damping: 22 }}
          >
            <span style={{ fontSize: 'calc(var(--cell-size) * 0.32)', filter: 'drop-shadow(0 0 4px #7dd3fc)' }}>❄️</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Frozen player badge — appears after the flying ❄️ lands, same corner position ── */}
      <AnimatePresence>
        {frozenPlayerData && !flyingFreeze && (
          <motion.div
            key={`frozen-badge-${frozenPlayerId}`}
            style={{
              position: 'absolute',
              left: `calc(4px + ${frozenPlayerData.col} * (var(--cell-size) + var(--board-gap)) + var(--cell-size) * 0.52)`,
              top:  `calc(4px + ${frozenPlayerData.row} * (var(--cell-size) + var(--board-gap)))`,
              width: 'calc(var(--cell-size) * 0.48)',
              height: 'calc(var(--cell-size) * 0.48)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(10, 20, 50, 0.72)',
              borderRadius: '50%',
              pointerEvents: 'none',
              zIndex: 6,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ scale: 2.2, opacity: 0, transition: { duration: 0.45 } }}
            transition={{ duration: 0.15 }}
          >
            <span style={{ fontSize: 'calc(var(--cell-size) * 0.32)', filter: 'drop-shadow(0 0 4px #7dd3fc)' }}>❄️</span>
          </motion.div>
        )}
      </AnimatePresence>

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
            rotate:  [0, -28, 28, -28, 28, -28, 28, -28, 720],
            scale:   [1, 1.4,  1.4,  1.4,  1.4,  1.4,  1.4,  1.4,  0],
            opacity: [1, 1,    1,    1,    1,    1,    1,    1,    0],
          }}
          transition={{ duration: 2.5, times: [0, 0.07, 0.16, 0.25, 0.34, 0.43, 0.52, 0.63, 1] }}
        >
          <span className="player-icon">{PLAYERS[tp.id].icon}</span>
        </motion.div>
      ))}

      {/* ── Winner celebration layer — joyful bounce while the last bot dies ── */}
      {winnerPlayer && (
        <motion.div
          key="winner-celebration"
          style={{
            position: 'absolute',
            left: `calc(4px + ${winnerPlayer.col} * (var(--cell-size) + var(--board-gap)))`,
            top:  `calc(4px + ${winnerPlayer.row} * (var(--cell-size) + var(--board-gap)))`,
            width: 'var(--cell-size)',
            height: 'var(--cell-size)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 4,
          }}
          animate={{
            rotate: [0, -14, 14, -14, 14, -10, 10, -6,  6,  0],
            scale:  [1,  1.3, 1.3, 1.3, 1.3, 1.35, 1.35, 1.4, 1.4, 1.45],
            y:      [0,  -6,   0,  -6,   0,   -4,   0,   -4,  0,   0],
          }}
          transition={{ duration: 2.5, times: [0, 0.07, 0.16, 0.25, 0.34, 0.43, 0.52, 0.63, 0.80, 1] }}
        >
          <span className="player-icon">{PLAYERS[winnerPlayer.id].icon}</span>
        </motion.div>
      )}

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
