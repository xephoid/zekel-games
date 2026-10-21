// Inside a town (PORT-PLAN §6): talking, tasks and rewards, occupation
// powers, the inn, houses and bindings. Ported from the original client's
// DialogueUI.show, triggerOccupationPower, InnUI and the house interaction.

import { INN_RIDE_COST, INN_SLEEP_COST, INN_TRAIN_COST, INN_TRAIN_XP, MERCHANT_SHUCKLES, SOLDIER_TRAINING_XP } from '../data/progression.js';
import { BINDING_NAMES } from '../data/registries.js';
import { buyPrice, RESOURCE_DISPLAY_NAME, RESOURCE_TYPES, sellPrice, type ResourceType } from '../data/resources.js';
import { pick, randomInt, shuffle } from '../rng.js';
import type { Clue, DemonHunterState, Person } from '../types.js';
import type { DemonHunterMove } from './moves.js';
import { refuse } from './errors.js';
import { activeTasks, addClue, allPeople, currentTown, endDialogue, gainXp, hasMagicItem, healToFull, personOf } from './helpers.js';
import { arriveInTown, requireNoCombat } from './movement.js';

// ---------------------------------------------------------------------------
// Talking
// ---------------------------------------------------------------------------

function requireTown(state: DemonHunterState): void {
  requireNoCombat(state);
  if (state.player.inside !== 'town') refuse('You are not inside a town.');
  if (state.innOpen) refuse('Leave the inn first.');
}

function dialoguePerson(state: DemonHunterState): Person {
  if (!state.dialogue) refuse('You are not talking to anyone.');
  return personOf(state, state.dialogue.personId);
}

function itemName(state: DemonHunterState, id: string): string {
  if (!id || id === 'None') return 'nothing';
  return state.items.find((i) => i.id === id)?.name ?? id;
}

/** The person's card: the facts the GM may reveal in conversation. */
export function personCard(state: DemonHunterState, person: Person): string {
  const town = state.towns.find((t) => t.id === person.attributes.townId)?.name ?? '?';
  const rumour = person.clues.bad?.text ?? 'I know the truth!';
  const eye = hasMagicItem(state, 'light') && (person.isDemon || person.isMinion) ? ' [Eye of Truth: they are LYING]' : '';
  return (
    `${person.name} the ${person.attributes.occupation} (pet: ${person.attributes.pet}; favourite colour: ${person.attributes.color}; ` +
    `item: ${itemName(state, person.attributes.item)}; lives in ${town}). Rumour: "${rumour}"${eye}.`
  );
}

/** The GM brief for a conversation: who this person is and what they know.
 *  The GM improvises the dialogue from it; the facts stay exact. */
export function characterBrief(state: DemonHunterState, person: Person): string {
  const p = person.persona;
  const reward = person.clues.good ? `${powerOffer(person)}, or a demon secret` : powerOffer(person);
  return (
    `GM BRIEF (improvise from this; do not read it out): ${person.name} is ${p.temperament}; ${p.manner}; ${p.quirk}. On their mind: ${p.worry}. ` +
    `Their story, to tell in their own words when it fits: "${person.tip}" ` +
    `What they say about the demon, meaning kept exactly: "${person.clues.bad?.text ?? 'I know the truth!'}". ` +
    `What they need: ${person.task.description.toLowerCase()}, because ${p.taskReason}; in return ${reward}. ` +
    `They can speak to the lore topics: ${p.loreHooks.join(', ')}. Anything the brief and the lore do not cover, they do not know.`
  );
}

