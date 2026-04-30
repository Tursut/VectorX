// Winner "hero" overlay (issue #60). Renders a centered 84 px avatar
// for ~1 s between the trap chain finishing and GameOverScreen
// mounting, so the climactic moment gets a clean spotlight instead
// of cross-fading the death animation into the leaderboard.

import { motion } from 'framer-motion';

export default function WinnerHeroOverlay({ winner }) {
  if (!winner) return null;
  return (
    <div className="winner-hero-overlay">
      <motion.div
        className="winner-hero-avatar"
        style={{ backgroundColor: winner.color }}
        initial={{ scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      >
        {winner.icon ?? '🏆'}
      </motion.div>
    </div>
  );
}
