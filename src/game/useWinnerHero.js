// Winner "hero" phase that runs after the trap chain settles and before
// GameOverScreen mounts (issue #60). Plays a short stinger and gives
// the winner a 2 s spotlight before the leaderboard takes over.
//
// heroPlaying is DERIVED from props each render — not stored in state
// that has to flip on after mount. Otherwise AnimatePresence in
// GameScreen sees one render with showGameOver=true (heroPlaying=false
// initial) before the effect would flip it, and mode="wait" gets
// confused by the rapid key swap. Deriving means the very first render
// where trap settles already has showHero=true, so the user sees the
// hero from frame one.

import { useEffect, useRef, useState } from 'react';
import { HERO_HOLD_MS } from './constants';
import * as sounds from './sounds';

export function useWinnerHero(gameState, trapPlaying) {
  const [heroEnded, setHeroEnded] = useState(false);

  const phase = gameState?.phase;
  const winner = gameState?.winner;
  const hasWinner = winner !== null && winner !== undefined;

  const heroPlaying =
    phase === 'gameover' && hasWinner && !trapPlaying && !heroEnded;

  // Reset the latch on game restart (phase moves away from gameover).
  useEffect(() => {
    if (phase !== 'gameover') setHeroEnded(false);
  }, [phase]);

  // Fire the stinger once per game-over, the moment heroPlaying flips
  // true. The ref latch survives re-renders that don't change phase.
  const stingerFiredRef = useRef(false);
  useEffect(() => {
    if (phase !== 'gameover') {
      stingerFiredRef.current = false;
      return;
    }
    if (!heroPlaying) return;
    if (stingerFiredRef.current) return;
    stingerFiredRef.current = true;
    sounds.playWinStinger();
  }, [heroPlaying, phase]);

  // End the hero phase after HERO_HOLD_MS. The timeout is keyed only on
  // heroPlaying, so unrelated dep churn can't cancel it without
  // rescheduling.
  useEffect(() => {
    if (!heroPlaying) return;
    const t = setTimeout(() => setHeroEnded(true), HERO_HOLD_MS);
    return () => clearTimeout(t);
  }, [heroPlaying]);

  return { heroPlaying };
}
