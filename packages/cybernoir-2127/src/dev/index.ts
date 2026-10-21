// Dev hooks for cybernoir-2127: what the development tools need to know about this
// game beyond the Game itself (@zekel/dev, harness/devHooks.ts).

import type { GameDevHooks, SweepBuilder } from '@zekel/dev/harness/devHooks';
import type { AnalysisOverride } from '@zekel/dev/harness/analysis';
import { moveType } from '@zekel/dev/harness/analysis';

import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import { cybernoirVerifyAdapter } from './verify/adapter.js';

// Cybernoir 2127: a turn is NOT a card-play vocabulary. The mandatory
// play_location + upkeep are maintenance (they happen every Detective turn and
// distinguish nothing), draw_contact/overclock are economy, and the reactive
// pending resolutions (block_decide during the Hacker's turn, clue_reveal
// during the Detective's, report_hideout at setup) are not turns at all.
const CN_REACTIVE_MOVES = new Set(['block_decide', 'clue_reveal', 'report_hideout']);
const CN_PROGRESS_MOVES = new Set([
  // Detective: pressure + information
  'arrest', 'recruit_informant', 'buy_clue', 'guess_location', 'final_guess',
  // Hacker: evidence + board impact
  'play_evidence', 'play_person', 'win_back', 'jailbreak',
]);
const cybernoirAnalysis: AnalysisOverride = {
  isRealTurn(moves) {
    // Drop pure reactive sub-resolutions (mid-opponent-turn pendings + setup).
    return !(moves.length > 0 && moves.every((m) => CN_REACTIVE_MOVES.has(moveType(m))));
  },
  isDeadTurn(moves) {
    // Dead = no progress move at all (mandatory play/upkeep/draw/pass only).
    return !moves.some((m) => CN_PROGRESS_MOVES.has(moveType(m)));
  },
  // §4 "who is ahead": the role-relative progress scalar from getScoreboard —
  // Detective = candidate elimination, Hacker = evidence assembly (ai.ts §2).
  leaderScalar: (row) => row.progress ?? 0,
  // Per-seat identity for the matchup matrix + lift table: which role this seat
  // played. Roles rotate with seat under seat rotation, so seat win rates alone
  // hide the Detective/Hacker split — the game's identity balance axis.
  playerFeatures(record, playerId) {
    const view = record.final_views[playerId] as { role?: string } | undefined;
    return typeof view?.role === 'string' ? [`role:${view.role}`] : [];
  },
};

// ---------- sweeps (ai-harness --sweep=<name>) ----------

const cybernoirSweeps: Record<string, SweepBuilder> = {
  // Cybernoir 2127: force the Hacker's hideout (the identity axis) so per-hideout
  // win rates measure whether any of the 18 locations is structurally strong.
  hideout(reference) {
    const names = ((reference as unknown as { locations?: { name: string }[] }).locations ?? []).map((l) => l.name);
    return { optionKey: 'hideout', count: 1, pool: names };
  },
  // Cybernoir 2127: AMBIG-4 parameterize-and-measure — when Overclock's 2 Location
  // draws land (immediate / next_turn / optional) moves the deck-exhaustion timer.
  overclock_draw_timing: () => ({ optionKey: 'overclock_draw_timing', count: 1, pool: ['immediate', 'next_turn', 'optional'] }),
};

export const devHooks: GameDevHooks = {
  analysis: cybernoirAnalysis,
  // Rules-checker adapters (./verify/), by adapter id.
  verify: {
    'cybernoir-2127': cybernoirVerifyAdapter as unknown as VerifyAdapter<unknown>,
  },
  sweeps: cybernoirSweeps,
};
