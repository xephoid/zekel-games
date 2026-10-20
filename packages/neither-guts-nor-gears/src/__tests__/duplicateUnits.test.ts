// Playtest 2026-09-29: with two Dragons of one owner in a battle, nothing told
// them apart. An Enhance went onto one of them — the choices showed two
// identical "Enhances Dragon" lines — and the other attacked first at its
// printed damage, so the boost looked a whole attack late. Three fixes:
//   1. identical units of one owner in a battle are numbered, and keep their
//      number for the battle (choices, battle list, log);
//   2. when several of a seat's own units are tied on initiative, every one
//      is offered, so the owner picks which acts first (§9.3);
//   3. an Enhance / Dehance line says whose unit it is and what the number
//      becomes, and Enhance is not offered on a unit printed with DMG 0.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { battleActivation, commitBattleCard, numberDuplicateUnits, startBattle } from '../engine-battle.js';
import type { BattleUnit, NGGMove, NGGState } from '../types.js';
import type { SessionState } from '@zekel/game-kit';
import { base2p, placeUnit } from './pendingFixtures.js';

function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }
type Act = Extract<NGGMove, { type: 'battle_activation' }>;

/** wiz attacks (0,4) from (0,2) with two Dragons and an Enchantress; rob
 *  defends with a Large Combat Platform (DEF 3), a Wall Platform (DEF 3, DMG
 *  0) and Marshal (a hero, DEF 4). */
function twoDragons(): { s: SessionState<NGGState>; g: NGGState; d1: string; d2: string; ench: string } {
  const s = base2p();
  const g = s.gameState;
  player(g, 'wiz').manaCurrent = 5;
  const d1 = placeUnit(g, 'wiz', '0,2', 'dragon');
  const d2 = placeUnit(g, 'wiz', '0,2', 'dragon');
  const ench = placeUnit(g, 'wiz', '0,2', 'enchantress');
  placeUnit(g, 'rob', '0,4', 'large-combat-platform');
  placeUnit(g, 'rob', '0,4', 'wall-platform');
  g.heroPool = g.heroPool.filter((h) => h !== 'marshal');
  g.heroes.push({ id: 'marshal', ownerId: 'rob', coord: '0,4', isLeader: false, dead: false });
  startBattle(g, player(g, 'wiz'), '0,2', '0,4', [{ kind: 'unit', id: d1 }, { kind: 'unit', id: d2 }, { kind: 'unit', id: ench }], []);
  let guard = 0;
  while (g.pending?.kind === 'battle_commit' && guard++ < 10) commitBattleCard(g, g.pending.forPlayerId, null);
  return { s, g, d1, d2, ench };
}

const unitViews = (s: SessionState<NGGState>) =>
  (game.getPlayerView(s, 'wiz') as { battle: { units: Array<{ unit: string; ref: string; dmg: number }> } }).battle.units;

/** rob's units pass until a wizard unit is up. */
function robPasses(g: NGGState) {
  let guard = 0;
  while (g.battle && guard++ < 10) {
    const cur = g.battle.activationQueue[g.battle.activationCursor]!;
    const u = g.battle.units.find((x) => x.unitRef === cur)!;
    if (u.ownerId !== 'rob') return;
    battleActivation(g, 'rob', { type: 'battle_activation', unit: cur, action: { kind: 'pass' } });
  }
}

