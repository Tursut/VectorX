// Shared in-game renderer used by both LocalGameController (hotseat) and
// OnlineGameController (multiplayer). Owns everything that only depends on
// gameState + a "which seats do I control" concept:
//
//   - Rendering: PlayerPanel, TurnIndicator, GameBoard, GameOverScreen
//
// The trap / death animation chain (and its elimination sound) moved up
// to the parent controllers via useTrapChain — they need `trapPlaying`
// to gate the next turn's bot driver / turn timer / valid-move dots,
// so trappedPlayers + trapPlaying come in here as props.
//
// The simpler gameplay sounds (bg theme, move/claim, your-turn chime,
// freeze/swap event sounds) live in useGameplaySounds and are called from
// each controller directly, so sandbox mode (which doesn't mount GameScreen)
// gets them too.
//
// Mode-specific concerns (start screen, lobby, pre-game countdown, turn timer,
// bot driving, sandbox panel, connection status, exit-confirm modal) stay in
// the outer controllers.

import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS, TURN_TAUNTS, TURN_TIME } from '../game/constants';
import { getCurrentValidMoves } from '../game/logic';
import { useWinnerHero } from '../game/useWinnerHero';
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
  restartLabel = 'PLAY AGAIN',
  restartDisabled = false,
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
  // Trap / death chain — driven by useTrapChain in the controller.
  trappedPlayers = [],
  trapPlaying = false,
}) {
  // Trap / death chain + elimination sound is owned by the parent
  // controller's useTrapChain hook (#36) and reaches us via props.
  // The "winner hero" phase (#60) sits between trap-end and the
  // GameOverScreen mount: 1 s spotlight on the winner with the win
  // sound, then GameOverScreen takes over. Driven here so the gating
  // in showGameOver below stays a single source of truth.
  const { heroPlaying } = useWinnerHero(gameState, trapPlaying);

  if (!gameState) return null;

  const currentSeat = gameState.currentPlayerIndex;
  const currentPlayerState = gameState.players[currentSeat];
  const currentIsBot = isBotPlayer(gameState, currentPlayerState);
  const myTurn = mySeats.includes(currentSeat);

  // Issue #39 — while the freeze/swap roulette is rolling, the reducer
  // has already advanced currentPlayerIndex to the next seat, but the
  // 6-second animation belongs to the actor's turn. Override only the
  // *displayed* seat for the on-board "whose turn" pulse and the
  // PlayerPanel "← NOW" banner so they keep pointing at the actor
  // until the wheel resolves. Turn logic (validMoves, myTurn, taunt,
  // bot driver) still reads currentSeat — that part of state is
  // already correct, only the UI surface was misaligned.
  const displayedSeat =
    rouletteActive && rouletteActor != null
      ? rouletteActor.playerId
      : currentSeat;
  const displayedPlayerState = gameState.players[displayedSeat];
  const displayedIsOpponent =
    !mySeats.includes(displayedSeat) && !displayedPlayerState?.isEliminated;

  // Issue #41 — span the held-item actor halo + icon across both the
  // pickup→select phase AND the roulette phase. When a bot picks up
  // freeze/swap, the state goes into freezeSelectActive/swapActive
  // and the bot's ~1.6 s thinking delay runs before it picks a
  // target. Without this, that whole window has no visual signal
  // that the bot is holding an item — reads as a stall. The motion
  // key uses (playerId, itemKind) so the icon mounts ONCE on pickup
  // (with a punchy grow-in) and stays mounted through the roulette
  // until the freeze/swap resolves.
  const pickupHeld =
    (gameState.freezeSelectActive || gameState.swapActive) && currentIsBot
      ? {
          playerId: currentSeat,
          itemKind: gameState.freezeSelectActive ? 'freeze' : 'swap',
        }
      : null;
  const heldItemActor = rouletteActor ?? pickupHeld;

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

  // GameOverScreen mounts as soon as the trap chain (#36) finishes.
  // The winner-hero spotlight (#60) renders INSIDE GameOverScreen via
  // its heroPlaying prop, so the trophy is in its real leaderboard
  // position from the first frame and the rest of the leaderboard
  // chrome bleeds in around it ~1 s later.
  const showGameOver = gameState.phase === 'gameover' && !trapPlaying;

  const winnerState =
    gameState.winner !== null
      ? gameState.players.find((p) => p.id === gameState.winner)
      : null;
  const winnerConfig = winnerState ? PLAYERS[winnerState.id] : null;
  const gameOverWinner =
    winnerState && winnerConfig
      ? {
          ...winnerConfig,
          name: winnerState.displayName ?? winnerConfig.name,
          shortName: winnerState.displayName ?? winnerConfig.shortName,
        }
      : null;

  return (
    <AnimatePresence mode="wait">
      {showGameOver ? (
        <motion.div
          key="gameover"
          style={{ width: '100%' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
        >
          <GameOverScreen
            winner={gameOverWinner}
            players={gameState.players}
            onRestart={onRestart}
            onMenu={onExit}
            restartLabel={restartLabel}
            restartDisabled={restartDisabled}
            heroPlaying={heroPlaying}
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
              currentPlayerIndex={displayedSeat}
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
                currentPlayerIndex={displayedSeat}
                items={gameState.items}
                portalActive={gameState.portalActive}
                swapActive={gameState.swapActive}
                freezeSelectActive={gameState.freezeSelectActive}
                isGremlinTurn={currentIsBot}
                isOpponentTurn={displayedIsOpponent}
                bombBlast={bombBlast}
                portalJump={portalJump}
                swapFlash={swapFlash}
                trappedPlayers={trappedPlayers}
                flyingFreeze={flyingFreeze}
                roulettePlayerId={roulettePlayerId}
                rouletteRevealing={rouletteRevealing}
                pendingSwap={pendingSwap}
                heldItemActor={heldItemActor}
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
