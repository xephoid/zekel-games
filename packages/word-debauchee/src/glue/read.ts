// Reads the Word Debauchee view (the engine's views.ts in @zekel/word-debauchee)
// into plain shapes for the screen. Nothing here is a rule: every number is
// the view's, and every move the screen sends is found among the listed ones.

import type { LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';

export const GAME = 'word-debauchee';

export interface Seat { id: string; name: string; ai: boolean; score: number }
export interface Clue { card: string; name: string; asks: string; answer: string | number | null; bribed: boolean }
export interface Check { by: string; word: string; yes: boolean }
export interface HandCard { card: string; name: string; kind: string; answer: string | number | null }
export interface RoundResult {
  number: number; debauchee: string; word: string; outcome: 'cracked' | 'stumped';
  synonym: string | null; revealed: number; bribes: number; payouts: Record<string, number>;
}

export interface Secret {
  dealt: string[];
  word: string | null;
  card: { letters: number; vowels: number; consonants: number; syllables: number; category: string; type: string; grade: number; difficulty: string; synonyms: string[] } | null;
  hand: HandCard[];
  lettersLeft: string[];
}

export interface WdTable {
  phase: string;
  phaseText: string;
  seats: Seat[];
  settings: { bribe: boolean; openHand: boolean; house: string | null; tiles: string; timer: string };
  round: {
    number: number; of: number; debauchee: string; guessers: string[];
    clues: Clue[]; redraws: number; revealed: string[]; revealsForScoring: number;
    burned: string[]; checks: Check[];
    rows: string[]; pool: Record<string, number>; turn: string | null; turnsUntilReveal: number | null;
  } | null;
  lastRound: RoundResult | null;
  history: RoundResult[];
  winners: string[] | null;
  /** present only in the debauchee's own view */
  secret: Secret | null;
}

function result(x: unknown): RoundResult | null {
  if (!isObj(x)) return null;
  const payouts: Record<string, number> = {};
  if (isObj(x['payouts'])) for (const [k, v] of Object.entries(x['payouts'])) payouts[k] = asNum(v);
  return {
    number: asNum(x['number']), debauchee: asStr(x['debauchee']), word: asStr(x['word']),
    outcome: x['outcome'] === 'cracked' ? 'cracked' : 'stumped',
    synonym: typeof x['synonym'] === 'string' ? x['synonym'] : null,
    revealed: asNum(x['revealed']), bribes: asNum(x['bribes']), payouts,
  };
}

const answerOf = (x: unknown): string | number | null => (typeof x === 'string' || typeof x === 'number' ? x : null);

export function readTable(view: unknown): WdTable | null {
  if (!isObj(view) || !Array.isArray(view['seats']) || typeof view['phase'] !== 'string' || !isObj(view['settings'])) return null;
  const st = view['settings'];
  const seats: Seat[] = asArr(view['seats']).filter(isObj).map((s) => ({ id: asStr(s['id']), name: asStr(s['name']), ai: s['ai'] === true, score: asNum(s['score']) }));
  const r = isObj(view['round']) ? view['round'] : null;
  // A bribed clue is played like the others: the engine appends it to the
  // played clues, so the last `bribed.length` of them are the bribed ones.
  const bribedCount = r ? asArr(r['bribed']).length : 0;
  const clues: Clue[] = r ? asArr(r['clues']).filter(isObj).map((c, i, all) => ({
    card: asStr(c['card']), name: asStr(c['name']), asks: asStr(c['asks']), answer: answerOf(c['answer']),
    bribed: i >= all.length - bribedCount,
  })) : [];
  const pool: Record<string, number> = {};
  if (r && isObj(r['pool'])) for (const [k, v] of Object.entries(r['pool'])) pool[k] = asNum(v);
  const sec = isObj(view['secret']) ? view['secret'] : null;
  const card = sec && isObj(sec['card']) ? sec['card'] : null;
  return {
    phase: asStr(view['phase']),
    phaseText: asStr(view['phase_text']),
    seats,
    settings: {
      bribe: st['bribe'] === true, openHand: st['openHand'] === true,
      house: typeof st['house'] === 'string' ? st['house'] : null,
      tiles: asStr(st['tiles']), timer: asStr(st['timer']),
    },
    round: r ? {
      number: asNum(r['number'], 1), of: asNum(r['of'], 1), debauchee: asStr(r['debauchee']),
      guessers: asArr(r['guessers']).map((g) => asStr(g)),
      clues, redraws: asNum(r['redraws']),
      revealed: asArr(r['revealed']).map((l) => asStr(l)),
      revealsForScoring: asNum(r['reveals_for_scoring'], asArr(r['revealed']).length),
      burned: asArr(r['burned']).map((w) => asStr(w)),
      checks: asArr(r['checks']).filter(isObj).map((c) => ({ by: asStr(c['by']), word: asStr(c['word']), yes: c['yes'] === true })),
      rows: asArr(r['build_area']).map((t) => asStr(t)),
      pool,
      turn: typeof r['turn'] === 'string' ? r['turn'] : null,
      turnsUntilReveal: typeof r['turns_until_reveal'] === 'number' ? r['turns_until_reveal'] : null,
    } : null,
    lastRound: result(view['last_round']),
    history: asArr(view['history']).map(result).filter((x): x is RoundResult => !!x),
    winners: Array.isArray(view['winners']) ? view['winners'].map((w) => asStr(w)) : null,
    secret: sec ? {
      dealt: asArr(sec['dealt_words']).map((w) => asStr(w)),
      word: typeof sec['word'] === 'string' ? sec['word'] : null,
      card: card ? {
        letters: asNum(card['letters']), vowels: asNum(card['vowels']), consonants: asNum(card['consonants']),
        syllables: asNum(card['syllables']), category: asStr(card['category']), type: asStr(card['type']),
        grade: asNum(card['grade']), difficulty: asStr(card['difficulty']),
        synonyms: asArr(card['synonyms']).map((w) => asStr(w)),
      } : null,
      hand: asArr(sec['hand']).filter(isObj).map((h) => ({ card: asStr(h['card']), name: asStr(h['name']), kind: asStr(h['kind']), answer: answerOf(h['answer']) })),
      lettersLeft: asArr(sec['letters_left']).map((l) => asStr(l)),
    } : null,
  };
}

// ---- finding listed moves --------------------------------------------------------

export const typeOf = (m: LegalMove): string => asStr(m.move['type']);

export function find(moves: LegalMove[], test: (m: LegalMove) => boolean): LegalMove | null {
  return moves.find(test) ?? null;
}

/** The listed place for this letter: in a new row, or at the end of `row`. */
export function placeMove(moves: LegalMove[], letter: string, row: number | null): LegalMove | null {
  return find(moves, (m) => typeOf(m) === 'place' && m.move['letter'] === letter && (row === null ? m.move['row'] === undefined : m.move['row'] === row));
}

/** The listed move for a tile of `row` (the engine lists one per row, index 0). */
export function moveMove(moves: LegalMove[], row: number): LegalMove | null {
  return find(moves, (m) => typeOf(m) === 'move' && m.move['row'] === row);
}

/** The listed play of exactly these three clue cards, in any order. */
export function playMove(moves: LegalMove[], cards: string[]): LegalMove | null {
  const want = [...cards].sort().join('+');
  return find(moves, (m) => typeOf(m) === 'play_clues' && Array.isArray(m.move['cards']) && [...(m.move['cards'] as string[])].sort().join('+') === want);
}

/** A template the engine lists with a placeholder in angle brackets. */
export const isTemplate = (m: LegalMove): boolean => Object.values(m.move).some((v) => typeof v === 'string' && /^<.*>$/.test(v))
  || (Array.isArray(m.move['cards']) && (m.move['cards'] as unknown[]).some((v) => typeof v === 'string' && /^<.*>$/.test(v)));

/** The keyboard's three rows. A layout, not a rule: every count is the view's. */
export const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function nameOf(table: WdTable, id: string, me: string | null): string {
  if (id === me) return 'You';
  return table.seats.find((s) => s.id === id)?.name || id;
}
