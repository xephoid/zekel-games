import { describe, expect, it } from 'vitest';
import { ENEMY_BY_ID } from '../data/enemies.js';
import { MAGIC_ITEMS } from '../data/magicItems.js';
import { buyPrice, sellPrice } from '../data/resources.js';
import { RIDDLES } from '../data/riddles.js';
import { getView } from '../views.js';
import { apply, clearAllEnemies, fresh, outsideStart, place } from './support.js';

// Post-port §1a: everything the player is entitled to see is recoverable from
// getPlayerView in structured form (ids the move language uses, numbers, not
// prose). The classification table is POST-PORT.md §2.

type AnyView = Record<string, any>;

describe('view completeness', () => {
  it('outdoors: the place, every path with its walled flag, every enemy and resource by id and HP, the trader', () => {
    const s = outsideStart(3);
    clearAllEnemies(s);
    for (const r of Object.values(s.resources)) if (r.at === s.player.at) delete s.resources[r.id];
    place(s, 'slime', s.player.at, 'slime_a');
    place(s, 'skeleton', s.player.at, 'skel_a');
    const lady = place(s, 'lady_bandit', s.player.at, 'lady_a');
    s.resources['ore_a'] = { id: 'ore_a', kind: 'ore', at: s.player.at, hp: 0 };
    s.resources['tree_a'] = { id: 'tree_a', kind: 'tree', at: s.player.at, hp: 2 };
    const v = getView(s) as AnyView;
    expect(v.you.location).toMatchObject({ node: s.player.at, name: s.graph.nodes[s.player.at]!.name, kind: 'town', inside: null, flying: false, aura_up: false });
    const here = v.here;
    expect(here.id).toBe(s.player.at);
    const pathIds = here.paths.map((x: AnyView) => x.to).sort();
    const expected = s.graph.edges.filter((e) => e.a === s.player.at || e.b === s.player.at).map((e) => (e.a === s.player.at ? e.b : e.a)).sort();
    expect(pathIds).toEqual(expected);
    for (const x of here.paths) expect(typeof x.walled).toBe('boolean');
    const ids = here.enemies.flatMap((g: AnyView) => g.ids).sort();
    expect(ids).toEqual(['lady_a', 'skel_a', 'slime_a']);
    const skel = here.enemies.find((g: AnyView) => g.type === 'skeleton');
    expect(skel.hp).toEqual([ENEMY_BY_ID.skeleton.hp]);
    expect(skel.count).toBe(1);
    expect(here.resources.map((g: AnyView) => g.ids).flat().sort()).toEqual(['ore_a', 'tree_a']);
    expect(here.trader).toBe(true);
    lady.attacked = true;
    expect((getView(s) as AnyView).here.trader).toBe(false);
  });

  it('the player: every stat, cap, resource, item, binding, task and follower', () => {
    let s = fresh(4);
    s.player.magicItems.push('sky', 'fire');
    s.player.bindings.push('Orb of Flesh');
    s.player.bombs = 2;
    s.player.lockpicks = 1;
    s.player.locksmithCharges = 1;
    s.player.resources.wood = 3;
    const giver = s.towns[0]!.people[1]!;
    s = apply(s, { type: 'talk', person: giver.id });
    s = apply(s, { type: 'accept_task' });
    const v = getView(s) as AnyView;
    expect(v.you).toMatchObject({
      hp: 3, max_hp: 3, level: 1, max_level: 10, xp: 0, xp_for_next_level: 4, can_level_up: false, free_stat_picks: 0,
      strength: 1, agility: 4, range: 1, shuckles: 5, lockpicks: 1, locksmith_favours: 1, deaths: 0, world_cleared: false,
    });
    expect(v.you.stat_caps).toEqual({ strength: 5, agility: 20, health: 10, range: 5 });
    expect(v.you.resources.Wood).toBe(3);
    expect(v.you.bombs).toBe('unlimited (Fire Bombs)');
    expect(v.you.magic_items).toEqual([MAGIC_ITEMS.sky.name, MAGIC_ITEMS.fire.name]);
    expect(v.you.bindings).toEqual(['Orb of Flesh']);
    expect(v.you.active_task).toMatchObject({ giver: giver.name, giver_id: giver.id, description: giver.task.description, progress: '0/' + giver.task.amount, completed: false });
    if (giver.task.type === 'ESCORT') expect(v.you.travelling_with).toBe(giver.name);
    else expect(v.you.travelling_with).toBeNull();
  });

  it('in town: every person by id with met flag; met people with pet, colour, item, town, rumour, task; the inn with prices and stock', () => {
    let s = fresh(5);
    const town = s.towns[0]!;
    const p = town.people[2]!;
    s = apply(s, { type: 'talk', person: p.id });
    s = apply(s, { type: 'goodbye' });
    const v = getView(s) as AnyView;
    expect(v.here.town_id).toBe(town.id);
    expect(v.here.people.map((x: AnyView) => x.id).sort()).toEqual(town.people.map((x) => x.id).sort());
    const card = v.here.people.find((x: AnyView) => x.id === p.id);
    expect(card).toMatchObject({ met: true, pet: p.attributes.pet, color: p.attributes.color, town: town.name, occupation: p.attributes.occupation });
    expect(card.item).toBe(s.items.find((i) => i.id === p.attributes.item)!.name);
    expect(card.rumour).toBe(p.clues.bad?.text ?? 'I know the truth!');
    expect(card.task).toMatchObject({ description: p.task.description, completed: false, reward_claimed: false });
    for (const r of ['wood', 'gold'] as const) {
      const row = v.here.inn.trade.find((x: AnyView) => x.resource === r);
      expect(row).toMatchObject({ sell_price: sellPrice(r, town.prices[r]), buy_price: buyPrice(r, town.prices[r]), inn_stock: town.stock[r], you_have: 0 });
    }
    expect(v.here.inn.services).toEqual({ sleep: 5, train: 50, ride: 50 });
  });

  it('the clue book: every clue with its kind, everyone met anywhere, suspects, bindings; the towns with visited flags; the temples with completion', () => {
    let s = fresh(6);
    const p = s.towns[0]!.people[0]!;
    s = apply(s, { type: 'talk', person: p.id });
    s = apply(s, { type: 'goodbye' });
    s = apply(s, { type: 'mark_suspect', person: p.id });
    s.player.magicItems.push('light');
    const v = getView(s) as AnyView;
    expect(v.clue_book.clues.length).toBe(s.player.knownClues.length);
    for (const c of v.clue_book.clues) expect(['rumour', 'secret', 'special']).toContain(c.kind);
    expect(v.clue_book.people_met.map((x: AnyView) => x.id)).toEqual([p.id]);
    expect(v.clue_book.suspects).toEqual([p.name]);
    expect(v.clue_book.max_suspects).toBe(10);
    expect(v.towns.map((t: AnyView) => t.id).sort()).toEqual(s.towns.map((t) => t.id).sort());
    expect(v.towns.find((t: AnyView) => t.id === s.towns[0]!.id).visited).toBe(true);
    expect(v.towns.find((t: AnyView) => t.id === s.towns[1]!.id).visited).toBe(false);
    expect(v.temples.map((t: AnyView) => t.id).sort()).toEqual(['temple_earth', 'temple_fire', 'temple_light', 'temple_sky', 'temple_space']);
    expect(v.temples.find((t: AnyView) => t.id === 'temple_light').completed).toBe(true);
  });

  it('combat: the enemy by id with HP, speed, range, damage; attacks per action both ways; reach and flee flags', () => {
    let s = outsideStart(7);
    s.player.maxHp = 10;
    s.player.hp = 10;
    place(s, 'undead_knight', s.player.at, 'knight_a');
    s = apply(s, { type: 'attack', target: 'knight_a' });
    const v = getView(s) as AnyView;
    expect(v.combat.enemy).toMatchObject({ id: 'knight_a', name: 'Undead Knight', max_hp: 20, speed: 8, range: 1, damage: 1 });
    expect(v.combat.enemy.hp).toBe(s.enemies['knight_a']!.hp);
    expect(v.combat).toMatchObject({ your_attacks_per_action: 1, its_attacks_per_action: 2, it_can_reach_you: true, you_can_attack: true, can_flee: true });
  });

  it('temple and riddle: the challenge mode, guardians remaining, the riddle text', () => {
    let s = outsideStart(8);
    clearAllEnemies(s);
    s.player.at = 'temple_space';
    s = apply(s, { type: 'enter' });
    s = apply(s, { type: 'gauntlet' });
    let v = getView(s) as AnyView;
    expect(v.here).toMatchObject({ temple: 'Space Temple', item: MAGIC_ITEMS.space.name, already_taken: false });
    expect(v.here.challenge).toMatchObject({ mode: 'gauntlet', guardian: 'Arachne', guardians_total: 5, guardians_remaining: 5 });
    s = apply(s, { type: 'riddle' });
    v = getView(s) as AnyView;
    expect(v.here.challenge.mode).toBe('riddle');
    expect(v.here.challenge.riddle).toBe(RIDDLES.space.text);
  });

  it('dialogue and inn flags; the arena; the result', () => {
    let s = fresh(9);
    const p = s.towns[0]!.people[3]!;
    s = apply(s, { type: 'talk', person: p.id });
    let v = getView(s) as AnyView;
    expect(v.dialogue).toEqual({ with: p.name, person_id: p.id, stage: 'offer' });
    s = apply(s, { type: 'goodbye' });
    s = apply(s, { type: 'inn' });
    expect((getView(s) as AnyView).inn_open).toBe(true);
    s = apply(s, { type: 'leave_inn' });
    const d = s.towns.flatMap((t) => t.people).find((x) => x.id === s.demonId)!;
    d.hasMet = true;
    s.player.strength = 5;
    s.player.agility = 20;
    s.player.range = 5;
    s.player.maxHp = 10;
    s.player.hp = 10;
    s.player.bindings = ['a', 'b', 'c', 'd', 'e', 'f']; // (20 - 18) × 5 = 10 HP
    s = apply(s, { type: 'accuse', person: d.id });
    v = getView(s) as AnyView;
    expect(v.phase).toBe('arena');
    // the opening attack (range 5 > 3) already knocks it to 5/10: phase two, three minions queued
    expect(v.arena).toMatchObject({ demon_max_hp: 10, minions_summoned: true, minions_left: 3 });
    expect(v.arena.demon_hp).toBe(s.enemies['demon']!.hp);
    let guard = 0;
    while (s.phase === 'arena' && guard++ < 40) s = apply(s, { type: 'fight' });
    v = getView(s) as AnyView;
    expect(v.phase).toBe('won');
    expect(v.result).toEqual(s.result);
  });
});
