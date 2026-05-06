/** Worker-built GAME_STATE bot seats use displayName like `🤖 Bluebot` (server/index.ts). */
const ONLINE_BOT_NAME_PREFIX = /^\u{1F916}\s+/u;

export function stripOnlineBotNamePrefix(str) {
  if (typeof str !== 'string') return str;
  return str.replace(ONLINE_BOT_NAME_PREFIX, '');
}
