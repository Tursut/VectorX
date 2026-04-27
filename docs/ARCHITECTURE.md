# VectorX — Architecture Overview

Living snapshot of the current app. Update this file at the end of any step (in `docs/multiplayer-plan.md`) that changes architecture, tech, state shape, invariants, deploy, or adds a subsystem.

## What it is

VectorX (public name **Mind the Grid**, npm package name `mind-the-grid`) is a turn-based grid-claiming game. Four characters start in the four corners of a 10×10 grid. On each turn, the active player must claim one empty cell **8-way adjacent** to their current position. A player is eliminated when they have no adjacent empty cell to move to (trapped). Last one standing wins.

Optional **magic items** (bomb, portal, freeze, swap) spawn periodically and create interesting mid-game swings. The game runs on a single device — one to four real people share it, and **gremlins** (bots) fill any seats not taken by humans (`gremlinCount` 0–3).

There is also a **sandbox mode** (1 human vs 1 bot, items placed by hand) for demoing and testing item behavior without game pressure.

## Tech stack

- **React 19** + **Vite 8** (JS, not TS)
- **framer-motion** for transitions, countdown, overlays, bomb/portal/swap flashes
- Global CSS in `src/App.css` (1.7k lines) + minimal `src/index.css`
- Custom Web Audio API synth in `src/game/sounds.js` (no audio files — everything is generated)
- **No backend, no network, no persistence, no accounts** — everything lives in memory, client-side only
- **No tests** currently (no test runner configured)
- ESLint 9 flat config in `eslint.config.js`

## How it's built & run

- `npm run dev` — Vite dev server with HMR
- `npm run build` — production build to `dist/`
- `npm run preview` — preview the production build
- `npm run lint` — ESLint
- `npm test` — client Vitest suite (jsdom)
- `npm run test:server` — server Vitest suite (workerd via `@cloudflare/vitest-pool-workers`)
- `npm run test:e2e` — Playwright end-to-end tests (chromium)

## Deploy

- **Host:** GitHub Pages, via `.github/workflows/deploy.yml`
- **Trigger branch:** pushes to `claude/grid-territory-game-design-433J8` (this is the currently-deploying branch — **not** `main`). The workflow runs `npm ci && npm run build`, uploads `dist/` as a Pages artifact, and deploys via `actions/deploy-pages@v4`. There is no `gh-pages` branch.
- **Invariant for multiplayer work:** don't push to that branch until online play is ready to go live. The multiplayer feature branch (`claude/multiplayer-architecture-planning-X2NrO`) does not trigger a deploy.

## Feature flags / env vars

Build-time flags use Vite's `import.meta.env.VITE_*` convention. Defaults live in a committed `.env`; `.env.example` documents each variable; per-developer overrides go in `.env.local` (gitignored via `*.local`). All reads are centralised in `src/config.js` — do not sprinkle `import.meta.env` across the codebase.

| Flag | Default | Purpose |
| --- | --- | --- |
| `VITE_ENABLE_ONLINE` | `false` | Gates the multiplayer Create/Join UI and the network client. Production stays `false` until Step 18's preview deploy flips it on. Parse is strict-equals `'true'` — `"1"`, `"yes"`, and unset all resolve to `false`. |

When no code references a flag, Vite tree-shakes the config module out of the bundle entirely — turning the flag on later costs zero bytes today.

## Server (`server/`)

A Cloudflare Worker lives at `server/index.ts`, module-default-export format, with an exported `RoomDurableObject` class bound as `ROOM` via `wrangler.toml`.

**Today's routes:**

| Route | Behaviour |
| --- | --- |
| `GET /ping` | `200 "pong"` |
| `POST /rooms` | Creates a room. Returns `201 {"code":"ABCDE"}`. |
| `GET /rooms/:code/ws` | WebSocket upgrade. `101` on success; the Worker forwards to the room's DO. Returns `404` if room never initialised, `400` for malformed codes (alphabet violation), `426` if `Upgrade: websocket` header missing. |
| Method violations on any above | `405` with `Allow` header |
| Anything else | `404` |

Steps 7–12 will grow this into a zod-validated protocol, ported `src/game/logic.js`, server-authoritative turn loop, server-side bots, and alarm-driven turn timer. Step 6 ships the transport only — the server just echoes whatever comes over the socket.

### Durable Object: `RoomDurableObject` (bound as `ROOM`)

- **One DO per room.** Room code → `env.ROOM.idFromName(code)` → stable DO identity. Same code always lands on the same DO, even after the Worker isolate restarts.
- **Storage today:** `{ code, createdAt, lobby }` where `lobby = { players: [{id, displayName, isBot, disconnectedAt}], hostId, phase: 'lobby'|'playing', magicItems }`. `isHost` is NOT stored — it's derived at broadcast time from `hostId`, so host reassignment on disconnect is a single field update. `disconnectedAt` is internal-only (lobby-grace bookkeeping) and stripped at the wire boundary in `buildLobbyState`. Step 10 added `game` alongside `lobby`.
- **Internal route convention** (Worker-to-DO `stub.fetch`): path mirrors the external path. External `POST /rooms` → internal DO `POST /rooms`. External `GET /rooms/:code/ws` → internal DO `GET /ws` (Worker rewrites the URL via `new Request('http://do/ws', request)` to preserve method + all handshake headers).
- **Init is atomic, one-shot.** DO's `POST /rooms` refuses to reinitialise (returns `409`) if storage already has a `code`. The Worker regenerates a fresh random code and retries up to 5× — race-safe against two Workers randomly picking the same code.
- **Per-socket seat identity** lives in `ws.serializeAttachment({ seatId })` (persists across hibernation). `handleHello` writes it on first join; subsequent handlers (`handleStart`, `webSocketClose`) read via `ws.deserializeAttachment()`.
- **WebSocket lifecycle:** DO's `/ws` handler checks storage has been initialised (`404` if not), creates a `WebSocketPair`, and calls `this.ctx.acceptWebSocket(server)` — the Hibernation API entry point. Inbound frames are dispatched to `webSocketMessage(ws, message)` on the class by the runtime.

### Lobby dispatcher (Step 9)

`webSocketMessage` flow: reject `ArrayBuffer` frames as `BAD_PAYLOAD` → `JSON.parse` → `parseClientMsg` → dispatch on `msg.type`:

