// Catalog data — transcribed verbatim from the pinned rules text
// (src/verify/neither-guts-nor-gears/rules-v2026-09-21.txt): §7 unit/building/
// research tables, §8 hero roster + stat classes + lore, §10.1 battle deck,
// §11.2 treaties, §12 victory tables, §2 supply counts.
//
// Nothing here is written from memory; every row carries its source section in a
// comment. data.test.ts locks counts/multisets against the pin.

// ---------------------------------------------------------------------------
// §1: the five resources.
// ---------------------------------------------------------------------------
export type ResourceType = 'water' | 'wood' | 'ore' | 'oil' | 'ether';
export const RESOURCE_TYPES: ResourceType[] = ['water', 'wood', 'ore', 'oil', 'ether'];

/** A printed cost: resource -> amount. Only present entries are owed. */
export type ResourceCost = Partial<Record<ResourceType, number>>;

export function costTotal(cost: ResourceCost): number {
  return Object.values(cost).reduce((a, b) => a + (b ?? 0), 0);
}

/** Does `payment` (multiset produced by committed collectors) cover `cost`? */
export function costCoveredBy(cost: ResourceCost, payment: ResourceCost): boolean {
  return RESOURCE_TYPES.every((r) => (payment[r] ?? 0) >= (cost[r] ?? 0));
}

export function describeCost(cost: ResourceCost): string {
  const parts = RESOURCE_TYPES.filter((r) => cost[r]).map((r) => `${cost[r]} ${r}`);
  return parts.length ? parts.join(' + ') : 'free';
}

// ---------------------------------------------------------------------------
// §3: factions. Species is the mechanical side; lore-only otherwise.
// ---------------------------------------------------------------------------
export type Species = 'wizard' | 'robot';

export interface FactionDef {
  id: string;
  name: string;
  species: Species;
  color: string;
}

export const FACTIONS: FactionDef[] = [
  { id: 'covenant', name: 'The Covenant', species: 'wizard', color: 'White' },
  { id: 'schism', name: 'The Schism', species: 'wizard', color: 'Red' },
  { id: 'brass-circle', name: 'The Brass Circle', species: 'wizard', color: 'Blue' },
  { id: 'ledger', name: 'The Ledger', species: 'robot', color: 'Purple' },
  { id: 'foundry', name: 'The Foundry', species: 'robot', color: 'Yellow' },
  { id: 'unbolted', name: 'The Unbolted', species: 'robot', color: 'Green' },
];

// ---------------------------------------------------------------------------
// §7.2 wizard units + §7.8 robot units. A "unit type" here is any purchasable
// piece type; collectors are units with the collector flag.
// ---------------------------------------------------------------------------
export interface UnitDef {
  id: string;
  /** Printed name (resolvers accept this). */
  name: string;
  species: Species;
  cost: ResourceCost;
  /** Combat stat line; absent = statless (collectors, Subjects offline). */
  init: number | null;
  dmg: number | null;
  def: number | null;
  /** AoE attack (hits every opposing unit). */
  aoe: boolean;
  /** Printed supply maximum per player of the relevant species. */
  maxPerPlayer: number;
  /** Collector: produces a resource when committed. resourceType=null → any (Surf). */
  collector: boolean;
  collectorResource: ResourceType | null;
  /** Robot platforms need an allocated Core to function (Infiltrator excepted). */
  needsCore: boolean;
  /** Building prerequisite (printed name of the building), if any. */
  requiresBuilding: string | null;
  /** Immobile Combat Platforms exist only at a base and cannot move/rally/retreat. */
  immobile: boolean;
  /** Wall Platform: must be single-target target while it stands. */
  wallFirst: boolean;
  /** Spy-granting type (Illusionist / Infiltrator): no separate map piece. */
  grantsSpy: boolean;
  notes: string;
}