export function talk(state: DemonHunterState, personId: string, lines: string[]): void {
  requireTown(state);
  const town = currentTown(state);
  const person =
    town.people.find((p) => p.id === personId || p.name.toLowerCase() === personId.toLowerCase()) ??
    (state.player.followers.includes(personId) ? personOf(state, personId) : null);
  if (!person) refuse(`There is no one called "${personId}" in ${town.name}.`);
  if (state.dialogue && state.dialogue.personId !== person.id) endDialogue(state, lines);

  person.hasMet = true;
  if (person.clues.bad && addClue(state, person.clues.bad)) lines.push('(Rumour added to your clue book.)');
  lines.push(personCard(state, person));
  lines.push(characterBrief(state, person));

  const p = state.player;

  // 0. The person IS the target of an accepted find task (any of them).
  // Meeting them IS finding them: the task completes on the spot.
  const found = findTasksMatching(state, person);
  if (found.length > 0) {
    const givers: string[] = [];
    for (const task of found) {
      task.currentAmount = task.amount;
      task.isCompleted = true;
      const giver = allPeople(state).find((x) => x.task === task);
      if (giver) givers.push(`${giver.name} (${giver.id}) in ${state.towns.find((t) => t.id === giver.attributes.townId)?.name ?? '?'}`);
    }
    state.dialogue = { personId: person.id, stage: 'closing' };
    lines.push(`Gist: "You found me! I am indeed the one you are looking for." Task complete: ${found.map((t) => t.description).join('; ')}. Claim the reward from ${givers.join(' and ')} when you are in their town (claim_reward with their id and your choice of reward; no need to talk first).`);
    return;
  }

  // 1. The giver of an accepted task.
  const task = p.activeTasks.includes(person.id) ? person.task : null;
  if (task) {
    if (task.isCompleted) {
      if (person.isMinion) {
        // A minion reveals itself instead of paying (the original minionReveal).
        person.taskCompleted = true;
        p.activeTasks = p.activeTasks.filter((id) => id !== person.id);
        state.dialogue = { personId: person.id, stage: 'closing' };
        lines.push(`"Ah, you caught me, but you will not find my master!" ${person.name} is one of the demon's MINIONS.`);
        return;
      }
      state.dialogue = { personId: person.id, stage: 'reward' };
      lines.push('Gist: "You did it! You are a true hero."');
      if (person.clues.good) lines.push(`Choose your reward: a demon secret (clue), or ${powerOffer(person)} (power).`);
      else lines.push(`Gist: "Let me use my ability." Claim your reward (power): ${powerOffer(person)}`);
      return;
    }
    state.dialogue = { personId: person.id, stage: 'closing' };
    lines.push(`Gist: "Please hurry! I need you to ${task.description}." (${task.currentAmount}/${task.amount})`);
    return;
  }

  // 2. Anyone else.
  if (person.taskCompleted) {
    state.dialogue = { personId: person.id, stage: 'closing' };
    lines.push(person.isMinion ? 'Gist: "You will never find my master!"' : 'Gist: "Thanks again for your help earlier!"');
    return;
  }
  state.dialogue = { personId: person.id, stage: 'offer' };
  const secret = person.clues.good ? ' I also know a demon secret.' : '';
  lines.push(`Gist: "Can you help me: ${person.task.description}. In return ${powerOffer(person)}.${secret}" Accept the task or decline.`);
}

/** The accepted, unfinished find tasks this person satisfies (never their own). */
function findTasksMatching(state: DemonHunterState, person: Person) {
  const a = person.attributes;
  return activeTasks(state).filter((task) => {
    if (task.isCompleted || task.giverId === person.id) return false;
    if (task.type !== 'FIND_PERSON' && task.type !== 'FIND_ITEM') return false;
    return (
      task.targetId === person.id ||
      task.targetId === a.occupation ||
      task.targetId === a.pet ||
      task.targetId === a.color ||
      (task.type === 'FIND_ITEM' && task.targetId === a.item)
    );
  });
}

const POWER_OFFER: Record<string, string> = {
  Farmer: 'I can tell you if you have already met the demon',
  Musician: 'I can tell you how many minions are in this town',
  Barber: 'I can introduce you to some people I know',
  Tailor: 'I can tell you if there are any liars in this town',
  Mayor: 'I can give you a piece of gold for your troubles',
  Merchant: `I'll pay you ${MERCHANT_SHUCKLES} shuckles for your time`,
  Soldier: `I can give you combat training (${SOLDIER_TRAINING_XP} XP)`,
  Blacksmith: 'I can improve one of your abilities',
  Carpenter: 'I can tell you location information about the demon',
  Locksmith: 'I can unlock one house door for you',
};

