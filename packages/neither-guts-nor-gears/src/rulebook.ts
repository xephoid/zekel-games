// The rulebook: the words and facts a person reads on the rules page, beside
// pictures the game's screen draws (src/glue/rulebook/). It rides the reference
// data (getReferenceData().rulebook) next to the catalogues, maps and victory
// numbers the screen draws from too, so every number on the page is the
// engine's. Counts that change with the map are given per layout, keyed like
// the reference data's maps ('2p', '3-4p', '5-6p').
//
// This is plain data: no React, nothing the server needs to run a game. The
// AI reads the rules through getRulesText (rulesSections.ts); this is the
// same rules laid out for a person at the table.

import { ECONOMIC_SPEND, MAX_BASES, MAX_RESERVES, MANA_PER_RESERVE, BASE_MAX_MANA, TREATIES, HEROES, WIZARD_UNITS, ROBOT_UNITS, BATTLE_CARDS, type ResourceCost, type TreatyType } from './data/catalogs.js';
import { coreSupplyFor, economicCollectorsFor, robotCollectorCaps } from './economicScale.js';
import { tileLabel, tilesForLayout, type LayoutId } from './data/maps.js';

export type LayoutKey = '2p' | '3-4p' | '5-6p';
export const LAYOUT_KEYS: Record<LayoutKey, LayoutId> = { '2p': 'two', '3-4p': 'threeFour', '5-6p': 'fiveSix' };
/** A number that depends on the map in play. */
export type ByLayout<T> = Record<LayoutKey, T>;
const byLayout = <T>(f: (layout: LayoutId) => T): ByLayout<T> =>
  ({ '2p': f('two'), '3-4p': f('threeFour'), '5-6p': f('fiveSix') });

/** A picture name from the game's icon set (the same names the table uses). */
type IconName = string;
type Faction = 'The Covenant' | 'The Schism' | 'The Brass Circle' | 'The Ledger' | 'The Foundry' | 'The Unbolted';

export interface RulebookComponent {
  icon: IconName;
  name: string;
  count: number | ByLayout<number>;
  text: string | ByLayout<string>;
}

export interface RulebookPiece { icon: IconName; count: number; name: string }
export interface RulebookStep { icon: IconName; name: string; text: string }
export interface RulebookTreatyRow { treaty: string; allies: boolean; collection: boolean; hands: boolean; victory: boolean }

/** A small corner of the board for a worked example: tiles and what sits on them. */
export interface RulebookBoardFigure {
  tiles: Array<{ c: number; r: number; resource: string; label: string }>;
  pieces: Array<{ c: number; r: number; faction: Faction; icon: IconName; name: string; placed: boolean }>;
  caption: string;
}

export interface Rulebook {
  title: string;
  intro: string;
  facts: string[];
  /** Which player counts each layout is for. */
  players_by_layout: ByLayout<number[]>;
  victory: { intro: string; military: string; cultural: string; economic: string; technological: string; economic_mix: ResourceCost };
  components: RulebookComponent[];
  map: { intro: string };
  setup: {
    steps: string[];
    wizard: { faction: Faction; factions: string; pieces: RulebookPiece[]; note: string };
    robot: { faction: Faction; factions: string; pieces: RulebookPiece[]; note: string };
  };
  round: {
    steps: RulebookStep[];
    note: string;
    stack: {
      title: string; intro: string; steps: string[];
      /** Top of the stack first: the order the cards resolve. */
      cards: Array<{ faction: Faction; action: string; placed: string }>;
    };
    milestones: { intro: string };
  };
  paying: { title: string; intro: string; example: { title: string; buys: string; steps: string[]; figure: RulebookBoardFigure } };
  battle: { title: string; intro: string; ladder_title: string; example: { title: string; units: string[]; steps: string[] } };
  treaties: { intro: string; chart: RulebookTreatyRow[] };
  units: { note: string };
  /**
   * How many entries each list beside the rulebook in the reference data
   * holds, so the page can tell a list arrived whole and refuse one that did not.
   */
  counts: { tiles: ByLayout<number>; wizard_units: number; robot_units: number; treaties: number; battle_deck: number; heroes: number };
}

