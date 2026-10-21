// Magic items from temple chests, and the find-item tasks they complete.

import { MAGIC_ITEMS, type TempleType } from '../data/magicItems.js';
import type { DemonHunterState } from '../types.js';
import { activeTasks } from './helpers.js';

export function grantMagicItem(state: DemonHunterState, temple: TempleType, lines: string[]): void {
  const item = MAGIC_ITEMS[temple];
  if (!state.player.magicItems.includes(temple)) state.player.magicItems.push(temple);
  lines.push(`Inside lies the ${item.name}. ${item.description} You take it.`);
  for (const task of activeTasks(state)) {
    if (task.isCompleted || task.type !== 'FIND_ITEM' || task.targetId !== temple) continue;
    task.currentAmount = task.amount;
    task.isCompleted = true;
    lines.push(`Task complete: ${task.description}. Return to the person who asked.`);
  }
}
