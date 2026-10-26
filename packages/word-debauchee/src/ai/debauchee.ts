// The AI debauchee (PLAN.md §6): give away as little as possible. Three
// tiers. easy: random word, first three cards, random letter. medium: the
// word that reveals slowest against its shortest synonym, bury the gift
// card, reveal the letters that say least. hard: run the guesser solver
// against itself and keep the candidate set as large as it can.

import { CLUES, clue, type ClueId } from '../data/clues.js';
import { CARDS, cardFor } from '../data/deck.js';
import type { Card } from '../data/wordCard.js';
import { unrevealedLetters } from '../engine/helpers.js';
import type { WordDebaucheeMove } from '../engine/moves.js';
import { CLUES_PLAYED } from '../engine/round.js';
import { pick, randomInt } from '../rng.js';
import type { WordDebaucheeState } from '../types.js';
import { answersFor, crackChance, heard } from './solver.js';

export type Tier = 'easy' | 'medium' | 'hard';

export function tierOf(difficulty: string | undefined): Tier {
  switch (difficulty) {
    case 'easy':
    case 'random':
    case undefined:
      return 'easy';
    case 'medium':
      return 'medium';
    default:
      return 'hard';
  }
}

/** Clue cards from the most giving to the most stingy: the order a medium
 *  debauchee buries them in. */
export const GIFT_ORDER: readonly ClueId[] = [
  'shortest_synonym', 'first_letter', 'last_letter', 'goes_with', 'opposite', 'longest_synonym', 'rhymes_with',
  'category', 'type', 'first_vowel', 'repeats', 'half_alphabet', 'opens_with', 'double_letter', 'register',
  'difficulty', 'grade', 'odd_or_even', 'syllables', 'consonants', 'vowels', 'letters',
];

/** Letters in English frequency order: an E says less than a Z. */
const FREQUENCY = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';

function giftRank(id: ClueId): number {
  return GIFT_ORDER.indexOf(id);
}

/** Every valid play of three from the hand: at least one number and one word
 *  clue (always true for a two-and-two hand). Distinct by card ids. */
export function validPlays(hand: readonly ClueId[]): ClueId[][] {
  const out: ClueId[][] = [];
  const seen = new Set<string>();
  for (let drop = 0; drop < hand.length; drop++) {
    const cards = hand.filter((_, i) => i !== drop);
    if (cards.length !== CLUES_PLAYED) continue;
    const key = [...cards].sort().join('+');
    if (seen.has(key)) continue;
    seen.add(key);
    const kinds = new Set(cards.map((c) => clue(c).kind));
    if (kinds.has('number') && kinds.has('word')) out.push(cards);
  }
  return out;
}

/** The medium tier's word score: long words reveal slowly, short synonyms crack fast. */
function slowness(card: Card): number {
  return card.letters + Math.min(...card.synonyms.map((s) => s.length));
}

/** The medium tier's play: bury the most giving card. */
function stingiestPlay(hand: readonly ClueId[]): ClueId[] {
  const plays = validPlays(hand);
  let best = plays[0]!;
  let bestGift = Infinity;
  for (const p of plays) {
    const buried = buriedFrom(hand, p);
    const g = giftRank(buried);
    if (g < bestGift) {
      best = p;
      bestGift = g;
    }
  }
  return best;
}

function buriedFrom(hand: readonly ClueId[], play: readonly ClueId[]): ClueId {
  const left = [...hand];
  for (const id of play) left.splice(left.indexOf(id), 1);
  return left[0]!;
}

/** The medium tier's reveal: the commonest letter first, and a letter with
 *  more copies still to come before one with a single copy. */
export function quietestLetter(left: Map<string, number>): string {
  let best = '';
  let bestScore = -Infinity;
  for (const [ch, n] of left) {
    const score = (26 - FREQUENCY.indexOf(ch)) + (n > 1 ? 10 : 0);
    if (score > bestScore) {
      best = ch;
      bestScore = score;
    }
  }
  return best;
}

/** The hard tier's play: the three cards that leave a solver-guesser the
 *  lowest chance of a scoring target; more candidates, then the medium tier's
 *  gift order, break ties. (Against the deck, Category and Type together give
 *  away more than Shortest synonym does: PLAN.md §6.) */
export function hardestPlay(card: Card, hand: readonly ClueId[]): { play: ClueId[]; chance: number; count: number } {
  let best: ClueId[] = validPlays(hand)[0]!;
  let bestChance = Infinity;
  let bestCount = -1;
  let bestGift = Infinity;
  for (const p of validPlays(hand)) {
    const { chance, count } = crackChance(answersFor(card, p), []);
    const g = giftRank(buriedFrom(hand, p));
    if (chance < bestChance || (chance === bestChance && (count > bestCount || (count === bestCount && g < bestGift)))) {
      best = p;
      bestChance = chance;
      bestCount = count;
      bestGift = g;
    }
  }
  return { play: best, chance: bestChance, count: bestCount };
}

// ---- Open hand: any three cards from the whole set, at least one a number clue ----

const ALL_IDS: readonly ClueId[] = CLUES.map((c) => c.id);
const NUMBER_IDS: readonly ClueId[] = CLUES.filter((c) => c.kind === 'number').map((c) => c.id);

