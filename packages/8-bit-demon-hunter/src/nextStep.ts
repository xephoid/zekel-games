// What the client should do next, per situation (PORT-PLAN §10). The shape
// mirrors @zekel/game-kit's NextStep; index.ts hands it through. Rules for
// `facts`: plain game facts in speakable words, no tool or move names.

import { ENEMY_BY_ID } from './data/enemies.js';
import { RIDDLES } from './data/riddles.js';
import { activeTasks, attacksPerAction, canLevelUp, condition, hereNode, townAtNode } from './engine/helpers.js';
import { describeNode } from './engine/describe.js';
import type { DemonHunterState } from './types.js';

export interface HumanResponseShape {
  ask: string;
  example: string;
  records_as: string;
  spoken_ask?: string;
}

export interface NextStepShape {
  status: 'game_over' | 'ai_to_move' | 'human_to_move';
  active_player_id: string | null;
  instruction: string;
  human_response?: HumanResponseShape;
  facts?: {
    phase?: string;
    reason?: string;
    progress?: { current: number; total: number; of?: string };
    options?: string[];
    notes?: string[];
  };
}

const NEVER_HINT = 'Do not suggest what to do, who to suspect, or where to go unless the player explicitly asks.';

export function describeNextStep(state: DemonHunterState, playerId: string): NextStepShape {
  const p = state.player;
  if (state.phase === 'won' || state.phase === 'lost') {
    return { status: 'game_over', active_player_id: null, instruction: `The game is over: ${state.result?.summary ?? ''}` };
  }
  if (state.phase === 'dead') {
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction: 'The player is DEAD. Tell them plainly, then ask whether they continue. Continuing wakes them in the last town they visited with level and stats reset; clues, items, money, bindings and magic items are kept. Submit continue when they say so.',
      human_response: { ask: 'whether they want to continue', example: 'Yes, continue', records_as: 'continue' },
      facts: { phase: 'Dead', notes: ['Continuing resets level and stats to the start.', 'Everything carried and learned is kept.', `Deaths so far: ${p.deaths}.`] },
    };
  }

  const levelNote = canLevelUp(state) ? ['A level-up is ready: the player may raise a stat at any time.'] : p.freeStatPicks > 0 ? ["A Blacksmith's free stat improvement is owed."] : [];
  // Why a move the player might expect is not on offer (withheld-move legibility).
  const gateNotes: string[] = [];
  if (p.flying && p.range < 3) gateNotes.push('You cannot attack from the air with range below 3; land first.');
  if (p.auraUp) gateNotes.push('You cannot attack while the Aura of Protection is up.');
  if (!p.magicItems.includes('sky')) gateNotes.push('Flying needs the Winged Boots (Sky Temple).');
  if (!p.magicItems.includes('space')) gateNotes.push('Teleporting needs the Cape of Teleportation (Space Temple).');

  if (state.combat) {
    const e = state.enemies[state.combat.enemyId]!;
    const d = ENEMY_BY_ID[e.type];
    const yours = attacksPerAction(p.agility, d.speed);
    const arena = !!state.arena;
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction:
        `COMBAT: the player's action is owed against ${d.name}. Relay the player's HP exactly and describe the enemy by how it looks and acts (never its numbers), then ask: fight or ${arena ? 'nothing else (there is no fleeing the arena)' : 'flee'}` +
        (p.magicItems.includes('earth') && !arena ? ', or the Aura of Protection to walk away untouched' : '') +
        '. Submit fight or flee. Never resolve attacks yourself; the server does. ' + NEVER_HINT,
      human_response: { ask: 'fight or run away', example: 'I fight', records_as: 'fight (attack) or flee (run away)' },
      facts: {
        phase: arena ? 'The arena' : 'Combat',
        reason: `fighting a ${d.name}`,
        notes: [
          `You: ${p.hp}/${p.maxHp} HP, strength ${p.strength}, speed ${p.agility}, range ${p.range}.`,
          `The ${d.name} is ${condition(e)}; it is ${d.speed > p.agility ? 'faster than you' : d.speed === p.agility ? 'as fast as you' : 'slower than you'}${d.range > p.range ? ' and strikes from further away than you can' : ''}.`,
          `You get ${yours} attack${yours === 1 ? '' : 's'} per action.`,
          ...(arena ? ['There is no way out of the arena.'] : ['Running away always works.', ...(d.behaviour === 'hunter' ? [`The ${d.name} gets one attack as you run.`] : [])]),
          ...(p.flying ? [d.range >= 3 ? 'It can reach you in the air.' : 'It cannot reach you while you fly.'] : []),
          ...levelNote,
        ],
      },
    };
  }

  if (state.dialogue) {
    const person = state.towns.flatMap((t) => t.people).find((x) => x.id === state.dialogue!.personId)!;
    const stage = state.dialogue.stage;
    const options =
      stage === 'found' ? ['I found you', 'goodbye'] : stage === 'reward' ? [...(person.clues.good ? ['clue'] : []), 'power', 'goodbye'] : stage === 'offer' ? ['accept', 'decline', 'goodbye'] : ['goodbye'];
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction:
        `IN CONVERSATION with ${person.name}. Play them from the GM BRIEF in the last response: their temperament, manner and quirk, their story, what they need and why. ` +
        'Do not read the brief or the gist lines out; improvise. The player may ask them anything; answer in character from the brief and the lore (get_demon_hunter_lore), and ' +
        'let them not know what the brief does not cover. The facts stay exact: their rumour\'s meaning, their task and its reward, their pet, colour, item and town. ' +
        `Only when the player decides something, submit it: ${options.join(' / ')}. ${NEVER_HINT}`,
      human_response: { ask: `what they say or ask ${person.name}, or what they decide`, example: options[0] === 'accept' ? "What happened to your husband? ... All right, I'll do it" : (options[0] ?? 'goodbye'), records_as: `talk freely records nothing; a decision records as ${options.join(', ')}; goodbye ends the conversation` },
      facts: { phase: 'Conversation', reason: `${person.name} the ${person.attributes.occupation} is speaking`, options, notes: levelNote },
    };
  }

  if (state.innOpen) {
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction: 'AT THE INN. Relay the prices and services exactly as given, then ask what the player does: sleep, train, ride to a town, buy or sell a resource, or leave. ' + NEVER_HINT,
      human_response: { ask: 'what they do at the inn', example: 'Sleep', records_as: 'sleep / train / ride {town} / buy {resource} / sell {resource} / leave_inn' },
      facts: { phase: 'The inn', notes: [`${p.shuckles} shuckles.`, `HP ${p.hp}/${p.maxHp}.`, ...levelNote] },
    };
  }

  if (p.inside === 'town') {
    const town = townAtNode(state, p.at)!;
    const tasks = activeTasks(state);
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction:
        `INSIDE ${town.name}. The player may talk to anyone here, visit the inn, search a house (needs a lockpick or a Locksmith's favour), stab someone with the demon-killing knife, or leave. ` +
        `Describe only what the last response showed. ${NEVER_HINT}`,
      human_response: { ask: 'what they do in town', example: 'Talk to the Baker', records_as: 'talk {person} / inn / search_house {person} / stab {person} / leave' },
      facts: {
        phase: `In ${town.name}`,
        notes: [
          `${town.people.filter((x) => x.hasMet).length} of ${town.people.length} people here met.`,
          ...(tasks.length > 0 ? tasks.map((task) => `Task: ${task.description} (${task.currentAmount}/${task.amount})${task.isCompleted ? ', complete' : ''}.`) : ['No tasks accepted.']),
          ...(p.lockpicks === 0 && p.locksmithCharges === 0 ? ["Houses are locked: searching one needs a lockpick or a Locksmith's favour."] : []),
          'The demon-killing knife works only face to face, here in town: the wrong person dies and the town turns on you.',
          ...levelNote,
        ],
      },
    };
  }

  if (p.inside === 'temple') {
    const here = hereNode(state);
    const t = state.temple;
    if (!t) {
      return {
        status: 'human_to_move',
        active_player_id: playerId,
        instruction: `INSIDE the ${here.name}; nothing is left to do here but leave. ${NEVER_HINT}`,
        human_response: { ask: 'what they do', example: 'Leave', records_as: 'leave' },
        facts: { phase: here.name, notes: ['The chest here is empty.', ...levelNote] },
      };
    }
    if (t.mode === 'riddle') {
      return {
        status: 'human_to_move',
        active_player_id: playerId,
        instruction:
          `THE RIDDLE DOOR of the ${here.name}. Read the riddle exactly: "${RIDDLES[t.temple].text}" Ask for the player's answer and submit it verbatim; the server judges it. ` +
          'Never hint at or guess the answer. They may instead take the gauntlet or leave.',
        human_response: { ask: 'their answer to the riddle', example: 'The answer is a lantern', records_as: 'answer_riddle with their words as text' },
        facts: { phase: `${here.name} riddle`, notes: ['A wrong answer costs nothing; they may try again.', 'The other way is the gauntlet: whatever guards this place, one at a time.'] },
      };
    }
    if (t.mode === 'gauntlet') {
      return {
        status: 'human_to_move',
        active_player_id: playerId,
        instruction: `THE GAUNTLET of the ${here.name}: something still stirs ahead. Never say how many guardians remain. Ask whether they face the next one, or leave (leaving resets the gauntlet). ${NEVER_HINT}`,
        human_response: { ask: 'whether they face the next guardian', example: 'Next fight', records_as: 'next_fight, or leave' },
        facts: { phase: `${here.name} gauntlet`, notes: ['Leaving the temple resets the gauntlet.', ...levelNote] },
      };
    }
    return {
      status: 'human_to_move',
      active_player_id: playerId,
      instruction: `INSIDE the ${here.name}: the player chooses the gauntlet (whatever guards this place, one at a time) or the riddle door, or leaves. Say only that a treasure awaits at the heart; never what it is or what guards it. ${NEVER_HINT}`,
      human_response: { ask: 'gauntlet or riddle', example: 'The riddle', records_as: 'gauntlet / riddle / leave' },
      facts: { phase: here.name, options: ['gauntlet', 'riddle', 'leave'], notes: ['A treasure awaits at the heart of the temple.', ...levelNote] },
    };
  }

  // Outdoors.
  const v = describeNode(state);
  return {
    status: 'human_to_move',
    active_player_id: playerId,
    instruction:
      `OUTDOORS at ${v.name}. Relay what is here exactly (paths, enemies with counts, resources, a trader) from the last look or move, then ask what the player does: ` +
      'move somewhere, enter, attack something, harvest, bomb, talk to someone here, use a magic item. ' + NEVER_HINT,
    human_response: { ask: 'what they do', example: 'Go to the Old Crossroads', records_as: 'move {to} / enter / attack {target} / bomb / talk_bandit / fly / land / aura / teleport {town}' },
    facts: {
      phase: `${v.name} (${v.kind})`,
      notes: [
        `Paths: ${v.paths.map((x) => `${x.name}${x.walled ? ' (walled: needs a bomb)' : ''}`).join(', ')}.`,
        v.enemies.length === 0 ? 'No enemies here.' : `Enemies: ${v.enemies.map((g) => `${g.count} ${g.count === 1 ? g.name : ENEMY_BY_ID[g.type as keyof typeof ENEMY_BY_ID].plural}`).join(', ')}.`,
        ...(v.resources.length > 0 ? [`Resources: ${v.resources.map((g) => `${g.count} ${g.name}`).join(', ')}.`] : []),
        ...(p.flying ? ['You are flying.'] : []),
        ...(v.resources.some((g) => g.kind === 'ore') && !p.magicItems.includes('fire') && p.bombs === 0 ? ['Ore deposits need a bomb; you have none.'] : []),
        ...((p.bombs > 0 || p.magicItems.includes('fire')) && v.resources.length > 0 ? ['A bomb here would also burn the plants and trees.'] : []),
        ...(v.paths.some((x) => x.walled) && !p.magicItems.includes('fire') && p.bombs === 0 ? ['The stone ring needs a bomb; you have none.'] : []),
        ...levelNote,
        ...gateNotes,
      ],
    },
  };
}
