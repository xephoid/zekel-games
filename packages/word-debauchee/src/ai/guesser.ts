// The AI guessers (PORT-PLAN.md §7). An AI guesser cannot hear hints or give
// them: it plays the deck. It keeps the cards that fit the clues and the
// revealed letters, picks a synonym those cards share, spells it one tile a
// turn (continuing a row that is already a prefix of it), checks on the tile
// that completes it, and decides when a reveal is worth the point it costs.
// It never reads the secret word or the debauchee's hand.

import { CLUES, clue, type ClueKind } from '../data/clues.js';
import { LETTERS } from '../data/tiles.js';
import { letterCounts, unrevealedLetters } from '../engine/helpers.js';
import type { WordDebaucheeMove } from '../engine/moves.js';
import { getLegalMoves } from '../legalMoves.js';
import { pick, randomInt } from '../rng.js';
import type { Round, WordDebaucheeState } from '../types.js';
import { quietestLetter, type Tier } from './debauchee.js';
import { candidates, crackChance, heard, synonymWeights, type HeardClue } from './solver.js';

/** Medium calls "Reveal!" when more cards than this still fit. */
export const MEDIUM_REVEAL_THRESHOLD = 40;
/** Hard estimates the next reveal over at most this many candidate cards. */
const REVEAL_SAMPLE = 30;
/** Hard estimates a bribed clue (every card of a deck, per candidate) over at most this many. */
const BRIBE_SAMPLE = 12;

export interface Target {
  /** Upper case, as the tiles spell it. */
  word: string;
  /** Cards among the candidates that list it. */
  weight: number;
  /** The row already spelling a prefix of it (the longest), or null. */
  row: number | null;
  /** Letters already down on that row. */
  progress: number;
  /** True when a row already spells the whole word (unchecked). */
  complete: boolean;
}

/** Words that cannot score this round: burned, or already answered "no". */
function dead(r: Round): Set<string> {
  const out = new Set(r.burned.map((w) => w.toUpperCase()));
  for (const c of r.checks) if (!c.yes) out.add(c.word.toUpperCase());
  return out;
}

/** The longest row that is a prefix of `word` (not the whole word). */
function prefixRow(r: Round, word: string): { row: number; length: number } | null {
  let best: { row: number; length: number } | null = null;
  r.buildArea.forEach((text, row) => {
    if (text.length < word.length && word.startsWith(text) && (!best || text.length > best.length)) best = { row, length: text.length };
  });
  return best;
}

/** True when the pool holds the letters still needed. */
function spellable(r: Round, word: string, progress: number): boolean {
  for (const [ch, n] of letterCounts(word.slice(progress))) if ((r.pool[ch] ?? 0) < n) return false;
  return true;
}

/** Every synonym the candidates share that can still be spelled, with where it stands on the table. */
export function targetsFor(r: Round, clues: readonly HeardClue[]): { targets: Target[]; count: number } {
  const cands = candidates(clues, r.revealed);
  const gone = dead(r);
  const targets: Target[] = [];
  for (const [syn, weight] of synonymWeights(cands)) {
    const word = syn.toUpperCase();
    if (gone.has(word)) continue;
    const complete = r.buildArea.includes(word);
    const prefix = prefixRow(r, word);
    const progress = prefix?.length ?? 0;
    if (!complete && !spellable(r, word, progress)) continue;
    targets.push({ word, weight, row: prefix?.row ?? null, progress, complete });
  }
  return { targets, count: cands.length };
}

/** Reveals still to come before this target is done: a reveal comes every
 *  lap, and the guessers lay one tile each per lap on the same row (the
 *  check lands on the completing tile, before that lap's reveal). */
function revealsBefore(state: WordDebaucheeState, t: Target): number {
  const remaining = t.word.length - t.progress;
  if (remaining <= 0) return 0;
  const perLap = state.round!.guessers.length;
  return Math.max(0, Math.ceil(remaining / perLap) - 1);
}

/** What a target would pay if the word is on the list: letters minus reveals
 *  so far and still to come, at least 1. `extraReveals` prices a reveal
 *  called now. */
function payoutIf(state: WordDebaucheeState, t: Target, extraReveals = 0): number {
  const r = state.round!;
  return Math.max(1, t.word.length - r.revealed.length - r.bribed.length - extraReveals - revealsBefore(state, t));
}

/** A shared synonym already complete on the table costs one action to check,
 *  so medium and hard take it before spelling anything new. */
function completeFirst(a: Target, b: Target): number {
  return Number(b.complete) - Number(a.complete);
}

function rankMedium(a: Target, b: Target): number {
  return completeFirst(a, b) || b.weight - a.weight || a.word.length - b.word.length || a.word.localeCompare(b.word);
}

function rankHard(state: WordDebaucheeState, count: number) {
  const value = (t: Target) => (t.weight / count) * payoutIf(state, t);
  return (a: Target, b: Target) => completeFirst(a, b) || value(b) - value(a) || b.weight - a.weight || a.word.length - b.word.length || a.word.localeCompare(b.word);
}

/** The next tile toward a target: continue its prefix row, or start a new row.
 *  Checks when the tile completes the word. A complete, unchecked row is
 *  re-completed by moving its last tile into place, which lets this player check it. */
function tileToward(t: Target): WordDebaucheeMove {
  if (t.complete) {
    const row = t.row ?? -1;
    return { type: 'move', row, index: t.word.length - 1, to_row: row, to_index: t.word.length - 1, check: true };
  }
  const letter = t.word[t.progress]!;
  const last = t.progress === t.word.length - 1;
  if (t.row === null) return last ? { type: 'place', letter, check: true } : { type: 'place', letter };
  return last ? { type: 'place', letter, row: t.row, check: true } : { type: 'place', letter, row: t.row };
}

