import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai.js';
import { applyMove } from '../engine/apply.js';
import { getLegalMoves } from '../legalMoves.js';
import { fresh } from './support.js';

// The harness bot must drive a session to game_over within a move cap, and
// every move it picks must be one the engine accepts.

describe('the harness bot', () => {
  it('reaches game over on 12 seeds within 600 moves, choosing only accepted moves', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = fresh(seed);
      let moves = 0;
      while (s.phase !== 'won' && s.phase !== 'lost' && moves < 600) {
        const choice = chooseMove(s, 'medium');
        const legalIds = getLegalMoves(s).map((m) => JSON.stringify(m.move));
        if (choice.move.type !== 'look') {
          expect(legalIds, `seed ${seed} move ${moves}: ${JSON.stringify(choice.move)} (${choice.reasoning})`).toContain(JSON.stringify(choice.move));
        }
        s = applyMove(s, choice.move).newState;
        moves++;
      }
      expect(['won', 'lost'], `seed ${seed} after ${moves} moves`).toContain(s.phase);
    }
  });

  it('is deterministic', () => {
    const a = fresh(7);
    expect(chooseMove(a, 'medium')).toEqual(chooseMove(fresh(7), 'medium'));
  });
});
