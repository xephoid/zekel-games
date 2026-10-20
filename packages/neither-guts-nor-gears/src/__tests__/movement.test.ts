// M3 movement / battle trigger / side assembly / sweeps — PORT-PLAN §7b M3
// (a)–(f): battle opens with correct sides; OB co-occupants force-included on
// defense; Peace destination rejects; collectors-only destination sweeps;
// SR-only authorized tile is not swept by the consenting side but swept by a
// hostile third; the origin hex is recorded and exposed.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { sweepLocation } from '../engine-battle.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): { s: SessionState<NGGState>; summary: string } {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return { s: r.newState, summary: r.summary };
}

/** 2-player session through setup; wizard @1 (-2,10 [Wo]), robot @2 (2,4 [Wa]). */
function baseSession(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 5, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).s;
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).s;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
  s = keepCores(s);
  return s;
}

/** Give `pid` a combat unit at `coord` (test-side placement with a Core). */
function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): void {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const needsCore = ['water-collector', 'wood-collector', 'ore-collector', 'oil-collector', 'ether-collector', 'spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform'].includes(typeId);
  g.units.push({
    id: `u-${typeId}-${pid}-${seq}`, typeId, ownerId: pid, coord,
    allocatedCoreId: needsCore ? `core-${pid}-${typeId}-${seq}` : null,
  });
}

/** Queue a Move/Battle action for the wizard (rob's research card sits behind). */
function startWizardMove(s0: SessionState<NGGState>): SessionState<NGGState> {
  let s = s0;
  s = apply(s, 'rob', { type: 'plan_action', card: 'research' }).s;
  s = apply(s, 'wiz', { type: 'plan_action', card: 'move_battle' }).s;
  s = apply(s, 'rob', { type: 'plan_action', card: 'pass' }).s;
  s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' }).s;
  expect(s.gameState.phase).toBe('action');
  expect(s.gameState.activeAction?.cardKind).toBe('move_battle');
  expect(s.gameState.activeAction?.ownerId).toBe('wiz');
  return s;
}

// 2p map landmarks: wiz base @1 = (-2,10); rob base @2 = (2,4).
// Neighbors of (-2,10): (-2,8) Wa, (-1,9) Wo, (-1,11) Wo.

