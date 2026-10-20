// Designer rulings #101–#106 (2026-09-26):
//   #101 Haste (wizard, Library of Enchantment, 1 ether + 1 ore): each committed
//        Surf makes two; unspent production is banked and pays later purchases
//        this round in full or in part; the bank empties at upkeep.
//   #102 Collector Optimizations (robot, Home, 1 oil + 2 ore): two of the
//        researcher's collectors may share a location; a partner's may join
//        only if the partner has it too; never more than two.
//   #103 Core Integration (robot, Home, 1 oil + 2 water): the Core bought with
//        a platform is free; a bare Core still costs 1 water.
//   #104 Motherboard / Technomancer Greymore give +3 tech each (was +1); +4 since #110; +5 since #113.
//   #105 Envoy Sable Marrow in a battle stops spy kills on her side.
//   #106 Dowser Wren Calloway grants a free collector when placed (a Surf for
//        a wizard; a robot picks the type, Core included); her overlay is gone.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { TECH_TARGET, WIZARD_RESEARCH, ROBOT_RESEARCH } from '../data/catalogs.js';
import { unitById } from '../resolvers.js';
import {
  bankOf, dowserCollectorOptions, findPayment, overlayResourceOf, purchaseCostOf, runUpkeep, stackAllowed, techTotal,
} from '../engine.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { base2p, keepCores, placeUnit } from './pendingFixtures.js';
import { coreSupplyFor, economicCollectorsNeeded, robotCollectorCaps } from '../economicScale.js';

function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return game.applyMove(s, playerId, move);
}

function player(s: SessionState<NGGState>, id: string) {
  return s.gameState.players.find((p) => p.playerId === id)!;
}

/** wiz holds a resolving Build card, base moved to (0,4) whose neighbours
 *  hold water (-1,3)/(1,3)/(1,5), wood (-1,5), ore (0,2), oil (0,6). */
function wizardBuilding(): SessionState<NGGState> {
  let s = base2p();
  const g = s.gameState;
  g.bases.find((b) => b.ownerId === 'wiz')!.coord = '0,4';
  g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '0,4';
  g.units.filter((u) => u.ownerId === 'wiz').forEach((u) => { u.coord = '0,4'; });
  expect(g.planningOrder[0]).toBe('rob');
  s = apply(s, 'rob', { type: 'plan_action', card: 'research' }).newState;
  s = apply(s, 'wiz', { type: 'plan_action', card: 'build' }).newState;
  s = apply(s, 'rob', { type: 'plan_action', card: 'pass' }).newState;
  s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' }).newState;
  expect(s.gameState.activeAction?.cardKind).toBe('build');
  expect(s.gameState.activeAction?.ownerId).toBe('wiz');
  return s;
}

