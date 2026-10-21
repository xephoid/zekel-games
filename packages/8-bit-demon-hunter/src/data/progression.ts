// Player progression, from the original gameConfig.playerProgression plus the
// notes' agility rule ("stat increases are by one except for speed which
// increments by 4"). Ruling 2026-10-20: the player starts at speed 4, so the
// four picks run 4 -> 8 -> 12 -> 16 -> 20.

export type StatId = 'strength' | 'agility' | 'health' | 'range';

export const MAX_LEVEL = 10;

/** XP needed to reach level n+2 while at level n+1 (xpCurve[level - 1]). */
export const XP_CURVE: readonly number[] = [4, 8, 16, 32, 64, 128, 256, 512, 1024];

export const STAT_BASE: Readonly<Record<StatId, number>> = { strength: 1, agility: 4, health: 3, range: 1 };

/** Original caps: strength/agility/range 5, health 10. Agility climbs by 4 per
 *  pick from 4, so its cap is the value after the same four picks: 20. */
export const STAT_MAX: Readonly<Record<StatId, number>> = { strength: 5, agility: 20, health: 10, range: 5 };

export const STAT_STEP: Readonly<Record<StatId, number>> = { strength: 1, agility: 4, health: 1, range: 1 };

export const STAT_DESCRIPTION: Readonly<Record<StatId, string>> = {
  strength: 'How much damage you do when you hit.',
  agility: 'Your speed: who acts first in combat and how many attacks you get per action.',
  health: 'How many hits you can take before dying. Raising it heals you to full.',
  range: 'Higher range than the enemy gives you a free attack at the start of combat, and lets you fight from the air.',
};

export const STARTING_SHUCKLES = 5;

/** Rewards and costs that live in the original client. */
export const WORLD_CLEARED_XP = 100;
export const SOLDIER_TRAINING_XP = 20;
export const MERCHANT_SHUCKLES = 50;
export const INN_SLEEP_COST = 5;
export const INN_TRAIN_COST = 50;
export const INN_TRAIN_XP = 20;
export const INN_RIDE_COST = 50;
export const BOMB_COST = 10;
export const LOCKPICK_COST = 200;
export const BOMB_DAMAGE = 5;

/** Guardians faced in a temple gauntlet, one at a time (ruling 2026-10-21: the
 *  original's full count, five to eight, was a cliff: a hunter either killed
 *  each before it acted or died, with no healing between). */
export const GAUNTLET_LENGTH = 4;

/** The lair fight, in one place so it can be tuned (ruling 2026-10-21).
 *  Flat HP: strength shortens the fight; every binding and every artifact
 *  held takes `perWeakening` off, never below `minHp`. At two thirds the
 *  demon summons `minionCount` minions of `minionHp`, one fewer for every
 *  `weakeningsPerMinionLost` weakenings (the bindings bind its servants too);
 *  in its last third it fires `phase3ExtraAttacks` more per action. */
export const LAIR = {
  baseHp: 48,
  perWeakening: 8,
  minHp: 4,
  minionCount: 3,
  minionHp: 6,
  weakeningsPerMinionLost: 2,
  phase3ExtraAttacks: 1,
};
/** The blast catches you too (ruling 2026-10-21); a bomb that would kill
 *  you needs `confirm`. */
export const BOMB_SELF_DAMAGE = 2;
export const MINIONS_PER_TOWN = 2;
export const PEOPLE_PER_TOWN = 10;
export const TOWN_COUNT = 5;
export const DEFAULT_CLEARINGS = { min: 5, max: 8 } as const;
/** Clearings may hold this many connections to other MAJOR nodes (ruling 2026-10-20). */
export const CLEARING_MAX_LINKS = 4;
