// First-gesture modal shown over the start screen. Browser autoplay
// policy (iOS Safari, Chrome iOS, and increasingly desktop too)
// blocks audio until the user gestures on the page, so the menu
// music can't start until the first tap. This modal turns that
// requirement into an inviting beat — a row of the four avatars
// bouncing in a slight wave, big "TAP TO BEGIN" text, dismisses on
// any pointerdown / keydown anywhere on the page.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

export default function TapToBeginModal() {
  const [hasGestured, setHasGestured] = useState(false);

  useEffect(() => {
    if (hasGestured) return undefined;
    const onGesture = () => setHasGestured(true);
    document.addEventListener('pointerdown', onGesture, { once: true, passive: true });
    document.addEventListener('keydown', onGesture, { once: true });
    return () => {
      document.removeEventListener('pointerdown', onGesture);
      document.removeEventListener('keydown', onGesture);
    };
  }, [hasGestured]);

  return (
    <AnimatePresence>
      {!hasGestured && (
        <motion.div
          key="tap-to-begin-overlay"
          className="tap-to-begin-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <motion.div
            className="tap-to-begin-card"
            initial={{ scale: 0.9, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            <div className="tap-to-begin-avatars">
              {PLAYERS.map((p, i) => (
                <motion.div
                  key={p.id}
                  className="tap-to-begin-avatar"
                  style={{ backgroundColor: p.darkColor, borderColor: p.color }}
                  // Per-avatar wave: each badge bounces on its own
                  // mirrored cycle, staggered 180 ms so they look
                  // like a row of characters peeking up at the user.
                  animate={{ y: [0, -8, 0] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.18,
                  }}
                >
                  <span className="tap-to-begin-avatar-icon">{p.icon}</span>
                </motion.div>
              ))}
            </div>
            <h2 className="tap-to-begin-title">TAP TO BEGIN</h2>
            <p className="tap-to-begin-sub">the grid awaits</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
