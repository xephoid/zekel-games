// M0 integrity locks — the six fixtures pinned in PORT-PLAN §7b M0. Every
// expected value here is computed from the PINNED rules text
// (src/verify/neither-guts-nor-gears/rules-v2026-09-21.txt), which this module
// cannot edit: (1) layout tile counts + per-resource totals vs §13.1,
// (2) hero roster 20 + lore 12 (8 absent recorded as absent, not invented),
// (3) battle-deck multiset = §10.1, (4) the shared 12-tile Or/Oi/Et center
// equals §7a-H4's coordinate set in EVERY layout, (5) adjacency spot-check on
// the 3–4p layout by the §13.2 neighbor rule, (6) Spinner DEF === 1 (ruling 60).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BATTLE_CARDS, buildBattleDeck, BATTLE_DECK_SIZE, HEROES, MILESTONES,
  ROBOT_UNITS, WIZARD_UNITS, WIZARD_BUILDINGS, WIZARD_RESEARCH, ROBOT_BUILDINGS,
  ROBOT_RESEARCH, TECH_TARGET, heroStatsForCategory,
} from '../data/catalogs.js';
import {
  FIVE_SIX_PLAYER_TILES, THREE_FOUR_PLAYER_TILES, TWO_PLAYER_TILES,
  coordKey, neighborsOf, type MapTile,
} from '../data/maps.js';

// --- The pin, parsed here so the module's own data file cannot pass itself. ---
const pinPath = fileURLToPath(new URL('../../rules/rules-v2026-09-21.txt', import.meta.url));
const pin = readFileSync(pinPath, 'utf-8').replace(/\r/g, '');

/** Parse a §13 coordinate listing (the `c=...: r=Res@n, ...` lines) from a
 *  headed pin section. */
function parsePinLayout(heading: string): Map<string, { resource: string; start: number | null }> {
  const startIdx = pin.indexOf(`### ${heading}`);
  expect(startIdx, `pin section ${heading} exists`).toBeGreaterThanOrEqual(0);
  const tail = pin.slice(startIdx);
  const endIdx = tail.indexOf('\n### ');
  const section = endIdx > 0 ? tail.slice(0, endIdx) : tail;
  const out = new Map<string, { resource: string; start: number | null }>();
  for (const line of section.split('\n')) {
    const m = line.match(/^c=(-?\d+):\s*(.+)$/);
    if (!m) continue;
    const c = m[1];
    for (const part of m[2]!.split(',')) {
      const t = part.trim().match(/^(\d+)=(Wa|Wo|Or|Oi|Et)(?:@(\d+))?$/);
      if (!t) continue;
      out.set(`${c},${t[1]}`, { resource: t[2]!, start: t[3] ? parseInt(t[3]!, 10) : null });
    }
  }
  return out;
}

const PIN_RES_NAME: Record<string, string> = { Wa: 'water', Wo: 'wood', Or: 'ore', Oi: 'oil', Et: 'ether' };

function tilesAsMap(tiles: MapTile[]): Map<string, { resource: string; start: number | null }> {
  const out = new Map<string, { resource: string; start: number | null }>();
  for (const t of tiles) out.set(coordKey(t.c, t.r), { resource: t.resource, start: t.start ?? null });
  return out;
}

describe('M0 (1): layout tile counts + per-resource totals match the pin', () => {
  const cases = [
    { heading: '13.5 Two player layout', tiles: TWO_PLAYER_TILES, total: 24 },
    { heading: '13.4 Three to four player layout', tiles: THREE_FOUR_PLAYER_TILES, total: 29 },
    { heading: '13.3 Five to six player layout', tiles: FIVE_SIX_PLAYER_TILES, total: 52 },
  ];
  for (const c of cases) {
    it(`${c.heading}: ${c.total} tiles, identical coordinate set + resources + starts`, () => {
      const fromPin = parsePinLayout(c.heading);
      expect(fromPin.size).toBe(c.total);
      expect(c.tiles.length).toBe(c.total);
      const ours = tilesAsMap(c.tiles);
      for (const [key, pinTile] of fromPin) {
        const our = ours.get(key);
        expect(our, `${key} exists in module data`).toBeTruthy();
        expect(our!.resource, `${key} resource`).toBe(PIN_RES_NAME[pinTile.resource]);
        expect(our!.start, `${key} start`).toBe(pinTile.start);
      }
    });
  }
});

