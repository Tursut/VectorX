// Winner "hero" overlay (issue #60). Big centred avatar + "WINNER!" text
// for ~1 s between the trap chain finishing and GameOverScreen
// mounting. The avatar shares a layoutId with .gameover-winner-icon so
// framer-motion morphs it across the screen swap to the leaderboard's
// trophy position — no visible jump or flash, the leaderboard chrome
// just appears around the already-placed avatar.

import { motion } from 'framer-motion';

export default function WinnerHeroOverlay({ winner }) {
  if (!winner) return null;
  return (
    <div className="winner-hero-overlay">
      <div className="winner-hero-content">
        <motion.div
          layoutId="winner-hero-avatar"
          className="winner-hero-avatar"
          style={{ backgroundColor: winner.color }}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        >
          {winner.icon ?? '🏆'}
        </motion.div>
        <motion.div
          className="winner-hero-text"
          style={{ color: winner.color }}
          initial={{ y: 40, opacity: 0, rotate: -6 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ delay: 0.18, type: 'spring', stiffness: 280, damping: 14 }}
        >
          <motion.span
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            WINNER!
          </motion.span>
        </motion.div>
      </div>
    </div>
  );
}
