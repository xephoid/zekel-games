// Glue: Word Debauchee engine state -> the common comparison shape the rules
// checker reads. This file may know the engine's types; it is a field-by-field
// copy with no interpretation (rules.ts does the rulebook reasoning). The
// checker runs server-side, so the secret word is in the shape: the rules need
// it to judge a check.

import type { VerifyEvent } from '@zekel/dev/verify/exec/types';
import type { WordDebaucheeState } from '../../types.js';

export interface WDVerifyRound {
  number: number;
  debauchee: string;
  guessers: string[];
  dealtWords: string[];
  word: string | null;
  hand: string[];
  played: { card: string; answer: string | number | null }[];
  revealed: string[];
  bribed: string[];
  burned: string[];
  checks: { by: string; word: string; yes: boolean }[];
  turnIndex: number;
  turnsSinceReveal: number;
  buildArea: string[];
  pool: Record<string, number>;
  lastTouched: { by: string; row: number } | null;
}

export interface WDVerifyResult {
  number: number;
  debauchee: string;
  word: string;
  outcome: string;
  synonym: string | null;
  revealed: number;
  bribes: number;
  payouts: Record<string, number>;
}

export interface WDVerifyState {
  phase: string;
  seats: string[];
  ai: Record<string, boolean>;
  settings: { tiles: string; timer: string; tilesPerReveal: number; rounds: number; bribe: boolean; openHand: boolean; house: string | null };
  scores: Record<string, number>;
  roundsPlayed: number;
  wordDeck: number;
  numberDeck: string[];
  wordClueDeck: string[];
  debaucheeOrder: string[];
  round: WDVerifyRound | null;
  history: WDVerifyResult[];
  winners: string[] | null;
}

export function projectWordDebauchee(g: WordDebaucheeState): WDVerifyState {
  const r = g.round;
  return {
    phase: g.phase,
    seats: g.seats.map((s) => s.id),
    ai: Object.fromEntries(g.seats.map((s) => [s.id, s.ai])),
    settings: { ...g.settings },
    scores: { ...g.scores },
    roundsPlayed: g.roundsPlayed,
    wordDeck: g.wordDeck.length,
    numberDeck: [...g.numberDeck],
    wordClueDeck: [...g.wordClueDeck],
    debaucheeOrder: [...g.debaucheeOrder],
    round: r
      ? {
          number: r.number,
          debauchee: r.debauchee,
          guessers: [...r.guessers],
          dealtWords: [...r.dealtWords],
          word: r.word,
          hand: [...r.hand],
          played: r.played.map((p) => ({ card: p.card, answer: p.answer })),
          revealed: [...r.revealed],
          bribed: [...r.bribed],
          burned: [...r.burned],
          checks: r.checks.map((c) => ({ ...c })),
          turnIndex: r.turnIndex,
          turnsSinceReveal: r.turnsSinceReveal,
          buildArea: [...r.buildArea],
          pool: { ...r.pool },
          lastTouched: r.lastTouched ? { ...r.lastTouched } : null,
        }
      : null,
    history: g.history.map((h) => ({ ...h, payouts: { ...h.payouts } })),
    winners: g.winners ? [...g.winners] : null,
  };
}

export function toEvent(_g: WordDebaucheeState, playerId: string, move: Record<string, unknown>, moveIndex: number): VerifyEvent {
  return { moveIndex, actor: playerId, moveType: String(move.type), move };
}
