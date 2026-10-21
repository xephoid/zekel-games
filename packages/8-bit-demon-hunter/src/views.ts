// What the player (and so the narrating LLM) may see. HIDDEN and never
// present here: demonId, Person.isDemon / isMinion, a person's good clue
// until it has been earned, the riddle answers. viewLeak.test.ts locks this.

import { ENEMY_BY_ID } from './data/enemies.js';
import { MAGIC_ITEMS } from './data/magicItems.js';
import { MAX_LEVEL, STAT_MAX } from './data/progression.js';
import { buyPrice, RESOURCE_DISPLAY_NAME, RESOURCE_TYPES, sellPrice } from './data/resources.js';
import { RIDDLES } from './data/riddles.js';
import { describeNode, type NodeView } from './engine/describe.js';
import { activeTasks, attacksPerAction, canLevelUp, condition, hasMagicItem, hereNode, townAtNode, xpToNextLevel } from './engine/helpers.js';
import type { DemonHunterState, Person } from './types.js';

export interface PersonView {
  id: string;
  name: string;
  occupation: string;
  town: string;
  met: boolean;
  /** Attributes are known only once met. */
  pet?: string;
  color?: string;
  item?: string;
  rumour?: string;
  knows_the_truth?: boolean;
  /** They confessed to serving the demon when their task was finished. */
  confessed_minion?: boolean;
  /** Eye of Truth only. */
  lying?: boolean;
  task?: { description: string; progress: string; completed: boolean; reward_claimed: boolean; why?: string };
  /** How the GM voices them (met people only). */
  persona?: { temperament: string; manner: string; quirk: string; worry: string; lore_topics: string[] };
  /** Their story: the tip or lore line they tell. */
  story?: string;
  suspect: boolean;
  house_searched: boolean;
  travelling_with_you: boolean;
}

export function personView(state: DemonHunterState, p: Person): PersonView {
  const town = state.towns.find((t) => t.id === p.attributes.townId)?.name ?? '?';
  const base: PersonView = {
    id: p.id,
    name: p.name,
    occupation: p.attributes.occupation,
    town,
    met: p.hasMet,
    suspect: state.player.suspects.includes(p.id),
    house_searched: state.player.searchedHouses.includes(p.id),
    travelling_with_you: state.player.followers.includes(p.id),
    ...(p.confessed ? { confessed_minion: true } : {}),
  };
  if (!p.hasMet) return base;
  const itemName = p.attributes.item === 'None' ? 'nothing' : (state.items.find((i) => i.id === p.attributes.item)?.name ?? p.attributes.item);
  const v: PersonView = {
    ...base,
    pet: p.attributes.pet,
    color: p.attributes.color,
    item: itemName,
    rumour: p.clues.bad?.text ?? 'I know the truth!',
    knows_the_truth: !!p.clues.good,
    task: {
      description: p.task.description,
      progress: `${p.task.currentAmount}/${p.task.amount}`,
      completed: p.task.isCompleted,
      reward_claimed: p.taskCompleted,
      why: p.persona.taskReason,
    },
    persona: { temperament: p.persona.temperament, manner: p.persona.manner, quirk: p.persona.quirk, worry: p.persona.worry, lore_topics: p.persona.loreHooks },
    story: p.tip,
  };
  if (hasMagicItem(state, 'light')) v.lying = p.isDemon || p.isMinion;
  return v;
}

