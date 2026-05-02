# GRIDMIND

A single-player territory strategy game. Claim cells on a 10×10 grid before
the Gremlins (AI opponents) trap you. The last player with a valid move wins.

## Gameplay

- 1 human player vs 1–4 Gremlins (configurable)
- On each turn, move to any adjacent unclaimed cell (including diagonals)
- Run out of valid moves and you're eliminated
- Last player standing wins; if everyone gets trapped at once, it's a draw
- **Classic mode**: pure territory
- **Magic mode**: items spawn on the board (bomb, portal, freeze, swap)
- **Sandbox mode** (testing ground): no timer, manual item placement, slow bots

## Running locally

```
npm install
npm run dev
```

Then open the URL printed in the terminal (usually `http://localhost:5173/VectorX/`).

## Architecture

This is a static React + Vite single-page app. There is no backend.

```
src/
  main.jsx          — app entry, PostHog init
  App.jsx           — all screens, lifecycle, reducer dispatch
  game/
    constants.js    — grid size, player definitions, item types
    logic.js        — pure reducer functions (initGame, applyMove, etc.)
    ai.js           — Gremlin move selection
    sounds.js       — Web Audio API sound engine (no audio files)
    track.js        — fire-and-forget PostHog event wrapper
  components/       — React UI components
```

State is managed by a single `useReducer` in `App.jsx` (no external state
library). Reducer actions: `START`, `SANDBOX_START`, `SANDBOX_GIVE_ITEM`,
`MOVE`, `TIMEOUT`, `RESET`.

## Event logging

The game sends a small set of anonymous usage events to
[PostHog](https://posthog.com) so we can answer the basic question:
*is anyone playing, and is usage growing?*

**Events tracked:**

| Event                | Properties                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `game_started`       | `gremlin_count`, `magic_mode`                                       |
| `sandbox_started`    | —                                                                   |
| `game_finished`      | `gremlin_count`, `magic_mode`, `winner_type`, `turn_count`          |
| `game_quit_midgame`  | `gremlin_count`, `magic_mode`                                       |

`winner_type` is `human`, `gremlin`, or `draw`.

**Where data lives:** PostHog cloud (US region, `app.posthog.com`). Free tier:
1M events/month. No PII is sent — PostHog assigns each browser an anonymous
distinct_id stored in localStorage.

**How to view your data:**

1. Log in at <https://app.posthog.com>
2. **Activity → Events** — live feed of every event as it arrives
3. **Insights → Trends** — pick an event, see daily/weekly counts; break down
   by any property (e.g. `magic_mode`)

**Fire-and-forget:** all `track()` calls are wrapped in a try/catch and gated
on PostHog being loaded. If the network is offline, the script is blocked,
or PostHog throws — the game is unaffected.

### Setup

Copy `.env.example` to `.env.local` and add your PostHog project API key:

```
VITE_POSTHOG_KEY=phc_your_key_here
```

The project API key is **public** and safe to embed in frontend code.

The game runs perfectly with no key set — no errors, no network calls. This
is intentional so forks, PR previews, and dev-without-key all work cleanly.

### Deploying

The game deploys to GitHub Pages via `.github/workflows/deploy.yml`. To enable
event logging in production, add `VITE_POSTHOG_KEY` as a repository secret
(Settings → Secrets and variables → Actions). The workflow passes it to the
build step automatically.
