import { describe, it, expect } from 'vitest';
import { FACTIONS, FACTION_IDS } from '../data/factions.js';
import { PUBLIC_OBJECTIVES, SECRET_OBJECTIVES, POINTS_TO_WIN, SECRET_OBJECTIVE_POINTS } from '../data/objectives.js';
import { buildIntelDeck, ALL_TREATS, INTEL_DECK_SIZE } from '../data/intel.js';
import { TREAT_LOCATIONS } from '../data/board.js';

describe('factions', () => {
  it('has 5 factions, one per id, regions 1-4 + nomads region-less', () => {
    expect(FACTION_IDS).toHaveLength(5);
    for (const id of FACTION_IDS) expect(FACTIONS[id].id).toBe(id);
    const regions = FACTION_IDS.map((id) => FACTIONS[id].homeRegion);
    expect(regions.filter((r) => r !== null).sort()).toEqual([1, 2, 3, 4]);
    expect(FACTIONS.nomads.homeRegion).toBeNull();
  });

  it('every region 1-4 is held by exactly one faction', () => {
    for (const region of [1, 2, 3, 4]) {
      const holders = FACTION_IDS.filter((id) => FACTIONS[id].homeRegion === region);
      expect(holders).toHaveLength(1);
    }
  });
});

describe('objectives', () => {
  it('has 5 public objectives with the confirmed point values', () => {
    expect(PUBLIC_OBJECTIVES).toHaveLength(5);
    const byId = Object.fromEntries(PUBLIC_OBJECTIVES.map((o) => [o.id, o.points]));
    expect(byId['units_all_matching_color']).toBe(3);
    expect(byId['defeat_foe']).toBe(3);
    expect(byId['capture_leader']).toBe(1);
    expect(byId['leader_castle_uncontested']).toBe(1);
  });

  it('has 12 secret objectives, all worth 2 points', () => {
    expect(SECRET_OBJECTIVES).toHaveLength(12);
    for (const o of SECRET_OBJECTIVES) expect(o.points).toBe(SECRET_OBJECTIVE_POINTS);
    const ids = new Set(SECRET_OBJECTIVES.map((o) => o.id));
    expect(ids.size).toBe(12);
  });

  it('win target is 5 points', () => {
    expect(POINTS_TO_WIN).toBe(5);
  });
});

describe('intel deck', () => {
  it('builds exactly 80 cards with unique ids', () => {
    const deck = buildIntelDeck();
    expect(deck).toHaveLength(INTEL_DECK_SIZE);
    const ids = new Set(deck.map((c) => c.cardId));
    expect(ids.size).toBe(deck.length);
  });

  it('composes 60 single + 12 double + 8 treat', () => {
    const deck = buildIntelDeck();
    expect(deck.filter((c) => c.kind === 'single')).toHaveLength(60);
    expect(deck.filter((c) => c.kind === 'double')).toHaveLength(12);
    expect(deck.filter((c) => c.kind === 'treat')).toHaveLength(8);
  });

  it('has 10 of each single color', () => {
    const deck = buildIntelDeck();
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
    for (const color of colors) {
      const n = deck.filter((c) => c.kind === 'single' && c.color === color).length;
      expect(n).toBe(10);
    }
  });

  it('doubles are same-color: 2 per color (RR/OO/YY/GG/BB/PP)', () => {
    const deck = buildIntelDeck();
    const colors = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
    for (const color of colors) {
      const n = deck.filter((c) => c.kind === 'double' && c.color === color).length;
      expect(n).toBe(2);
    }
  });

  it('has one treat card per treat location (8 total, ids match)', () => {
    const deck = buildIntelDeck();
    const treatCards = deck.flatMap((c) => (c.kind === 'treat' ? [c.treat] : []));
    expect(new Set(treatCards)).toEqual(new Set(ALL_TREATS));
    // every board treat location has a matching treat card
    for (const loc of TREAT_LOCATIONS) {
      expect(ALL_TREATS).toContain(loc.id);
    }
  });
});
