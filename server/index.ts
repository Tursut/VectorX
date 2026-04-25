// Cloudflare Worker + RoomDurableObject.
// Step 4: /ping. Step 5: POST /rooms + DO init. Step 6: /rooms/:code/ws echo.
// Step 7: zod schemas in protocol.ts. Step 8: shared game logic + validateMove.
// Step 9: lobby dispatcher (HELLO/START/LOBBY_STATE). Step 10: server-
// authoritative turn loop — START boots initGame and broadcasts GAME_STATE;
// MOVE validates + applyMove + broadcasts. Illegal moves return typed ERRORs.

import { DurableObject } from 'cloudflare:workers';
import {
  parseClientMsg,
  type GameStateMsg,
  type HelloMsg,
  type JoinMsg,
  type LobbyStateMsg,
  type MoveMsg,
  type ServerMsg,
  type StartMsg,
} from './protocol';
// Shared pure game module. Imported from src/game/ — single source of truth
// with the client. Purity invariant enforced by CLAUDE.md (no React, no DOM).
// Types come in as `any` (no .d.ts on the .js files); we re-type via protocol.ts
// when assembling outbound messages.
import {
  initGame,
  applyMove,
  validateMove,
  eliminateCurrentPlayer,
  eliminatePlayer,
} from '../src/game/logic';
import { getGremlinMove } from '../src/game/ai';
import { PLAYERS, TURN_TIME } from '../src/game/constants';

// Human turn-timer budget. TURN_TIME is seconds in the shared constants; the
// DO alarm API expects milliseconds.
const TURN_TIME_MS = TURN_TIME * 1000;

interface Env {
  ROOM: DurableObjectNamespace<RoomDurableObject>;
}

// Base32 excluding visually-confusable chars (0/O/1/I). 32 symbols → 5 bits
// per char → 32⁵ ≈ 33.5M combinations over 5 chars. Random picks still need
// collision handling (birthday paradox: ~1.5% across 1000 samples) — the DO's
// atomic put-if-empty + the Worker's retry loop below are what make this safe.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

// Looser path regex than CODE_RE on purpose: it rejects obvious garbage paths
// (`/rooms/abc/ws`, `/rooms//ws`) fast, and any surviving non-alphabet value
// falls into the 400 branch below. Two cheap checks keep the alphabet
// invariant local to one place.
const WS_PATH_RE = /^\/rooms\/([A-Z2-9]{5})\/ws$/;

const MAX_PLAYERS = 4;

// ----- Step 20: abuse hardening -----

// Allowed browser origins for POST /rooms and WS upgrades. Non-browser callers
// (curl, SELF.fetch in workers-pool tests, server-to-server fetches) omit the
// Origin header entirely — we allow those through so debugging and tests keep
// working. Anything with a NON-empty Origin that isn't in this set → 403.
const ALLOWED_ORIGINS = new Set([
  'https://tursut.github.io',
  'http://localhost:5173', // Vite dev server
  'http://localhost:4173', // Vite preview server
]);

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (origin === null) return true;
  return ALLOWED_ORIGINS.has(origin);
}

// Per-IP sliding-window rate limiter. Isolate-local Map, so a griefer bouncing
// between Cloudflare data centres gets a fresh bucket per isolate — acceptable
// for our threat model, and costs zero DO requests (unlike a RateLimiter DO).
// Keys: `${scope}:${ip}`. The `scope` prefix lets a single IP hit different
// routes independently (POST /rooms + WS handshake).
const RATE_BUCKETS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const ROOM_CREATE_LIMIT = 10;   // per IP per minute
const WS_HANDSHAKE_LIMIT = 30;  // per IP per minute

function rateLimitAllow(scope: string, ip: string | null, limit: number): boolean {
  // No IP header (tests, non-CF proxies) → skip rate limiting. Production
  // always sets CF-Connecting-IP; the absence is a test-harness signal.
  if (!ip) return true;
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const bucket = (RATE_BUCKETS.get(key) ?? []).filter((t) => t > cutoff);
  if (bucket.length >= limit) {
    RATE_BUCKETS.set(key, bucket);
    return false;
  }
  bucket.push(now);
  RATE_BUCKETS.set(key, bucket);
  return true;
}

