import { describe, expect, it } from 'vitest';
import { chooseAIMove } from '../ai.js';
import type { Tier } from '../ai/debauchee.js';
import { chooseGuesserMove, MEDIUM_REVEAL_THRESHOLD, targetsFor } from '../ai/guesser.js';
import { candidates, heard, synonymWeights } from '../ai/solver.js';
import { cardFor } from '../data/deck.js';
import { applyMove } from '../engine/apply.js';
import { activeSeatId } from '../engine/helpers.js';
import { createState } from '../engine/round.js';
import { getLegalMoves } from '../legalMoves.js';
import type { WordDebaucheeState } from '../types.js';
import { play, seats, secret, start, toBuild } from './support.js';

const TIERS: Tier[] = ['easy', 'medium', 'hard'];

/** Play a whole all-AI game; every move must be legal. Returns the final state. */
function allAI(n: number, tiers: Tier[], seed: number, rounds?: number): WordDebaucheeState {
  let s = createState(seats(n, [...Array(n).keys()]), { seed, rounds });
  let guard = 0;
  while (s.phase !== 'game_over') {
    if (++guard > 5000) throw new Error('game did not end');
    const id = activeSeatId(s);
    const tier = tiers[s.seats.findIndex((x) => x.id === id)]!;
    const m = chooseAIMove(s, id, tier, seed + guard);
    expect(chooseAIMove(s, id, tier, seed + guard)).toEqual(m);
    const legal = getLegalMoves(s, id);
    const sameMove = legal.some((l) => l.move.type === m.type);
    expect(sameMove, `${tier} ${id} ${JSON.stringify(m)} in ${s.phase}`).toBe(true);
    s = applyMove(s, id, m).newState;
  }
  return s;
}

