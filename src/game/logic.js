import {
  GRID_SIZE, PLAYERS, DIRECTIONS,
  ITEM_TYPES, ITEM_LIFESPAN, ITEM_SPAWN_AFTER, MAX_ITEMS_ON_BOARD, ITEM_SPAWN_MIN, ITEM_SPAWN_MAX,
} from './constants';

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export function createInitialGrid() {
  return Array.from({ length: GRID_SIZE }, () =>
    Array.from({ length: GRID_SIZE }, () => ({ owner: null }))
  );
}

export function initGame(magicItems = false, gremlinCount = 0) {
  const grid = createInitialGrid();
  const startingPlayerIndex = Math.floor(Math.random() * PLAYERS.length);

  const players = PLAYERS.map((p) => {
    grid[p.startRow][p.startCol] = { owner: p.id };
    return { id: p.id, row: p.startRow, col: p.startCol, isEliminated: false, deathCell: null };
  });

  return {
    grid,
    players,
    currentPlayerIndex: startingPlayerIndex,
    phase: 'playing',
    winner: null,
    turnCount: 0,
    magicItems,
    gremlinCount,
    items: [],
    nextSpawnIn: randomInt(ITEM_SPAWN_MIN, ITEM_SPAWN_MAX),
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    frozenPlayerId: null,
    frozenTurnsLeft: 0,
    lastEvent: null,
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

const markEliminated = (p) => ({ ...p, isEliminated: true, deathCell: { row: p.row, col: p.col } });

function advanceToNextActive(players, fromIndex) {
  let next = fromIndex;
  let attempts = 0;
  do {
    next = (next + 1) % players.length;
    attempts++;
  } while (players[next].isEliminated && attempts <= players.length);
  return next;
}

function getSpawnCandidates(grid, players, items) {
  const occupied = new Set([
    ...players.filter(p => !p.isEliminated).map(p => `${p.row},${p.col}`),
    ...items.map(i => `${i.row},${i.col}`),
  ]);
  const candidates = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c].owner === null && !occupied.has(`${r},${c}`)) {
        candidates.push({ row: r, col: c });
      }
    }
  }
  return candidates;
}

