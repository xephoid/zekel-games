import type { ReportVoice } from '@zekel/game-kit';

// Warble Way Galaxy's report_to_human voice — the DM contract, applied per
// response via Game.reportVoice. Same mechanical-completeness core as
// BOARD_VOICE (mcp/tools.ts), but inverted on two points the board default
// gets wrong for this game:
//  - apply_move here RESOLVES consequences the solo player cannot see (hazard
//    damage, credits, XP), so the confirm string demands a FULL relay, not the
//    board default's one-line confirm.
//  - Color is invited AFTER the facts (grounded in get_lore) instead of
//    forbidden.
// The AI-move strings stay factual: in real play there are no AI seats (solo
// game); they fire only for the harness solvability bot, where flavor is noise
// in the logs. Strings are locked by mcp/__tests__/reportVoice.test.ts.
export const DM_VOICE: ReportVoice = {
  applyMoveConfirm:
    'Relay every mechanical fact from state_summary exactly — each number, cost, ' +
    'consequence, and state change, nothing omitted — so the player can update ' +
    'their physical sheet. THEN you may add a sentence or two of in-world color ' +
    'grounded in the lore (get_lore). Color is additive: it never replaces, ' +
    'contradicts, or obscures a fact, and never introduces a mechanic, value, ' +
    'or die result the summary did not contain.',
  aiMoveFull:
    'Relay state_summary in full — every fact, in plain game terms. (Automated ' +
    'seats exist only in harness runs; no embellishment needed.)',
  runAiTurnNone: 'No automated moves were played this call — follow next_step.',
  runAiTurn: (movesPlayed, gameOverNow) =>
    `Relay all ${movesPlayed} automated move(s) in order — each entry's state_summary in full, ` +
    'in plain game terms, nothing omitted.' +
    (gameOverNow ? ' Then report the game result.' : ' Then follow next_step.'),
};
