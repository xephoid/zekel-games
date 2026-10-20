// Temple riddles. The designer's notes left the riddles to be written; these
// five await the designer's review. Each riddle is answerable from
// lore lines townsfolk say (registries.ts LORE_LINES). Answers are matched
// after normalisation (lowercase, punctuation and leading articles stripped)
// and must NEVER appear in a player view.

import type { TempleType } from './magicItems.js';

export interface Riddle {
  temple: TempleType;
  text: string;
  /** Accepted answers, compared after normaliseAnswer(). */
  answers: readonly string[];
}

export const RIDDLES: Readonly<Record<TempleType, Riddle>> = {
  sky: {
    temple: 'sky',
    text:
      'Five of us were forged where nothing grows. One of us was fished from a riverbed by a farmer\'s cousin, ' +
      'who laughed at what he had found. What was it?',
    answers: ['boot', 'boots', 'winged boots', 'the boot', 'a boot', 'winged boot'],
  },
  earth: {
    temple: 'earth',
    text:
      'I was called the kindest wizard who ever lived, until I made a bargain to save my dying wife. ' +
      'Speak my name and the earth will open.',
    answers: ['memlax', 'the wizard memlax', 'wizard memlax'],
  },
  space: {
    temple: 'space',
    text:
      'I loved him even after the demon took him. I did not kill it; I pushed it out, and my followers kept my name alive. ' +
      'Who am I?',
    answers: ['chineera', 'the sorceress chineera', 'sorceress chineera', 'the bride of memlax', 'memlax\'s wife', 'memlax\'s bride'],
  },
  light: {
    temple: 'light',
    text:
      'The demon thought it was a weakness, and a woman proved it was the opposite. ' +
      'Name the strength that beat the demon.',
    answers: ['love', 'her love', 'love for her husband', 'love for memlax'],
  },
  fire: {
    temple: 'fire',
    text:
      'Count the barren places in this region, where not a blade of grass has grown in living memory, ' +
      'and where the old weapons were made. How many?',
    answers: ['5', 'five', 'five places', 'five spots'],
  },
};

export function normaliseAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an|it is|it's|its|i am|im|i'm)\s+/g, '')
    .trim();
}

export function isRiddleAnswerCorrect(temple: TempleType, text: string): boolean {
  const given = normaliseAnswer(text);
  return RIDDLES[temple].answers.some((a) => normaliseAnswer(a) === given);
}
