// Waiting indicator while CREATE ROOM is in flight (POST /rooms + WS handshake).
// Avatar parade — four characters in a row, one wiggle at a time — plus a
// static heading/subtitle. Mounted inline in StartScreen's bottom bar.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const PARADE_INTERVAL_MS = 600;

// Per-character idle wiggle. Each animation is keyframes that
// resolve back to the rest pose, so when the spotlight rotates
// away the previous avatar lands neutral. Order in the array
// matches PLAYERS — Reginald, Gerald, Bluebot, Buzzilda.
const PARADE_ANIMS = [
  // Reginald — wand-waving little tilt-and-bob
  { rotate: [0, -14, 12, -8, 0], y: [0, -4, 0, -2, 0], scale: [1, 1.08, 1.04, 1.06, 1] },
  // Gerald — hop with squash
  { y: [0, -14, 0, -3, 0], scaleY: [1, 0.85, 1.15, 0.95, 1], scaleX: [1, 1.1, 0.9, 1.05, 1] },
  // Bluebot — rigid stutter step
  { x: [0, -3, 3, -2, 2, 0], rotate: [0, 0, 0, 0, 0, 0], scale: [1, 1, 1.05, 1, 1.05, 1] },
  // Buzzilda — figure-of-eight buzz
  { x: [0, 6, -6, 4, -4, 0], y: [0, -5, -5, -2, -2, 0], rotate: [0, 8, -8, 4, -4, 0] },
];

export default function WaitingFlourish() {
  const [activeAvatar, setActiveAvatar] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveAvatar((i) => (i + 1) % PLAYERS.length);
    }, PARADE_INTERVAL_MS);
    return () => clearInterval(id);
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
      <p className="waiting-flourish-heading">Creating private room</p>
      <p className="waiting-flourish-caption">We are soon there...</p>
    </div>
  );
}
