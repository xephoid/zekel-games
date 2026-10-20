// Enemy table. Numbers are the original game's server/src/config/gameConfig.ts
// (hp, xp, speed, max, toKill, damage). New for the text port (PORT-PLAN §3):
// `range`, `minHops` (replaces the tile-distance spawn rule), `clearingsOnly`
// (the notes: wizard, skeleton, undead knight spawn only in clearings) and the
// `behaviour` tag the engine switches on.

export type EnemyType =
  | 'slime'
  | 'mushroom'
  | 'snake'
  | 'wizard'
  | 'skeleton'
  | 'dude_bandit'
  | 'lady_bandit'
  | 'undead_knight'
  | 'bee'
  | 'man_eater_flower'
  | 'arachne'
  | 'evil_eye'
  | 'fire_skull'
  | 'demon';

export type EnemyBehaviour =
  | 'passive' // fights only if attacked
  | 'snake' // passive; 50% flee when damaged and alive
  | 'wizard' // passive; flees when attacked, 50% teleport to another clearing
  | 'mushroom' // aggressive; follows the player; 5+ attack when the player leaves
  | 'blocker' // aggressive; attacks when the player leaves the node (bandits)
  | 'hunter' // blocker that also attacks when the player runs away (skeleton, knight)
  | 'temple' // temple gauntlet enemy
  | 'boss';

export interface EnemyDef {
  id: EnemyType;
  name: string;
  plural: string;
  hp: number;
  xp: number;
  speed: number;
  damage: number;
  range: number;
  /** How many spawn in the world (or in the temple gauntlet). */
  max: number;
  /** Kill-task count ("Kill 5 Slimes"). Overworld enemies only. */
  toKill?: number;
  templeOnly?: boolean;
  clearingsOnly?: boolean;
  /** Minimum graph distance from the starting town (its node is 0, its clearing 1).
   *  Replaces the original's tile distance from the spawn: slime 10, mushroom 15,
   *  snake 20, bandits 30, wizard 35, skeleton 40, knight 45 on a 200-tile map,
   *  with a town about 10 tiles across. */
  minHops: number;
  behaviour: EnemyBehaviour;
}

export const ENEMIES: readonly EnemyDef[] = [
  { id: 'slime', name: 'Slime', plural: 'Slimes', hp: 2, xp: 1, speed: 1.0, damage: 1, range: 1, max: 15, toKill: 5, minHops: 0, behaviour: 'passive' },
  { id: 'mushroom', name: 'Mushroom', plural: 'Mushrooms', hp: 3, xp: 1, speed: 3.0, damage: 1, range: 1, max: 20, toKill: 4, minHops: 0, behaviour: 'mushroom' },
  { id: 'snake', name: 'Snake', plural: 'Snakes', hp: 4, xp: 2, speed: 3.5, damage: 1, range: 1, max: 20, toKill: 3, minHops: 1, behaviour: 'snake' },
  { id: 'wizard', name: 'Wizard', plural: 'Wizards', hp: 5, xp: 3, speed: 1.5, damage: 1, range: 3, max: 10, toKill: 2, clearingsOnly: true, minHops: 2, behaviour: 'wizard' },
  { id: 'skeleton', name: 'Skeleton', plural: 'Skeletons', hp: 6, xp: 6, speed: 2.0, damage: 1, range: 4, max: 5, toKill: 2, clearingsOnly: true, minHops: 2, behaviour: 'hunter' },
  { id: 'dude_bandit', name: 'Dude Bandit', plural: 'Dude Bandits', hp: 7, xp: 4, speed: 6.0, damage: 1, range: 1, max: 10, toKill: 3, minHops: 2, behaviour: 'blocker' },
  { id: 'lady_bandit', name: 'Lady Bandit', plural: 'Lady Bandits', hp: 7, xp: 4, speed: 6.0, damage: 1, range: 1, max: 10, toKill: 4, minHops: 2, behaviour: 'blocker' },
  { id: 'undead_knight', name: 'Undead Knight', plural: 'Undead Knights', hp: 20, xp: 15, speed: 8, damage: 1, range: 1, max: 5, toKill: 1, clearingsOnly: true, minHops: 3, behaviour: 'hunter' },
  // --- Temple enemies (one type per temple) ---
  { id: 'bee', name: 'Bee', plural: 'Bees', hp: 6, xp: 5, speed: 16.0, damage: 1, range: 1, max: 8, templeOnly: true, minHops: 0, behaviour: 'temple' },
  { id: 'man_eater_flower', name: 'Man Eater Flower', plural: 'Man Eater Flowers', hp: 7, xp: 6, speed: 14.0, damage: 2, range: 1, max: 6, templeOnly: true, minHops: 0, behaviour: 'temple' },
  { id: 'arachne', name: 'Arachne', plural: 'Arachnes', hp: 10, xp: 10, speed: 3.0, damage: 2, range: 1, max: 5, templeOnly: true, minHops: 0, behaviour: 'temple' },
  { id: 'evil_eye', name: 'Evil Eye', plural: 'Evil Eyes', hp: 8, xp: 8, speed: 2.5, damage: 2, range: 5, max: 6, templeOnly: true, minHops: 0, behaviour: 'temple' },
  { id: 'fire_skull', name: 'Fire Skull', plural: 'Fire Skulls', hp: 5, xp: 5, speed: 14.0, damage: 2, range: 1, max: 8, templeOnly: true, minHops: 0, behaviour: 'temple' },
  // --- The finale (hp is computed from bindings × strength; see finale) ---
  { id: 'demon', name: 'The Demon', plural: 'Demons', hp: 20, xp: 0, speed: 8, damage: 2, range: 3, max: 1, templeOnly: true, minHops: 0, behaviour: 'boss' },
];

export const ENEMY_BY_ID: Readonly<Record<EnemyType, EnemyDef>> = Object.fromEntries(
  ENEMIES.map((e) => [e.id, e]),
) as Record<EnemyType, EnemyDef>;

export const OVERWORLD_ENEMIES: readonly EnemyDef[] = ENEMIES.filter((e) => !e.templeOnly);

export const TEMPLE_ENEMY_TYPES: readonly EnemyType[] = ['bee', 'man_eater_flower', 'arachne', 'evil_eye', 'fire_skull'];

export function isAggressive(def: EnemyDef): boolean {
  return def.behaviour === 'mushroom' || def.behaviour === 'blocker' || def.behaviour === 'hunter';
}
