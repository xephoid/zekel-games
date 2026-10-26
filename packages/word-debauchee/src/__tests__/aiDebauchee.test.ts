import { describe, expect, it } from 'vitest';
import { chooseDebaucheeMove, GIFT_ORDER, hardestPlay, tierOf, validPlays, type Tier } from '../ai/debauchee.js';
import { answersFor, candidateCount, candidates, crackChance, fitsRevealed, heard, synonymWeights } from '../ai/solver.js';
import { CLUES, clue, type ClueId } from '../data/clues.js';
import { cardFor, CARDS } from '../data/deck.js';
import { applyMove } from '../engine/apply.js';
import { createState } from '../engine/round.js';
import { getLegalMoves } from '../legalMoves.js';
import type { WordDebaucheeState } from '../types.js';
import { play, seats, start } from './support.js';

const TIERS: Tier[] = ['easy', 'medium', 'hard'];

describe('the candidate solver', () => {
  it('keeps the word itself among the candidates for any clues it answers', () => {
    const happy = cardFor('HAPPY')!;
    const all = CLUES.map((c) => c.id);
    const cands = candidates(answersFor(happy, all), ['P', 'P', 'Y']);
    expect(cands.map((c) => c.word)).toContain('HAPPY');
    expect(candidateCount(answersFor(happy, ['letters', 'category']), [])).toBeGreaterThan(1);
    expect(candidateCount([], [])).toBe(500);
  });

  it('prunes by revealed letters as a multiset', () => {
    const happy = cardFor('HAPPY')!;
    expect(fitsRevealed(happy, ['P', 'P'])).toBe(true);
    expect(fitsRevealed(happy, ['P', 'P', 'P'])).toBe(false);
    expect(fitsRevealed(happy, ['Z'])).toBe(false);
    expect(fitsRevealed(happy, ['Y', 'H', 'A', 'P', 'P'])).toBe(true);
    expect(fitsRevealed(happy, ['Y', 'H', 'A', 'P', 'P', 'E'])).toBe(false);
  });

  it('drops judgment clues a human answered in their own words rather than return nothing', () => {
    const happy = cardFor('HAPPY')!;
    const clues = [...answersFor(happy, ['letters', 'category']), { card: 'opposite' as ClueId, answer: 'glum and miserable' }];
    const cands = candidates(clues, []);
    expect(cands.length).toBeGreaterThan(0);
    expect(cands.every((c) => c.letters === 5 && c.category === 'Feelings')).toBe(true);
    expect(candidates([{ card: 'letters', answer: 99 }], []).length).toBe(500);
  });

  it('weights the synonyms the candidates share', () => {
    const w = synonymWeights(candidates(answersFor(cardFor('HAPPY')!, ['category', 'type', 'letters']), []));
    expect(w.get('glad')).toBeGreaterThanOrEqual(1);
    expect([...w.values()].every((n) => n >= 1)).toBe(true);
  });

  it('reads only what the table heard', () => {
    expect(heard([{ card: 'letters', answer: 5 }, { card: 'opposite', answer: null }])).toEqual([{ card: 'letters', answer: 5 }]);
  });
});

