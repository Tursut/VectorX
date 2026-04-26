// Derives the four transient in-game animation states + their item-pickup
// sounds from gameState transitions. Works identically in local and online
// because both receive a gameState with the same shape (a reducer dispatch
// locally; a wire broadcast online). No imperative pre-dispatch setup.
//
// Returned state is consumed as props by GameBoard: `bombBlast`, `portalJump`,
// `swapFlash`, `flyingFreeze`, `roulettePlayerId`. Each auto-clears after
// its animation duration.
//
// Roulette suspense (issue #30): when a BOT applies freeze or swap to a
// chosen target, this hook plays a short drum-roll first — a glowing
// outline hops across alive opponents (with `playTick` per hop), eased
// from fast to slow, finally landing on the actual target — and only
// THEN dispatches the existing `flyingFreeze` / `swapFlash` animation.
// Skipped (existing immediate behaviour) for human picks, for picks
// with ≤ 1 alive opponent, and for picks while no humans are alive
// (bots-only endgame already runs in #20's speed-run mode and shouldn't
// be slowed by suspense theatre).

import { useEffect, useRef, useState } from 'react';
import { GRID_SIZE, PLAYERS } from './constants';
import * as sounds from './sounds';

// Bot detection that works for hotseat (no per-player isBot field —
// derives from gremlinCount: the last `gc` seats are bots) and for
// online (per-player isBot, set by the server's buildGameState).
function isBotPlayer(gameState, player) {
  if (!player) return false;
  if (player.isBot !== undefined) return player.isBot;
  const gc = gameState?.gremlinCount ?? 0;
  return player.id >= PLAYERS.length - gc;
}

// EaseOut hop schedule: fast at first, slowing dramatically into the
// final reveal — the last 3 hops are unmistakably long so the wheel
// looks like it's coasting to a stop.
// 16 hops, ~5.1 s total + reveal blink ≈ 6 s end-to-end.
const ROULETTE_HOP_DURATIONS_MS = [
  30, 38, 50, 65, 85, 110, 140, 175, 215, 265, 325, 400, 500, 650, 870, 1180,
];
// Brief pause after the final hop before the 3-blink reveal starts —
// the spotlight settles for a beat ("…and the winner is…") before
// we celebrate.
const ROULETTE_HOLD_MS = 250;
// Duration of the 3-blink reveal animation. Must match the
// .cell-roulette-reveal keyframes in App.css. The deferred
// swap/freeze fly-in fires when this elapses.
const ROULETTE_REVEAL_MS = 900;