// Test-only: reset the rate-limit map so tests can run with predictable state
// when they explicitly opt into rate-limit behaviour (by setting an IP).
export function _resetRateLimiters(): void {
  RATE_BUCKETS.clear();
}

// WS frame size cap. Our largest legitimate client→server payload is MOVE,
// which serialises to <40 bytes. 4 KiB is 100× safety margin; anything bigger
// is griefing and we close the socket with the "message too big" code.
const MAX_FRAME_BYTES = 4096;

// Room reaper: delete a finished room's DO storage 10 minutes after the game
// ends, so storage doesn't accumulate forever. Read in the alarm handler.
const REAPER_DELAY_MS = 10 * 60 * 1000;

// Lobby disconnect grace. iOS Safari aggressively suspends the WebSocket when
// its tab is backgrounded, so a clean WS close arriving without an explicit
// 1000 from the client is almost always a temporary suspension, not a real
// leave. We hold the seat for this long; if a HELLO with the same displayName
// arrives in the window the player resumes their seat. On expiry the alarm
// drops the seat (and reassigns host if needed) just like a hard leave.
//
// Sized for the dominant pre-START flow: the host opens the room, switches
// apps to share the link via Snap/SMS, types a message, hits send, switches
// back. That round-trip is realistically 30–60 s of foreground-elsewhere; iOS
// will have suspended the tab within seconds. 90 s comfortably covers it
// without holding abandoned seats long enough to block 4-player rooms — and
// a deliberate exit (close code 1000 from the wrapper's close()) still drops
// the seat instantly.
const LOBBY_GRACE_MS = 90 * 1000;

function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let out = '';
  for (const b of bytes) {
    out += CODE_ALPHABET[b & 0x1f];
  }
  return out;
}

// Storage shape (single `lobby` key). `isHost` is NOT stored — it's derived at
// broadcast time from `hostId` so host reassignment on disconnect is a single
// field update instead of N per-player flag updates.
//
// `disconnectedAt` is internal-only: when set, the seat is in the grace
// window after an abnormal close. It's stripped at the wire boundary in
// buildLobbyState so other clients see the player exactly as before.
type LobbyStorage = {
  players: Array<{
    id: number;
    displayName: string;
    isBot: boolean;
    disconnectedAt: number | null;
  }>;
  hostId: number | null;
  phase: 'lobby' | 'playing';
  magicItems: boolean;
};

const EMPTY_LOBBY: LobbyStorage = {
  players: [],
  hostId: null,
  phase: 'lobby',
  magicItems: false,
};

// Game state stored under the `game` key. Shape mirrors `initGame` output from
// src/game/logic.js exactly (see docs/ARCHITECTURE.md "State shape"). Typed as
// `any` here because logic.js is untyped at the boundary; the outbound
// GAME_STATE message is zod-validated shape via protocol.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameStorage = any;

