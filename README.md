# Mind the Grid

A turn-based grid-claiming game for 1–4 players. Four characters race to trap each other on a 10×10 grid — last one moving wins. Runs hotseat on a single device, or online with friends over the internet.

**Live at:** [https://tursut.github.io/VectorX/](https://tursut.github.io/VectorX/)
**Repo name:** `VectorX` (kept for URL stability — the public game name is "Mind the Grid").

---

## Contents

- [What it is](#what-it-is)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack](#tech-stack)
- [Local development](#local-development)
- [Testing](#testing)
- [Deployment pipeline](#deployment-pipeline)
- [Hosting & cost](#hosting--cost)
- [Repository tour](#repository-tour)
- [Configuration](#configuration)
- [Known limits](#known-limits)
- [Further reading](#further-reading)

---

## What it is

- **10×10 grid.** Four characters start in the corners.
- **Each turn**, the active player moves to an 8-adjacent empty cell. The cell they land on becomes theirs forever.
- **You lose** when you have no adjacent empty cell left (trapped).
- **You win** when everyone else is trapped.
- **Magic items** (optional): bomb, portal, swap, freeze — spawn periodically and create mid-game swings.

Two ways to play:

- **Same device** — 1–4 humans share a screen. Bots fill any empty seats.
- **Online** — create a room, share a 5-char code, play together over the internet. Bots fill whatever seats humans don't take.

Game logic lives in a pure, deterministic, fully-serializable JavaScript module (`src/game/`) — the same code runs on the client for hotseat play and on the server for online multiplayer, by direct import. No duplication.

---

## Architecture at a glance

```
┌────────────────────────────────┐          ┌─────────────────────────────────┐
│ Browser (React 19 + Vite)      │          │ Cloudflare Worker + DO          │
│ https://tursut.github.io/      │          │ https://vectorx-server.         │
│   VectorX/                     │          │   andreasfriis.workers.dev/     │
│                                │          │                                 │
│  LocalGameController  ──────►  │          │  RoomDurableObject (per room)   │
│   hotseat, useReducer          │          │   ├── lobby state               │
│                                │          │   ├── game state (authoritative)│
│  OnlineGameController ──── WSS ──────────► │   ├── turn-timer alarm          │
│   useNetworkGame hook          │          │   └── bot driver (alarm-backed) │
│                                │          │                                 │
│  shared:                       │          │  shared:                        │
│   src/game/logic.js            │ (copy in │   import "../src/game/logic"    │
│   src/game/ai.js               │  bundle) │   import "../src/game/ai"       │
│   src/game/constants.js        │          │   import "../src/game/constants"│
└────────────────────────────────┘          └─────────────────────────────────┘
```

Two hosts, split cleanly:

1. **Client** — static React bundle served from GitHub Pages. Free.
2. **Server** — Cloudflare Worker + Durable Object (SQLite-backed). Free tier is more than enough for a hobby game.

The server is authoritative for online play: every move is validated server-side before being broadcast to the room's other sockets. Cheating is prevented by construction — only legal moves reach anyone.

Bots live on whichever side needs them: the client runs bots for hotseat mode, the server runs bots to fill empty seats in online rooms. Same `getGremlinMove()` function in both places.

---

## Tech stack

| Layer | Tech |
| --- | --- |
| Client UI | React 19, Vite 8 |
| Animations | framer-motion |
| Audio | Web Audio API (custom synth, no audio files) |
| Styles | Global CSS (`src/App.css`) |
| Client state | `useReducer` for hotseat, `useNetworkGame` hook for online |
| Wire format | JSON over WebSocket, validated with zod |
| Server | Cloudflare Workers (TypeScript), Durable Objects (SQLite storage, Hibernation API for idle rooms) |
| Shared game logic | Plain JS, framework-agnostic (imported by both sides) |
| Client tests | Vitest + jsdom + @testing-library/react |
| Server tests | Vitest + `@cloudflare/vitest-pool-workers` (real workerd runtime) |
| E2E tests | Playwright (chromium) |
| CI | GitHub Actions |
| Client hosting | GitHub Pages |
| Server hosting | Cloudflare Workers (`*.workers.dev`) |

---

## Local development

```bash
npm install          # first time only

npm run dev          # client only, hotseat mode (no server needed)
npm run dev:server   # server only (wrangler dev on :8787)
npm run dev:online   # both, with online mode enabled in the client

npm run build        # production client build → dist/
npm run preview      # preview the production build
npm run lint         # ESLint
```

**For online play locally:**

```bash
npm run dev:online
```

Then open two browser tabs at `http://localhost:5173/VectorX/` and use the ONLINE mode.

**To test against the live Cloudflare Worker** (not local wrangler):

```bash
VITE_ENABLE_ONLINE=true \
VITE_SERVER_URL=https://vectorx-server.andreasfriis.workers.dev \
npm run dev
```

**To deploy the Worker from your machine** (requires `CLOUDFLARE_API_TOKEN` env var):

```bash
npm run deploy:preview    # same command as CI; deploys to *.workers.dev
```

---

## Testing

Three test suites, three reasons:

| Suite | Command | Runtime | Covers |
| --- | --- | --- | --- |
| Client unit | `npm test` | jsdom | React components, hooks, pure client logic |
| Server unit | `npm run test:server` | workerd | Worker routes, Durable Object state, turn loop, bots, timer, disconnects |
| End-to-end | `npm run test:e2e` | Chromium + auto-started dev servers | Create room, join via share link, bots fill seats, disconnect handling |

**Current counts:** 93 client, ~100 server, 5 E2E — all green on `main`.

**E2E setup**: Playwright's `webServer` config auto-starts `wrangler dev` (port 8787) and `vite` with `VITE_ENABLE_ONLINE=true` (port 5173) before any spec runs. In sandboxed environments where `npx playwright install` can't reach the CDN, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a pre-installed chromium binary.

CI runs all three suites in parallel on every PR and on every push to `main`. See `.github/workflows/test.yml`.

---

## Deployment pipeline

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs two jobs in sequence:

```
push main
   │
   ▼
┌─────────────────────────────┐
│ deploy-worker               │  ~30s
│  - npm ci                   │
│  - wrangler deploy          │  → Cloudflare Workers
│  - extract workers.dev URL  │
│  - curl /ping smoke-test    │
└──────────────┬──────────────┘
               │ passes URL to next job
               ▼
┌─────────────────────────────┐
│ deploy-pages                │  ~40s
│  - npm ci                   │
│  - VITE_ENABLE_ONLINE=true  │
│    VITE_SERVER_URL=<url>    │
│    npm run build            │  → dist/
│  - actions/deploy-pages     │  → GitHub Pages
└─────────────────────────────┘
```

**What's in each artifact:**

- **Worker bundle** (~590 KB uncompressed, ~92 KB gzipped): the entire server code + shared game module + zod schemas, deployed to `https://vectorx-server.andreasfriis.workers.dev/`.
- **Client bundle**: the Vite-built React app with `VITE_ENABLE_ONLINE=true` and the Worker URL baked in. Served from `https://tursut.github.io/VectorX/`.

**Failure isolation:** if the Worker deploy fails, the client deploy doesn't run (so the live site doesn't start pointing at a broken server). If the client deploy fails, the Worker is still updated — you'd just need to re-run the failed job.

**Manual trigger:** the workflow also supports `workflow_dispatch`, so you can re-deploy at any time from the Actions tab without pushing a commit.

**Secrets the workflow needs:**

- `CLOUDFLARE_API_TOKEN` — repo secret. Use the "Edit Cloudflare Workers" template when creating the token.

**GitHub Pages environment** (`github-pages` environment in repo settings) must allow deployments from `main`. We use "No restriction" on deployment branches since the workflow itself already hard-codes `main`.

---

## Hosting & cost

**GitHub Pages** — free for public repositories. Unlimited bandwidth for normal use.

**Cloudflare Workers free tier** — the relevant limits:

- 100,000 Worker requests/day
- Durable Objects: 1M requests/month, 1 GB storage
- WebSocket Hibernation: idle rooms cost $0 in compute (the DO sleeps between messages)

For a hobby game shared with friends, monthly cost is **$0**. A room used during an active game is ~4 messages/second (turn broadcasts), well inside free-tier quotas.

If the game ever got serious traffic (e.g. linked from Reddit), the first paid tier is $5/month — no architectural change needed.

---

## Repository tour

```
src/                       ← client
  main.jsx                 React entry
  App.jsx                  thin router: picks Local or Online controller
  LocalGameController.jsx  hotseat: reducer, turn timer, gremlin driver, countdown
  OnlineGameController.jsx online: WebSocket, HELLO, lobby, status screens
  config.js                env flags (ENABLE_ONLINE, SERVER_URL, wsUrl)
  game/                    pure game module (also imported by server)
    logic.js               initGame, applyMove, validateMove, eliminateCurrentPlayer, …
    ai.js                  getGremlinMove
    constants.js           GRID_SIZE, PLAYERS, TURN_TIME, ITEM_TYPES
    sounds.js              Web Audio synth (client-only)
    useDerivedAnimations.js  overlays from gameState diffs (bomb, portal, swap, freeze)
    useGameplaySounds.js   bg theme, move/claim/your-turn chime, event sounds
  net/                     client networking (no React here)
    client.js              WebSocket wrapper: zod validation, auto-reconnect, send queue
    useNetworkGame.js      React hook returning same state shape as the local reducer
  components/
    StartScreen.jsx        start menu: mode switcher, character/bot picker, magic toggle
    GameScreen.jsx         in-game renderer, shared between local and online
    GameBoard.jsx, Cell.jsx, PlayerPanel.jsx, TurnIndicator.jsx,
    GameOverScreen.jsx, EventToast.jsx, EliminationMoment.jsx,
    SandboxPanel.jsx, SoundToggle.jsx,
    Lobby.jsx              online waiting room

server/                    Cloudflare Worker + Durable Object
  index.ts                 Worker entry + RoomDurableObject class
  protocol.ts              zod schemas for every wire message
  wrangler.toml            Worker config, DO binding, SQLite migration
  tsconfig.json, vitest.config.ts

e2e/                       Playwright specs
  sanity.spec.ts           harness test (no server needed)
  share-link.spec.ts, happy-path.spec.ts, bot-fill.spec.ts, disconnect.spec.ts
  helpers.ts               shared utilities

docs/
  ARCHITECTURE.md          detailed reference for every subsystem
  multiplayer-plan.md      phased rollout plan + deviations log

.github/workflows/
  deploy.yml               production deploy on push to main
  test.yml                 unit + server + E2E tests on main + PRs
```

---

## Configuration

**Build-time flags** (Vite `import.meta.env.VITE_*`, read centrally via `src/config.js`):

| Flag | Default | Purpose |
| --- | --- | --- |
| `VITE_ENABLE_ONLINE` | `false` | Show ONLINE mode switcher and lazy-load the online module. |
| `VITE_SERVER_URL` | `http://localhost:8787` | Base URL of the Cloudflare Worker. Converted to `wss://` for WebSockets. |

Production values are set in `.github/workflows/deploy.yml`:

```yaml
env:
  VITE_ENABLE_ONLINE: 'true'
  VITE_SERVER_URL: https://vectorx-server.andreasfriis.workers.dev
```

Dev defaults live in `.env`; per-developer overrides go in `.env.local` (gitignored via `*.local`).

**Runtime secrets:**

| Secret | Where it lives | Used by |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub repo secret | `wrangler deploy` step of `deploy.yml` |

The Worker itself has no runtime secrets — it's stateless per-request and all state lives in Durable Object storage, scoped per room.

---

## Known limits

- **No session identity across reconnects.** If your WebSocket closes mid-game, the server treats it as a disconnect and eliminates your character. A reconnecting socket starts fresh (re-HELLO + new seat). A sticky-session fix exists in the long-term plan but isn't shipped.
- **No visible turn-timer countdown on the client.** The server enforces the 10-second deadline via an alarm, but the client doesn't render a "5 seconds left" bar yet. The bar shown on screen is the hotseat timer; online renders a static bar.
- **Abuse hardening is minimal, not enterprise-grade.** We ship an Origin allow-list, per-IP rate limits on room creation (10/min) and WS handshake (30/min), a 4 KiB WS frame cap, and a 10-minute post-`GAME_OVER` storage reaper. That's enough to stop a casual griefer; a determined attacker with rotating IPs could still exhaust free-tier quotas (at which point Cloudflare returns `429`/`1015` and the game stops working — it **cannot** bill us without a credit card on file). See `docs/ARCHITECTURE.md` → "Abuse hardening" for details.
- **Room capacity hard-coded at 4.** Changing this is a nontrivial change to the `PLAYERS` array (which defines starting corners) and the bot-fill logic.
- **5-char room codes.** ~33 M possible codes; guessing an active room requires millions of attempts per active minute. Not secret, but slow.

---

## Further reading

- **`docs/ARCHITECTURE.md`** — deep dive into every subsystem: the full state shape, move lifecycle, wire protocol, Durable Object internals, turn-alarm driver, client hook contract. The living reference.
- **`docs/multiplayer-plan.md`** — the phased rollout plan (Steps 0–20) with deviations for each step. Useful historical context for "why was decision X made?".
- **`CLAUDE.md`** — guidance for Claude Code sessions working on this repo.
