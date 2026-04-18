import { motion, AnimatePresence } from 'framer-motion';
import { PLAYERS, ITEM_TYPES } from '../game/constants';

function badgeColor(turnsLeft) {
  if (turnsLeft >= 4) return '#27ae60';
  if (turnsLeft === 3) return '#f39c12';
  if (turnsLeft === 2) return '#e67e22';
  return '#e74c3c';
}

const spring = { type: 'spring', stiffness: 380, damping: 28 };

export default function Cell({ row, col, cell, isValidMove, isCurrentPlayer, playerHere, deathHere, itemHere, portalActive, onCellClick }) {
  const owner = cell.owner !== null ? PLAYERS[cell.owner] : null;

  let className = 'cell';
  if (isValidMove) className += portalActive ? ' cell-portal' : ' cell-valid';
  if (isCurrentPlayer) className += ' cell-current';

  return (
    <div
      className={className}
      onClick={isValidMove ? () => onCellClick(row, col) : undefined}
      role={isValidMove ? 'button' : undefined}
    >
      {/* ── Layer 0: territory fill (animates in on claim, flashes on bomb clear) ── */}
      <AnimatePresence>
        {owner && (
          <motion.div
            key={`fill-${row}-${col}-${cell.owner}`}
            className="cell-fill"
            style={{ backgroundColor: owner.color }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.85 }}
            exit={{ scale: 1.6, opacity: 0, transition: { duration: 0.28 } }}
            transition={spring}
          />
        )}
      </AnimatePresence>

      {/* ── Layer 1: content (player, item, tombstone, dot) ── */}
      <div className="cell-content">

        {/* Player icon — layoutId makes it glide across the board */}
        <AnimatePresence>
          {playerHere && (
            <motion.span
              key={`player-${playerHere.id}`}
              layoutId={`player-${playerHere.id}`}
              className="player-icon"
              initial={{ y: -28, opacity: 0, scale: 0.5 }}
              animate={{
                y: 0,
                opacity: 1,
                scale: 1,
                ...(isCurrentPlayer ? {} : {}),
              }}
              exit={{ scale: 0, rotate: 540, opacity: 0, transition: { duration: 0.35 } }}
              transition={{ ...spring, delay: playerHere.id * 0.08 }}
            >
              {playerHere.icon}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Tombstone — thuds in after death */}
        <AnimatePresence>
          {deathHere && !playerHere && (
            <motion.span
              key="tombstone"
              className="death-tombstone"
              initial={{ scale: 2.2, opacity: 0, y: -8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 14, delay: 0.15 }}
            >
              🪦
            </motion.span>
          )}
        </AnimatePresence>

        {/* Magic item — pops in, shrinks out */}
        <AnimatePresence>
          {itemHere && !playerHere && (
            <motion.div
              key={itemHere.id}
              className="item-wrapper"
              initial={{ scale: 0, opacity: 0, y: -12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0, opacity: 0, transition: { duration: 0.2 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 24 }}
            >
              <span className="item-icon">{ITEM_TYPES[itemHere.type]?.icon}</span>
              <span
                className="item-badge"
                style={{ backgroundColor: badgeColor(itemHere.turnsLeft) }}
              >
                {itemHere.turnsLeft}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Valid move hint dot */}
        {isValidMove && !playerHere && !itemHere && <span className="valid-move-dot" />}
      </div>
    </div>
  );
}
