// share-link.spec.ts — cold-open of a share URL auto-fills the room code.
//
// Verifies that a user who receives `/#/r/CODE` directly (e.g. pasted from
// chat) lands in online mode with the code pre-filled and the primary button
// ready to JOIN, without having to navigate through the start screen manually.

import { test, expect } from '@playwright/test';
import { createRoom, APP } from './helpers';

test('cold-open share link pre-fills the room code', async ({ page }) => {
  const code = await createRoom();
  // Navigate directly to the share URL — no prior interaction with the app.
  await page.goto(`${APP}#/r/${code}`);

  // App should initialise in online mode with code already in the field.
  await expect(page.getByLabel('Room code')).toHaveValue(code, { timeout: 8_000 });
  // Primary button label confirms we're joining (not creating) a room.
  await expect(page.getByTestId('primary-button')).toHaveText(/JOIN ROOM/);
});
