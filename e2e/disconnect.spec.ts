// disconnect.spec.ts — deliberate exit-to-menu mid-game eliminates that
// player on the remaining player's board.
//
// The server's playing-phase grace (30 s after #22's resilience pass) means
// a transient disconnect — backgrounded tab, dropped network — no longer
// produces an instant skull. A DELIBERATE exit (the user taps "← Exit to
// menu" → "Yes, exit") still does, because the wrapper closes the WS with
// code 1000 and the server's deliberate-exit branch elims immediately.
// This test exercises that fast path; the slow grace + grace-expiry path is
// covered by server-side unit tests (room-playing-grace.test.ts).

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

test('player who taps exit-to-menu gets a skull on the remaining player\'s board', async ({ browser }) => {
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
    await expect(pageA.getByTestId('game-board')).toBeVisible({ timeout: 8_000 });
    await expect(pageB.getByTestId('game-board')).toBeVisible({ timeout: 8_000 });

    // Bob deliberately exits via the in-game button → confirm modal →
    // "Yes, exit". This unmounts OnlineGameController which calls
    // client.close() → WebSocket close with code 1000, which the server
    // treats as a deliberate exit and eliminates Bob immediately (the
    // playing-phase grace only applies to non-1000 transient closes).
    await pageB.getByRole('button', { name: /exit to menu/i }).click();
    await pageB.getByRole('button', { name: /yes, exit/i }).click();

    // The server calls eliminatePlayer on the 1000 close branch and
    // broadcasts the updated GAME_STATE. Alice should see a death skull
    // (💀) appear on the board within a few seconds.
    await expect(pageA.getByTestId('death-marker')).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctxA.close().catch(() => {});
    await ctxB.close().catch(() => {});
  }
});
