// Neither Guts nor Gears — the ONE "who is ahead" scalar (ai-development §2).
//
// Three consumers read the same quantity so they cannot drift:
//   - the heuristic's own scoring (ai.ts scoreMove bonuses),
//   - the MCTS leaf evaluation (getHeuristicValue),
//   - the balance §4 temporal leader scalar (analysis.ts leaderScalar, which
//     reads the public scoreboard row produced here via index.getScoreboard).
//
// NGG wins by one of FOUR printed paths, each with a living Leader (§12). The
// scalar projects "how close is this seat to winning by its best path" onto a
// single number: the dominant term is `culture` (the public standing and the
// Cultural path's target), and it adds normalized progress on the other three
// paths (Military kills, Economic committed Surfs, Technological points).
//
// The projection is deliberately monotone in the printed targets so a higher
// scalar = strictly closer to a win. `result.scores` ranks on culture only
// (engine checkGameOver), so `leaderScalar` keeps culture as the head term and
// the path terms as tie-break — consistent, never contradictory.

import {
  CULTURE_TARGET, cultureTargetFor, ECONOMIC_COLLECTORS_NEEDED, TECH_TARGET,
} from './data/catalogs.js';
import { economicCollectorsNeeded } from './economicScale.js';
import {
  byId, hasLivingLeader, militaryThreshold, speciesOf, techTotal,
} from './engine.js';
import type { NGGState, PlayerState } from './types.js';

/** The per-seat public scoreboard row — this is what `leaderScalar` reduces.
 *  Keep the field names stable: analysis.ts reads them verbatim. */
export interface NGGScoreRow {
  culture: number;
  culture_target: number;
  /** Collectors the Economic spend needs this session (printed 11). */
  economic_collectors: number;
  leader_kills: number;
  surfs_committed: number;
  tech_points: number;
  tech_target: number;
  military_needed: number;
  has_living_leader: number; // 1/0 so it carries in a numeric scoreboard row
}

/** Build the public scoreboard row for one seat. Public facts only — the
 *  committed-collector count is table-visible (a committed Surf sits on the
 *  map until upkeep), acquired-types and culture are the public trackers. */
export function nggScoreRow(state: NGGState, playerId: string): NGGScoreRow {
  const p = byId(state, playerId);
  const species = p.species ?? 'wizard';
  return {
    culture: p.culture,
    culture_target: cultureTargetFor(state.players.length),
    economic_collectors: economicCollectorsNeeded(state),
    leader_kills: p.leaderKills,
    surfs_committed: state.placements.filter((c) => c.ownerId === playerId && c.collectorId.startsWith('surf-')).length,
    tech_points: techTotal(state, p),
    tech_target: TECH_TARGET[species],
    military_needed: militaryThreshold(state.players.length),
    has_living_leader: hasLivingLeader(state, playerId) ? 1 : 0,
  };
}

/** The full-state "how close to winning" scalar in [0,1). 1 == already won.
 *  Best-path progress, culture-dominant so the order matches result.scores. */
export function positionValue(state: NGGState, playerId: string): number {
  const p = byId(state, playerId);
  if (state.result?.winners.includes(playerId)) return 1;
  // A dead Leader can't initiate any victory (ruling 74) — collapse to a
  // trailing value; culture income still flows so it isn't zero.
  const species = p.species ?? 'wizard';
  const cultural = p.culture / cultureTargetFor(state.players.length);
  const military = p.leaderKills / militaryThreshold(state.players.length);
  const economic = state.placements.filter((c) => c.ownerId === playerId && c.collectorId.startsWith('surf-')).length / economicCollectorsNeeded(state);
  const tech = techTotal(state, p) / TECH_TARGET[species];
  const best = Math.max(cultural, military, economic, tech);
  // Secondary ordering keeps it consistent with result.scores across seats.
  const secondary = p.culture / cultureTargetFor(state.players.length);
  const v = Math.min(0.9999, best * 0.7 + secondary * 0.3);
  return hasLivingLeader(state, playerId) ? v : v * 0.2;
}

/** Normalize a scoreboard row to the same ordering positionValue produces.
 *  culture is the head term (matches result.scores); path terms tie-break.
 *  Returns a non-negative scalar where higher = ahead. */
export function leaderScalarFromRow(row: Record<string, number>): number {
  const culture = row.culture ?? 0;
  const military = (row.leader_kills ?? 0) / Math.max(1, row.military_needed ?? 1);
  // Economic tracks committed Surfs / the 11-Surf printed requirement.
  const economic = (row.surfs_committed ?? 0) / Math.max(1, row.economic_collectors ?? ECONOMIC_COLLECTORS_NEEDED);
  const tech = (row.tech_points ?? 0) / Math.max(1, row.tech_target ?? 22);
  const best = Math.max(culture / Math.max(1, row.culture_target ?? CULTURE_TARGET), military, economic, tech);
  const v = culture + best * 10; // culture stays the head term; path prox adds a nudge
  return (row.has_living_leader ?? 1) === 0 ? v * 0.2 : v;
}
