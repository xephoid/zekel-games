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

function flag(options: WordDebaucheeOptions | undefined, key: 'bribe' | 'openHand' | 'house'): boolean {
  const v = options?.[key];
  if (v !== undefined && typeof v !== 'boolean') invalidOptions(`${key} must be true or false.`);
  return v === true;
}

export function settingsFrom(seats: Seat[], options: WordDebaucheeOptions | undefined): Settings {
  const bribe = flag(options, 'bribe');
  const openHand = flag(options, 'openHand');
  let house: string | null = null;
  if (flag(options, 'house')) {
    const ai = seats.find((s) => s.ai);
    if (!ai) invalidOptions('The House needs an AI seat to be the house.');
    house = ai.id;
  }
  // An AI guesser needs the server to hold the tiles; the house only ever listens.
  const aiGuesser = seats.some((s) => s.ai && s.id !== house);
  const tiles = options?.tiles ?? (aiGuesser ? 'server' : 'table');
  if (tiles !== 'table' && tiles !== 'server') invalidOptions(`tiles must be "table" or "server", not "${String(tiles)}".`);
  if (aiGuesser && tiles === 'table') invalidOptions('An AI seat that guesses needs the server to hold the tiles: set tiles to "server" or leave it out.');
  const timer = options?.timer ?? 'laps';
  if (timer !== 'laps' && timer !== 'sand') invalidOptions(`timer must be "laps" or "sand", not "${String(timer)}".`);
  const tilesPerReveal = options?.tilesPerReveal ?? DEFAULT_TILES_PER_REVEAL;
  if (!Number.isInteger(tilesPerReveal) || tilesPerReveal < 1) invalidOptions('tilesPerReveal must be a whole number of at least 1.');
  const rounds = options?.rounds ?? defaultRounds(seats.length);
  if (!Number.isInteger(rounds) || rounds < 1) invalidOptions('rounds must be a whole number of at least 1.');
  return { tiles, timer, tilesPerReveal, rounds, bribe, openHand, house };
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
  const state: WordDebaucheeState = {
    seed,
    settings,
    seats,
    scores: Object.fromEntries(seats.map((x) => [x.id, 0])),
    wordDeck: words.items,
    numberDeck: numbers.items,
    wordClueDeck: wordClues.items,
    debaucheeOrder: [],
    roundsPlayed: 0,
    round: null,
    history: [],
    phase: 'setup',
    turn: 0,
    winners: null,
  };
  if (settings.house) {
    // The House: the house is the debauchee every round; nobody to ask.
    if (options?.firstDebauchee !== undefined && resolveSeat(seats, options.firstDebauchee)?.id !== settings.house) {
      invalidOptions('Under The House the house is the debauchee every round; leave firstDebauchee out.');
    }
    state.debaucheeOrder = [settings.house];
    startRound(state);
  } else if (options?.firstDebauchee !== undefined) {
    const first = resolveSeat(seats, options.firstDebauchee);
    if (!first) invalidOptions(`firstDebauchee "${options.firstDebauchee}" is not a seat.`);
    setFirstDebauchee(state, first.id);
  } else if (seats.every((x) => x.ai)) {
    // No human to ask: the server draws.
    setFirstDebauchee(state, pick(seats, s).value.id);
  }
  // Otherwise the table says who most recently got away with something (choose_first_debauchee).
  return state;
}

/** A seat by id or by name, in any case. */
export function resolveSeat(seats: readonly Seat[], text: string): Seat | undefined {
  const want = String(text).trim().toLowerCase();
  return seats.find((x) => x.id.toLowerCase() === want) ?? seats.find((x) => x.name.trim().toLowerCase() === want);
}

/** Fix the debauchee order from the first debauchee and deal the first round. */
export function setFirstDebauchee(state: WordDebaucheeState, firstId: string): void {
  const seats = state.seats;
  const firstIndex = seats.findIndex((x) => x.id === firstId);
  state.debaucheeOrder = seats.map((_, i) => seats[(firstIndex + i) % seats.length]!.id);
  startRound(state);
}

