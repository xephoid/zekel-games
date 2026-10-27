// One move is one action (PORT-PLAN.md §4). Letters are upper case; words may be
// sent in any case.

import type { ClueId } from '../data/clues.js';

export type WordDebaucheeMove =
  /** Setup, any human seat: who most recently got away with something (a seat id or name). */
  | { type: 'choose_first_debauchee'; player: string }
  /** Debauchee: keep one of the three dealt words; the other two go under the deck. */
  | { type: 'choose_word'; word: string }
  /** Debauchee: play three of the four clue cards in hand (Open hand: any three
   *  from the whole set, at least one a number clue). */
  | { type: 'play_clues'; cards: ClueId[] }
  /** Human debauchee: answer a judgment clue in their own words, or with the card's
   *  answer when `text` is omitted. */
  | { type: 'answer_clue'; card: ClueId; text?: string }
  /** Guesser, `server` tiles: one tile from the pool into the build area. A new row
   *  when `row` is omitted; at the end of the row when `index` is omitted. `check`
   *  calls "Check!" on the row the tile completes. A row is its number or the letters
   *  it reads ("GLA"), as the summaries name it. */
  | { type: 'place'; letter: string; row?: number | string; index?: number; check?: boolean }
  /** Guesser, `server` tiles: move one tile in the build area to another spot
   *  (`to_row` a row index or 'new'), or back to the pool when `to_row` is omitted. */
  | { type: 'move'; row: number | string; index: number; to_row?: number | 'new' | string; to_index?: number; check?: boolean }
  /** Guesser: "Check!". `server` tiles: a row you just completed. `table` tiles: the
   *  word on the table, trusted as declared. */
  | { type: 'check'; word?: string; row?: number | string }
  /** Guesser, on your turn: "Reveal!" instead of acting. Bribe variant: `clue`
   *  takes the top card of that clue deck instead of a letter. */
  | { type: 'call_reveal'; clue?: 'number' | 'word' }
  /** Anyone, any time: a guesser said this word aloud; it cannot score this round. */
  | { type: 'burn'; word: string }
  /** Anyone: the sand ran out (`sand` timer), or at a table with its own tiles, the
   *  turn came back round to the first guesser. */
  | { type: 'timer_out' }
  /** Debauchee: lay one letter of the secret word face up. The tile comes from the
   *  pool; when the pool has none of that letter, `row` says which build-area row to
   *  take it from (server-held tiles; needed only when more than one row has it). */
  | { type: 'reveal'; letter: string; row?: number | string };

export type MoveType = WordDebaucheeMove['type'];

export const MOVE_TYPES: readonly MoveType[] = [
  'choose_first_debauchee', 'choose_word', 'play_clues', 'answer_clue', 'place', 'move', 'check', 'call_reveal', 'burn', 'timer_out', 'reveal',
];
