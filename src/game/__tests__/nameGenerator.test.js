import { describe, expect, it } from 'vitest';
import { generateDisplayName } from '../nameGenerator';

describe('generateDisplayName', () => {
  it('returns a non-empty string', () => {
    const name = generateDisplayName();
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('always fits within the 20-char DisplayName cap', () => {
    // Loop a generous N to cover both pools' cross product.
    for (let i = 0; i < 500; i++) {
      const name = generateDisplayName();
      expect(name.length).toBeLessThanOrEqual(20);
    }
  });

  it('matches the "Name the Adjective" pattern', () => {
    // Either "Word the Word" (regular path) or a single bare word
    // (defensive fallback when no adjective fits the budget).
    const SHAPE = /^[A-Z][a-z]+( the [A-Z][a-z]+)?$/;
    for (let i = 0; i < 200; i++) {
      const name = generateDisplayName();
      expect(name).toMatch(SHAPE);
    }
  });
});
