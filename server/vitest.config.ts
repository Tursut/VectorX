import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    pool: cloudflarePool({
      wrangler: { configPath: './server/wrangler.toml' },
    }),
  },
});
