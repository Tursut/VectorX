// Shared "should this freeze/swap event run the bot roulette?" gates.
//
// The roulette suspense (issue #30) is a client-only animation that
// plays before the freeze fly-in / swap flash when a BOT applies the
// effect. The same skip/engage criteria need to be answered in three
// places to keep the wheel, the gameplay sound mute, and the server's
// next-turn delay all in lockstep:
//
//   1. useDerivedAnimations — drives the visual wheel + deferred handoff.
//   2. useGameplaySounds — suppresses the per-turn move/claim thump
//      that would otherwise fire at the start of the wheel (issue #31).
//   3. server/index.ts#computeTurnDelay — pushes the next-turn alarm
//      out by ROULETTE_DELAY_MS so online doesn't keep advancing turns
//      mid-wheel. (Server has its own copy because its bot detection
//      uses lobby.players instead of the per-state gremlinCount/isBot
//      signals — keep it in sync by hand when the criteria change.)
//
// Skips when:
//   - event isn't freeze or swap
//   - actor is a human (humans pick targets manually, no suspense)
//   - ≤ 1 alive opponent (no choice to roulette over)
//   - no humans alive (bots-only endgame is in #20's speed-run mode and
//     shouldn't be slowed by suspense theatre)

import { PLAYERS } from './constants';

// Bot detection that works for hotseat (no per-player isBot field —
// derives from gremlinCount: the last `gc` seats are bots) and for
// online (per-player isBot, set by the server's buildGameState).
export function isBotPlayer(gameState, player) {
  if (!player) return false;
  if (player.isBot !== undefined) return player.isBot;
  const gc = gameState?.gremlinCount ?? 0;
  return player.id >= PLAYERS.length - gc;
}

export function shouldRouletteFreezeSwap(gameState, ev) {
  if (!ev) return false;
  if (ev.type !== 'freeze' && ev.type !== 'swap') return false;
  const collector = gameState.players.find((p) => p.id === ev.byId);
  if (!collector) return false;
  if (!isBotPlayer(gameState, collector)) return false;
  const aliveOpponents = gameState.players.filter(
    (p) => !p.isEliminated && p.id !== ev.byId,
  ).length;
  if (aliveOpponents <= 1) return false;
  const aliveHumans = gameState.players.filter(
    (p) => !p.isEliminated && !isBotPlayer(gameState, p),
  ).length;
  if (aliveHumans === 0) return false;
  return true;
}
