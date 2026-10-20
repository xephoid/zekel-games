// Sweetlands Imperium — Intel deck composition.
//
// Source: SWEETLANDS-RULES.md §1. 80 cards = 60 single-color (10 each of the 6
// colors) + 12 double-color + 8 treat (one per treat location). The shared deck
// is built once, shuffled by the engine, and server-owned (report-draw pattern).
//
// Double cards are SAME-color (designer-confirmed): two of each color (RR, OO, YY,
// GG, BB, PP) = 12. A double lets you take that color's move+action TWICE.

import type { IntelCard } from '../types.js';
import { COLOR_SEQUENCE, type TreatId } from './board.js';

export const SINGLE_COPIES_PER_COLOR = 10; // 6 * 10 = 60
export const DOUBLE_COPIES_PER_COLOR = 2; // 6 colors * 2 = 12

export const ALL_TREATS: TreatId[] = [
  'milkshake', 'fudge', 'jellybean', 'cheesecake',
  'ice_cream', 'chocolate_bar', 'gummy_bear', 'cupcake',
];

/** Build the full 80-card Intel deck (unshuffled, with stable unique ids). */
export function buildIntelDeck(): IntelCard[] {
  const deck: IntelCard[] = [];
  for (const color of COLOR_SEQUENCE) {
    for (let i = 0; i < SINGLE_COPIES_PER_COLOR; i++) {
      deck.push({ cardId: `single-${color}-${i}`, kind: 'single', color });
    }
  }
  for (const color of COLOR_SEQUENCE) {
    for (let i = 0; i < DOUBLE_COPIES_PER_COLOR; i++) {
      deck.push({ cardId: `double-${color}-${i}`, kind: 'double', color });
    }
  }
  for (const treat of ALL_TREATS) {
    deck.push({ cardId: `treat-${treat}`, kind: 'treat', treat });
  }
  return deck;
}

export const INTEL_DECK_SIZE = 80;
