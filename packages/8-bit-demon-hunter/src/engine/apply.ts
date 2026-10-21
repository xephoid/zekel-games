// The move dispatcher: deep-copy the state, apply one move, return the new
// state and a plain-words summary. Rule violations throw RuleError.

import type { DemonHunterState } from '../types.js';
import { arenaContinue, auraEscape, playerFight, playerFlee, startCombat } from './combat.js';
import { lookText } from './describe.js';
import { refuse, RuleError } from './errors.js';
import { clone, hasMagicItem, hereNode } from './helpers.js';
import { bomb, buyFromBandit, continueAfterDeath, harvest, levelUp, talkBandit } from './items.js';
import type { DemonHunterMove } from './moves.js';
import { auraOutdoors, enterTown, fly, land, leaveInterior, move, requireNoCombat, requireOutdoors, teleport } from './movement.js';
import { enterTemple, nextFight, startGauntlet, startRiddle, answerRiddle } from './temple.js';
import {
  acceptTask,
  claimReward,
  declineTask,
  foundYou,
  goodbye,
  innBuy,
  innLeave,
  innOpen,
  innRide,
  innSell,
  innSleep,
  innTrain,
  searchHouse,
  talk,
} from './town.js';
import { stab } from './finale.js';

export interface ApplyResult {
  newState: DemonHunterState;
  summary: string;
}

export function applyMove(prev: DemonHunterState, move_: DemonHunterMove): ApplyResult {
  const state = clone(prev);
  state.turn++;
  const lines: string[] = [];
  if (state.phase === 'won' || state.phase === 'lost') {
    throw new RuleError('GAME_OVER', 'The game is over.');
  }
  if (state.phase === 'dead' && move_.type !== 'look' && move_.type !== 'continue') {
    refuse('You are dead. Say "continue" to wake up in the last town you visited.');
  }

  switch (move_.type) {
    case 'look':
      lines.push(lookText(state));
      break;
    case 'move':
      move(state, move_.to, lines);
      break;
    case 'enter': {
      requireNoCombat(state);
      requireOutdoors(state);
      const here = hereNode(state);
      if (here.kind === 'town') enterTown(state, lines);
      else if (here.kind === 'temple') enterTemple(state, lines);
      else refuse('There is nothing here to enter.');
      break;
    }
    case 'leave':
      leaveInterior(state, lines);
      break;
    case 'attack': {
      requireNoCombat(state);
      if (state.resources[move_.target]) harvest(state, move_.target, lines);
      else {
        requireOutdoors(state);
        const e = state.enemies[move_.target];
        if (!e || e.at !== state.player.at) refuse(`There is no "${move_.target}" here. Look around first.`);
        if (state.player.auraUp) refuse('You cannot attack while the Aura of Protection is up.');
        if (state.player.flying && state.player.range < 3) refuse('You cannot attack from the air with range below 3. Land first.');
        startCombat(state, e.id, 'attack', lines);
        if (state.combat) playerFight(state, lines);
      }
      break;
    }
    case 'bomb':
      bomb(state, lines);
      break;
    case 'talk_bandit':
      talkBandit(state, lines);
      break;
    case 'buy_from_bandit':
      buyFromBandit(state, move_.item, lines);
      break;
    case 'fly':
      fly(state, lines);
      break;
    case 'land':
      land(state, lines);
      break;
    case 'aura':
      if (state.combat) {
        if (!hasMagicItem(state, 'earth')) refuse('You have no Aura of Protection.');
        auraEscape(state, lines);
      } else auraOutdoors(state, lines);
      break;
    case 'teleport':
      teleport(state, move_.town, lines);
      break;
    case 'fight':
      playerFight(state, lines);
      break;
    case 'flee':
      playerFlee(state, lines);
      break;
    case 'level_up':
      levelUp(state, move_.stat, lines);
      break;
    case 'continue':
      continueAfterDeath(state, lines);
      break;
    case 'mark_suspect': {
      const max = state.towns.length * 2;
      const people = state.towns.flatMap((t) => t.people);
      if (!people.some((p) => p.id === move_.person)) refuse(`There is no one called "${move_.person}".`);
      if (state.player.suspects.includes(move_.person)) refuse('Already marked.');
      if (state.player.suspects.length >= max) refuse(`You can mark at most ${max} suspects.`);
      state.player.suspects.push(move_.person);
      lines.push(`Marked as a suspect (${state.player.suspects.length}/${max}).`);
      break;
    }
    case 'unmark_suspect':
      if (!state.player.suspects.includes(move_.person)) refuse('That person is not marked.');
      state.player.suspects = state.player.suspects.filter((p) => p !== move_.person);
      lines.push('Suspect mark removed.');
      break;
    case 'stab':
      stab(state, move_.person, lines);
      break;
    case 'talk':
      talk(state, move_.person, lines);
      break;
    case 'found_you':
      foundYou(state, lines);
      break;
    case 'accept_task':
      acceptTask(state, lines);
      break;
    case 'decline':
      declineTask(state, lines);
      break;
    case 'claim_reward':
      claimReward(state, move_.reward, lines);
      break;
    case 'goodbye':
      goodbye(state, lines);
      break;
    case 'inn':
      innOpen(state, lines);
      break;
    case 'sleep':
      innSleep(state, lines);
      break;
    case 'train':
      innTrain(state, lines);
      break;
    case 'ride':
      innRide(state, move_.town, lines);
      break;
    case 'buy':
      innBuy(state, move_.resource, lines);
      break;
    case 'sell':
      innSell(state, move_.resource, lines);
      break;
    case 'leave_inn':
      innLeave(state, lines);
      break;
    case 'search_house':
      searchHouse(state, move_.person, move_.confirm === true, lines);
      break;
    case 'gauntlet':
      startGauntlet(state, lines);
      break;
    case 'next_fight':
      nextFight(state, lines);
      break;
    case 'riddle':
      startRiddle(state, lines);
      break;
    case 'answer_riddle':
      answerRiddle(state, move_.text, lines);
      break;
    default: {
      const never: never = move_;
      refuse(`Unknown move ${JSON.stringify(never)}.`);
    }
  }
  arenaContinue(state, lines);
  return { newState: state, summary: lines.join(' ') };
}
