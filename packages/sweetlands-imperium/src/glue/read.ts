// Read a Sweetlands Imperium view (zekel src/games/sweetlands-imperium/views.ts)
// into what the candy table draws. Everything here is a reading of the view or
// of the engine's reference data; nothing is worked out from the rules.

import type { GameReferenceResponse } from '@zekel/wire-types';
import type { GlueInput } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj, words } from '@zekel/glue-kit';
import type { FactionKey, UnitKey } from './art.js';
import type { Region } from './geometry.js';

export const UNITS: UnitKey[] = ['leader', 'knight', 'ambassador'];
export const UNIT_NAME: Record<UnitKey, string> = { leader: 'Leader', knight: 'Knight', ambassador: 'Ambassador' };

/** The printed faction looks, by the engine's faction id. Quiche (the Nomads) is not designed yet. */
export const FACTION_LOOK: Record<FactionKey, { short: string; color: string; tint: string; border: string; portrait: string }> = {
  milkshake: { short: 'Milkshake', color: '#f5a623', tint: '#fdebc8', border: '#f5a623', portrait: '/art/sweetlands/sweet-milkshake.jpg' },
  fudge: { short: 'Fudge', color: '#8b5a2b', tint: '#efe0d0', border: '#8b5a2b', portrait: '/art/sweetlands/sweet-fudge.jpg' },
  jellybean: { short: 'Jellybean', color: '#9013fe', tint: '#efe0ff', border: '#9013fe', portrait: '/art/sweetlands/sweet-jellybean.jpg' },
  cheesecake: { short: 'Cheesecake', color: '#f0f0f0', tint: '#f4f1ea', border: '#9a9180', portrait: '/art/sweetlands/sweet-cheesecake.jpg' },
};

/** Each land's outline color (the region's), from the canvas. */
export const LAND_EDGE: Record<Region, string> = { 1: '#f5a623', 2: '#8b5a2b', 3: '#9013fe', 4: '#8a8270' };

/** The printed board: whose home each region is, and each region's own treat. */
export const REGION_HOME: Record<Region, FactionKey> = { 1: 'milkshake', 2: 'fudge', 3: 'jellybean', 4: 'cheesecake' };
export const REGION_TREAT: Record<Region, string> = { 1: 'milkshake', 2: 'fudge', 3: 'jellybean', 4: 'cheesecake' };

export const TREAT_ART: Record<string, string> = {
  milkshake: '/art/sweetlands/treat-milkshake-1.png',
  ice_cream: '/art/sweetlands/treat-milkshake-2.png',
  fudge: '/art/sweetlands/treat-fudge-1.png',
  chocolate_bar: '/art/sweetlands/treat-fudge-2.png',
  jellybean: '/art/sweetlands/treat-jellybean-1.png',
  gummy_bear: '/art/sweetlands/treat-jellybean-2.png',
  cheesecake: '/art/sweetlands/treat-cheesecake-1.png',
  cupcake: '/art/sweetlands/treat-cheesecake-2.png',
  quiche: '/art/sweetlands/treat-quiche-1.png',
  tomato: '/art/sweetlands/treat-quiche-2.png',
};

export interface UnitLocation {
  zone: 'offboard' | 'start' | 'ring' | 'road' | 'castle' | 'treat';
  region?: number;
  ringIndex?: number;
  roadIndex?: number;
  slotKind?: 'regional' | 'random';
}

/** The board tile a unit stands on (sweetlands-board ids), or null off the board. */
export function tileOf(loc: UnitLocation | null | undefined): string | null {
  if (!loc) return null;
  const r = loc.region;
  if (loc.zone === 'ring' && typeof r === 'number' && typeof loc.ringIndex === 'number') return `r${r}-ring-${loc.ringIndex}`;
  if (loc.zone === 'road' && typeof r === 'number' && typeof loc.roadIndex === 'number') return `r${r}-road-${loc.roadIndex}`;
  if (loc.zone === 'treat' && typeof r === 'number') return `r${r}-treat-${loc.slotKind ?? 'regional'}`;
  if (loc.zone === 'start' && typeof r === 'number') return `r${r}-start`;
  if (loc.zone === 'castle') return 'castle';
  return null;
}

export interface SlPlayer {
  pid: string;
  faction: FactionKey | null; // null for the Nomads, or before factions are seated
  factionId: string;
  name: string; // the engine's faction name
  homeRegion: Region | null;
  points: number;
  influence: number;
  sugar: number;
  handCount: number;
  tokens: string[];
  units: Record<UnitKey, UnitLocation | null>;
  isMe: boolean;
  active: boolean;
  ai: boolean;
}

export interface SlCard {
  cardId: string;
  kind: 'single' | 'double' | 'treat';
  color: string; // '' for a treat
  treat: string; // '' for a color card
}

