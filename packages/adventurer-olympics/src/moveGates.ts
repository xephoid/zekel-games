// Adventurer Olympics — move gates (docs/rules-teaching.md). The live status of
// every move TYPE for the active seat, rendered against live state so the
// "why" never drifts from the engine. Must agree with getLegalMoves (available
// ⇔ ≥1 legal instance); lock per game with core/moveGates.ts checkGateConsistency.
import type { MoveGateStatus } from '@zekel/game-kit';
import type { AOState } from './types.js';
import { getLegalMoves } from './legalMoves.js';
import { explorableSlots } from './engine.js';

export function aomoveGates(state: AOState, playerId: string): MoveGateStatus[] {
  const kind = state.pending?.kind;
  const payload = state.pending?.payload ?? {};
  const seats = state.pending?.seat === playerId;
  const hasLegal = (type: string) =>
    getLegalMoves(state, playerId).some((m) => m.move.type === type);

  const gates: MoveGateStatus[] = [];
  const push = (
    move_type: string,
    status: MoveGateStatus['status'],
    reason?: string,
    rules_section?: string,
  ) => gates.push({ move_type, status, reason, rules_section });

  if (!seats) {
    for (const t of ['step', 'stop', 'explore', 'try_again', 'report_test_roll', 'report_card', 'take_artifact']) {
      push(t, 'routine', 'not your turn', undefined);
    }
    return gates;
  }

  switch (kind) {
    case 'setup_standee_colour':
      push('setup_standee', 'available', undefined, 'ao-setup');
      break;

    case 'roll':
      if (hasLegal('resolve_report')) {
        push('resolve_report', 'available', undefined, payload.rollKind === 'turn_order' ? 'ao-round-order' : 'ao-rolling');
      } else if (payload.rollKind === 'turn_order') {
        push('report_turn_order_roll', 'available', undefined, 'ao-round-order');
      } else {
        push('report_test_roll', 'available', undefined, 'ao-rolling');
      }
      break;

    case 'report_card':
      push('report_card', 'available', undefined, 'ao-icons');
      break;

    case 'draw':
      push('resolve_report', 'available', undefined, payload.deck === 'tile' ? 'ao-explore' : 'ao-icons');
      break;

    case 'move': {
      push('step', hasLegal('step') ? 'available' : 'gated', hasLegal('step') ? undefined : 'no adjacent open hex', 'ao-moving');
      push('stop', 'available', undefined, 'ao-moving');
      push('explore', hasLegal('explore') ? 'available' : 'gated', hasLegal('explore') ? undefined : exploreBlockedReason(state, playerId), 'ao-explore');
      break;
    }

    case 'try_again':
      push('try_again', 'available', undefined, 'ao-try-again');
      push('stop', 'available', undefined, 'ao-try-again');
      push('move_away', hasLegal('move_away') ? 'available' : 'gated', hasLegal('move_away') ? undefined : 'no open adjacent hex', 'ao-try-again');
      push('step', 'gated', 'you are on an uncompleted icon — stay and try again, walk away, or explore', 'ao-try-again');
      push('explore', hasLegal('explore') ? 'available' : 'gated', hasLegal('explore') ? undefined : exploreBlockedReason(state, playerId), 'ao-explore');
      break;

    case 'explore_place': {
      const context = payload.context as string;
      const section = context === 'forced' ? 'ao-forced-explore' : context === 'dungeon_map' ? 'ao-dungeon' : 'ao-explore';
      push('explore', hasLegal('explore') ? 'available' : 'gated', hasLegal('explore') ? undefined : 'no empty slot touching the map', section);
      if (context === 'forced') {
        push('step', 'gated', 'you must place the revealed tile first (every icon is completed)', 'ao-forced-explore');
      }
      break;
    }

    case 'take_artifact':
      push('take_artifact', hasLegal('take_artifact') ? 'available' : 'gated', hasLegal('take_artifact') ? undefined : 'no suit artifact available from the supply or another player', 'ao-artifacts');
      push('decline_artifact', 'available', undefined, 'ao-dungeon-draw-again');
      break;

    default:
      break;
  }

  return gates;
}

/** Why the seat cannot explore right now, in the order a player would check
 *  (RULES.md §5.3: a step left, and an outer hex touching an empty slot). */
function exploreBlockedReason(state: AOState, playerId: string): string {
  const me = state.players[playerId] as { stepsLeft: number; hexKey: string };
  if (state.tileStack.length === 0) return 'no tiles left in the stack';
  if (me.stepsLeft < 1) return 'no steps left';
  if (state.placedTiles.some((t) => t.center.key === me.hexKey)) return 'you are on a centre hex, and a centre hex touches no slot';
  if (explorableSlots(state, playerId).length === 0) return 'both slots next to your hex are already taken';
  return 'you cannot explore now';
}