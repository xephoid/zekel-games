// Neither Guts nor Gears — the classic AI (the 2026-09-22 AI, kept as-is).
//
// This is the AI the game shipped with before the 2026-09-24 rebuild
// (commit 303cbb8), kept unchanged so its play stays a fixed yardstick:
//   easy   = its medium (its full policy, softened on purchases/planning),
//   medium = its hard  (its full policy).
// The hard tier is the rebuilt planner in ai.ts; random is a uniform pick.
// Setup picks (Leader, start) for every tier come from ai.ts. Nothing in this
// file is tuned further — change ai.ts instead. The one rules update carried
// in: the culture target scales with player count (ruling #84), and the
// robot's starting types count its wood collectors (ruling #85).
//
// Original header follows.
//
// Neither Guts nor Gears — the AI (ai-development gate).
//
// The port's bar was "legal + complete"; this gate builds the skill ladder for
// real. `chooseMove(state, playerId, difficulty?, strategy?)` exposes:
//   easy   — uniform-random over the legal set via a SEEDED rng (never the
//            broken `state.seed % k` stub: the seed never advances between
//            calls, so two identical states would pick the same index forever).
//   medium — the authored deterministic heuristic (this file's scoreMove).
//   hard   — additional tactical/tempo preferences; current strength is measured
//            in BALANCE.md rather than inferred from the difficulty label.
//   mcts   — generic search (index.ts), measured at explicit time budgets.
//
// Strategy is orthogonal (§4): the four printed victory paths are the
// archetypes; `parseStrategy` maps names/aliases → a path lean; `undefined` is
// the adaptive default. The lever keys on each move's printed EFFECT toward
// the path (a Culture lean buys +culture buildings and Subjects regardless of
// label), never on a faction tag.
//
// Every decision the printed rules hand a player routes through a pending
// (human) or this deterministic policy (AI). Nothing is resolved silently.

import type { LegalMove } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import type { Coord, NGGMove, NGGState, PlayerState } from './types.js';
import {
  availableCollectorIds, byId, checkVictory, hasLivingLeader, hasTreatyUnlock,
  militaryThreshold, speciesOf, techTotal, areMilitaryAllies,
  ownedCollectorIds,
} from './engine.js';
import { getLegalMoves } from './legalMoves.js';
import {
  ACTION_CARD_RESEARCH, BATTLE_CARDS, cultureTargetFor, ECONOMIC_COLLECTORS_NEEDED, HEROES,
  MILESTONES, TREATIES, heroStatsForCategory, researchForSpecies,
  buildingsForSpecies, unitsForSpecies, type Species,
} from './data/catalogs.js';
import { economicCollectorsNeeded } from './economicScale.js';
import { coordKey, neighborsOf } from './data/maps.js';
import { heroesEligibleFor, unitById } from './resolvers.js';
import { nggScoreRow, positionValue } from './eval.js';
import { randomInt } from './rng.js';
import { currentDmgOf, currentDefOf } from './engine-battle.js';

type Difficulty = 'easy' | 'medium' | 'hard';

interface ScoredMove { move: NGGMove; score: number; narration: string }

// ---------------------------------------------------------------------------
// §4 Strategy — the four victory paths as behavioral levers
// ---------------------------------------------------------------------------

type NGGStrategy = 'military' | 'cultural' | 'economic' | 'technological';

const STRATEGY_ALIASES: Record<string, NGGStrategy> = {
  military: 'military', conquest: 'military', aggro: 'military', kill: 'military', kills: 'military',
  cultural: 'cultural', culture: 'cultural', income: 'cultural', subjects: 'cultural',
  economic: 'economic', economy: 'economic', eleven: 'economic', spend: 'economic', surfs: 'economic',
  technological: 'technological', tech: 'technological', science: 'technological', research: 'technological',
};

/** §4 lever wiring: free-form name (+ aliases) → an archetype; `undefined` ⇒
 *  the adaptive default (no lean; existing batches unchanged). Unknown strings
 *  return undefined so a typo silently degrades to adaptive rather than crash. */
