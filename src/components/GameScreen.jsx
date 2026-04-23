// Shared in-game renderer used by both LocalGameController (hotseat) and
// OnlineGameController (multiplayer). Owns everything that only depends on
// gameState + a "which seats do I control" concept:
//
//   - Rendering: PlayerPanel, TurnIndicator, GameBoard, GameOverScreen
//   - Sound effects driven by state transitions
//   - The trapped/death animation chain + its elimination sound
//   - Win/draw sound (gated on trap animation finishing)
//
// Mode-specific concerns (start screen, lobby, pre-game countdown, turn timer,
// bot driving, sandbox panel, connection status, exit-confirm modal) stay in
// the outer controllers.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS, TURN_TAUNTS, TURN_TIME } from '../game/constants';
import { getCurrentValidMoves } from '../game/logic';
import * as sounds from '../game/sounds';
import PlayerPanel from './PlayerPanel';
import TurnIndicator from './TurnIndicator';
import GameBoard from './GameBoard';
import GameOverScreen from './GameOverScreen';

// Bot detection works for both shapes: online wire carries `isBot` per player;
// local state has `gremlinCount` at the top-level. Sandbox only has 2 players
// so `currentPlayerIndex` (index) != `player.id` — prefer passing the player.
function isBotPlayer(gameState, player) {
  if (!player) return false;
  if (player.isBot !== undefined) return player.isBot;
  const gc = gameState?.gremlinCount ?? 0;
  return player.id >= PLAYERS.length - gc;
}

