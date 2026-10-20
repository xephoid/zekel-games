// The world graph (PORT-PLAN §3). Major nodes only: towns, clearings, temples.
// Rules: towns have exactly one connection, to a clearing (a town–town edge
// would cut both off); temples have exactly one connection, to a clearing;
// clearings hold up to CLEARING_MAX_LINKS (4) connections to major nodes.
// The Sky Temple's edge starts walled (its stone ring).

import { CLEARING_MAX_LINKS, DEFAULT_CLEARINGS, TOWN_COUNT } from '../data/progression.js';
import { TEMPLE_NAME, TEMPLE_TYPES, type TempleType } from '../data/magicItems.js';
import { CLEARING_NAMES } from '../data/registries.js';
import { pick, randomInt, shuffle } from '../rng.js';
import type { Edge, MajorNode, WorldGraph } from '../types.js';

export interface GraphBuildInput {
  towns: { id: string; name: string }[];
  clearings?: number;
}

function degree(edges: Edge[], id: string): number {
  return edges.filter((e) => e.a === id || e.b === id).length;
}

function adjacent(edges: Edge[], a: string, b: string): boolean {
  return edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

export function neighborsOf(graph: WorldGraph, id: string, opts: { includeWalled?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const e of graph.edges) {
    if (e.walled && !opts.includeWalled) continue;
    if (e.a === id) out.push(e.b);
    else if (e.b === id) out.push(e.a);
  }
  return out;
}

export function edgeBetween(graph: WorldGraph, a: string, b: string): Edge | undefined {
  return graph.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

/** BFS distances from `from`, over every edge (walled ones included: the
 *  Sky Temple is still "3 hops away" for placement purposes). */
export function hopDistances(graph: WorldGraph, from: string): Record<string, number> {
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(graph, cur, { includeWalled: true })) {
      if (dist[n] === undefined) {
        dist[n] = dist[cur]! + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

export function buildGraph(input: GraphBuildInput, seed: number): { graph: WorldGraph; nextSeed: number } {
  let s = seed;
  if (input.towns.length !== TOWN_COUNT) {
    throw new Error(`buildGraph: expected ${TOWN_COUNT} towns, got ${input.towns.length}`);
  }
  let clearingCount: number;
  if (input.clearings !== undefined) {
    if (input.clearings < DEFAULT_CLEARINGS.min || input.clearings > DEFAULT_CLEARINGS.max) {
      throw new Error(`buildGraph: clearings must be ${DEFAULT_CLEARINGS.min}..${DEFAULT_CLEARINGS.max}`);
    }
    clearingCount = input.clearings;
  } else {
    const r = randomInt(s, DEFAULT_CLEARINGS.max - DEFAULT_CLEARINGS.min + 1);
    s = r.nextSeed;
    clearingCount = DEFAULT_CLEARINGS.min + r.value;
  }

  const nodes: Record<string, MajorNode> = {};
  const edges: Edge[] = [];

  // 1. Clearings, connected by a random spanning tree that respects the cap.
  const names = shuffle(CLEARING_NAMES, s);
  s = names.nextSeed;
  const clearingIds: string[] = [];
  for (let i = 0; i < clearingCount; i++) {
    const id = `clearing_${i}`;
    clearingIds.push(id);
    nodes[id] = { id, kind: 'clearing', name: names.items[i] ?? `Clearing ${i + 1}`, hops: 0 };
    if (i > 0) {
      const open = clearingIds.slice(0, i).filter((c) => degree(edges, c) < CLEARING_MAX_LINKS - 1);
      // Keep at least one slot per clearing for a leaf (town/temple) so the
      // tree never eats every slot; fall back to any clearing under the cap.
      const candidates = open.length > 0 ? open : clearingIds.slice(0, i).filter((c) => degree(edges, c) < CLEARING_MAX_LINKS);
      const p = pick(candidates, s);
      s = p.nextSeed;
      edges.push({ a: p.value, b: id, walled: false });
    }
  }

  const freeClearings = (): string[] => clearingIds.filter((c) => degree(edges, c) < CLEARING_MAX_LINKS);
  const leavesAt = (c: string, kind: 'town' | 'temple'): number =>
    neighborsOf({ nodes, edges, startNodeId: '' }, c, { includeWalled: true }).filter((n) => nodes[n]!.kind === kind).length;

  // 2. Towns: each hangs off a clearing with a free slot, preferring clearings
  //    without a town yet so the towns spread out.
  for (const town of input.towns) {
    const id = `town_${town.id}`;
    nodes[id] = { id, kind: 'town', name: town.name, townId: town.id, hops: 0 };
    const free = freeClearings();
    if (free.length === 0) throw new Error('buildGraph: no free clearing slot for a town');
    const minTowns = Math.min(...free.map((c) => leavesAt(c, 'town')));
    const p = pick(free.filter((c) => leavesAt(c, 'town') === minTowns), s);
    s = p.nextSeed;
    edges.push({ a: p.value, b: id, walled: false });
  }

  // 3. Temples: same, preferring clearings without a temple yet. The Sky
  //    Temple's edge is walled.
  for (const temple of TEMPLE_TYPES) {
    const id = `temple_${temple}`;
    nodes[id] = { id, kind: 'temple', name: TEMPLE_NAME[temple], templeType: temple as TempleType, hops: 0 };
    const free = freeClearings();
    if (free.length === 0) throw new Error('buildGraph: no free clearing slot for a temple');
    const minTemples = Math.min(...free.map((c) => leavesAt(c, 'temple')));
    const p = pick(free.filter((c) => leavesAt(c, 'temple') === minTemples), s);
    s = p.nextSeed;
    edges.push({ a: p.value, b: id, walled: temple === 'sky' });
  }

  // 4. With leftover slots, add up to two extra clearing–clearing edges so the
  //    map is not always a tree.
  for (let extra = 0; extra < 2; extra++) {
    const free = freeClearings();
    const pairs: [string, string][] = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (!adjacent(edges, free[i]!, free[j]!)) pairs.push([free[i]!, free[j]!]);
      }
    }
    if (pairs.length === 0) break;
    const roll = randomInt(s, 2);
    s = roll.nextSeed;
    if (roll.value === 0) continue; // 50%: leave the slots empty
    const p = pick(pairs, s);
    s = p.nextSeed;
    edges.push({ a: p.value[0], b: p.value[1], walled: false });
  }

  const startNodeId = `town_${input.towns[0]!.id}`;
  const graph: WorldGraph = { nodes, edges, startNodeId };
  const dist = hopDistances(graph, startNodeId);
  for (const n of Object.values(nodes)) n.hops = dist[n.id] ?? Number.POSITIVE_INFINITY;
  return { graph, nextSeed: s };
}

/** Every major node reachable from the start, walled edges included. */
export function isConnected(graph: WorldGraph): boolean {
  const dist = hopDistances(graph, graph.startNodeId);
  return Object.keys(graph.nodes).every((id) => dist[id] !== undefined);
}