function trySpawnItem(state) {
  if (!state.magicItems || state.sandboxMode) return state;

  const newNextSpawnIn = state.nextSpawnIn - 1;
  if (newNextSpawnIn > 0) return { ...state, nextSpawnIn: newNextSpawnIn };

  // Timer hit zero — reset it regardless of whether we actually spawn
  const reset = { ...state, nextSpawnIn: randomInt(ITEM_SPAWN_MIN, ITEM_SPAWN_MAX) };

  if (state.turnCount < ITEM_SPAWN_AFTER || state.items.length >= MAX_ITEMS_ON_BOARD) {
    return reset;
  }

  const candidates = getSpawnCandidates(state.grid, state.players, state.items);
  if (candidates.length === 0) return reset;

  // 40% bias toward the most-trapped active player
  let cell = candidates[Math.floor(Math.random() * candidates.length)];
  if (Math.random() < 0.4) {
    const active = state.players.filter(p => !p.isEliminated);
    const trapped = active.reduce(
      (best, p) => {
        const n = getValidMoves(state.grid, p.row, p.col).length;
        return n < best.moves ? { player: p, moves: n } : best;
      },
      { player: active[0], moves: Infinity }
    );
    if (trapped.player) {
      const sorted = [...candidates].sort((a, b) => {
        const da = Math.max(Math.abs(a.row - trapped.player.row), Math.abs(a.col - trapped.player.col));
        const db = Math.max(Math.abs(b.row - trapped.player.row), Math.abs(b.col - trapped.player.col));
        return da - db;
      });
      const pool = sorted.slice(0, Math.min(5, sorted.length));
      cell = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  const typeKeys = Object.keys(ITEM_TYPES);
  const type = typeKeys[Math.floor(Math.random() * typeKeys.length)];

  // Lifespan scales with board fill: 16 early, 12 mid, 8 late
  const totalCells = GRID_SIZE * GRID_SIZE;
  const claimedCells = state.grid.flat().filter(c => c.owner !== null).length;
  const boardFill = claimedCells / totalCells;
  const lifespan = Math.max(8, Math.round(16 - boardFill * 8));

  return {
    ...reset,
    items: [
      ...state.items,
      { id: `${Date.now()}-${Math.random()}`, type, row: cell.row, col: cell.col, turnsLeft: lifespan },
    ],
  };
}

// Completes a turn: eliminates trapped players, advances turn order, checks win, ticks items.
function completeTurn(state) {
  const { grid, players, currentPlayerIndex, turnCount, items } = state;
  const player = players[currentPlayerIndex];

  let updatedPlayers = players;
  let nextIndex = advanceToNextActive(updatedPlayers, currentPlayerIndex);
  let frozenPlayerId = state.frozenPlayerId ?? null;
  let frozenTurnsLeft = state.frozenTurnsLeft ?? 0;

  // Only eliminate players whose turn is up next — others die when their turn arrives.
  let safety = 0;
  while (safety++ < players.length) {
    const nextPlayer = updatedPlayers[nextIndex];
    if (nextIndex === currentPlayerIndex || nextPlayer.isEliminated) break;
    if (getValidMoves(grid, nextPlayer.row, nextPlayer.col).length > 0) break;
    updatedPlayers = updatedPlayers.map((p) =>
      p.id === nextPlayer.id ? { ...markEliminated(p), finishTurn: turnCount } : p
    );
    nextIndex = advanceToNextActive(updatedPlayers, nextIndex);
  }

  // Skip frozen player and tick down their counter.
  // When turnsLeft hits 0, keep the badge alive until the player's real turn arrives.
  if (frozenPlayerId !== null) {
    const fp = updatedPlayers.find(p => p.id === frozenPlayerId);
    if (!fp || fp.isEliminated) {
      frozenPlayerId = null; frozenTurnsLeft = 0;
    } else if (updatedPlayers[nextIndex]?.id === frozenPlayerId) {
      if (frozenTurnsLeft > 0) {
        frozenTurnsLeft -= 1;
        nextIndex = advanceToNextActive(updatedPlayers, nextIndex); // skip
      } else {
        // All skips exhausted — real turn arrives, clear badge and let them play
        frozenPlayerId = null;
      }
    }
  }

  const stillAlive = updatedPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? (stillAlive[0] ?? updatedPlayers.find((p) => p.id === player.id)) : null;

  const tickedItems = items
    .map(i => ({ ...i, turnsLeft: i.turnsLeft - 1 }))
    .filter(i => i.turnsLeft > 0);

  const nextState = {
    ...state,
    players: updatedPlayers,
    currentPlayerIndex: nextIndex,
    phase: isGameOver ? 'gameover' : 'playing',
    winner: winner ? winner.id : null,
    turnCount: turnCount + 1,
    items: tickedItems,
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    frozenPlayerId,
    frozenTurnsLeft,
    lastEvent: null,
  };

  return trySpawnItem(nextState);
}

export function applyMove(state, targetRow, targetCol) {
  const { grid, players, currentPlayerIndex, items, portalActive, swapActive } = state;
  const player = players[currentPlayerIndex];

  // Freeze target selection: freeze the chosen player for 3 turns
  if (state.freezeSelectActive) {
    const target = players.find(p => !p.isEliminated && p.id !== player.id && p.row === targetRow && p.col === targetCol);
    if (!target) return state;
    const result = completeTurn({ ...state, frozenPlayerId: target.id, frozenTurnsLeft: 3, freezeSelectActive: false });
    return { ...result, lastEvent: { type: 'freeze', byId: player.id, targetId: target.id } };
  }

  // Swap selection: exchange positions and claim the new squares
  if (swapActive) {
    const target = players.find(p => !p.isEliminated && p.id !== player.id && p.row === targetRow && p.col === targetCol);
    const swapGrid = grid.map(r => r.map(c => ({ ...c })));
    swapGrid[targetRow][targetCol] = { owner: player.id };
    if (target) swapGrid[player.row][player.col] = { owner: target.id };
    const swappedPlayers = players.map(p => {
      if (p.id === player.id) return { ...p, row: targetRow, col: targetCol };
      if (p.id === target?.id) return { ...p, row: player.row, col: player.col };
      return { ...p };
    });
    const result = completeTurn({ ...state, grid: swapGrid, players: swappedPlayers, swapActive: false });
    return { ...result, lastEvent: target ? { type: 'swap', byId: player.id, targetId: target.id } : null };
  }

  const newGrid = grid.map((row) => row.map((cell) => ({ ...cell })));
  newGrid[targetRow][targetCol] = { owner: player.id };

  const movedPlayers = players.map((p) =>
    p.id === player.id ? { ...p, row: targetRow, col: targetCol } : { ...p }
  );

  const itemAtTarget = items.find(i => i.row === targetRow && i.col === targetCol);
  const remainingItems = items.filter(i => !(i.row === targetRow && i.col === targetCol));

  const partial = { ...state, grid: newGrid, players: movedPlayers, items: remainingItems, lastEvent: null };

  // Portal move: complete turn normally
  if (portalActive) {
    return completeTurn({ ...partial, portalActive: false });
  }

  // First move — apply item effect if collected
  if (itemAtTarget) {
    switch (itemAtTarget.type) {
      case 'portal':
        return { ...partial, portalActive: true };

      case 'swap':
        return { ...partial, swapActive: true };

      case 'bomb': {
        const bombGrid = newGrid.map(r => r.map(c => ({ ...c })));
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = targetRow + dr;
            const nc = targetCol + dc;
            if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
              bombGrid[nr][nc] = { owner: null };
            }
          }
        }
        return completeTurn({ ...partial, grid: bombGrid });
      }

      case 'freeze':
        return { ...partial, freezeSelectActive: true };
    }
  }

  return completeTurn(partial);
}