describe('#101 Haste', () => {
  it('is a wizard research at the Library of Enchantment for 2 ore + 1 ether (ruling #126; 1 ether + 1 ore under #101)', () => {
    const h = WIZARD_RESEARCH.find((r) => r.id === 'haste')!;
    expect(h.prerequisite).toBe('Library of Enchantment');
    expect(h.cost).toEqual({ ore: 2, ether: 1 });
  });

  it('one Surf on water pays a 2-water Surf', () => {
    // Without Haste one Surf makes one water and the buy is refused.
    const noHaste = wizardBuilding();
    expect(() => apply(noHaste, 'wiz', { type: 'build', item: 'Surf', payment: [{ collectorId: 'surf-1', coord: '-1,3' }] })).toThrow(/costs|produces/);
    // With Haste it lands, and an exact payment banks nothing.
    let s = wizardBuilding();
    player(s, 'wiz').research.push('haste');
    s = apply(s, 'wiz', { type: 'build', item: 'Surf', payment: [{ collectorId: 'surf-1', coord: '-1,3' }] }).newState;
    expect(Object.keys(player(s, 'wiz').collectorsAvailable)).toContain('surf-4');
    expect(bankOf(player(s, 'wiz'))).toEqual({});
  });

  it('an overpaid purchase banks the surplus; the bank pays later purchases this round and empties at upkeep', () => {
    let s = wizardBuilding();
    player(s, 'wiz').research.push('haste');
    // 2 Surfs on wood + ore make 2 wood + 2 ore for an Evoker (2 wood + 1 ore) — 1 ore banked.
    s = apply(s, 'wiz', { type: 'build', item: 'Evoker', payment: [{ collectorId: 'surf-1', coord: '-1,5' }, { collectorId: 'surf-2', coord: '0,2' }] }).newState;
    expect(bankOf(player(s, 'wiz'))).toEqual({ ore: 1 });
    // The bank pays a later purchase this round with no collector placed;
    // the payment finder knows it too.
    const p = player(s, 'wiz');
    p.bank = { water: 2 };
    expect(findPayment(s.gameState, p, { water: 2 })).toEqual([]);
    // The bank is a Haste thing: without the research it is ignored.
    const plain = { ...p, research: p.research.filter((r) => r !== 'haste') };
    expect(bankOf(plain)).toEqual({});
    // It empties at upkeep.
    runUpkeep(s.gameState);
    expect(player(s, 'wiz').bank).toEqual({});
  });

  it('a bank may pay a purchase with no collectors placed, but only with Haste', () => {
    const s = wizardBuilding();
    const p = player(s, 'wiz');
    p.bank = { water: 2 };
    expect(() => apply(s, 'wiz', { type: 'build', item: 'Surf', payment: [] })).toThrow(/complete collector payment/);
    p.research.push('haste');
    const after = apply(s, 'wiz', { type: 'build', item: 'Surf', payment: [] }).newState;
    expect(after.gameState.placements).toHaveLength(0);
    expect(Object.keys(player(after, 'wiz').collectorsAvailable)).toContain('surf-4');
    expect(bankOf(player(after, 'wiz'))).toEqual({});
  });

  it('the reach question and the view count Haste: two per Surf, and the bank pays first', () => {
    const s = wizardBuilding();
    const p = player(s, 'wiz');
    p.research.push('haste');
    const surf = { type: 'build', item: 'Surf' };
    const reach = (prior: Array<{ collectorId: string; coord: string }>) =>
      game.queryChoice!(s, 'wiz', 'collector_reach', { prior, purchase: surf }) as { produced: Record<string, number>; covers: boolean; bank: Record<string, number> };
    // One Surf on water makes two: a 2-water Surf is covered.
    const one = reach([{ collectorId: 'surf-1', coord: '-1,3' }]);
    expect(one.produced).toEqual({ water: 2 });
    expect(one.covers).toBe(true);
    // With the bank holding two water, no placement at all covers it.
    expect(reach([]).covers).toBe(false);
    p.bank = { water: 2 };
    const none = reach([]);
    expect(none.bank).toEqual({ water: 2 });
    expect(none.covers).toBe(true);
    // The view shows the bank and the technology target the victory check uses.
    const view = game.getPlayerView!(s, 'wiz') as { players: Array<{ player_id: string; bank: Record<string, number>; tech_progress: { target: number } }> };
    const me = view.players.find((x) => x.player_id === 'wiz')!;
    expect(me.bank).toEqual({ water: 2 });
    expect(me.tech_progress.target).toBe(TECH_TARGET.wizard);
    expect(view.players.find((x) => x.player_id === 'rob')!.tech_progress.target).toBe(TECH_TARGET.robot);
  });
});

describe('#102 Collector Optimizations', () => {
  it('is a robot research at Home for 1 oil + 2 ore; a location holds one collector unless the placer has it, two at most', () => {
    const r = ROBOT_RESEARCH.find((x) => x.id === 'collector-optimizations')!;
    expect(r.prerequisite).toBe('Home');
    expect(r.cost).toEqual({ oil: 1, ore: 2 });

    const s = base2p();
    const g = s.gameState;
    const rob = player(s, 'rob');
    const wiz = player(s, 'wiz');
    const own = { collectorId: 'water-collector-1', ownerId: 'rob', coord: '-2,8', resource: 'water' as const, authorizedBy: null };
    g.placements.push(own);
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(false);
    rob.research.push('collector-optimizations');
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(true);
    // Counting this payment's earlier placements: a second there fills it.
    expect(stackAllowed(g, rob, '-2,8', [{ collectorId: 'water-collector-2', coord: '-2,8' }])).toBe(false);
    g.placements.push({ ...own, collectorId: 'water-collector-2' });
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(false);

    // A partner's collector: the partner needs the research AND an access treaty.
    g.placements.length = 0;
    g.placements.push({ collectorId: 'surf-1', ownerId: 'wiz', coord: '-2,8', resource: 'water', authorizedBy: null });
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(false);
    g.treaties.push({ type: 'shared-resources', partners: ['wiz', 'rob'] });
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(false);
    wiz.research.push('collector-optimizations');
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(true);
    // The wizard, who has the research, may add its own second there too.
    expect(stackAllowed(g, wiz, '-2,8', [])).toBe(true);
  });

  it('the Economic spend still wants distinct tiles', () => {
    const s = base2p();
    const g = s.gameState;
    const rob = player(s, 'rob');
    rob.research.push('collector-optimizations');
    g.placements.push({ collectorId: 'water-collector-1', ownerId: 'rob', coord: '-2,8', resource: 'water', authorizedBy: null });
    // A spend-style (distinct tiles) payment never uses the half-full tile.
    const spend = findPayment(g, rob, { water: 1 }, [], 3000, 0, true);
    if (spend) expect(spend.some((x) => x.coord === '-2,8')).toBe(false);
    // A normal payment may stack on it when nothing else is in reach.
    expect(stackAllowed(g, rob, '-2,8', [])).toBe(true);
  });
});

