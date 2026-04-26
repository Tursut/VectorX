// Trap / death animation chain — extracted from GameScreen.jsx in #36
// finding #1 so the queue + drain state machine can also be consulted
// from the parent controllers. The controllers gate the next turn
// (bot driver, turn timer, human valid-move dots) on `trapPlaying`,
// so back-to-back deaths each get their full ~3 s beat instead of
// replacing each other mid-animation.
//
// Same-tick batched deaths (e.g. one bomb killing two bots in a
// single turn) form a single batch and animate together in one
// shared 2.5 s window — preserves the existing bomb behaviour. Across
// turns, each death is its own batch and they drain in arrival
// order.

import { useEffect, useRef, useState } from 'react';
import { isBotPlayer } from './rouletteCriteria';
import * as sounds from './sounds';

const TRAP_WINDUP_MS = 450;
const TRAP_SETTLE_MS = 2500;

export function useTrapChain(gameState) {
  // Render layer reads `trappedPlayers`. Each entry in `queue` is a
  // batch (an array of { id, row, col }) — one bomb-kill batch can
  // hold multiple players; consecutive-turn deaths produce separate
  // batches.
  const [trappedPlayers, setTrappedPlayers] = useState([]);
  const [eliminationPending, setEliminationPending] = useState(false);
  const [queue, setQueue] = useState([]);
  const prevPlayersRef = useRef(null);
  const drainTimerRef = useRef(null);

  // Detect newly-trapped on every gameState transition and append as
  // one batch to the queue. Same diff as the original GameScreen
  // effect, including the "skip if no humans alive" branch so the
  // bots-only endgame doesn't drag.
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
        setQueue((q) => [...q, newlyTrapped]);
      }
    }
    prevPlayersRef.current = gameState.players;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.players]);

  // Idle + queued → start a drain cycle by flipping `eliminationPending`
  // true. The cycle effect below picks it up.
  useEffect(() => {
    if (eliminationPending) return;
    if (trappedPlayers.length > 0) return;
    if (queue.length === 0) return;
    setEliminationPending(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [eliminationPending, trappedPlayers, queue]);

  // Drain cycle: 450 ms wind-up → show batch + elim sound → 2500 ms
  // settle → clear + dequeue + drop pending. The settle is scheduled
  // from INSIDE the wind-up callback (chained setTimeouts on the same
  // ref) so we don't depend on a React render to schedule it; that
  // matters for tests using vi.advanceTimersByTime to bulk-skip the
  // first 450 ms — the React render that would have run a separate
  // settle effect doesn't happen until the advance completes, by
  // which point the clock is already past 450 ms.
  //
  // Pending flips back to false ONLY at the end of the cycle, so the
  // self-cleanup that would fire when pending changes mid-callback
  // can't cancel the in-flight settle.
  useEffect(() => {
    if (!eliminationPending) return;
    drainTimerRef.current = setTimeout(() => {
      setTrappedPlayers(queue[0] ?? []);
      sounds.playElimination();
      drainTimerRef.current = setTimeout(() => {
        setTrappedPlayers([]);
        setQueue((q) => q.slice(1));
        setEliminationPending(false);
      }, TRAP_SETTLE_MS);
    }, TRAP_WINDUP_MS);
    return () => clearTimeout(drainTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eliminationPending]);

  const trapPlaying =
    queue.length > 0 || eliminationPending || trappedPlayers.length > 0;
  return { trappedPlayers, trapPlaying };
}
