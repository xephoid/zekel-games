// The mystery: people, the demon and its minions, clues, tasks. A port of the
// original server's DemonLogic.ts (generatePuzzle, regenerateClues,
// generateTasks, checkConflict) and WorldGenerator.generatePeople, with the
// seeded RNG in place of Math.random. Deviations from the original are noted
// inline with "PORT:".

import { ENEMY_BY_ID, OVERWORLD_ENEMIES } from '../data/enemies.js';
import { MAGIC_ITEMS, TEMPLE_TYPES } from '../data/magicItems.js';
import { MINIONS_PER_TOWN, PEOPLE_PER_TOWN } from '../data/progression.js';
import {
  COLORS,
  GAME_TIPS,
  ITEM_NAMES,
  LORE_LINES,
  OCCUPATIONS,
  PERSON_NAMES,
  PETS,
  type Color,
  type Pet,
} from '../data/registries.js';
import { pick, randomInt, shuffle } from '../rng.js';
import { loreHooksFor, MANNERS, QUIRKS, TASK_REASONS, TEMPERAMENTS, WORRIES } from '../data/personas.js';
import type { Clue, GameTask, Item, Person, Town } from '../types.js';

export interface PuzzleTowns {
  towns: Town[];
  demonId: string;
  items: Item[];
}

/** The towns' people. PORT: one world-wide name pool (the original drew a
 *  fresh pool per town, so two towns could share a name; a text game needs
 *  names unambiguous). */
export function generatePeople(towns: Town[], seed: number): number {
  let s = seed;
  const namePool = shuffle(PERSON_NAMES, s);
  s = namePool.nextSeed;
  let nameIdx = 0;
  for (const town of towns) {
    const occupations = shuffle(OCCUPATIONS, s);
    s = occupations.nextSeed;
    town.people = [];
    for (let i = 0; i < PEOPLE_PER_TOWN; i++) {
      const entry = namePool.items[nameIdx++];
      const pet = pick(PETS, s);
      s = pet.nextSeed;
      const color = pick(COLORS, s);
      s = color.nextSeed;
      const id = `${town.id}_p_${i}`;
      town.people.push({
        id,
        name: entry?.name ?? `Person ${nameIdx}`,
        gender: entry?.gender ?? 'male',
        attributes: {
          occupation: occupations.items[i % occupations.items.length]!,
          pet: pet.value as Pet,
          color: color.value as Color,
          item: 'None', // assigned by generatePuzzle
          townId: town.id,
        },
        isDemon: false,
        isMinion: false,
        clues: {},
        task: seedTask(id),
        hasMet: false,
        taskCompleted: false,
        tip: '',
        persona: { temperament: '', manner: '', quirk: '', worry: '', taskReason: '', loreHooks: [] },
      });
    }
  }
  return s;
}

/** Every person's task is assigned by generateTasks; this is the value a
 *  Person carries between generatePeople and that step (never seen in play). */
function seedTask(giverId: string): GameTask {
  return {
    id: `task_seed_${giverId}`,
    type: 'KILL',
    targetId: 'slime',
    targetName: 'SLIME',
    amount: 5,
    currentAmount: 0,
    description: 'Kill 5 Slimes',
    reward: 'ITEM',
    giverId,
    isCompleted: false,
  };
}

/** DemonLogic.generatePuzzle: pick the demon and minions, mint the items,
 *  generate clues and tasks, hand out tips and lore. */