describe('#103 Core Integration', () => {
  it('is a robot research at Home for 1 oil + 2 water; the paired Core is free, a bare Core is not', () => {
    const r = ROBOT_RESEARCH.find((x) => x.id === 'core-integration')!;
    expect(r.prerequisite).toBe('Home');
    expect(r.cost).toEqual({ oil: 1, water: 2 });
    const s = base2p();
    const rob = player(s, 'rob');
    const paired = { type: 'build', item: 'Spinner Platform', core_pairing: true };
    const before = purchaseCostOf(rob, paired).cost;
    expect(before).toEqual({ wood: 1, water: 1 });
    rob.research.push('core-integration');
    expect(purchaseCostOf(rob, paired).cost).toEqual({ wood: 1 });
    expect(purchaseCostOf(rob, { type: 'build', item: 'Core' }).cost).toEqual(unitById('core')!.cost);
  });

  it('the Build menu, its move text and the view price the paired Core the same way', () => {
    let s = base2p();
    let planned = false;
    for (let guard = 0; s.gameState.phase === 'planning' && guard < 12; guard++) {
      const head = s.gameState.planningOrder[0]!;
      const card = head === 'rob' && !planned ? 'build' as const : 'pass' as const;
      if (card === 'build') planned = true;
      s = apply(s, head, { type: 'plan_action', card }).newState;
    }
    expect(s.gameState.activeAction?.ownerId).toBe('rob');
    const paired = () => game.getLegalMoves(s, 'rob').filter((m) => (m.move as { core_pairing?: boolean }).core_pairing && (m.move as { item: string }).item === 'Water collector');
    const pairedCost = () => ((game.getPlayerView!(s, 'rob') as { players: Array<{ player_id: string; paired_core_cost: Record<string, number> | null }> }).players.find((x) => x.player_id === 'rob')!.paired_core_cost);
    const before = paired();
    expect(before.length).toBeGreaterThan(0);
    expect(before[0]!.description).toContain('+1 water');
    expect(pairedCost()).toEqual(unitById('core')!.cost);
    player(s, 'rob').research.push('core-integration');
    const after = paired();
    expect(after[0]!.description).toContain('free with Core Integration');
    // The suggested payment covers the platform alone: one collector fewer.
    expect((after[0]!.move as { payment: unknown[] }).payment.length).toBe((before[0]!.move as { payment: unknown[] }).payment.length - 1);
    expect(pairedCost()).toEqual({});
  });
});

