// Shared fixtures for the candy screen's tests: a round-4 view in the
// engine's shape, the reference data, and the props the table would pass.

import { vi } from 'vitest';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { GameScreenProps, GlueInput, LegalMove } from '@zekel/glue-kit';

const loc = {
  start: (region: number) => ({ zone: 'start', region }),
  ring: (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex }),
};

export const SL_SCREEN_VIEW = {
  game_id: 'sweetlands-imperium', phase: 'play', round: 4, active_player_id: 'p1', first_player_id: 'p1',
  taxes: { '1': 0, '2': 2, '3': 1, '4': 0 }, foe: { type: 'orc', defeated: false }, castle_occupant_id: null,
  intel_deck_count: 52, intel_discard_count: 13,
  random_treat_placement: { '1': 'cupcake', '2': 'gummy_bear', '3': 'ice_cream', '4': 'chocolate_bar' },
  players: [
    { player_id: 'p1', kind: 'human', faction: 'milkshake', faction_name: 'Arch Duchess of Milkshake', home_region: 1, points: 2, influence: 3, sugar_cubes: 4, intel_tokens: ['blue'], hand_count: 4,
      unit_locations: { leader: loc.ring(1, 2), knight: loc.ring(2, 3), ambassador: loc.ring(4, 1) } },
    { player_id: 'p2', kind: 'ai', faction: 'fudge', faction_name: 'General Fudge', home_region: 2, points: 5, influence: 4, sugar_cubes: 3, intel_tokens: [], hand_count: 1,
      unit_locations: { leader: loc.ring(2, 1), knight: loc.ring(2, 6), ambassador: loc.start(2) } },
  ],
  your_hand: [
    { card_id: 'c1', kind: 'single', color: 'red' },
    { card_id: 'c2', kind: 'double', color: 'blue' },
    { card_id: 'c3', kind: 'treat', treat: 'gummy_bear' },
    { card_id: 'c4', kind: 'single', color: 'green' },
  ],
  your_secret_objectives: ['defeat_knight'], your_turn_step: 'play',
};

export function slReference(extra: Record<string, unknown> = {}): GameReferenceResponse {
  return {
    gameId: 'sweetlands-imperium', rules: '', moveSchema: {}, optionsSchema: {},
    referenceData: { points_to_win: 5, foes: [{ type: 'dragon', dice: 5 }, { type: 'orc', dice: 3 }, { type: 'fiend', dice: 2 }], ...extra },
  } as GameReferenceResponse;
}

export function slProps(over: { view?: unknown; legalMoves?: LegalMove[]; reference?: GameReferenceResponse | null; playerId?: string | null } = {}, props: Partial<GameScreenProps> = {}): GameScreenProps {
  const input: GlueInput = {
    view: over.view ?? SL_SCREEN_VIEW, previous: null, legalMoves: over.legalMoves ?? [], unavailable: [],
    playerId: over.playerId === undefined ? 'p1' : over.playerId, reference: over.reference === undefined ? slReference() : over.reference,
    seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(),
  } as GlueInput;
  return {
    input, yourTurn: true, busy: false, interactive: true,
    onMove: vi.fn(), onForm: vi.fn(), nameFor: (pid: string) => (pid === 'p2' ? 'AI (easy)' : 'Guest'),
    ...props,
  };
}
