// Warble Way Galaxy's view, read into what the screen draws (build item 5).
// Everything here is read off the engine's view and its reference data;
// nothing is worked out. The view is the engine's getView (zekel-games,
// warble-way-galaxy/views.ts): a solo game, so the captain's view is the
// whole table. A field the view does not carry reads as empty, never as a
// guess.

import type { GameReferenceResponse, LegalMove } from '@zekel/wire-types';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { travelCard, type TravelCardFace } from './cards.js';
import { readLastRoll, readRollFacts, type LastRoll, type RollFacts } from './facts.js';

export interface Ability { code: string; name: string; stat: string; natural: number; effective: number }
export interface Being {
  /** the label the engine's moves address this being by */
  name: string;
  /** the name to show: the one on their row or card when the engine has one, else the label */
  title: string;
  race: string;
  /** the captain, as opposed to a crew member */
  captain: boolean;
  abilities: Ability[];
  skills: string[];
  anger: number;
  equipped: Record<string, string>;
}
export interface Captain extends Being {
  level: number; xp: number; xpToNext: number; credits: number; wounded: boolean; dread: number;
}
export interface Ship { name: string; capacity: number; speed: number; handling: number; armor: number; damage: string; parts: string[]; /** hits until the ship is destroyed, that one included; absent when the engine does not say */ hitsToLost?: number }
export interface Item { id: string; name: string; /** the shop's name for it, else the printed label */ title: string; type: string; consumed: boolean; /** what it does, in the engine's line */ effect: string; /** the label of the being wearing it */ wornBy: string | null; /** a ship part, fitted */ fitted: boolean }
export interface Leg { position: string; purpose: string; kind: string; missionId?: string; cardsRemaining: number; current: boolean }
export interface HabitatRow { index: number; name: string; title: string; meta: string; status: string; id?: string }
export interface Habitat {
  number: number; name: string;
  shop: Array<HabitatRow & { cost: number; type: string; effect: string }>;
  cantina: Array<HabitatRow & { race: string; idealized: string; need: number; chips: string[] }>;
  missions: Array<HabitatRow & { ability?: string; need?: number; depth?: number; distance: number; credits: number; xp: number }>;
  progression: string;
  repairRoll: boolean; unrestRoll: boolean; docksRoll: boolean; fabricate: boolean;
}
export interface Combat {
  card: string; rank: string; stage: string; rerollUsed: boolean; volleyUsed: boolean; redlineUsed: boolean; survivorsUsed: boolean;
  pirateDebuff: number; playerBuff: number; face: TravelCardFace | null;
}
export interface RuinAttack { ability: string; bonus: number; range: number; advantage: boolean }
export interface RuinToken {
  name: string; title: string; cell: string; moved: number; acted: boolean; ended: boolean; captain: boolean; unnamed: boolean;
  /** from the engine, when it says: movement this round, squares it can end on, how it attacks */
  moveAllowance?: number; movesLeft?: number; reach: string[]; attack?: RuinAttack;
}
export interface RuinCandidate { name: string; title: string; kind: string; moveAllowance: number; attack: RuinAttack }
export interface RuinAttacker { id: string; atk: number; move: number; range: number; xp?: number; cell: string; defeated: boolean; index: number }
export interface Ruin {
  map: string; level: number; targetDepth: number; purpose: string; status: string;
  round: number; threat: number; startCell: string;
  /** the base map's rows (legend letters), from the reference data */
  rows: string[];
  party: RuinToken[]; attackers: RuinAttacker[]; spent: string[];
  attackerTurn: number | null;
  goalCell: string | null;
  /** before setup: how each being who could go in would move and fight */
  candidates: RuinCandidate[];
}
export interface Pending { kind: string; [k: string]: unknown }

