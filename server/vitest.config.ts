import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// `cloudflareTest` is the Vite plugin: its configureVitest hook wires up the
// pool runner, and its resolveId/load hooks are what make
// `import { SELF } from 'cloudflare:test'` resolve inside workerd.
// (`cloudflarePool` alone only registers the pool runner — it omits the
// virtual-module resolver, so tests can't import `cloudflare:test`.)
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './server/wrangler.toml' },
    }),
  ],
  test: {
    include: ['server/**/*.test.ts'],
  },
});