export function getView(state: DemonHunterState): Record<string, unknown> {
  const p = state.player;
  const here = hereNode(state);
  const people = state.towns.flatMap((t) => t.people);
  const tasks = activeTasks(state).map((task) => {
    const giver = people.find((x) => x.id === task.giverId);
    return {
      giver: giver?.name,
      giver_id: task.giverId,
      town: state.towns.find((t) => t.id === giver?.attributes.townId)?.name,
      description: task.description,
      progress: `${task.currentAmount}/${task.amount}`,
      completed: task.isCompleted,
    };
  });
  const followers = p.followers.map((id) => people.find((x) => x.id === id)?.name ?? id);

  const you = {
    location: { node: here.id, name: here.name, kind: here.kind, inside: p.inside, flying: p.flying, aura_up: p.auraUp },
    hp: p.hp,
    max_hp: p.maxHp,
    level: p.level,
    max_level: MAX_LEVEL,
    xp: p.xp,
    xp_for_next_level: xpToNextLevel(state),
    can_level_up: canLevelUp(state),
    free_stat_picks: p.freeStatPicks,
    strength: p.strength,
    agility: p.agility,
    range: p.range,
    stat_caps: STAT_MAX,
    shuckles: p.shuckles,
    resources: Object.fromEntries(RESOURCE_TYPES.map((r) => [RESOURCE_DISPLAY_NAME[r], p.resources[r]])),
    bombs: hasMagicItem(state, 'fire') ? 'unlimited (Fire Bombs)' : p.bombs,
    lockpicks: p.lockpicks,
    locksmith_favours: p.locksmithCharges,
    knife: 'the demon-killing knife (stab someone face to face in their town; the wrong person dies and the town turns on you)',
    magic_items: p.magicItems.map((t) => MAGIC_ITEMS[t].name),
    bindings: [...p.bindings],
    active_tasks: tasks,
    travelling_with: followers,
    deaths: p.deaths,
    world_cleared: p.worldCleared,
  };

  let hereView: NodeView | Record<string, unknown>;
  if (p.inside === 'town') {
    const town = townAtNode(state, here.id)!;
    hereView = {
      town: town.name,
      town_id: town.id,
      people: town.people.map((x) => personView(state, x)),
      inn: innView(state, town.id),
    };
  } else if (p.inside === 'temple') {
    const t = state.temple;
    hereView = {
      temple: here.name,
      already_taken: here.templeType ? p.magicItems.includes(here.templeType) : false,
      treasure: here.templeType && p.magicItems.includes(here.templeType) ? MAGIC_ITEMS[here.templeType].name : 'unknown: a treasure awaits at the heart',
      challenge: t
        ? {
            mode: t.mode,
            riddle: t.mode === 'riddle' && here.templeType ? RIDDLES[here.templeType].text : undefined,
          }
        : null,
    };
  } else {
    hereView = describeNode(state);
  }

  const combat = state.combat
    ? (() => {
        const e = state.enemies[state.combat!.enemyId]!;
        const d = ENEMY_BY_ID[e.type];
        return {
          enemy: { id: e.id, name: d.name, condition: condition(e) },
          round: state.combat!.round,
          your_attacks_per_action: attacksPerAction(p.agility, d.speed),
          it_is_faster_than_you: d.speed > p.agility,
          it_strikes_from_further_than_you: d.range > p.range,
          it_can_reach_you: !(p.flying && d.range < 3),
          you_can_attack: !(p.flying && p.range < 3) && !p.auraUp,
          can_flee: !state.lair,
        };
      })()
    : null;

  const lair = state.lair
    ? {
        demon_condition: state.enemies[state.lair.demonEnemyId] ? condition(state.enemies[state.lair.demonEnemyId]!) : 'dead',
        minions_summoned: state.lair.phase2Done,
        minions_left: state.lair.minionQueue.length + (state.combat && state.combat.enemyId !== state.lair.demonEnemyId ? 1 : 0),
      }
    : null;

  const dialogue = state.dialogue
    ? { with: people.find((x) => x.id === state.dialogue!.personId)?.name, person_id: state.dialogue.personId, stage: state.dialogue.stage }
    : null;

  return {
    phase: state.phase,
    you,
    here: hereView,
    combat,
    lair,
    dialogue,
    inn_open: state.innOpen,
    clue_book: {
      clues: p.knownClues.map((c) => ({ text: c.text, kind: c.isSpecial ? 'special' : c.isGood ? 'secret' : 'rumour' })),
      people_met: people.filter((x) => x.hasMet).map((x) => personView(state, x)),
      suspects: p.suspects.map((id) => people.find((x) => x.id === id)?.name ?? id),
      max_suspects: state.towns.length * 2,
      bindings: [...p.bindings],
    },
    towns: state.towns.map((t) => ({ id: t.id, name: t.name, node: t.nodeId, visited: p.visitedTowns.includes(t.id) })),
    // Only temples the player has found: the GM must not name the rest.
    temples: Object.values(state.graph.nodes)
      .filter((n) => n.kind === 'temple' && p.knownPlaces.includes(n.id))
      .map((n) => ({ id: n.id, name: n.name, completed: n.templeType ? p.magicItems.includes(n.templeType) : false, treasure: n.templeType && p.magicItems.includes(n.templeType) ? MAGIC_ITEMS[n.templeType].name : 'unknown' })),
    known_places: p.knownPlaces
      .map((id) => state.graph.nodes[id]!)
      .map((n) => ({ id: n.id, name: n.name, kind: n.kind, been_there: n.kind === 'town' ? p.visitedTowns.includes(n.townId!) : undefined })),
    result: state.result,
  };
}

export function innView(state: DemonHunterState, townId: string): Record<string, unknown> {
  const town = state.towns.find((t) => t.id === townId)!;
  return {
    trade: RESOURCE_TYPES.map((r) => ({
      resource: r,
      name: RESOURCE_DISPLAY_NAME[r],
      sell_price: sellPrice(r, town.prices[r]),
      buy_price: buyPrice(r, town.prices[r]),
      inn_stock: town.stock[r],
      you_have: state.player.resources[r],
    })),
    services: { sleep: 5, train: 50, ride: 50 },
  };
}
