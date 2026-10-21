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

/** `stab {person}`: the demon-killing knife. You must be in the town with
 *  them. The wrong person dies and the town turns on you (the game is lost);
 *  the right one drops its disguise and the arena begins. */
export function stab(state: DemonHunterState, personId: string, lines: string[]): void {
  requireNoCombat(state);
  if (state.phase !== 'playing') refuse('You cannot use the knife right now.');
  if (state.player.inside !== 'town') refuse('You must be in a town, face to face with someone, to use the knife.');
  const town = state.towns.find((t) => t.nodeId === state.player.at)!;
  const person =
    town.people.find((x) => x.id === personId || x.name.toLowerCase() === personId.toLowerCase()) ??
    (state.player.followers.includes(personId) ? personOf(state, personId) : null);
  if (!person) refuse(`There is no one called "${personId}" here in ${town.name}.`);
  lines.push(`You draw the demon-killing knife and drive it into ${person.name} the ${person.attributes.occupation}.`);
  if (person.id !== state.demonId) {
    state.phase = 'lost';
    state.dialogue = null;
    state.innOpen = false;
    state.result = {
      winner: 'demon',
      summary: `${person.name} was no demon. They die in front of ${town.name} with your knife in them, and the town turns on you. Somewhere, the real demon is laughing. The hunt is lost.`,
    };
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
  state.player.followers = [];
  const demon = makeEnemy('demon', ENEMY_BY_ID.demon, ARENA_NODE_ID, demonHp(state));
  state.enemies[demon.id] = demon;
  state.arena = { demonEnemyId: demon.id, phase2Done: false, minionQueue: [] };
  state.phase = 'arena';
  lines.push(
    `The knife goes in and ${person.name}'s face splits into a grin far too wide. The town falls away and you stand in a dark arena of black pillars. ` +
      `THE DEMON rises before you${state.player.bindings.length > 0 ? `, moving stiffly: your ${state.player.bindings.length} binding${state.player.bindings.length === 1 ? '' : 's'} weigh on it` : ''}. There is no way out but through.`,
  );
  startCombat(state, demon.id, 'arena', lines);
}
