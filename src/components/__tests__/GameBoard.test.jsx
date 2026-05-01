import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PLAYERS } from '../../game/constants';
import GameBoard from '../GameBoard';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
}));

function makeGrid() {
  return [
    [{ owner: 0 }, { owner: 1 }],
    [{ owner: null }, { owner: null }],
  ];
}

function makePlayers() {
  return [
    { id: 0, row: 0, col: 0, isEliminated: false, deathCell: null },
    { id: 1, row: 0, col: 1, isEliminated: false, deathCell: null },
    { id: 2, row: 1, col: 0, isEliminated: false, deathCell: null },
    { id: 3, row: 1, col: 1, isEliminated: false, deathCell: null },
  ];
}

function renderBoard(overrides = {}) {
  return render(
    <GameBoard
      grid={makeGrid()}
      players={makePlayers()}
      validMoveSet={new Set()}
      onCellClick={() => {}}
      currentPlayerIndex={0}
      items={[]}
      portalActive={false}
      swapActive={false}
      isGremlinTurn={false}
      {...overrides}
    />,
  );
}

describe('GameBoard swap ownership masking', () => {
  it('renders committed ownership colors when pendingSwap is not active', () => {
    renderBoard();
    const fills = screen.getAllByTestId('cell-fill');
    expect(fills[0]).toHaveStyle(`background-color: ${PLAYERS[0].color}`);
    expect(fills[1]).toHaveStyle(`background-color: ${PLAYERS[1].color}`);
  });

  it('renders pre-swap ownership colors while pendingSwap is active', () => {
    // Post-swap state: players have already swapped positions and the two
    // claimed cells now show swapped owners in the authoritative grid.
    const playersAfterSwap = [
      { id: 0, row: 0, col: 1, isEliminated: false, deathCell: null },
      { id: 1, row: 0, col: 0, isEliminated: false, deathCell: null },
      { id: 2, row: 1, col: 0, isEliminated: false, deathCell: null },
      { id: 3, row: 1, col: 1, isEliminated: false, deathCell: null },
    ];
    const gridAfterSwap = [
      [{ owner: 1 }, { owner: 0 }],
      [{ owner: null }, { owner: null }],
    ];

    renderBoard({
      grid: gridAfterSwap,
      players: playersAfterSwap,
      pendingSwap: { byId: 1, targetId: 0 },
    });

    const fills = screen.getAllByTestId('cell-fill');
    // Masked render should still look pre-swap during roulette:
    // (0,0) back to id 0's color, (0,1) back to id 1's color.
    expect(fills[0]).toHaveStyle(`background-color: ${PLAYERS[0].color}`);
    expect(fills[1]).toHaveStyle(`background-color: ${PLAYERS[1].color}`);
  });
});
