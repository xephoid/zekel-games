import { describe, expect, it } from 'vitest';
import { CLEARING_MAX_LINKS, DEFAULT_CLEARINGS } from '../data/progression.js';
import { buildGraph, edgeBetween, hopDistances, isConnected, neighborsOf } from '../world/graph.js';
import type { WorldGraph } from '../types.js';

// PORT-PLAN §3 invariants over many seeds.

const TOWNS = ['Himfergen', 'Walgon', 'Sheeford', 'Malpance', 'Placington'].map((name, i) => ({ id: `town_${i}`, name }));

function build(seed: number, clearings?: number): WorldGraph {
  return buildGraph({ towns: TOWNS, clearings }, seed).graph;
}

function majorDegree(g: WorldGraph, id: string): number {
  return neighborsOf(g, id, { includeWalled: true }).length;
}

describe('world graph', () => {
  it('is connected, with the degree rules, for 200 seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const g = build(seed);
      expect(isConnected(g), `seed ${seed} connected`).toBe(true);
      const nodes = Object.values(g.nodes);
      expect(nodes.filter((n) => n.kind === 'town')).toHaveLength(5);
      expect(nodes.filter((n) => n.kind === 'temple')).toHaveLength(5);
      const clearings = nodes.filter((n) => n.kind === 'clearing').length;
      expect(clearings).toBeGreaterThanOrEqual(DEFAULT_CLEARINGS.min);
      expect(clearings).toBeLessThanOrEqual(DEFAULT_CLEARINGS.max);
      for (const n of nodes) {
        const nb = neighborsOf(g, n.id, { includeWalled: true });
        if (n.kind === 'town' || n.kind === 'temple') {
          expect(nb, `${n.id} has one link`).toHaveLength(1);
          expect(g.nodes[nb[0]!]!.kind, `${n.id} links to a clearing`).toBe('clearing');
        } else {
          expect(majorDegree(g, n.id)).toBeLessThanOrEqual(CLEARING_MAX_LINKS);
          expect(majorDegree(g, n.id)).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('honours an explicit clearing count and rejects an out-of-range one', () => {
    for (const c of [5, 6, 7, 8]) {
      const g = build(3, c);
      expect(Object.values(g.nodes).filter((n) => n.kind === 'clearing')).toHaveLength(c);
    }
    expect(() => build(3, 4)).toThrow();
    expect(() => build(3, 9)).toThrow();
  });

  it('walls only the Sky Temple edge, and the wall still counts for hop distance', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const g = build(seed);
      const walled = g.edges.filter((e) => e.walled);
      expect(walled).toHaveLength(1);
      expect([walled[0]!.a, walled[0]!.b]).toContain('temple_sky');
      expect(neighborsOf(g, 'temple_sky')).toHaveLength(0); // unreachable until bombed
      expect(neighborsOf(g, 'temple_sky', { includeWalled: true })).toHaveLength(1);
      expect(Number.isFinite(g.nodes['temple_sky']!.hops)).toBe(true);
      const clearing = neighborsOf(g, 'temple_sky', { includeWalled: true })[0]!;
      expect(edgeBetween(g, clearing, 'temple_sky')!.walled).toBe(true);
    }
  });

  it('starts at the first town and measures hops from it', () => {
    const g = build(11);
    expect(g.startNodeId).toBe('town_town_0');
    expect(g.nodes[g.startNodeId]!.hops).toBe(0);
    const startClearing = neighborsOf(g, g.startNodeId)[0]!;
    expect(g.nodes[startClearing]!.hops).toBe(1);
    const d = hopDistances(g, g.startNodeId);
    for (const n of Object.values(g.nodes)) expect(n.hops).toBe(d[n.id]);
  });

  it('is deterministic per seed', () => {
    expect(build(42)).toEqual(build(42));
    expect(JSON.stringify(build(42))).not.toEqual(JSON.stringify(build(43)));
  });

  it('sometimes adds a cycle (the map is not always a tree)', () => {
    let cycles = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const g = build(seed);
      if (g.edges.length > Object.keys(g.nodes).length - 1) cycles++;
    }
    expect(cycles).toBeGreaterThan(0);
  });
});
