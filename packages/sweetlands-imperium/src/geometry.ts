// Sweetlands Imperium — movement geometry.
//
// Movement resolves by JUMP-TO-NEXT-MATCHING-COLOR along the ordered track
// (SWEETLANDS-RULES.md §4): play color C, advance a unit counter-clockwise to the
// next space of color C. The ring is one big cycle (regions 1->2->3->4->1); each
// region's 1st purple (ring index 5) is a JUNCTION where a unit may branch onto
// the region's road (-> castle) instead of continuing the ring. Treat side-nodes
// are reached only via treat cards and rejoin the ring when left with a color card.

import {
  COLOR_SEQUENCE, NEXT_REGION, type SpaceColor, type RegionId,
} from './data/board.js';
import type { UnitLocation } from './types.js';

export const JUNCTION_INDEX = 5; // 1st purple
export const EXIT_INDEX = 11; // 2nd purple
export const ROAD_CASTLE_INDEX = 5; // road purple = castle entrance

/** Color of a track space, or null for off-track nodes (start/treat/castle). */
export function colorOf(loc: UnitLocation): SpaceColor | null {
  if (loc.zone === 'ring') return COLOR_SEQUENCE[loc.ringIndex % 6]!;
  if (loc.zone === 'road') return COLOR_SEQUENCE[loc.roadIndex % 6]!;
  return null;
}

/** The region a location belongs to (null for the castle / off-board). */
export function regionOf(loc: UnitLocation): RegionId | null {
  switch (loc.zone) {
    case 'start': case 'ring': case 'road': case 'treat': return loc.region;
    case 'castle': case 'offboard': return null;
  }
}

/** Where a treat side-node rejoins the ring when a unit leaves it via a color
 *  card. Keyed by the physical slot (region + regional/random). Derived from the
 *  board transcription (DATA_TEMPLATE.md): regional slots sit just before the
 *  segment-B red (ring index 6), except Milkshake which sits at the region entry
 *  (index 0); random slots sit before a green (index 9), except R1's (index 6). */
export function treatRejoin(region: RegionId, slotKind: 'regional' | 'random'): UnitLocation {
  let ringIndex: number;
  if (slotKind === 'regional') {
    ringIndex = region === 1 ? 0 : 6;
  } else {
    ringIndex = region === 1 ? 6 : 9;
  }
  return { zone: 'ring', region, ringIndex };
}

/** One CCW step from a location. At a junction the caller picks the fork via
 *  `preferRoad`. Returns null from the castle (a dead end — leave only by recall). */
export function step(loc: UnitLocation, preferRoad: boolean): UnitLocation | null {
  switch (loc.zone) {
    case 'offboard':
      return null; // off-board units need an explicit entry region (engine handles)
    case 'start':
      return { zone: 'ring', region: loc.region, ringIndex: 0 };
    case 'treat':
      return treatRejoin(loc.region, loc.slotKind);
    case 'ring': {
      if (loc.ringIndex === JUNCTION_INDEX && preferRoad) {
        return { zone: 'road', region: loc.region, roadIndex: 0 };
      }
      if (loc.ringIndex === EXIT_INDEX) {
        return { zone: 'ring', region: NEXT_REGION[loc.region], ringIndex: 0 };
      }
      return { zone: 'ring', region: loc.region, ringIndex: loc.ringIndex + 1 };
    }
    case 'road': {
      if (loc.roadIndex === ROAD_CASTLE_INDEX) return { zone: 'castle' };
      return { zone: 'road', region: loc.region, roadIndex: loc.roadIndex + 1 };
    }
    case 'castle':
      return null;
  }
}

/** Whether advancing CCW from `loc` for `color` will cross a junction before the
 *  next matching space — i.e. the player has a real ring-vs-road choice to make. */
export function hasJunctionChoice(loc: UnitLocation, color: SpaceColor): boolean {
  const ring = advanceToColor(loc, color, false);
  const road = advanceToColor(loc, color, true);
  if (!ring || !road) return ring !== road;
  return !sameLocation(ring, road);
}

/** Advance to the next space of `color` (CCW). `preferRoad` chooses the fork at a
 *  junction encountered on the way. Returns null if no such space is reachable
 *  (e.g. blocked by the castle dead end). */
export function advanceToColor(
  loc: UnitLocation,
  color: SpaceColor,
  preferRoad: boolean,
  maxSteps = 24,
): UnitLocation | null {
  let cur = loc;
  for (let i = 0; i < maxSteps; i++) {
    const nxt = step(cur, preferRoad);
    if (!nxt) return null;
    cur = nxt;
    if (colorOf(cur) === color) return cur;
  }
  return null;
}

/** Every location a unit passes advancing to the next space of `color`, in
 *  order and ending on that space; null when none is reachable. The same walk
 *  as advanceToColor, kept step by step so a client can draw the path. */
export function pathToColor(
  loc: UnitLocation,
  color: SpaceColor,
  preferRoad: boolean,
  maxSteps = 24,
): UnitLocation[] | null {
  let cur = loc;
  const path: UnitLocation[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const nxt = step(cur, preferRoad);
    if (!nxt) return null;
    cur = nxt;
    path.push(cur);
    if (colorOf(cur) === color) return path;
  }
  return null;
}

/** The distinct regions a unit passes through moving from `from` to `to` along the
 *  CCW path (inclusive of both ends). The engine unions these per unit across a turn
 *  for the "move one unit through 3 regions in one turn" objective. */
export function regionsOnPath(from: UnitLocation, to: UnitLocation, preferRoad: boolean, maxSteps = 24): RegionId[] {
  let cur = from;
  const regions: RegionId[] = [];
  const add = (loc: UnitLocation): void => { const r = regionOf(loc); if (r != null && !regions.includes(r)) regions.push(r); };
  add(from);
  for (let i = 0; i < maxSteps; i++) {
    if (sameLocation(cur, to)) break;
    const nxt = step(cur, preferRoad);
    if (!nxt) break;
    cur = nxt;
    add(cur);
  }
  return regions;
}

/** Count of region boundaries crossed in a single move (legacy helper). */
export function regionsCrossed(from: UnitLocation, to: UnitLocation, preferRoad: boolean, maxSteps = 24): number {
  return regionsOnPath(from, to, preferRoad, maxSteps).length;
}

export function sameLocation(a: UnitLocation, b: UnitLocation): boolean {
  if (a.zone !== b.zone) return false;
  switch (a.zone) {
    case 'castle': case 'offboard': return true;
    case 'start': return a.region === (b as typeof a).region;
    case 'ring': return a.region === (b as typeof a).region && a.ringIndex === (b as typeof a).ringIndex;
    case 'road': return a.region === (b as typeof a).region && a.roadIndex === (b as typeof a).roadIndex;
    case 'treat': return a.region === (b as typeof a).region && a.slotKind === (b as typeof a).slotKind;
  }
}

// ---------------------------------------------------------------------------
// Region distance (for Intel gain and influence gain)
// ---------------------------------------------------------------------------

/** Ring distance 0..3 from `home` to `current`, in ring order 1->2->3->4. */
export function ringDistance(home: RegionId, current: RegionId): number {
  return (current - home + 4) % 4;
}

/** Intel gained from the Ambassador's region distance: home +1, then +2,+3,+2. */
export function intelGainForDistance(distance: number): number {
  return [1, 2, 3, 2][distance % 4]!;
}

/** Influence gained from the Leader's region distance: own +0, then +1,+2,+3. */
export function influenceGainForDistance(distance: number): number {
  return [0, 1, 2, 3][distance % 4]!;
}

export const CASTLE_INFLUENCE_GAIN = 5;
