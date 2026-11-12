// The Sweetlands Imperium board: exactly 80 play spaces + 4 start tiles,
// coordinates transcribed space-for-space from docs/games/sweetlands-imperium.md
// ("The printed board", rows 1–11 × columns 0–13; we keep (row, col)).
// Ring runs ROYGBP twice per region; roads 0–5 run toward the castle.

export type SpaceColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

export interface BoardSpace {
  id: string; // e.g. 'r1-ring-5', 'r2-road-3', 'r3-treat-regional'
  region: 1 | 2 | 3 | 4;
  zone: 'ring' | 'road' | 'treat';
  index: number; // ring/road index; treats: 0 = regional, 1 = random slot
  color: SpaceColor | null;
  row: number;
  col: number;
}

const RING_POS: Record<number, [number, number][]> = {
  1: [[11,3],[10,3],[10,4],[10,5],[11,5],[11,6],[10,7],[10,8],[10,9],[11,9],[11,10],[11,11]],
  2: [[11,12],[10,12],[10,13],[9,13],[8,13],[8,12],[6,12],[6,13],[5,13],[4,12],[3,12],[2,12]],
  3: [[2,11],[2,10],[1,10],[1,9],[1,8],[2,8],[2,6],[1,6],[1,5],[1,3],[1,2],[2,2]],
  4: [[3,2],[4,2],[4,1],[5,1],[6,1],[6,2],[8,2],[8,1],[9,1],[10,0],[11,0],[11,1]],
};

const ROAD_POS: Record<number, [number, number][]> = {
  1: [[10,6],[9,6],[9,7],[9,8],[8,8],[7,8]],
  2: [[8,11],[8,10],[7,10],[6,10],[5,10],[5,9]],
  3: [[3,8],[3,7],[3,6],[4,6],[4,7],[4,8]],
  4: [[6,3],[6,4],[7,4],[7,5],[6,5],[6,6]],
};

const TREAT_POS: Record<number, { regional: [number, number]; random: [number, number]; start: [number, number] }> = {
  1: { regional: [11,2], random: [11,7], start: [11,4] },
  2: { regional: [7,12], random: [4,13], start: [11,13] },
  3: { regional: [2,7], random: [1,4], start: [1,11] },
  4: { regional: [7,2], random: [9,0], start: [3,1] },
};

export const CYCLE: SpaceColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

/** The 80 spaces: per region 12 ring + 6 road + 2 treat slots = 20 × 4. */
export const SPACES: BoardSpace[] = ([1, 2, 3, 4] as const).flatMap((region) => [
  ...RING_POS[region]!.map(([row, col], i) => ({
    id: `r${region}-ring-${i}`, region, zone: 'ring' as const, index: i,
    color: CYCLE[i % 6]! as SpaceColor, row: row!, col: col!,
  })),
  ...ROAD_POS[region]!.map(([row, col], i) => ({
    id: `r${region}-road-${i}`, region, zone: 'road' as const, index: i,
    color: CYCLE[i]! as SpaceColor, row: row!, col: col!,
  })),
  {
    id: `r${region}-treat-regional`, region, zone: 'treat' as const, index: 0,
    color: null, row: TREAT_POS[region]!.regional[0]!, col: TREAT_POS[region]!.regional[1]!,
  },
  {
    id: `r${region}-treat-random`, region, zone: 'treat' as const, index: 1,
    color: null, row: TREAT_POS[region]!.random[0]!, col: TREAT_POS[region]!.random[1]!,
  },
]);

/** The junction spaces — first purple on each ring (index 5). */
export const JUNCTIONS: BoardSpace[] = SPACES.filter((s) => s.zone === 'ring' && s.index === 5);

/** Junction -> road 0 of the same region (the "turn off the ring" step). */
export const JUNCTION_ROADS: Record<string, string> = Object.fromEntries(
  JUNCTIONS.map((j) => [j.id, `r${j.region}-road-0`]),
);

export const CASTLE_POS: [number, number][] = [[5,7],[5,8],[6,7],[6,8]];

export const TREATS = TREAT_POS;

export const REGION_FACTION: Record<number, { name: string; colorKey: string; color: string; treatArt: string }> = {
  1: { name: 'Arch Duchess of Milkshake', colorKey: 'milkshake', color: '#f5a623', treatArt: '/art/sweetlands/treat-milkshake-1.png' },
  2: { name: 'General Fudge', colorKey: 'fudge', color: '#8b5a2b', treatArt: '/art/sweetlands/treat-fudge-1.png' },
  3: { name: 'Princess Jellybean', colorKey: 'jellybean', color: '#9013fe', treatArt: '/art/sweetlands/treat-jellybean-1.png' },
  4: { name: 'Grand Vizier Cheesecake', colorKey: 'cheesecake', color: '#f0f0f0', treatArt: '/art/sweetlands/treat-cheesecake-1.png' },
};

/** The printed (PICO-8) space colors, purple the muted one; the same on the
 *  cards and in the color guide (docs/design/sweetlands-candy). */
export const SPACE_COLORS: Record<SpaceColor, string> = {
  red: '#ff004d', orange: '#ffa300', yellow: '#ffec27',
  green: '#00e436', blue: '#29adff', purple: '#83769c',
};

/** Board extents: rows 1..11, cols 0..13. */
export const BOARD = { rows: 11, cols: 13 };
