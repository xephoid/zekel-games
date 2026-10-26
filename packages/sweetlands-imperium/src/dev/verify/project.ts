// Glue: Sweetlands engine state/moves -> its common comparison shape. Allowed
// to know the engine's types (unlike rule content, which cites the pinned
// rules freeze); keep it a dumb field-by-field copy with no interpretation.

import type {
  SweetlandsMove,
  SweetlandsState,
  UnitLocation,
} from '../../types.js';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';

export interface SweetlandsVerifyPlayer {
  playerId: string;
  faction: string;
  isNomads: boolean;
  homeRegion: number | null;
  influence: number;
  sugar: number;
  points: number;
  handCount: number;
  /** Owned token colors, sorted. */
  tokens: string[];
  /** Public objective ids scored, sorted. */
  publicScored: string[];
  secretScoredCount: number;
  /** Stable location keys per unit, e.g. "ring:2:7", "start:1", "castle". */
  units: Record<'leader' | 'knight' | 'ambassador', string>;
}

export interface SweetlandsVerifyState {
  phase: string;
  round: number;
  pendingKind: string | null;
  activePlayerId: string;
  /** The active player's turn step ('recall' | 'play' | 'influence'). */
  activeStep: string;
  taxes: Record<number, number>;
  deckCount: number;
  discardCount: number;
  foeType: string | null;
  foeDefeated: boolean;
  castleOccupantId: string | null;
  /** In session player order (stable). */
  players: SweetlandsVerifyPlayer[];
  winners: string[];
}

export function locationKey(loc: UnitLocation): string {
  switch (loc.zone) {
    case 'offboard':
      return 'offboard';
    case 'start':
      return `start:${loc.region}`;
    case 'ring':
      return `ring:${loc.region}:${loc.ringIndex}`;
    case 'road':
      return `road:${loc.region}:${loc.roadIndex}`;
    case 'treat':
      return `treat:${loc.region}:${loc.slotKind}`;
    case 'castle':
      return 'castle';
  }
}

export function projectSweetlands(state: SweetlandsState): SweetlandsVerifyState {
  const active = state.players[state.currentPlayerIndex];
  const gameOver = state.phase === 'game_over';
  const winners = gameOver
    ? state.players.filter((p) => p.points >= 5).map((p) => p.playerId).sort()
    : [];
  return {
    phase: state.phase,
    round: state.round,
    pendingKind: state.pending?.kind ?? null,
    activePlayerId: state.activePlayerId,
    activeStep: active?.turn.step ?? 'recall',
    taxes: { ...state.taxes },
    deckCount: state.intelDeck.length,
    discardCount: state.intelDiscard.length,
    foeType: state.foe?.type ?? null,
    foeDefeated: state.foe?.defeated ?? false,
    castleOccupantId: state.castleOccupantId,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      faction: p.faction,
      isNomads: p.faction === 'nomads',
      homeRegion: p.homeRegion,
      influence: p.influence,
      sugar: p.sugarCubes,
      points: p.points,
      handCount: p.hand.length,
      tokens: Object.keys(p.intelTokens).sort(),
      publicScored: [...p.publicObjectivesScored].sort(),
      secretScoredCount: (p.secretObjectivesScored ?? []).length,
      units: {
        leader: locationKey(p.units.leader),
        knight: locationKey(p.units.knight),
        ambassador: locationKey(p.units.ambassador),
      },
    })),
    winners,
  };
}

export function toEvent(
  _state: SweetlandsState,
  playerId: string,
  move: SweetlandsMove,
  moveIndex: number,
): VerifyEvent {
  return {
    moveIndex,
    actor: playerId,
    moveType: move.type,
    move: move as unknown as Record<string, unknown>,
  };
}
