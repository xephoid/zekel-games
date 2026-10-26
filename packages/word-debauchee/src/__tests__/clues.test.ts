import { describe, expect, it } from 'vitest';
import { CLUES, clue, clueByName, clueDeck, NUMBER_CLUES, WORD_CLUES } from '../data/clues.js';
import { cardFor } from '../data/deck.js';
import type { Card } from '../data/wordCard.js';

const happy = (): Card => cardFor('HAPPY')!;

describe('the clue decks', () => {
  it('are 20 number clues and 28 word clues', () => {
    expect(clueDeck('number')).toHaveLength(20);
    expect(clueDeck('word')).toHaveLength(28);
    expect(NUMBER_CLUES.every((c) => c.kind === 'number')).toBe(true);
    expect(WORD_CLUES.every((c) => c.kind === 'word')).toBe(true);
    expect(new Set(CLUES.map((c) => c.id)).size).toBe(CLUES.length);
  });

  it('mark exactly four cards as judgment clues', () => {
    expect(CLUES.filter((c) => c.judgment).map((c) => c.id).sort()).toEqual(['goes_with', 'opposite', 'register', 'rhymes_with']);
  });

  it('always leave one of each kind among three cards played from two and two', () => {
    const hand = ['number', 'number', 'word', 'word'];
    for (let drop = 0; drop < 4; drop++) {
      const played = hand.filter((_, i) => i !== drop);
      expect(played).toContain('number');
      expect(played).toContain('word');
    }
  });
});

describe('answers for HAPPY, as in the rules appendix', () => {
  const expected: Record<string, string | number> = {
    letters: 5, vowels: 1, consonants: 4, syllables: 2, grade: 1, difficulty: 1,
    repeats: 1, first_vowel: 2, shortest_synonym: 4, longest_synonym: 8,
    category: 'Feelings', type: 'adjective', first_letter: 'H', last_letter: 'Y',
    opens_with: 'consonant', double_letter: 'yes', half_alphabet: 'A–M', odd_or_even: 'odd',
  };
  for (const [id, want] of Object.entries(expected)) {
    it(`${id} → ${want}`, () => {
      expect(clue(id as never).answer(happy())).toBe(want);
    });
  }

  it('reads the judgment clues from the card', () => {
    const h = happy();
    expect(clue('opposite').answer(h)).toBe(h.opposite ?? 'it has no opposite');
    expect(clue('goes_with').answer(h)).toBe(h.goesWith);
    expect(clue('rhymes_with').answer(h)).toBe(h.rhymesWith ?? 'nothing rhymes');
    expect(clue('register').answer(h)).toBe(h.register);
  });
});

describe('edge answers', () => {
  it('SHY has no vowel to point at', () => {
    const shy = cardFor('SHY')!;
    expect(clue('vowels').answer(shy)).toBe(0);
    expect(clue('first_vowel').answer(shy)).toBe('none');
    expect(clue('opens_with').answer(shy)).toBe('consonant');
    expect(clue('half_alphabet').answer(shy)).toBe('N–Z');
  });

  it('counts repeated letters once each', () => {
    expect(clue('repeats').answer(cardFor('EMBARRASSED')!)).toBe(4); // E, A, R, S
    expect(clue('double_letter').answer(cardFor('EMBARRASSED')!)).toBe('yes');
    expect(clue('double_letter').answer(cardFor('SAD')!)).toBe('no');
  });

  it('rejects an unknown card id', () => {
    expect(() => clue('weight' as never)).toThrow();
  });

  it('finds a card by its printed name in any case', () => {
    expect(clueByName('Shortest synonym')?.id).toBe('shortest_synonym');
    expect(clueByName('half the alphabet')?.id).toBe('half_alphabet');
    expect(clueByName('LETTERS')?.id).toBe('letters');
    expect(clueByName('first_vowel')?.id).toBe('first_vowel');
    expect(clueByName('weight')).toBeUndefined();
  });
});
