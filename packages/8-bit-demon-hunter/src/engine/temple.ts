// Temples (PORT-PLAN §7): the gauntlet or the riddle.

import { ENEMY_BY_ID } from '../data/enemies.js';
import { MAGIC_ITEMS, TEMPLE_GUARDIAN } from '../data/magicItems.js';
import { isRiddleAnswerCorrect, RIDDLES } from '../data/riddles.js';
import type { DemonHunterState } from '../types.js';
import { startCombat } from './combat.js';
import { refuse } from './errors.js';
import { clearTempleEnemiesAt, enemiesAt, hereNode } from './helpers.js';
import { makeEnemy } from '../world/populate.js';
import { requireNoCombat } from './movement.js';
import { grantMagicItem } from './rewards.js';

export function enterTemple(state: DemonHunterState, lines: string[]): void {
  const here = hereNode(state);
  if (here.kind !== 'temple' || !here.templeType) refuse('There is no temple here.');
  const temple = here.templeType;
  state.player.inside = 'temple';
  state.player.flying = false;
  state.player.auraUp = false;
  if (state.player.magicItems.includes(temple)) {
    state.temple = null;
    lines.push(`You enter the ${here.name}. Its chest stands open and empty: you already carry the ${MAGIC_ITEMS[temple].name}.`);
    return;
  }
  const guardian = ENEMY_BY_ID[TEMPLE_GUARDIAN[temple]];
  state.temple = { temple, mode: 'choice', remaining: guardian.max };
  lines.push(
    `You enter the ${here.name}. Two ways lead to its heart: a gauntlet of ${guardian.max} ${guardian.plural}, fought one at a time (gauntlet), ` +
      'or a sealed door that opens to the right answer (riddle).',
  );
}

function requireTemple(state: DemonHunterState): void {
  requireNoCombat(state);
  if (state.player.inside !== 'temple' || !state.temple) refuse('You are not inside a temple with a challenge open.');
}

export function startGauntlet(state: DemonHunterState, lines: string[]): void {
  requireTemple(state);
  if (state.temple!.mode === 'gauntlet') refuse('The gauntlet is already under way: say "next fight".');
  state.temple!.mode = 'gauntlet';
  lines.push(`You step into the gauntlet. ${state.temple!.remaining} guardians stand between you and the chest. Say "next fight" to face the first.`);
}

export function nextFight(state: DemonHunterState, lines: string[]): void {
  requireTemple(state);
  if (state.temple!.mode !== 'gauntlet') refuse('You have not started the gauntlet.');
  if (state.temple!.remaining <= 0) refuse('The gauntlet is done.');
  const here = hereNode(state);
  // A guardian the player fled from is still here; otherwise summon the next.
  let guardian = enemiesAt(state, here.id).find((e) => ENEMY_BY_ID[e.type].templeOnly);
  if (!guardian) {
    const def = ENEMY_BY_ID[TEMPLE_GUARDIAN[state.temple!.temple]];
    const n = Object.keys(state.enemies).filter((id) => id.startsWith(`${def.id}_`)).length + 1;
    guardian = makeEnemy(`${def.id}_${n}`, def, here.id);
    state.enemies[guardian.id] = guardian;
  }
  startCombat(state, guardian.id, 'gauntlet', lines);
}

export function startRiddle(state: DemonHunterState, lines: string[]): void {
  requireTemple(state);
  if (state.temple!.mode === 'gauntlet') {
    // Switching to the riddle abandons the gauntlet (it resets anyway on leaving).
    clearGuardians(state);
    state.temple!.remaining = ENEMY_BY_ID[TEMPLE_GUARDIAN[state.temple!.temple]].max;
  }
  state.temple!.mode = 'riddle';
  lines.push(`Words are carved over the sealed door: "${RIDDLES[state.temple!.temple].text}" Give your answer.`);
}

export function answerRiddle(state: DemonHunterState, text: string, lines: string[]): void {
  requireTemple(state);
  if (state.temple!.mode !== 'riddle') refuse('You are not standing at the riddle door. Say "riddle" first.');
  const temple = state.temple!.temple;
  if (!isRiddleAnswerCorrect(temple, text)) {
    lines.push(`"${text}" — the door does not move. You may try again, or take the gauntlet.`);
    return;
  }
  lines.push('The door grinds open. A chest waits inside.');
  grantMagicItem(state, temple, lines);
  state.temple = null;
}

/** Remove temple guardians at the player's node (leaving resets the gauntlet). */
export function clearGuardians(state: DemonHunterState): void {
  clearTempleEnemiesAt(state, state.player.at);
}
