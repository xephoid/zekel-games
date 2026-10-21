// Shared lookups and the small state mutations several moves perform.

import { ENEMY_BY_ID, isAggressive, type EnemyDef } from '../data/enemies.js';
import { MAX_LEVEL, STAT_MAX, XP_CURVE } from '../data/progression.js';
import { RESOURCE_NODE } from '../data/resources.js';
import { neighborsOf } from '../world/graph.js';
import type { Clue, DemonHunterState, Enemy, GameTask, MajorNode, Person, ResourceNode, Town } from '../types.js';
import { refuse } from './errors.js';

/** The engine mutates a deep copy; state is plain JSON. */
export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function defOf(enemy: Enemy): EnemyDef {
  return ENEMY_BY_ID[enemy.type];
}

export function nodeOf(state: DemonHunterState, id: string): MajorNode {
  const n = state.graph.nodes[id];
  if (!n) refuse(`There is no place called "${id}".`);
  return n;
}

export function hereNode(state: DemonHunterState): MajorNode {
  return state.graph.nodes[state.player.at]!;
}

export function enemiesAt(state: DemonHunterState, nodeId: string): Enemy[] {
  return Object.values(state.enemies)
    .filter((e) => e.at === nodeId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function resourcesAt(state: DemonHunterState, nodeId: string): ResourceNode[] {
  return Object.values(state.resources)
    .filter((r) => r.at === nodeId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function aggressiveAt(state: DemonHunterState, nodeId: string): Enemy[] {
  return enemiesAt(state, nodeId).filter((e) => isAggressive(defOf(e)));
}

export function townOf(state: DemonHunterState, townId: string): Town {
  const t = state.towns.find((t) => t.id === townId);
  if (!t) refuse(`There is no town "${townId}".`);
  return t;
}

export function townAtNode(state: DemonHunterState, nodeId: string): Town | null {
  const node = state.graph.nodes[nodeId];
  if (!node || node.kind !== 'town') return null;
  return state.towns.find((t) => t.id === node.townId) ?? null;
}

export function currentTown(state: DemonHunterState): Town {
  if (state.player.inside !== 'town') refuse('You are not inside a town.');
  return townAtNode(state, state.player.at)!;
}

export function allPeople(state: DemonHunterState): Person[] {
  return state.towns.flatMap((t) => t.people);
}

export function personOf(state: DemonHunterState, personId: string): Person {
  const p = allPeople(state).find((p) => p.id === personId);
  if (!p) refuse(`There is no one called "${personId}".`);
  return p;
}

export function enemyName(enemy: Enemy): string {
  return defOf(enemy).name;
}

export function resourceName(r: ResourceNode): string {
  return RESOURCE_NODE[r.kind].name;
}

export function hasMagicItem(state: DemonHunterState, item: 'sky' | 'earth' | 'space' | 'light' | 'fire'): boolean {
  return state.player.magicItems.includes(item);
}

/** The original: xp >= xpCurve[level - 1] while below max level. */
export function canLevelUp(state: DemonHunterState): boolean {
  const p = state.player;
  if (p.level >= MAX_LEVEL) return false;
  return p.xp >= (XP_CURVE[p.level - 1] ?? Number.POSITIVE_INFINITY);
}

export function xpToNextLevel(state: DemonHunterState): number | null {
  const p = state.player;
  if (p.level >= MAX_LEVEL) return null;
  return XP_CURVE[p.level - 1] ?? null;
}

export function statIsMaxed(state: DemonHunterState, stat: keyof typeof STAT_MAX): boolean {
  const p = state.player;
  const value = stat === 'health' ? p.maxHp : p[stat];
  return value >= STAT_MAX[stat];
}

export function gainXp(state: DemonHunterState, amount: number, lines: string[]): void {
  const before = canLevelUp(state);
  state.player.xp += amount;
  lines.push(`+${amount} XP (${state.player.xp} total).`);
  if (!before && canLevelUp(state)) lines.push(`You can level up! (level ${state.player.level + 1} is ready: choose a stat to raise.)`);
}

/** Every accepted task, in acceptance order. */
export function activeTasks(state: DemonHunterState): GameTask[] {
  const people = allPeople(state);
  return state.player.activeTasks.map((giver) => people.find((p) => p.id === giver)?.task).filter((t): t is GameTask => !!t);
}

/** How an enemy looks, in words: the GM never sees its numbers. */
export function condition(e: Enemy): string {
  if (e.hp <= 0) return 'dead';
  const f = e.hp / e.maxHp;
  if (f >= 1) return 'unhurt';
  if (f >= 0.75) return 'barely scratched';
  if (f >= 0.5) return 'hurt';
  if (f >= 0.25) return 'badly wounded';
  return 'barely able to stand';
}

/** The overworld as it was generated comes back (the original reloaded its
 *  stored overworld every time the player left a town or temple). Ore
 *  deposits and the opened Sky ring stay as they are. */
/** Standing somewhere, the player learns it and every place a path leads to
 *  from it (a walled temple included: the wall is in plain sight). */
export function learnSurroundings(state: DemonHunterState): void {
  const p = state.player;
  for (const id of [p.at, ...neighborsOf(state.graph, p.at, { includeWalled: true })]) {
    if (!p.knownPlaces.includes(id)) p.knownPlaces.push(id);
  }
}

export function knowsPlace(state: DemonHunterState, nodeId: string): boolean {
  return state.player.knownPlaces.includes(nodeId);
}

/** Doing anything else ends the conversation you were in (the player simply
 *  walks away; nothing needs a goodbye first). Ruling 2026-10-21: quest
 *  flows were six moves long. */
export function endDialogue(state: DemonHunterState, lines: string[]): void {
  if (!state.dialogue) return;
  const who = allPeople(state).find((x) => x.id === state.dialogue!.personId);
  lines.push(`(You take your leave of ${who?.name ?? 'them'}.)`);
  state.dialogue = null;
}

export function respawnOverworld(state: DemonHunterState): void {
  state.enemies = structuredClone(state.initialEnemies);
  for (const [id, r] of Object.entries(state.initialResources)) {
    if (!state.resources[id]) state.resources[id] = structuredClone(r);
  }
}

export function addClue(state: DemonHunterState, clue: Clue): boolean {
  if (state.player.knownClues.some((c) => c.text === clue.text)) return false;
  state.player.knownClues.push({ ...clue });
  return true;
}

export function attacksPerAction(ownSpeed: number, otherSpeed: number): number {
  if (otherSpeed <= 0) return 1;
  return Math.max(1, Math.floor(ownSpeed / otherSpeed));
}

export function healToFull(state: DemonHunterState): void {
  state.player.hp = state.player.maxHp;
}

/** Remove temple guardians / arena foes standing at `nodeId`. */
export function clearTempleEnemiesAt(state: DemonHunterState, nodeId: string): void {
  for (const e of Object.values(state.enemies)) {
    if (e.at === nodeId && ENEMY_BY_ID[e.type].templeOnly) delete state.enemies[e.id];
  }
}

/** Overworld enemies still standing (temple guardians and the demon never live in the overworld). */
export function overworldEnemiesLeft(state: DemonHunterState): number {
  return Object.values(state.enemies).filter((e) => !defOf(e).templeOnly).length;
}
