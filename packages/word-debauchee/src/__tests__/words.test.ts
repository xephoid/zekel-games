import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CARDS, cardFor, gradeOfWord, isSynonymOf } from '../data/deck.js';
import { CATEGORIES, countVowels, REGISTERS, WORD_TYPES } from '../data/wordCard.js';
import { WORDS } from '../data/words.js';
// @ts-expect-error plain JS, shared with scripts/build-words.mjs
import { parseWordsCsv, renderWordsMd, renderWordsTs } from '../../scripts/words-render.mjs';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const csv = readFileSync(join(pkg, 'rules', 'words.csv'), 'utf8');
const WORD_RE = /^[a-z]+$/;

describe('the word deck', () => {
  it('is 500 cards with unique upper-case headwords', () => {
    expect(WORDS).toHaveLength(500);
    const seen = new Set<string>();
    for (const w of WORDS) {
      expect(w.word).toMatch(/^[A-Z]+$/);
      expect(seen.has(w.word), `duplicate ${w.word}`).toBe(false);
      seen.add(w.word);
    }
  });

  it('has counts that match the word (Y is a consonant)', () => {
    for (const w of WORDS) {
      expect(w.letters, w.word).toBe(w.word.length);
      expect(w.vowels, w.word).toBe(countVowels(w.word));
      expect(w.consonants, w.word).toBe(w.word.length - w.vowels);
      expect(w.syllables, w.word).toBeGreaterThanOrEqual(1);
    }
    expect(cardFor('SHY')?.vowels).toBe(0);
  });

  it('agrees with the counts written in the CSV', () => {
    const drift: string[] = [];
    for (const r of parseWordsCsv(csv) as Array<{ word: string; letters: number; vowels: number; consonants: number; csvLetters: number; csvVowels: number; csvConsonants: number }>) {
      if (r.letters !== r.csvLetters || r.vowels !== r.csvVowels || r.consonants !== r.csvConsonants) drift.push(r.word);
    }
    expect(drift).toEqual([]);
  });

  it('uses the printed types, categories, grades and registers', () => {
    for (const w of WORDS) {
      expect(WORD_TYPES, w.word).toContain(w.type);
      expect(CATEGORIES, w.word).toContain(w.category);
      expect(w.grade, w.word).toBeGreaterThanOrEqual(1);
      expect(w.grade, w.word).toBeLessThanOrEqual(12);
      expect(REGISTERS, w.word).toContain(w.register);
    }
  });

  it('keeps every category at or under 15 % of the deck', () => {
    for (const cat of CATEGORIES) {
      const n = WORDS.filter((w) => w.category === cat).length;
      expect(n / WORDS.length, cat).toBeLessThanOrEqual(0.15);
    }
  });

  it('lists 4 to 10 synonyms, each 3–10 lower-case letters, no headword inside, no repeats', () => {
    for (const w of WORDS) {
      expect(w.synonyms.length, w.word).toBeGreaterThanOrEqual(4);
      expect(w.synonyms.length, w.word).toBeLessThanOrEqual(10);
      expect(new Set(w.synonyms).size, w.word).toBe(w.synonyms.length);
      for (const s of w.synonyms) {
        expect(s, `${w.word}: ${s}`).toMatch(WORD_RE);
        expect(s.length, `${w.word}: ${s}`).toBeGreaterThanOrEqual(3);
        expect(s.length, `${w.word}: ${s}`).toBeLessThanOrEqual(10);
        expect(s.includes(w.word.toLowerCase()), `${w.word}: ${s}`).toBe(false);
      }
    }
  });

  it('has a judgment answer on every card that is not the word or a synonym', () => {
    for (const w of WORDS) {
      const head = w.word.toLowerCase();
      if (w.opposite !== null) {
        expect(w.opposite, w.word).toMatch(WORD_RE);
        expect(w.opposite, w.word).not.toBe(head);
      }
      expect(w.goesWith, w.word).toMatch(WORD_RE);
      expect(w.goesWith, w.word).not.toBe(head);
      expect(w.synonyms, `${w.word} goes with ${w.goesWith}`).not.toContain(w.goesWith);
      if (w.rhymesWith !== null) {
        expect(w.rhymesWith, w.word).toMatch(WORD_RE);
        expect(w.rhymesWith, w.word).not.toBe(head);
        expect(w.synonyms, `${w.word} rhymes with ${w.rhymesWith}`).not.toContain(w.rhymesWith);
      }
    }
  });

  it('is generated from rules/words.csv and up to date (run build:words)', () => {
    const ts = readFileSync(join(pkg, 'src', 'data', 'words.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(ts).toBe(renderWordsTs(csv));
    const md = readFileSync(join(pkg, 'rules', 'words.md'), 'utf8').replace(/\r\n/g, '\n');
    expect(md).toBe(renderWordsMd(csv));
  });
});

describe('cards with difficulty', () => {
  it('judges a spelled word by the synonym list, case-blind', () => {
    const happy = cardFor('happy')!;
    expect(isSynonymOf(happy, 'GLAD')).toBe(true);
    expect(isSynonymOf(happy, 'cheerful')).toBe(true);
    expect(isSynonymOf(happy, 'happy')).toBe(false);
    expect(isSynonymOf(happy, 'sad')).toBe(false);
    expect(gradeOfWord('glad')).toBe(1);
    expect(gradeOfWord('zzz')).toBeUndefined();
  });

  it('spreads the deck across the three difficulties', () => {
    const n = (d: number) => CARDS.filter((c) => c.difficulty === d).length;
    const spread = { easy: n(1), medium: n(2), hard: n(3) };
    // eslint-disable-next-line no-console
    console.log(`difficulty spread: ●○○ ${spread.easy}  ●●○ ${spread.medium}  ●●● ${spread.hard}`);
    expect(spread.easy + spread.medium + spread.hard).toBe(500);
    for (const d of [1, 2, 3]) expect(n(d), `difficulty ${d}`).toBeGreaterThan(0);
    expect(cardFor('MELANCHOLY')?.difficulty).toBe(3);
    expect(cardFor('HAPPY')?.difficulty).toBe(1);
  });
});
