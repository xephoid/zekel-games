import { describe, expect, it } from 'vitest';
import { TEMPLE_TYPES } from '../data/magicItems.js';
import { isRiddleAnswerCorrect, normaliseAnswer, RIDDLES } from '../data/riddles.js';

describe('temple riddles', () => {
  it('has one riddle per temple with at least one answer', () => {
    for (const t of TEMPLE_TYPES) {
      expect(RIDDLES[t].temple).toBe(t);
      expect(RIDDLES[t].text.length).toBeGreaterThan(20);
      expect(RIDDLES[t].answers.length).toBeGreaterThan(0);
    }
  });

  it('accepts answers loosely: case, punctuation, leading articles', () => {
    expect(isRiddleAnswerCorrect('earth', 'MEMLAX!')).toBe(true);
    expect(isRiddleAnswerCorrect('earth', 'It is Memlax.')).toBe(true);
    expect(isRiddleAnswerCorrect('sky', 'A boot')).toBe(true);
    expect(isRiddleAnswerCorrect('sky', 'the winged boots')).toBe(true);
    expect(isRiddleAnswerCorrect('fire', 'Five')).toBe(true);
    expect(isRiddleAnswerCorrect('fire', '5')).toBe(true);
    expect(isRiddleAnswerCorrect('light', 'Love')).toBe(true);
    expect(isRiddleAnswerCorrect('space', 'Chineera')).toBe(true);
  });

  it('rejects wrong answers', () => {
    expect(isRiddleAnswerCorrect('earth', 'Chineera')).toBe(false);
    expect(isRiddleAnswerCorrect('space', 'Memlax')).toBe(false);
    expect(isRiddleAnswerCorrect('fire', 'seven')).toBe(false);
    expect(isRiddleAnswerCorrect('sky', '')).toBe(false);
  });

  it('normalises predictably', () => {
    expect(normaliseAnswer('  The   BOOT. ')).toBe('boot');
    expect(normaliseAnswer("It's love")).toBe('love');
  });
});
