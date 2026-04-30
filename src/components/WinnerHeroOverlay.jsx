// Winner "hero" overlay (issue #60). Renders a centered 84 px avatar
// when the winner-hero phase is active — between the trap chain
// finishing and GameOverScreen mounting. Shares a layoutId with
// GameOverScreen's trophy so framer-motion morphs the avatar across
// the screen swap without a visible jump.

import { motion } from 'framer-motion';

export default function WinnerHeroOverlay({ winner }) {
  if (!winner) return null;
  return (
    <div className="winner-hero-overlay">
      <motion.div
        layoutId="winner-hero-avatar"
        className="winner-hero-avatar"
        style={{ backgroundColor: winner.color }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
      >
        {winner.icon ?? '🏆'}
      </motion.div>
    </div>
  );
}