function powerOffer(person: Person): string {
  return POWER_OFFER[person.attributes.occupation] ?? 'I can use my ability';
}

export function acceptTask(state: DemonHunterState, lines: string[]): void {
  requireTown(state);
  const person = dialoguePerson(state);
  if (state.dialogue!.stage !== 'offer') refuse(`${person.name} has not offered you a task.`);
  const p = state.player;
  if (!p.activeTasks.includes(person.id)) p.activeTasks.push(person.id);
  const task = person.task;
  lines.push(`Task accepted: ${task.description}. (${p.activeTasks.length} task${p.activeTasks.length === 1 ? '' : 's'} on your list.)`);
  if (task.type === 'ESCORT') {
    if (!p.followers.includes(person.id)) p.followers.push(person.id);
    lines.push(`${person.name} will travel with you.`);
  }
  if (task.type === 'FIND_ITEM' && p.magicItems.includes(task.targetId as never)) {
    task.currentAmount = task.amount;
    task.isCompleted = true;
    lines.push(`You already have the ${task.targetName}! Task complete: talk to ${person.name} again for your reward.`);
  }
  state.dialogue = { personId: person.id, stage: 'closing' };
}

export function declineTask(state: DemonHunterState, lines: string[]): void {
  requireTown(state);
  const person = dialoguePerson(state);
  if (state.dialogue!.stage !== 'offer') refuse('There is nothing to decline.');
  state.dialogue = { personId: person.id, stage: 'closing' };
  lines.push(`"No thanks," you tell ${person.name}.`);
}

export function goodbye(state: DemonHunterState, lines: string[]): void {
  if (!state.dialogue) refuse('You are not talking to anyone.');
  const person = personOf(state, state.dialogue.personId);
  state.dialogue = null;
  lines.push(`You say goodbye to ${person.name}.`);
}

export function claimReward(state: DemonHunterState, reward: 'clue' | 'power', personId: string | undefined, lines: string[]): void {
  requireTown(state);
  // Naming the giver talks to them first (their card, brief and answer appear);
  // if they owe nothing yet, or confess as a minion, that answer stands.
  if (personId) {
    const target = currentTown(state).people.find((x) => x.id === personId || x.name.toLowerCase() === personId.toLowerCase());
    if (!target) refuse(`There is no one called "${personId}" in ${currentTown(state).name}.`);
    if (!state.dialogue || state.dialogue.personId !== target.id || state.dialogue.stage !== 'reward') {
      talk(state, target.id, lines);
      if (!state.dialogue || state.dialogue.stage !== 'reward') return;
    }
  }
  const person = dialoguePerson(state);
  if (state.dialogue!.stage !== 'reward') refuse(`${person.name} owes you no reward right now.`);
  if (reward === 'clue' && !person.clues.good) refuse(`${person.name} has no demon secret; claim the power instead.`);
  person.taskCompleted = true;
  person.task.isCompleted = true;
  state.player.activeTasks = state.player.activeTasks.filter((id) => id !== person.id);
  state.dialogue = { personId: person.id, stage: 'closing' };
  if (reward === 'clue') {
    const good = person.clues.good!;
    addClue(state, good);
    if (person.clues.bad) addClue(state, person.clues.bad);
    lines.push(`"Here is what I know: ${good.text}." (Added to your clue book.)`);
    return;
  }
  occupationPower(state, person, lines);
}

