import type { AbilityId, CardRank, MissionDefinition, RecruitDefinition, RuinDepth } from '../types.js';

// The four Space Travel Tables — WR §9, locked data. Every one of the 52 cards
// maps to exactly one row:
//   ♥ A–K            → recruits (13)
//   ♦ 2–9            → pirates (8)
//   ♦ 10,J,Q,K,A     → ruins discoveries (5)
//   ♠ A–K            → hazards (13)
//   ♣ 2–10 (dual) + J,Q,K,A (ruins missions) → missions (13)

// --------------------------------------------------------------------------
// ♥ Recruits (WR §9)
// --------------------------------------------------------------------------

export const HEART_RECRUITS: Record<CardRank, RecruitDefinition> = {
  A: { id: 'heart-A', race: 'hexapod', idealized: 'smarts', min_roll: 13, abilities: { PIL: 3 } },
  '2': { id: 'heart-2', race: 'grull', idealized: 'finesse', min_roll: 12, abilities: { MEC: 2, DIP: 1 } },
  '3': { id: 'heart-3', race: 'grull', idealized: 'finesse', min_roll: 13, abilities: { HAK: 3 } },
  '4': { id: 'heart-4', race: 'kralkin', idealized: 'moxie', min_roll: 13, abilities: { SWA: 3 } },
  '5': { id: 'heart-5', race: 'kralkin', idealized: 'moxie', min_roll: 12, abilities: { DIP: 2, ARM: 1 } },
  '6': { id: 'heart-6', race: 'kralkin', idealized: 'moxie', min_roll: 12, abilities: { ARM: 2, GUN: 1 } },
  '7': { id: 'heart-7', race: 'human', idealized: 'brawn', min_roll: 13, abilities: { DEM: 3 } },
  '8': { id: 'heart-8', race: 'hexapod', idealized: 'smarts', min_roll: 13, abilities: { SNE: 3 } },
  '9': { id: 'heart-9', race: 'human', idealized: 'brawn', min_roll: 13, abilities: { ARM: 3 } },
  '10': { id: 'heart-10', race: 'hexapod', idealized: 'smarts', min_roll: 12, abilities: { SNE: 2, DIP: 1 } },
  J: { id: 'heart-J', race: 'kralkin', idealized: 'moxie', min_roll: 13, abilities: { MEC: 3 } },
  Q: { id: 'heart-Q', race: 'grull', idealized: 'finesse', min_roll: 12, abilities: { RES: 2, MEC: 1 } },
  K: { id: 'heart-K', race: 'human', idealized: 'brawn', min_roll: 12, abilities: { ACT: 2, SWA: 1 } },
};

// --------------------------------------------------------------------------
// ♦ 2–9 Pirates (WR §9)
// --------------------------------------------------------------------------

export type PirateSpecial = 'space_combat_advantage' | 'minus_2_enemy_space_bonus';

export interface PirateDefinition {
  id: string;
  space_attack: number;
  ground_attack: number;
  capacity: number;
  speed: number;
  handling: number;
  min_hacking: number;
  special: PirateSpecial | null;
}

export type PirateRank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export const DIAMOND_PIRATES: Record<PirateRank, PirateDefinition> = {
  '2': { id: 'pirate-2', space_attack: 7, ground_attack: 5, capacity: 7, speed: 2, handling: 4, min_hacking: 15, special: null },
  '3': { id: 'pirate-3', space_attack: 3, ground_attack: 1, capacity: 3, speed: 0, handling: 2, min_hacking: 12, special: null },
  '4': { id: 'pirate-4', space_attack: 5, ground_attack: 2, capacity: 5, speed: 0, handling: 0, min_hacking: 13, special: 'space_combat_advantage' },
  '5': { id: 'pirate-5', space_attack: 3, ground_attack: 1, capacity: 3, speed: 2, handling: 0, min_hacking: 12, special: null },
  '6': { id: 'pirate-6', space_attack: 3, ground_attack: 1, capacity: 4, speed: 0, handling: 0, min_hacking: 12, special: null },
  '7': { id: 'pirate-7', space_attack: 5, ground_attack: 2, capacity: 5, speed: 2, handling: 0, min_hacking: 13, special: null },
  '8': { id: 'pirate-8', space_attack: 3, ground_attack: 1, capacity: 3, speed: 0, handling: 0, min_hacking: 12, special: 'minus_2_enemy_space_bonus' },
  '9': { id: 'pirate-9', space_attack: 3, ground_attack: 1, capacity: 4, speed: 1, handling: 0, min_hacking: 12, special: null },
};

// --------------------------------------------------------------------------
// ♦ 10,J,Q,K,A Ruins discoveries (WR §9) — entry optional (ruling in WR §9)
// --------------------------------------------------------------------------

export type RuinDiamondRank = '10' | 'J' | 'Q' | 'K' | 'A';

export const DIAMOND_RUINS: Record<RuinDiamondRank, RuinDepth> = {
  A: 3,
  '10': 1,
  J: 2,
  Q: 3,
  K: 2,
};