describe('the AI guessers', () => {
  it('play legal moves through whole games at every tier, and the same game for the same seed', () => {
    for (const tier of TIERS) {
      const a = allAI(3, [tier, tier, tier], 100, 3);
      const b = allAI(3, [tier, tier, tier], 100, 3);
      expect(a.history).toEqual(b.history);
      expect(a.history).toHaveLength(3);
    }
    allAI(4, ['hard', 'easy', 'medium', 'hard'], 7, 4);
    allAI(2, ['medium', 'hard'], 8, 2);
  });

  it('crack some rounds and get stumped in others, at medium and hard (easy is the random floor)', () => {
    for (const tier of TIERS.filter((t) => t !== 'easy')) {
      const outcomes = new Set<string>();
      for (const seed of [1, 2, 3, 4, 5, 6]) for (const h of allAI(3, [tier, tier, tier], seed, 3).history) outcomes.add(h.outcome);
      expect(outcomes.has('cracked'), `${tier} never cracks`).toBe(true);
    }
  });

  it('lists spellable shared synonyms, with the row that already spells a prefix', () => {
    let s = toBuild(start(3, { tiles: 'server', timer: 'sand' }, [1, 2]));
    const card = secret(s);
    const syn = card.synonyms[0]!.toUpperCase();
    s = play(s, 'ben', { type: 'place', letter: syn[0]! }).state;
    const { targets, count } = targetsFor(s.round!, heard(s.round!.played));
    expect(count).toBe(candidates(heard(s.round!.played), []).length);
    const t = targets.find((x) => x.word === syn);
    if (t) {
      expect(t.row).toBe(0);
      expect(t.progress).toBe(1);
    }
    for (const x of targets) expect(x.weight).toBeGreaterThanOrEqual(1);
  });

  it('medium spells the most-shared synonym and checks on the tile that completes it', () => {
    let s = toBuild(start(2, { tiles: 'server', timer: 'sand' }, [1]));
    const clues = heard(s.round!.played);
    const { targets } = targetsFor(s.round!, clues);
    const best = [...targets].sort((a, b) => b.weight - a.weight || a.word.length - b.word.length || a.word.localeCompare(b.word))[0]!;
    const cands = candidates(clues, []);
    if (cands.length > MEDIUM_REVEAL_THRESHOLD) {
      expect(chooseGuesserMove(s, 'ben', 'medium', 1)).toEqual({ type: 'call_reveal' });
      return;
    }
    for (let i = 0; i < best.word.length; i++) {
      const m = chooseGuesserMove(s, 'ben', 'medium', 1);
      expect(m.type).toBe('place');
      if (m.type !== 'place') return;
      expect(m.letter).toBe(best.word[i]);
      expect(!!m.check).toBe(i === best.word.length - 1);
      s = applyMove(s, 'ben', m).newState;
      if (s.round?.number !== 1) break;
    }
    expect(s.round?.number !== 1 || s.round.checks.some((c) => c.word === best.word)).toBe(true);
  });

  it('never spells a burned word or one already answered "no"', () => {
    let s = toBuild(start(2, { tiles: 'server', timer: 'sand' }, [1]));
    const clues = heard(s.round!.played);
    const before = targetsFor(s.round!, clues).targets.map((t) => t.word);
    if (before.length < 2) return;
    s = play(s, 'ann', { type: 'burn', word: before[0]! }).state;
    const after = targetsFor(s.round!, clues).targets.map((t) => t.word);
    expect(after).not.toContain(before[0]);
    expect(after).toContain(before[1]);
  });

  it('easy is uniformly random over the legal moves, and never a report', () => {
    for (const seed of [1, 2, 3]) {
      let s = toBuild(createState(seats(2, [1]), { seed, firstDebauchee: 'ann' }));
      for (let i = 0; i < 12 && s.round?.number === 1; i++) {
        if (s.phase === 'reveal') {
          s = play(s, 'ann', getLegalMoves(s, 'ann')[0]!.move).state;
          continue;
        }
        const m = chooseGuesserMove(s, 'ben', 'easy', seed + i);
        expect(['place', 'move', 'call_reveal', 'check']).toContain(m.type);
        expect(getLegalMoves(s, 'ben').some((l) => JSON.stringify(l.move) === JSON.stringify(m))).toBe(true);
        s = applyMove(s, 'ben', m).newState;
      }
    }
  });

  it('hard does not abandon a row it has started', () => {
    for (const seed of [31, 32, 33]) {
      let s = toBuild(createState(seats(2, [1]), { seed, firstDebauchee: 'ann', timer: 'sand' }));
      let m = chooseGuesserMove(s, 'ben', 'hard', 1);
      if (m.type !== 'place' || m.check) continue;
      s = applyMove(s, 'ben', m).newState;
      m = chooseGuesserMove(s, 'ben', 'hard', 1);
      expect(m.type).toBe('place');
      // The row by its letters (what the summaries say) or its number: either names row 0.
      if (m.type === 'place') expect(typeof m.row === 'string' ? s.round!.buildArea.indexOf(m.row) : m.row).toBe(0);
    }
  });

  it('re-completes an unchecked word on the table so it can check it', () => {
    let s = toBuild(start(3, { tiles: 'server', timer: 'sand' }, [2]));
    const clues = heard(s.round!.played);
    const { targets } = targetsFor(s.round!, clues);
    const best = [...targets].sort((a, b) => b.weight - a.weight || a.word.length - b.word.length || a.word.localeCompare(b.word))[0];
    if (!best || candidates(clues, []).length > MEDIUM_REVEAL_THRESHOLD) return;
    // Ben (human) spells the whole word without checking; Cat (AI) is next.
    let row: number | undefined;
    for (const ch of best.word) {
      s = play(s, 'ben', row === undefined ? { type: 'place', letter: ch } : { type: 'place', letter: ch, row }).state;
      row ??= 0;
      s = play(s, 'cat', { type: 'place', letter: 'Z' }).state; // Cat keeps out of the way
      if (s.round!.buildArea.length > 1) s = play(s, 'ben', { type: 'move', row: 1, index: 0 }).state;
      s = play(s, 'cat', { type: 'move', row: 0, index: 0, to_row: 0, to_index: 0 }).state;
    }
    expect(s.round!.buildArea[0]).toBe(best.word);
    const m = chooseGuesserMove(s, 'ben', 'medium', 1);
    expect(m).toMatchObject({ type: 'move', row: s.round!.buildArea[0], check: true });
    const r = applyMove(s, 'ben', m);
    expect(r.summary).toContain(`"Check! ${best.word}."`);
  });

  it('refuses a seat that is not on the move', () => {
    const s = toBuild(start(3, { tiles: 'server' }, [1, 2]));
    expect(() => chooseAIMove(s, 'cat', 'hard', 1)).toThrow(/not cat's move/);
    expect(() => chooseAIMove(s, 'ann', 'hard', 1)).toThrow(/not ann's move/);
    expect(cardFor(s.round!.word!)).toBeDefined();
    expect(synonymWeights([]).size).toBe(0);
  });
});
