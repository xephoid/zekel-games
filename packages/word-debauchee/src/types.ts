// Word Debauchee — the session state. Canonical design: PLAN.md in this
// package; rules/rules.md is the rule.
//
// Who holds the truth, and who may see it (building-a-game.md, "Physical-first"):
//
// | Zone                         | Truth held by | Seen by                 |
// |------------------------------|---------------|-------------------------|
// | Word deck (500 cards)        | Server        | Nobody (order hidden)   |
// | The three dealt words        | Server        | The debauchee only      |
// | The chosen word, its card    | Server        | The debauchee only, until the round ends |
// | Number and word clue decks   | Server        | Nobody (order hidden)   |
// | The clue hand of four        | Server        | The debauchee only      |
// | Clues played and answered    | Server        | Everyone                |
// | Bribed clues (Bribe variant) | Server        | Everyone                |
// | Revealed letters, burned words, checks, scores | Server | Everyone     |
// | Tiles: pool and build area   | The table (`tiles: table`) or the server (`tiles: server`) | Everyone |
//
// There is no private human-held zone: the only hidden things are dealt by
// the server to the debauchee's seat and shown in that seat's view alone.

import type { ClueId } from './data/clues.js';

export type TilesMode = 'table' | 'server';
export type TimerMode = 'laps' | 'sand';

export type Phase =
  | 'setup' // a human names the first debauchee
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
  /** Bribe variant: a guesser who calls "Reveal!" may take a clue from either deck
   *  instead of a letter; it counts as a revealed tile for scoring. */
  bribe?: boolean;
  /** Open hand variant: no clue deal; the debauchee plays any three clue cards from
   *  the whole set, at least one of them a number clue. */
  openHand?: boolean;
  /** The House variant: the AI seat is the debauchee every round and the people
   *  score as one team against it. Needs an AI seat; the tiles may be the table's. */
  house?: boolean;
}

export interface Settings {
  tiles: TilesMode;
  timer: TimerMode;
  tilesPerReveal: number;
  rounds: number;
  bribe: boolean;
  openHand: boolean;
  /** The House: the seat id of the house, or null when the variant is off. */
  house: string | null;
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
  /** Bribe variant: clues taken instead of letters; each counts as a reveal. */
  bribes: number;
  payouts: Record<string, number>;
}

export interface Round {
  number: number;
  debauchee: string;
  /** HIDDEN. The three word cards dealt. */
  dealtWords: string[];
  /** HIDDEN until the round ends. */
  word: string | null;
  /** HIDDEN. The four clue cards dealt; three are played (none dealt under Open
   *  hand). Once played, every card the round holds, so they return to their decks. */
  hand: ClueId[];
  played: PlayedClue[];
  /** Letters of the secret word laid face up, in reveal order. */
  revealed: string[];
  /** Bribe variant: clues taken instead of letters, in order; each counts as a reveal. */
  bribed: ClueId[];
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
  /** Seat ids in debauchee order, starting with the first debauchee. Empty
   *  during setup, until a human names the first debauchee. */
  debaucheeOrder: string[];
  roundsPlayed: number;
  round: Round | null;
  history: RoundResult[];
  phase: Phase;
  turn: number;
  winners: string[] | null;
}
