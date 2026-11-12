// The six factions' inks, from the design canvas (Faction Marks, Table).
// Colour says whose; the mark says what. The engine names the colour ("White",
// "Red"…) in its reference data; these are the inks the canvas prints it in.

import type { NggView } from './read.js';

export interface FactionInk {
  name: string;
  fill: string;
  /** the glyph and text colour on the fill */
  on: string;
  /** the icon registry's mark for the faction */
  mark: string;
}

const INKS: Record<string, FactionInk> = {
  'The Covenant': { name: 'The Covenant', fill: '#f0ece2', on: '#1c1a17', mark: 'The Covenant' },
  'The Schism': { name: 'The Schism', fill: '#c0392b', on: '#ffffff', mark: 'The Schism' },
  'The Brass Circle': { name: 'The Brass Circle', fill: '#2f6f9f', on: '#ffffff', mark: 'The Brass Circle' },
  'The Ledger': { name: 'The Ledger', fill: '#6b4fa0', on: '#ffffff', mark: 'The Ledger' },
  'The Foundry': { name: 'The Foundry', fill: '#d8a020', on: '#1c1a17', mark: 'The Foundry' },
  'The Unbolted': { name: 'The Unbolted', fill: '#3f7d52', on: '#ffffff', mark: 'The Unbolted' },
};

/** A seat with no faction yet (setup) still needs a colour to be told apart. */
const UNASSIGNED: FactionInk = { name: '', fill: '#b9b1a2', on: '#1c1a17', mark: '' };

export function inkOf(faction: string | null | undefined): FactionInk {
  return (faction && INKS[faction]) || UNASSIGNED;
}

export function inkOfSeat(v: NggView, playerId: string | null | undefined): FactionInk {
  return inkOf(v.players.find((p) => p.id === playerId)?.faction);
}

/** Map-tile inks and the darker chip fills, per resource. */
export const TERRAIN: Record<string, { tile: string; chip: string; icon: string; name: string }> = {
  water: { tile: '#4d86ab', chip: '#2f6b91', icon: 'Water', name: 'Water' },
  wood: { tile: '#57804a', chip: '#3f6730', icon: 'Wood', name: 'Wood' },
  ore: { tile: '#8d8577', chip: '#6f6858', icon: 'Ore', name: 'Ore' },
  oil: { tile: '#3a342c', chip: '#2f2a24', icon: 'Oil', name: 'Oil' },
  ether: { tile: '#7b55bd', chip: '#6f43b5', icon: 'Ether', name: 'Ether' },
};

export const TREATY_INK: Record<string, string> = {
  'Open Borders': '#2f6f9f',
  'Shared Resources': '#3f7d52',
  Peace: '#6f6858',
  'Culture Treaty': '#6b4fa0',
  'Shared Tactics': '#b06a28',
};

/** Two initials for a hero token: heroes carry letters, never a mark. */
/** A hero's initials, on the map and in the Heroes list alike: the first
 *  letters of the last two words of its name ("Envoy Sable Marrow" → SM,
 *  "Dr. Elayn Smyth" → ES). No two heroes share a pair. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return words.map((w) => w[0]).slice(-2).join('').toUpperCase() || name.slice(0, 2).toUpperCase();
}

/** The icon for a unit's printed name; the registry's aliases cover the long names. */
export function unitIcon(name: string): string {
  return name;
}
