// Word Debauchee adapter for the verify driver (and the hunter).
//
// Sessions rotate through 2 to 5 seats, three kinds of table and the variants,
// so random play reaches the paths a real table uses:
//   - every seat an AI (server-held tiles);
//   - one person at seat "a", the server holding the tiles;
//   - every seat a person, the table's own tiles (the server tracks no tile:
//     checks are declared, so the glue offers one listed synonym and one word
//     that is not, in place of the fill-in template).
// The driver plays every seat from the offered legal moves, so fill-in
// templates ("<word>", "<your answer>") are replaced by concrete moves here.
//
// The driver reads `session.gameState.activePlayerId`; the engine keeps the
// seat to act in `activeSeatId(state)`, so the wrapped game copies it across.

import type { ApplyMoveResult, Game, LegalMove, PlayerConfig, SessionState } from '@zekel/game-kit';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { cardFor } from '../../data/deck.js';
import { activeSeatId } from '../../engine/helpers.js';
import { MOVE_TYPES, type WordDebaucheeMove } from '../../engine/moves.js';
import { wordDebauchee as game } from '../../index.js';
import type { WordDebaucheeOptions, WordDebaucheeState } from '../../types.js';
import { projectWordDebauchee, toEvent, type WDVerifyState } from './project.js';
import { WORD_DEBAUCHEE_ORACLE_RULES } from './rules.js';

function patch(gs: WordDebaucheeState): void {
  (gs as WordDebaucheeState & { activePlayerId: string }).activePlayerId = activeSeatId(gs);
}

const NAMES = ['Ann', 'Ben', 'Cat', 'Dev', 'Eve'];

function createSession(seed: number): SessionState<WordDebaucheeState> {
  const count = 2 + (seed % 4);
  const table = Math.floor(seed / 4) % 3; // 0 all-AI, 1 one person with server tiles, 2 all people with the table's tiles
  const variant = Math.floor(seed / 12) % 4; // 0 none, 1 Bribe, 2 Open hand + Bribe, 3 The House
  const players: PlayerConfig[] = Array.from({ length: count }, (_, i) => {
    const id = String.fromCharCode(97 + i);
    const human = table === 2 || (table === 1 && i === 0);
    return { player_id: id, name: NAMES[i], kind: human ? 'human' : 'ai' } as PlayerConfig;
  });
  const options: WordDebaucheeOptions = { seed, rounds: 2 };
  if (variant === 1) options.bribe = true;
  if (variant === 2) {
    options.bribe = true;
    options.openHand = true;
  }
  if (variant === 3) {
    if (table === 2) options.openHand = true; // no AI seat to be the house
    else options.house = true;
  }
  if (table === 1 && seed % 2 === 1) options.timer = 'sand';
  const session = game.createSession(players, options);
  patch(session.gameState);
  return session;
}

/** Concrete moves in place of the menu's fill-in templates. */
function concrete(gs: WordDebaucheeState, entries: LegalMove<WordDebaucheeMove>[]): LegalMove<WordDebaucheeMove>[] {
  const out: LegalMove<WordDebaucheeMove>[] = [];
  const word = gs.round?.word;
  const synonym = word ? cardFor(word)!.synonyms[0]!.toUpperCase() : 'GLAD';
  for (const e of entries) {
    const m = e.move;
    if (m.type === 'check' && m.word === '<word>') {
      out.push({ ...e, move_id: 'check:listed', move: { type: 'check', word: synonym } });
      out.push({ ...e, move_id: 'check:unlisted', move: { type: 'check', word: 'ZZZZ' } });
    } else if (m.type === 'burn') {
      out.push({ ...e, move: { type: 'burn', word: 'QUIZ' } });
    } else if (m.type === 'answer_clue' && m.text === '<your answer>') {
      out.push({ ...e, move: { type: 'answer_clue', card: m.card, text: m.card === 'register' ? 'formal' : 'zzz' } });
    } else if (m.type === 'play_clues' && JSON.stringify(m.cards).includes('<')) {
      out.push({ ...e, move_id: 'play_clues:a', move: { type: 'play_clues', cards: ['letters', 'category', 'type'] } });
      out.push({ ...e, move_id: 'play_clues:b', move: { type: 'play_clues', cards: ['vowels', 'first_letter', 'opposite'] } });
      out.push({ ...e, move_id: 'play_clues:c', move: { type: 'play_clues', cards: ['syllables', 'grade', 'letters'] } });
    } else {
      out.push(e);
    }
  }
  return out;
}

const wrapped = Object.create(game) as Game<WordDebaucheeState, WordDebaucheeMove, WordDebaucheeOptions>;
wrapped.applyMove = (state: SessionState<WordDebaucheeState>, playerId: string, move: WordDebaucheeMove): ApplyMoveResult<WordDebaucheeState> => {
  const result = game.applyMove(state, playerId, move);
  patch(result.newState.gameState);
  return result;
};
wrapped.getLegalMoves = (state: SessionState<WordDebaucheeState>, playerId: string): LegalMove<WordDebaucheeMove>[] =>
  concrete(state.gameState, game.getLegalMoves(state, playerId));

const PHASES = ['setup', 'choose_word', 'play_clues', 'answer_clues', 'build', 'reveal', 'game_over'];

const SENSORS: Record<string, (s: WDVerifyState) => number> = {
  phase: (s) => PHASES.indexOf(s.phase),
  round: (s) => s.round?.number ?? 0,
  rounds_left: (s) => s.settings.rounds - s.roundsPlayed,
  revealed: (s) => s.round?.revealed.length ?? 0,
  bribed: (s) => s.round?.bribed.length ?? 0,
  burned: (s) => s.round?.burned.length ?? 0,
  checks: (s) => s.round?.checks.length ?? 0,
  clues_played: (s) => s.round?.played.length ?? 0,
  build_rows: (s) => s.round?.buildArea.length ?? 0,
  build_tiles: (s) => s.round?.buildArea.reduce((a, t) => a + t.length, 0) ?? 0,
  turns_since_reveal: (s) => s.round?.turnsSinceReveal ?? 0,
  word_length: (s) => s.round?.word?.length ?? 0,
  score_lead: (s) => {
    const v = Object.values(s.scores);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  },
  players: (s) => s.seats.length,
  table_tiles: (s) => (s.settings.tiles === 'table' ? 1 : 0),
};

const SENSOR_MAX: Record<string, number> = {
  phase: 6, round: 16, rounds_left: 16, revealed: 12, bribed: 6, burned: 10, checks: 10, clues_played: 8,
  build_rows: 12, build_tiles: 40, turns_since_reveal: 8, word_length: 12, score_lead: 60, players: 8, table_tiles: 1,
};

export const wordDebaucheeVerifyAdapter: VerifyAdapter<WordDebaucheeState, WDVerifyState> = {
  gameId: 'word-debauchee',
  game: wrapped as unknown as Game<WordDebaucheeState, unknown, unknown>,
  createSession,
  project: projectWordDebauchee,
  toEvent: (gs, playerId, move, moveIndex) => toEvent(gs, playerId, move as Record<string, unknown>, moveIndex),
  annotate: () => {},
  rules: WORD_DEBAUCHEE_ORACLE_RULES,
  sensors: SENSORS,
  sensorMax: SENSOR_MAX,
  moveTypes: MOVE_TYPES,
};
