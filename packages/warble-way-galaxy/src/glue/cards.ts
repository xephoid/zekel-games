// Warble Way Galaxy's travel cards (docs/games/warble-way-galaxy-theme-build.md,
// item 4): what a card's face shows, read from the engine's reference data.
// The engine publishes the four travel tables (the numbers), the names and
// lines on each card (`cards`, by card id) and the hazard consequence by
// stat; this file only looks a card up and arranges what it finds. Nothing
// here is a rule and no name lives here: a code the reference does not
// carry draws as a plain card.

import type { GameReferenceResponse } from '@zekel/wire-types';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import type { IconName } from './icons.js';

export type Suit = 'H' | 'D' | 'S' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type CardKind = 'recruit' | 'pirate' | 'ruin' | 'hazard' | 'job';
/** What a failed hazard check costs, as the engine names it. */
export type Fail = 'ship_damage' | 'lose_credits' | 'crew_unrest' | 'death';

const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Record<string, Suit> = { H: 'H', D: 'D', S: 'S', C: 'C', '♥': 'H', '♦': 'D', '♠': 'S', '♣': 'C', '♡': 'H', '♢': 'D', '♤': 'S', '♧': 'C' };
export const GLYPH: Record<Suit, string> = { H: '♥', D: '♦', S: '♠', C: '♣' };

/** "AH", "10D", "3♠", "♥Q": the rank and suit, or null. */
export function parseCode(code: string): { rank: Rank; suit: Suit } | null {
  const raw = code.trim().toUpperCase();
  const m = /^(A|10|[2-9]|J|Q|K)\s*([HDSC♥♦♠♣♡♢♤♧])$/.exec(raw) ?? (() => {
    const r = /^([HDSC♥♦♠♣♡♢♤♧])\s*(A|10|[2-9]|J|Q|K)$/.exec(raw);
    return r ? [r[0], r[2], r[1]] : null;
  })();
  if (!m) return null;
  return { rank: m[1] as Rank, suit: SUITS[m[2]!]! };
}

/** The card id the engine keys its tables by: rank then suit letter. */
export function cardId(code: string): string | null {
  const p = parseCode(code);
  return p ? `${p.rank}${p.suit}` : null;
}

export interface Option { head: string; tail: string; fail?: Fail }

export interface TravelCardFace {
  id: string;
  rank: Rank;
  suit: Suit;
  kind: CardKind;
  title: string;
  line: string;
  /** Recruit: who, what they need, what they bring. */
  race?: string;
  idealized?: string;
  need?: number;
  chips?: string[];
  /** Pirates: the numbers as printed. */
  spaceAttack?: number;
  stats?: { k: string; v: string }[];
  /** Ruin: how deep. */
  depth?: number;
  /** Hazard and job: each way through. */
  options?: Option[];
}

/** The kind of every card, from which table the engine put it in. */
function kindOf(rank: Rank, suit: Suit, tables: Record<string, unknown>): CardKind | null {
  if (suit === 'H') return isObj(tables['hearts_recruits']) && rank in tables['hearts_recruits'] ? 'recruit' : null;
  if (suit === 'S') return isObj(tables['spades_hazards']) && rank in tables['spades_hazards'] ? 'hazard' : null;
  if (suit === 'C') return isObj(tables['clubs_missions']) && rank in tables['clubs_missions'] ? 'job' : null;
  if (isObj(tables['diamonds_2_to_9_pirates']) && rank in tables['diamonds_2_to_9_pirates']) return 'pirate';
  if (isObj(tables['diamonds_10_J_Q_K_A_ruin_depths']) && rank in tables['diamonds_10_J_Q_K_A_ruin_depths']) return 'ruin';
  return null;
}

const SPECIAL: Record<string, string> = {
  space_combat_advantage: 'Space combat advantage',
  minus_2_enemy_space_bonus: '−2 enemy space combat bonus',
};

