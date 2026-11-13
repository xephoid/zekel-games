// Reads what the rulebook page draws from the game's reference data
// (getReferenceData in the rules half): the rulebook's words, the maps, the
// unit and treaty catalogues, the battle deck and the victory numbers. Nothing
// here works out a rule; it only checks the shapes and names the fields.

import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';

export type LayoutKey = '2p' | '3-4p' | '5-6p';
export const LAYOUTS: LayoutKey[] = ['2p', '3-4p', '5-6p'];
export type ByLayout<T> = Record<LayoutKey, T>;

export interface Tile { c: number; r: number; resource: string; label: string; start: number | null }
export interface Unit { name: string; species: string; cost: Record<string, number>; init: number | null; dmg: number | null; def: number | null; notes: string }
export interface Treaty { name: string; culture: number; breaking: string }
export interface BattleCard { kind: string; effect: string; copies: number }
export interface LadderRung { name: string; species: string; init: number; dmg: number; def: number }

export interface RulebookText {
  title: string;
  intro: string;
  facts: string[];
  players_by_layout: ByLayout<number[]>;
  victory: { intro: string; military: string; cultural: string; economic: string; technological: string; economic_mix: Record<string, number> };
  components: Array<{ icon: string; name: string; count: number | ByLayout<number>; text: string | ByLayout<string> }>;
  map: { intro: string };
  setup: {
    steps: string[];
    wizard: { faction: string; factions: string; pieces: Array<{ icon: string; count: number; name: string }>; note: string };
    robot: { faction: string; factions: string; pieces: Array<{ icon: string; count: number; name: string }>; note: string };
  };
  round: {
    steps: Array<{ icon: string; name: string; text: string }>;
    note: string;
    stack: { title: string; intro: string; steps: string[]; cards: Array<{ faction: string; action: string; placed: string }> };
    milestones: { intro: string };
  };
  paying: { title: string; intro: string; example: { title: string; buys: string; steps: string[]; figure: Figure } };
  battle: { title: string; intro: string; ladder_title: string; example: { title: string; units: string[]; steps: string[] } };
  treaties: { intro: string; chart: Array<{ treaty: string; allies: boolean; collection: boolean; hands: boolean; victory: boolean }> };
  units: { note: string };
}

export interface Figure {
  tiles: Array<{ c: number; r: number; resource: string; label: string }>;
  pieces: Array<{ c: number; r: number; faction: string; icon: string; name: string; placed: boolean }>;
  caption: string;
}

export interface RulebookData {
  text: RulebookText;
  maps: ByLayout<Tile[]>;
  wizardUnits: Unit[];
  robotUnits: Unit[];
  treaties: Treaty[];
  deck: BattleCard[];
  ladder: LadderRung[];
  victory: {
    milestones: Record<number, number[]>;
    cultureTarget: Record<number, number>;
    kills: Record<number, number>;
    economicCollectors: ByLayout<number>;
    tech: number;
  };
}

const LAYOUT_IDS: ByLayout<string> = { '2p': 'two', '3-4p': 'threeFour', '5-6p': 'fiveSix' };
const numOrNull = (x: unknown): number | null => (typeof x === 'number' ? x : null);
const costOf = (x: unknown): Record<string, number> =>
  isObj(x) ? Object.fromEntries(Object.entries(x).filter(([, v]) => typeof v === 'number') as Array<[string, number]>) : {};
const numRecord = (x: unknown): Record<number, number> =>
  isObj(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [Number(k), asNum(v)])) : {};

function units(x: unknown): Unit[] {
  return asArr(x).filter(isObj).map((u) => ({
    name: asStr(u['name']), species: asStr(u['species']), cost: costOf(u['cost']),
    init: numOrNull(u['init']), dmg: numOrNull(u['dmg']), def: numOrNull(u['def']), notes: asStr(u['notes']),
  }));
}

