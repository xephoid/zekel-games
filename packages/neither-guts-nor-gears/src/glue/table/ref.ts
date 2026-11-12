// The engine's reference data for NGnG: the printed catalogue (costs, stat
// lines, effects, treaty text, hero cards). A screen may print any of it,
// because it is what is printed on the components. Nothing here is a rule the
// client evaluates; it is the text and numbers on the cards.

import type { GameReferenceResponse } from '@zekel/wire-types';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';

export type Cost = Partial<Record<Resource, number>>;
export type Resource = 'water' | 'wood' | 'ore' | 'oil' | 'ether';
export const RESOURCES: Resource[] = ['water', 'wood', 'ore', 'oil', 'ether'];

export interface RefUnit {
  id: string; name: string; species: string; cost: Cost;
  init: number | null; dmg: number | null; def: number | null;
  maxPerPlayer: number; collector: boolean; collectorResource: string | null;
  needsCore: boolean; requiresBuilding: string | null; immobile: boolean; notes: string;
}
export interface RefBuilding { id: string; name: string; species: string; cost: Cost; isBase: boolean; repeatableMax: number | null; effect: string }
/** `either`: one more resource, any one of these, on top of `cost` (an Extra action card, ruling #86). */
export interface RefResearch { id: string; name: string; species: string; prerequisite: string; cost: Cost; either: string[]; effect: string }
/** `stats`: the printed battle stats (a Leader adds `leaderStatBonus`); null from an older engine. */
export interface RefHero { num: number; id: string; name: string; category: string; species: string | null; recommendedLeader: boolean; effect: string; stats: { init: number; dmg: number; def: number } | null }
export interface RefCard { id: string; label: string; copies: number; effect: string }
export interface RefTreaty { id: string; name: string; cultureIncome: number; effect: string; breakingCondition: string }
export interface RefFaction { id: string; name: string; species: 'wizard' | 'robot'; color: string }

export interface NggRef {
  factions: RefFaction[];
  units: RefUnit[];
  buildings: RefBuilding[];
  research: RefResearch[];
  heroes: RefHero[];
  cards: RefCard[];
  treaties: RefTreaty[];
  /** an older engine's one milestone list and culture target */
  milestones: number[];
  cultureTarget: number;
  /** the milestones and culture target by player count (they scale with it) */
  milestonesByCount: Record<number, number[]>;
  cultureTargetByCount: Record<number, number>;
  economicSpend: Cost;
  /** how many collectors, on as many different tiles, the Economic spend takes; null when not published */
  economicCollectors: number | null;
  /** the Economic spend's collector count by map layout (it scales with the map) */
  economicCollectorsByLayout: Record<string, number>;
  /** what one battle card costs on a Research action: the fixed resources, one
   *  of `either`, and the building that unlocks it per species; null when not published */
  battleCardPurchase: { cost: Cost; either: string[]; unlockedBy: Record<string, string> } | null;
  /** the building that unlocks treaty formation, per species (and a hero's name under `hero`) */
  treatyUnlockedBy: Record<string, string>;
  techTarget: Record<string, number>;
  militaryKillsNeeded: Record<string, number>;
}

function cost(x: unknown): Cost {
  if (!isObj(x)) return {};
  const out: Cost = {};
  for (const r of RESOURCES) if (typeof x[r] === 'number') out[r] = x[r] as number;
  return out;
}

function numOrNull(x: unknown): number | null {
  return typeof x === 'number' ? x : null;
}

const cache = new WeakMap<object, NggRef>();

