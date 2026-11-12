import type { AbilityId } from '../types.js';
import type { HazardConsequence } from './abilities.js';

// What the sheet's words mean in play, in one short line each: the twelve
// abilities and their skills, the ship's numbers, the five endings and the
// ways to lose. A table shows these beside the thing they describe, so a
// player choosing a score or a level-up can read what it does without the
// rulebook open. Each line restates a rule the engine already enforces
// (engine.ts); nothing here is read by the engine, and a line that drifts
// from the rule is a bug in the line.

export interface AbilityText {
  /** What a score of 1 or more does (the basic skill). */
  basic: string;
  /** The advanced skill a natural 3 grants: its printed name and what it does. */
  advanced: { name: string; what: string };
}

export const ABILITY_TEXT: Record<AbilityId, AbilityText> = {
  SWA: {
    basic: 'Ground combat advantage: in a boarding or a ruin fight your side takes the higher pair. Added to your attack.',
    advanced: { name: 'Expert Combat Tactics', what: 'One extra die on this being\'s ruin attacks, added to the total.' },
  },
  ARM: {
    basic: 'Added to this being\'s defense when a ruin attacker strikes.',
    advanced: { name: 'Reinforced Armor', what: 'One extra die on this being\'s defense. Aboard: ship armor +1, and once per game a killing blow leaves the ship Hobbled instead of destroyed.' },
  },
  DEM: {
    basic: 'A ruin attack reaches as far as this score. Added to your attack. Lets you threaten pirates into breaking off: 3 dice + DEM against 10 + their space attack.',
    advanced: { name: 'Splash Damage', what: 'A ruin attack hits every attacker in range. Pirates you threaten off also pay 50 credits per point of their space attack.' },
  },
  HAK: {
    basic: 'Lets you hack a pirate ship: 3 dice + HAK against their hacking number. Success disables them without a fight.',
    advanced: { name: 'Hackers Delight', what: '+200 credits for every successful hack.' },
  },
  RES: {
    basic: 'At the start of a trip, look at as many cards off the top of the travel deck as this score and discard one. Only the captain\'s own score counts.',
    advanced: { name: 'Personal Teleporter', what: 'This being moves through walls, pits and others in a ruin; the distance still counts.' },
  },
  MEC: {
    basic: 'On arriving at a habitat, one repair roll: 3 dice + MEC, 12 or more raises the ship one damage level. In a pirate fight, Redline once: 3 dice + MEC against 12 for +2 to your exchanges.',
    advanced: { name: 'Ms/Mr Fix-it', what: 'The ship repairs to Pristine on every habitat arrival. Opens the workshop: pay to improve a weapon or armor, or to build a ship part.' },
  },
  PIL: {
    basic: 'Space combat advantage: in an exchange of fire your side takes the higher pair, and this score is added. Added to an escape roll.',
    advanced: { name: 'Flying Ace', what: 'Once per pirate fight, reroll an exchange you lost.' },
  },
  GUN: {
    basic: 'A ruin attack reaches 2 + this score. Added to your attack. In a pirate fight, an opening volley once: 3 dice + GUN against 12 for −2 to their exchanges.',
    advanced: { name: 'Sniper', what: 'Ground combat advantage: your side takes the higher pair.' },
  },
  SNE: {
    basic: 'Movement in a ruin is 3 + this score. Lets you try to slip past pirates before the fight: 3 dice + SNE against 10 + their speed.',
    advanced: { name: 'Personal Cloaking', what: 'Ruin attackers cannot target this being until it attacks.' },
  },
  LEA: {
    basic: 'On arriving at a habitat, one roll to ease unrest: 3 dice + LEA, 12 or more takes one anger token off each crew member. +1 XP for every recruit who joins.',
    advanced: { name: 'Inspirational', what: '+3 to any roll that adds a crew member\'s score.' },
  },
  DIP: {
    basic: 'Lets you sign red shirts at the docks and from beaten pirates (3 dice + DIP against 12), and call on a ruin attacker to surrender. The most red shirts you can hold is your best natural DIP. The captain\'s own DIP also gives the look at the travel deck that Research gives.',
    advanced: { name: 'Silver Tongue', what: 'Mission credits are doubled.' },
  },
  ACT: {
    basic: 'One extra die on any Moxie or Smarts roll except ship repair, and when recruiting a Hexapod or a Kralkin.',
    advanced: { name: 'Je ne sais quoi', what: '+100 credits per point of this score on every mission paid.' },
  },
};

