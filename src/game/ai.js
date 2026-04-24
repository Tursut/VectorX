import { GRID_SIZE, DIRECTIONS } from './constants';
import { getCurrentValidMoves } from './logic';

const GREMLIN_THOUGHTS = [
  'Recklessly scheming…',
  'Counting your squares…',
  'Running simulations…',
  'Buzzing chaotically…',
];

export { GREMLIN_THOUGHTS };

// ── BFS reachability ─────────────────────────────────────────────────────────
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
  return visited.size - 1;
}

function cloneGrid(grid) {
  return grid.map(r => r.map(c => ({ ...c })));
}

// Returns the number of empty immediate neighbours of a cell (used to penalise dead ends)
function openNeighbours(grid, row, col) {
  let count = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && grid[nr][nc].owner === null) count++;
  }
  return count;
}

// Small dead-end penalty: avoid moves that leave very few exits
function deadEndPenalty(grid, row, col) {
  const exits = openNeighbours(grid, row, col);
  if (exits === 0) return -8;   // never walk into a cell with no exits
  if (exits === 1) return -2.0; // strong penalty for near-dead-ends
  if (exits === 2) return -0.6;
  return 0;
}

// One-step lookahead: best reachable space achievable from any next move
function futureReachable(grid, row, col, playerId) {
  let best = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && grid[nr][nc].owner === null) {
      const tempGrid = cloneGrid(grid);
      tempGrid[nr][nc] = { owner: playerId };
      best = Math.max(best, reachable(tempGrid, nr, nc));
    }
  }
  return best;
}

// ── Scoring functions ────────────────────────────────────────────────────────

function scoreExpansive(state, move) {
  const playerId = state.players[state.currentPlayerIndex].id;
  const tempGrid = cloneGrid(state.grid);
  tempGrid[move.row][move.col] = { owner: playerId };
  const now    = reachable(tempGrid, move.row, move.col);
  const future = futureReachable(tempGrid, move.row, move.col, playerId);
  return now * 0.8 + future * 0.2 + deadEndPenalty(tempGrid, move.row, move.col);
}

function scoreTerritorial(state, move) {
  const player = state.players[state.currentPlayerIndex];
  const tempGrid = cloneGrid(state.grid);
  tempGrid[move.row][move.col] = { owner: player.id };

  const now    = reachable(tempGrid, move.row, move.col);
  const future = futureReachable(tempGrid, move.row, move.col, player.id);
  const ownSpace = now * 0.8 + future * 0.2;

  const opponents = state.players.filter(p => !p.isEliminated && p.id !== player.id);
  const blockBonus = opponents.reduce((sum, opp) => {
    const before = reachable(state.grid, opp.row, opp.col);
    const after  = reachable(tempGrid, opp.row, opp.col);
    return sum + Math.max(0, before - after);
  }, 0);

  return ownSpace + blockBonus * 0.65 + deadEndPenalty(tempGrid, move.row, move.col);
}

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

  const now    = reachable(tempGrid, move.row, move.col);
  const future = futureReachable(tempGrid, move.row, move.col, player.id);
  return totalCut * 0.75 + (now * 0.8 + future * 0.2) * 0.25 + deadEndPenalty(tempGrid, move.row, move.col);
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
  return bestDist <= 5 ? bestMove : null;
}

// ── Special item decisions (difficulty >= 1) ─────────────────────────────────

// Swap: target the opponent who has the most reachable space (most dangerous),
// but only if swapping into their position is actually better than staying.
function pickSwapTarget(state) {
  const moves = getCurrentValidMoves(state); // opponent positions
  if (moves.length === 0) return null;
  const player = state.players[state.currentPlayerIndex];
  const myCurrentSpace = reachable(state.grid, player.row, player.col);

  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const myNewSpace   = reachable(state.grid, m.row, m.col);
    const theirNewSpace = myCurrentSpace; // they inherit the bot's old position
    const netGain = myNewSpace - theirNewSpace;
    const score = netGain + deadEndPenalty(state.grid, m.row, m.col);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  // Don't swap if it's clearly a losing trade
  return bestScore > -2 ? best : moves[0];
}

// Freeze: target the opponent with the most reachable space (most threatening).
function pickFreezeTarget(state) {
  const moves = getCurrentValidMoves(state); // opponent positions
  if (moves.length === 0) return null;
  let best = moves[0], bestScore = -1;
  for (const m of moves) {
    const score = reachable(state.grid, m.row, m.col);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// Portal: jump to the empty cell with the most reachable open space.
function pickPortalDest(state) {
  const moves = getCurrentValidMoves(state); // all empty cells
  if (moves.length === 0) return null;

  let best = moves[0], bestScore = -1;
  for (const m of moves) {
    const score = reachable(state.grid, m.row, m.col);
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// ── Main entry point ─────────────────────────────────────────────────────────
// difficulty: 0 = original, 1 = improved (default)

export function getGremlinMove(state, difficulty = 1) {
  const moves = getCurrentValidMoves(state);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  // Handle special item states first at difficulty >= 1
  if (difficulty >= 1) {
    if (state.freezeSelectActive) return pickFreezeTarget(state) ?? moves[0];
    if (state.swapActive) return pickSwapTarget(state) ?? moves[0];
    if (state.portalActive) return pickPortalDest(state) ?? moves[0];
  }

  const rand = () => moves[Math.floor(Math.random() * moves.length)];

  // 72% chance to seek an item when any are visible
  if (state.magicItems && state.items.length > 0 && Math.random() < 0.72) {
    const itemMove = seekItem(moves, state);
    if (itemMove) return itemMove;
  }

  const playerId = state.players[state.currentPlayerIndex].id;
  switch (playerId) {
    case 0: return pickBest(moves, scoreExpansive, state);
    case 1: return pickBest(moves, scoreTerritorial, state);
    case 2: return pickBest(moves, scoreAggressive, state);
    case 3: // Buzzilda — less chaotic than before (20% random)
      return Math.random() < 0.2 ? rand() : pickBest(moves, scoreExpansive, state);
    default: return rand();
  }
}
