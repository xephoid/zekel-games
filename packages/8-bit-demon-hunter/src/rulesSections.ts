// The rules, one section per topic (rules-teaching: getRulesSections). The
// get_rules blob is DERIVED from these (renderRules here for tests,
// @zekel/game-kit's renderRulesText in index.ts) so the two cannot drift.
// Every move type is tagged to at least one section (rulesSections.test.ts).

import { OVERWORLD_ENEMIES } from './data/enemies.js';
import { MAGIC_ITEMS, TEMPLE_TYPES } from './data/magicItems.js';
import { INN_RIDE_COST, INN_SLEEP_COST, INN_TRAIN_COST, INN_TRAIN_XP, MAX_LEVEL, STAT_BASE, STAT_MAX, WORLD_CLEARED_XP, XP_CURVE } from './data/progression.js';

export interface RuleSectionShape {
  id: string;
  title: string;
  text: string;
  tags: { move_types?: string[]; phases?: string[] };
}

const behaviourWords: Record<string, string> = {
  passive: 'minds its own business; fights only if attacked',
  snake: 'wanders; when wounded, half the time it slithers off to a neighbouring place',
  wizard: 'does nothing until hit, then runs: half the time it teleports to another clearing',
  mushroom: 'follows you from place to place; five or more at a place block you from leaving',
  blocker: 'attacks when you try to leave its place',
  hunter: 'attacks when you try to leave its place, and gets one attack as you run from it',
};

const enemyRows = OVERWORLD_ENEMIES.map((e) => `${e.name}: ${behaviourWords[e.behaviour]}${e.clearingsOnly ? '; found only in the wild clearings' : ''}.`);

const itemRows = TEMPLE_TYPES.map((t) => `${MAGIC_ITEMS[t].name}: ${MAGIC_ITEMS[t].description}`);