export function useDerivedAnimations(gameState) {
  const [bombBlast, setBombBlast] = useState(null);
  const [portalJump, setPortalJump] = useState(null);
  const [swapFlash, setSwapFlash] = useState(null);
  const [flyingFreeze, setFlyingFreeze] = useState(null);
  const [roulettePlayerId, setRoulettePlayerId] = useState(null);
  // True during the post-final-hop "winner reveal" — the target cell
  // blinks 3 times so it's unmistakable who got picked. GameBoard
  // routes this to a different CSS animation class.
  const [rouletteRevealing, setRouletteRevealing] = useState(false);
  // While a swap roulette is rolling we want the two players' icons to
  // appear at their PRE-swap positions (since the GAME_STATE we received
  // has already exchanged them). GameBoard reads this to invert the pair
  // back to their pre-swap layout until the spotlight lands.
  const [pendingSwap, setPendingSwap] = useState(null);
  const prevRef = useRef(null);
  // Last `lastEvent` reference processed — guards against re-firing the
  // roulette / fly-in on a reconnect-driven repeat GAME_STATE or any
  // other re-render that doesn't actually represent a new event.
  const lastEventRef = useRef(null);
  // Pending hop timeouts so unmount / new event can clean them up.
  const rouletteTimersRef = useRef([]);

  function clearRouletteTimers() {
    for (const t of rouletteTimersRef.current) clearTimeout(t);
    rouletteTimersRef.current = [];
  }

  // Auto-clear timeouts.
  useEffect(() => {
    if (!bombBlast) return;
    const t = setTimeout(() => setBombBlast(null), 700);
    return () => clearTimeout(t);
  }, [bombBlast]);
  useEffect(() => {
    if (!portalJump) return;
    const t = setTimeout(() => setPortalJump(null), 800);
    return () => clearTimeout(t);
  }, [portalJump]);
  useEffect(() => {
    if (!swapFlash) return;
    const t = setTimeout(() => setSwapFlash(null), 800);
    return () => clearTimeout(t);
  }, [swapFlash]);
  useEffect(() => {
    if (!flyingFreeze) return;
    const t = setTimeout(() => setFlyingFreeze(null), 800);
    return () => clearTimeout(t);
  }, [flyingFreeze]);

  // Cleanup any in-flight roulette timers on unmount.
  useEffect(() => () => clearRouletteTimers(), []);

  // Freeze / swap event watcher. Routes a bot-driven event through the
  // roulette before firing the existing fly-in / flash; routes a human
  // event (or an unwatchable one) straight through, matching pre-#30
  // timing.
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev) return;
    if (ev.type !== 'freeze' && ev.type !== 'swap') return;
    // Reconnects deliver the same GAME_STATE (and the same `lastEvent`
    // reference) again. Fire once per unique event reference.
    if (lastEventRef.current === ev) return;
    lastEventRef.current = ev;

    const collector = gameState.players.find((p) => p.id === ev.byId);
    const target = gameState.players.find((p) => p.id === ev.targetId);
    if (!collector || !target) return;

    const fireImmediate = () => {
      if (ev.type === 'freeze') {
        setFlyingFreeze({
          fromRow: collector.row,
          fromCol: collector.col,
          toRow: target.row,
          toCol: target.col,
        });
      } else {
        setSwapFlash({
          pos1: { row: collector.row, col: collector.col },
          pos2: { row: target.row, col: target.col },
        });
      }
    };

    const isBotEvent = isBotPlayer(gameState, collector);
    const opponents = gameState.players.filter(
      (p) => !p.isEliminated && p.id !== ev.byId,
    );
    const aliveHumans = gameState.players.filter(
      (p) => !p.isEliminated && !isBotPlayer(gameState, p),
    );
    const skipRoulette =
      !isBotEvent ||
      opponents.length <= 1 ||
      aliveHumans.length === 0;

    if (skipRoulette) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fireImmediate();
      return;
    }

    // Defer the visible "applied" state until the spotlight lands. For
    // swap, that means rendering both players at their PRE-swap spots
    // throughout the roll — set pendingSwap which GameBoard reads.
    if (ev.type === 'swap') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSwap({ byId: ev.byId, targetId: ev.targetId });
    }

    // Build the hop schedule. Each non-final hop picks a random
    // opponent ≠ the previous hop, so the highlight visibly travels.
    // The penultimate hop also excludes the actual target so the
    // FINAL hop is a visible move (otherwise a random penultimate
    // pick that happens to be the target would leave the spotlight
    // sitting still during the climax). The final hop is the target.
    const hops = [];
    let prevId = -1;
    for (let i = 0; i < ROULETTE_HOP_DURATIONS_MS.length - 1; i++) {
      const isPenultimate = i === ROULETTE_HOP_DURATIONS_MS.length - 2;
      let pool = opponents.filter((p) => p.id !== prevId);
      if (isPenultimate) {
        const noTarget = pool.filter((p) => p.id !== target.id);
        if (noTarget.length > 0) pool = noTarget;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      hops.push({ playerId: pick.id, dur: ROULETTE_HOP_DURATIONS_MS[i] });
      prevId = pick.id;
    }
    hops.push({
      playerId: target.id,
      dur: ROULETTE_HOP_DURATIONS_MS[ROULETTE_HOP_DURATIONS_MS.length - 1],
    });

    // Schedule the hops + the final fly-in/flash handoff.
    clearRouletteTimers();
    let cumulative = 0;
    hops.forEach((hop) => {
      const at = cumulative;
      rouletteTimersRef.current.push(setTimeout(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRoulettePlayerId(hop.playerId);
        sounds.playTick();
      }, at));
      cumulative += hop.dur;
    });
    // After the final hop + brief settle, kick off the 3-blink reveal
    // on the target cell. Spotlight stays on (roulettePlayerId pinned
    // to target) but switches to the reveal animation. Only after the
    // blink finishes do we clear the spotlight, drop pendingSwap, and
    // fire the existing fly-in / flash.
    rouletteTimersRef.current.push(setTimeout(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRouletteRevealing(true);
    }, cumulative + ROULETTE_HOLD_MS));
    rouletteTimersRef.current.push(setTimeout(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRouletteRevealing(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoulettePlayerId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSwap(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fireImmediate();
    }, cumulative + ROULETTE_HOLD_MS + ROULETTE_REVEAL_MS));
  }, [gameState?.lastEvent, gameState?.players]);

  // Main state-diff: detect item pickups + portal jumps from the
  // (prev → current) turn transition. Item-pickup sounds fire here.
  // Swap flash + freeze fly-in moved to the freeze/swap event watcher
  // above (post-#30 it can sit alongside the roulette state machine).
  useEffect(() => {
    if (!gameState) { prevRef.current = null; return; }
    const prev = prevRef.current;
    prevRef.current = gameState;
    if (!prev) return;
    // Bomb/portal/swap/freeze items each have different turn-advancement behaviour:
    //   bomb   → calls completeTurn → turnCount advances
    //   portal → sets portalActive; completeTurn fires on the *next* move
    //   swap   → sets swapActive; completeTurn fires on the *next* move
    //   freeze → sets freezeSelectActive; completeTurn fires on the *next* move
    // So "turnCount changed" is not a reliable proxy for "something happened".
    // Let through any transition where the turn advanced OR an item-mode flag
    // just became active (which means a portal/swap/freeze item was just picked up).
    const turnAdvanced = prev.turnCount !== gameState.turnCount;
    const modeActivated =
      (!prev.swapActive && gameState.swapActive) ||
      (!prev.portalActive && gameState.portalActive) ||
      (!prev.freezeSelectActive && gameState.freezeSelectActive);
    if (!turnAdvanced && !modeActivated) return;

    const mover = gameState.players[prev.currentPlayerIndex];
    if (!mover) return;
    const movedTo = { row: mover.row, col: mover.col };

    // Item pickup: prev had an item at movedTo, current doesn't.
    const pickedUp = (prev.items ?? []).find(
      (it) => it.row === movedTo.row && it.col === movedTo.col,
    );
    const stillThere = pickedUp
      ? (gameState.items ?? []).some((it) => it.id === pickedUp.id)
      : false;
    if (pickedUp && !stillThere) {
      if (pickedUp.type === 'bomb') {
        const cleared = [];
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = movedTo.row + dr;
            const nc = movedTo.col + dc;
            if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
              cleared.push({ row: nr, col: nc });
            }
          }
        }
        setBombBlast({ origin: movedTo, cleared });
        sounds.playBomb();
      } else if (pickedUp.type === 'portal') {
        sounds.playPortal();
      } else if (pickedUp.type === 'swap') {
        sounds.playSwapActivate();
      } else if (pickedUp.type === 'freeze') {
        // playTick is a placeholder pickup cue (issue #28). The
        // iced-magic sample (playFreeze) still plays on apply via
        // useGameplaySounds when lastEvent.type === 'freeze' lands —
        // pickup vs apply stay audibly distinct.
        sounds.playTick();
      }
    }

    // Portal jump: prev.portalActive → false, mover moved >1 cell (Chebyshev).
    if (prev.portalActive && !gameState.portalActive) {
      const prevMover = prev.players[prev.currentPlayerIndex];
      if (prevMover) {
        const dist = Math.max(
          Math.abs(prevMover.row - mover.row),
          Math.abs(prevMover.col - mover.col),
        );
        if (dist > 1) {
          setPortalJump({
            from: { row: prevMover.row, col: prevMover.col },
            to: movedTo,
          });
          sounds.playPortalJump();
        }
      }
    }
  }, [gameState]);

  return { bombBlast, portalJump, swapFlash, flyingFreeze, roulettePlayerId, rouletteRevealing, pendingSwap };
}