// §7.2 — Wizard units (7 rows).
export const WIZARD_UNITS: UnitDef[] = [
  {
    id: 'surf', name: 'Surf', species: 'wizard', cost: { water: 2 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 11,
    collector: true, collectorResource: null, needsCore: false,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Collector; may collect any resource. Maximum = the Economic spend on this map: 12 / 16 / 26.',
  },
  {
    id: 'subject', name: 'Subject', species: 'wizard', cost: { water: 1, wood: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 10,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Off-map faction-board token. +1 culture per round, or +2 with Amphitheatre. Maximum 10.',
  },
  {
    id: 'evoker', name: 'Evoker', species: 'wizard', cost: { wood: 2, ore: 1 },
    init: 50, dmg: 2, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Wizard Missile costs 1 mana per attack. Researched Ice Blast costs 3 mana and gives one unit −100 Init. Researched Fiery Explosion costs 3 mana and deals 2 DMG AoE.',
  },
  {
    id: 'illusionist', name: 'Illusionist', species: 'wizard', cost: { wood: 2, ore: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: 'Library of Illusion', immobile: false, wallFirst: false, grantsSpy: true,
    notes: 'Requires Library of Illusion. Assigns a hero as a spy; no separate map piece. Maximum one active assignment.',
  },
  {
    id: 'dragon', name: 'Dragon', species: 'wizard', cost: { wood: 2, ore: 2, ether: 1 },
    init: 10, dmg: 3, def: 2, aoe: true, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: 'Dragon Hoard', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'No mana cost. Requires Dragon Hoard.',
  },
  {
    id: 'enchantress', name: 'Enchantress', species: 'wizard', cost: { water: 1, wood: 1, ether: 1 },
    init: 75, dmg: 0, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: 'Library of Enchantment', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Requires Library of Enchantment. Enhance: +2 DMG to one unit for 2 mana. Researched Dehance: −1 DEF to one unit for 2 mana.',
  },
  {
    id: 'cleric', name: 'Cleric', species: 'wizard', cost: { water: 2, ether: 1 },
    init: 2, dmg: 0, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: 'Temple', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Requires Temple. Each Cleric may prevent one death per initiative pass for 5 mana, including its own or an allied unit\'s death in the same battle.',
  },
];

// §7.8 — Robot units (12 rows). Costs exclude a separate Core.
export const ROBOT_UNITS: UnitDef[] = [
  {
    id: 'core', name: 'Core', species: 'robot', cost: { water: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 15,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Maximum 15 owned tokens; can be purchased with its platform in one Build purchase.',
  },
  {
    id: 'water-collector', name: 'Water collector', species: 'robot', cost: { water: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 3,
    collector: true, collectorResource: 'water', needsCore: true,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Water only; one per water tile on the map in play (2p 7 / 3–4p 10 / 5–6p 21). Needs a Core.',
  },
  {
    id: 'wood-collector', name: 'Wood collector', species: 'robot', cost: { water: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 3,
    collector: true, collectorResource: 'wood', needsCore: true,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Wood only; one per wood tile on the map in play (2p 6 / 3–4p 8 / 5–6p 19). Needs a Core.',
  },
  {
    id: 'ore-collector', name: 'Ore collector', species: 'robot', cost: { wood: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 3,
    collector: true, collectorResource: 'ore', needsCore: true,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Ore only; one per ore tile on the map in play (2p 7 / 3–4p 7 / 5–6p 8). Needs a Core.',
  },
  {
    id: 'oil-collector', name: 'Oil collector', species: 'robot', cost: { ore: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 1,
    collector: true, collectorResource: 'oil', needsCore: true,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Oil only; four per player on every map. Needs a Core.',
  },
  {
    id: 'ether-collector', name: 'Ether collector', species: 'robot', cost: { oil: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 1,
    collector: true, collectorResource: 'ether', needsCore: true,
    requiresBuilding: null, immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Ether only; two per player on every map. Needs a Core.',
  },
  {
    id: 'spinner', name: 'Spinner Platform', species: 'robot', cost: { wood: 1 },
    // Designer ruling #131 (2026-10-18): 1 wood (was 2).
    init: 5, dmg: 2, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: true,
    requiresBuilding: 'Combat Frame Production', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Requires Combat Frame Production. Base DEF is 1, not 2.',
  },
  {
    id: 'spitter', name: 'Spitter Platform', species: 'robot', cost: { wood: 1, ore: 1 },
    init: 95, dmg: 1, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: true,
    requiresBuilding: 'Combat Frame Production', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Requires Combat Frame Production.',
  },
  {
    id: 'infiltrator', name: 'Infiltrator Platform', species: 'robot', cost: { water: 1, wood: 1, oil: 1 },
    init: null, dmg: null, def: null, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: false,
    requiresBuilding: 'Diplomatic Research Station', immobile: false, wallFirst: false, grantsSpy: true,
    notes: 'Requires Diplomatic Research Station. No Core required. Assigns a hero as a spy; no separate map piece.',
  },
  {
    id: 'immobile-combat-platform', name: 'Immobile Combat Platform', species: 'robot', cost: { wood: 2, ore: 2 },
    // Designer ruling #94 (2026-09-25): DEF 1 / DMG 6 (was 3 / 3) — it can
    // kill a Leader, and one surviving small unit can take it out.
    init: 98, dmg: 6, def: 1, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: true,
    requiresBuilding: null, immobile: true, wallFirst: false, grantsSpy: false,
    notes: 'Exists only at a base. Cannot move, Rally, or retreat.',
  },
  {
    id: 'large-combat-platform', name: 'Large Combat Platform', species: 'robot', cost: { wood: 2, ore: 1, oil: 1 },
    init: 60, dmg: 3, def: 3, aoe: true, maxPerPlayer: 5, // DMG 3 by ruling #130 (was 2)
    collector: false, collectorResource: null, needsCore: true,
    requiresBuilding: 'Combat Frame Production', immobile: false, wallFirst: false, grantsSpy: false,
    notes: 'Requires Combat Frame Production.',
  },
  {
    id: 'wall-platform', name: 'Wall Platform', species: 'robot', cost: { wood: 2 },
    // Designer ruling #107 (2026-09-26): DEF 3 (was 4). Ruling #132 (2026-10-18): 2 wood (was 3).
    init: 1, dmg: 0, def: 3, aoe: false, maxPerPlayer: 5,
    collector: false, collectorResource: null, needsCore: true,
    requiresBuilding: 'Defense Research Station', immobile: false, wallFirst: true, grantsSpy: false,
    notes: 'Requires Defense Research Station. Moves normally. Must be targeted first by single-target attacks while it stands.',
  },
];

// ---------------------------------------------------------------------------
// §7.5 wizard buildings (9) + §7.10 robot buildings (5). Ordinary buildings
// live on the faction board, one per player, and cannot be lost. Castle/Home
// are map bases; Mana Reserve is the repeatable mana building (max four).
// ---------------------------------------------------------------------------
export interface BuildingDef {
  id: string;
  name: string;
  species: Species;
  cost: ResourceCost;
  /** A map BASE (Castle/Home) rather than a faction-board building. */
  isBase: boolean;
  /** Repeatable beyond one-per-player (Mana Reserve only, max four). */
  repeatableMax: number | null;
  effect: string;
}

// §7.5 — Wizard buildings (9 rows).
export const WIZARD_BUILDINGS: BuildingDef[] = [
  { id: 'castle', name: 'Castle', species: 'wizard', cost: { wood: 3, ore: 1 }, isBase: true, repeatableMax: null, effect: 'Additional or replacement base on the map. Spawns map units. Three-base total limit; starting Castle is free.' },
  { id: 'library-of-evocation', name: 'Library of Evocation', species: 'wizard', cost: { wood: 2, water: 1 }, isBase: false, repeatableMax: null, effect: 'Permits Ice Blast, Fiery Explosion, Mana Shield and Extra Move/Battle Card research.' },
  { id: 'library-of-illusion', name: 'Library of Illusion', species: 'wizard', cost: { wood: 2, ore: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Illusionist recruitment and Invisible and Extra Research Card research.' },
  { id: 'library-of-enchantment', name: 'Library of Enchantment', species: 'wizard', cost: { water: 1, wood: 2, ore: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Enchantress recruitment and Dehance and Extra Build Card research.' },
  { id: 'dragon-hoard', name: 'Dragon Hoard', species: 'wizard', cost: { ore: 2, water: 1, ether: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Dragon recruitment.' },
  { id: 'temple', name: 'Temple', species: 'wizard', cost: { wood: 2, water: 2 }, isBase: false, repeatableMax: null, effect: 'Unlocks Cleric recruitment.' },
  { id: 'embassy', name: 'Embassy', species: 'wizard', cost: { wood: 2 }, isBase: false, repeatableMax: null, effect: 'Unlocks treaty formation and battle-card purchases.' },
  { id: 'amphitheatre', name: 'Amphitheatre', species: 'wizard', cost: { wood: 3, water: 1 }, isBase: false, repeatableMax: null, effect: 'Adds +1 culture per Subject per round, making each Subject worth +2 total.' },
  { id: 'mana-reserve', name: 'Mana Reserve', species: 'wizard', cost: { wood: 2, water: 1 }, isBase: false, repeatableMax: 4, effect: '+5 maximum mana. Maximum four.' },
];

// §7.10 — Robot buildings (5 rows).
export const ROBOT_BUILDINGS: BuildingDef[] = [
  { id: 'home', name: 'Home', species: 'robot', cost: { wood: 3, ore: 1 }, isBase: true, repeatableMax: null, effect: 'Additional or replacement base; spawns map units. Starting Home is free.' },
  { id: 'combat-frame-production', name: 'Combat Frame Production', species: 'robot', cost: { wood: 2, ore: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Spinner, Spitter, and Large Combat Platforms.' },
  { id: 'diplomatic-research-station', name: 'Diplomatic Research Station', species: 'robot', cost: { wood: 2, water: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Infiltrator recruitment and treaty formation.' },
  { id: 'defense-research-station', name: 'Defense Research Station', species: 'robot', cost: { wood: 2, ore: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks Wall Platform recruitment and battle-card purchases.' },
  { id: 'third-space', name: 'Third Space', species: 'robot', cost: { wood: 3, water: 1, ore: 1 }, isBase: false, repeatableMax: null, effect: '+5 culture per round.' },
  // Designer ruling #86 (2026-09-25).
  { id: 'advanced-research-station', name: 'Advanced Research Station', species: 'robot', cost: { ore: 2, wood: 1 }, isBase: false, repeatableMax: null, effect: 'Unlocks research of the Extra Build, Extra Move/Battle and Extra Research cards. It is a building type, so it counts toward technology like any other.' },
];

// ---------------------------------------------------------------------------
// §7.6 wizard research (6) + §7.10 robot research (1).
// ---------------------------------------------------------------------------
export interface ResearchDef {
  id: string;
  name: string;
  species: Species;
  /** Prerequisite building (printed name; "at Home" for Metal Platforms). */
  prerequisite: string;
  cost: ResourceCost;
  /** A fourth resource that is one of these (the Extra action cards: ether OR
   *  oil, priced like a battle strategy card — ruling #86). */
  either?: ResourceType[];
  effect: string;
}

export const WIZARD_RESEARCH: ResearchDef[] = [
  { id: 'ice-blast', name: 'Ice Blast', species: 'wizard', prerequisite: 'Library of Evocation', cost: { water: 2, wood: 1 }, effect: 'Evoker may spend 3 mana to give one unit −100 Init for the battle.' },
  { id: 'fiery-explosion', name: 'Fiery Explosion', species: 'wizard', prerequisite: 'Library of Evocation', cost: { wood: 1, ore: 1 }, effect: 'Evoker may spend 3 mana to use its 2 DMG AoE spell.' },
  { id: 'mana-shield', name: 'Mana Shield', species: 'wizard', prerequisite: 'Library of Evocation', cost: { ether: 2 }, effect: 'Evokers, Enchantresses, and Clerics may reduce an incoming hit\'s DMG at 1 mana per point.' },
  { id: 'invisible', name: 'Invisible', species: 'wizard', prerequisite: 'Library of Illusion', cost: { water: 1, wood: 1 }, effect: 'An assigned Illusionist hero may reveal on activation to instantly kill an opposing hero.' },
  { id: 'dehance', name: 'Dehance', species: 'wizard', prerequisite: 'Library of Enchantment', cost: { water: 1, wood: 1 }, effect: 'Enchantress may spend 2 mana to give one unit −1 DEF for the battle.' },
  // Designer ruling #86 (2026-09-25): each action card type can be researched
  // once, priced like a battle strategy card; a Library unlocks each one.
  { id: 'extra-move-battle-card', name: 'Extra Move/Battle Card', species: 'wizard', prerequisite: 'Library of Evocation', cost: { water: 1, wood: 1, ore: 1, ether: 1 }, effect: 'Gain a second Move/Battle action card for the rest of the game (with Marshal\'s, three). Counts as a research type for technology without raising the target.' },
  { id: 'extra-research-card', name: 'Extra Research Card', species: 'wizard', prerequisite: 'Library of Illusion', cost: { water: 1, wood: 1, ore: 1, ether: 1 }, effect: 'Gain a second Research action card for the rest of the game (with Archivist\'s, three). Counts as a research type for technology without raising the target.' },
  { id: 'extra-build-card', name: 'Extra Build Card', species: 'wizard', prerequisite: 'Library of Enchantment', cost: { water: 1, wood: 1, ore: 1, ether: 1 }, effect: 'Gain a second Build action card for the rest of the game (with Quartermaster\'s, three). Counts as a research type for technology without raising the target.' },
  // Designer ruling #101 (2026-09-26).
  { id: 'haste', name: 'Haste', species: 'wizard', prerequisite: 'Library of Enchantment', cost: { ore: 2, ether: 1 }, effect: 'Each committed Surf produces two of its tile\'s resource. Surplus production from any purchase is banked and may pay later purchases this round, in full or in part; the bank empties at upkeep. The Economic spend still needs its full count of collectors on distinct tiles.' },
];

export const ROBOT_RESEARCH: ResearchDef[] = [
  // Designer ruling 2026-09-24: 2 wood + 1 ore + 1 oil (the printed 2 wood +
  // 2 oil was unpayable — a robot owns one oil collector).
  { id: 'metal-platforms', name: 'Metal Platforms', species: 'robot', prerequisite: 'Home', cost: { wood: 2, ore: 1, oil: 1 }, effect: 'All robot platforms gain +1 DEF. Heroes are not affected. This does not give statless pieces a combat stat line.' },
  // Designer ruling #86 (2026-09-25): the Advanced Research Station unlocks
  // all three Extra action cards, each priced like a battle strategy card.
  { id: 'extra-build-card', name: 'Extra Build Card', species: 'robot', prerequisite: 'Advanced Research Station', cost: { water: 1, wood: 1, ore: 1, oil: 1 }, effect: 'Gain a second Build action card for the rest of the game (with Quartermaster\'s, three). Counts as a research type for technology without raising the target.' },
  { id: 'extra-move-battle-card', name: 'Extra Move/Battle Card', species: 'robot', prerequisite: 'Advanced Research Station', cost: { water: 1, wood: 1, ore: 1, oil: 1 }, effect: 'Gain a second Move/Battle action card for the rest of the game (with Marshal\'s, three). Counts as a research type for technology without raising the target.' },
  { id: 'extra-research-card', name: 'Extra Research Card', species: 'robot', prerequisite: 'Advanced Research Station', cost: { water: 1, wood: 1, ore: 1, oil: 1 }, effect: 'Gain a second Research action card for the rest of the game (with Archivist\'s, three). Counts as a research type for technology without raising the target.' },
  // Designer rulings #102 and #103 (2026-09-26), researched at Home like Metal Platforms.
  { id: 'collector-optimizations', name: 'Collector Optimizations', species: 'robot', prerequisite: 'Home', cost: { oil: 1, ore: 2 }, effect: 'Two of your collectors may share one location. An access partner\'s collector (Shared Resources or Open Borders) may share a location with yours only if that partner has this research too. Never more than two collectors on a location. The Economic spend still needs its full count of distinct tiles.' },
  { id: 'core-integration', name: 'Core Integration', species: 'robot', prerequisite: 'Home', cost: { oil: 1, water: 2 }, effect: 'The Core bought together with a platform costs nothing (it still comes from the Core supply). A Core bought on its own still costs 1 water.' },
  // Designer ruling #111 (2026-09-27), researched at Home.
  { id: 'self-destruct', name: 'Self Destruct', species: 'robot', prerequisite: 'Home', cost: { ore: 2, wood: 1, oil: 1 }, effect: 'In battle, any of your robot units (not heroes) with printed DMG 1 or more may self-destruct on its activation instead of attacking: its current DMG + 3 is dealt to every other unit and hero in the battle, every side, with the reactions of an area attack. The unit is lost.' },
];

/** Ruling #86: research ids that grant a permanent extra action card, by kind. */
export const ACTION_CARD_RESEARCH: Record<string, 'build' | 'moveBattle' | 'research'> = {
  'extra-build-card': 'build',
  'extra-move-battle-card': 'moveBattle',
  'extra-research-card': 'research',
};

/** Rulings #87 / #122: the first battle strategy card a player buys, or
 *  gains from Archmage Chaimidious, counts once as an acquired type for
 *  technology (the target does not rise). */
export const BATTLE_CARD_TYPE_ID = 'battle-strategy-card';

// ---------------------------------------------------------------------------
// §8.2 hero stat classes.
// ---------------------------------------------------------------------------
export type HeroCategory = 'military' | 'culture' | 'economy' | 'technology' | 'evo-angel';

export function heroStatsForCategory(category: HeroCategory, isLeader: boolean): { init: number; dmg: number; def: number } {
  // §8.2 table.
  const base =
    category === 'evo-angel' ? { init: 80, dmg: 4, def: 4 }
      : category === 'military' ? { init: 70, dmg: 3, def: 4 }
        : { init: 30, dmg: 1, def: 3 };
  return { ...base, def: base.def + (isLeader ? 2 : 0) };
}

// ---------------------------------------------------------------------------
// §8.4 hero roster (20) + §8.5 lore (12 rows).
// ---------------------------------------------------------------------------
export interface HeroDef {
  /** Roster number (1-20). */
  num: number;
  id: string;
  name: string;
  category: HeroCategory;
  /** Species restriction, applied at setup AND later claims; null = either. */
  species: Species | null;
  /** Recommended Leader (asterisk); not mandatory. */
  recommendedLeader: boolean;
  effect: string;
  /** §8.5 lore row; absent for the 8 heroes with no printed lore. */
  lore: string | null;
}

export const HEROES: HeroDef[] = [
  { num: 1, id: 'marshal', name: 'Marshal Corvin Ashlock', category: 'military', species: null, recommendedLeader: false, effect: 'Gain one extra Move/Battle action card. Remove it at the upkeep after Marshal dies.', lore: 'Former head of the Ledger\'s private security. Sold his campaign maps to both sides the week the war started.' },
  { num: 2, id: 'chaimidious', name: 'Archmage Chaimidious', category: 'military', species: null, recommendedLeader: true, effect: 'Gain a battle strategy card. It counts for technology like a bought one: the battle strategy card type, one point, once.', lore: null },
  { num: 3, id: 'evo-angel', name: 'Evo Angel', category: 'evo-angel', species: 'robot', recommendedLeader: true, effect: 'Uses Init 80, DMG 4, DEF 4 instead of ordinary military stats.', lore: null },
  { num: 4, id: 'elara', name: 'Archmage Elara', category: 'military', species: 'wizard', recommendedLeader: true, effect: 'At the start of a Move/Battle action, before movement, may spend 5 mana to deal 4 damage to all units in an adjacent space except your own units and those of Open Borders or Peace allies. Movement afterward is optional. This is not a battle.', lore: null },
  { num: 5, id: 'warden', name: 'Warden Hesper Quill', category: 'military', species: null, recommendedLeader: false, effect: 'All other allied units in the battle gain +1 DEF. If Warden dies in an area attack, its bonus applies throughout that attack before casualties are removed.', lore: 'Siege-witch cast out of the Covenant for shielding a robot column. Now shields whoever pays.' },
  { num: 6, id: 'rook', name: 'Captain Rook Malvane', category: 'military', species: null, recommendedLeader: false, effect: 'All other allied units in the battle gain +2 DMG, subject to the DMG-0 restriction. Does not stack with an identical hero effect.', lore: 'Schism battle-mage who thinks the Covenant fights too politely. Drills any army into one that does not.' },
  { num: 7, id: 'kestrel', name: 'Kestrel Nine', category: 'military', species: null, recommendedLeader: false, effect: 'All other allied units in the battle gain +2 DMG, subject to the DMG-0 restriction. Does not stack with an identical hero effect.', lore: 'Decommissioned targeting core from the first uprising. Rents its firing solutions to wizards without irony.' },
  { num: 8, id: 'chronicler', name: 'Chronicler Ottoline Vey', category: 'culture', species: null, recommendedLeader: true, effect: '+5 culture per round during the income step. No income while reserved.', lore: 'Writes the official history of whichever faction feeds her. Her version tends to become the true one.' },
  { num: 9, id: 'foreman', name: 'Foreman Hadrik Stoll', category: 'culture', species: null, recommendedLeader: false, effect: 'May make two unit or building purchases per Build action, each paid with separate collectors. A collector bought in the first purchase may help pay the second.', lore: 'Ran the Foundry\'s assembly floors before the robots walked out. Can stand up two of anything before lunch.' },
  { num: 10, id: 'envoy', name: 'Envoy Sable Marrow', category: 'culture', species: null, recommendedLeader: true, effect: 'Unlocks treaties. Existing treaties survive Envoy\'s death; forming new ones still requires an unlock held by either partner. In a battle Envoy is in, no spy (Invisible or Spy Attack) can kill a hero on Envoy\'s side.', lore: 'The only person both an Archmage and an Unbolted have agreed to sit across from. Nobody knows what she is.' },
  { num: 11, id: 'quartermaster', name: 'Quartermaster Bertram Hollis', category: 'culture', species: null, recommendedLeader: false, effect: 'Gain one extra Build action card. Remove it at the upkeep after Quartermaster dies.', lore: 'Kept the Ledger\'s supply lines running through three embargoes. Finds a way to build when there is no way.' },
  { num: 12, id: 'wren', name: 'Dowser Wren Calloway', category: 'economy', species: null, recommendedLeader: false, effect: 'When placed, grants free collectors at once: two Surfs for a wizard; for a robot, four collectors, the owner choosing the type of each, each with a Core already in it. The grant stops at the supply limits. No resource overlay.', lore: 'Non-magical, and the wizards hate that she still finds water where they cannot.' },
  { num: 13, id: 'ida', name: 'Prospector Ida Marrs', category: 'economy', species: null, recommendedLeader: false, effect: 'Occupied space becomes Ore while its overlay is active.', lore: 'Mapped the ore ring before any faction claimed it. Still has the maps, still sells them.' },
  { num: 14, id: 'derrick', name: 'Derrick Prime', category: 'economy', species: 'robot', recommendedLeader: true, effect: 'Occupied space becomes Oil while its overlay is active.', lore: null },
  { num: 15, id: 'mayhew', name: 'Conjurer Mayhew', category: 'economy', species: 'wizard', recommendedLeader: true, effect: 'Occupied space becomes Ether while its overlay is active.', lore: null },
  { num: 16, id: 'archivist', name: 'Archivist Solenne Dray', category: 'technology', species: null, recommendedLeader: false, effect: 'Gain one extra Research action card. Remove it at the upkeep after Archivist dies.', lore: 'Curates the last library that holds both spellbooks and schematics. Lends to anyone who returns them.' },
  { num: 17, id: 'kettering', name: 'Professor Anselm Kettering', category: 'technology', species: null, recommendedLeader: false, effect: 'May make two Research purchases: technologies, battle cards, or one of each. Normal prerequisites and separate collector payments apply.', lore: 'Dr. Smyth\'s former teacher. Insists he did the important half of the work.' },
  { num: 18, id: 'smyth', name: 'Dr. Elayn Smyth', category: 'technology', species: null, recommendedLeader: true, effect: 'Gain one unresearched technology from your species\' list for free, waiving both cost and prerequisite building. Choose immediately, except that a reserved Smyth\'s reward waits until placement.', lore: null },
  { num: 19, id: 'motherboard', name: 'Motherboard', category: 'technology', species: 'robot', recommendedLeader: true, effect: '+5 bonus tech points while alive, owned, and in play. Robots only.', lore: null },
  { num: 20, id: 'greymore', name: 'Technomancer Greymore', category: 'technology', species: 'wizard', recommendedLeader: true, effect: '+5 bonus tech points while alive, owned, and in play.', lore: null },
];

// ---------------------------------------------------------------------------
// §10.1 battle strategy deck (20 cards, exact composition).
// ---------------------------------------------------------------------------
export type BattleCardId =
  | 'bonus-def-plus' | 'bonus-dmg-plus' | 'bonus-def-minus' | 'bonus-dmg-minus'
  | 'extra' | 'counter' | 'rally' | 'retreat' | 'initiative';

export interface BattleCardDef {
  id: BattleCardId;
  /** Printed type label. */
  label: string;
  copies: number;
  effect: string;
}

export const BATTLE_CARDS: BattleCardDef[] = [
  { id: 'bonus-def-plus', label: 'Bonus (+1 DEF to all your units)', copies: 2, effect: '+1 DEF to all your units in the battle.' },
  { id: 'bonus-dmg-plus', label: 'Bonus (+1 DMG to all your units)', copies: 2, effect: '+1 DMG to all your units in the battle, subject to inherent DMG-0 immunity to increases.' },
  { id: 'bonus-def-minus', label: 'Bonus (−1 DEF to all opposing units)', copies: 2, effect: '−1 DEF to all opposing units in the battle.' },
  { id: 'bonus-dmg-minus', label: 'Bonus (−1 DMG to all opposing units)', copies: 2, effect: '−1 DMG to all opposing units in the battle.' },
  { id: 'extra', label: 'Extra', copies: 2, effect: 'Play up to two additional battle strategy cards.' },
  { id: 'counter', label: 'Counter', copies: 2, effect: 'Counter a battle strategy card that has not yet resolved.' },
  { id: 'rally', label: 'Rally', copies: 2, effect: 'Move any number of your own eligible mobile units from adjacent locations into this battle.' },
  { id: 'retreat', label: 'Retreat', copies: 4, effect: 'Immediately retreat all your mobile units from this battle using normal retreat rules.' },
  { id: 'initiative', label: 'Initiative', copies: 2, effect: '−100 Initiative to all opposing units in the battle.' },
];

export const BATTLE_DECK_SIZE = 20;

/** The exact 20-card multiset as individual card instances (ids suffixed). */
export function buildBattleDeck(): Array<{ instanceId: string; card: BattleCardId }> {
  const out: Array<{ instanceId: string; card: BattleCardId }> = [];
  for (const def of BATTLE_CARDS) {
    for (let i = 0; i < def.copies; i++) out.push({ instanceId: `${def.id}-${i + 1}`, card: def.id });
  }
  return out;
}

// ---------------------------------------------------------------------------
// §11.2 treaties (5). Income is paid to BOTH partners per income step.
// ---------------------------------------------------------------------------
export type TreatyType = 'open-borders' | 'shared-resources' | 'peace' | 'culture-treaty' | 'shared-tactics';

export interface TreatyDef {
  id: TreatyType;
  name: string;
  cultureIncome: number;
  effect: string;
  /** Which phase/window a unilateral break is legal in (§11.2 column 3). */
  breakingCondition: string;
}

export const TREATIES: TreatyDef[] = [
  { id: 'open-borders', name: 'Open Borders', cultureIncome: 5, effect: 'Units may share locations without battle and must fight on the same side when attacked there. Allied combat units protect the partner\'s bases and pieces. Grants collection access to the partner\'s locations and collector placement adjacent to the partner\'s units. Does not share battle cards or victory.', breakingCondition: 'End of round, provided allied units do not share a space.' },
  { id: 'shared-resources', name: 'Shared Resources', cultureIncome: 4, effect: 'Grants collection on the partner\'s locations and collector placement adjacent to the partner\'s units. Does not create military allies or general movement access.', breakingCondition: 'End of round, if no unit is collecting from a partner\'s space.' },
  { id: 'peace', name: 'Peace', cultureIncome: 3, effect: 'No combat between partners. Partners\' units may not enter each other\'s locations. No automatic collection access; a one-off collection agreement may be made.', breakingCondition: 'End of round only.' },
  { id: 'culture-treaty', name: 'Culture Treaty', cultureIncome: 1, effect: 'Direct partners share an eligible partner\'s victory. Does not create military allies; partners may fight. Shared victory does not chain. Available only at four or more players. No automatic collection access.', breakingCondition: 'Outside the culture phase, only when no action or battle is resolving.' },
  { id: 'shared-tactics', name: 'Shared Tactics', cultureIncome: 2, effect: 'Partners privately share existing hands immediately and show new draws while active. Either may play a card the other owns. If both are in a battle, the card\'s owner decides first whether to play it; the partner may play it only if the owner does not. No automatic collection access or military alliance.', breakingCondition: 'End of round.' },
];

// Designer rulings #88, #92 and #96 (2026-09-25): every treaty pays +2 culture a round (was +5; #92 tried +3 for one run).

// ---------------------------------------------------------------------------
// §12 victory tables.
// ---------------------------------------------------------------------------

/** §5.5 / §12.3 culture milestones that grant a hero claim, as a share of
 *  the cultural target: 5%, 15%, 30%, 50%, 75% of it (the printed 5 / 15 /
 *  30 / 50 / 75 at a target of 100). Use `milestonesFor(playerCount)`,
 *  never this table directly. */
export const MILESTONES = [5, 15, 30, 50, 75] as const;

/** The target the printed milestones were written against. */
export const CULTURE_TARGET = 100;

/** §12.3 cultural target: 35 culture per player (designer ruling #119,
 *  2026-10-01; 50 under #108, 25 under #99) — 70 at two players, 140 at
 *  four, 210 at six. */
export const CULTURE_PER_PLAYER = 35;
export function cultureTargetFor(playerCount: number): number {
  return CULTURE_PER_PLAYER * playerCount;
}

/** §5.5 milestones scaled to the target: each printed milestone times
 *  (target ÷ 100), rounded UP (rulings #84, #99, #108, #119) — e.g. two players
 *  4/11/21/35/53, four players 7/21/42/70/105, six players 11/32/63/105/158. */
export function milestonesFor(playerCount: number): number[] {
  return MILESTONES.map((m) => Math.ceil((m * cultureTargetFor(playerCount)) / CULTURE_TARGET));
}

/** §12.2 military kills by player count. */
/** Designer ruling #95 (2026-09-25): two Leader kills win at four to six players (was 3 at five and six). */
export const MILITARY_KILLS_NEEDED: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 };

/** §12.4 economic spend (and the build-nothing rule): the printed mix, the
 *  minimum. The number of collectors/tiles is half the map (ruling #89):
 *  `economicCollectorsNeeded(state)` in economicScale.ts. */
export const ECONOMIC_SPEND: ResourceCost = { water: 3, wood: 3, ore: 3, ether: 1, oil: 1 };

/** §6.5: buying a battle strategy card on a Research action — the fixed
 *  resources, then one of `either`, and the building that unlocks the
 *  purchase for each species. */
export const BATTLE_CARD_PURCHASE: { cost: ResourceCost; either: ResourceType[]; unlockedBy: Record<'wizard' | 'robot', string> } = {
  cost: { water: 1, wood: 1, ore: 1 },
  either: ['ether', 'oil'],
  unlockedBy: { wizard: 'Embassy', robot: 'Defense Research Station' },
};

/** §11.1: what unlocks treaty formation for a seat — its species' building,
 *  or this hero placed and alive (one partner needs an unlock, not both). */
export const TREATY_UNLOCK: { buildings: Record<'wizard' | 'robot', string>; heroId: string } = {
  buildings: { wizard: 'Embassy', robot: 'Diplomatic Research Station' },
  heroId: 'envoy',
};

/** Whether a seat's buildings unlock the battle-card purchase. */
export function battleCardUnlocked(buildings: string[]): boolean {
  return Object.values(BATTLE_CARD_PURCHASE.unlockedBy).some((b) => buildings.includes(b));
}
/** Resources in the printed mix — the floor of the collector count. */
export const ECONOMIC_COLLECTORS_NEEDED = 11;

/** §12.5 technological targets per species: one per ordinary type on the
 *  species list plus the battle strategy card type (ruling #129, 2026-10-08:
 *  it now raises the target; #87 had it count without raising it). Wizard 21
 *  (Detection removed, #121) + 3 Extra cards (#90) + Haste (#101) + battle
 *  card = 26; robot 18 + Advanced Research Station (#86) + 3 Extra cards +
 *  Collector Optimizations + Core Integration (#102, #103) + Self Destruct
 *  (#111) + battle card = 26. */
export const TECH_TARGET: Record<Species, number> = { wizard: 26, robot: 26 };

/** §5.4 wizard mana. */
export const BASE_MAX_MANA = 5;
export const MANA_PER_RESERVE = 5;
export const MAX_RESERVES = 4;

/** §12.5: robot collector supply IS the economic mix — assertion helper for tests. */
export const ROBOT_COLLECTOR_SUPPLY: Record<string, number> = { water: 3, wood: 3, ore: 3, oil: 1, ether: 1 };

/** §2/§6.3 base limit (includes the free starting base). */
export const MAX_BASES = 3;

/** §8.1 max heroes per player. */
export const MAX_HEROES_PER_PLAYER = 6;

/** Per-species catalogs. */
export function unitsForSpecies(species: Species): UnitDef[] {
  return species === 'wizard' ? WIZARD_UNITS : ROBOT_UNITS;
}
export function buildingsForSpecies(species: Species): BuildingDef[] {
  return species === 'wizard' ? WIZARD_BUILDINGS : ROBOT_BUILDINGS;
}
export function researchForSpecies(species: Species): ResearchDef[] {
  return species === 'wizard' ? WIZARD_RESEARCH : ROBOT_RESEARCH;
}
