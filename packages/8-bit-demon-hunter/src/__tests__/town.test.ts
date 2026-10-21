import { describe, expect, it } from 'vitest';
import { INN_RIDE_COST, INN_SLEEP_COST, INN_TRAIN_COST, INN_TRAIN_XP, MERCHANT_SHUCKLES, SOLDIER_TRAINING_XP } from '../data/progression.js';
import { buyPrice, sellPrice } from '../data/resources.js';
import type { DemonHunterState, Person } from '../types.js';
import { apply, applyText, demon, fresh } from './support.js';
import { getLegalMoves } from '../legalMoves.js';

// PORT-PLAN §6.

function townPeople(s: DemonHunterState): Person[] {
  return s.towns[0]!.people;
}
function byOcc(s: DemonHunterState, occ: string): Person {
  return townPeople(s).find((p) => p.attributes.occupation === occ)!;
}
function person(s: DemonHunterState, id: string): Person {
  return s.towns.flatMap((t) => t.people).find((p) => p.id === id)!;
}

describe('talking to townsfolk', () => {
  it('shows the card, records the rumour, offers the task; decline or accept', () => {
    let s = fresh();
    const p = townPeople(s).find((x) => !x.clues.good && !x.isMinion)!;
    const r = applyText(s, { type: 'talk', person: p.id });
    s = r.state;
    expect(r.summary).toContain(`${p.name} the ${p.attributes.occupation}`);
    expect(r.summary).toContain(`Rumour: "${p.clues.bad!.text}"`);
    expect(r.summary).toContain('Can you help me');
    expect(s.player.knownClues.map((c) => c.text)).toContain(p.clues.bad!.text);
    expect(person(s, p.id).hasMet).toBe(true);
    expect(s.dialogue?.stage).toBe('offer');
    expect(applyText(s, { type: 'leave' }).summary).toContain('You take your leave of'); // no goodbye needed
    s = apply(s, { type: 'decline' });
    expect(s.dialogue?.stage).toBe('closing');
    s = apply(s, { type: 'goodbye' });
    expect(s.dialogue).toBeNull();
    s = apply(s, { type: 'talk', person: p.name.toLowerCase() });
    s = apply(s, { type: 'accept_task' });
    expect(s.player.activeTasks).toContain(p.id);
  });

  it('a truth-knower says so, and the Eye of Truth flags liars', () => {
    let s = fresh();
    const good = townPeople(s).find((x) => x.clues.good)!;
    let r = applyText(s, { type: 'talk', person: good.id });
    expect(r.summary).toContain('I know the truth!');
    expect(r.summary).toContain('I also know a demon secret');
    const liar = townPeople(s).find((x) => x.isMinion || x.isDemon);
    if (liar) {
      r = applyText(s, { type: 'talk', person: liar.id });
      expect(r.summary).not.toContain('LYING');
      s.player.magicItems.push('light');
      r = applyText(s, { type: 'talk', person: liar.id });
      expect(r.summary).toContain('Eye of Truth: they are LYING');
    }
  });

  it('completing a task: a good-clue holder offers clue or power; the clue is recorded', () => {
    let s = fresh();
    const good = townPeople(s).find((x) => x.clues.good)!;
    s = apply(s, { type: 'talk', person: good.id });
    s = apply(s, { type: 'accept_task' });
    s = apply(s, { type: 'goodbye' });
    // progress line while incomplete
    let r = applyText(s, { type: 'talk', person: good.id });
    expect(r.summary).toContain('Please hurry');
    s = apply(r.state, { type: 'goodbye' });
    person(s, good.id).task.currentAmount = person(s, good.id).task.amount;
    person(s, good.id).task.isCompleted = true;
    r = applyText(s, { type: 'talk', person: good.id });
    expect(r.summary).toContain('Choose your reward');
    s = r.state;
    r = applyText(s, { type: 'claim_reward', reward: 'clue' });
    s = r.state;
    expect(r.summary).toContain(good.clues.good!.text);
    expect(s.player.knownClues.map((c) => c.text)).toContain(good.clues.good!.text);
    expect(person(s, good.id).taskCompleted).toBe(true);
    expect(s.player.activeTasks).not.toContain(good.id);
    s = apply(s, { type: 'goodbye' });
    r = applyText(s, { type: 'talk', person: good.id });
    expect(r.summary).toContain('Thanks again');
  });

  it('a minion whose task you finish confesses instead of paying', () => {
    let s = fresh(3);
    const minion = s.towns.flatMap((t) => t.people).find((x) => x.isMinion)!;
    const town = s.towns.find((t) => t.id === minion.attributes.townId)!;
    s.player.at = town.nodeId;
    s.player.inside = 'town';
    s = apply(s, { type: 'talk', person: minion.id });
    s = apply(s, { type: 'accept_task' });
    s = apply(s, { type: 'goodbye' });
    person(s, minion.id).task.isCompleted = true;
    const r = applyText(s, { type: 'talk', person: minion.id });
    expect(r.summary).toContain('you will not find my master');
    expect(r.summary).toContain('MINIONS');
    expect(r.state.player.activeTasks).not.toContain(minion.id);
    expect(person(r.state, minion.id).taskCompleted).toBe(true);
  });

  it('find tasks: the matching person says "you found me"', () => {
    let s = fresh();
    const giver = townPeople(s)[0]!;
    const target = townPeople(s).find((x) => x.id !== giver.id)!;
    giver.task = { ...giver.task, type: 'FIND_PERSON', targetId: target.attributes.pet, targetName: target.attributes.pet, amount: 1, currentAmount: 0, description: `Find someone with a ${target.attributes.pet}`, isCompleted: false };
    s = apply(s, { type: 'talk', person: giver.id });
    s = apply(s, { type: 'accept_task' });
    s = apply(s, { type: 'goodbye' });
    const r = applyText(s, { type: 'talk', person: target.id });
    expect(r.summary).toContain('You found me');
    expect(r.summary).toContain(`Claim the reward from ${giver.name}`);
    s = r.state;
    expect(person(s, giver.id).task.isCompleted).toBe(true);
  });

  it('the short quest flow: talk to the target straight from the giver, then claim in one move', () => {
    let s = fresh();
    const giver = townPeople(s)[0]!;
    const target = townPeople(s).find((x) => x.id !== giver.id)!;
    giver.task = { ...giver.task, type: 'FIND_PERSON', targetId: target.attributes.pet, targetName: target.attributes.pet, amount: 1, currentAmount: 0, description: `Find someone with a ${target.attributes.pet}`, isCompleted: false };
    s = apply(s, { type: 'talk', person: giver.id });
    s = apply(s, { type: 'accept_task' });
    // no goodbye: talking to the target ends the giver's conversation and completes the find
    let r = applyText(s, { type: 'talk', person: target.id });
    expect(r.summary).toContain(`(You take your leave of ${giver.name}.)`);
    expect(r.summary).toContain('Task complete');
    s = r.state;
    const ids = getLegalMoves(s).map((m) => m.move_id);
    expect(ids).toContain('goodbye');
    // claim in one move, mid-conversation with the target
    r = applyText(s, { type: 'claim_reward', person: giver.id, reward: 'power' });
    expect(r.summary).toContain(`(You take your leave of ${target.name}.)`);
    expect(r.summary).toContain('You did it');
    s = r.state;
    expect(person(s, giver.id).taskCompleted).toBe(true);
    expect(s.player.activeTasks).not.toContain(giver.id);
    // and the town list offered that claim before we took it
    const before = apply(apply(fresh(), { type: 'talk', person: giver.id }), { type: 'goodbye' });
    expect(getLegalMoves(before).map((m) => m.move_id)).not.toContain(`claim_reward:${giver.id}:power`);
  });

  it('claiming from a giver who owes nothing yet just talks to them; the inn, leaving and asking around end a conversation by themselves', () => {
    let s = fresh();
    const giver = townPeople(s)[0]!;
    s = apply(s, { type: 'talk', person: giver.id });
    s = apply(s, { type: 'accept_task' });
    let r = applyText(s, { type: 'claim_reward', person: giver.id, reward: 'power' });
    expect(r.summary).toContain('Please hurry');
    expect(r.state.dialogue?.stage).toBe('closing');
    r = applyText(r.state, { type: 'inn' });
    expect(r.summary).toContain('You take your leave of');
    expect(r.state.dialogue).toBeNull();
    s = apply(r.state, { type: 'leave_inn' });
    s = apply(s, { type: 'talk', person: giver.id });
    r = applyText(s, { type: 'leave' });
    expect(r.summary).toContain('You take your leave of');
    expect(r.state.player.inside).toBeNull();
  });

  it('each occupation power does what the original did', () => {
    const run = (occ: string, setup?: (s: DemonHunterState, p: Person) => void): { s: DemonHunterState; summary: string; p: Person } => {
      let s = fresh(2);
      const p = byOcc(s, occ);
      p.clues = {};
      p.isMinion = false; // a minion would confess instead of paying
      p.isDemon = false;
      setup?.(s, p);
      s = apply(s, { type: 'talk', person: p.id });
      s = apply(s, { type: 'accept_task' });
      s = apply(s, { type: 'goodbye' });
      person(s, p.id).task.isCompleted = true;
      s = apply(s, { type: 'talk', person: p.id });
      const r = applyText(s, { type: 'claim_reward', reward: 'power' });
      return { s: r.state, summary: r.summary, p };
    };
    expect(run('Mayor').s.player.resources.gold).toBe(1);
    expect(run('Merchant').s.player.shuckles).toBe(5 + MERCHANT_SHUCKLES);
    expect(run('Soldier').s.player.xp).toBe(SOLDIER_TRAINING_XP);
    expect(run('Blacksmith').s.player.freeStatPicks).toBe(1);
    expect(run('Locksmith').s.player.locksmithCharges).toBe(1);
    const farmer = run('Farmer');
    expect(farmer.summary).toContain(demon(farmer.s).hasMet ? 'have met the demon' : 'have not met the demon');
    const musician = run('Musician');
    const minions = musician.s.towns[0]!.people.filter((x) => x.isMinion).length;
    expect(musician.summary).toContain(`${minions === 1 ? 'is 1 minion' : `are ${minions} minions`}`);
    const tailor = run('Tailor');
    const liar = tailor.s.towns[0]!.people.some((x) => x.isMinion || x.isDemon);
    expect(tailor.summary).toContain(liar ? 'are lying' : 'is lying');
    expect(tailor.s.player.knownClues.some((c) => c.isSpecial)).toBe(true);
    const carpenter = run('Carpenter');
    const notIn = carpenter.s.player.knownClues.find((c) => c.text.startsWith('The demon is not in') && c.relatedAttribute?.key === 'townId')!;
    expect(notIn).toBeDefined();
    expect(notIn.relatedAttribute!.value).not.toBe(demon(carpenter.s).attributes.townId);
    const barber = run('Barber');
    expect(barber.summary).toContain('introduced you to');
    const met = barber.s.towns.flatMap((t) => t.people).filter((x) => x.hasMet).length;
    expect(met).toBeGreaterThan(1);
  });

  it('claiming a clue from someone without one is refused; powers need the reward stage', () => {
    let s = fresh();
    const p = townPeople(s).find((x) => !x.clues.good && !x.isMinion)!;
    s = apply(s, { type: 'talk', person: p.id });
    expect(() => apply(s, { type: 'claim_reward', reward: 'power' })).toThrow(/owes you no reward/);
    s = apply(s, { type: 'accept_task' });
    s = apply(s, { type: 'goodbye' });
    person(s, p.id).task.isCompleted = true;
    s = apply(s, { type: 'talk', person: p.id });
    expect(() => apply(s, { type: 'claim_reward', reward: 'clue' })).toThrow(/no demon secret/);
  });
});

