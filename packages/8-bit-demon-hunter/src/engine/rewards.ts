// Magic items from temple chests, and the find-item task they complete.

import { MAGIC_ITEMS, type TempleType } from '../data/magicItems.js';
import type { DemonHunterState } from '../types.js';
import { activeTask } from './helpers.js';

export function grantMagicItem(state: DemonHunterState, temple: TempleType, lines: string[]): void {
  const item = MAGIC_ITEMS[temple];
  if (!state.player.magicItems.includes(temple)) state.player.magicItems.push(temple);
  lines.push(`You take the ${item.name}! ${item.description}`);
  const task = activeTask(state);
  if (task && !task.isCompleted && task.type === 'FIND_ITEM' && task.targetId === temple) {
    task.currentAmount = task.amount;
    task.isCompleted = true;
    lines.push(`Task complete: ${task.description}. Return to the person who asked.`);
  }
}
