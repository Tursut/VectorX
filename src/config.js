// Build-time feature flags and endpoints. Centralised so tests and future
// modules share one source of truth and we avoid sprinkling `import.meta.env`
// across the codebase.
//
// Vite replaces `import.meta.env.VITE_*` with literal strings at build time,
// so referencing the flag from a module that nothing imports still tree-shakes
// to zero bytes in the production bundle.

export const ENABLE_ONLINE = import.meta.env.VITE_ENABLE_ONLINE === 'true';

// Base URL for the Cloudflare Worker server. Dev default matches
// `npx wrangler dev --config server/wrangler.toml` which listens on 8787.
// Step 18's preview deploy will set this at build time to the real
// `*.workers.dev` origin.
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787';

// Convert SERVER_URL into a WebSocket URL for a given room code.
// Mirrors http → ws / https → wss so the client stays on the same security
// posture as the HTTP origin.
export function wsUrl(code) {
  const base = SERVER_URL.replace(/^http/, 'ws');
  return `${base}/rooms/${code}/ws`;
}

// Baked into the bundle by vite.config.js's `define` block. Shown on the start
// screen so anyone can eyeball whether a deploy has actually landed. Vitest
// doesn't run through Vite's define pass, so guard with typeof to avoid a
// ReferenceError in test runs.
/* global __BUILD_TIME__ */
export const BUILD_TIME =
  typeof __BUILD_TIME__ === 'undefined' ? 'dev' : __BUILD_TIME__;
