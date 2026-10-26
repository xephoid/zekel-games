import { cardFor } from '../data/deck.js';
import { applyMove } from '../engine/apply.js';
import type { WordDebaucheeMove } from '../engine/moves.js';
import { createState } from '../engine/round.js';
import { getLegalMoves } from '../legalMoves.js';
import type { Seat, WordDebaucheeOptions, WordDebaucheeState } from '../types.js';

export const NAMES = ['Ann', 'Ben', 'Cat', 'Dev', 'Eve', 'Fay', 'Gus', 'Hal'];

export function seats(n: number, ai: number[] = []): Seat[] {
  return NAMES.slice(0, n).map((name, i) => ({ id: name.toLowerCase(), name, ai: ai.includes(i) }));
}

export function start(n: number, options: WordDebaucheeOptions = {}, ai: number[] = []): WordDebaucheeState {
  return createState(seats(n, ai), { seed: 7, firstDebauchee: 'ann', ...options });
}

export function play(state: WordDebaucheeState, by: string, move: WordDebaucheeMove): { state: WordDebaucheeState; summary: string } {
  const r = applyMove(state, by, move);
  return { state: r.newState, summary: r.summary };
}

/** Run the debauchee through word choice and clues with the first legal option
 *  (card answers for judgment clues) so a test can start on the build phase. */
export function toBuild(state: WordDebaucheeState, word?: string): WordDebaucheeState {
  let s = state;
  const deb = s.round!.debauchee;
  if (s.phase === 'choose_word') s = play(s, deb, { type: 'choose_word', word: word ?? s.round!.dealtWords[0]! }).state;
  if (s.phase === 'play_clues') s = play(s, deb, getLegalMoves(s, deb)[0]!.move).state;
  while (s.phase === 'answer_clues') {
    const p = s.round!.played.find((x) => x.answer === null)!;
    s = play(s, deb, { type: 'answer_clue', card: p.card }).state;
  }
  return s;
}

/** The secret word's card, for a test that needs a synonym to spell. */
export function secret(state: WordDebaucheeState) {
  return cardFor(state.round!.word!)!;
}

/** Spell `word` in the build area one tile per turn by whoever is on turn,
 *  calling reveals as the debauchee when owed; checks on the last tile. */
export function spell(state: WordDebaucheeState, word: string): { state: WordDebaucheeState; summary: string } {
  let s = state;
  let summary = '';
  const letters = word.toUpperCase().split('');
  let row: number | undefined;
  for (let i = 0; i < letters.length; i++) {
    if (s.phase === 'reveal') s = play(s, s.round!.debauchee, getLegalMoves(s, s.round!.debauchee)[0]!.move).state;
    if (s.phase !== 'build') break;
    const by = s.round!.guessers[s.round!.turnIndex]!;
    const last = i === letters.length - 1;
    const res = play(s, by, row === undefined ? { type: 'place', letter: letters[i]!, check: last } : { type: 'place', letter: letters[i]!, row, check: last });
    s = res.state;
    summary = res.summary;
    if (row === undefined && s.round) row = s.round.buildArea.length - 1;
  }
  return { state: s, summary };
}
