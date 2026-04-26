// Sound effects driven by gameState transitions. Shared by LocalGameController
// (main game + sandbox) and OnlineGameController so every mode that runs a
// game gets the same sound polish.
//
// Elimination + win/draw sounds stay in GameScreen because they're timed
// against the trap-animation visual state it owns.

import { useEffect, useRef } from 'react';
import { isBotPlayer, shouldRouletteFreezeSwap } from './rouletteCriteria';
import * as sounds from './sounds';

export function useGameplaySounds(gameState, mySeats = [], { enabled = true } = {}) {
  const prevTurnRef = useRef(null);

  // (iOS audio-recovery listeners now live at module load in sounds.js so
  // they persist across mounts and also catch visibilitychange / focus /
  // pageshow — see issue #17.)

  // Background theme. Cleanup on unmount silences the theme when the
  // controller unmounts without ever transitioning to a non-'playing' phase
  // (e.g. gameState reset to null on exit).
  // The `enabled` flag lets OnlineGameController hold the music until
  // the pre-game 3-2-1-GO countdown finishes (issue #35) — otherwise
  // the bg theme starts kicking under the overlay the moment the
  // server's first GAME_STATE arrives.
  useEffect(() => {
    if (enabled && gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
    return () => sounds.stopBgTheme();
  }, [gameState?.phase, enabled]);

  // Freeze / swap apply sounds moved to useDerivedAnimations#fireImmediate
  // so they line up with the deferred visual after the bot-pick roulette
  // (issue #30). Human picks fall through the same fireImmediate path
  // and so still fire at the same wall-clock moment as before.

  // Move + claim on turn change; your-turn chime when a seat I control is up.
  // Gated on `enabled` so the chime + thump don't fire under the
  // pre-game countdown overlay (issue #35).
  useEffect(() => {
    if (!enabled) return;
    if (!gameState || gameState.phase !== 'playing') return;
    const seat = gameState.currentPlayerIndex;
    if (prevTurnRef.current !== null && prevTurnRef.current !== seat) {
      const prevPlayer = gameState.players[prevTurnRef.current];
      // Skip the per-turn move/claim thump when the just-completed turn
      // ended in a bot-driven freeze/swap that the client will roulette
      // over (issue #31). For freeze the actor doesn't actually change
      // cells, and for swap the visual exchange is deferred until after
      // the wheel — so a thump at the start of the roulette is a stray
      // sound. The freeze fly-in / swap flash brings its own apply
      // sound at the end of the wheel via useDerivedAnimations.
      if (!shouldRouletteFreezeSwap(gameState, gameState.lastEvent)) {
        sounds.playMove(isBotPlayer(gameState, prevPlayer));
        setTimeout(() => sounds.playClaim(), 200);
      }
    }
    prevTurnRef.current = seat;
    if (mySeats.includes(seat)) sounds.playYourTurn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.currentPlayerIndex, gameState?.phase, enabled]);
}
