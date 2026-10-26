// What a seat may see. The public view is what the table can see; the
// debauchee's view adds the dealt words, the chosen word with its card, and
// the clue hand. Nothing else ever shows the secret word before the round
// ends (viewLeak.test.ts locks this).

import { clue, type ClueId } from './data/clues.js';
import { cardFor } from './data/deck.js';
import { difficultyDots } from './data/wordCard.js';
import { activeSeatId, currentGuesser, turnsPerReveal } from './engine/helpers.js';
import type { CheckRecord, Phase, RoundResult, Settings, WordDebaucheeState } from './types.js';

export interface ClueView {
  card: ClueId;
  name: string;
  asks: string;
  answer: string | number | null;
}

export interface PublicView {
  phase: Phase;
  phase_text: string;
  settings: Settings;
  seats: { id: string; name: string; ai: boolean; score: number }[];
  round: {
    number: number;
    of: number;
    debauchee: string;
    guessers: string[];
    clues: ClueView[];
    revealed: string[];
    revealed_count: number;
    burned: string[];
    checks: CheckRecord[];
    /** `server` tiles only. */
    build_area?: string[];
    pool?: Record<string, number>;
    turn?: string;
    turns_until_reveal?: number;
  } | null;
  last_round: RoundResult | null;
  history: RoundResult[];
  winners: string[] | null;
}

export interface DebaucheeView extends PublicView {
  secret: {
    dealt_words: string[];
    word: string | null;
    card: { letters: number; vowels: number; consonants: number; syllables: number; category: string; type: string; grade: number; difficulty: string; synonyms: string[] } | null;
    hand: { card: ClueId; name: string; kind: string; answer: string | number | null }[];
    letters_left: string[];
  };
}

const PHASE_TEXT: Record<Phase, string> = {
  setup: 'The table is saying who is the first debauchee.',
  choose_word: 'The debauchee is choosing a word from three cards.',
  play_clues: 'The debauchee is choosing three clue cards to play.',
  answer_clues: 'The debauchee is answering the clues played.',
  build: 'The guessers are building.',
  reveal: 'The debauchee owes a reveal.',
  game_over: 'The game is over.',
};

export function getPublicView(state: WordDebaucheeState): PublicView {
  const r = state.round;
  const server = state.settings.tiles === 'server';
  return {
    phase: state.phase,
    phase_text: PHASE_TEXT[state.phase],
    settings: { ...state.settings },
    seats: state.seats.map((s) => ({ id: s.id, name: s.name, ai: s.ai, score: state.scores[s.id] ?? 0 })),
    round: r
      ? {
          number: r.number,
          of: state.settings.rounds,
          debauchee: r.debauchee,
          guessers: [...r.guessers],
          clues: r.played.map((p) => ({ card: p.card, name: clue(p.card).name, asks: clue(p.card).prompt, answer: p.answer })),
          revealed: [...r.revealed],
          revealed_count: r.revealed.length,
          burned: [...r.burned],
          checks: r.checks.map((c) => ({ ...c })),
          ...(server
            ? {
                build_area: [...r.buildArea],
                pool: { ...r.pool },
                turn: state.phase === 'build' ? currentGuesser(state) : activeSeatId(state),
                ...(state.settings.timer === 'laps' ? { turns_until_reveal: Math.max(0, turnsPerReveal(state) - r.turnsSinceReveal) } : {}),
              }
            : {}),
        }
      : null,
    last_round: state.history[state.history.length - 1] ?? null,
    history: state.history.map((h) => ({ ...h, payouts: { ...h.payouts } })),
    winners: state.winners ? [...state.winners] : null,
  };
}

export function getPlayerView(state: WordDebaucheeState, playerId: string): PublicView | DebaucheeView {
  const pub = getPublicView(state);
  const r = state.round;
  if (!r || r.debauchee !== playerId) return pub;
  const card = r.word ? cardFor(r.word)! : null;
  const left = new Map<string, number>();
  if (r.word) {
    for (const ch of r.word) left.set(ch, (left.get(ch) ?? 0) + 1);
    for (const ch of r.revealed) left.set(ch, (left.get(ch) ?? 0) - 1);
  }
  return {
    ...pub,
    secret: {
      dealt_words: [...r.dealtWords],
      word: r.word,
      card: card
        ? {
            letters: card.letters, vowels: card.vowels, consonants: card.consonants, syllables: card.syllables,
            category: card.category, type: card.type, grade: card.grade, difficulty: difficultyDots(card.difficulty), synonyms: [...card.synonyms],
          }
        : null,
      hand: r.hand.map((id) => ({ card: id, name: clue(id).name, kind: clue(id).kind, answer: card ? clue(id).answer(card) : null })),
      letters_left: [...left.entries()].filter(([, n]) => n > 0).map(([ch]) => ch).sort(),
    },
  };
}