export const SHIP_TEXT = {
  capacity: 'How many can be aboard, the captain included. Red shirts do not take a berth.',
  speed: 'Each point takes one card off every leg of a trip.',
  handling: 'Added to an escape roll.',
  armor: 'Taken off the pirates\' total in every exchange of fire.',
  damage: 'Pristine, Used, Damaged, Hobbled. A hit moves it one step; a hit at Hobbled destroys the ship and ends the game.',
} as const;

/** Character creation, for a table that asks these before the season starts. */
export const CREATION_TEXT = {
  race: "Your own race changes no rule. A recruit's race does matter: each race idealizes one stat, and your best score under that stat is added when you try to recruit them.",
  scores: "Put 3 in one ability, 2 in another and 1 in a third; or spread 6 points with no ability above 3. A score of 1 or more gives the ability's basic skill, and a natural 3 gives its advanced skill.",
  archetype: 'A card with the scores already chosen and a printed difficulty.',
  disposition: 'A roleplay hint only. It changes no rule.',
} as const;

export const COUNTER_TEXT = {
  red_shirts: 'Unnamed crew: bodies with no scores, no gear and no berth. One can take a failed hazard roll for you and is lost; in a ruin each fights at Swashbuckling 1 and falls to one hit. You can hold as many as your best natural Diplomacy.',
  dread: 'Your name among pirates, up to 3. Each point adds 1 when you threaten pirates off. It grows with every boarding won and every crew threatened off.',
  anger: 'A crew member who reaches three anger tokens leaves with the gear they wear. A failed Moxie hazard adds one to everyone.',
} as const;

export const ENDING_TEXT: Record<'conquest' | 'fortune' | 'legend' | 'plunder' | 'bounty', { name: string; how: string }> = {
  conquest: { name: 'Conquest', how: 'Past the third habitat, clear the depth 3 ruin.' },
  fortune: { name: 'Fortune', how: 'Hold 6,000 credits while docked at a habitat.' },
  legend: { name: 'Legend', how: 'Reach level 5.' },
  plunder: { name: 'Plunder', how: 'Open 6 ruin caches, full or empty.' },
  bounty: { name: 'Bounty', how: 'Beat 8 foes face to face: ships captured by boarding and ruin attackers felled. Disabling, threatening off and talking round do not count.' },
};

export const LOSS_TEXT: string[] = [
  'The captain dies: a failed death check while already wounded.',
  'The ship is destroyed: a hit while Hobbled.',
  'Debt passes 300 credits.',
  'You are stranded with nothing left you can do.',
];

/** A failed hazard's price, by the stat of the ability rolled. */
export const HAZARD_TEXT: Record<HazardConsequence, string> = {
  death: 'Whoever carried the roll faces death: a crew member dies outright; the captain rolls a death check.',
  lose_credits: 'Lose 100 credits.',
  ship_damage: 'The ship takes one damage.',
  crew_unrest: 'Every crew member gains an anger token; at three they leave with their gear.',
};

export const DEATH_CHECK_TEXT =
  'A death check is 3 dice with nothing added: 9 or more and you live. The first failure leaves you wounded, −1 to every score until you next reach a habitat. A failure while wounded kills you and ends the game.';

/** How a ruin visit runs, for the map's margin. */
export const RUIN_TEXT = {
  goal: 'The level ends the moment anyone steps on the goal. At your target depth that ends the whole visit: caches not yet opened and beings not yet met are left behind.',
  start: 'Everyone enters on the start square. A being standing on it may step out; when no one is left inside, the visit ends.',
  round: 'Each round your beings act first, in any order: each may move and take one action. Then every attacker moves toward the nearest being and strikes if it can reach.',
  movement: 'A being moves up to 3 squares plus its Sneaking, no diagonals. Walls, pits and other pieces block.',
  attack: 'An attack needs a straight clear line: 1 square, or 2 + Gunslinging, or Demolitions if higher. Walls block; pits do not.',
  cache: 'Standing next to a cache, a being may open it: one die on the map\'s item list. Every cache opened counts toward Plunder.',
  being: 'Standing next to a figure, a being may approach: one die on the map\'s list of beings, then a recruit roll at once if someone is there.',
  struck: 'When an attacker strikes, the defender rolls. A crew member who loses dies, a red shirt falls, and the captain rolls a death check.',
  threat: 'The threat level picks which three attackers stand guard. Each is worth XP equal to its attack bonus when felled.',
} as const;
