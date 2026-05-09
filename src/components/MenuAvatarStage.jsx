// Four avatar "bubbles" that cross the start screen on slow,
// random trajectories. Each bubble independently:
//
//   1. Spawns just off one edge of the screen.
//   2. Drifts in a straight line at a random angle to a point
//      just off the OPPOSITE edge — takes 14-22 s.
//   3. Stays off-screen 18-50 s.
//   4. Picks a new trajectory and goes again.
//
// Clicking a visible bubble redirects it: the click position within
// the bubble determines speed (edge = fast, centre = slow) and
// direction (away from where you tapped). The bubble drifts off-screen
// on the new heading, then waits and returns on a fresh random path.
//
// Built with useMotionValue + the standalone animate() so trajectory
// can be interrupted and redirected at any point without remounting
// or AnimatePresence transitions.
//
// prefers-reduced-motion: bubbles never render, no listeners attach.

import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { PLAYERS } from '../game/constants';
import { playPush } from '../game/sounds';

const CROSS_DURATION_MIN_MS = 14_000;
const CROSS_DURATION_MAX_MS = 22_000;
const OFFSCREEN_WAIT_MIN_MS = 18_000;
const OFFSCREEN_WAIT_MAX_MS = 50_000;
const ROTATE_MIN_MS = 8_000;
const ROTATE_MAX_MS = 18_000;
// First-trip stagger buckets, one per bubble.
const FIRST_TRIP_BUCKETS_MS = [
  [300,   1500],
  [5_000,  14_000],
  [15_000, 28_000],
  [25_000, 40_000],
];
const OFFSCREEN_MARGIN_PX = 140;

// Push speed: px/s at the edge vs at the centre of the bubble.
const PUSH_SPEED_EDGE_PX_S  = 140;
const PUSH_SPEED_CENTER_PX_S = 10;
const PUSH_COOLDOWN_MS = 400;

// Clicks on (or inside) any of these elements are ignored so real
// UI interactions are never stolen.
const UI_PASSTHROUGH_SELECTOR =
  'button, a, input, textarea, select, label, ' +
  '[role="button"], [tabindex]:not([tabindex="-1"]), ' +
  '[data-bubble-blocker]';

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randomTrip() {
  const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
  const h = (typeof window !== 'undefined' && window.innerHeight) || 1200;
  const m = OFFSCREEN_MARGIN_PX;
  const edge = Math.floor(Math.random() * 4); // 0=top 1=right 2=bottom 3=left
  const opposite = (edge + 2) % 4;

  const pointOnEdge = (e) => {
    switch (e) {
      case 0: return { x: rand(0, w), y: -m };
      case 1: return { x: w + m,     y: rand(0, h) };
      case 2: return { x: rand(0, w), y: h + m };
      case 3: return { x: -m,        y: rand(0, h) };
      default: return { x: 0, y: 0 };
    }
  };

  return {
    from: pointOnEdge(edge),
    to:   pointOnEdge(opposite),
    durationMs: rand(CROSS_DURATION_MIN_MS, CROSS_DURATION_MAX_MS),
  };
}

// Compute the distance to travel along direction (nx, ny) from
// (fromX, fromY) until the point lands off-screen.
function distToOffscreen(fromX, fromY, nx, ny) {
  const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
  const h = (typeof window !== 'undefined' && window.innerHeight) || 1200;
  const m = OFFSCREEN_MARGIN_PX;
  let d = 200; // minimum
  if (Math.abs(nx) > 0.001) {
    const t = nx > 0 ? (w + m - fromX) / nx : (-m - fromX) / nx;
    if (t > 0) d = Math.max(d, t);
  }
  if (Math.abs(ny) > 0.001) {
    const t = ny > 0 ? (h + m - fromY) / ny : (-m - fromY) / ny;
    if (t > 0) d = Math.max(d, t);
  }
  return d;
}

