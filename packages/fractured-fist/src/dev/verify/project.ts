// Glue: Fractured Fist engine state -> the comparison shape the rules check.
// This file may know the engine's types (rule content may not — it cites the
// rulebook); it is a field-by-field copy with no interpretation.
//
// The driver plays two kinds of session (adapter.ts): both seats tracked
// (server knows every card), or seat p1 a physical human (opaque — the server
// knows only counts). Card contents are null for an opaque seat, so rules
// that need contents check tracked seats only.

import type { FFMove, FFState } from '../../types.js';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';

export interface FFVerifyPlayer {
  kind: 'tracked' | 'opaque';
  stamina: number;
  maxStamina: number;
  actions: number;
  channels: number;
  spirit: number;
  refinePending: number;
  damageQueued: number;
  defenseQueued: number;
  deckSize: number;
  handSize: number;
  discardSize: number;
  playedSize: number;
  misstepCount: number;
  startingHandSize: number;
  focusReloads: number;
  supply: Record<string, number>;
  /** Sorted card ids; null for an opaque seat. */
  hand: string[] | null;
  deck: string[] | null;
  discard: string[] | null;
  played: string[];
}

export interface FFVerifyState {
  phase: string;
  round: number;
  activePlayerId: string;
  playerOrder: string[];
  playersDone: string[];
  players: Record<string, FFVerifyPlayer>;
  winners: string[] | null;
}

const sorted = (xs: string[]): string[] => [...xs].sort();

export function projectFracturedFist(gs: FFState): FFVerifyState {
  const players: Record<string, FFVerifyPlayer> = {};
  for (const pid of gs.playerOrder) {
    const p = gs.players[pid]!;
    const tracked = p.kind === 'tracked';
    players[pid] = {
      kind: p.kind,
      stamina: p.stamina,
      maxStamina: p.maxStamina,
      actions: p.actions,
      channels: p.channels,
      spirit: p.spirit,
      refinePending: p.refinePending,
      damageQueued: p.damageQueued,
      defenseQueued: p.defenseQueued,
      deckSize: p.deckSize,
      handSize: p.handSize,
      discardSize: p.discardSize,
      playedSize: p.played.length,
      misstepCount: p.misstepCount,
      startingHandSize: p.startingHandSize,
      focusReloads: p.focusReloadsThisTurn ?? 0,
      supply: { ...p.supply },
      hand: tracked ? sorted(p.hand) : null,
      deck: tracked ? sorted(p.deck) : null,
      discard: tracked ? sorted(p.discard) : null,
      played: sorted(p.played),
    };
  }
  return {
    phase: gs.phase,
    round: gs.round,
    activePlayerId: gs.activePlayerId,
    playerOrder: [...gs.playerOrder],
    playersDone: [...gs.playersDoneThisRound],
    players,
    winners: gs.winners ? [...gs.winners] : null,
  };
}

export function toEvent(_gs: FFState, playerId: string, move: FFMove, moveIndex: number): VerifyEvent {
  return {
    moveIndex,
    actor: playerId,
    moveType: move.type,
    move: move as unknown as Record<string, unknown>,
  };
}