/** Easy: a random number clue and two other random cards. */
function randomOpenPlay(seed: number): ClueId[] {
  const first = pick(NUMBER_IDS, seed);
  const rest = ALL_IDS.filter((id) => id !== first.value);
  const second = pick(rest, first.nextSeed);
  const third = pick(rest.filter((id) => id !== second.value), second.nextSeed);
  return [first.value, second.value, third.value];
}

/** Medium: the three stingiest cards in the gift order (all number clues). */
export const STINGIEST_OPEN_PLAY: readonly ClueId[] = GIFT_ORDER.slice(-CLUES_PLAYED);

/** Hard: greedy. The card that leaves a solver-guesser the lowest crack
 *  chance, then the next given the first, then the third; the third must be a
 *  number clue when neither of the first two is. (All 1,320 triples would be
 *  the exact answer; greedy is a few dozen solver runs instead.) */
export function hardestOpenPlay(card: Card): { play: ClueId[]; chance: number; count: number } {
  const play: ClueId[] = [];
  let chance = 1;
  let count = CARDS.length;
  for (let k = 0; k < CLUES_PLAYED; k++) {
    const needNumber = k === CLUES_PLAYED - 1 && !play.some((id) => clue(id).kind === 'number');
    let best: ClueId | null = null;
    let bestChance = Infinity;
    let bestCount = -1;
    for (const id of ALL_IDS) {
      if (play.includes(id) || (needNumber && clue(id).kind !== 'number')) continue;
      const next = crackChance(answersFor(card, [...play, id]), []);
      if (next.chance < bestChance || (next.chance === bestChance && (next.count > bestCount || (next.count === bestCount && giftRank(id) > giftRank(best!))))) {
        best = id;
        bestChance = next.chance;
        bestCount = next.count;
      }
    }
    play.push(best!);
    chance = bestChance;
    count = bestCount;
  }
  return { play, chance, count };
}

/** The hard tier's play for this word: from the hand dealt, or under Open hand from the whole set. */
function bestPlay(card: Card, hand: readonly ClueId[], openHand: boolean): { play: ClueId[]; chance: number; count: number } {
  return openHand ? hardestOpenPlay(card) : hardestPlay(card, hand);
}

export function chooseDebaucheeMove(state: WordDebaucheeState, playerId: string, tier: Tier, seed: number): WordDebaucheeMove {
  const r = state.round;
  if (!r || r.debauchee !== playerId) throw new Error(`${playerId} is not the debauchee`);
  const openHand = state.settings.openHand;
  switch (state.phase) {
    case 'choose_word':
      return { type: 'choose_word', word: chooseWord(r.dealtWords.map((w) => cardFor(w)!), r.hand, tier, seed, openHand) };
    case 'play_clues': {
      const card = cardFor(r.word!)!;
      if (openHand) {
        if (tier === 'easy') return { type: 'play_clues', cards: randomOpenPlay(seed) };
        if (tier === 'medium') return { type: 'play_clues', cards: [...STINGIEST_OPEN_PLAY] };
        return { type: 'play_clues', cards: hardestOpenPlay(card).play };
      }
      if (tier === 'easy') return { type: 'play_clues', cards: validPlays(r.hand)[0]! };
      if (tier === 'medium') return { type: 'play_clues', cards: stingiestPlay(r.hand) };
      return { type: 'play_clues', cards: hardestPlay(card, r.hand).play };
    }
    case 'answer_clues': {
      // Never reached for an AI seat (the engine answers from the card), but harmless.
      const pending = r.played.find((p) => p.answer === null)!;
      return { type: 'answer_clue', card: pending.card };
    }
    case 'reveal':
      return { type: 'reveal', letter: chooseLetter(state, tier, seed) };
    default:
      throw new Error(`The debauchee has no move in phase ${state.phase}`);
  }
}

function chooseWord(dealt: Card[], hand: readonly ClueId[], tier: Tier, seed: number, openHand: boolean): string {
  if (tier === 'easy') return pick(dealt, seed).value.word;
  if (tier === 'medium') {
    return [...dealt].sort((a, b) => slowness(b) - slowness(a) || a.synonyms.length - b.synonyms.length || a.word.localeCompare(b.word))[0]!.word;
  }
  // hard: the word whose best play gives a solver-guesser the lowest chance; longer on ties.
  let best = dealt[0]!;
  let bestChance = Infinity;
  for (const card of dealt) {
    const { chance } = bestPlay(card, hand, openHand);
    if (chance < bestChance || (chance === bestChance && card.letters > best.letters)) {
      best = card;
      bestChance = chance;
    }
  }
  return best.word;
}

function chooseLetter(state: WordDebaucheeState, tier: Tier, seed: number): string {
  const r = state.round!;
  const left = unrevealedLetters(r);
  const letters = [...left.keys()].sort();
  if (tier === 'easy') return letters[randomInt(seed, letters.length).value]!;
  if (tier === 'medium') return quietestLetter(left);
  // hard: the letter whose reveal leaves a solver-guesser the lowest chance;
  // more candidates, then the quietest letter, on ties.
  const clues = heard(r.played);
  let best = letters[0]!;
  let bestChance = Infinity;
  let bestCount = -1;
  for (const ch of letters) {
    const { chance, count } = crackChance(clues, [...r.revealed, ch]);
    const quieter = quietestLetter(new Map([[ch, left.get(ch)!], [best, left.get(best)!]])) === ch;
    if (chance < bestChance || (chance === bestChance && (count > bestCount || (count === bestCount && quieter)))) {
      best = ch;
      bestChance = chance;
      bestCount = count;
    }
  }
  return best;
}
