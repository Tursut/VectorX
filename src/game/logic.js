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
      deathCell: null,
    };
  });

  return {
    grid,
    players,
    currentPlayerIndex: startingPlayerIndex,
    phase: 'playing',
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

function markEliminated(p) {
  return { ...p, isEliminated: true, deathCell: { row: p.row, col: p.col } };
}

function advanceToNextActive(players, fromIndex) {
  let next = fromIndex;
  let attempts = 0;
  do {
    next = (next + 1) % PLAYERS.length;
    attempts++;
  } while (players[next].isEliminated && attempts <= PLAYERS.length);
  return next;
}

export function applyMove(state, targetRow, targetCol) {
  const { grid, players, currentPlayerIndex, turnCount } = state;
  const player = players[currentPlayerIndex];

  const newGrid = grid.map((row) => row.map((cell) => ({ ...cell })));
  newGrid[targetRow][targetCol] = { owner: player.id };

  const movedPlayers = players.map((p) =>
    p.id === player.id ? { ...p, row: targetRow, col: targetCol } : { ...p }
  );

  // Eliminate players (other than the mover) with no valid moves
  const updatedPlayers = movedPlayers.map((p) => {
    if (p.isEliminated || p.id === player.id) return p;
    return getValidMoves(newGrid, p.row, p.col).length === 0 ? markEliminated(p) : p;
  });

  let nextIndex = advanceToNextActive(updatedPlayers, currentPlayerIndex);

  // Eliminate the next player too if they have no moves
  const nextPlayer = updatedPlayers[nextIndex];
  let finalPlayers = updatedPlayers;
  if (!nextPlayer.isEliminated && getValidMoves(newGrid, nextPlayer.row, nextPlayer.col).length === 0) {
    finalPlayers = updatedPlayers.map((p) => p.id === nextPlayer.id ? markEliminated(p) : p);
    nextIndex = advanceToNextActive(finalPlayers, nextIndex);
  }

  const stillAlive = finalPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? (stillAlive[0] ?? finalPlayers.find((p) => p.id === player.id)) : null;

  return {
    grid: newGrid,
    players: finalPlayers,
    currentPlayerIndex: nextIndex,
    phase: isGameOver ? 'gameover' : 'playing',
    winner: winner ? winner.id : null,
    turnCount: turnCount + 1,
  };
}

export function eliminateCurrentPlayer(state) {
  const { players, currentPlayerIndex, turnCount } = state;
  const player = players[currentPlayerIndex];

  const updatedPlayers = players.map((p) =>
    p.id === player.id ? markEliminated(p) : p
  );

  const nextIndex = advanceToNextActive(updatedPlayers, currentPlayerIndex);

  const stillAlive = updatedPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? stillAlive[0] ?? null : null;

  return {
    ...state,
    players: updatedPlayers,
    currentPlayerIndex: nextIndex,
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
