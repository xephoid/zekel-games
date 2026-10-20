// A client shows what a battle card costs from the reference data, so the
// price published there is the one the rules charge, stated once.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { BATTLE_CARD_PURCHASE } from '../data/catalogs.js';
import { purchaseCostOf } from '../engine.js';

describe('the battle card price', () => {
  it('is published in the reference data as the rules charge it', () => {
    const ref = game.getReferenceData() as { battle_card_purchase: { cost: Record<string, number>; either: string[]; unlocked_by: Record<string, string> } };
    expect(ref.battle_card_purchase).toEqual({
      cost: { water: 1, wood: 1, ore: 1 }, either: ['ether', 'oil'],
      unlocked_by: { wizard: 'Embassy', robot: 'Defense Research Station' },
    });
    const charged = purchaseCostOf({} as never, { type: 'research', kind: 'battle_card' });
    expect(charged).toEqual({ cost: BATTLE_CARD_PURCHASE.cost, either: BATTLE_CARD_PURCHASE.either });
  });

  it('publishes each hero with its battle stats, and the Leader bonus', () => {
    const ref = game.getReferenceData() as { heroes: Array<{ id: string; category: string; stats: { init: number; dmg: number; def: number } }>; leader_stat_bonus: { def: number } };
    const byCat = Object.fromEntries(ref.heroes.map((h) => [h.category, h.stats]));
    expect(byCat['military']).toEqual({ init: 70, dmg: 3, def: 4 });
    expect(byCat['evo-angel']).toEqual({ init: 80, dmg: 4, def: 4 });
    expect(ref.heroes.every((h) => h.stats && typeof h.stats.init === 'number')).toBe(true);
    expect(ref.leader_stat_bonus).toEqual({ def: 2 });
  });
});
