// Shared in-game renderer used by both LocalGameController (hotseat) and
// OnlineGameController (multiplayer). Owns everything that only depends on
// gameState + a "which seats do I control" concept:
//
//   - Rendering: PlayerPanel, TurnIndicator, GameBoard, GameOverScreen
//   - The trapped/death animation chain + its elimination sound
//   - Win/draw sound (gated on trap animation finishing)
//
// The simpler gameplay sounds (bg theme, move/claim, your-turn chime,
// freeze/swap event sounds) live in useGameplaySounds and are called from
// each controller directly, so sandbox mode (which doesn't mount GameScreen)
// gets them too.
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
  // Animation overlays — produced by useDerivedAnimations(gameState) in the
  // parent controller and passed here so each controller fires the hook once.
  bombBlast = null,
  portalJump = null,
  swapFlash = null,
  flyingFreeze = null,
  roulettePlayerId = null,
  rouletteRevealing = false,
  pendingSwap = null,
  rouletteActor = null,
  rouletteActive = false,
}) {
  const [trappedPlayers, setTrappedPlayers] = useState([]);
  const [eliminationPending, setEliminationPending] = useState(false);
  const prevPlayersRef = useRef(null);
  const trappedTimerRef = useRef(null);

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

  // Win / draw sound moved to GameOverScreen mount (issue #34) so the
  // cue lines up with the leaderboard appearing instead of firing on
  // top of the wind-down trap animation while we're still on the
  // board, and again when the leaderboard renders.

  if (!gameState) return null;

  const currentSeat = gameState.currentPlayerIndex;
  const currentPlayerState = gameState.players[currentSeat];
  const currentIsBot = isBotPlayer(gameState, currentPlayerState);
  const myTurn = mySeats.includes(currentSeat);

  // While the freeze/swap roulette is rolling (issue #30) we hide the
  // valid-move dots so the human can't interrupt the suspense — the
  // turn really is theirs (gameState advanced when the bot picked the
  // target), but we want them to watch the wheel before acting.
  const validMoves = myTurn && !rouletteActive ? getCurrentValidMoves(gameState) : [];
  const validMoveSet = new Set(validMoves.map((m) => `${m.row},${m.col}`));

  const playerConfig = PLAYERS[currentPlayerState.id];
  const player = {
    ...playerConfig,
    name: currentPlayerState.displayName ?? playerConfig.name,
  };
  // Online players have a chosen displayName; hotseat / bots fall back to
  // the character shortName. Without this fallback the taunt always read
  // the static shortName ("It's Gerald's turn…") even when the actual
  // player was "Hugo the Plucky".
  const tauntName = currentPlayerState.displayName ?? playerConfig.shortName;
  const taunt = TURN_TAUNTS[gameState.turnCount % TURN_TAUNTS.length](tauntName);

  // During the trap animation we still want the board visible (not the
  // GameOverScreen). Once trap clears and phase is gameover, render gameover.
  const trapPlaying = trappedPlayers.length > 0 || eliminationPending;
  const showGameOver = gameState.phase === 'gameover' && !trapPlaying;

  const winnerState =
    gameState.winner !== null
      ? gameState.players.find((p) => p.id === gameState.winner)
      : null;

  // Highlight any winner (human or bot) during the last-death wind-down.
  const winnerPlayer = trapPlaying && winnerState ? winnerState : null;

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
                isOpponentTurn={!myTurn && !currentPlayerState.isEliminated}
                bombBlast={bombBlast}
                portalJump={portalJump}
                swapFlash={swapFlash}
                trappedPlayers={trappedPlayers}
                winnerPlayer={winnerPlayer}
                flyingFreeze={flyingFreeze}
                roulettePlayerId={roulettePlayerId}
                rouletteRevealing={rouletteRevealing}
                pendingSwap={pendingSwap}
                rouletteActor={rouletteActor}
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
