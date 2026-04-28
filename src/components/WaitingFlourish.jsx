// Quirky waiting indicator shown while CREATE ROOM is in flight
// (POST /rooms + WS handshake). Two flourishes layered:
//
//   1. A cycling italic caption — "Polishing the grid…",
//      "Recruiting bots…" — that rotates every ~700 ms so the
//      screen always reads as "working".
//   2. A small avatar parade — the four characters in a row, with
//      ONE doing a tiny bespoke wiggle at a time. Spotlight rotates
//      every ~600 ms.
//
// Mounted inline (no overlay, no modal) inside whichever surface
// owns the wait — StartScreen during CREATE ROOM, StatusScreen
// during the WS connecting half. Both halves get the same
// flourish so the wait reads as one continuous beat.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const CAPTIONS = [
  'Polishing the grid…',
  'Recruiting bots…',
  'Asking the wizard for permission…',
  'Telling Buzzilda to behave…',
  'Sweeping cobwebs out of the room…',
  'Sharpening the trickster’s hat…',
  'Calibrating the trap-doors…',
  'Reminding Gerald not to eat the items…',
];

// Heading rotates once partway through the wait so the user sees
// the playful framing first ("Creating your playground") then the
// accurate label ("Creating your private room") before the
// lobby mounts. Pacing tuned to the 2100 ms minimum: the swap
// fires at the midpoint (1050 ms), leaving ~1 s on each label —
// long enough to actually read.
const HEADINGS = [
  'Creating your playground',
  'Creating your private room',
];
const HEADING_SWITCH_AT_MS = 1050;

const CAPTION_INTERVAL_MS = 1100;
const PARADE_INTERVAL_MS = 600;

// Per-character idle wiggle. Each animation is keyframes that
// resolve back to the rest pose, so when the spotlight rotates
// away the previous avatar lands neutral. Order in the array
// matches PLAYERS — Reginald, Gerald, Bluebot, Buzzilda.
const PARADE_ANIMS = [
  // Reginald 🧙‍♂️ — wand-waving little tilt-and-bob
  { rotate: [0, -14, 12, -8, 0], y: [0, -4, 0, -2, 0], scale: [1, 1.08, 1.04, 1.06, 1] },
  // Gerald 🐸 — hop with squash
  { y: [0, -14, 0, -3, 0], scaleY: [1, 0.85, 1.15, 0.95, 1], scaleX: [1, 1.1, 0.9, 1.05, 1] },
  // Bluebot 🤖 — rigid stutter step
  { x: [0, -3, 3, -2, 2, 0], rotate: [0, 0, 0, 0, 0, 0], scale: [1, 1, 1.05, 1, 1.05, 1] },
  // Buzzilda 🐝 — figure-of-eight buzz
  { x: [0, 6, -6, 4, -4, 0], y: [0, -5, -5, -2, -2, 0], rotate: [0, 8, -8, 4, -4, 0] },
];

export default function WaitingFlourish() {
  const [captionIndex, setCaptionIndex] = useState(0);
  const [activeAvatar, setActiveAvatar] = useState(0);
  const [headingIndex, setHeadingIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCaptionIndex((i) => (i + 1) % CAPTIONS.length);
    }, CAPTION_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveAvatar((i) => (i + 1) % PLAYERS.length);
    }, PARADE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setHeadingIndex(1), HEADING_SWITCH_AT_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="waiting-flourish" role="status" aria-live="polite">
      <div className="waiting-flourish-parade">
        {PLAYERS.map((p, i) => {
          const isActive = i === activeAvatar;
          return (
            <motion.div
              key={p.id}
              className="waiting-flourish-avatar"
              style={{ backgroundColor: p.darkColor, borderColor: p.color }}
              animate={isActive ? PARADE_ANIMS[i] : { x: 0, y: 0, rotate: 0, scale: 1 }}
              transition={
                isActive
                  ? { duration: PARADE_INTERVAL_MS / 1000, ease: 'easeInOut' }
                  : { duration: 0.18 }
              }
            >
              <span className="waiting-flourish-avatar-icon">{p.icon}</span>
            </motion.div>
          );
        })}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={headingIndex}
          className="waiting-flourish-heading"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {HEADINGS[headingIndex]}
        </motion.p>
      </AnimatePresence>
      <motion.p
        key={captionIndex}
        className="waiting-flourish-caption"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        {CAPTIONS[captionIndex]}
      </motion.p>
    </div>
  );
}