- `HELLO`: validate phase (must be `'lobby'`), idempotent re-send (same socket re-HELLOs → LOBBY_STATE back to caller only), capacity (≤ 4), unique displayName. Assigns the lowest-unused seat id 0..3; first joiner becomes host. Broadcasts `JOIN { player }` to **all sockets including the joiner** (client symmetry — one reducer path for "player joined"), followed by a full `LOBBY_STATE` snapshot.
- `START`: phase check runs **before** host check (so duplicate/late START returns `ALREADY_STARTED` even from non-host). Host-only; transitions `phase: 'playing'` and records `magicItems`. No `GAME_STATE` broadcast yet — Step 10 wires that.
- `MOVE`: returns `ERROR INVALID_MOVE` with `"Game not started"` until Step 10 replaces this branch.
- Parse failure / unknown type → `ERROR BAD_PAYLOAD`.

`webSocketClose` during `phase: 'lobby'` branches on the close code. **Code 1000** (deliberate `client.close()` from the wrapper, e.g. exit-to-menu) drops the seat immediately, reassigns `hostId` if the leaver was host, and broadcasts the new `LOBBY_STATE`. **Any other code** (1006 from iOS Safari tab suspension, 1001 going-away, 1011 errors, …) is treated as transient: the seat is held with `disconnectedAt` set and a grace alarm is scheduled at `disconnectedAt + LOBBY_GRACE_MS` (90 s — sized for the dominant flow of host-opens-Snap-to-share-the-link-and-comes-back); no broadcast happens, so observers see no change. A re-HELLO with the same `displayName` inside the window resumes the same seat (clears the flag, sends LOBBY_STATE back). The alarm sweeps any seat whose grace expired, reassigns host if needed, and broadcasts. `handleStart` filters out any still-disconnected seats before booting the game so abandoned grace seats don't take a slot from a bot. **`webSocketClose` during `phase: 'playing'` follows the same code-based branching**: code 1000 eliminates immediately (matches the original disconnect-=-elimination policy for deliberate exits); anything else marks the seat with `disconnectedAt`, schedules a grace alarm at `disconnectedAt + PLAYING_GRACE_MS` (30 s — shorter than the lobby grace because the rest of the table is waiting). A re-HELLO mid-game with the same `displayName` reattaches the seat and pushes the current GAME_STATE so the returning player catches up; on grace expiry the alarm runs `eliminatePlayer`. The 10 s human-turn timer also auto-skips a disconnected player whose turn comes up, so a stuck seat can never stall the game for more than one turn.