describe('#104 / #110 / #113 Motherboard and Greymore give +5', () => {
  it('each live, owned, placed bonus hero adds five', () => {
    const s = base2p();
    const g = s.gameState;
    const wiz = player(s, 'wiz');
    const before = techTotal(g, wiz);
    g.heroPool = g.heroPool.filter((h) => h !== 'motherboard' && h !== 'greymore');
    g.heroes.push({ id: 'motherboard', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    expect(techTotal(g, wiz)).toBe(before + 5);
    g.heroes.push({ id: 'greymore', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    expect(techTotal(g, wiz)).toBe(before + 10);
    g.heroes.find((h) => h.id === 'greymore')!.dead = true;
    expect(techTotal(g, wiz)).toBe(before + 5);
    // The view's bonus is the same five (#113).
    const view = game.getPlayerView!(s, 'wiz') as { players: Array<{ player_id: string; tech_progress: { bonus_points_live: number; total: number } }> };
    const tp = view.players.find((x) => x.player_id === 'wiz')!.tech_progress;
    expect(tp.bonus_points_live).toBe(5);
    expect(tp.total).toBe(before + 5);
  });
});

// ---- #105: the Wall-stops-spies fixture with Envoy in place of the Wall.
function driveMoveBattle(s: SessionState<NGGState>, mover: string): SessionState<NGGState> {
  const placed = new Set<string>();
  let guard = 0;
  while (s.gameState.phase === 'planning' && guard++ < 12) {
    const head = s.gameState.planningOrder[0]!;
    const card = head === mover && !placed.has(head) ? 'move_battle' as const : 'pass' as const;
    if (card === 'move_battle') placed.add(head);
    s = apply(s, head, { type: 'plan_action', card }).newState;
  }
  let g0 = 0;
  while (g0++ < 6 && (s.gameState.activeAction?.ownerId !== mover || s.gameState.activeAction?.cardKind !== 'move_battle')) {
    s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).newState;
  }
  return s;
}

function battleWithSpy(envoy: boolean): SessionState<NGGState> {
  let s = base2p();
  const g = s.gameState;
  g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
  placeUnit(g, 'rob', '-2,8', 'spinner');
  if (envoy) {
    g.heroPool = g.heroPool.filter((h) => h !== 'envoy');
    g.heroes.push({ id: 'envoy', ownerId: 'rob', coord: '-2,8', isLeader: false, dead: false });
  }
  player(s, 'wiz').spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
  player(s, 'wiz').research.push('invisible');
  s = driveMoveBattle(s, 'wiz');
  s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).newState;
  let guard = 0;
  while (s.gameState.pending?.kind === 'battle_commit' && guard++ < 10) {
    s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).newState;
  }
  expect(s.gameState.battle).not.toBeNull();
  guard = 0;
  while (s.gameState.battle && s.gameState.battle.phase === 'activations' && guard++ < 12) {
    const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
    if (cur === undefined) break;
    if (s.gameState.pending?.kind === 'battle_defense') {
      s = apply(s, s.gameState.pending.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).newState;
      continue;
    }
    if (cur === 'warden') break;
    s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
  }
  expect(s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]).toBe('warden');
  return s;
}

describe('#105 Envoy Sable Marrow stops spies', () => {
  it('with Envoy on the robot side, Invisible is neither offered nor accepted', () => {
    const s = battleWithSpy(true);
    const offered = game.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'invisible');
    expect(offered).toHaveLength(0);
    expect(() => apply(s, 'wiz', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: 'kestrel' } })).toThrow(/Envoy/);
    expect(player(s, 'wiz').spyAssignments.some((x) => x.active && x.heroId === 'warden')).toBe(true);
  });

  it('without Envoy the same spy kill lands', () => {
    const s = battleWithSpy(false);
    const after = apply(s, 'wiz', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: 'kestrel' } }).newState;
    expect(after.gameState.phase).toBe('game_over');
    expect(after.gameState.result?.winners).toEqual(['wiz']);
  });
});

