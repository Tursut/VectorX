// Step 9 — lobby dispatcher tests. Multi-client broadcasts, seat assignment,
// host reassignment on disconnect, error paths.
//
// Uses the SELF.fetch + Response.webSocket pattern established in room-ws.test.ts.
// afterEach drains any sockets left open by a test — missing this leaks sockets
// into the next test and can poison the workerd isolate (see Step 5's
// parallel-fetch blowup for the class of issue).

import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

// ---------- Shared harness ----------

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

async function openWs(code: string): Promise<WebSocket> {
  const res = await SELF.fetch(`http://example.com/rooms/${code}/ws`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  openSockets.push(ws);
  return ws;
}

type InboundMsg = { type: string; [k: string]: unknown };

function onMessage(ws: WebSocket, handler: (msg: InboundMsg) => void): () => void {
  const listener = (e: MessageEvent) => handler(JSON.parse(e.data as string) as InboundMsg);
  ws.addEventListener('message', listener);
  return () => ws.removeEventListener('message', listener);
}

// Wait for the first inbound message matching `predicate`. Messages that
// don't match are silently skipped (they'll still be observed by other
// listeners attached before this call). Useful when the server sends several
// messages in sequence and the test only cares about a specific one.
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: InboundMsg) => boolean,
  timeoutMs = 1000,
): Promise<InboundMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', listener);
      reject(new Error('timeout waiting for message'));
    }, timeoutMs);
    const listener = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as InboundMsg;
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeEventListener('message', listener);
        resolve(msg);
      }
    };
    ws.addEventListener('message', listener);
  });
}

async function hello(ws: WebSocket, displayName: string): Promise<void> {
  ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName }));
}

// Wait until the growing `inbox` array contains a message matching `predicate`.
// Unlike `waitForMessage` (which only watches FUTURE events), this scans the
// full backlog first so it catches messages that already arrived.
async function waitForInbox(
  inbox: InboundMsg[],
  predicate: (msg: InboundMsg) => boolean,
  timeoutMs = 1000,
): Promise<InboundMsg> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout waiting for inbox entry');
}

// ---------- Cases ----------

describe('HELLO — single join', () => {
  it('first HELLO: caller gets JOIN then LOBBY_STATE with isHost=true', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const inbox: InboundMsg[] = [];
    onMessage(a, (m) => inbox.push(m));

    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    // Expect JOIN came first, then LOBBY_STATE
    expect(inbox[0]).toMatchObject({
      type: 'JOIN',
      player: { id: 0, displayName: 'Alice', isBot: false, isHost: true },
    });
    expect(inbox[1]).toMatchObject({
      type: 'LOBBY_STATE',
      code,
      hostId: 0,
      magicItems: false,
      players: [{ id: 0, displayName: 'Alice', isBot: false, isHost: true }],
    });
  });
});

describe('HELLO — second join', () => {
  it('both sockets receive JOIN(B) then LOBBY_STATE(A,B); B is not host', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const b = await openWs(code);

    // Inboxes attached before any traffic — captures everything.
    const aInbox: InboundMsg[] = [];
    const bInbox: InboundMsg[] = [];
    onMessage(a, (m) => aInbox.push(m));
    onMessage(b, (m) => bInbox.push(m));

    // Wait synchronization happens via the inbox contents, not via fresh
    // addEventListener after the trigger — broadcasts arrive asynchronously
    // and a listener attached after the trigger may miss the message.
    await hello(a, 'Alice');
    await waitForInbox(aInbox, (m) => m.type === 'LOBBY_STATE');

    await hello(b, 'Bob');
    await waitForInbox(
      aInbox,
      (m) => m.type === 'LOBBY_STATE' && Array.isArray(m.players) && m.players.length === 2,
    );
    await waitForInbox(
      bInbox,
      (m) => m.type === 'LOBBY_STATE' && Array.isArray(m.players) && m.players.length === 2,
    );

    // Both inboxes should contain JOIN(Bob) then LOBBY_STATE with 2 players
    for (const inbox of [aInbox, bInbox]) {
      const joinBobIdx = inbox.findIndex(
        (m) => m.type === 'JOIN' && (m.player as { id?: number })?.id === 1,
      );
      const lobby2Idx = inbox.findIndex(
        (m) => m.type === 'LOBBY_STATE' && Array.isArray(m.players) && (m.players as unknown[]).length === 2,
      );
      expect(joinBobIdx).toBeGreaterThanOrEqual(0);
      expect(lobby2Idx).toBeGreaterThan(joinBobIdx);
      expect(inbox[joinBobIdx]).toMatchObject({
        type: 'JOIN',
        player: { id: 1, displayName: 'Bob', isBot: false, isHost: false },
      });
      expect(inbox[lobby2Idx]).toMatchObject({ type: 'LOBBY_STATE', hostId: 0 });
    }
  });
});

