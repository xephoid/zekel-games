// Trading Intel cards in for one card of a color (`discard_for_color`).
// Zeke's ruling (T45, 2026-11-13): the card taken is a real card from the deck
// or the discard pile. A color with no one-color card left in either is not
// offered, and the game never makes up a card.

import { describe, it, expect } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { createInitialState, applyMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { IntelCard, SpaceColor, SweetlandsState } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });
const isColor = (color: SpaceColor) => (c: IntelCard): boolean => c.kind === 'single' && c.color === color;

function totalCards(s: SweetlandsState): number {
  return s.intelDeck.length + s.intelDiscard.length + s.players.reduce((n, p) => n + p.hand.length, 0);
}

/** Player a at the play step, with at least 4 cards and no red one-color card. */
function setUp(): SweetlandsState {
  let s = createInitialState([ai('a'), ai('b')], { seed: 7 });
  s = applyMove(s, 'a', { type: 'recall', units: [] }).newState; // a gains Intel, now at the play step
  const a = s.players[0]!;
  const b = s.players[1]!;
  // Give a's red one-color cards to b, so a's own trade can't hand one back.
  b.hand.push(...a.hand.filter(isColor('red')));
  a.hand = a.hand.filter((c) => !isColor('red')(c));
  // Top a up to 4 cards with non-red cards from the deck.
  while (a.hand.length < 4) {
    const i = s.intelDeck.findIndex((c) => !isColor('red')(c));
    a.hand.push(s.intelDeck.splice(i, 1)[0]!);
  }
  return s;
}

/** Move every red one-color card in the deck and the discard pile into b's hand. */
function emptyRed(s: SweetlandsState): void {
  const b = s.players[1]!;
  b.hand.push(...s.intelDeck.filter(isColor('red')), ...s.intelDiscard.filter(isColor('red')));
  s.intelDeck = s.intelDeck.filter((c) => !isColor('red')(c));
  s.intelDiscard = s.intelDiscard.filter((c) => !isColor('red')(c));
}

const tradeColors = (s: SweetlandsState): string[] =>
  getLegalMoves(s, 'a').filter((m) => m.move.type === 'discard_for_color').map((m) => String((m.move as { color: string }).color));

describe('trading Intel cards in for one color', () => {
  it('takes a real red card while one is left', () => {
    const s = setUp();
    expect(tradeColors(s)).toContain('red');
    const ids = s.players[0]!.hand.slice(0, 4).map((c) => c.cardId);
    const next = applyMove(s, 'a', { type: 'discard_for_color', cardIds: ids, color: 'red' }).newState;
    const got = next.players[0]!.hand.at(-1)!;
    expect(got.kind === 'single' && got.color).toBe('red');
    expect(got.cardId.startsWith('conv-')).toBe(false);
    expect(totalCards(next)).toBe(80);
  });

  it('takes the red card from the discard pile when the deck has none', () => {
    const s = setUp();
    const reds = s.intelDeck.filter(isColor('red'));
    s.intelDeck = s.intelDeck.filter((c) => !isColor('red')(c));
    s.intelDiscard.push(...reds);
    expect(tradeColors(s)).toContain('red');
    const ids = s.players[0]!.hand.slice(0, 4).map((c) => c.cardId);
    const next = applyMove(s, 'a', { type: 'discard_for_color', cardIds: ids, color: 'red' }).newState;
    expect(reds.map((c) => c.cardId)).toContain(next.players[0]!.hand.at(-1)!.cardId);
    expect(totalCards(next)).toBe(80);
  });

  it('does not offer red once no red card is left in the deck or the discard pile', () => {
    const s = setUp();
    emptyRed(s);
    expect(totalCards(s)).toBe(80);
    const colors = tradeColors(s);
    expect(colors).not.toContain('red');
    expect(colors.length).toBe(5); // every other color is still offered
  });

  it('refuses a red trade sent anyway, and changes nothing', () => {
    const s = setUp();
    emptyRed(s);
    const before = JSON.stringify(s);
    const ids = s.players[0]!.hand.slice(0, 4).map((c) => c.cardId);
    expect(() => applyMove(s, 'a', { type: 'discard_for_color', cardIds: ids, color: 'red' })).toThrow(/No red Intel card is left/);
    expect(JSON.stringify(s)).toBe(before);
    expect(totalCards(s)).toBe(80);
  });

  it('counts a red card among the ones traded in, since it goes to the discard pile first', () => {
    const s = setUp();
    emptyRed(s);
    const a = s.players[0]!;
    const b = s.players[1]!;
    const red = b.hand.find(isColor('red'))!;
    b.hand = b.hand.filter((c) => c !== red);
    a.hand.unshift(red); // the first 4 cards, which the listed trade uses, now hold it
    expect(tradeColors(s)).toContain('red');
    const ids = a.hand.slice(0, 4).map((c) => c.cardId);
    const next = applyMove(s, 'a', { type: 'discard_for_color', cardIds: ids, color: 'red' }).newState;
    expect(next.players[0]!.hand.at(-1)!.cardId).toBe(red.cardId);
    expect(totalCards(next)).toBe(80);
  });
});
