# CLAUDE.md

Guidance for Claude Code working in this repo.

## The app

**Mind the Grid** (repo name `VectorX`, npm package `mind-the-grid`) — a React 19 + Vite,
turn-based grid-claiming game for 1–4 players. Four characters race to trap each other
on a 10×10 grid; last one moving wins. Plays hotseat on a single device, or online
with friends via a Cloudflare Worker + Durable Object.

- **Live:** https://tursut.github.io/VectorX/
- **Worker:** https://vectorx-server.andreasfriis.workers.dev/
- **Deploy:** push to `main` triggers `.github/workflows/deploy.yml` which deploys
  Worker → captures `*.workers.dev` URL → builds client with `VITE_ENABLE_ONLINE=true` +
  the URL → publishes to GitHub Pages.

## Living docs (read at the start of every session)

- **`docs/ARCHITECTURE.md`** — what exists today: state shape, move lifecycle,
  Worker + DO internals, wire protocol, invariants. Update in the same commit as
  the code when architecture changes.
- **`docs/multiplayer-plan.md`** — the phased rollout history (Steps 0–20, all ✅).
  Useful context for "why did we make decision X".
- **`README.md`** — concise present-tense overview of build/deploy/hosting.

`TodoWrite` is per-session scratch paper, not memory. The docs above are the durable
memory across sessions.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server, HMR |
| `npm run dev:server` | Wrangler dev (Worker on :8787) |
| `npm run dev:online` | Vite + Wrangler in parallel (online play locally) |
| `npm run build` | Production client build |
| `npm test` | Client Vitest (jsdom) — 98 tests |
| `npm run test:server` | Server Vitest (workerd) — ~110 tests |
| `npm run test:e2e` | Playwright (chromium). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` locally if browsers can't be downloaded |
| `npm run deploy:preview` | Manual `wrangler deploy` (needs `CLOUDFLARE_API_TOKEN`) |

All three test suites should be green before any commit.

## Visual + design language

The look has been tuned over many iterations. Don't introduce new colours, fonts,
or motion patterns without asking — match the existing vocabulary.

**Palette (App.css)**
- Page bg `#1a1a2e`, card bg `#0f0f23`, border `#333366`
- Accent lavender `#7a8cff` for "active/selected" cues + glow halos
- Active text `#c8caff`; secondary text `#aaaacc`; tertiary `#888aaa`; muted `#666888`
- Primary action: orange-to-red gradient `linear-gradient(135deg, #e74c3c, #f39c12)`
- Error red `#ff8899`; success green `#2ecc71`
- Player colours come from `PLAYERS` in `src/game/constants.js` — single source of truth

**Typography**
- Titles + button labels: `'Fredoka One'`, UPPERCASE, letter-spacing 2–4px
- Section labels: 11px uppercase letter-spaced 1px (`WHO'S PLAYING?`, `INVITE FRIENDS`)
- Body / inputs / italics: `'Segoe UI'`
- Big titles use a `text-shadow` + `titlePulse` 3s glow animation

**Buttons**
- `.start-button` (orange gradient, sticky bottom bar) is THE primary action. Reused by
  StartScreen and Lobby for visual continuity.
- `.exit-game-btn` is THE secondary text-link (subtle `#556` → `#aab` on hover). Reused
  by GameScreen and Lobby. Don't write a third "small text-link" button class.

**Motion**
- framer-motion springs: `stiffness: 200–400, damping: 16–26`
- Fades / crossfades: 0.18–0.22s
- Title pulse: 3s infinite alternate
- Mode-switcher tile + drawer share a "merged tab" design (active tile sinks 2px into
  drawer via `transform: translateY(2px)` + `clip-path` to clip the glow at the bottom)

**Layout**
- Mobile-first; key surfaces use `width: min(100% - 40px, 560px)` for a 20px gutter
  on phones and a 560px cap on desktop
