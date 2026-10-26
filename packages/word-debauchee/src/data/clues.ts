// The 48 clue cards (rules.md, appendix): 20 number clues and 28 word clues,
// each naming one thing the debauchee must tell the table. Every card
// answers itself from the card facts except the four judgment clues, which
// read the card's generated answer (a human debauchee may answer those in
// their own words instead).

import { isVowel, type Card } from './wordCard.js';

export type ClueKind = 'number' | 'word';

export type NumberClueId =
  | 'letters' | 'vowels' | 'consonants' | 'syllables' | 'grade' | 'difficulty'
  | 'repeats' | 'first_vowel' | 'shortest_synonym' | 'longest_synonym';

export type WordClueId =
  | 'category' | 'type' | 'first_letter' | 'last_letter' | 'opens_with' | 'double_letter'
  | 'half_alphabet' | 'odd_or_even' | 'rhymes_with' | 'opposite' | 'register' | 'goes_with';

export type ClueId = NumberClueId | WordClueId;

export interface ClueCard {
  readonly id: ClueId;
  readonly kind: ClueKind;
  /** The name printed on the card. */
  readonly name: string;
  /** How many copies are in the deck. */
  readonly copies: number;
  /** What the debauchee says, in the rules' words. */
  readonly prompt: string;
  /** True for the four clues a debauchee answers from judgment rather than facts. */
  readonly judgment: boolean;
  /** The truthful answer for this card. */
  answer(card: Card): string | number;
}

function repeats(word: string): number {
  const counts = new Map<string, number>();
  for (const ch of word) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let n = 0;
  for (const c of counts.values()) if (c > 1) n++;
  return n;
}

function firstVowelPosition(word: string): number | 'none' {
  for (let i = 0; i < word.length; i++) if (isVowel(word[i]!)) return i + 1;
  return 'none';
}

function hasDoubleLetter(word: string): boolean {
  for (let i = 1; i < word.length; i++) if (word[i] === word[i - 1]) return true;
  return false;
}

const shortest = (c: Card) => Math.min(...c.synonyms.map((s) => s.length));
const longest = (c: Card) => Math.max(...c.synonyms.map((s) => s.length));

export const NUMBER_CLUES: readonly ClueCard[] = [
  { id: 'letters', kind: 'number', name: 'Letters', copies: 4, prompt: 'how many letters', judgment: false, answer: (c) => c.letters },
  { id: 'vowels', kind: 'number', name: 'Vowels', copies: 3, prompt: 'how many of A E I O U', judgment: false, answer: (c) => c.vowels },
  { id: 'consonants', kind: 'number', name: 'Consonants', copies: 3, prompt: 'how many consonants', judgment: false, answer: (c) => c.consonants },
  { id: 'syllables', kind: 'number', name: 'Syllables', copies: 2, prompt: 'how many syllables', judgment: false, answer: (c) => c.syllables },
  { id: 'grade', kind: 'number', name: 'Grade', copies: 2, prompt: 'the school grade on the card, 1–12', judgment: false, answer: (c) => c.grade },
  { id: 'difficulty', kind: 'number', name: 'Difficulty', copies: 2, prompt: 'the difficulty on the card, 1–3', judgment: false, answer: (c) => c.difficulty },
  { id: 'repeats', kind: 'number', name: 'Repeats', copies: 1, prompt: 'how many different letters appear more than once', judgment: false, answer: (c) => repeats(c.word) },
  { id: 'first_vowel', kind: 'number', name: 'First vowel', copies: 1, prompt: 'the position of the first vowel', judgment: false, answer: (c) => firstVowelPosition(c.word) },
  { id: 'shortest_synonym', kind: 'number', name: 'Shortest synonym', copies: 1, prompt: 'letters in the shortest word on the synonym list', judgment: false, answer: shortest },
  { id: 'longest_synonym', kind: 'number', name: 'Longest synonym', copies: 1, prompt: 'letters in the longest word on the synonym list', judgment: false, answer: longest },
];

export const WORD_CLUES: readonly ClueCard[] = [
  { id: 'category', kind: 'word', name: 'Category', copies: 4, prompt: 'the category on the card', judgment: false, answer: (c) => c.category },
  { id: 'type', kind: 'word', name: 'Type', copies: 4, prompt: 'noun, verb, adjective or adverb', judgment: false, answer: (c) => c.type.toLowerCase() },
  { id: 'first_letter', kind: 'word', name: 'First letter', copies: 2, prompt: 'the first letter', judgment: false, answer: (c) => c.word[0]! },
  { id: 'last_letter', kind: 'word', name: 'Last letter', copies: 2, prompt: 'the last letter', judgment: false, answer: (c) => c.word[c.word.length - 1]! },
  { id: 'opens_with', kind: 'word', name: 'Opens with', copies: 2, prompt: 'whether the first letter is a vowel or a consonant', judgment: false, answer: (c) => (isVowel(c.word[0]!) ? 'vowel' : 'consonant') },
  { id: 'double_letter', kind: 'word', name: 'Double letter', copies: 2, prompt: 'whether two of the same letter sit side by side', judgment: false, answer: (c) => (hasDoubleLetter(c.word) ? 'yes' : 'no') },
  { id: 'half_alphabet', kind: 'word', name: 'Half the alphabet', copies: 2, prompt: 'whether the first letter is in A–M or N–Z', judgment: false, answer: (c) => (c.word[0]! <= 'M' ? 'A–M' : 'N–Z') },
  { id: 'odd_or_even', kind: 'word', name: 'Odd or even', copies: 2, prompt: 'whether the letter count is odd or even', judgment: false, answer: (c) => (c.letters % 2 ? 'odd' : 'even') },
  { id: 'rhymes_with', kind: 'word', name: 'Rhymes with', copies: 2, prompt: 'any real word that rhymes with it and is not on the synonym list, or "nothing rhymes"', judgment: true, answer: (c) => c.rhymesWith ?? 'nothing rhymes' },
  { id: 'opposite', kind: 'word', name: 'Opposite', copies: 2, prompt: 'a word that means the opposite', judgment: true, answer: (c) => c.opposite ?? 'it has no opposite' },
  { id: 'register', kind: 'word', name: 'Register', copies: 2, prompt: 'formal, everyday or slang', judgment: true, answer: (c) => c.register },
  { id: 'goes_with', kind: 'word', name: 'Goes with', copies: 2, prompt: 'a word that often sits right before or after it', judgment: true, answer: (c) => c.goesWith },
];

export const CLUES: readonly ClueCard[] = [...NUMBER_CLUES, ...WORD_CLUES];

const byId = new Map<ClueId, ClueCard>(CLUES.map((c) => [c.id, c]));

export function clue(id: ClueId): ClueCard {
  const c = byId.get(id);
  if (!c) throw new Error(`no clue card "${id}"`);
  return c;
}

/** A clue card by id or by the name printed on it, in any case ("Letters",
 *  "shortest synonym", "half_alphabet"); undefined when nothing matches. */
export function clueByName(text: string): ClueCard | undefined {
  const want = String(text).trim().toLowerCase().replace(/[\s-]+/g, '_');
  return CLUES.find((c) => c.id === want || c.name.toLowerCase().replace(/[\s-]+/g, '_') === want);
}

/** One deck's cards, copies expanded, in appendix order (shuffle before dealing). */
export function clueDeck(kind: ClueKind): ClueId[] {
  const out: ClueId[] = [];
  for (const c of kind === 'number' ? NUMBER_CLUES : WORD_CLUES) {
    for (let i = 0; i < c.copies; i++) out.push(c.id);
  }
  return out;
}
