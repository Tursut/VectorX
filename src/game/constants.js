export const GRID_SIZE = 10;

export const PLAYERS = [
  {
    id: 0,
    name: 'Reginald the Reckless',
    shortName: 'Reginald',
    color: '#e74c3c',
    lightColor: '#f1948a',
    darkColor: '#c0392b',
    bgClass: 'player-red',
    icon: '🧙‍♂️',
    startRow: 0,
    startCol: 0,
    deathQuote: 'cornered like a raccoon in a trash can',
    winQuote: 'The wizard has spoken. And the wizard has WON.',
  },
  {
    id: 1,
    name: 'Gerald the Greedy',
    shortName: 'Gerald',
    color: '#27ae60',
    lightColor: '#82e0aa',
    darkColor: '#1e8449',
    bgClass: 'player-green',
    icon: '🐸',
    startRow: 0,
    startCol: GRID_SIZE - 1,
    deathQuote: 'trapped himself with his own greed',
    winQuote: "Gerald croaks in victory. The swamp is EVERYWHERE now.",
  },
  {
    id: 2,
    name: 'Bluebot 3000',
    shortName: 'Bluebot',
    color: '#2980b9',
    lightColor: '#7fb3d3',
    darkColor: '#1a5276',
    bgClass: 'player-blue',
    icon: '🤖',
    startRow: GRID_SIZE - 1,
    startCol: 0,
    deathQuote: 'computed a losing position. Error: feelings detected',
    winQuote: 'VICTORY PROTOCOL ACTIVATED. Humans: 0. Bluebot: 1.',
  },
  {
    id: 3,
    name: 'Queen Buzzilda',
    shortName: 'Buzzilda',
    color: '#f39c12',
    lightColor: '#f9e79f',
    darkColor: '#d68910',
    bgClass: 'player-yellow',
    icon: '🐝',
    startRow: GRID_SIZE - 1,
    startCol: GRID_SIZE - 1,
    deathQuote: 'got her wings clipped',
    winQuote: 'ALL HAIL THE QUEEN. The grid is now a hive.',
  },
];

export const TURN_TAUNTS = [
  (name) => `Your move, ${name}. No pressure. (Lots of pressure.)`,
  (name) => `${name}, the grid awaits. Don't blow it.`,
  (name) => `It's ${name}'s turn. Think fast. Or don't. We'll see.`,
  (name) => `${name} is up! The crowd holds its breath. (There is no crowd.)`,
  (name) => `${name}, this is your moment. Make it count.`,
  (name) => `Hey ${name}, your opponents are watching. Awkward.`,
  (name) => `${name}'s turn. The grid is judging you.`,
];

export const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

export const TURN_TIME = 10;

export const ITEM_TYPES = {
  bomb:   { type: 'bomb',   icon: '💣', name: 'Bomb',   color: '#e74c3c', desc: 'Clears nearby territory!' },
  portal: { type: 'portal', icon: '🌀', name: 'Portal', color: '#9b59b6', desc: 'Teleport anywhere!' },
  freeze: { type: 'freeze', icon: '❄️', name: 'Freeze', color: '#3498db', desc: 'Choose a player to freeze for 2 turns!' },
  swap:   { type: 'swap',   icon: '🎭', name: 'Swap',   color: '#2ecc71', desc: 'Switch places with any player!' },
};

export const ITEM_LIFESPAN      = 5;  // turns before item vanishes
export const ITEM_SPAWN_AFTER   = 6;  // don't spawn until this many turns in
export const ITEM_SPAWN_MIN     = 3;  // min turns between spawns
export const ITEM_SPAWN_MAX     = 7;  // max turns between spawns (random so same player isn't always next)
export const MAX_ITEMS_ON_BOARD = 2;