export function generatePuzzle(towns: Town[], seed: number): { puzzle: PuzzleTowns; nextSeed: number } {
  let s = seed;
  const people = towns.flatMap((t) => t.people);

  // 1. Demon
  const demonPick = pick(people, s);
  s = demonPick.nextSeed;
  const demon = demonPick.value;
  demon.isDemon = true;

  // Minions: towns × MINIONS_PER_TOWN, drawn from everyone else (the original
  // does not force them to spread across towns).
  const minionCount = towns.length * MINIONS_PER_TOWN;
  const candidates = shuffle(people.filter((p) => !p.isDemon), s);
  s = candidates.nextSeed;
  for (let i = 0; i < Math.min(minionCount, candidates.items.length); i++) candidates.items[i]!.isMinion = true;

  // 2. Items: one unique item per person.
  const itemNames = shuffle(ITEM_NAMES, s);
  s = itemNames.nextSeed;
  const items: Item[] = people.map((_, i) => ({ id: `item_${i}`, name: itemNames.items[i] ?? `Item ${i}` }));
  people.forEach((p, i) => {
    p.attributes.item = items[i]!.id;
  });

  // 3. Clues
  s = regenerateClues(towns, demon.id, items, s);

  // 4. Tasks
  s = generateTasks(towns, s);

  // 5. Tips (starting town) and lore (everyone else)
  const tips = shuffle(GAME_TIPS, s);
  s = tips.nextSeed;
  towns[0]!.people.forEach((p, i) => {
    p.tip = tips.items[i % tips.items.length]!;
  });
  const lore = shuffle(LORE_LINES, s);
  s = lore.nextSeed;
  let loreIdx = 0;
  for (const town of towns.slice(1)) {
    for (const p of town.people) p.tip = lore.items[loreIdx++ % lore.items.length]!;
  }

  // 6. Personas: drawn after the mystery is fixed and independently of it.
  for (const p of people) {
    const temperament = pick(TEMPERAMENTS, s);
    s = temperament.nextSeed;
    const manner = pick(MANNERS, s);
    s = manner.nextSeed;
    const quirk = pick(QUIRKS, s);
    s = quirk.nextSeed;
    const worry = pick(WORRIES, s);
    s = worry.nextSeed;
    const reason = pick(TASK_REASONS[p.task.type], s);
    s = reason.nextSeed;
    const target = p.task.type === 'KILL' ? p.task.description.replace(/^Kill \d+ /, '') : p.task.targetName;
    p.persona = {
      temperament: temperament.value,
      manner: manner.value,
      quirk: quirk.value,
      worry: worry.value,
      taskReason: reason.value.replace('{target}', target),
      loreHooks: loreHooksFor(p.tip, p.attributes.occupation),
    };
  }

  return { puzzle: { towns, demonId: demon.id, items }, nextSeed: s };
}

/** DemonLogic.regenerateClues. Re-run after an escort moves the demon or the
 *  player takes the demon's item: every person's clue is rebuilt from the
 *  truth. Returns the next seed. */
