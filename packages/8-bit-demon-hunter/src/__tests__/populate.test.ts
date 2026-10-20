import { describe, expect, it } from 'vitest';
import { ENEMY_BY_ID, OVERWORLD_ENEMIES } from '../data/enemies.js';
import { STARTING_SHUCKLES, STAT_BASE } from '../data/progression.js';
import { initialStock, ORE_DEPOSIT_COUNT, PLANT_COUNT, RESOURCE_TYPES, TREE_COUNT } from '../data/resources.js';
import { generateWorld } from '../world/generate.js';
import { spawnNodesFor } from '../world/populate.js';

describe('populating the world', () => {
  it('spawns the original counts, bandits in pairs, clearing-only types in clearings, nothing in temples', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateWorld(seed);
      const enemies = Object.values(s.enemies);
      for (const def of OVERWORLD_ENEMIES) {
        const ofType = enemies.filter((e) => e.type === def.id);
        expect(ofType, `${def.id} count`).toHaveLength(def.max);
        for (const e of ofType) {
          const node = s.graph.nodes[e.at]!;
          expect(node.kind).not.toBe('temple');
          if (def.clearingsOnly) expect(node.kind).toBe('clearing');
          expect(e.hp).toBe(def.hp);
          expect(e.attacked).toBe(false);
        }
      }
      // Every Lady Bandit shares a node with a Dude Bandit.
      const dudes = enemies.filter((e) => e.type === 'dude_bandit').map((e) => e.at);
      for (const lady of enemies.filter((e) => e.type === 'lady_bandit')) expect(dudes).toContain(lady.at);
      expect(enemies.some((e) => e.type === 'demon')).toBe(false);
      expect(enemies.some((e) => ENEMY_BY_ID[e.type].templeOnly)).toBe(false);
    }
  });

  it('keeps each type at least its minimum hops from the start town when the map allows', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateWorld(seed);
      for (const def of OVERWORLD_ENEMIES) {
        const allowed = new Set(spawnNodesFor(s.graph, def));
        for (const e of Object.values(s.enemies).filter((e) => e.type === def.id)) {
          expect(allowed.has(e.at), `${e.id} on an allowed node`).toBe(true);
        }
        const kinds = def.clearingsOnly ? ['clearing'] : ['town', 'clearing'];
        const farEnough = Object.values(s.graph.nodes).filter((n) => kinds.includes(n.kind) && n.hops >= def.minHops);
        if (farEnough.length > 0) {
          for (const e of Object.values(s.enemies).filter((e) => e.type === def.id)) {
            expect(s.graph.nodes[e.at]!.hops).toBeGreaterThanOrEqual(def.minHops);
          }
        }
      }
    }
  });

  it('keeps the starting town free of anything but slimes and mushrooms', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = generateWorld(seed);
      for (const e of Object.values(s.enemies).filter((e) => e.at === s.graph.startNodeId)) {
        expect(['slime', 'mushroom']).toContain(e.type);
      }
    }
  });

  it('places plants and trees on towns and clearings, ore only on clearings', () => {
    const s = generateWorld(2);
    const res = Object.values(s.resources);
    expect(res.filter((r) => r.kind === 'plant')).toHaveLength(PLANT_COUNT);
    expect(res.filter((r) => r.kind === 'tree')).toHaveLength(TREE_COUNT);
    expect(res.filter((r) => r.kind === 'ore')).toHaveLength(ORE_DEPOSIT_COUNT);
    for (const r of res) {
      const node = s.graph.nodes[r.at]!;
      expect(node.kind).not.toBe('temple');
      if (r.kind === 'ore') expect(node.kind).toBe('clearing');
      if (r.kind === 'plant') expect(r.hp).toBe(1);
      if (r.kind === 'tree') expect(r.hp).toBe(4);
    }
  });

  it('prices every inn 1..6 per resource with the matching opening stock', () => {
    const s = generateWorld(4);
    for (const town of s.towns) {
      for (const r of RESOURCE_TYPES) {
        expect(town.prices[r]).toBeGreaterThanOrEqual(1);
        expect(town.prices[r]).toBeLessThanOrEqual(6);
        expect(town.stock[r]).toBe(initialStock(town.prices[r]));
      }
    }
  });

  it('starts the player inside the first town with base stats and 5 shuckles', () => {
    const s = generateWorld(8);
    expect(s.phase).toBe('playing');
    expect(s.player.at).toBe(s.graph.startNodeId);
    expect(s.player.inside).toBe('town');
    expect(s.player.lastTown).toBe(s.towns[0]!.id);
    expect(s.player.visitedTowns).toEqual([s.towns[0]!.id]);
    expect(s.player.shuckles).toBe(STARTING_SHUCKLES);
    expect(s.player.strength).toBe(STAT_BASE.strength);
    expect(s.player.agility).toBe(STAT_BASE.agility);
    expect(s.player.range).toBe(STAT_BASE.range);
    expect(s.player.hp).toBe(STAT_BASE.health);
    expect(s.player.maxHp).toBe(STAT_BASE.health);
    expect(s.player.level).toBe(1);
    expect(s.combat).toBeNull();
    expect(s.temple).toBeNull();
    expect(s.arena).toBeNull();
  });
});
