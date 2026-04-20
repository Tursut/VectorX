import { describe, it, expect } from 'vitest';
import { initGame } from '../game/logic';
import { GRID_SIZE, PLAYERS } from '../game/constants';

describe('client test harness smoke', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('can import pure game logic from src/game/', () => {
    const state = initGame(false, 0);
    expect(state.grid).toHaveLength(GRID_SIZE);
    expect(state.players).toHaveLength(PLAYERS.length);
    expect(state.phase).toBe('playing');
  });
});
