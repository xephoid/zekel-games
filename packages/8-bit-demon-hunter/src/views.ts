// What the player (and so the narrating LLM) may see. HIDDEN and never
// present here: demonId, Person.isDemon / isMinion, a person's good clue
// until it has been earned, the riddle answers. viewLeak.test.ts locks this.

import { ENEMY_BY_ID } from './data/enemies.js';
import { MAGIC_ITEMS, TEMPLE_GUARDIAN } from './data/magicItems.js';
import { MAX_LEVEL, STAT_MAX } from './data/progression.js';
import { buyPrice, RESOURCE_DISPLAY_NAME, RESOURCE_TYPES, sellPrice } from './data/resources.js';
import { RIDDLES } from './data/riddles.js';
import { describeNode, type NodeView } from './engine/describe.js';
import { activeTask, attacksPerAction, canLevelUp, hasMagicItem, hereNode, townAtNode, xpToNextLevel } from './engine/helpers.js';
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
    travelling_with_you: state.player.follower === p.id,
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
  const task = activeTask(state);
  const giver = p.activeTaskGiver ? state.towns.flatMap((t) => t.people).find((x) => x.id === p.activeTaskGiver) : null;
  const follower = p.follower ? state.towns.flatMap((t) => t.people).find((x) => x.id === p.follower) : null;
  const people = state.towns.flatMap((t) => t.people);

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
    active_task: task && giver ? { giver: giver.name, giver_id: giver.id, town: state.towns.find((t) => t.id === giver.attributes.townId)?.name, description: task.description, progress: `${task.currentAmount}/${task.amount}`, completed: task.isCompleted } : null,
    travelling_with: follower ? follower.name : null,
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
    const guardian = here.templeType ? ENEMY_BY_ID[TEMPLE_GUARDIAN[here.templeType]] : null;
    hereView = {
      temple: here.name,
      item: here.templeType ? MAGIC_ITEMS[here.templeType].name : null,
      already_taken: here.templeType ? p.magicItems.includes(here.templeType) : false,
      challenge: t
        ? {
            mode: t.mode,
            guardian: guardian?.name,
            guardians_total: guardian?.max,
            guardians_remaining: t.remaining,
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
          enemy: { id: e.id, name: d.name, hp: e.hp, max_hp: e.maxHp, speed: d.speed, range: d.range, damage: d.damage },
          round: state.combat!.round,
          your_attacks_per_action: attacksPerAction(p.agility, d.speed),
          its_attacks_per_action: attacksPerAction(d.speed, p.agility),
          it_can_reach_you: !(p.flying && d.range < 3),
          you_can_attack: !(p.flying && p.range < 3) && !p.auraUp,
          can_flee: !state.arena,
        };
      })()
    : null;

  const arena = state.arena
    ? {
        demon_hp: state.enemies[state.arena.demonEnemyId]?.hp ?? 0,
        demon_max_hp: state.enemies[state.arena.demonEnemyId]?.maxHp ?? 0,
        minions_summoned: state.arena.phase2Done,
        minions_left: state.arena.minionQueue.length + (state.combat && state.combat.enemyId !== state.arena.demonEnemyId ? 1 : 0),
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
    arena,
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
    temples: Object.values(state.graph.nodes)
      .filter((n) => n.kind === 'temple')
      .map((n) => ({ id: n.id, name: n.name, item: n.templeType ? MAGIC_ITEMS[n.templeType].name : null, completed: n.templeType ? p.magicItems.includes(n.templeType) : false })),
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
