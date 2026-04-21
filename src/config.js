// Build-time feature flags. Centralised so tests and future modules share one
// source of truth and we avoid sprinkling `import.meta.env` across the codebase.
//
// Vite replaces `import.meta.env.VITE_*` with literal strings at build time,
// so referencing the flag from a module that nothing imports still tree-shakes
// to zero bytes in the production bundle.

export const ENABLE_ONLINE = import.meta.env.VITE_ENABLE_ONLINE === 'true';