describe('#106 / #117 Dowser Wren Calloway grants four free collectors', () => {
  function setupWith(wizLeader: string, robLeader: string): SessionState<NGGState> {
    const players: PlayerConfig[] = [{ player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' }];
    let s = game.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
    s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
    s = apply(s, 'wiz', { type: 'choose_leader', hero: wizLeader }).newState;
    s = apply(s, 'rob', { type: 'choose_leader', hero: robLeader }).newState;
    return s;
  }

  it('a robot Leader keeps all four after the starting collectors are added (oil, ore, ore, wood)', () => {
    let s = setupWith('Warden Hesper Quill', 'Dowser Wren Calloway');
    for (const pick of ['Oil collector', 'Ore collector', 'Ore collector', 'Wood collector']) {
      s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: pick }).newState;
    }
    for (let i = 0; i < 4 && s.gameState.pending?.kind === 'choose_starting_location'; i++) {
      const who = s.gameState.pending.forPlayerId;
      const m = game.getLegalMoves(s, who).find((x) => x.move.type === 'choose_starting_location')!;
      s = apply(s, who, m.move).newState;
    }
    expect(s.gameState.bases.some((b) => b.ownerId === 'rob')).toBe(true);
    const owned = Object.keys(player(s, 'rob').collectorsAvailable).filter((k) => player(s, 'rob').collectorsAvailable[k]).sort();
    expect(owned).toEqual([
      'oil-collector-1', 'ore-collector-1', 'ore-collector-2',
      'water-collector-1', 'water-collector-2', 'wood-collector-1', 'wood-collector-2', 'wood-collector-3',
    ]);
  });

  it('her overlay is gone', () => {
    expect(overlayResourceOf('wren')).toBeNull();
    expect(overlayResourceOf('ida')).not.toBeNull();
  });

  it('a robot placing her picks each of four collectors, each with a Core from the supply, and setup carries on', () => {
    // A Leader's benefit fires at the draft (grantLeader), before locations.
    let s = setupWith('Warden Hesper Quill', 'Dowser Wren Calloway');
    expect(s.gameState.pending).toEqual({ kind: 'dowser_collector', forPlayerId: 'rob', remaining: 4 });
    expect(game.describeNextStep!(s).instruction).toMatch(/4 left to pick/);
    // The view says how many picks are left, and every unit's limit on this map.
    const view = () => game.getPlayerView!(s, 'rob') as { pending: { context?: { remaining?: number } }; players: Array<{ player_id: string; unit_limits: Record<string, number> }> };
    expect(view().pending.context?.remaining).toBe(4);
    const limits = view().players.find((x) => x.player_id === 'rob')!.unit_limits;
    const caps = robotCollectorCaps(s.gameState);
    expect(limits['Water collector']).toBe(caps.water);
    expect(limits['Oil collector']).toBe(caps.oil);
    expect(limits['Core']).toBe(coreSupplyFor(s.gameState));
    expect(limits['Spinner Platform']).toBe(unitById('spinner')!.maxPerPlayer);
    expect(view().players.find((x) => x.player_id === 'wiz')!.unit_limits['Surf']).toBe(economicCollectorsNeeded(s.gameState));
    expect(game.describeNextStep!(s).active_player_id).toBe('rob');
    const legal = game.getLegalMoves(s, 'rob');
    const names = legal.map((m) => (m.move as { collector?: string }).collector);
    expect(legal.every((m) => m.move.type === 'choose_dowser_collector')).toBe(true);
    expect(names).toContain('Ore collector');
    expect(names).toEqual(dowserCollectorOptions(s.gameState, player(s, 'rob')).map((u) => u.name));
    const supplyBefore = player(s, 'rob').coresInSupply;
    expect(() => apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'Surf' })).toThrow(/Choose one of/);
    s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'ore collector' }).newState;
    const rob = player(s, 'rob');
    expect(rob.collectorsAvailable['ore-collector-1']).toBe(1);
    expect(rob.coresInSupply).toBe(supplyBefore - 1);
    expect(rob.acquiredTypes).toContain('ore-collector');
    // Three more picks, one at a time — the owner chooses each type.
    expect(s.gameState.pending).toEqual({ kind: 'dowser_collector', forPlayerId: 'rob', remaining: 3 });
    expect(view().pending.context?.remaining).toBe(3);
    s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'Oil collector' }).newState;
    s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'Oil collector' }).newState;
    expect(s.gameState.pending).toEqual({ kind: 'dowser_collector', forPlayerId: 'rob', remaining: 1 });
    s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'Ether collector' }).newState;
    const after = player(s, 'rob');
    expect(after.collectorsAvailable['oil-collector-1']).toBe(1);
    expect(after.collectorsAvailable['oil-collector-2']).toBe(1);
    expect(after.collectorsAvailable['ether-collector-1']).toBe(1);
    expect(after.coresInSupply).toBe(supplyBefore - 4);
    expect(s.gameState.pending?.kind).toBe('choose_starting_location');
    // Setup resumes with the location picks.
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
    s = keepCores(s);
    expect(s.gameState.phase).toBe('planning');
  });

  it('a robot grant stops early when no Core is left to power another collector', () => {
    let s = setupWith('Warden Hesper Quill', 'Dowser Wren Calloway');
    const rob = player(s, 'rob');
    rob.coresInSupply = 1; rob.coresInReserve = 0; // test-side: one Core to spare
    s = apply(s, 'rob', { type: 'choose_dowser_collector', collector: 'Ore collector' }).newState;
    expect(s.gameState.pending?.kind).toBe('choose_starting_location');
  });

  it('a wizard placing her simply gets two more Surfs (ruling #124; four under #117)', () => {
    let s = setupWith('Dowser Wren Calloway', 'Kestrel Nine');
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
    expect(s.gameState.pending?.kind).not.toBe('dowser_collector');
    const surfs = Object.keys(player(s, 'wiz').collectorsAvailable).filter((k) => k.startsWith('surf-'));
    expect(surfs).toHaveLength(5); // three starting Surfs (ruling #100) + Dowser's two (#124)
  });
});
