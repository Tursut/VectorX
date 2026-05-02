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
    heroEnded = false,
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
  // 3-2-1-GO countdown. `trapPlaying` and winner-hero `heroEnded` / cut
  // flags hold the menu music until trap chain (#36) and fanfare are done.
  // Winner hero handoff (#66):
  //   1) very fast bg cut right before fanfare
  //   2) 2s silent gap under the fanfare tail
  //   3) menu theme starts (from start) while still on hero/leaderboard
  // sounds.js latches bg starts after stopBgThemeFast until menu wins or
  // a new playing phase clears it — avoids one stray startBgTheme restart.
  useEffect(() => {
    if (gameState?.phase === 'playing') {
      sounds.clearBgStartSuppressionAfterWinnerFanfare();
    }
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
    // Winner + fanfare: keep spring for the whole post-game arc until the
    // fanfare cut or leaderboard — not only when heroPlaying is true. There
    // is often a frame (trap just cleared, readyForHero not yet true) where
    // trapPlaying and heroPlaying are both false; treating that as "menu"
    // stops spring and starts menu, then the next frame restarts spring.
    const winnerSpringHold =
      phase === 'gameover' &&
      hasWinner &&
      !heroEnded &&
      !heroMusicCutRequested;
    const drawTrapHold =
      phase === 'gameover' && !hasWinner && trapPlaying;
    const inGameAudio =
      phase === 'playing' || winnerSpringHold || drawTrapHold;
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
  }, [
    gameState?.phase,
    gameState?.winner,
    enabled,
    trapPlaying,
    heroEnded,
    heroMusicCutRequested,
    heroMenuWarmupActive,
  ]);

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
