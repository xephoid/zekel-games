// The word deck: every card with its difficulty worked out, and lookups the
// engine and the AI share.

import { difficultyOf, type Card, type WordCard } from './wordCard.js';
import { WORDS } from './words.js';

const gradeByWord = new Map<string, number>();
for (const w of WORDS) gradeByWord.set(w.word.toLowerCase(), w.grade);

/** A synonym's grade when it is itself a card in the deck. */
export function gradeOfWord(word: string): number | undefined {
  return gradeByWord.get(word.toLowerCase());
}

function withDifficulty(w: WordCard): Card {
  return { ...w, difficulty: difficultyOf(w) };
}

/** Every word card, in CSV order. */
export const CARDS: readonly Card[] = WORDS.map(withDifficulty);

const cardByWord = new Map<string, Card>();
for (const c of CARDS) cardByWord.set(c.word, c);

export function cardFor(word: string): Card | undefined {
  return cardByWord.get(word.toUpperCase());
}

/** True when `spelled` scores against `card`: it is on the synonym list. */
export function isSynonymOf(card: WordCard, spelled: string): boolean {
  return card.synonyms.includes(spelled.toLowerCase());
}