export class RoomDurableObject extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/rooms' && request.method === 'POST') {
      // First-time init only. Second caller gets 409 so the Worker can pick
      // a different random code. This atomic check-and-write is what makes
      // the Worker's retry loop race-safe against concurrent inits.
      const existing = await this.ctx.storage.get<string>('code');
      if (existing !== undefined) {
        return new Response('conflict', { status: 409 });
      }
      const { code } = (await request.json()) as { code: string };
      await this.ctx.storage.put({
        code,
        createdAt: Date.now(),
        lobby: EMPTY_LOBBY,
      });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/ws' && request.method === 'GET') {
      // Reject pre-upgrade if the room was never initialised. Keeps the
      // contract: clients only reach `/ws` via a code that `POST /rooms`
      // minted. No half-open sockets.
      const code = await this.ctx.storage.get<string>('code');
      if (code === undefined) {
        return new Response('Room not found', { status: 404 });
      }

      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];

      // Hibernation entry point. Replaces `server.accept()` — the runtime
      // tracks this socket and dispatches inbound frames to
      // `webSocketMessage` below, allowing the DO to hibernate between them.
      this.ctx.acceptWebSocket(server);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not Found', { status: 404 });
  }

  // Hibernation dispatch. Parse → parseClientMsg → route.
  override async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    // Frame-size cap. Largest legit payload is MOVE at ~40 bytes; anything
    // over 4 KiB is griefing. Close with 1009 (Message Too Big) and don't
    // even attempt to parse the payload.
    const size = typeof raw === 'string' ? raw.length : raw.byteLength;
    if (size > MAX_FRAME_BYTES) {
      try {
        ws.close(1009, 'Message too big');
      } catch {
        // Socket already dead; nothing to do.
      }
      return;
    }

    // Binary frames aren't part of the text-JSON protocol.
    if (typeof raw !== 'string') {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    const result = parseClientMsg(parsed);
    if (!result.ok) {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    const msg = result.msg;
    switch (msg.type) {
      case 'HELLO':
        await this.handleHello(ws, msg);
        return;
      case 'START':
        await this.handleStart(ws, msg);
        return;
      case 'MOVE':
        await this.handleMove(ws, msg);
        return;
    }
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    // Wrap the whole body: DO teardown races during tests can throw storage
    // reads; we always want to attempt ws.close() at the end.
    try {
      const seatId = this.getAttachedSeatId(ws);
      if (seatId === null) return;

      const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');
      if (!lobby) return;

      if (lobby.phase === 'lobby') {
        // Code 1000 = client-initiated clean close. Treat as a deliberate
        // leave: drop the seat immediately, reassign host, broadcast. Anything
        // else (1006 from iOS suspension, 1001 going-away, 1011 errors, …) is
        // probably temporary — hold the seat for LOBBY_GRACE_MS and let a
        // re-HELLO with the same displayName resume it.
        if (code === 1000) {
          const players = lobby.players.filter((p) => p.id !== seatId);
          let hostId = lobby.hostId;
          if (hostId === seatId) {
            hostId = players.length > 0 ? players[0].id : null;
          }
          const updated: LobbyStorage = { ...lobby, players, hostId };
          await this.ctx.storage.put('lobby', updated);

          const storedCode = await this.ctx.storage.get<string>('code');
          if (storedCode) {
            this.broadcast(this.buildLobbyState(storedCode, updated));
          }
          await this.scheduleLobbyGraceAlarm(updated);
        } else {
          const now = Date.now();
          const players = lobby.players.map((p) =>
            p.id === seatId ? { ...p, disconnectedAt: now } : p,
          );
          const updated: LobbyStorage = { ...lobby, players };
          await this.ctx.storage.put('lobby', updated);
          // No broadcast — visible state is unchanged for other clients.
          await this.scheduleLobbyGraceAlarm(updated);
        }
      } else {
        // lobby.phase === 'playing' → disconnect = elimination (Step 12).
        // Leave the seat's cells claimed (the tombstone), advance turn if
        // they were current, check gameover, broadcast updated GAME_STATE.
        // If the game is already over or the player was already eliminated,
        // eliminatePlayer is a no-op — skip the broadcast path to avoid
        // spurious state-unchanged broadcasts after game end.
        const storedCode = await this.ctx.storage.get<string>('code');
        const game = await this.ctx.storage.get<GameStorage>('game');
        if (storedCode && game && game.phase === 'playing') {
          const next = eliminatePlayer(game, seatId) as GameStorage;
          if (next !== game) {
            await this.ctx.storage.put('game', next);
            this.broadcast(this.buildGameState(storedCode, lobby, next));
            await this.maybeScheduleTurnAlarm(next, lobby);
          }
        }
      }
    } catch {
      // DO/storage may be torn down; ignore and still close the socket below.
    }
    try {
      ws.close(code, reason);
    } catch {
      // already closed — harmless
    }
  }

  override webSocketError(ws: WebSocket, _error: unknown): void {
    try {
      ws.close(1011, 'error');
    } catch {
      // already closed — harmless
    }
  }

  // Bot turn driver. Runs when a scheduled alarm fires — see
  // maybeScheduleTurnAlarm below for when that happens. Guards against stale
  // invocations (game over, phase flipped, current player changed to a
  // human between scheduling and firing). Chains consecutive bot turns by
  // re-scheduling at the end.
  override async alarm(): Promise<void> {
    // Reaper check first: if a post-GAME_OVER reaper was scheduled and the
    // 10-minute grace is up, drain sockets and wipe all storage. Subsequent
    // WS upgrades for this room code will 404 (storage.get('code') is now
    // undefined).
    const reaperAt = await this.ctx.storage.get<number>('reaperAt');
    if (reaperAt !== undefined && Date.now() >= reaperAt) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, 'Room closed');
        } catch {
          // Socket already torn down — nothing to do.
        }
      }
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const code = await this.ctx.storage.get<string>('code');
    const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');

    // Lobby grace expiry: any seats still flagged disconnected past the grace
    // window are truly gone. Drop them, reassign host if needed, broadcast.
    if (code && lobby && lobby.phase === 'lobby') {
      await this.processLobbyGrace(code, lobby);
      return;
    }

    let game = await this.ctx.storage.get<GameStorage>('game');
    if (
      !code ||
      !lobby ||
      !game ||
      lobby.phase !== 'playing' ||
      game.phase !== 'playing'
    ) {
      return;
    }
    const currentSeatId = game.players[game.currentPlayerIndex].id;
    const isHuman = lobby.players.some((p) => p.id === currentSeatId);
    if (isHuman) {
      // Human's turn-timer elapsed → auto-forfeit. Mirrors the hotseat
      // TIMEOUT dispatch in LocalGameController: eliminateCurrentPlayer,
      // which advances turn + runs completeTurn's item/gameover logic.
      game = eliminateCurrentPlayer(game) as GameStorage;
    } else {
      // Bot's turn. getGremlinMove returns null when it has no legal moves
      // — same hotseat TIMEOUT path → eliminate the stuck bot.
      const move = getGremlinMove(game, 1);
      game = move
        ? (applyMove(game, move.row, move.col) as GameStorage)
        : (eliminateCurrentPlayer(game) as GameStorage);
    }
    await this.ctx.storage.put('game', game);
    this.broadcast(this.buildGameState(code, lobby, game));
    await this.maybeScheduleTurnAlarm(game, lobby);
  }

  // ----- Handlers -----

  private async handleHello(ws: WebSocket, msg: HelloMsg): Promise<void> {
    const storedCode = await this.ctx.storage.get<string>('code');
    const lobby = (await this.ctx.storage.get<LobbyStorage>('lobby')) ?? EMPTY_LOBBY;
    if (!storedCode) {
      // Shouldn't happen — room has to be initialised before /ws accepts.
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    if (lobby.phase !== 'lobby') {
      this.sendError(ws, 'ALREADY_STARTED');
      return;
    }

    // Idempotent re-HELLO: if the socket already has an attached seat that
    // still matches a live player, just resend LOBBY_STATE. If the attachment
    // is stale (player was removed while socket was in flight), fall through
    // to fresh-join behaviour.
    const attached = this.getAttachedSeatId(ws);
    if (attached !== null && lobby.players.some((p) => p.id === attached)) {
      ws.send(JSON.stringify(this.buildLobbyState(storedCode, lobby)));
      return;
    }

    // Grace-period recovery: if a player with the same displayName is
    // currently in the disconnected state (their previous WS dropped without
    // a clean 1000 close), reattach this fresh socket to that seat. Same
    // identity, same seat — exactly what an iOS-suspended Safari tab needs to
    // resume the lobby without becoming a phantom join.
    const recovering = lobby.players.find(
      (p) => p.disconnectedAt !== null && p.displayName === msg.displayName,
    );
    if (recovering) {
      const players = lobby.players.map((p) =>
        p.id === recovering.id ? { ...p, disconnectedAt: null } : p,
      );
      const updated: LobbyStorage = { ...lobby, players };
      await this.ctx.storage.put('lobby', updated);
      ws.serializeAttachment({ seatId: recovering.id });
      ws.send(JSON.stringify(this.buildLobbyState(storedCode, updated)));
      // Refresh the grace alarm to reflect any other still-disconnected
      // players (or clear it if this was the last one).
      await this.scheduleLobbyGraceAlarm(updated);
      return;
    }

    if (lobby.players.length >= MAX_PLAYERS) {
      this.sendError(ws, 'ROOM_FULL');
      return;
    }

    if (lobby.players.some((p) => p.displayName === msg.displayName)) {
      this.sendError(ws, 'DUPLICATE_NAME');
      return;
    }

    const newId = lowestUnusedId(lobby.players.map((p) => p.id));
    const newPlayer = {
      id: newId,
      displayName: msg.displayName,
      isBot: false,
      disconnectedAt: null,
    };
    const updated: LobbyStorage = {
      ...lobby,
      players: [...lobby.players, newPlayer],
      hostId: lobby.hostId ?? newId,
    };
    await this.ctx.storage.put('lobby', updated);

    ws.serializeAttachment({ seatId: newId });

    const joinMsg: JoinMsg = {
      type: 'JOIN',
      player: {
        id: newPlayer.id,
        displayName: newPlayer.displayName,
        isBot: newPlayer.isBot,
        isHost: newPlayer.id === updated.hostId,
      },
    };
    this.broadcast(joinMsg); // includes joiner — client symmetry
    this.broadcast(this.buildLobbyState(storedCode, updated));
  }

  private async handleStart(ws: WebSocket, msg: StartMsg): Promise<void> {
    const storedCode = await this.ctx.storage.get<string>('code');
    const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');
    if (!storedCode || !lobby) {
      this.sendError(ws, 'BAD_PAYLOAD');
      return;
    }

    // Phase check BEFORE host check: ALREADY_STARTED is more informative than
    // UNAUTHORIZED for a duplicate/late START, even from a non-host.
    if (lobby.phase !== 'lobby') {
      this.sendError(ws, 'ALREADY_STARTED');
      return;
    }

    const seatId = this.getAttachedSeatId(ws);
    if (seatId === null || seatId !== lobby.hostId) {
      this.sendError(ws, 'UNAUTHORIZED');
      return;
    }

    // Drop any seats still in the lobby grace window — if a player hasn't
    // re-attached by START they're not actually playing, and bots should fill
    // the slot. Compact the survivors so seat IDs are 0..N-1 implicitly via
    // the existing gremlinCount convention.
    const activeLobbyPlayers = lobby.players.filter(
      (p) => p.disconnectedAt === null,
    );

    // gremlinCount tells initGame how many of the last seats are bots by
    // convention. For Step 10 we assume humans fill seats 0..N-1 (tests do);
    // Step 11 adds the bot-fill compaction + drives bot turns via
    // getGremlinMove. isBot on each outbound GamePlayer is derived from the
    // lobby roster (see buildGameState) — not the gremlinCount convention —
    // so lobby gaps are still honest on the wire even today.
    const gremlinCount = 4 - activeLobbyPlayers.length;
    const game = initGame(msg.magicItems, gremlinCount) as GameStorage;

    const updatedLobby: LobbyStorage = {
      ...lobby,
      players: activeLobbyPlayers,
      phase: 'playing',
      magicItems: msg.magicItems,
    };

    // One atomic write: phase flip + fresh game state. Readers never see a
    // half-started room.
    await this.ctx.storage.put({ lobby: updatedLobby, game });

    this.broadcast(this.buildGameState(storedCode, updatedLobby, game));
    await this.maybeScheduleTurnAlarm(game, updatedLobby);
  }

  private async handleMove(ws: WebSocket, msg: MoveMsg): Promise<void> {
    const storedCode = await this.ctx.storage.get<string>('code');
    const lobby = await this.ctx.storage.get<LobbyStorage>('lobby');
    const game = await this.ctx.storage.get<GameStorage>('game');

    if (!storedCode || !lobby || !game || lobby.phase !== 'playing') {
      this.sendError(ws, 'INVALID_MOVE', 'Game not started');
      return;
    }

    const seatId = this.getAttachedSeatId(ws);
    if (seatId === null) {
      // Socket never HELLO'd — can't prove identity, can't move.
      this.sendError(ws, 'UNAUTHORIZED');
      return;
    }

    // validateMove's reason strings map 1:1 to ERROR.code values (see
    // src/game/logic.js Step 8 comment). Forward directly.
    const result = validateMove(game, seatId, msg.row, msg.col) as
      | { ok: true }
      | { ok: false; reason: 'NOT_YOUR_TURN' | 'INVALID_MOVE' };
    if (!result.ok) {
      this.sendError(ws, result.reason);
      return;
    }

    const nextGame = applyMove(game, msg.row, msg.col) as GameStorage;
    await this.ctx.storage.put('game', nextGame);

    this.broadcast(this.buildGameState(storedCode, lobby, nextGame));
    await this.maybeScheduleTurnAlarm(nextGame, lobby);
  }

  // ----- Helpers -----

  private broadcast(msg: ServerMsg, opts?: { excludeSeatId?: number }): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      // Skip terminal states only — hibernation-accepted sockets may not report
      // readyState === OPEN even when they're perfectly live. The try/catch
      // below handles any "send on closed socket" edge cases.
      if (
        ws.readyState === WebSocket.CLOSING ||
        ws.readyState === WebSocket.CLOSED
      ) {
        continue;
      }
      if (opts?.excludeSeatId !== undefined) {
        const a = this.getAttachedSeatId(ws);
        if (a === opts.excludeSeatId) continue;
      }
      try {
        ws.send(raw);
      } catch {
        // One misbehaving socket shouldn't abort the broadcast.
      }
    }
  }

  // Called after every state-transitioning broadcast (START, MOVE, alarm).
  // Ensures exactly one of:
  //   - Game over / non-playing phase → no alarm (delete any stale one).
  //   - Current seat is a human       → no alarm (they need to move).
  //   - Current seat is a bot         → alarm scheduled 800–1400ms out.
  // setAlarm overwrites any existing alarm; deleteAlarm is idempotent.
  // Called after every state-transitioning broadcast (START, MOVE, alarm,
  // disconnect). Schedules exactly one alarm:
  //   - Game over / non-playing phase → deleteAlarm (alarm is idempotent).
  //   - Current seat is a bot → 800–1400ms "thinking delay" for feel.
  //   - Current seat is a human → TURN_TIME_MS deadline for their move.
  //   - Current seat is an eliminated ghost (shouldn't happen post-Step-8's
  //     advanceToNextActive, but defensive) → deleteAlarm; the runtime can
  //     recover once some other transition brings a live seat back.
  // setAlarm overwrites any existing alarm — no read-then-write needed.
  // Sweep disconnected seats whose grace expired; reassign host if they were
  // it; broadcast the new lobby state. Reschedules the alarm if anyone else
  // is still inside their own grace window.
  private async processLobbyGrace(
    code: string,
    lobby: LobbyStorage,
  ): Promise<void> {
    const now = Date.now();
    const expiredIds = new Set(
      lobby.players
        .filter(
          (p) =>
            p.disconnectedAt !== null &&
            now - p.disconnectedAt >= LOBBY_GRACE_MS,
        )
        .map((p) => p.id),
    );

    if (expiredIds.size === 0) {
      // Spurious wake-up (or alarm fired slightly early). Reschedule for the
      // next pending grace expiry.
      await this.scheduleLobbyGraceAlarm(lobby);
      return;
    }

    const survivors = lobby.players.filter((p) => !expiredIds.has(p.id));
    let hostId = lobby.hostId;
    if (hostId !== null && expiredIds.has(hostId)) {
      hostId = survivors.length > 0 ? survivors[0].id : null;
    }
    const updated: LobbyStorage = { ...lobby, players: survivors, hostId };
    await this.ctx.storage.put('lobby', updated);
    this.broadcast(this.buildLobbyState(code, updated));
    await this.scheduleLobbyGraceAlarm(updated);
  }

  // Set the DO alarm to the earliest pending lobby-grace expiry, or clear it
  // if no seat is currently disconnected. Called after every lobby-state
  // mutation that touches `disconnectedAt`.
  private async scheduleLobbyGraceAlarm(lobby: LobbyStorage): Promise<void> {
    let earliest: number | null = null;
    for (const p of lobby.players) {
      if (p.disconnectedAt !== null) {
        const expiry = p.disconnectedAt + LOBBY_GRACE_MS;
        if (earliest === null || expiry < earliest) earliest = expiry;
      }
    }
    if (earliest === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.max(earliest, Date.now() + 1));
  }

  private async maybeScheduleTurnAlarm(
    game: GameStorage,
    lobby: LobbyStorage,
  ): Promise<void> {
    if (game.phase !== 'playing') {
      // Game over (or otherwise not playing). Replace any pending turn alarm
      // with the room reaper, if we haven't already scheduled it. reaperAt
      // is persisted so concurrent triggers (close + alarm) don't race the
      // schedule; once set, it's not re-bumped.
      const existing = await this.ctx.storage.get<number>('reaperAt');
      if (existing === undefined) {
        const target = Date.now() + REAPER_DELAY_MS;
        await this.ctx.storage.put('reaperAt', target);
        await this.ctx.storage.setAlarm(target);
      }
      return;
    }
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (currentPlayer.isEliminated) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Date.now() + computeTurnDelay(game, lobby));
  }

  private buildLobbyState(code: string, lobby: LobbyStorage): LobbyStateMsg {
    return {
      type: 'LOBBY_STATE',
      code,
      // Project storage → wire explicitly. The storage shape carries a
      // `disconnectedAt` field (internal grace-period bookkeeping) that the
      // strict LobbyPlayer wire schema rejects.
      players: lobby.players.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        isBot: p.isBot,
        isHost: p.id === lobby.hostId,
      })),
      hostId: lobby.hostId,
      magicItems: lobby.magicItems,
    };
  }

  // Assemble a wire-shape GAME_STATE by merging identity (displayName,
  // isBot, isHost) from the lobby into the game state's players array. The
  // game module doesn't know about display names, and the lobby doesn't know
  // about row/col/isEliminated — this helper is the single place those
  // halves join. Seats not present in the lobby (Step 11's bot fill, or
  // mid-lobby departures before START) are marked isBot: true with a
  // character-shortName display name prefixed by 🤖 (e.g., "🤖 Bluebot").
  private buildGameState(
    code: string,
    lobby: LobbyStorage,
    game: GameStorage,
  ): GameStateMsg {
    void code; // GAME_STATE has no code field today; the param keeps the
               // helper signature symmetric with buildLobbyState for Step 13
               // when the client may want code on GAME_STATE too.
    const lobbyById = new Map(lobby.players.map((p) => [p.id, p]));
    return {
      type: 'GAME_STATE',
      grid: game.grid,
      players: game.players.map((gp: {
        id: number;
        row: number;
        col: number;
        isEliminated: boolean;
        deathCell: { row: number; col: number } | null;
        finishTurn?: number | null;
      }) => {
        const lp = lobbyById.get(gp.id);
        return {
          id: gp.id,
          // Bots borrow the local-game character shortName (Reginald,
          // Gerald, Bluebot, Buzzilda) for continuity with hotseat play,
          // prefixed with 🤖 so the visual stays distinct even if a human
          // happens to pick a character shortName as their displayName.
          displayName: lp?.displayName ?? `🤖 ${PLAYERS[gp.id].shortName}`,
          isBot: lp ? lp.isBot : true,
          isHost: gp.id === lobby.hostId,
          row: gp.row,
          col: gp.col,
          isEliminated: gp.isEliminated,
          deathCell: gp.deathCell ?? null,
          // logic.js doesn't always set finishTurn; protocol requires
          // always-present-but-nullable.
          finishTurn: gp.finishTurn ?? null,
        };
      }),
      currentPlayerIndex: game.currentPlayerIndex,
      phase: game.phase,
      winner: game.winner,
      turnCount: game.turnCount,
      magicItems: game.magicItems,
      items: game.items,
      nextSpawnIn: game.nextSpawnIn,
      portalActive: game.portalActive,
      swapActive: game.swapActive,
      freezeSelectActive: game.freezeSelectActive,
      frozenPlayerId: game.frozenPlayerId,
      frozenTurnsLeft: game.frozenTurnsLeft,
      lastEvent: game.lastEvent,
    };
  }

  private getAttachedSeatId(ws: WebSocket): number | null {
    try {
      const a = ws.deserializeAttachment() as { seatId?: number } | null;
      return a?.seatId ?? null;
    } catch {
      return null;
    }
  }

  private sendError(
    ws: WebSocket,
    code:
      | 'NOT_YOUR_TURN'
      | 'INVALID_MOVE'
      | 'ROOM_FULL'
      | 'DUPLICATE_NAME'
      | 'UNAUTHORIZED'
      | 'BAD_PAYLOAD'
      | 'ALREADY_STARTED',
    message?: string,
  ): void {
    const payload: ServerMsg = message
      ? { type: 'ERROR', code, message }
      : { type: 'ERROR', code };
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // socket gone — nothing to do
    }
  }
}