describe('HELLO — capacity cap', () => {
  it('5th join gets ROOM_FULL', async () => {
    const code = await createRoom();
    const sockets: WebSocket[] = [];
    for (let i = 0; i < 4; i++) {
      const ws = await openWs(code);
      sockets.push(ws);
      await hello(ws, `Player${i}`);
      await waitForMessage(ws, (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === i + 1);
    }

    const fifth = await openWs(code);
    const err = waitForMessage(fifth, (m) => m.type === 'ERROR');
    await hello(fifth, 'TooMany');
    expect(await err).toMatchObject({ type: 'ERROR', code: 'ROOM_FULL' });
  });
});

describe('HELLO — duplicate name', () => {
  it('rejects a duplicate displayName with DUPLICATE_NAME', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    const b = await openWs(code);
    const err = waitForMessage(b, (m) => m.type === 'ERROR');
    await hello(b, 'Alice');
    expect(await err).toMatchObject({ type: 'ERROR', code: 'DUPLICATE_NAME' });
  });
});

describe('HELLO — after START', () => {
  it('returns ALREADY_STARTED', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    // Host starts
    a.send(JSON.stringify({ type: 'START', magicItems: false }));
    // Give the DO a beat to process
    await new Promise((r) => setTimeout(r, 50));

    const b = await openWs(code);
    const err = waitForMessage(b, (m) => m.type === 'ERROR');
    await hello(b, 'LateBob');
    expect(await err).toMatchObject({ type: 'ERROR', code: 'ALREADY_STARTED' });
  });
});

describe('START — host path', () => {
  it('host START transitions storage phase to playing and records magicItems', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    a.send(JSON.stringify({ type: 'START', magicItems: true }));
    // No response to assert — inspect storage directly.
    await new Promise((r) => setTimeout(r, 50));

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    await runInDurableObject(stub, async (_instance, state) => {
      const lobby = (await state.storage.get('lobby')) as {
        phase: string;
        magicItems: boolean;
        players: unknown[];
        hostId: number | null;
      };
      expect(lobby.phase).toBe('playing');
      expect(lobby.magicItems).toBe(true);
      expect(lobby.players).toHaveLength(1);
      expect(lobby.hostId).toBe(0);
    });
  });
});

describe('START — non-host', () => {
  it('non-host START during lobby gets UNAUTHORIZED', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    const b = await openWs(code);
    await hello(b, 'Bob');
    await waitForMessage(b, (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 2);

    const err = waitForMessage(b, (m) => m.type === 'ERROR');
    b.send(JSON.stringify({ type: 'START', magicItems: false }));
    expect(await err).toMatchObject({ type: 'ERROR', code: 'UNAUTHORIZED' });
  });
});

describe('START — already started', () => {
  it('host re-sends START after game started → ALREADY_STARTED', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    a.send(JSON.stringify({ type: 'START', magicItems: false }));
    await new Promise((r) => setTimeout(r, 50));

    const err = waitForMessage(a, (m) => m.type === 'ERROR');
    a.send(JSON.stringify({ type: 'START', magicItems: false }));
    expect(await err).toMatchObject({ type: 'ERROR', code: 'ALREADY_STARTED' });
  });
});

