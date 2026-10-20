// Every move the game accepts (PORT-PLAN §4–§9). `type` is the discriminant
// the moveSchema and get_legal_moves use.

import type { StatId } from '../data/progression.js';
import type { ResourceType } from '../data/resources.js';

export type DemonHunterMove =
  // --- outdoors ---
  | { type: 'look' }
  | { type: 'move'; to: string }
  | { type: 'enter' }
  | { type: 'leave' }
  | { type: 'attack'; target: string }
  | { type: 'bomb'; target?: string }
  | { type: 'talk_bandit' }
  | { type: 'buy_from_bandit'; item: 'bomb' | 'lockpick' }
  | { type: 'fly' }
  | { type: 'land' }
  | { type: 'aura' }
  | { type: 'teleport'; town: string }
  // --- combat ---
  | { type: 'fight' }
  | { type: 'flee' }
  // --- any time ---
  | { type: 'level_up'; stat: StatId }
  | { type: 'mark_suspect'; person: string }
  | { type: 'unmark_suspect'; person: string }
  | { type: 'accuse'; person: string }
  | { type: 'continue' }
  // --- town ---
  | { type: 'talk'; person: string }
  | { type: 'found_you' }
  | { type: 'accept_task' }
  | { type: 'decline' }
  | { type: 'claim_reward'; reward: 'clue' | 'power' }
  | { type: 'goodbye' }
  | { type: 'inn' }
  | { type: 'sleep' }
  | { type: 'train' }
  | { type: 'ride'; town: string }
  | { type: 'buy'; resource: ResourceType }
  | { type: 'sell'; resource: ResourceType }
  | { type: 'leave_inn' }
  | { type: 'search_house'; person: string; confirm?: boolean }
  // --- temple ---
  | { type: 'gauntlet' }
  | { type: 'next_fight' }
  | { type: 'riddle' }
  | { type: 'answer_riddle'; text: string };

export type MoveType = DemonHunterMove['type'];

export const MOVE_TYPES: readonly MoveType[] = [
  'look', 'move', 'enter', 'leave', 'attack', 'bomb', 'talk_bandit', 'buy_from_bandit', 'fly', 'land', 'aura', 'teleport',
  'fight', 'flee', 'level_up', 'mark_suspect', 'unmark_suspect', 'accuse', 'continue',
  'talk', 'found_you', 'accept_task', 'decline', 'claim_reward', 'goodbye',
  'inn', 'sleep', 'train', 'ride', 'buy', 'sell', 'leave_inn', 'search_house',
  'gauntlet', 'next_fight', 'riddle', 'answer_riddle',
];
