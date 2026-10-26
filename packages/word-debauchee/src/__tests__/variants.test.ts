// The three printed variants as options: Bribe, Open hand and The House
// (rules.md "Variants"; PLAN.md Q7 and Q11).

import { checkGateConsistency } from '@zekel/game-kit';
import { describe, expect, it } from 'vitest';
import { chooseAIMove } from '../ai.js';
import { hardestOpenPlay, STINGIEST_OPEN_PLAY } from '../ai/debauchee.js';
import { clue, CLUES, type ClueId } from '../data/clues.js';
import { cardFor } from '../data/deck.js';
import { applyMove } from '../engine/apply.js';
import { activeSeatId } from '../engine/helpers.js';
import { MOVE_TYPES } from '../engine/moves.js';
import { createState, payouts } from '../engine/round.js';
import { wordDebauchee } from '../index.js';
import { getLegalMoves } from '../legalMoves.js';
import { moveGates } from '../moveGates.js';
import { describeNextStep } from '../nextStep.js';
import type { WordDebaucheeOptions, WordDebaucheeState } from '../types.js';
import { getPublicView } from '../views.js';
import { play, seats, secret, spell, start, toBuild } from './support.js';

const CLUE_CARDS = CLUES.reduce((a, c) => a + c.copies, 0);

function lock(state: WordDebaucheeState): void {
  for (const seat of state.seats) {
    const gates = moveGates(state, seat.id);
    expect(gates.map((g) => g.move_type).sort()).toEqual([...MOVE_TYPES].sort());
    expect(checkGateConsistency(gates, getLegalMoves(state, seat.id)), `${seat.id} at ${state.phase}`).toEqual([]);
  }
}

/** An all-AI game to the end, every seat at `tier`, gates locked every few moves. */
function allAI(n: number, tier: string, seed: number, options: WordDebaucheeOptions): WordDebaucheeState {
  let s = createState(seats(n, [...Array(n).keys()]), { seed, rounds: 3, ...options });
  let guard = 0;
  while (s.phase !== 'game_over') {
    if (++guard > 3000) throw new Error('stuck');
    if (guard % 7 === 0) lock(s);
    const id = activeSeatId(s);
    s = applyMove(s, id, chooseAIMove(s, id, tier, seed + guard)).newState;
  }
  lock(s);
  return s;
}

/** Cards in the two decks plus the round's hand: always the whole set. */
function clueCardsHeld(s: WordDebaucheeState): number {
  return s.numberDeck.length + s.wordClueDeck.length + (s.round?.hand.length ?? 0);
}