export interface WwTable {
  phase: string;
  pending: Pending | null;
  me: Captain | null;
  crew: Being[];
  unnamed: number;
  /** the most red shirts the crew can hold; null when the engine does not say */
  unnamedCap: number | null;
  /** the open roll, worked out by the engine */
  rollFacts: RollFacts | null;
  /** the roll the last move resolved */
  lastRoll: LastRoll | null;
  ship: Ship | null;
  items: Item[];
  endings: Record<string, string>;
  habitat: Habitat | null;
  journey: Leg[];
  combat: Combat | null;
  ruin: Ruin | null;
  deck: { draw: number; discardCount: number; discard: string[] };
  peek: string[];
  bulkheadsSpent: boolean;
  /** the card the table is resolving, if the pending names one, else the last discard */
  card: TravelCardFace | null;
  cardIsLive: boolean;
  result: unknown;
}

/** "SWA (Swashbuckling)" per stat, from the reference data; the stats in the printed order. */
export function statGroups(reference: GameReferenceResponse | null): Array<{ stat: string; abilities: Array<{ code: string; name: string }> }> {
  const rd = reference?.referenceData;
  const stats = isObj(rd) && isObj(rd['stats']) ? rd['stats'] : {};
  return Object.entries(stats).map(([stat, list]) => ({
    stat,
    abilities: asArr(list).map((x) => { const m = /^(\w+)\s*\((.*)\)$/.exec(asStr(x)); return m ? { code: m[1]!, name: m[2]! } : { code: asStr(x), name: asStr(x) }; }),
  }));
}

function abilitiesOf(v: unknown): Ability[] {
  if (!isObj(v)) return [];
  return Object.entries(v).map(([code, a]) => isObj(a)
    ? { code, name: asStr(a['name'], code), stat: asStr(a['stat']), natural: asNum(a['natural']), effective: asNum(a['effective'], asNum(a['natural'])) }
    : { code, name: code, stat: '', natural: asNum(a), effective: asNum(a) });
}

function being(v: Record<string, unknown>, captain: boolean): Being {
  return {
    name: asStr(v['name']), title: asStr(v['title'], asStr(v['name'])), race: asStr(v['race']), captain,
    abilities: abilitiesOf(v['abilities']),
    skills: asArr(v['skills']).map((s) => asStr(s)),
    anger: asNum(v['anger_tokens']),
    equipped: isObj(v['equipped']) ? Object.fromEntries(Object.entries(v['equipped']).map(([k, x]) => [k, asStr(x)])) : {},
  };
}

/** The printed row the view's habitat lists line up with, from the reference data. */
function habitatRef(reference: GameReferenceResponse | null, number: number): Record<string, unknown> | null {
  const rd = reference?.referenceData;
  const habs = isObj(rd) && isObj(rd['habitats']) ? rd['habitats'] : {};
  const h = habs[String(number)];
  return isObj(h) ? h : null;
}