export const DEMON_HUNTER_RULE_SECTIONS: RuleSectionShape[] = [
  {
    id: 'goal',
    title: 'The goal',
    text:
      'A demon hides as an ordinary person in one of five towns. Find out who it is and put the demon-killing knife in it. ' +
      'You carry the knife from the start. It works only face to face: you must be inside the town with the person. ' +
      'Stab the wrong person and you have killed an innocent in front of their town; the townspeople turn on you and the game is lost at once. ' +
      'Stab the right one and the disguise comes off: the demon drags you into its arena for the final fight.',
    tags: { move_types: ['stab'], phases: ['playing'] },
  },
  {
    id: 'people-and-clues',
    title: 'People, rumours and secrets',
    text:
      'Each of the five towns has ten people, one of each trade: Carpenter, Barber, Soldier, Musician, Farmer, Blacksmith, Merchant, Tailor, Locksmith, Mayor. ' +
      'Every person has a favourite colour (six exist), a pet (fifteen exist) and an item nobody else has. ' +
      'When you first talk to someone they tell you a rumour about the demon, which goes in your clue book. ' +
      'A person who says "I know the truth" holds a demon secret instead: a true fact about the demon\'s town, trade, colour, pet or item. Five such people exist, one per town, and they never lie. ' +
      'Everyone else\'s rumour is a true "the demon is not ..." except for the demon itself and its minions (two per town), who always lie: their rumour contradicts the truth. ' +
      'With the Eye of Truth you can tell who is lying. Your clue book lists every clue and everyone you have met, and lets you mark up to ten suspects. ' +
      'Townsfolk know each other: in any town you may ask around for whoever keeps a certain pet, likes a colour, follows a trade, owns an item, wants help with something, or claims to know the truth, and you may compare the rumours in your clue book against the secrets you hold to see which cannot be true. Whoever asking around turns up counts as met: you learn their card and their rumour as if you had talked to them.',
    tags: { move_types: ['talk', 'goodbye', 'mark_suspect', 'unmark_suspect', 'look', 'search_town'], phases: ['town'] },
  },
  {
    id: 'tasks-and-favours',
    title: 'Tasks and favours',
    text:
      'Everyone has a task for you: kill a number of one kind of monster, find someone by trade, pet or colour, escort them to another town, or find one of the five magic items. ' +
      'You may accept as many tasks as you like; all of them are active at once, and tasks that overlap progress and complete together (five slimes killed count for everyone who asked for slimes). An escorted person travels with you and the task completes when you enter the destination town by any means; they then live there. ' +
      'Finishing a task and returning to the giver earns a reward. A truth-knower lets you choose their demon secret or their favour; anyone else gives their favour. A minion whose task you finish confesses instead of paying. ' +
      'Favours by trade: Farmer, whether you have already met the demon; Musician, how many minions are in this town; Barber, introductions to one to five people and their rumours; Tailor, whether anyone in this town is lying; Mayor, a piece of gold; Merchant, 50 shuckles; Soldier, 20 XP; Blacksmith, one free stat improvement; Carpenter, a town the demon is not in; Locksmith, the favour of opening one house.',
    tags: { move_types: ['accept_task', 'decline', 'claim_reward', 'found_you'], phases: ['town'] },
  },
  {
    id: 'houses-and-bindings',
    title: 'Houses and demon bindings',
    text:
      "Every house is locked. A lockpick or a Locksmith's favour opens one house, once. " +
      'A minion\'s house holds a demon binding; anyone else\'s holds nothing. Each binding you hold takes 3 off the demon\'s base HP of 20 (never below 1); the result is multiplied by your strength.',
    tags: { move_types: ['search_house'], phases: ['town'] },
  },
  {
    id: 'the-inn',
    title: 'The inn',
    text:
      `Every town has an inn. It buys and sells plant fiber, wood, demon powder, demon ichor, iron ore and gold at its own prices (each town sets a multiplier of 1 to 6 per resource: sell for base × multiplier, buy for one and a half times that, rounded up) while its stock lasts. ` +
      `Sleep heals you to full for ${INN_SLEEP_COST} shuckles. Training costs ${INN_TRAIN_COST} and gives ${INN_TRAIN_XP} XP. A cart to any town costs ${INN_RIDE_COST}.`,
    tags: { move_types: ['inn', 'sleep', 'train', 'ride', 'buy', 'sell', 'leave_inn'], phases: ['town'] },
  },
  {
    id: 'the-world',
    title: 'The world',
    text:
      'The world is a map of named places joined by paths: five towns, five temples and a handful of clearings between them. "Look" always tells you where you are, which paths lead on, and which enemies and resources are here. ' +
      'Towns and temples are entered from their door; you must leave a town or temple before travelling on. ' +
      'You may also travel in one go: to a place by name, back to the town of someone whose task you are on, or to the nearest inn. The journey follows the same rules as walking, hop by hop, and stops at the edge of any place where something would attack you on the way out, so you can decide: go through, or go another way. ' +
      'When you try to leave a place: bandits, skeletons and undead knights attack you; mushrooms follow you, and five or more block your way; everything else lets you go. ' +
      'Whenever you step out of a town or a temple the wild has reset: every monster, plant and tree is back where it was when the world began (ore deposits you blew open stay open). ' +
      'The Sky Temple sits inside a ring of stone wall: bomb it from the next clearing before you can enter.',
    tags: { move_types: ['move', 'travel', 'enter', 'leave', 'look'], phases: ['outdoors'] },
  },
  {
    id: 'enemies',
    title: 'Enemies',
    text:
      'You learn an enemy by watching it. The game never tells you its numbers: how hurt it is comes as words (unhurt, barely scratched, hurt, badly wounded, barely able to stand), ' +
      'and whether it is faster than you or strikes from further away shows in how a fight opens. ' +
      enemyRows.join(' '),
    tags: { move_types: ['attack'], phases: ['outdoors'] },
  },
  {
    id: 'combat',
    title: 'Combat',
    text:
      'Fights are one on one and turn based. At the start, the side with the higher range gets one free attack. Then the faster side acts (your agility against the enemy\'s speed; ties go to you), then the other, and so on. ' +
      'An action is attack or run away. Attacks always hit. Each action is floor(your speed ÷ theirs) attacks, at least one; the enemy gets the same against you. Your hits do your strength in damage; theirs do their listed damage. ' +
      'Running away always works, but a skeleton or undead knight gets one attack as you go. There is no running from the demon\'s arena. ' +
      'Attacking an enemy opens the fight and is your first action. ' +
      `If you die, say "continue": you wake in the last town you visited with your level and stats back at the start (strength ${STAT_BASE.strength}, agility ${STAT_BASE.agility}, range ${STAT_BASE.range}, ${STAT_BASE.health} health) but you keep everything you carry and everything you know.`,
    tags: { move_types: ['attack', 'fight', 'flee', 'continue'], phases: ['combat', 'dead'] },
  },
  {
    id: 'stats-and-levels',
    title: 'Stats and levelling',
    text:
      `Strength is your damage per hit (starts ${STAT_BASE.strength}, max ${STAT_MAX.strength}). Agility is your speed: who acts first and how many attacks you get (starts ${STAT_BASE.agility}, rises by 4 per pick to ${STAT_MAX.agility}). ` +
      `Range gives you a free attack when it beats the enemy's and lets you fight from the air (starts ${STAT_BASE.range}, max ${STAT_MAX.range}). Health is how many hits you can take (starts ${STAT_BASE.health}, max ${STAT_MAX.health}); raising it heals you to full. ` +
      `You earn XP for kills and some favours; at ${XP_CURVE.join(', ')} XP you reach the next level (max level ${MAX_LEVEL}) and may raise one stat whenever you like. Killing every monster in the world pays ${WORLD_CLEARED_XP} XP once.`,
    tags: { move_types: ['level_up'], phases: ['playing'] },
  },
  {
    id: 'resources-and-bombs',
    title: 'Resources and bombs',
    text:
      'Plants (1 HP) and trees (4 HP) are harvested by attacking them: each swing does your strength, and each swing has a one in ten chance of drawing an aggressive enemy at the place into a fight. A plant gives plant fiber, a tree gives wood. ' +
      'Monsters drop demon powder (bandits drop nothing); temple guardians drop demon ichor. ' +
      `A bomb hits everything where you stand: every enemy is hurt by 5, every ore deposit shatters (each yields gold one time in ten, iron ore four times in ten, else nothing), every plant and tree burns to nothing, and the Sky Temple's stone ring opens if you are beside it. Where bombs and lockpicks come from is for you to find out; there are rumours. The Fire Bombs give you unlimited bombs.`,
    tags: { move_types: ['attack', 'bomb', 'talk_bandit', 'buy_from_bandit'], phases: ['outdoors'] },
  },
  {
    id: 'temples',
    title: 'Temples and magic items',
    text:
      'The five temples are ancient and deadly. Each holds a treasure at its heart behind two doors: a gauntlet, where whatever guards the place comes at you one at a time, or a riddle door that opens to the right answer. ' +
      'Nobody can tell you what guards a temple or what it holds; you find out by going in. A wrong answer costs nothing; you may try again or take the gauntlet. Leaving a temple mid-gauntlet resets it. ' +
      'The five treasures, once found, are the five artifacts of legend: ' + itemRows.join(' ') +
      ' (Flying: only enemies that can strike from afar reach you in the air; you can attack from the air only with range 3 or more.)',
    tags: { move_types: ['gauntlet', 'next_fight', 'riddle', 'answer_riddle', 'fly', 'land', 'aura', 'teleport'], phases: ['temple'] },
  },
  {
    id: 'the-finale',
    title: 'The finale',
    text:
      'Stab the demon and the town falls away: you stand in its arena. The demon has (20 − 3 per binding, at least 1) × your strength HP, speed 8, range 3 and damage 2. ' +
      'At two thirds of its HP it retreats and summons three monsters of 10 HP each, which you fight one at a time before it returns. At one third it attacks twice more per action. ' +
      'Kill it to win. Dying in the arena is a death like any other; you may stab it again.',
    tags: { move_types: ['stab', 'fight'], phases: ['arena'] },
  },
];

/** The same rendering @zekel/game-kit's renderRulesText produces: titled sections, blank-line separated. */
export function renderRules(sections: RuleSectionShape[]): string {
  return sections.map((s) => `## ${s.title}\n${s.text}`).join('\n\n');
}
