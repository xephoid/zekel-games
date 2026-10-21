// One-on-one combat (PORT-PLAN §5).
//
// Order: at the start, the side with the higher range gets one free attack
// (opening). Then the faster side acts first (player agility vs enemy speed,
// ties to the player); sides alternate from there. An action is attack or run
// away. Attacks always hit; attacks per action = max(1, floor(own speed ÷
// other speed)). Player damage = strength; enemy damage = its table value.
//
// The player's action is a move (fight / flee); the enemy's action resolves
// automatically right after, or right at the start when it is faster.

import { ENEMIES, ENEMY_BY_ID, TEMPLE_ENEMY_TYPES } from '../data/enemies.js';
import { LAIR, WORLD_CLEARED_XP } from '../data/progression.js';
import { weakenings } from './finale.js';
import { chance, pick, shuffle } from '../rng.js';

export const LAIR_NODE_ID = 'lair';
import type { DemonHunterState, Enemy } from '../types.js';
import { neighborsOf } from '../world/graph.js';
import { refuse } from './errors.js';
import { activeTasks, attacksPerAction, condition, defOf, enemyName, gainXp, overworldEnemiesLeft, withArticle } from './helpers.js';
import { grantMagicItem } from './rewards.js';

export type CombatCause = 'attack' | 'leaving' | 'harvest' | 'gauntlet' | 'lair' | 'flying' | 'resume';

export function inCombat(state: DemonHunterState): boolean {
  return state.combat !== null;
}

export function combatEnemy(state: DemonHunterState): Enemy {
  const c = state.combat;
  if (!c) refuse('You are not in a fight.');
  const e = state.enemies[c.enemyId];
  if (!e) refuse('The enemy you were fighting is gone.');
  return e;
}

/** Start a fight. Resolves the opening (range) attack and, when the enemy is
 *  faster, its first action. Afterwards it is the player's action unless the
 *  fight already ended. */
export function startCombat(state: DemonHunterState, enemyId: string, cause: CombatCause, lines: string[]): void {
  const enemy = state.enemies[enemyId];
  if (!enemy) refuse(`There is no enemy "${enemyId}" here.`);
  const def = defOf(enemy);
  const p = state.player;
  state.combat = { enemyId, round: 1, enemyDamaged: false, openingDone: false, turn: 'player' };
  const why: Record<CombatCause, string> = {
    attack: `You go for the ${def.name}.`,
    leaving: `The ${def.name} attacks as you try to leave!`,
    harvest: `Your noise draws the ${def.name} to you!`,
    gauntlet: `${withArticle(def.name, true)} comes at you.`,
    lair: `The ${def.name} rises to meet you.`,
    flying: `The ${def.name} fires at you as you fly past!`,
    resume: `The ${def.name} comes at you again.`,
  };
  lines.push(why[cause]);
  lines.push(`Combat: you (HP ${p.hp}/${p.maxHp}, strength ${p.strength}, speed ${p.agility}, range ${p.range}) vs the ${def.name}, ${condition(enemy)}.`);

  // Opening: higher range gets one free attack (not when a fight resumes).
  if (cause === 'resume') {
    // no opening
  } else if (p.range > def.range) {
    lines.push(`You strike before the ${def.name} can close: a free attack.`);
    playerHits(state, 1, lines);
  } else if (def.range > p.range) {
    lines.push(`The ${def.name} strikes before you can close.`);
    enemyHits(state, 1, lines);
  }
  if (!state.combat) return; // ended during the opening
  state.combat.openingDone = true;

  if (def.speed > p.agility) {
    lines.push(`The ${def.name} is faster and acts first.`);
    enemyAction(state, lines);
  } else {
    lines.push(def.speed === p.agility ? `You and the ${def.name} move at the same pace: you act first.` : 'You are faster and act first.');
  }
}

/** Player's action: attack. */
export function playerFight(state: DemonHunterState, lines: string[]): void {
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  if (state.player.flying && state.player.range < 3) {
    refuse('You cannot attack from the air with range below 3. Land first.');
  }
  const attacks = attacksPerAction(state.player.agility, def.speed);
  lines.push(attacks > 1 ? `You attack ${attacks} times.` : 'You attack.');
  playerHits(state, attacks, lines);
  if (!state.combat) return;
  enemyAction(state, lines);
}

