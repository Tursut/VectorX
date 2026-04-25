// Quirky display-name generator for the online lobby. Produces strings like
// "Otis the Sly" or "Freddie the Unbeatable" — first name + " the " +
// adjective. Pure module: imported by the StartScreen as a default for the
// "Your name" input, also reused as the reroll source.
//
// DisplayName on the wire is capped at 20 chars (server/protocol.ts), and
// the literal " the " between the parts is 5 chars. The name + adjective
// budget is therefore 15 chars total. Pre-filter the adjective pool per
// chosen name so the result is always within budget.

const NAMES = [
  'Freddie', 'Mira', 'Otis', 'Wren', 'Quill', 'Zara', 'Nico', 'Ivy',
  'Sully', 'Luna', 'Bram', 'Cleo', 'Pip', 'Rufus', 'Hazel', 'Theo',
  'Dax', 'Kit', 'Jules', 'Hugo', 'Nyx', 'Roo', 'Fizz', 'Boo',
];

const ADJECTIVES = [
  'Unbeatable', 'Cunning', 'Sly', 'Daring', 'Brave', 'Bold', 'Wily',
  'Sneaky', 'Reckless', 'Crafty', 'Swift', 'Nimble', 'Mighty', 'Fearless',
  'Quick', 'Clever', 'Lucky', 'Wise', 'Bright', 'Fierce', 'Plucky',
  'Dauntless', 'Spry', 'Grand',
];

const MAX_LEN = 20;
const SEPARATOR = ' the ';

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateDisplayName() {
  const name = pick(NAMES);
  const budget = MAX_LEN - name.length - SEPARATOR.length;
  const fitting = ADJECTIVES.filter((a) => a.length <= budget);
  if (fitting.length === 0) return name;
  return `${name}${SEPARATOR}${pick(fitting)}`;
}
