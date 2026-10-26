import { checkGateConsistency } from '@zekel/game-kit';
import { describe, expect, it } from 'vitest';
import { chooseAIMove } from '../ai.js';
import { applyMove } from '../engine/apply.js';
import { activeSeatId } from '../engine/helpers.js';
import { MOVE_TYPES } from '../engine/moves.js';
import { createState } from '../engine/round.js';
import { getLegalMoves } from '../legalMoves.js';
import { moveGates } from '../moveGates.js';
import type { WordDebaucheeState } from '../types.js';
import { play, seats, start, toBuild } from './support.js';

function lock(state: WordDebaucheeState): void {
  for (const seat of state.seats) {
    const gates = moveGates(state, seat.id);
    expect(gates.map((g) => g.move_type).sort()).toEqual([...MOVE_TYPES].sort());
    expect(checkGateConsistency(gates, getLegalMoves(state, seat.id)), `${seat.id} at ${state.phase}`).toEqual([]);
    for (const g of gates) if (g.status !== 'available') expect(g.reason, `${seat.id} ${g.move_type}`).toBeTruthy();
  }
}

describe('move gates', () => {
  it('agree with the legal moves through setup, a human table and an all-AI game', () => {
    lock(createState(seats(3), { seed: 7 }));
    lock(start(3));
    lock(toBuild(start(3)));
    lock(play(toBuild(start(3)), 'ben', { type: 'call_reveal' }).state);
    let s = createState(seats(3, [0, 1, 2]), { seed: 9, rounds: 2 });
    let guard = 0;
    while (s.phase !== 'game_over' && guard++ < 400) {
      lock(s);
      const id = activeSeatId(s);
      s = applyMove(s, id, chooseAIMove(s, id, 'medium', guard)).newState;
    }
    lock(s);
    expect(s.phase).toBe('game_over');
  });

  it('name the rule when a move is blocked by one', () => {
    const table = toBuild(start(3));
    expect(moveGates(table, 'ben').find((g) => g.move_type === 'place')).toMatchObject({ status: 'gated', rules_section: 'build' });
    const server = toBuild(start(3, { tiles: 'server' }));
    expect(moveGates(server, 'ben').find((g) => g.move_type === 'timer_out')).toMatchObject({ status: 'gated' });
    expect(moveGates(server, 'cat').find((g) => g.move_type === 'place')?.reason).toContain("Ben's turn");
    expect(moveGates(server, 'ann').find((g) => g.move_type === 'reveal')?.reason).toContain('no reveal is owed');
  });
});
