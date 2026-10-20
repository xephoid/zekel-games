// Sweetlands Imperium — faction definitions.
//
// Source: SWEETLANDS-RULES.md §2 (final art names; abilities mapped from the
// rulebook's old faction names, designer-confirmed). 5 factions: 4 region-holders
// + the region-less Unsweetened Nomads.

import type { FactionDef, FactionId } from '../types.js';

export const FACTIONS: Record<FactionId, FactionDef> = {
  milkshake: {
    id: 'milkshake',
    name: 'Arch Duchess of Milkshake',
    homeRegion: 1,
    color: 'yellow',
    ability: 'You never pay taxes.',
  },
  fudge: {
    id: 'fudge',
    name: 'General Fudge',
    homeRegion: 2,
    color: 'brown',
    ability: 'Discard 2 Intel (instead of 4) to convert into one Intel of any color.',
  },
  jellybean: {
    id: 'jellybean',
    name: 'Princess Jellybean',
    homeRegion: 3,
    color: 'purple',
    ability: 'Your knight always wins battles when attacking another knight (not the castle foe).',
  },
  cheesecake: {
    id: 'cheesecake',
    name: 'Grand Vizier Cheesecake',
    homeRegion: 4,
    color: 'white',
    ability: 'Treat Intel cards can be used to move to ANY special treat location.',
  },
  nomads: {
    id: 'nomads',
    name: 'Deposed Queen Quiche',
    homeRegion: null,
    color: 'black',
    ability:
      'You may start your units in any region\'s starting location. Having no region, you ' +
      'always gain +3 influence (Orange) and always gain +2 Intel (Blue/Gain). You cannot ' +
      'collect taxes. You start with 0 sugar cubes and no secret objectives.',
  },
};

export const FACTION_IDS: FactionId[] = ['milkshake', 'fudge', 'jellybean', 'cheesecake', 'nomads'];

/** The region-less faction(s). */
export function isNomads(id: FactionId): boolean {
  return id === 'nomads';
}

/** Factions a player may pick at a given count: Nomads is 5-player only. */
export function availableFactionIds(playerCount: number): FactionId[] {
  return playerCount === 5 ? FACTION_IDS : FACTION_IDS.filter((id) => id !== 'nomads');
}