describe('Bribe', () => {
  it('lets a guesser take a clue instead of a letter on "Reveal!", counted as a reveal', () => {
    let s = toBuild(start(3, { tiles: 'server', bribe: true }));
    const numbersBefore = s.numberDeck.length;
    const top = s.numberDeck[0]!;
    const { state, summary } = play(s, 'ben', { type: 'call_reveal', clue: 'number' });
    s = state;
    expect(summary).toContain('takes a number clue instead of a letter');
    expect(summary).toContain(`${clue(top).name}: `);
    expect(summary).toContain('counts as a reveal (1 so far)');
    expect(s.phase).toBe('build');
    expect(s.round!.bribed).toEqual([top]);
    expect(s.round!.played).toHaveLength(4);
    expect(s.round!.played[3]).toMatchObject({ card: top, answer: clue(top).answer(secret(s)) });
    expect(s.round!.revealed).toEqual([]);
    expect(s.numberDeck).toHaveLength(numbersBefore - 1);
    expect(clueCardsHeld(s)).toBe(CLUE_CARDS);
    expect(s.round!.turnIndex).toBe(1);
    expect(s.round!.turnsSinceReveal).toBe(0);
    const view = getPublicView(s).round!;
    expect(view.bribed).toEqual([top]);
    expect(view.reveals_for_scoring).toBe(1);
    expect(describeNextStep(s).facts?.notes?.some((n) => n.includes('(bribed)'))).toBe(true);
  });

  it('cuts the crack payout by each bribed clue', () => {
    let s = toBuild(start(3, { tiles: 'server', bribe: true, timer: 'sand' }));
    s = play(s, 'ben', { type: 'call_reveal', clue: 'number clue' }).state;
    const syn = secret(s).synonyms[0]!;
    const { state } = spell(s, syn);
    const h = state.history[0]!;
    expect(h.outcome).toBe('cracked');
    expect(h.bribes).toBe(1);
    expect(h.revealed).toBe(0);
    expect(h.payouts).toEqual(payouts('cracked', h.word, syn, 1, 'ann', ['ben', 'cat']));
    expect(h.payouts.ben).toBe(Math.max(1, syn.length - 1));
    expect(clueCardsHeld(state)).toBe(CLUE_CARDS);
  });

  it('pauses the build while a human debauchee answers a bribed judgment clue; words still burn', () => {
    let s = toBuild(start(3, { tiles: 'server', bribe: true }));
    s.wordClueDeck = ['opposite', ...s.wordClueDeck.filter((id) => id !== 'opposite')];
    const r1 = play(s, 'ben', { type: 'call_reveal', clue: 'word' });
    s = r1.state;
    expect(r1.summary).toContain('Ann answers Opposite in their own words');
    expect(s.phase).toBe('answer_clues');
    lock(s);
    expect(getLegalMoves(s, 'ann').map((m) => m.move_id)).toEqual(['answer_clue:opposite:card', 'answer_clue:opposite:own', 'burn']);
    expect(getLegalMoves(s, 'cat').map((m) => m.move_id)).toEqual(['burn']);
    expect(moveGates(s, 'cat').find((g) => g.move_type === 'place')?.reason).toContain('answers the bribed clue first');
    s = play(s, 'cat', { type: 'burn', word: 'glum' }).state;
    expect(s.round!.burned).toEqual(['glum']);
    const r2 = play(s, 'ann', { type: 'answer_clue', card: 'Opposite', text: 'sad' });
    expect(r2.summary).toContain('Opposite: sad.');
    expect(r2.summary).toContain('Cat to act.');
    expect(r2.state.phase).toBe('build');
    expect(r2.state.round!.played[3]).toMatchObject({ card: 'opposite', answer: 'sad' });
  });

  it('works at a table with its own tiles, and is refused when the variant is off', () => {
    const table = toBuild(start(3, { bribe: true }));
    expect(getLegalMoves(table, 'ben').map((m) => m.move_id)).toEqual(['check', 'call_reveal', 'call_reveal:number', 'call_reveal:word', 'burn', 'timer_out']);
    const { state, summary } = play(table, 'cat', { type: 'call_reveal', clue: 'a word clue' });
    expect(summary).toContain('takes a word clue');
    expect(state.round!.bribed).toHaveLength(1);
    const off = toBuild(start(3, { tiles: 'server' }));
    expect(getLegalMoves(off, 'ben').some((m) => m.move_id.startsWith('call_reveal:'))).toBe(false);
    expect(() => play(off, 'ben', { type: 'call_reveal', clue: 'number' })).toThrow(/Bribe is not on/);
    expect(() => play(table, 'ben', { type: 'call_reveal', clue: 'letters' } as never)).toThrow(/say "number" or "word"/);
  });

  it('is played by the AI at every tier, deterministically', () => {
    for (const tier of ['easy', 'medium', 'hard']) {
      const a = allAI(3, tier, 11, { bribe: true });
      const b = allAI(3, tier, 11, { bribe: true });
      expect(a.history).toEqual(b.history);
      expect(a.history).toHaveLength(3);
    }
    // Medium and hard take clues at some point over a few seeds.
    let bribes = 0;
    for (const seed of [1, 2, 3, 4]) for (const h of allAI(3, 'medium', seed, { bribe: true }).history) bribes += h.bribes;
    expect(bribes).toBeGreaterThan(0);
  });
});

describe('Open hand', () => {
  it('deals no clues and lets the debauchee play any three from the set, one a number clue', () => {
    let s = start(3, { tiles: 'server', openHand: true });
    expect(s.round!.hand).toEqual([]);
    expect(s.numberDeck).toHaveLength(20);
    expect(s.wordClueDeck).toHaveLength(28);
    const { state: chosen, summary } = play(s, 'ann', { type: 'choose_word', word: s.round!.dealtWords[0]! });
    expect(summary).toContain('any three clue cards from the whole set');
    s = chosen;
    const menu = getLegalMoves(s, 'ann');
    expect(menu).toHaveLength(1);
    expect(menu[0]!.move_id).toBe('play_clues');
    expect(menu[0]!.description).toContain('Shortest synonym');
    expect(() => play(s, 'ann', { type: 'play_clues', cards: ['letters', 'letters', 'category'] })).toThrow(/three different/);
    expect(() => play(s, 'ann', { type: 'play_clues', cards: ['category', 'type', 'opposite'] })).toThrow(/number clue/);
    expect(() => play(s, 'ann', { type: 'play_clues', cards: ['letters', 'type', 'opposite', 'vowels'] })).toThrow(/exactly 3/);
    expect(() => play(s, 'ann', { type: 'play_clues', cards: ['letters', 'type', 'nope'] as ClueId[] })).toThrow(/not a clue card/);
    const played = play(s, 'ann', { type: 'play_clues', cards: ['Letters', 'Syllables', 'Category'] as ClueId[] });
    s = played.state;
    expect(played.summary).toContain('Ann lays down Letters, Syllables and Category.');
    expect(s.round!.hand).toEqual(['letters', 'syllables', 'category']);
    expect(s.numberDeck).toHaveLength(18);
    expect(s.wordClueDeck).toHaveLength(27);
    expect(clueCardsHeld(s)).toBe(CLUE_CARDS);
    expect(s.phase).toBe('build');
    // The cards go back under their decks when the round ends.
    const { state: done } = spell(s, secret(s).synonyms[0]!);
    expect(done.history[0]!.outcome).toBe('cracked');
    expect(done.numberDeck).toHaveLength(20);
    expect(done.wordClueDeck).toHaveLength(28);
    expect(describeNextStep(start(3, { openHand: true })).instruction).toContain('three word cards');
  });

  it('gives the AI debauchee a play from the whole set at every tier', () => {
    const happy = cardFor('HAPPY')!;
    const hard = hardestOpenPlay(happy);
    expect(hard.play).toHaveLength(3);
    expect(new Set(hard.play).size).toBe(3);
    expect(hard.play.some((id) => clue(id).kind === 'number')).toBe(true);
    expect(hard.chance).toBeLessThanOrEqual(1);
    expect(hardestOpenPlay(happy)).toEqual(hard);
    expect(STINGIEST_OPEN_PLAY.every((id) => clue(id).kind === 'number')).toBe(true);
    for (const tier of ['easy', 'medium', 'hard']) {
      const a = allAI(3, tier, 5, { openHand: true });
      expect(a.history).toHaveLength(3);
      expect(a.history).toEqual(allAI(3, tier, 5, { openHand: true }).history);
    }
    allAI(2, 'hard', 6, { openHand: true, bribe: true });
  });
});

