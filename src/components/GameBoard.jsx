import { motion, AnimatePresence } from 'framer-motion';
import { PLAYERS, ITEM_TYPES } from '../game/constants';
import Cell from './Cell';

export default function GameBoard({ grid, players, validMoveSet, onCellClick, currentPlayerIndex, items, portalActive, swapActive, freezeSelectActive = false, isGremlinTurn, isOpponentTurn = false, bombBlast, portalJump, swapFlash, trappedPlayers = [], winnerPlayer = null, flyingFreeze = null, roulettePlayerId = null, rouletteRevealing = false, pendingSwap = null, rouletteActor = null, frozenPlayerId = null, frozenTurnsLeft = 0 }) {
  // While a swap roulette is rolling (issue #30), the server-applied swap has
  // already exchanged the two players' positions in gameState — but we want
  // them to *appear* still in their pre-swap spots until the spotlight lands.
  // Because a swap is symmetrical, each player's pre-swap position is the
  // OTHER player's current (post-swap) position, so we can derive the
  // pre-swap layout from the current gameState alone.
  const renderPlayers = pendingSwap
    ? players.map((p) => {
        if (p.id === pendingSwap.byId) {
          const t = players.find((q) => q.id === pendingSwap.targetId);
          return t ? { ...p, row: t.row, col: t.col } : p;
        }
        if (p.id === pendingSwap.targetId) {
          const b = players.find((q) => q.id === pendingSwap.byId);
          return b ? { ...p, row: b.row, col: b.col } : p;
        }
        return p;
      })
    : players;

  const playerPositions = {};
  const deathCells = {};
  const itemMap = {};

  renderPlayers.forEach((p) => {
    if (!p.isEliminated) {
      playerPositions[`${p.row},${p.col}`] = PLAYERS[p.id];
    } else if (p.deathCell) {
      deathCells[`${p.deathCell.row},${p.deathCell.col}`] = PLAYERS[p.id];
    }
  });

  (items || []).forEach((item) => {
    itemMap[`${item.row},${item.col}`] = item;
  });

  const currentPlayer = renderPlayers[currentPlayerIndex];
  const playerColor = PLAYERS[renderPlayers[currentPlayerIndex].id].color;

  const bombOriginKey = bombBlast ? `${bombBlast.origin.row},${bombBlast.origin.col}` : null;
  const bombClearedSet = bombBlast ? new Set(bombBlast.cleared.map(c => `${c.row},${c.col}`)) : null;
  const portalFromKey = portalJump ? `${portalJump.from.row},${portalJump.from.col}` : null;
  const portalToKey   = portalJump ? `${portalJump.to.row},${portalJump.to.col}`   : null;
  const swapFlashSet  = swapFlash
    ? new Set([`${swapFlash.pos1.row},${swapFlash.pos1.col}`, `${swapFlash.pos2.row},${swapFlash.pos2.col}`])
    : null;

  const frozenPlayerData = frozenPlayerId !== null
    ? renderPlayers.find(p => p.id === frozenPlayerId && !p.isEliminated)
    : null;

  // Roulette actor (issue #37) — the player who picked the freeze/swap
  // item that the wheel is rolling for. Look up against renderPlayers
  // so the halo + item icon track the PRE-swap position during a swap
  // roulette (matching where the actor's avatar is rendered).
  const rouletteActorData = rouletteActor
    ? renderPlayers.find(p => p.id === rouletteActor.playerId && !p.isEliminated)
    : null;
  const rouletteActorItemIcon = rouletteActor
    ? ITEM_TYPES[rouletteActor.itemKind]?.icon
    : null;

  return (
    <div
      className="board"
      data-testid="game-board"
      style={{
        '--player-color': playerColor,
        // Actor's colour for .cell-roulette-actor halo (issue #37) —
        // the board-level --player-color tracks the CURRENT player,
        // which has advanced past the actor by the time the wheel
        // is rolling.
        '--roulette-actor-color': rouletteActor
          ? PLAYERS[rouletteActor.playerId].color
          : 'transparent',
        position: 'relative',
      }}
    >
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
              isOpponentTurn={isOpponentTurn && currentPlayer && currentPlayer.row === ri && currentPlayer.col === ci}
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
              isFreezeTarget={!isGremlinTurn && freezeSelectActive && renderPlayers.some(p => !p.isEliminated && p.id !== renderPlayers[currentPlayerIndex].id && p.row === ri && p.col === ci)}
              isRoulette={roulettePlayerId !== null && renderPlayers.some(p => p.id === roulettePlayerId && p.row === ri && p.col === ci)}
              isRouletteReveal={rouletteRevealing && roulettePlayerId !== null && renderPlayers.some(p => p.id === roulettePlayerId && p.row === ri && p.col === ci)}
              isRouletteActor={rouletteActorData !== null && rouletteActorData.row === ri && rouletteActorData.col === ci}
            />
          );
        })
      )}

      {/* ── Flying ❄️ — travels from collector to target's top-left corner (badge landing spot) ── */}
      <AnimatePresence>
        {flyingFreeze && (
          <motion.div
            key="flying-freeze"
            style={{
              position: 'absolute',
              left: `calc(4px + ${flyingFreeze.toCol} * (var(--cell-size) + var(--board-gap)))`,
              top:  `calc(4px + ${flyingFreeze.toRow} * (var(--cell-size) + var(--board-gap)) + 2px)`,
              width: 'var(--cell-size)',
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 10,
            }}
            initial={{
              x: `calc(${flyingFreeze.fromCol - flyingFreeze.toCol} * (var(--cell-size) + var(--board-gap)))`,
              y: `calc(${flyingFreeze.fromRow - flyingFreeze.toRow} * (var(--cell-size) + var(--board-gap)) + var(--cell-size) * 0.5 - 2px)`,
              scale: 1.6,
              opacity: 0,
            }}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.55, type: 'spring', stiffness: 180, damping: 22 }}
          >
            <span className="frozen-count-badge">❄️ 3</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Roulette actor item icon (issue #37) ──
           Floats the freeze/swap icon above the actor's cell for the
           whole wheel + reveal so it's clear who picked the item and
           what's at stake. Reuses the .item-wrapper / .item-icon
           styles used for items resting on the board. */}
      <AnimatePresence>
        {rouletteActorData && rouletteActorItemIcon && (
          <motion.div
            key={`roulette-actor-item-${rouletteActor.playerId}-${rouletteActor.itemKind}`}
            className="roulette-actor-item"
            style={{
              position: 'absolute',
              left: `calc(4px + ${rouletteActorData.col} * (var(--cell-size) + var(--board-gap)))`,
              top:  `calc(4px + ${rouletteActorData.row} * (var(--cell-size) + var(--board-gap)))`,
              width: 'var(--cell-size)',
              height: 'var(--cell-size)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 7,
            }}
            initial={{ scale: 0.7, opacity: 0, y: -10 }}
            animate={{ scale: 1, opacity: 1, y: -10 }}
            exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            <span className="roulette-actor-item-icon">{rouletteActorItemIcon}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Frozen badge — top-left "❄️ N" pill, persists until real turn arrives ── */}
      {/* Hidden while a roulette is rolling (issue #30): the freeze is already
          applied server-side, but showing the badge before the spotlight lands
          would spoil who got hit. */}
      <AnimatePresence>
        {frozenPlayerData && !flyingFreeze && roulettePlayerId === null && (
          <motion.div
            key={`frozen-badge-${frozenPlayerId}-${frozenTurnsLeft}`}
            style={{
              position: 'absolute',
              left: `calc(4px + ${frozenPlayerData.col} * (var(--cell-size) + var(--board-gap)))`,
              top:  `calc(4px + ${frozenPlayerData.row} * (var(--cell-size) + var(--board-gap)) + 2px)`,
              width: 'var(--cell-size)',
              display: 'flex',
              justifyContent: 'center',
              pointerEvents: 'none',
              zIndex: 6,
            }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 2.2, opacity: 0, transition: { duration: 0.45 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          >
            <span className="frozen-count-badge">
              {frozenTurnsLeft > 0 ? `❄️ ${frozenTurnsLeft}` : '❄️'}
            </span>
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

      {/* ── Player icon layer — one persistent element per player, animated via layout ──
           When a winner-celebration is on screen, hide that player's static icon —
           the wobbly celebration motion.div above (z-index 4) is the only avatar
           we want during the wind-down, otherwise we'd render two stacked icons. */}
      <AnimatePresence>
        {renderPlayers.filter(p => !p.isEliminated && p.id !== winnerPlayer?.id).map(p => (
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
              zIndex: 5,
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
