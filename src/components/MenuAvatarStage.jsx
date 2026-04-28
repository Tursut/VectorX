// Four floating avatar "bubbles" that hover at the edges of the
// start menu. All four visible at all times — each drifts on its
// own slow keyframe loop and rotates continuously, like balloons
// caught in a gentle current. Background-only: pointer-events
// none + low z-index so they never compete with the heroes.
//
// Future possibilities (not in this version):
//   - Gravity / physics so they bump into each other
//   - Click to burst
//   - React to cursor proximity
//
// prefers-reduced-motion freezes all motion to the rest pose.

import { motion, useReducedMotion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

// Per-character drift path. Each one stays inside its own corner
// zone so all four are always in sight. Paths are mirrored
// keyframes that loop forever; framer-motion handles the
// interpolation with `ease: 'easeInOut'`. Rotation values use
// linear ease so spin is steady.
//
// Order matches PLAYERS — Reginald, Gerald, Bluebot, Buzzilda.
const FLOAT_CONFIGS = [
  // Reginald 🧙‍♂️ — top-left, slow ethereal sway. Rotates CCW.
  {
    anchor: { top: '10%', left: '4%' },
    drift: {
      x: [0, 36, 18, -8, -22, 0],
      y: [0, 18, 38, 22, 8, 0],
    },
    driftDuration: 36,
    rotate: [0, -360],
    rotateDuration: 32,
  },
  // Gerald 🐸 — bottom-left, more vertical bob. Gentle wobble.
  {
    anchor: { bottom: '14%', left: '6%' },
    drift: {
      x: [0, 14, 28, 8, -10, 0],
      y: [0, -22, -8, -32, -12, 0],
    },
    driftDuration: 30,
    rotate: [-12, 12, -12],
    rotateDuration: 7,
  },
  // Bluebot 🤖 — bottom-right, linear-feeling rectangular path.
  // Rotates fully but slowly, like a satellite.
  {
    anchor: { bottom: '12%', right: '5%' },
    drift: {
      x: [0, -28, -32, -10, 6, 0],
      y: [0, -10, -28, -36, -12, 0],
    },
    driftDuration: 40,
    rotate: [0, 360],
    rotateDuration: 44,
  },
  // Buzzilda 🐝 — top-right, wider figure-eight. Bee energy.
  {
    anchor: { top: '12%', right: '4%' },
    drift: {
      x: [0, -28, 6, -32, -8, 0],
      y: [0, 24, 12, 32, 16, 0],
    },
    driftDuration: 26,
    rotate: [0, -180, 0, 180, 0],
    rotateDuration: 18,
  },
];

export default function MenuAvatarStage() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="menu-avatar-stage" aria-hidden="true">
      {PLAYERS.map((p, i) => {
        const cfg = FLOAT_CONFIGS[i];
        return (
          <div
            key={p.id}
            className="menu-avatar-anchor"
            style={cfg.anchor}
          >
            <motion.div
              className="menu-avatar-bubble"
              style={{ backgroundColor: p.darkColor, borderColor: p.color }}
              animate={
                prefersReducedMotion
                  ? { x: 0, y: 0, rotate: 0 }
                  : {
                      x: cfg.drift.x,
                      y: cfg.drift.y,
                      rotate: cfg.rotate,
                    }
              }
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : {
                      x: { duration: cfg.driftDuration, repeat: Infinity, ease: 'easeInOut' },
                      y: { duration: cfg.driftDuration, repeat: Infinity, ease: 'easeInOut' },
                      rotate: { duration: cfg.rotateDuration, repeat: Infinity, ease: 'linear' },
                    }
              }
            >
              <span className="menu-avatar-bubble-icon">{p.icon}</span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
