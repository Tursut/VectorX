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

A Cloudflare Worker lives at `server/index.ts`, module-default-export format:

```ts
export default { async fetch(request) { … } }
```

Today it only answers `GET /ping → "pong"` and 404s everything else — a walking-skeleton proving the build + test pipeline. Steps 5–12 grow it into a `RoomDurableObject` with WebSocket upgrade, zod-validated protocol, ported `src/game/logic.js`, server-authoritative turn loop, server-side bots, and alarm-driven turn timer.

- **Local dev:** `npx wrangler dev --config server/wrangler.toml` → Worker on `http://localhost:8787`.
- **Tests:** `npm run test:server` runs the full suite inside the real `workerd` runtime via `@cloudflare/vitest-pool-workers`. The pool is registered in `server/vitest.config.ts` as `plugins: [cloudflareTest({...})]`; test files hit the Worker via `import { SELF } from 'cloudflare:test'` and `SELF.fetch(...)`.
- **Deploy:** not wired yet. Step 18 adds `wrangler deploy` → `*.workers.dev`; Step 19 points the production client at it.
- **No TypeScript tsconfig / `@cloudflare/workers-types`** yet. Vitest (esbuild) and wrangler both strip TS at runtime — types will land in Step 5 alongside the Durable Object `Env` / `DurableObjectState` signatures.

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
  game/                          ← pure game module — no React, no DOM, no window
    constants.js                 ← GRID_SIZE, PLAYERS, DIRECTIONS, TURN_TIME, ITEM_TYPES, spawn tuning
    logic.js                     ← initGame, initSandboxGame, applyMove, completeTurn (internal), eliminateCurrentPlayer, getCurrentValidMoves, getValidMoves, placeSandboxItem
    ai.js                        ← getGremlinMove(state, difficulty) — bot move selection
    sounds.js                    ← Web Audio API synth (SFX + bg theme), resumeAudio, setMuted
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
server/                          ← Cloudflare Worker (Step 4: `/ping` only). DO + game logic arrive in Steps 5–12.
  index.ts                       ← Worker entry. Module-default-export format. Currently: GET /ping → "pong", else 404.
  wrangler.toml                  ← name, main, compat_date, nodejs_compat. `main = "index.ts"` (relative to the toml).
  vitest.config.ts               ← Workers-pool Vitest config — `plugins: [cloudflareTest({ wrangler: { configPath } })]`.
  __tests__/smoke.test.ts        ← runs inside workerd, asserts Request/Response/fetch are globals
  __tests__/ping.test.ts         ← uses SELF.fetch from `cloudflare:test` to hit the `/ping` handler
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

No WebSocket client, no room/lobby concept, no Durable Object, no remote human players, no session/identity, no shared game logic on the server, no TypeScript on the client. Online play is still impossible — four humans must share one device. The work in `docs/multiplayer-plan.md` adds exactly these pieces while keeping the current hotseat path byte-for-byte intact. The test harness (Step 1), the `VITE_ENABLE_ONLINE` flag (Step 2), the client mode router + controllers (Step 3), and the Worker skeleton with `/ping` (Step 4) are already in place so later steps can grow the online stack behind the gate without disturbing production.
