// First-gesture modal shown over the start screen on first app
// entry. Browser autoplay policy (iOS Safari, Chrome iOS, and
// increasingly desktop too) blocks audio until the user gestures on
// the page, so the menu music can't start until the first tap. This
// modal turns that requirement into an inviting beat — a row of the
// four avatars flying in from different corners, then settling into
// a wave-style bounce, with big "TAP TO BEGIN" text. Dismisses on
// any pointerdown / keydown anywhere on the page; on dismiss the
// avatars retreat back through the corners they came in from.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

// Once-per-page-session flag. The modal lives inside StartScreen,
// which unmounts/remounts whenever the user exits to menu (between
// games, leaderboard → menu, etc.). Component state would reset on
// each remount and the user would see the modal every time. A
// module-level flag survives StartScreen's lifecycle and resets
// only on full page reload — which is the moment the autoplay
// gesture requirement comes back anyway.
let hasShownTapToBegin = false;

const FLY_IN_STARTS = [
  { x: -260, y: -180, rotate: -240 },
  { x:  260, y: -180, rotate:  240 },
  { x: -260, y:  180, rotate:  360 },
  { x:  260, y:  180, rotate: -540 },
];

const BOUNCE_START_DELAY_S = 0.85;

export default function TapToBeginModal() {
  // Skip under headless test runners (Playwright sets
  // navigator.webdriver). Tests don't need the gesture nudge and
  // we'd otherwise have to special-case dismissal in every spec.
  // Also skip if the modal has already been shown this page session
  // (see hasShownTapToBegin above).
  const [hasGestured, setHasGestured] = useState(
    hasShownTapToBegin
      || (typeof navigator !== 'undefined' && navigator.webdriver === true),
  );

  useEffect(() => {
    if (hasGestured) return undefined;
    const onGesture = () => {
      hasShownTapToBegin = true;
      setHasGestured(true);
    };
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
          // Backdrop holds at full opacity while the avatars fly
          // out, then fades. Without the delay the whole overlay
          // dims during the fly-out and the motion barely reads.
          exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.5 } }}
          transition={{ duration: 0.3 }}
          // Capture the click so it can't bleed through to the
          // start-screen mode tabs / buttons underneath. The
          // document-level pointerdown listener also fires (handles
          // the audio-context unlock); this onPointerDown is what
          // STOPS the click reaching anything else.
          onPointerDown={(e) => {
            e.stopPropagation();
            hasShownTapToBegin = true;
            setHasGestured(true);
          }}
        >
          <motion.div
            className="tap-to-begin-card"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            // Card fades together with the backdrop, after the
            // avatars have left.
            exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.3, delay: 0.5 } }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            <div className="tap-to-begin-avatars">
              {PLAYERS.map((p, i) => (
                <motion.div
                  key={p.id}
                  className="tap-to-begin-avatar-fly"
                  // Fly-in: each avatar starts off-screen in a
                  // different corner with a tumble, then springs to
                  // its row position. On dismissal, exit reverses
                  // the trajectory — full opacity throughout so the
                  // motion is visible (the overlay's delayed fade
                  // hides them at the end).
                  initial={{
                    x: FLY_IN_STARTS[i].x,
                    y: FLY_IN_STARTS[i].y,
                    rotate: FLY_IN_STARTS[i].rotate,
                    scale: 0.4,
                    opacity: 0,
                  }}
                  animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
                  exit={{
                    x: FLY_IN_STARTS[i].x,
                    y: FLY_IN_STARTS[i].y,
                    rotate: FLY_IN_STARTS[i].rotate,
                    scale: 0.5,
                    transition: {
                      duration: 0.5,
                      ease: [0.7, 0, 0.84, 0],
                      delay: i * 0.05,
                    },
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 220,
                    damping: 16,
                    delay: i * 0.08,
                  }}
                >
                  <motion.div
                    className="tap-to-begin-avatar"
                    style={{ backgroundColor: p.darkColor, borderColor: p.color }}
                    animate={{ y: [0, -8, 0] }}
                    transition={{
                      duration: 1.2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: BOUNCE_START_DELAY_S + i * 0.18,
                    }}
                  >
                    <span className="tap-to-begin-avatar-icon">{p.icon}</span>
                  </motion.div>
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
