import { describe, expect, it } from 'vitest';
import { freshPool, LETTERS, TILE_COUNTS, TILE_TOTAL } from '../data/tiles.js';

describe('the letter tiles', () => {
  it('are 144 across the 26 letters, as the appendix prints them', () => {
    expect(LETTERS).toHaveLength(26);
    expect(Object.values(TILE_COUNTS).reduce((a, b) => a + b, 0)).toBe(TILE_TOTAL);
    expect(TILE_COUNTS.E).toBe(18);
    expect(TILE_COUNTS.Q).toBe(2);
  });

  it('gives each session its own pool', () => {
    const a = freshPool();
    a.A -= 1;
    expect(freshPool().A).toBe(13);
    expect(TILE_COUNTS.A).toBe(13);
  });
});
