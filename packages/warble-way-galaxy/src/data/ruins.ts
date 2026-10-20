import type { ItemDefinition, RecruitDefinition } from '../types.js';

// Ruins R1–R3 — WR §14. Attacker stats, item lists, being lists AND the map
// grids are locked (grids transcribed from PyMuPDF renders of pp. 26–28,
// port/warble-way-galaxy/pages/, and DESIGNER-CONFIRMED 2026-07-07 against
// DATA_TEMPLATE.md). Cell legend (one char per cell):
//   .  open floor          #  wall (blocks movement + LOS)
//   ~  pit (blocks movement; can be shot across)
//   S  starting location   G  goal
//   A  attacker spot       B  being spot       I  item spot

export interface AttackerDefinition {
  /** Attack bonus; XP awarded for defeating it = atk (ruling #12). */
  atk: number;
  move: number;
  range: number;
  xp: number;
}

/** d6 result → item found, or null for "Empty" (spot closes; ruling #13-adjacent). */
export type RuinItemRoll = ItemDefinition | null;

/** d6 result → being found, or null for "Decoy" (spot was empty; closes — ruling #13). */
export type RuinBeingRoll = RecruitDefinition | null;

export interface RuinGrid {
  /** 9 rows × 9 cols, one legend char per cell (see the header comment / DATA_TEMPLATE.md). */
  rows: string[];
}

export interface RuinMapDefinition {
  id: 'R1' | 'R2' | 'R3';
  /** Threat level 1..3 → the three attackers placed at setup (player picks spots). */
  attackers: Record<1 | 2 | 3, AttackerDefinition[]>;
  /** d6 → find, index 1..6. */
  items: Record<number, RuinItemRoll>;
  beings: Record<number, RuinBeingRoll>;
  /** Designer-confirmed transcription (DATA_TEMPLATE.md, 2026-07-07). */
  grid: RuinGrid | null;
}

function a(atk: number, move: number, range: number): AttackerDefinition {
  return { atk, move, range, xp: atk };
}

