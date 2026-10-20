// Enemies, harvestables, ore deposits and inn prices on a built graph
// (PORT-PLAN §3). Counts are the original's; the tile-distance spawn rule
// becomes a minimum hop distance from the start town's clearing.

import { ENEMY_BY_ID, OVERWORLD_ENEMIES, type EnemyDef } from '../data/enemies.js';
import {
  initialStock,
  ORE_DEPOSIT_COUNT,
  PLANT_COUNT,
  PRICE_MULTIPLIER_MAX,
  PRICE_MULTIPLIER_MIN,
  RESOURCE_NODE,
  RESOURCE_TYPES,
  TREE_COUNT,
  type ResourceNodeKind,
  type ResourceType,
} from '../data/resources.js';
import { pick, randomInt } from '../rng.js';
import type { Enemy, ResourceNode, Town, WorldGraph } from '../types.js';

function majorNodes(graph: WorldGraph, kinds: readonly ('town' | 'clearing' | 'temple')[]): string[] {
  return Object.values(graph.nodes)
    .filter((n) => kinds.includes(n.kind))
    .map((n) => n.id);
}

/** Nodes an enemy type may spawn on: clearings (and towns unless
 *  clearingsOnly), at least minHops from the start town; if none qualify,
 *  the farthest eligible nodes. Never temples. */
export function spawnNodesFor(graph: WorldGraph, def: EnemyDef): string[] {
  const kinds: ('town' | 'clearing')[] = def.clearingsOnly ? ['clearing'] : ['town', 'clearing'];
  const eligible = majorNodes(graph, kinds);
  const far = eligible.filter((id) => graph.nodes[id]!.hops >= def.minHops);
  if (far.length > 0) return far;
  const maxHops = Math.max(...eligible.map((id) => graph.nodes[id]!.hops));
  return eligible.filter((id) => graph.nodes[id]!.hops === maxHops);
}

export function makeEnemy(id: string, def: EnemyDef, at: string, hp = def.hp): Enemy {
  return { id, type: def.id, at, hp, maxHp: hp, attacked: false };
}

export function populateEnemies(graph: WorldGraph, seed: number): { enemies: Record<string, Enemy>; nextSeed: number } {
  let s = seed;
  const enemies: Record<string, Enemy> = {};
  const counters: Record<string, number> = {};
  const add = (def: EnemyDef, at: string): void => {
    const n = (counters[def.id] = (counters[def.id] ?? 0) + 1);
    const id = `${def.id}_${n}`;
    enemies[id] = makeEnemy(id, def, at);
  };

  // Bandits come in Dude + Lady pairs on the same node (original spawnBanditPair).
  const dude = ENEMY_BY_ID.dude_bandit;
  const lady = ENEMY_BY_ID.lady_bandit;
  const pairCount = Math.min(dude.max, lady.max);
  const banditNodes = spawnNodesFor(graph, dude);
  for (let i = 0; i < pairCount; i++) {
    const p = pick(banditNodes, s);
    s = p.nextSeed;
    add(dude, p.value);
    add(lady, p.value);
  }

  for (const def of OVERWORLD_ENEMIES) {
    if (def.id === 'dude_bandit' || def.id === 'lady_bandit') continue;
    const nodes = spawnNodesFor(graph, def);
    for (let i = 0; i < def.max; i++) {
      const p = pick(nodes, s);
      s = p.nextSeed;
      add(def, p.value);
    }
  }
  return { enemies, nextSeed: s };
}

export function populateResources(graph: WorldGraph, seed: number): { resources: Record<string, ResourceNode>; nextSeed: number } {
  let s = seed;
  const resources: Record<string, ResourceNode> = {};
  const counters: Record<string, number> = {};
  const add = (kind: ResourceNodeKind, at: string): void => {
    const n = (counters[kind] = (counters[kind] ?? 0) + 1);
    const id = `${kind}_${n}`;
    resources[id] = { id, kind, at, hp: RESOURCE_NODE[kind].hp };
  };
  const open = majorNodes(graph, ['town', 'clearing']);
  const clearings = majorNodes(graph, ['clearing']);
  for (let i = 0; i < PLANT_COUNT; i++) {
    const p = pick(open, s);
    s = p.nextSeed;
    add('plant', p.value);
  }
  for (let i = 0; i < TREE_COUNT; i++) {
    const p = pick(open, s);
    s = p.nextSeed;
    add('tree', p.value);
  }
  for (let i = 0; i < ORE_DEPOSIT_COUNT; i++) {
    const p = pick(clearings, s);
    s = p.nextSeed;
    add('ore', p.value);
  }
  return { resources, nextSeed: s };
}

/** Per-town inn price multipliers (1..6 per resource) and opening stock. */
export function populateInns(towns: Town[], seed: number): number {
  let s = seed;
  for (const town of towns) {
    const prices = {} as Record<ResourceType, number>;
    const stock = {} as Record<ResourceType, number>;
    for (const r of RESOURCE_TYPES) {
      const roll = randomInt(s, PRICE_MULTIPLIER_MAX - PRICE_MULTIPLIER_MIN + 1);
      s = roll.nextSeed;
      prices[r] = PRICE_MULTIPLIER_MIN + roll.value;
      stock[r] = initialStock(prices[r]);
    }
    town.prices = prices;
    town.stock = stock;
  }
  return s;
}
