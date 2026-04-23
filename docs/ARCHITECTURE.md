# VectorX — Architecture Overview

Living snapshot of the current app. Update this file at the end of any step (in `docs/multiplayer-plan.md`) that changes architecture, tech, state shape, invariants, deploy, or adds a subsystem.

## What it is

VectorX (internal package name `gridmind`) is a turn-based grid-claiming game. Four characters start in the four corners of a 10×10 grid. On each turn, the active player must claim one empty cell **8-way adjacent** to their current position. A player is eliminated when they have no adjacent empty cell to move to (trapped). Last one standing wins.

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
- **Storage today:** `{ code, createdAt, lobby }` where `lobby = { players: [{id, displayName, isBot}], hostId, phase: 'lobby'|'playing', magicItems }`. `isHost` is NOT stored — it's derived at broadcast time from `hostId`, so host reassignment on disconnect is a single field update. Step 10 will add `game` alongside `lobby`.
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

`webSocketClose` during `phase: 'lobby'` removes the departing seat from `players`, reassigns `hostId` to the lowest-id remaining player if the leaver was host, and broadcasts an updated LOBBY_STATE. During `phase: 'playing'` (Step 12) it calls `eliminatePlayer(game, seatId)`, stores, broadcasts `GAME_STATE`, and reschedules the turn alarm — see **Turn alarm driver** below for the full handoff.

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

