// Derives the four transient in-game animation states + their item-pickup
// sounds from gameState transitions. Works identically in local and online
// because both receive a gameState with the same shape (a reducer dispatch
// locally; a wire broadcast online). No imperative pre-dispatch setup.
//
// Returned state is consumed as props by GameBoard: `bombBlast`, `portalJump`,
// `swapFlash`, `flyingFreeze`. Each auto-clears after its animation duration.

import { useEffect, useRef, useState } from 'react';
import { GRID_SIZE } from './constants';
import * as sounds from './sounds';

export function useDerivedAnimations(gameState) {
  const [bombBlast, setBombBlast] = useState(null);
  const [portalJump, setPortalJump] = useState(null);
  const [swapFlash, setSwapFlash] = useState(null);
  const [flyingFreeze, setFlyingFreeze] = useState(null);
  const prevRef = useRef(null);

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

  // Flying-freeze projectile — fires when lastEvent changes to a freeze event.
  useEffect(() => {
    const ev = gameState?.lastEvent;
    if (!ev || ev.type !== 'freeze') return;
    const collector = gameState.players.find((p) => p.id === ev.byId);
    const frozen = gameState.players.find((p) => p.id === ev.targetId);
    if (collector && frozen) {
      setFlyingFreeze({
        fromRow: collector.row,
        fromCol: collector.col,
        toRow: frozen.row,
        toCol: frozen.col,
      });
    }
  }, [gameState?.lastEvent]);

  // Main state-diff: detect item pickups, portal jumps, swap flashes from the
  // (prev → current) turn transition. Item-pickup sounds fire here too.
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
      }
      // freeze pickup has no dedicated sound — fires on lastEvent instead.
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

    // Swap flash: prev.swapActive → false, some other player now sits at
    // prevMover's previous position.
    if (prev.swapActive && !gameState.swapActive) {
      const prevMover = prev.players[prev.currentPlayerIndex];
      if (prevMover) {
        const partner = gameState.players.find(
          (p) =>
            p.id !== mover.id &&
            p.row === prevMover.row &&
            p.col === prevMover.col,
        );
        if (partner) {
          setSwapFlash({
            pos1: { row: prevMover.row, col: prevMover.col },
            pos2: { row: mover.row, col: mover.col },
          });
        }
      }
    }
  }, [gameState]);

  return { bombBlast, portalJump, swapFlash, flyingFreeze };
}
