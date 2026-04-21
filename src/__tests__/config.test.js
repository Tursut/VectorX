import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return (await import('../config.js')).ENABLE_ONLINE;
}

describe('VITE_ENABLE_ONLINE flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to false (committed .env)', async () => {
    // `.env` ships with VITE_ENABLE_ONLINE=false — that default must survive.
    expect(await loadConfig()).toBe(false);
  });

  it('is true only when the env var is the literal string "true"', async () => {
    vi.stubEnv('VITE_ENABLE_ONLINE', 'true');
    expect(await loadConfig()).toBe(true);
  });

  it('rejects truthy-looking but non-"true" values (e.g. "1", "yes")', async () => {
    vi.stubEnv('VITE_ENABLE_ONLINE', '1');
    expect(await loadConfig()).toBe(false);
    vi.stubEnv('VITE_ENABLE_ONLINE', 'yes');
    expect(await loadConfig()).toBe(false);
  });

  it('is false when unset', async () => {
    vi.stubEnv('VITE_ENABLE_ONLINE', undefined);
    expect(await loadConfig()).toBe(false);
  });
});
