// A word card (rules.md, "A word card"): the facts the debauchee answers clue
// cards from, and the synonym list that referees every "Check!". The 500
// cards live in rules/words.csv and are generated into words.ts; this file
// holds the shape and the card facts that are rules rather than data.

export const WORD_TYPES = ['Noun', 'Verb', 'Adjective', 'Adverb'] as const;
export type WordType = (typeof WORD_TYPES)[number];

export const CATEGORIES = [
  'Feelings', 'Actions', 'People', 'Places', 'Things', 'Nature',
  'Body', 'Food', 'Size & Amount', 'Time', 'Speech', 'Qualities',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const REGISTERS = ['formal', 'everyday', 'slang'] as const;
export type Register = (typeof REGISTERS)[number];

export interface WordCard {
  /** Upper case, letters only: the word as the tiles spell it. */
  readonly word: string;
  readonly letters: number;
  /** A, E, I, O and U are vowels; Y is a consonant (rules.md). */
  readonly vowels: number;
  readonly consonants: number;
  readonly syllables: number;
  readonly type: WordType;
  readonly category: Category;
  /** The US school grade the word is usually taught in, 1–12. */
  readonly grade: number;
  /** Lower case. A spelled word scores if and only if it is here. */
  readonly synonyms: readonly string[];
  /** Judgment clues, a generated first pass to check at the table (PLAN.md Q4). */
  readonly opposite: string | null;
  readonly goesWith: string;
  readonly rhymesWith: string | null;
  readonly register: Register;
}

/** Difficulty dots on the card: 1 = ●○○, 2 = ●●○, 3 = ●●●. */
export type Difficulty = 1 | 2 | 3;

/** A word card with its difficulty worked out against the deck (deck.ts). */
export interface Card extends WordCard {
  readonly difficulty: Difficulty;
}

export const VOWELS = 'AEIOU';

export function isVowel(letter: string): boolean {
  return VOWELS.includes(letter.toUpperCase());
}

export function countVowels(word: string): number {
  let n = 0;
  for (const ch of word) if (isVowel(ch)) n++;
  return n;
}

/** The difficulty printed on the card, from the headword's own grade and
 *  synonym count (PLAN.md Q12: the design notes' rule needs a grade for
 *  every synonym, which the deck does not have). ●●●: grade 5 or more, or
 *  fewer than four synonyms; ●○○: grade 1–2; ●●○ otherwise. */
export function difficultyOf(card: WordCard): Difficulty {
  if (card.grade >= 5 || card.synonyms.length < 4) return 3;
  if (card.grade <= 2) return 1;
  return 2;
}

export function difficultyDots(d: Difficulty): string {
  return '●'.repeat(d) + '○'.repeat(3 - d);
}