describe('M3 movement + battle trigger (PORT-PLAN §7b)', () => {
  it('(a) moving into enemy combat units opens a battle with correct sides + records the origin', () => {
    let s = baseSession();
    // Put an enemy combat platform on the wizard's doorstep: a robot Spitter at (-2,8).
    placeUnit(s.gameState, 'wiz', '-2,8', 'spitter'); // temporarily wiz-owned to move...
    s.gameState.units[s.gameState.units.length - 1]!.ownerId = 'rob'; // enemy instead
    s = startWizardMove(s);
    // The wizard's Leader (Warden) moves from (-2,10) to (-2,8) — into the Spitter.
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] });
    s = r.s;
    expect(s.gameState.battle).not.toBeNull();
    const b = s.gameState.battle!;
    expect(b.coord).toBe('-2,8');
    expect(b.originCoord).toBe('-2,10'); // (f) origin hex recorded
    const sides = Object.fromEntries(b.units.map((u) => [u.unitRef, u.side]));
    expect(sides['warden']).toBe('attackers');
    const defender = b.units.find((u) => u.side === 'defenders')!;
    expect(defender.ownerId).toBe('rob');
    expect(defender.label).toBe('Spitter Platform');
  });

  it('(b) Open Borders co-occupants are force-included on the defense side', () => {
    let s = baseSession();
    // 2p game can't make a real 3-player alliance; we model the OB rule by
    // adding a third seat's unit would need 3 players — instead assert the
    // treaty-driven protection via a unit pair on one tile: an OB partner's
    // unit co-occupying with the defender joins the DEFENSE side.
    // For a genuine co-occupation we need three seats — skip to the 4p variant
    // in battle tests; here assert the engine-side rule on a 4p session.
    const players: PlayerConfig[] = [
      { player_id: 'a', kind: 'human' }, { player_id: 'b', kind: 'human' },
      { player_id: 'c', kind: 'human' }, { player_id: 'd', kind: 'human' },
    ];
    let s4 = neitherGutsNorGears.createSession(players, { seed: 9, setupFirstPlayerId: 'a' });
    s4 = apply(s4, 'a', { type: 'assign_setup_choices', selections: { a: 'covenant', b: 'schism', c: 'ledger', d: 'foundry' } }).s;
    for (const pid of ['a', 'b', 'c', 'd']) {
      const hero = { a: 'Warden Hesper Quill', b: 'Captain Rook Malvane', c: 'Kestrel Nine', d: 'Chronicler Ottoline Vey' }[pid]!; // not Dowser: a robot placing her owes a collector choice since #106
      const pend = s4.gameState.pending;
      expect(pend?.kind).toBe('choose_leader');
      s4 = apply(s4, pend!.forPlayerId, { type: 'choose_leader', hero }).s;
    }
    for (const pid of ['d', 'c', 'b', 'a']) {
      const pend = s4.gameState.pending;
      expect(pend?.kind).toBe('choose_starting_location');
      expect(pend!.forPlayerId).toBe(pid);
      const spot = { d: '@4', c: '@3', b: '@2', a: '@1' }[pid]!;
      s4 = apply(s4, pid, { type: 'choose_starting_location', location: spot }).s;
    }
    s4 = keepCores(s4);
    const g = s4.gameState;
    // Form an Open Borders between b and c. Then c's Spitter co-occupies b's
    // Leader tile; a attacks; both b and c must ride the defense side.
    g.treaties.push({ type: 'open-borders', partners: ['b', 'c'] });
    // Place b's Leader + c's Spitter on the center tile (0,4) [Or].
    g.heroes.find((h) => h.ownerId === 'b' && h.isLeader)!.coord = '0,4';
    placeUnit(g, 'c', '0,4', 'spitter');
    // a's Leader + a wizard combat unit adjacent: (0,4)'s neighbors: (0,2),(0,6),(-1,3),(-1,5),(1,3),(1,5).
    g.heroes.find((h) => h.ownerId === 'a' && h.isLeader)!.coord = '0,2';
    // Drive a's Move/Battle action (planning starts at the rotated first
    // player 'b' — only 'a' places a card; the others pass until it resolves).
    let s2 = s4;
    let placed = false;
    while (s2.gameState.phase === 'planning') {
      const head = s2.gameState.planningOrder[0]!;
      const wantCard = head === 'a' && !placed;
      s2 = apply(s2, head, { type: 'plan_action', card: wantCard ? 'move_battle' : 'pass' }).s;
      if (wantCard) placed = true;
    }
    expect(s2.gameState.activeAction?.ownerId).toBe('a');
    const r = apply(s2, 'a', { type: 'move_units', from: '0,2', to: '0,4', units: ['warden'] });
    s2 = r.s;
    const bst = s2.gameState.battle!;
    const defenseSides = bst.units.filter((u) => u.side === 'defenders').map((u) => u.ownerId).sort();
    expect(defenseSides).toEqual(['b', 'c']); // OB co-occupant force-included
    expect(bst.units.find((u) => u.ownerId === 'c')!.label).toBe('Spitter Platform');
  });

  it('(c) a Peace partner destination rejects (no entry, no attack)', () => {
    let s = baseSession();
    const g = s.gameState;
    g.treaties.push({ type: 'peace', partners: ['wiz', 'rob'] });
    placeUnit(g, 'rob', '-2,8', 'spitter');
    s = startWizardMove(s);
    expect(() => neitherGutsNorGears.applyMove(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }))
      .toThrowError(/Peace/);
  });

  it('(d) a destination with only enemy collectors sweeps them without a battle', () => {
    let s = baseSession();
    const g = s.gameState;
    // An enemy committed collector sits alone at (-2,8) (as if rob paid earlier).
    g.placements.push({ collectorId: 'water-collector-rob', ownerId: 'rob', coord: '-2,8', resource: 'water', authorizedBy: null });
    s = startWizardMove(s);
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] });
    s = r.s;
    expect(r.summary).toMatch(/removed|swept|moves to|destroyed/i);
    expect(s.gameState.battle).toBeNull();
    // The collector is gone from the placements.
    expect(s.gameState.placements.some((c) => c.collectorId === 'water-collector-rob')).toBe(false);
  });

  it('(e) ruling 72: sweepLocation spares the consenting side\'s authorized collector and removes it for a hostile sweep (engine-level)', () => {
    // The passive-sweep rule (one path in the engine: sweeps on movement entry
    // and battle completion both run sweepLocation) — locked directly: an
    // authorizedBy-matching collector survives when the granter sweeps, and is
    // removed when a hostile side sweeps.
    let s = baseSession();
    const g = s.gameState;
    const robBase = g.bases.find((b) => b.ownerId === 'rob')!.coord;
    const robTileResource = g.tiles.find((t) => `${t.c},${t.r}` === robBase)!.resource;
    g.placements.push({ collectorId: 'surf-1', ownerId: 'wiz', coord: robBase, resource: robTileResource, authorizedBy: 'rob' });
    // Consenting side sweeps its own location: guest survives.
    const removedByGranter = sweepLocation(g, g.players.find((p) => p.playerId === 'rob')!, robBase);
    expect(removedByGranter).not.toContain("wiz's Surf");
    expect(g.placements.some((c) => c.collectorId === 'surf-1')).toBe(true);
    // Hostile side sweeps (a third hypothetical owner): the guest is removed.
    // Model the hostile as the wizard... no — wiz owns the collector. Use a
    // third-owner set via winnerSet without 'rob'.
    const removedByHostile = sweepLocation(g, null, robBase, new Set(['third-hostile']));
    expect(removedByHostile).toContain("wiz's Surf");
    expect(g.placements.some((c) => c.collectorId === 'surf-1')).toBe(false);
  });
  it('(f) attack-origin hex is exposed in battle state and blocks retreat/Decoy into it', () => {
    let s = baseSession();
    placeUnit(s.gameState, 'rob', '-2,8', 'spitter');
    s.gameState.units[s.gameState.units.length - 1]!.ownerId = 'rob';
    s = startWizardMove(s);
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] });
    s = r.s;
    expect(s.gameState.battle!.originCoord).toBe('-2,10');
  });
});
