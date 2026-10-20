// Two more blocking notices (2026-10-01): an attacker whose attack found a
// Decoy is told, and so is a seat whose treaty partner broke a treaty with it.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { battleActivation, commitBattleCard, startBattle } from '../engine-battle.js';
import type { NGGState } from '../types.js';
import { base2p, placeUnit, treatyBreakWindow } from './pendingFixtures.js';

function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }

describe('blocking notices', () => {
  it("a Decoy tells the seat whose attack it avoided", () => {
    const s = base2p();
    const g = s.gameState;
    const spitter = placeUnit(g, 'rob', '0,2', 'spitter');
    placeUnit(g, 'wiz', '0,4', 'evoker');
    const lead = g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!;
    lead.coord = '0,4';
    player(g, 'wiz').spyAssignments.push({ source: 'illusionist', heroId: lead.id, active: true } as never);
    startBattle(g, player(g, 'rob'), '0,2', '0,4', [{ kind: 'unit', id: spitter }], []);
    for (let i = 0; g.pending?.kind === 'battle_commit' && i < 10; i++) commitBattleCard(g, g.pending.forPlayerId, null);
    for (let i = 0; i < 12; i++) {
      const cur = g.battle!.activationQueue[g.battle!.activationCursor];
      if (cur === undefined || cur === spitter) break;
      const owner = g.battle!.units.find((u) => u.unitRef === cur)!.ownerId;
      battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } });
    }
    battleActivation(g, 'rob', { type: 'battle_activation', unit: spitter, action: { kind: 'attack', target: lead.id } });
    expect(g.pending).toEqual({ kind: 'battle_defense', forPlayerId: 'wiz' });
    const before = g.log.length;
    const after = game.applyMove(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'decoy' } }).newState;
    const entry = after.gameState.log.slice(before).find((e) => /Decoy/.test(e.headline ?? ''))!;
    expect(entry.notify).toEqual(['rob']);
    expect(entry.subject).toBe('rob');
    expect(entry.subject_headline).toMatch(/avoided your .* attack/);
  });

  it('a broken treaty tells the partner', () => {
    const { s } = treatyBreakWindow([{ type: 'peace', partners: ['wiz', 'rob'] }]);
    const before = s.gameState.log.length;
    const after = game.applyMove(s, 'wiz', { type: 'break_treaty', treaty_type: 'Peace', partner: 'rob' }).newState;
    const entry = after.gameState.log.slice(before).find((e) => e.category === 'treaty')!;
    expect(entry.notify).toEqual(['rob']);
    expect(entry.subject_headline).toMatch(/broke Peace with you/);
  });
});
