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
  counts: { tiles: ByLayout<number>; wizard_units: number; robot_units: number; treaties: number; battle_deck: number; heroes: number };
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

// Checks that a value is what the page draws. The reader runs them on the raw
// reference data before reading it, so a missing or wrong field (which the
// readers below would fill with 0 or '') refuses the whole rulebook, and a
// site shows the plain rules text instead of wrong numbers or a broken page.
type Check = (x: unknown) => boolean;
const isStr: Check = (x) => typeof x === 'string';
const isNum: Check = (x) => typeof x === 'number' && Number.isFinite(x);
const isBool: Check = (x) => typeof x === 'boolean';
const positive: Check = (x) => isNum(x) && (x as number) > 0;
const count: Check = (x) => Number.isInteger(x) && (x as number) > 0;
const absentOr = (ok: Check): Check => (x) => x === null || x === undefined || ok(x);
const listOf = (ok: Check): Check => (x) => Array.isArray(x) && x.length > 0 && x.every(ok);
const strs = listOf(isStr);
const has = (fields: Record<string, Check>): Check => (x) => isObj(x) && Object.entries(fields).every(([k, ok]) => ok(x[k]));
const eachLayout = (ok: Check): Check => (x) => isObj(x) && LAYOUTS.every((k) => ok(x[k]));
const amounts: Check = (x) => isObj(x) && Object.keys(x).length > 0 && Object.values(x).every(positive);

const side = has({ faction: isStr, factions: isStr, pieces: listOf(has({ icon: isStr, count, name: isStr })), note: isStr });
const figure = has({
  tiles: listOf(has({ c: isNum, r: isNum, resource: isStr, label: isStr })),
  pieces: listOf(has({ c: isNum, r: isNum, faction: isStr, icon: isStr, name: isStr, placed: isBool })),
  caption: isStr,
});
/** Every part of the rulebook's words the page reads. */
const rulebookText = has({
  title: isStr, intro: isStr, facts: strs,
  players_by_layout: eachLayout(listOf(count)),
  victory: has({ intro: isStr, military: isStr, cultural: isStr, economic: isStr, technological: isStr, economic_mix: amounts }),
  components: listOf(has({ icon: isStr, name: isStr, count: (x) => count(x) || eachLayout(count)(x), text: (x) => isStr(x) || eachLayout(isStr)(x) })),
  map: has({ intro: isStr }),
  setup: has({ steps: strs, wizard: side, robot: side }),
  round: has({
    steps: listOf(has({ icon: isStr, name: isStr, text: isStr })),
    note: isStr,
    stack: has({ title: isStr, intro: isStr, steps: strs, cards: listOf(has({ faction: isStr, action: isStr, placed: isStr })) }),
    milestones: has({ intro: isStr }),
  }),
  paying: has({ title: isStr, intro: isStr, example: has({ title: isStr, buys: isStr, steps: strs, figure }) }),
  battle: has({ title: isStr, intro: isStr, ladder_title: isStr, example: has({ title: isStr, units: strs, steps: strs }) }),
  treaties: has({ intro: isStr, chart: listOf(has({ treaty: isStr, allies: isBool, collection: isBool, hands: isBool, victory: isBool })) }),
  units: has({ note: isStr }),
  counts: has({ tiles: eachLayout(count), wizard_units: count, robot_units: count, treaties: count, battle_deck: count, heroes: count }),
});

const tile = has({ c: isNum, r: isNum, resource: isStr, label: isStr, start: absentOr(isNum) });
const STATS = ['init', 'dmg', 'def'];
/** A unit that fights has all three stats; one that does not has none. */
const unit: Check = (x) => has({ name: isStr, species: isStr, cost: amounts, notes: isStr })(x) && isObj(x)
  && (STATS.every((k) => isNum(x[k])) || STATS.every((k) => x[k] === null || x[k] === undefined));
const treaty = has({ name: isStr, cultureIncome: isNum, breakingCondition: isStr });
const BATTLE_LABEL = /^(.*?) \((.*)\)$/;
const battleCard: Check = (x) => has({ label: isStr, copies: count })(x) && isObj(x)
  && (BATTLE_LABEL.test(x['label'] as string) || isStr(x['effect']));
