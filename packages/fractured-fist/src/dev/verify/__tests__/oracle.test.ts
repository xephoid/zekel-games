import { describe, expect, it } from 'vitest';
import { fracturedFistVerifyAdapter } from '../adapter.js';
import { randomPolicy, runGame } from '@zekel/dev/verify/exec/driver';

// Random play can reach a game nobody can lose (both players refine away or
// never buy a damage card), so a stalled game at the move cap is expected
// here — it is a property of the rules, recorded in the game's development notes, not a
// driver error. What must hold: no offered move is refused, and no rule fires.
function assertClean(seed: number): void {
  const result = runGame(fracturedFistVerifyAdapter, randomPolicy, seed, 1500);
  if (result.error) expect(result.error).toMatch(/move cap/);
  expect(result.divergences).toEqual([]);
}

describe('fractured-fist rules checker on the real engine', () => {
  it('plays random games (tracked and physical seats) with no divergences', () => {
    for (let seed = 1; seed <= 30; seed++) assertClean(seed);
  });

  it('is deterministic: same seed, same game', () => {
    const a = runGame(fracturedFistVerifyAdapter, randomPolicy, 5, 1500);
    const b = runGame(fracturedFistVerifyAdapter, randomPolicy, 5, 1500);
    expect(a.moves).toBe(b.moves);
    expect(a.winners).toEqual(b.winners);
  });
});