export function regenerateClues(towns: Town[], demonId: string, items: Item[], seed: number): number {
  let s = seed;
  const people = towns.flatMap((t) => t.people);
  const demon = people.find((p) => p.id === demonId);
  if (!demon) return s;
  for (const p of people) p.clues = {};

  const townName = (id: string): string => towns.find((t) => t.id === id)?.name ?? 'Unknown Town';
  const itemName = (id: string): string => items.find((i) => i.id === id)?.name ?? id;
  const truth = demon.attributes;

  const goodClues: Clue[] = [
    { text: `The demon is a ${truth.occupation}`, isGood: true, relatedAttribute: { key: 'occupation', value: truth.occupation } },
    { text: `The demon has a ${truth.pet}`, isGood: true, relatedAttribute: { key: 'pet', value: truth.pet } },
    { text: `The demon likes ${truth.color}`, isGood: true, relatedAttribute: { key: 'color', value: truth.color } },
    { text: `The demon is in ${townName(truth.townId)}`, isGood: true, relatedAttribute: { key: 'townId', value: truth.townId } },
  ];
  if (truth.item && truth.item !== 'None') {
    goodClues.push({ text: `The demon has ${itemName(truth.item)}`, isGood: true, relatedAttribute: { key: 'item', value: truth.item } });
  }

  const badCluePool: Clue[] = [];
  const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));
  for (const occ of uniq(people.map((p) => p.attributes.occupation))) {
    if (occ !== truth.occupation) badCluePool.push({ text: `The demon is not a ${occ}`, isGood: false, relatedAttribute: { key: 'occupation', value: occ } });
  }
  for (const pet of uniq(people.map((p) => p.attributes.pet))) {
    if (pet !== truth.pet) badCluePool.push({ text: `The demon does not have a ${pet}`, isGood: false, relatedAttribute: { key: 'pet', value: pet } });
  }
  for (const col of uniq(people.map((p) => p.attributes.color))) {
    if (col !== truth.color) badCluePool.push({ text: `The demon does not like ${col}`, isGood: false, relatedAttribute: { key: 'color', value: col } });
  }
  for (const tId of uniq(people.map((p) => p.attributes.townId))) {
    if (tId !== truth.townId) badCluePool.push({ text: `The demon is not in ${townName(tId)}`, isGood: false, relatedAttribute: { key: 'townId', value: tId } });
  }
  for (const itemId of uniq(people.map((p) => p.attributes.item).filter((i) => i && i !== 'None'))) {
    if (itemId !== truth.item) badCluePool.push({ text: `The demon does not have ${itemName(itemId)}`, isGood: false, relatedAttribute: { key: 'item', value: itemId } });
  }

  const innocents = people.filter((p) => !p.isDemon && !p.isMinion);
  const minions = people.filter((p) => p.isMinion);
  const badShuffled = shuffle(badCluePool, s);
  s = badShuffled.nextSeed;
  const goodShuffled = shuffle(goodClues, s);
  s = goodShuffled.nextSeed;

  // One good-clue holder per town first (as many towns as there are good clues)...
  const innocentsByTown = new Map<string, Person[]>();
  for (const p of innocents) {
    const list = innocentsByTown.get(p.attributes.townId) ?? [];
    list.push(p);
    innocentsByTown.set(p.attributes.townId, list);
  }
  const townIds = shuffle(Array.from(innocentsByTown.keys()), s);
  s = townIds.nextSeed;
  const goodHolders = new Set<string>();
  const firstPass = Math.min(townIds.items.length, goodShuffled.items.length);
  for (let i = 0; i < firstPass; i++) {
    const pool = innocentsByTown.get(townIds.items[i]!)!;
    const holder = pick(pool, s);
    s = holder.nextSeed;
    holder.value.clues.good = goodShuffled.items[i]!;
    goodHolders.add(holder.value.id);
  }
  // ...then any leftovers scattered among the remaining innocents.
  let goodIdx = firstPass;
  if (goodIdx < goodShuffled.items.length) {
    const unassigned = shuffle(innocents.filter((p) => !goodHolders.has(p.id)), s);
    s = unassigned.nextSeed;
    for (const p of unassigned.items) {
      if (goodIdx >= goodShuffled.items.length) break;
      p.clues.good = goodShuffled.items[goodIdx++]!;
      goodHolders.add(p.id);
    }
  }
  // Bad clues for every innocent without a good clue.
  let badIdx = 0;
  for (const p of innocents) {
    if (goodHolders.has(p.id)) continue;
    if (badIdx < badShuffled.items.length) p.clues.bad = badShuffled.items[badIdx++]!;
    else if (badShuffled.items.length > 0) {
      const r = pick(badShuffled.items, s);
      s = r.nextSeed;
      p.clues.bad = r.value;
    }
  }

  // The demon and its minions lie: each gets a negation of the truth. Each
  // lie appears at most twice.
  const lieOptions: Clue[] = [
    { text: `The demon is not a ${truth.occupation}`, isGood: false, relatedAttribute: { key: 'occupation', value: truth.occupation } },
    { text: `The demon does not have a ${truth.pet}`, isGood: false, relatedAttribute: { key: 'pet', value: truth.pet } },
    { text: `The demon does not like ${truth.color}`, isGood: false, relatedAttribute: { key: 'color', value: truth.color } },
    { text: `The demon is not in ${townName(truth.townId)}`, isGood: false, relatedAttribute: { key: 'townId', value: truth.townId } },
  ];
  if (truth.item && truth.item !== 'None') {
    lieOptions.push({ text: `The demon does not have ${itemName(truth.item)}`, isGood: false, relatedAttribute: { key: 'item', value: truth.item } });
  }
  const liePool = shuffle(lieOptions.flatMap((o) => [o, { ...o }]), s);
  s = liePool.nextSeed;
  [demon, ...minions].forEach((liar, i) => {
    liar.clues.bad = { ...liePool.items[i % liePool.items.length]! };
  });
  return s;
}

