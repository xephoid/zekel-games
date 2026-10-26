// Setup, dealing, scoring, and the start and end of a round (rules.md
// "Setup", "A round", "Scoring", "Winning").

import { clue, clueDeck, type ClueId } from '../data/clues.js';
import { CARDS } from '../data/deck.js';
import { freshPool } from '../data/tiles.js';
import { pick, randomSeed, shuffle } from '../rng.js';
import type { Outcome, Round, RoundResult, Seat, Settings, WordDebaucheeOptions, WordDebaucheeState } from '../types.js';
import { RuleError } from './errors.js';
import { listNames, nameOf } from './helpers.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const WORDS_DEALT = 3;
export const CLUES_DEALT_PER_DECK = 2;
export const CLUES_PLAYED = 3;
export const DEFAULT_TILES_PER_REVEAL = 5;
/** Cracked: each guesser scores at least this much. */
export const MIN_CRACK_PAYOUT = 1;

export function defaultRounds(seats: number): number {
  return seats >= 5 ? seats : seats * 2;
}

function invalidOptions(message: string): never {
  throw new RuleError('INVALID_OPTIONS', message);
}

export function settingsFrom(seats: Seat[], options: WordDebaucheeOptions | undefined): Settings {
  const anyAI = seats.some((s) => s.ai);
  const tiles = options?.tiles ?? (anyAI ? 'server' : 'table');
  if (tiles !== 'table' && tiles !== 'server') invalidOptions(`tiles must be "table" or "server", not "${String(tiles)}".`);
  if (anyAI && tiles === 'table') invalidOptions('An AI seat needs the server to hold the tiles: set tiles to "server" or leave it out.');
  const timer = options?.timer ?? 'laps';
  if (timer !== 'laps' && timer !== 'sand') invalidOptions(`timer must be "laps" or "sand", not "${String(timer)}".`);
  const tilesPerReveal = options?.tilesPerReveal ?? DEFAULT_TILES_PER_REVEAL;
  if (!Number.isInteger(tilesPerReveal) || tilesPerReveal < 1) invalidOptions('tilesPerReveal must be a whole number of at least 1.');
  const rounds = options?.rounds ?? defaultRounds(seats.length);
  if (!Number.isInteger(rounds) || rounds < 1) invalidOptions('rounds must be a whole number of at least 1.');
  return { tiles, timer, tilesPerReveal, rounds };
}

export function createState(seats: Seat[], options?: WordDebaucheeOptions): WordDebaucheeState {
  if (seats.length < MIN_PLAYERS || seats.length > MAX_PLAYERS) {
    throw new RuleError('INVALID_PLAYERS', `Word Debauchee is for ${MIN_PLAYERS} to ${MAX_PLAYERS} players; got ${seats.length}.`);
  }
  if (new Set(seats.map((s) => s.id)).size !== seats.length) throw new RuleError('INVALID_PLAYERS', 'Seat ids must be unique.');
  const settings = settingsFrom(seats, options);
  const seed = options?.seed ?? randomSeed();
  let s = seed;
  const words = shuffle(CARDS.map((c) => c.word), s);
  s = words.nextSeed;
  const numbers = shuffle(clueDeck('number'), s);
  s = numbers.nextSeed;
  const wordClues = shuffle(clueDeck('word'), s);
  s = wordClues.nextSeed;
  let firstIndex: number;
  if (options?.firstDebauchee !== undefined) {
    firstIndex = seats.findIndex((x) => x.id === options.firstDebauchee);
    if (firstIndex < 0) invalidOptions(`firstDebauchee "${options.firstDebauchee}" is not a seat.`);
  } else {
    const p = pick(seats, s);
    s = p.nextSeed;
    firstIndex = seats.indexOf(p.value);
  }
  const debaucheeOrder = seats.map((_, i) => seats[(firstIndex + i) % seats.length]!.id);
  const state: WordDebaucheeState = {
    seed,
    settings,
    seats,
    scores: Object.fromEntries(seats.map((x) => [x.id, 0])),
    wordDeck: words.items,
    numberDeck: numbers.items,
    wordClueDeck: wordClues.items,
    debaucheeOrder,
    roundsPlayed: 0,
    round: null,
    history: [],
    phase: 'choose_word',
    turn: 0,
    winners: null,
  };
  startRound(state);
  return state;
}

/** Deal the next round: three word cards and two clue cards from each deck to
 *  the next debauchee; the guessers follow clockwise from the debauchee's left. */
