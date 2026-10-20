// A seat plans its own strike without its Leader (2026-10-08). Seats on the
// military plan never killed anyone in all-AI games: the read counted the
// seat's own Leader as the spy carrier and as part of the strike force, but
// the AI's defence never walks the Leader off its base, so the read promised
// a kill "in three rounds" every round and nothing moved. With the Leader
// left home, a step forward must also show — the walk is read in fractions
// of a round, not rounded up.

import { describe, expect, it } from 'vitest';
import { damageKit, distancesFrom, militaryRead } from '../ai-military.js';
import { strikeForce, strikeKills } from '../ai-strike.js';
import { econFromState } from '../ai-econ.js';
import { unitsForSpecies } from '../data/catalogs.js';
import { coordKey, neighborsOf } from '../data/maps.js';
import { base2p } from './pendingFixtures.js';
import type { NGGState } from '../types.js';

function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }
function leaderOf(g: NGGState, id: string) { return g.heroes.find((h) => h.ownerId === id && h.isLeader)!; }

/** wiz holds the spy line, its spy on `carrier`. */
function armWizard(g: NGGState, carrier: string) {
  const wiz = player(g, 'wiz');
  wiz.buildings.push('Library of Illusion');
  wiz.research.push('invisible');
  wiz.spyAssignments.push({ source: 'illusionist', heroId: carrier, active: true });
}

/** A non-Leader hero for wiz, standing at its base. */
function addHero(g: NGGState, id: string) {
  g.heroPool = g.heroPool.filter((h) => h !== id);
  g.heroes.push({ id, ownerId: 'wiz', coord: leaderOf(g, 'wiz').coord, isLeader: false, dead: false });
}

describe('a seat plans its own strike without its Leader', () => {
  it('a spy on the Leader opens no spy line in the seat\'s own plan, though a rival still reads the threat', () => {
    const g = base2p().gameState;
    armWizard(g, leaderOf(g, 'wiz').id);
    expect(militaryRead(g, player(g, 'wiz'), 'wiz').line).not.toBe('spy');
    expect(militaryRead(g, player(g, 'wiz'), 'rob').line).toBe('spy');
  });

  it('the same spy on another hero opens it', () => {
    const g = base2p().gameState;
    addHero(g, 'quartermaster');
    armWizard(g, 'quartermaster');
    const own = militaryRead(g, player(g, 'wiz'), 'wiz');
    expect(own.line).toBe('spy');
    expect(own.eta).toBeLessThan(40);
  });

  it('one step toward the target shortens the seat\'s own clock, with two Move/Battle cards too', () => {
    const g = base2p().gameState;
    addHero(g, 'quartermaster');
    armWizard(g, 'quartermaster');
    player(g, 'wiz').actionCards.moveBattle = 2;
    // Start the carrier an even number of steps away (4), then step to 3:
    // rounded up at two steps a round, both are two rounds — the step used
    // to count for nothing.
    const qm = g.heroes.find((h) => h.id === 'quartermaster')!;
    const dist = distancesFrom(g, [leaderOf(g, 'rob').coord!]);
    const tiles = g.tiles.map((t) => coordKey(t.c, t.r));
    qm.coord = tiles.find((k) => dist.get(k) === 4)!;
    const before = militaryRead(g, player(g, 'wiz'), 'wiz').byTarget['rob']!;
    const [c, r] = qm.coord.split(',').map(Number);
    const tile = g.tiles.find((t) => t.c === c && t.r === r)!;
    qm.coord = neighborsOf(g.tiles, tile.c, tile.r).map((t) => coordKey(t.c, t.r)).find((k) => dist.get(k) === 3)!;
    const after = militaryRead(g, player(g, 'wiz'), 'wiz').byTarget['rob']!;
    expect(after).toBeLessThan(before);
  });
});

describe('a strike can need two new pieces', () => {
  it('no single unit kills a defence-5 Leader at home, two Enchantresses do — and the kit reads it (2026-10-08)', () => {
    const g = base2p().gameState;
    const robLeader = leaderOf(g, 'rob');
    robLeader.id = 'chronicler'; // a culture Leader: defence 5
    g.heroPool = g.heroPool.filter((h) => h !== 'chronicler' && h !== 'quartermaster');
    addHero(g, 'quartermaster');
    player(g, 'wiz').subjects = 2;
    const force = strikeForce(g, 'wiz', true).map((f) => ({ kind: f.kind, id: f.id }));
    const units = unitsForSpecies('wizard').filter((u) => !u.collector && !u.immobile && u.init !== null).map((u) => u.id);
    for (const u of units) expect(strikeKills(g, 'wiz', 'rob', [...force, { kind: 'new-unit', typeId: u }]), u).toBe(false);
    expect(strikeKills(g, 'wiz', 'rob', [...force, { kind: 'new-unit', typeId: 'enchantress' }, { kind: 'new-unit', typeId: 'enchantress' }])).toBe(true);
    // Before, the kit added one piece only and read this Leader as out of reach.
    // No milestone heroes, so only unit kits count (since ruling #125 raised the
    // Library's price, a claimed hero + one Enchantress is quicker).
    g.heroPool = [];
    const kit = damageKit(g, player(g, 'wiz'), econFromState(g, player(g, 'wiz')), 'rob', true);
    expect(kit.rounds).toBeLessThan(40);
    expect(kit.missing.filter((x) => x === 'enchantress')).toHaveLength(2);
  });
});
