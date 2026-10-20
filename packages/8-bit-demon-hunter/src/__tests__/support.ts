// Shared helpers for the engine suites: a fresh world, and ways to stage a
// situation (clear a node, drop an enemy in, step outside).

import { ENEMY_BY_ID, type EnemyType } from '../data/enemies.js';
import { applyMove } from '../engine/apply.js';
import type { DemonHunterMove } from '../engine/moves.js';
import type { DemonHunterState, Enemy } from '../types.js';
import { generateWorld } from '../world/generate.js';
import { neighborsOf } from '../world/graph.js';
import { makeEnemy } from '../world/populate.js';

export function fresh(seed = 1): DemonHunterState {
  return generateWorld(seed);
}

export function apply(state: DemonHunterState, move: DemonHunterMove): DemonHunterState {
  return applyMove(state, move).newState;
}

export function applyText(state: DemonHunterState, move: DemonHunterMove): { state: DemonHunterState; summary: string } {
  const r = applyMove(state, move);
  return { state: r.newState, summary: r.summary };
}

/** Remove every enemy (and optionally resource) at a node. */
export function clearNode(state: DemonHunterState, nodeId: string, resourcesToo = false): void {
  for (const e of Object.values(state.enemies)) if (e.at === nodeId) delete state.enemies[e.id];
  if (resourcesToo) for (const r of Object.values(state.resources)) if (r.at === nodeId) delete state.resources[r.id];
}

export function clearAllEnemies(state: DemonHunterState): void {
  state.enemies = {};
}

export function place(state: DemonHunterState, type: EnemyType, at: string, id = `${type}_test_${Object.keys(state.enemies).length}`): Enemy {
  const e = makeEnemy(id, ENEMY_BY_ID[type], at);
  state.enemies[id] = e;
  return e;
}

/** The player outdoors at the start town's door, with that node emptied. */
export function outsideStart(seed = 1): DemonHunterState {
  const s = fresh(seed);
  clearNode(s, s.graph.startNodeId);
  return apply(s, { type: 'leave' });
}

export function startClearing(state: DemonHunterState): string {
  return neighborsOf(state.graph, state.graph.startNodeId)[0]!;
}

export function demon(state: DemonHunterState) {
  return state.towns.flatMap((t) => t.people).find((p) => p.id === state.demonId)!;
}