describe('the AI debauchee', () => {
  it('maps every difficulty name onto a tier', () => {
    expect(tierOf(undefined)).toBe('easy');
    expect(tierOf('random')).toBe('easy');
    expect(tierOf('medium')).toBe('medium');
    expect(tierOf('hard')).toBe('hard');
    expect(tierOf('mcts')).toBe('hard');
  });

  it('lists the valid plays of three from a hand, once each', () => {
    expect(validPlays(['letters', 'vowels', 'category', 'type'])).toHaveLength(4);
    expect(validPlays(['letters', 'letters', 'category', 'type'])).toHaveLength(3);
    expect(validPlays(['letters', 'vowels', 'grade', 'type']).every((p) => p.includes('type'))).toBe(true);
    expect(GIFT_ORDER).toHaveLength(CLUES.length);
    expect(new Set(GIFT_ORDER).size).toBe(CLUES.length);
  });

  it('always makes a legal move, for every tier, at every debauchee phase, and the same one for the same seed', () => {
    for (const tier of TIERS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        let s = createState(seats(3, [0]), { seed, firstDebauchee: 'ann' });
        while (s.round?.number === 1 && s.phase !== 'game_over') {
          if (['choose_word', 'play_clues', 'reveal'].includes(s.phase)) {
            const m = chooseDebaucheeMove(s, 'ann', tier, seed);
            expect(chooseDebaucheeMove(s, 'ann', tier, seed)).toEqual(m);
            const legal = getLegalMoves(s, 'ann').map((l) => JSON.stringify(l.move));
            // play_clues legal entries may list the cards in another order
            const ok = legal.includes(JSON.stringify(m)) || (m.type === 'play_clues' && legal.some((l) => JSON.stringify([...(JSON.parse(l).cards as string[])].sort()) === JSON.stringify([...m.cards].sort())));
            expect(ok, `${tier} ${seed} ${s.phase} ${JSON.stringify(m)}`).toBe(true);
            s = applyMove(s, 'ann', m).newState;
          } else {
            s = play(s, s.round!.guessers[s.round!.turnIndex]!, { type: 'call_reveal' }).state;
          }
        }
        expect(s.history[0]?.outcome).toBe('stumped');
      }
    }
  });

  it('medium buries the most giving card and keeps the slowest word', () => {
    let s = createState(seats(3, [0]), { seed: 9, firstDebauchee: 'ann' });
    const dealt = s.round!.dealtWords.map((w) => cardFor(w)!);
    const slow = (c: typeof dealt[0]) => c.letters + Math.min(...c.synonyms.map((x) => x.length));
    const chosen = chooseDebaucheeMove(s, 'ann', 'medium', 1) as { word: string };
    expect(Math.max(...dealt.map(slow))).toBe(slow(cardFor(chosen.word)!));
    s = applyMove(s, 'ann', chosen).newState;
    const playM = chooseDebaucheeMove(s, 'ann', 'medium', 1) as { cards: ClueId[] };
    const buried = s.round!.hand.filter((id) => !playM.cards.includes(id) || playM.cards.filter((x) => x === id).length < s.round!.hand.filter((x) => x === id).length);
    const giftiest = Math.min(...s.round!.hand.map((id) => GIFT_ORDER.indexOf(id)));
    expect(GIFT_ORDER.indexOf(buried[0]!)).toBe(giftiest);
  });

  it('medium reveals common and repeated letters before rare ones', () => {
    const s = reveal(start(3, { tiles: 'server' }, [0]));
    const word = s.round!.word!;
    const m = chooseDebaucheeMove(s, 'ann', 'medium', 1) as { letter: string };
    const freq = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';
    const letters = [...new Set(word.split(''))];
    const counts = new Map<string, number>();
    for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const best = letters.sort((a, b) => ((26 - freq.indexOf(b)) + (counts.get(b)! > 1 ? 10 : 0)) - ((26 - freq.indexOf(a)) + (counts.get(a)! > 1 ? 10 : 0)))[0];
    expect(m.letter).toBe(best);
  });

  it('hard plays the three cards that give a solver-guesser the lowest chance, and reveals the letter that keeps it lowest', () => {
    for (const seed of [21, 22, 23]) {
      let s = createState(seats(3, [0]), { seed, firstDebauchee: 'ann' });
      s = applyMove(s, 'ann', chooseDebaucheeMove(s, 'ann', 'hard', 1)).newState;
      const card = cardFor(s.round!.word!)!;
      const m = chooseDebaucheeMove(s, 'ann', 'hard', 1) as { cards: ClueId[] };
      const chosen = crackChance(answersFor(card, m.cards), []).chance;
      for (const p of validPlays(s.round!.hand)) expect(crackChance(answersFor(card, p), []).chance).toBeGreaterThanOrEqual(chosen);
      s = applyMove(s, 'ann', m).newState;
      s = reveal(s);
      const rv = chooseDebaucheeMove(s, 'ann', 'hard', 1) as { letter: string };
      const after = crackChance(heard(s.round!.played), [rv.letter]).chance;
      for (const ch of new Set(card.word.split(''))) expect(crackChance(heard(s.round!.played), [ch]).chance).toBeGreaterThanOrEqual(after);
    }
  });

  it('against the deck, Category and Type together give more away than Shortest synonym (HAPPY)', () => {
    const card = cardFor('HAPPY')!;
    expect(clue('shortest_synonym').answer(card)).toBe(4);
    const hand: ClueId[] = ['letters', 'shortest_synonym', 'category', 'type'];
    const { play, chance } = hardestPlay(card, hand);
    expect([...play].sort()).toEqual(['letters', 'shortest_synonym', 'type']);
    expect(chance).toBeLessThan(crackChance(answersFor(card, ['letters', 'category', 'type']), []).chance);
    expect(candidateCount(answersFor(card, ['letters', 'category', 'type']), [])).toBe(8);
  });
});

/** Drive a fresh game to the first owed reveal with the AI debauchee playing hard. */
function reveal(state: WordDebaucheeState): WordDebaucheeState {
  let s = state;
  while (s.phase !== 'reveal') {
    if (s.phase === 'build') s = play(s, s.round!.guessers[s.round!.turnIndex]!, { type: 'call_reveal' }).state;
    else s = applyMove(s, 'ann', chooseDebaucheeMove(s, 'ann', 'hard', 1)).newState;
  }
  return s;
}
