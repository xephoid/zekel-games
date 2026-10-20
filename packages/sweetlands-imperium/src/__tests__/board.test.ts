import { describe, it, expect } from 'vitest';
import {
  REGION_RINGS, REGION_ROADS, REGION_TREAT, TREAT_LOCATIONS, START_TILES,
  NEXT_REGION, COLOR_SEQUENCE, JUNCTION_RING_INDEX, EXIT_RING_INDEX,
  buildRingSpaces, buildRoadSpaces, nextColor, type RegionId, type Coord,
} from '../data/board.js';

const REGIONS: RegionId[] = [1, 2, 3, 4];
const key = (c: Coord) => `${c[0]},${c[1]}`;

describe('board topology', () => {
  it('has 4 regions, each with a 12-space ring and a 6-space road', () => {
    for (const r of REGIONS) {
      expect(REGION_RINGS[r]).toHaveLength(12);
      expect(REGION_ROADS[r]).toHaveLength(6);
    }
  });

  it('ring colors follow ROYGBP twice; junction/exit are purple', () => {
    const ring = buildRingSpaces();
    expect(ring).toHaveLength(48);
    for (const s of ring) {
      expect(s.color).toBe(COLOR_SEQUENCE[s.ringIndex % 6]);
    }
    for (const r of REGIONS) {
      const reg = ring.filter((s) => s.region === r);
      expect(reg[JUNCTION_RING_INDEX]!.color).toBe('purple');
      expect(reg[EXIT_RING_INDEX]!.color).toBe('purple');
    }
  });

  it('road colors follow ROYGBP castle-ward (purple enters the castle)', () => {
    const road = buildRoadSpaces();
    expect(road).toHaveLength(24);
    for (const s of road) {
      expect(s.color).toBe(COLOR_SEQUENCE[s.roadIndex % 6]);
    }
    for (const r of REGIONS) {
      const reg = road.filter((s) => s.region === r);
      expect(reg[5]!.color).toBe('purple'); // castle entrance
    }
  });

  it('totals 80 spaces: 48 ring + 24 road + 8 treats', () => {
    expect(48 + 24 + TREAT_LOCATIONS.length).toBe(80);
  });

  it('has 8 treat locations: 4 regional (matching faction) + 4 random', () => {
    const regional = TREAT_LOCATIONS.filter((t) => t.kind === 'regional');
    const random = TREAT_LOCATIONS.filter((t) => t.kind === 'random');
    expect(regional).toHaveLength(4);
    expect(random).toHaveLength(4);
    for (const r of REGIONS) {
      const t = regional.find((x) => x.region === r);
      expect(t?.id).toBe(REGION_TREAT[r]);
    }
  });

  it('every board coordinate is unique (rings, roads, treats, start tiles)', () => {
    const coords: Coord[] = [
      ...REGIONS.flatMap((r) => REGION_RINGS[r]),
      ...REGIONS.flatMap((r) => REGION_ROADS[r]),
      ...TREAT_LOCATIONS.map((t) => t.coord),
      ...REGIONS.map((r) => START_TILES[r]),
    ];
    const seen = new Set(coords.map(key));
    expect(seen.size).toBe(coords.length);
  });

  it('region links form a single 4-cycle 1->2->3->4->1', () => {
    let cur: RegionId = 1;
    const visited: RegionId[] = [];
    for (let i = 0; i < 4; i++) { visited.push(cur); cur = NEXT_REGION[cur]; }
    expect(visited.sort()).toEqual([1, 2, 3, 4]);
    expect(cur).toBe(1); // closed the loop
  });

  it('nextColor cycles ROYGBP', () => {
    expect(nextColor('red')).toBe('orange');
    expect(nextColor('purple')).toBe('red');
  });
});
