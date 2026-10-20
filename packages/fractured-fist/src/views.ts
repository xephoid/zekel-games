import type { FFState, OpaquePlayerState, PlayerState, TrackedPlayerState } from './types.js';

function isTracked(p: PlayerState): p is TrackedPlayerState {
  return p.kind === 'tracked';
}

interface CommonPublicFields {
  kind: 'tracked' | 'opaque';
  stamina: number;
  max_stamina: number;
  deck_size: number;
  hand_size: number;
  discard_size: number;
  /** Face-up discard contents for a TRACKED player (ruling 2026-08-05: physical
   *  FF discards are face-up, so contents are public). Absent for opaque players
   *  — the server never tracked theirs. */
  discard?: string[];
  played: string[];
  damage_queued: number;
  defense_queued: number;
  actions: number;
  channels: number;
  spirit: number;
  refine_pending: number;
  misstep_count: number;
  /** Cards redrawn at cleanup — option-configurable per player, not a constant. */
  starting_hand_size: number;
  /** Focus reloads used this turn (legality-gating vs FOCUS_RELOADS_PER_TURN). */
  focus_reloads_this_turn: number;
  supply: Record<string, number>;
}

function commonPublic(p: PlayerState): CommonPublicFields {
  return {
    kind: p.kind,
    stamina: p.stamina,
    max_stamina: p.maxStamina,
    deck_size: p.deckSize,
    hand_size: p.handSize,
    discard_size: p.discardSize,
    ...(isTracked(p) ? { discard: [...p.discard] } : {}),
    played: [...p.played],
    damage_queued: p.damageQueued,
    defense_queued: p.defenseQueued,
    actions: p.actions,
    channels: p.channels,
    spirit: p.spirit,
    refine_pending: p.refinePending,
    misstep_count: p.misstepCount,
    starting_hand_size: p.startingHandSize,
    focus_reloads_this_turn: p.focusReloadsThisTurn ?? 0,
    supply: { ...p.supply },
  };
}

function trackedPrivate(p: TrackedPlayerState) {
  const deckCounts: Record<string, number> = {};
  for (const id of p.deck) deckCounts[id] = (deckCounts[id] ?? 0) + 1;
  return {
    ...commonPublic(p),
    hand: [...p.hand],
    discard: [...p.discard],
    deck_count_by_card: deckCounts,
  };
}

function opaquePrivate(p: OpaquePlayerState) {
  return {
    ...commonPublic(p),
    note:
      'This player is opaque: the server does not track hand/deck/discard contents. ' +
      'Card counts and misstep_count are derived from your declared actions; the server ' +
      'trusts you on what you have in hand and only validates that named cards belong to ' +
      'this game\'s card pool.',
  };
}

export function getPublicView(state: FFState): unknown {
  const players: Record<string, CommonPublicFields> = {};
  for (const pid of state.playerOrder) players[pid] = commonPublic(state.players[pid]!);
  return {
    phase: state.phase,
    round: state.round,
    active_player_id: state.activePlayerId,
    player_order: state.playerOrder,
    // Seats that already finished their turn this round (who is still owed one).
    players_done_this_round: [...state.playersDoneThisRound],
    players,
    winners: state.winners,
    scores: state.scores,
    result_summary: state.resultSummary,
  };
}

export function getPlayerView(state: FFState, playerId: string): unknown {
  const players: Record<string, unknown> = {};
  for (const pid of state.playerOrder) {
    const p = state.players[pid]!;
    if (pid === playerId) {
      players[pid] = isTracked(p) ? trackedPrivate(p) : opaquePrivate(p);
    } else {
      players[pid] = commonPublic(p);
    }
  }
  return {
    phase: state.phase,
    round: state.round,
    active_player_id: state.activePlayerId,
    player_order: state.playerOrder,
    // Seats that already finished their turn this round (who is still owed one).
    players_done_this_round: [...state.playersDoneThisRound],
    players,
    winners: state.winners,
    scores: state.scores,
    result_summary: state.resultSummary,
  };
}