/** The original triggerOccupationPower. */
function occupationPower(state: DemonHunterState, person: Person, lines: string[]): void {
  const people = allPeople(state);
  const townId = person.attributes.townId;
  const townName = state.towns.find((t) => t.id === townId)?.name ?? townId;
  const p = state.player;
  switch (person.attributes.occupation) {
    case 'Farmer': {
      const demon = people.find((x) => x.id === state.demonId);
      lines.push(demon?.hasMet ? '"You have met the demon."' : '"You have not met the demon yet."');
      return;
    }
    case 'Musician': {
      const count = people.filter((x) => x.attributes.townId === townId && x.isMinion).length;
      lines.push(`"There ${count === 1 ? 'is 1 minion' : `are ${count} minions`} in this town."`);
      return;
    }
    case 'Barber': {
      const unmet = people.filter((x) => !x.hasMet && x.id !== person.id);
      const n = randomInt(state.seed, 5);
      state.seed = n.nextSeed;
      const count = Math.min(n.value + 1, unmet.length);
      const chosen = shuffle(unmet, state.seed);
      state.seed = chosen.nextSeed;
      const introduced = chosen.items.slice(0, count);
      for (const x of introduced) {
        x.hasMet = true;
        if (x.clues.bad) addClue(state, x.clues.bad);
      }
      lines.push(`"I have introduced you to ${count} ${count === 1 ? 'person' : 'people'}": ${introduced.map((x) => `${x.name} the ${x.attributes.occupation} of ${state.towns.find((t) => t.id === x.attributes.townId)?.name}`).join('; ')}. Their rumours are in your clue book.`);
      return;
    }
    case 'Tailor': {
      const liar = people.some((x) => x.attributes.townId === townId && (x.isMinion || x.isDemon));
      const text = liar ? `Some people in ${townName} are lying!` : `No one in ${townName} is lying.`;
      addClue(state, { text, isGood: false, isSpecial: true });
      lines.push(`"${text}" (Added to your clue book.)`);
      return;
    }
    case 'Mayor':
      p.resources.gold++;
      lines.push(`The Mayor hands you a piece of gold (${p.resources.gold}).`);
      return;
    case 'Merchant':
      p.shuckles += MERCHANT_SHUCKLES;
      lines.push(`"Here are ${MERCHANT_SHUCKLES} shuckles for your trouble." (${p.shuckles} shuckles.)`);
      return;
    case 'Soldier':
      lines.push('"Nice training session!"');
      gainXp(state, SOLDIER_TRAINING_XP, lines);
      return;
    case 'Blacksmith':
      p.freeStatPicks++;
      lines.push('"Hope this helps you in your quest." The Blacksmith will improve one ability of your choice: level up a stat for free.');
      return;
    case 'Carpenter': {
      const demonTown = people.find((x) => x.id === state.demonId)?.attributes.townId;
      const candidates = state.towns.filter((t) => t.id !== demonTown && !p.knownClues.some((c) => c.text === `The demon is not in ${t.name}`));
      if (candidates.length === 0) {
        lines.push('"I have no new location clues for you."');
        return;
      }
      const choice = pick(candidates, state.seed);
      state.seed = choice.nextSeed;
      const text = `The demon is not in ${choice.value.name}`;
      addClue(state, { text, isGood: false, relatedAttribute: { key: 'townId', value: choice.value.id } });
      lines.push(`"${text}." (Added to your clue book.)`);
      return;
    }
    case 'Locksmith':
      p.locksmithCharges++;
      lines.push('"I\'ll unlock one house for you. Go to any house in any town and search it."');
      return;
    default:
      lines.push('Power activated!');
  }
}

// ---------------------------------------------------------------------------
// The inn
// ---------------------------------------------------------------------------

export function innOpen(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  if (state.player.inside !== 'town') refuse('You are not inside a town.');
  endDialogue(state, lines);
  const town = currentTown(state);
  state.innOpen = true;
  lines.push(innMenu(state, town.id));
}

export function innMenu(state: DemonHunterState, townId: string): string {
  const town = state.towns.find((t) => t.id === townId)!;
  const p = state.player;
  const rows = RESOURCE_TYPES.map(
    (r) => `${RESOURCE_DISPLAY_NAME[r]}: sell ${sellPrice(r, town.prices[r])}, buy ${buyPrice(r, town.prices[r])}, inn stock ${town.stock[r]}, you have ${p.resources[r]}`,
  );
  return (
    `Welcome to the ${town.name} inn! You have ${p.shuckles} shuckles. Trade: ${rows.join('; ')}. ` +
    `Services: sleep (${INN_SLEEP_COST}, heals to full), train (${INN_TRAIN_COST}, +${INN_TRAIN_XP} XP), ride to any town (${INN_RIDE_COST}).`
  );
}

