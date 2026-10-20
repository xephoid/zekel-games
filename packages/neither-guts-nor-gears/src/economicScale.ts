// The Economic spend scales with the map (designer rulings #89, #91, #115,
// #120 and #133): 12 collectors on 12 distinct tiles at two players, 16 at
// three to four (#133, 2026-10-19; was 20 under #91 and #120, and 15 for a
// day under #115), 26 at five to six. The printed mix
// (3 water + 3 wood + 3 ore + 1 ether + 1 oil, eleven resources) is the
// minimum; the remaining collectors may collect anything. The supply:
//   - a wizard may own as many Surfs as the spend needs;
//   - a robot may own one water, wood and ore collector per tile of that
//     resource on the map, plus 4 oil and 2 ether collectors on every map
//     (ruling #116, 2026-10-01 — the old caps summed to exactly the spend, so
//     one blocked tile made Economic impossible for robots):
//     2p 7/6/7/4/2; 3–4p 10/8/7/4/2; 5–6p 21/19/8/4/2;
//   - the robot Core supply is 15 plus the spend's extra (16 / 20 / 30).
// A session may still override the count (`NGGOptions.economicCollectors`,
// integer >= 11) for experiments; the harness pace runs used it.
import { ECONOMIC_COLLECTORS_NEEDED, type UnitDef } from './data/catalogs.js';
import { tilesForLayout, type LayoutId } from './data/maps.js';

/** §2 printed Core supply per robot player before the spend's extra. */
export const PRINTED_CORE_SUPPLY = 15;

export interface EconomicScaleState { economicCollectors?: number; layout: LayoutId }

/** Rulings #89 / #91 / #115 / #120 / #133: collectors the Economic spend needs on each printed layout. */
export const ECONOMIC_COLLECTORS_BY_LAYOUT: Readonly<Record<LayoutId, number>> = { two: 12, threeFour: 16, fiveSix: 26 };

/** Ruling #116: robot oil and ether collector caps, the same on every map. */
export const ROBOT_OIL_COLLECTORS = 4;
export const ROBOT_ETHER_COLLECTORS = 2;

export function economicCollectorsFor(layout: LayoutId): number {
  return ECONOMIC_COLLECTORS_BY_LAYOUT[layout];
}

export function economicCollectorsNeeded(state: EconomicScaleState): number {
  return state.economicCollectors ?? economicCollectorsFor(state.layout);
}

/** Collectors the spend needs beyond the printed eleven-resource mix — any resource. */
export function economicExtraAny(state: EconomicScaleState): number {
  return Math.max(0, economicCollectorsNeeded(state) - ECONOMIC_COLLECTORS_NEEDED);
}

export function coreSupplyFor(state: EconomicScaleState): number {
  return PRINTED_CORE_SUPPLY + economicExtraAny(state);
}

/** Robot typed collector caps on this layout (ruling #116): one water, wood
 *  and ore collector per tile of that resource on the map; 4 oil and 2 ether
 *  everywhere. The `economicCollectors` dial does not move them. */
export function robotCollectorCaps(state: EconomicScaleState): Record<'water' | 'wood' | 'ore' | 'oil' | 'ether', number> {
  const tiles = tilesForLayout(state.layout);
  const onMap = (k: 'water' | 'wood' | 'ore') => tiles.filter((t) => t.resource === k).length;
  return { water: onMap('water'), wood: onMap('wood'), ore: onMap('ore'), oil: ROBOT_OIL_COLLECTORS, ether: ROBOT_ETHER_COLLECTORS };
}

/** Per-player cap of a unit type on this layout: a collector's cap follows the
 *  spend size; anything else keeps its printed maximum. */
export function collectorCapFor(state: EconomicScaleState, udef: Pick<UnitDef, 'id' | 'collector' | 'collectorResource' | 'maxPerPlayer'>): number {
  if (!udef.collector) return udef.maxPerPlayer;
  if (udef.collectorResource === null) return economicCollectorsNeeded(state);
  return robotCollectorCaps(state)[udef.collectorResource];
}