function completeRow(r: Round, word: string): number {
  return r.buildArea.indexOf(word);
}

/** The expected value of the best target after one more thing is known:
 *  the chance it scores times what it would pay, one reveal dearer. */
function valueAfter(state: WordDebaucheeState, clues: readonly HeardClue[], revealed: readonly string[]): number {
  const r = state.round!;
  const next = crackChance(clues, revealed);
  if (!next.target) return 0;
  const word = next.target.toUpperCase();
  const prefix = prefixRow(r, word);
  const target: Target = { word, weight: 0, row: prefix?.row ?? null, progress: prefix?.length ?? 0, complete: r.buildArea.includes(word) };
  return next.chance * payoutIf(state, target, 1);
}

/** What a letter reveal is expected to be worth, over a sample of candidate
 *  cards, each revealing what a careful debauchee would. */
function letterValue(state: WordDebaucheeState, clues: readonly HeardClue[]): number {
  const r = state.round!;
  const cands = candidates(clues, r.revealed).slice(0, REVEAL_SAMPLE);
  if (cands.length === 0) return 0;
  let after = 0;
  for (const c of cands) {
    const left = unrevealedLetters({ ...r, word: c.word });
    if (left.size === 0) continue;
    after += valueAfter(state, clues, [...r.revealed, quietestLetter(left)]);
  }
  return after / cands.length;
}

/** Bribe: what the top card of a clue deck is expected to be worth. The deck's
 *  order is hidden, so every card of that kind is weighed by its printed copies
 *  less the copies already on the table. */
function bribeValue(state: WordDebaucheeState, clues: readonly HeardClue[], kind: ClueKind): number {
  const r = state.round!;
  const cands = candidates(clues, r.revealed).slice(0, BRIBE_SAMPLE);
  if (cands.length === 0) return 0;
  const onTable = new Map<string, number>();
  for (const p of r.played) onTable.set(p.card, (onTable.get(p.card) ?? 0) + 1);
  const deck = CLUES.filter((c) => c.kind === kind).map((c) => ({ id: c.id, weight: Math.max(0, c.copies - (onTable.get(c.id) ?? 0)) })).filter((c) => c.weight > 0);
  const total = deck.reduce((a, c) => a + c.weight, 0);
  if (total === 0) return 0;
  let after = 0;
  for (const c of cands) {
    for (const d of deck) after += (d.weight / total) * valueAfter(state, [...clues, { card: d.id, answer: clue(d.id).answer(c) }], r.revealed);
  }
  return after / cands.length;
}

/** Hard: is a reveal worth its point, and under Bribe, is a clue worth more
 *  than a letter? Returns the call, or null when building beats both. */
function bestReveal(state: WordDebaucheeState, clues: readonly HeardClue[], best: Target | undefined, count: number): WordDebaucheeMove | null {
  if (best && best.progress > 0) return null;
  const now = best ? (best.weight / count) * payoutIf(state, best) : 0;
  const options: { move: WordDebaucheeMove; value: number }[] = [{ move: { type: 'call_reveal' }, value: letterValue(state, clues) }];
  if (state.settings.bribe) {
    for (const kind of ['number', 'word'] as const) {
      const deck = kind === 'number' ? state.numberDeck : state.wordClueDeck;
      if (deck.length) options.push({ move: { type: 'call_reveal', clue: kind }, value: bribeValue(state, clues, kind) });
    }
  }
  options.sort((a, b) => b.value - a.value);
  const top = options[0]!;
  return top.value > now ? top.move : null;
}

/** Medium under Bribe: take a clue of the kind the table has heard least. */
function bribeHeardLeast(r: Round): ClueKind {
  const numbers = r.played.filter((p) => clue(p.card).kind === 'number').length;
  return numbers < r.played.length - numbers ? 'number' : 'word';
}

export function chooseGuesserMove(state: WordDebaucheeState, playerId: string, tier: Tier, seed: number): WordDebaucheeMove {
  const r = state.round;
  if (!r || state.phase !== 'build') throw new Error(`${playerId} has no guesser move in phase ${state.phase}`);
  if (state.settings.tiles !== 'server') throw new Error('An AI guesser needs server-held tiles.');
  if (r.guessers[r.turnIndex] !== playerId) throw new Error(`It is not ${playerId}'s turn`);
  const clues = heard(r.played);
  const { targets, count } = targetsFor(r, clues);
  for (const t of targets) if (t.complete) t.row = completeRow(r, t.word);

  if (tier === 'easy') {
    // The floor: uniformly random over the legal moves (never a report, never a fill-in).
    const legal = getLegalMoves(state, playerId).filter((m) => m.move.type !== 'burn' && m.move.type !== 'timer_out' && !JSON.stringify(m.move).includes('<'));
    if (legal.length === 0) return anyTile(r, seed);
    return legal[randomInt(seed, legal.length).value]!.move;
  }

  const ranked = [...targets].sort(tier === 'medium' ? rankMedium : rankHard(state, count));
  const best = ranked[0];
  if (tier === 'medium') {
    if (count > MEDIUM_REVEAL_THRESHOLD && !(best && best.progress > 0)) {
      return state.settings.bribe ? { type: 'call_reveal', clue: bribeHeardLeast(r) } : { type: 'call_reveal' };
    }
  } else {
    const call = bestReveal(state, clues, best, count);
    if (call) return call;
  }
  if (best) return tileToward(best);
  return { type: 'call_reveal' };
}

/** Nothing can be spelled: lay any tile the pool still has. */
function anyTile(r: Round, seed: number): WordDebaucheeMove {
  const have = LETTERS.filter((l) => (r.pool[l] ?? 0) > 0);
  if (have.length === 0) return { type: 'call_reveal' };
  return { type: 'place', letter: pick(have, seed).value };
}
