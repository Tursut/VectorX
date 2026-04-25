// bot-fill.spec.ts — 1 human + 3 bots: lobby shows bot placeholders, game starts.
//
// When a human starts a game alone, the server fills the remaining 3 seats with
// bots. This spec verifies the lobby shows the correct empty-slot count and that
// the game board appears with the starting-position cells already claimed.

import { test, expect } from '@playwright/test';
import {
  APP,
  gotoApp,
  selectOnlineMode,
  fillOnlineForm,
  clickPrimary,
  waitForLobby,
  clickFirstValidCell,
} from './helpers';

test('1 human + 3 bots: lobby shows 3 bot slots, game starts, board renders', async ({ page }) => {
  await gotoApp(page);
  await selectOnlineMode(page);
  await fillOnlineForm(page, 'Solo');
  await clickPrimary(page); // "CREATE ROOM →"

  await waitForLobby(page);

  // Lobby must show exactly 3 "Bot will fill this slot" placeholders.
  await expect(page.getByTestId('lobby-empty-seat')).toHaveCount(3);

  // Host starts with only one human — 3 bot seats get filled server-side.
  await page.getByRole('button', { name: /start game/i }).click();

  // Game board must appear after start.
  await expect(page.getByTestId('game-board')).toBeVisible({ timeout: 8_000 });

  // Each player's starting corner is pre-claimed in initGame → 4 .cell-fill
  // divs should exist immediately (no moves needed).
  await expect(page.getByTestId('cell-fill')).toHaveCount(4, { timeout: 5_000 });

  // If it is the human's turn (seat 0, starting corner is random), make a move
  // so the test doesn't rely on the 10 s turn-timer to advance.
  const firstValid = page.getByTestId('game-board').locator('[role="button"]').first();
  if (await firstValid.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await firstValid.click();
  }

  // At least 4 cells are claimed (pre-claimed corners). After any single move
  // there will be 5. Either count >= 4 proves the board rendered correctly.
  const fills = await page.getByTestId('cell-fill').count();
  expect(fills).toBeGreaterThanOrEqual(4);
});
