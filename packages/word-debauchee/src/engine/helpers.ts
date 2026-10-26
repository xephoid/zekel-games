import type { Round, Seat, WordDebaucheeState } from '../types.js';
import { refuse } from './errors.js';

export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function seatById(state: WordDebaucheeState, id: string): Seat {
  const s = state.seats.find((x) => x.id === id);
  if (!s) refuse(`No seat "${id}" in this game.`);
  return s;
}

export function nameOf(state: WordDebaucheeState, id: string): string {
  return state.seats.find((x) => x.id === id)?.name ?? id;
}

export function round(state: WordDebaucheeState): Round {
  if (!state.round) refuse('No round is in progress.');
  return state.round;
}

export function isDebauchee(state: WordDebaucheeState, id: string): boolean {
  return state.round?.debauchee === id;
}

export function isGuesser(state: WordDebaucheeState, id: string): boolean {
  return !!state.round && state.round.guessers.includes(id);
}

/** `server` tiles: the guesser whose turn it is. `table` tiles: the first guesser
 *  stands for the table, since the table keeps its own turn order. */
export function currentGuesser(state: WordDebaucheeState): string {
  const r = round(state);
  return state.settings.tiles === 'server' ? r.guessers[r.turnIndex]! : r.guessers[0]!;
}

/** Whose action the game waits on. */
export function activeSeatId(state: WordDebaucheeState): string {
  switch (state.phase) {
    case 'setup':
      return (state.seats.find((s) => !s.ai) ?? state.seats[0]!).id;
    case 'choose_word':
    case 'play_clues':
    case 'answer_clues':
    case 'reveal':
      return round(state).debauchee;
    case 'build':
      return currentGuesser(state);
    case 'game_over':
      return state.history[state.history.length - 1]?.debauchee ?? state.seats[0]!.id;
  }
}

/** Turns between reveals under the laps timer: one lap of the guessers, or
 *  `tilesPerReveal` when a lap would be a single turn. */
export function turnsPerReveal(state: WordDebaucheeState): number {
  const n = round(state).guessers.length;
  return n === 1 ? state.settings.tilesPerReveal : n;
}

/** "Ben", "Ben and Cat", "Ben, Cat and Dev". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function normaliseWord(word: string): string {
  return word.trim().toUpperCase();
}

export function letterCounts(word: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of word) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

/** Letters of the secret word not yet revealed, with how many of each remain. */
export function unrevealedLetters(r: Round): Map<string, number> {
  const left = letterCounts(r.word ?? '');
  for (const ch of r.revealed) left.set(ch, (left.get(ch) ?? 0) - 1);
  for (const [ch, n] of left) if (n <= 0) left.delete(ch);
  return left;
}
