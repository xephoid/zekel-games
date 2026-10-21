import { describe, expect, it } from 'vitest';
import { demonHp } from '../engine/finale.js';
import { apply, applyText, demon, fresh } from './support.js';

// PORT-PLAN §9.

describe('the knife', () => {
  it('stabbing an innocent loses the game; the knife only works face to face in town', () => {
    const s = fresh();
    const innocent = s.towns[0]!.people.find((p) => p.id !== s.demonId)!;
    const elsewhere = s.towns[1]!.people[0]!;
    expect(() => apply(s, { type: 'stab', person: elsewhere.id })).toThrow(/no one called/);
    const outside = apply(s, { type: 'leave' });
    expect(() => apply(outside, { type: 'stab', person: innocent.id })).toThrow(/face to face/);
    const r = applyText(s, { type: 'stab', person: innocent.id });
    expect(r.state.phase).toBe('lost');
    expect(r.state.result?.winner).toBe('demon');
    expect(r.summary).toContain('was no demon');
    expect(r.summary).toContain('turns on you');
    expect(() => apply(r.state, { type: 'look' })).toThrow(/over/);
  });

  it('demon HP is flat: 48, less 8 per binding and per artifact, never below 4; strength does not scale it', () => {
    const s = fresh();
    expect(demonHp(s)).toBe(48);
    s.player.strength = 3;
    expect(demonHp(s)).toBe(48);
    s.player.magicItems = ['sky', 'earth'];
    expect(demonHp(s)).toBe(32);
    s.player.bindings = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(demonHp(s)).toBe(4); // 48 - 72, floored
  });

  it('stabbing the demon starts the lair; the demon summons minions at two thirds; killing it wins', () => {
    let s = fresh(5);
    s.player.strength = 5;
    s.player.agility = 17;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.bindings = ['a']; // 40 HP: nothing wins with nothing held
    s.player.at = s.towns.find((t) => t.id === demon(s).attributes.townId)!.nodeId;
    s.player.inside = 'town';
    s.player.lastTown = demon(s).attributes.townId;
    let r = applyText(s, { type: 'stab', person: demon(s).id });
    s = r.state;
    expect(s.phase).toBe('lair');
    expect(r.summary).toContain('THE DEMON rises before you');
    expect(r.summary).not.toMatch(/\d+ HP\)/);
    expect(s.combat?.enemyId).toBe('demon');
    expect(() => apply(s, { type: 'flee' })).toThrow(/no way out/);
    expect(() => apply(s, { type: 'move', to: 'x' })).toThrow(/in a fight/);
    // opening: range 5 > 3 → one hit of 5 (35). Player faster (17 > 8): your action is owed.
    expect(s.enemies['demon']!.hp).toBe(35);
    r = applyText(s, { type: 'fight' }); // 2 attacks → 25 ≤ 26 → phase 2
    s = r.state;
    expect(r.summary).toContain('Three Demon Minions');
    expect(s.lair?.phase2Done).toBe(true);
    expect(s.combat).not.toBeNull();
    expect(s.combat!.enemyId).toMatch(/^lair_minion_/);
    // fight through the minions (10 HP each, 2 attacks of 5 per action)
    let guard = 0;
    while (s.combat && s.combat.enemyId !== 'demon' && guard++ < 20) s = apply(s, { type: 'fight' });
    expect(s.combat?.enemyId).toBe('demon');
    expect(s.enemies['demon']!.hp).toBeLessThanOrEqual(26);
    guard = 0;
    while (s.phase === 'lair' && guard++ < 20) s = apply(s, { type: 'fight' });
    expect(s.phase).toBe('won');
    expect(s.result?.winner).toBe('player');
    expect(s.lair).toBeNull();
    expect(Object.values(s.enemies).some((e) => e.at === 'lair')).toBe(false);
  });

  it('dying in the lair dissolves it; you can stab again after continuing', () => {
    let s = fresh(6);
    s.player.bindings = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    s.player.at = s.towns.find((t) => t.id === demon(s).attributes.townId)!.nodeId;
    s.player.inside = 'town';
    s.player.lastTown = demon(s).attributes.townId;
    let r = applyText(s, { type: 'stab', person: demon(s).id });
    s = r.state;
    // demon speed 8 vs agility 1, damage 2, player 3 HP: dead on its first action
    expect(s.phase).toBe('dead');
    expect(r.summary).toContain('time runs backwards');
    expect(r.summary).toContain('still know the demon');
    expect(s.lair).toBeNull();
    expect(s.enemies['demon']).toBeUndefined();
    s = apply(s, { type: 'continue' });
    expect(s.phase).toBe('playing');
    s.player.strength = 5;
    s.player.agility = 17;
    s.player.range = 5;
    s.player.at = s.towns.find((t) => t.id === demon(s).attributes.townId)!.nodeId;
    s.player.inside = 'town';
    s.player.lastTown = demon(s).attributes.townId;
    r = applyText(s, { type: 'stab', person: demon(s).id });
    expect(['lair', 'won']).toContain(r.state.phase);
  });

  it('in its last third the demon fires twice per action, not three times', () => {
    let s = fresh(7);
    s.player.strength = 5;
    s.player.agility = 8;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.at = s.towns.find((t) => t.id === demon(s).attributes.townId)!.nodeId;
    s.player.inside = 'town';
    s = apply(s, { type: 'stab', person: demon(s).id });
    expect(s.enemies['demon']!.maxHp).toBe(48);
    s.enemies['demon']!.hp = 12;
    s.lair!.phase2Done = true;
    const r = applyText(s, { type: 'fight' }); // 12 - 5 = 7 ≤ 16: phase 3
    expect(r.summary).toContain('Demon attacks 2 times');
    expect(r.summary).not.toContain('3 times');
  });

  it('what you hold weighs on the demon, and binds its servants: six weakenings mean no minions', () => {
    let s = fresh(8);
    s.player.strength = 5;
    s.player.agility = 20;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.bindings = ['a', 'b', 'c'];
    s.player.magicItems = ['light', 'sky', 'fire'];
    s.player.at = s.towns.find((t) => t.id === demon(s).attributes.townId)!.nodeId;
    s.player.inside = 'town';
    let r = applyText(s, { type: 'stab', person: demon(s).id });
    s = r.state;
    expect(r.summary).toContain('3 bindings and 3 artifacts weigh on it');
    expect(demonHp(s)).toBe(4); // and the opening attack (range 5 > 3) already finishes it
    let guard = 0;
    while (s.phase === 'lair' && guard++ < 20) {
      r = applyText(s, { type: 'fight' });
      s = r.state;
      expect(r.summary).not.toContain('Demon Minions answer');
    }
    expect(s.phase).toBe('won');
  });
});