export default function GameScreen({
  gameState,
  mySeats = [],
  onMove,
  onExit,
  onRestart = null,
  soundEnabled = true,
  onToggleSound,
  // Optional overrides supplied by LocalGameController; online passes defaults.
  isThinking = false,
  timeLeft = TURN_TIME,
  totalTime = TURN_TIME,
  // Animation props — still owned by local for now (Phase 2 will move them here).
  bombBlast = null,
  portalJump = null,
  swapFlash = null,
  flyingFreeze = null,
}) {
  const [trappedPlayers, setTrappedPlayers] = useState([]);
  const [eliminationPending, setEliminationPending] = useState(false);
  const prevPlayersRef = useRef(null);
  const prevTurnRef = useRef(null);
  const trappedTimerRef = useRef(null);

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

  // Background theme.
  useEffect(() => {
    if (gameState?.phase === 'playing') sounds.startBgTheme();
    else sounds.stopBgTheme();
  }, [gameState?.phase]);

  // Freeze / swap sound on event.
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

  // Trap / death animation chain: detect false→true transitions on
  // isEliminated, wait 450ms, set `trappedPlayers` (drives GameBoard animation)
  // and play elimination sound; clear the state 2.5s later.
  useEffect(() => {
    if (!gameState?.players) { prevPlayersRef.current = null; return; }
    if (prevPlayersRef.current) {
      const newlyTrapped = [];
      gameState.players.forEach((p, i) => {
        const prev = prevPlayersRef.current[i];
        if (prev && p.isEliminated && !prev.isEliminated) {
          const isHuman = !isBotPlayer(gameState, p);
          const humanAlive = gameState.players.some(
            (q) => !q.isEliminated && !isBotPlayer(gameState, q),
          );
          if (isHuman || humanAlive) {
            newlyTrapped.push({
              id: p.id,
              row: p.deathCell?.row ?? prev.row,
              col: p.deathCell?.col ?? prev.col,
            });
          }
        }
      });
      if (newlyTrapped.length > 0) {
        setEliminationPending(true);
        clearTimeout(trappedTimerRef.current);
        trappedTimerRef.current = setTimeout(() => {
          setEliminationPending(false);
          setTrappedPlayers(newlyTrapped);
          sounds.playElimination();
          trappedTimerRef.current = setTimeout(() => {
            setTrappedPlayers([]);
          }, 2500);
        }, 450);
      }
    }
    prevPlayersRef.current = gameState.players;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.players]);

  // Win / draw sound — plays once the trap animation has cleared.
  useEffect(() => {
    if (gameState?.phase !== 'gameover') return;
    if (trappedPlayers.length > 0 || eliminationPending) return;
    if (gameState.winner !== null) sounds.playWin();
    else sounds.playDraw();
  }, [gameState?.phase, trappedPlayers, eliminationPending, gameState?.winner]);

  if (!gameState) return null;

  const currentSeat = gameState.currentPlayerIndex;
  const currentPlayerState = gameState.players[currentSeat];
  const currentIsBot = isBotPlayer(gameState, currentPlayerState);
  const myTurn = mySeats.includes(currentSeat);

  const validMoves = myTurn ? getCurrentValidMoves(gameState) : [];
  const validMoveSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));

  const playerConfig = PLAYERS[currentPlayerState.id];
  const player = {
    ...playerConfig,
    name: currentPlayerState.displayName ?? playerConfig.name,
  };
  const taunt = TURN_TAUNTS[gameState.turnCount % TURN_TAUNTS.length](
    playerConfig.shortName,
  );

  // During the trap animation we still want the board visible (not the
  // GameOverScreen). Once trap clears and phase is gameover, render gameover.
  const trapPlaying = trappedPlayers.length > 0 || eliminationPending;
  const showGameOver = gameState.phase === 'gameover' && !trapPlaying;

  const winnerState =
    gameState.winner !== null
      ? gameState.players.find((p) => p.id === gameState.winner)
      : null;

  // Highlight the winner during the trap wind-down when a human wins.
  const winnerPlayer =
    trapPlaying && winnerState && !isBotPlayer(gameState, winnerState)
      ? winnerState
      : null;

  return (
    <AnimatePresence mode="wait">
      {showGameOver ? (
        <motion.div
          key="gameover"
          style={{ width: '100%' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.22 }}
        >
          <GameOverScreen
            winner={gameState.winner !== null ? PLAYERS[gameState.winner] : null}
            players={gameState.players}
            onRestart={onRestart}
            onMenu={onExit}
          />
        </motion.div>
      ) : (
        <motion.div
          key="playing"
          className="game-layout"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.25 }}
        >
          <div className="game-center">
            <PlayerPanel
              players={gameState.players}
              currentPlayerIndex={currentSeat}
              gremlinCount={gameState.gremlinCount ?? 0}
              frozenPlayerId={gameState.frozenPlayerId ?? null}
              frozenTurnsLeft={gameState.frozenTurnsLeft ?? 0}
            />
            <div className="board-column">
              <TurnIndicator
                player={player}
                taunt={taunt}
                timeLeft={timeLeft}
                totalTime={totalTime}
                portalActive={gameState.portalActive}
                swapActive={gameState.swapActive}
                freezeSelectActive={gameState.freezeSelectActive}
                lastEvent={gameState.lastEvent}
                isGremlin={currentIsBot}
                isThinking={isThinking}
                soundEnabled={soundEnabled}
                onToggleSound={onToggleSound}
              />
              <GameBoard
                grid={gameState.grid}
                players={gameState.players}
                validMoveSet={validMoveSet}
                onCellClick={(row, col) => { if (myTurn) onMove(row, col); }}
                currentPlayerIndex={currentSeat}
                items={gameState.items}
                portalActive={gameState.portalActive}
                swapActive={gameState.swapActive}
                freezeSelectActive={gameState.freezeSelectActive}
                isGremlinTurn={currentIsBot}
                bombBlast={bombBlast}
                portalJump={portalJump}
                swapFlash={swapFlash}
                trappedPlayers={trappedPlayers}
                winnerPlayer={winnerPlayer}
                flyingFreeze={flyingFreeze}
                frozenPlayerId={gameState.frozenPlayerId ?? null}
                frozenTurnsLeft={gameState.frozenTurnsLeft ?? 0}
              />
              <button className="exit-game-btn" onClick={onExit}>
                ← Exit to menu
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
