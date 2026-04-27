// Idle peek-ins from the four characters on the start menu.
// Every 6-10 s one of them pops up from a screen edge, hangs for
// ~1.5 s, then ducks back. Each character has its own entry
// vocabulary — wizard like a cuckoo clock from the top-left, frog
// hopping up from the bottom-left, robot sliding up rigidly from
// the bottom-right, bee zig-zagging down from the top-right.
//
// Sits as an absolutely-positioned overlay across the menu view
// so it doesn't shift any layout. Only renders one peeker at a
// time. prefers-reduced-motion freezes everything.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const MIN_PEEK_DELAY_MS = 6000;
const MAX_PEEK_DELAY_MS = 10000;
const FIRST_PEEK_DELAY_MS = 6000; // long enough that the tap-to-begin modal is dismissed
const PEEK_HOLD_MS = 1600;

// Per-character entry choreography. Each entry describes:
//   - corner: where on the screen the avatar is anchored
//   - initial / animate / exit: framer-motion variants
//   - rotate (optional): keyframes for the visit
//
// Order matches PLAYERS — Reginald, Gerald, Bluebot, Buzzilda.
const PEEK_STYLES = [
  // Reginald 🧙‍♂️ — cuckoo-clock peek from top-left. Comes out at
  // an angle, tips back like an old wizard checking who's there.
  {
    corner: { top: 16, left: 16 },
    initial: { x: -80, y: -40, rotate: -45, opacity: 0 },
    animate: { x: 0, y: 0, rotate: [-45, -10, -22, -10], opacity: 1 },
    exit:    { x: -80, y: -40, rotate: -45, opacity: 0 },
    transition: {
      animate: { duration: 1.4, times: [0, 0.3, 0.6, 1], ease: 'easeOut' },
      enter: { type: 'spring', stiffness: 220, damping: 18 },
      exit: { duration: 0.45, ease: 'easeIn' },
    },
  },
  // Gerald 🐸 — hops up from below the bottom-left. Two hops then
  // back down.
  {
    corner: { bottom: 100, left: 24 },
    initial: { y: 100, opacity: 0 },
    animate: { y: [100, -8, 6, -4, 0], opacity: 1 },
    exit:    { y: 120, opacity: 0 },
    transition: {
      animate: { duration: 1.2, times: [0, 0.35, 0.55, 0.75, 1], ease: 'easeOut' },
      enter: { type: 'spring', stiffness: 260, damping: 16 },
      exit: { duration: 0.4, ease: 'easeIn' },
    },
  },
  // Bluebot 🤖 — slides up from the bottom-right. Rigid stop, no
  // overshoot. Mechanical.
  {
    corner: { bottom: 100, right: 24 },
    initial: { y: 100, opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit:    { y: 100, opacity: 0 },
    transition: {
      animate: { duration: 0.35, ease: 'linear' },
      enter: { duration: 0.35, ease: 'linear' },
      exit: { duration: 0.3, ease: 'linear' },
    },
  },
  // Buzzilda 🐝 — zig-zags down from the top-right.
  {
    corner: { top: 16, right: 16 },
    initial: { y: -90, x: 30, rotate: 0, opacity: 0 },
    animate: { y: [-90, -10, -30, -5, 0], x: [30, -10, 16, -6, 0], rotate: [0, -10, 10, -6, 0], opacity: 1 },
    exit:    { y: -90, x: 30, opacity: 0 },
    transition: {
      animate: { duration: 1.2, times: [0, 0.3, 0.55, 0.8, 1], ease: 'easeInOut' },
      enter: { duration: 1.2, ease: 'easeInOut' },
      exit: { duration: 0.4, ease: 'easeIn' },
    },
  },
];

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function pickNext(prevIndex) {
  if (prevIndex == null) return Math.floor(Math.random() * PLAYERS.length);
  let next = prevIndex;
  while (next === prevIndex) {
    next = Math.floor(Math.random() * PLAYERS.length);
  }
  return next;
}

export default function MenuAvatarStage() {
  // null when no avatar is currently peeking, otherwise the index
  // into PLAYERS / PEEK_STYLES.
  const [peeker, setPeeker] = useState(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;

    let mounted = true;
    let lastIndex = null;
    let timeoutId = null;

    const schedulePeek = (delay) => {
      timeoutId = setTimeout(() => {
        if (!mounted) return;
        const next = pickNext(lastIndex);
        lastIndex = next;
        setPeeker(next);
        timeoutId = setTimeout(() => {
          if (!mounted) return;
          setPeeker(null);
          const cooldown =
            MIN_PEEK_DELAY_MS +
            Math.floor(Math.random() * (MAX_PEEK_DELAY_MS - MIN_PEEK_DELAY_MS));
          schedulePeek(cooldown);
        }, PEEK_HOLD_MS);
      }, delay);
    };

    schedulePeek(FIRST_PEEK_DELAY_MS);

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="menu-avatar-stage" aria-hidden="true">
      <AnimatePresence>
        {peeker !== null && (() => {
          const p = PLAYERS[peeker];
          const s = PEEK_STYLES[peeker];
          return (
            <motion.div
              key={p.id}
              className="menu-avatar-peeker"
              style={{
                ...s.corner,
                backgroundColor: p.darkColor,
                borderColor: p.color,
              }}
              initial={s.initial}
              animate={s.animate}
              exit={s.exit}
              transition={s.transition.animate}
            >
              <span className="menu-avatar-peeker-icon">{p.icon}</span>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
