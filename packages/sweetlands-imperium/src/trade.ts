// Sweetlands Imperium — trading Intel cards in for one card of a color you
// pick (`discard_for_color`). Shared by the engine and the move list so both
// agree on which colors can be handed over.
//
// Zeke's ruling (T45, 2026-11-13): the card you take is a real card from the
// deck or the discard pile. When no one-color card of that color is left in
// either, that color is not offered. The game never makes up a card.

import type { IntelCard, SpaceColor, SweetlandsState } from './types.js';

const isColor = (color: SpaceColor) => (c: IntelCard): boolean => c.kind === 'single' && c.color === color;

/** Whether a one-color card of `color` is left to take once the `traded`
 *  cards are traded in. The traded cards go to the discard pile first,
 *  so one of them counts too. */
export function colorCardLeft(state: SweetlandsState, color: SpaceColor, traded: readonly IntelCard[]): boolean {
  const has = isColor(color);
  return state.intelDeck.some(has) || state.intelDiscard.some(has) || traded.some(has);
}