/** DemonLogic.generateTasks. */
function generateTasks(towns: Town[], seed: number): number {
  let s = seed;
  const people = towns.flatMap((t) => t.people);
  const taskPool: GameTask[] = [];
  const mk = (partial: Omit<GameTask, 'currentAmount' | 'giverId' | 'isCompleted' | 'reward'>): GameTask => ({
    ...partial,
    currentAmount: 0,
    reward: 'CLUE',
    giverId: '',
    isCompleted: false,
  });

  // 1. Kill tasks, one per overworld enemy type.
  for (const e of OVERWORLD_ENEMIES) {
    taskPool.push(
      mk({
        id: `task_kill_${e.id}`,
        type: 'KILL',
        targetId: e.id,
        targetName: e.name.toUpperCase(),
        amount: e.toKill ?? 0,
        description: `Kill ${e.toKill} ${e.plural}`,
      }),
    );
  }
  // 2. Find tasks: one per occupation / pet / colour present in the world.
  const uniq = <T>(xs: T[]): T[] => Array.from(new Set(xs));
  for (const occ of uniq(people.map((p) => p.attributes.occupation))) {
    taskPool.push(mk({ id: `task_find_occ_${occ}`, type: 'FIND_PERSON', targetId: occ, targetName: occ, amount: 1, description: `Find a ${occ}` }));
  }
  for (const pet of uniq(people.map((p) => p.attributes.pet))) {
    taskPool.push(mk({ id: `task_find_pet_${pet}`, type: 'FIND_PERSON', targetId: pet, targetName: pet, amount: 1, description: `Find someone with a ${pet}` }));
  }
  for (const col of uniq(people.map((p) => p.attributes.color))) {
    taskPool.push(mk({ id: `task_find_col_${col}`, type: 'FIND_PERSON', targetId: col, targetName: col, amount: 1, description: `Find someone who likes ${col}` }));
  }
  // Escort tasks, one per town, to a random other town.
  for (const town of towns) {
    const others = towns.filter((t) => t.id !== town.id);
    if (others.length === 0) continue;
    const target = pick(others, s);
    s = target.nextSeed;
    taskPool.push(
      mk({
        id: `task_escort_from_${town.id}_to_${target.value.id}`,
        type: 'ESCORT',
        targetId: target.value.id,
        targetName: target.value.name,
        amount: 1,
        description: `Escort me to ${target.value.name}`,
      }),
    );
  }
  // Magic item tasks, one per temple.
  for (const temple of TEMPLE_TYPES) {
    const item = MAGIC_ITEMS[temple];
    taskPool.push(mk({ id: `task_find_magic_${temple}`, type: 'FIND_ITEM', targetId: temple, targetName: item.name, amount: 1, description: `Find the ${item.name}` }));
  }

  // 3. Assignment.
  const killTasks = shuffle(taskPool.filter((t) => t.type === 'KILL'), s);
  s = killTasks.nextSeed;
  let escortTasks = shuffle(taskPool.filter((t) => t.type === 'ESCORT'), s);
  s = escortTasks.nextSeed;
  const magicTasks = shuffle(taskPool.filter((t) => t.type === 'FIND_ITEM'), s);
  s = magicTasks.nextSeed;
  const otherTasks = shuffle(taskPool.filter((t) => t.type === 'FIND_PERSON'), s);
  s = otherTasks.nextSeed;
  const goodHolders = shuffle(people.filter((p) => p.clues.good), s);
  s = goodHolders.nextSeed;
  const assigned = new Set<string>();
  const give = (p: Person, task: GameTask): void => {
    p.task = { ...task, giverId: p.id, reward: p.clues.good ? 'CLUE' : 'ITEM' };
    assigned.add(p.id);
  };

  // First: every Merchant gets an escort task (they are travelling traders),
  // retrying the shuffle until no merchant is asked to be escorted home.
  const merchants = people.filter((p) => p.attributes.occupation === 'Merchant');
  let merchantAssignments: Array<[Person, GameTask]> | null = null;
  for (let attempt = 0; attempt < 20 && merchantAssignments === null; attempt++) {
    escortTasks = shuffle(escortTasks.items, s);
    s = escortTasks.nextSeed;
    const used = new Set<GameTask>();
    const temp: Array<[Person, GameTask]> = [];
    let ok = true;
    for (const m of merchants) {
      const task = escortTasks.items.find((t) => !used.has(t) && t.targetId !== m.attributes.townId);
      if (!task) {
        ok = false;
        break;
      }
      temp.push([m, task]);
      used.add(task);
    }
    if (ok) merchantAssignments = temp;
  }
  let escortLeft = escortTasks.items;
  if (merchantAssignments) {
    for (const [m, task] of merchantAssignments) {
      escortLeft = escortLeft.filter((t) => t !== task);
      give(m, task);
    }
  }

  // Second: exactly one good-clue holder gets a magic item task; the other
  // holders get kill tasks.
  let killLeft = killTasks.items;
  let magicLeft = magicTasks.items;
  let magicGiven = false;
  for (const p of goodHolders.items) {
    if (assigned.has(p.id)) continue;
    if (!magicGiven && magicLeft.length > 0) {
      give(p, magicLeft[0]!);
      magicLeft = magicLeft.slice(1);
      magicGiven = true;
    } else {
      if (killLeft.length === 0) break;
      give(p, killLeft[0]!);
      killLeft = killLeft.slice(1);
    }
  }

  // Third: everyone else from the general pool, never a task that conflicts
  // with the giver (asking to find themselves, or an escort to their own
  // town). PORT: the original rotated the pool at most ten times and could
  // still hand out a self-conflicting find task (talking to the giver would
  // then complete it at once); here the whole pool is searched and a generic
  // kill task is the fallback.
  const general = shuffle([...killLeft, ...escortLeft, ...magicLeft, ...otherTasks.items], s);
  s = general.nextSeed;
  const pool = general.items;
  const fallback = ENEMY_BY_ID.slime;
  for (const p of people) {
    if (assigned.has(p.id)) continue;
    const idx = pool.findIndex((t) => !checkConflict(p, t));
    if (idx === -1) {
      give(p, mk({ id: `task_generic_${p.id}`, type: 'KILL', targetId: fallback.id, targetName: fallback.name.toUpperCase(), amount: fallback.toKill ?? 0, description: `Kill ${fallback.toKill} ${fallback.plural}` }));
      continue;
    }
    give(p, pool.splice(idx, 1)[0]!);
  }
  return s;
}

