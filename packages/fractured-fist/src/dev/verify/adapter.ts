// Fractured Fist adapter for the verify driver. Even seeds play two
// server-tracked seats (every card known, so the content rules run); odd seeds
// make p1 a physical human (opaque — counts only), so the count rules also
// cover the seat the server cannot see into. Both seats are driven by the
// driver's policy through getLegalMoves, which is what a human is offered.

import { fracturedFist as game } from '../../index.js';
import type { FFMove, FFState } from '../../types.js';
import type { Game, SessionState } from '@zekel/game-kit';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import type { FFVerifyState } from './project.js';
import { projectFracturedFist, toEvent } from './project.js';
import { FRACTURED_FIST_ORACLE_RULES } from './rules.js';

const SENSORS: Record<string, (s: FFVerifyState) => number> = {
  round: (s) => s.round,
  p1_stamina: (s) => s.players.p1?.stamina ?? 0,
  p2_stamina: (s) => s.players.p2?.stamina ?? 0,
  stamina_gap: (s) => Math.abs((s.players.p1?.stamina ?? 0) - (s.players.p2?.stamina ?? 0)),
  active_actions: (s) => s.players[s.activePlayerId]?.actions ?? 0,
  active_channels: (s) => s.players[s.activePlayerId]?.channels ?? 0,
  active_spirit: (s) => s.players[s.activePlayerId]?.spirit ?? 0,
  active_hand: (s) => s.players[s.activePlayerId]?.handSize ?? 0,
  active_deck: (s) => s.players[s.activePlayerId]?.deckSize ?? 0,
  active_discard: (s) => s.players[s.activePlayerId]?.discardSize ?? 0,
  active_missteps: (s) => s.players[s.activePlayerId]?.misstepCount ?? 0,
  active_refines: (s) => s.players[s.activePlayerId]?.refinePending ?? 0,
  active_reloads: (s) => s.players[s.activePlayerId]?.focusReloads ?? 0,
  active_damage: (s) => s.players[s.activePlayerId]?.damageQueued ?? 0,
  active_defense: (s) => s.players[s.activePlayerId]?.defenseQueued ?? 0,
  in_channel: (s) => (s.phase === 'channel' ? 1 : 0),
};

const SENSOR_MAX: Record<string, number> = {
  round: 60,
  p1_stamina: 7,
  p2_stamina: 7,
  stamina_gap: 7,
  active_actions: 10,
  active_channels: 5,
  active_spirit: 20,
  active_hand: 15,
  active_deck: 30,
  active_discard: 30,
  active_missteps: 10,
  active_refines: 4,
  active_reloads: 3,
  active_damage: 10,
  active_defense: 10,
  in_channel: 1,
};

const MOVE_TYPES = [
  'play_card',
  'buy_card',
  'refine_card',
  'skip_refine',
  'advance_phase',
  'end_turn',
  'focus_reload',
] as const;

function createSession(seed: number): SessionState<FFState> {
  const physicalHuman = seed % 2 === 1;
  return game.createSession(
    [
      physicalHuman ? { player_id: 'p1', kind: 'human' } : { player_id: 'p1', kind: 'ai' },
      { player_id: 'p2', kind: 'ai' },
    ],
    { seed },
  );
}

export const fracturedFistVerifyAdapter: VerifyAdapter<FFState, FFVerifyState> = {
  gameId: 'fractured-fist',
  game: game as unknown as Game<FFState, unknown, unknown>,
  createSession,
  project: projectFracturedFist,
  toEvent: (gs, playerId, move, moveIndex) => toEvent(gs, playerId, move as FFMove, moveIndex),
  annotate: () => {},
  rules: FRACTURED_FIST_ORACLE_RULES,
  sensors: SENSORS,
  sensorMax: SENSOR_MAX,
  moveTypes: MOVE_TYPES,
};
