// Winner "hero" phase that runs after the trap chain settles and before
// GameOverScreen mounts (issue #60). Plays the win sound and gives the
// winner a 1 s spotlight so the climactic moment isn't a positive +
// negative animation cross-fade.
//
// Single-fire per game: a ref tracks whether we already triggered the
// hero for the current gameover. Resetting the game (phase moves away
// from 'gameover') clears the latch so a restart works.

import { useEffect, useRef, useState } from 'react';
import { HERO_HOLD_MS } from './constants';
import * as sounds from './sounds';

export function useWinnerHero(gameState, trapPlaying) {
  const [heroPlaying, setHeroPlaying] = useState(false);
  const firedRef = useRef(false);
  const timerRef = useRef(null);

  const phase = gameState?.phase;
  const winner = gameState?.winner;
  const hasWinner = winner !== null && winner !== undefined;

  useEffect(() => {
    if (phase !== 'gameover') {
      firedRef.current = false;
      return;
    }
    if (!hasWinner) return;
    if (trapPlaying) return;
    if (firedRef.current) return;
    firedRef.current = true;
    setHeroPlaying(true);
    sounds.playWin();
    timerRef.current = setTimeout(() => {
      setHeroPlaying(false);
    }, HERO_HOLD_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [phase, hasWinner, trapPlaying]);

  return { heroPlaying };
}
