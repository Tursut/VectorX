import { defineConfig, devices } from '@playwright/test';

// Allow overriding the chromium binary path (useful in sandboxed dev
// environments where Playwright can't download browsers). In CI we rely on
// `npx playwright install` to populate the default location.
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
      },
    },
  ],
  webServer: [
    {
      // Wrangler dev: Worker + Durable Objects on port 8787.
      command: 'npm run dev:server',
      url: 'http://localhost:8787/ping',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Vite dev with online flag enabled. Port pinned to match baseURL.
      command: 'VITE_ENABLE_ONLINE=true npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173/VectorX/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
