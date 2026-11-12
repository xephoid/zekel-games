// The table's inks, copied from zekel-universe apps/web/src/glue/ngg/factions.ts
// (from the design canvas: Faction Marks, Table). Colour says whose; the mark
// says what. Like icons.gen.ts, this becomes the only copy when the screen
// moves here; until then change both together.

export interface FactionInk { fill: string; on: string }

const INKS: Record<string, FactionInk> = {
  'The Covenant': { fill: '#f0ece2', on: '#1c1a17' },
  'The Schism': { fill: '#c0392b', on: '#ffffff' },
  'The Brass Circle': { fill: '#2f6f9f', on: '#ffffff' },
  'The Ledger': { fill: '#6b4fa0', on: '#ffffff' },
  'The Foundry': { fill: '#d8a020', on: '#1c1a17' },
  'The Unbolted': { fill: '#3f7d52', on: '#ffffff' },
};
const UNASSIGNED: FactionInk = { fill: '#b9b1a2', on: '#1c1a17' };

export const FACTION_NAMES = Object.keys(INKS);

export function inkOf(faction: string | null | undefined): FactionInk {
  return (faction && INKS[faction]) || UNASSIGNED;
}

/** Map-tile inks and the darker chip fills, per resource. The board's, the same for every seat. */
export const TERRAIN: Record<string, { tile: string; chip: string; icon: string; name: string }> = {
  water: { tile: '#4d86ab', chip: '#2f6b91', icon: 'Water', name: 'Water' },
  wood: { tile: '#57804a', chip: '#3f6730', icon: 'Wood', name: 'Wood' },
  ore: { tile: '#8d8577', chip: '#6f6858', icon: 'Ore', name: 'Ore' },
  oil: { tile: '#3a342c', chip: '#2f2a24', icon: 'Oil', name: 'Oil' },
  ether: { tile: '#7b55bd', chip: '#6f43b5', icon: 'Ether', name: 'Ether' },
};
export const RESOURCES = ['water', 'wood', 'ore', 'oil', 'ether'] as const;

export const TREATY_INK: Record<string, string> = {
  'Open Borders': '#2f6f9f',
  'Shared Resources': '#3f7d52',
  Peace: '#6f6858',
  'Culture Treaty': '#6b4fa0',
  'Shared Tactics': '#b06a28',
};