describe('The House', () => {
  it('makes the AI seat the debauchee every round, with the table as one team', () => {
    const s = createState(seats(3, [0]), { seed: 7, house: true });
    expect(s.phase).toBe('choose_word');
    expect(s.settings.house).toBe('ann');
    expect(s.settings.tiles).toBe('table');
    expect(s.debaucheeOrder).toEqual(['ann']);
    expect(s.round!.debauchee).toBe('ann');
    expect(s.round!.guessers).toEqual(['ben', 'cat']);
    expect(s.settings.rounds).toBe(6);
    let t = createState(seats(3, [0]), { seed: 7, house: true, tiles: 'server', rounds: 2 });
    t = toBuild(t);
    const first = spell(t, secret(t).synonyms[0]!);
    expect(first.summary).toContain('Ann is the house and stays debauchee');
    expect(first.summary).toContain('Scores: the house (Ann) 0, the table');
    expect(first.state.round!.debauchee).toBe('ann');
    expect(first.state.round!.number).toBe(2);
    let u = toBuild(first.state);
    while (u.phase !== 'game_over') {
      const id = activeSeatId(u);
      u = applyMove(u, id, id === 'ann' ? chooseAIMove(u, id, 'medium', 1) : { type: 'call_reveal' }).newState;
    }
    expect(u.scores.ben).toBe(u.scores.cat);
    const team = u.scores.ben!;
    const house = u.scores.ann!;
    expect(u.winners).toEqual(house > team ? ['ann'] : team > house ? ['ben', 'cat'] : ['ann', 'ben', 'cat']);
    expect(describeNextStep(u).instruction).toMatch(/The house wins|The table beats the house|tie/);
  });

  it('needs an AI seat, refuses a different first debauchee, and still forces server tiles for AI guessers', () => {
    expect(() => createState(seats(3), { seed: 7, house: true })).toThrow(/needs an AI seat/);
    expect(() => createState(seats(3, [0]), { seed: 7, house: true, firstDebauchee: 'ben' })).toThrow(/leave firstDebauchee out/);
    expect(createState(seats(3, [0]), { seed: 7, house: true, firstDebauchee: 'ann' }).round!.debauchee).toBe('ann');
    expect(createState(seats(3, [0, 1]), { seed: 7, house: true }).settings.tiles).toBe('server');
    expect(() => createState(seats(3, [0, 1]), { seed: 7, house: true, tiles: 'table' })).toThrow(/AI seat that guesses/);
    const all = allAI(3, 'medium', 4, { house: true });
    expect(all.history.every((h) => h.debauchee === 'ann')).toBe(true);
  });

  it('goes through the seam with no setup step and a house line in the physical setup', () => {
    const session = wordDebauchee.createSession(
      [{ player_id: 'h', kind: 'ai', name: 'The House', difficulty: 'hard' }, { player_id: 'p1', kind: 'human', name: 'Zeke' }, { player_id: 'p2', kind: 'human', name: 'Sam' }],
      { seed: 3, house: true },
    );
    expect(wordDebauchee.getSetupChecklist(session)).toEqual([]);
    expect(wordDebauchee.describeNextStep(session)?.status).toBe('ai_to_move');
    expect(wordDebauchee.getPhysicalSetup(session).some((step) => step.text.includes('The House: The House (the AI) is the debauchee every round'))).toBe(true);
    expect(wordDebauchee.getChoiceCatalog().find((c) => c.id === 'variants')?.resolvedBy).toContain('options.house');
    expect(wordDebauchee.getRulesText()).toContain('The House (the house option)');
  });
});