export const RUIN_MAPS: Record<'R1' | 'R2' | 'R3', RuinMapDefinition> = {
  R1: {
    id: 'R1',
    attackers: {
      1: [a(5, 3, 1), a(3, 3, 1), a(3, 3, 1)],
      2: [a(3, 4, 3), a(3, 3, 1), a(3, 3, 1)],
      3: [a(5, 3, 1), a(3, 3, 1), a(3, 3, 1)],
    },
    items: {
      1: null, // Empty
      2: { id: 'r1-i2', name: 'Consumable SWA +3', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'SWA', bonus: 3 } },
      3: { id: 'r1-i3', name: 'Consumable PIL +3', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'PIL', bonus: 3 } },
      4: { id: 'r1-i4', name: 'Ship Part Speed +2', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'speed', bonus: 2 } },
      5: { id: 'r1-i5', name: 'Armor +3 ARM', type: 'armor', effect: { kind: 'ability_bonus', ability: 'ARM', bonus: 3 } },
      6: { id: 'r1-i6', name: 'Weapon +4 GUN', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 4 } },
    },
    beings: {
      1: null, // Decoy
      2: { id: 'r1-b2', race: 'kralkin', idealized: 'moxie', min_roll: 13, abilities: { SWA: 2, ACT: 2 } },
      3: { id: 'r1-b3', race: 'human', idealized: 'brawn', min_roll: 14, abilities: { DEM: 3, LEA: 2 } },
      4: { id: 'r1-b4', race: 'human', idealized: 'smarts', min_roll: 13, abilities: { DIP: 3, HAK: 2 } },
      5: { id: 'r1-b5', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { GUN: 3, LEA: 2 } },
      6: { id: 'r1-b6', race: 'kralkin', idealized: 'moxie', min_roll: 13, abilities: { GUN: 2, SWA: 2 } },
    },
    grid: {
      rows: [
        'GA.B....A',
        'A#..#..#.',
        '.#A.I....',
        'B#....A..',
        'A#..####.',
        '.....I.B.',
        '.........',
        '.#..#..#.',
        'S...I...S',
      ],
    },
  },
  R2: {
    id: 'R2',
    attackers: {
      1: [a(5, 3, 1), a(5, 3, 1), a(5, 3, 1)],
      2: [a(3, 3, 4), a(3, 3, 4), a(5, 4, 1)],
      3: [a(5, 3, 4), a(5, 3, 4), a(5, 4, 1)],
    },
    items: {
      1: null,
      2: { id: 'r2-i2', name: 'Consumable DEM +4', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'DEM', bonus: 4 } },
      3: { id: 'r2-i3', name: 'Consumable DIP +4', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'DIP', bonus: 4 } },
      4: { id: 'r2-i4', name: 'Ship Part Capacity +2', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'capacity', bonus: 2 } },
      5: { id: 'r2-i5', name: 'Weapon DEM +4', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'DEM', bonus: 4 } },
      6: { id: 'r2-i6', name: 'Armor SNE +4', type: 'armor', effect: { kind: 'ability_bonus', ability: 'SNE', bonus: 4 } },
    },
    beings: {
      1: null,
      2: { id: 'r2-b2', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { LEA: 3, ACT: 2 } },
      3: { id: 'r2-b3', race: 'kralkin', idealized: 'moxie', min_roll: 14, abilities: { HAK: 3, LEA: 2 } },
      4: { id: 'r2-b4', race: 'human', idealized: 'smarts', min_roll: 14, abilities: { DIP: 3, LEA: 2 } },
      5: { id: 'r2-b5', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { SNE: 3, LEA: 2 } },
      6: { id: 'r2-b6', race: 'human', idealized: 'brawn', min_roll: 14, abilities: { LEA: 4 } },
    },
    grid: {
      rows: [
        'GA..~I..A',
        '.#A.~~.#.',
        'B~....A..',
        '~~..B..~~',
        '~~#.I.#~~',
        '~~A.....~',
        'B...~....',
        '.#I.~~.#.',
        'A...~~..S',
      ],
    },
  },
  R3: {
    id: 'R3',
    attackers: {
      1: [a(7, 3, 1), a(5, 4, 2), a(5, 4, 2)],
      2: [a(5, 4, 2), a(5, 4, 2), a(5, 4, 2)],
      3: [a(7, 4, 4), a(7, 4, 2), a(5, 4, 4)],
    },
    items: {
      1: null,
      2: { id: 'r3-i2', name: 'Consumable +5 HAK', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'HAK', bonus: 5 } },
      3: { id: 'r3-i3', name: 'Consumable +5 RES', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'RES', bonus: 5 } },
      4: { id: 'r3-i4', name: 'Ship Part +4 Handling', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'handling', bonus: 4 } },
      5: { id: 'r3-i5', name: 'Weapon +4 SWA', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'SWA', bonus: 4 } },
      6: { id: 'r3-i6', name: 'Armor +4 GUN', type: 'armor', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 4 } },
    },
    beings: {
      1: null,
      2: { id: 'r3-b2', race: 'human', idealized: 'smarts', min_roll: 14, abilities: { SWA: 4 } },
      3: { id: 'r3-b3', race: 'human', idealized: 'brawn', min_roll: 14, abilities: { ACT: 4 } },
      4: { id: 'r3-b4', race: 'kralkin', idealized: 'moxie', min_roll: 14, abilities: { HAK: 4 } },
      5: { id: 'r3-b5', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { DIP: 4 } },
      6: { id: 'r3-b6', race: 'grull', idealized: 'finesse', min_roll: 14, abilities: { LEA: 4 } },
    },
    grid: {
      rows: [
        'S.A.B~~~~',
        '.A.A~~~~~',
        '.#~.~~~.I',
        '~~~.I~...',
        '~~~~...A.',
        '.........',
        'B....A.#.',
        '...A#....',
        'G.......S',
      ],
    },
  },
};
