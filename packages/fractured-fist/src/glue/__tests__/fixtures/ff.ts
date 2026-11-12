// A Fractured Fist seat view, its legal moves and the engine's reference data,
// for the glue and screen tests.

import type { GameReferenceResponse } from '@zekel/wire-types';

// zekel/src/games/fractured-fist/views.ts getPlayerView for a TRACKED seat.
export const FF_VIEW = {
  phase: 'technique',
  round: 2,
  active_player_id: 'p1',
  player_order: ['p1', 'p2'],
  players_done_this_round: [],
  players: {
    p1: {
      kind: 'tracked', stamina: 6, max_stamina: 7, deck_size: 8, hand_size: 5,
      discard_size: 2, discard: ['misstep', 'focus'], played: ['attack'],
      damage_queued: 1, defense_queued: 0, actions: 1, channels: 1, spirit: 0,
      refine_pending: 0, misstep_count: 3, starting_hand_size: 5,
      focus_reloads_this_turn: 0, supply: { attack: 4, focus: 20, momentum: 19 },
      hand: ['focus', 'misstep', 'quicken', 'center', 'focus'],
      deck_count_by_card: { focus: 5, misstep: 1, attack: 2 },
    },
    p2: {
      kind: 'tracked', stamina: 7, max_stamina: 7, deck_size: 9, hand_size: 5,
      discard_size: 1, discard: ['block'], played: [], damage_queued: 0,
      defense_queued: 1, actions: 1, channels: 1, spirit: 2, refine_pending: 0,
      misstep_count: 3, starting_hand_size: 5, focus_reloads_this_turn: 0,
      supply: { attack: 5 },
    },
  },
  winners: [], scores: {}, result_summary: null,
};

export const FF_MOVES = [
  { move_id: 'play-2-quicken', description: 'Play Quicken from your hand', move: { type: 'play_card', card_id: 'quicken', hand_index: 2 } },
  { move_id: 'buy-attack', description: 'Buy Attack', move: { type: 'buy_card', card_id: 'attack' } },
  { move_id: 'advance-phase', description: 'Advance to Channel phase', move: { type: 'advance_phase' } },
];

export const FF_REFERENCE: GameReferenceResponse = {
  gameId: 'fractured-fist',
  rules: 'rules',
  referenceData: {
    cards: [
      { id: 'focus', name: 'Focus', type: 'RESOURCE', cost: 0, value: 1, description: '1 Spirit.' },
      { id: 'misstep', name: 'Misstep', type: 'MISSTEP', cost: 0, description: 'Cannot be played.' },
      { id: 'quicken', name: 'Quicken', type: 'TECHNIQUE', cost: 2, description: '+2 Draw.', effects: { draw: 2 } },
      { id: 'center', name: 'Center', type: 'TECHNIQUE', cost: 2, description: '+2 Spirit.', effects: { spirit: 2 } },
      { id: 'attack', name: 'Attack', type: 'TECHNIQUE', cost: 4, description: '+1 Damage.', effects: { damage: 1 } },
      { id: 'block', name: 'Block', type: 'TECHNIQUE', cost: 3, description: '+1 Defense.', effects: { defense: 1 } },
      { id: 'momentum', name: 'Momentum', type: 'RESOURCE', cost: 3, value: 2, description: '2 spirit.' },
      { id: 'grand-finale', name: 'Grand Finale', type: 'TECHNIQUE', cost: 10, description: '+5 Damage.', faction: 'Titan Entertainment', effects: { damage: 5 } },
    ],
    starter_loadout: ['attack', 'block', 'assess', 'center', 'distract', 'quicken', 'react'],
    max_missteps: 10,
  },
  moveSchema: {},
  optionsSchema: { type: 'object', properties: { loadout: { type: 'array', description: 'Seven techniques. ASK THE PLAYER.' } } },
};