function requireInn(state: DemonHunterState): void {
  requireNoCombat(state);
  if (!state.innOpen) refuse('You are not at the inn.');
}

export function innSleep(state: DemonHunterState, lines: string[]): void {
  requireInn(state);
  const p = state.player;
  if (p.hp >= p.maxHp) refuse('You are already at full health.');
  if (p.shuckles < INN_SLEEP_COST) refuse(`You don't have enough shuckles (${INN_SLEEP_COST} needed).`);
  p.shuckles -= INN_SLEEP_COST;
  healToFull(state);
  lines.push(`You sleep soundly and wake refreshed (HP ${p.hp}/${p.maxHp}; ${p.shuckles} shuckles left).`);
}

export function innTrain(state: DemonHunterState, lines: string[]): void {
  requireInn(state);
  const p = state.player;
  if (p.shuckles < INN_TRAIN_COST) refuse(`You don't have enough shuckles (${INN_TRAIN_COST} needed).`);
  p.shuckles -= INN_TRAIN_COST;
  lines.push(`You feel stronger after training! (${p.shuckles} shuckles left.)`);
  gainXp(state, INN_TRAIN_XP, lines);
}

export function innRide(state: DemonHunterState, townId: string, lines: string[]): void {
  requireInn(state);
  const p = state.player;
  const town = state.towns.find((t) => t.id === townId || t.name.toLowerCase() === townId.toLowerCase());
  if (!town) refuse(`There is no town "${townId}".`);
  if (p.shuckles < INN_RIDE_COST) refuse(`You don't have enough shuckles (${INN_RIDE_COST} needed).`);
  p.shuckles -= INN_RIDE_COST;
  state.innOpen = false;
  lines.push(`You pay ${INN_RIDE_COST} shuckles for a cart to ${town.name}.`);
  arriveInTown(state, town.id, lines);
}

/** How many of something: a whole number of at least one, or 'all' = `most`.
 *  Trading one at a time was tedious (designer, 2026-10-21): any valid amount goes. */
function howMany(amount: number | 'all' | undefined, most: number, what: string, limit: string): number {
  if (amount === 'all') {
    if (most <= 0) refuse(`${what}: ${limit}.`);
    return most;
  }
  const n = amount === undefined ? 1 : amount;
  if (!Number.isInteger(n) || n < 1) refuse(`How many? Give a whole number of at least 1, or "all".`);
  if (n > most) refuse(`${what}: ${limit}${most > 0 ? ` (up to ${most})` : ''}.`);
  return n;
}

export function innBuy(state: DemonHunterState, resource: ResourceType, amount: number | 'all' | undefined, lines: string[]): void {
  requireInn(state);
  const town = currentTown(state);
  if (!RESOURCE_TYPES.includes(resource)) refuse(`"${resource}" is not a resource.`);
  const name = RESOURCE_DISPLAY_NAME[resource];
  const price = buyPrice(resource, town.prices[resource]);
  if (town.stock[resource] <= 0) refuse(`The inn has no ${name} in stock.`);
  if (state.player.shuckles < price) refuse(`${name} costs ${price}; you have ${state.player.shuckles}.`);
  const affordable = Math.floor(state.player.shuckles / price);
  const most = Math.min(town.stock[resource], affordable);
  const n = howMany(amount, most, `Buying ${name}`, town.stock[resource] < affordable ? `the inn has only ${town.stock[resource]} in stock` : `at ${price} each you can afford ${affordable} with ${state.player.shuckles} shuckles`);
  state.player.shuckles -= price * n;
  town.stock[resource] -= n;
  state.player.resources[resource] += n;
  lines.push(`You buy ${n} ${name} for ${price * n}${n > 1 ? ` (${price} each)` : ''}; you have ${state.player.resources[resource]} and ${state.player.shuckles} shuckles left.`);
}