**Disconnect = elimination** (Step 12): `webSocketClose` during `phase: 'playing'` calls `eliminatePlayer(game, seatId)` from the shared module (Step 8's port was extended in Step 12 to handle arbitrary-player elimination, not just the current one). The helper delegates to `eliminateCurrentPlayer` when the departing seat is current (full turn advance + item tick); otherwise it just marks that player eliminated (with `deathCell` at their current cell + `finishTurn: turnCount`) and checks gameover without advancing turn. Broadcasts updated `GAME_STATE` + reschedules the alarm. Skipped entirely if `game.phase !== 'playing'` (post-gameover disconnects are no-ops).

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
const client = createClient({ url, onMessage, onStateChange });
client.send(clientMsg);   // validated with ClientMsg.parse; throws on garbage
client.close();           // sticky: no reconnect after this
```

- **Outbound** goes through `ClientMsg.parse` (strict — throws). Developer-error guard; not a runtime failure mode.
- **Inbound** goes through `ServerMsg.safeParse` (permissive — log-and-drop). A server protocol bug can't kill the client.
- **Send queue** buffers messages while the socket is `CONNECTING` / `CLOSED`; flushes FIFO on `OPEN`, including after a reconnect.
- **Auto-reconnect** on unexpected close. Jittered exponential backoff `[500, 1000, 2000, 4000, 8000, 16000, 30000]` ms ± 25%. Resets on a successful `open`.
- **`close()` is sticky** — once called, no further reconnect attempts. State transitions to `'destroyed'` to distinguish from transient `'closed'`.

Scope limits (deferred to later):

- **No session identity across reconnects.** A reconnecting socket is treated by the server as a fresh connection — the caller must re-HELLO and will get a new seat assignment (or `ROOM_FULL` if their old seat was filled). Seat-sticky reconnects would require cross-origin `Set-Cookie` on the server, DO-side session→seat mapping, and a change to `webSocketClose` — out of scope for Step 13.

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

### Room code format

- Alphabet: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` — base32 excluding visually-confusable chars (`0/O/1/I`). 32 symbols → 5 bits per char.
- 5-char codes → 32⁵ ≈ 33.5M combinations.
- Generated via `crypto.getRandomValues(new Uint8Array(5))` + `byte & 0x1F` lookup (unbiased — 5 bits out of 8 independently uniform).

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
- **Deploy:** not wired yet. Step 18 adds `wrangler deploy` → `*.workers.dev`; Step 19 points the production client at it.

## Directory map

```
src/
  main.jsx                       ← React entry, mounts <App />
  App.jsx                        ← thin mode router: `mode: 'local' | 'online'` state, picks LocalGameController or (behind ENABLE_ONLINE flag) OnlineGameController. Owns the global stylesheet import.
  LocalGameController.jsx        ← the entire hotseat app: gameReducer, all effects (timers, sounds, animations, bot turn driver, iOS audio resume), start/game/sandbox/gameover screens.
  OnlineGameController.jsx       ← stub returning null; real implementation lands in Steps 13–16. Tree-shaken out of prod bundle while ENABLE_ONLINE is false.
  App.css                        ← all app styles (global)
  index.css                      ← minimal reset / base
  config.js                      ← build-time feature flags (currently: ENABLE_ONLINE). Single read site for `import.meta.env.VITE_*`.
  net/                           ← client-side networking (Step 13+). No React here; pure transport layer.
    client.js                    ← createClient({url,onMessage,onStateChange}) → {send,close,getState}. Zod-validated send/recv, send queue, jittered-exponential auto-reconnect, sticky explicit close. No consumer yet; Step 14's useNetworkGame wires it in.
    __tests__/client.test.js     ← 14 cases via a hand-written MockWebSocket + fake timers: connect transitions, inbound happy-path/malformed/wrong-shape, outbound validation throws, queue FIFO before-and-after reconnect, backoff growth + reset, sticky close.
    useNetworkGame.js            ← React hook wrapping createClient. `gameState` is shape-compatible with useReducer(gameReducer, null); also exposes lobby, connectionState, mySeatId, lastError, and join/start/move senders. Step 16 wires it into OnlineGameController.
    __tests__/useNetworkGame.test.jsx ← 11 cases. Two "contract" checks iterate Object.keys(initGame(false, 3)) and assert each key is present on hook.gameState — that's what guarantees Step 16's useReducer→useNetworkGame swap won't break any component. Other cases cover lobby/mySeatId/senders/error/connection-state/unmount-cleanup. Mocks ../client.js via vi.mock.
  game/                          ← pure game module — no React, no DOM, no window. IMPORTED BY SERVER (see Step 8).
    constants.js                 ← GRID_SIZE, PLAYERS, DIRECTIONS, TURN_TIME, ITEM_TYPES, spawn tuning
    logic.js                     ← initGame, initSandboxGame, applyMove, completeTurn (internal), eliminateCurrentPlayer, eliminatePlayer (server-side arbitrary-player elimination for disconnect), getCurrentValidMoves, getValidMoves, placeSandboxItem, validateMove (server-side security boundary)
    ai.js                        ← getGremlinMove(state, difficulty) — bot move selection
    sounds.js                    ← Web Audio API synth (SFX + bg theme), resumeAudio, setMuted — client-only
  components/
    StartScreen.jsx              ← menu: start game, sandbox, toggle magic items, pick gremlin count, sound toggle
    GameBoard.jsx                ← 10×10 grid rendering + cell animations
    Cell.jsx                     ← single cell, owner glow, valid-move hint, item icon, trapped state
    PlayerPanel.jsx              ← live sidebar: territory counts, elimination state
    TurnIndicator.jsx            ← whose turn + taunt + timer bar + special-mode badges
    EventToast.jsx               ← transient toast for freeze events
    EliminationMoment.jsx        ← full-screen "X was eliminated" overlay with death quote
    SandboxPanel.jsx             ← sandbox mode controls (place items on demand, reset)
    SoundToggle.jsx              ← tiny speaker button
    GameOverScreen.jsx           ← winner screen, restart, back to menu
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
  __tests__/room-disconnect.test.ts ← 4 cases covering disconnect=elimination during `playing` phase: non-current player disconnect (marked eliminated, turn unchanged), current-player disconnect (eliminated + turn advances), last-human-in-1h3b disconnect (bots play out to GAME_OVER via alarms), and post-GAME_OVER disconnect (no-op, no alarm, no broadcast).
e2e/                             ← Playwright specs
  sanity.spec.ts                 ← trivial harness-wired test
vitest.config.js                 ← client/jsdom Vitest config
vitest.setup.js                  ← jest-dom matchers
playwright.config.ts             ← Playwright config (chromium-only, executablePath override via env)
.github/workflows/deploy.yml     ← GitHub Pages deploy (triggers on a single branch — see Deploy section)
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

## Effects in `LocalGameController.jsx` (big list, all co-located)

`LocalGameController.jsx` owns: screen state (`start | game | sandbox`), countdown before start, animation triggers (`bombBlast`, `portalJump`, `swapFlash`, `eventToast`, `playerMoment`, `trappedPlayers`), the turn timer, the your-turn chime, the bot-move scheduler, the background theme, elimination sound + overlay, and the iOS audio-context-resume listeners. All driven by `useEffect` reacting to `gameState`. This is the file to open when a hotseat-gameplay question comes up — `App.jsx` itself has no game logic.

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
- **End-to-end** — Playwright (`@playwright/test`). Config: `playwright.config.ts`. Specs live at `e2e/**/*.spec.ts`. Chromium only for now. Run with `npm run test:e2e`. In sandboxed dev environments where `playwright install` can't reach the CDN, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to point at a pre-installed chromium binary.

CI: `.github/workflows/test.yml` runs all three as separate jobs on pushes to the multiplayer feature branch and on all PRs.

## What's NOT here yet (framing for the multiplayer work)

**Server side is complete; client transport + state hook just landed.** Rooms play end-to-end on the server for any human count 0–4. The client now has `createClient` (Step 13) and `useNetworkGame` (Step 14) — but nothing renders them yet. Still missing: no Lobby / JoinScreen UI (Step 15), no wire-up from `OnlineGameController` to the hook (Step 16). Playwright E2E (Step 17) then validates the full browser-level flow. Online play via the real game UI is still impossible today — four humans must still share one device.

The test harness (Step 1), the `VITE_ENABLE_ONLINE` flag (Step 2), the client mode router + controllers (Step 3), the Worker skeleton (Step 4), `RoomDurableObject` + `POST /rooms` (Step 5), the WebSocket upgrade via the Hibernation API (Step 6), the zod-validated wire format (Step 7), the shared game module with server-side `validateMove` (Step 8), the lobby dispatcher (Step 9), the server-authoritative turn loop (Step 10), the alarm-driven bot driver (Step 11), turn-timer + disconnect=elimination (Step 12), the auto-reconnecting client WebSocket wrapper (Step 13), and the `useNetworkGame` hook with the local-reducer-shape contract (Step 14) are all in place so later steps can grow the online stack behind the gate without disturbing production.
