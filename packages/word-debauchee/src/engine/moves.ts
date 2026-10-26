// One move is one action (PLAN.md §4). Letters are upper case; words may be
// sent in any case.

import type { ClueId } from '../data/clues.js';

export type WordDebaucheeMove =
  /** Debauchee: keep one of the three dealt words; the other two go under the deck. */
  | { type: 'choose_word'; word: string }
  /** Debauchee: play three of the four clue cards in hand. */
  | { type: 'play_clues'; cards: ClueId[] }
  /** Human debauchee: answer a judgment clue in their own words, or with the card's
   *  answer when `text` is omitted. */
  | { type: 'answer_clue'; card: ClueId; text?: string }
  /** Guesser, `server` tiles: one tile from the pool into the build area. A new row
   *  when `row` is omitted; at the end of the row when `index` is omitted. `check`
   *  calls "Check!" on the row the tile completes. */
  | { type: 'place'; letter: string; row?: number; index?: number; check?: boolean }
  /** Guesser, `server` tiles: move one tile in the build area to another spot
   *  (`to_row` a row index or 'new'), or back to the pool when `to_row` is omitted. */
  | { type: 'move'; row: number; index: number; to_row?: number | 'new'; to_index?: number; check?: boolean }
  /** Guesser: "Check!". `server` tiles: a row you just completed. `table` tiles: the
   *  word on the table, trusted as declared. */
  | { type: 'check'; word?: string; row?: number }
  /** Guesser, on your turn: "Reveal!" instead of acting. */
  | { type: 'call_reveal' }
  /** Anyone, any time: a guesser said this word aloud; it cannot score this round. */
  | { type: 'burn'; word: string }
  /** Anyone: the sand ran out (`sand` timer), or at a table with its own tiles, the
   *  turn came back round to the first guesser. */
  | { type: 'timer_out' }
  /** Debauchee: lay one letter of the secret word face up. */
  | { type: 'reveal'; letter: string };

export type MoveType = WordDebaucheeMove['type'];

export const MOVE_TYPES: readonly MoveType[] = [
  'choose_word', 'play_clues', 'answer_clue', 'place', 'move', 'check', 'call_reveal', 'burn', 'timer_out', 'reveal',
];