describe('asking around town', () => {
  it('names who fits a pet, colour, trade, item, task or truth, and they count as met', () => {
    const s = fresh(1);
    const town = s.towns[0]!;
    const purple = town.people.filter((p) => p.attributes.color === 'Purple');
    let r = applyText(s, { type: 'search_town', color: 'purple' });
    if (purple.length === 0) expect(r.summary).toContain('Nobody here fits');
    else for (const p of purple) expect(r.summary).toContain(`${p.name} the ${p.attributes.occupation}`);
    for (const p of purple) {
      expect(r.state.towns[0]!.people.find((x) => x.id === p.id)!.hasMet).toBe(true);
      if (p.clues.bad) expect(r.state.player.knownClues.map((c) => c.text)).toContain(p.clues.bad.text);
    }
    const truth = town.people.find((p) => p.clues.good)!;
    r = applyText(s, { type: 'search_town', truth: true });
    expect(r.summary).toContain(`${truth.name} the ${truth.attributes.occupation}`);
    expect(r.summary).toContain('I know the truth!');
    expect(r.state.towns[0]!.people.find((x) => x.id === truth.id)!.hasMet).toBe(true);
    const killer = town.people.find((p) => p.task.type === 'KILL');
    if (killer) {
      const monster = killer.task.description.replace(/^Kill \d+ /, '');
      r = applyText(s, { type: 'search_town', task: monster });
      expect(r.summary).toContain(killer.name);
      expect(r.summary).toContain(killer.task.description.toLowerCase());
    }
    const someone = town.people[3]!;
    const itemName = s.items.find((i) => i.id === someone.attributes.item)!.name;
    r = applyText(s, { type: 'search_town', item: itemName });
    expect(r.summary).toContain(someone.name);
    r = applyText(s, { type: 'search_town', occupation: 'Mayor', pet: town.people.find((p) => p.attributes.occupation === 'Mayor')!.attributes.pet });
    expect(r.summary).toContain('the Mayor');
    r = applyText(s, { type: 'search_town' });
    expect(r.summary).toContain('Ask about something');
    expect(() => apply(apply(s, { type: 'leave' }), { type: 'search_town', pet: 'dog' })).toThrow(/in a town/);
  });

  it('finds the rumours that contradict a secret and names who said them', () => {
    let s = fresh(2);
    const d = demon(s);
    // a secret about the demon's trade, as if earned
    s.player.knownClues.push({ text: `The demon is a ${d.attributes.occupation}`, isGood: true, relatedAttribute: { key: 'occupation', value: d.attributes.occupation } });
    let r = applyText(s, { type: 'search_town', contradictions: true });
    expect(r.summary).toContain('None of them contradicts');
    // a liar whose lie is exactly that negation
    const liar = s.towns[0]!.people.find((p) => p.id !== d.id)!;
    liar.clues.bad = { text: `The demon is not a ${d.attributes.occupation}`, isGood: false, relatedAttribute: { key: 'occupation', value: d.attributes.occupation } };
    s = apply(s, { type: 'talk', person: liar.id });
    s = apply(s, { type: 'goodbye' });
    r = applyText(s, { type: 'search_town', contradictions: true });
    expect(r.summary).toContain(`said by ${liar.name} the ${liar.attributes.occupation}`);
    expect(r.summary).toContain('was lying');
    // works outdoors too
    r = applyText(apply(s, { type: 'leave' }), { type: 'search_town', contradictions: true });
    expect(r.summary).toContain('was lying');
  });

  it('without a secret, says why nothing can contradict', () => {
    const r = applyText(fresh(3), { type: 'search_town', contradictions: true });
    expect(r.summary).toContain('Without a demon secret');
  });
});