describe('BAD_PAYLOAD paths', () => {
  it('malformed JSON → BAD_PAYLOAD', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const err = waitForMessage(a, (m) => m.type === 'ERROR');
    a.send('{not valid json');
    expect(await err).toMatchObject({ type: 'ERROR', code: 'BAD_PAYLOAD' });
  });

  it('unknown message type → BAD_PAYLOAD', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const err = waitForMessage(a, (m) => m.type === 'ERROR');
    a.send(JSON.stringify({ type: 'BOGUS', foo: 1 }));
    expect(await err).toMatchObject({ type: 'ERROR', code: 'BAD_PAYLOAD' });
  });

  it('binary frame → BAD_PAYLOAD', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const err = waitForMessage(a, (m) => m.type === 'ERROR');
    a.send(new Uint8Array([1, 2, 3]).buffer);
    expect(await err).toMatchObject({ type: 'ERROR', code: 'BAD_PAYLOAD' });
  });
});

describe('HELLO — idempotent re-send', () => {
  it('second HELLO on the same socket just resends LOBBY_STATE to caller, no broadcast', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    const b = await openWs(code);

    // Inboxes attached before any traffic — no messages missed.
    const aInbox: InboundMsg[] = [];
    const bInbox: InboundMsg[] = [];
    onMessage(a, (m) => aInbox.push(m));
    onMessage(b, (m) => bInbox.push(m));

    await hello(a, 'Alice');
    await waitForInbox(aInbox, (m) => m.type === 'LOBBY_STATE');
    await hello(b, 'Bob');
    await waitForInbox(
      bInbox,
      (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 2,
    );
    // Let any trailing A-side broadcast arrive before baselining.
    await new Promise((r) => setTimeout(r, 50));

    const aBaseline = aInbox.length;
    const bBaseline = bInbox.length;

    // B re-sends HELLO — idempotent. Expect: B gets one more LOBBY_STATE,
    // A gets nothing new (no broadcast).
    await hello(b, 'Bob');
    // Wait until B's inbox has grown since baseline.
    const deadline = Date.now() + 1000;
    while (bInbox.length === bBaseline && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Extra settle time for any stray A broadcast that shouldn't happen
    await new Promise((r) => setTimeout(r, 100));

    const aNew = aInbox.slice(aBaseline);
    const bNew = bInbox.slice(bBaseline);

    expect(aNew).toHaveLength(0); // no broadcast to A
    expect(bNew).toHaveLength(1);
    expect(bNew[0]).toMatchObject({ type: 'LOBBY_STATE' });
  });
});

describe('disconnect during lobby', () => {
  it('remaining players see LOBBY_STATE with departed player removed', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    const b = await openWs(code);
    await hello(b, 'Bob');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 2);

    const updated = waitForMessage(
      a,
      (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 1,
    );
    // Close Bob's socket
    b.close(1000);
    // Remove from tracker so afterEach doesn't try to close again
    const bIdx = openSockets.indexOf(b);
    if (bIdx >= 0) openSockets.splice(bIdx, 1);

    const lobby = await updated;
    expect(lobby).toMatchObject({
      type: 'LOBBY_STATE',
      hostId: 0,
      players: [{ id: 0, displayName: 'Alice', isHost: true }],
    });
  });

  it('host disconnect reassigns host to next-lowest id', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    const b = await openWs(code);
    await hello(b, 'Bob');
    await waitForMessage(b, (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 2);

    const updated = waitForMessage(
      b,
      (m) => m.type === 'LOBBY_STATE' && (m.players as unknown[]).length === 1,
    );
    a.close(1000);
    const aIdx = openSockets.indexOf(a);
    if (aIdx >= 0) openSockets.splice(aIdx, 1);

    const lobby = await updated;
    expect(lobby).toMatchObject({
      type: 'LOBBY_STATE',
      hostId: 1,
      players: [{ id: 1, displayName: 'Bob', isHost: true }],
    });
  });
});

describe('MOVE in lobby', () => {
  it('returns INVALID_MOVE with a helpful message', async () => {
    const code = await createRoom();
    const a = await openWs(code);
    await hello(a, 'Alice');
    await waitForMessage(a, (m) => m.type === 'LOBBY_STATE');

    const err = waitForMessage(a, (m) => m.type === 'ERROR');
    a.send(JSON.stringify({ type: 'MOVE', row: 0, col: 1 }));
    const e = await err;
    expect(e).toMatchObject({ type: 'ERROR', code: 'INVALID_MOVE' });
    expect(e.message).toBeTypeOf('string');
  });
});
