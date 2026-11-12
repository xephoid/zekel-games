// Drawing geometry for the candy board, computed once from the printed board's
// coordinates (sweetlands-board.ts). None of it is a rule: which land an empty
// grid square is painted as, which way a road arrow points, which side of the
// board a land's label sits on.

import { CASTLE_POS, SPACES, TREATS, type BoardSpace } from './sweetlands-board.js';

export const COLS = 14; // columns 0..13
export const ROWS = 11; // rows 1..11
export const SQUARE = 48; // px at the design size

export type Region = 1 | 2 | 3 | 4;
export const REGIONS: Region[] = [1, 2, 3, 4];

const key = (row: number, col: number) => `${row},${col}`;

/** Every tile on the board: the 80 spaces and the four start tiles. */
export interface Tile {
  id: string; // the space id (r1-ring-0, r2-road-3, r3-treat-random, r4-start)
  region: Region;
  row: number;
  col: number;
  space: BoardSpace | null; // null for a start tile
}

export const TILES: Tile[] = [
  ...SPACES.map((s) => ({ id: s.id, region: s.region, row: s.row, col: s.col, space: s })),
  ...REGIONS.map((r) => ({ id: `r${r}-start`, region: r, row: TREATS[r]!.start[0]!, col: TREATS[r]!.start[1]!, space: null })),
];

export const TILE_BY_ID: Record<string, Tile> = Object.fromEntries(TILES.map((t) => [t.id, t]));

const castleSquares = new Set(CASTLE_POS.map(([r, c]) => key(r!, c!)));

/**
 * The land each grid square is painted as: a tile its own region's; an empty
 * square the region of the nearest tile (straight-line distance, ties to the
 * lower region); the four castle squares nobody's (0).
 */
export const LAND: Record<string, Region | 0> = (() => {
  const out: Record<string, Region | 0> = {};
  const own = new Map(TILES.map((t) => [key(t.row, t.col), t.region]));
  for (let row = 1; row <= ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const k = key(row, col);
      if (castleSquares.has(k)) { out[k] = 0; continue; }
      const mine = own.get(k);
      if (mine) { out[k] = mine; continue; }
      let best = Infinity;
      let region: Region = 1;
      for (const t of TILES) {
        const d = Math.hypot(t.row - row, t.col - col);
        if (d < best - 1e-9 || (Math.abs(d - best) <= 1e-9 && t.region < region)) { best = d; region = t.region; }
      }
      out[k] = region;
    }
  }
  return out;
})();

export function landAt(row: number, col: number): Region | 0 | undefined {
  return LAND[key(row, col)];
}

/** The sides of a square where the land changes (drawn as the land's outline). */
export function landEdges(row: number, col: number): { top: boolean; right: boolean; bottom: boolean; left: boolean } {
  const here = landAt(row, col);
  const differs = (r: number, c: number) => landAt(r, c) !== here;
  return { top: differs(row - 1, col), right: differs(row, col + 1), bottom: differs(row + 1, col), left: differs(row, col - 1) };
}

/** Degrees to turn a right-pointing arrow toward a neighbouring square. */
function angleTo(from: [number, number], to: [number, number]): number {
  const dr = to[0] - from[0];
  const dc = to[1] - from[1];
  return dc === 1 ? 0 : dc === -1 ? 180 : dr === 1 ? 90 : -90;
}

/** Each road space's arrow: toward the next road space, the last one toward the castle square it touches. */
export const ROAD_ARROW: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const r of REGIONS) {
    const road = SPACES.filter((s) => s.region === r && s.zone === 'road').sort((a, b) => a.index - b.index);
    road.forEach((s, i) => {
      const next = road[i + 1];
      if (next) { out[s.id] = angleTo([s.row, s.col], [next.row, next.col]); return; }
      const castle = CASTLE_POS.find(([cr, cc]) => Math.abs(cr! - s.row) + Math.abs(cc! - s.col) === 1);
      if (castle) out[s.id] = angleTo([s.row, s.col], [castle[0]!, castle[1]!]);
    });
  }
  return out;
})();

/** The castle's corner squares on the grid (rows and columns, 1-based for CSS). */
export const CASTLE_AREA = (() => {
  const rows = CASTLE_POS.map(([r]) => r!);
  const cols = CASTLE_POS.map(([, c]) => c!);
  return { row: Math.min(...rows), col: Math.min(...cols) + 1, rowSpan: Math.max(...rows) - Math.min(...rows) + 1, colSpan: Math.max(...cols) - Math.min(...cols) + 1 };
})();

/** Which side of the board each land's label sits on, and which way pieces travel along it
 *  (counter-clockwise: bottom →, right ↑, top ←, left ↓). */
export const SIDE: Record<Region, { side: 'bottom' | 'right' | 'top' | 'left'; arrow: number }> = {
  1: { side: 'bottom', arrow: 0 },
  2: { side: 'right', arrow: -90 },
  3: { side: 'top', arrow: 180 },
  4: { side: 'left', arrow: 90 },
};
