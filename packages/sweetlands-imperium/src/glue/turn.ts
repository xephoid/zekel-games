// What the turn panel offers, read from the engine's listed moves (build
// item 6). Nothing here decides a move or works out a rule: each option is a
// group of moves the engine listed, and where a piece lands is the move's own
// `landing` (zekel core/game.ts LegalMove.landing).

import type { LegalMove } from '@zekel/glue-kit';
import { asNum, asStr, isObj } from '@zekel/glue-kit';
import type { UnitKey } from './art.js';
import { landWords } from './Board.js';
import { TILE_BY_ID } from './geometry.js';
import { movesForCard } from './Hand.js';
import { REGION_TREAT, UNIT_NAME, tileOf, treatName, type SlTable, type UnitLocation } from './read.js';

export type TurnStep = 'waiting' | 'secret' | 'draw' | 'recall' | 'play' | 'influence' | 'over' | 'other';

/** Which of the four steps the turn is at (or a setup step), from the view and the listed moves. */
export function turnStep(table: SlTable, legal: LegalMove[], yourTurn: boolean): TurnStep {
  if (table.phase === 'game_over') return 'over';
  if (!yourTurn || legal.length === 0) return 'waiting';
  if (legal.some((m) => m.move['type'] === 'resolve_report')) return 'draw';
  if (legal.some((m) => m.move['type'] === 'choose_secret_objective')) return 'secret';
  if (table.phase !== 'play') return 'other';
  if (table.step === 'recall') return 'recall';
  if (table.step === 'play') return 'play';
  if (table.step === 'influence') return 'influence';
  return 'other';
}

export interface Landing { piece: string; from: UnitLocation | null; to: UnitLocation | null; path: UnitLocation[]; stops?: UnitLocation[] }

export function landingOf(m: LegalMove): Landing | null {
  const l = (m as LegalMove & { landing?: unknown }).landing;
  if (!isObj(l)) return null;
  const loc = (x: unknown) => (isObj(x) ? (x as unknown as UnitLocation) : null);
  return {
    piece: asStr(l['piece']),
    from: loc(l['from']),
    to: loc(l['to']),
    path: Array.isArray(l['path']) ? l['path'].map(loc).filter((x): x is UnitLocation => !!x) : [],
    ...(Array.isArray(l['stops']) ? { stops: l['stops'].map(loc).filter((x): x is UnitLocation => !!x) } : {}),
  };
}

/** One numbered choice: a piece and a destination (ring and road counted apart). */
export interface PlayOption {
  n: number;
  unit: UnitKey;
  /** the board tile the piece ends on, when the engine said */
  tile: string | null;
  landing: Landing | null;
  title: string;
  /** what the action would do there, in the engine's words */
  sentence: string;
  /** take the color's action */
  act: LegalMove | null;
  /** move only */
  move: LegalMove | null;
  /** Yellow: collect taxes and raise the tax */
  raise: LegalMove | null;
  /** a template that still asks something (Cheesecake's any-treat slot) */
  template: LegalMove | null;
}

/** "the red space in Fudge’s land", from where the engine says the piece lands. */
export function destinationWords(table: SlTable, l: Landing | null): string {
  if (!l || !l.to) return 'where the engine sends it';
  const from = tileOf(l.from);
  const to = tileOf(l.to);
  if (to && from === to && l.path.length === 0) return 'nowhere: it cannot move';
  if (!to) return 'off the board';
  if (to === 'castle') return 'the Candy Castle';
  const t = TILE_BY_ID[to];
  if (!t) return 'off the board';
  const land = landWords(table, t.region);
  const loc = l.to;
  if (loc.zone === 'treat') return `the ${treatName(loc.slotKind === 'random' ? table.randomTreat[t.region] : REGION_TREAT[t.region])} treat in ${land}`;
  if (loc.zone === 'start') return `home in ${land}`;
  const color = t.space?.color ?? '';
  return loc.zone === 'road' ? `the ${color} road space in ${land}` : `the ${color} space in ${land}`;
}

function groupKey(m: LegalMove): string {
  const mv = m.move;
  return [mv['unit'], mv['viaRoad'] ? 'road' : 'ring', asNum(mv['entryRegion']), 'treatRegion' in mv ? 'any-treat' : ''].join('|');
}

/** The numbered options for a picked card (or Intel token), one per piece per destination. */
export function playOptions(table: SlTable, moves: LegalMove[]): PlayOption[] {
  const groups = new Map<string, LegalMove[]>();
  for (const m of moves) {
    const k = groupKey(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const out: PlayOption[] = [];
  for (const ms of groups.values()) {
    const first = ms[0]!;
    const unit = asStr(first.move['unit']) as UnitKey;
    const landing = landingOf(first);
    const template = ms.find((m) => 'treatRegion' in m.move) ?? null;
    const act = ms.find((m) => m.move['takeAction'] === true && !m.move['raiseTaxes']) ?? null;
    const move = ms.find((m) => m.move['takeAction'] === false && !('treatRegion' in m.move)) ?? null;
    const raise = ms.find((m) => m.move['raiseTaxes'] === true) ?? null;
    const where = template ? 'any treat you choose' : destinationWords(table, landing);
    out.push({
      n: out.length + 1, unit, tile: tileOf(landing?.to), landing,
      title: `${UNIT_NAME[unit] ?? unit} → ${where}`,
      sentence: (act ?? template ?? move ?? first).description ?? '',
      act, move, raise, template,
    });
  }
  return out;
}

/** The listed moves a picked card stands for, and the ones that move nothing (Green's discard). */
export function cardChoices(table: SlTable, legal: LegalMove[], picked: string): { options: PlayOption[]; extra: LegalMove[] } {
  const hand = table.hand ?? [];
  const moves = picked.startsWith('token:')
    ? legal.filter((m) => m.move['type'] === 'play_token' && m.move['color'] === picked.slice(6))
    : movesForCard({ legalMoves: legal } as never, hand, picked);
  const extra = moves.filter((m) => !landingOf(m) && m.move['type'] === 'play_intel' && m.move['takeAction'] === true && !('treatRegion' in m.move) && !hand.find((c) => c.cardId === m.move['cardId'] && c.kind === 'treat'));
  const options = playOptions(table, moves.filter((m) => !extra.includes(m)));
  return { options, extra };
}