describe('identical units in a battle are told apart', () => {
  it('two Dragons of one owner are Dragon 1 and Dragon 2 in the battle list and the opening log line; single units keep their plain name', () => {
    const { s, g, d1, d2 } = twoDragons();
    const names = Object.fromEntries(unitViews(s).map((u) => [u.ref, u.unit]));
    expect(names[d1]).toBe('Dragon 1');
    expect(names[d2]).toBe('Dragon 2');
    expect(Object.values(names)).toContain('Enchantress');
    expect(Object.values(names)).toContain('Large Combat Platform');
    const begins = g.log.find((e) => /A battle begins/.test(e.summary))!.summary;
    expect(begins).toMatch(/Dragon 1 \(initiative 10, damage 3, defense 2\)/);
    expect(begins).toMatch(/Dragon 2 \(initiative 10, damage 3, defense 2\)/);
  });

  it('a number stays with its unit: a survivor keeps it, a newcomer takes the next free one', () => {
    const mk = (ref: string, label: string): BattleUnit => ({ unitRef: ref, ownerId: 'wiz', isHero: false, side: 'attackers', typeId: 'dragon', init: 10, dmg: 3, def: 2, aoe: true, activated: false, clericUsedThisPass: false, label } as BattleUnit);
    const alone = [mk('a', 'Dragon')];
    numberDuplicateUnits(alone);
    expect(alone.map((u) => u.label)).toEqual(['Dragon']);
    const survivorAndNewcomer = [mk('b', 'Dragon 2'), mk('c', 'Dragon')];
    numberDuplicateUnits(survivorAndNewcomer);
    expect(survivorAndNewcomer.map((u) => u.label)).toEqual(['Dragon 2', 'Dragon 1']);
    const third = [...survivorAndNewcomer, mk('d', 'Dragon')];
    numberDuplicateUnits(third);
    expect(third.map((u) => u.label)).toEqual(['Dragon 2', 'Dragon 1', 'Dragon 3']);
    // Another seat's Dragon is its own group.
    const mixed = [mk('e', 'Dragon'), { ...mk('f', 'Dragon'), ownerId: 'rob' }];
    numberDuplicateUnits(mixed);
    expect(mixed.map((u) => u.label)).toEqual(['Dragon', 'Dragon']);
  });
});

describe('the Enhance choices say which unit and what changes', () => {
  it('each Dragon has its own line with the owner and the damage before and after; DMG-0 units are not offered; enemy units are marked', () => {
    const { s, ench } = twoDragons();
    const offers = game.getLegalMoves(s, 'wiz').filter((m) => (m.move as Act).unit === ench && (m.move as Act).action.kind === 'ability');
    const lines = offers.map((m) => m.description);
    expect(lines).toContain('Enchantress Enhances Dragon 1 (yours) — DMG 3 to 5 for this battle (2 mana).');
    expect(lines).toContain('Enchantress Enhances Dragon 2 (yours) — DMG 3 to 5 for this battle (2 mana).');
    expect(new Set(lines).size).toBe(lines.length); // no two lines read the same
    expect(lines.some((l) => /Enhances Enchantress|Enhances Wall Platform/.test(l))).toBe(false);
    expect(lines).toContain('Enchantress Enhances Large Combat Platform (enemy rob) — DMG 3 to 5 for this battle (2 mana).');
    // Own side first.
    expect(lines.findIndex((l) => /\(yours\)/.test(l))).toBeLessThan(lines.findIndex((l) => /\(enemy rob\)/.test(l)));
  });
});

describe('the owner picks which of its tied units acts first', () => {
  it('after Enhancing Dragon 2, both Dragons are offered when their slot comes up; Dragon 2 may go first, at 5', () => {
    const { s, g, d1, d2, ench } = twoDragons();
    battleActivation(g, 'wiz', { type: 'battle_activation', unit: ench, action: { kind: 'ability', ability: 'enhance', target: d2 } });
    expect(g.log.some((e) => /casts Enhance \(2 mana\): wiz's Dragon 2 gets damage plus 2/.test(e.summary))).toBe(true);
    expect(unitViews(s).find((u) => u.ref === d2)!.dmg).toBe(5);
    expect(unitViews(s).find((u) => u.ref === d1)!.dmg).toBe(3);
    robPasses(g);
    const attacks = game.getLegalMoves(s, 'wiz').filter((m) => (m.move as Act).action.kind === 'attack');
    expect(attacks.map((m) => (m.move as Act).unit).sort()).toEqual([d1, d2].sort());
    expect(attacks.find((m) => (m.move as Act).unit === d1)!.description).toMatch(/^Dragon 1 makes its area attack — 3 DMG/);
    expect(attacks.find((m) => (m.move as Act).unit === d2)!.description).toMatch(/^Dragon 2 makes its area attack — 5 DMG/);
    // The boosted Dragon goes first, named by its numbered label.
    battleActivation(g, 'wiz', { type: 'battle_activation', unit: 'Dragon 2', action: { kind: 'attack', target: '' } });
    expect(g.log.some((e) => /wiz's Dragon 2's area attack \(5 damage/.test(e.summary))).toBe(true);
    // Marshal (DEF 4) fell to the 5; every robot piece is gone and the battle is over.
    expect(g.heroes.find((h) => h.id === 'marshal')!.dead).toBe(true);
  });
});
