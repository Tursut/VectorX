// happy-path.spec.ts — two players create + join a room and both see the game.
//
// Uses two independent browser contexts to simulate two separate users. Alice
// creates a room, Bob joins via the share URL, Alice starts the game, and
// both contexts confirm they are rendering the same game board state.

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

test('two players create + join, lobby syncs, both see game board after start', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    // ── Alice: navigate to the app, switch to online mode, create a room ──
    await gotoApp(pageA);
    await selectOnlineMode(pageA);
    await fillOnlineForm(pageA, 'Alice');
    await clickPrimary(pageA); // "CREATE ROOM →"

    await waitForLobby(pageA);
    const code = await getLobbyCode(pageA);
    expect(code).toHaveLength(5);

    // ── Bob: join via the share URL (hash pre-fills the code) ──
    await pageB.goto(`${APP}#/r/${code}`);
    await fillOnlineForm(pageB, 'Bob'); // code already pre-filled by hash
    await clickPrimary(pageB); // "JOIN ROOM →"

    await waitForLobby(pageB);

    // ── Both see each other in the player list ──
    await expect(pageA.locator('[aria-label="Players"]')).toContainText('Bob', { timeout: 8_000 });
    await expect(pageB.locator('[aria-label="Players"]')).toContainText('Alice');

    // ── Alice (host) starts the game ──
    await pageA.getByRole('button', { name: /start game/i }).click();

    // ── Both contexts should show the game board ──
    await expect(pageA.getByTestId('game-board')).toBeVisible({ timeout: 8_000 });
    await expect(pageB.getByTestId('game-board')).toBeVisible({ timeout: 8_000 });

    // ── State sync: both show the same current player's name ──
    // Retry because framer-motion may briefly show no text during the enter
    // animation. Wait for the turn-name to contain any text first.
    await expect(pageA.getByTestId('turn-name')).not.toBeEmpty({ timeout: 5_000 });
    await expect(pageB.getByTestId('turn-name')).not.toBeEmpty({ timeout: 5_000 });

    const nameA = await pageA.getByTestId('turn-name').textContent();
    const nameB = await pageB.getByTestId('turn-name').textContent();
    expect(nameA).toBeTruthy();
    expect(nameA).toBe(nameB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