// Bot thinking-delay schedule. Exported so the timing branches are unit-
// testable without driving real alarms (which would also run a non-
// deterministic bot move and complicate any "what's the next delay?"
// assertion). Mirrors LocalGameController's branch:
//   - human's turn → full TURN_TIME budget for them to move
//   - bot's turn, at least one human still alive → 800–1400 ms thinking pace
//   - bot's turn, no humans left → 120–200 ms speed-run pace
export function computeTurnDelay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  game: any,
  lobby: { players: Array<{ id: number }> },
): number {
  const currentPlayer = game.players[game.currentPlayerIndex];
  const isHuman = lobby.players.some((p) => p.id === currentPlayer.id);
  if (isHuman) return TURN_TIME_MS;
  const humanIds = new Set(lobby.players.map((p) => p.id));
  const anyHumanAlive = game.players.some(
    (p: { id: number; isEliminated: boolean }) =>
      !p.isEliminated && humanIds.has(p.id),
  );
  return anyHumanAlive
    ? 800 + Math.floor(Math.random() * 600)
    : 120 + Math.floor(Math.random() * 80);
}

function lowestUnusedId(used: number[]): number {
  const taken = new Set(used);
  for (let i = 0; i < MAX_PLAYERS; i++) {
    if (!taken.has(i)) return i;
  }
  // Caller is responsible for capacity check; this should never fire.
  throw new Error('no free seat');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ping') {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { allow: 'GET' } });
      }
      return new Response('pong', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname === '/rooms') {
      if (request.method !== 'POST') {
        return new Response(null, { status: 405, headers: { allow: 'POST' } });
      }
      if (!originAllowed(request)) {
        return new Response('Origin not allowed', { status: 403 });
      }
      const ip = request.headers.get('CF-Connecting-IP');
      if (!rateLimitAllow('rooms', ip, ROOM_CREATE_LIMIT)) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'retry-after': '60' },
        });
      }
      // Up to 5 retries on DO 409 (collision). With 33.5M space and a clean
      // uniform generator, this branch effectively never re-loops in practice.
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const initRes = await stub.fetch('http://do/rooms', {
          method: 'POST',
          body: JSON.stringify({ code }),
        });
        if (initRes.status === 204) {
          return new Response(JSON.stringify({ code }), {
            status: 201,
            headers: {
              'content-type': 'application/json',
              // Permissive CORS so the browser can read the response from
              // whatever origin the client is running on (GitHub Pages,
              // localhost, preview). Step 20 replaces `*` with a tight
              // allow-list against the `Origin` header.
              'access-control-allow-origin': '*',
            },
          });
        }
        if (initRes.status !== 409) {
          return new Response('Room init failed', { status: 502 });
        }
      }
      return new Response('Exhausted room code retries', { status: 500 });
    }

    const wsMatch = WS_PATH_RE.exec(url.pathname);
    if (wsMatch) {
      if (request.method !== 'GET') {
        return new Response(null, { status: 405, headers: { allow: 'GET' } });
      }
      if (!originAllowed(request)) {
        return new Response('Origin not allowed', { status: 403 });
      }
      const ip = request.headers.get('CF-Connecting-IP');
      if (!rateLimitAllow('ws', ip, WS_HANDSHAKE_LIMIT)) {
        return new Response('Too Many Requests', {
          status: 429,
          headers: { 'retry-after': '60' },
        });
      }
      if (request.headers.get('upgrade') !== 'websocket') {
        return new Response('Upgrade Required', {
          status: 426,
          headers: { upgrade: 'websocket' },
        });
      }
      const code = wsMatch[1];
      // Belt and braces: path regex allows [A-Z2-9] but the alphabet excludes
      // O, I. Anything that slips through the path pattern but fails the
      // alphabet check is a malformed code.
      if (!CODE_RE.test(code)) {
        return new Response('Malformed code', { status: 400 });
      }
      // Forward to the DO with a rewritten internal URL. `new Request(url,
      // init)` preserves method, headers (Upgrade, Sec-WebSocket-Key, …)
      // and body — everything the handshake needs.
      const doReq = new Request('http://do/ws', request);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(doReq);
    }

    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
