// The accusation and the lair (PORT-PLAN §9). Wrong → the game is lost.
// Right → the demon reveals itself and the fight starts at once.

import { ENEMY_BY_ID } from '../data/enemies.js';
import { LAIR } from '../data/progression.js';
import type { DemonHunterState } from '../types.js';
import { makeEnemy } from '../world/populate.js';
import { LAIR_NODE_ID, startCombat } from './combat.js';
import { refuse } from './errors.js';
import { personOf } from './helpers.js';
import { requireNoCombat } from './movement.js';

/** The lair fight (ruling 2026-10-21, after three playtests): flat HP so every
 *  strength point shortens the fight; each binding AND each artifact held
 *  takes a fixed bite out of it; never below a floor. */
/** Bindings held plus artifacts held: everything that weakens the demon. */
export function weakenings(state: DemonHunterState): number {
  return state.player.bindings.length + state.player.magicItems.length;
}

export function demonHp(state: DemonHunterState): number {
  return Math.max(LAIR.minHp, LAIR.baseHp - LAIR.perWeakening * weakenings(state));
}

/** `stab {person}`: the demon-killing knife. You must be in the town with
 *  them. The wrong person dies and the town turns on you (the game is lost);
 *  the right one drops its disguise and the lair begins. */
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
  // The demon drops its disguise and drags you into its lair.
  const b = state.player.bindings.length;
  const a = state.player.magicItems.length;
  const weigh = [b > 0 ? `${b} binding${b === 1 ? '' : 's'}` : '', a > 0 ? `${a} artifact${a === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  state.dialogue = null;
  state.innOpen = false;
  state.temple = null;
  state.player.inside = null;
  state.player.flying = false;
  state.player.auraUp = false;
  state.player.followers = [];
  const demon = makeEnemy('demon', ENEMY_BY_ID.demon, LAIR_NODE_ID, demonHp(state));
  state.enemies[demon.id] = demon;
  state.lair = { demonEnemyId: demon.id, phase2Done: false, minionQueue: [] };
  state.phase = 'lair';
  lines.push(
    `The knife goes in and ${person.name}'s face splits into a grin far too wide. The town falls away and you stand in the demon's lair: a dark hall of black pillars. ` +
      `THE DEMON rises before you${weigh ? `, moving stiffly: your ${weigh} weigh on it` : ''}. There is no way out but through.`,
  );
  startCombat(state, demon.id, 'lair', lines);
}