const treatyName = (id: TreatyType) => TREATIES.find((t) => t.id === id)!.name;
const envoy = HEROES.find((h) => h.id === 'envoy')!.name;

export function nggRulebook(): Rulebook {
  const surfs = byLayout((l) => economicCollectorsFor(l));
  const caps = byLayout((l) => robotCollectorCaps({ layout: l }));
  const cores = byLayout((l) => coreSupplyFor({ layout: l }));
  const collectorCount = byLayout((l) => { const c = caps[keyOf(l)]; return c.water + c.wood + c.ore + c.oil + c.ether; });
  const collectorText = byLayout((l) => {
    const c = caps[keyOf(l)];
    return `One per water, wood and ore tile on this map (${c.water} / ${c.wood} / ${c.ore}), plus ${c.oil} oil and ${c.ether} ether.`;
  });
  return {
    title: 'Neither Guts nor Gears',
    intro: 'Three wizard factions and three robot factions fight over a small hex map for five resources. Build collectors, units and buildings; move and fight in battles where one hit kills; claim heroes as your culture grows; and sign binding treaties. Diplomacy is meant to be the winning path.',
    facts: ['2–6 players', 'about 20 rounds', '4 ways to win'],
    players_by_layout: { '2p': [2], '3-4p': [3, 4], '5-6p': [5, 6] },
    victory: {
      intro: 'The first player to reach any one of these wins. You can only win while your Leader is alive. If every Leader dies and nobody has won, the game is a draw.',
      military: 'Kill other players\' Leaders.',
      cultural: 'Reach this much culture: 35 for each player.',
      economic: 'In one Build action, commit this many collectors on different tiles, making at least:',
      technological: 'One point for each different unit, building and research you own. The battle strategy card counts as one.',
      economic_mix: ECONOMIC_SPEND,
    },
    components: [
      { icon: 'Ore', name: 'Map board', count: 1, text: 'Three layouts on one board, with the Technology and Culture tracks.' },
      { icon: 'The Brass Circle', name: 'Faction boards', count: 6, text: 'Three wizard, three robot. They hold buildings and off-map pieces.' },
      { icon: 'Hero', name: 'Heroes', count: HEROES.length, text: 'A hero piece and card for each, in one shared pool.' },
      { icon: 'Battle card', name: 'Battle strategy cards', count: 20, text: 'One shared deck, shown below.' },
      { icon: 'Build', name: 'Action cards', count: 54, text: 'Three Build, three Move / Battle and three Research per faction.' },
      { icon: 'Open Borders', name: 'Treaty tokens', count: 30, text: 'Five per faction, one of each treaty.' },
      { icon: 'Base', name: 'Bases per faction', count: MAX_BASES, text: 'Castles or Homes, including the free one you start with.' },
      { icon: 'Surf', name: 'Surfs per wizard', count: surfs, text: 'The wizards\' collectors: as many as the Economic win needs on this map.' },
      { icon: 'Subject', name: 'Subjects per wizard', count: 10, text: 'Kept off the map. Each gives 1 culture a round.' },
      { icon: 'Mana Shield', name: 'Mana Reserves per wizard', count: MAX_RESERVES, text: `Each adds ${MANA_PER_RESERVE} maximum mana.` },
      { icon: 'Collector', name: 'Collectors per robot', count: collectorCount, text: collectorText },
      { icon: 'Core', name: 'Cores per robot', count: cores, text: 'A platform only works with a Core in it.' },
      { icon: 'Evoker', name: 'Of each other unit', count: 5, text: 'Per player of that side.' },
      { icon: 'Pass', name: 'First-player token', count: 1, text: 'Passes on at every upkeep.' },
      { icon: 'Ether', name: 'Resource overlay tiles', count: 3, text: 'They follow Prospector Ida Marrs, Derrick Prime and Conjurer Mayhew.' },
    ],
    map: {
      intro: 'One printed board has three layouts; smaller games use fewer tiles. Ore, oil and ether sit in the middle, with water and wood around them. The circled numbers are the starting locations. Each tile is named by its column letter and number, as at the table.',
    },
    setup: {
      steps: [
        'Lay out the map for your player count.',
        'Each player chooses a faction and takes its color, board, buildings, action cards and research cards. Keep one Build, one Move / Battle and one Research card; set the rest aside.',
        'Pick a random first player.',
        'In player order, each player chooses a hero from the shared pool as their Leader. Starred heroes are recommended. The Leader gains +2 DEF.',
        'In reverse player order, each player picks an empty numbered starting tile and places their free starting base and Leader there.',
        'Take your starting pieces. Shuffle the battle deck and put the remaining heroes in the shared pool.',
      ],
      wizard: {
        faction: 'The Covenant', factions: 'The Covenant · The Schism · The Brass Circle',
        pieces: [{ icon: 'Base', count: 1, name: 'Castle' }, { icon: 'Leader', count: 1, name: 'Leader' }, { icon: 'Surf', count: 3, name: 'Surfs' }],
        note: `Maximum mana starts at ${BASE_MAX_MANA}.`,
      },
      robot: {
        faction: 'The Foundry', factions: 'The Ledger · The Foundry · The Unbolted',
        pieces: [{ icon: 'Base', count: 1, name: 'Home' }, { icon: 'Leader', count: 1, name: 'Leader' }, { icon: 'Water collector', count: 2, name: 'water collectors' }, { icon: 'Wood collector', count: 2, name: 'wood collectors' }, { icon: 'Core', count: 4, name: 'Cores' }],
        note: 'Each of the four collectors holds one Core.',
      },
    },
    round: {
      steps: [
        { icon: 'Pass', name: 'Upkeep', text: 'Pass the first-player token. Take collectors back. Robots move Cores; wizards refill mana. Get your action cards back.' },
        { icon: 'Build', name: 'Planning', text: 'In turn, put one action card on the Action Stack, or pass for the round.' },
        { icon: 'Move / Battle', name: 'Actions', text: 'Take cards off the top of the stack. The last one placed goes first.' },
        { icon: 'Subject', name: 'Culture', text: 'Everyone gains culture in first-player order.' },
        { icon: 'Hero', name: 'Heroes', text: 'Each player who passed a milestone claims one hero, in turn.' },
        { icon: 'Break a treaty', name: 'End of round', text: 'Treaties that can be broken at the end of the round may be broken now.' },
      ],
      note: 'There is no round limit.',
      stack: {
        title: 'The Action Stack: last in, first out',
        intro: 'In planning, players take turns putting one action card on the stack. In the action step, cards come off the top, so the last card placed goes first. You may skip your card when it comes up.',
        steps: [
          'The Covenant is first player. It puts down Build, The Foundry puts down Move / Battle, The Covenant Research, The Foundry Build. Then both pass.',
          'The Foundry\'s Build was placed last, so it happens first.',
          'The Covenant\'s Build, placed first, happens last. By then The Foundry may already hold the tile it wanted.',
        ],
        cards: [
          { faction: 'The Foundry', action: 'Build', placed: '4th' },
          { faction: 'The Covenant', action: 'Research', placed: '3rd' },
          { faction: 'The Foundry', action: 'Move / Battle', placed: '2nd' },
          { faction: 'The Covenant', action: 'Build', placed: '1st' },
        ],
      },
      milestones: { intro: 'You earn a hero each time your culture passes one of these totals, up to six heroes counting your Leader.' },
    },
    paying: {
      title: 'Resources are never stored',
      intro: 'To buy something, place collectors on the map. Each makes one of its tile\'s resource at once, then stays there until upkeep, so it can\'t pay for anything else this round. Anything you don\'t spend is lost.',
      example: {
        title: 'Example: The Covenant buys an Evoker',
        buys: 'Evoker',
        steps: [
          'Place three Surfs (dashed): two on wood and one on ore. Each must be on or next to one of your pieces, or next to a collector you placed this round.',
          'They make 2 wood and 1 ore, which pays exactly.',
          'The Evoker appears at any base you own.',
          'The Surfs stay until upkeep. Later this round they still help you reach farther tiles, but they can\'t pay again.',
        ],
        figure: {
          // A real corner of the three-to-four-player map, around starting location 1 (C7).
          tiles: cornerOf('threeFour', [[-2, 8], [-2, 10], [-2, 12], [-1, 9], [-1, 11], [-1, 13], [0, 8], [0, 10], [0, 12], [0, 14]]),
          pieces: [
            { c: -2, r: 12, faction: 'The Covenant', icon: 'Base', name: 'Castle', placed: true },
            { c: -2, r: 10, faction: 'The Covenant', icon: 'Surf', name: 'Surf', placed: false },
            { c: -1, r: 11, faction: 'The Covenant', icon: 'Surf', name: 'Surf', placed: false },
            { c: 0, r: 10, faction: 'The Covenant', icon: 'Surf', name: 'Surf', placed: false },
          ],
          caption: 'Starting location 1 on the three-to-four-player map. The Surfs on C6 and D6 are next to the Castle on C7; the one on E6 is next to D6.',
        },
      },
    },
    battle: {
      title: 'Fighting',
      intro: 'Moving onto a tile with enemy combat units starts a battle. Units act from highest initiative to lowest; each gets one attack or ability per pass. A hit that meets a unit\'s DEF kills it. Ties go to the defender.',
      ladder_title: 'Printed initiative, highest acts first',
      example: {
        title: 'Example: a Spitter Platform attacks an Evoker',
        units: ['Spitter Platform', 'Evoker'],
        steps: [
          'The Spitter (95) acts first and hits the Evoker for 1. That would kill it (DEF 1).',
          'The wizard has researched Mana Shield and spends 1 mana to cut the hit to 0. The Evoker lives, and this does not use up its turn.',
          'The Evoker (50) casts Wizard Missile for 1 mana: 2 damage, enough to kill the Spitter.',
        ],
      },
    },
    treaties: {
      intro: `A treaty is a binding deal between two players, made at the start or end of the active player's action. One of you needs an Embassy, a Diplomatic Research Station or ${envoy} to make one. Each pair may have one treaty at a time, and each can only be broken at the time printed on it.`,
      chart: [
        { treaty: treatyName('open-borders'), allies: true, collection: true, hands: false, victory: false },
        { treaty: treatyName('shared-resources'), allies: false, collection: true, hands: false, victory: false },
        { treaty: treatyName('peace'), allies: true, collection: false, hands: false, victory: false },
        { treaty: treatyName('shared-tactics'), allies: false, collection: false, hands: true, victory: false },
        { treaty: treatyName('culture-treaty'), allies: false, collection: false, hands: false, victory: true },
      ],
    },
    units: { note: 'Robot platforms need a Core to work, except the Infiltrator. A dash means the piece does not fight.' },
    counts: {
      tiles: byLayout((l) => tilesForLayout(l).length),
      wizard_units: WIZARD_UNITS.length, robot_units: ROBOT_UNITS.length,
      treaties: TREATIES.length, battle_deck: BATTLE_CARDS.length, heroes: HEROES.length,
    },
  };
}

/** Tiles of a printed layout, by coordinate, with the map's own resource and name. */
function cornerOf(layout: LayoutId, coords: Array<[number, number]>): RulebookBoardFigure['tiles'] {
  const map = tilesForLayout(layout);
  return coords.map(([c, r]) => {
    const t = map.find((x) => x.c === c && x.r === r);
    if (!t) throw new Error(`rulebook figure: (${c},${r}) is not on the ${layout} map`);
    return { c, r, resource: t.resource, label: tileLabel(c, r) };
  });
}

function keyOf(layout: LayoutId): LayoutKey {
  return (Object.keys(LAYOUT_KEYS) as LayoutKey[]).find((k) => LAYOUT_KEYS[k] === layout)!;
}
