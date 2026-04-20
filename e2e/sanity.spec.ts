import { test, expect } from '@playwright/test';

test('browser harness is wired up', async ({ page }) => {
  await page.goto('about:blank');
  const result = await page.evaluate(() => 1 + 1);
  expect(result).toBe(2);
});
