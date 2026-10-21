import { describe, expect, it } from 'vitest';
import { INN_RIDE_COST } from '../data/progression.js';
import { apply, applyText, clearAllEnemies, fresh, place, startClearing } from './support.js';
import { hopDistances, neighborsOf } from '../world/graph.js';

// Ruling 2026-10-21: travel in one go, edge stop before anything that attacks
// on the way out; works for places, quest givers and the nearest inn; a quiet
// paid cart when it is shorter.

function clearWorld(s: ReturnType<typeof fresh>) {
  clearAllEnemies(s);
  s.initialEnemies = {};
}

describe('travel', () => {
  it('walks to a far town in one action through a cleared world and enters it', () => {
    let s = fresh(1);
    clearWorld(s);
    const dest = s.towns[2]!;
    const r = applyText(s, { type: 'travel', to: dest.name });
    s = r.state;
    expect(r.summary).toContain('You set out for');
    expect(r.summary).toContain(`You enter ${dest.name}`);
    expect(s.player.at).toBe(dest.nodeId);
    expect(s.player.inside).toBe('town');
  });

  it('a person resolves to their town; the nearest inn is the closest other town', () => {
    let s = fresh(2);
    clearWorld(s);
    const giver = s.towns[3]!.people[0]!;
    let r = applyText(s, { type: 'travel', person: giver.id });
    expect(r.state.player.at).toBe(s.towns[3]!.nodeId);
    expect(r.state.player.inside).toBe('town');
    s = r.state;
    s = apply(s, { type: 'leave' });
    s.player.at = startClearing(s);
    const dist = hopDistances(s.graph, s.player.at);
    const nearest = s.towns.map((t) => t.nodeId).sort((a, b) => dist[a]! - dist[b]!)[0]!;
    r = applyText(s, { type: 'travel', nearest: 'inn' });
    expect(r.state.player.at).toBe(nearest);
    expect(r.state.player.inside).toBe('town');
    expect(() => apply(r.state, { type: 'travel', nearest: 'inn' })).toThrow(/already in/);
  });

  it('stops at the edge of a place whose occupants would attack on the way out, then goes through when asked again', () => {
    let s = fresh(3);
    clearWorld(s);
    const clearing = startClearing(s);
    const beyond = neighborsOf(s.graph, clearing).find((n) => n !== s.graph.startNodeId && s.graph.nodes[n]!.kind === 'clearing')!;
    s = apply(s, { type: 'leave' }); // step out first: leaving resets the wild
    place(s, 'dude_bandit', clearing, 'dude_1');
    s.player.strength = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    let r = applyText(s, { type: 'travel', to: beyond });
    s = r.state;
    expect(r.summary).toContain(`You stop at the edge of ${s.graph.nodes[clearing]!.name}: a Dude Bandit waits there`);
    expect(s.player.at).toBe(s.graph.startNodeId);
    expect(s.player.inside).toBeNull();
    // going on: walks in, the bandit jumps you on the way out
    r = applyText(s, { type: 'travel', to: beyond });
    s = r.state;
    expect(r.summary).toContain('attacks as you try to leave');
    expect(s.combat?.enemyId).toBe('dude_1');
    expect(() => apply(s, { type: 'travel', to: beyond })).toThrow(/in a fight/);
    s = apply(s, { type: 'fight' });
    s = apply(s, { type: 'fight' });
    expect(s.enemies['dude_1']).toBeUndefined();
    r = applyText(s, { type: 'travel', to: beyond });
    expect(r.state.player.at).toBe(beyond);
    expect(r.summary).toContain('You arrive at');
  });

  it('a mushroom tail that would make a crowd stops you; slimes and snakes never do; the destination itself is never an edge stop', () => {
    let s = fresh(4);
    clearWorld(s);
    const clearing = startClearing(s);
    const beyond = neighborsOf(s.graph, clearing).find((n) => n !== s.graph.startNodeId)!;
    s = apply(s, { type: 'leave' });
    for (let i = 0; i < 3; i++) place(s, 'mushroom', s.graph.startNodeId, `mush_${i}`);
    for (let i = 0; i < 2; i++) place(s, 'mushroom', clearing, `mushc_${i}`);
    place(s, 'slime', clearing, 'slime_1');
    place(s, 'snake', clearing, 'snake_1');
    const r = applyText(s, { type: 'travel', to: beyond });
    expect(r.summary).toContain('a crowd of 5 Mushrooms');
    expect(r.state.player.at).toBe(s.graph.startNodeId);
    // the same enemies at the destination do not stop arrival
    const t = applyText(s, { type: 'travel', to: clearing });
    expect(t.state.player.at).toBe(clearing);
  });

  it('pays for a cart when via_inn is set, the shuckles are there and it is shorter; never otherwise', () => {
    let s = fresh(5);
    clearWorld(s);
    s = apply(s, { type: 'leave' });
    // the farthest town from here
    const dist = hopDistances(s.graph, s.player.at);
    const far = s.towns.map((t) => t.nodeId).sort((a, b) => dist[b]! - dist[a]!)[0]!;
    const farTown = s.towns.find((t) => t.nodeId === far)!;
    expect(dist[far]!).toBeGreaterThan(2);
    s.player.shuckles = INN_RIDE_COST;
    let r = applyText(s, { type: 'travel', to: farTown.name, via_inn: true });
    expect(r.summary).toContain('by way of a cart');
    expect(r.summary).toContain(`for a cart to ${farTown.name}`);
    expect(r.state.player.shuckles).toBe(0);
    expect(r.state.player.at).toBe(far);
    expect(r.state.player.inside).toBe('town');
    // without the flag, or broke: walking
    r = applyText(s, { type: 'travel', to: farTown.name });
    expect(r.summary).not.toContain('cart');
    s.player.shuckles = INN_RIDE_COST - 1;
    r = applyText(s, { type: 'travel', to: farTown.name, via_inn: true });
    expect(r.summary).not.toContain('cart');
  });

  it('refuses nonsense and the Sky Temple behind its wall; leaves a town by itself', () => {
    const s = fresh(6);
    clearWorld(s);
    expect(() => apply(s, { type: 'travel', to: 'Narnia' })).toThrow(/no place called/);
    expect(applyText(s, { type: 'travel' }).summary).toContain('Travel where');
    expect(() => apply(s, { type: 'travel', to: 'temple_sky' })).toThrow(/No path leads/);
    const r = applyText(s, { type: 'travel', to: 'temple_earth' });
    expect(r.summary).toContain('You step out of');
    expect(r.state.player.at).toBe('temple_earth');
    expect(r.state.player.inside).toBeNull();
  });
});