function checkConflict(p: Person, task: GameTask): boolean {
  if (task.type === 'FIND_PERSON') {
    return task.targetId === p.attributes.occupation || task.targetId === p.attributes.pet || task.targetId === p.attributes.color;
  }
  if (task.type === 'FIND_ITEM') return task.targetId === p.attributes.item;
  if (task.type === 'ESCORT') return task.targetId === p.attributes.townId;
  return false;
}

/** Original /api/escort/complete: the person now lives in `targetTownId`.
 *  Callers then regenerateClues so location clues follow the move. */
export function movePersonToTown(towns: Town[], personId: string, targetTownId: string): Person | null {
  let person: Person | null = null;
  for (const town of towns) {
    const idx = town.people.findIndex((p) => p.id === personId);
    if (idx !== -1) {
      person = town.people[idx]!;
      if (town.id !== targetTownId) town.people.splice(idx, 1);
      break;
    }
  }
  if (!person) return null;
  person.attributes.townId = targetTownId;
  const target = towns.find((t) => t.id === targetTownId);
  if (target && !target.people.some((p) => p.id === personId)) target.people.push(person);
  return person;
}

export function randomTownOrder<T>(xs: readonly T[], seed: number): { items: T[]; nextSeed: number } {
  return shuffle(xs, seed);
}

export { randomInt };
