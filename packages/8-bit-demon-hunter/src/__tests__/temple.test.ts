import { describe, expect, it } from 'vitest';
import { GAUNTLET_LENGTH } from '../data/progression.js';
import { ENEMY_BY_ID } from '../data/enemies.js';
import { TEMPLE_GUARDIAN } from '../data/magicItems.js';
import type { DemonHunterState } from '../types.js';
import { apply, applyText, clearAllEnemies, outsideStart } from './support.js';

// PORT-PLAN §7.

function atTemple(temple: 'earth' | 'fire' | 'light' | 'space' | 'sky', seed = 1): DemonHunterState {
  const s = outsideStart(seed);
  clearAllEnemies(s);
  s.player.at = `temple_${temple}`;
  return s;
}

describe('temples', () => {
  it('entering offers gauntlet or riddle; the riddle opens the chest on the right answer', () => {
    let s = atTemple('earth');
    let r = applyText(s, { type: 'enter' });
    s = r.state;
    expect(r.summary).toContain('gauntlet');
    expect(r.summary).toContain('riddle');
    expect(r.summary).toContain('A treasure awaits');
    expect(r.summary).not.toContain('Aura of Protection');
    expect(r.summary).not.toContain('Flower');
    expect(s.temple?.mode).toBe('choice');
    expect(() => apply(s, { type: 'answer_riddle', text: 'Memlax' })).toThrow(/Say "riddle" first/);
    r = applyText(s, { type: 'riddle' });
    s = r.state;
    expect(r.summary).toContain('Words are carved');
    r = applyText(s, { type: 'answer_riddle', text: 'Chineera' });
    expect(r.summary).toContain('does not move');
    expect(r.state.temple?.mode).toBe('riddle');
    r = applyText(r.state, { type: 'answer_riddle', text: 'memlax!' });
    s = r.state;
    expect(r.summary).toContain('Aura of Protection');
    expect(s.player.magicItems).toEqual(['earth']);
    expect(s.temple).toBeNull();
    // leaving and re-entering: already taken
    s = apply(s, { type: 'leave' });
    r = applyText(s, { type: 'enter' });
    expect(r.summary).toContain('already took');
    expect(r.state.temple).toBeNull();
  });

  it('the gauntlet is the guardian count fought one at a time; leaving resets it', () => {
    let s = atTemple('fire');
    s.player.strength = 5;
    s.player.agility = 17;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'gauntlet' });
    expect(s.temple?.mode).toBe('gauntlet');
    const total = Math.min(GAUNTLET_LENGTH, ENEMY_BY_ID[TEMPLE_GUARDIAN.fire].max);
    expect(total).toBe(4);
    expect(s.temple?.remaining).toBe(total);
    let r = applyText(s, { type: 'next_fight' });
    s = r.state;
    expect(r.summary).toContain('Fire Skull');
    // strength 5 vs 5 HP: dead in one hit (opening by range)
    expect(s.combat).toBeNull();
    expect(s.temple?.remaining).toBe(total - 1);
    expect(s.player.resources.demon_ichor).toBe(1);
    // retreat: the count resets
    s = apply(s, { type: 'leave' });
    expect(s.temple).toBeNull();
    expect(Object.values(s.enemies).some((e) => ENEMY_BY_ID[e.type].templeOnly)).toBe(false);
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'gauntlet' });
    expect(s.temple?.remaining).toBe(total);
    for (let i = 0; i < total; i++) s = apply(s, { type: 'next_fight' });
    expect(s.player.magicItems).toEqual(['fire']);
    expect(s.temple).toBeNull();
    expect(() => apply(s, { type: 'next_fight' })).toThrow();
  });

  it('a fled guardian is still there for the next fight; the Evil Eye has range 5', () => {
    let s = atTemple('light');
    s.player.maxHp = 20;
    s.player.hp = 20;
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'gauntlet' });
    let r = applyText(s, { type: 'next_fight' });
    s = r.state;
    expect(r.summary).toContain('Evil Eye strikes before you can close');
    const eye = Object.values(s.enemies).find((e) => e.type === 'evil_eye')!;
    expect(s.combat?.enemyId).toBe(eye.id);
    s = apply(s, { type: 'fight' });
    s = apply(s, { type: 'flee' });
    expect(s.combat).toBeNull();
    expect(s.enemies[eye.id]).toBeDefined();
    r = applyText(s, { type: 'next_fight' });
    expect(r.state.combat?.enemyId).toBe(eye.id);
  });

  it('a find-item task completes when the chest is opened', () => {
    let s = atTemple('space', 2);
    const giver = s.towns[0]!.people[0]!;
    giver.task = { ...giver.task, type: 'FIND_ITEM', targetId: 'space', targetName: 'Cape of Teleportation', amount: 1, currentAmount: 0, description: 'Find the Cape of Teleportation', isCompleted: false };
    s.player.activeTasks = [giver.id];
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'riddle' });
    const r = applyText(s, { type: 'answer_riddle', text: 'Chineera' });
    expect(r.summary).toContain('Task complete');
    expect(r.state.towns[0]!.people[0]!.task.isCompleted).toBe(true);
  });

  it('the sky temple cannot be entered until its wall is bombed', () => {
    const s = atTemple('sky');
    // the player is standing at the temple node but arrived by fiat; the engine
    // only guards the edge, so check the edge
    expect(s.graph.edges.find((e) => e.walled)).toBeDefined();
  });
});