export interface SlTable {
  phase: string;
  round: number;
  step: string; // your turn step, '' when it is not your turn
  activePid: string;
  players: SlPlayer[];
  me: SlPlayer | null;
  taxes: Record<Region, number>;
  foe: { type: string; dice: number | null; defeated: boolean } | null;
  castleOccupant: string;
  randomTreat: Record<Region, string>;
  deckCount: number;
  discardCount: number;
  hand: SlCard[] | null;
  secrets: string[];
  pointsToWin: number | null;
  /** The most influence a player may hold, when the engine's reference data says (influence_cap). */
  influenceCap: number | null;
  seated: boolean; // factions are assigned
}

function factionKey(id: string): FactionKey | null {
  return (['milkshake', 'fudge', 'jellybean', 'cheesecake'] as const).find((k) => id.includes(k)) ?? null;
}

function foeDice(reference: GameReferenceResponse | null, type: string): number | null {
  const rd = reference?.referenceData;
  if (!isObj(rd)) return null;
  const f = asArr(rd['foes']).find((x) => isObj(x) && x['type'] === type);
  return isObj(f) && typeof f['dice'] === 'number' ? f['dice'] : null;
}

const region = (n: unknown): Region | null => (n === 1 || n === 2 || n === 3 || n === 4 ? n : null);

export function readTable(input: GlueInput): SlTable | null {
  const view = input.view;
  if (!isObj(view) || !Array.isArray(view['players'])) return null;
  const phase = asStr(view['phase']);
  const activePid = asStr(view['active_player_id']);
  const seated = phase !== 'setup_factions';
  const players: SlPlayer[] = asArr(view['players']).filter(isObj).map((p) => {
    const pid = asStr(p['player_id']);
    const factionId = asStr(p['faction']);
    const locs = isObj(p['unit_locations']) ? p['unit_locations'] : {};
    const unitAt = (u: UnitKey) => (isObj(locs[u]) ? (locs[u] as unknown as UnitLocation) : null);
    return {
      pid,
      faction: seated ? factionKey(factionId) : null,
      factionId,
      name: seated ? asStr(p['faction_name'], words(factionId)) : pid,
      homeRegion: seated ? region(p['home_region']) : null,
      points: asNum(p['points']),
      influence: asNum(p['influence']),
      sugar: asNum(p['sugar_cubes']),
      handCount: asNum(p['hand_count']),
      tokens: asArr(p['intel_tokens']).map((t) => asStr(t)).filter(Boolean),
      units: { leader: unitAt('leader'), knight: unitAt('knight'), ambassador: unitAt('ambassador') },
      isMe: pid === input.playerId,
      active: pid === activePid,
      ai: p['kind'] === 'ai',
    };
  });
  const taxesRaw = isObj(view['taxes']) ? view['taxes'] : {};
  const placement = isObj(view['random_treat_placement']) ? view['random_treat_placement'] : {};
  const foe = isObj(view['foe']) && asStr(view['foe']['type'])
    ? { type: asStr(view['foe']['type']), dice: foeDice(input.reference, asStr(view['foe']['type'])), defeated: view['foe']['defeated'] === true }
    : null;
  const rd = input.reference?.referenceData;
  const hand = Array.isArray(view['your_hand'])
    ? (view['your_hand'] as unknown[]).filter(isObj).map((c) => ({
        cardId: asStr(c['card_id']),
        kind: (c['kind'] === 'double' ? 'double' : c['kind'] === 'treat' ? 'treat' : 'single') as SlCard['kind'],
        color: asStr(c['color']),
        treat: asStr(c['treat']),
      }))
    : null;
  return {
    phase,
    round: asNum(view['round'], 1),
    step: asStr(view['your_turn_step']),
    activePid,
    players,
    me: players.find((p) => p.isMe) ?? null,
    taxes: { 1: asNum(taxesRaw['1']), 2: asNum(taxesRaw['2']), 3: asNum(taxesRaw['3']), 4: asNum(taxesRaw['4']) },
    foe,
    castleOccupant: asStr(view['castle_occupant_id']),
    randomTreat: { 1: asStr(placement['1']), 2: asStr(placement['2']), 3: asStr(placement['3']), 4: asStr(placement['4']) },
    deckCount: asNum(view['intel_deck_count']),
    discardCount: asNum(view['intel_discard_count']),
    hand,
    secrets: asArr(view['your_secret_objectives']).map((x) => asStr(x)).filter(Boolean),
    pointsToWin: isObj(rd) && typeof rd['points_to_win'] === 'number' ? rd['points_to_win'] : null,
    influenceCap: isObj(rd) && typeof rd['influence_cap'] === 'number' ? rd['influence_cap'] : null,
    seated,
  };
}

export function treatName(id: string): string {
  return id ? words(id) : 'a random treat';
}
