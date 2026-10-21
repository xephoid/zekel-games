// Moving between major nodes and what the enemies there do about it
// (PORT-PLAN §4), plus flight, the aura outdoors, and the cape.

import { TEMPLE_NAME } from '../data/magicItems.js';
import type { DemonHunterState } from '../types.js';
import { edgeBetween, neighborsOf } from '../world/graph.js';
import { startCombat } from './combat.js';
import { whatIsHere } from './describe.js';
import { refuse } from './errors.js';
import { movePersonToTown } from '../world/puzzle.js';
import { activeTasks, clearTempleEnemiesAt, defOf, enemiesAt, hasMagicItem, healToFull, hereNode, learnSurroundings, nodeOf, personOf, respawnOverworld, townAtNode } from './helpers.js';
import { relocateDemonClues } from './clues.js';

export function requireOutdoors(state: DemonHunterState): void {
  if (state.player.inside === 'town') refuse('You are inside the town. Leave it first.');
  if (state.player.inside === 'temple') refuse('You are inside the temple. Leave it first.');
}

export function requireNoCombat(state: DemonHunterState): void {
  if (state.combat) refuse('You are in a fight: fight or flee first.');
}

/** `move {to}`. Returns true when the player actually moved. */
export function move(state: DemonHunterState, to: string, lines: string[], opts: { quiet?: boolean } = {}): boolean {
  requireNoCombat(state);
  requireOutdoors(state);
  const here = hereNode(state);
  const dest = nodeOf(state, to);
  const edge = edgeBetween(state.graph, here.id, to);
  if (!edge) refuse(`${dest.name} is not next to ${here.name}. Paths lead to: ${neighborsOf(state.graph, here.id, { includeWalled: true }).map((n) => state.graph.nodes[n]!.name).join(', ')}.`);
  if (edge.walled) refuse(`A ring of stone wall surrounds the ${TEMPLE_NAME.sky}. You will need a bomb to blow a hole in it.`);

  const p = state.player;
  const mushrooms = enemiesAt(state, here.id).filter((e) => e.type === 'mushroom');

  if (p.auraUp) {
    p.auraUp = false;
    lines.push('The Aura of Protection shields you as you go; nothing here can stop you.');
  } else if (p.flying) {
    // Only aggressive ranged enemies (range >= 3) can reach a flier: skeletons.
    const shooter = enemiesAt(state, here.id).find((e) => {
      const d = defOf(e);
      return d.behaviour === 'hunter' && d.range >= 3;
    });
    if (shooter) {
      startCombat(state, shooter.id, 'flying', lines);
      return false;
    }
  } else {
    const blocker = enemiesAt(state, here.id).find((e) => {
      const d = defOf(e);
      return d.behaviour === 'blocker' || d.behaviour === 'hunter';
    });
    if (blocker) {
      startCombat(state, blocker.id, 'leaving', lines);
      return false;
    }
    if (mushrooms.length >= 5) {
      lines.push(`${mushrooms.length} Mushrooms crowd around you as you try to leave!`);
      startCombat(state, mushrooms[0]!.id, 'leaving', lines);
      return false;
    }
  }

  p.at = to;
  p.inside = null;
  learnSurroundings(state);
  lines.push(`You travel to ${dest.name}.`);
  if (mushrooms.length > 0) {
    for (const m of mushrooms) m.at = to;
    lines.push(`${mushrooms.length === 1 ? 'A Mushroom follows' : `${mushrooms.length} Mushrooms follow`} you.`);
  }
  if (!opts.quiet) lines.push(whatIsHere(state));
  return true;
}

/** `enter` at a town node. (Temples: engine/temple.ts.) */
export function enterTown(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  const town = townAtNode(state, state.player.at);
  if (!town) refuse('There is no town here to enter.');
  arriveInTown(state, town.id, lines);
}

