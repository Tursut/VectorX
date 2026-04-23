import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Hits the real Worker fetch handler in-process via @cloudflare/vitest-pool-workers.
// SELF.fetch resolves to the export in server/index.ts because wrangler.toml
// declares `main = "index.ts"`.

describe('GET /ping', () => {
  it('returns "pong"', async () => {
    const res = await SELF.fetch('https://example.com/ping');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('pong');
  });

  it('404s unknown routes', async () => {
    const res = await SELF.fetch('https://example.com/nope');
    expect(res.status).toBe(404);
  });
});