describe('M0 (2): hero roster = 20, lore rows = 12 (8 recorded absent, not invented)', () => {
  it('exactly 20 heroes, roster numbers 1..20 unique', () => {
    expect(HEROES.length).toBe(20);
    expect(new Set(HEROES.map((h) => h.num)).size).toBe(20);
    expect(HEROES.map((h) => h.num).sort((a, b) => a - b)).toEqual([...Array(20)].map((_, i) => i + 1));
  });
  it('exactly 12 lore rows; the 8 un-lored heroes are null, not invented', () => {
    const lored = HEROES.filter((h) => h.lore !== null);
    expect(lored.length).toBe(12);
    for (const unloredId of ['chaimidious', 'evo-angel', 'elara', 'derrick', 'mayhew', 'smyth', 'motherboard', 'greymore']) {
      expect(HEROES.find((h) => h.id === unloredId)!.lore, `${unloredId} has no printed lore row`).toBeNull();
    }
    // Every printed lore row in the pin appears in the data.
    const loreSection = pin.slice(pin.indexOf('### 8.5'), pin.indexOf('## 9'));
    const rows = loreSection.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---') && !l.startsWith('| Hero'));
    expect(rows.length).toBe(12);
    for (const row of rows) {
      const [name, lore] = row.split('|').slice(1, 3).map((s) => s.trim());
      const hero = HEROES.find((h) => h.name === name);
      expect(hero, `lore hero "${name}" exists`).toBeTruthy();
      expect(hero!.lore).toBe(lore);
    }
  });
  it('hero stat classes per §8.2 (incl. Leader +2 DEF tiers)', () => {
    expect(heroStatsForCategory('military', false)).toEqual({ init: 70, dmg: 3, def: 4 });
    expect(heroStatsForCategory('military', true)).toEqual({ init: 70, dmg: 3, def: 6 });
    expect(heroStatsForCategory('culture', true)).toEqual({ init: 30, dmg: 1, def: 5 });
    expect(heroStatsForCategory('evo-angel', false)).toEqual({ init: 80, dmg: 4, def: 4 });
    expect(heroStatsForCategory('evo-angel', true)).toEqual({ init: 80, dmg: 4, def: 6 });
  });
});

describe('M0 (3): battle deck multiset = §10.1 (20 total, 4 Retreat)', () => {
  it('composition sums to 20 with exactly 4 Retreat', () => {
    expect(BATTLE_DECK_SIZE).toBe(20);
    expect(BATTLE_CARDS.reduce((a, c) => a + c.copies, 0)).toBe(20);
    expect(BATTLE_CARDS.find((c) => c.id === 'retreat')!.copies).toBe(4);
    const deck = buildBattleDeck();
    expect(deck.length).toBe(20);
    const counts: Record<string, number> = {};
    for (const d of deck) counts[d.card] = (counts[d.card] ?? 0) + 1;
    for (const c of BATTLE_CARDS) expect(counts[c.id]).toBe(c.copies);
    expect(new Set(deck.map((d) => d.instanceId)).size).toBe(20);
  });
});

describe('M0 (4): the shared 12-tile Or/Oi/Et center is identical in every layout', () => {
  // Ruling #97 (2026-09-25): C3 (-2,4) is water and C2 (-2,2) ore on every
  // layout; only the 5-6p layout reaches C2, so it alone has the eighth ore.
  const EXPECTED = {
    ore: ['0,2', '0,4', '0,10', '0,12', '1,9', '1,11', '2,10'].sort(),
    oil: ['0,6', '0,8'].sort(),
    ether: ['-1,7', '1,7'].sort(),
  };
  for (const [name, tiles] of [
    ['2p', TWO_PLAYER_TILES],
    ['3-4p', THREE_FOUR_PLAYER_TILES],
    ['5-6p', FIVE_SIX_PLAYER_TILES],
  ] as const) {
    it(`${name}: center = 7 Or (+ C2 on 5-6p) / 2 Oi / 2 Et at the pinned coordinates`, () => {
      const at = (res: string) => tiles.filter((t) => t.resource === res).map((t) => coordKey(t.c, t.r)).sort();
      expect(at('ore')).toEqual(name === '5-6p' ? ['-2,2', ...EXPECTED.ore].sort() : EXPECTED.ore);
      expect(at('oil')).toEqual(EXPECTED.oil);
      expect(at('ether')).toEqual(EXPECTED.ether);
    });
  }
});