export function innSell(state: DemonHunterState, resource: ResourceType, amount: number | 'all' | undefined, lines: string[]): void {
  requireInn(state);
  const town = currentTown(state);
  if (!RESOURCE_TYPES.includes(resource)) refuse(`"${resource}" is not a resource.`);
  const name = RESOURCE_DISPLAY_NAME[resource];
  if (state.player.resources[resource] <= 0) refuse(`You have no ${name} to sell.`);
  const price = sellPrice(resource, town.prices[resource]);
  const n = howMany(amount, state.player.resources[resource], `Selling ${name}`, `you have only ${state.player.resources[resource]}`);
  state.player.resources[resource] -= n;
  town.stock[resource] += n;
  state.player.shuckles += price * n;
  lines.push(`You sell ${n} ${name} for ${price * n}${n > 1 ? ` (${price} each)` : ''}; ${state.player.resources[resource]} left and ${state.player.shuckles} shuckles.`);
}

export function innLeave(state: DemonHunterState, lines: string[]): void {
  if (!state.innOpen) refuse('You are not at the inn.');
  state.innOpen = false;
  lines.push('You leave the inn.');
}

// ---------------------------------------------------------------------------
// Houses and bindings
// ---------------------------------------------------------------------------

export function searchHouse(state: DemonHunterState, personId: string, confirm: boolean, lines: string[]): void {
  requireTown(state);
  endDialogue(state, lines);
  const town = currentTown(state);
  const owner = town.people.find((p) => p.id === personId || p.name.toLowerCase() === personId.toLowerCase());
  if (!owner) refuse(`No one called "${personId}" has a house in ${town.name}.`);
  const p = state.player;
  if (p.searchedHouses.includes(owner.id)) refuse(`You already searched ${owner.name}'s house.`);
  if (p.locksmithCharges > 0) {
    p.locksmithCharges--;
    lines.push(`The Locksmith's favour opens ${owner.name}'s door.`);
  } else if (p.lockpicks > 0) {
    if (!confirm) {
      lines.push(`${owner.name}'s house is locked. Use a lockpick (you have ${p.lockpicks})? Search again with confirm set to true.`);
      return;
    }
    p.lockpicks--;
    lines.push(`You pick the lock on ${owner.name}'s door (${p.lockpicks} lockpicks left).`);
  } else {
    refuse(`${owner.name}'s house is locked. You need a lockpick or a Locksmith's favour.`);
  }
  p.searchedHouses.push(owner.id);
  if (owner.isMinion) {
    const name = BINDING_NAMES[p.bindings.length] ?? `Demon Binding ${p.bindings.length + 1}`;
    p.bindings.push(name);
    lines.push(`You found a demon binding: ${name}! (${p.bindings.length} so far; each one weakens the demon.)`);
  } else {
    lines.push('Nothing of note here.');
  }
}

// ---------------------------------------------------------------------------
// Asking around town
// ---------------------------------------------------------------------------

type SearchMove = Extract<DemonHunterMove, { type: 'search_town' }>;

const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

/** `search_town`: townsfolk know each other, so the player can ask who here
 *  fits a description instead of talking to everyone. Whoever it turns up
 *  counts as met (ruling 2026-10-21): their card and rumour come back and go
 *  into the clue book, as if the player had talked to them. */