Three private helpers on the class: `broadcast(msg, {excludeSeatId?})` iterates `this.ctx.getWebSockets()` and sends (skips only sockets in terminal state; one bad socket doesn't abort the loop); `buildLobbyState(code, lobby)` annotates `isHost` and assembles a `LobbyStateMsg`; `getAttachedSeatId(ws)` safely extracts the attachment.

### Turn loop (Step 10)

Server-authoritative gameplay. Once the host sends `START`:

1. Worker loads `lobby`, verifies `phase === 'lobby'` and caller is host.
2. Calls `initGame(msg.magicItems, 4 - lobby.players.length)` from the shared `src/game/logic.js`.
3. Writes both `lobby` (phase → `'playing'`, magicItems locked in) and the new `game` storage key in a single atomic `storage.put({lobby, game})`.
4. Broadcasts `GAME_STATE` to every connected socket.

On `MOVE`:

1. Load `lobby`, `game`, `code`. If `phase !== 'playing'` → `ERROR INVALID_MOVE "Game not started"`.
2. Read seat from the WS attachment. No seat (socket never HELLO'd) → `ERROR UNAUTHORIZED`.
3. Call `validateMove(game, seatId, row, col)` — the Step 8 security boundary. On reject, forward `result.reason` as the `ERROR.code` directly (reason strings were aligned with the ERROR enum in Step 8).
4. Call `applyMove(game, row, col)`. Store the new state under `game`. Broadcast `GAME_STATE` to every connected socket.

**`buildGameState(code, lobby, game)`** is the merge helper. `initGame` doesn't know display names; the lobby doesn't know row/col. The helper walks `game.players` (always 4 entries) and for each id looks up the matching lobby player for `{displayName, isBot, isHost}`. Seats missing from the lobby (bot fill, or mid-lobby departures before START) become `{displayName: "🤖 ${PLAYERS[id].shortName}", isBot: true}` — e.g., `"🤖 Bluebot"`. Character shortnames match the hotseat-game identity; the emoji prefix keeps bots visually distinct even if a human picks a character shortName as their displayName. `finishTurn` is normalised to `null` when `initGame` doesn't populate it — the `GamePlayer` schema requires always-present-but-nullable.

### Turn alarm driver (Steps 11 + 12)

Bots live only in `game.players` (as all 4 seats from `initGame`). `lobby.players` stays human-only; `isBot` is derived at wire-build time.

A single DO alarm powers two independent behaviours, coordinated by `maybeScheduleTurnAlarm(game, lobby)`:

- **Bot turns** — 800–1400ms "thinking delay" before the server plays for the bot.
- **Human turn timer** — `TURN_TIME_MS` (= `TURN_TIME × 1000` = 10s) deadline; if the human hasn't moved by then, they auto-forfeit.

After every state-transitioning path (`handleStart`, `handleMove`, `alarm`, `webSocketClose` in playing phase), `maybeScheduleTurnAlarm` runs:

- `phase !== 'playing'` → `deleteAlarm()`.
- Current seat is eliminated (defensive; `advanceToNextActive` shouldn't leave one current) → `deleteAlarm()`.
- Current seat is a bot → `setAlarm(Date.now() + 800–1400ms)`.
- Current seat is a human → `setAlarm(Date.now() + TURN_TIME_MS)`.

When the alarm fires, `alarm()` reloads state, re-checks `phase === 'playing'`, and dispatches:

- **Human** (current seat in lobby): `eliminateCurrentPlayer(game)` — mirrors the hotseat TIMEOUT path, advances turn + runs item/gameover logic.
- **Bot** (current seat not in lobby): `getGremlinMove(game, 1)` → `applyMove` on a move, or `eliminateCurrentPlayer` on `null` (trapped bot).

Either branch stores, broadcasts `GAME_STATE`, and tail-calls `maybeScheduleTurnAlarm` to chain into the next turn.

**Disconnect handling, Step 12 → updated for #22**: `webSocketClose` during `phase: 'playing'` used to call `eliminatePlayer(game, seatId)` unconditionally. After the resilience pass for issue #22 (and the follow-up that added the playing-phase grace), it now branches on close code: **1000** → still calls `eliminatePlayer` from the shared module (which delegates to `eliminateCurrentPlayer` when the departing seat is current — full turn advance + item tick — or just marks the seat eliminated with `deathCell` at its current cell + `finishTurn: turnCount` otherwise). **Anything else** → marks the seat `disconnectedAt`, schedules grace, and only eliminates on expiry (or on the existing 10 s turn-timer if that fires first). `eliminatePlayer` itself is unchanged. Skipped entirely if `game.phase !== 'playing'` (post-gameover disconnects are no-ops).

DO single-threading guarantees `webSocketMessage` and `alarm()` never run concurrently on the same DO. `setAlarm` overwrites any existing alarm; `deleteAlarm` is idempotent — no read-then-write guards needed.

**Seat-id invariant** (Step 11 test): humans always occupy dense seat ids `0..N-1` **at START time**. Proof by construction: `lowestUnusedId` fills the lowest available slot; `webSocketClose` during lobby splices by id; any future HELLO refills the hole. This is what makes `initGame(magicItems, 4 - N)` — which marks the last 4-N seats as bots by convention — correct in all rejoin sequences. Note the invariant only holds up to START; mid-game disconnects leave "tombstone" seats at their original ids.

### WebSocket Hibernation API

Cloudflare's Hibernation API is the reason a hobby multiplayer game can run for $0 on the free tier: instead of keeping the DO instance alive for every open connection, the DO can hibernate between messages and the runtime re-invokes it only when inbound data arrives.

Three invariants, all on `RoomDurableObject`:

- **Use `this.ctx.acceptWebSocket(server)` on the server half, not `server.accept()`.** The former is the hibernation entry; the latter creates a live, non-hibernating socket.
- **Declare `webSocketMessage(ws, message)`, `webSocketClose(ws, code, reason, wasClean)`, and `webSocketError(ws, error)` on the class.** The runtime calls these directly — they are not reached via `fetch()`.
- **The client half of the pair** is returned via `new Response(null, { status: 101, webSocket: client })`. The Worker's route handler forwards this response unchanged.

Today `webSocketMessage` just echoes the message (Step 6). Step 9 will parse the payload as a zod-validated protocol message and dispatch to lobby/game handlers. `webSocketError` closes the socket cleanly on any workerd-reported fault — without it, the test isolate noisily logs unhandled errors on every abnormal close.

### Protocol (`server/protocol.ts`)

All WebSocket traffic is JSON. Every message has a literal `type` field that discriminates the shape. Schemas live in `server/protocol.ts` as **zod 4** schemas, built strict (unknown keys reject) and round-trip-safe (schemas never mutate input — `DisplayName` rejects whitespace-bounded strings rather than trimming).

**Messages:**

| Direction | `type` | Purpose |
| --- | --- | --- |
| C → S | `HELLO` | Handshake on socket open. Carries `version: PROTOCOL_VERSION` and `displayName`. |
| C → S | `START` | Host-only request to start the game (and lock the `magicItems` choice). |
| C → S | `MOVE` | `{row, col}` move. |
| S → C | `JOIN` | Broadcast: a new `LobbyPlayer` joined the room. |
| S → C | `LOBBY_STATE` | Full lobby snapshot — `code`, `players[]`, `magicItems`, `hostId`. |
| S → C | `GAME_STATE` | Full game snapshot — grid (10×10 enforced), players (4 enforced), current turn, items, winner, `lastEvent` (freeze/swap discriminated union). Mirrors `src/game/logic.js` byte-for-byte. |
| S → C | `ELIMINATED` | A player was eliminated. `reason: trapped | timeout | disconnect`. |
| S → C | `GAME_OVER` | Game ended. `winner` (or null for draw) + final `players[]`. |
| S → C | `ERROR` | Typed rejection. `code` enum covers `NOT_YOUR_TURN`, `INVALID_MOVE`, `ROOM_FULL`, `DUPLICATE_NAME`, `UNAUTHORIZED`, `BAD_PAYLOAD`, `ALREADY_STARTED`. |

Discriminated unions `ClientMsg` and `ServerMsg` (both on `type`) exhaustively cover the two directions. The sole server-side helper is `parseClientMsg(raw) → {ok:true,msg} | {ok:false,code:'BAD_PAYLOAD'}`; the DO handler (Step 9) uses it as a single entry point.

**`PROTOCOL_VERSION = 1`** is stamped into `HELLO` and rejected on mismatch. Bump when the wire format changes incompatibly — cheap defence against cached-client-vs-new-server skew once we deploy.

**Player identity is intentionally split** into two schemas:

- `LobbyPlayer` — `id, displayName, isBot, isHost`. Used in `LOBBY_STATE` and `JOIN`.
- `GamePlayer` — adds `row, col, isEliminated, deathCell: {row,col}|null, finishTurn: number|null`. Used in `GAME_STATE` and `GAME_OVER`. The nullable-but-always-present shape matches `logic.js` exactly, so the Step 14 `useNetworkGame` contract test stays trivial.

The DO handler (Step 9) uses it server-side; the client WebSocket wrapper (`src/net/client.js`, Step 13) imports it client-side — client-and-server-side-agree-on-the-wire-format is enforced by both directions pulling from the same file.

### Client networking (`src/net/client.js`)

Step 13. A small factory wrapping the browser `WebSocket`:

```js
const client = createClient({ url, onMessage, onStateChange, bootstrap });
client.send(clientMsg);   // validated with ClientMsg.parse; throws on garbage
client.close();           // sticky: no reconnect after this
```

- **Outbound** goes through `ClientMsg.parse` (strict — throws). Developer-error guard; not a runtime failure mode.
- **Inbound** goes through `ServerMsg.safeParse` (permissive — log-and-drop). A server protocol bug can't kill the client.
- **Bootstrap callback** (issue #22) fires on every WS `open` BEFORE the queue flushes. The hook returns a `HELLO` from it, guaranteeing HELLO is the first frame on every connection — protects against the reconnect race where a queued user tap (e.g. the host pressed START while their tab was suspended) would otherwise beat HELLO to the wire and trip server `UNAUTHORIZED`.
- **Send queue, post-#22**: buffers messages only during the *initial* connect (before the first `OPEN`). After the wrapper has been `OPEN` once, sends issued while the socket isn't open are **dropped on the floor** — replaying stale user actions against post-reconnect server state would mean acting on assumptions (host status, current turn) that may no longer hold. Caller can re-tap once `'open'` returns.
- **Auto-reconnect** on unexpected close. Jittered exponential backoff `[500, 1000, 2000, 4000, 8000, 16000, 30000]` ms ± 25%. Resets on a successful `open`. Also force-reconnects (cancel pending backoff timer + reset attempt counter + `connect()` now) on `document.visibilitychange → visible` so iOS Safari tab-foreground feels instant.
- **`close()` is sticky** — once called, no further reconnect attempts. State transitions to `'destroyed'` to distinguish from transient `'closed'`. Cleans up the `visibilitychange` listener.

Scope limits (deferred to later):

- **No session identity across reconnects** — except for **lobby-phase displayName recovery**. The wrapper itself doesn't track identity, but the server holds a lobby seat for `LOBBY_GRACE_MS` (90 s, see Lobby dispatcher above) after an abnormal close, and a re-HELLO with the same `displayName` inside that window reattaches to the same seat (host preserved). The hook layer also resets `mySeatId` whenever `connectionState` leaves `'open'`, so a fresh seat assignment after a grace expiry is picked up correctly from the next LOBBY_STATE. Mid-game reconnects still re-HELLO into a fresh socket and find their seat already eliminated; full session-token-based seat stickiness is still out of scope.

### Hook (`src/net/useNetworkGame.js`)

Step 14. React hook layered on `createClient`. The first consumer of `client.js`.

```js
const { gameState, lobby, connectionState, mySeatId, lastError,
        join, start, move } = useNetworkGame({ url });
```

- **`gameState` is shape-compatible with `useReducer(gameReducer, null)`.** After a `GAME_STATE` broadcast arrives, it carries every field `initGame()` produces (plus per-player `displayName/isBot/isHost/finishTurn` from the server). This is the contract that lets Step 16 swap `useReducer` → `useNetworkGame` in `OnlineGameController` without touching any component.
- **`mySeatId`** is derived from the first LOBBY_STATE / JOIN after `join(displayName)` is called — lookup by displayName in the roster. Server duplicate-name rejection makes exact-match unambiguous.
- **`ELIMINATED` / `GAME_OVER` messages are ignored** for now. The authoritative state change arrives via the following `GAME_STATE` broadcast, so using it as the single source of truth keeps the contract simple. Future UI polish can add a `lastEvent` field without breaking it.
- **Imperative senders (`join`, `start`, `move`)** push validated messages through the client's send queue. No client-side host checks — server enforces with `UNAUTHORIZED`.
- **Lifecycle:** `useEffect([url])` creates one client per URL; cleanup calls `client.close()` on unmount. React strict-mode's double-invoke doesn't leak sockets — the first is closed before the second is created.

### Online mode (`src/OnlineGameController.jsx`, Step 16)

Online is a thin socket + lobby shell that reuses the in-game renderer. Entry lives on `StartScreen`, which now renders a three-view IA — `menu` (PLAY + PLAY WITH FRIENDS hero buttons + a tertiary "pass-and-play on this device" text-link), `online` (multiplayer drawer with name + create/join sub-state and a "got a code?" toggle), and `local` (the hotseat slider that used to live behind the SAME SCREEN tab). Cold-open share links + retry-after-rejection bypass the menu and land directly in `online` with `joinMode=true`. Once the user submits, `App.jsx` mounts `OnlineGameController` under a `<Suspense>` boundary.

`OnlineGameController` calls `useNetworkGame({ url: wsUrl(code) })` and routes on connection state + game phase:

| state | what renders |
| --- | --- |
| `connecting` / waiting for HELLO | `<StatusScreen>` |
| error / closed / destroyed | `<StatusScreen>` with label |
| lobby (no GAME_STATE yet) | `<Lobby>` |
| `playing` or `gameover` | `<GameScreen>` (shared with local) |

**Shared in-game surface.** `<GameScreen>` (`src/components/GameScreen.jsx`) owns everything that only depends on `gameState` + "which seats I control" — rendering (`PlayerPanel` + `TurnIndicator` + `GameBoard` + `GameOverScreen`), every in-game sound, the trap/death animation chain, win/draw gating. Both controllers mount it and pass a `mySeats` prop (local: all non-bot seats; online: `[mySeatId]`). Any future in-game polish change lands there and both modes inherit it.

**Animation derivation.** `src/game/useDerivedAnimations.js` is a hook both controllers call. It diffs the current `gameState` against the previous one to produce `{bombBlast, portalJump, swapFlash, flyingFreeze}` + fire item-pickup sounds (`playBomb`, `playPortal`, `playSwapActivate`, `playPortalJump`). No imperative pre-dispatch is needed; the hook runs identically in local (reducer output) and online (wire broadcast) because both produce the same `gameState` shape.

**Server URL configuration.** `src/config.js` exports `SERVER_URL` (defaults to `http://localhost:8787`, overridable via `VITE_SERVER_URL` at build time) and `wsUrl(code)` which converts `http → ws`/`https → wss` and appends `/rooms/<code>/ws`. Step 18 sets `VITE_SERVER_URL` to the preview `*.workers.dev` origin.

**Lazy-load boundary.** `App.jsx` uses `ENABLE_ONLINE ? lazy(() => import('./OnlineGameController')) : null`. Vite auto-extracts `GameScreen` + `useDerivedAnimations` into a shared chunk between the main bundle and the online chunk.

**Still missing from online** (not required for shipping): visible turn-timer countdown (server enforces the deadline but client shows a static bar); reconnect UX polish beyond `client.js`'s automatic backoff.

### Room code format

- Alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — base32 excluding visually-confusable chars (`0/O/1/I`). 32 symbols → 5 bits per char.
- 5-char codes → 32⁵ ≈ 33.5M combinations.
- Generated via `crypto.getRandomValues(new Uint8Array(5))` + `byte & 0x1F` lookup (unbiased — 5 bits out of 8 independently uniform).

### Abuse hardening (Step 20)

Four cheap, layered defences — all in `server/index.ts`, zero new bindings or secrets. Goal: keep a casual griefer from burning through free-tier quotas.

- **Origin allow-list.** `POST /rooms` and `GET /rooms/:code/ws` check the `Origin` header. `https://tursut.github.io`, `http://localhost:5173`, and `http://localhost:4173` are allowed; so is a missing header (CLI / server-to-server). Anything else → `403`. Declared in `ALLOWED_ORIGINS` near the top of `server/index.ts`.
- **Per-IP rate limit** — isolate-local sliding-window Map keyed by `${scope}:${ip}` from `CF-Connecting-IP`. `POST /rooms`: 10/minute/IP. `GET /rooms/:code/ws`: 30/minute/IP. Over-budget → `429` with `retry-after: 60`. No DO calls, so it doesn't eat our DO quota. A griefer routed to a different Cloudflare data-centre gets a fresh bucket — fuzzy, but enough for our threat model. Tests call `_resetRateLimiters()` (exported only for test use) in `beforeEach`.
- **WS frame size cap** — `webSocketMessage` rejects frames > 4 KiB by closing with `1009` (Message Too Big) before parsing. Legit payloads are < 40 bytes; the cap is 100× safety margin.
- **Room reaper** — on transition into `gameover`, `maybeScheduleTurnAlarm` writes `reaperAt = Date.now() + 10 min` to storage and `setAlarm(reaperAt)`. When the alarm fires, `alarm()` checks `reaperAt` first: if elapsed, drain sockets (`close(1000)`) and `storage.deleteAll()`. Subsequent WS upgrades for the same code `404` because `storage.get('code')` is now undefined. Multiplexed with the turn-timer alarm (which was the previous sole user of the alarm channel).

Free-tier safety: Cloudflare cannot bill without a credit card on file. The absolute worst-case after all defences are bypassed is hitting Workers (100k/day) or DO (1M/month) quotas and receiving `429`/`1015` from Cloudflare — the game degrades, no bill. Tests: `server/__tests__/security.test.ts`.

### Shared game module (`src/game/`)

The server imports the existing pure game module directly — no copy. Single source of truth; client and server can never drift.

- **`src/game/logic.js`** — `initGame`, `applyMove`, `eliminateCurrentPlayer`, `getCurrentValidMoves`, `getValidMoves`, `validateMove`, plus sandbox helpers.
- **`src/game/ai.js`** — `getGremlinMove(state, difficulty)`.
- **`src/game/constants.js`** — `GRID_SIZE`, `PLAYERS`, `DIRECTIONS`, `ITEM_TYPES`, `TURN_TIME`, etc.

**Security boundary: `validateMove(state, playerId, row, col)`.** Added in Step 8. Returns `{ok: true}` or `{ok: false, reason: 'NOT_YOUR_TURN' | 'INVALID_MOVE'}`. The reason strings match two of the `ERROR.code` values in `server/protocol.ts`, so Step 9's DO handler can forward them as `ERROR` messages without a translation layer. Delegates legality to `getCurrentValidMoves` (which already rules out out-of-bounds, already-claimed, and non-adjacent targets across all the portal/swap/freeze-select modes), then adds a phase + turn-ownership guard on top.

Server-side TS imports these `.js` files via a relative path (`../../src/game/logic` from test files, `../src/game/...` from server sources). `server/tsconfig.json` enables `allowJs` and includes `../src/game/**/*.js` so editor tooling resolves them. Esbuild (Vitest + wrangler) handles the cross-directory path without extra config.

### Local dev, tests, deploy

- **Local dev:** `npx wrangler dev --config server/wrangler.toml` → Worker on `http://localhost:8787`. Hot-reloads on save.
- **Tests:** `npm run test:server` runs the full suite inside the real `workerd` runtime via `@cloudflare/vitest-pool-workers`. The pool is registered in `server/vitest.config.ts` as `plugins: [cloudflareTest({...})]`; test files hit the Worker via `import { SELF } from 'cloudflare:test'`, and DO state is inspected via `runInDurableObject(stub, (instance, state) => {…})`. Pure-logic tests (e.g. `logic.test.ts`) don't touch `SELF` or `env` — they just import the shared game module and assert.
- **DO binding discovery:** `wrangler.toml` declares `[[durable_objects.bindings]] name = "ROOM" class_name = "RoomDurableObject"` plus a `[[migrations]] tag = "v1" new_classes = ["RoomDurableObject"]` block (required the first time a DO class is introduced). `wrangler dev` and the Vitest pool both read these from the same toml.
- **TypeScript:** `server/tsconfig.json` extends `@cloudflare/workers-types` and `@cloudflare/vitest-pool-workers` types (no DOM). `allowJs: true` + `include: ["**/*.ts", "../src/game/**/*.js"]` for the shared game module. `noEmit: true` — types are for editors + type-aware tooling only; runtime transpilation goes through esbuild (Vitest) and wrangler.
- **Deploy:** `.github/workflows/deploy-preview.yml` (Step 18) deploys the Worker to `*.workers.dev` on every push to the multiplayer feature branch, then builds a client with `VITE_ENABLE_ONLINE=true` + `VITE_SERVER_URL=<worker-url>` and pushes `dist/` to the `gh-pages-preview` branch via `peaceiris/actions-gh-pages@v3`. The worker URL is extracted from `wrangler deploy` stdout and passed to the client-build job as a workflow output. Requires `CLOUDFLARE_API_TOKEN` GitHub secret (one-time setup by the repo owner; see the workflow file's header comment). Local manual deploy: `npm run deploy:preview`. Step 19 will extend this for production cutover.

## Directory map

```
src/
  main.jsx                       ← React entry, mounts <App />
  App.jsx                        ← thin mode router: `mode: 'local' | 'online'` state, picks LocalGameController or (behind ENABLE_ONLINE flag) OnlineGameController. Owns the global stylesheet import.
  LocalGameController.jsx        ← hotseat outer shell: gameReducer, screen nav (start/game/sandbox), turn timer, gremlin bot driver, pre-game countdown, exit-confirm modal, StartScreen + SandboxPanel layouts. In-game rendering delegates to <GameScreen>.
  OnlineGameController.jsx       ← online multiplayer shell: useNetworkGame socket lifecycle, HELLO handshake, status/lobby screens. In-game rendering delegates to <GameScreen>. Lazy-loaded via App.jsx so its subtree only ships when ENABLE_ONLINE is true at build time.
  App.css                        ← all app styles (global)
  index.css                      ← minimal reset / base
  config.js                      ← build-time feature flags (currently: ENABLE_ONLINE). Single read site for `import.meta.env.VITE_*`.
  net/                           ← client-side networking (Step 13+). No React here; pure transport layer.
    client.js                    ← createClient({url,onMessage,onStateChange,bootstrap}) → {send,close,getState}. Zod-validated send/recv, bootstrap-first-on-open (HELLO race fix #22), drop-while-disconnected send semantics post-first-open, jittered-exponential auto-reconnect with visibilitychange-triggered fast-path, sticky explicit close.
    __tests__/client.test.js     ← 17 cases via a hand-written MockWebSocket + fake timers: connect transitions, inbound happy-path/malformed/wrong-shape, outbound validation throws, queue flushes the initial-connect buffer, post-first-open sends drop while disconnected (#22), backoff growth + reset, sticky close, bootstrap-first ordering, visibilitychange forces an immediate reconnect.
    useNetworkGame.js            ← React hook wrapping createClient. `gameState` is shape-compatible with useReducer(gameReducer, null); also exposes lobby, connectionState, mySeatId, lastError, and join/start/move senders. Step 16 wires it into OnlineGameController.
    __tests__/useNetworkGame.test.jsx ← 11 cases. Two "contract" checks iterate Object.keys(initGame(false, 3)) and assert each key is present on hook.gameState — that's what guarantees Step 16's useReducer→useNetworkGame swap won't break any component. Other cases cover lobby/mySeatId/senders/error/connection-state/unmount-cleanup. Mocks ../client.js via vi.mock.
  game/                          ← pure game module — no React, no DOM, no window. IMPORTED BY SERVER (see Step 8).
    constants.js                 ← GRID_SIZE, PLAYERS, DIRECTIONS, TURN_TIME, ITEM_TYPES, spawn tuning
    logic.js                     ← initGame, initSandboxGame, applyMove, completeTurn (internal), eliminateCurrentPlayer, eliminatePlayer (server-side arbitrary-player elimination for disconnect), getCurrentValidMoves, getValidMoves, placeSandboxItem, validateMove (server-side security boundary)
    ai.js                        ← getGremlinMove(state, difficulty) — bot move selection
    sounds.js                    ← Web Audio API synth (SFX + bg theme), resumeAudio, setMuted — client-only
    useDerivedAnimations.js      ← React hook: diffs (prev → current) gameState to produce {bombBlast, portalJump, swapFlash, flyingFreeze} overlays + fire item-pickup sounds. Called once per controller; works identically in local and online.
  components/
    StartScreen.jsx              ← three-view IA (menu / online / local). Menu: PLAY + PLAY WITH FRIENDS heroes + pass-and-play link + rules + sandbox link. Online: name input, magic toggle, create/join sub-state. Local: hotseat slider + magic toggle. Sound toggle in corner across all views.
    GameBoard.jsx                ← 10×10 grid rendering + cell animations
    Cell.jsx                     ← single cell, owner glow, valid-move hint, item icon, trapped state
    PlayerPanel.jsx              ← live sidebar: territory counts, elimination state
    TurnIndicator.jsx            ← whose turn + taunt + timer bar + special-mode badges
    EventToast.jsx               ← transient toast for freeze events
    EliminationMoment.jsx        ← full-screen "X was eliminated" overlay with death quote
    SandboxPanel.jsx             ← sandbox mode controls (place items on demand, reset)
    SoundToggle.jsx              ← tiny speaker button
    GameOverScreen.jsx           ← winner screen, restart, back to menu
    GameScreen.jsx               ← shared in-game renderer used by both controllers: PlayerPanel + TurnIndicator + GameBoard + GameOverScreen, all in-game sounds, trap/death animation chain, win/draw gating. Takes a `mySeats` prop + an `onMove(row, col)` callback. Any polish change to the in-game UX goes here.
    Lobby.jsx                    ← online: waiting-room. Shows code + share link + roster (with 👑 on host and "(you)" on self) + empty-seat placeholders. Host-only: magic-items toggle + Start button. (Step 15)
    __tests__/Lobby.test.jsx     ← 10 cases: code rendered, player names, host badge, (you) badge, empty-seat placeholders, host-only controls hidden for non-hosts, Start/Leave/magic-toggle callbacks.
public/                          ← static assets served as-is
server/                          ← Cloudflare Worker + RoomDurableObject + wire protocol (Steps 4–7). Gameplay arrives in Steps 8–12.
  index.ts                       ← Worker entry + `RoomDurableObject` class. Module-default-export format. Routes: GET /ping, POST /rooms, GET /rooms/:code/ws (WebSocket upgrade); 400/404/405/426 otherwise.
  protocol.ts                    ← zod 4 schemas for every message. Split LobbyPlayer/GamePlayer, strict objects, PROTOCOL_VERSION stamp, parseClientMsg helper. No runtime imports yet — Step 9 wires it.
  wrangler.toml                  ← name, main, compat_date, nodejs_compat, `[[durable_objects.bindings]] ROOM`, `[[migrations]] v1 new_classes=[RoomDurableObject]`.
  tsconfig.json                  ← server-only tsconfig. Pulls in @cloudflare/workers-types + @cloudflare/vitest-pool-workers. noEmit.
  vitest.config.ts               ← Workers-pool Vitest config — `plugins: [cloudflareTest({ wrangler: { configPath } })]`.
  __tests__/smoke.test.ts        ← runs inside workerd, asserts Request/Response/fetch are globals
  __tests__/ping.test.ts         ← uses SELF.fetch from `cloudflare:test` to hit the `/ping` handler
  __tests__/room-create.test.ts  ← POST /rooms: code format, 200-create uniqueness, DO storage inspection via runInDurableObject, persistence, method guards
  __tests__/room-ws.test.ts      ← GET /rooms/:code/ws: happy-path echo through hibernation, 404 on uninitialised room, 426 without Upgrade header, 400 on malformed code, 405 on wrong method. afterEach drains open sockets.
  __tests__/protocol.test.ts     ← Pure schema tests (no Worker/DO). Round-trips 9 message types; rejects version/length/enum violations + unknown keys; covers discriminated-union direction guards and parseClientMsg.
  __tests__/logic.test.ts        ← Server-side tests for the shared src/game/ module. initGame shape, applyMove/eliminateCurrentPlayer/getValidMoves/getCurrentValidMoves, and all validateMove security cases (NOT_YOUR_TURN × 2, INVALID_MOVE × 4). getGremlinMove → validateMove round-trip.
  __tests__/room-lobby.test.ts   ← 15 cases covering HELLO/START dispatch: single+second join, capacity cap, duplicate name, host/non-host START, re-START (ALREADY_STARTED), malformed JSON / unknown type / binary (BAD_PAYLOAD), idempotent re-HELLO, player-leaves-during-lobby, host-leaves-during-lobby, MOVE-in-lobby. Uses a `waitForInbox` helper — inboxes are attached at socket open so broadcasts that arrive before test-side waiters aren't lost.
  __tests__/room-turnloop.test.ts ← 10 cases covering START → initGame → GAME_STATE broadcast and MOVE → validateMove → applyMove → GAME_STATE broadcast. Includes security rejections (NOT_YOUR_TURN, INVALID_MOVE × 2, UNAUTHORIZED), identity merge check, magicItems flow-through, storage shape check, and a 4-move cycling test. Uses `startGameWithHumans(names)` setup helper.
  __tests__/room-bots.test.ts    ← 4 cases covering the bot driver: identity in a 1h3b room (🤖 shortName + isBot=true), alarm scheduled after START and advances via runDurableObjectAlarm, all-bots simulation drives the game to GAME_OVER via seeded storage + alarm loop, and the seat-recycling invariant that makes `gremlinCount = 4 - N` correct.
  __tests__/room-timer.test.ts   ← 3 cases covering the human turn timer: alarm size is ~TURN_TIME_MS when current seat is human, firing the alarm forfeits via eliminateCurrentPlayer (isEliminated + deathCell + finishTurn set; currentPlayerIndex advances), and bot-to-human handoff correctly switches the alarm size from 800–1400ms to TURN_TIME_MS.
  __tests__/room-disconnect.test.ts ← 4 cases covering CODE-1000 disconnect-=-elimination during `playing` phase (the deliberate-exit path): non-current player disconnect (marked eliminated, turn unchanged), current-player disconnect (eliminated + turn advances), last-human-in-1h3b disconnect (bots play out to GAME_OVER via alarms), and post-GAME_OVER disconnect (no-op, no alarm, no broadcast). All use `ws.close(1000)` so they exercise the immediate-elimination branch added back for deliberate exits.
  __tests__/room-playing-grace.test.ts ← 5 cases covering the abnormal-close playing-phase grace: code != 1000 holds the seat (no isEliminated flip, alarm scheduled), same-name re-HELLO reattaches and receives a fresh GAME_STATE, fresh-name HELLO mid-game still gets ALREADY_STARTED, expired grace via alarm flips isEliminated and broadcasts, and code 1000 still eliminates immediately as a regression check.
  __tests__/room-lobby-grace.test.ts ← 5 cases covering lobby-phase grace: abnormal close (code != 1000) holds the seat without broadcasting, same-displayName re-HELLO during grace resumes the seat (incl. host), expired grace via alarm drops the seat and reassigns host, deliberate `ws.close(1000)` still removes immediately.
e2e/                             ← Playwright specs
  sanity.spec.ts                 ← trivial harness-wired test (no server needed)
  helpers.ts                     ← shared helpers: createRoom(), APP/SERVER constants, page interaction utilities
  share-link.spec.ts             ← cold-open of a share URL pre-fills room code + shows JOIN ROOM button
  happy-path.spec.ts             ← two contexts: create room, join via share URL, both see same game board after start
  bot-fill.spec.ts               ← 1 human + 3 bots: lobby shows 3 bot placeholders, game starts, 4 corners pre-claimed
  disconnect.spec.ts             ← closing a context mid-game → remaining player sees a skull on the board
vitest.config.js                 ← client/jsdom Vitest config
vitest.setup.js                  ← jest-dom matchers
playwright.config.ts             ← Playwright config (chromium-only, executablePath override via env)
.github/workflows/deploy.yml     ← GitHub Pages deploy for the live hotseat game (triggers on `claude/grid-territory-game-design-433J8`)
.github/workflows/deploy-preview.yml ← Step 18 preview deploy. Triggers on pushes to the multiplayer feature branch. Two jobs: (1) `wrangler deploy` Worker → capture `*.workers.dev` URL from stdout, (2) build client with `VITE_ENABLE_ONLINE=true` + `VITE_SERVER_URL=<url>` and push `dist/` to `gh-pages-preview` branch via `peaceiris/actions-gh-pages`. Requires `CLOUDFLARE_API_TOKEN` repo secret.
.github/workflows/test.yml       ← runs the three test suites on the feature branch + all PRs
```

## State shape (source of truth: `src/game/logic.js`)

`initGame(magicItems, gremlinCount)` returns:

```js
{
  grid: Cell[GRID_SIZE][GRID_SIZE],   // Cell = { owner: playerId | null }
  players: Player[],                  // 4 entries, index === player.id
  currentPlayerIndex: number,         // whose turn (random at start)
  phase: 'playing' | 'gameover',
  winner: playerId | null,
  turnCount: number,                  // increments each completed turn
  magicItems: boolean,
  gremlinCount: number,               // 0..3, how many of the 4 players are bots
  items: Item[],                      // { id, type, row, col, turnsLeft }
  nextSpawnIn: number,                // turns until the next item-spawn roll
  portalActive: boolean,              // true between collecting a portal and using it
  swapActive: boolean,                // true between collecting a swap and using it
  freezeNextPlayer: boolean,          // true if the current turn collected a freeze item
  lastEvent: null | { type: 'freeze' | 'swap', byId, targetId }, // for toasts & sounds
  sandboxMode?: true                  // only set by initSandboxGame
}
```

`Player` shape: `{ id, row, col, isEliminated, deathCell: {row,col}|null, finishTurn?: number }`.

## Move lifecycle

1. UI dispatches `{ type: 'MOVE', row, col }` (or `TIMEOUT`, `START`, `SANDBOX_START`, `SANDBOX_GIVE_ITEM`).
2. Reducer (`gameReducer` in `App.jsx`) calls `applyMove(state, row, col)`.
3. `applyMove` branches:
   - If `swapActive`: exchange positions with the targeted player, claim both squares, complete turn.
   - If `portalActive`: claim target cell, complete turn.
   - Else claim the adjacent target. If an item was picked up:
     - `portal` / `swap`: set `portalActive` / `swapActive`, return state WITHOUT completing turn — player picks the second target next.
     - `bomb`: clear the 8 neighbors of the bomb cell, complete turn.
     - `freeze`: set `freezeNextPlayer`, complete turn.
   - Else just complete turn.
4. `completeTurn` (internal): eliminate any newly-trapped non-current players, advance to next active player, apply freeze skip if needed, check game-over (≤1 alive), tick item lifespans, maybe spawn a new item.
5. `TIMEOUT` calls `eliminateCurrentPlayer` (the timer ran out on the active player's turn).

`getCurrentValidMoves(state)` gives the set of legal targets, context-aware:
- `swapActive` → any other active player's cell
- `portalActive` → any empty unoccupied cell on the board
- else → empty adjacent cells around the current player

## Who's a bot?

Convention: **players with `id >= PLAYERS.length - gremlinCount` are bots.** So `gremlinCount: 1` means only player 3 (Buzzilda) is a bot; `gremlinCount: 3` means players 1/2/3 are bots and player 0 (Reginald) is the lone human. The `PLAYERS` order in `constants.js` is the source of truth for seating.

The bot turn driver in `LocalGameController.jsx` (search for "Gremlin auto-move") detects bot turns, delays 1600–2200ms for feel (or ~150ms if no humans are alive — instant finish), calls `getGremlinMove(gameState, 1)`, and dispatches a `MOVE`.

## Mode router (`App.jsx`)

`App.jsx` is a ~16-line router. It owns one `useState('local')` mode slot and delegates to:

- `LocalGameController` — the hotseat game (everything described in the rest of this doc).
- `OnlineGameController` — stub today; real implementation lands in Steps 13–16.

The online branch is gated by `ENABLE_ONLINE && mode === 'online'`. With `VITE_ENABLE_ONLINE=false` (the default), Vite substitutes `ENABLE_ONLINE` to `false` at build time and Rollup tree-shakes `OnlineGameController` out of production bundles entirely. Until Step 16 wires StartScreen buttons, the mode setter is intentionally not exposed and the router always picks `LocalGameController`.

`App.jsx` also owns the global `App.css` import so the stylesheet loads regardless of which controller renders.

## Where in-game effects live

Post-unification, the split is:

**`GameScreen.jsx`** — iOS audio-context resume, background theme, move + claim + your-turn chime on turn change, freeze/swap event sounds, elimination detection (the 450ms wind-up → trap animation → 2.5s settle → elimination sound chain), win/draw sound gated on the trap animation completing, and the GameOverScreen gating. One place to add or tune any observational in-game effect.

**`useDerivedAnimations.js`** — the four transient animation overlays (`bombBlast`, `portalJump`, `swapFlash`, `flyingFreeze`) + their item-pickup sounds (`playBomb`, `playPortal`, `playSwapActivate`, `playPortalJump`). Called from each controller once; feeds into GameScreen as props.

**`LocalGameController.jsx`** — screen state (`start | game | sandbox`), pre-game countdown (3-2-1-GO + sounds), the turn timer (setInterval + `playTick` on last 3s, dispatches `TIMEOUT`), the gremlin auto-move scheduler, and the exit-confirm modal. Specific to hotseat because server owns these concerns online.

**`OnlineGameController.jsx`** — socket lifecycle (`useNetworkGame`), HELLO handshake, connection-state screens, lobby rendering.

## Gotchas & invariants

- **`src/game/` is pure.** No React imports, no `window`, no audio, no DOM. This is what lets the module run unchanged on a server. Keep it that way.
- **State is fully serializable.** No functions, Dates, or Maps in the shape — everything is plain JSON.
- **`applyMove` may return a mid-turn state** when an item puts the player into `portalActive` or `swapActive`. The turn is only completed on the follow-up move. UI must respect this — that's why `getCurrentValidMoves` branches.
- **Player count is hard-coded at 4.** Corners of the grid are assigned to the 4 PLAYERS entries; changing seat count would ripple through start positions, UI panels, and the bot convention.
- **Bots share one difficulty constant** (`getGremlinMove(state, 1)`). Difficulty isn't user-configurable.
- **Sandbox mode disables item auto-spawn** (`nextSpawnIn: 999`) and the turn timer.
- **Sound system requires a user gesture** to resume on iOS (`resumeAudio()` listeners in `App.jsx` for touchstart/touchend/click). Don't remove those without a replacement.
- **The deploy workflow is branch-scoped** to `claude/grid-territory-game-design-433J8`. Pushing to other branches is always safe — won't ship anything.

## Testing

Three suites, all wired in Step 1 with trivial "is this connected?" tests:

- **Client unit/component** — Vitest + jsdom + `@testing-library/react`. Config: `vitest.config.js`. Tests live at `src/**/*.test.{js,jsx}`. Run with `npm test` (or `npm run test:watch`).
- **Server** — Vitest running inside the Cloudflare `workerd` runtime via `@cloudflare/vitest-pool-workers`. Config: `server/vitest.config.ts`, registered as a Vite plugin: `plugins: [cloudflareTest({ wrangler: { configPath } })]` (the `cloudflareTest` plugin wires up the pool runner **and** the virtual `cloudflare:test` module — pass `cloudflarePool` alone and `import { SELF } from 'cloudflare:test'` will fail to resolve). Tests live at `server/**/*.test.ts`. Requires `server/wrangler.toml`. Run with `npm run test:server`.
- **End-to-end** — Playwright (`@playwright/test`). Config: `playwright.config.ts`. Specs live at `e2e/**/*.spec.ts`. Chromium only for now. Run with `npm run test:e2e`. The config has a `webServer` array that auto-starts `npm run dev:server` (wrangler on port 8787) and the Vite dev server with `VITE_ENABLE_ONLINE=true` (port 5173) before any spec runs. In sandboxed dev environments where `playwright install` can't reach the CDN, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to point at a pre-installed chromium binary. Four online specs: share-link (cold-open), happy-path (two-context create+join+sync), bot-fill (1h3b lobby+start), disconnect (close-tab → skull).

CI: `.github/workflows/test.yml` runs all three as separate jobs on pushes to the multiplayer feature branch and on all PRs.

## What's NOT here yet (framing for the multiplayer work)

**Online play works end-to-end in a browser.** Run `npx wrangler dev` + `VITE_ENABLE_ONLINE=true VITE_SERVER_URL=http://localhost:8787 npm run dev`, click Play online → Create Room → Alice → Start game, and a real 1h3b game plays out against the server-driven bots. Second tab with the share link joins a second human. Steps 0–16 together shipped the full stack.

What's still missing for a real deploy: production cutover (Step 19 — flip main branch to `VITE_ENABLE_ONLINE=true`); abuse + hygiene hardening (Step 20). No visible turn-timer countdown on the client (server enforces the deadline). The preview deploy pipeline (Step 18) is in place and needs only a one-time Cloudflare credential setup by the repo owner (`CLOUDFLARE_API_TOKEN` secret) to become active.

The in-game surface is now unified between local and online: both mount the shared `<GameScreen>` and call `useDerivedAnimations`, so sounds, bomb/portal/swap flashes, flying-freeze, and the trap/death animation chain all fire identically in both modes without a protocol change.

The test harness (Step 1), the `VITE_ENABLE_ONLINE` flag (Step 2), the client mode router + controllers (Step 3), the Worker skeleton (Step 4), `RoomDurableObject` + `POST /rooms` (Step 5), the WebSocket upgrade via the Hibernation API (Step 6), the zod-validated wire format (Step 7), the shared game module with server-side `validateMove` (Step 8), the lobby dispatcher (Step 9), the server-authoritative turn loop (Step 10), the alarm-driven bot driver (Step 11), turn-timer + disconnect=elimination (Step 12), the auto-reconnecting client WebSocket wrapper (Step 13), the `useNetworkGame` hook with the local-reducer-shape contract (Step 14), the `JoinScreen` + `Lobby` presentational components (Step 15), and the online wire-up in `OnlineGameController` with a lazy-loaded chunk + Play-online entry on StartScreen (Step 16) are all in place. The online branch ships as a separate Vite chunk that flag-off builds never fetch.
