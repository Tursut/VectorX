// Step 12 — turn-timer tests.
//
// Covers the human-timeout branch of the DO alarm: on a human's turn the
// alarm is scheduled at `Date.now() + TURN_TIME_MS`; firing it (via
// runDurableObjectAlarm, which ignores the scheduled time) must call
// eliminateCurrentPlayer on that seat and broadcast an updated GAME_STATE.
// Disconnect-elimination is covered separately in room-disconnect.test.ts.
//
// Same SELF.fetch + openWs + waitForInbox pattern as room-bots.test.ts.

import {
  SELF,
  env,
  runInDurableObject,
  runDurableObjectAlarm,
} from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';
import { TURN_TIME } from '../../src/game/constants';

const TURN_TIME_MS = TURN_TIME * 1000;

// ---------- Harness (copied from room-bots.test.ts) ----------

const openSockets: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(openSockets.splice(0).map((ws) => drain(ws)));
});

async function drain(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
  });
  try {
    ws.close(1000);
  } catch {
    return;
  }
  await Promise.race([closed, new Promise((r) => setTimeout(r, 200))]);
}

async function createRoom(): Promise<string> {
  const res = await SELF.fetch('http://example.com/rooms', { method: 'POST' });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

type InboundMsg = { type: string; [k: string]: unknown };

async function openWs(code: string): Promise<{ ws: WebSocket; inbox: InboundMsg[] }> {
  const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const inbox: InboundMsg[] = [];
  ws.addEventListener('message', (e) => {
    inbox.push(JSON.parse(e.data as string) as InboundMsg);
  });
  openSockets.push(ws);
  return { ws, inbox };
}

async function waitForInbox(
  inbox: InboundMsg[],
  predicate: (msg: InboundMsg) => boolean,
  timeoutMs = 1500,
): Promise<InboundMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout waiting for inbox entry');
}

function latestGameState(inbox: InboundMsg[]): InboundMsg | undefined {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i].type === 'GAME_STATE') return inbox[i];
  }
  return undefined;
}

async function peekGameAndAlarm(code: string): Promise<{
  game: {
    phase: string;
    currentPlayerIndex: number;
    turnCount: number;
    winner: number | null;
    players: Array<{ id: number; isEliminated: boolean; finishTurn: number | null; deathCell: { row: number; col: number } | null }>;
  } | undefined;
  lobby: { players: Array<{ id: number }>; phase: string } | undefined;
  alarm: number | null;
}> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runInDurableObject(stub, async (_i, state) => ({
    game: (await state.storage.get('game')) as never,
    lobby: (await state.storage.get('lobby')) as never,
    alarm: await state.storage.getAlarm(),
  }));
}

async function triggerAlarm(code: string): Promise<boolean> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  return runDurableObjectAlarm(stub);
}

async function hello(ws: WebSocket, displayName: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName }));
}

// Advance the game until it's the human's (seat 0, Alice's) turn. For a
// 1h3b room, initGame picks a random starting player; this loop fires bot
// alarms until the human is current.
async function advanceUntilHumansTurn(
  code: string,
  inbox: InboundMsg[],
  humanSeat: number,
): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const snap = await peekGameAndAlarm(code);
    if (snap.game!.currentPlayerIndex === humanSeat) return;
    if (snap.game!.phase !== 'playing') return;
    await triggerAlarm(code);
    await waitForInbox(
      inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        (m.turnCount as number) > snap.game!.turnCount,
      2000,
    );
  }
  throw new Error(`human seat ${humanSeat} never became current after 10 bot alarms`);
}

// ---------- Cases ----------

describe('turn timer: alarm scheduled at TURN_TIME_MS on human turn', () => {
  it('sets an alarm ~TURN_TIME_MS in the future when a human is current', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');
    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    await advanceUntilHumansTurn(code, inbox, 0);

    const before = Date.now();
    const snap = await peekGameAndAlarm(code);
    expect(snap.game!.currentPlayerIndex).toBe(0);
    expect(snap.alarm).not.toBeNull();
    // Human deadline is much longer than the bot's 800–1400ms delay.
    // Allow a generous lower bound to tolerate test-runner scheduling.
    const msUntilAlarm = snap.alarm! - before;
    expect(msUntilAlarm).toBeGreaterThan(5_000);
    expect(msUntilAlarm).toBeLessThanOrEqual(TURN_TIME_MS + 100);
  });
});

describe('turn timer: firing the alarm forfeits the human', () => {
  it('eliminates the current human seat and advances the turn', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');
    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    await advanceUntilHumansTurn(code, inbox, 0);

    // Trigger the scheduled alarm → Alice's turn is forfeited.
    const before = await peekGameAndAlarm(code);
    expect(before.game!.currentPlayerIndex).toBe(0);

    const ran = await triggerAlarm(code);
    expect(ran).toBe(true);

    await waitForInbox(
      inbox,
      (m) =>
        m.type === 'GAME_STATE' &&
        Array.isArray(m.players) &&
        (m.players as Array<{ id: number; isEliminated: boolean }>).find((p) => p.id === 0)?.isEliminated === true,
    );

    const after = await peekGameAndAlarm(code);
    const alicePost = after.game!.players.find((p) => p.id === 0)!;
    expect(alicePost.isEliminated).toBe(true);
    expect(alicePost.deathCell).not.toBeNull();
    expect(alicePost.finishTurn).toBe(before.game!.turnCount);
    // Turn advanced off Alice.
    expect(after.game!.currentPlayerIndex).not.toBe(0);
  });
});

describe('turn timer: bot-then-human alarm handoff', () => {
  it('after bot plays, the next alarm is sized for a human deadline', async () => {
    const code = await createRoom();
    const { ws, inbox } = await openWs(code);
    await hello(ws, 'Alice');
    await waitForInbox(inbox, (m) => m.type === 'LOBBY_STATE');
    ws.send(JSON.stringify({ type: 'START', magicItems: false }));
    const firstGs = await waitForInbox(inbox, (m) => m.type === 'GAME_STATE');

    // If it's already Alice's turn, make a move so the next turn is a bot.
    if ((firstGs.currentPlayerIndex as number) === 0) {
      // Find any adjacent empty cell for Alice at (0,0).
      ws.send(JSON.stringify({ type: 'MOVE', row: 0, col: 1 }));
      await waitForInbox(
        inbox,
        (m) => m.type === 'GAME_STATE' && m.turnCount === 1,
      );
    }

    // Now run the game forward until the alarm is for a human deadline.
    // After at most 4 bot turns we're back to Alice. Check the alarm size
    // each step; the first time it's "large" (≥ 5s) we've confirmed the
    // human-timeout branch took over from the bot-delay branch.
    let foundHumanAlarm = false;
    for (let i = 0; i < 8 && !foundHumanAlarm; i++) {
      const snap = await peekGameAndAlarm(code);
      if (snap.alarm !== null && snap.alarm - Date.now() > 5_000) {
        foundHumanAlarm = true;
        break;
      }
      if (snap.game!.phase !== 'playing') break;
      await triggerAlarm(code);
      await waitForInbox(
        inbox,
        (m) =>
          m.type === 'GAME_STATE' &&
          (m.turnCount as number) > snap.game!.turnCount,
      );
    }
    expect(foundHumanAlarm).toBe(true);
  });
});
