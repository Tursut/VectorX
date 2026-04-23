# VectorX Online Multiplayer — Architecture Plan

## Context

VectorX is currently a React + Vite hotseat game: four players take turns on a single device claiming cells on a 10×10 grid. The game logic (`src/game/logic.js`) is already pure, deterministic, and fully serializable, and a sophisticated bot AI (`src/game/ai.js`) exists. There is no backend, no networking code, and no accounts.

The goal is to turn VectorX into a real online multiplayer game — friends in different places can play together over the internet — while keeping hosting cheap for a low-traffic hobby project. Bots must fill any empty seats so a game can always start with four players, even if only one human is present. The design should feel Among-Us/Jackbox simple: share a link, join, play.

## Recommended Architecture

**Two hosts, split cleanly:**

- **Client (the React app)** stays on **GitHub Pages** exactly as today. No change to how it's built or deployed — `.github/workflows/deploy.yml` runs `vite build` on push to the deploy branch (`claude/grid-territory-game-design-433J8`) and publishes `dist/` via `actions/deploy-pages@v4`. No `gh-pages` branch is used.
- **Server (rooms, game state, WebSockets)** runs on **Cloudflare Workers + Durable Objects** at a free `*.workers.dev` subdomain. The client connects to it over `wss://`.

GitHub Pages is static-only — it can't run server code or hold WebSocket connections, which is why a separate host is required. Cloudflare is the cheapest option that gives us real-time sockets and per-room state with essentially no ops.

**Other key decisions:** Server-authoritative game state. Server-side bots. Private rooms only (shareable code/link). Anonymous play with a local display name. Disconnect = elimination, no mid-game bot handoff.

### Why this shape

- **Cost stays near zero.** Cloudflare's free tier covers expected traffic; Durable Objects' hibernation means idle rooms don't bill compute. Realistic monthly cost at hobby scale: $0–$5.
- **One Durable Object per room** is a perfect model — a single-threaded actor that owns the game state, WebSocket connections, and turn timer. No external database, no Redis, no matchmaking service.
- **Server-authoritative is almost free** because `logic.js` is already pure — it ports to the server with essentially no changes, preventing cheating by construction (only legal moves are accepted, only from the player whose turn it is).
- **Private rooms only** ships faster and dodges moderation/AFK problems of public queues. Sharing a 5-char code or link (like Jackbox/skribbl.io) is the right model for a game you play with friends.
- **Forfeit-on-disconnect** dramatically simplifies v1: no grace-period bookkeeping, no bot takeover mid-game, no rejoin logic. Bots exist only to fill empty seats at game start.

### Alternatives considered (and rejected)

- **Node/WebSocket on Fly.io or a VPS:** familiar, but has a non-zero always-on cost and manual scaling. Loses on ops-per-dollar.
- **Pure WebRTC P2P:** no server authority (easy to cheat), needs a TURN server anyway for NAT traversal, and server-less bot-backfill is awkward.

## Tech Choices

- **Client host:** GitHub Pages (unchanged).
- **Server host:** Cloudflare Workers + Durable Objects. Free tier covers expected traffic; worst-case ~$5/mo if exceeded. Idle rooms cost $0 thanks to WebSocket hibernation.
- **CORS:** Worker allows `wss://` connections from the GitHub Pages origin — one line in the Worker entry.
- **Runtime:** TypeScript Worker deployed with `wrangler` v3.
- **Transport:** WebSocket using Cloudflare's [Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) (essential — without it, idle rooms burn CPU).
- **Protocol:** JSON messages, validated with `zod` on both sides.
- **Room codes:** 5-char base32 excluding confusable chars (0/O/1/I). ~1M combos — plenty.
- **Identity:** display name in `localStorage`. Server issues an HttpOnly session cookie with a random UUID on first connect so a browser refresh keeps the same seat until disconnect elimination kicks in.
- **Storage:** DO transactional storage for in-flight rooms only. Rooms TTL out one hour after game end. No separate DB.
- **Domain:** default `workers.dev` subdomain for now; can add a custom domain later without architectural change.

## Interaction Pattern

