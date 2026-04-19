import { motion, AnimatePresence } from 'framer-motion';
import { PLAYERS, ITEM_TYPES } from '../game/constants';

function badgeColor(turnsLeft) {
  if (turnsLeft >= 4) return '#27ae60';
  if (turnsLeft === 3) return '#f39c12';
  if (turnsLeft === 2) return '#e67e22';
  return '#e74c3c';
}

const spring = { type: 'spring', stiffness: 380, damping: 28 };

export default function Cell({ row, col, cell, isValidMove, isCurrentPlayer, playerHere, deathHere, itemHere, portalActive, swapActive, playerColor, onCellClick, isBombOrigin, isBombCleared, isPortalOrigin, isPortalDest, isSwapFlash }) {
  const owner = cell.owner !== null ? PLAYERS[cell.owner] : null;

  let className = 'cell';
  if (isValidMove) {
    if (swapActive && playerHere) className += ' cell-swap-target';
    else if (portalActive) className += ' cell-portal';
    else className += ' cell-valid';
  }
  if (isCurrentPlayer) className += ' cell-current';
  if (isBombCleared) className += ' cell-bomb-cleared';

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
            exit={{ opacity: 0, transition: { duration: 0.28 } }}
            transition={{ ...spring, delay: 0.16 }}
          />
        )}
      </AnimatePresence>

      {/* ── Layer 0b: valid-move highlight — fades in/out as a group ── */}
      <AnimatePresence>
        {isValidMove && !portalActive && !swapActive && (
          <motion.div
            className="cell-valid-overlay"
            style={{
              background: `${playerColor}18`,
              boxShadow: `inset 0 0 0 2px ${playerColor}66`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.38, ease: 'easeInOut' }}
          />
        )}
      </AnimatePresence>

      {/* ── Layer 1: content (player, item, tombstone, dot) ── */}
      <div className="cell-content">

        {/* Player icon — layoutId glides it across the board via LayoutGroup */}
        {playerHere && (
          <motion.span
            layoutId={`player-${playerHere.id}`}
            className="player-icon"
            initial={{ opacity: 1, scale: 1 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            {playerHere.icon}
          </motion.span>
        )}

        {/* Skull — absolutely positioned so it doesn't fight the exiting player in flex layout */}
        {deathHere && !playerHere && (
          <span className="death-marker">💀</span>
        )}

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
                style={{ color: badgeColor(itemHere.turnsLeft) }}
              >
                {itemHere.turnsLeft}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Valid move hint dot — CSS animation only, no Framer Motion */}
        {isValidMove && !playerHere && !itemHere && <span className="valid-move-dot" />}
      </div>

      {/* Swap-target label */}
      {swapActive && isValidMove && playerHere && (
        <div className="cell-swap-label">SWAP</div>
      )}

      {/* Portal origin — ring collapses inward */}
      {isPortalOrigin && (
        <motion.div
          className="portal-ring"
          initial={{ scale: 1.1, opacity: 0.9 }}
          animate={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeIn' }}
        />
      )}

      {/* Portal destination — ring expands outward */}
      {isPortalDest && (
        <motion.div
          className="portal-ring"
          initial={{ scale: 0, opacity: 0.95 }}
          animate={{ scale: 2.8, opacity: 0 }}
          transition={{ duration: 0.65, ease: 'easeOut' }}
        />
      )}

      {/* Swap flash — green ring expands from both swapped cells */}
      {isSwapFlash && (
        <motion.div
          className="swap-ring"
          initial={{ scale: 0.8, opacity: 0.9 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      )}

      {/* Bomb explosion overlay — absolutely positioned above everything */}
      {isBombOrigin && <span className="bomb-origin-fx">💥</span>}
    </div>
  );
}