/** Player's action: run away. Always succeeds; skeletons and undead knights
 *  get one parting attack (ruling 2026-10-20). */
export function playerFlee(state: DemonHunterState, lines: string[]): void {
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  if (state.lair) refuse('There is no way out of the lair but through the demon.');
  lines.push(`You run from the ${def.name}.`);
  if (def.behaviour === 'hunter') {
    lines.push(`The ${def.name} attacks as you run!`);
    enemyHits(state, 1, lines);
    if (!state.combat) return; // died
  }
  endCombat(state);
  lines.push('You got away.');
}

/** Aura of Protection: the fight ends with no parting shots. */
export function auraEscape(state: DemonHunterState, lines: string[]): void {
  const enemy = combatEnemy(state);
  if (state.lair) refuse('The Aura of Protection cannot carry you out of the lair.');
  lines.push(`The Aura of Protection flares; the ${enemyName(enemy)} cannot touch you and you walk away from the fight.`);
  endCombat(state);
}

function endCombat(state: DemonHunterState): void {
  state.combat = null;
}

function playerHits(state: DemonHunterState, attacks: number, lines: string[]): void {
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  for (let i = 0; i < attacks && enemy.hp > 0; i++) {
    enemy.hp -= state.player.strength;
    enemy.attacked = true;
    state.combat!.enemyDamaged = true;
    lines.push(enemy.hp > 0 ? `You hit the ${def.name} for ${state.player.strength}; it is ${condition(enemy)}.` : `You hit the ${def.name} for ${state.player.strength}.`);
  }
  if (enemy.hp <= 0) {
    killEnemy(state, enemy, lines);
    endCombat(state);
    return;
  }
  // Lair phase 2: at two-thirds HP the demon withdraws and summons minions.
  if (def.behaviour === 'boss' && state.lair && !state.lair.phase2Done && enemy.hp <= Math.floor((enemy.maxHp * 2) / 3)) {
    state.lair.phase2Done = true;
    const pool = ENEMIES.filter((d) => !d.templeOnly);
    const chosen = shuffle(pool, state.seed);
    state.seed = chosen.nextSeed;
    const lost = Math.floor((state.player.bindings.length + state.player.magicItems.length) / LAIR.weakeningsPerMinionLost);
    const minions = chosen.items.slice(0, Math.max(0, LAIR.minionCount - lost));
    if (minions.length === 0) {
      lines.push('The Demon screams for its servants, but your bindings hold them fast: nothing answers. It turns back to you.');
      return;
    }
    state.lair.minionQueue = minions.map((d, i) => {
      const id = `lair_minion_${i + 1}`;
      state.enemies[id] = { id, type: d.id, at: LAIR_NODE_ID, hp: LAIR.minionHp, maxHp: LAIR.minionHp, attacked: false };
      return id;
    });
    lines.push(`The Demon screams and retreats to the centre of the lair. ${minions.length === 1 ? 'A Demon Minion answers' : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][minions.length] ?? minions.length} Demon Minions answer`} its call: ${minions.map((d) => d.name).join(', ')}. You must fight them one at a time.`);
    endCombat(state);
  }
}

function winLair(state: DemonHunterState, summary: string, lines: string[]): void {
  state.phase = 'won';
  state.combat = null;
  state.lair = null;
  for (const e of Object.values(state.enemies)) if (e.at === LAIR_NODE_ID) delete state.enemies[e.id];
  state.result = { winner: 'player', summary };
  lines.push(summary);
}

/** `say {text}`: words spoken aloud. In the lair, to the demon's face, one
 *  word undoes it (the songs were right); anything else costs you its next
 *  action. Elsewhere, nothing answers. The GM-facing texts never name the
 *  word; the rumours and the lore do (ruling 2026-10-21). */
export function say(state: DemonHunterState, text: string, lines: string[]): void {
  const spoken = (text ?? '').trim();
  if (spoken === '') refuse('Say what? Give the words.');
  if (!state.combat) {
    lines.push(`You say it aloud: "${spoken}". Nothing answers.`);
    return;
  }
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  if (def.behaviour !== 'boss') {
    lines.push(`You say it: "${spoken}". The ${def.name} does not care for words.`);
    enemyAction(state, lines);
    return;
  }
  if (/\blove\b/i.test(spoken)) {
    lines.push(
      `You say it: "${spoken}". The word hangs in the dark. The Demon stops mid-stride, and something in the grin breaks. ` +
      `"She said that," it says, and for a moment the face it wears is no mask at all. The black pillars crack from floor to vault. ` +
      'Whatever Chineera did to it long ago, you have done again: it comes apart like smoke in a draught, and the lair with it.',
    );
    winLair(state, 'The Demon is undone by the word Chineera once said to it. The land is free, and the hunt is over: you win!', lines);
    return;
  }
  lines.push(`You say it: "${spoken}". The Demon laughs, and the laugh goes on too long.`);
  enemyAction(state, lines);
}

/** Between lair fights: the next minion, then the demon again, or victory. */
export function lairContinue(state: DemonHunterState, lines: string[]): void {
  // A foe can die to the opening attack of its own fight; keep going until a
  // fight is open or the lair is over.
  let guard = 0;
  while (state.lair && !state.combat && state.phase === 'lair' && guard++ < 10) lairStep(state, lines);
}

function lairStep(state: DemonHunterState, lines: string[]): void {
  const lair = state.lair;
  if (!lair || state.combat || state.phase !== 'lair') return;
  if (!state.enemies[lair.demonEnemyId]) {
    winLair(state, 'The Demon is destroyed. The land is free, and the hunt is over: you win!', lines);
    return;
  }
  const next = lair.minionQueue.find((id) => state.enemies[id]);
  if (next) {
    lair.minionQueue = lair.minionQueue.filter((id) => id !== next);
    startCombat(state, next, 'lair', lines);
    return;
  }
  startCombat(state, lair.demonEnemyId, 'resume', lines);
}

function enemyHits(state: DemonHunterState, attacks: number, lines: string[]): void {
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  const p = state.player;
  if (p.flying && def.range < 3) {
    lines.push(`The ${def.name} cannot reach you in the air.`);
    return;
  }
  for (let i = 0; i < attacks && p.hp > 0; i++) {
    p.hp -= def.damage;
    lines.push(`The ${def.name} hits you for ${def.damage} (${Math.max(0, p.hp)}/${p.maxHp} HP left).`);
  }
  if (p.hp <= 0) die(state, def.name, lines);
}

/** The enemy's action, by behaviour. */
function enemyAction(state: DemonHunterState, lines: string[]): void {
  const enemy = combatEnemy(state);
  const def = defOf(enemy);
  const p = state.player;
  switch (def.behaviour) {
    case 'wizard': {
      if (!state.combat!.enemyDamaged) {
        lines.push('The Wizard watches you warily and does nothing.');
        return;
      }
      lines.push('The Wizard turns to run.');
      wizardFlee(state, enemy, lines);
      endCombat(state);
      return;
    }
    case 'snake': {
      if (state.combat!.enemyDamaged) {
        const roll = chance(state.seed, 0.5);
        state.seed = roll.nextSeed;
        if (roll.value) {
          const dest = randomNeighbour(state, state.player.at);
          if (dest) enemy.at = dest;
          lines.push(`The wounded Snake slithers away${dest ? ` towards ${state.graph.nodes[dest]!.name}` : ''}.`);
          endCombat(state);
          return;
        }
      }
      break;
    }
    default:
      break;
  }
  let attacks = attacksPerAction(def.speed, p.agility);
  if (def.behaviour === 'boss' && state.lair && enemy.hp <= Math.floor(enemy.maxHp / 3)) attacks += LAIR.phase3ExtraAttacks; // phase 3 (ruling 2026-10-21: a double shot, not triple)
  lines.push(attacks > 1 ? `The ${def.name} attacks ${attacks} times.` : `The ${def.name} attacks.`);
  enemyHits(state, attacks, lines);
  if (state.combat) state.combat.round++;
}

function randomNeighbour(state: DemonHunterState, from: string): string | null {
  const options = neighborsOf(state.graph, from).filter((n) => state.graph.nodes[n]!.kind !== 'temple');
  if (options.length === 0) return null;
  const r = pick(options, state.seed);
  state.seed = r.nextSeed;
  return r.value;
}

/** A wizard runs: 50% teleport to another clearing, else to a neighbour. */
export function wizardFlee(state: DemonHunterState, enemy: Enemy, lines: string[]): void {
  const roll = chance(state.seed, 0.5);
  state.seed = roll.nextSeed;
  const clearings = Object.values(state.graph.nodes).filter((n) => n.kind === 'clearing' && n.id !== enemy.at);
  if (roll.value && clearings.length > 0) {
    const r = pick(clearings, state.seed);
    state.seed = r.nextSeed;
    enemy.at = r.value.id;
    lines.push('With a crack of light the Wizard teleports away.');
    return;
  }
  const dest = randomNeighbour(state, enemy.at);
  if (dest) {
    enemy.at = dest;
    lines.push(`The Wizard flees towards ${state.graph.nodes[dest]!.name}.`);
  } else {
    lines.push('The Wizard backs off out of reach.');
  }
}

/** Remove a dead enemy and pay out: XP, kill-task progress, drops, the
 *  world-cleared bonus. Also used by bombs. */
export function killEnemy(state: DemonHunterState, enemy: Enemy, lines: string[]): void {
  const def = defOf(enemy);
  delete state.enemies[enemy.id];
  lines.push(`The ${def.name} is dead.`);
  if (def.behaviour === 'boss') return; // the finale handles its own ending

  // Drops (original onEntityKilled): temple enemies → demon ichor; overworld
  // enemies except bandits → demon powder.
  if (TEMPLE_ENEMY_TYPES.includes(def.id)) {
    state.player.resources.demon_ichor++;
    lines.push(`You collect 1 Demon Ichor (${state.player.resources.demon_ichor} in all).`);
  } else if (def.id !== 'dude_bandit' && def.id !== 'lady_bandit') {
    state.player.resources.demon_powder++;
    lines.push(`You collect 1 Demon Powder (${state.player.resources.demon_powder} in all).`);
  }

  // Kill-task progress: every accepted task that wants this kind of monster.
  for (const task of activeTasks(state)) {
    if (task.isCompleted || task.type !== 'KILL' || task.targetId !== def.id) continue;
    task.currentAmount++;
    if (task.currentAmount >= task.amount) {
      task.isCompleted = true;
      lines.push(`Task complete: ${task.description}. Return to the person who asked.`);
    } else {
      lines.push(`Task progress: ${task.description} (${task.currentAmount}/${task.amount}).`);
    }
  }

  gainXp(state, def.xp, lines);

  // Temple gauntlet: one guardian down.
  if (def.templeOnly && state.temple && state.temple.mode === 'gauntlet') {
    state.temple.remaining--;
    if (state.temple.remaining > 0) lines.push('Something else stirs deeper in the temple.');
    else {
      lines.push('Silence. Nothing else stirs. At the heart of the temple a chest stands open.');
      grantMagicItem(state, state.temple.temple, lines);
      state.temple = null;
    }
  }

  // World cleared: every overworld enemy dead, once.
  if (!def.templeOnly && !state.player.worldCleared && overworldEnemiesLeft(state) === 0) {
    state.player.worldCleared = true;
    lines.push('The land is quiet: every monster in the world is dead.');
    gainXp(state, WORLD_CLEARED_XP, lines);
  }
}

/** Death (the original's death screen): the game pauses until `continue`. */
export function die(state: DemonHunterState, killerName: string, lines: string[]): void {
  state.player.hp = 0;
  state.player.deaths++;
  state.phase = 'dead';
  state.combat = null;
  if (state.lair) {
    for (const e of Object.values(state.enemies)) if (e.at === LAIR_NODE_ID) delete state.enemies[e.id];
    state.lair = null;
    // Death in the lair: the knife turns time back. The stab, the lair and the
    // wound are undone; the demon keeps its face and its town, and the player
    // keeps the knowledge (ruling 2026-10-21: the demon does not re-hide).
    lines.push(`The ${killerName} hits you and the lair dissolves. The knife in your hand burns cold and time runs backwards: the stab, the lair, the wound, all undone.`);
    lines.push('Say "continue" to wake up in the last town you visited, before any of it happened. Your level and stats reset; everything you carry and know is kept, and you still know the demon\'s face.');
    return;
  }
  lines.push(`You were killed by ${withArticle(killerName)}.`);
  lines.push('Say "continue" to wake up in the last town you visited. Your level and stats reset; everything you carry and know is kept.');
}
