// Dev hooks for warble-way-galaxy: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { moveType } from '@zekel/dev/harness/analysis';

// ---- Warble Way Galaxy (SOLO RPG on the RPG server) ----
// One seat → the whole game segments as a single "turn", so per-turn dead/real
// metrics are degenerate; the meaningful temporal read is the score_trace.
// leaderScalar mirrors the game's progressScore (../ai.ts) — keep the
// formulas in sync.
const warbleWayGalaxyAnalysis: AnalysisOverride = {
  // A11 objective dimension (runbook §0.5): which of the five endings won —
  // per-ending achievement is the health metric for a multi-win-condition game.
  playerFeatures(record) {
    if ((record.result?.winners?.length ?? 0) === 0) return [];
    const summary = record.result?.summary ?? '';
    const m = summary.match(/^(FORTUNE|LEGEND|PLUNDER|BOUNTY)/);
    return [`ending:${m ? m[1]!.toLowerCase() : 'conquest'}`];
  },
  leaderScalar: (row) =>
    (row.credits ?? 0) +
    150 * Math.max(0, (row.level ?? 1) - 1) +
    25 * (row.xp ?? 0) +
    40 * (row.crew ?? 0) +
    300 * Math.max(0, (row.habitat ?? 1) - 1) +
    50 * (row.ship_damage_level ?? 0),
  // A "real turn" contains at least one DECISION (not pure physical reporting).
  isRealTurn(moves) {
    return moves.some((m) => !['report_roll', 'report_card_draw', 'report_res_discard'].includes(moveType(m)));
  },
  // A dead segment made no progress: nothing taken/bought/fought/moved/looted.
  isDeadTurn(moves) {
    const progress = new Set([
      'take_mission', 'accept_mission', 'buy_item', 'attempt_recruit', 'attempt_repair', 'attempt_reduce_unrest',
      'depart_for_next_habitat', 'fight_round', 'attempt_hack', 'attempt_escape', 'board_ship', 'take_ship',
      'enter_ruin', 'setup_encounter', 'move_being', 'attack', 'collect_item', 'recruit_at', 'convert_attacker',
      'level_up', 'use_item', 'report_card_draw',
    ]);
    return !moves.some((m) => progress.has(moveType(m)));
  },
};

export const devHooks: GameDevHooks = {
  analysis: warbleWayGalaxyAnalysis,
};
