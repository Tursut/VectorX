import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

type InboundMsg = { type: string; [k: string]: unknown };

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

async function seedGameOver(code: string): Promise<void> {
  const stub = env.ROOM.get(env.ROOM.idFromName(code));
  await runInDurableObject(stub, async (_instance, state) => {
    const lobby = (await state.storage.get('lobby')) as {
      players: Array<{ id: number; displayName: string; isBot: boolean; disconnectedAt: number | null }>;
      hostId: number | null;
      phase: 'lobby' | 'playing';
      magicItems: boolean;
    };
    const game = (await state.storage.get('game')) as {
      players: Array<{ isEliminated: boolean }>;
      phase: string;
      winner: number | null;
    };
    await state.storage.put({
      lobby: { ...lobby, phase: 'playing' },
      game: {
        ...game,
        phase: 'gameover',
        winner: 0,
        players: game.players.map((p, i) => (i === 0 ? p : { ...p, isEliminated: true })),
      },
      reaperAt: Date.now() + 60_000,
    });
  });
}

async function startTwoPlayerRoom() {
  const code = await createRoom();
  const host = await openWs(code);
  const joiner = await openWs(code);

  host.ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName: 'Host' }));
  await waitForInbox(host.inbox, (m) => m.type === 'LOBBY_STATE');

  joiner.ws.send(JSON.stringify({ type: 'HELLO', version: 1, displayName: 'Joiner' }));
  await waitForInbox(joiner.inbox, (m) => m.type === 'LOBBY_STATE');

  host.ws.send(JSON.stringify({ type: 'START', magicItems: false }));
  await waitForInbox(host.inbox, (m) => m.type === 'GAME_STATE');
  await waitForInbox(joiner.inbox, (m) => m.type === 'GAME_STATE');

  await seedGameOver(code);
  return { code, host, joiner };
}

describe('RESTART_ROOM', () => {
  it('host can restart room to lobby after gameover', async () => {
    const { code, host, joiner } = await startTwoPlayerRoom();

    host.ws.send(JSON.stringify({ type: 'RESTART_ROOM' }));
    const hostLobby = await waitForInbox(
      host.inbox,
      (m) => m.type === 'LOBBY_STATE' && (m.code as string) === code,
    );
    const joinerLobby = await waitForInbox(
      joiner.inbox,
      (m) => m.type === 'LOBBY_STATE' && (m.code as string) === code,
    );
    expect(hostLobby.type).toBe('LOBBY_STATE');
    expect(joinerLobby.type).toBe('LOBBY_STATE');

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    await runInDurableObject(stub, async (_instance, state) => {
      const lobby = (await state.storage.get('lobby')) as { phase: string };
      const game = await state.storage.get('game');
      const reaperAt = await state.storage.get('reaperAt');
      expect(lobby.phase).toBe('lobby');
      expect(game).toBeUndefined();
      expect(reaperAt).toBeUndefined();
    });
  });

  it('non-host gets UNAUTHORIZED', async () => {
    const { joiner } = await startTwoPlayerRoom();

    joiner.ws.send(JSON.stringify({ type: 'RESTART_ROOM' }));
    const err = await waitForInbox(joiner.inbox, (m) => m.type === 'ERROR');
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('host can send RESTART_ROOM again after restart without fatal error', async () => {
    const { code, host } = await startTwoPlayerRoom();

    host.ws.send(JSON.stringify({ type: 'RESTART_ROOM' }));
    await waitForInbox(host.inbox, (m) => m.type === 'LOBBY_STATE' && (m.code as string) === code);

    host.ws.send(JSON.stringify({ type: 'RESTART_ROOM' }));
    const msg = await waitForInbox(host.inbox, (m) => m.type === 'LOBBY_STATE' && (m.code as string) === code);
    expect(msg.type).toBe('LOBBY_STATE');
  });
});
