import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import { chooseMove, type Difficulty } from '../ai.js';
import type { PlayerConfig } from '@zekel/game-kit';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

/** Play an all-AI game to completion, returning the sequence of move types. */
function playout(seed: number, difficulty: Difficulty): string[] {
  const seq: string[] = [];
  let s = createInitialState([ai('a'), ai('b'), ai('c')], { seed });
  let guard = 0;
  while (s.phase !== 'game_over' && guard++ < 4000) {
    const pid = s.activePlayerId;
    const { move } = chooseMove(s, pid, difficulty);
    seq.push(`${pid}:${move.type}`);
    s = applyMove(s, pid, move).newState;
  }
  return seq;
}

describe('AI determinism (seeded)', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
    it(`${difficulty}: identical seed → identical move sequence`, () => {
      const a = playout(123, difficulty);
      const b = playout(123, difficulty);
      expect(a).toEqual(b);
      expect(a.length).toBeGreaterThan(10);
    });
  }

  it('different seeds produce different games', () => {
    const a = playout(1, 'hard');
    const b = playout(2, 'hard');
    expect(a).not.toEqual(b);
  });

  it('easy is genuinely random (varies from the medium heuristic on the same seed)', () => {
    const easy = playout(5, 'easy');
    const medium = playout(5, 'medium');
    expect(easy).not.toEqual(medium);
  });
});