export function eliminateCurrentPlayer(state) {
  const { players, currentPlayerIndex, turnCount, items } = state;
  const player = players[currentPlayerIndex];

  const updatedPlayers = players.map((p) =>
    p.id === player.id ? { ...markEliminated(p), finishTurn: turnCount } : p
  );

  let nextIndex = advanceToNextActive(updatedPlayers, currentPlayerIndex);
  const stillAlive = updatedPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? stillAlive[0] ?? null : null;

  const tickedItems = items
    .map(i => ({ ...i, turnsLeft: i.turnsLeft - 1 }))
    .filter(i => i.turnsLeft > 0);

  return trySpawnItem({
    ...state,
    players: updatedPlayers,
    currentPlayerIndex: nextIndex,
    phase: isGameOver ? 'gameover' : 'playing',
    winner: winner ? winner.id : null,
    turnCount: turnCount + 1,
    items: tickedItems,
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    lastEvent: null,
  });
}

// Eliminate an arbitrary player by id. Used server-side for disconnects:
// closing a WebSocket in-game kicks that seat without requiring it to be
// their turn.
//
// Behaviour:
//   - If the player isn't found or is already eliminated → no-op, returns
//     `state` unchanged.
//   - If playerId points at the current player → delegates to
//     `eliminateCurrentPlayer` so turn advance + item tick + trySpawnItem
//     all happen exactly as they would for a TIMEOUT on their own turn.
//   - Otherwise → marks that player eliminated with `deathCell` at their
//     current cell and `finishTurn: turnCount`. Turn does NOT advance
//     (someone else is mid-turn). Recomputes gameover + winner.
export function eliminatePlayer(state, playerId) {
  const { players, currentPlayerIndex, turnCount } = state;
  const target = players.find((p) => p.id === playerId);
  if (!target || target.isEliminated) return state;

  if (players[currentPlayerIndex].id === playerId) {
    return eliminateCurrentPlayer(state);
  }

  const updatedPlayers = players.map((p) =>
    p.id === playerId ? { ...markEliminated(p), finishTurn: turnCount } : p
  );
  const stillAlive = updatedPlayers.filter((p) => !p.isEliminated);
  const isGameOver = stillAlive.length <= 1;
  const winner = isGameOver ? stillAlive[0] ?? null : null;

  return {
    ...state,
    players: updatedPlayers,
    phase: isGameOver ? 'gameover' : 'playing',
    winner: winner ? winner.id : null,
  };
}

