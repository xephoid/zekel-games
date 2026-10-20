// Resources and trade, from shared/src/data/GameData.ts and the original
// client (inn pricing, stock, ore rolls, harvest hit points).

export type ResourceType = 'plant_fiber' | 'wood' | 'demon_powder' | 'demon_ichor' | 'iron_ore' | 'gold';

export const RESOURCE_TYPES: readonly ResourceType[] = ['plant_fiber', 'wood', 'demon_powder', 'demon_ichor', 'iron_ore', 'gold'];

export const RESOURCE_BASE_VALUE: Readonly<Record<ResourceType, number>> = {
  demon_powder: 1,
  plant_fiber: 2,
  wood: 3,
  demon_ichor: 4,
  iron_ore: 5,
  gold: 6,
};

export const RESOURCE_DISPLAY_NAME: Readonly<Record<ResourceType, string>> = {
  plant_fiber: 'Plant Fiber',
  wood: 'Wood',
  demon_powder: 'Demon Powder',
  demon_ichor: 'Demon Ichor',
  iron_ore: 'Iron Ore',
  gold: 'Gold',
};

/** Inn prices: a per-town multiplier 1..6 per resource, fixed at generation. */
export const PRICE_MULTIPLIER_MIN = 1;
export const PRICE_MULTIPLIER_MAX = 6;

export function sellPrice(resource: ResourceType, multiplier: number): number {
  return RESOURCE_BASE_VALUE[resource] * multiplier;
}

export function buyPrice(resource: ResourceType, multiplier: number): number {
  return Math.ceil(sellPrice(resource, multiplier) * 1.5);
}

/** Opening inn stock per resource: (7 − multiplier) × 10. */
export function initialStock(multiplier: number): number {
  return (7 - multiplier) * 10;
}

/** Harvestable nodes. Plants and trees are attacked (the original: plant hp 1,
 *  tree hp 4); ore deposits are bombed. */
export type ResourceNodeKind = 'plant' | 'tree' | 'ore';

export const RESOURCE_NODE: Readonly<
  Record<ResourceNodeKind, { name: string; plural: string; hp: number; yields: ResourceType | null }>
> = {
  plant: { name: 'Plant', plural: 'Plants', hp: 1, yields: 'plant_fiber' },
  tree: { name: 'Tree', plural: 'Trees', hp: 4, yields: 'wood' },
  ore: { name: 'Ore Deposit', plural: 'Ore Deposits', hp: 0, yields: null },
};

export const PLANT_COUNT = 50;
export const TREE_COUNT = 20;
/** The original's rock formations have no fixed count; PORT-PLAN Q3 → 8. */
export const ORE_DEPOSIT_COUNT = 8;

/** A bombed deposit (or the Sky Temple wall): 10% gold, 40% iron ore, else nothing. */
export const GOLD_DROP_CHANCE = 0.1;
export const IRON_DROP_CHANCE = 0.4;

/** Each harvest swing has this chance to pull an aggressive enemy at the node into combat. */
export const HARVEST_AGGRO_CHANCE = 0.1;
