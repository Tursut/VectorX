// Shared corner trajectories for Tap to Begin + WaitingFlourish avatar fly-in/out.

export const FLY_IN_STARTS = [
  { x: -260, y: -180, rotate: -240 },
  { x: 260, y: -180, rotate: 240 },
  { x: -260, y: 180, rotate: 360 },
  { x: 260, y: 180, rotate: -540 },
];

/** Framer Motion `exit` for outer avatar fly wrapper — keep in sync across callers. */
export function avatarFlyExit(i) {
  const s = FLY_IN_STARTS[i];
  return {
    x: s.x,
    y: s.y,
    rotate: s.rotate,
    scale: 0.5,
    transition: {
      duration: 0.5,
      ease: [0.7, 0, 0.84, 0],
      delay: i * 0.05,
    },
  };
}