describe('escorts', () => {
  it('the escorted person travels with you and moves house on arrival; escorting the demon moves the location clues', () => {
    let s = fresh(4);
    const d = demon(s);
    const home = s.towns.find((t) => t.id === d.attributes.townId)!;
    const dest = s.towns.find((t) => t.id !== home.id)!;
    d.task = { ...d.task, type: 'ESCORT', targetId: dest.id, targetName: dest.name, amount: 1, currentAmount: 0, description: `Escort me to ${dest.name}`, isCompleted: false };
    s.player.at = home.nodeId;
    s.player.inside = 'town';
    s = apply(s, { type: 'talk', person: d.id });
    s = apply(s, { type: 'accept_task' });
    expect(s.player.followers).toContain(d.id);
    s = apply(s, { type: 'goodbye' });
    // a truthful "not in <dest>" clue in the book must flip; the good town clue must follow
    const goodHolder = s.towns.flatMap((t) => t.people).find((p) => p.clues.good?.relatedAttribute?.key === 'townId')!;
    s.player.knownClues.push({ ...goodHolder.clues.good! });
    s.player.magicItems.push('space');
    s.player.visitedTowns.push(dest.id);
    const r = applyText(s, { type: 'teleport', town: dest.id });
    s = r.state;
    expect(r.summary).toContain('will live here now');
    expect(s.player.followers).not.toContain(d.id);
    expect(person(s, d.id).attributes.townId).toBe(dest.id);
    expect(s.towns.find((t) => t.id === dest.id)!.people.some((p) => p.id === d.id)).toBe(true);
    expect(s.towns.find((t) => t.id === home.id)!.people.some((p) => p.id === d.id)).toBe(false);
    expect(person(s, goodHolder.id).clues.good!.text).toBe(`The demon is in ${dest.name}`);
    expect(s.player.knownClues.some((c) => c.text === `The demon is in ${dest.name}`)).toBe(true);
    for (const p of s.towns.flatMap((t) => t.people)) {
      const c = p.clues.bad;
      if (!c || c.relatedAttribute?.key !== 'townId') continue;
      const lies = p.isDemon || p.isMinion;
      expect(c.relatedAttribute!.value === dest.id, `${p.id} ${lies ? 'lies' : 'is honest'}: ${c.text}`).toBe(lies);
    }
    expect(person(s, d.id).task.isCompleted).toBe(true);
  });
});

