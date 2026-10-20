// Phase-aware next_step for Fractured Fist (CLAUDE.md "next_step and setup
// directives"). Every step a human owes is their own turn — there are no
// setup reports and no mid-turn reports to an AI — but WHAT they owe changes
// with the phase: techniques, then resources and buys, and a refine window
// that blocks everything else until it is used or skipped. Each gets a
// human_response whose `ask` works read aloud (zekel Live speaks it) and whose
// `records_as` names the exact move and fields. AI turns return null so the
// generic ai_to_move directive (run_ai_turn) stands.

import type { NextStep, SessionState } from '@zekel/game-kit';
import { FOCUS_RELOADS_PER_TURN } from './cards.js';
import { getLegalMoves } from './legalMoves.js';
import { count, seatNamer } from './narration.js';
import type { FFState } from './types.js';

export function describeFFNextStep(state: SessionState<FFState>): NextStep | null {
  const gs = state.gameState;
  if (gs.phase === 'game_over') return null;
  const pid = gs.activePlayerId;
  const seat = state.players.find((p) => p.player_id === pid);
  if (seat?.kind !== 'human') return null;
  const me = gs.players[pid];
  if (!me) return null;

  const name = seatNamer(state.players)(pid);
  const physical = me.kind === 'opaque';
  const offered = new Set(getLegalMoves(gs, pid).map((lm) => lm.move.type));
  const reloadNote = offered.has('focus_reload')
    ? physical
      ? ' Because their stamina is lower than the opponent\'s, they may also reload with Focus ' +
        `(focus_reload with count = how many Focus cards they discarded; ${FOCUS_RELOADS_PER_TURN - (me.focusReloadsThisTurn ?? 0)} left this turn).`
      : ' They may also reload with Focus (focus_reload).'
    : '';
  // The reload option as facts, for clients that never see the prose.
  const reloadsLeft = FOCUS_RELOADS_PER_TURN - (me.focusReloadsThisTurn ?? 0);
  const reloadFacts = offered.has('focus_reload')
    ? [
        "Because your stamina is lower than your opponent's, you may also reload with Focus: discard every Focus card in your hand and draw that many.",
        `${reloadsLeft === 1 ? '1 reload is' : `${reloadsLeft} reloads are`} left this turn.`,
      ]
    : [];
  const base = (
    instruction: string,
    human_response: NextStep['human_response'],
    facts: NonNullable<NextStep['facts']>,
  ): NextStep => {
    const notes = [...(facts.notes ?? []), ...reloadFacts];
    return {
      status: 'human_to_move',
      active_player_id: pid,
      instruction:
        `It is ${name}'s turn (human player, seat ${pid}). ${instruction} ` +
        'Record exactly ONE move per apply_move, and never pick for them.' +
        reloadNote,
      human_response,
      facts: { ...facts, ...(notes.length > 0 ? { notes } : {}) },
    };
  };

  // A refine window blocks every other move until each refine is used or skipped.
  if (me.refinePending > 0) {
    return base(
      `They may refine ${count(me.refinePending, 'card')} from their hand (remove it from the game) before doing anything else.`,
      physical
        ? {
            ask: `You may refine ${count(me.refinePending, 'card')}. Which card do you remove from the game: a Misstep, a different card, or none?`,
            example: 'I refine a Misstep',
            records_as:
              'refine_card with was_misstep: true for a Misstep or false for any other card (one per refine); ' +
              'skip_refine to give up the remaining refines',
          }
        : {
            ask: `You may refine ${count(me.refinePending, 'card')}. Which card from your hand do you remove from the game, or none?`,
            example: 'I refine the Misstep',
            records_as:
              'refine_card with the hand_index get_legal_moves lists for that card; skip_refine to give up the remaining refines',
          },
      {
        phase: 'Refine',
        notes: [`You may refine ${count(me.refinePending, 'card')} from your hand, removing each from the game, before doing anything else.`],
      },
    );
  }

  if (gs.phase === 'technique') {
    if (me.actions < 1) {
      return base(
        'They have no actions left, so they cannot play another technique card this turn.',
        {
          ask: 'You are out of actions. Do you move on to the Channel phase, or end your turn?',
          example: 'I move on to channel',
          records_as: 'advance_phase to go to the Channel phase; end_turn to end the turn without channeling',
        },
        { phase: 'Technique phase', notes: ['You have no actions left, so you cannot play another technique card this turn.'] },
      );
    }
    return base(
      `Technique phase: they have ${count(me.actions, 'action')} left. Wait for them to say which technique card they play.`,
      {
        ask: `Technique phase, you have ${count(me.actions, 'action')}. Which technique card do you play? Or are you moving on to the Channel phase?`,
        example: 'I play Devastating Blow',
        records_as:
          'play_card with card_id = the name printed on the card; advance_phase to go to the Channel phase; ' +
          'end_turn to end the turn without channeling',
      },
      { phase: 'Technique phase', notes: [`You have ${count(me.actions, 'action')} left.`] },
    );
  }

  // Channel phase.
  const canBuy = offered.has('buy_card');
  return base(
    `Channel phase: they have ${me.spirit} spirit and ${count(me.channels, 'channel')} left. ` +
      'Wait for them to say which resource card they play or which card they buy.',
    {
      ask:
        `Channel phase, you have ${me.spirit} spirit and ${count(me.channels, 'channel')}. ` +
        (canBuy
          ? 'Which resource card do you play, or what do you buy? Or are you ending your turn?'
          : 'Which resource card do you play? Or are you ending your turn?'),
      example: canBuy ? 'I buy Block' : 'I play a Momentum',
      records_as:
        'play_card with card_id = the resource card (Focus, Momentum or Mastery), one card per move; ' +
        'buy_card with card_id = the name printed on the card bought; end_turn to end the turn',
    },
    { phase: 'Channel phase', notes: [`You have ${me.spirit} spirit and ${count(me.channels, 'channel')} left.`] },
  );
}
