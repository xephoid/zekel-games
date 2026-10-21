import { describe, expect, it } from 'vitest';
import { applyMove } from '../engine/apply.js';
import { getLegalMoves } from '../legalMoves.js';
import { describeNextStep } from '../nextStep.js';
import { apply, clearAllEnemies, fresh, outsideStart, place } from './support.js';

// Every listed move must be accepted by the engine, in every situation we can
// stage; and next_step must always be well formed.

function allAccepted(state: ReturnType<typeof fresh>, except: string[] = []): void {
  for (const lm of getLegalMoves(state)) {
    if (except.includes(lm.move_id)) continue;
    expect(() => applyMove(state, lm.move), lm.move_id).not.toThrow();
  }
  const ns = describeNextStep(state, 'p1');
  expect(['human_to_move', 'game_over']).toContain(ns.status);
  expect(ns.instruction.length).toBeGreaterThan(10);
  if (ns.status === 'human_to_move') expect(ns.human_response?.ask.length).toBeGreaterThan(3);
  for (const note of ns.facts?.notes ?? []) {
    expect(note).not.toMatch(/apply_move|get_legal_moves|move_id/);
  }
}

describe('legal moves', () => {
  it('inside the starting town', () => {
    const s = fresh();
    const ids = getLegalMoves(s).map((m) => m.move_id);
    expect(ids).toContain('look');
    expect(ids).toContain('inn');
    expect(ids).toContain('leave');
    expect(ids.filter((i) => i.startsWith('talk:'))).toHaveLength(10);
    expect(ids.filter((i) => i.startsWith('stab:'))).toHaveLength(10); // the knife works on anyone here
    expect(ids.some((i) => i.startsWith('search_house:'))).toBe(false); // no key
    allAccepted(s);
  });

  it('outdoors with enemies, resources and a trader', () => {
    const s = outsideStart();
    clearAllEnemies(s);
    place(s, 'slime', s.player.at, 'slime_a');
    place(s, 'lady_bandit', s.player.at, 'lady_a');
    s.player.bombs = 1;
    s.player.shuckles = 300;
    s.resources['ore_a'] = { id: 'ore_a', kind: 'ore', at: s.player.at, hp: 0 };
    const before = getLegalMoves(s).map((m) => m.move_id);
    expect(before).toContain('talk_bandit');
    expect(before.some((i) => i.startsWith('buy_from_bandit'))).toBe(false); // a secret until she offers
    s.player.blackMarketKnown = true;
    const ids = getLegalMoves(s).map((m) => m.move_id);
    expect(ids).toContain('enter');
    expect(ids).toContain('attack:slime_a');
    expect(ids).toContain('bomb');
    expect(ids).toContain('talk_bandit');
    expect(ids).toContain('buy_from_bandit:lockpick');
    expect(ids.some((i) => i.startsWith('move:'))).toBe(true);
    expect(ids).not.toContain('fly');
    allAccepted(s);
  });

  it('in combat, in a conversation, at the inn, in a temple, dead', () => {
    let s = outsideStart();
    s.player.maxHp = 10;
    s.player.hp = 10;
    place(s, 'skeleton', s.player.at, 'skel_a');
    s = apply(s, { type: 'attack', target: 'skel_a' });
    expect(getLegalMoves(s).map((m) => m.move_id)).toEqual(['look', 'fight', 'flee']);
    allAccepted(s);

    let t = fresh();
    t = apply(t, { type: 'talk', person: t.towns[0]!.people[0]!.id });
    expect(getLegalMoves(t).map((m) => m.move_id)).toEqual(['look', 'accept_task', 'decline', 'goodbye']);
    allAccepted(t);

    let u = fresh();
    u.player.shuckles = 100;
    u.player.hp = 1;
    u = apply(u, { type: 'inn' });
    const innIds = getLegalMoves(u).map((m) => m.move_id);
    expect(innIds).toContain('sleep');
    expect(innIds).toContain('train');
    expect(innIds).toContain('leave_inn');
    expect(innIds.filter((i) => i.startsWith('ride:'))).toHaveLength(4);
    allAccepted(u);

    let v = outsideStart();
    clearAllEnemies(v);
    v.player.at = 'temple_light';
    v = apply(v, { type: 'enter' });
    expect(getLegalMoves(v).map((m) => m.move_id)).toEqual(['look', 'gauntlet', 'riddle', 'leave', 'travel']);
    allAccepted(v);
    v = apply(v, { type: 'riddle' });
    expect(getLegalMoves(v).map((m) => m.move_id)).toContain('answer_riddle');
    allAccepted(v, ['answer_riddle']); // the fill-in template has empty text

    let w = outsideStart();
    place(w, 'undead_knight', w.player.at, 'knight_a');
    w = apply(w, { type: 'attack', target: 'knight_a' });
    expect(w.phase).toBe('dead');
    expect(getLegalMoves(w).map((m) => m.move_id)).toEqual(['look', 'continue']);
    allAccepted(w);
  });

  it('after stabbing an innocent nothing is legal and next_step is game_over', () => {
    let s = fresh();
    const innocent = s.towns[0]!.people.find((p) => p.id !== s.demonId)!;
    s = apply(s, { type: 'stab', person: innocent.id });
    expect(getLegalMoves(s)).toEqual([]);
    expect(describeNextStep(s, 'p1').status).toBe('game_over');
  });

  it('the inn offers a level-up when one is earned', () => {
    let s = fresh(3);
    s = apply(s, { type: 'inn' });
    s.player.xp = 1000;
    const ids = getLegalMoves(s).map((m) => m.move_id);
    expect(ids.some((id) => id.startsWith('level_up:'))).toBe(true);
  });
});