function mission(m: unknown): { head: string; tail: string } | null {
  if (!isObj(m)) return null;
  const goal = isObj(m['goal']) ? m['goal'] : {};
  const head = goal['kind'] === 'ruin' ? `R${asNum(goal['depth'])}` : `${asStr(goal['ability'])} ${asNum(goal['min_roll'])}`;
  return { head, tail: `dist ${asNum(m['distance'])} · ${asNum(m['credits']).toLocaleString('en-US')}c · ${asNum(m['xp'])} XP` };
}

/** A card's face from its code and the reference data, or null when the reference does not carry it. */
export function travelCard(code: string, reference: GameReferenceResponse | null): TravelCardFace | null {
  const p = parseCode(code);
  const rd = reference?.referenceData;
  if (!p || !isObj(rd)) return null;
  const tables = isObj(rd['travel_tables']) ? rd['travel_tables'] : {};
  const kind = kindOf(p.rank, p.suit, tables);
  if (!kind) return null;
  const id = `${p.rank}${p.suit}`;
  const names = isObj(rd['cards']) && isObj(rd['cards'][id]) ? rd['cards'][id] : {};
  const face: TravelCardFace = { id, rank: p.rank, suit: p.suit, kind, title: asStr(names['title']), line: asStr(names['line']) };
  if (kind === 'recruit') {
    const r = (tables['hearts_recruits'] as Record<string, unknown>)[p.rank];
    if (isObj(r)) {
      face.race = asStr(r['race']);
      face.idealized = asStr(r['idealized']);
      face.need = asNum(r['min_roll']);
      face.chips = isObj(r['abilities']) ? Object.entries(r['abilities']).map(([a, n]) => `+${asNum(n)} ${a}`) : [];
      if (!face.title) face.title = face.race.charAt(0).toUpperCase() + face.race.slice(1);
      if (!face.line && face.idealized) face.line = `idealizes ${face.idealized}`;
      else if (face.idealized) face.line = `${face.line} · idealizes ${face.idealized}`;
    }
  } else if (kind === 'pirate') {
    const r = (tables['diamonds_2_to_9_pirates'] as Record<string, unknown>)[p.rank];
    if (isObj(r)) {
      face.spaceAttack = asNum(r['space_attack']);
      face.stats = [
        { k: 'ground', v: `+${asNum(r['ground_attack'])}` }, { k: 'crew', v: String(asNum(r['capacity'])) },
        { k: 'speed', v: `+${asNum(r['speed'])}` }, { k: 'handl.', v: String(asNum(r['handling'])) }, { k: 'hack', v: String(asNum(r['min_hacking'])) },
      ];
      if (!face.title) face.title = 'Pirates';
      const special = asStr(r['special']);
      if (special && SPECIAL[special]) face.line = SPECIAL[special]!;
      if (!face.line) face.line = 'Fight, flee, hack or slip past';
    }
  } else if (kind === 'ruin') {
    face.depth = asNum((tables['diamonds_10_J_Q_K_A_ruin_depths'] as Record<string, unknown>)[p.rank]);
    if (!face.title) face.title = 'Ruin';
    face.line = face.line ? `${face.line} Enter, or fly on.` : 'Enter, or fly on.';
  } else if (kind === 'hazard') {
    const h = (tables['spades_hazards'] as Record<string, unknown>)[p.rank];
    const byStat = isObj(rd['hazard_consequence_by_stat']) ? rd['hazard_consequence_by_stat'] : {};
    const stats = isObj(rd['ability_stats']) ? rd['ability_stats'] : {};
    if (isObj(h)) {
      face.options = [h['option1'], h['option2']].filter(isObj).map((o) => {
        const ability = asStr(o['ability']);
        const fail = asStr(byStat[asStr(stats[ability])]) as Fail | '';
        return { head: `${ability} ${asNum(o['min_roll'])}`, tail: fail ? FAIL_TEXT[fail] ?? fail : '', ...(fail ? { fail } : {}) };
      });
      if (!face.title) face.title = 'Hazard';
      face.line = 'Pick a way through · 1 XP';
    }
  } else {
    const c = (tables['clubs_missions'] as Record<string, unknown>)[p.rank];
    if (isObj(c)) {
      face.options = (c['kind'] === 'ruins' ? [c['mission']] : [c['option1'], c['option2']]).map(mission).filter((o): o is { head: string; tail: string } => o !== null);
      if (!face.title) face.title = 'Job';
      if (c['kind'] === 'ruins') face.line = face.line ? `${face.line} No ability needed.` : 'No ability needed.';
    }
  }
  return face;
}