/** Shared by walking in, the inn ride and the cape. */
export function arriveInTown(state: DemonHunterState, townId: string, lines: string[]): void {
  const town = state.towns.find((t) => t.id === townId)!;
  const p = state.player;
  p.at = town.nodeId;
  p.inside = 'town';
  p.flying = false;
  p.auraUp = false;
  p.lastTown = town.id;
  learnSurroundings(state);
  if (!p.visitedTowns.includes(town.id)) p.visitedTowns.push(town.id);
  lines.push(`You enter ${town.name}.`);
  // Escort tasks complete on entering the target town by any means (the
  // original checks on every town load). Each delivered person now lives
  // here; if one was the demon, every location clue follows it.
  for (const followerId of [...p.followers]) {
    const follower = personOf(state, followerId);
    const task = follower.task;
    if (!p.activeTasks.includes(followerId) || task.isCompleted || task.type !== 'ESCORT' || task.targetId !== town.id) continue;
    const from = follower.attributes.townId;
    movePersonToTown(state.towns, follower.id, town.id);
    if (follower.id === state.demonId) relocateDemonClues(state, from, town.id);
    task.currentAmount = task.amount;
    task.isCompleted = true;
    p.followers = p.followers.filter((id) => id !== followerId);
    lines.push(`${follower.name} is safely in ${town.name} and will live here now. Task complete: ${follower.name} owes you a reward.`);
  }
}

export function leaveInterior(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  if (state.player.inside === null) refuse('You are already outdoors.');
  if (state.dialogue) refuse('Finish the conversation first (say goodbye).');
  if (state.innOpen) refuse('Leave the inn first.');
  const here = hereNode(state);
  if (state.player.inside === 'temple') {
    if (state.temple && state.temple.mode === 'gauntlet' && state.temple.remaining > 0) {
      lines.push('You retreat from the temple; the guardians regroup behind you. The gauntlet starts over next time.');
    }
    clearTempleEnemiesAt(state, here.id);
    state.temple = null;
  }
  state.player.inside = null;
  // The wild resets while you are indoors (the original reloaded its stored
  // overworld on every exit): the monsters, plants and trees are back.
  respawnOverworld(state);
  lines.push(`You step out of ${here.name}.`);
  lines.push(whatIsHere(state));
}

export function fly(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  if (!hasMagicItem(state, 'sky')) refuse('You have no Winged Boots.');
  if (state.player.flying) refuse('You are already flying.');
  state.player.flying = true;
  lines.push('The Winged Boots lift you into the air. Enemies below cannot reach you unless they have range 3 or more.');
}

export function land(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  if (!state.player.flying) refuse('You are not flying.');
  state.player.flying = false;
  lines.push('You land.');
}

export function auraOutdoors(state: DemonHunterState, lines: string[]): void {
  requireOutdoors(state);
  if (!hasMagicItem(state, 'earth')) refuse('You have no Aura of Protection.');
  if (state.player.auraUp) refuse('The aura is already up.');
  state.player.auraUp = true;
  lines.push('The Aura of Protection surrounds you. Nothing can hurt you, but you cannot attack. Your next move will pass every enemy here.');
}

export function teleport(state: DemonHunterState, townId: string, lines: string[]): void {
  requireNoCombat(state);
  if (!hasMagicItem(state, 'space')) refuse('You have no Cape of Teleportation.');
  if (state.dialogue || state.innOpen) refuse('Finish what you are doing first.');
  const town = state.towns.find((t) => t.id === townId || t.name.toLowerCase() === townId.toLowerCase());
  if (!town) refuse(`There is no town "${townId}".`);
  if (!state.player.visitedTowns.includes(town.id)) refuse(`You have never been to ${town.name}; the cape only knows places you have visited.`);
  state.temple = null;
  lines.push(`The Cape of Teleportation whisks you to ${town.name}.`);
  arriveInTown(state, town.id, lines);
  healToFull(state); // the original heals on a cape jump
  lines.push(`You feel refreshed (HP ${state.player.hp}/${state.player.maxHp}).`);
}
