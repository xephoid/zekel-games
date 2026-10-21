import { describe, expect, it } from 'vitest';
import { chooseMove } from '../ai.js';
import { applyMove } from '../engine/apply.js';
import { getLegalMoves } from '../legalMoves.js';
import { describeNextStep } from '../nextStep.js';
import { fresh } from './support.js';

// Post-port §7 (human-seat sweep) and §8 (spoken summaries), engine-side:
// drive whole games, and at every step check that next_step is a well-formed
// human directive, that something is offered, and that the summary speaks in
// names rather than internal ids or debug text.

const RAW = [/undefined/, /NaN/, /\[object/, /town_town_/, /_p_\d+/, /clearing_\d+/, /temple_(sky|earth|space|light|fire)\b/];

describe('summaries and next_step over whole games', () => {
  it('every summary is speakable and every step has a directive and an offer (12 seeds)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = fresh(seed);
      let moves = 0;
      while (s.phase !== 'won' && s.phase !== 'lost' && moves < 1500) {
        const ns = describeNextStep(s, 'p1');
        expect(ns.status, `seed ${seed} move ${moves}`).toBe('human_to_move');
        expect(ns.active_player_id).toBe('p1');
        expect(ns.human_response?.ask.length ?? 0).toBeGreaterThan(3);
        expect(ns.human_response?.records_as.length ?? 0).toBeGreaterThan(3);
        for (const note of ns.facts?.notes ?? []) expect(note).not.toMatch(/apply_move|get_legal_moves|move_id|ASK them|do not invent/);
        expect(getLegalMoves(s).length, `seed ${seed} move ${moves}: something is offered`).toBeGreaterThan(1);
        const choice = chooseMove(s, 'medium');
        const r = applyMove(s, choice.move);
        if (choice.move.type !== 'look') {
          for (const re of RAW) expect(r.summary, `seed ${seed} move ${moves} ${choice.move.type}: ${r.summary.slice(0, 120)}`).not.toMatch(re);
        }
        expect(r.summary.length).toBeGreaterThan(5);
        s = r.newState;
        moves++;
      }
      expect(['won', 'lost']).toContain(s.phase);
      expect(describeNextStep(s, 'p1').status).toBe('game_over');
    }
  });

  it('look names every enemy id in brackets (the move language) beside its printed name', () => {
    const s = fresh(2);
    const r = applyMove(s, { type: 'leave' });
    const look = applyMove(r.newState, { type: 'look' }).summary;
    expect(look).toMatch(/You are at .* \(town\), outside its door\./);
    expect(look).toMatch(/Paths: /);
  });
});