function FloatingBubble({ player, initialDelayMs, registerBubble }) {
  // MotionValues drive the trajectory — framer-motion sets these as
  // CSS transforms, so getBoundingClientRect() always returns the
  // true on-screen position even mid-animation.
  const mx = useMotionValue(-OFFSCREEN_MARGIN_PX);
  const my = useMotionValue(-OFFSCREEN_MARGIN_PX);
  const mOpacity = useMotionValue(0);

  // Rotation is constant for the bubble's lifetime — independent of
  // trajectory changes. Stored as a ref so it never changes.
  const rotRef = useRef({
    ms:  rand(ROTATE_MIN_MS, ROTATE_MAX_MS),
    dir: Math.random() < 0.5 ? 1 : -1,
  });

  const wrapperRef = useRef(null);
  const animsRef = useRef(null);   // { stop() } handle for current trajectory anim
  const timerRef = useRef(null);
  const cooldownRef = useRef(false);
  const mountedRef = useRef(true);

  // ── Helpers ─────────────────────────────────────────────────────

  function clearTimer() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }

  function stopAnims() {
    animsRef.current?.stop();
    animsRef.current = null;
  }

  // Start a trajectory:
  //   - If natural: jump to from, then animate to to with fade in/out
  //   - If pushed:  animate from current position (no jump) with
  //                 instant-full opacity then fade out near the end
  function startTrajectory(toX, toY, durationMs, options = {}) {
    const { fromX, fromY, natural = false } = options;

    stopAnims();
    clearTimer();

    if (natural) {
      mx.set(fromX);
      my.set(fromY);
      mOpacity.set(0);
    }

    const dur = durationMs / 1000;
    const xa = animate(mx, toX, { duration: dur, ease: 'linear' });
    const ya = animate(my, toY, { duration: dur, ease: 'linear' });
    const oa = animate(
      mOpacity,
      natural ? [0, 1, 1, 0] : [mOpacity.get(), 1, 1, 0],
      {
        duration: dur,
        times: natural ? [0, 0.08, 0.92, 1] : [0, 0.04, 0.88, 1],
        ease: 'linear',
      },
    );
    animsRef.current = { stop: () => { xa.stop(); ya.stop(); oa.stop(); } };

    // After the trajectory completes, wait off-screen then restart.
    timerRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      animsRef.current = null;
      timerRef.current = setTimeout(() => {
        if (mountedRef.current) startNaturalTrip();
      }, rand(OFFSCREEN_WAIT_MIN_MS, OFFSCREEN_WAIT_MAX_MS));
    }, durationMs);
  }

  function startNaturalTrip() {
    const t = randomTrip();
    startTrajectory(t.to.x, t.to.y, t.durationMs, {
      fromX: t.from.x,
      fromY: t.from.y,
      natural: true,
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  useEffect(() => {
    timerRef.current = setTimeout(startNaturalTrip, initialDelayMs);
    return () => {
      mountedRef.current = false;
      stopAnims();
      clearTimer();
    };
    // startNaturalTrip is defined in the closure — no external deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDelayMs]);

  // ── Push registration ────────────────────────────────────────────

  useEffect(() => {
    return registerBubble({
      getRect: () => wrapperRef.current?.getBoundingClientRect() ?? null,

      applyPush(clickX, clickY) {
        if (cooldownRef.current) return;
        cooldownRef.current = true;
        setTimeout(() => { cooldownRef.current = false; }, PUSH_COOLDOWN_MS);

        const rect = wrapperRef.current?.getBoundingClientRect();
        if (!rect) return;

        const bx = rect.left + rect.width / 2;
        const by = rect.top + rect.height / 2;
        const r  = rect.width / 2;

        // Direction away from tap point.
        const dx = bx - clickX;
        const dy = by - clickY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Speed: edge tap → fast, centre tap → slow.
        const proximity = Math.min(dist / r, 1); // 0=centre, 1=edge
        const speed = PUSH_SPEED_CENTER_PX_S +
          proximity * (PUSH_SPEED_EDGE_PX_S - PUSH_SPEED_CENTER_PX_S);

        // Unit vector pointing away from tap.
        const norm = dist > 0 ? dist : 1;
        const nx = dx / norm;
        const ny = dy / norm;

        // Current position (wrapper top-left in viewport coords).
        const fromX = rect.left;
        const fromY = rect.top;

        const travel  = distToOffscreen(fromX, fromY, nx, ny);
        const toX     = fromX + nx * travel;
        const toY     = fromY + ny * travel;
        const durMs   = Math.max((travel / speed) * 1000, 600);

        startTrajectory(toX, toY, durMs);
        playPush();
      },
    });
    // registerBubble is stable (created in useState init)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerBubble]);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <motion.div
      ref={wrapperRef}
      className="menu-avatar-bubble-wrapper"
      style={{ x: mx, y: my, opacity: mOpacity }}
    >
      <motion.div
        className="menu-avatar-bubble"
        style={{ backgroundColor: player.darkColor, borderColor: player.color }}
        animate={{ rotate: rotRef.current.dir * 360 }}
        transition={{
          duration: rotRef.current.ms / 1000,
          repeat: Infinity,
          ease: 'linear',
        }}
      >
        <span className="menu-avatar-bubble-icon">{player.icon}</span>
      </motion.div>
    </motion.div>
  );
}

export default function MenuAvatarStage() {
  const prefersReducedMotion = useReducedMotion();

  const [initialDelays] = useState(() => {
    const shuffled = [...FIRST_TRIP_BUCKETS_MS].sort(() => Math.random() - 0.5);
    return PLAYERS.map((_, i) => rand(shuffled[i][0], shuffled[i][1]));
  });

  const bubblesRef = useRef([]);

  const [registerCallbacks] = useState(() =>
    PLAYERS.map((_, i) => (api) => {
      bubblesRef.current[i] = api;
      return () => { bubblesRef.current[i] = null; };
    }),
  );

  useEffect(() => {
    if (prefersReducedMotion) return;

    function handleClick(e) {
      if (e.target.closest(UI_PASSTHROUGH_SELECTOR)) return;

      const cx = e.clientX;
      const cy = e.clientY;

      for (const api of bubblesRef.current) {
        if (!api) continue;
        const rect = api.getRect();
        if (!rect) continue;

        const bx = rect.left + rect.width / 2;
        const by = rect.top + rect.height / 2;
        const r  = rect.width / 2;
        const dx = cx - bx;
        const dy = cy - by;

        if (dx * dx + dy * dy <= r * r) {
          // Pass raw click coords; the bubble computes direction from
          // its own centre so it always uses the latest position.
          api.applyPush(cx, cy);
          break; // one bubble per click
        }
      }
    }

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return (
    <div className="menu-avatar-stage" aria-hidden="true">
      {PLAYERS.map((p, i) => (
        <FloatingBubble
          key={p.id}
          player={p}
          initialDelayMs={initialDelays[i]}
          registerBubble={registerCallbacks[i]}
        />
      ))}
    </div>
  );
}
