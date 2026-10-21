// Every move the game accepts (PORT-PLAN §4–§9). `type` is the discriminant
// the moveSchema and get_legal_moves use.

import type { StatId } from '../data/progression.js';
import type { ResourceType } from '../data/resources.js';

export type DemonHunterMove =
  // --- outdoors ---
  | { type: 'look' }
  | { type: 'move'; to: string }
  | {
      type: 'travel';
      /** A place by name or id. */
      to?: string;
      /** A person: their town. */
      person?: string;
      /** The nearest town (every town has an inn). */
      nearest?: 'inn' | 'town';
      via_inn?: boolean;
    }
  | { type: 'enter' }
  | { type: 'leave' }
  | { type: 'attack'; target: string }
  | { type: 'bomb' }
  | { type: 'talk_bandit' }
  | { type: 'buy_from_bandit'; item: 'bomb' | 'lockpick'; amount?: number | 'all' }
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
  | { type: 'stab'; person: string }
  | { type: 'continue' }
  // --- town ---
  | {
      type: 'search_town';
      pet?: string;
      color?: string;
      occupation?: string;
      item?: string;
      /** A task by what it asks for: a monster ("slimes"), "escort", "find", or a word of its description. */
      task?: string;
      /** Who here says they know the truth. */
      truth?: boolean;
      /** Which known rumours contradict a secret you hold (uses your clue book; works anywhere). */
      contradictions?: boolean;
    }
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
  /** Any amount the stock and your purse allow (default 1; 'all' = as many as you can). */
  | { type: 'buy'; resource: ResourceType; amount?: number | 'all' }
  /** Any amount you hold (default 1; 'all' = everything of it). */
  | { type: 'sell'; resource: ResourceType; amount?: number | 'all' }
  | { type: 'leave_inn' }
  | { type: 'search_house'; person: string; confirm?: boolean }
  // --- temple ---
  | { type: 'gauntlet' }
  | { type: 'next_fight' }
  | { type: 'riddle' }
  | { type: 'answer_riddle'; text: string };

export type MoveType = DemonHunterMove['type'];

export const MOVE_TYPES: readonly MoveType[] = [
  'look', 'move', 'travel', 'enter', 'leave', 'attack', 'bomb', 'talk_bandit', 'buy_from_bandit', 'fly', 'land', 'aura', 'teleport',
  'fight', 'flee', 'level_up', 'mark_suspect', 'unmark_suspect', 'stab', 'continue',
  'search_town', 'talk', 'found_you', 'accept_task', 'decline', 'claim_reward', 'goodbye',
  'inn', 'sleep', 'train', 'ride', 'buy', 'sell', 'leave_inn', 'search_house',
  'gauntlet', 'next_fight', 'riddle', 'answer_riddle',
];
