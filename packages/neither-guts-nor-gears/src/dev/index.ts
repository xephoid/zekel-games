// Dev hooks for neither-guts-nor-gears: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks, SweepBuilder, SweepSpec } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { moveType } from '@zekel/dev/harness/analysis';
import type { MoveRecord } from '@zekel/dev/harness/runner';

// Neither Guts nor Gears: a round-based action-stack game (plan → LIFO pop →
// income → claims), NOT a play_card/buy_card deck-builder, so the generic rule
// marks EVERY turn dead. A "turn" (segment) here is one move plus its own
// pending-resolution chain; real board progress = a build/research purchase,
// movement, a battle act, a treaty, a claim, or a victory spend. Setup
// handshakes (factions/leaders/locations), forced draw reports, and pure
// pending reactions are not turns — isRealTurn drops them.
const NGG_SETUP_MOVES = new Set([
  'assign_setup_choices', 'choose_leader', 'choose_starting_location',
  'report_draw', 'resolve_report',
]);
// Pending-resolution moves that react to something else and never move the
// board on their own (granting access, answering a treaty, defenses, retreat,
// rally/counter/extra/draw settlement, tie-breaks, overlay/spy/claims).
const NGG_REACTIVE_MOVES = new Set([
  'respond_access_request', 'respond_treaty', 'resolve_battle_defense',
  'choose_retreat', 'select_rally_units', 'choose_counter_target',
  'select_extra_cards', 'initiative_tie', 'resolve_overlay_choice',
  'choose_spy', 'choose_milestone_hero', 'place_reserved_hero',
  'reallocate_cores',
]);
// A segment containing ANY of these made board progress (never dead).
const NGG_PROGRESS_MOVES = new Set([
  'plan_action', 'build', 'research', 'move_units', 'cast_elara_spell',
  'economic_victory_spend', 'form_treaty', 'break_treaty',
  'commit_battle_card', 'battle_activation',
]);
function nggProgress(m: MoveRecord): boolean {
  const move = m.move as { type?: string; card?: string | null; skip?: boolean; action?: { kind?: string } };
  if (move.type === 'plan_action') return move.card !== 'pass';
  if (move.type === 'cast_elara_spell') return !move.skip;
  if (move.type === 'commit_battle_card') return move.card != null;
  if (move.type === 'battle_activation') return move.action?.kind !== 'pass';
  return NGG_PROGRESS_MOVES.has(moveType(m));
}
const neitherAnalysis: AnalysisOverride = {
  isRealTurn(moves) {
    // Drop pure setup handshakes (faction/leader/location/draw reports).
    if (moves.length > 0 && moves.every((m) => NGG_SETUP_MOVES.has(moveType(m)))) return false;
    // Drop segments that are ONLY a forced pending resolution (a defense,
    // a retreat answer, a rally pick) riding someone else's action — the
    // actor's own proactive move is the turn; the reaction is not.
    return moves.some((m) => !NGG_SETUP_MOVES.has(moveType(m)) && !NGG_REACTIVE_MOVES.has(moveType(m)));
  },
  isDeadTurn(moves) {
    // Dead = a real turn that made no board progress: nothing built, moved,
    // researched, battled, treatied, or claimed. A planning "pass" + a skip
    // both read dead (the player let the round go by). Any progress move lives.
    return !moves.some(nggProgress);
  },
  extraFeatures(m) {
    const move = m.move as { type?: string; item?: string; tech?: string; hero?: string; treaty_type?: string; card?: string | null };
    if (move.type === 'build' && move.item) return [`build:${move.item}`];
    if (move.type === 'research' && move.tech) return [`research:${move.tech}`];
    if (move.type === 'choose_milestone_hero' && move.hero) return [`claim:${move.hero}`];
    if (move.type === 'form_treaty' && move.treaty_type) return [`treaty:${move.treaty_type}`];
    if (move.type === 'commit_battle_card' && move.card) return [`battle_card:${move.card}`];
    return [];
  },
  // §4 "who is ahead": the shared eval.ts row (culture-dominant + the best
  // path as tie-break, dead-Leader collapsed). result.scores ranks on culture,
  // so the head term matches; the path prox keeps a non-Cultural leader from
  // reading as behind purely because they chased a different printed path.
  leaderScalar: (row) => {
    const culture = row.culture ?? 0;
    const military = (row.leader_kills ?? 0) / Math.max(1, row.military_needed ?? 1);
    const economic = (row.surfs_committed ?? 0) / Math.max(1, row.economic_collectors ?? 11); // the spend's size on this map (ruling #89)
    const tech = (row.tech_points ?? 0) / Math.max(1, row.tech_target ?? 22);
    const best = Math.max(culture / 100, military, economic, tech);
    const v = culture + best * 10;
    return (row.has_living_leader ?? 1) === 0 ? v * 0.2 : v;
  },
  // Setup identities plus actually achieved victory paths. A treaty partner
  // sharing a win did not necessarily achieve the initiating seat's objective.
  playerFeatures(record, playerId) {
    const view = record.final_views[playerId] as {
      players?: Array<{ player_id: string; faction?: string; species?: string }>;
      balance_setup?: Record<string, { leader?: string; start?: number; setup_order?: number }>;
    } | undefined;
    const out: string[] = [];
    const seat = view?.players?.find((p) => p.player_id === playerId);
    if (seat?.faction) out.push(`faction:${seat.faction}`);
    if (seat?.species) out.push(`species:${seat.species}`);
    const setup = view?.balance_setup?.[playerId];
    if (setup?.leader) out.push(`leader:${setup.leader}`);
    if (setup?.start != null) out.push(`start:${setup.start}`);
    if (setup?.setup_order != null) out.push(`setup_order:${setup.setup_order}`);
    if (record.result.summary.startsWith(`${playerId} wins (`)) {
      for (const path of ['Military', 'Cultural', 'Economic', 'Technological']) {
        if (record.result.summary.includes(path)) out.push(`objective:${path.toLowerCase()}`);
      }
    }
    return out;
  },
};

// ---------- sweeps (ai-harness --sweep=<name>) ----------

interface NGGReference {
  factions?: { id: string; species?: string }[];
  heroes?: { id: string; species?: string | null }[];
}

// Faction sweep: shuffle which faction each seat gets. The 'setup' sweep also
// pairs each faction with a species-eligible Leader for the AI seats.
function nggFactionSweep(reference: Record<string, unknown>, withLeaders: boolean): SweepSpec {
  const ref = reference as unknown as NGGReference;
  const factions = ref.factions ?? [];
  return {
    optionKey: 'factionAssignment', count: factions.length, pool: factions.map((f) => f.id),
    ...(withLeaders ? { companion: {
      optionKey: 'aiLeaderAssignment',
      eligible: Object.fromEntries(factions.map((f) => [f.id,
        (ref.heroes ?? []).filter((h) => h.species == null || h.species === f.species).map((h) => h.id),
      ])),
    } } : {}),
  };
}

const neitherSweeps: Record<string, SweepBuilder> = {
  faction: (reference) => nggFactionSweep(reference, false),
  setup: (reference) => nggFactionSweep(reference, true),
};

export const devHooks: GameDevHooks = {
  analysis: neitherAnalysis,
  sweeps: neitherSweeps,
};
