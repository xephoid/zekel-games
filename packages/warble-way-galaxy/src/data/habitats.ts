import type { ItemDefinition, MissionDefinition, RecruitDefinition } from '../types.js';

// Habitats #1–#3 — WR §16, locked data. Shop items and habitat missions are
// one-shot; cantina fails are permanently marked (WR §6–§7, rulings #7).

export type HabitatProgression =
  | { kind: 'missions_then_travel'; missions_required: number; distance_one_way: number }
  | { kind: 'travel'; distance_one_way: number }
  /** The Season-1 finale: complete a full R3 ruin → campaign victory (ruling #16). */
  | { kind: 'final_ruin'; depth: 1 | 2 | 3 };

export interface HabitatDefinition {
  number: number;
  name: string;
  /** Lore topic id for the DM (lore_refs); null when no topic exists yet. */
  lore_topic: string | null;
  missions: MissionDefinition[];
  shop: Array<ItemDefinition & { cost: number }>;
  cantina: RecruitDefinition[];
  progression: HabitatProgression;
}

export const HABITATS: Record<number, HabitatDefinition> = {
  1: {
    number: 1,
    name: 'Xaxalon 4',
    lore_topic: 'xaxalon-4',
    missions: [
      { id: 'h1-m1', distance: 3, goal: { kind: 'ability_check', ability: 'RES', min_roll: 10 }, credits: 300, xp: 1 },
      { id: 'h1-m2', distance: 3, goal: { kind: 'ability_check', ability: 'DIP', min_roll: 10 }, credits: 300, xp: 1 },
      { id: 'h1-m3', distance: 3, goal: { kind: 'ability_check', ability: 'MEC', min_roll: 10 }, credits: 300, xp: 1 },
      { id: 'h1-m4', distance: 4, goal: { kind: 'ruin', depth: 1 }, credits: 600, xp: 1 },
      { id: 'h1-m5', distance: 4, goal: { kind: 'ability_check', ability: 'SWA', min_roll: 10 }, credits: 300, xp: 1 },
      { id: 'h1-m6', distance: 4, goal: { kind: 'ability_check', ability: 'ARM', min_roll: 10 }, credits: 300, xp: 1 },
      { id: 'h1-m7', distance: 6, goal: { kind: 'ability_check', ability: 'ACT', min_roll: 12 }, credits: 400, xp: 1 },
    ],
    shop: [
      { id: 'h1-s1', name: 'Consumable +1 Any', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'ANY', bonus: 1 }, cost: 200 },
      { id: 'h1-s2', name: 'Weapon +1 GUN', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 1 }, cost: 300 },
      { id: 'h1-s3', name: 'Armor Combat Advantage', type: 'armor', effect: { kind: 'ground_combat_advantage' }, cost: 400 },
      // Amendment A2: repriced 600 → 400 (speed measured as THE progression dial; 600 sat past the early economy).
      { id: 'h1-s4', name: 'Ship part +1 Speed', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'speed', bonus: 1 }, cost: 400 },
      { id: 'h1-s5', name: 'Ship part +2 Capacity', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'capacity', bonus: 2 }, cost: 700 },
    ],
    cantina: [
      { id: 'h1-c1', race: 'human', idealized: 'brawn', min_roll: 11, abilities: { PIL: 1 } },
      { id: 'h1-c2', race: 'kralkin', idealized: 'moxie', min_roll: 11, abilities: { PIL: 1 } },
      { id: 'h1-c3', race: 'hexapod', idealized: 'smarts', min_roll: 11, abilities: { HAK: 1 } },
      { id: 'h1-c4', race: 'grull', idealized: 'finesse', min_roll: 11, abilities: { DIP: 1 } },
      { id: 'h1-c5', race: 'human', idealized: 'brawn', min_roll: 11, abilities: { ACT: 1 } },
    ],
    progression: { kind: 'missions_then_travel', missions_required: 4, distance_one_way: 6 },
  },
  2: {
    number: 2,
    name: 'Kookookachaa',
    lore_topic: null,
    missions: [
      { id: 'h2-m1', distance: 5, goal: { kind: 'ability_check', ability: 'PIL', min_roll: 11 }, credits: 400, xp: 2 },
      { id: 'h2-m2', distance: 5, goal: { kind: 'ability_check', ability: 'GUN', min_roll: 12 }, credits: 500, xp: 2 },
      { id: 'h2-m3', distance: 5, goal: { kind: 'ability_check', ability: 'SNE', min_roll: 11 }, credits: 400, xp: 2 },
      { id: 'h2-m4', distance: 6, goal: { kind: 'ability_check', ability: 'HAK', min_roll: 12 }, credits: 500, xp: 2 },
      { id: 'h2-m5', distance: 6, goal: { kind: 'ability_check', ability: 'LEA', min_roll: 12 }, credits: 500, xp: 2 },
      { id: 'h2-m6', distance: 7, goal: { kind: 'ruin', depth: 2 }, credits: 1000, xp: 4 },
    ],
    shop: [
      { id: 'h2-s1', name: 'Ship part +3 Capacity', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'capacity', bonus: 3 }, cost: 1200 },
      { id: 'h2-s2', name: 'Ship part +2 Handling', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'handling', bonus: 2 }, cost: 600 },
      { id: 'h2-s3', name: 'Ship part Space Combat Advantage', type: 'ship_part', effect: { kind: 'space_combat_advantage' }, cost: 600 },
      { id: 'h2-s4', name: 'Ship part +2 Speed', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'speed', bonus: 2 }, cost: 800 },
      { id: 'h2-s5', name: 'Weapon +2 GUN', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 2 }, cost: 600 },
      { id: 'h2-s6', name: 'Armor +2 SNE', type: 'armor', effect: { kind: 'ability_bonus', ability: 'SNE', bonus: 2 }, cost: 400 },
    ],
    cantina: [
      { id: 'h2-c1', race: 'kralkin', idealized: 'moxie', min_roll: 11, abilities: { HAK: 1 } },
      { id: 'h2-c2', race: 'grull', idealized: 'finesse', min_roll: 12, abilities: { PIL: 2 } },
      { id: 'h2-c3', race: 'human', idealized: 'brawn', min_roll: 11, abilities: { SWA: 1, DIP: 1 } },
      { id: 'h2-c4', race: 'kralkin', idealized: 'moxie', min_roll: 12, abilities: { HAK: 2 } },
      // "+! GUN" on the printed page is a typo for +1 GUN (WR §16).
      { id: 'h2-c5', race: 'kralkin', idealized: 'moxie', min_roll: 11, abilities: { GUN: 1 } },
    ],
    progression: { kind: 'travel', distance_one_way: 12 },
  },
  3: {
    number: 3,
    name: 'FFD700 Base',
    lore_topic: null,
    missions: [
      { id: 'h3-m1', distance: 7, goal: { kind: 'ability_check', ability: 'RES', min_roll: 13 }, credits: 600, xp: 3 },
      { id: 'h3-m2', distance: 7, goal: { kind: 'ability_check', ability: 'DIP', min_roll: 14 }, credits: 700, xp: 4 },
      { id: 'h3-m3', distance: 8, goal: { kind: 'ability_check', ability: 'MEC', min_roll: 14 }, credits: 700, xp: 4 },
      { id: 'h3-m4', distance: 8, goal: { kind: 'ability_check', ability: 'SNE', min_roll: 14 }, credits: 700, xp: 4 },
      { id: 'h3-m5', distance: 8, goal: { kind: 'ability_check', ability: 'ARM', min_roll: 15 }, credits: 750, xp: 4 },
      { id: 'h3-m6', distance: 9, goal: { kind: 'ability_check', ability: 'PIL', min_roll: 18 }, credits: 1500, xp: 5 },
    ],
    shop: [
      { id: 'h3-s1', name: 'Consumable +3 SWA', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'SWA', bonus: 3 }, cost: 600 },
      { id: 'h3-s2', name: 'Consumable +3 RES', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'RES', bonus: 3 }, cost: 600 },
      { id: 'h3-s3', name: 'Armor +3 ARM', type: 'armor', effect: { kind: 'ability_bonus', ability: 'ARM', bonus: 3 }, cost: 800 },
      { id: 'h3-s4', name: 'Weapon +3 GUN', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 3 }, cost: 800 },
      { id: 'h3-s5', name: 'Ship part Armor +2', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'armor', bonus: 2 }, cost: 1000 },
      { id: 'h3-s6', name: 'Ship part Capacity +3', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'capacity', bonus: 3 }, cost: 1500 },
    ],
    cantina: [
      { id: 'h3-c1', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { SNE: 3, PIL: 1 } },
      { id: 'h3-c2', race: 'kralkin', idealized: 'moxie', min_roll: 14, abilities: { DIP: 3, ARM: 1 } },
      { id: 'h3-c3', race: 'hexapod', idealized: 'smarts', min_roll: 13, abilities: { HAK: 3 } },
      { id: 'h3-c4', race: 'human', idealized: 'brawn', min_roll: 14, abilities: { SWA: 3, GUN: 1 } },
      { id: 'h3-c5', race: 'hexapod', idealized: 'smarts', min_roll: 13, abilities: { MEC: 3 } },
      { id: 'h3-c6', race: 'human', idealized: 'brawn', min_roll: 14, abilities: { LEA: 3, DEM: 1 } },
    ],
    progression: { kind: 'final_ruin', depth: 3 },
  },
};