/** What each failure costs, in the board's words, and its icon. */
export const FAIL_TEXT: Record<Fail, string> = { ship_damage: 'ship damage', lose_credits: 'lose credits', crew_unrest: 'crew unrest', death: 'death check' };
export const FAIL_ICON: Record<Fail, IconName> = { ship_damage: 'crack', lose_credits: 'credits', crew_unrest: 'convince', death: 'disintegrate' };

/** The kind's word, icon and colour token (Cards.dc.html). */
export const KIND: Record<CardKind, { word: string; icon: IconName; colour: string }> = {
  recruit: { word: 'Recruit', icon: 'being', colour: 'var(--ww-recruit)' },
  pirate: { word: 'Pirates', icon: 'skull', colour: 'var(--ww-pirate)' },
  ruin: { word: 'Ruin', icon: 'silo', colour: 'var(--ww-ruin)' },
  hazard: { word: 'Hazard', icon: 'meteorimpact', colour: 'var(--ww-hazard)' },
  job: { word: 'Job', icon: 'satcom', colour: 'var(--ww-job)' },
};

/** The picture in a card's ring: one shape per card, chosen on the board. */
const PIRATE_ART: Partial<Record<Rank, IconName>> = { '2': 'ufo', '3': 'scout', '4': 'starfighter', '5': 'interceptor', '6': 'shuttle', '7': 'strafe', '8': 'lunar', '9': 'rocketship' };
const HAZARD_ART: Record<Rank, IconName> = { A: 'meteorimpact', '2': 'asteroid', '3': 'blackhole', '4': 'bug', '5': 'spiky', '6': 'vortex', '7': 'bubble', '8': 'eclipse', '9': 'explplanet', '10': 'bolt', J: 'evilmoon', Q: 'rays', K: 'egg' };
const JOB_ART: Record<Rank, IconName> = { '2': 'satcom', '3': 'radar', '4': 'beam', '5': 'observ', '6': 'defsat', '7': 'curiosity', '8': 'ringed', '9': 'orbrays', '10': 'starcycle', J: 'conquest', Q: 'conquest', K: 'conquest', A: 'conquest' };

export function artFor(face: TravelCardFace): IconName {
  switch (face.kind) {
    case 'pirate': return PIRATE_ART[face.rank] ?? 'ship';
    case 'ruin': return 'silo';
    case 'hazard': return HAZARD_ART[face.rank];
    case 'job': return JOB_ART[face.rank];
    default: return face.race === 'kralkin' ? 'suit' : 'helmet';
  }
}

/** Every card id the engine's deck holds, rank-major by suit, from the tables it publishes. */
export function deckIds(reference: GameReferenceResponse | null): string[] {
  const rd = reference?.referenceData;
  if (!isObj(rd) || !isObj(rd['travel_tables'])) return [];
  const ids: string[] = [];
  for (const suit of ['H', 'D', 'S', 'C'] as Suit[]) for (const rank of RANKS) if (kindOf(rank, suit, rd['travel_tables'])) ids.push(`${rank}${suit}`);
  return ids;
}

/** The discard pile's entries as the view spells them ("3♠"), kept for the id. */
export function codesOf(list: unknown): string[] {
  return asArr(list).map((x) => asStr(x)).filter(Boolean);
}
