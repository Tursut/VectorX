// First-gesture modal shown over the start screen. Browser autoplay
// policy (iOS Safari, Chrome iOS, and increasingly desktop too)
// blocks audio until the user gestures on the page, so the menu
// music can't start until the first tap. This modal turns that
// requirement into an inviting beat — a row of the four avatars
// flying in from different corners, then settling into a wave-style
// bounce, with big "TAP TO BEGIN" text. Dismisses on any pointerdown
// / keydown anywhere on the page.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

// Four corners of the viewport, one per avatar. Each entry pairs the
// off-screen origin with a rotation amount so the avatar tumbles in.
// Order matches PLAYERS — Reginald top-left, Gerald top-right,
// Bluebot bottom-left, Buzzilda bottom-right. The mix of rotation
// directions + magnitudes adds quirk: the wizard spins one way, the
// frog the other, the robot does a full turn, the bee a double.
const FLY_IN_STARTS = [
  { x: -260, y: -180, rotate: -240 },
  { x:  260, y: -180, rotate:  240 },
  { x: -260, y:  180, rotate:  360 },
  { x:  260, y:  180, rotate: -540 },
];

// How long after mount the continuous bounce loop kicks in. Has to
// be long enough that the spring entrance is visibly settled —
// otherwise the bounce y-offset stacks on top of mid-flight motion
// and reads as jitter.
const BOUNCE_START_DELAY_S = 0.85;

export default function TapToBeginModal() {
  // Skip the modal under headless test runners (Playwright sets
  // navigator.webdriver to true). The modal's job is to nudge a real
  // user into making the first gesture for the autoplay unblock;
  // tests don't need that and would have to special-case the modal
  // in every spec to dismiss it before clicking start-screen
  // buttons. The modal is purely UX, not behaviour, so opting out
  // for automation is safe.
  const [hasGestured, setHasGestured] = useState(
    typeof navigator !== 'undefined' && navigator.webdriver === true,
  );

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
          // Capture the click so it can't bleed through to the
          // start-screen mode tabs / buttons underneath. The
          // document-level pointerdown listener also fires (handles
          // the audio-context unlock); this onPointerDown is what
          // STOPS the click reaching anything else.
          onPointerDown={(e) => {
            e.stopPropagation();
            setHasGestured(true);
          }}
        >
          <motion.div
            className="tap-to-begin-card"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          >
            <div className="tap-to-begin-avatars">
              {PLAYERS.map((p, i) => (
                <motion.div
                  key={p.id}
                  className="tap-to-begin-avatar-fly"
                  // Fly-in: each avatar starts off-screen in a
                  // different corner with a tumble, then springs to
                  // its row position. Stagger keeps the four
                  // arrivals slightly out of sync — the row reads
                  // like characters racing onto the stage.
                  initial={{
                    x: FLY_IN_STARTS[i].x,
                    y: FLY_IN_STARTS[i].y,
                    rotate: FLY_IN_STARTS[i].rotate,
                    scale: 0.4,
                    opacity: 0,
                  }}
                  animate={{ x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }}
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
                    // Idle bounce — kicks in after the fly-in
                    // settles. Each avatar bounces on its own
                    // mirrored cycle, staggered 180 ms so the row
                    // reads as a wave.
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
