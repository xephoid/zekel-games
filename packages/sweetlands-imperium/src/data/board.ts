// Sweetlands Imperium — board topology (data).
//
// Source of truth: ../DATA_TEMPLATE.md (transcribed from the rulebook board image,
// designer-confirmed). See SWEETLANDS-RULES.md §10.
//
// Model (confirmed):
//  - 4 regions in a ring, ordered 1 -> 2 -> 3 -> 4 -> 1, movement always
//    COUNTER-CLOCKWISE. Region 1 = bottom, 2 = right, 3 = top, 4 = left.
//  - Each region's 12 ring spaces are two full ROYGBP runs. The 1st purple
//    (ringIndex 5) is the JUNCTION; the 2nd purple (ringIndex 11) is the EXIT
//    that links to the next region's first red.
//  - Movement resolves by JUMP-TO-NEXT-MATCHING-COLOR along this ordered ring
//    (not pixel adjacency), so the `coord` fields are reference/display only.
//  - At a junction a unit may instead branch onto that region's 6-space road
//    (also ROYGBP, castle-ward), whose final purple ENTERS the single castle node.
//  - 8 treat locations are SIDE NODES (reached via treat Intel cards, not normal
//    color moves): 4 regional faction treats + 4 random `?` slots.

export type SpaceColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';
export type RegionId = 1 | 2 | 3 | 4;

/** ROYGBP — the canonical color cycle; ring/road spaces follow it. */
export const COLOR_SEQUENCE: readonly SpaceColor[] = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple',
] as const;

export function nextColor(c: SpaceColor): SpaceColor {
  return COLOR_SEQUENCE[(COLOR_SEQUENCE.indexOf(c) + 1) % 6]!;
}

export type Coord = readonly [row: number, col: number];

export interface RingSpace {
  region: RegionId;
  ringIndex: number; // 0..11, counter-clockwise from the region's entry red
  color: SpaceColor;
  coord: Coord;
}

export interface RoadSpace {
  region: RegionId;
  roadIndex: number; // 0..5, castle-ward (0 = nearest junction red, 5 = castle-entrance purple)
  color: SpaceColor;
  coord: Coord;
}

export type TreatId =
  // regional (faction) treats, one per region
  | 'milkshake' | 'fudge' | 'jellybean' | 'cheesecake'
  // random treats, placed at setup into the `?` slots
  | 'ice_cream' | 'chocolate_bar' | 'gummy_bear' | 'cupcake';

export interface TreatLocation {
  id: TreatId;
  kind: 'regional' | 'random';
  region: RegionId; // region the slot physically sits in
  coord: Coord;
}

/** Ordered ring per region (CCW). Color is always ROYGBP,ROYGBP by index. */
export const REGION_RINGS: Record<RegionId, Coord[]> = {
  1: [[11, 3], [10, 3], [10, 4], [10, 5], [11, 5], [11, 6], [10, 7], [10, 8], [10, 9], [11, 9], [11, 10], [11, 11]],
  2: [[11, 12], [10, 12], [10, 13], [9, 13], [8, 13], [8, 12], [6, 12], [6, 13], [5, 13], [4, 12], [3, 12], [2, 12]],
  3: [[2, 11], [2, 10], [1, 10], [1, 9], [1, 8], [2, 8], [2, 6], [1, 6], [1, 5], [1, 3], [1, 2], [2, 2]],
  4: [[3, 2], [4, 2], [4, 1], [5, 1], [6, 1], [6, 2], [8, 2], [8, 1], [9, 1], [10, 0], [11, 0], [11, 1]],
};

/** Ordered road per region, castle-ward (R,O,Y,G,B,P); index 5 (P) enters the castle. */
export const REGION_ROADS: Record<RegionId, Coord[]> = {
  1: [[10, 6], [9, 6], [9, 7], [9, 8], [8, 8], [7, 8]],
  2: [[8, 11], [8, 10], [7, 10], [6, 10], [5, 10], [5, 9]],
  3: [[3, 8], [3, 7], [3, 6], [4, 6], [4, 7], [4, 8]],
  4: [[6, 3], [6, 4], [7, 4], [7, 5], [6, 5], [6, 6]],
};

export const JUNCTION_RING_INDEX = 5; // the 1st purple — branch point onto the road
export const EXIT_RING_INDEX = 11; // the 2nd purple — links to next region's entry red

/** Region entered next when leaving this region's exit (CCW): 1->2->3->4->1. */
export const NEXT_REGION: Record<RegionId, RegionId> = { 1: 2, 2: 3, 3: 4, 4: 1 };

/** Per-region faction (regional treat) and the region's faction identity. */
export const REGION_TREAT: Record<RegionId, TreatId> = {
  1: 'milkshake', 2: 'fudge', 3: 'jellybean', 4: 'cheesecake',
};

export const TREAT_LOCATIONS: TreatLocation[] = [
  { id: 'milkshake', kind: 'regional', region: 1, coord: [11, 2] },
  { id: 'fudge', kind: 'regional', region: 2, coord: [7, 12] },
  { id: 'jellybean', kind: 'regional', region: 3, coord: [2, 7] },
  { id: 'cheesecake', kind: 'regional', region: 4, coord: [7, 2] },
  // random treat slots (the dashed `?`); which treat tile lands where is set at setup
  { id: 'ice_cream', kind: 'random', region: 1, coord: [11, 7] },
  { id: 'chocolate_bar', kind: 'random', region: 2, coord: [4, 13] },
  { id: 'gummy_bear', kind: 'random', region: 3, coord: [1, 4] },
  { id: 'cupcake', kind: 'random', region: 4, coord: [9, 0] },
];

/** Each region's unit starting tile (also the return point on capture / unpaid tax). */
export const START_TILES: Record<RegionId, Coord> = {
  1: [11, 4], 2: [11, 13], 3: [1, 11], 4: [3, 1],
};

/** The castle is a single node (physically 4 spaces). The four road purples enter it. */
export const CASTLE_ID = 'castle';

/** Build the flat list of ring spaces with derived colors. */
export function buildRingSpaces(): RingSpace[] {
  const out: RingSpace[] = [];
  for (const region of [1, 2, 3, 4] as RegionId[]) {
    REGION_RINGS[region].forEach((coord, ringIndex) => {
      out.push({ region, ringIndex, color: COLOR_SEQUENCE[ringIndex % 6]!, coord });
    });
  }
  return out;
}

export function buildRoadSpaces(): RoadSpace[] {
  const out: RoadSpace[] = [];
  for (const region of [1, 2, 3, 4] as RegionId[]) {
    REGION_ROADS[region].forEach((coord, roadIndex) => {
      out.push({ region, roadIndex, color: COLOR_SEQUENCE[roadIndex % 6]!, coord });
    });
  }
  return out;
}
