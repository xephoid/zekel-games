// The five temples and their magic items (notes §Magic Items; names from the
// notes where they differ from the original's task text).

export type TempleType = 'sky' | 'earth' | 'space' | 'light' | 'fire';

export const TEMPLE_TYPES: readonly TempleType[] = ['sky', 'earth', 'space', 'light', 'fire'];

export interface MagicItemDef {
  temple: TempleType;
  templeName: string;
  name: string;
  description: string;
}

export const MAGIC_ITEMS: Readonly<Record<TempleType, MagicItemDef>> = {
  sky: {
    temple: 'sky',
    templeName: 'Sky Temple',
    name: 'Winged Boots',
    description:
      'Fly over enemies to avoid fights. Aggressive ranged enemies (range 3 or more) can still attack you. ' +
      'You can attack from the air only if your range is 3 or more, and enemies with range below 3 cannot hit back.',
  },
  earth: {
    temple: 'earth',
    templeName: 'Earth Temple',
    name: 'Aura of Protection',
    description:
      'Become invulnerable. You cannot attack while it is up: in combat it ends the fight with no parting shots, ' +
      'outdoors it lets your next move pass every enemy on the node.',
  },
  space: {
    temple: 'space',
    templeName: 'Space Temple',
    name: 'Cape of Teleportation',
    description: 'Teleport at will to any town you have visited.',
  },
  light: {
    temple: 'light',
    templeName: 'Light Temple',
    name: 'Eye of Truth',
    description: 'Passive. When you talk to someone you can tell whether they are lying.',
  },
  fire: {
    temple: 'fire',
    templeName: 'Fire Bombs',
    name: 'Fire Bombs',
    description: 'Unlimited bombs.',
  },
};

export const TEMPLE_NAME: Readonly<Record<TempleType, string>> = {
  sky: 'Sky Temple',
  earth: 'Earth Temple',
  space: 'Space Temple',
  light: 'Light Temple',
  fire: 'Fire Temple',
};

/** Which enemy guards each temple's gauntlet (original generateTempleMaze). */
export const TEMPLE_GUARDIAN = {
  sky: 'bee',
  earth: 'man_eater_flower',
  space: 'arachne',
  light: 'evil_eye',
  fire: 'fire_skull',
} as const;
