import { describe, expect, it } from 'vitest';
import { randomPolicy, runGame } from '@zekel/dev/verify/exec/driver';
import { wordDebaucheeVerifyAdapter } from '../adapter.js';

describe('word-debauchee driver on the real engine', () => {
  it('plays random games at every seat count, table kind and variant with no errors or disagreements', () => {
    // Seeds 0-47 cover 2-5 seats x all-AI / one person / all people x none / Bribe / Open hand / The House.
    for (let seed = 0; seed < 48; seed++) {
      const result = runGame(wordDebaucheeVerifyAdapter, randomPolicy, seed, 1500);
      expect(result.error, `seed ${seed}`).toBeNull();
      expect(result.divergences, `seed ${seed}`).toEqual([]);
    }
  });

  it('is deterministic: same seed, same game', () => {
    const a = runGame(wordDebaucheeVerifyAdapter, randomPolicy, 41, 1500);
    const b = runGame(wordDebaucheeVerifyAdapter, randomPolicy, 41, 1500);
    expect(a.moves).toBe(b.moves);
    expect(a.winners).toEqual(b.winners);
  });
});
