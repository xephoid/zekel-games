// Dev hooks for adventurer-olympics: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { summaryOf, moveType } from '@zekel/dev/harness/analysis';

import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { adventurerOlympicsVerifyAdapter } from './verify/adapter.js';

// Adventurer Olympics: moves are single steps, explores, icon tries and dice
// reports, not play_card/buy_card, so the generic rule marks every turn dead.
// A turn is DEAD when the player neither moved, explored, nor tried an icon —
// they stood still and stopped. Turn-order rolls and setup picks/reports are
// not turns (isRealTurn drops them). "Who is ahead" is the scoreboard's
// `outlook`: expected quest points, the same number the AI plans with and the
// MCTS leaf reads (aiPlanner.ts `outlook`).
const AO_PROGRESS_MOVES = new Set(['step', 'move_away', 'explore', 'try_again']);
const AO_NOT_A_TURN = new Set(['report_turn_order_roll', 'setup_standee', 'setup_report', 'resolve_report']);
const adventurerOlympicsAnalysis: AnalysisOverride = {
  isRealTurn(moves) {
    return !(moves.length > 0 && moves.every((m) => AO_NOT_A_TURN.has(moveType(m))));
  },
  isDeadTurn(moves) {
    return !moves.some((m) => AO_PROGRESS_MOVES.has(moveType(m)));
  },
  leaderScalar: (row) => row.outlook ?? row.quest_points ?? 0,
  // The quest draw (a scenario axis): which quests were in play this game.
  playerFeatures(record, playerId) {
    const view = record.final_views[playerId] as { inPlayQuests?: Record<string, string> } | undefined;
    return Object.keys(view?.inPlayQuests ?? {}).map((q) => `quest_in_play:${q}`);
  },
  extraFeatures(move) {
    // Which icon kinds a player takes on (from the canonical summary).
    const m = /The (City|Dungeon|Little Monster|Big Monster|Hearts|Spades|Diamonds|Clubs|Star) on .* triggers/.exec(summaryOf(move));
    return m ? [`icon:${m[1]!.toLowerCase().replace(/ /g, '_')}`] : [];
  },
};

export const devHooks: GameDevHooks = {
  analysis: adventurerOlympicsAnalysis,
  // Rules-checker adapters (./verify/), by adapter id.
  verify: {
    'adventurer-olympics': adventurerOlympicsVerifyAdapter as unknown as VerifyAdapter<unknown>,
  },
};