function parseStrategy(s: string | undefined): NGGStrategy | undefined {
  if (s === undefined) return undefined;
  return STRATEGY_ALIASES[s.trim().toLowerCase()];
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/** Choose the AI's move. Every skeleton field the menu leaves blank for a human
 *  to edit (a base's at_base, a payment edit) is resolved here before the move
 *  is returned — the engine validates the complete declared shape, so a pick
 *  carrying a placeholder is an AI bug the engine correctly rejects. */
export function chooseMoveClassic(state: NGGState, playerId: string, difficulty: Difficulty = 'medium', strategy?: string): { move: NGGMove; narration: string } {
  const legal = getLegalMoves(state, playerId);
  if (legal.length === 0) throw new GameError('ILLEGAL_MOVE', `AI ${playerId} has no legal move`);
  const p = byId(state, playerId);
  const strat = parseStrategy(strategy);
  const completed = legal
    .map((lm) => completeMove(state, p, lm.move))
    .filter((m): m is NGGMove => m !== null);
  // Military expeditions leave productive collector platforms at their anchors.
  // This remains one legal movement action, using a subset of the offered group.
  if (strat === 'military') for (let i = 0; i < completed.length; i++) {
    const m = completed[i]!;
    if (m.type !== 'move_units') continue;
    const fighters = m.units.filter(id => state.heroes.some(h => h.id === id)
      || !unitById(state.units.find(u => u.id === id)?.typeId ?? '')?.collector);
    if (fighters.length) completed[i] = { ...m, units: fighters };
  }
  if (completed.length === 0) throw new GameError('ILLEGAL_MOVE', `AI ${playerId} has no completable move`);
  // Refusal-chain guard: a payment enumerated at menu time can go stale by the
  // time the AI's pick applies (an access grant/refusal round-trip consumed or
  // refused the collectors it names). Drop any payment-based move whose
  // placements reference a collector no longer available, so the pick is
  // re-scored from what's legal NOW — never propose a payment the engine
  // would reject (the 4p harness's GET_AI_MOVE_ERROR class, surf-N).
  const live = completed.filter((m) => {
    // A rejected offer leaves the same action open. Do not repeat that offer
    // during this round; reconsider next round after income/board changes.
    if (m.type === 'form_treaty' && state.log.some((e) => e.turn === state.round
      && e.actor === m.partner && e.category === 'treaty'
      && e.summary === `${m.partner} declines ${m.treaty_type} from ${playerId}`)) return false;
    const pay = (m as { payment?: Array<{ collectorId: string; coord: Coord }> }).payment;
    if (!Array.isArray(pay)) return true;
    const avail = new Set(availableCollectorIds(state, p));
    return pay.every((pl) => avail.has(pl.collectorId));
  });
  const pool = live.length > 0 ? live : completed; // never strand on an empty pool
  if (difficulty === 'easy') return { move: pool[Math.floor(seededUnit(state) * pool.length)]!, narration: 'picks at random' };
  // A zero-income economy can get trapped in the same harmless battle and
  // refused-access cycle forever (balance seed 1281, 3p). Once ten full rounds
  // brought no purchase, explore a peaceful location instead of repeating it.
  // This changes the policy, never the rules or the human move menu.
  if (state.round >= 20 && p.culture < 5 && !state.log.some((e) =>
    e.actor === playerId && e.turn > state.round - 10 && (e.category === 'build' || e.category === 'research'))) {
    const explore = pool.filter((m) => m.type === 'move_units'
      && !state.units.some((u) => u.coord === m.to && u.ownerId !== playerId)
      && !state.heroes.some((h) => h.coord === m.to && h.ownerId !== playerId && !h.dead));
    if (explore.length > 0) {
      const move = explore[Math.floor(seededUnit(state) * explore.length)]!;
      return { move, narration: 'explores a peaceful location after ten rounds without an economic purchase' };
    }
  }
  const scored = pool.map((m) => scoreMove(state, p, m, difficulty, strat));
  scored.sort((a, b) => b.score - a.score);
  let best = scored[0]!;
  // Medium is the full policy SOFTENED: on three of four purchase and
  // planning decisions it takes one of its top three options at random
  // (seeded) instead of the best (0.25 and 0.5 measured indistinguishable
  // from hard at n=40; 0.75 gives hard 31/40). Hard is the same policy unsoftened. This is
  // the ladder the game supports: measured on the fixed engine, no authored
  // extra (treaty timing, Embassy tempo, a 100-ply deterministic rollout over
  // purchase candidates, the old 3p military lean) moved the full policy's
  // 2p win rate off 50% — a culture race between two competent engines is
  // decided at the draft, the seat and the species, not in play. Pendings
  // (battle, claims, spy, access) are never softened.
  if (difficulty === 'medium' && scored.length > 1 && !state.pending
    && (best.move.type === 'build' || best.move.type === 'research' || best.move.type === 'plan_action')
    && seededUnit(state) < MEDIUM_SOFTEN_RATE) {
    const top = scored.slice(0, Math.min(3, scored.length));
    const salt = state.round * 104729 + state.log.length * 31 + scored.length;
    const { value } = randomInt((state.seed ^ salt) >>> 0, top.length);
    best = top[value]!;
  }
  return { move: best.move, narration: best.narration };
}

/** Share of medium's purchase/planning decisions that are deliberately
 *  imperfect (one of the top three, seeded). */
const MEDIUM_SOFTEN_RATE = 0.75;

/** Fill the fields a menu skeleton leaves for human edit. Returns null when a
 *  move can't be made legal right now (a base with no legal anchor tile) —
 *  the AI drops it from consideration rather than submit a guaranteed reject. */
function completeMove(state: NGGState, p: PlayerState, move: NGGMove): NGGMove | null {
  // Build a base: at_base must name a tile holding my unit and no opposing unit.
  if (move.type === 'build') {
    const species = speciesOf(p);
    const bld = buildingsForSpecies(species).find((b) => b.name === move.item);
    if (bld?.isBase && !move.at_base) {
      const anchor = baseAnchorTiles(state, p)[0];
      if (!anchor) return null; // no legal base spot — don't offer it at all
      return { ...move, at_base: anchor };
    }
  }
  return move;
}

/** Tiles eligible to host a NEW base of mine: hold an owned piece and no
 *  opposing piece (ruling 55), not already bases, under the 3-base cap. */
function baseAnchorTiles(state: NGGState, p: PlayerState): Coord[] {
  if (state.bases.filter((b) => b.ownerId === p.playerId).length >= 3) return [];
  const mine = new Set<Coord>();
  for (const u of state.units) if (u.ownerId === p.playerId) mine.add(u.coord);
  for (const h of state.heroes) if (h.ownerId === p.playerId && !h.dead && h.coord) mine.add(h.coord);
  const out: Coord[] = [];
  for (const k of mine) {
    if (state.bases.some((b) => b.coord === k)) continue;
    const oppHere = state.units.some((u) => u.coord === k && u.ownerId !== p.playerId)
      || state.heroes.some((h) => h.coord === k && h.ownerId !== p.playerId && !h.dead);
    if (oppHere) continue;
    out.push(k);
  }
  return out;
}

/** Deterministic 0..1 that ADVANCES with the state's salt (never the broken
 *  `seed % k` — the seed never advances between calls, so identical states
 *  always pick the same index). Derives from seed + a per-state salt. */
function seededUnit(state: NGGState): number {
  const salt = state.round * 7919 + state.phase.length * 131 + state.log.length;
  const { value } = randomInt((state.seed ^ salt) >>> 0, 1000003);
  return value / 1000003;
}

// ---------------------------------------------------------------------------
// Heuristic scoring
// ---------------------------------------------------------------------------

function scoreMove(state: NGGState, p: PlayerState, move: NGGMove, difficulty: Difficulty, strat: NGGStrategy | undefined): ScoredMove {
  const narration = narrationFor(move);
  const hard = difficulty === 'hard';
  switch (move.type) {
    case 'plan_action': return { move, narration, score: planScore(state, p, move, hard, strat) };

    case 'build': {
      const s = buildScore(state, p, move, hard, strat);
      return { move, narration, score: s };
    }
    case 'economic_victory_spend': {
      // Printed alternate win: only offered when payable. This is a build turn
      // that wins outright — above everything except the engine would have
      // ended the game already on a threshold path.
      return { move, narration, score: 900 };
    }
    case 'research': {
      return { move, narration, score: researchScore(state, p, move, hard, strat) };
    }
    case 'move_units': {
      return { move, narration, score: moveScore(state, p, move, hard, strat) };
    }
    case 'commit_battle_card': return { move, narration, score: commitScore(state, p, move) };
    case 'battle_activation': return { move, narration, score: activationScore(state, p, move, hard) };
    case 'resolve_battle_defense': return { move, narration, score: defenseScore(state, p, move) };
    case 'choose_retreat': return { move, narration, score: retreatScore(state, p, move) };
    case 'select_extra_cards': return { move, narration, score: extraScore(state, p, move) };
    case 'choose_counter_target': return { move, narration, score: counterScore(state, p, move) };
    case 'select_rally_units': return { move, narration, score: rallyScore(state, p, move) };
    case 'respond_access_request': return { move, narration, score: accessRequestScore(state, p, move) };
    case 'respond_treaty': return { move, narration, score: (difficulty === 'hard' ? respondTreatyScoreHard(state, p, move, strat) : respondTreatyScore(state, p, move, strat)) };
    case 'form_treaty': return { move, narration, score: (difficulty === 'hard' ? formTreatyScoreHard(state, p, move, strat) : formTreatyScore(state, p, move, strat)) };
    case 'break_treaty': return { move, narration, score: breakTreatyScore(state, p, move) };
    case 'choose_milestone_hero': return { move, narration, score: milestoneScore(state, p, move, hard, strat) };
    case 'choose_spy': return { move, narration, score: spyScore(state, p, move) };
    case 'reallocate_cores': return { move, narration, score: reallocateScore(state, p, move, hard) };
    case 'resolve_overlay_choice': return { move, narration, score: overlayScore(state, p, move) };
    case 'place_reserved_hero': return { move, narration, score: placeScore(state, p, move) };
    case 'cast_elara_spell': return { move, narration, score: elaraScore(state, p, move) };
    case 'skip_action': return { move, narration, score: 3 };
    case 'report_draw': case 'resolve_report': return { move, narration, score: 100 }; // always settle a draw pending
    case 'assign_setup_choices': return { move, narration, score: 50 };
    case 'choose_leader': return { move, narration, score: leaderScore(state, p, move, strat) };
    case 'choose_starting_location': return { move, narration, score: locationScore(state, p, move, strat) };
    default: return { move, narration, score: 1 };
  }
}

// ---- Planning (which action card to queue) --------------------------------

function planScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'plan_action' }>, _hard: boolean, strat: NGGStrategy | undefined): number {
  if (move.card === 'pass') return 1;
  const path = strat ?? bestPath(state, p);
  const base = path === 'military' ? { build: 24, move_battle: 34, research: 14 }
    : path === 'cultural' ? { build: 32, move_battle: 12, research: 16 }
    : path === 'economic' ? { build: 36, move_battle: 8, research: 12 }
    : { build: 24, move_battle: 10, research: 34 }; // technological
  return base[move.card];
}

/** The adaptive default's path pick: the printed target the seat is closest
 *  to, re-read from live state each call (never a frozen assignment). Culture
 *  is the inertia default: it compounds every round and the scoreboard ranks
 *  on it, so another path must be CLEARLY closer to its target (a real lead,
 *  not a rounding edge) before the seat pivots off the culture engine. This
 *  stops the self-reinforcing Surf spiral: committing Surfs flips bestPath to
 *  economic, which then buys MORE Surfs while the culture lead rots. */
