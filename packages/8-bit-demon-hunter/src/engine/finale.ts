// The accusation and the arena (PORT-PLAN §9). Wrong → the game is lost.
// Right → the demon reveals itself and the fight starts at once.

import { ENEMY_BY_ID } from '../data/enemies.js';
import type { DemonHunterState } from '../types.js';
import { makeEnemy } from '../world/populate.js';
import { ARENA_NODE_ID, startCombat } from './combat.js';
import { refuse } from './errors.js';
import { personOf } from './helpers.js';
import { requireNoCombat } from './movement.js';

export const DEMON_BASE_HP = 20;
export const BINDING_HP_PENALTY = 3;

export function demonHp(state: DemonHunterState): number {
  return Math.max(1, DEMON_BASE_HP - BINDING_HP_PENALTY * state.player.bindings.length) * state.player.strength;
}

export function accuse(state: DemonHunterState, personId: string, lines: string[]): void {
  requireNoCombat(state);
  if (state.phase !== 'playing') refuse('You cannot accuse anyone right now.');
  const person = personOf(state, personId);
  if (!person.hasMet) refuse(`You have not met ${person.name}; you can only accuse someone from your clue book.`);
  const town = state.towns.find((t) => t.id === person.attributes.townId)?.name ?? '';
  lines.push(`You accuse ${person.name} the ${person.attributes.occupation} of ${town} of being the demon!`);
  if (person.id !== state.demonId) {
    state.phase = 'lost';
    state.dialogue = null;
    state.innOpen = false;
    state.result = { winner: 'demon', summary: `${person.name} was innocent. The real demon slips away laughing; the hunt is lost.` };
    lines.push(state.result.summary);
    return;
  }
  // The demon drops its disguise and drags you into its arena.
  state.dialogue = null;
  state.innOpen = false;
  state.temple = null;
  state.player.inside = null;
  state.player.flying = false;
  state.player.auraUp = false;
  state.player.follower = null;
  const hp = demonHp(state);
  const demon = makeEnemy('demon', ENEMY_BY_ID.demon, ARENA_NODE_ID, hp);
  state.enemies[demon.id] = demon;
  state.arena = { demonEnemyId: demon.id, phase2Done: false, minionQueue: [] };
  state.phase = 'arena';
  lines.push(
    `${person.name}'s face splits into a grin far too wide. The town falls away and you stand in a dark arena of black pillars. ` +
      `THE DEMON (${hp} HP${state.player.bindings.length > 0 ? `, weakened by ${state.player.bindings.length} binding${state.player.bindings.length === 1 ? '' : 's'}` : ''}) rises before you. There is no way out but through.`,
  );
  startCombat(state, demon.id, 'arena', lines);
}