- Sticky bottom action bar (`.start-button-bar`) lives outside the scrollable content;
  give containers `margin-bottom: 120px` to clear it

## Gameplay feel

- **Turn timing**: human turn = 10s (`TURN_TIME`); bot "thinking" delay = 800–1400ms
  (server-driven online; ~1600–2200ms locally for hotseat)
- **Trap / death sequence**: 450ms wind-up → trap animation → elimination sound → 2.5s
  settle. Don't speed this up — the beats are intentional.
- **Win celebration** plays for ANY winner (human or bot) — see issue #10 history
- **Bot fast-death** when a bot has no valid moves: 80ms instead of the full thinking
  delay (issue 2fd7286 ported)
- **Server-authoritative** online: every move is `validateMove`'d server-side; client
  optimistic state is corrected by the next `GAME_STATE` broadcast
- **Sound levels**: bg music plays through a 0.504 gain node (quiet under effects);
  one-shot sound effects play at full gain through `masterGain`

## Code style

- **`src/game/` stays pure.** No React, DOM, `window`, audio, or networking imports.
  This is what lets the module run unchanged on the Worker.
- **Don't add abstractions for one-off uses.** Three similar lines is better than a
  premature DRY helper. Don't wrap existing utilities or rebuild parallel ones.
- **Fix root causes, not symptoms.** Don't suppress with `try/catch` or hacky guards
  unless there's a justifying comment.
- **`useEffect` setState exceptions** (e.g. animation overlays, validation reset)
  legitimately need `setState` inside an effect. Suppress
  `react-hooks/set-state-in-effect` with an inline comment explaining why.
- **Comments**: only the *why*, never the *what*. One short line max — no doc-block
  paragraphs. Don't reference issue numbers in code (the commit/PR carries that).
- **No emojis in code or comments** unless they're game-mechanic icons (`🤖`, `❄️`,
  `🌀`, `🎭`, `💣` — these are part of the player/item vocabulary).

## Tone & communication

- Lower-case prose in chat updates; UPPERCASE only for in-game button labels and
  section headings.
- No emojis in commit messages, chat replies, docs, or code unless explicitly asked.
- Commit messages: short subject (≤72 chars), then a body that explains *why*. Bullet
  the changes when there are several. End with the session URL footer
  `https://claude.ai/code/session_…` that the user has been using.
- When proposing a UX or architectural change: state the trade-off in 2–3 sentences,
  then ask before implementing. The user iterates with screenshots — be ready to
  refine a CSS or animation decision multiple times.

## Workflow

- **Push directly to `main`.** No PRs for hobby-game work. Each commit ships through
  the deploy workflow.
- **Close GitHub issues with `state_reason: completed`** when shipping a fix; reference
  `Closes #N` in the commit body so it's visible in history (the auto-close on push
  doesn't always fire).
- **Plan mode for non-trivial changes.** Use the plan file at the path in the plan-mode
  prompt; finalise with `ExitPlanMode`. Skip plan mode for one-line fixes.
- **Ask before destructive operations**: branch deletes, force pushes, schema changes,
  anything that touches shared infrastructure (Cloudflare, GitHub Pages settings).
- **Pre-commit gates**: `npm test` + `npm run build`. CI runs the full three-suite
  matrix on every push to `main`.

## Pitfalls

- The deploy workflow's E2E selectors must track UI changes (issue #15 was caused by
  renaming a tab without updating `e2e/helpers.ts`)
- The mode-switcher's "merged tab" effect is fragile — `transform: translateY` (not
  `margin-bottom`) is what works inside the grid; iOS `:hover` can stick on the active
  tile if `:not(.active):hover` isn't used
- Audio is iOS-fragile; `resumeAudio()` must run inside a synchronous click handler
  (App.jsx's `handleCreateOnline`/`handleJoinOnline` already do this)
- The GitHub Pages `github-pages` environment must allow `main` as a deployment branch
  (Settings → Environments)
