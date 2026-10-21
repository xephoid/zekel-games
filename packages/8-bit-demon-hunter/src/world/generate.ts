// generateWorld: towns → graph → people and puzzle → enemies, resources, inns.
// Everything is seeded; the same seed and options build the same world.

import { STARTING_SHUCKLES, STAT_BASE, TOWN_COUNT } from '../data/progression.js';
import { TOWN_NAMES } from '../data/registries.js';
import { RESOURCE_TYPES, type ResourceType } from '../data/resources.js';
import { shuffle } from '../rng.js';
import type { DemonHunterOptions, DemonHunterState, PlayerState, Town } from '../types.js';
import { buildGraph, neighborsOf } from './graph.js';
import { populateEnemies, populateInns, populateResources } from './populate.js';
import { generatePeople, generatePuzzle } from './puzzle.js';

export function emptyResources(): Record<ResourceType, number> {
  return Object.fromEntries(RESOURCE_TYPES.map((r) => [r, 0])) as Record<ResourceType, number>;
}

export function generateWorld(seed: number, options: DemonHunterOptions = {}): DemonHunterState {
  let s = seed;

  // Towns, named from the registry.
  const names = shuffle(TOWN_NAMES, s);
  s = names.nextSeed;
  const towns: Town[] = [];
  for (let i = 0; i < TOWN_COUNT; i++) {
    const id = `town_${i}`;
    towns.push({
      id,
      name: names.items[i] ?? `Town ${i + 1}`,
      nodeId: `town_${id}`,
      people: [],
      prices: {} as Record<ResourceType, number>,
      stock: {} as Record<ResourceType, number>,
    });
  }

  const built = buildGraph({ towns: towns.map((t) => ({ id: t.id, name: t.name })), clearings: options.clearings }, s);
  s = built.nextSeed;

  s = generatePeople(towns, s);
  const puzzle = generatePuzzle(towns, s);
  s = puzzle.nextSeed;
  s = populateInns(towns, s);

  const enemies = populateEnemies(built.graph, s);
  s = enemies.nextSeed;
  const resources = populateResources(built.graph, s);
  s = resources.nextSeed;

  const startTown = towns[0]!;
  const player: PlayerState = {
    at: built.graph.startNodeId,
    inside: 'town', // the original auto-enters the starting town
    level: 1,
    xp: 0,
    strength: STAT_BASE.strength,
    agility: STAT_BASE.agility,
    range: STAT_BASE.range,
    hp: STAT_BASE.health,
    maxHp: STAT_BASE.health,
    freeStatPicks: 0,
    shuckles: STARTING_SHUCKLES,
    resources: emptyResources(),
    bombs: 0,
    lockpicks: 0,
    magicItems: [],
    flying: false,
    auraUp: false,
    knownClues: [],
    activeTasks: [],
    followers: [],
    suspects: [],
    searchedHouses: [],
    locksmithCharges: 0,
    bindings: [],
    visitedTowns: [startTown.id],
    knownPlaces: Array.from(new Set([...towns.map((t) => t.nodeId), startTown.nodeId, ...neighborsOf(built.graph, startTown.nodeId, { includeWalled: true })])),
    lastTown: startTown.id,
    worldCleared: false,
    blackMarketKnown: false,
    lastEdgeStop: null,
    deaths: 0,
  };

  return {
    seed: s,
    turn: 0,
    phase: 'playing',
    graph: built.graph,
    towns,
    demonId: puzzle.puzzle.demonId,
    items: puzzle.puzzle.items,
    enemies: enemies.enemies,
    resources: resources.resources,
    initialEnemies: structuredClone(enemies.enemies),
    initialResources: Object.fromEntries(Object.entries(resources.resources).filter(([, r]) => r.kind !== 'ore')),
    player,
    combat: null,
    temple: null,
    lair: null,
    dialogue: null,
    innOpen: false,
    result: null,
  };
}
