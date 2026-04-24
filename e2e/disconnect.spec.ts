// disconnect.spec.ts — closing a browser mid-game eliminates that player.
//
// When a connected player's page closes (tab crash, navigation away, etc.) the
// server immediately eliminates them and broadcasts the updated game state.
// The remaining player's board should show a skull (💀) at the dead player's
// last cell within a few seconds.

import { test, expect } from '@playwright/test';
import {
  APP,
  gotoApp,
  selectOnlineMode,
  fillOnlineForm,
  clickPrimary,
  waitForLobby,
  getLobbyCode,
} from './helpers';

test('disconnected player gets a skull on the remaining player\'s board', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // Alice creates a room.
    await gotoApp(pageA);
    await selectOnlineMode(pageA);
    await fillOnlineForm(pageA, 'Alice');
    await clickPrimary(pageA);
    await waitForLobby(pageA);
    const code = await getLobbyCode(pageA);

    // Bob joins.
    await pageB.goto(`${APP}#/r/${code}`);
    await fillOnlineForm(pageB, 'Bob');
    await clickPrimary(pageB);
    await waitForLobby(pageB);

    // Wait for Alice's lobby to list Bob before starting.
    await expect(pageA.locator('[aria-label="Players"]')).toContainText('Bob', { timeout: 8_000 });

    // Alice starts the game — both see the board.
    await pageA.getByRole('button', { name: /start game/i }).click();
    await expect(pageA.locator('[data-testid="game-board"]')).toBeVisible({ timeout: 8_000 });
    await expect(pageB.locator('[data-testid="game-board"]')).toBeVisible({ timeout: 8_000 });

    // Bob disconnects abruptly (simulate tab close).
    await ctxB.close();

    // The server calls eliminatePlayer on webSocketClose and broadcasts a new
    // GAME_STATE. Alice should see a death skull (💀) appear on the board.
    await expect(pageA.locator('.death-marker')).toBeVisible({ timeout: 10_000 });
  } finally {
    // ctxB is already closed; closing ctxA is safe even if it throws.
    await ctxA.close().catch(() => {});
  }
});
