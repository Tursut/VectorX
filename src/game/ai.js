import { GRID_SIZE } from './constants';
import { getCurrentValidMoves } from './logic';

const GREMLIN_THOUGHTS = [
  'Recklessly scheming…',
  'Counting your squares…',
  'Running simulations…',
  'Buzzing chaotically…',
];

export { GREMLIN_THOUGHTS };

// ── BFS reachability ─────────────────────────────────────────────────────────
// Counts empty cells reachable from (row, col) on a given grid.
// Capped at maxCells to keep it fast on a 10×10 board.
function reachable(grid, row, col, maxCells = 60) {
  const visited = new Set([`${row},${col}`]);
  const queue = [[row, col]];
  while (queue.length > 0 && visited.size <= maxCells) {
    const [r, c] = queue.shift();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr, nc = c + dc;
        const key = `${nr},${nc}`;
        if (
          nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE &&
          grid[nr][nc].owner === null && !visited.has(key)
        ) {
          visited.add(key);
          queue.push([nr, nc]);
        }
      }
    }
  }
  return visited.size - 1; // exclude starting cell
}

function cloneGrid(grid) {
  return grid.map(r => r.map(c => ({ ...c })));
}

// ── Scoring functions ────────────────────────────────────────────────────────

// Reginald — stay free: picks the move that keeps the most reachable space.
// Much smarter than counting immediate neighbors — avoids dead ends.
function scoreExpansive(state, move) {
  const tempGrid = cloneGrid(state.grid);
  tempGrid[move.row][move.col] = { owner: state.players[state.currentPlayerIndex].id };
  return reachable(tempGrid, move.row, move.col);
}

// Gerald — territory + soft cut: own reachable space plus a bonus for
// each cell we shave off opponents' reach.
function scoreTerritorial(state, move) {
  const player = state.players[state.currentPlayerIndex];
  const tempGrid = cloneGrid(state.grid);
  tempGrid[move.row][move.col] = { owner: player.id };

  const ownSpace = reachable(tempGrid, move.row, move.col);
  const opponents = state.players.filter(p => !p.isEliminated && p.id !== player.id);
  const blockBonus = opponents.reduce((sum, opp) => {
    const before = reachable(state.grid, opp.row, opp.col);
    const after  = reachable(tempGrid, opp.row, opp.col);
    return sum + Math.max(0, before - after);
  }, 0);

  return ownSpace + blockBonus * 0.5;
}

// Bluebot — aggressive cutter: maximises how much space it strips from
// every active opponent, with a smaller bonus for its own freedom.
function scoreAggressive(state, move) {
  const player = state.players[state.currentPlayerIndex];
  const tempGrid = cloneGrid(state.grid);
  tempGrid[move.row][move.col] = { owner: player.id };

  const opponents = state.players.filter(p => !p.isEliminated && p.id !== player.id);
  const totalCut = opponents.reduce((sum, opp) => {
    const before = reachable(state.grid, opp.row, opp.col);
    const after  = reachable(tempGrid, opp.row, opp.col);
    return sum + Math.max(0, before - after);
  }, 0);

  const ownSpace = reachable(tempGrid, move.row, move.col);
  return totalCut * 0.7 + ownSpace * 0.3;
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

  for (const move of moves) {
    if (state.items.some(i => i.row === move.row && i.col === move.col)) return move;
  }

  let bestMove = null, bestDist = Infinity;
  for (const move of moves) {
    for (const item of state.items) {
      const dist = Math.max(Math.abs(move.row - item.row), Math.abs(move.col - item.col));
      if (dist < bestDist) { bestDist = dist; bestMove = move; }
    }
  }
  return bestDist <= 4 ? bestMove : null;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function getGremlinMove(state) {
  const moves = getCurrentValidMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const rand = () => moves[Math.floor(Math.random() * moves.length)];

  // 65% chance to seek an item when any are visible
  if (state.magicItems && state.items.length > 0 && Math.random() < 0.65) {
    const itemMove = seekItem(moves, state);
    if (itemMove) return itemMove;
  }

  const playerId = state.players[state.currentPlayerIndex].id;
  switch (playerId) {
    case 0: return pickBest(moves, scoreExpansive, state);   // Reginald — stay free
    case 1: return pickBest(moves, scoreTerritorial, state); // Gerald   — territory + soft cut
    case 2: return pickBest(moves, scoreAggressive, state);  // Bluebot  — cut opponents off
    case 3:                                                   // Buzzilda — chaotic but less dumb
      return Math.random() < 0.45 ? rand() : pickBest(moves, scoreExpansive, state);
    default: return rand();
  }
}
