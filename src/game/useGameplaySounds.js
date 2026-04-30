// Sound effects driven by gameState transitions. Shared by LocalGameController
// (main game + sandbox) and OnlineGameController so every mode that runs a
// game gets the same sound polish.
//
// Elimination + win/draw sounds stay in GameScreen because they're timed
// against the trap-animation visual state it owns.

import { useEffect, useRef } from 'react';
import { isBotPlayer, shouldRouletteFreezeSwap } from './rouletteCriteria';
import * as sounds from './sounds';

// After phase becomes 'gameover', wait this long before kicking the
// menu loop back in. Covers the win-fanfare sample's natural playback
// (~3 s) so the menu music doesn't trample the cue. Trap-chain
// drawing time is handled separately via the `trapPlaying` flag.
const MENU_RESUME_AFTER_GAMEOVER_MS = 3500;

export function useGameplaySounds(gameState, mySeats = [], { enabled = true, trapPlaying = false, heroPlaying = false } = {}) {
  const prevTurnRef = useRef(null);

  // (iOS audio-recovery listeners now live at module load in sounds.js so
  // they persist across mounts and also catch visibilitychange / focus /
  // pageshow — see issue #17.)

  // Background theme. Two mutually-exclusive tracks:
  //   - in-game (bg-spring) plays while phase === 'playing'
  //   - menu (bg-menu) plays in the start screen / lobby / leaderboard
  // The `enabled` flag (#35) keeps both silent during the pre-game
  // 3-2-1-GO countdown. The `trapPlaying` flag + a post-gameover delay
  // hold the menu music until the trap chain (#36) and the win sound
  // have finished their wind-down — otherwise the menu would kick
  // in over the elimination + fanfare.
  useEffect(() => {
    if (!enabled) {
      sounds.stopBgTheme();
      sounds.stopMenuTheme();
      return undefined;
    }
    // bg-spring keeps playing all the way through the in-game flow:
    //   - phase=='playing'                 (live game)
    //   - phase=='gameover' && trapPlaying (death animation)
    //   - phase=='gameover' && heroPlaying (winner spotlight, #60)
    // Stops only when the leaderboard takes over, so the player
    // doesn't experience a silent "limbo" between the second-to-last
    // death and the leaderboard's fanfare.
    const inGameAudio =
      gameState?.phase === 'playing' ||
      (gameState?.phase === 'gameover' && (trapPlaying || heroPlaying));
    if (inGameAudio) {
      sounds.stopMenuTheme();
      sounds.startBgTheme();
      return undefined;
    }
    sounds.stopBgTheme();
    if (gameState?.phase === 'gameover') {
      // Hero is done; the win fanfare is now playing on GameOverScreen
      // mount. Defer the menu loop so the fanfare gets its full beat.
      const t = setTimeout(() => sounds.startMenuTheme(), MENU_RESUME_AFTER_GAMEOVER_MS);
      return () => clearTimeout(t);
    }
    // Start screen / lobby / null → menu immediately.
    sounds.startMenuTheme();
    return undefined;
  }, [gameState?.phase, enabled, trapPlaying, heroPlaying]);

  // Hard stop on unmount — covers exiting to the start screen, an
  // online disconnect, or the page tearing down. Single mount-only
  // effect so the per-phase effect above can return phase-specific
  // cleanups without losing the unmount guarantee.
  useEffect(() => () => {
    sounds.stopBgTheme();
    sounds.stopMenuTheme();
  }, []);

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
