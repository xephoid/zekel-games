// Dev hooks for word-debauchee: what the development tools need to know about
// this game beyond the Game itself (@zekel/dev, harness/devHooks.ts). The
// game's own code never loads this folder.

import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { moveType } from '@zekel/dev/harness/analysis';
import type { DesyncHooks, GameDevHooks } from '@zekel/dev/harness/devHooks';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { clue, clueByName, type ClueId } from '../data/clues.js';
import { wordDebaucheeVerifyAdapter } from './verify/adapter.js';

// Word Debauchee has no cards to play or buy, so the generic dead-turn rule
// would mark every turn dead. A turn is DEAD when the seat made no board
// progress: a guesser who only called "Reveal!" (a letter bought, nothing
// built), or a seat whose stretch of moves was only reports. Reports (a burned
// word, the timer, who goes first) are not turns at all.
const PROGRESS = new Set(['place', 'move', 'check', 'reveal', 'choose_word', 'play_clues', 'answer_clue']);
const NOT_A_TURN = new Set(['burn', 'timer_out', 'choose_first_debauchee']);

const wordDebaucheeAnalysis: AnalysisOverride = {
  isRealTurn(moves) {
    return !(moves.length > 0 && moves.every((m) => NOT_A_TURN.has(moveType(m))));
  },
  isDeadTurn(moves) {
    return !moves.some((m) => PROGRESS.has(moveType(m)));
  },
  // The score climbs during play: the scoreboard's `score` is who is ahead.
  leaderScalar: (row) => row.score ?? 0,
  // Which clue cards a debauchee chose to play, and a bribe's deck, as lift features.
  extraFeatures(move) {
    const m = (move as { move?: Record<string, unknown> }).move ?? {};
    const type = moveType(move);
    if (type === 'play_clues' && Array.isArray(m.cards)) return (m.cards as string[]).map((c) => `clue:${c}`);
    if (type === 'call_reveal' && typeof m.clue === 'string') return [`bribe:${m.clue}`];
    return [];
  },
};

// ---- the desync bot: how a person at the table says a move ----------------

const an = (letter: string): string => (/^[AEFHILMNORSX]$/.test(letter) ? 'an' : 'a');
const CLUE_NAME = (id: unknown): string => (typeof id === 'string' ? (clue(id as ClueId)?.name ?? id) : String(id));

const wordDebaucheeDesync: DesyncHooks = {
  utterance(move, _isReport, view, _playerId) {
    const m = move as Record<string, unknown>;
    const rows = ((view as { round?: { build_area?: string[] } }).round?.build_area ?? []) as string[];
    const rowText = (i: unknown): string => (typeof i === 'number' && rows[i] !== undefined ? rows[i]! : `row ${String(i)}`);
    switch (m.type) {
      case 'choose_first_debauchee':
        return `${String(m.player)} most recently got away with something, so they go first.`;
      case 'choose_word':
        return `I'll keep ${String(m.word)}.`;
      case 'play_clues':
        return `I play ${(m.cards as unknown[]).map(CLUE_NAME).join(', ')}.`;
      case 'answer_clue':
        return m.text ? `${CLUE_NAME(m.card)}: ${String(m.text)}.` : `For ${CLUE_NAME(m.card)} I'll take the card's answer.`;
      case 'place': {
        const letter = String(m.letter).toUpperCase();
        const check = m.check ? ' Check!' : '';
        if (m.row === undefined) return `I put ${an(letter)} ${letter} down in a new row.${check}`;
        if (m.index === undefined) return `I add ${an(letter)} ${letter} to the end of ${rowText(m.row)}.${check}`;
        return `I put ${an(letter)} ${letter} into ${rowText(m.row)} at position ${Number(m.index) + 1}.${check}`;
      }
      case 'move': {
        const from = rowText(m.row);
        const which = `the ${ordinal(Number(m.index) + 1)} tile of ${from}`;
        if (m.to_row === undefined) return `I take ${which} back to the pool.`;
        if (m.to_row === 'new') return `I move ${which} to a new row.${m.check ? ' Check!' : ''}`;
        return `I move ${which} to ${m.to_row === m.row ? 'another spot in the same row' : rowText(m.to_row)}${m.to_index !== undefined ? `, position ${Number(m.to_index) + 1}` : ''}.${m.check ? ' Check!' : ''}`;
      }
      case 'check':
        return m.word ? `Check! ${String(m.word).toUpperCase()}.` : `Check! ${rowText(m.row)}.`;
      case 'call_reveal':
        return m.clue ? `Reveal! But I'll take a ${String(m.clue)} clue instead of a letter.` : 'Reveal!';
      case 'burn':
        return `Someone just said "${String(m.word).toLowerCase()}" out loud.`;
      case 'timer_out':
        return 'The sand has run out.';
      case 'reveal':
        return `I reveal ${an(String(m.letter).toUpperCase())} ${String(m.letter).toUpperCase()}${m.row !== undefined ? `, taking it from ${rowText(m.row)}` : ''}.`;
      default:
        return null;
    }
  },
  canonicalMove(move) {
    // A move recorded by its menu id is a correct record: expand it to the move shape.
    const m: Record<string, unknown> = typeof move.move_id === 'string' && Object.keys(move).length === 1 ? expandMoveId(move.move_id) ?? { ...move } : { ...move };
    if (typeof m.word === 'string') m.word = m.word.trim().toUpperCase();
    if (typeof m.letter === 'string') m.letter = m.letter.trim().toUpperCase();
    if (typeof m.card === 'string') m.card = clueByName(m.card)?.id ?? m.card;
    if (Array.isArray(m.cards)) m.cards = [...(m.cards as string[])].map((c) => clueByName(c)?.id ?? c).sort();
    if (typeof m.clue === 'string') m.clue = /word/i.test(m.clue) ? 'word' : 'number';
    for (const k of Object.keys(m)) if (m[k] === undefined || m[k] === false) delete m[k];
    return m;
  },
};

/** The move a legal-move id names (legalMoves.ts builds the ids), or null when the id carries a fill-in. */
function expandMoveId(id: string): Record<string, unknown> | null {
  const p = id.split(':');
  const n = (x: string | undefined): number => Number(x);
  switch (p[0]) {
    case 'choose_first_debauchee': return { type: 'choose_first_debauchee', player: p[1] };
    case 'choose_word': return { type: 'choose_word', word: p[1] };
    case 'play_clues': return p[1] && !p[1].includes('<') ? { type: 'play_clues', cards: p[1].split('+') } : null;
    case 'answer_clue': return p[2] === 'card' ? { type: 'answer_clue', card: p[1] } : null;
    case 'reveal': return p[2] === 'row' ? { type: 'reveal', letter: p[1], row: n(p[3]) } : { type: 'reveal', letter: p[1] };
    case 'place': return p[2] === 'new' ? { type: 'place', letter: p[1] } : { type: 'place', letter: p[1], row: n(p[2]) };
    case 'move': return p[1] === undefined ? null : { type: 'move', row: n(p[1]), index: 0 };
    case 'check': return p[1] === undefined ? null : { type: 'check', row: n(p[1]) };
    case 'call_reveal': return p[1] ? { type: 'call_reveal', clue: p[1] } : { type: 'call_reveal' };
    case 'timer_out': return { type: 'timer_out' };
    default: return null;
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export const devHooks: GameDevHooks = {
  analysis: wordDebaucheeAnalysis,
  verify: {
    'word-debauchee': wordDebaucheeVerifyAdapter as unknown as VerifyAdapter<unknown>,
  },
  desync: wordDebaucheeDesync,
};