function bestPath(state: NGGState, p: PlayerState, _hard = false): NGGStrategy {
  const cultural = p.culture / cultureTargetFor(state.players.length);
  // Kills alone can't measure military progress: at 2-3 players the first
  // kill ENDS the game, so the count is zero until it is over and the seat
  // could never choose this path. Progress is lethal reach — a group that can
  // kill an enemy Leader, and how close it stands (militaryReach).
  const military = Math.max(p.leaderKills / militaryThreshold(state.players.length), militaryReach(state, p));
  const surfs = state.placements.filter((c) => c.ownerId === p.playerId && c.collectorId.startsWith('surf-')).length;
  const economic = surfs / economicCollectorsNeeded(state);
  const species = speciesOf(p);
  // Tech progress is measured NET of the starting package: a robot begins with
  // three acquired types (Core, water collector, Home) = 3/18 = 17%, a
  // wizard with two (Surf, Castle) = 9%. Read raw, that head start beat culture's 0%
  // by the margin below on turn one, so every robot opened on the
  // technological line — buying one collector of every type on zero income
  // and losing 79% of 2p games (balance 2026-09-22). Progress is what the seat
  // has EARNED toward the target since setup.
  const startTypes = species === 'wizard' ? 2 : 4; // robot start: Core, water and wood collectors, Home (#85)
  const techTarget = species === 'wizard' ? 22 : 18;
  const tech = Math.max(0, techTotal(state, p) - startTypes) / (techTarget - startTypes);
  // A challenger wins the seat's attention only when it leads culture by a
  // real margin (≥15% of its own target more than culture is along).
  const margin = 0.15;
  let best: NGGStrategy = 'cultural'; let bv = cultural;
  if (military > bv + margin) { best = 'military'; bv = military; }
  if (economic > bv + margin) { best = 'economic'; bv = economic; }
  if (tech > bv + margin) { best = 'technological'; bv = tech; }
  // (The old hard-only "open military at 3p+" lean was measured on the engine
  // that dropped most action cards; on the fixed engine it made hard WORSE
  // than medium at 3p — balance 2026-09-22 — and is gone.)
  return best;
}

// ---- Build ----------------------------------------------------------------

function buildScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'build' }>, hard: boolean, strat: NGGStrategy | undefined): number {
  const species = speciesOf(p);
  const path = strat ?? bestPath(state, p, hard);
  const unit = unitsForSpecies(species).find((u) => u.name === move.item);
  const building = buildingsForSpecies(species).find((b) => b.name === move.item);
  if (path === 'technological') {
    const id = unit?.id ?? building?.id;
    const fresh = id != null && !p.acquiredTypes.includes(id);
    const collectors = ownedCollectorIds(p).length;
    // Every distinct unit/building/research type scores, not just research.
    // Establish production first, then diversify and unlock missing research.
    if (unit?.collector) {
      if (species === 'wizard' && collectors < 9) return 120 - collectors;
      if (species === 'robot') {
        const count = state.units.filter(u => u.ownerId === p.playerId && u.typeId === unit.id).length;
        const need = unit.collectorResource === 'wood' ? 3 : ['water','ore'].includes(unit.collectorResource ?? '') ? 2 : 1;
        if (count < need) return 120 - count * 5;
      }
    }
    if (unit?.id === 'core' && p.coresInReserve === 0 && collectors < 9) return 115;
    const unlocks = building ? researchForSpecies(species).filter(r =>
      r.prerequisite === building.name && !p.research.includes(r.id)).length : 0;
    return (fresh ? 90 : 5) + unlocks * 7 - move.payment.length * 2;
  }
  if (path === 'military' && strat === 'military') {
    const collectors = ownedCollectorIds(p).length;
    if (unit?.collector && collectors < 4) return 120 - collectors * 3;
    if (unit?.grantsSpy) return 110 - move.payment.length;
    if (building && ['library-of-illusion', 'diplomatic-research-station'].includes(building.id)) return 100;
    const army = state.units.filter(u => u.ownerId === p.playerId && (unitById(u.typeId)?.dmg ?? 0) > 0).length;
    if (unit && (unit.dmg ?? 0) > 0) return (army < 3 ? 78 : 15) + (unit.dmg ?? 0) * 2 - move.payment.length;
    if (building && ['dragon-hoard', 'combat-frame-production'].includes(building.id)) return 74;
  }
  let s = 10;

  // Economy spine: collectors AND culture-producers lead; combat next; the
  // rest follow. (Port's shape, kept — the harness runs on this floor.)
  if (unit) {
    // A robot's culture engine is the RESERVE Core: each owned unallocated Core
    // is +1 culture per round for 1 water (§5.4) — the Subject's job at half the
    // price. Collector platforms grow production but each one EATS a Core (or
    // costs one more water combined), so past a working set of four they are
    // scored like any other piece, not like the economy spine. (Pre-fix the
    // robot AI bought a collector for every Core it minted and ran the whole
    // game on zero income: 2p robot win rate 21%, balance 2026-09-22.)
    const robotCollectors = species === 'robot'
      ? ownedCollectorIds(p).length : 0;
    if (unit.collector) s += species === 'robot' && robotCollectors >= 4 ? 8 : 40;
    if (unit.id === 'subject' || unit.id === 'core') s += 42;
    if (!unit.collector && unit.dmg !== null && unit.dmg > 0) s += 25;
    if (unit.grantsSpy) s += 15;
    s -= totalCost(unit.cost);
  }
  if (building) {
    s += 18;
    // Buildings that unlock combat or culture pay forward; cheap early.
    if (building.isBase) s += 6; // expansion + a reserved-hero landing spot
    if (building.id === 'amphitheatre' || building.id === 'third-space') s += (path === 'cultural' ? 30 : 12);
    if (building.id === 'dragon-hoard' || building.id === 'combat-frame-production' || building.id === 'defense-research-station') {
      s += (path === 'military' ? 26 : 8); // combat unlocks
    }
    if (building.id === 'advanced-research-station') s += 12; // opens the three Extra cards (+ a tech point)
    s -= totalCost(building.cost);
  }

  // Defence: the printed Leader-kill line is Elara's spell to clear escorts
  // (4 damage, a Leader's 5 defence survives) then a spy reveal — Invisible
  // (wizard) or Spy Attack (robot) — for an instant kill. The counter is a spy
  // of my OWN on the Leader: a wizard Decoy reveal voids the attack; a robot
  // Spy Attack from the Leader (defender wins initiative ties) kills the
  // carrier before it acts. So when an enemy armed group closes on my Leader,
  // buy the spy (and its unlock) ahead of the economy. Measured 2026-09-22:
  // without this a military seat killed the culture racer's Leader 26/30 at 2p.
  const threat = leaderThreatDistance(state, p);
  if (threat <= 4 && !p.spyAssignments.some((x) => x.active)) {
    if (unit?.grantsSpy) s += 70;
    const spyUnlock = species === 'wizard' ? 'library-of-illusion' : 'diplomatic-research-station';
    if (building?.id === spyUnlock) s += 60;
    if (species === 'wizard' && building?.id === 'temple') s += 12; // a Cleric save is the second line
  }
  if (threat <= 3 && unit && !unit.collector && (unit.dmg ?? 0) > 0) s += 24; // strike-first bodies at the base

  // §4 path lean (effect-keyed, not label-keyed).
  const myCollectors = ownedCollectorIds(p).length;
  s += pathBuildLean(species, unit?.id ?? building?.id ?? '', path, myCollectors);

  if (!hard) return s;

  // ---- hard: the culture engine, bought smart — measured against medium ----
  // The dominant line both tiers found is Amphitheatre → Subjects → culture
  // buildings. Hard keeps THAT ORDER (don't out-clever the winning play):
  // its edge is only to never waste a buy on a piece that can't pay — a combat
  // unit with no fight on the map, or a surplus collector at the commit cap.
  // (c) A combat piece is worth buying only when a fight is actually available
  // (an enemy adjacent to anything I own) — otherwise it's a parked resource
  // I could have spent on culture. Soft-penalty.
  if (unit && !unit.collector && unit.dmg !== null && unit.dmg > 0) {
    const threatened = state.units.some((u) => u.ownerId !== p.playerId && areAnyMineAdjacent(state, p, u.coord));
    if (!threatened && bestPath(state, p) !== 'military') s -= 8;
  }
  // (d) Surplus collectors: a Surf the seat can't commit this round (already
  // has ≥2 committed, the working number) is a wasted buy. Count what's on the
  // board + available; only chase more Surfs when the seat is actually short.
  if (unit?.id === 'surf') {
    const surfsUp = state.placements.filter((c) => c.ownerId === p.playerId).length;
    const surfsAvailable = Object.entries(p.collectorsAvailable).filter(([k]) => k.startsWith('surf-')).reduce((a, [, n]) => a + n, 0);
    if (surfsUp + surfsAvailable >= economicCollectorsNeeded(state)) s -= 40; // at cap: never offered anyway, belt & braces
    // Under the Economic path, committed Surfs are real progress.
    if (bestPath(state, p) === 'economic' && surfsUp < economicCollectorsNeeded(state)) s += 12;
  }
  // (e) The Embassy opens treaties + battle-card buys (§11/§10): on the culture
  // path it's worth taking once the core engine (≥3 Subjects) stands, not
  // before — earlier than that it crowds out a producer.
  if (building?.id === 'embassy' && p.subjects >= 3) s += 6;
  if (state.players.length >= 3 && (building?.id === 'embassy' || building?.id === 'diplomatic-research-station')
    && !hasTreatyUnlock(state, p.playerId)) s += 40; // one unlock opens +5/round per partner across the table
  // (f) Research-enabling buildings: medium skips its Research action every
  // round (it never builds the unlock, so researchMoves is empty). Hard opens
  // the libraries once the culture engine is already capped (a research line
  // is a SECOND win path — tech points and the battle spells — but only once
  // the culture engine can't absorb another Subject).
  const unlockBuildings = ['library-of-evocation', 'library-of-enchantment', 'library-of-illusion', 'combat-frame-production', 'diplomatic-research-station', 'defense-research-station', 'dragon-hoard', 'temple'];
  if (building && unlockBuildings.includes(building.id) && p.subjects >= 5) s += 24;
  // (g) Embassy AFTER the engine is capped — a treaty is real income but the
  // printed +5 goes to both partners, so rushing it ahead of the Amphitheatre
  // costs more culture than it earns (measured: hard lost 100-0 doing that).
  if (building?.id === 'embassy' && p.subjects >= 5 && p.buildings.includes('Amphitheatre')) s += 30;
  return s;
}

