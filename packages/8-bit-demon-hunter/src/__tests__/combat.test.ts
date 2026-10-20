import { describe, expect, it } from 'vitest';
import { ENEMY_BY_ID } from '../data/enemies.js';
import { attacksPerAction } from '../engine/helpers.js';
import { apply, applyText, clearAllEnemies, outsideStart, place } from './support.js';

// PORT-PLAN §5.

describe('attacks per action', () => {
  it('is floor(own speed / other speed), at least 1', () => {
    expect(attacksPerAction(1, 1)).toBe(1);
    expect(attacksPerAction(1, 8)).toBe(1);
    expect(attacksPerAction(5, 1)).toBe(5);
    expect(attacksPerAction(5, 3)).toBe(1);
    expect(attacksPerAction(9, 3)).toBe(3);
    expect(attacksPerAction(8, 1)).toBe(8);
    expect(attacksPerAction(5, 3.5)).toBe(1);
    expect(attacksPerAction(9, 3.5)).toBe(2);
  });
});

describe('combat', () => {
  it('a slime: equal range, player faster (4 vs 1), four swings kill it before it replies; XP and powder', () => {
    let s = outsideStart();
    const slime = place(s, 'slime', s.player.at);
    const r = applyText(s, { type: 'attack', target: slime.id });
    s = r.state;
    expect(r.summary).toMatch(/You are faster and act first/);
    expect(r.summary).toContain('You attack 4 times');
    expect(s.player.hp).toBe(3);
    expect(s.combat).toBeNull();
    expect(s.enemies[slime.id]).toBeUndefined();
    expect(s.player.xp).toBe(ENEMY_BY_ID.slime.xp);
    expect(s.player.resources.demon_powder).toBe(1);
    expect(r.summary).toContain('is dead');
  });

  it('a faster enemy acts first; higher enemy range gives it a free opening attack', () => {
    let s = outsideStart();
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.agility = 1;
    const skel = place(s, 'skeleton', s.player.at);
    const r = applyText(s, { type: 'attack', target: skel.id });
    s = r.state;
    expect(r.summary).toContain("Skeleton's range is higher");
    expect(r.summary).toContain('is faster and acts first');
    // opening 1 + its first action (2 attacks: speed 2 vs 1) + your swing + its reply (2)
    expect(s.player.hp).toBe(10 - 1 - 2 - 2);
    expect(s.enemies[skel.id]!.hp).toBe(ENEMY_BY_ID.skeleton.hp - 1);
  });

  it('higher player range gives the player a free opening attack', () => {
    let s = outsideStart();
    s.player.range = 2;
    const slime = place(s, 'slime', s.player.at);
    const r = applyText(s, { type: 'attack', target: slime.id });
    expect(r.summary).toContain('Your range is higher');
    s = r.state;
    // opening hit + first action hit = 2 damage: dead before it acts
    expect(s.enemies[slime.id]).toBeUndefined();
    expect(s.player.hp).toBe(3);
  });

  it('speed multiplies attacks: agility 5 against a slime hits five times', () => {
    let s = outsideStart();
    s.player.agility = 5;
    const knight = place(s, 'undead_knight', s.player.at);
    s.player.maxHp = 30;
    s.player.hp = 30;
    const r = applyText(s, { type: 'attack', target: knight.id });
    s = r.state;
    // knight speed 8 > 5 → knight first: floor(8/5)=1 attack; your swing; its reply.
    expect(s.player.hp).toBe(28);
    expect(s.enemies[knight.id]!.hp).toBe(ENEMY_BY_ID.undead_knight.hp - 1);
    const r2 = applyText(s, { type: 'fight' });
    expect(r2.summary).toContain('You attack');
    const s2 = r2.state;
    expect(s2.enemies[knight.id]!.hp).toBe(ENEMY_BY_ID.undead_knight.hp - 2);
    expect(s2.player.hp).toBe(27);
    // and a slime takes 5 hits in one action
    let t = outsideStart();
    t.player.agility = 5;
    t.player.strength = 1;
    const slime = place(t, 'slime', t.player.at);
    const rt = applyText(t, { type: 'attack', target: slime.id });
    expect(rt.summary).toContain('You attack 5 times');
    expect(rt.state.enemies[slime.id]).toBeUndefined();
  });

  it('a knight at agility 1 kills a 3 HP player in one action, and death resets stats but keeps the rest', () => {
    let s = outsideStart();
    s.player.xp = 50;
    s.player.level = 4;
    s.player.strength = 3;
    s.player.shuckles = 99;
    s.player.knownClues.push({ text: 'The demon is not a Baker', isGood: false });
    const knight = place(s, 'undead_knight', s.player.at);
    const r = applyText(s, { type: 'attack', target: knight.id });
    s = r.state;
    expect(s.phase).toBe('dead');
    expect(s.player.hp).toBe(0);
    expect(r.summary).toContain('killed by an Undead Knight');
    expect(() => apply(s, { type: 'look' })).not.toThrow();
    expect(() => apply(s, { type: 'move', to: 'x' })).toThrow(/dead/);
    const c = applyText(s, { type: 'continue' });
    s = c.state;
    expect(s.phase).toBe('playing');
    expect(s.player.level).toBe(1);
    expect(s.player.xp).toBe(0);
    expect(s.player.strength).toBe(1);
    expect(s.player.hp).toBe(3);
    expect(s.player.maxHp).toBe(3);
    expect(s.player.shuckles).toBe(99);
    expect(s.player.knownClues).toHaveLength(1);
    expect(s.player.inside).toBe('town');
    expect(s.player.at).toBe(s.graph.startNodeId);
  });

  it('fleeing always works; skeletons and knights take a parting shot, slimes do not', () => {
    let s = outsideStart();
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.agility = 1;
    const slime = place(s, 'slime', s.player.at);
    s = apply(s, { type: 'attack', target: slime.id }); // hp 9 after its reply
    const r = applyText(s, { type: 'flee' });
    expect(r.state.combat).toBeNull();
    expect(r.state.player.hp).toBe(9);
    expect(r.summary).toContain('You got away');

    let t = outsideStart();
    t.player.maxHp = 10;
    t.player.hp = 10;
    t.player.agility = 1;
    const skel = place(t, 'skeleton', t.player.at);
    t = apply(t, { type: 'attack', target: skel.id }); // 10 - 1 opening - 2 - 2 = 5
    expect(t.player.hp).toBe(5);
    const r2 = applyText(t, { type: 'flee' });
    expect(r2.summary).toContain('attacks as you run');
    expect(r2.state.player.hp).toBe(4);
    expect(r2.state.combat).toBeNull();
  });

  it('a wounded snake flees half the time (seeded), to a neighbouring node', () => {
    let fled = 0;
    let fought = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = outsideStart(seed);
      s.player.maxHp = 20;
      s.player.hp = 20;
      s.player.agility = 1;
      const snake = place(s, 'snake', s.player.at);
      // snake faster: acts first undamaged (attacks); your swing wounds it; then 50% flee
      const r = applyText(s, { type: 'attack', target: snake.id });
      expect(r.state.player.hp).toBeLessThan(20);
      if (r.state.combat === null && r.state.enemies[snake.id]) {
        fled++;
        expect(r.summary).toContain('slithers away');
        expect(r.state.enemies[snake.id]!.at).not.toBe(s.player.at);
      } else fought++;
    }
    expect(fled).toBeGreaterThan(5);
    expect(fought).toBeGreaterThan(5);
  });

  it('a wizard waits, then runs when hit; half the time it teleports to another clearing', () => {
    let teleported = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let s = outsideStart(seed);
      clearAllEnemies(s);
      s.player.agility = 1;
      const wiz = place(s, 'wizard', s.player.at);
      const r = applyText(s, { type: 'attack', target: wiz.id });
      s = r.state;
      // wizard range 3 > 1: opening shot; speed 1.5 > 1: acts first, but it only "watches";
      // your swing wounds it and it runs
      expect(r.summary).toContain('watches you warily');
      expect(s.player.hp).toBe(2);
      expect(s.combat).toBeNull();
      expect(s.enemies[wiz.id]!.hp).toBe(ENEMY_BY_ID.wizard.hp - 1);
      expect(s.enemies[wiz.id]!.at).not.toBe(s.player.at);
      if (r.summary.includes('teleports')) {
        teleported++;
        expect(s.graph.nodes[s.enemies[wiz.id]!.at]!.kind).toBe('clearing');
      }
    }
    expect(teleported).toBeGreaterThan(3);
  });

  it('a strong enough player kills a wizard before it can run', () => {
    let s = outsideStart();
    clearAllEnemies(s);
    s.player.worldCleared = true; // not testing the bonus here
    s.player.strength = 5;
    s.player.range = 3; // no opening for the wizard
    const wiz = place(s, 'wizard', s.player.at);
    s = apply(s, { type: 'attack', target: wiz.id });
    expect(s.enemies[wiz.id]).toBeUndefined();
    expect(s.player.xp).toBe(ENEMY_BY_ID.wizard.xp);
  });

  it('refuses to attack something that is not here, or while the aura is up', () => {
    const s = outsideStart();
    expect(() => apply(s, { type: 'attack', target: 'slime_999' })).toThrow(/no "slime_999" here/);
    s.player.magicItems.push('earth');
    const a = apply(s, { type: 'aura' });
    const slime = place(a, 'slime', a.player.at);
    expect(() => apply(a, { type: 'attack', target: slime.id })).toThrow(/Aura/);
  });

  it('kill tasks progress and complete from kills', () => {
    let s = outsideStart();
    const giver = s.towns[0]!.people.find((p) => p.task.type === 'KILL' && p.task.targetId === 'slime') ?? s.towns[0]!.people[0]!;
    giver.task = { ...giver.task, type: 'KILL', targetId: 'slime', targetName: 'SLIME', amount: 2, currentAmount: 0, description: 'Kill 2 Slimes', isCompleted: false };
    s.player.activeTaskGiver = giver.id;
    s.player.strength = 2;
    for (let i = 0; i < 2; i++) {
      const slime = place(s, 'slime', s.player.at, `slime_t${i}`);
      s = apply(s, { type: 'attack', target: slime.id });
    }
    const task = s.towns[0]!.people.find((p) => p.id === giver.id)!.task;
    expect(task.currentAmount).toBe(2);
    expect(task.isCompleted).toBe(true);
  });

  it('clearing the last overworld enemy pays the 100 XP bonus once', () => {
    let s = outsideStart();
    clearAllEnemies(s);
    const slime = place(s, 'slime', s.player.at);
    s.player.strength = 2;
    const r = applyText(s, { type: 'attack', target: slime.id });
    expect(r.summary).toContain('every monster in the world is dead');
    expect(r.state.player.xp).toBe(ENEMY_BY_ID.slime.xp + 100);
    expect(r.state.player.worldCleared).toBe(true);
  });

  it('levelling: xp past the curve lets you spend a level; agility climbs by 4; health heals', () => {
    let s = outsideStart();
    expect(() => apply(s, { type: 'level_up', stat: 'strength' })).toThrow(/no level/);
    s.player.xp = 4;
    s.player.hp = 1;
    s = apply(s, { type: 'level_up', stat: 'agility' });
    expect(s.player.level).toBe(2);
    expect(s.player.agility).toBe(8);
    expect(() => apply(s, { type: 'level_up', stat: 'strength' })).toThrow(/no level/);
    s.player.xp = 8;
    s = apply(s, { type: 'level_up', stat: 'health' });
    expect(s.player.maxHp).toBe(4);
    expect(s.player.hp).toBe(4);
    s.player.strength = 5;
    s.player.xp = 16;
    expect(() => apply(s, { type: 'level_up', stat: 'strength' })).toThrow(/maximum/);
    // a free Blacksmith pick does not consume a level
    s.player.freeStatPicks = 1;
    s.player.xp = 0;
    s = apply(s, { type: 'level_up', stat: 'range' });
    expect(s.player.level).toBe(3);
    expect(s.player.range).toBe(2);
    expect(s.player.freeStatPicks).toBe(0);
  });
});
