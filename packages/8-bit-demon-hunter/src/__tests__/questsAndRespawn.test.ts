import { describe, expect, it } from 'vitest';
import { OVERWORLD_ENEMIES } from '../data/enemies.js';
import { apply, applyText, clearAllEnemies, fresh, outsideStart, place } from './support.js';
import { generateWorld } from '../world/generate.js';

// Rulings 2026-10-21: any number of accepted tasks, progressing together;
// the wild respawns when you leave a town or temple; temples have company.

describe('many tasks at once', () => {
  it('two kill tasks for the same monster progress and complete from the same kills', () => {
    let s = fresh(1);
    const [a, b] = s.towns[0]!.people;
    for (const p of [a!, b!]) {
      p.isMinion = false;
      p.task = { ...p.task, type: 'KILL', targetId: 'slime', targetName: 'SLIME', amount: 2, currentAmount: 0, description: 'Kill 2 Slimes', isCompleted: false };
    }
    for (const p of [a!, b!]) {
      s = apply(s, { type: 'talk', person: p.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
    }
    expect(s.player.activeTasks).toEqual([a!.id, b!.id]);
    s = apply(s, { type: 'leave' });
    clearAllEnemies(s);
    s.player.strength = 2;
    place(s, 'slime', s.player.at, 'slime_a');
    place(s, 'slime', s.player.at, 'slime_b');
    s = apply(s, { type: 'attack', target: 'slime_a' });
    const r = applyText(s, { type: 'attack', target: 'slime_b' });
    expect((r.summary.match(/Task complete/g) ?? []).length).toBe(2);
    for (const p of [a!, b!]) expect(r.state.towns[0]!.people.find((x) => x.id === p.id)!.task.isCompleted).toBe(true);
  });

  it('accepting a second task keeps the first, and one person satisfies every matching find task', () => {
    let s = fresh(2);
    const [g1, g2, target] = s.towns[0]!.people;
    g1!.task = { ...g1!.task, type: 'FIND_PERSON', targetId: target!.attributes.pet, targetName: target!.attributes.pet, amount: 1, currentAmount: 0, description: 'Find pet', isCompleted: false };
    g2!.task = { ...g2!.task, type: 'FIND_PERSON', targetId: target!.attributes.color, targetName: target!.attributes.color, amount: 1, currentAmount: 0, description: 'Find colour', isCompleted: false };
    for (const g of [g1!, g2!]) {
      s = apply(s, { type: 'talk', person: g.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
    }
    const r = applyText(s, { type: 'talk', person: target!.id });
    expect(r.summary).toContain('Find pet; Find colour');
    s = apply(r.state, { type: 'found_you' });
    expect(s.towns[0]!.people.find((x) => x.id === g1!.id)!.task.isCompleted).toBe(true);
    expect(s.towns[0]!.people.find((x) => x.id === g2!.id)!.task.isCompleted).toBe(true);
  });

  it('two escorts travel together and both complete on arrival', () => {
    let s = fresh(3);
    const town = s.towns[0]!;
    const dest = s.towns[1]!;
    const [e1, e2] = town.people;
    for (const e of [e1!, e2!]) {
      e.isMinion = false;
      e.task = { ...e.task, type: 'ESCORT', targetId: dest.id, targetName: dest.name, amount: 1, currentAmount: 0, description: `Escort me to ${dest.name}`, isCompleted: false };
    }
    for (const e of [e1!, e2!]) {
      s = apply(s, { type: 'talk', person: e.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
    }
    expect(s.player.followers).toEqual([e1!.id, e2!.id]);
    s.player.magicItems.push('space');
    s.player.visitedTowns.push(dest.id);
    const r = applyText(s, { type: 'teleport', town: dest.id });
    expect((r.summary.match(/Task complete/g) ?? []).length).toBe(2);
    expect(r.state.player.followers).toEqual([]);
    expect(r.state.towns.find((t) => t.id === dest.id)!.people.map((p) => p.id)).toEqual(expect.arrayContaining([e1!.id, e2!.id]));
  });
});

describe('the wild respawns', () => {
  it('leaving a town brings back the monsters, plants and trees as generated; ore stays shattered', () => {
    let s = outsideStart(4);
    const before = Object.keys(s.initialEnemies).length;
    expect(Object.keys(s.enemies).length).toBeLessThan(before); // the door was cleared by the helper
    const ore = Object.values(s.resources).find((r) => r.kind === 'ore')!;
    delete s.resources[ore.id];
    const plant = Object.values(s.initialResources).find((r) => r.kind === 'plant')!;
    delete s.resources[plant.id];
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'leave' });
    expect(Object.keys(s.enemies).sort()).toEqual(Object.keys(s.initialEnemies).sort());
    expect(s.resources[plant.id]).toBeDefined();
    expect(s.resources[ore.id]).toBeUndefined();
  });

  it('a temple visit resets the wild too, and the start town stays gentle after a respawn', () => {
    let s = outsideStart(5);
    clearAllEnemies(s);
    s.player.at = 'temple_earth';
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'leave' });
    expect(Object.keys(s.enemies).length).toBe(Object.keys(s.initialEnemies).length);
    for (const e of Object.values(s.enemies).filter((e) => e.at === s.graph.startNodeId)) expect(['slime', 'mushroom']).toContain(e.type);
  });
});

describe('temples have company', () => {
  it('enemies and resources can stand at a temple node', () => {
    let withEnemies = 0;
    let withResources = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = generateWorld(seed);
      const temples = Object.values(s.graph.nodes).filter((n) => n.kind === 'temple').map((n) => n.id);
      if (Object.values(s.enemies).some((e) => temples.includes(e.at))) withEnemies++;
      if (Object.values(s.resources).some((r) => temples.includes(r.at))) withResources++;
      for (const e of Object.values(s.enemies)) expect(OVERWORLD_ENEMIES.some((d) => d.id === e.type)).toBe(true);
    }
    expect(withEnemies).toBeGreaterThan(25);
    expect(withResources).toBeGreaterThan(25);
  });
});