function pathBuildLean(species: Species, id: string, path: NGGStrategy, collectors = 0): number {
  // Effect-keyed: what does this purchase DO for the path.
  switch (path) {
    case 'cultural': {
      // A wizard's culture engine is Subjects doubled by the Amphitheatre, and
      // the Amphitheatre costs four resources — two more Surfs than the seat
      // starts with. Surfs first (to four), then the Amphitheatre pays double
      // on every Subject that follows; Subjects-first stalls at two Surfs and
      // reaches the Amphitheatre a round or two after the engine is capped.
      if (species === 'wizard' && id === 'surf' && collectors < 4) return 32;
      if (id === 'subject' || id === 'core' || id === 'amphitheatre' || id === 'third-space' || id === 'embassy') return 28;
      return 0;
    }
    case 'military': {
      if (id === 'evoker' || id === 'dragon' || id === 'illusionist' ||
          id === 'spinner' || id === 'spitter' || id === 'large-combat-platform' || id === 'immobile-combat-platform' || id === 'wall-platform' || id === 'infiltrator') return 22;
      if (id === 'dragon-hoard' || id === 'combat-frame-production' || id === 'defense-research-station' || id === 'library-of-illusion' || id === 'diplomatic-research-station') return 12;
      return 0;
    }
    case 'economic': {
      if (id === 'surf') return 30;
      if (species === 'robot' && (id === 'core' || /collector/.test(id))) return 18;
      if (id === 'castle' || id === 'home') return 8;
      return 0;
    }
    case 'technological': {
      return 0; // distinct-type and prerequisite scoring lives in buildScore
    }
  }
}

// ---- Research --------------------------------------------------------------

function researchScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'research' }>, hard: boolean, strat: NGGStrategy | undefined): number {
  const path = strat ?? bestPath(state, p, hard);
  if (move.kind === 'battle_card') {
    // Battle cards matter most when a fight is likely; under a military lean,
    // always worth it. Otherwise modest.
    const base = path === 'military' ? 30 : 20;
    return hard ? base + 4 : base;
  }
  const def = researchForSpecies(speciesOf(p)).find((r) => r.name === move.tech);
  if (!def) return 12;
  if (path === 'military' && def.id === 'invisible' && p.spyAssignments.some(s => s.active)) return 110;
  let s = 22;
  // Ruling #86: a researched Extra card is an extra action every round.
  if (ACTION_CARD_RESEARCH[def.id]) s += hard ? 30 : 22;
  // Tech is the technological path's engine; other paths buy it cheap.
  s += path === 'technological' ? 18 : 0;
  // Species-appropriate battle tech rides the military lean.
  if (path === 'military') {
    if (['Ice Blast', 'Fiery Explosion', 'Mana Shield', 'Dehance', 'Invisible', 'Metal Platforms'].includes(def.name)) s += 14;
  }
  if (hard) {
    // Hard USES the Research action medium skips: an unlocked unresearched tech
    // is permanent progress on the tech path AND a real ability. Prefer cheap
    // techs (they cost less production) and the seat's species list first.
    s += 16; // research is real progress, not a skip
    s -= totalCost(def.cost) * 0.3; // cheaper = sooner, more per round
    // Mana Shield / Ice Blast / Metal Platforms are the battle-winning ones.
    if (['mana-shield', 'ice-blast', 'metal-platforms'].includes(def.id)) s += 8;
  }
  return s;
}

// ---- Movement / battle entry ----------------------------------------------

function moveScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'move_units' }>, hard: boolean, strat: NGGStrategy | undefined): number {
  const to = move.to;
  const from = move.from;
  const enemyHere = state.units.some((u) => u.coord === to && u.ownerId !== p.playerId)
    || state.heroes.some((x) => x.coord === to && x.ownerId !== p.playerId && !x.dead);
  const path = strat ?? bestPath(state, p, hard);
  if (strat === 'military' || path === 'military') {
    // Route toward a killable Leader (or assemble with friends). The explicit
    // military strategy lives on this router alone; the adaptive military
    // path falls back to the generic scorer when the router sees no target.
    const e = expeditionScore(state, p, move);
    if (strat === 'military' || e > 0) return e;
  }
  let s = enemyHere ? 35 : 12;
  if (enemyHere) {
    s += path === 'military' ? 18 : 0;
    s -= threatAssessment(state, p, to) * (hard ? 8 : 4); // attacking into a wall reads worse at hard
  } else if (hard) {
    // Don't ping-pong — but DON'T chase resource tiles either (measured: that
    // scatters collectors off the production spots and costs ~10 culture/game).
    // A quiet move is worth taking only when it closes on a fight. Otherwise
    // stay put (skip_action reads 3, so a pointless move below 3 is fine).
    const toward = adjacencyTowardEnemy(state, p, to);
    s += (path === 'military' ? 10 : 4) * toward;
    if (toward === 0) s -= 2; // a shuffle that gains nothing, mild
    void from;
  }
  return s;
}

/** BFS hex distances from a set of goal tiles (public map, no blocking). */
function distancesFrom(state: NGGState, goals: Coord[]): Map<Coord, number> {
  const distances = new Map<Coord, number>(goals.map((c) => [c, 0]));
  const queue = [...goals];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!; const [x, y] = c.split(',').map(Number);
    for (const t of neighborsOf(state.tiles, x!, y!)) {
      const next = coordKey(t.c, t.r);
      if (!distances.has(next)) { distances.set(next, distances.get(c)! + 1); queue.push(next); }
    }
  }
  return distances;
}

