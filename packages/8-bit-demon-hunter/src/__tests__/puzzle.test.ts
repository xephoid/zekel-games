import { describe, expect, it } from 'vitest';
import { OVERWORLD_ENEMIES } from '../data/enemies.js';
import { MINIONS_PER_TOWN, PEOPLE_PER_TOWN, TOWN_COUNT } from '../data/progression.js';
import { OCCUPATIONS } from '../data/registries.js';
import { generateWorld } from '../world/generate.js';
import { movePersonToTown, regenerateClues } from '../world/puzzle.js';
import type { Clue, DemonHunterState, Person } from '../types.js';

// Ported invariants of the original DemonLogic (PORT-PLAN §11).

function people(s: DemonHunterState): Person[] {
  return s.towns.flatMap((t) => t.people);
}
function demonOf(s: DemonHunterState): Person {
  return people(s).find((p) => p.id === s.demonId)!;
}

/** Does the clue hold for the demon? */
function clueIsTrue(s: DemonHunterState, clue: Clue): boolean {
  const demon = demonOf(s);
  const attr = clue.relatedAttribute!;
  const matches = demon.attributes[attr.key] === attr.value;
  return clue.isGood ? matches : !matches;
}

describe('the mystery', () => {
  it('has one demon, two minions per town, ten people per town, unique occupations per town, unique items', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = generateWorld(seed);
      const all = people(s);
      expect(s.towns).toHaveLength(TOWN_COUNT);
      expect(all.filter((p) => p.isDemon)).toHaveLength(1);
      expect(all.filter((p) => p.isMinion)).toHaveLength(TOWN_COUNT * MINIONS_PER_TOWN);
      for (const t of s.towns) expect(t.people.filter((p) => p.isMinion), `seed ${seed}: ${t.name}`).toHaveLength(MINIONS_PER_TOWN); // two in every town
      expect(demonOf(s).isMinion).toBe(false);
      for (const town of s.towns) {
        expect(town.people).toHaveLength(PEOPLE_PER_TOWN);
        expect(new Set(town.people.map((p) => p.attributes.occupation)).size).toBe(OCCUPATIONS.length);
        for (const p of town.people) expect(p.attributes.townId).toBe(town.id);
      }
      expect(new Set(all.map((p) => p.attributes.item)).size).toBe(all.length);
      expect(new Set(all.map((p) => p.name)).size).toBe(all.length); // PORT: unique names
      expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    }
  });

  it('spreads exactly five good clues, one per town, all true; every other clue is a true negation', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = generateWorld(seed);
      const all = people(s);
      const good = all.filter((p) => p.clues.good);
      expect(good).toHaveLength(5);
      expect(new Set(good.map((p) => p.attributes.townId)).size).toBe(5);
      for (const p of good) {
        expect(p.isDemon || p.isMinion).toBe(false);
        expect(clueIsTrue(s, p.clues.good!)).toBe(true);
        expect(p.clues.bad).toBeUndefined();
      }
      for (const p of all.filter((p) => !p.isDemon && !p.isMinion && !p.clues.good)) {
        expect(p.clues.bad, `${p.id} has a rumour`).toBeDefined();
        expect(p.clues.bad!.isGood).toBe(false);
        expect(clueIsTrue(s, p.clues.bad!)).toBe(true);
      }
    }
  });

  it('makes the demon and every minion lie: their rumour contradicts the truth', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = generateWorld(seed);
      for (const liar of people(s).filter((p) => p.isDemon || p.isMinion)) {
        expect(liar.clues.good).toBeUndefined();
        expect(liar.clues.bad).toBeDefined();
        expect(clueIsTrue(s, liar.clues.bad!)).toBe(false);
      }
    }
  });

  it('gives everyone a task; merchants escort; exactly one good-clue holder offers a magic item; no self-conflicts', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = generateWorld(seed);
      const all = people(s);
      for (const p of all) {
        expect(p.task.giverId).toBe(p.id);
        expect(p.task.reward).toBe(p.clues.good ? 'CLUE' : 'ITEM');
        expect(p.task.isCompleted).toBe(false);
        if (p.task.type === 'ESCORT') expect(p.task.targetId).not.toBe(p.attributes.townId);
        if (p.task.type === 'FIND_PERSON') {
          expect([p.attributes.occupation, p.attributes.pet, p.attributes.color]).not.toContain(p.task.targetId);
        }
        if (p.task.type === 'KILL') {
          const def = OVERWORLD_ENEMIES.find((e) => e.id === p.task.targetId);
          expect(def, `kill task targets an overworld enemy (${p.task.targetId})`).toBeDefined();
          expect(p.task.amount).toBe(def!.toKill);
        }
      }
      for (const m of all.filter((p) => p.attributes.occupation === 'Merchant')) expect(m.task.type).toBe('ESCORT');
      const goodWithMagic = all.filter((p) => p.clues.good && p.task.type === 'FIND_ITEM');
      expect(goodWithMagic).toHaveLength(1);
    }
  });

  it('hands out game tips in the starting town and lore everywhere else', () => {
    const s = generateWorld(5);
    for (const p of s.towns[0]!.people) expect(p.tip.length).toBeGreaterThan(0);
    const tips = new Set(s.towns[0]!.people.map((p) => p.tip));
    for (const town of s.towns.slice(1)) {
      for (const p of town.people) {
        expect(p.tip.length).toBeGreaterThan(0);
        expect(tips.has(p.tip)).toBe(false);
      }
    }
  });

  it('moving the demon and regenerating puts the town clue in the new town', () => {
    const s = generateWorld(9);
    const demon = demonOf(s);
    const from = demon.attributes.townId;
    const to = s.towns.find((t) => t.id !== from)!.id;
    movePersonToTown(s.towns, demon.id, to);
    expect(s.towns.find((t) => t.id === from)!.people).not.toContain(demon);
    expect(s.towns.find((t) => t.id === to)!.people).toContain(demon);
    s.seed = regenerateClues(s.towns, s.demonId, s.items, s.seed);
    const townClue = people(s).find((p) => p.clues.good?.relatedAttribute?.key === 'townId')!.clues.good!;
    expect(townClue.relatedAttribute!.value).toBe(to);
    expect(townClue.text).toBe(`The demon is in ${s.towns.find((t) => t.id === to)!.name}`);
  });

  it('is deterministic per seed', () => {
    expect(generateWorld(77)).toEqual(generateWorld(77));
    expect(generateWorld(77).demonId === generateWorld(78).demonId && JSON.stringify(generateWorld(77)) === JSON.stringify(generateWorld(78))).toBe(false);
  });
});
