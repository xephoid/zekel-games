// The harness bot (PORT-PLAN §10). NOT a real detective: it may read the
// hidden demon id so that smoke tests and the harness can run a session to
// game_over. Policy, in order: fight what is in front of it; collect task
// rewards; heal when hurt and able to pay; spend levels keeping health within
// two of strength; hunt the slimes (and, once fast enough, mushrooms) that
// stand on nodes it can leave again; otherwise grind — cut plants and trees
// on safe nodes, sell everything at an inn, and pay for training — until it is
// strong enough to walk through bandits to the demon's town, meet the demon
// and stab it. After three deaths it gives up by stabbing an innocent, which
// ends the game. Fully deterministic: it never draws randomness.

import { ENEMY_BY_ID } from './data/enemies.js';
import { BOMB_COST, BOMB_DAMAGE, INN_SLEEP_COST, INN_TRAIN_COST, STAT_MAX } from './data/progression.js';
import { RESOURCE_TYPES } from './data/resources.js';
import type { DemonHunterMove } from './engine/moves.js';
import { activeTasks, attacksPerAction, canLevelUp, enemiesAt, hereNode, resourcesAt, townAtNode } from './engine/helpers.js';
import type { DemonHunterState, Enemy, Person } from './types.js';
import { neighborsOf } from './world/graph.js';

export type Tier = 'easy' | 'medium' | 'hard';

export function parseTier(difficulty?: string): Tier {
  if (difficulty === 'hard' || difficulty === 'mcts' || difficulty === 'hyperon') return 'hard';
  if (difficulty === 'easy' || difficulty === 'random') return 'easy';
  return 'medium';
}

export interface BotChoice {
  move: DemonHunterMove;
  reasoning: string;
}

const PREY: ReadonlySet<string> = new Set(['slime', 'mushroom']);
const GIVE_UP_DEATHS = 3;
const GIVE_UP_TURNS = 1000;

/** Can the bot take one of this enemy's actions and live? */
function survivable(state: DemonHunterState, e: Enemy): boolean {
  const d = ENEMY_BY_ID[e.type];
  return attacksPerAction(d.speed, state.player.agility) * d.damage < state.player.hp;
}

function preyAt(state: DemonHunterState, nodeId: string): Enemy | null {
  const prey = enemiesAt(state, nodeId).filter((e) => PREY.has(e.type) && survivable(state, e));
  if (prey.length === 0) return null;
  prey.sort((a, b) => a.hp - b.hp || ENEMY_BY_ID[a.type].speed - ENEMY_BY_ID[b.type].speed);
  return prey[0]!;
}

/** Damage the bot takes beating one enemy of this type from the start of a
 *  fight, by the combat rules: opening shot if its range is higher, it acts
 *  first if faster, attacks per action by the speed ratio. */
function damageFrom(state: DemonHunterState, type: Enemy['type'], hp: number = ENEMY_BY_ID[type].hp): number {
  if (hp <= 0) return 0;
  const p = state.player;
  const d = ENEMY_BY_ID[type];
  const mine = p.strength * attacksPerAction(p.agility, d.speed);
  const its = d.damage * attacksPerAction(d.speed, p.agility);
  const rounds = Math.ceil(hp / mine);
  const enemyFirst = d.speed > p.agility;
  let taken = d.range > p.range ? d.damage : 0;
  taken += its * (enemyFirst ? rounds : rounds - 1);
  return taken;
}

/** HP it would cost to fight every blocker at this node in turn (leaving it),
 *  optionally after a bomb has hurt them all by 5. */
function clearCost(state: DemonHunterState, nodeId: string, bombed = false): number {
  let cost = 0;
  for (const e of enemiesAt(state, nodeId)) {
    const b = ENEMY_BY_ID[e.type].behaviour;
    if (b === 'blocker' || b === 'hunter') cost += damageFrom(state, e.type, bombed ? e.hp - BOMB_DAMAGE : e.hp);
  }
  return cost;
}

function hasBomb(state: DemonHunterState): boolean {
  return state.player.bombs > 0 || state.player.magicItems.includes('fire');
}

function traderAt(state: DemonHunterState, nodeId: string): boolean {
  return enemiesAt(state, nodeId).some((e) => e.type === 'lady_bandit' && !e.attacked);
}

/** Could it clear this node's blockers, with its HP, a bomb it holds, or a bomb it can buy here? */
function affordable(state: DemonHunterState, nodeId: string): boolean {
  const hp = state.player.hp;
  if (clearCost(state, nodeId) < hp) return true;
  if (hasBomb(state) && clearCost(state, nodeId, true) < hp) return true;
  if (traderAt(state, nodeId) && state.player.shuckles >= BOMB_COST && clearCost(state, nodeId, true) < hp) return true;
  return false;
}

