// Winner "hero" phase that runs after the trap chain settles and before
// GameOverScreen mounts (issue #60). Plays the win sound and gives the
// winner a 1 s spotlight so the climactic moment isn't a positive +
// negative animation cross-fade.
//
// Three small effects, each with one job:
//   1. Reset the single-fire latch when phase moves away from gameover
//      (so a restart triggers the hero again).
//   2. Trigger the hero phase: flip heroPlaying true + fire the win
//      sound the moment trap finishes on a gameover-with-winner.
//   3. Auto-end the hero phase after HERO_HOLD_MS, with a clean
//      timeout that's only gated on heroPlaying — so unrelated dep
//      churn (gameState references, etc.) can't cancel it.

import { useEffect, useRef, useState } from 'react';
import { HERO_HOLD_MS } from './constants';
import * as sounds from './sounds';

export function useWinnerHero(gameState, trapPlaying) {
  const [heroPlaying, setHeroPlaying] = useState(false);
  const firedRef = useRef(false);

  const phase = gameState?.phase;
  const winner = gameState?.winner;
  const hasWinner = winner !== null && winner !== undefined;

  useEffect(() => {
    if (phase !== 'gameover') firedRef.current = false;
  }, [phase]);

  useEffect(() => {
    if (phase !== 'gameover') return;
    if (!hasWinner) return;
    if (trapPlaying) return;
    if (firedRef.current) return;
    firedRef.current = true;
    setHeroPlaying(true);
    sounds.playWinStinger();
  }, [phase, hasWinner, trapPlaying]);

  useEffect(() => {
    if (!heroPlaying) return;
    const t = setTimeout(() => setHeroPlaying(false), HERO_HOLD_MS);
    return () => clearTimeout(t);
  }, [heroPlaying]);

  return { heroPlaying };
}
