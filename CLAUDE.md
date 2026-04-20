# CLAUDE.md

Guidance for Claude Code when working in this repo.

## The app

VectorX (internal package name `gridmind`) is a React 19 + Vite, single-device turn-based grid-claiming game. Four characters race to trap each other on a 10×10 grid. Bots fill any seats not taken by humans. No backend today.

**Start by reading `docs/ARCHITECTURE.md`** — it's the living overview of what's in the codebase, the state shape, the move lifecycle, and the invariants. Keep it accurate when you change architecture.

## Active work

Online multiplayer rollout is tracked in **`docs/multiplayer-plan.md`**. Work through its numbered steps one at a time, in order. Each step has a Verify gate — stop when it's green.

## Rules

1. **Read both docs at the start of every session.** `docs/ARCHITECTURE.md` (what exists) and `docs/multiplayer-plan.md` (what's being built) are the durable memory across sessions. `TodoWrite` is per-session scratch paper, not memory.
2. **Keep both docs current in the same commit as the code.** When you finish a numbered step:
   - Tick the step heading in `docs/multiplayer-plan.md` (add `✅`).
   - Add a one-line deviation note under the step heading if the implementation differed from the plan.
   - Update `docs/ARCHITECTURE.md` with any new subsystem, tech choice, env var, module, or invariant. If it's just a small addition, add a bullet to the relevant section rather than creating a new section.
3. **`src/game/` stays pure.** No React, DOM, `window`, audio, or networking imports in that directory. This is what lets the game logic run unchanged on a server in Step 8.
4. **The deployed game must not break.** The deploy workflow triggers on pushes to `claude/grid-territory-game-design-433J8` only — the multiplayer feature branch is `claude/multiplayer-architecture-planning-X2NrO` and does not deploy. Until Step 19, online features stay behind `VITE_ENABLE_ONLINE=false`.

## Commands

- `npm run dev` — local dev server (HMR)
- `npm run build` — prod build to `dist/`
- `npm run preview` — serve the prod build
- `npm run lint` — ESLint

No test runner is installed yet — Step 1 of the multiplayer plan adds one.