1. Landing screen shows three buttons: **Play vs Bots** (existing local flow, unchanged), **Create Room**, **Join Room**.
2. **Create Room** instantly generates a code + shareable URL (`/VectorX/#/r/AB7K2`). Host configures magic items on/off and sees a waiting room listing joined players. Empty seats display "🤖 Bot will fill this slot."
3. **Join Room** is a single 5-char input (autofocus, uppercase-enforced, also accepts pasted full URLs). On join, player picks/confirms a display name.
4. When the host clicks **Start**, any empty seats are filled with server-side bots and the game begins.
5. **Bots**: run inside the Durable Object. Their turns use the existing `getGremlinMove(state, 1)` with an 800–1400ms "thinking" delay to preserve feel. They are indistinguishable from humans at the protocol level.
6. **Disconnect**: the player's WebSocket closing is treated exactly like the `eliminatePlayer` action — their cells stay claimed, their character becomes a tombstone, and the game continues with the remaining players. A toast notifies the others: "Gerald disconnected."

## Code Organization

Single repo, shared source directory (no workspaces / no published package — keep it simple):

```
/src/game/                   ← existing pure logic (logic.js, ai.js, constants.js) — SHARED
/src/net/                    ← NEW client networking
  client.js                  ← WebSocket wrapper (auto-reconnect, queue, typed send/recv)
  useNetworkGame.js          ← React hook matching the useReducer API shape
/src/components/
  Lobby.jsx                  ← NEW waiting room UI
  JoinScreen.jsx             ← NEW room-code entry
  StartScreen.jsx            ← MODIFIED: add Create/Join buttons
/server/                     ← NEW Worker + DO
  index.ts                   ← Worker entry, routes /rooms, /rooms/:code/ws
  room.ts                    ← RoomDurableObject: state, WS lifecycle, timer, bots
  protocol.ts                ← zod schemas for all messages
  game/                      ← build-step copy of /src/game (or relative import)
/wrangler.toml               ← NEW DO binding, free-tier config
```

The server imports `logic.js` and `ai.js` directly. Vite and Wrangler build independently of each other.

## Files to Modify / Create

**Modify:**
- `src/App.jsx` — split into `LocalGameController` (current reducer path, keep as-is) and `OnlineGameController` (network path via `useNetworkGame`). Route on a `mode: 'local' | 'online'` state. All child components (`GameBoard`, `Cell`, `PlayerPanel`, `TurnIndicator`, `GameOverScreen`) receive the same-shape state and stay unchanged — they already consume the `gameState` shape produced by `logic.js`.
- `src/components/StartScreen.jsx` — add **Create Room** and **Join Room** entry points alongside the existing local-play flow.
- `src/game/constants.js` — verify no DOM/`window` imports leak in; already clean based on exploration.

**Create:**
- `src/net/client.js`, `src/net/useNetworkGame.js`
- `src/components/Lobby.jsx`, `src/components/JoinScreen.jsx`
- `server/index.ts`, `server/room.ts`, `server/protocol.ts`
- `wrangler.toml`

## Reused Existing Code (critical — don't rewrite)

- `src/game/logic.js`: `initGame`, `applyMove`, `completeTurn`, `eliminateCurrentPlayer`, `getCurrentValidMoves` — all run unchanged on the server.
- `src/game/ai.js`: `getGremlinMove(state, 1)` — server calls this for every bot turn.
- `src/game/constants.js`: `TURN_TIME_MS`, player definitions — source of truth for both client and server.
- The React `useReducer` pattern in `App.jsx` — the online hook returns the same-shape state, so rendering components need no changes.

## Phased Roadmap (high level)

**Phase 1 — MVP (ships online play):** Worker + DO scaffold, server-authoritative turn loop, create/join rooms, bots fill empty seats, disconnect=forfeit, client refactor with `useNetworkGame`, Lobby + JoinScreen, share links.

**Phase 2 — Polish:** Rematch, spectator mode, native share sheet, host kick/start-with-bots-now controls, magic item toggle.

**Phase 3 — Deferred until demand:** Public Quick Play queue, accounts + stats in Workers KV, chat/emote reactions, mobile deep links.

## Step-by-Step Implementation (do these in order)

Each step is a single commit-sized unit of work. Every step ends with an automated check that proves it works before moving to the next. The live game is never broken — the feature branch stays mergeable but dormant behind `VITE_ENABLE_ONLINE=false` until Step 18.

> **Terminology note:** this plan sometimes says `main` as shorthand for "the branch that currently deploys the live game." In this repo that branch is actually **`claude/grid-territory-game-design-433J8`** (see `.github/workflows/deploy.yml`). Mentally substitute accordingly. The multiplayer feature branch is `claude/multiplayer-architecture-planning-X2NrO` and does **not** trigger a deploy.