const hero = has({ name: isStr, category: isStr });
/** The hero the battle ladder draws with its own stat line. */
const LADDER_HERO = 'evo-angel';
const ladderHero = has({ name: isStr, species: isStr, stats: has({ init: isNum, dmg: isNum, def: isNum }) });

/** Whether a list is there whole: as many entries as the rulebook says, each one complete. */
const whole = (x: unknown, n: number, ok: Check) => Array.isArray(x) && x.length === n && x.every(ok);
const names = (x: unknown) => (x as Array<{ name: string }>).map((e) => e.name);

/** Whether the raw reference data holds every part the page draws, whole. */
function rawComplete(ref: Record<string, unknown>): boolean {
  if (!rulebookText(ref['rulebook'])) return false;
  const t = ref['rulebook'] as unknown as RulebookText;
  const n = t.counts;
  const maps = ref['maps'];
  if (!isObj(maps) || !LAYOUTS.every((k) => whole(maps[k], n.tiles[k], tile))) return false;
  if (!whole(ref['wizard_units'], n.wizard_units, unit) || !whole(ref['robot_units'], n.robot_units, unit)) return false;
  if (!whole(ref['treaties'], n.treaties, treaty) || !whole(ref['battle_deck'], n.battle_deck, battleCard)) return false;
  if (!whole(ref['heroes'], n.heroes, hero)) return false;
  const ladder = (ref['heroes'] as Array<Record<string, unknown>>).filter((h) => h['category'] === LADDER_HERO);
  if (ladder.length === 0 || !ladder.every(ladderHero)) return false;
  // Names the page looks up in the lists: each treaty in the chart, and the units the examples use.
  const treatyNames = new Set(names(ref['treaties']));
  const unitNames = new Set([...names(ref['wizard_units']), ...names(ref['robot_units'])]);
  return t.treaties.chart.every((row) => treatyNames.has(row.treaty))
    && unitNames.has(t.paying.example.buys)
    && t.battle.example.units.every((u) => unitNames.has(u));
}

/** The rulebook page's data, or null when the reference has no rulebook or is missing part of what the page draws. */
export function readRulebook(referenceData: unknown): RulebookData | null {
  if (!isObj(referenceData) || !isObj(referenceData['rulebook'])) return null;
  if (!rawComplete(referenceData)) return null;
  const text = referenceData['rulebook'] as unknown as RulebookText;

  const mapsIn = referenceData['maps'] as Record<string, unknown>;
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
    const m = BATTLE_LABEL.exec(label);
    return { kind: m ? m[1]! : label, effect: m ? m[2]! : asStr(c['effect']), copies: asNum(c['copies']) };
  });

  const heroes = asArr(referenceData['heroes']).filter(isObj);
  const ladder: LadderRung[] = [...wizardUnits, ...robotUnits]
    .filter((u) => u.init !== null)
    .map((u) => ({ name: u.name, species: u.species, init: u.init!, dmg: u.dmg!, def: u.def! }));
  // The one hero with its own stat line, not its category's.
  for (const h of heroes.filter((x) => x['category'] === LADDER_HERO)) {
    const s = h['stats'] as Record<string, unknown>;
    ladder.push({ name: `${asStr(h['name'])} (hero)`, species: asStr(h['species']), init: asNum(s['init']), dmg: asNum(s['dmg']), def: asNum(s['def']) });
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
  return victoryComplete(data) ? data : null;
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const MILESTONE_COLUMNS = 5;

/**
 * Whether every win number the page draws is there. The readers above fill a
 * missing number with 0, and a wrong number is worse than no page.
 */
function victoryComplete(data: RulebookData): boolean {
  const v = data.victory;
  const milestonesOk = (p: number) => {
    const row = v.milestones[p];
    return Array.isArray(row) && row.length === MILESTONE_COLUMNS && row.every(positive);
  };
  return PLAYER_COUNTS.every((p) => positive(v.cultureTarget[p]) && positive(v.kills[p]) && milestonesOk(p))
    && positive(v.tech)
    && LAYOUTS.every((k) => positive(v.economicCollectors[k]));
}

export function layoutFor(data: RulebookData, players: number): LayoutKey {
  return LAYOUTS.find((k) => data.text.players_by_layout[k].includes(players)) ?? '3-4p';
}

export function atLayout<T>(x: T | ByLayout<T>, layout: LayoutKey): T {
  return isObj(x) && layout in x ? (x as ByLayout<T>)[layout] : (x as T);
}
