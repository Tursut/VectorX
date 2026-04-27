// Shared helpers for the online E2E suite.
//
// APP and SERVER match the webServer ports in playwright.config.ts. Both must
// be running before tests execute (the webServer config handles this).

import type { Page } from '@playwright/test';

export const SERVER = 'http://localhost:8787';
export const APP = 'http://localhost:5173/VectorX/';

// Create a room via the HTTP API (not the browser). Returns the 5-char code.
export async function createRoom(): Promise<string> {
  const res = await fetch(`${SERVER}/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /rooms returned ${res.status}`);
  const body = await res.json() as { code: string };
  return body.code;
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto(APP);
}

// Switch the start screen into create-a-room mode (the entry path every
// online-mode E2E spec uses — share-link join tests cold-open into JOIN
// mode directly, so they don't go through this helper).
export async function selectOnlineMode(page: Page): Promise<void> {
  await page.getByTestId('hero-play-online').click();
}

// Fill the online form. `code` is optional — when the URL hash pre-filled it,
// pass nothing (the field is already populated). The display-name field is
// pre-filled by the name generator, so we always clear before filling.
export async function fillOnlineForm(
  page: Page,
  name: string,
  code?: string,
): Promise<void> {
  const nameInput = page.getByTestId('display-name-input');
  await nameInput.fill('');
  await nameInput.fill(name);
  if (code) {
    await page.getByLabel('Room code').fill(code);
  }
}

export async function clickPrimary(page: Page): Promise<void> {
  await page.getByTestId('primary-button').click();
}

// Wait for the lobby waiting-room section to become visible.
export async function waitForLobby(page: Page): Promise<void> {
  await page.waitForSelector('[aria-label="Waiting room"]', { timeout: 10_000 });
}

// Extract the 5-char room code from the lobby hero section.
export async function getLobbyCode(page: Page): Promise<string> {
  const text = await page.getByTestId('lobby-code').textContent();
  return text?.trim() ?? '';
}

// Click the first valid-move cell on the game board (role="button" is only
// added to cells where the current player can legally move).
export async function clickFirstValidCell(page: Page): Promise<void> {
  await page
    .getByTestId('game-board')
    .locator('[role="button"]')
    .first()
    .click({ timeout: 8_000 });
}
