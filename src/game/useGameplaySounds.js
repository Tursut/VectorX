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

  // iOS audio recovery: resume context on any user interaction.
  useEffect(() => {
    const resume = () => sounds.resumeAudio();
    document.addEventListener('touchstart', resume, { passive: true });
    document.addEventListener('touchend',   resume, { passive: true });
    document.addEventListener('click',      resume);
    return () => {
      document.removeEventListener('touchstart', resume, { passive: true });
      document.removeEventListener('touchend',   resume, { passive: true });
      document.removeEventListener('click',      resume);
    };
  }, []);

  // Background theme. Cleanup on unmount silences the theme when the
  // controller unmounts without ever transitioning to a non-'playing' phase
  // (e.g. gameState reset to null on exit).
  useEffect(() => {
    if (gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
    return () => sounds.stopBgTheme();
  }, [gameState?.phase]);

  // Freeze / swap event sounds — fire when the move that triggered them lands.
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev) return;
    if (ev.type === 'freeze') sounds.playFreeze();
    else if (ev.type === 'swap') sounds.playSwap();
  }, [gameState?.lastEvent]);

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
