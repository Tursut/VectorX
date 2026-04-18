import { GRID_SIZE, PLAYERS, DIRECTIONS } from './constants';

export function createInitialGrid() {
  const grid = Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ owner: null }))
  );
  return grid;
}

export function initGame() {
  const grid = createInitialGrid();
  const startingPlayerIndex = Math.floor(Math.random() * PLAYERS.length);

  const players = PLAYERS.map((p) => {
    grid[p.startRow][p.startCol] = { owner: p.id };
    return {
      id: p.id,
      row: p.startRow,
      col: p.startCol,
      isEliminated: false,
    };
  });

  return {
    grid,
    players,
    currentPlayerIndex: startingPlayerIndex,
    phase: 'playing', // 'playing' | 'gameover'
    winner: null,
    turnCount: 0,
  };
}

export function getValidMoves(grid, row, col) {
  const moves = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = row + dr;
    const nc = col + dc;
    if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && grid[nr][nc].owner === null) {
      moves.push({ row: nr, col: nc });
    }
  }
  return moves;
}

export function applyMove(state, targetRow, targetCol) {
  const { grid, players, currentPlayerIndex, turnCount } = state;
  const player = players[currentPlayerIndex];

  // Deep clone grid
  const newGrid = grid.map((row) => row.map((cell) => ({ ...cell })));
  newGrid[targetRow][targetCol] = { owner: player.id };

  const newPlayers = players.map((p) =>
    p.id === player.id ? { ...p, row: targetRow, col: targetCol } : { ...p }
  );

  // Find next active player, eliminating anyone with no moves along the way
  let nextIndex = currentPlayerIndex;
  let skipped = 0;
  const activePlayers = newPlayers.filter((p) => !p.isEliminated);

  // Eliminate players who have no valid moves now
  const updatedPlayers = newPlayers.map((p) => {
    if (p.isEliminated) return p;
    const moves = getValidMoves(newGrid, p.row, p.col);
    if (moves.length === 0 && p.id !== player.id) {
      return { ...p, isEliminated: true };
    }
    return p;
  });

  // Find next non-eliminated player
  let attempts = 0;
  do {
    nextIndex = (nextIndex + 1) % PLAYERS.length;
    attempts++;
  } while (updatedPlayers[nextIndex].isEliminated && attempts <= PLAYERS.length);

  // Check if the next player also needs to be eliminated (no moves)
  const nextPlayer = updatedPlayers[nextIndex];
  const nextMoves = getValidMoves(newGrid, nextPlayer.row, nextPlayer.col);
  const finalPlayers = updatedPlayers.map((p) => {
    if (p.id === nextPlayer.id && nextMoves.length === 0) {
      return { ...p, isEliminated: true };
    }
    return p;
  });

  // Recheck next after potential elimination
  let finalNextIndex = nextIndex;
  if (finalPlayers[nextIndex].isEliminated) {
    attempts = 0;
    do {
      finalNextIndex = (finalNextIndex + 1) % PLAYERS.length;
      attempts++;
    } while (finalPlayers[finalNextIndex].isEliminated && attempts <= PLAYERS.length);
  }

  const stillAlive = finalPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? (stillAlive[0] ?? finalPlayers.find((p) => p.id === player.id)) : null;

  return {
    grid: newGrid,
    players: finalPlayers,
    currentPlayerIndex: finalNextIndex,
    phase: isGameOver ? 'gameover' : 'playing',
    winner: winner ? winner.id : null,
    turnCount: turnCount + 1,
  };
}

export function getCurrentValidMoves(state) {
  const { grid, players, currentPlayerIndex } = state;
  const p = players[currentPlayerIndex];
  if (p.isEliminated) return [];
  return getValidMoves(grid, p.row, p.col);
}