// --------------------------------------------------------------------------
// ♠ Hazards (WR §9–§10). The failure consequence is derived from the rolled
// ability's stat group (HAZARD_CONSEQUENCE_BY_STAT) — the printed consequences
// match the derivation for all 26 options (locked by the data parity test).
// --------------------------------------------------------------------------

export interface HazardOption {
  ability: AbilityId;
  min_roll: number;
}

export interface HazardDefinition {
  option1: HazardOption;
  option2: HazardOption;
}

export const SPADE_HAZARDS: Record<CardRank, HazardDefinition> = {
  A: { option1: { ability: 'PIL', min_roll: 10 }, option2: { ability: 'HAK', min_roll: 15 } },
  '2': { option1: { ability: 'SNE', min_roll: 10 }, option2: { ability: 'RES', min_roll: 15 } },
  '3': { option1: { ability: 'RES', min_roll: 10 }, option2: { ability: 'SWA', min_roll: 15 } },
  '4': { option1: { ability: 'ACT', min_roll: 10 }, option2: { ability: 'RES', min_roll: 15 } },
  '5': { option1: { ability: 'GUN', min_roll: 10 }, option2: { ability: 'MEC', min_roll: 15 } },
  '6': { option1: { ability: 'PIL', min_roll: 10 }, option2: { ability: 'DIP', min_roll: 15 } },
  '7': { option1: { ability: 'RES', min_roll: 10 }, option2: { ability: 'GUN', min_roll: 15 } },
  '8': { option1: { ability: 'SNE', min_roll: 10 }, option2: { ability: 'LEA', min_roll: 15 } },
  '9': { option1: { ability: 'ARM', min_roll: 10 }, option2: { ability: 'HAK', min_roll: 15 } },
  '10': { option1: { ability: 'SNE', min_roll: 10 }, option2: { ability: 'LEA', min_roll: 15 } },
  J: { option1: { ability: 'ACT', min_roll: 10 }, option2: { ability: 'PIL', min_roll: 15 } },
  Q: { option1: { ability: 'DIP', min_roll: 10 }, option2: { ability: 'DEM', min_roll: 15 } },
  K: { option1: { ability: 'MEC', min_roll: 10 }, option2: { ability: 'ACT', min_roll: 15 } },
};

// --------------------------------------------------------------------------
// ♣ Missions (WR §9). 2–10 offer a choice of two; J/Q/K/A are single ruins
// missions (no ability gate — ruling in WR §7).
// --------------------------------------------------------------------------

export type ClubMissionEntry =
  | { kind: 'choice'; option1: MissionDefinition; option2: MissionDefinition }
  | { kind: 'ruins'; mission: MissionDefinition };

function m(id: string, distance: number, ability: AbilityId, min: number, credits: number, xp: number): MissionDefinition {
  return { id, distance, goal: { kind: 'ability_check', ability, min_roll: min }, credits, xp };
}

function rm(id: string, distance: number, depth: RuinDepth, credits: number, xp: number): MissionDefinition {
  return { id, distance, goal: { kind: 'ruin', depth }, credits, xp };
}

export const CLUB_MISSIONS: Record<CardRank, ClubMissionEntry> = {
  '2': { kind: 'choice', option1: m('club-2-1', 4, 'DIP', 10, 200, 1), option2: m('club-2-2', 8, 'HAK', 15, 400, 2) },
  '3': { kind: 'choice', option1: m('club-3-1', 4, 'LEA', 10, 200, 1), option2: m('club-3-2', 8, 'SWA', 14, 400, 2) },
  '4': { kind: 'choice', option1: m('club-4-1', 4, 'ACT', 10, 200, 1), option2: m('club-4-2', 8, 'MEC', 15, 400, 2) },
  '5': { kind: 'choice', option1: m('club-5-1', 6, 'LEA', 15, 300, 1), option2: m('club-5-2', 12, 'RES', 15, 600, 3) },
  '6': { kind: 'choice', option1: m('club-6-1', 6, 'HAK', 15, 300, 1), option2: m('club-6-2', 12, 'GUN', 14, 600, 3) },
  '7': { kind: 'choice', option1: m('club-7-1', 4, 'RES', 10, 250, 1), option2: m('club-7-2', 8, 'PIL', 15, 400, 2) },
  '8': { kind: 'choice', option1: m('club-8-1', 4, 'PIL', 10, 250, 1), option2: m('club-8-2', 8, 'RES', 15, 400, 2) },
  '9': { kind: 'choice', option1: m('club-9-1', 4, 'MEC', 10, 250, 1), option2: m('club-9-2', 8, 'ACT', 15, 400, 2) },
  '10': { kind: 'choice', option1: m('club-10-1', 6, 'DIP', 15, 300, 1), option2: m('club-10-2', 12, 'LEA', 15, 700, 3) },
  J: { kind: 'ruins', mission: rm('club-J', 8, 1, 1400, 2) },
  Q: { kind: 'ruins', mission: rm('club-Q', 12, 2, 1600, 3) },
  K: { kind: 'ruins', mission: rm('club-K', 16, 3, 1800, 4) },
  A: { kind: 'ruins', mission: rm('club-A', 10, 3, 1500, 3) },
};
