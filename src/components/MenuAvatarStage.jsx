// Four avatar "bubbles" that cross the start screen on slow,
// random trajectories. Each bubble independently:
//
//   1. Spawns just off one edge of the screen.
//   2. Drifts in a straight line at a random angle to a point
//      just off the OPPOSITE edge — takes 14-22 s.
//   3. Stays off-screen 18-50 s.
//   4. Picks a new trajectory and goes again.
//
// Cycles are heavily staggered so usually only one or two are
// visible at a time (sometimes none). Continuous rotation runs
// through the whole trip. Background-only: pointer-events none
// + z-index 0 so they sit behind every UI element.
//
// Future possibilities (not in this version):
//   - Gravity / physics so they bump into each other
//   - Click to burst
//   - React to cursor proximity
//
// prefers-reduced-motion freezes everything (the bubbles never
// render at all).

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PLAYERS } from '../game/constants';

const CROSS_DURATION_MIN_MS = 14_000;
const CROSS_DURATION_MAX_MS = 22_000;
const OFFSCREEN_WAIT_MIN_MS = 18_000;
const OFFSCREEN_WAIT_MAX_MS = 50_000;
const INITIAL_STAGGER_MAX_MS = 40_000;
const ROTATE_MIN_MS = 8_000;
const ROTATE_MAX_MS = 18_000;
// How far past the screen edge the bubble starts / ends. Has to
// exceed the bubble's rendered size so it's fully hidden when
// off-screen.
const OFFSCREEN_MARGIN_PX = 140;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// Build a random crossing trajectory: enter from one edge, exit
// from the opposite edge at a random point. Coordinates are
// pixels relative to the stage's top-left.
function randomTrip() {
  const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
  const h = (typeof window !== 'undefined' && window.innerHeight) || 1200;
  const m = OFFSCREEN_MARGIN_PX;
  const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
  const opposite = (edge + 2) % 4;

  const pointOnEdge = (e) => {
    switch (e) {
      case 0: return { x: rand(0, w),     y: -m };
      case 1: return { x: w + m,          y: rand(0, h) };
      case 2: return { x: rand(0, w),     y: h + m };
      case 3: return { x: -m,             y: rand(0, h) };
      default: return { x: 0, y: 0 };
    }
  };

  return {
    id: Math.random(),
    from: pointOnEdge(edge),
    to: pointOnEdge(opposite),
    durationMs: rand(CROSS_DURATION_MIN_MS, CROSS_DURATION_MAX_MS),
    rotateMs: rand(ROTATE_MIN_MS, ROTATE_MAX_MS),
    rotateDir: Math.random() < 0.5 ? 1 : -1,
  };
}

function FloatingBubble({ player }) {
  // null = off-screen / not rendered. Set to a trip object while
  // crossing. Each new trip gets a fresh `id` so the motion.div
  // remounts and replays initial → animate cleanly.
  const [trip, setTrip] = useState(null);

  useEffect(() => {
    let mounted = true;
    let timer = null;

    const startTrip = () => {
      if (!mounted) return;
      const t = randomTrip();
      setTrip(t);
      timer = setTimeout(() => {
        if (!mounted) return;
        setTrip(null);
        timer = setTimeout(startTrip, rand(OFFSCREEN_WAIT_MIN_MS, OFFSCREEN_WAIT_MAX_MS));
      }, t.durationMs);
    };

    timer = setTimeout(startTrip, rand(0, INITIAL_STAGGER_MAX_MS));

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <AnimatePresence>
      {trip && (
        <motion.div
          key={trip.id}
          className="menu-avatar-bubble-wrapper"
          // Linear motion across the screen. Opacity fades in then
          // out at the very ends of the trip so the bubble doesn't
          // hard-snap into view at the screen edge.
          initial={{ x: trip.from.x, y: trip.from.y, opacity: 0 }}
          animate={{
            x: trip.to.x,
            y: trip.to.y,
            opacity: [0, 1, 1, 0],
          }}
          exit={{ opacity: 0 }}
          transition={{
            x: { duration: trip.durationMs / 1000, ease: 'linear' },
            y: { duration: trip.durationMs / 1000, ease: 'linear' },
            opacity: {
              duration: trip.durationMs / 1000,
              times: [0, 0.08, 0.92, 1],
              ease: 'linear',
            },
          }}
        >
          <motion.div
            className="menu-avatar-bubble"
            style={{ backgroundColor: player.darkColor, borderColor: player.color }}
            animate={{ rotate: trip.rotateDir * 360 }}
            transition={{
              duration: trip.rotateMs / 1000,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            <span className="menu-avatar-bubble-icon">{player.icon}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function MenuAvatarStage() {
  const prefersReducedMotion = useReducedMotion();
  if (prefersReducedMotion) return null;

  return (
    <div className="menu-avatar-stage" aria-hidden="true">
      {PLAYERS.map((p) => (
        <FloatingBubble key={p.id} player={p} />
      ))}
    </div>
  );
}
