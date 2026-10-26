// Word Debauchee — the session state. Canonical design: PLAN.md in this
// package; rules/rules.md is the rule.
//
// HIDDEN from everyone but the debauchee (and so from every other seat's
// view): the three dealt word cards, the chosen word, the clue hand, and the
// order of the decks. Everything else is what the table can see.

import type { ClueId } from './data/clues.js';

export type TilesMode = 'table' | 'server';
export type TimerMode = 'laps' | 'sand';

export type Phase =
  | 'choose_word' // the debauchee picks one of three dealt words
  | 'play_clues' // the debauchee plays three of four clue cards
  | 'answer_clues' // a human debauchee answers the judgment clues played
  | 'build' // the guessers build
  | 'reveal' // a reveal is owed: the debauchee picks the letter
  | 'game_over';

export interface WordDebaucheeOptions {
  /** RNG seed: decks and the first debauchee. Random if omitted. */
  seed?: number;
  /** Who holds the tiles. `table` (default): the table's own tiles, checks trusted as
   *  declared. `server`: the pool and build area are tracked here, one tile per turn.
   *  Forced to `server` when any seat is an AI. */
  tiles?: TilesMode;
  /** `laps` (default): a reveal each time the turn comes back round to the first
   *  guesser. `sand`: the table runs the 30-second timer and reports it. */
  timer?: TimerMode;
  /** With one guesser, laps are one turn long, so a reveal comes every this many
   *  tiles instead (default 5). */
  tilesPerReveal?: number;
  /** Rounds in the game. Default: once round the table with 5–8 players, twice with 2–4. */
  rounds?: number;
  /** Seat id of the first debauchee. Default: random. */
  firstDebauchee?: string;
}

export interface Settings {
  tiles: TilesMode;
  timer: TimerMode;
  tilesPerReveal: number;
  rounds: number;
}

export interface Seat {
  id: string;
  name: string;
  ai: boolean;
}

export interface PlayedClue {
  card: ClueId;
  /** Null until a human debauchee has answered a judgment clue. */
  answer: string | number | null;
}

export interface CheckRecord {
  by: string;
  word: string;
  yes: boolean;
}

export type Outcome = 'cracked' | 'stumped';

export interface RoundResult {
  number: number;
  debauchee: string;
  word: string;
  outcome: Outcome;
  synonym: string | null;
  revealed: number;
  payouts: Record<string, number>;
}

export interface Round {
  number: number;
  debauchee: string;
  /** HIDDEN. The three word cards dealt. */
  dealtWords: string[];
  /** HIDDEN until the round ends. */
  word: string | null;
  /** HIDDEN. The four clue cards dealt; three are played. */
  hand: ClueId[];
  played: PlayedClue[];
  /** Letters of the secret word laid face up, in reveal order. */
  revealed: string[];
  /** Words said aloud by a guesser, lower case: they cannot score this round. */
  burned: string[];
  checks: CheckRecord[];
  /** Turn order, clockwise from the debauchee's left. */
  guessers: string[];
  /** `server` tiles only: whose turn, and turns since the last reveal (laps). */
  turnIndex: number;
  turnsSinceReveal: number;
  /** `server` tiles only: the build area, one string of touching tiles per row. */
  buildArea: string[];
  /** `server` tiles only: tiles left in the pool, by letter. */
  pool: Record<string, number>;
  /** `server` tiles only: the last tile move, so its player may still call "Check!". */
  lastTouched: { by: string; row: number } | null;
}

export interface WordDebaucheeState {
  seed: number;
  settings: Settings;
  seats: Seat[];
  scores: Record<string, number>;
  /** HIDDEN. Headwords, top of the deck first. */
  wordDeck: string[];
  /** HIDDEN. Top of each clue deck first. */
  numberDeck: ClueId[];
  wordClueDeck: ClueId[];
  /** Seat ids in debauchee order, starting with the first debauchee. */
  debaucheeOrder: string[];
  roundsPlayed: number;
  round: Round | null;
  history: RoundResult[];
  phase: Phase;
  turn: number;
  winners: string[] | null;
}
