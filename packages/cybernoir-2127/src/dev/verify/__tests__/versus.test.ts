import { describe, expect, it } from 'vitest';
import { cybernoirVerifyAdapter } from '../adapter.js';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { randomPolicy, runVersusGame } from '@zekel/dev/verify/exec/driver';
import { runVersus } from '@zekel/dev/verify/hunter/versus';

const adapter = cybernoirVerifyAdapter as unknown as VerifyAdapter<unknown>;

describe('versus mode', () => {
  it('plays a full game with one seat on the engine AI, deterministically', async () => {
    const a = await runVersusGame(adapter, 'hacker', randomPolicy, 'medium', 321, 600);
    const b = await runVersusGame(adapter, 'hacker', randomPolicy, 'medium', 321, 600);
    expect(a.error).toBeNull();
    expect(a.winners).toEqual(b.winners);
    expect(a.moves).toBe(b.moves);
    expect(a.winners.length).toBeGreaterThan(0);
  });

  it('runVersus reports a champion, holdout, and baseline', async () => {
    const result = await runVersus(
      adapter,
      {
        policySeatId: 'hacker',
        aiDifficulty: 'easy',
        populationSize: 3,
        generations: 1,
        gamesPerCandidate: 2,
        holdoutGames: 4,
        maxMovesPerGame: 300,
        baseSeed: 5,
      },
    );
    expect(result.championRender.length).toBeGreaterThan(0);
    expect(result.holdout.games).toBe(4);
    expect(result.randomBaseline.games).toBe(4);
    expect(result.generationBests).toHaveLength(1);
  });
});
