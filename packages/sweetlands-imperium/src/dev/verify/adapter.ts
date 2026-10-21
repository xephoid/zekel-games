// Sweetlands Imperium adapters for the verify driver. All seats AI (tracked),
// so setup auto-runs and every zone is server-known. Two registry entries:
// the 4-player base game and the 5-player game (which adds the region-less
// Nomads — their off-board/entry corners are worth hunting separately).

import { sweetlandsImperium as game } from '../../index.js';
import type { SweetlandsMove, SweetlandsState } from '../../types.js';
import type { Game, SessionState } from '@zekel/game-kit';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import type { SweetlandsVerifyState } from './project.js';
import { projectSweetlands, toEvent } from './project.js';
import { SWEETLANDS_ORACLE_RULES } from './rules.js';

function createSessionFor(playerCount: number) {
  return (seed: number): SessionState<SweetlandsState> =>
    game.createSession(
      Array.from({ length: playerCount }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'ai' as const })),
      { seed },
    );
}

const SENSORS: Record<string, (s: SweetlandsVerifyState) => number> = {
  round: (s) => s.round,
  player_count: (s) => s.players.length,
  deck_count: (s) => s.deckCount,
  discard_count: (s) => s.discardCount,
  foe_defeated: (s) => (s.foeDefeated ? 1 : 0),
  castle_occupied: (s) => (s.castleOccupantId !== null ? 1 : 0),
  total_sugar_in_play: (s) => s.players.reduce((n, p) => n + p.sugar, 0),
  max_taxes: (s) => Math.max(...Object.values(s.taxes)),
  active_step_is_play: (s) => (s.activeStep === 'play' ? 1 : 0),
  active_influence: (s) => activeOf(s)?.influence ?? 0,
  active_sugar: (s) => activeOf(s)?.sugar ?? 0,
  active_points: (s) => activeOf(s)?.points ?? 0,
  active_hand_count: (s) => activeOf(s)?.handCount ?? 0,
  active_token_count: (s) => activeOf(s)?.tokens.length ?? 0,
  active_public_scored: (s) => activeOf(s)?.publicScored.length ?? 0,
  active_units_offboard: (s) => unitCount(s, (loc) => loc === 'offboard'),
  active_units_on_road: (s) => unitCount(s, (loc) => loc.startsWith('road:')),
  active_units_on_treats: (s) => unitCount(s, (loc) => loc.startsWith('treat:')),
  active_units_at_home: (s) => unitCount(s, (loc) => loc.startsWith('start:')),
  active_leader_in_castle: (s) => (activeOf(s)?.units.leader === 'castle' ? 1 : 0),
  best_opponent_points: (s) =>
    Math.max(0, ...s.players.filter((p) => p.playerId !== s.activePlayerId).map((p) => p.points)),
};

function activeOf(s: SweetlandsVerifyState) {
  return s.players.find((p) => p.playerId === s.activePlayerId);
}

function unitCount(s: SweetlandsVerifyState, test: (loc: string) => boolean): number {
  const p = activeOf(s);
  if (!p) return 0;
  return Object.values(p.units).filter(test).length;
}

const SENSOR_MAX: Record<string, number> = {
  round: 15,
  player_count: 5,
  deck_count: 80,
  discard_count: 40,
  foe_defeated: 1,
  castle_occupied: 1,
  total_sugar_in_play: 30,
  max_taxes: 3,
  active_step_is_play: 1,
  active_influence: 5,
  active_sugar: 10,
  active_points: 5,
  active_hand_count: 15,
  active_token_count: 6,
  active_public_scored: 5,
  active_units_offboard: 3,
  active_units_on_road: 3,
  active_units_on_treats: 3,
  active_units_at_home: 3,
  active_leader_in_castle: 1,
  best_opponent_points: 5,
};

const MOVE_TYPES = [
  'recall',
  'pass',
  'play_intel',
  'play_token',
  'discard_for_color',
  'discard_sugar',
  'trash_influence',
  'buy_intel_token',
  'buy_sugar_cube',
  'trade',
  'end_turn',
] as const;

function makeAdapter(gameId: string, playerCount: number): VerifyAdapter<SweetlandsState, SweetlandsVerifyState> {
  return {
    gameId,
    game: game as unknown as Game<SweetlandsState, unknown, unknown>,
    createSession: createSessionFor(playerCount),
    project: projectSweetlands,
    toEvent: (gs, playerId, move, moveIndex) => toEvent(gs, playerId, move as SweetlandsMove, moveIndex),
    annotate: () => {},
    rules: SWEETLANDS_ORACLE_RULES,
    sensors: SENSORS,
    sensorMax: SENSOR_MAX,
    moveTypes: MOVE_TYPES,
  };
}

export const sweetlandsVerifyAdapter = makeAdapter('sweetlands-imperium', 4);
export const sweetlands5pVerifyAdapter = makeAdapter('sweetlands-imperium-5p', 5);
