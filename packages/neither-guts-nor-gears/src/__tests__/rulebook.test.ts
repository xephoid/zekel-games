// The rulebook (rulebook.ts) states facts the engine also holds. These checks
// fail when the two part: a treaty chart that grants what the engine does not,
// a component count that is not the engine's supply, an example naming a unit
// that does not exist. The last check keeps the screen's captured reference
// data (src/glue/__tests__/fixtures/reference.json) the engine's current one.

import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { areMilitaryAllies, hasCollectionAccess } from '../engine.js';
import { TREATIES, WIZARD_UNITS, ROBOT_UNITS, type TreatyType } from '../data/catalogs.js';
import { layoutForPlayerCount, tilesForLayout } from '../data/maps.js';
import { coreSupplyFor, economicCollectorsFor, robotCollectorCaps } from '../economicScale.js';
import { LAYOUT_KEYS, nggRulebook, type LayoutKey } from '../rulebook.js';
import neitherGutsNorGears from '../index.js';
import type { NGGState } from '../types.js';

const book = nggRulebook();
const count = (name: string) => book.components.find((c) => c.name === name)!.count as Record<LayoutKey, number>;

describe('the rulebook agrees with the engine', () => {
  it('rides the reference data', () => {
    const ref = neitherGutsNorGears.getReferenceData() as { rulebook: unknown };
    expect(ref.rulebook).toEqual(book);
  });

  it('puts each player count on the engine\'s layout', () => {
    for (const [key, counts] of Object.entries(book.players_by_layout)) {
      for (const n of counts) expect(layoutForPlayerCount(n)).toBe(LAYOUT_KEYS[key as LayoutKey]);
    }
    expect(Object.values(book.players_by_layout).flat().sort()).toEqual([2, 3, 4, 5, 6]);
  });

  it('charts what each treaty grants as the engine does', () => {
    expect(book.treaties.chart.map((r) => r.treaty).sort()).toEqual(TREATIES.map((t) => t.name).sort());
    for (const row of book.treaties.chart) {
      const type = TREATIES.find((t) => t.name === row.treaty)!.id as TreatyType;
      const state = { treaties: [{ type, partners: ['a', 'b'] }] } as unknown as NGGState;
      expect(areMilitaryAllies(state, 'a', 'b'), `${row.treaty} allies`).toBe(row.allies);
      expect(hasCollectionAccess(state, 'a', 'b'), `${row.treaty} collection`).toBe(row.collection);
      expect(row.hands, `${row.treaty} hands`).toBe(type === 'shared-tactics');
      expect(row.victory, `${row.treaty} victory`).toBe(type === 'culture-treaty');
    }
  });

  it('counts the supply the engine enforces, per map', () => {
    for (const [key, layout] of Object.entries(LAYOUT_KEYS) as Array<[LayoutKey, (typeof LAYOUT_KEYS)[LayoutKey]]>) {
      const caps = robotCollectorCaps({ layout });
      expect(count('Surfs per wizard')[key]).toBe(economicCollectorsFor(layout));
      expect(count('Cores per robot')[key]).toBe(coreSupplyFor({ layout }));
      expect(count('Collectors per robot')[key]).toBe(caps.water + caps.wood + caps.ore + caps.oil + caps.ether);
      // The water / wood / ore caps are the map's own tiles.
      const tiles = tilesForLayout(layout);
      for (const r of ['water', 'wood', 'ore'] as const) expect(caps[r]).toBe(tiles.filter((t) => t.resource === r).length);
    }
  });

  it('names real units and tiles in its examples', () => {
    const units = [...WIZARD_UNITS, ...ROBOT_UNITS].map((u) => u.name);
    expect(units).toContain(book.paying.example.buys);
    for (const u of book.battle.example.units) expect(units).toContain(u);
    const fig = book.paying.example.figure;
    for (const p of fig.pieces) expect(fig.tiles.some((t) => t.c === p.c && t.r === p.r)).toBe(true);
    // The figure is a real corner of the board: every tile is on the three-to-four-player map with the same resource.
    const big = tilesForLayout('threeFour');
    for (const t of fig.tiles) expect(big.find((b) => b.c === t.c && b.r === t.r)?.resource).toBe(t.resource);
  });

  it('keeps the screen\'s captured reference data current', () => {
    const file = fileURLToPath(new URL('../glue/__tests__/fixtures/reference.json', import.meta.url));
    const now = JSON.parse(JSON.stringify(neitherGutsNorGears.getReferenceData()));
    if (process.env['UPDATE_FIXTURES']) writeFileSync(file, JSON.stringify(now, null, 1) + '\n');
    expect(JSON.parse(readFileSync(file, 'utf8')), 'run with UPDATE_FIXTURES=1 to refresh').toEqual(now);
  });
});
