// Sound effects driven by gameState transitions. Shared by LocalGameController
// (main game + sandbox) and OnlineGameController so every mode that runs a
// game gets the same sound polish.
//
// Elimination + win/draw sounds stay in GameScreen because they're timed
// against the trap-animation visual state it owns.

import { useEffect, useRef } from 'react';
import { isBotPlayer, shouldRouletteFreezeSwap } from './rouletteCriteria';
import * as sounds from './sounds';

export function useGameplaySounds(
  gameState,
  mySeats = [],
  {
    enabled = true,
    trapPlaying = false,
    heroPlaying = false,
    heroMusicCutRequested = false,
    heroMenuWarmupActive = false,
  } = {},
) {
  const prevTurnRef = useRef(null);

  // (iOS audio-recovery listeners now live at module load in sounds.js so
  // they persist across mounts and also catch visibilitychange / focus /
  // pageshow — see issue #17.)

  // Background theme. Two mutually-exclusive tracks:
  //   - in-game (bg-spring) plays while phase === 'playing'
  //   - menu (bg-menu) plays in the start screen / lobby / leaderboard
  // The `enabled` flag (#35) keeps both silent during the pre-game
  // 3-2-1-GO countdown. The `trapPlaying` + `heroPlaying` flags hold
  // the menu music until trap chain (#36) and winner hero are done.
  // Winner hero handoff (#66):
  //   1) very fast bg cut right before fanfare
  //   2) 2s silent gap under the fanfare tail
  //   3) menu theme starts (from start) while still on hero/leaderboard
  useEffect(() => {
    if (!enabled) {
      sounds.stopBgTheme();
      sounds.stopMenuTheme();
      return undefined;
    }
    const phase = gameState?.phase;
    const hasWinner = gameState?.winner !== null && gameState?.winner !== undefined;
    const winnerHandoffWaiting =
      phase === 'gameover' &&
      hasWinner &&
      heroMusicCutRequested &&
      !heroMenuWarmupActive;
    // bg-spring keeps playing all the way through the in-game flow:
    //   - phase=='playing'                 (live game)
    //   - phase=='gameover' && trapPlaying (death animation)
    //   - phase=='gameover' && heroPlaying && !heroMusicCutRequested
    //     (winner spotlight before fanfare handoff #66)
    // Stops only when the leaderboard takes over, so the player
    // doesn't experience a silent "limbo" between the second-to-last
    // death and the fanfare handoff.
    const inGameAudio =
      phase === 'playing' ||
      (phase === 'gameover' && (trapPlaying || (heroPlaying && !heroMusicCutRequested)));
    if (inGameAudio) {
      sounds.stopMenuTheme();
      sounds.startBgTheme();
      return undefined;
    }
    if (winnerHandoffWaiting) {
      sounds.stopBgTheme();
      sounds.stopMenuTheme();
      return undefined;
    }
    sounds.stopBgTheme();
    // Start screen / lobby / post-handoff hero / leaderboard → menu.
    sounds.startMenuTheme();
    return undefined;
  }, [gameState?.phase, gameState?.winner, enabled, trapPlaying, heroPlaying, heroMusicCutRequested, heroMenuWarmupActive]);

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