export function searchTown(state: DemonHunterState, q: SearchMove, lines: string[]): void {
  requireNoCombat(state);
  if (state.innOpen) refuse('Leave the inn first.');
  endDialogue(state, lines);
  const asked = ['pet', 'color', 'occupation', 'item', 'task', 'truth', 'contradictions'].filter((k) => (q as Record<string, unknown>)[k] !== undefined && (q as Record<string, unknown>)[k] !== '' && (q as Record<string, unknown>)[k] !== false);
  if (asked.length === 0) {
    lines.push('Ask about something: a pet, a colour, a trade, an item, a task (by the monster or a word of it), who knows the truth, or which clues contradict each other.');
    return;
  }

  if (q.contradictions) {
    contradictions(state, lines);
    if (asked.length === 1) return;
  }

  if (state.player.inside !== 'town') refuse('You must be in a town to ask around it.');
  const town = currentTown(state);
  const itemName = (id: string): string => (id === 'None' ? 'nothing' : (state.items.find((i) => i.id === id)?.name ?? id));
  const want: string[] = [];
  let people = town.people;
  if (q.pet) {
    const v = norm(q.pet);
    people = people.filter((p) => norm(p.attributes.pet) === v || norm(p.attributes.pet) + 's' === v);
    want.push(`keeps a ${q.pet}`);
  }
  if (q.color) {
    const v = norm(q.color);
    people = people.filter((p) => norm(p.attributes.color) === v);
    want.push(`likes ${q.color}`);
  }
  if (q.occupation) {
    const v = norm(q.occupation);
    people = people.filter((p) => norm(p.attributes.occupation) === v);
    want.push(`is a ${q.occupation}`);
  }
  if (q.item) {
    const v = norm(q.item).replace(/^(a|an|the) /, '');
    people = people.filter((p) => norm(itemName(p.attributes.item)).replace(/^(a|an|the) /, '') === v);
    want.push(`has ${q.item}`);
  }
  if (q.task) {
    const v = norm(q.task).replace(/s$/, '');
    people = people.filter((p) => {
      const d = norm(p.task.description);
      const t = p.task.type.toLowerCase();
      return d.includes(v) || d.includes(v + 's') || (v === 'escort' && t === 'escort') || (v === 'find' && (t === 'find_person' || t === 'find_item')) || (v === 'kill' && t === 'kill');
    });
    want.push(`wants help with "${q.task}"`);
  }
  if (q.truth) {
    people = people.filter((p) => !!p.clues.good);
    want.push('says they know the truth');
  }
  if (want.length === 0) return;
  const whom = want.join(' and ');
  if (people.length === 0) {
    lines.push(`You ask around ${town.name} for anyone who ${whom}. Nobody here fits.`);
    return;
  }
  let newRumours = 0;
  const described = people.map((p) => {
    const first = !p.hasMet;
    p.hasMet = true;
    if (p.clues.bad && addClue(state, p.clues.bad)) newRumours++;
    return `${personCard(state, p)} Task: ${p.task.description}${p.taskCompleted ? ' (done)' : ''}.${first ? '' : ' (Already met.)'}`;
  });
  lines.push(`You ask around ${town.name} for anyone who ${whom}, and are pointed to ${people.length === 1 ? 'one person' : `${people.length} people`}: ${described.join(' ')}`);
  if (newRumours > 0) lines.push(`(${newRumours} rumour${newRumours === 1 ? '' : 's'} added to your clue book.)`);
}

/** Known rumours that cannot be true alongside a secret you hold: a
 *  negation of exactly what a truth-knower told you. Lists who said them. */
function contradictions(state: DemonHunterState, lines: string[]): void {
  const known = state.player.knownClues;
  const secrets = known.filter((c) => c.isGood && c.relatedAttribute);
  if (secrets.length === 0) {
    lines.push('You compare the rumours in your clue book. Without a demon secret to measure them against, none of them contradicts another: every rumour is a "not", and "nots" never clash.');
    return;
  }
  const people = allPeople(state);
  const speakers = (clue: Clue): string[] =>
    people.filter((p) => p.hasMet && p.clues.bad?.text === clue.text).map((p) => `${p.name} the ${p.attributes.occupation} of ${state.towns.find((t) => t.id === p.attributes.townId)?.name}`);
  const found: string[] = [];
  for (const s of secrets) {
    for (const c of known) {
      if (c.isGood || !c.relatedAttribute) continue;
      if (c.relatedAttribute.key === s.relatedAttribute!.key && c.relatedAttribute.value === s.relatedAttribute!.value) {
        const who = speakers(c);
        found.push(`"${c.text}" (said by ${who.length > 0 ? who.join(' and ') : 'someone you have not written down'}) contradicts the secret "${s.text}"`);
      }
    }
  }
  if (found.length === 0) lines.push(`You compare the rumours in your clue book against your ${secrets.length} secret${secrets.length === 1 ? '' : 's'}. None of them contradicts a secret.`);
  else lines.push(`You compare your clue book: ${found.join('; ')}. Whoever told you a rumour that contradicts a secret was lying.`);
}
