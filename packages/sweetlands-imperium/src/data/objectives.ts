// Sweetlands Imperium — objective definitions.
//
// Source: SWEETLANDS-RULES.md §6 (5 public, one-time scorable) and §7 (12 secret,
// 2 points each, scored immediately when completed). Win at 5 points.

import type { PublicObjectiveId, SecretObjectiveId } from '../types.js';

export interface PublicObjectiveDef {
  id: PublicObjectiveId;
  points: number;
  description: string;
}

export interface SecretObjectiveDef {
  id: SecretObjectiveId;
  points: number;
  description: string;
  /** True when completion cannot be derived purely from public state and the
   *  human must declare it (the server validates AI completion itself). */
  selfAttested: boolean;
}

export const POINTS_TO_WIN = 5;
/** The most influence a player may hold; any more gained is lost. */
export const INFLUENCE_CAP = 5;
export const SECRET_OBJECTIVE_POINTS = 2;

export const PUBLIC_OBJECTIVES: PublicObjectiveDef[] = [
  { id: 'units_all_matching_color', points: 3, description: 'Have a unit in each opposing region, all on matching-color spaces.' },
  { id: 'units_all_treats', points: 3, description: 'Have a unit in each opposing region, all on special-treat spaces.' },
  { id: 'defeat_foe', points: 3, description: 'Defeat the foe in the castle.' },
  { id: 'capture_leader', points: 1, description: 'Capture a leader.' },
  { id: 'leader_castle_uncontested', points: 1, description: 'Have a leader in the castle, uncontested for one full round (scores after your turn).' },
];

export const SECRET_OBJECTIVES: SecretObjectiveDef[] = [
  { id: 'defeat_knight', points: 2, description: 'Defeat a knight in battle.', selfAttested: false },
  { id: 'capture_leader', points: 2, description: 'Capture a leader (does not also score the public objective).', selfAttested: false },
  { id: 'capture_ambassador', points: 2, description: 'Capture an ambassador.', selfAttested: false },
  { id: 'raise_taxes_3', points: 2, description: 'Raise taxes to 3.', selfAttested: false },
  { id: 'spend_5_influence', points: 2, description: 'Spend 5 influence (without using it on its effect).', selfAttested: true },
  { id: 'discard_5_intel', points: 2, description: 'Discard 5 Intel.', selfAttested: false },
  { id: 'gain_5_intel_one_turn', points: 2, description: 'Gain 5 Intel in one turn.', selfAttested: false },
  { id: 'collect_taxes_from_opponent', points: 2, description: 'Collect taxes from an opponent.', selfAttested: false },
  { id: 'collect_5_influence_one_turn', points: 2, description: 'Collect 5 influence in one turn.', selfAttested: false },
  { id: 'unit_through_3_regions', points: 2, description: 'Move one unit through 3 regions in one turn.', selfAttested: false },
  { id: 'discard_5_sugar', points: 2, description: 'Discard 5 sugar cubes.', selfAttested: false },
  { id: 'enter_castle_with_leader', points: 2, description: 'Enter the castle with your leader.', selfAttested: false },
];