describe('the inn', () => {
  it('sleep, train, buy, sell and ride with the original prices', () => {
    let s = fresh();
    const town = s.towns[0]!;
    s.player.hp = 1;
    s.player.shuckles = 100;
    let r = applyText(s, { type: 'inn' });
    expect(r.summary).toContain('Welcome to the');
    s = r.state;
    expect(() => apply(s, { type: 'talk', person: town.people[0]!.id })).toThrow(/Leave the inn/);
    s = apply(s, { type: 'sleep' });
    expect(s.player.hp).toBe(3);
    expect(s.player.shuckles).toBe(100 - INN_SLEEP_COST);
    expect(() => apply(s, { type: 'sleep' })).toThrow(/full health/);
    s = apply(s, { type: 'train' });
    expect(s.player.xp).toBe(INN_TRAIN_XP);
    expect(s.player.shuckles).toBe(100 - INN_SLEEP_COST - INN_TRAIN_COST);
    const before = s.player.shuckles;
    const stock = town.stock.wood;
    s = apply(s, { type: 'buy', resource: 'wood' });
    expect(s.player.resources.wood).toBe(1);
    expect(s.player.shuckles).toBe(before - buyPrice('wood', town.prices.wood));
    expect(s.towns[0]!.stock.wood).toBe(stock - 1);
    s = apply(s, { type: 'sell', resource: 'wood' });
    expect(s.player.resources.wood).toBe(0);
    expect(s.player.shuckles).toBe(before - buyPrice('wood', town.prices.wood) + sellPrice('wood', town.prices.wood));
    expect(() => apply(s, { type: 'sell', resource: 'gold' })).toThrow(/no Gold/);
    s.player.shuckles = INN_RIDE_COST;
    const dest = s.towns[2]!;
    s = apply(s, { type: 'ride', town: dest.name });
    expect(s.player.shuckles).toBe(0);
    expect(s.innOpen).toBe(false);
    expect(s.player.at).toBe(dest.nodeId);
    expect(s.player.inside).toBe('town');
    expect(s.player.visitedTowns).toContain(dest.id);
  });
});

