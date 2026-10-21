// Harvesting, bombs, levelling, death and the Lady Bandit's black market
// (PORT-PLAN §8–§9).

import { BOMB_COST, BOMB_DAMAGE, LOCKPICK_COST, STAT_BASE, STAT_MAX, STAT_STEP, type StatId } from '../data/progression.js';
import { GOLD_DROP_CHANCE, HARVEST_AGGRO_CHANCE, IRON_DROP_CHANCE, RESOURCE_DISPLAY_NAME, RESOURCE_NODE } from '../data/resources.js';
import { ENEMY_BY_ID } from '../data/enemies.js';
import { chance, pick, randomFloat } from '../rng.js';
import type { Enemy } from '../types.js';

const defOfEnemy = (e: Enemy) => ENEMY_BY_ID[e.type];
import type { DemonHunterState } from '../types.js';
import { edgeBetween, neighborsOf } from '../world/graph.js';
import { killEnemy, startCombat } from './combat.js';
import { refuse } from './errors.js';
import { aggressiveAt, canLevelUp, enemiesAt, enemyName, hasMagicItem, healToFull, hereNode, resourcesAt, statIsMaxed } from './helpers.js';
import { arriveInTown, requireNoCombat, requireOutdoors } from './movement.js';

/** `attack {target}` on a plant or tree. */
export function harvest(state: DemonHunterState, resourceId: string, lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  if (state.player.auraUp) refuse('You cannot attack while the Aura of Protection is up.');
  if (state.player.flying && state.player.range < 3) refuse('You cannot reach it from the air with range below 3. Land first.');
  const r = state.resources[resourceId];
  if (!r || r.at !== state.player.at) refuse(`There is no "${resourceId}" here.`);
  if (r.kind === 'ore') refuse('Ore deposits must be blown up with a bomb.');
  const def = RESOURCE_NODE[r.kind];
  r.hp -= state.player.strength;
  lines.push(`You hack at the ${def.name}${r.hp > 0 ? ` (${r.hp} more to go)` : ''}.`);
  if (r.hp <= 0) {
    delete state.resources[r.id];
    const yields = def.yields!;
    state.player.resources[yields]++;
    lines.push(`You collect ${RESOURCE_DISPLAY_NAME[yields]} (${state.player.resources[yields]}).`);
  }
  // 10% to attract a nearby aggressive enemy, if any.
  const nearby = aggressiveAt(state, state.player.at);
  if (nearby.length > 0) {
    const roll = chance(state.seed, HARVEST_AGGRO_CHANCE);
    state.seed = roll.nextSeed;
    if (roll.value) {
      const e = pick(nearby, state.seed);
      state.seed = e.nextSeed;
      startCombat(state, e.value.id, 'harvest', lines);
    }
  }
}

/** `bomb` outdoors: everything on the node takes the blast. Every enemy is
 *  hurt by 5, every ore deposit shatters and rolls ore, every plant and tree
 *  is burnt (no yield), and if the node touches the Sky Temple's stone ring
 *  the ring opens (with an ore roll of its own). */
export function bomb(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  const p = state.player;
  const unlimited = hasMagicItem(state, 'fire');
  if (!unlimited && p.bombs <= 0) refuse('You have no bombs.');
  const here = hereNode(state);

  if (!unlimited) {
    p.bombs--;
    lines.push(`You light a bomb (${p.bombs} left).`);
  } else {
    lines.push('You conjure a Fire Bomb.');
  }
  lines.push('BOOM!');

  let oreRolls = 0;
  const wall = neighborsOf(state.graph, here.id, { includeWalled: true })
    .map((n) => edgeBetween(state.graph, here.id, n)!)
    .find((e) => e.walled);
  if (wall) {
    wall.walled = false;
    oreRolls++;
    lines.push('The blast tears a hole in the stone ring. The way to the Sky Temple is open.');
  }

  for (const e of enemiesAt(state, here.id)) {
    e.hp -= BOMB_DAMAGE;
    e.attacked = true;
    if (e.hp <= 0) killEnemy(state, e, lines);
    else lines.push(`The blast hurts the ${enemyName(e)} (${e.hp}/${e.maxHp} HP left).`);
  }

  let burnt = 0;
  for (const r of resourcesAt(state, here.id)) {
    delete state.resources[r.id];
    if (r.kind === 'ore') {
      oreRolls++;
      lines.push('An ore deposit shatters.');
    } else burnt++;
  }
  if (burnt > 0) lines.push(`${burnt} plant${burnt === 1 ? '' : 's'} or tree${burnt === 1 ? '' : 's'} here burn to nothing.`);

  for (let k = 0; k < oreRolls; k++) {
    const roll = randomFloat(state.seed);
    state.seed = roll.nextSeed;
    if (roll.value < GOLD_DROP_CHANCE) {
      p.resources.gold++;
      lines.push(`Something glints in the rubble: Gold (${p.resources.gold}).`);
    } else if (roll.value < GOLD_DROP_CHANCE + IRON_DROP_CHANCE) {
      p.resources.iron_ore++;
      lines.push(`You dig Iron Ore out of the rubble (${p.resources.iron_ore}).`);
    } else {
      lines.push('Nothing but rubble.');
    }
  }
}

