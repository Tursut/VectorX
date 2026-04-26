// Sound effects driven by gameState transitions. Shared by LocalGameController
// (main game + sandbox) and OnlineGameController so every mode that runs a
// game gets the same sound polish.
//
// Elimination + win/draw sounds stay in GameScreen because they're timed
// against the trap-animation visual state it owns.

import { useEffect, useRef } from 'react';
import { PLAYERS } from './constants';
import * as sounds from './sounds';

function isBotPlayer(gameState, player) {
  if (!player) return false;
  if (player.isBot !== undefined) return player.isBot;
  const gc = gameState?.gremlinCount ?? 0;
  return player.id >= PLAYERS.length - gc;
}

export function useGameplaySounds(gameState, mySeats = []) {
  const prevTurnRef = useRef(null);

  // (iOS audio-recovery listeners now live at module load in sounds.js so
  // they persist across mounts and also catch visibilitychange / focus /
  // pageshow — see issue #17.)

  // Background theme. Cleanup on unmount silences the theme when the
  // controller unmounts without ever transitioning to a non-'playing' phase
  // (e.g. gameState reset to null on exit).
  useEffect(() => {
    if (gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
    return () => sounds.stopBgTheme();
  }, [gameState?.phase]);

  // Freeze / swap apply sounds moved to useDerivedAnimations#fireImmediate
  // so they line up with the deferred visual after the bot-pick roulette
  // (issue #30). Human picks fall through the same fireImmediate path
  // and so still fire at the same wall-clock moment as before.

  // Move + claim on turn change; your-turn chime when a seat I control is up.
  useEffect(() => {
    if (!gameState || gameState.phase !== 'playing') return;
    const seat = gameState.currentPlayerIndex;
    if (prevTurnRef.current !== null && prevTurnRef.current !== seat) {
      const prevPlayer = gameState.players[prevTurnRef.current];
      sounds.playMove(isBotPlayer(gameState, prevPlayer));
      setTimeout(() => sounds.playClaim(), 200);
    }
    prevTurnRef.current = seat;
    if (mySeats.includes(seat)) sounds.playYourTurn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.currentPlayerIndex, gameState?.phase]);
}