describe('houses and bindings', () => {
  it('locked without a lockpick or locksmith; a minion house yields a binding once', () => {
    let s = fresh(3);
    const minion = townPeople(s).find((x) => x.isMinion) ?? townPeople(s)[0]!;
    minion.isMinion = true;
    const innocent = townPeople(s).find((x) => !x.isMinion)!;
    expect(() => apply(s, { type: 'search_house', person: minion.id })).toThrow(/locked/);
    s.player.lockpicks = 1;
    let r = applyText(s, { type: 'search_house', person: minion.id });
    expect(r.summary).toContain('Use a lockpick');
    expect(r.state.player.lockpicks).toBe(1);
    r = applyText(s, { type: 'search_house', person: minion.id, confirm: true });
    s = r.state;
    expect(r.summary).toContain('found a demon binding');
    expect(s.player.bindings).toHaveLength(1);
    expect(s.player.lockpicks).toBe(0);
    expect(() => apply(s, { type: 'search_house', person: minion.id })).toThrow(/already searched/);
    s.player.locksmithCharges = 1;
    r = applyText(s, { type: 'search_house', person: innocent.id });
    expect(r.summary).toContain('Nothing of note');
    expect(r.state.player.locksmithCharges).toBe(0);
  });

  it('buys and sells in any valid amount, or all; past the bound it refuses and names it', () => {
    let s = fresh(8);
    const town = s.towns[0]!;
    s = apply(s, { type: 'inn' });
    s.towns[0]!.stock.wood = 5; // on the state the inn move returned, not the copy it was cloned from
    s.player.shuckles = 100;
    const buy = buyPrice('wood', town.prices.wood);
    const sell = sellPrice('wood', town.prices.wood);
    expect(() => apply(s, { type: 'buy', resource: 'wood', amount: 6 })).toThrow(/only 5 in stock|can afford/);
    expect(() => apply(s, { type: 'buy', resource: 'wood', amount: 0 })).toThrow(/How many/);
    expect(() => apply(s, { type: 'buy', resource: 'wood', amount: 1.5 })).toThrow(/How many/);
    const r = applyText(s, { type: 'buy', resource: 'wood', amount: 3 });
    expect(r.summary).toContain(`You buy 3 Wood for ${buy * 3}`);
    s = r.state;
    expect(s.player.resources.wood).toBe(3);
    expect(s.player.shuckles).toBe(100 - buy * 3);
    expect(s.towns[0]!.stock.wood).toBe(2);
    // all = as many as stock and purse allow
    s = apply(s, { type: 'buy', resource: 'wood', amount: 'all' });
    expect(s.player.resources.wood).toBe(5);
    expect(s.towns[0]!.stock.wood).toBe(0);
    expect(() => apply(s, { type: 'buy', resource: 'wood', amount: 'all' })).toThrow(/no Wood in stock/);
    // a purse that only stretches so far
    s.player.shuckles = buy * 2 - 1;
    s.towns[0]!.stock.wood = 9;
    s = apply(s, { type: 'buy', resource: 'wood', amount: 'all' });
    expect(s.player.resources.wood).toBe(6);
    expect(() => apply(s, { type: 'sell', resource: 'wood', amount: 7 })).toThrow(/only 6/);
    s = apply(s, { type: 'sell', resource: 'wood', amount: 4 });
    expect(s.player.resources.wood).toBe(2);
    const before = s.player.shuckles;
    s = apply(s, { type: 'sell', resource: 'wood', amount: 'all' });
    expect(s.player.resources.wood).toBe(0);
    expect(s.player.shuckles).toBe(before + sell * 2);
    expect(() => apply(s, { type: 'sell', resource: 'wood', amount: 'all' })).toThrow(/no Wood to sell/);
  });
});