**Two docs are maintained continuously throughout this work, both committed to the repo:**

- `docs/ARCHITECTURE.md` — living overview of the app (what it does, how it's built, tech stack, state shape, key files). Created in Step 0. Updated at the end of every step that changes architecture, tech, or adds a subsystem.
- `docs/multiplayer-plan.md` — this plan file, copied into the repo in Step 0. Each step's heading gets a ✅ checkbox ticked when that step ships, plus a one-line note if the implementation deviated from the plan.

**At the end of every step the commit must include any relevant updates to both docs.** If a step introduces a new module, pattern, env var, or trade-off, `ARCHITECTURE.md` gains a line about it in the same commit. This is non-negotiable — stale docs are worse than no docs.

### Step 0 — Repo bootstrap: plan + architecture docs ✅

**Deviation:** When copying this plan into the repo, three factual corrections were made that the original plan text had wrong: (1) the live game is NOT deployed from a `gh-pages` branch — `.github/workflows/deploy.yml` uses `actions/deploy-pages@v4` with `dist/` as the artifact; (2) the deploy trigger branch is `claude/grid-territory-game-design-433J8`, not `main` — a Terminology note near the top of the plan records this without rewriting every `main` reference; (3) Step 0's own description of what goes in `ARCHITECTURE.md` was updated to match these facts.

**Goal:** Make the plan durable in the repo and capture a snapshot of the current app so every future session (human or Claude) has shared ground truth.

**Changes:**
1. Copy this plan file verbatim to `docs/multiplayer-plan.md` in the repo.
2. Create `docs/ARCHITECTURE.md` covering the **current** app (pre-multiplayer). Must include:
   - **What it is** — Qwixx-style turn-based cell-claiming game on a 10×10 grid, 4 players, hotseat on one device.
   - **Tech stack** — React 19, Vite, plain JS (no TS yet), `useReducer` for state, CSS modules / global CSS (whatever is actually used), no backend, no external services.
   - **How it's built** — `npm run dev` for local, `npm run build` for prod. Deploy is via `.github/workflows/deploy.yml` on push to the currently-deploying branch (`claude/grid-territory-game-design-433J8`), using `actions/deploy-pages@v4` with `dist/` as the artifact. No `gh-pages` branch.
   - **Key directories & files** — `src/App.jsx` (root + reducer), `src/game/logic.js` (pure game logic: `initGame`, `applyMove`, `completeTurn`, `getCurrentValidMoves`), `src/game/ai.js` (`getGremlinMove`), `src/components/` (UI), public assets, and whatever else matters. Include one-sentence-per-file purpose.
   - **State shape** — the exact shape the reducer returns (board cells, turn index, player list, scores, magic items, game phase). Pull this from the actual code, don't guess.
   - **Move lifecycle** — dispatch → validate via `getCurrentValidMoves` → `applyMove` → `completeTurn` → AI turn if applicable.
   - **Testing** — what tests exist today (likely few/none). Where they live, how to run.
   - **Deploy** — GitHub Actions workflow name, branch, URL.
   - **Gotchas & invariants** — anything that would surprise a new contributor (e.g. "game logic is pure — never read from `window` in `src/game/`", "player index wraps mod 4", etc. — only include ones that are actually true, verified by reading code).
   - **What's NOT here yet** — one paragraph: no network layer, no Worker, no tests harness, no TypeScript. This frames what the multiplayer work adds.
3. Add a pointer in `CLAUDE.md` at repo root (create if absent):
   ```
   ## Active work
   Online multiplayer rollout follows `docs/multiplayer-plan.md`.
   Current-state overview lives in `docs/ARCHITECTURE.md` — keep it updated.
   Execute plan steps one at a time and stop at each Verify gate.
   ```
4. Commit both docs + `CLAUDE.md` update on the feature branch.

**Verify:**
- `docs/ARCHITECTURE.md` can be read cold by someone who's never seen the repo and they can point to every key file without grepping.
- `docs/multiplayer-plan.md` exists and is identical to this plan.
- `CLAUDE.md` at repo root references both.
- No code changes — only doc commits.

### Foundation (steps 1–3): can't break anything

**Step 1 — Test harness + CI skeleton. ✅** Install `vitest`, `@cloudflare/vitest-pool-workers`, `@playwright/test`. Add `npm test`, `npm run test:server`, `npm run test:e2e` scripts. Add `.github/workflows/test.yml` with three jobs. Add one trivial passing test in each suite so green = wired up.
- **Verify:** `npm test` → green. Push → GitHub Actions shows three green checks.

**Step 1 deviations:**
- Also installed `wrangler` (required by the Workers pool), `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` (for later React component tests).
- Vitest 4's pool API changed: register the pool via `plugins: [cloudflareTest({...})]` — `cloudflareTest`'s `configureVitest` hook sets `test.pool` + `test.poolRunner` and its `resolveId`/`load` hooks register the virtual `cloudflare:test` module. `defineWorkersConfig` no longer exists in `@cloudflare/vitest-pool-workers@0.14`. (Step 1 originally shipped with `cloudflarePool(...)` at `test.pool`, which silently omitted the virtual-module resolver; Step 4 corrected this.)
- Created `server/wrangler.toml` (originally Step 4's deliverable) because the Workers pool requires it. It's minimal — `name`, `compatibility_date`, `nodejs_compat` flag. Step 4 will add a `main` entry + `/ping` route.
- `playwright.config.ts` accepts a `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` env var to override the browser binary path — needed for sandboxed dev environments where `playwright install` can't reach the CDN. CI uses the default `npx playwright install --with-deps chromium`.
- Test workflow triggers on pushes to `claude/multiplayer-architecture-planning-X2NrO` (the feature branch) and on all PRs. Not wired to `main` / the deploy branch.

**Step 2 — Feature flag, no behavior change. ✅** Add `VITE_ENABLE_ONLINE` env var (default `false`). No UI change yet — just the flag plumbing.
- **Verify:** `vite build` succeeds; bundle diff against `main` is effectively zero.

**Step 2 deviations:**
- Committed `.env` (`VITE_ENABLE_ONLINE=false`) as the repo-wide default and `.env.example` as documentation; per-developer overrides go in `.env.local` (already covered by the `*.local` gitignore rule).
- Added `src/config.js` exporting `ENABLE_ONLINE` so the flag has a single read site. Nothing imports it yet, so Vite tree-shakes it out — verified bundle diff vs the prior build is byte-identical (same sha256 on every file under `dist/`, including the hashed `assets/*`).
- Flag parse is strict: `import.meta.env.VITE_ENABLE_ONLINE === 'true'`. Values like `"1"`, `"yes"`, or unset all resolve to `false`. Covered by `src/__tests__/config.test.js` using `vi.stubEnv` + `vi.resetModules`.

**Step 3 — Refactor `App.jsx` into mode router, local path unchanged. ✅** Extract current reducer logic into `src/LocalGameController.jsx`. Add stub `OnlineGameController.jsx` that renders nothing. Add `mode: 'local' | 'online'` state, default `'local'`.
- **Verify:** `npm run dev`, play a full local game — identical behavior to `main`. Existing snapshot/component tests still pass.

**Step 3 deviations:**
- `App.jsx` is a near-empty router (~16 lines): `const [mode] = useState('local')` plus `if (ENABLE_ONLINE && mode === 'online') return <OnlineGameController />; return <LocalGameController />`. The setter is intentionally not destructured yet — ESLint's `no-unused-vars` forbids it and nothing flips mode until Step 16's StartScreen buttons land.
- Kept `import './App.css'` in `App.jsx` (not `LocalGameController.jsx`) so the global stylesheet loads regardless of mode — online play will reuse the same styles.
- Copied the existing `gameReducer`, `fadeSlide`, all effects, and the entire JSX tree verbatim into `LocalGameController.jsx`. No behavior changes inside the local path — same imports, same deps arrays, same `// eslint-disable-next-line` lines. Pre-existing `react-hooks/set-state-in-effect` errors and `exhaustive-deps` warnings moved with the code (total lint count unchanged: 14 errors, 6 warnings).
- `OnlineGameController.jsx` is a zero-dep stub returning `null`. Verified it's fully tree-shaken out of the production bundle: `grep "OnlineGameController" dist/assets/*.js` returns zero matches. Net bundle growth from the refactor is 70 bytes (the router wrapper itself).
- Added `src/__tests__/App.test.jsx` — mocks both controllers and pins the "flag-off → LocalGameController" contract so Step 16's flip can't silently regress this. Full client suite: 7/7 passing.

### Server walking skeleton (steps 4–7): end-to-end pipe, no gameplay yet

**Step 4 — Worker + `wrangler.toml` scaffold. ✅** Create `/server/index.ts` with a single `GET /ping → "pong"` route. Add `wrangler.toml`. No DO yet.
- **Verify:** `wrangler dev` locally, `curl /ping` returns `pong`. Add `server/__tests__/ping.test.ts` (Workers pool) asserting the same. `npm run test:server` → green.

**Step 4 deviations:**
- `server/wrangler.toml` existed from Step 1 — just added `main = "index.ts"` (resolved relative to the toml).
- `server/index.ts` is the modern module-default-export format (`export default { fetch(request) { … } }`), not the legacy `addEventListener('fetch', …)` style. Required for Step 5's Durable Object bindings and modern wrangler defaults.
- **Fixed a Step 1 bug in `server/vitest.config.ts`:** previous config passed `cloudflarePool({...})` to `test.pool`, which only registered the pool runner and left the virtual-module resolver inactive — so `import { SELF } from 'cloudflare:test'` threw "Cannot find package". Correct wiring is `plugins: [cloudflareTest({...})]`; `cloudflareTest` is the Vite plugin whose `configureVitest` hook internally sets up `cloudflarePool` **plus** the `resolveId`/`load` hooks for `cloudflare:test`. Step 1's deviation note has been corrected accordingly.
- Skipped adding `@cloudflare/workers-types` + root `tsconfig.json`. 10-line Worker with no bindings; Vitest (esbuild) and wrangler both strip TS types at runtime. Add types in Step 5 when the Durable Object `Env` / `DurableObjectState` signatures start earning their keep.
- No CORS headers on `/ping`. The real browser client never calls `/ping`; it's a liveness probe. Step 6's WebSocket upgrade uses `Origin` checks, not CORS preflight.
- Server suite: 4/4 passing (2 smoke + 2 ping). Manual smoke: `npx wrangler dev --config server/wrangler.toml` → `curl :8787/ping` returns `pong`, `curl :8787/nope` returns `404`. Client suite unchanged (7/7), client bundle byte-identical to Step 3.

**Step 5 — `RoomDurableObject` skeleton + `POST /rooms`.** Add DO class with empty state; route creates a room with a 5-char code, stores `{code, createdAt}` in DO storage, returns `{code}`.
- **Verify:** `server/__tests__/room-create.test.ts` asserts code format, uniqueness across 1000 creates, and code resolves to a live DO.

**Step 6 — WebSocket upgrade + echo at `/rooms/:code/ws`.** Use the Hibernation API. Server echoes any message back.
- **Verify:** Workers-pool test opens a WS, sends `"ping"`, asserts `"ping"` comes back. Covers the hibernation wiring.

**Step 7 — `protocol.ts` with zod schemas.** Define `HELLO`, `JOIN`, `LOBBY_STATE`, `START`, `MOVE`, `GAME_STATE`, `ELIMINATED`, `GAME_OVER` schemas. No handlers wired yet — just the types.
- **Verify:** `server/__tests__/protocol.test.ts` round-trips every valid message and asserts rejection of malformed ones.

### Shared game logic on the server (step 8)

**Step 8 — Port `logic.js` and `ai.js` to the server.** Either relative-import from `/src/game/` or copy into `/server/game/` (decide based on what `wrangler` bundles cleanly). Add move-validation tests — this is now a security boundary.
- **Verify:** `server/__tests__/logic.test.ts` covers `initGame`, `applyMove`, `completeTurn`, `getCurrentValidMoves`, plus new tests for: not-your-turn, already-claimed cell, out-of-bounds, malformed payload. `npm run test:server` → green.

### Gameplay on the server (steps 9–12)

**Step 9 — Lobby: join / host / start (no gameplay yet).** WS handler accepts `HELLO` (adds player, assigns host if first), caps at 4, rejects duplicates, broadcasts `LOBBY_STATE`. Host-only `START` transitions state.
- **Verify:** `room-lobby.test.ts` — join flow, capacity cap, host assignment, non-host start rejected.

**Step 10 — Server-authoritative turn loop.** On `START`, call `initGame`, broadcast `GAME_STATE`. On `MOVE`, validate → `applyMove` → `completeTurn` → broadcast updated state. Reject illegal moves with a typed error.
- **Verify:** `room-turnloop.test.ts` — legal move advances state, illegal move returns error and leaves state unchanged, broadcast reaches all clients.

**Step 11 — Bots fill empty seats + full-bot simulation.** On `START`, fill `4-N` seats with bot records. On a bot's turn, call `getGremlinMove(state, 1)` after a 800–1400ms delay.
- **Verify:** `room-bots.test.ts` includes an **all-bots simulation**: seed 4 bots, drive the DO's alarm forward until `GAME_OVER`, assert exactly one winner and no errors. This single test exercises the whole loop.

**Step 12 — Turn timer + disconnect=elimination.** DO alarm scheduled at `TURN_TIME_MS`; on fire, auto-forfeit current turn. WS `close` → eliminate that player, broadcast.
- **Verify:** `room-timer.test.ts` fast-forwards the alarm and asserts forfeit. `room-disconnect.test.ts` closes a WS mid-turn and asserts elimination broadcast + game continuation.

### Client networking (steps 13–16)

**Step 13 — `src/net/client.js` WebSocket wrapper.** Auto-reconnect with backoff, send-queue while disconnected, typed send/recv using the shared zod schemas.
- **Verify:** `src/net/__tests__/client.test.js` with mock `WebSocket`: reconnect backoff, queued sends flush on reconnect, session cookie persists.

**Step 14 — `useNetworkGame` hook (contract test).** Returns the exact same state shape as the existing `useReducer` path.
- **Verify:** `src/net/__tests__/useNetworkGame.test.jsx` — **contract test**: fake a server script, assert every field the local reducer produces also appears from the hook. This is the guarantee that lets existing components render online play unchanged.

**Step 15 — `JoinScreen` + `Lobby` components.** `JoinScreen` autofocus, uppercase, URL-paste. `Lobby` shows joined players + empty seats + host-only Start.
- **Verify:** `JoinScreen.test.jsx` and `Lobby.test.jsx` unit tests.

**Step 16 — Wire `OnlineGameController` to the hook; flag-gate Create/Join on `StartScreen`.** Behind `VITE_ENABLE_ONLINE=true` only.
- **Verify:** `StartScreen.test.jsx` asserts flag-off hides online buttons. Run `vite dev` with flag on, click through Create → Lobby → Start → play. One manual glance; everything else covered by tests.

### End-to-end validation (step 17)

**Step 17 — Playwright E2E suite.** Five specs, each a single file:
- `happy-path.spec.ts` — two contexts, create+join via share link, play 3 turns, identical state.
- `bot-fill.spec.ts` — 1 human + 3 bots → `GAME_OVER` with a winner.
- `disconnect.spec.ts` — close ctx B mid-game → ctx A sees elimination toast.
- `share-link.spec.ts` — cold open of generated URL works.
- `reconnect.spec.ts` — toggle offline/online on ctx B → session cookie restores seat.
- **Verify:** `npm run test:e2e` → all five green. CI runs them with `wrangler dev` + `vite preview` as fixtures.

### Deploy (steps 18–19)

**Step 18 — Preview deploy.** `wrangler deploy` Worker to `*.workers.dev`. Add GitHub Actions job that deploys the feature branch to `gh-pages-preview` with `VITE_ENABLE_ONLINE=true` pointing at the preview Worker URL. `main` is untouched, still at `VITE_ENABLE_ONLINE=false`.
- **Verify:** Open preview URL in two browsers, play a full online game. Main game URL is unchanged — verify by loading it and seeing no online buttons.

**Step 19 — Production cutover.** Merge the feature branch to `main`. Flip production build env var `VITE_ENABLE_ONLINE=true`. Point client at production Worker URL.
- **Verify:** Load the live Pages URL; online buttons appear; create a room; play a full game with a friend. CI green.

### Invariants that hold at every step

- `main` branch prod build works identically to today until Step 19.
- `npm test` is green before every commit.
- Local hotseat play is never touched — deleting `/server` or `/src/net` would still leave the local game fully working.

## How to Execute This Plan with Claude Code

### Item-by-item, not in parallel

Do the steps **one at a time, in order**. Reasons:

- **Real dependencies between steps.** Step 10 (turn loop) needs Step 8 (ported logic). Step 17 (E2E) needs the whole server built. Parallel work would block on the same files.
- **Small context per session.** A focused "execute Step 5" prompt keeps Claude's context tight and reasoning sharp. A "do steps 4–11" prompt drifts, forgets early decisions, and produces messy commits.
- **Easy recovery.** If a step fails, you re-run or adjust just that step. With a big multi-step prompt, a failure mid-flight leaves you unsure which of 6 changes broke what.
- **Clean commits.** One step = one commit = one CI run = one reviewable unit.

**Exception — a few steps can run in parallel:** Step 15's `JoinScreen` and `Lobby` are independent components and could be split into two parallel subagents. Step 17's five Playwright specs are independent. That's it.

### Suggested prompt template per step

```
Read docs/multiplayer-plan.md. Execute Step N only.
Stop after the step's Verify check is green.
Do not proceed to Step N+1.
```

Short, specific, and bounded. Claude executes, verifies, commits. You review the diff, then kick off Step N+1 in a fresh (or continued) session.

### How the plan is remembered across sessions

The scratch plan at `/root/.claude/plans/…` is **not** auto-loaded into new Claude Code sessions. Step 0 fixes this by committing the plan into the repo itself. Once Step 0 ships:

1. **The plan lives at `docs/multiplayer-plan.md` in the repo** — versioned, visible in PRs, and reviewable alongside the code it describes.
2. **`CLAUDE.md` at the repo root auto-loads every session** and points to both `docs/multiplayer-plan.md` and `docs/ARCHITECTURE.md`. The memory gap is bridged for free.
3. **Reference it explicitly in each prompt.** Even with `CLAUDE.md` auto-loaded, starting with "Read `docs/multiplayer-plan.md` and `docs/ARCHITECTURE.md`" pins them into the session's context.
4. **`TodoWrite` is scratch paper, not memory.** The todo list is per-session and evaporates when the session ends. The two docs are the durable source of truth.

### Living documentation rule (applies to every step 0–19)

After completing a step, the same commit that delivers the code must also:

1. **Tick the step checkbox** in `docs/multiplayer-plan.md` (e.g. `### Step 4 — Worker + wrangler.toml scaffold ✅`).
2. **Add a one-line deviation note** under the step heading if the implementation differed from the plan (e.g. "Deviation: used `hono` router instead of plain fetch handlers for readability.").
3. **Update `docs/ARCHITECTURE.md`** with any new subsystem, tech choice, env var, or invariant introduced by the step. If the step only adds tests or refactors internals, add a line to the relevant section instead of a new section.

The suggested prompt template becomes:

```
Read docs/multiplayer-plan.md and docs/ARCHITECTURE.md.
Execute Step N only. Stop after the Verify check is green.
In the same commit: tick Step N in multiplayer-plan.md, add any
deviation note, and update ARCHITECTURE.md with new architecture
introduced by this step. Do not proceed to Step N+1.
```

### Practical cadence

A reasonable rhythm: one session per step for Steps 1–7 (small, mechanical), one step per session for Steps 8–12 (where the real game-logic decisions live), and one session that does Step 17's E2E specs in parallel. Expect ~1–2 hours of wall time per step including your review.


## Keeping the Live Game Running During Development

Zero disruption to the currently deployed game is a hard constraint. Strategy:

1. **Branch isolation.** All work happens on `claude/multiplayer-architecture-planning-X2NrO`. `main` stays untouched, so GitHub Pages keeps serving the current game unchanged. Merge to `main` only when online play is stable.
2. **Additive, not rewriting.** The existing local hotseat code path (`useReducer` + `gameReducer` + all current components) is preserved byte-for-byte. Online play is added *alongside* it. `App.jsx` routes to either `LocalGameController` (today's flow) or `OnlineGameController` (new) based on a `mode` state. If the server is unreachable or removed, local play still works — it never touches the network.
3. **Separate preview deployment.** Add a GitHub Actions workflow to publish the feature branch to a `gh-pages-preview` branch or Cloudflare Pages preview URL. Play-test the online version there without risking the live game.
4. **Feature flag.** Gate the Create/Join buttons behind `import.meta.env.VITE_ENABLE_ONLINE` (Vite env var). Default off in production, on in dev and preview builds. Flip on when ready to launch.
5. **Server is separately deployed.** The Worker lives at its own `*.workers.dev` URL, completely decoupled from the Pages deploy. Until the production client is pointed at it, production has no dependency on the server existing.

## Automated Testing Strategy

Goal: catch regressions and validate behavior without manual play. Three layers of tests, all runnable with a single `npm test` and wired into GitHub Actions CI on every push to the feature branch.

### Tooling

- **Vitest** — unit tests for pure modules (client and server share the same test runner). Fast, Vite-native, zero-config for JSX.
- **`@cloudflare/vitest-pool-workers`** — runs tests inside the real `workerd` runtime with Durable Object bindings. This is the only way to properly test DO state, WebSockets, and alarm timers.
- **Playwright** — end-to-end browser tests with two parallel browser contexts to simulate two human players in the same room.
- **MSW / mock `WebSocket`** — for client-side hook tests that don't need a live server.

### Test Files to Create

**Server (`server/__tests__/`):**
- `logic.test.ts` — port and extend tests for `initGame`, `applyMove`, `completeTurn`, `eliminateCurrentPlayer`, `getCurrentValidMoves`. Move-validation path gets dedicated coverage because it's now a security boundary (rejects: not-your-turn, already-claimed cell, out-of-bounds, malformed payload).
- `protocol.test.ts` — every zod schema: round-trip valid messages, assert rejection of malformed ones. Guards the wire format.
- `room.test.ts` — Durable Object integration tests (Workers pool). Covers:
  - create room → returns code, DO alive
  - join flow: capacity cap at 4, duplicate-name handling, host assignment
  - host-only `start` action (non-host start is rejected)
  - bot-fill: start with N humans → `4-N` bots spawn
  - illegal moves rejected, valid moves broadcast
  - turn timer: fast-forward alarms, assert auto-forfeit fires
  - disconnect (close WS) → elimination broadcast, game continues
  - **all-bots simulation**: seed 4 bots, drive the game to completion via alarm-driven turns, assert a winner emerges without errors — this single test exercises the full turn loop end-to-end
  - rematch preserves seats

**Client (`src/net/__tests__/` and `src/components/__tests__/`):**
- `client.test.js` — mock `WebSocket`: reconnect backoff, send-queue during disconnect, cookie/session continuity across reconnect.
- `useNetworkGame.test.jsx` — **contract test**: asserts the hook's returned state matches the shape produced by the existing `useReducer` path. This is what lets `GameBoard`, `Cell`, `PlayerPanel`, etc. stay unchanged.
- `StartScreen.test.jsx` — Create/Join buttons hidden when `VITE_ENABLE_ONLINE` is off, visible when on.
- `JoinScreen.test.jsx` — uppercase enforcement, URL-paste auto-extracts code, validation errors.
- `Lobby.test.jsx` — empty-seat rendering, host-only Start button, player-joined updates.

**End-to-end (`e2e/` with Playwright):**
- `happy-path.spec.ts` — two browser contexts: create room in ctx A, join in ctx B via share link, start, play 3 turns, assert both see identical board state.
- `bot-fill.spec.ts` — 1 human + 3 bots; game plays to completion driven entirely by bots after the human's turns; assert win screen appears.
- `disconnect.spec.ts` — mid-game, close ctx B; assert ctx A sees elimination toast and game continues.
- `share-link.spec.ts` — open generated URL cold in a fresh context, join flow works without prior landing-page visit.
- `reconnect.spec.ts` — toggle network offline/online on ctx B mid-game, assert session cookie lets them rejoin the same seat.

### CI

- `.github/workflows/test.yml` — jobs: `vitest-client`, `vitest-server` (Workers pool), `playwright`. All three run on PRs and on pushes to the feature branch. Playwright uses `wrangler dev` + `vite preview` as fixtures.
- Gate merges to `main` on green CI once production cutover nears.

### What this buys

- Every piece of the online flow — protocol, DO state, turn timer, bots, disconnect, reconnect, share-links — has an automated check. You run `npm test`, not a 10-minute manual playthrough.
- The **all-bots simulation** test in particular gives high confidence the turn loop is correct without staging four browsers.
- The **contract test** on `useNetworkGame` guarantees UI components stay renderer-agnostic between local and online modes.

## Verification Plan (manual smoke, post-automation)

1. **Local end-to-end sanity:** `wrangler dev` + `vite dev`, two browser windows, create + join + play one full game. One-time sanity check after major changes.
2. **Deploy:** `wrangler deploy` to the free `workers.dev` subdomain, update the client's WS endpoint env var, redeploy the client to the preview Pages branch. Validate on preview URL before merging to `main`.

## Open Question (non-blocking)

- **Host controls during game:** should the host be able to pause/cancel a game, or only influence the pre-start lobby? Default assumption in this plan: lobby-only. Easy to revisit in Phase 2.
