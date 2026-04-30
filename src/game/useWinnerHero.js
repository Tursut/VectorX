// Winner "hero" phase that runs after the trap chain settles and
// before GameOverScreen mounts (issue #60). Plays a short stinger
// and gives the winner a spotlight that holds until the user taps
// "TAP TO CONTINUE" — no auto-dismiss, since rushing through the
// climax of the game is exactly what we don't want.
//
// heroPlaying is DERIVED from props each render — not stored in
// state that has to flip on after mount. Otherwise GameScreen sees
// one render with showGameOver=true (heroPlaying=false initial)
// before any effect could flip it, and the leaderboard mounts
// briefly before the hero takes over.

import { useCallback, useEffect, useRef, useState } from 'react';
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

  const dismissHero = useCallback(() => {
    setHeroEnded(true);
  }, []);

  return { heroPlaying, dismissHero };
}
