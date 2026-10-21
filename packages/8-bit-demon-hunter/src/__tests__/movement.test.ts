import { describe, expect, it } from 'vitest';
import { neighborsOf } from '../world/graph.js';
import { getLegalMoves } from '../legalMoves.js';
import { apply, applyText, clearAllEnemies, clearNode, fresh, outsideStart, place, startClearing } from './support.js';

// PORT-PLAN §4, §8, §9 (movement items).

describe('moving around', () => {
  it('starts inside the first town; leave, move to the clearing, enter again', () => {
    let s = fresh();
    expect(s.player.inside).toBe('town');
    expect(() => apply(s, { type: 'move', to: startClearing(s) })).toThrow(/inside the town/);
    s = apply(s, { type: 'leave' });
    expect(s.player.inside).toBeNull();
    clearNode(s, s.player.at);
    const r = applyText(s, { type: 'move', to: startClearing(s) });
    expect(r.summary).toContain('You travel to');
    s = r.state;
    expect(s.player.at).toBe(startClearing(s));
    expect(() => apply(s, { type: 'enter' })).toThrow(/nothing here to enter/);
    clearNode(s, s.player.at);
    s = apply(s, { type: 'move', to: s.graph.startNodeId });
    s = apply(s, { type: 'enter' });
    expect(s.player.inside).toBe('town');
  });

  it('rejects moves to places that are not adjacent and through the sky wall', () => {
    const s = outsideStart();
    expect(() => apply(s, { type: 'move', to: 'temple_fire' })).toThrow(/not next to/);
    expect(() => apply(s, { type: 'move', to: 'nowhere' })).toThrow(/no place/);
    // stand next to the sky temple
    const t = outsideStart();
    clearAllEnemies(t);
    const clearing = neighborsOf(t.graph, 'temple_sky', { includeWalled: true })[0]!;
    t.player.at = clearing;
    expect(() => apply(t, { type: 'move', to: 'temple_sky' })).toThrow(/ring of stone wall/);
  });

  it('look describes the node, its paths, enemies and resources', () => {
    const s = outsideStart();
    clearAllEnemies(s);
    place(s, 'slime', s.player.at, 'slime_a');
    place(s, 'slime', s.player.at, 'slime_b');
    const r = applyText(s, { type: 'look' });
    expect(r.summary).toContain('You are at');
    expect(r.summary).toContain('2 Slimes [slime_a, slime_b]');
    expect(r.summary).toContain('Paths:');
  });

  it('bandits block leaving: the move is cancelled and a fight starts; after killing them you may go', () => {
    let s = outsideStart();
    s.player.strength = 7;
    s.player.maxHp = 20;
    s.player.hp = 20;
    place(s, 'dude_bandit', s.player.at, 'dude_1');
    const dest = startClearing(s);
    let r = applyText(s, { type: 'move', to: dest });
    s = r.state;
    expect(r.summary).toContain('attacks as you try to leave');
    expect(s.player.at).not.toBe(dest);
    expect(s.combat?.enemyId).toBe('dude_1');
    s = apply(s, { type: 'fight' });
    expect(s.enemies['dude_1']).toBeUndefined();
    clearNode(s, dest);
    s = apply(s, { type: 'move', to: dest });
    expect(s.player.at).toBe(dest);
  });

  it('mushrooms follow; five or more attack when you try to leave', () => {
    let s = outsideStart();
    s.player.maxHp = 10;
    s.player.hp = 10;
    for (let i = 0; i < 4; i++) place(s, 'mushroom', s.player.at, `mush_${i}`);
    const dest = startClearing(s);
    clearNode(s, dest);
    let r = applyText(s, { type: 'move', to: dest });
    s = r.state;
    expect(r.summary).toContain('4 Mushrooms follow you');
    expect(s.player.at).toBe(dest);
    for (let i = 0; i < 4; i++) expect(s.enemies[`mush_${i}`]!.at).toBe(dest);
    place(s, 'mushroom', dest, 'mush_4');
    r = applyText(s, { type: 'move', to: s.graph.startNodeId });
    expect(r.summary).toContain('5 Mushrooms crowd around you');
    expect(r.state.player.at).toBe(dest);
    expect(r.state.combat).not.toBeNull();
  });

  it('flying passes bandits and knights but a skeleton still shoots; attacking from the air needs range 3', () => {
    let s = outsideStart();
    s.player.magicItems.push('sky');
    place(s, 'dude_bandit', s.player.at, 'dude_1');
    place(s, 'undead_knight', s.player.at, 'knight_1');
    s = apply(s, { type: 'fly' });
    expect(() => apply(s, { type: 'attack', target: 'dude_1' })).toThrow(/range below 3/);
    const dest = startClearing(s);
    clearNode(s, dest);
    s = apply(s, { type: 'move', to: dest });
    expect(s.player.at).toBe(dest);
    expect(s.player.flying).toBe(true);
    place(s, 'skeleton', dest, 'skel_1');
    s.player.maxHp = 10;
    s.player.hp = 10;
    const r = applyText(s, { type: 'move', to: s.graph.startNodeId });
    expect(r.summary).toContain('fires at you as you fly past');
    expect(r.state.combat?.enemyId).toBe('skel_1');
    // a flying player with range 3 can hit back, and a knight cannot reach a flier
    let t = outsideStart();
    t.player.magicItems.push('sky');
    t.player.range = 3;
    t = apply(t, { type: 'fly' });
    place(t, 'undead_knight', t.player.at, 'knight_2');
    const rt = applyText(t, { type: 'attack', target: 'knight_2' });
    expect(rt.summary).toContain('cannot reach you in the air');
    expect(rt.state.player.hp).toBe(3);
    expect(rt.state.enemies['knight_2']!.hp).toBe(18); // opening + swing
    expect(() => apply(rt.state, { type: 'land' })).toThrow(/in a fight/);
  });

  it('the aura outdoors lets the next move ignore blockers, then drops', () => {
    let s = outsideStart();
    expect(() => apply(s, { type: 'aura' })).toThrow(/no Aura/);
    s.player.magicItems.push('earth');
    place(s, 'undead_knight', s.player.at, 'knight_1');
    s = apply(s, { type: 'aura' });
    expect(s.player.auraUp).toBe(true);
    const dest = startClearing(s);
    clearNode(s, dest);
    const r = applyText(s, { type: 'move', to: dest });
    expect(r.summary).toContain('shields you');
    expect(r.state.player.at).toBe(dest);
    expect(r.state.player.auraUp).toBe(false);
  });

  it('the aura in combat ends the fight with no parting shot', () => {
    let s = outsideStart();
    s.player.magicItems.push('earth');
    s.player.maxHp = 10;
    s.player.hp = 10;
    place(s, 'skeleton', s.player.at, 'skel_1');
    s = apply(s, { type: 'attack', target: 'skel_1' });
    const hp = s.player.hp;
    const r = applyText(s, { type: 'aura' });
    expect(r.state.combat).toBeNull();
    expect(r.state.player.hp).toBe(hp);
    expect(r.summary).toContain('walk away from the fight');
  });

  it('the cape teleports to visited towns only, arriving inside and healed', () => {
    let s = outsideStart();
    s.player.hp = 1;
    expect(() => apply(s, { type: 'teleport', town: s.towns[1]!.id })).toThrow(/no Cape/);
    s.player.magicItems.push('space');
    expect(() => apply(s, { type: 'teleport', town: s.towns[1]!.id })).toThrow(/never been/);
    s.player.visitedTowns.push(s.towns[1]!.id);
    s = apply(s, { type: 'teleport', town: s.towns[1]!.name });
    expect(s.player.at).toBe(s.towns[1]!.nodeId);
    expect(s.player.inside).toBe('town');
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.player.lastTown).toBe(s.towns[1]!.id);
  });

  it('harvesting: a plant in one swing, a tree in four, with a seeded chance of trouble', () => {
    let s = outsideStart();
    clearAllEnemies(s);
    for (const r of Object.values(s.resources)) if (r.at === s.player.at) delete s.resources[r.id];
    s.resources['plant_x'] = { id: 'plant_x', kind: 'plant', at: s.player.at, hp: 1 };
    s.resources['tree_x'] = { id: 'tree_x', kind: 'tree', at: s.player.at, hp: 4 };
    s = apply(s, { type: 'attack', target: 'plant_x' });
    expect(s.player.resources.plant_fiber).toBe(1);
    expect(s.resources['plant_x']).toBeUndefined();
    for (let i = 0; i < 3; i++) s = apply(s, { type: 'attack', target: 'tree_x' });
    expect(s.resources['tree_x']!.hp).toBe(1);
    s = apply(s, { type: 'attack', target: 'tree_x' });
    expect(s.player.resources.wood).toBe(1);
    // with an aggressive enemy about, roughly one swing in ten draws it
    let drawn = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const t = outsideStart(seed);
      clearAllEnemies(t);
      place(t, 'dude_bandit', t.player.at, 'dude_1');
      t.resources['plant_y'] = { id: 'plant_y', kind: 'plant', at: t.player.at, hp: 1 };
      const r = applyText(t, { type: 'attack', target: 'plant_y' });
      if (r.summary.includes('draws the Dude Bandit')) drawn++;
    }
    expect(drawn).toBeGreaterThan(2);
    expect(drawn).toBeLessThan(30);
  });

  it('bombs: need a bomb unless you hold Fire Bombs; hit everything here: enemies by 5, every ore deposit, plants and trees, the sky wall', () => {
    let s = outsideStart();
    clearAllEnemies(s);
    for (const r of Object.values(s.resources)) if (r.at === s.player.at) delete s.resources[r.id];
    expect(() => apply(s, { type: 'bomb' })).toThrow(/no bombs/);
    s.player.bombs = 2;
    place(s, 'wizard', s.player.at, 'wiz_1');
    place(s, 'undead_knight', s.player.at, 'knight_1');
    s.resources['plant_z'] = { id: 'plant_z', kind: 'plant', at: s.player.at, hp: 1 };
    let r = applyText(s, { type: 'bomb' });
    s = r.state;
    expect(s.player.bombs).toBe(1);
    expect(s.enemies['wiz_1']).toBeUndefined();
    expect(s.enemies['knight_1']!.hp).toBe(15);
    expect(s.player.hp).toBe(s.player.maxHp - 2); // the blast catches you too
    expect(r.summary).toContain('The blast catches you too: 2 damage');
    s.player.maxHp = 20;
    s.player.hp = 20; // the rest of this test is about what the blast hits, not about dying
    expect(s.enemies['knight_1']!.attacked).toBe(true);
    expect(s.player.xp).toBe(3);
    expect(s.resources['plant_z']).toBeUndefined(); // burnt, no fiber
    expect(s.player.resources.plant_fiber).toBe(0);
    expect(r.summary).toContain('burn to nothing');
    // the sky wall, and two deposits at once
    const clearing = neighborsOf(s.graph, 'temple_sky', { includeWalled: true })[0]!;
    s.player.at = clearing;
    clearNode(s, clearing, true);
    s.resources['ore_x'] = { id: 'ore_x', kind: 'ore', at: clearing, hp: 0 };
    s.resources['ore_y'] = { id: 'ore_y', kind: 'ore', at: clearing, hp: 0 };
    r = applyText(s, { type: 'bomb' });
    s = r.state;
    expect(r.summary).toContain('way to the Sky Temple is open');
    expect(s.graph.edges.find((e) => e.walled)).toBeUndefined();
    expect(s.resources['ore_x']).toBeUndefined();
    expect(s.resources['ore_y']).toBeUndefined();
    expect((r.summary.match(/rubble/g) ?? []).length).toBe(3); // wall + two deposits, one roll each
    expect(() => apply(s, { type: 'bomb' })).toThrow(/no bombs/);
    s.player.magicItems.push('fire');
    r = applyText(s, { type: 'bomb' });
    expect(r.state.player.bombs).toBe(0); // unlimited: none consumed
    // ore odds over many seeds: ~10% gold, ~40% iron
    let gold = 0;
    let iron = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const t = outsideStart(seed);
      clearAllEnemies(t);
      for (const x of Object.values(t.resources)) if (x.at === t.player.at) delete t.resources[x.id];
      t.player.magicItems.push('fire');
      t.resources['ore_y'] = { id: 'ore_y', kind: 'ore', at: t.player.at, hp: 0 };
      const rt = apply(t, { type: 'bomb' });
      gold += rt.player.resources.gold;
      iron += rt.player.resources.iron_ore;
    }
    expect(gold).toBeGreaterThan(5);
    expect(gold).toBeLessThan(45);
    expect(iron).toBeGreaterThan(50);
    expect(iron).toBeLessThan(120);
  });

  it('the Lady Bandit trades until attacked, then vanishes after a sale', () => {
    let s = outsideStart();
    clearAllEnemies(s);
    place(s, 'lady_bandit', s.player.at, 'lady_1');
    place(s, 'dude_bandit', s.player.at, 'dude_1');
    s.player.shuckles = 15;
    const r = applyText(s, { type: 'talk_bandit' });
    expect(r.summary).toContain('I deal, if you');
    expect(r.state.player.blackMarketKnown).toBe(true);
    expect(s.player.blackMarketKnown).toBe(false);
    expect(() => apply(s, { type: 'buy_from_bandit', item: 'lockpick' })).toThrow(/costs 200/);
    expect(() => apply(s, { type: 'buy_from_bandit', item: 'bomb', amount: 2 })).toThrow(/can afford 1 bomb /);
    s.player.shuckles = 35;
    s = apply(s, { type: 'buy_from_bandit', item: 'bomb', amount: 'all' }); // one deal, as many as she can sell you
    expect(s.player.bombs).toBe(3);
    expect(s.player.shuckles).toBe(5);
    expect(s.enemies['lady_1']).toBeUndefined();
    expect(() => apply(s, { type: 'talk_bandit' })).toThrow(/no Lady Bandit/);
    // attacked ladies do not trade
    const t = outsideStart();
    clearAllEnemies(t);
    const lady = place(t, 'lady_bandit', t.player.at, 'lady_2');
    lady.attacked = true;
    expect(() => apply(t, { type: 'talk_bandit' })).toThrow(/no Lady Bandit/);
  });

  it('a bomb that would kill you is refused with a warning until confirmed; confirmed, it kills you', () => {
    let s = outsideStart(9);
    clearAllEnemies(s);
    s.player.bombs = 2;
    s.player.hp = 2;
    let r = applyText(s, { type: 'bomb' });
    expect(r.summary).toContain('That bomb would kill you');
    expect(r.state.player.bombs).toBe(2);
    expect(r.state.player.hp).toBe(2);
    expect(getLegalMoves(r.state).find((m) => m.move_id === 'bomb')?.description).toContain('WOULD KILL YOU');
    r = applyText(r.state, { type: 'bomb', confirm: true });
    expect(r.state.phase).toBe('dead');
    expect(r.state.player.bombs).toBe(1);
    expect(r.summary).toContain('your own bomb');
    // at 3 HP no warning, and you live
    s.player.hp = 3;
    r = applyText(s, { type: 'bomb' });
    expect(r.summary).not.toContain('would kill you');
    expect(r.state.player.hp).toBe(1);
    expect(r.state.phase).toBe('playing');
  });

  it('every arrival outdoors says what is here: a move, stepping out, the end of a travel', () => {
    let s = fresh(10);
    const clearing = startClearing(s);
    let r = applyText(s, { type: 'leave' });
    s = r.state;
    expect(r.summary).toMatch(/No enemies here\.|Enemies: /);
    clearAllEnemies(s);
    place(s, 'slime', clearing, 'slime_a');
    place(s, 'slime', clearing, 'slime_b');
    place(s, 'snake', clearing, 'snake_a');
    r = applyText(s, { type: 'move', to: clearing });
    expect(r.summary).toContain('You travel to');
    expect(r.summary).toContain('2 Slimes [slime_a, slime_b]');
    expect(r.summary).toContain('1 Snake [snake_a]');
    s = r.state;
    const beyond = neighborsOf(s.graph, clearing).find((n) => n !== s.graph.startNodeId)!;
    place(s, 'slime', beyond, 'slime_c');
    r = applyText(s, { type: 'travel', to: beyond });
    expect(r.summary).toContain('You arrive at');
    expect(r.summary).toContain('1 Slime [slime_c]');
    expect(r.summary).not.toContain('slime_a'); // the hop through the first clearing stays brief
  });
});
