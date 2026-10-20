import type { AbilityId, Race, StatId } from '../types.js';

// WR §3 — the stat/ability vocabulary, locked.

export const STAT_ABILITIES: Record<StatId, readonly AbilityId[]> = {
  brawn: ['SWA', 'ARM', 'DEM'],
  smarts: ['HAK', 'RES', 'MEC'],
  finesse: ['PIL', 'GUN', 'SNE'],
  moxie: ['LEA', 'DIP', 'ACT'],
};

export const ABILITY_STAT: Record<AbilityId, StatId> = {
  SWA: 'brawn', ARM: 'brawn', DEM: 'brawn',
  HAK: 'smarts', RES: 'smarts', MEC: 'smarts',
  PIL: 'finesse', GUN: 'finesse', SNE: 'finesse',
  LEA: 'moxie', DIP: 'moxie', ACT: 'moxie',
};

export const ABILITY_NAMES: Record<AbilityId, string> = {
  SWA: 'Swashbuckling',
  ARM: 'Armor',
  DEM: 'Demolitions',
  HAK: 'Hacking',
  RES: 'Research',
  MEC: 'Mechanics',
  PIL: 'Piloting',
  GUN: 'Gunslinging',
  SNE: 'Sneaking',
  LEA: 'Leadership',
  DIP: 'Diplomacy',
  ACT: 'Acting',
};

/** Which stat each race idealizes (recruiting; WR §3, §6). */
export const RACE_IDEALIZED: Record<Race, StatId> = {
  human: 'brawn',
  kralkin: 'moxie',
  hexapod: 'smarts',
  grull: 'finesse',
};

/** Failed-hazard consequence by the rolled ability's stat group (WR §10). */
export type HazardConsequence = 'death' | 'lose_credits' | 'ship_damage' | 'crew_unrest';

export const HAZARD_CONSEQUENCE_BY_STAT: Record<StatId, HazardConsequence> = {
  brawn: 'death',
  smarts: 'lose_credits',
  finesse: 'ship_damage',
  moxie: 'crew_unrest',
};
