// Winner hero phase (issue #60). A fixed-position overlay that sits
// ON TOP of the live board between the trap-chain death animation
// and the GameOverScreen leaderboard. Holds until the user taps —
// rushing through the climax of the game is exactly what we don't
// want, so no auto-dismiss.

import { motion } from 'framer-motion';

export default function WinnerHero({ winner, onContinue }) {
  if (!winner) return null;
  return (
    <motion.div
      className="winner-hero-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (typeof onContinue === 'function') onContinue();
      }}
    >
      <div className="winner-hero-content">
        {/* Outer motion handles the entrance; inner handles a subtle
            idle "breathing" animation so the screen doesn't feel
            frozen during the hold. */}
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

        {/* Tap-to-continue prompt. Same vocabulary as TapToBeginModal's
            title — Fredoka One, letter-spaced, lavender, glow shadow,
            titlePulse animation — at a smaller size since this sits
            below a bigger hero element. Delayed entrance so the
            avatar + WINNER read first. */}
        <motion.div
          className="winner-hero-continue"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.35 }}
        >
          TAP TO CONTINUE
        </motion.div>
      </div>
    </motion.div>
  );
}