/** Enemy Leaders my force could kill outright (public stats + my own spy). */
function killableLeaders(state: NGGState, p: PlayerState): { targets: Coord[]; fighters: Coord[] } {
  const foes = state.heroes.filter((h) => h.isLeader && !h.dead && h.coord
    && h.ownerId !== p.playerId && !areMilitaryAllies(state, p.playerId, h.ownerId));
  const fighters: Coord[] = []; let maxDmg = 0;
  for (const h of state.heroes) if (h.ownerId === p.playerId && !h.dead && h.coord) {
    const d = heroStatsForCategory(HEROES.find((x) => x.id === h.id)!.category, h.isLeader).dmg;
    if (d > 0) { fighters.push(h.coord); maxDmg = Math.max(maxDmg, d); }
  }
  for (const u of state.units) if (u.ownerId === p.playerId) {
    const d = unitById(u.typeId)?.dmg ?? 0;
    if (d > 0) { fighters.push(u.coord); maxDmg = Math.max(maxDmg, d); }
  }
  const spy = p.spyAssignments.some((s) => s.active && (s.source === 'infiltrator' || p.research.includes('invisible')));
  const targets = foes.filter((h) => spy || maxDmg >= heroStatsForCategory(HEROES.find((d) => d.id === h.id)!.category, true).def).map((h) => h.coord!);
  return { targets, fighters };
}

/** Military progress in [0,1): how close a Leader-killing force stands to a
 *  killable enemy Leader. 0 when no such force or target exists. */
function militaryReach(state: NGGState, p: PlayerState): number {
  const { targets, fighters } = killableLeaders(state, p);
  if (!targets.length || !fighters.length) return 0;
  const dist = distancesFrom(state, targets);
  let best = 99;
  for (const f of fighters) best = Math.min(best, dist.get(f) ?? 99);
  return best <= 1 ? 0.9 : best === 2 ? 0.6 : best === 3 ? 0.35 : 0;
}

/** Distance from my living Leader to the nearest enemy piece that could
 *  actually kill it; 99 when none. A Leader has 5 defence: nothing printed
 *  reaches that except a spy reveal (Invisible / Spy Attack — the recruit is
 *  public, the carrier is not, so every hero of a spy-holding seat counts)
 *  or a 3-damage hero boosted by Rook/Kestrel's +2. A wandering economy hero
 *  or an Evoker is not a threat to the Leader itself. Public board only. */
function leaderThreatDistance(state: NGGState, p: PlayerState): number {
  const leader = state.heroes.find((h) => h.ownerId === p.playerId && h.isLeader && !h.dead && h.coord);
  if (!leader) return 99;
  const hostile: Coord[] = [];
  for (const q of state.players) {
    if (q.playerId === p.playerId || areMilitaryAllies(state, p.playerId, q.playerId)) continue;
    const heroes = state.heroes.filter((h) => h.ownerId === q.playerId && !h.dead && h.coord);
    const spy = q.spyAssignments.some((x) => x.active);
    const boost = heroes.some((h) => h.id === 'rook' || h.id === 'kestrel');
    for (const h of heroes) {
      const cat = HEROES.find((d) => d.id === h.id)!.category;
      const heavy = boost && (cat === 'military' || cat === 'evo-angel') && h.id !== 'rook' && h.id !== 'kestrel';
      if (spy || heavy) hostile.push(h.coord!);
    }
  }
  if (!hostile.length) return 99;
  return distancesFrom(state, hostile).get(leader.coord!) ?? 99;
}

/** Public-board route and force estimate. Hidden enemy cards/spies are never
 *  consulted; only our own spy assignment contributes to the attack estimate. */
function expeditionScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'move_units' }>): number {
  const foes = state.heroes.filter(h => h.isLeader && !h.dead && h.coord
    && h.ownerId !== p.playerId && !areMilitaryAllies(state, p.playerId, h.ownerId));
  if (!foes.length) return 0;
  const group = move.units;
  const damageBoost = group.some(id => id === 'rook' || id === 'kestrel') ? 2 : 0;
  const damages = group.map(id => {
    const h = state.heroes.find(h => h.id === id);
    const u = state.units.find(u => u.id === id);
    const raw = h ? heroStatsForCategory(HEROES.find(d => d.id === h.id)!.category, h.isLeader).dmg
      : unitById(u?.typeId ?? '')?.dmg ?? 0;
    return raw > 0 ? raw + (id === 'rook' || id === 'kestrel' ? 0 : damageBoost) : 0;
  });
  const spy = p.spyAssignments.some(s => s.active && group.includes(s.heroId)
    && (s.source === 'infiltrator' || p.research.includes('invisible')));
  const targets = foes.filter(h => spy || Math.max(...damages) >=
    heroStatsForCategory(HEROES.find(d => d.id === h.id)!.category, true).def);
  // Without lethal force, assemble with another friendly hero instead of
  // spending the round entering a battle that cannot kill a Leader.
  const goals = targets.length ? targets.map(h => h.coord!)
    : state.heroes.filter(h => h.ownerId === p.playerId && !h.dead && h.coord
      && !group.includes(h.id)).map(h => h.coord!);
  if (!goals.length) return 0;
  const distances = new Map<Coord, number>(goals.map(c => [c, 0]));
  const queue = [...goals];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!; const [x,y] = c.split(',').map(Number);
    for (const t of neighborsOf(state.tiles, x!, y!)) {
      const next = coordKey(t.c,t.r);
      if (!distances.has(next)) { distances.set(next, distances.get(c)! + 1); queue.push(next); }
    }
  }
  const before = distances.get(move.from) ?? 99, after = distances.get(move.to) ?? 99;
  if (after >= before) return 0;
  const enemyHere = state.heroes.some(h => h.coord === move.to && h.ownerId !== p.playerId && !h.dead)
    || state.units.some(u => u.coord === move.to && u.ownerId !== p.playerId);
  if (enemyHere && !targets.length) return 0;
  return (after === 0 && targets.length ? 180 : 50) - after * 3 + group.length;
}

/** Count my units adjacent to `coord` (does an enemy here threaten me?). */
function areAnyMineAdjacent(state: NGGState, p: PlayerState, coord: Coord): boolean {
  const tile = state.tiles.find((t) => coordKey(t.c, t.r) === coord);
  if (!tile) return false;
  const mine = new Set<Coord>([
    ...state.units.filter((u) => u.ownerId === p.playerId).map((u) => u.coord),
    ...state.heroes.filter((h) => h.ownerId === p.playerId && !h.dead && h.coord).map((h) => h.coord!),
  ]);
  return neighborsOf(state.tiles, tile.c, tile.r).some((n) => mine.has(coordKey(n.c, n.r)));
}

/** 1 when `to` brings me adjacent to an enemy piece/space, else 0. */
function adjacencyTowardEnemy(state: NGGState, p: PlayerState, to: Coord): number {
  const tile = state.tiles.find((t) => coordKey(t.c, t.r) === to);
  if (!tile) return 0;
  for (const n of neighborsOf(state.tiles, tile.c, tile.r)) {
    const k = coordKey(n.c, n.r);
    if (state.units.some((u) => u.coord === k && u.ownerId !== p.playerId)) return 1;
    if (state.heroes.some((h) => h.coord === k && h.ownerId !== p.playerId && !h.dead)) return 1;
  }
  return 0;
}

/** Crude threat read: enemy units at `coord` outgun my movers? */
function threatAssessment(state: NGGState, p: PlayerState, coord: Coord): number {
  const enemyUnits = state.units.filter((u) => u.coord === coord && u.ownerId !== p.playerId);
  const enemyHeroes = state.heroes.filter((h) => h.coord === coord && h.ownerId !== p.playerId && !h.dead);
  let threat = 0;
  for (const u of enemyUnits) { const d = unitById(u.typeId); threat += d?.dmg ?? 0; }
  for (const h of enemyHeroes) { const hd = HEROES.find((x) => x.id === h.id); threat += hd ? heroStatsForCategory(hd.category, h.isLeader).dmg : 1; }
  return threat;
}