/** Deal the next round: three word cards and two clue cards from each deck to
 *  the next debauchee; the guessers follow clockwise from the debauchee's left. */
export function startRound(state: WordDebaucheeState): void {
  const n = state.seats.length;
  const debauchee = state.debaucheeOrder[state.roundsPlayed % state.debaucheeOrder.length]!;
  const at = state.seats.findIndex((x) => x.id === debauchee);
  const guessers: string[] = [];
  for (let i = 1; i < n; i++) guessers.push(state.seats[(at + i) % n]!.id);
  const dealtWords = state.wordDeck.splice(0, WORDS_DEALT);
  // Open hand: no deal; the debauchee takes any three cards from the whole set.
  const hand: ClueId[] = state.settings.openHand ? [] : [...state.numberDeck.splice(0, CLUES_DEALT_PER_DECK), ...state.wordClueDeck.splice(0, CLUES_DEALT_PER_DECK)];
  const round: Round = {
    number: state.roundsPlayed + 1,
    debauchee,
    dealtWords,
    word: null,
    hand,
    played: [],
    revealed: [],
    bribed: [],
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
 *  revealed (a bribed clue counts as one), at least 1; the debauchee scores nothing. */
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
    bribes: r.bribed.length,
    payouts: payouts(outcome, word, synonym, r.revealed.length + r.bribed.length, r.debauchee, r.guessers),
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
    const bribes = r.bribed.length ? ` and ${r.bribed.length} bribed clue${r.bribed.length === 1 ? '' : 's'}` : '';
    lines.push(
      `Cracked with ${synonym!.toUpperCase()} after ${r.revealed.length} reveal${r.revealed.length === 1 ? '' : 's'}${bribes}: ` +
        `${guessersNamed} score${r.guessers.length === 1 ? 's' : ''} ${each} each. The word was ${word}. ${nameOf(state, r.debauchee)} scores 0.`,
    );
  }
  lines.push(scoreLine(state));

  if (state.roundsPlayed >= state.settings.rounds) {
    state.round = null;
    state.phase = 'game_over';
    state.winners = winners(state);
    const best = state.scores[state.winners[0]!]!;
    if (state.settings.house) {
      const house = nameOf(state, state.settings.house);
      const team = state.scores[state.seats.find((x) => x.id !== state.settings.house)!.id]!;
      const houseScore = state.scores[state.settings.house]!;
      lines.push(
        houseScore > team ? `Game over. The house wins, ${houseScore} to ${team}.`
          : team > houseScore ? `Game over. The table beats ${house}, ${team} to ${houseScore}.`
            : `Game over. The table and the house tie at ${team}.`,
      );
    } else {
      lines.push(
        state.winners.length === 1
          ? `Game over. ${nameOf(state, state.winners[0]!)} wins with ${best}.`
          : `Game over. ${listNames(state.winners.map((w) => nameOf(state, w)))} share the win with ${best}.`,
      );
    }
  } else {
    startRound(state);
    const next = nameOf(state, state.round!.debauchee);
    lines.push(`Every tile goes back to the pool. ${state.settings.house ? `${next} is the house and stays debauchee; they draw` : `${next} is the next debauchee and draws`} three word cards.`);
  }
  return lines;
}

/** "Scores: Ann 4, Ben 2, Cat 2." Under The House: the house against the table. */
export function scoreLine(state: WordDebaucheeState): string {
  const house = state.settings.house;
  if (house) {
    const team = state.seats.find((x) => x.id !== house)!;
    return `Scores: the house (${nameOf(state, house)}) ${state.scores[house]}, the table ${state.scores[team.id]}.`;
  }
  return `Scores: ${state.seats.map((x) => `${x.name} ${state.scores[x.id]}`).join(', ')}.`;
}

/** Highest total wins; ties share. Under The House the people are one team:
 *  all of them win, or the house does, or everyone shares a tie. */
export function winners(state: WordDebaucheeState): string[] {
  const best = Math.max(...Object.values(state.scores));
  return state.seats.filter((x) => state.scores[x.id] === best).map((x) => x.id);
}
