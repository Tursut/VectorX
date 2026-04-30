// Winner hero phase (issue #60). A fixed-position overlay that sits
// ON TOP of the live board for ~2 s between the trap-chain death
// animation and the GameOverScreen leaderboard. The board stays
// visible underneath through a soft scrim — the moment reads as
// "you won THIS game" rather than a screen change.

import { motion } from 'framer-motion';

export default function WinnerHero({ winner }) {
  if (!winner) return null;
  return (
    <motion.div
      className="winner-hero-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="winner-hero-content">
        {/* Outer motion handles the entrance; inner handles a subtle
            idle "breathing" animation so the screen doesn't feel
            frozen during the 2 s hold. */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        >
          <motion.div
            className="winner-hero-avatar"
            style={{ backgroundColor: winner.color }}
            animate={{ rotate: [0, 4, -4, 0] }}
            transition={{
              duration: 3.2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: 0.4,
            }}
          >
            {winner.icon ?? '🏆'}
          </motion.div>
        </motion.div>

        <motion.div
          className="winner-hero-text"
          style={{ color: winner.color }}
          initial={{ y: 32, opacity: 0, rotate: -6 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.18, type: 'spring', stiffness: 280, damping: 14 }}
        >
          <motion.span
            style={{ display: 'inline-block', transformOrigin: 'center' }}
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            WINNER!
          </motion.span>
        </motion.div>
      </div>
    </motion.div>
  );
}
