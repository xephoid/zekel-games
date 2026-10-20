import type { CardRank, CardSuit, PlayingCard } from '../types.js';

// The player's own 52-card deck (jokers removed; WR §1, §8). The server tracks
// COMPOSITION only — ids like "7S" — to validate report_card_draw.

export const CARD_RANKS: readonly CardRank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];
export const CARD_SUITS: readonly CardSuit[] = ['hearts', 'diamonds', 'spades', 'clubs'];

const SUIT_LETTER: Record<CardSuit, string> = {
  hearts: 'H',
  diamonds: 'D',
  spades: 'S',
  clubs: 'C',
};

export function cardId(card: PlayingCard): string {
  return `${card.rank}${SUIT_LETTER[card.suit]}`;
}

export function cardName(card: PlayingCard): string {
  const rankNames: Record<CardRank, string> = {
    A: 'Ace', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
    '8': '8', '9': '9', '10': '10', J: 'Jack', Q: 'Queen', K: 'King',
  };
  return `${rankNames[card.rank]} of ${card.suit.charAt(0).toUpperCase()}${card.suit.slice(1)}`;
}

/** All 52 card ids, rank-major (AH, 2H, ... KC). */
export function fullDeckIds(): string[] {
  const ids: string[] = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) ids.push(cardId({ rank, suit }));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// resolveCardName — the "accept the printed name" rule for report_card_draw.
// Accepts: "7♠", "7S", "7 of spades", "seven of spades", "QH", "Q♥",
// "queen of hearts", "10D", "ten of diamonds", case/spacing/punctuation
// tolerant. Returns null (never a guess) when unparseable.
// ---------------------------------------------------------------------------

const RANK_WORDS: Record<string, CardRank> = {
  a: 'A', ace: 'A', '1': 'A',
  '2': '2', two: '2', deuce: '2',
  '3': '3', three: '3',
  '4': '4', four: '4',
  '5': '5', five: '5',
  '6': '6', six: '6',
  '7': '7', seven: '7',
  '8': '8', eight: '8',
  '9': '9', nine: '9',
  '10': '10', ten: '10', t: '10',
  j: 'J', jack: 'J',
  q: 'Q', queen: 'Q',
  k: 'K', king: 'K',
};

const SUIT_WORDS: Record<string, CardSuit> = {
  h: 'hearts', heart: 'hearts', hearts: 'hearts', '♥': 'hearts', '♡': 'hearts',
  d: 'diamonds', diamond: 'diamonds', diamonds: 'diamonds', '♦': 'diamonds', '♢': 'diamonds',
  s: 'spades', spade: 'spades', spades: 'spades', '♠': 'spades', '♤': 'spades',
  c: 'clubs', club: 'clubs', clubs: 'clubs', '♣': 'clubs', '♧': 'clubs',
};

export function resolveCardName(input: string): PlayingCard | null {
  const raw = input.trim().toLowerCase();
  if (raw.length === 0) return null;

  // Suit glyph anywhere ("7♠", "♠7").
  for (const glyph of ['♥', '♡', '♦', '♢', '♠', '♤', '♣', '♧']) {
    if (raw.includes(glyph)) {
      const suit = SUIT_WORDS[glyph]!;
      const rankPart = raw.replace(glyph, '').replace(/[^a-z0-9]/g, '');
      const rank = RANK_WORDS[rankPart];
      return rank ? { rank, suit } : null;
    }
  }

  // "<rank> of <suit>" (words or digits, punctuation-tolerant).
  const ofMatch = /^([a-z0-9]+)\s*(?:of)?\s*(hearts?|diamonds?|spades?|clubs?)$/.exec(
    raw.replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim(),
  );
  if (ofMatch) {
    const rank = RANK_WORDS[ofMatch[1]!];
    const suit = SUIT_WORDS[ofMatch[2]!];
    return rank && suit ? { rank, suit } : null;
  }

  // Compact "7s" / "10d" / "qh" / "as".
  const compact = raw.replace(/[^a-z0-9]/g, '');
  const compactMatch = /^(10|[a2-9jqkt])([hdsc])$/.exec(compact);
  if (compactMatch) {
    const rank = RANK_WORDS[compactMatch[1]!];
    const suit = SUIT_WORDS[compactMatch[2]!];
    return rank && suit ? { rank, suit } : null;
  }

  return null;
}