describe('M0 (5): adjacency spot-check on the 3–4p layout via the §13.2 neighbor rule', () => {
  const tiles = THREE_FOUR_PLAYER_TILES;
  const has = (c: number, r: number) => tiles.some((t) => t.c === c && t.r === r);
  it('center (0,4) [Ore] has exactly the listed neighbors', () => {
    const ns = neighborsOf(tiles, 0, 4).map((t) => coordKey(t.c, t.r)).sort();
    // Potential: (0,2),(0,6),(-1,3),(-1,5),(1,3),(1,5) — all listed on 3-4p.
    expect(ns).toEqual(['-1,3', '-1,5', '0,2', '0,6', '1,3', '1,5']);
    expect(ns.map((k) => tilesAsMap(tiles).get(k)!.resource).sort()).toEqual(['ore', 'oil', 'water', 'water', 'water', 'wood'].sort());
  });
  it('corner start @4 (-2,4) sees only existing tiles (the top row is covered, ruling #97)', () => {
    const ns = neighborsOf(tiles, -2, 4).map((t) => coordKey(t.c, t.r)).sort();
    // Potential: (-2,2) covered, (-2,6), (-3,3) missing, (-3,5) missing, (-1,3), (-1,5).
    expect(ns).toEqual(['-2,6', '-1,3', '-1,5'].sort());
    expect(has(-2, 2)).toBe(false);
    expect(has(0, 0)).toBe(false);
    expect(tiles.find((t) => t.c === -2 && t.r === 4)).toMatchObject({ resource: 'water', start: 4 });
    expect(tiles.find((t) => t.c === 2 && t.r === 4)).toMatchObject({ resource: 'water', start: 3 });
  });
  it('no tile has a neighbor outside the layout', () => {
    for (const t of tiles) {
      for (const n of neighborsOf(tiles, t.c, t.r)) {
        expect(has(n.c, n.r), `(${n.c},${n.r}) exists`).toBe(true);
      }
    }
  });
});

describe('M0 (6): Spinner Platform DEF is 1 (ruling 60)', () => {
  it('spinner def === 1, not 2', () => {
    expect(ROBOT_UNITS.find((u) => u.id === 'spinner')!.def).toBe(1);
  });
});

describe('catalog counts (§7a H1/H6 anchors)', () => {
  it('wizard units 7 / robot units 12 / wizard buildings 9 / robot buildings 6 / wizard research 9 / robot research 7 (rulings #86, #101-#103, #111, #121)', () => {
    expect(WIZARD_UNITS.length).toBe(7);
    expect(ROBOT_UNITS.length).toBe(12);
    expect(WIZARD_BUILDINGS.length).toBe(9);
    expect(ROBOT_BUILDINGS.length).toBe(6);
    expect(WIZARD_RESEARCH.length).toBe(9);
    // Ruling #121: Detection is gone.
    expect(WIZARD_RESEARCH.some((r) => r.id === 'detection')).toBe(false);
    expect(ROBOT_RESEARCH.length).toBe(7);
  });
  it('two-player milestones are exactly 5/15/30/50/75 (scaled by milestonesFor)', () => {
    expect([...MILESTONES]).toEqual([5, 15, 30, 50, 75]);
  });
  it('tech targets are the type pools plus the battle strategy card type: wizard 7+9+9+1=26, robot 12+6+7+1=26 (rulings #86, #90, #101-#103, #111, #121, #129)', () => {
    expect(WIZARD_UNITS.length + WIZARD_BUILDINGS.length + WIZARD_RESEARCH.length + 1).toBe(26);
    expect(ROBOT_UNITS.length + ROBOT_BUILDINGS.length + ROBOT_RESEARCH.length + 1).toBe(26);
    expect(TECH_TARGET).toEqual({ wizard: 26, robot: 26 });
  });
});
