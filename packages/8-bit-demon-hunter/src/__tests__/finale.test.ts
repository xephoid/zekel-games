import { describe, expect, it } from 'vitest';
import { demonHp } from '../engine/finale.js';
import { apply, applyText, demon, fresh } from './support.js';

// PORT-PLAN §9.

describe('the accusation', () => {
  it('a wrong accusation loses the game', () => {
    const s = fresh();
    const innocent = s.towns[0]!.people.find((p) => p.id !== s.demonId)!;
    expect(() => apply(s, { type: 'accuse', person: innocent.id })).toThrow(/not met/);
    innocent.hasMet = true;
    const r = applyText(s, { type: 'accuse', person: innocent.id });
    expect(r.state.phase).toBe('lost');
    expect(r.state.result?.winner).toBe('demon');
    expect(r.summary).toContain('was innocent');
    expect(() => apply(r.state, { type: 'look' })).toThrow(/over/);
  });

  it('demon HP follows the binding formula', () => {
    const s = fresh();
    expect(demonHp(s)).toBe(20);
    s.player.strength = 3;
    expect(demonHp(s)).toBe(60);
    s.player.bindings = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(demonHp(s)).toBe(3); // max(1, 20-21) * 3
  });

  it('the right accusation starts the arena; the demon summons minions at two thirds; killing it wins', () => {
    let s = fresh(5);
    s.player.strength = 5;
    s.player.agility = 17;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.bindings = ['a', 'b', 'c', 'd']; // hp = (20-12)*5 = 40
    demon(s).hasMet = true;
    let r = applyText(s, { type: 'accuse', person: demon(s).id });
    s = r.state;
    expect(s.phase).toBe('arena');
    expect(r.summary).toContain('THE DEMON (40 HP');
    expect(s.combat?.enemyId).toBe('demon');
    expect(() => apply(s, { type: 'flee' })).toThrow(/no way out/);
    expect(() => apply(s, { type: 'move', to: 'x' })).toThrow(/in a fight/);
    // opening: range 5 > 3 → one hit of 5 (35). Player faster (17 > 8): your action is owed.
    expect(s.enemies['demon']!.hp).toBe(35);
    r = applyText(s, { type: 'fight' }); // 2 attacks → 25 ≤ 26 → phase 2
    s = r.state;
    expect(r.summary).toContain('Three Demon Minions');
    expect(s.arena?.phase2Done).toBe(true);
    expect(s.combat).not.toBeNull();
    expect(s.combat!.enemyId).toMatch(/^arena_minion_/);
    // fight through the minions (10 HP each, 2 attacks of 5 per action)
    let guard = 0;
    while (s.combat && s.combat.enemyId !== 'demon' && guard++ < 20) s = apply(s, { type: 'fight' });
    expect(s.combat?.enemyId).toBe('demon');
    expect(s.enemies['demon']!.hp).toBe(25);
    guard = 0;
    while (s.phase === 'arena' && guard++ < 20) s = apply(s, { type: 'fight' });
    expect(s.phase).toBe('won');
    expect(s.result?.winner).toBe('player');
    expect(s.arena).toBeNull();
    expect(Object.values(s.enemies).some((e) => e.at === 'arena')).toBe(false);
  });

  it('dying in the arena dissolves it; you can accuse again after continuing', () => {
    let s = fresh(6);
    s.player.bindings = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    demon(s).hasMet = true;
    let r = applyText(s, { type: 'accuse', person: demon(s).id });
    s = r.state;
    // demon speed 8 vs agility 1, damage 2, player 3 HP: dead on its first action
    expect(s.phase).toBe('dead');
    expect(r.summary).toContain('arena dissolves');
    expect(s.arena).toBeNull();
    expect(s.enemies['demon']).toBeUndefined();
    s = apply(s, { type: 'continue' });
    expect(s.phase).toBe('playing');
    s.player.strength = 5;
    s.player.agility = 17;
    s.player.range = 5;
    demon(s).hasMet = true;
    r = applyText(s, { type: 'accuse', person: demon(s).id });
    expect(['arena', 'won']).toContain(r.state.phase);
  });
});
