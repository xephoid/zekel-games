// The candidate solver (PORT-PLAN.md §7): which cards of the deck fit the clues
// played and the letters revealed so far. The AI debauchee runs it against
// itself to find the stingiest play; the AI guessers run it to pick a
// synonym to spell. It reads the deck, never the secret word.

import { clue, type ClueId } from '../data/clues.js';
import { CARDS } from '../data/deck.js';
import type { Card } from '../data/wordCard.js';
import { letterCounts } from '../engine/helpers.js';
import type { PlayedClue } from '../types.js';

/** A clue as the table heard it. */
export interface HeardClue {
  card: ClueId;
  answer: string | number;
}

export function heard(played: readonly PlayedClue[]): HeardClue[] {
  return played.filter((p): p is PlayedClue & { answer: string | number } => p.answer !== null).map((p) => ({ card: p.card, answer: p.answer }));
}

function same(a: string | number, b: string | number): boolean {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

/** Every revealed letter is in the word, as many times as revealed. */
export function fitsRevealed(card: Card, revealed: readonly string[]): boolean {
  if (revealed.length === 0) return true;
  if (revealed.length > card.letters) return false;
  const have = letterCounts(card.word);
  for (const [ch, n] of letterCounts(revealed.join(''))) if ((have.get(ch) ?? 0) < n) return false;
  return true;
}

export function fitsClue(card: Card, c: HeardClue): boolean {
  return same(clue(c.card).answer(card), c.answer);
}

/** Cards consistent with every clue and the revealed letters. A human debauchee
 *  answers judgment clues in their own words, which may not match the card's
 *  printed answer, so when nothing fits the judgment clues are dropped, then
 *  the rest, so the result is never empty. */
export function candidates(clues: readonly HeardClue[], revealed: readonly string[]): Card[] {
  const strict = clues;
  const facts = clues.filter((c) => !clue(c.card).judgment);
  for (const set of [strict, facts, []]) {
    const out = CARDS.filter((card) => fitsRevealed(card, revealed) && set.every((c) => fitsClue(card, c)));
    if (out.length > 0) return out;
  }
  return [...CARDS];
}

/** How many cards would fit if these clues were played on this word. */
export function candidateCount(clues: readonly HeardClue[], revealed: readonly string[]): number {
  return candidates(clues, revealed).length;
}

/** The clues a card would answer for the given cards. */
export function answersFor(card: Card, ids: readonly ClueId[]): HeardClue[] {
  return ids.map((id) => ({ card: id, answer: clue(id).answer(card) }));
}

/** How a solver-guesser would fare: the share of candidates that list the
 *  most-shared synonym, i.e. the chance that spelling the best target scores.
 *  The hard debauchee keeps this low; the hard guesser spells that target. */
export function crackChance(clues: readonly HeardClue[], revealed: readonly string[]): { chance: number; count: number; target: string | null } {
  const cands = candidates(clues, revealed);
  let target: string | null = null;
  let best = 0;
  for (const [s, n] of synonymWeights(cands)) {
    if (n > best || (n === best && target !== null && s < target)) {
      best = n;
      target = s;
    }
  }
  return { chance: cands.length ? best / cands.length : 0, count: cands.length, target };
}

/** Synonyms the candidates share, weighted by how many candidates list each. */
export function synonymWeights(cands: readonly Card[]): Map<string, number> {
  const w = new Map<string, number>();
  for (const c of cands) for (const s of c.synonyms) w.set(s, (w.get(s) ?? 0) + 1);
  return w;
}
