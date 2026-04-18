import { GRID_SIZE } from './constants';
import { getValidMoves, getCurrentValidMoves } from './logic';

const GREMLIN_THOUGHTS = [
  'Recklessly scheming…',
  'Counting your squares…',
  'Running simulations…',
  'Buzzing chaotically…',
];

export { GREMLIN_THOUGHTS };

// ── Scoring functions ────────────────────────────────────────────────────────

function scoreReckless(state, move) {
  // Maximize own freedom after the move
  const tempGrid = state.grid.map(r => r.map(c => ({ ...c })));
  tempGrid[move.row][move.col] = { owner: state.players[state.currentPlayerIndex].id };
  return getValidMoves(tempGrid, move.row, move.col).length;
}

function scoreGreedy(state, move) {
  // Count unclaimed cells adjacent to the target position
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = move.row + dr, nc = move.col + dc;
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && state.grid[nr][nc].owner === null) {
        count++;
      }
    }
  }
  return count;
}

function scoreTactical(state, move) {
  // Minimize nearest active opponent's valid moves after our move
  const player = state.players[state.currentPlayerIndex];
  const opponents = state.players.filter(p => !p.isEliminated && p.id !== player.id);
  if (opponents.length === 0) return 0;

  const nearest = opponents.reduce((best, opp) => {
    const dist = Math.max(Math.abs(opp.row - player.row), Math.abs(opp.col - player.col));
    return dist < best.dist ? { opp, dist } : best;
  }, { opp: opponents[0], dist: Infinity });

  const tempGrid = state.grid.map(r => r.map(c => ({ ...c })));
  tempGrid[move.row][move.col] = { owner: player.id };
  return -getValidMoves(tempGrid, nearest.opp.row, nearest.opp.col).length;
}

function pickBest(moves, scoreFn, state) {
  let best = moves[0], bestScore = -Infinity;
  for (const move of moves) {
    const s = scoreFn(state, move);
    if (s > bestScore) { bestScore = s; best = move; }
  }
  return best;
}

// ── Item seeking ─────────────────────────────────────────────────────────────

function seekItem(moves, state) {
  if (!state.magicItems || state.items.length === 0) return null;

  // Grab item directly if a valid move lands on it
  for (const move of moves) {
    if (state.items.some(i => i.row === move.row && i.col === move.col)) return move;
  }

  // Otherwise step toward the nearest item — but only when it's within reach
  let bestMove = null, bestDist = Infinity;
  for (const move of moves) {
    for (const item of state.items) {
      const dist = Math.max(Math.abs(move.row - item.row), Math.abs(move.col - item.col));
      if (dist < bestDist) { bestDist = dist; bestMove = move; }
    }
  }
  return bestDist <= 3 ? bestMove : null;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function getGremlinMove(state) {
  const moves = getCurrentValidMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const rand = () => moves[Math.floor(Math.random() * moves.length)];

  // 55% chance to seek an item when any are on the board
  if (state.magicItems && state.items.length > 0 && Math.random() < 0.55) {
    const itemMove = seekItem(moves, state);
    if (itemMove) return itemMove;
  }

  const playerId = state.players[state.currentPlayerIndex].id;
  switch (playerId) {
    case 0: return pickBest(moves, scoreReckless, state); // Reginald — expand hard
    case 1: return pickBest(moves, scoreGreedy, state);   // Gerald   — claim most neighbours
    case 2: return pickBest(moves, scoreTactical, state); // Bluebot  — trap opponents
    case 3:                                                // Buzzilda — chaotic
      return Math.random() < 0.7 ? rand() : pickBest(moves, scoreReckless, state);
    default: return rand();
  }
}