function readHabitat(v: Record<string, unknown>, reference: GameReferenceResponse | null): Habitat {
  const number = asNum(v['number']);
  const ref = habitatRef(reference, number);
  const refShop = ref ? asArr(ref['shop']).filter(isObj) : [];
  const refCantina = ref ? asArr(ref['cantina']).filter(isObj) : [];
  const refMissions = ref ? asArr(ref['missions']).filter(isObj) : [];
  return {
    number, name: asStr(v['name']),
    shop: asArr(v['shop']).filter(isObj).map((s, i) => {
      const r = refShop[i];
      const effect = r && isObj(r['effect']) ? r['effect'] : {};
      const eff = effect['kind'] === 'ability_bonus' ? `+${asNum(effect['bonus'])} ${asStr(effect['ability'])}`
        : effect['kind'] === 'ship_stat' ? `+${asNum(effect['bonus'])} ${asStr(effect['stat'])}`
          : asStr(effect['kind']).replace(/_/g, ' ');
      return { index: i, id: r ? asStr(r['id']) : undefined, name: asStr(s['name']), title: r ? asStr(r['title'], asStr(s['name'])) : asStr(s['name']), cost: asNum(s['cost']), type: r ? asStr(r['type']) : '', effect: eff, meta: `${r ? asStr(r['type']).replace(/_/g, ' ') : ''}${eff ? ` · ${eff}` : ''}`, status: s['purchased'] ? 'sold' : 'available' };
    }),
    cantina: asArr(v['cantina']).filter(isObj).map((c, i) => {
      const r = refCantina[i];
      const abil = r && isObj(r['abilities']) ? Object.entries(r['abilities']).map(([a, n]) => `+${asNum(n)} ${a}`) : [];
      const race = r ? asStr(r['race']) : asStr(c['recruit']).split(' ')[0]?.toLowerCase() ?? '';
      const status = asStr(c['status']);
      return { index: i, id: r ? asStr(r['id']) : undefined, name: r ? asStr(r['name'], race) : asStr(c['recruit']), title: r ? asStr(r['name'], race) : asStr(c['recruit']), race, idealized: r ? asStr(r['idealized']) : '', need: r ? asNum(r['min_roll']) : 0, chips: abil, meta: asStr(c['recruit']), status: status.startsWith('hired') ? 'hired' : status.startsWith('permanently') ? 'marked' : 'available' };
    }),
    missions: asArr(v['missions']).filter(isObj).map((m, i) => {
      const r = refMissions.find((x) => asStr(x['id']) === asStr(m['id'])) ?? refMissions[i];
      const goal = r && isObj(r['goal']) ? r['goal'] : {};
      const status = asStr(m['status']);
      return {
        index: i, id: asStr(m['id']), name: asStr(m['mission']), title: r ? asStr(r['title'], asStr(m['mission'])) : asStr(m['mission']), meta: asStr(m['mission']),
        ability: goal['kind'] === 'ability_check' ? asStr(goal['ability']) : undefined, need: goal['kind'] === 'ability_check' ? asNum(goal['min_roll']) : undefined,
        depth: goal['kind'] === 'ruin' ? asNum(goal['depth']) : undefined,
        distance: r ? asNum(r['distance']) : 0, credits: r ? asNum(r['credits']) : 0, xp: r ? asNum(r['xp']) : 0,
        status: status.startsWith('succeeded') ? 'passed' : status.startsWith('attempted') ? 'failed' : 'available',
      };
    }),
    progression: asStr(v['progression']),
    repairRoll: v['repair_roll_available'] === true, unrestRoll: v['unrest_roll_available'] === true,
    docksRoll: v['docks_unnamed_roll_available'] === true, fabricate: v['fabrication_available_this_visit'] === true,
  };
}

const readAttack = (a: unknown): RuinAttack => (isObj(a) ? { ability: asStr(a['ability']), bonus: asNum(a['bonus']), range: asNum(a['range']), advantage: a['advantage'] === true } : { ability: '', bonus: 0, range: 1, advantage: false });

function readRuin(v: Record<string, unknown>, reference: GameReferenceResponse | null): Ruin {
  const rd = reference?.referenceData;
  const maps = isObj(rd) && isObj(rd['ruins']) && isObj(rd['ruins']['maps']) ? rd['ruins']['maps'] : {};
  const map = asStr(v['map']);
  const def = isObj(maps[map]) ? maps[map] : {};
  const grid = isObj(def['grid']) ? asArr(def['grid']['rows']).map((r) => asStr(r)) : [];
  return {
    map, level: asNum(v['level'], 1), targetDepth: asNum(v['target_depth'], 1), purpose: asStr(v['purpose']), status: asStr(v['status']),
    round: asNum(v['round']), threat: asNum(v['threat_level']), startCell: asStr(v['start_cell']), rows: grid,
    party: asArr(v['party']).filter(isObj).map((t) => ({
      name: asStr(t['name']), title: asStr(t['title'], asStr(t['name'])), cell: asStr(t['cell']), moved: asNum(t['moved']), acted: t['acted'] === true, ended: t['ended'] === true, captain: t['is_character'] === true, unnamed: t['unnamed'] === true,
      ...(typeof t['move_allowance'] === 'number' ? { moveAllowance: t['move_allowance'] } : {}), ...(typeof t['moves_left'] === 'number' ? { movesLeft: t['moves_left'] } : {}),
      reach: asArr(t['reach']).map((c) => asStr(c)),
      ...(isObj(t['attack']) ? { attack: readAttack(t['attack']) } : {}),
    })),
    attackers: asArr(v['attackers']).filter(isObj).map((a, i) => ({ id: asStr(a['id']), atk: asNum(a['atk']), move: asNum(a['move']), range: asNum(a['range']), ...(typeof a['xp'] === 'number' ? { xp: a['xp'] } : {}), cell: asStr(a['cell']), defeated: a['defeated'] === true, index: i })),
    spent: asArr(v['spots_spent']).map((c) => asStr(c)),
    attackerTurn: typeof v['attacker_turn_index'] === 'number' ? v['attacker_turn_index'] : null,
    goalCell: typeof v['goal_cell'] === 'string' ? v['goal_cell'] : null,
    candidates: asArr(v['candidates']).filter(isObj).map((c) => ({ name: asStr(c['name']), title: asStr(c['title'], asStr(c['name'])), kind: asStr(c['kind']), moveAllowance: asNum(c['move_allowance']), attack: readAttack(c['attack']) })),
  };
}