// ---- Battle ----------------------------------------------------------------

function commitScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'commit_battle_card' }>): number {
  if (!move.card) return 10;
  // Commit a card whose printed effect helps my side of this battle.
  const b = state.battle!;
  const mine = b.units.filter((u) => u.ownerId === p.playerId);
  const theirs = b.units.filter((u) => u.ownerId !== p.playerId);
  const myDmg = mine.reduce((a, u) => a + u.dmg, 0);
  const theirDmg = theirs.reduce((a, u) => a + u.dmg, 0);
  const outnumbered = mine.length < theirs.length;
  const label = move.card.toLowerCase();
  // Retreat pulls ALL my units out before anyone fights: only an escape from
  // a fight I'm losing, never a default play (playtest 2026-09-24: the AI
  // attacked, then retreated from its own attack at once).
  if (label.includes('retreat')) return theirDmg > myDmg ? 30 : 2;
  let s = 20;
  if (label.includes('+1 dmg') && myDmg > 0) s += 14;
  if (label.includes('−1 def') || label.includes('-1 def')) s += 10;
  if (label.includes('initiative') && theirs.some((u) => u.init > (mine[0]?.init ?? 0))) s += 8;
  if (label.includes('rally') && outnumbered) s += 12; // bring friends when losing the count
  if (label.includes('counter')) s += 6; // reactive — only good once I see their card
  if (label.includes('extra')) s += 5;
  return s;
}

function activationScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'battle_activation' }>, hard: boolean): number {
  const a = move.action;
  if (a.kind === 'attack') {
    const b = state.battle!;
    const me = b.units.find((u) => u.unitRef === move.unit);
    if (me?.aoe) {
      // An area attack: worth the kills it lands across the opposing side.
      const hits = b.units.filter((u) => u.side !== me.side && currentDmgOf(state, me) >= currentDefOf(state, u));
      if (hits.length === 0) return 2;
      return 40 + 30 * hits.length + (hits.some((u) => state.heroes.some((h) => h.id === u.unitRef && h.isLeader)) ? 100 : 0);
    }
    const tgt = b.units.find((u) => u.unitRef === a.target);
    if (!me || !tgt) return 40;
    // Kill-secured attacks first; then pick the softest valuable target.
    let s = 40;
    const wouldKill = currentDmgOf(state, me) >= currentDefOf(state, tgt) ? 1 : 0;
    if (!wouldKill) return 2; // damage does not accumulate across attacks
    s += wouldKill * 30;
    if (tgt.isHero) s += 18; // heroes are the prize (spy targets + the Leader)
    if (state.heroes.some(h => h.id === tgt.unitRef && h.isLeader)) s += 100;
    if (hard) s -= tgt.def * 0.5;
    return s;
  }
  if (a.kind === 'ability') {
    const cost = a.mana ?? 0;
    let s = 30 - cost; // abilities are good but mana is finite
    if (a.ability === 'ice_blast') s += 12; // −100 Init flips the pass order
    if (a.ability === 'fiery_explosion') s += 10; // AoE
    if (a.ability === 'dehance') s += 8;  // shaves DEF off a tanky target
    if (a.ability === 'enhance') s += 6;
    return s;
  }
  if (a.kind === 'self_destruct') {
    // Ruling #111: blow up when it kills more of theirs than of ours, never my own Leader.
    const b = state.battle!;
    const me = b.units.find((u) => u.unitRef === move.unit);
    if (!me) return 1;
    const dmg = currentDmgOf(state, me) + 3;
    const theirs = b.units.filter((u) => u.side !== me.side && dmg >= currentDefOf(state, u));
    const ours = b.units.filter((u) => u.side === me.side && u.unitRef !== me.unitRef && dmg >= currentDefOf(state, u));
    if (theirs.length === 0 || ours.some((u) => u.ownerId === p.playerId && state.heroes.some((h) => h.id === u.unitRef && h.isLeader))) return 0;
    return 20 + 30 * theirs.length - 30 * ours.length + (theirs.some((u) => state.heroes.some((h) => h.id === u.unitRef && h.isLeader)) ? 100 : 0);
  }
  if (a.kind === 'spy_attack' || a.kind === 'invisible') {
    // Reveal only to kill a HERO (the spy is spent). Never waste it on a unit.
    const b = state.battle!;
    const tgt = b.units.find((u) => u.unitRef === a.target);
    return state.heroes.some(h => h.id === tgt?.unitRef && h.isLeader) ? 200 : tgt?.isHero ? 80 : 5;
  }
  return 5; // pass — the floor
}

function defenseScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'resolve_battle_defense' }>): number {
  const d = move.defense;
  if (d.kind === 'none') return 20;
  const b = state.battle!;
  const target = b.defense ? b.units.find((u) => u.unitRef === b.defense!.targetRef) : undefined;
  if (d.kind === 'decoy') return 40; // a clean dodge beats everything
  if (d.kind === 'cleric_save') return 35 + (target?.isHero ? 10 : 0);
  if (d.kind === 'mana_shield') {
    // Spend just enough to save the unit when I can read the incoming damage.
    const need = b.defense && target ? b.defense.damage - target.def : 0;
    if (target && need > 0 && (d.mana ?? 0) >= need && target.def + (d.mana ?? 0) >= b.defense!.damage) return 30;
    return 14; // a partial shield is still something on a valuable unit
  }
  return 20;
}

function retreatScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_retreat' }>): number {
  if (move.stay || move.destination === null) return 25;
  // Retreat when out-fought; stay when winning. Crude but consistent.
  const b = state.battle!;
  const mine = b.units.filter((u) => u.ownerId === p.playerId);
  const theirs = b.units.filter((u) => u.ownerId !== p.playerId);
  const losing = mine.reduce((a, u) => a + Math.max(0, u.dmg), 0) < theirs.reduce((a, u) => a + Math.max(0, u.dmg), 0) || mine.length < theirs.length;
  return losing ? 35 : 10;
}

// ---- Battle card batches ---------------------------------------------------

function counterScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_counter_target' }>): number {
  const b = state.battle!;
  const target = b.committed.find((c) => {
    const def = BATTLE_CARDS.find((x) => x.id === c.card);
    return def?.label.toLowerCase() === move.card.toLowerCase();
  });
  // Always counter the opponent's most valuable pending card: initiative and
  // bonus swings are the big ones; countering an ally's card is almost never.
  if (!target) return 40;
  if (target.playingPlayerId === p.playerId) return 2; // don't counter my own
  const label = move.card.toLowerCase();
  let s = 40;
  if (label.includes('initiative')) s += 14;
  if (label.includes('bonus')) s += 10;
  if (label.includes('rally')) s += 8;
  if (label.includes('extra')) s += 12; // stop the chain before it starts
  return s;
}

function extraScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'select_extra_cards' }>): number {
  if (move.cards.length === 0) return 5;
  // Only throw good cards into the Extra: bonus + initiative ride the batch.
  let s = 10;
  for (const c of move.cards) {
    const l = c.toLowerCase();
    if (l.includes('initiative')) s += 14;
    else if (l.includes('bonus')) s += 12;
    else if (l.includes('rally')) s += 8;
    else s += 3; // filler cards dilute the batch more than they help
  }
  return s;
}

function rallyScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'select_rally_units' }>): number {
  if (move.units.length === 0) return 10;
  // Bring the biggest guns I have adjacent; don't rally a Collector into a fight.
  let s = 20;
  const b = state.battle!;
  const outnumbered = b.units.filter((u) => u.ownerId === p.playerId).length < b.units.filter((u) => u.ownerId !== p.playerId).length;
  s += outnumbered ? move.units.length * 6 : -move.units.length * 2;
  return s;
}

// ---- Treaties / access ------------------------------------------------------

function accessRequestScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'respond_access_request' }>): number {
  if (move.grant) return 15; // mild possessiveness is the port default
  // Refuse when the buyer is LEADING (deny them the purchase), grant when I'm
  // ahead or they're a treaty partner already feeding me access.
  return 25;
}

function respondTreatyScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'respond_treaty' }>, strat: NGGStrategy | undefined): number {
  const path = strat ?? bestPath(state, p);
  if (!move.accept) {
    // Decline only when the treaty would COST me something real: a win-sharing
    // Culture Treaty while I'm ahead, or a Peace treaty while I'm on the
    // warpath. Income treaties (Shared Resources / Open Borders / Shared
    // Tactics) pay me too — accept them.
    const pend = state.pending?.kind === 'treaty_response' ? state.pending : null;
    if (pend) {
      const def = TREATIES.find((t) => t.id === pend.treatyType);
      const ahead = otherSeats(state, p.playerId).every((q) => positionValue(state, p.playerId) >= positionValue(state, q.playerId));
      if (def?.id === 'culture-treaty' && ahead) return 60; // a shared win is half a win — never while ahead
      if ((def?.id === 'peace' || def?.id === 'open-borders') && path === 'military') return 20;
    }
    return 6; // low: accepting is usually right
  }
  let s = 18;
  if (path === 'cultural') s += 14; // culture treaties pay income
  if (path === 'military') s -= 4;  // peace/open-borders restrain the war
  return s;
}

/** Hard's answer to an offer: symmetric income (+5 to both) shortens the
 *  race without moving the gap, so it helps whoever is AHEAD. Accept when
 *  ahead, decline when behind — the Culture Treaty keeps its own rule. */
function respondTreatyScoreHard(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'respond_treaty' }>, strat: NGGStrategy | undefined): number {
  const base = respondTreatyScore(state, p, move, strat);
  const pend = state.pending?.kind === 'treaty_response' ? state.pending : null;
  if (!pend || pend.treatyType === 'culture-treaty') return base;
  // Only at 2p: with three or more seats a treaty I decline gets formed
  // between the others instead, so there the right answer is to be in as
  // many income treaties as possible.
  if (state.players.length > 2) return base;
  const ahead = otherSeats(state, p.playerId).every((q) => positionValue(state, p.playerId) >= positionValue(state, q.playerId));
  if (!ahead && !move.accept) return 45;
  return base;
}

function formTreatyScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'form_treaty' }>, strat: NGGStrategy | undefined): number {
  const path = strat ?? bestPath(state, p);
  const def = TREATIES.find((t) => t.name === move.treaty_type);
  // Baseline: a treaty with income pays culture every round for the rest of the
  // game. Even at medium this is worth real points — it just never sees it.
  let s = 16 + (def?.cultureIncome ?? 0);
  if (!def) return s;
  if (strat === 'technological') return 0;
  // A Culture Treaty shares the win. Offer it only from BEHIND — the partner
  // ahead of me carries me; ahead of them I'd be giving half my win away.
  if (def.id === 'culture-treaty' && !otherSeats(state, p.playerId).some((q) => positionValue(state, q.playerId) > positionValue(state, p.playerId))) return 0;
  if (strat === 'military' && ['peace','open-borders'].includes(def.id)) return 0;
  if (path === 'cultural' && (def.id === 'culture-treaty' || def.id === 'shared-resources' || def.id === 'open-borders')) s += 20;
  if (path === 'economic' && def.id === 'shared-resources') s += 22; // more tiles to collect on
  if (path === 'military' && def.id === 'shared-tactics') s += 16; // read + play their cards
  if (path === 'military' && def.id === 'peace') s -= 8; // handcuffs
  return s;
}

/** Hard's treaty offer gets a real income-weighted boost once the culture
 *  engine is capped — this is hard's decisive edge: medium NEVER forms a treaty
 *  (it scores them 16 while its builds score 50+), so it forgoes the printed
 *  +5/treaty/round income stream that tips a close culture race. Called from
 *  scoreMove so `hard` is the only tier that actually uses treaties. */
function formTreatyScoreHard(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'form_treaty' }>, strat: NGGStrategy | undefined): number {
  const base = formTreatyScore(state, p, move, strat);
  const def = TREATIES.find((t) => t.name === move.treaty_type);
  if (!def) return base;
  if (strat === 'technological') return 0;
  if (strat === 'military' && ['peace','open-borders'].includes(def.id)) return 0;
  // The printed edge (batch-validated: form_treaty lift +55.6% at 3p): being
  // FIRST on the treaty unlock opens an income + access stream medium never
  // reaches. BUT the +5 income lands on BOTH partners — symmetric — so the
  // asymmetric win is ACCESS: Shared Resources / Open Borders let me collect
  // on THEIR locations (production they can't reciprocate while they lack an
  // Embassy to answer back). Prefer the access treaties; flat income is the
  // smaller win, and NEVER bankroll a seat already ahead of me.
  const partnerAhead = positionValue(state, move.partner) > positionValue(state, p.playerId) + 0.02;
  // Symmetric income helps the seat that is ahead: at 2p never bankroll a
  // partner who leads me; at 3p+ every extra partner is +5 a round only I
  // collect from THAT pair, so the table-wide treaty web is the edge.
  if (partnerAhead && state.players.length === 2) return 0;
  const accessBonus = def.id === 'shared-resources' || def.id === 'open-borders' ? 26 : 0;
  const income = def.cultureIncome * 4 + 30;
  return base + income + accessBonus - (partnerAhead ? 20 : 0);
}

function breakTreatyScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'break_treaty' }>): number {
  // Break a treaty when the partner is ahead and it restrains me (peace /
  // open-borders blocking my fights), or when shared resources stop paying.
  const def = TREATIES.find((t) => t.name === move.treaty_type);
  const partnerAhead = positionValue(state, move.partner) > positionValue(state, p.playerId);
  let s = 8;
  if (!def) return s;
  if (partnerAhead && (def.id === 'peace' || def.id === 'open-borders')) s += 18;
  if (def.id === 'culture-treaty') s -= 30; // never — sharing a win is the whole point
  return s;
}

// ---- Heroes / spies / overlays / placement ---------------------------------

function milestoneScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_milestone_hero' }>, hard: boolean, strat: NGGStrategy | undefined): number {
  const path = strat ?? bestPath(state, p);
  const hero = HEROES.find((h) => h.name.toLowerCase() === move.hero.toLowerCase() || h.id === move.hero.toLowerCase());
  if (!hero) return 30;
  // Effect-keyed levers: what the hero DOES for the path, not the label.
  let s = 30;
  const id = hero.id;
  switch (path) {
    case 'cultural': {
      if (id === 'chronicler') s += 45;      // +5/round (ruling #114; #82 had +2)
      // Foreman = a SECOND Build purchase per Build action — it doubles the
      // whole economy's tempo (two Subjects land where one did). At the
      // culture race this is the single highest-value claim in the pool; the
      // batch trace shows the winner is whoever compounds fastest, and Foreman
      // IS compounding. Hard claims it ahead of everything but Chronicler.
      if (id === 'foreman') s += (hard ? 34 : 18);
      if (id === 'quartermaster') s += 14;   // extra build card
      if (id === 'marshal') s += 6;
      break;
    }
    case 'military': {
      if (id === 'rook' || id === 'kestrel') s += 26; // +2 DMG to all others
      if (id === 'warden') s += 20;          // +1 DEF to all others
      if (id === 'marshal') s += 22;         // extra move/battle card
      if (id === 'evo-angel') s += 18;       // combat stats 80/4/4
      if (id === 'chaimidious') s += 12;     // free battle card
      break;
    }
    case 'economic': {
      if (id === 'foreman') s += 28;         // two purchases → reach 11 Surfs fastest
      if (id === 'quartermaster') s += 16;
      if (hero.category === 'economy') s += 20; // Dowser/Ida/Derrick/Mayhew overlays
      break;
    }
    case 'technological': {
      if (id === 'kettering') s += 28;       // two research purchases
      if (id === 'smyth') s += 24;           // free tech
      if (id === 'motherboard' || id === 'greymore') s += 26; // +1 tech point alive
      if (id === 'archivist') s += 16;       // extra research card
      break;
    }
  }
  if (hard) {
    // Species-restricted picks are already filtered upstream; here just prefer
    // a hero whose effect I can use THIS round (placed immediately at a base).
    if (state.bases.some((b) => b.ownerId === p.playerId)) s += 2;
  }
  return s;
}

function spyScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_spy' }>): number {
  const hero = HEROES.find((h) => h.name.toLowerCase() === move.hero.toLowerCase() || h.id === move.hero.toLowerCase());
  if (!hero) return 20;
  // Under threat the spy guards the Leader: a wizard Decoy voids the
  // instant-kill attack; a robot Spy Attack from the Leader strikes first.
  const mine = state.heroes.find((h) => h.id === hero.id && h.ownerId === p.playerId);
  if (mine?.isLeader && leaderThreatDistance(state, p) <= 4) return 60;
  // Put the spy on a hero that already fights in the open (military/evo) so
  // the reveal lands on a unit actually in the battle — never on a pure
  // economy overlay hero standing on a remote tile.
  if (hero.category === 'military' || hero.category === 'evo-angel') return 38;
  if (hero.category === 'technology') return 22;
  return 16;
}

function reallocateScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'reallocate_cores' }>, hard: boolean): number {
  if (!hard) return 10;
  // Allocate Cores to combat platforms over collectors when a threat exists
  // (collectors already committed can't move; a Coreless combat platform is a
  // wasted piece). The pending offered keep/toggle options; prefer keeping.
  const alloc = Object.entries(move.allocations);
  const combatWithCore = alloc.filter(([unitId, on]) => {
    if (!on) return false;
    const u = state.units.find((x) => x.id === unitId);
    const d = u ? unitById(u.typeId) : undefined;
    return d && !d.collector && d.dmg !== null && d.dmg > 0;
  }).length;
  return 10 + combatWithCore * 8 - alloc.filter(([, on]) => !on).length * 2;
}

function overlayScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'resolve_overlay_choice' }>): number {
  // Pick the overlay whose resource I most need for my current path.
  const hero = HEROES.find((h) => h.name.toLowerCase() === move.hero.toLowerCase() || h.id === move.hero.toLowerCase());
  const wantResource: Record<NGGStrategy, string[]> = {
    cultural: ['wood', 'water'],
    economic: ['ether', 'oil', 'ore', 'wood', 'water'],
    military: ['ore', 'wood'],
    technological: ['ore', 'ether', 'wood'],
  };
  const pathRes = wantResource[bestPath(state, p)];
  const overlayRes: Record<string, string> = { wren: 'water', ida: 'ore', derrick: 'oil', mayhew: 'ether' };
  const res = hero ? overlayRes[hero.id] : undefined;
  return 20 + (res && pathRes.includes(res) ? pathRes.length - pathRes.indexOf(res) : 0) * 4;
}

function placeScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'place_reserved_hero' }>): number {
  const hero = HEROES.find((h) => h.name.toLowerCase() === move.hero.toLowerCase() || h.id === move.hero.toLowerCase());
  let s = 50;
  // Place a bonus/tech hero where it starts paying NOW (any owned base does);
  // an economy overlay hero prefers a tile whose resource its overlay improves.
  if (hero && hero.category === 'economy') {
    const tile = state.tiles.find((t) => coordKey(t.c, t.r) === move.coord);
    if (tile) s += 6;
  }
  return s;
}

function elaraScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'cast_elara_spell' }>): number {
  if (move.skip || move.target_location === null) return 5;
  // The batch lift table measured casting Elara at −50% WR (sig): the 5-mana
  // cost + the skipped movement costs more than the 4 damage gains. The
  // correct AI play is to skip unless the spell KILLS a Leader outright.
  const k = move.target_location;
  const enemies = state.units.filter((u) => u.coord === k && u.ownerId !== p.playerId).length
    + state.heroes.filter((h) => h.coord === k && h.ownerId !== p.playerId && !h.dead).length;
  const leaderThere = state.heroes.some((h) => h.coord === k && h.ownerId !== p.playerId && h.isLeader && !h.dead);
  if (leaderThere && enemies >= 2) return 42; // a Leader kill is a victory path
  if (enemies >= 3) return 20;                 // mass clear, rare
  return 2;                                    // below the skip floor — never cast
}

// ---- Setup (also drives the human-facing pending when a human lets the AI
//      recommend) -------------------------------------------------------------

function leaderScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_leader' }>, strat: NGGStrategy | undefined): number {
  const hero = HEROES.find((h) => h.name.toLowerCase() === move.hero.toLowerCase() || h.id === move.hero.toLowerCase());
  if (!hero) return 50;
  const path = strat ?? (speciesOf(p) === 'robot' ? undefined : undefined);
  void path;
  // Reuse the milestone lean: the Leader is with me the whole game, so the
  // path-keyed preferences apply even harder. Default (no strategy) = the
  // species-recommended Leader, then the path-leaning pick.
  let s = 40 + (hero.recommendedLeader ? 8 : 0);
  if (strat) s += milestoneScore(state, p, { type: 'choose_milestone_hero', hero: hero.name }, false, strat) - 30;
  return s;
}

function locationScore(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'choose_starting_location' }>, strat: NGGStrategy | undefined): number {
  const path = strat ?? bestPath(state, p);
  const tile = state.tiles.find((t) => `@${t.start}` === move.location);
  if (!tile) return 30;
  const k = coordKey(tile.c, tile.r);
  // Prefer a start adjacent to the resources my path needs: an economic robot
  // wants oil+ether nearby; everyone wants wood/water for early Surfs.
  const want = path === 'economic' ? ['ether', 'oil', 'ore', 'wood', 'water']
    : path === 'technological' ? ['ore', 'ether', 'wood']
    : path === 'military' ? ['ore', 'wood']
    : ['wood', 'water'];
  let s = 30;
  for (const n of neighborsOf(state.tiles, tile.c, tile.r)) {
    const ri = want.indexOf(n.resource);
    if (ri >= 0) s += (want.length - ri) * 3;
  }
  // A start that is itself a needed resource is a small plus.
  const selfIdx = want.indexOf(state.tiles.find((t) => coordKey(t.c, t.r) === k)?.resource ?? '');
  if (selfIdx >= 0) s += (want.length - selfIdx) * 2;
  return s;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function otherSeats(state: NGGState, playerId: string): PlayerState[] {
  return state.players.filter((q) => q.playerId !== playerId);
}

function totalCost(cost: Partial<Record<string, number>>): number {
  return Object.values(cost).reduce<number>((a, b) => a + (b ?? 0), 0);
}

function narrationFor(move: NGGMove): string {
  switch (move.type) {
    case 'plan_action': return move.card === 'pass' ? 'passes planning' : `plans ${move.card}`;
    case 'build': return `builds ${move.item}`;
    case 'economic_victory_spend': return 'commits collectors across half the map for the Economic victory';
    case 'research': return move.kind === 'tech' ? `researches ${move.tech}` : 'buys a battle strategy card';
    case 'move_units': return `moves units from ${move.from} to ${move.to}`;
    case 'commit_battle_card': return move.card ? 'commits a battle card' : 'commits no battle card';
    case 'battle_activation': return `activates ${move.unit}`;
    case 'choose_retreat': return move.stay || move.destination === null ? 'stays in the battle' : `retreats toward ${move.destination}`;
    case 'form_treaty': return `offers ${move.treaty_type} to ${move.partner}`;
    case 'break_treaty': return `breaks ${move.treaty_type}`;
    case 'choose_milestone_hero': return `claims ${move.hero}`;
    case 'resolve_report': return 'presses Draw';
    default: return move.type;
  }
}
