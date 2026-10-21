// Every move the player may take right now, with a stable move_id and a
// plain-words description. Fill-in moves (a riddle answer) carry a template.

import { ENEMY_BY_ID } from './data/enemies.js';
import { INN_RIDE_COST, INN_SLEEP_COST, INN_TRAIN_COST, STAT_BASE, type StatId } from './data/progression.js';
import { buyPrice, RESOURCE_DISPLAY_NAME, RESOURCE_NODE, RESOURCE_TYPES, sellPrice } from './data/resources.js';
import type { DemonHunterMove } from './engine/moves.js';
import { canLevelUp, condition, currentTown, enemiesAt, hasMagicItem, hereNode, resourcesAt, statIsMaxed } from './engine/helpers.js';
import type { DemonHunterState } from './types.js';
import { edgeBetween, neighborsOf } from './world/graph.js';

export interface LegalMoveEntry {
  move_id: string;
  description: string;
  move: DemonHunterMove;
  cost?: string;
}

export function getLegalMoves(state: DemonHunterState): LegalMoveEntry[] {
  const out: LegalMoveEntry[] = [];
  const add = (move_id: string, description: string, move: DemonHunterMove, cost?: string): void => {
    out.push(cost ? { move_id, description, move, cost } : { move_id, description, move });
  };
  const p = state.player;
  if (state.phase === 'won' || state.phase === 'lost') return out;
  add('look', 'Look around', { type: 'look' });
  if (state.phase === 'dead') {
    add('continue', 'Continue: wake up in the last town you visited (stats reset, everything else kept)', { type: 'continue' });
    return out;
  }

  const levelUps = (): void => {
    if (!canLevelUp(state) && p.freeStatPicks <= 0) return;
    for (const stat of Object.keys(STAT_BASE) as StatId[]) {
      if (statIsMaxed(state, stat)) continue;
      add(`level_up:${stat}`, `${p.freeStatPicks > 0 ? 'Blacksmith: improve' : 'Level up:'} ${stat}`, { type: 'level_up', stat });
    }
  };

  if (state.combat) {
    const e = state.enemies[state.combat.enemyId]!;
    const d = ENEMY_BY_ID[e.type];
    if (!(p.flying && p.range < 3)) add('fight', `Attack the ${d.name}`, { type: 'fight' });
    if (!state.arena) add('flee', `Run away from the ${d.name}${d.behaviour === 'hunter' ? ' (it gets one attack as you go)' : ''}`, { type: 'flee' });
    if (hasMagicItem(state, 'earth') && !state.arena) add('aura', 'Aura of Protection: leave the fight untouched', { type: 'aura' });
    levelUps();
    return out;
  }

  if (state.dialogue) {
    const person = state.towns.flatMap((t) => t.people).find((x) => x.id === state.dialogue!.personId)!;
    switch (state.dialogue.stage) {
      case 'found':
        add('found_you', `Tell ${person.name} "I found you"`, { type: 'found_you' });
        break;
      case 'reward':
        if (person.clues.good) add('claim_reward:clue', `Take ${person.name}'s demon secret (clue)`, { type: 'claim_reward', reward: 'clue' });
        add('claim_reward:power', `Take ${person.name}'s ability (power)`, { type: 'claim_reward', reward: 'power' });
        break;
      case 'offer':
        add('accept_task', `Accept ${person.name}'s task: ${person.task.description}`, { type: 'accept_task' });
        add('decline', 'No thanks', { type: 'decline' });
        break;
      default:
        break;
    }
    add('goodbye', `Say goodbye to ${person.name}`, { type: 'goodbye' });
    return out;
  }

  if (state.innOpen) {
    const town = currentTown(state);
    if (p.hp < p.maxHp && p.shuckles >= INN_SLEEP_COST) add('sleep', 'Sleep: heal to full', { type: 'sleep' }, `${INN_SLEEP_COST} shuckles`);
    if (p.shuckles >= INN_TRAIN_COST) add('train', 'Train: +20 XP', { type: 'train' }, `${INN_TRAIN_COST} shuckles`);
    if (p.shuckles >= INN_RIDE_COST) {
      for (const t of state.towns) if (t.id !== town.id) add(`ride:${t.id}`, `Ride to ${t.name}`, { type: 'ride', town: t.id }, `${INN_RIDE_COST} shuckles`);
    }
    for (const r of RESOURCE_TYPES) {
      const buy = buyPrice(r, town.prices[r]);
      if (town.stock[r] > 0 && p.shuckles >= buy) add(`buy:${r}`, `Buy ${RESOURCE_DISPLAY_NAME[r]}`, { type: 'buy', resource: r }, `${buy} shuckles`);
      if (p.resources[r] > 0) add(`sell:${r}`, `Sell ${RESOURCE_DISPLAY_NAME[r]} for ${sellPrice(r, town.prices[r])} shuckles`, { type: 'sell', resource: r });
    }
    add('leave_inn', 'Leave the inn', { type: 'leave_inn' });
    return out;
  }

  const anywhere = (): void => {
    if (!state.combat && state.phase === 'playing') {
      add('travel', 'Travel in one go to a place, a person\'s town, or the nearest inn (fill in to / person / nearest). Stops at the edge of anywhere that would attack you on the way out; travel again to go on.', { type: 'travel' });
    }
    levelUps();
    if (hasMagicItem(state, 'space')) {
      for (const t of state.towns) {
        if (p.visitedTowns.includes(t.id) && !(p.inside === 'town' && hereNode(state).townId === t.id)) {
          add(`teleport:${t.id}`, `Cape of Teleportation: go to ${t.name}`, { type: 'teleport', town: t.id });
        }
      }
    }
    const people = state.towns.flatMap((t) => t.people).filter((x) => x.hasMet);
    for (const x of people) {
      if (p.suspects.includes(x.id)) add(`unmark_suspect:${x.id}`, `Unmark ${x.name} as a suspect`, { type: 'unmark_suspect', person: x.id });
      else if (p.suspects.length < state.towns.length * 2) add(`mark_suspect:${x.id}`, `Mark ${x.name} as a suspect`, { type: 'mark_suspect', person: x.id });
    }
  };

  if (p.inside === 'town') {
    const town = currentTown(state);
    for (const x of town.people) add(`talk:${x.id}`, `Talk to ${x.name} the ${x.attributes.occupation}${x.hasMet ? '' : ' (not yet met)'}`, { type: 'talk', person: x.id });
    add('search_town', 'Ask around town; whoever fits counts as met (fill in what you are looking for: a pet, colour, trade or item; a task by its monster or a word of it; truth = who claims to know the truth; contradictions = which rumours clash with your secrets)', { type: 'search_town' });
    for (const x of town.people) add(`stab:${x.id}`, `STAB ${x.name} the ${x.attributes.occupation} with the demon-killing knife (an innocent dies and you lose)`, { type: 'stab', person: x.id });
    add('inn', 'Go to the inn', { type: 'inn' });
    if (p.locksmithCharges > 0 || p.lockpicks > 0) {
      for (const x of town.people) {
        if (!p.searchedHouses.includes(x.id)) add(`search_house:${x.id}`, `Search ${x.name}'s house`, { type: 'search_house', person: x.id, confirm: true }, p.locksmithCharges > 0 ? "a Locksmith's favour" : 'one lockpick');
      }
    }
    add('leave', `Leave ${town.name}`, { type: 'leave' });
    anywhere();
    return out;
  }

  if (p.inside === 'temple') {
    const t = state.temple;
    if (t) {
      if (t.mode === 'choice' || t.mode === 'riddle') add('gauntlet', 'Take the gauntlet', { type: 'gauntlet' });
      if (t.mode === 'gauntlet' && t.remaining > 0) add('next_fight', 'Face the next guardian', { type: 'next_fight' });
      if (t.mode !== 'riddle') add('riddle', 'Try the riddle door', { type: 'riddle' });
      if (t.mode === 'riddle') add('answer_riddle', 'Answer the riddle (fill in text)', { type: 'answer_riddle', text: '' });
    }
    add('leave', `Leave the ${hereNode(state).name}`, { type: 'leave' });
    anywhere();
    return out;
  }

  // Outdoors.
  const here = hereNode(state);
  for (const n of neighborsOf(state.graph, here.id, { includeWalled: true })) {
    const edge = edgeBetween(state.graph, here.id, n)!;
    const node = state.graph.nodes[n]!;
    if (edge.walled) continue;
    add(`move:${n}`, `Go to ${node.name} (${node.kind})`, { type: 'move', to: n });
  }
  if (here.kind === 'town' || here.kind === 'temple') add('enter', `Enter ${here.name}`, { type: 'enter' });
  const canAttack = !p.auraUp && !(p.flying && p.range < 3);
  if (canAttack) {
    for (const e of enemiesAt(state, here.id)) add(`attack:${e.id}`, `Attack the ${ENEMY_BY_ID[e.type].name} ${e.id} (${condition(e)})`, { type: 'attack', target: e.id });
    for (const r of resourcesAt(state, here.id)) {
      if (r.kind !== 'ore') add(`attack:${r.id}`, `Harvest the ${RESOURCE_NODE[r.kind].name} ${r.id}`, { type: 'attack', target: r.id });
    }
  }
  const canBomb = hasMagicItem(state, 'fire') || p.bombs > 0;
  if (canBomb) {
    const wall = neighborsOf(state.graph, here.id, { includeWalled: true }).some((n) => edgeBetween(state.graph, here.id, n)!.walled);
    const ore = resourcesAt(state, here.id).filter((r) => r.kind === 'ore').length;
    const what = ['hurt every enemy here by 5', ...(ore > 0 ? [`shatter ${ore} ore deposit${ore === 1 ? '' : 's'}`] : []), ...(wall ? ['blow a hole in the stone ring'] : []), 'burn every plant and tree here'];
    add('bomb', `Bomb this place: ${what.join(', ')}`, { type: 'bomb' }, hasMagicItem(state, 'fire') ? 'free' : 'one bomb');
  }
  if (enemiesAt(state, here.id).some((e) => e.type === 'lady_bandit' && !e.attacked)) {
    add('talk_bandit', 'Talk to the Lady Bandit', { type: 'talk_bandit' });
    // Her wares are a secret until the player has heard her offer.
    if (p.blackMarketKnown) {
      add('buy_from_bandit:bomb', 'Buy a bomb from the Lady Bandit', { type: 'buy_from_bandit', item: 'bomb' }, '10 shuckles');
      add('buy_from_bandit:lockpick', 'Buy a lockpick from the Lady Bandit', { type: 'buy_from_bandit', item: 'lockpick' }, '200 shuckles');
    }
  }
  if (hasMagicItem(state, 'sky')) {
    if (p.flying) add('land', 'Land', { type: 'land' });
    else add('fly', 'Winged Boots: take to the air', { type: 'fly' });
  }
  if (hasMagicItem(state, 'earth') && !p.auraUp) add('aura', 'Aura of Protection: pass every enemy here on your next move', { type: 'aura' });
  anywhere();
  return out;
}
