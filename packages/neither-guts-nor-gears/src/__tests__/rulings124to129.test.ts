// Designer rulings #124–#129 (2026-10-08), a nerf to the wizard tech rush:
//   #124 Dowser gives a wizard two Surfs (a robot still four collectors) —
//        rulings101to106.test.ts
//   #125 Library of Enchantment costs 1 water + 2 wood + 1 ore — here
//   #126 Haste costs 2 ore + 1 ether — rulings101to106.test.ts
//   #127 Ice Blast costs 2 water + 1 wood — here
//   #128 the Extra cards take ether (wizards) or oil (robots) — extraActionCards.test.ts
//   #129 the battle card type is part of the technology target, 26 for both —
//        data.test.ts, extraActionCards.test.ts, victory.test.ts

import { describe, expect, it } from 'vitest';
import { ROBOT_UNITS, WIZARD_BUILDINGS, WIZARD_RESEARCH } from '../data/catalogs.js';

describe('rulings #125 and #127: dearer wizard pieces', () => {
  it('#125 the Library of Enchantment costs 1 water + 2 wood + 1 ore (was 2 wood + 1 ore)', () => {
    expect(WIZARD_BUILDINGS.find((b) => b.id === 'library-of-enchantment')!.cost).toEqual({ water: 1, wood: 2, ore: 1 });
  });

  it('#127 Ice Blast costs 2 water + 1 wood (was 1 water + 1 wood)', () => {
    expect(WIZARD_RESEARCH.find((r) => r.id === 'ice-blast')!.cost).toEqual({ water: 2, wood: 1 });
  });
});

// Ruling #130 (2026-10-09): the Large Combat Platform does 3 damage (was 2).
describe('ruling #130: Large Combat Platform DMG 3', () => {
  it('DMG 3, area attack, initiative 60, DEF 3, cost unchanged', () => {
    const lcp = ROBOT_UNITS.find((u) => u.id === 'large-combat-platform')!;
    expect({ dmg: lcp.dmg, aoe: lcp.aoe, init: lcp.init, def: lcp.def, cost: lcp.cost }).toEqual({ dmg: 3, aoe: true, init: 60, def: 3, cost: { wood: 2, ore: 1, oil: 1 } });
  });
});

// Rulings #131 and #132 (2026-10-18): cheaper robot platforms.
describe('rulings #131 and #132: cheaper Spinner and Wall Platforms', () => {
  it('#131 the Spinner Platform costs 1 wood (was 2); its stats are unchanged', () => {
    const u = ROBOT_UNITS.find((x) => x.id === 'spinner')!;
    expect({ cost: u.cost, init: u.init, dmg: u.dmg, def: u.def }).toEqual({ cost: { wood: 1 }, init: 5, dmg: 2, def: 1 });
  });

  it('#132 the Wall Platform costs 2 wood (was 3); its stats are unchanged', () => {
    const u = ROBOT_UNITS.find((x) => x.id === 'wall-platform')!;
    expect({ cost: u.cost, init: u.init, dmg: u.dmg, def: u.def, wallFirst: u.wallFirst }).toEqual({ cost: { wood: 2 }, init: 1, dmg: 0, def: 3, wallFirst: true });
  });
});