export function startRound(state: WordDebaucheeState): void {
  const n = state.seats.length;
  const debauchee = state.debaucheeOrder[state.roundsPlayed % n]!;
  const at = state.seats.findIndex((x) => x.id === debauchee);
  const guessers: string[] = [];
  for (let i = 1; i < n; i++) guessers.push(state.seats[(at + i) % n]!.id);
  const dealtWords = state.wordDeck.splice(0, WORDS_DEALT);
  const hand: ClueId[] = [...state.numberDeck.splice(0, CLUES_DEALT_PER_DECK), ...state.wordClueDeck.splice(0, CLUES_DEALT_PER_DECK)];
  const round: Round = {
    number: state.roundsPlayed + 1,
    debauchee,
    dealtWords,
    word: null,
    hand,
    played: [],
    revealed: [],
    burned: [],
    checks: [],
    guessers,
    turnIndex: 0,
    turnsSinceReveal: 0,
    buildArea: [],
    pool: state.settings.tiles === 'server' ? freshPool() : {},
    lastTouched: null,
  };
  state.round = round;
  state.phase = 'choose_word';
}

/** The scoring table. Stumped: the debauchee scores the word's letters.
 *  Cracked: every guesser scores the synonym's letters minus the tiles
 *  revealed, at least 1; the debauchee scores nothing. */
export function payouts(outcome: Outcome, word: string, synonym: string | null, revealed: number, debauchee: string, guessers: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (outcome === 'stumped') {
    out[debauchee] = word.length;
    for (const g of guessers) out[g] = 0;
  } else {
    out[debauchee] = 0;
    const each = Math.max(MIN_CRACK_PAYOUT, (synonym ?? '').length - revealed);
    for (const g of guessers) out[g] = each;
  }
  return out;
}

/** Score the round, put the clue cards back under their decks, and either
 *  deal the next round or end the game. Returns the lines for the summary. */
export function endRound(state: WordDebaucheeState, outcome: Outcome, synonym: string | null): string[] {
  const r = state.round!;
  const word = r.word!;
  const result: RoundResult = {
    number: r.number,
    debauchee: r.debauchee,
    word,
    outcome,
    synonym,
    revealed: r.revealed.length,
    payouts: payouts(outcome, word, synonym, r.revealed.length, r.debauchee, r.guessers),
  };
  for (const [id, n] of Object.entries(result.payouts)) state.scores[id] = (state.scores[id] ?? 0) + n;
  state.history.push(result);
  // The three played cards go under their decks (the buried fourth already did).
  for (const id of r.hand) (clue(id).kind === 'number' ? state.numberDeck : state.wordClueDeck).push(id);
  state.roundsPlayed++;

  const lines: string[] = [];
  const guessersNamed = listNames(r.guessers.map((g) => nameOf(state, g)));
  if (outcome === 'stumped') {
    lines.push(`The last letter is down: the word was ${word}. ${guessersNamed} ${r.guessers.length === 1 ? 'is' : 'are'} stumped. ${nameOf(state, r.debauchee)} scores ${word.length}.`);
  } else {
    const each = result.payouts[r.guessers[0]!]!;
    lines.push(
      `Cracked with ${synonym!.toUpperCase()} after ${r.revealed.length} reveal${r.revealed.length === 1 ? '' : 's'}: ` +
        `${guessersNamed} score${r.guessers.length === 1 ? 's' : ''} ${each} each. The word was ${word}. ${nameOf(state, r.debauchee)} scores 0.`,
    );
  }
  lines.push(`Scores: ${state.seats.map((x) => `${x.name} ${state.scores[x.id]}`).join(', ')}.`);

  if (state.roundsPlayed >= state.settings.rounds) {
    state.round = null;
    state.phase = 'game_over';
    const best = Math.max(...Object.values(state.scores));
    state.winners = state.seats.filter((x) => state.scores[x.id] === best).map((x) => x.id);
    lines.push(
      state.winners.length === 1
        ? `Game over. ${nameOf(state, state.winners[0]!)} wins with ${best}.`
        : `Game over. ${listNames(state.winners.map((w) => nameOf(state, w)))} share the win with ${best}.`,
    );
  } else {
    startRound(state);
    lines.push(`Every tile goes back to the pool. ${nameOf(state, state.round!.debauchee)} is the next debauchee and draws three word cards.`);
  }
  return lines;
}