export function getCurrentValidMoves(state) {
  const { grid, players, currentPlayerIndex, portalActive, swapActive } = state;
  const p = players[currentPlayerIndex];
  if (p.isEliminated) return [];

  if (state.freezeSelectActive) {
    return players
      .filter(op => !op.isEliminated && op.id !== p.id)
      .map(op => ({ row: op.row, col: op.col }));
  }

  if (swapActive) {
    return players
      .filter(op => !op.isEliminated && op.id !== p.id)
      .map(op => ({ row: op.row, col: op.col }));
  }

  if (portalActive) {
    const occupied = new Set(
      players.filter(pl => !pl.isEliminated).map(pl => `${pl.row},${pl.col}`)
    );
    const itemCells = new Set(state.items.map(i => `${i.row},${i.col}`));
    const moves = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (grid[r][c].owner === null && !occupied.has(`${r},${c}`) && !itemCells.has(`${r},${c}`)) {
          moves.push({ row: r, col: c });
        }
      }
    }
    return moves;
  }

  return getValidMoves(grid, p.row, p.col);
}

export function initSandboxGame() {
  const grid = createInitialGrid();
  const sandboxPlayers = [PLAYERS[0], PLAYERS[3]]; // Reginald (human) + Buzzilda (bot)
  const players = sandboxPlayers.map((p) => {
    grid[p.startRow][p.startCol] = { owner: p.id };
    return { id: p.id, row: p.startRow, col: p.startCol, isEliminated: false, deathCell: null };
  });
  return {
    grid,
    players,
    currentPlayerIndex: 0,
    phase: 'playing',
    winner: null,
    turnCount: 0,
    magicItems: true,
    gremlinCount: 1,
    items: [],
    nextSpawnIn: 999,
    portalActive: false,
    swapActive: false,
    freezeSelectActive: false,
    frozenPlayerId: null,
    frozenTurnsLeft: 0,
    lastEvent: null,
    sandboxMode: true,
  };
}

export function placeSandboxItem(state, type) {
  const human = state.players[0];
  const occupied = new Set([
    ...state.players.filter(p => !p.isEliminated).map(p => `${p.row},${p.col}`),
    ...state.items.map(i => `${i.row},${i.col}`),
  ]);
  const candidates = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = human.row + dr;
    const nc = human.col + dc;
    if (
      nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE &&
      state.grid[nr][nc].owner === null &&
      !occupied.has(`${nr},${nc}`)
    ) {
      candidates.push({ row: nr, col: nc });
    }
  }
  if (candidates.length === 0) return state;
  const cell = candidates[0];
  const filtered = state.items.filter(i => i.type !== type);
  return {
    ...state,
    items: [...filtered, { id: `sb-${type}-${Date.now()}`, type, row: cell.row, col: cell.col, turnsLeft: 99 }],
  };
}

// Server-side security boundary for MOVE messages.
// Returns { ok: true } when the given player may legally move to (row, col)
// in the current state, or { ok: false, reason } otherwise. `reason` values
// map 1:1 to the ERROR.code enum in server/protocol.ts so a DO handler can
// forward them directly as ERROR messages.
//
// Delegates the "what's legal" question to `getCurrentValidMoves`, which
// already knows how to handle portal/swap/freeze-select modes and returns
// only in-bounds, empty-or-valid-target cells. So bounds and already-claimed
// checks come for free — we only add phase + turn-ownership guards on top.
export function validateMove(state, playerId, row, col) {
  if (state.phase !== 'playing') {
    return { ok: false, reason: 'NOT_YOUR_TURN' };
  }
  if (state.players[state.currentPlayerIndex].id !== playerId) {
    return { ok: false, reason: 'NOT_YOUR_TURN' };
  }
  const moves = getCurrentValidMoves(state);
  if (!moves.some((m) => m.row === row && m.col === col)) {
    return { ok: false, reason: 'INVALID_MOVE' };
  }
  return { ok: true };
}