/** `level_up {stat}`: spend an earned level (xp past the curve) or a
 *  Blacksmith's free pick. */
export function levelUp(state: DemonHunterState, stat: StatId, lines: string[]): void {
  const p = state.player;
  const free = p.freeStatPicks > 0;
  if (!free && !canLevelUp(state)) refuse('You have no level to spend.');
  if (!(stat in STAT_BASE)) refuse(`"${stat}" is not a stat. Choose strength, agility, health or range.`);
  if (statIsMaxed(state, stat)) refuse(`Your ${stat} is already at its maximum (${STAT_MAX[stat]}).`);
  if (free) p.freeStatPicks--;
  else p.level++;
  if (stat === 'health') {
    p.maxHp += STAT_STEP.health;
    healToFull(state);
    lines.push(`${free ? 'The Blacksmith improves your' : `Level ${p.level}:`} health is now ${p.maxHp}, and you are healed to full.`);
  } else {
    p[stat] += STAT_STEP[stat];
    lines.push(`${free ? 'The Blacksmith improves your' : `Level ${p.level}:`} ${stat} is now ${p[stat]}.`);
  }
  if (!free && canLevelUp(state)) lines.push('You can level up again.');
}

/** `continue` after death: the original's Continue button. */
export function continueAfterDeath(state: DemonHunterState, lines: string[]): void {
  if (state.phase !== 'dead') refuse('You are not dead.');
  const p = state.player;
  p.level = 1;
  p.xp = 0;
  p.strength = STAT_BASE.strength;
  p.agility = STAT_BASE.agility;
  p.range = STAT_BASE.range;
  p.maxHp = STAT_BASE.health;
  p.hp = STAT_BASE.health;
  p.freeStatPicks = 0;
  p.flying = false;
  p.auraUp = false;
  state.combat = null;
  state.temple = null;
  state.arena = null;
  state.dialogue = null;
  state.innOpen = false;
  state.phase = 'playing';
  // Temple guardians and arena foes do not outlive the attempt.
  for (const e of Object.values(state.enemies)) if (defOfEnemy(e).templeOnly) delete state.enemies[e.id];
  lines.push('You wake up. Your level and stats are back to where you started, but you kept everything you carried and learned.');
  arriveInTown(state, p.lastTown, lines);
}

/** `talk_bandit`: a Lady Bandit here who has not been attacked will trade. */
export function talkBandit(state: DemonHunterState, lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  const lady = findTrader(state);
  if (!lady) refuse('There is no Lady Bandit here willing to talk.');
  state.player.blackMarketKnown = true;
  lines.push(`The Lady Bandit looks you over, then lowers her voice. "You're not here to fight, are you. Good. I deal, if you've got coin: a bomb for ${BOMB_COST} shuckles, a lockpick for ${LOCKPICK_COST}. You have ${state.player.shuckles}."`);
}

export function buyFromBandit(state: DemonHunterState, item: 'bomb' | 'lockpick', lines: string[]): void {
  requireNoCombat(state);
  requireOutdoors(state);
  const lady = findTrader(state);
  if (!lady) refuse('There is no Lady Bandit here willing to trade.');
  const cost = item === 'bomb' ? BOMB_COST : LOCKPICK_COST;
  if (state.player.shuckles < cost) refuse(`A ${item} costs ${cost} shuckles; you have ${state.player.shuckles}.`);
  state.player.shuckles -= cost;
  if (item === 'bomb') state.player.bombs++;
  else state.player.lockpicks++;
  lines.push(`You buy a ${item} for ${cost} shuckles (${state.player.shuckles} left; bombs ${state.player.bombs}, lockpicks ${state.player.lockpicks}).`);
  // After a sale she slips away (the original removes her).
  delete state.enemies[lady.id];
  lines.push('The Lady Bandit pockets your coins and vanishes into the trees.');
}

function findTrader(state: DemonHunterState) {
  return enemiesAt(state, state.player.at).find((e) => e.type === 'lady_bandit' && !e.attacked) ?? null;
}
