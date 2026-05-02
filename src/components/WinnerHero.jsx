// Winner hero phase (issue #60). A fixed-position overlay that sits
// ON TOP of the live board between the trap-chain death animation
// and the GameOverScreen leaderboard. Holds until the user taps —
// rushing through the climax of the game is exactly what we don't
// want, so no auto-dismiss.

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import * as sounds from '../game/sounds';

const WINNER_LABEL = 'WINNER!';

export default function WinnerHero({
  winner,
  onContinue,
  soundKey = null,
  onBeforeFanfare = null,
  onAfterFanfareStart = null,
}) {
  const reduceMotion = useReducedMotion();
  const playedSoundKeyRef = useRef(null);
  const beforeFanfareRef = useRef(onBeforeFanfare);
  const afterFanfareRef = useRef(onAfterFanfareStart);

  useEffect(() => {
    beforeFanfareRef.current = onBeforeFanfare;
  }, [onBeforeFanfare]);
  useEffect(() => {
    afterFanfareRef.current = onAfterFanfareStart;
  }, [onAfterFanfareStart]);

  // Hooks must come before any conditional return (rules of hooks).
  // StrictMode mounts effects twice (mount → cleanup → remount). Using a
  // macrotask (setTimeout) means StrictMode's synchronous cleanup cancels
  // the fake-mount timer before it fires — only the real mount ever plays.
  useEffect(() => {
    if (!winner || !soundKey) return undefined;
    if (playedSoundKeyRef.current === soundKey) return undefined;
    const t = setTimeout(() => {
      if (playedSoundKeyRef.current === soundKey) return;
      playedSoundKeyRef.current = soundKey;
      if (typeof beforeFanfareRef.current === 'function') beforeFanfareRef.current();
      sounds.playWin();
      if (typeof afterFanfareRef.current === 'function') afterFanfareRef.current();
    }, 0);
    return () => clearTimeout(t);
  }, [winner, soundKey]);

  if (!winner) return null;

  const avatarBg = winner.darkColor ?? winner.color;

  const avatarIdle = reduceMotion
    ? { rotate: 0, y: 0, scale: 1 }
    : {
        rotate: [0, 12, -12, 0],
        y: [0, -8, 0, 6, 0],
        scale: [1, 1.05, 1, 1.04, 1],
      };

  const avatarIdleTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 2.2,
        repeat: Infinity,
        ease: 'easeInOut',
        delay: 0.4,
      };

  const letterIdle = reduceMotion ? { y: 0, rotate: 0 } : { y: [0, -12, 0], rotate: [0, -4, 0] };

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
        {/* Outer motion handles the entrance; inner handles idle
            celebration — ring + wobble like menu bubbles (#86). */}
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        >
          <motion.div
            className="winner-hero-avatar"
            style={{
              backgroundColor: avatarBg,
              borderColor: winner.color,
            }}
            animate={avatarIdle}
            transition={avatarIdleTransition}
          >
            <span className="winner-hero-avatar-icon">{winner.icon ?? '🏆'}</span>
          </motion.div>
        </motion.div>

        <motion.div
          className="winner-hero-text"
          style={{ color: winner.color }}
          role="heading"
          aria-level={2}
          aria-label={WINNER_LABEL}
          initial={{ y: 32, opacity: 0, rotate: -6 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.18, type: 'spring', stiffness: 280, damping: 14 }}
        >
          {WINNER_LABEL.split('').map((char, i) => (
            <motion.span
              key={`${char}-${i}`}
              style={{ display: 'inline-block', transformOrigin: 'center bottom' }}
              animate={letterIdle}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      duration: 1.05,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: i * 0.07,
                    }
              }
            >
              {char}
            </motion.span>
          ))}
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