/** The rulebook page's data, or null when the reference has no rulebook or is missing part of what the page draws. */
export function readRulebook(referenceData: unknown): RulebookData | null {
  if (!isObj(referenceData) || !isObj(referenceData['rulebook'])) return null;
  const text = referenceData['rulebook'] as unknown as RulebookText;
  if (typeof text.title !== 'string' || !Array.isArray(text.components)) return null;

  const mapsIn = isObj(referenceData['maps']) ? referenceData['maps'] : {};
  const maps = Object.fromEntries(LAYOUTS.map((k) => [k, asArr(mapsIn[k]).filter(isObj).map((t) => ({
    c: asNum(t['c']), r: asNum(t['r']), resource: asStr(t['resource']), label: asStr(t['label']), start: numOrNull(t['start']),
  }))])) as ByLayout<Tile[]>;

  const wizardUnits = units(referenceData['wizard_units']);
  const robotUnits = units(referenceData['robot_units']);
  const treaties = asArr(referenceData['treaties']).filter(isObj).map((t) => ({
    name: asStr(t['name']), culture: asNum(t['cultureIncome']), breaking: asStr(t['breakingCondition']),
  }));
  // A printed label reads "Bonus (+1 DEF to all your units)": the kind, then what it does.
  const deck = asArr(referenceData['battle_deck']).filter(isObj).map((c) => {
    const label = asStr(c['label']);
    const m = /^(.*?) \((.*)\)$/.exec(label);
    return { kind: m ? m[1]! : label, effect: m ? m[2]! : asStr(c['effect']), copies: asNum(c['copies']) };
  });

  const heroes = asArr(referenceData['heroes']).filter(isObj);
  const ladder: LadderRung[] = [...wizardUnits, ...robotUnits]
    .filter((u) => u.init !== null)
    .map((u) => ({ name: u.name, species: u.species, init: u.init!, dmg: u.dmg ?? 0, def: u.def ?? 0 }));
  // The one hero with its own stat line, not its category's.
  for (const h of heroes.filter((x) => asStr(x['category']) === 'evo-angel')) {
    const s = isObj(h['stats']) ? h['stats'] : {};
    ladder.push({ name: `${asStr(h['name'])} (hero)`, species: asStr(h['species'], 'robot'), init: asNum(s['init']), dmg: asNum(s['dmg']), def: asNum(s['def']) });
  }
  ladder.sort((a, b) => b.init - a.init);

  const v = isObj(referenceData['victory']) ? referenceData['victory'] : {};
  const milestones = isObj(v['milestones_by_player_count'])
    ? Object.fromEntries(Object.entries(v['milestones_by_player_count']).map(([k, m]) => [Number(k), asArr(m).map((x) => asNum(x))]))
    : {};
  const eco = isObj(v['economic_collectors_by_layout']) ? v['economic_collectors_by_layout'] : {};
  const tech = isObj(v['tech_target']) ? asNum(v['tech_target']['wizard']) : 0;

  const data: RulebookData = {
    text, maps, wizardUnits, robotUnits, treaties, deck, ladder,
    victory: {
      milestones,
      cultureTarget: numRecord(v['culture_target_by_player_count']),
      kills: numRecord(v['military_kills_needed']),
      economicCollectors: Object.fromEntries(LAYOUTS.map((k) => [k, asNum(eco[LAYOUT_IDS[k]])])) as ByLayout<number>,
      tech,
    },
  };
  return complete(data, heroes.length) ? data : null;
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const MILESTONE_COLUMNS = 5;
const positive = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x > 0;

/**
 * Whether the data holds everything the page draws. The readers above fill a
 * missing number with 0 and a missing list with nothing, and a page showing a
 * wrong number is worse than no page: a site then shows the plain rules text.
 */
function complete(data: RulebookData, heroCount: number): boolean {
  const v = data.victory;
  const milestonesOk = (n: number) => {
    const row = v.milestones[n];
    return Array.isArray(row) && row.length === MILESTONE_COLUMNS && row.every(positive);
  };
  return PLAYER_COUNTS.every((n) => positive(v.cultureTarget[n]) && positive(v.kills[n]) && milestonesOk(n))
    && positive(v.tech)
    && LAYOUTS.every((k) => positive(v.economicCollectors[k]) && data.maps[k].length > 0)
    && heroCount > 0
    && data.wizardUnits.length > 0 && data.robotUnits.length > 0
    && data.treaties.length > 0 && data.deck.length > 0;
}

export function layoutFor(data: RulebookData, players: number): LayoutKey {
  return LAYOUTS.find((k) => data.text.players_by_layout[k].includes(players)) ?? '3-4p';
}

export function atLayout<T>(x: T | ByLayout<T>, layout: LayoutKey): T {
  return isObj(x) && layout in x ? (x as ByLayout<T>)[layout] : (x as T);
}