/** The card the pending or the encounter names, as the engine ids it ("7S"). */
export function liveCardId(view: Record<string, unknown>): string | null {
  const p = isObj(view['pending']) ? view['pending'] : null;
  if (p) {
    for (const k of ['card_id', 'hazard_card_id', 'evade_card_id']) if (typeof p[k] === 'string') return p[k] as string;
    const ctx = isObj(p['context']) ? p['context'] : {};
    for (const k of ['hazard_card_id', 'evade_card_id']) if (typeof ctx[k] === 'string') return ctx[k] as string;
    // The roll names the recruit ("heart-8"); its card is the same rank of hearts.
    if (asStr(ctx['recruit_source']) === 'space' && typeof ctx['recruit_id'] === 'string') return `${(ctx['recruit_id'] as string).replace(/^heart-/, '')}H`;
  }
  const sc = isObj(view['space_combat']) ? view['space_combat'] : null;
  if (sc) return asStr(sc['pirate']).replace('♦', '') + 'D';
  const ruin = isObj(view['ruin']) ? view['ruin'] : null;
  if (ruin && asStr(ruin['purpose']) === 'discovery') return null;
  return null;
}

export function readTable(view: unknown, reference: GameReferenceResponse | null): WwTable | null {
  if (!isObj(view) || !('travel_deck' in view || 'character' in view || 'ship' in view)) return null;
  const ch = isObj(view['character']) ? view['character'] : null;
  const me: Captain | null = ch ? {
    ...being(ch, true),
    level: asNum(ch['level'], 1), xp: asNum(ch['xp']), xpToNext: asNum(ch['xp_to_next_level']), credits: asNum(ch['credits']),
    wounded: ch['wounded'] === true, dread: asNum(ch['dread']),
  } : null;
  const sh = isObj(view['ship']) ? view['ship'] : null;
  const td = isObj(view['travel_deck']) ? view['travel_deck'] : {};
  const discard = asArr(td['discard']).map((x) => asStr(x));
  const live = liveCardId(view);
  const cardId = live ?? discard[discard.length - 1] ?? null;
  const sc = isObj(view['space_combat']) ? view['space_combat'] : null;
  const journey = isObj(view['journey']) ? asArr(view['journey']['legs']).filter(isObj) : [];
  return {
    phase: asStr(view['phase']),
    pending: isObj(view['pending']) ? (view['pending'] as Pending) : null,
    me,
    crew: asArr(view['crew']).filter(isObj).map((c) => being(c, false)),
    unnamed: asNum(view['unnamed_crew']),
    unnamedCap: typeof view['unnamed_crew_cap'] === 'number' ? view['unnamed_crew_cap'] : null,
    rollFacts: readRollFacts(view['roll_facts']),
    lastRoll: readLastRoll(view['last_roll']),
    ship: sh ? { name: asStr(sh['name']), capacity: asNum(sh['capacity']), speed: asNum(sh['speed']), handling: asNum(sh['handling']), armor: asNum(sh['armor']), damage: asStr(sh['damage']), parts: asArr(sh['parts']).map((p) => asStr(p)), ...(typeof sh['hits_to_lost'] === 'number' ? { hitsToLost: sh['hits_to_lost'] } : {}) } : null,
    items: asArr(view['items']).filter(isObj).map((i) => ({ id: asStr(i['id']), name: asStr(i['name']), title: asStr(i['title'], asStr(i['name'])), type: asStr(i['type']), consumed: i['consumed'] === true, effect: asStr(i['effect']), wornBy: typeof i['worn_by'] === 'string' ? i['worn_by'] : null, fitted: i['fitted'] === true })),
    endings: isObj(view['season_endings']) ? Object.fromEntries(Object.entries(view['season_endings']).map(([k, x]) => [k, asStr(x)])) : {},
    habitat: isObj(view['habitat']) ? readHabitat(view['habitat'], reference) : null,
    journey: journey.map((l) => ({ position: asStr(l['position']), purpose: asStr(l['purpose']), kind: asStr(l['kind']), ...(typeof l['mission_id'] === 'string' ? { missionId: l['mission_id'] } : {}), cardsRemaining: asNum(l['cards_remaining']), current: asStr(l['position']) === 'current' })),
    combat: sc ? {
      card: asStr(sc['pirate']), rank: asStr(sc['pirate']).replace('♦', ''), stage: asStr(sc['stage']),
      rerollUsed: sc['flying_ace_reroll_used'] === true, volleyUsed: sc['opening_volley_used'] === true, redlineUsed: sc['redline_used'] === true, survivorsUsed: sc['survivors_roll_used'] === true,
      pirateDebuff: asNum(sc['pirate_debuff']), playerBuff: asNum(sc['player_buff']),
      face: travelCard(`${asStr(sc['pirate']).replace('♦', '')}D`, reference),
    } : null,
    ruin: isObj(view['ruin']) ? readRuin(view['ruin'], reference) : null,
    deck: { draw: asNum(td['cards_in_draw_pile']), discardCount: asNum(td['cards_in_discard']), discard },
    peek: asArr(view['res_peek']).map((x) => asStr(x)),
    bulkheadsSpent: view['bulkheads_spent'] === true,
    card: cardId ? travelCard(cardId, reference) : null,
    cardIsLive: live !== null,
    result: view['result'] ?? null,
  };
}

