// Cybernoir 2127 adapter for the verify driver: session creation (two tracked
// seats, seeded, fixed overclock timing so rules can predict draws), the
// projection, and the id-delta annotations the jail rules consume.

import { cybernoir2127 as game } from '../../index.js';
import type { CNMove, CNState } from '../../types.js';
import type { Game, SessionState } from '@zekel/game-kit';
import type { VerifyAdapter } from '@zekel/dev/verify/exec/driver';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';
import type { CybernoirVerifyState } from './project.js';
import { projectCybernoir, toEvent } from './project.js';
import { CYBERNOIR_ORACLE_RULES } from './rules.js';

/** The hunter's numeric sensors — exactly the comparison shape's facts, so a
 * strategy can steer toward anything the differ can see. */
const SENSORS: Record<string, (s: CybernoirVerifyState) => number> = {
  turn: (s) => s.turn,
  detective_ap: (s) => s.detective.ap,
  hacker_ap: (s) => s.hacker.ap,
  jail_total: (s) => s.detective.jail.flat().length,
  jail_slot1_count: (s) => s.detective.jail[0].length,
  jail_slot2_count: (s) => s.detective.jail[1].length,
  jail_slot3_count: (s) => s.detective.jail[2].length,
  informants_facedown: (s) => s.detective.informantsFacedown.length,
  informants_revealed: (s) => s.detective.informantsRevealed.length,
  board_count: (s) => s.detective.board.length,
  location_deck_count: (s) => s.detective.locationDeckCount,
  location_hand_count: (s) => s.detective.locationHand.length,
  poi_deck_count: (s) => s.detective.poiDeck.length,
  hacker_hand_count: (s) => s.hacker.hand.length,
  contacts_deck_count: (s) => s.hacker.contactsDeckCount,
  contacts_discard_count: (s) => s.hacker.contactsDiscard.length,
  evidence_count: (s) =>
    (s.hacker.evidenceWeapon ? 1 : 0) +
    s.hacker.evidenceWitnesses.length +
    s.hacker.evidenceMotiveSets.reduce((n, set) => n + set.length, 0),
  truthful_clues_given: (s) => s.hacker.truthfulCluesGiven.length,
  negative_clue_count: (s) => s.hacker.negativeClueCount,
};

const SENSOR_MAX: Record<string, number> = {
  turn: 20,
  detective_ap: 4,
  hacker_ap: 4,
  jail_total: 6,
  jail_slot1_count: 4,
  jail_slot2_count: 4,
  jail_slot3_count: 4,
  informants_facedown: 5,
  informants_revealed: 4,
  board_count: 12,
  location_deck_count: 18,
  location_hand_count: 8,
  poi_deck_count: 24,
  hacker_hand_count: 10,
  contacts_deck_count: 25,
  contacts_discard_count: 15,
  evidence_count: 13,
  truthful_clues_given: 3,
  negative_clue_count: 6,
};

const MOVE_TYPES = [
  'play_location',
  'upkeep_choice',
  'arrest',
  'recruit_informant',
  'draw_extra_location',
  'guess_location',
  'buy_clue',
  'draw_contact',
  'play_person',
  'play_evidence',
  'win_back',
  'jailbreak',
  'overclock',
  'burn_safehouse',
  'clue_reveal',
  'block_decide',
  'final_guess',
  'pass_turn',
] as const;

function createSession(seed: number): SessionState<CNState> {
  return game.createSession(
    [
      { player_id: 'detective', kind: 'ai' },
      { player_id: 'hacker', kind: 'ai' },
    ],
    { seed, overclock_draw_timing: 'immediate' },
  );
}

function annotate(event: VerifyEvent, prev: CNState, next: CNState): void {
  if (event.moveType === 'arrest') {
    event.nextPoiDeck = [...next.detective.poi_deck];
  }
  if (event.moveType === 'jailbreak') {
    const nextJailed = new Set(next.detective.jail.flat());
    event.freedIds = prev.detective.jail.flat().filter((id) => !nextJailed.has(id));
  }
}

export const cybernoirVerifyAdapter: VerifyAdapter<CNState, CybernoirVerifyState> = {
  gameId: 'cybernoir-2127',
  game: game as unknown as Game<CNState, unknown, unknown>,
  createSession,
  project: projectCybernoir,
  toEvent: (gs, playerId, move, moveIndex) => toEvent(gs, playerId, move as CNMove, moveIndex),
  annotate,
  rules: CYBERNOIR_ORACLE_RULES,
  sensors: SENSORS,
  sensorMax: SENSOR_MAX,
  moveTypes: MOVE_TYPES,
};
