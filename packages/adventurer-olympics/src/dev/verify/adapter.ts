// Adventurer Olympics adapter for the verify driver.
//
// Sessions rotate through 2, 3 and 4 players and three kinds of table, so the
// random games reach the paths a real table uses, not only the all-AI ones:
//   - every seat an AI (the server deals every card from its own shuffle);
//   - seat "a" a PHYSICAL human (real cards: every draw, the AI's included, is
//     reported by that human — the random policy picks the reports from the
//     offered menu);
//   - seat "a" a DIGITAL human (server-dealt, reveal button for rolls).
// The driver plays every seat from the offered legal moves.
//
// The driver reads `session.gameState.activePlayerId`; AO keeps the seat that
// owes the next move in `pending.seat`, so the wrapped game copies it across
// after every create/apply (the Triple Triad adapter does the same).

import { adventurerOlympics as game } from '../../index.js';
import type { AOState } from '../../types.js';
import type { ApplyMoveResult, Game, PlayerConfig, SessionState } from '@zekel/game-kit';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import type { AOVerifyState } from './project.js';
import { projectAdventurerOlympics, toEvent } from './project.js';
import { ADVENTURER_OLYMPICS_ORACLE_RULES } from './rules.js';

function patch(gs: AOState): void {
  (gs as AOState & { activePlayerId: string }).activePlayerId = gs.pending?.seat ?? gs.activeSeat;
}

const NAMES = ['Alice', 'Bob', 'Chris', 'Dana'];

function createSession(seed: number): SessionState<AOState> {
  const count = 2 + (seed % 3);
  const table = Math.floor(seed / 3) % 3; // 0 all-AI, 1 physical human, 2 digital human
  const players: PlayerConfig[] = Array.from({ length: count }, (_, i) => {
    const id = String.fromCharCode(97 + i);
    if (i === 0 && table === 1) return { player_id: id, name: NAMES[i], kind: 'human', table: 'physical' } as PlayerConfig;
    if (i === 0 && table === 2) return { player_id: id, name: NAMES[i], kind: 'human', table: 'digital' } as PlayerConfig;
    return { player_id: id, name: NAMES[i], kind: 'ai' } as PlayerConfig;
  });
  const session = game.createSession(players, { seed });
  patch(session.gameState);
  return session;
}

const wrapped = Object.create(game) as Game<AOState, Record<string, unknown>, unknown>;
wrapped.applyMove = (state: SessionState<AOState>, playerId: string, move: Record<string, unknown>): ApplyMoveResult<AOState> => {
  const result = game.applyMove(state, playerId, move as never);
  patch(result.newState.gameState);
  return result;
};

const SENSORS: Record<string, (s: AOVerifyState) => number> = {
  round: (s) => s.round,
  tiles_placed: (s) => Object.keys(s.tiles).length,
  tiles_left: (s) => s.tileStack.length,
  icons_completed: (s) => s.icons.filter((i) => i.completed).length,
  icons_open: (s) => s.icons.filter((i) => !i.completed).length,
  little_deck: (s) => s.decks.little.length,
  big_deck: (s) => s.decks.big.length,
  companion_deck: (s) => s.decks.companion.length,
  artifacts_held: (s) => s.playerOrder.reduce((n, p) => n + s.players[p]!.artifacts.length, 0),
  ending_phase: (s) => s.endingPhase,
  a_companions: (s) => s.players.a?.companions.length ?? 0,
  a_steps_left: (s) => s.players.a?.stepsLeft ?? 0,
  quests_claimed: (s) => Object.values(s.inPlayQuests).filter((o) => o !== 'unclaimed').length,
  players: (s) => s.playerOrder.length,
  physical_table: (s) => (s.serverOwnsDecks ? 0 : 1),
};

const SENSOR_MAX: Record<string, number> = {
  round: 30, tiles_placed: 10, tiles_left: 9, icons_completed: 26, icons_open: 26,
  little_deck: 12, big_deck: 12, companion_deck: 16, artifacts_held: 5, ending_phase: 2,
  a_companions: 8, a_steps_left: 12, quests_claimed: 5, players: 4, physical_table: 1,
};

const MOVE_TYPES = [
  'setup_standee', 'setup_report', 'report_turn_order_roll', 'step', 'stop', 'try_again', 'move_away',
  'explore', 'report_test_roll', 'report_card', 'resolve_report', 'take_artifact', 'decline_artifact',
] as const;

export const adventurerOlympicsVerifyAdapter: VerifyAdapter<AOState, AOVerifyState> = {
  gameId: 'adventurer-olympics',
  game: wrapped as unknown as Game<AOState, unknown, unknown>,
  createSession,
  project: projectAdventurerOlympics,
  toEvent: (gs, playerId, move, moveIndex) => toEvent(gs, playerId, move as Record<string, unknown>, moveIndex),
  annotate: () => {},
  rules: ADVENTURER_OLYMPICS_ORACLE_RULES,
  sensors: SENSORS,
  sensorMax: SENSOR_MAX,
  moveTypes: MOVE_TYPES,
};