/** The listed move with this id, or the first whose id starts with it. */
export function moveById(moves: LegalMove[], id: string): LegalMove | undefined {
  return moves.find((m) => m.move_id === id) ?? moves.find((m) => (m.move_id ?? '').startsWith(id));
}

/** "best aboard: +2" from a listed move's words, when the engine says it; display only. */
export function bestAboardIn(description: string | undefined): number | null {
  const m = /best aboard:\s*\+(\d+)/.exec(description ?? '');
  return m ? Number(m[1]) : null;
}

/** The chevron plates of the damage track, as the boards draw them: four
 *  plates, the lit ones left of the damage level, from the engine's levels. */
export const DAMAGE_LEVELS = ['pristine', 'used', 'damaged', 'hobbled'] as const;
export function platesLit(damage: string): number {
  const i = DAMAGE_LEVELS.indexOf(damage as (typeof DAMAGE_LEVELS)[number]);
  return i < 0 ? 0 : DAMAGE_LEVELS.length - i;
}

/** A cell id ("r5c3") to row and column, 1-based. */
export function cellRC(cell: string): { r: number; c: number } | null {
  const m = /^r(\d+)c(\d+)$/i.exec(cell.trim());
  return m ? { r: Number(m[1]), c: Number(m[2]) } : null;
}
export const cellId = (r: number, c: number) => `r${r}c${c}`;