/** A node the bot can leave again without a forced fight. */
function safeToStand(state: DemonHunterState, nodeId: string): boolean {
  if (state.graph.nodes[nodeId]!.kind === 'temple') return false;
  return clearCost(state, nodeId) === 0;
}

/** A node the bot can stand on and leave again: free, or affordable with the
 *  HP it has (so a lone bandit or a skeleton is a stepping stone, a knight is not). */
function passable(state: DemonHunterState, nodeId: string): boolean {
  if (state.graph.nodes[nodeId]!.kind === 'temple') return false;
  return affordable(state, nodeId);
}

/** Something it can cut here without a blocker waiting to pounce. (Mushrooms
 *  follow it everywhere, so they are not a reason to cut elsewhere.) */
function harvestableAt(state: DemonHunterState, nodeId: string): string | null {
  if (!passable(state, nodeId)) return null;
  const r = resourcesAt(state, nodeId).find((x) => x.kind === 'plant') ?? resourcesAt(state, nodeId).find((x) => x.kind === 'tree');
  return r?.id ?? null;
}

/** No undead knight here: the one thing a mid-level bot cannot fight through. */
function noKnights(state: DemonHunterState, nodeId: string): boolean {
  return !enemiesAt(state, nodeId).some((e) => e.type === 'undead_knight');
}

/** First step of a shortest path to a node satisfying `goal`, passing only
 *  through nodes `allowed` (the goal itself is exempt). Walled edges are never used. */
function nextHopTo(state: DemonHunterState, from: string, goal: (id: string) => boolean, allowed: boolean | ((id: string) => boolean)): string | null {
  const path = pathTo(state, from, goal, allowed);
  return path ? path[0]! : null;
}

