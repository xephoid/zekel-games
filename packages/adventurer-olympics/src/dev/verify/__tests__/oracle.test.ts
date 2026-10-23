import { describe, expect, it } from 'vitest';
import { adventurerOlympicsVerifyAdapter } from '../adapter.js';
import { randomPolicy, runGame } from '@zekel/dev/verify/exec/driver';

describe('adventurer-olympics driver on the real engine', () => {
  it('plays random games at every player count and table kind with no errors or disagreements', () => {
    // Seeds 0-8 cover 2/3/4 players x all-AI / physical human / digital human.
    for (let seed = 0; seed < 9; seed++) {
      const result = runGame(adventurerOlympicsVerifyAdapter, randomPolicy, seed, 2000);
      expect(result.error, `seed ${seed}`).toBeNull();
      expect(result.divergences, `seed ${seed}`).toEqual([]);
    }
  });

  it('is deterministic: same seed, same game', () => {
    const a = runGame(adventurerOlympicsVerifyAdapter, randomPolicy, 41, 2000);
    const b = runGame(adventurerOlympicsVerifyAdapter, randomPolicy, 41, 2000);
    expect(a.moves).toBe(b.moves);
    expect(a.winners).toEqual(b.winners);
  });
});
