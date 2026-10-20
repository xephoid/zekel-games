// Move-gate declarations for Fractured Fist (docs/rules-teaching.md). For each
// move type, "available" is read straight off getLegalMoves — the same list
// the tool surface offers — so the gates agree with it by construction; the
// only hand-written part is the REASON a type is missing, checked against
// live state in the same order the engine checks it, with the live values
// quoted ("you have 0 actions left"). checkGateConsistency stays as the lock
// (__tests__/rulesTeaching.test.ts).

import type { MoveGateStatus, SessionState } from '@zekel/game-kit';
import { FOCUS_RELOADS_PER_TURN, getCard } from './cards.js';
import { getLegalMoves } from './legalMoves.js';
import { count } from './narration.js';
import type { FFMove, FFState, PlayerState } from './types.js';

type Reason = { status: 'gated' | 'routine'; reason: string; rules_section?: string };

const MOVE_TYPES: FFMove['type'][] = [
  'play_card',
  'buy_card',
  'refine_card',
  'skip_refine',
  'advance_phase',
  'end_turn',
  'focus_reload',
];

function refineBlock(me: PlayerState): Reason | null {
  return me.refinePending > 0
    ? {
        status: 'gated',
        reason: `you still have ${count(me.refinePending, 'refine')} to use or skip first`,
        rules_section: 'refine',
      }
    : null;
}

function playReason(gs: FFState, me: PlayerState): Reason {
  const block = refineBlock(me);
  if (block) return block;
  if (gs.phase === 'technique') {
    if (me.actions < 1) {
      return {
        status: 'gated',
        reason: 'you have 0 actions left, and each technique card uses 1 — move on to the Channel phase to play resource cards',
        rules_section: 'technique-phase',
      };
    }
    return me.kind === 'tracked'
      ? { status: 'gated', reason: 'you have no technique cards in your hand', rules_section: 'technique-phase' }
      : { status: 'gated', reason: 'your hand is empty', rules_section: 'technique-phase' };
  }
  return me.kind === 'tracked'
    ? { status: 'gated', reason: 'you have no resource cards in your hand', rules_section: 'channel-phase' }
    : { status: 'gated', reason: 'your hand is empty', rules_section: 'channel-phase' };
}

function buyReason(gs: FFState, me: PlayerState): Reason {
  const block = refineBlock(me);
  if (block) return block;
  if (gs.phase === 'technique') {
    return {
      status: 'routine',
      reason: 'buying happens in the Channel phase — move on with advance_phase first',
      rules_section: 'channel-phase',
    };
  }
  if (me.channels < 1) {
    return {
      status: 'gated',
      reason: 'you have 0 channels left this turn, and each buy uses 1',
      rules_section: 'channel-phase',
    };
  }
  const costs = Object.entries(me.supply)
    .filter(([, n]) => n > 0)
    .map(([id]) => getCard(id).cost);
  if (costs.length === 0) {
    return { status: 'gated', reason: 'your supply is empty', rules_section: 'channel-phase' };
  }
  return {
    status: 'gated',
    reason: `you have ${me.spirit} spirit, and the cheapest card left in your supply costs ${Math.min(...costs)} — play resource cards for more spirit`,
    rules_section: 'channel-phase',
  };
}

function refineOnlyReason(me: PlayerState): Reason {
  if (me.refinePending > 0) {
    // Only reachable for refine_card: the hand has no card that can be refined.
    return me.kind === 'opaque' && me.handSize > 0
      ? { status: 'gated', reason: 'you have no Missteps left, and your hand has no other card', rules_section: 'refine' }
      : { status: 'gated', reason: 'your hand is empty, so there is nothing to refine — skip_refine instead', rules_section: 'refine' };
  }
  return {
    status: 'routine',
    reason: 'you can only refine right after playing a card with Refine',
    rules_section: 'refine',
  };
}

function advanceReason(gs: FFState, me: PlayerState): Reason {
  const block = refineBlock(me);
  if (block) return block;
  return {
    status: 'routine',
    reason: gs.phase === 'channel' ? 'you are already in the Channel phase' : 'not available right now',
    rules_section: 'turn-structure',
  };
}

function reloadReason(gs: FFState, pid: string, me: PlayerState): Reason {
  const block = refineBlock(me);
  if (block) return block;
  const oppId = gs.playerOrder.find((p) => p !== pid);
  const opp = oppId ? gs.players[oppId] : undefined;
  if (opp && me.stamina >= opp.stamina) {
    return {
      status: 'gated',
      reason: `only when your stamina is lower than your opponent's — yours is ${me.stamina}, theirs is ${opp.stamina}`,
      rules_section: 'focus-reload',
    };
  }
  const used = me.focusReloadsThisTurn ?? 0;
  if (used >= FOCUS_RELOADS_PER_TURN) {
    return {
      status: 'gated',
      reason: `you have used all ${FOCUS_RELOADS_PER_TURN} Focus reloads this turn`,
      rules_section: 'focus-reload',
    };
  }
  return me.kind === 'tracked'
    ? { status: 'gated', reason: 'you have no Focus cards in your hand', rules_section: 'focus-reload' }
    : { status: 'gated', reason: 'your hand is empty', rules_section: 'focus-reload' };
}

export function describeFFMoveGates(state: SessionState<FFState>, playerId: string): MoveGateStatus[] {
  const gs = state.gameState;
  const me = gs.players[playerId];
  if (!me || gs.phase === 'game_over') return [];
  if (gs.activePlayerId !== playerId) {
    return MOVE_TYPES.map((move_type) => ({ move_type, status: 'routine', reason: 'it is not your turn' }));
  }
  const offered = new Set(getLegalMoves(gs, playerId).map((lm) => lm.move.type));
  const reasons: Record<FFMove['type'], () => Reason> = {
    play_card: () => playReason(gs, me),
    buy_card: () => buyReason(gs, me),
    refine_card: () => refineOnlyReason(me),
    skip_refine: () => refineOnlyReason(me),
    advance_phase: () => advanceReason(gs, me),
    end_turn: () => refineBlock(me) ?? { status: 'routine', reason: 'not available right now' },
    focus_reload: () => reloadReason(gs, playerId, me),
  };
  return MOVE_TYPES.map((move_type) => {
    if (offered.has(move_type)) return { move_type, status: 'available' };
    const r = reasons[move_type]();
    return {
      move_type,
      status: r.status,
      reason: r.reason,
      ...(r.rules_section !== undefined ? { rules_section: r.rules_section } : {}),
    };
  });
}
