// Winner "hero" phase that runs after the trap chain settles and
// before GameOverScreen mounts (issue #60). Gives the winner a
// spotlight that holds until the user taps
// "TAP TO CONTINUE" — no auto-dismiss, since rushing through the
// climax of the game is exactly what we don't want.
//
// heroPlaying is DERIVED from state each render — not a simple boolean
// expression. The one-render gap between when phase becomes 'gameover'
// and when useTrapChain's detection effect queues the death means
// trapPlaying is briefly false on that first render even though a trap
// animation is about to start. Without the readyForHero guard, heroPlaying
// would flip true on that first render, WinnerHero would mount and play the
// fanfare, then immediately unmount when trapPlaying becomes true — and play
// again when the animation finally completes (double fanfare).
//
// readyForHero uses setTimeout(0) so it becomes true only in the macrotask
// after the gameover render, by which point the trap detection effect has
// already queued any pending deaths and trapPlaying reflects the real state.

import { useCallback, useEffect, useState } from 'react';

export function useWinnerHero(gameState, trapPlaying) {
  const [heroEnded, setHeroEnded] = useState(false);
  const [readyForHero, setReadyForHero] = useState(false);

  const phase = gameState?.phase;
  const winner = gameState?.winner;
  const hasWinner = winner !== null && winner !== undefined;

  // Gate heroPlaying on readyForHero so the one-render window where
  // trapPlaying is momentarily false right after gameover can't cause an
  // early hero mount. The setTimeout(0) ensures the macrotask fires after
  // the trap detection effect has populated the queue. StrictMode's
  // synchronous cleanup cancels the timer on the fake mount so only the
  // real mount schedules the timer — preventing a spurious double-fire.
  useEffect(() => {
    if (phase !== 'gameover' || !hasWinner) {
      setReadyForHero(false);
      return undefined;
    }
    const t = setTimeout(() => setReadyForHero(true), 0);
    return () => {
      clearTimeout(t);
      setReadyForHero(false);
    };
  }, [phase, hasWinner]);

  // Reset heroEnded on game restart so the next game shows the hero again.
  useEffect(() => {
    if (phase !== 'gameover') setHeroEnded(false);
  }, [phase]);

  const heroPlaying =
    phase === 'gameover' && hasWinner && !trapPlaying && !heroEnded && readyForHero;

  const dismissHero = useCallback(() => {
    setHeroEnded(true);
  }, []);

  return { heroPlaying, dismissHero, heroEnded };
}