export function readRef(reference: GameReferenceResponse | null): NggRef | null {
  if (!reference) return null;
  const hit = cache.get(reference);
  if (hit) return hit;
  const rd = reference.referenceData;
  if (!isObj(rd)) return null;
  const units = [...asArr(rd['wizard_units']), ...asArr(rd['robot_units'])].filter(isObj).map((u): RefUnit => ({
    id: asStr(u['id']), name: asStr(u['name']), species: asStr(u['species']), cost: cost(u['cost']),
    init: numOrNull(u['init']), dmg: numOrNull(u['dmg']), def: numOrNull(u['def']),
    maxPerPlayer: asNum(u['maxPerPlayer']), collector: u['collector'] === true,
    collectorResource: typeof u['collectorResource'] === 'string' ? u['collectorResource'] : null,
    needsCore: u['needsCore'] === true,
    requiresBuilding: typeof u['requiresBuilding'] === 'string' ? u['requiresBuilding'] : null,
    immobile: u['immobile'] === true, notes: asStr(u['notes']),
  }));
  const buildings = [...asArr(rd['wizard_buildings']), ...asArr(rd['robot_buildings'])].filter(isObj).map((b): RefBuilding => ({
    id: asStr(b['id']), name: asStr(b['name']), species: asStr(b['species']), cost: cost(b['cost']),
    isBase: b['isBase'] === true, repeatableMax: numOrNull(b['repeatableMax']), effect: asStr(b['effect']),
  }));
  const research = [...asArr(rd['wizard_research']), ...asArr(rd['robot_research'])].filter(isObj).map((r): RefResearch => ({
    id: asStr(r['id']), name: asStr(r['name']), species: asStr(r['species']), prerequisite: asStr(r['prerequisite']),
    cost: cost(r['cost']), either: asArr(r['either']).map((x) => asStr(x)), effect: asStr(r['effect']),
  }));
  const victory = isObj(rd['victory']) ? rd['victory'] : {};
  const out: NggRef = {
    factions: asArr(rd['factions']).filter(isObj).map((f) => ({
      id: asStr(f['id']), name: asStr(f['name']), species: f['species'] === 'robot' ? 'robot' : 'wizard', color: asStr(f['color']),
    })),
    units, buildings, research,
    heroes: asArr(rd['heroes']).filter(isObj).map((h) => ({
      num: asNum(h['num']), id: asStr(h['id']), name: asStr(h['name']), category: asStr(h['category']),
      species: typeof h['species'] === 'string' ? h['species'] : null,
      recommendedLeader: h['recommendedLeader'] === true, effect: asStr(h['effect']),
      stats: isObj(h['stats']) ? { init: asNum(h['stats']['init']), dmg: asNum(h['stats']['dmg']), def: asNum(h['stats']['def']) } : null,
    })),
    cards: asArr(rd['battle_deck']).filter(isObj).map((c) => ({ id: asStr(c['id']), label: asStr(c['label']), copies: asNum(c['copies']), effect: asStr(c['effect']) })),
    treaties: asArr(rd['treaties']).filter(isObj).map((t) => ({
      id: asStr(t['id']), name: asStr(t['name']), cultureIncome: asNum(t['cultureIncome']), effect: asStr(t['effect']), breakingCondition: asStr(t['breakingCondition']),
    })),
    milestones: asArr(victory['milestones']).map((m) => asNum(m)),
    cultureTarget: asNum(victory['culture_target'], 100),
    milestonesByCount: isObj(victory['milestones_by_player_count'])
      ? Object.fromEntries(Object.entries(victory['milestones_by_player_count']).map(([n, list]) => [Number(n), asArr(list).map((m) => asNum(m))]))
      : {},
    cultureTargetByCount: isObj(victory['culture_target_by_player_count'])
      ? Object.fromEntries(Object.entries(victory['culture_target_by_player_count']).map(([n, t]) => [Number(n), asNum(t)]))
      : {},
    economicSpend: cost(victory['economic_spend']),
    economicCollectors: typeof victory['economic_collectors'] === 'number' ? victory['economic_collectors'] : null,
    economicCollectorsByLayout: isObj(victory['economic_collectors_by_layout'])
      ? Object.fromEntries(Object.entries(victory['economic_collectors_by_layout']).map(([k, n]) => [k, asNum(n)]))
      : {},
    battleCardPurchase: isObj(rd['battle_card_purchase']) ? {
      cost: cost(rd['battle_card_purchase']['cost']),
      either: asArr(rd['battle_card_purchase']['either']).map((r) => asStr(r)),
      unlockedBy: isObj(rd['battle_card_purchase']['unlocked_by'])
        ? Object.fromEntries(Object.entries(rd['battle_card_purchase']['unlocked_by']).map(([k, b]) => [k, asStr(b)]))
        : {},
    } : null,
    treatyUnlockedBy: isObj(rd['treaty_unlocked_by']) ? Object.fromEntries(Object.entries(rd['treaty_unlocked_by']).map(([k, b]) => [k, asStr(b)])) : {},
    techTarget: isObj(victory['tech_target']) ? Object.fromEntries(Object.entries(victory['tech_target']).map(([k, v]) => [k, asNum(v)])) : {},
    militaryKillsNeeded: isObj(victory['military_kills_needed']) ? Object.fromEntries(Object.entries(victory['military_kills_needed']).map(([k, v]) => [k, asNum(v)])) : {},
  };
  cache.set(reference, out);
  return out;
}

/** Anything a build move can name: a unit or a building, by its printed name. */
export function itemByName(ref: NggRef | null, name: string): { kind: 'unit'; unit: RefUnit } | { kind: 'building'; building: RefBuilding } | null {
  if (!ref) return null;
  const u = ref.units.find((x) => x.name === name);
  if (u) return { kind: 'unit', unit: u };
  const b = ref.buildings.find((x) => x.name === name);
  return b ? { kind: 'building', building: b } : null;
}

export function heroByName(ref: NggRef | null, name: string): RefHero | null {
  return ref?.heroes.find((h) => h.name === name) ?? null;
}

export function heroById(ref: NggRef | null, id: string): RefHero | null {
  return ref?.heroes.find((h) => h.id === id) ?? null;
}

/** A research by name. The wizard and robot lists share some names (the
 *  Extra action cards) at different prices, so pass the buyer's species. */
export function researchByName(ref: NggRef | null, name: string, species?: string | null): RefResearch | null {
  const named = ref?.research.filter((r) => r.name === name) ?? [];
  return named.find((r) => r.species === species) ?? named[0] ?? null;
}

export function treatyByName(ref: NggRef | null, name: string): RefTreaty | null {
  return ref?.treaties.find((t) => t.name === name || t.id === name) ?? null;
}

/** A card by the label a move or a hand names it by ("Counter", "Bonus (+1 DEF …)"). */
export function cardByLabel(ref: NggRef | null, label: string): RefCard | null {
  return ref?.cards.find((c) => c.label === label) ?? null;
}

/** This table's culture target and milestones: the seat view's own target
 *  first, then the catalogue's entry for this many players, then an older
 *  engine's single values. */
export function cultureRaceOf(ref: NggRef | null, playerCount: number, viewTarget: number | null): { target: number; milestones: number[] } {
  const target = viewTarget ?? ref?.cultureTargetByCount[playerCount] ?? ref?.cultureTarget ?? 100;
  const milestones = ref?.milestonesByCount[playerCount] ?? ref?.milestones ?? [];
  return { target, milestones };
}

/** How many collectors, on as many tiles, the Economic spend takes on this
 *  table's map (the engine publishes it by layout), or an older engine's one number. */
export function economicCollectorsFor(ref: NggRef | null, layout: string): number | null {
  return ref?.economicCollectorsByLayout[layout] ?? ref?.economicCollectors ?? null;
}