/** The whole path (excluding `from`) under the same rules, or null. */
function pathTo(state: DemonHunterState, from: string, goal: (id: string) => boolean, allowed: boolean | ((id: string) => boolean)): string[] | null {
  const pass = allowed === true ? () => true : allowed === false ? () => true : allowed;
  const safeOnly = allowed === true;
  const prev: Record<string, string> = {};
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(state.graph, cur)) {
      if (seen.has(n)) continue;
      if (state.graph.nodes[n]!.kind === 'temple') continue;
      if (safeOnly && !passable(state, n) && !goal(n)) continue;
      if (!safeOnly && !pass(n) && !goal(n)) continue;
      seen.add(n);
      prev[n] = cur;
      if (goal(n)) {
        const path: string[] = [];
        let step: string = n;
        while (step !== from) {
          path.unshift(step);
          step = prev[step]!;
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** HP the march to the demon's town would cost from here: this node's
 *  blockers plus every node on the way (not the town itself). */
function marchCost(state: DemonHunterState, here: string): number {
  const target = demonTownNode(state);
  if (here === target) return 0;
  const goal = (id: string): boolean => id === target;
  const path = pathTo(state, here, goal, true) ?? pathTo(state, here, goal, (id) => noKnights(state, id)) ?? pathTo(state, here, goal, false);
  if (!path) return Number.POSITIVE_INFINITY;
  let cost = clearCost(state, here);
  for (const id of path) if (id !== target) cost += clearCost(state, id);
  return cost;
}

function demon(state: DemonHunterState): Person {
  return state.towns.flatMap((t) => t.people).find((x) => x.id === state.demonId)!;
}

function demonTownNode(state: DemonHunterState): string {
  return state.towns.find((t) => t.id === demon(state).attributes.townId)!.nodeId;
}

/** Strong enough to walk through a bandit pair (the usual roadblock) and
 *  still stand: it marches on the demon's town only then. */
function strongEnough(state: DemonHunterState, tier: Tier): boolean {
  const pair = damageFrom(state, 'dude_bandit') + damageFrom(state, 'lady_bandit');
  if (tier === 'easy') return damageFrom(state, 'dude_bandit') < state.player.maxHp;
  return pair < state.player.maxHp;
}

function hasGoods(state: DemonHunterState): boolean {
  return RESOURCE_TYPES.some((r) => state.player.resources[r] > 0);
}

function canHeal(state: DemonHunterState): boolean {
  return state.player.shuckles >= INN_SLEEP_COST || hasGoods(state);
}

function huntable(state: DemonHunterState, id: string): boolean {
  return preyAt(state, id) !== null && passable(state, id);
}

function preyReachable(state: DemonHunterState): boolean {
  const here = state.player.at;
  if (preyAt(state, here)) return true;
  return nextHopTo(state, here, (id) => huntable(state, id), true) !== null;
}

function harvestReachable(state: DemonHunterState): boolean {
  const here = state.player.at;
  if (harvestableAt(state, here)) return true;
  return nextHopTo(state, here, (id) => harvestableAt(state, id) !== null, true) !== null;
}

const isTown = (state: DemonHunterState, id: string): boolean => state.graph.nodes[id]!.kind === 'town';

export function chooseMove(state: DemonHunterState, difficulty?: string): BotChoice {
  const tier = parseTier(difficulty);
  const p = state.player;

  if (state.phase === 'dead') return { move: { type: 'continue' }, reasoning: 'dead: continue' };
  if (state.phase === 'won' || state.phase === 'lost') throw new Error('The game is over.');

  if (state.combat) {
    const e = state.enemies[state.combat.enemyId]!;
    const d = ENEMY_BY_ID[e.type];
    // Run only when running frees it: not from something that will block the
    // exit again (bandits, hunters, a mushroom crowd), and only if it can then
    // pay for a bed. Otherwise a death is the way out (it respawns in town).
    const crowd = enemiesAt(state, p.at).filter((m) => m.type === 'mushroom').length >= 5;
    const trapped = d.behaviour === 'blocker' || d.behaviour === 'hunter' || (d.id === 'mushroom' && crowd);
    if (!state.arena && !trapped && p.hp <= d.damage && e.hp > p.strength && canHeal(state)) {
      return { move: { type: 'flee' }, reasoning: 'about to die: run' };
    }
    return { move: { type: 'fight' }, reasoning: 'fight' };
  }

  if (state.dialogue) {
    const person = state.towns.flatMap((t) => t.people).find((x) => x.id === state.dialogue!.personId)!;
    switch (state.dialogue.stage) {
      case 'found':
        return { move: { type: 'found_you' }, reasoning: 'found the target' };
      case 'reward':
        return { move: { type: 'claim_reward', reward: person.clues.good ? 'clue' : 'power' }, reasoning: 'claim the reward' };
      case 'offer':
        return { move: { type: 'accept_task' }, reasoning: 'task offer' };
      default:
        return { move: { type: 'goodbye' }, reasoning: 'done talking' };
    }
  }

  const strong = strongEnough(state, tier);

  if (state.innOpen) {
    if (p.hp < p.maxHp && p.shuckles >= INN_SLEEP_COST) return { move: { type: 'sleep' }, reasoning: 'heal' };
    const sellable = RESOURCE_TYPES.find((r) => p.resources[r] > 0);
    if (sellable) return { move: { type: 'sell', resource: sellable }, reasoning: 'sell goods' };
    if (!strong && p.shuckles >= INN_TRAIN_COST) return { move: { type: 'train' }, reasoning: 'pay for training' };
    return { move: { type: 'leave_inn' }, reasoning: 'nothing more to do at the inn' };
  }

  if (canLevelUp(state) || p.freeStatPicks > 0) {
    const stat =
      p.maxHp < STAT_MAX.health && p.maxHp <= p.strength + 2 ? 'health'
      : p.strength < STAT_MAX.strength ? 'strength'
      : p.maxHp < STAT_MAX.health ? 'health'
      : p.agility < STAT_MAX.agility ? 'agility' : 'range';
    return { move: { type: 'level_up', stat }, reasoning: `level up ${stat}` };
  }

  const here = hereNode(state);
  const d = demon(state);
  const givingUp = p.deaths >= GIVE_UP_DEATHS || state.turn >= GIVE_UP_TURNS;
  const innWorthwhile = hasGoods(state) || (!strong && p.shuckles >= INN_TRAIN_COST);
  // Nothing left to grind: no prey, nothing to cut, nothing to sell or train with.
  const ready = strong || (!preyReachable(state) && !harvestReachable(state) && !innWorthwhile);

  if (p.inside === 'town') {
    const town = townAtNode(state, p.at)!;
    if ((p.hp < p.maxHp && canHeal(state)) || innWorthwhile) return { move: { type: 'inn' }, reasoning: 'to the inn' };
    const owed = activeTasks(state).find((task) => task.isCompleted && town.people.some((x) => x.id === task.giverId));
    if (owed) return { move: { type: 'talk', person: owed.giverId }, reasoning: 'collect a task reward' };
    if (givingUp) {
      const someone = state.towns.flatMap((t) => t.people).find((x) => x.hasMet && x.id !== d.id);
      void someone;
      const stranger = town.people.find((x) => x.id !== d.id)!;
      return { move: { type: 'stab', person: stranger.id }, reasoning: 'giving up after three deaths' };
    }
    if (ready) {
      if (d.attributes.townId === town.id) return { move: { type: 'stab', person: d.id }, reasoning: 'stab the demon' };
    }
    return { move: { type: 'leave' }, reasoning: ready ? "off to the demon's town" : 'back out to hunt' };
  }

  if (p.inside === 'temple') return { move: { type: 'leave' }, reasoning: 'the bot skips temples' };

  // Outdoors. Once strong enough, prey is a distraction (it respawns every
  // time the bot steps indoors) and a scratch is no reason to turn back.
  const prey = preyAt(state, here.id);
  if (prey && !givingUp && !strong) return { move: { type: 'attack', target: prey.id }, reasoning: `kill a ${ENEMY_BY_ID[prey.type].name}` };

  // Blockers here it cannot afford to fight: soften them with a bomb, buying
  // one from the Lady Bandit if need be (the tip "someone bought a bomb off a
  // Lady Bandit" is exactly this).
  const toll = clearCost(state, here.id);
  if (toll > 0 && toll >= p.hp) {
    if (!hasBomb(state) && traderAt(state, here.id) && p.shuckles >= BOMB_COST) {
      if (!p.blackMarketKnown) return { move: { type: 'talk_bandit' }, reasoning: 'see what the Lady Bandit wants' };
      return { move: { type: 'buy_from_bandit', item: 'bomb' }, reasoning: 'buy a bomb to break out' };
    }
    if (hasBomb(state) && clearCost(state, here.id, true) < p.hp) return { move: { type: 'bomb' }, reasoning: 'bomb the blockers' };
  }

  // Strong: rest only when the whole march ahead costs more HP than it has
  // (every rest stop respawns the wild, so the march restarts from scratch).
  const needsRest = strong ? p.hp < p.maxHp && marchCost(state, here.id) >= p.hp : p.hp < p.maxHp;
  if (needsRest) {
    if (canHeal(state)) {
      if (here.kind === 'town') return { move: { type: 'enter' }, reasoning: 'into town to heal' };
      const next =
        nextHopTo(state, here.id, (id) => isTown(state, id) && safeToStand(state, id), true) ??
        nextHopTo(state, here.id, (id) => isTown(state, id), true) ??
        nextHopTo(state, here.id, (id) => isTown(state, id), (id) => noKnights(state, id));
      if (next) return { move: { type: 'move', to: next }, reasoning: 'towards a town to heal' };
    } else if (!givingUp) {
      const cut = harvestableAt(state, here.id);
      if (cut) return { move: { type: 'attack', target: cut }, reasoning: 'cut something to pay for a bed' };
      const toCut = nextHopTo(state, here.id, (id) => harvestableAt(state, id) !== null, true);
      if (toCut) return { move: { type: 'move', to: toCut }, reasoning: 'towards something to cut, to pay for a bed' };
    }
  }

  if (givingUp) {
    if (here.kind === 'town') return { move: { type: 'enter' }, reasoning: 'giving up: into town' };
    const goal = (id: string): boolean => isTown(state, id);
    const next = nextHopTo(state, here.id, goal, true) ?? nextHopTo(state, here.id, goal, (id) => noKnights(state, id)) ?? nextHopTo(state, here.id, goal, false);
    if (next) return { move: { type: 'move', to: next }, reasoning: 'giving up: to a town' };
    return { move: { type: 'look' }, reasoning: 'stuck' };
  }

  if (ready) {
    const target = demonTownNode(state);
    if (here.id === target) return { move: { type: 'enter' }, reasoning: "into the demon's town" };
    const goal = (id: string): boolean => id === target;
    const next = nextHopTo(state, here.id, goal, true) ?? nextHopTo(state, here.id, goal, (id) => noKnights(state, id)) ?? nextHopTo(state, here.id, goal, false);
    if (next) return { move: { type: 'move', to: next }, reasoning: "towards the demon's town" };
    if (here.kind === 'town') return { move: { type: 'enter' }, reasoning: 'into town' };
    return { move: { type: 'look' }, reasoning: 'stuck' };
  }

  // Grinding: prey first, then cutting, then selling and training.
  const toPrey = nextHopTo(state, here.id, (id) => huntable(state, id), true);
  if (toPrey) return { move: { type: 'move', to: toPrey }, reasoning: 'towards prey' };
  const cut = harvestableAt(state, here.id);
  if (cut) return { move: { type: 'attack', target: cut }, reasoning: 'cut something to sell' };
  if (innWorthwhile) {
    if (here.kind === 'town') return { move: { type: 'enter' }, reasoning: 'into town to sell and train' };
    const next = nextHopTo(state, here.id, (id) => isTown(state, id) && safeToStand(state, id), true) ?? nextHopTo(state, here.id, (id) => isTown(state, id), true);
    if (next) return { move: { type: 'move', to: next }, reasoning: 'towards a town to sell' };
  }
  const toCut = nextHopTo(state, here.id, (id) => harvestableAt(state, id) !== null, true);
  if (toCut) return { move: { type: 'move', to: toCut }, reasoning: 'towards something to cut' };
  if (here.kind === 'town') return { move: { type: 'enter' }, reasoning: 'into town' };
  return { move: { type: 'look' }, reasoning: 'nothing to do' };
}
