// Regression locks for the independent rules recheck at 46802be
// (output/neither-guts-nor-gears/RULES-RECHECK-46802be.md), cases #01–#48.
// Each test builds the case's situation and asserts what the RULES say should
// happen (the recheck's own scripts asserted the old wrong behaviour). The
// four designer rulings of 2026-09-24 are locked too (#40, #43, #47, Metal
// Platforms).

import { describe, it, expect } from 'vitest';
import * as E from '../engine.js';
import * as B from '../engine-battle.js';
import { getLegalMoves, collectorReach } from '../legalMoves.js';
import { getPlayerView, getPublicView } from '../views.js';
import { treatyBreakGate } from '../gates.js';
import { chooseMove } from '../ai.js';
import { ROBOT_BUILDINGS, ROBOT_RESEARCH, ROBOT_UNITS, WIZARD_BUILDINGS, WIZARD_RESEARCH, WIZARD_UNITS, buildBattleDeck, researchForSpecies } from '../data/catalogs.js';
import { tileLabel } from '../data/maps.js';
import { researchById, resolveBattleCard } from '../resolvers.js';
import type { NGGMove, NGGState } from '../types.js';
import { nggMoveGates } from '../moveGates.js';
import { checkGateConsistency, enrichGateRejection, unavailableMoves } from '@zekel/game-kit';

// ---------------------------------------------------------------------------
// Fixtures (the 2-player map: a starts at @1 = -2,10 (wood), b at @2 = 2,4)
// ---------------------------------------------------------------------------

type S = NGGState;
const apply = (s: S, pid: string, move: NGGMove): S => E.applyMove(s, pid, move).newState;

function keepCores(s: S): S {
  while (s.pending?.kind === 'upkeep_reallocate_cores') {
    s = apply(s, s.pending.forPlayerId, { type: 'reallocate_cores', allocations: {} });
  }
  return s;
}

function fresh(factions = ['covenant', 'schism'], leaders = ['marshal', 'warden'], settle = true): S {
  const ids = factions.map((_, i) => String.fromCharCode(97 + i));
  let s = E.createInitialState(ids.map((player_id) => ({ player_id, kind: 'human' as const })), { seed: 9, setupFirstPlayerId: 'a' });
  s = apply(s, 'a', { type: 'assign_setup_choices', selections: Object.fromEntries(ids.map((id, i) => [id, factions[i]!])) });
  while (s.phase === 'setup_leaders') {
    const p = s.pending!;
    if (p.kind === 'choose_leader') s = apply(s, p.forPlayerId, { type: 'choose_leader', hero: leaders[ids.indexOf(p.forPlayerId)]! });
    else if (p.kind === 'smyth_reward') s = apply(s, p.forPlayerId, { type: 'research', kind: 'tech', tech: E.speciesOf(E.byId(s, p.forPlayerId)) === 'robot' ? 'Metal Platforms' : 'Dehance', payment: [] });
    else if (p.kind === 'report_draw') s = apply(s, p.forPlayerId, { type: 'report_draw', card: 'Retreat' });
    else throw new Error(`unexpected setup pending ${p.kind}`);
  }
  while (s.phase === 'setup_locations') {
    const p = s.pending!;
    s = apply(s, p.forPlayerId, { type: 'choose_starting_location', location: `@${ids.indexOf(p.forPlayerId) + 1}` });
  }
  return settle ? keepCores(s) : s;
}

/** `owner`'s action card of `kind` is resolving; b's research card waits under it. */
function act(s: S, owner = 'a', kind: 'build' | 'research' | 'move_battle' = 'build'): S {
  s.pending = null;
  s.phase = 'action';
  s.activeAction = { ownerId: owner, cardKind: kind, slotId: `${kind}:base` };
  s.actionStack = [{ ownerId: 'b', cardKind: 'research', slotId: 'research:base' }, s.activeAction];
  s.activePlayerId = owner;
  return s;
}

function addHero(s: S, id: string, ownerId: string, coord: string | null) {
  s.heroPool = s.heroPool.filter((x) => x !== id);
  const h = { id, ownerId, coord, isLeader: false, dead: false };
  s.heroes.push(h);
  return h;
}

function addUnit(s: S, typeId: string, ownerId: string, coord: string, core = false) {
  const seq = s.units.filter((u) => u.typeId === typeId && u.ownerId === ownerId).length + 1;
  const u = { id: `u-${typeId}-${ownerId}-${seq}`, typeId, ownerId, coord, allocatedCoreId: core ? `core-${ownerId}-${typeId}-${seq}` : null };
  s.units.push(u);
  return u;
}

function cards(s: S, owner: string, ids: string[]): void {
  for (const id of ids) {
    s.battleDeck = s.battleDeck.filter((x) => x !== id);
    E.byId(s, owner).hand.push(id);
    s.cardOwners[id] = owner;
  }
}

/** a's pieces `attackIds` have moved into `at` from `origin`; the battle opens. */
function battle(s: S, attackIds: string[], at = '0,6', origin = '-1,5'): S {
  act(s, 'a', 'move_battle');
  for (const id of attackIds) {
    const u = s.units.find((x) => x.id === id);
    if (u) u.coord = at; else s.heroes.find((h) => h.id === id)!.coord = at;
  }
  const defenders = [...new Set([...s.units, ...s.heroes.filter((h) => !h.dead)]
    .filter((x) => x.coord === at && x.ownerId !== 'a').map((x) => x.ownerId))];
  B.startBattle(s, E.byId(s, 'a'), origin, at,
    attackIds.map((id) => ({ kind: s.units.some((u) => u.id === id) ? 'unit' as const : 'hero' as const, id })), defenders);
  return s;
}

function noCards(s: S): S {
  while (s.pending?.kind === 'battle_commit') s = apply(s, s.pending.forPlayerId, { type: 'commit_battle_card', card: null });
  return s;
}

function pay(coords: string[], start = 1) { return coords.map((coord, i) => ({ collectorId: `surf-${start + i}`, coord })); }
function surfs(s: S, n: number) { E.byId(s, 'a').collectorsAvailable = Object.fromEntries(Array.from({ length: n }, (_, i) => [`surf-${i + 1}`, 1])); }

// ---------------------------------------------------------------------------

describe('rules recheck 46802be — collectors and payments', () => {
  it('#01 one collector pays once: a repeated collector id is refused, and the Economic spend needs twelve different collectors at two players (ruling #89)', () => {
    const s = act(fresh());
    expect(() => apply(s, 'a', { type: 'build', item: 'Subject', payment: [{ collectorId: 'surf-1', coord: '-2,8' }, { collectorId: 'surf-1', coord: '-1,9' }] }))
      .toThrowError(/named twice/);
    const coords = ['-2,8', '-1,9', '0,10', '0,8', '-1,7', '-2,6', '-1,5', '-1,3', '0,4', '0,2', '-1,11'];
    expect(() => apply(s, 'a', { type: 'economic_victory_spend', payment: coords.map((coord) => ({ collectorId: 'surf-1', coord })) }))
      .toThrowError(/12 different collectors/);
  });

  it('#02 consent comes only from the owner\'s answer — a buyer-supplied access list is ignored', () => {
    let s = act(fresh());
    s.bases.find((b) => b.ownerId === 'b')!.coord = '-2,8';
    s = apply(s, 'a', { type: 'build', item: 'Subject', payment: pay(['-2,8', '-1,9']), access: [{ ownerId: 'b', collectorId: 'surf-1', coord: '-2,8' }] } as never);
    expect(E.byId(s, 'a').subjects).toBe(0);
    expect(s.pending).toMatchObject({ kind: 'access_request', forPlayerId: 'b' });
    s = apply(s, 'b', { type: 'respond_access_request', grant: true });
    expect(E.byId(s, 'a').subjects).toBe(1);
    // The consent was for that purchase only.
    expect(s.activeAction?.accessGrants).toBeUndefined();
  });

  it('#05 a destroyed Surf leaves its owner (bought again at full cost), not back to availability', () => {
    const s = fresh();
    s.placements = [{ collectorId: 'surf-1', ownerId: 'a', coord: '0,6', resource: 'oil', authorizedBy: null }];
    addUnit(s, 'evoker', 'b', '0,6');
    B.sweepLocation(s, E.byId(s, 'b'), '0,6');
    expect(E.byId(s, 'a').collectorsAvailable['surf-1']).toBeUndefined();
    E.runUpkeep(s);
    expect(E.availableCollectorIds(s, E.byId(s, 'a'))).toEqual(['surf-2', 'surf-3']); // three starting Surfs (ruling #100), one destroyed
    expect(E.countOwnedUnitsOfType(s, E.byId(s, 'a'), 'surf')).toBe(2);
  });

  it('#06 a robot collector is ONE piece: off the map until placed, counted once, and destroyed with its Core where it collects', () => {
    let s = act(fresh(['ledger', 'covenant']));
    const a = () => E.byId(s, 'a');
    expect(s.units.some((u) => u.ownerId === 'a' && u.typeId.endsWith('-collector'))).toBe(false);
    expect(E.availableCollectorIds(s, a()).sort()).toEqual(['water-collector-1', 'water-collector-2', 'wood-collector-1', 'wood-collector-2']); // rulings #81, #85
    s = apply(s, 'a', { type: 'build', item: 'Core', payment: [{ collectorId: 'water-collector-1', coord: '-2,8' }] });
    expect(s.placements).toMatchObject([{ collectorId: 'water-collector-1', coord: '-2,8' }]);
    expect(E.countOwnedUnitsOfType(s, a(), 'water-collector')).toBe(2); // each counted once
    const supplyBefore = a().coresInSupply;
    B.sweepLocation(s, E.byId(s, 'b'), '-2,8');
    expect(a().collectorsAvailable['water-collector-1']).toBeUndefined();
    expect(a().coresInSupply).toBe(supplyBefore + 1); // its Core died with it
    expect(E.countOwnedUnitsOfType(s, a(), 'water-collector')).toBe(1);
  });

  it('#07 a Coreless platform is not a unit: it anchors no collector and no base site', () => {
    const s = act(fresh(['ledger', 'covenant']));
    s.bases = s.bases.filter((b) => b.ownerId !== 'a');
    const spinner = addUnit(s, 'spinner', 'a', '2,10', false);
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), '1,11', [])).toBe(false);
    expect(E.isBaseSite(s, 'a', '2,10')).toBe(false);
    spinner.allocatedCoreId = 'core-x';
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), '1,11', [])).toBe(true);
  });

  it('#08/#48 printed tile labels pay, and the reach question reads them the same way', () => {
    let s = act(fresh());
    const labelled = pay(['-2,8', '-1,9']).map((x) => {
      const [c, r] = x.coord.split(',').map(Number);
      return { ...x, coord: tileLabel(c!, r!) };
    });
    const reach = collectorReach(s, 'a', [labelled[0]!]);
    expect(reach.collectors.find((c) => c.id === 'surf-1')?.placed_at).toBe('-2,8');
    s = apply(s, 'a', { type: 'build', item: 'Subject', payment: labelled });
    expect(E.byId(s, 'a').subjects).toBe(1);
    expect(s.placements.map((p) => p.coord).sort()).toEqual(['-1,9', '-2,8']);
  });

  it('#47 (designer ruling) a partner\'s unit anchors a collector on its own tile — the payment and the reach question agree', () => {
    const s = act(fresh());
    s.treaties = [{ type: 'shared-resources', partners: ['a', 'b'] }];
    s.bases = s.bases.filter((b) => b.ownerId !== 'b');
    s.heroes.find((h) => h.ownerId === 'b')!.coord = '2,4';
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), '2,4', [])).toBe(true);
    expect(collectorReach(s, 'a', []).next['surf-1']).toContain('2,4');
    expect(() => collectorReach(s, 'a', [{ collectorId: 'surf-1', coord: '2,4' }])).not.toThrow();
    expect(() => E.validatePayment(s, E.byId(s, 'a'), {}, [{ collectorId: 'surf-1', coord: '2,4' }])).not.toThrow();
  });

  it('(designer ruling #79) a partner base anchors collectors on its tile and next to it', () => {
    const s = act(fresh());
    const partnerBase = s.bases.find((b) => b.ownerId === 'b')!.coord; // 2,4
    s.heroes.find((h) => h.ownerId === 'b')!.coord = '0,12'; // no partner unit near the base
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), partnerBase, [])).toBe(false);
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), '2,6', [])).toBe(false);
    s.treaties = [{ type: 'shared-resources', partners: ['a', 'b'] }];
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), partnerBase, [])).toBe(true);
    expect(E.isLegalPlacement(s, E.byId(s, 'a'), '2,6', [])).toBe(true);
    expect(collectorReach(s, 'a', []).next['surf-1']).toContain('2,6');
  });

  it('#42 the oil-funded battle-card purchase is offered', () => {
    const s = act(fresh(['ledger', 'covenant']), 'a', 'research');
    const p = E.byId(s, 'a');
    p.buildings = ['Defense Research Station'];
    s.bases.find((b) => b.ownerId === 'a')!.coord = '0,6';
    s.heroes.find((h) => h.ownerId === 'a')!.coord = '0,6';
    p.collectorsAvailable['wood-collector-1'] = 1;
    p.collectorsAvailable['ore-collector-1'] = 1;
    p.collectorsAvailable['oil-collector-1'] = 1;
    const offer = getLegalMoves(s, 'a').find((m) => m.move.type === 'research' && m.move.kind === 'battle_card');
    expect(offer).toBeDefined();
    const n = apply(s, 'a', offer!.move);
    expect(n.pending?.kind).toBe('report_draw');
  });
});

describe('rules recheck 46802be — research, upkeep, planning, treaties', () => {
  it('#03 Metal Platforms is researched at an owned Home and (designer ruling) costs 2 wood + 1 ore + 1 oil', () => {
    expect(researchById('metal-platforms')!.cost).toEqual({ wood: 2, ore: 1, oil: 1 });
    let s = act(fresh(['ledger', 'covenant']), 'a', 'research');
    const p = E.byId(s, 'a');
    p.collectorsAvailable['wood-collector-1'] = 1;
    p.collectorsAvailable['wood-collector-2'] = 1;
    p.collectorsAvailable['ore-collector-1'] = 1;
    p.collectorsAvailable['oil-collector-1'] = 1;
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'research' && m.move.kind === 'tech' && m.move.tech === 'Metal Platforms')).toBe(true);
    s = apply(s, 'a', { type: 'research', kind: 'tech', tech: 'Metal Platforms', payment: [
      { collectorId: 'wood-collector-1', coord: '-2,10' }, { collectorId: 'wood-collector-2', coord: '-1,9' },
      { collectorId: 'ore-collector-1', coord: '0,10' }, { collectorId: 'oil-collector-1', coord: '0,8' },
    ] });
    expect(E.byId(s, 'a').research).toContain('metal-platforms');
  });

  it('#04 every robot seat is asked about its Cores at upkeep — even fully allocated — and may free one', () => {
    let s = fresh(['ledger', 'covenant'], ['marshal', 'warden'], false);
    expect(s.pending).toMatchObject({ kind: 'upkeep_reallocate_cores', forPlayerId: 'a' });
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'reallocate_cores'
      && (m.move as { allocations: Record<string, boolean> }).allocations['water-collector-1'] === false)).toBe(true);
    s = apply(s, 'a', { type: 'reallocate_cores', allocations: { 'water-collector-1': false } });
    expect(E.byId(s, 'a').coresInReserve).toBe(1);
    expect(E.availableCollectorIds(s, E.byId(s, 'a')).sort()).toEqual(['water-collector-2', 'wood-collector-1', 'wood-collector-2']);
    expect(s.phase).toBe('planning');
    // An AI robot seat is asked too (its own brain answers).
    let ai = E.createInitialState([{ player_id: 'h', kind: 'human' }, { player_id: 'r', kind: 'ai' }], { seed: 9, setupFirstPlayerId: 'h', aiLeaderAssignment: ['marshal'] });
    ai = apply(ai, 'h', { type: 'assign_setup_choices', selections: { h: 'covenant', r: 'ledger' } });
    ai = apply(ai, 'h', { type: 'choose_leader', hero: 'warden' });
    while (ai.pending?.kind === 'choose_starting_location') {
      const open = getLegalMoves(ai, ai.pending.forPlayerId)[0]!.move;
      ai = apply(ai, ai.pending.forPlayerId, open);
    }
    expect(ai.pending).toMatchObject({ kind: 'upkeep_reallocate_cores', forPlayerId: 'r' });
    const { move } = chooseMove(ai, 'r', 'medium');
    ai = apply(ai, 'r', move);
    expect(ai.phase).toBe('planning');
  });

  it('#09 the hero-granted extra card is still offered after the normal card is placed', () => {
    let s = fresh();
    s.planningOrder = ['a', 'b'];
    expect(E.byId(s, 'a').actionCards.moveBattle).toBe(2);
    s = apply(s, 'a', { type: 'plan_action', card: 'move_battle', which: 'base' });
    s = apply(s, 'b', { type: 'plan_action', card: 'pass' });
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'plan_action' && m.move.card === 'move_battle' && m.move.which === 'hero_extra')).toBe(true);
  });

  it('#10 a face-down planned card\'s kind is in no public view or log — only its owner\'s view', () => {
    let s = fresh();
    s.planningOrder = ['a', 'b'];
    s = apply(s, 'a', { type: 'plan_action', card: 'research' });
    const pub = JSON.stringify(getPublicView(s));
    expect(pub).not.toContain('research:base');
    expect(JSON.stringify(getPlayerView(s, 'b'))).not.toContain('research:base');
    expect((getPlayerView(s, 'a') as Record<string, unknown>)['your_action_cards_played']).toEqual(['research:base']);
    const planning = s.log.filter((e) => e.category === 'planning' && e.actor === 'a');
    expect(planning.at(-1)!.summary).toBe('a places an action card face down on the Action Stack');
    expect(planning.some((e) => /research/i.test(e.summary))).toBe(false);
  });

  it('#11 a treaty can be formed at the END of the active player\'s action', () => {
    let s = act(fresh());
    s = apply(s, 'a', { type: 'build', item: 'Embassy', payment: pay(['-1,9', '-1,11']) });
    expect(s.activeAction).toMatchObject({ ownerId: 'a', endWindow: true });
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'build')).toBe(false);
    s = apply(s, 'a', { type: 'form_treaty', partner: 'b', treaty_type: 'Peace' });
    s = apply(s, 'b', { type: 'respond_treaty', accept: true });
    expect(s.treaties).toEqual([{ type: 'peace', partners: ['a', 'b'] }]);
    s = apply(s, 'a', { type: 'skip_action' });
    expect(s.activeAction?.ownerId).toBe('b');
  });

  it('#12 Open Borders cannot break while the partners\' heroes share a space', () => {
    const s = fresh();
    s.heroes.forEach((h) => { h.coord = '0,6'; });
    s.phase = 'treaty_break';
    const t = { type: 'open-borders' as const, partners: ['a', 'b'] as [string, string] };
    s.treaties = [t];
    expect(treatyBreakGate.check(s, 'a', t)).toMatch(/share a space/);
  });
});

describe('rules recheck 46802be — heroes, claims and rewards', () => {
  function rebuildWithReserved(ids: string[]): S {
    const s = act(fresh());
    surfs(s, 6);
    s.bases = s.bases.filter((b) => b.ownerId !== 'a');
    for (const id of ids) addHero(s, id, 'a', null);
    return apply(s, 'a', { type: 'build', item: 'Castle', at_base: '-2,10', payment: pay(['-2,10', '-1,9', '-1,11', '0,10']) });
  }

  it('#13 a reserved hero is placed after the base is rebuilt, and the Build then ends', () => {
    let s = rebuildWithReserved(['chronicler']);
    expect(s.pending?.kind).toBe('place_reserved_hero');
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'chronicler', coord: '-2,10' });
    expect(s.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('-2,10');
    expect(s.activeAction?.ownerId).toBe('b');
  });

  it('#14 a milestone hero goes to the base its owner chooses', () => {
    let s = fresh();
    s.bases.push({ id: 'extra', ownerId: 'a', coord: '0,6' });
    s.phase = 'claims';
    s.pending = { kind: 'choose_milestone_hero', forPlayerId: 'a', claimsOwed: 1 };
    s.claimsOwed = { a: 1 };
    s = apply(s, 'a', { type: 'choose_milestone_hero', hero: 'chronicler' });
    expect(getLegalMoves(s, 'a').filter((m) => m.move.type === 'place_reserved_hero')).toHaveLength(2);
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'chronicler', coord: '0,6' });
    expect(s.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('0,6');
  });

  it('#15 an AI seat that crosses two milestones claims two heroes', () => {
    let s = fresh();
    E.byId(s, 'a').kind = 'ai';
    E.byId(s, 'b').kind = 'ai';
    E.byId(s, 'a').culture = 14;
    E.byId(s, 'a').subjects = 5;
    E.byId(s, 'a').buildings = ['Amphitheatre'];
    addHero(s, 'chronicler', 'a', '-2,10');
    s.treaties = [{ type: 'peace', partners: ['a', 'b'] }, { type: 'shared-resources', partners: ['a', 'b'] }];
    const before = s.heroes.filter((h) => h.ownerId === 'a').length;
    s.phase = 'action';
    s.actionStack = [];
    E.beginCulturePhase(s);
    expect(E.byId(s, 'a').culture).toBe(36); // 14 + 10 Subjects + 5 Chronicler (#114) + 3 Peace + 4 Shared Resources (#112): crosses 15 and 30
    let guard = 0;
    while (s.phase === 'claims' && s.pending && guard++ < 20) {
      const pid = s.pending.forPlayerId;
      s = apply(s, pid, chooseMove(s, pid, 'medium').move);
    }
    expect(s.heroes.filter((h) => h.ownerId === 'a').length - before).toBe(2);
  });

  it('#16 a claimed Motherboard that brings the final technology points wins at once (robots only, #123)', () => {
    let s = fresh(['ledger', 'covenant']);
    // 21 of the 26 robot points (ruling #129); Motherboard's five are the last.
    E.byId(s, 'a').acquiredTypes = [...ROBOT_UNITS, ...ROBOT_BUILDINGS, ...ROBOT_RESEARCH].map((x) => x.id).slice(0, 21);
    s.phase = 'claims';
    s.pending = { kind: 'choose_milestone_hero', forPlayerId: 'a', claimsOwed: 1 };
    s.claimsOwed = { a: 1 };
    s = apply(s, 'a', { type: 'choose_milestone_hero', hero: 'motherboard' });
    expect(s.result?.winners).toEqual(['a']);
    expect(s.result?.kinds).toContain('Technological');
  });

  it('#123 a wizard cannot take Motherboard, as Leader or as a milestone hero', () => {
    let s = fresh();
    s.phase = 'claims';
    s.pending = { kind: 'choose_milestone_hero', forPlayerId: 'a', claimsOwed: 1 };
    s.claimsOwed = { a: 1 };
    expect(getLegalMoves(s, 'a').some((m) => (m.move as { hero?: string }).hero?.toLowerCase().includes('motherboard'))).toBe(false);
    expect(() => apply(s, 'a', { type: 'choose_milestone_hero', hero: 'motherboard' })).toThrow(/robot-only/);
    expect(() => fresh(['covenant', 'schism'], ['motherboard', 'warden'])).toThrow(/robot-only/);
  });

  it('#122 Chaimidious claimed as a milestone hero: his card is the battle strategy card type, and its point can win', () => {
    let s = fresh();
    // 25 of the 26 wizard points (ruling #129); the card type is the last.
    E.byId(s, 'a').acquiredTypes = [...WIZARD_UNITS, ...WIZARD_BUILDINGS, ...WIZARD_RESEARCH].map((x) => x.id).slice(0, 25);
    s.heroes = s.heroes.filter((h) => h.id !== 'chaimidious');
    if (!s.heroPool.includes('chaimidious')) s.heroPool.push('chaimidious');
    s.phase = 'claims';
    s.pending = { kind: 'choose_milestone_hero', forPlayerId: 'a', claimsOwed: 1 };
    s.claimsOwed = { a: 1 };
    s = apply(s, 'a', { type: 'choose_milestone_hero', hero: 'chaimidious' });
    expect(E.byId(s, 'a').acquiredTypes).toContain('battle-strategy-card');
    expect(s.result?.winners).toEqual(['a']);
    expect(s.result?.kinds).toContain('Technological');
  });

  it('#17 an Economy Leader\'s overlay is active from its starting placement', () => {
    const s = fresh(['covenant', 'schism'], ['ida', 'warden']); // Ida (ore): Dowser has no overlay since ruling #106
    expect(E.effectiveResourceAt(s, '-2,10')).toBe('ore');
  });

  it('#18 overlays follow their heroes: a new arrival owes a choice, a departure re-selects', () => {
    const s = fresh();
    const mayhew = addHero(s, 'mayhew', 'a', '0,6'); // ether overlay (Dowser has none since #106)
    B.refreshOverlay(s, '0,6');
    expect(E.effectiveResourceAt(s, '0,6')).toBe('ether');
    addHero(s, 'ida', 'a', '0,6');
    B.refreshOverlay(s, '0,6');
    B.armOverlayChoice(s);
    expect(s.pending).toMatchObject({ kind: 'overlay_choice', forPlayerId: 'a' });
    B.resolveOverlayChoice(s, 'a', 'Prospector Ida Marrs');
    expect(E.effectiveResourceAt(s, '0,6')).toBe('ore');
    mayhew.coord = '-1,5';
    B.refreshOverlay(s, '0,6');
    B.refreshOverlay(s, '-1,5');
    expect(E.effectiveResourceAt(s, '0,6')).toBe('ore');
    expect(E.effectiveResourceAt(s, '-1,5')).toBe('ether');
    s.heroes.find((h) => h.id === 'ida')!.coord = '0,4';
    B.refreshOverlay(s, '0,6');
    expect(E.effectiveResourceAt(s, '0,6')).toBe('oil');
  });

  it('#37 a mixed setup keeps an AI Smyth Leader\'s free research', () => {
    let s = E.createInitialState([{ player_id: 'a', kind: 'human' }, { player_id: 'b', kind: 'ai' }], { seed: 9, setupFirstPlayerId: 'a', aiLeaderAssignment: ['smyth'] });
    s = apply(s, 'a', { type: 'assign_setup_choices', selections: { a: 'covenant', b: 'ledger' } });
    s = apply(s, 'a', { type: 'choose_leader', hero: 'marshal' });
    expect(s.pending).toMatchObject({ kind: 'smyth_reward', forPlayerId: 'b' });
    s = apply(s, 'b', chooseMove(s, 'b', 'medium').move);
    // Smyth waives the prerequisite, so any robot technology — Metal
    // Platforms or one of the Extra cards (#86) — is a legal free pick.
    expect(E.byId(s, 'b').research).toHaveLength(1);
    expect(researchForSpecies('robot').map((r) => r.id)).toContain(E.byId(s, 'b').research[0]);
    expect(s.phase).toBe('setup_locations');
  });

  it('#45 Smyth\'s placement reward resumes the remaining placements, then ends the Build — no extra purchase', () => {
    let s = rebuildWithReserved(['smyth', 'chronicler']);
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'smyth', coord: '-2,10' });
    expect(s.pending?.kind).toBe('smyth_reward');
    s = apply(s, 'a', { type: 'research', kind: 'tech', tech: 'Dehance', payment: [] });
    expect(s.pending).toMatchObject({ kind: 'place_reserved_hero', forPlayerId: 'a' });
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'chronicler', coord: '-2,10' });
    expect(s.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('-2,10');
    expect(s.activeAction?.ownerId).toBe('b');
    expect(() => apply(s, 'a', { type: 'build', item: 'Surf', payment: pay(['-2,8', '-2,6'], 5) })).toThrow();
  });

  it('#46 Chaimidious\'s placement reward resumes the remaining placements', () => {
    let s = rebuildWithReserved(['chaimidious', 'chronicler']);
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'chaimidious', coord: '-2,10' });
    expect(s.pending?.kind).toBe('report_draw');
    s = apply(s, 'a', { type: 'report_draw', card: 'Retreat' });
    expect(s.pending).toMatchObject({ kind: 'place_reserved_hero', forPlayerId: 'a' });
    s = apply(s, 'a', { type: 'place_reserved_hero', hero: 'chronicler', coord: '-2,10' });
    expect(s.heroes.find((h) => h.id === 'chronicler')!.coord).toBe('-2,10');
    expect(s.activeAction?.ownerId).toBe('b');
  });
});

describe('rules recheck 46802be — Elara, battle cards and the deck', () => {
  it('#19 Elara casts at the start of the action, movement after is optional, and her spell kills collectors', () => {
    let s = act(fresh(['covenant', 'schism'], ['elara', 'warden']), 'a', 'move_battle');
    s.placements = [{ collectorId: 'surf-1', ownerId: 'b', coord: '-1,9', resource: 'wood', authorizedBy: null }];
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'cast_elara_spell')).toBe(true);
    s = apply(s, 'a', { type: 'cast_elara_spell', target_location: '-1,9' });
    expect(s.placements).toHaveLength(0);
    expect(E.byId(s, 'b').collectorsAvailable['surf-1']).toBeUndefined();
    expect(s.heroes.find((h) => h.id === 'elara')!.coord).toBe('-2,10');
    s = apply(s, 'a', { type: 'skip_action' });
    expect(s.activeAction?.ownerId).toBe('b');
  });

  it('#20 a Counter with nothing to cancel does not stall the battle', () => {
    let s = fresh();
    addUnit(s, 'evoker', 'b', '0,6');
    cards(s, 'a', ['counter-1']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Counter' });
    s = apply(s, 'b', { type: 'commit_battle_card', card: null });
    expect(s.battle!.phase).toBe('activations');
  });

  it('#21 a person playing Retreat chooses where their units go', () => {
    let s = fresh();
    addUnit(s, 'evoker', 'b', '0,6');
    cards(s, 'a', ['retreat-1']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Retreat' });
    s = apply(s, 'b', { type: 'commit_battle_card', card: null });
    expect(s.pending).toMatchObject({ kind: 'retreat', forPlayerId: 'a', viaCard: 'retreat-1' });
    const dests = getLegalMoves(s, 'a').map((m) => (m.move as { destination?: string }).destination);
    expect(dests).toContain('0,8');
    expect(dests).not.toContain(null); // the card's retreat is not optional
    s = apply(s, 'a', { type: 'choose_retreat', destination: '0,8' });
    expect(s.heroes.find((h) => h.id === 'marshal')!.coord).toBe('0,8');
  });

  it('#22 a retreat goes only to an eligible ADJACENT map tile', () => {
    let s = fresh();
    addUnit(s, 'evoker', 'b', '0,6');
    battle(s, ['marshal']);
    s = noCards(s);
    s.pending = { kind: 'retreat', forPlayerId: 'a' };
    expect(() => apply(s, 'a', { type: 'choose_retreat', destination: '99,99' })).toThrow();
    expect(() => apply(s, 'a', { type: 'choose_retreat', destination: '-2,10' })).toThrowError(/not an eligible retreat destination/);
    expect(() => apply(s, 'a', { type: 'choose_retreat', destination: '-1,5' })).toThrowError(/not an eligible retreat destination/); // the origin
  });

  it('#30 a physical draw from an empty pile reshuffles the discard', () => {
    let s = fresh();
    s.battleDiscard = buildBattleDeck().map((x) => x.instanceId);
    s.battleDeck = [];
    s.pending = { kind: 'report_draw', forPlayerId: 'a', reason: 'research-purchase', resume: { action: 'research', move: null } };
    s = apply(s, 'a', { type: 'report_draw', card: 'Retreat' });
    expect(E.byId(s, 'a').hand).toHaveLength(1);
    expect(s.battleDiscard).toHaveLength(0);
    expect(s.battleDeck).toHaveLength(19);
  });

  it('#31 the public draw-pile count is the real 20 cards', () => {
    const s = fresh();
    expect((getPublicView(s) as { battle_deck_count: number }).battle_deck_count).toBe(20);
  });

  it('#32 with every card held, a person\'s draw asks nothing and strands nothing', () => {
    const s = fresh();
    s.battleDeck = [];
    E.byId(s, 'b').hand = buildBattleDeck().map((x) => x.instanceId);
    expect(E.drawBattleCard(s, E.byId(s, 'a'), 'hero-reward')).toBe(false);
    expect(s.pending).toBeNull();
  });

  it('#35 two copies played by different players are two different Counter targets', () => {
    let s = fresh(['covenant', 'schism', 'ledger'], ['marshal', 'warden', 'evo-angel']);
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    s.heroes.find((h) => h.id === 'evo-angel')!.coord = '0,6';
    s.treaties = [{ type: 'open-borders', partners: ['b', 'c'] }];
    cards(s, 'a', ['counter-1']);
    cards(s, 'b', ['bonus-def-plus-1']);
    cards(s, 'c', ['bonus-def-plus-2']);
    battle(s, ['marshal']);
    while (s.pending?.kind === 'battle_commit') {
      const pid = s.pending.forPlayerId;
      s = apply(s, pid, { type: 'commit_battle_card', card: pid === 'a' ? 'Counter' : 'Bonus (+1 DEF to all your units)' });
    }
    const moves = getLegalMoves(s, 'a');
    expect(moves).toHaveLength(2);
    expect(moves[0]!.move).not.toEqual(moves[1]!.move);
    const cMove = moves.find((m) => (m.move as { played_by?: string }).played_by === 'c')!;
    s = apply(s, 'a', cMove.move);
    const committed = s.battle!.committed;
    expect(committed.find((c) => c.cardInstanceId === 'bonus-def-plus-2')!.countered).toBe(true);
    expect(committed.find((c) => c.cardInstanceId === 'bonus-def-plus-1')!.countered).toBe(false);
  });

  it('#36 a signed Bonus short name keeps its sign; an unsigned one is refused', () => {
    expect(resolveBattleCard('-1 DEF').id).toBe('bonus-def-minus');
    expect(resolveBattleCard('+1 DEF').id).toBe('bonus-def-plus');
    expect(resolveBattleCard('−1 DMG').id).toBe('bonus-dmg-minus');
    expect(() => resolveBattleCard('1 DEF')).toThrowError(/either Bonus/);
  });

  it('#38 a Shared Tactics borrower gets a look at the owner\'s card after the owner passes on it', () => {
    let s = fresh();
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    s.treaties = [{ type: 'shared-tactics', partners: ['a', 'b'] }];
    cards(s, 'b', ['initiative-1']);
    battle(s, ['marshal']);
    expect(s.pending?.forPlayerId).toBe('a');
    s = apply(s, 'a', { type: 'commit_battle_card', card: null });
    s = apply(s, 'b', { type: 'commit_battle_card', card: null });
    expect(s.pending).toMatchObject({ kind: 'battle_commit', forPlayerId: 'a' });
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'commit_battle_card' && m.move.card === 'Initiative')).toBe(true);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Initiative' });
    expect(s.battle!.committed.some((c) => c.cardInstanceId === 'initiative-1' && c.playingPlayerId === 'a')).toBe(true);
  });

  it('#39 every Rally is answered in turn — an AI Rally ahead does not skip a person\'s', () => {
    let s = fresh();
    s.firstPlayerIndex = 0;
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    addUnit(s, 'evoker', 'b', '0,8'); // something b could bring in
    cards(s, 'a', ['rally-1']);
    cards(s, 'b', ['rally-2']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Rally' });
    E.byId(s, 'a').kind = 'ai';
    s = apply(s, 'b', { type: 'commit_battle_card', card: 'Rally' });
    expect(s.pending).toMatchObject({ kind: 'rally_selection', forPlayerId: 'b' });
  });
});

describe('rules recheck 46802be — battle', () => {
  it('#23 Wizard Missile obeys the Wall rule on every path', () => {
    let s = fresh(['covenant', 'ledger']);
    const e = addUnit(s, 'evoker', 'a', '-1,5');
    addUnit(s, 'wall-platform', 'b', '0,6', true);
    const victim = addUnit(s, 'spinner', 'b', '0,6', true);
    battle(s, [e.id]);
    s = noCards(s);
    expect(() => apply(s, 'a', { type: 'battle_activation', unit: e.id, action: { kind: 'attack', target: victim.id } })).toThrowError(/Wall/);
    expect(() => apply(s, 'a', { type: 'battle_activation', unit: e.id, action: { kind: 'ability', ability: 'wizard_missile', target: victim.id } })).toThrowError(/Wall/);
  });

  it('#24 a robot Infiltrator carries no Decoy', () => {
    let s = fresh(['covenant', 'ledger']);
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    E.byId(s, 'b').spyAssignments = [{ source: 'infiltrator', heroId: 'warden', active: true }];
    battle(s, ['marshal']);
    s = noCards(s);
    s = apply(s, 'b', { type: 'battle_activation', unit: 'warden', action: { kind: 'pass' } });
    s = apply(s, 'a', { type: 'battle_activation', unit: 'marshal', action: { kind: 'attack', target: 'warden' } });
    expect(s.pending?.kind).not.toBe('battle_defense');
    expect(E.byId(s, 'b').spyAssignments[0]!.active).toBe(true);
  });

  it('#25 a Coreless platform cannot be rallied', () => {
    let s = fresh(['ledger', 'covenant']);
    const coreless = addUnit(s, 'spinner', 'a', '-1,7', false);
    const powered = addUnit(s, 'spinner', 'a', '0,8', true);
    addUnit(s, 'evoker', 'b', '0,6');
    cards(s, 'a', ['rally-1']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Rally' });
    s = apply(s, 'b', { type: 'commit_battle_card', card: null });
    expect(s.pending?.kind).toBe('rally_selection');
    const offered = JSON.stringify(getLegalMoves(s, 'a').map((m) => m.move));
    expect(offered).toContain(powered.id);
    expect(offered).not.toContain(coreless.id);
    expect(() => apply(s, 'a', { type: 'select_rally_units', units: [coreless.id] })).toThrow();
  });

  it('#26 a +1 DMG Bonus helps only the playing player\'s own units', () => {
    let s = fresh(['covenant', 'schism', 'ledger'], ['marshal', 'warden', 'evo-angel']);
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    s.heroes.find((h) => h.id === 'evo-angel')!.coord = '0,6';
    s.treaties = [{ type: 'open-borders', partners: ['b', 'c'] }];
    cards(s, 'b', ['bonus-dmg-plus-1']);
    battle(s, ['marshal']);
    while (s.pending?.kind === 'battle_commit') {
      const pid = s.pending.forPlayerId;
      s = apply(s, pid, { type: 'commit_battle_card', card: pid === 'b' ? '+1 DMG' : null });
    }
    const ally = s.battle!.units.find((u) => u.unitRef === 'evo-angel')!;
    const own = s.battle!.units.find((u) => u.unitRef === 'warden')!;
    expect(B.modifierSumPub(s, ally, 'dmg')).toBe(0);
    expect(B.modifierSumPub(s, own, 'dmg')).toBe(1);
  });

  it('#27 one Cleric owner\'s refusal does not stop another allied owner saving the unit', () => {
    let s = fresh(['covenant', 'schism', 'brass-circle'], ['marshal', 'warden', 'rook']);
    const target = addUnit(s, 'evoker', 'b', '0,6');
    addUnit(s, 'cleric', 'b', '0,6');
    addUnit(s, 'cleric', 'c', '0,6');
    s.treaties = [{ type: 'open-borders', partners: ['b', 'c'] }];
    battle(s, ['marshal']);
    s = noCards(s);
    while (s.battle && s.battle.activationQueue[s.battle.activationCursor] !== 'marshal') {
      const ref = s.battle.activationQueue[s.battle.activationCursor]!;
      const owner = s.battle.units.find((u) => u.unitRef === ref)!.ownerId;
      s = apply(s, owner, { type: 'battle_activation', unit: ref, action: { kind: 'pass' } });
    }
    s = apply(s, 'a', { type: 'battle_activation', unit: 'marshal', action: { kind: 'attack', target: target.id } });
    const first = s.pending!.forPlayerId;
    const second = first === 'b' ? 'c' : 'b';
    s = apply(s, first, { type: 'resolve_battle_defense', defense: { kind: 'none' } });
    expect(s.pending).toMatchObject({ kind: 'battle_defense', forPlayerId: second });
    const cleric = s.battle!.units.find((u) => u.ownerId === second && u.label === 'Cleric')!;
    s = apply(s, second, { type: 'resolve_battle_defense', defense: { kind: 'cleric_save', cleric: cleric.unitRef, target: target.id } });
    expect(s.units.some((u) => u.id === target.id)).toBe(true);
  });

  it('#28 a spy assignment ends with its hero, so a replacement can be recruited', () => {
    const s = fresh();
    const h = addHero(s, 'chronicler', 'a', '0,6');
    E.byId(s, 'a').spyAssignments = [{ source: 'illusionist', heroId: 'chronicler', active: true }];
    B.killHero(s, h, 'b');
    expect(E.byId(s, 'a').spyAssignments.some((x) => x.active)).toBe(false);
  });

  it('#33 a unit\'s type never depends on its owner\'s id', () => {
    expect(B.probeUnitDef('u-evoker-player-a-1')?.id).toBe('evoker');
    expect(B.probeUnitDef('u-wall-platform-seat-x-2')?.id).toBe('wall-platform');
  });

  it('#34 tied allied units of different owners: the earliest tied owner picks who acts next', () => {
    let s = fresh(['covenant', 'schism', 'brass-circle'], ['marshal', 'warden', 'rook']);
    const bEvoker = addUnit(s, 'evoker', 'b', '0,6');
    const cEvoker = addUnit(s, 'evoker', 'c', '0,6');
    s.treaties = [{ type: 'open-borders', partners: ['b', 'c'] }];
    s.firstPlayerIndex = 1; // b is first in first-player order
    const dragon = addUnit(s, 'dragon', 'a', '-1,5');
    battle(s, [dragon.id]);
    s = noCards(s);
    expect(s.pending).toMatchObject({ kind: 'initiative_tie', forPlayerId: 'b' });
    expect(s.pending!.kind === 'initiative_tie' && s.pending.tieGroup.sort()).toEqual([bEvoker.id, cEvoker.id].sort());
    s = apply(s, 'b', { type: 'choose_initiative_order', unit: cEvoker.id });
    expect(s.battle!.activationQueue[s.battle!.activationCursor]).toBe(cEvoker.id);
    expect(s.activePlayerId).toBe('c');
  });

  it('#40 (designer ruling) Fiery Explosion takes the Evoker\'s damage bonus', () => {
    let s = fresh();
    const e = addUnit(s, 'evoker', 'a', '-1,5');
    addHero(s, 'rook', 'a', '0,6');
    addHero(s, 'chronicler', 'b', '0,6');
    E.byId(s, 'a').research = ['fiery-explosion'];
    battle(s, [e.id]);
    s = noCards(s);
    while (s.battle && s.battle.activationQueue[s.battle.activationCursor] !== e.id) {
      const ref = s.battle.activationQueue[s.battle.activationCursor]!;
      const owner = s.battle.units.find((u) => u.unitRef === ref)!.ownerId;
      s = apply(s, owner, { type: 'battle_activation', unit: ref, action: { kind: 'pass' } });
    }
    s = apply(s, 'a', { type: 'battle_activation', unit: e.id, action: { kind: 'ability', ability: 'fiery_explosion' } });
    expect(s.heroes.find((h) => h.id === 'chronicler')!.dead).toBe(true); // 2 + Rook's 2 = 4 ≥ DEF 3
  });

  it('#41 when everyone retreats, nobody is left to destroy the base', () => {
    let s = fresh();
    s.firstPlayerIndex = 0;
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    s.bases.find((b) => b.ownerId === 'b')!.coord = '0,6';
    cards(s, 'a', ['retreat-1']);
    cards(s, 'b', ['retreat-2']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Retreat' });
    s = apply(s, 'b', { type: 'commit_battle_card', card: 'Retreat' });
    let guard = 0;
    while (s.pending?.kind === 'retreat' && guard++ < 4) {
      const pid = s.pending.forPlayerId;
      const dest = getLegalMoves(s, pid).find((m) => m.move.type === 'choose_retreat' && (m.move as { destination: string | null }).destination)!;
      s = apply(s, pid, dest.move);
    }
    expect(s.battle).toBeNull();
    expect(s.bases.some((b) => b.coord === '0,6' && b.ownerId === 'b')).toBe(true);
  });

  it('#43 (designer ruling) an area attack kills the opposing side\'s collectors on the battle tile', () => {
    let s = fresh();
    const dragon = addUnit(s, 'dragon', 'a', '-1,5');
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    s.placements = [{ collectorId: 'surf-1', ownerId: 'b', coord: '0,6', resource: 'oil', authorizedBy: null }];
    battle(s, [dragon.id]);
    s = noCards(s);
    s = apply(s, 'b', { type: 'battle_activation', unit: 'warden', action: { kind: 'pass' } });
    s = apply(s, 'a', { type: 'battle_activation', unit: dragon.id, action: { kind: 'attack', target: '' } });
    expect(s.placements).toHaveLength(0);
    expect(E.byId(s, 'b').collectorsAvailable['surf-1']).toBeUndefined();
  });

  it('#44 a unit printed with DMG 0 shows DMG 0 even beside a +2 hero', () => {
    let s = fresh(['ledger', 'covenant']);
    const wall = addUnit(s, 'wall-platform', 'a', '-1,5', true);
    addHero(s, 'rook', 'a', '0,6');
    addUnit(s, 'evoker', 'b', '0,6');
    battle(s, [wall.id]);
    s = noCards(s);
    const row = (getPublicView(s) as { battle: { units: Array<{ unit: string; dmg: number }> } }).battle.units.find((u) => u.unit === 'Wall Platform')!;
    expect(row.dmg).toBe(0);
  });
});

describe('older saved sessions', () => {
  it('a session saved with robot collectors as map units is upgraded to off-map collectors', () => {
    const s = fresh(['ledger', 'covenant']);
    // Rebuild the old shape: collectors as units at the base, supply slots.
    delete s.collectorModel;
    const a = E.byId(s, 'a');
    const base = s.bases.find((b) => b.ownerId === 'a')!.coord;
    s.units.push({ id: 'u-water-collector-a', typeId: 'water-collector', ownerId: 'a', coord: base, allocatedCoreId: 'core-a-water' });
    s.units.push({ id: 'u-wood-collector-a', typeId: 'wood-collector', ownerId: 'a', coord: base, allocatedCoreId: null });
    a.collectorsAvailable = { 'water-collector-1': 0, 'wood-collector-1': 0, 'ore-collector-1': 1 };
    s.placements = [{ collectorId: 'water-collector-a', ownerId: 'a', coord: '-2,8', resource: 'water', authorizedBy: null }];
    E.upgradeLegacyState(s);
    expect(s.units.some((u) => u.typeId.endsWith('-collector'))).toBe(false);
    expect(a.collectorsAvailable).toEqual({ 'water-collector-1': 1, 'wood-collector-1': 1 });
    expect(a.corelessCollectors).toEqual(['wood-collector-1']);
    expect(s.placements[0]!.collectorId).toBe('water-collector-1');
    expect(E.availableCollectorIds(s, a)).toEqual([]);
  });
});

describe('the original audit\'s extra problems', () => {
  it('a Culture Treaty breaks in planning, at an action\'s start or finished end, and at end of round — never mid-action or during the culture phase', () => {
    let s = fresh(['covenant', 'schism', 'ledger', 'foundry'], ['marshal', 'warden', 'rook', 'kestrel']);
    const t = { type: 'culture-treaty' as const, partners: ['a', 'b'] as [string, string] };
    s.treaties = [t];
    // Planning: offered to the seat on turn.
    s.planningOrder = ['a', 'b', 'c', 'd'];
    expect(getLegalMoves(s, 'a').some((m) => m.move.type === 'break_treaty')).toBe(true);
    // An action's start: open; once it is under way: shut; its finished end: open.
    act(s);
    expect(treatyBreakGate.check(s, 'a', t)).toBeNull();
    s.activeAction!.acted = true;
    expect(treatyBreakGate.check(s, 'a', t)).toMatch(/while an action resolves/);
    s.activeAction!.endWindow = true;
    expect(treatyBreakGate.check(s, 'a', t)).toBeNull();
    // The culture phase, hero claims included: shut.
    s.phase = 'claims';
    expect(treatyBreakGate.check(s, 'a', t)).toMatch(/culture phase/);
    // End of round: a Culture Treaty holder is asked too.
    s = fresh(['covenant', 'schism', 'ledger', 'foundry'], ['marshal', 'warden', 'rook', 'kestrel']);
    s.treaties = [t];
    s.phase = 'action';
    s.actionStack = [];
    E.beginCulturePhase(s);
    let guard = 0;
    while (s.pending && s.pending.kind !== 'treaty_break_decision' && guard++ < 30) s = apply(s, s.pending.forPlayerId, getLegalMoves(s, s.pending.forPlayerId)[0]!.move);
    expect(s.pending?.kind).toBe('treaty_break_decision');
    expect(['a', 'b']).toContain(s.pending!.forPlayerId);
  });

  it('after a refusal the suggested payments avoid that owner\'s tiles, but the refused collector stays usable', () => {
    let s = act(fresh());
    s.bases.find((b) => b.ownerId === 'b')!.coord = '-2,8';
    s = apply(s, 'a', { type: 'build', item: 'Subject', payment: pay(['-2,8', '-1,9']) });
    s = apply(s, 'b', { type: 'respond_access_request', grant: false });
    const offers = getLegalMoves(s, 'a').filter((m) => m.move.type === 'build');
    expect(offers.length).toBeGreaterThan(0);
    const used = offers.flatMap((m) => (m.move as { payment: Array<{ collectorId: string; coord: string }> }).payment);
    expect(used.some((x) => x.coord === '-2,8')).toBe(false);
    expect(used.some((x) => x.collectorId === 'surf-1')).toBe(true);
  });

  it('the payment search places a collector only to reach further when that is the only way', () => {
    const s = act(fresh());
    // Ore is two steps from a's base (-2,10): only through the wood at -1,9 or -1,11.
    const pay1 = E.findPayment(s, E.byId(s, 'a'), { ore: 1 });
    expect(pay1).toHaveLength(2);
    expect(E.effectiveResourceAt(s, pay1![1]!.coord)).toBe('ore');
    expect(() => E.validatePayment(s, E.byId(s, 'a'), { ore: 1 }, pay1)).not.toThrow();
    // Nothing is paid with more collectors than it needs.
    expect(E.findPayment(s, E.byId(s, 'a'), { wood: 1 })).toHaveLength(1);
    // Unpayable: three Surfs (ruling #100) cannot make four resources.
    expect(E.findPayment(s, E.byId(s, 'a'), { wood: 4 })).toBeNull();
  });

  it('a move may take any group of the units on a tile, not only all of them', () => {
    const s = act(fresh(), 'a', 'move_battle');
    addUnit(s, 'evoker', 'a', '-2,10');
    const moves = getLegalMoves(s, 'a').filter((m) => m.move.type === 'move_units' && m.move.to === '-2,8')
      .map((m) => (m.move as { units: string[] }).units.slice().sort().join('+'));
    expect(moves).toEqual(expect.arrayContaining(['marshal', 'u-evoker-a-1', 'marshal+u-evoker-a-1']));
  });

  it('an area attack that would not kill an Illusionist spy hero still lets it reveal Decoy', () => {
    let s = fresh();
    const dragon = addUnit(s, 'dragon', 'a', '-1,5');
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    E.byId(s, 'b').spyAssignments = [{ source: 'illusionist', heroId: 'warden', active: true }];
    battle(s, [dragon.id]);
    s = noCards(s);
    s = apply(s, 'b', { type: 'battle_activation', unit: 'warden', action: { kind: 'pass' } });
    s = apply(s, 'a', { type: 'battle_activation', unit: dragon.id, action: { kind: 'attack', target: '' } });
    // 3 DMG against the Leader's DEF 6 would not kill — Decoy is still offered.
    expect(s.pending).toMatchObject({ kind: 'battle_defense', forPlayerId: 'b' });
    expect(getLegalMoves(s, 'b').some((m) => m.move.type === 'resolve_battle_defense' && m.move.defense.kind === 'decoy')).toBe(true);
    s = apply(s, 'b', { type: 'resolve_battle_defense', defense: { kind: 'none' } });
    expect(s.heroes.find((h) => h.id === 'warden')!.dead).toBe(false);
    expect(E.byId(s, 'b').spyAssignments[0]!.active).toBe(true);
  });
});

describe('playtest 2026-09-24', () => {
  it('an AI holding only a Retreat card does not retreat from a fight it is not losing', () => {
    let s = fresh();
    E.byId(s, 'a').kind = 'ai';
    addUnit(s, 'evoker', 'b', '0,6');
    cards(s, 'a', ['retreat-1']);
    battle(s, ['marshal']);
    expect(s.pending).toMatchObject({ kind: 'battle_commit', forPlayerId: 'a' });
    expect(chooseMove(s, 'a', 'hard').move).toEqual({ type: 'commit_battle_card', card: null });
  });

  it('a battle that ends before anyone fights says so, in the log and in the move summary', () => {
    let s = fresh();
    s.heroes.find((h) => h.id === 'warden')!.coord = '0,6';
    cards(s, 'a', ['retreat-1']);
    battle(s, ['marshal']);
    s = apply(s, 'a', { type: 'commit_battle_card', card: 'Retreat' });
    const r = E.applyMove(s, 'b', { type: 'commit_battle_card', card: null });
    s = r.newState;
    if (s.pending?.kind === 'retreat') s = apply(s, 'a', getLegalMoves(s, 'a')[0]!.move);
    expect(s.battle).toBeNull();
    expect(s.log.some((e) => /The battle at 0,6 is over before any unit acted: b holds the tile/.test(e.summary))).toBe(true);
    expect(r.summary).toMatch(/Retreat/);
  });
});

describe('designer rulings #81 and #85', () => {
  it('a robot starts with four Cores powering two water and two wood collectors, and can buy a wood collector with its Core in its first Build', () => {
    let s = act(fresh(['ledger', 'covenant']));
    const a = E.byId(s, 'a');
    expect(Object.keys(a.collectorsAvailable).sort()).toEqual(['water-collector-1', 'water-collector-2', 'wood-collector-1', 'wood-collector-2']);
    expect(a.coresInSupply).toBe(12); // 16 at two players (ruling #89) minus the four starting Cores
    expect(a.coresInReserve).toBe(0);
    expect(a.acquiredTypes.sort()).toEqual(['core', 'home', 'water-collector', 'wood-collector']);
    const offer = getLegalMoves(s, 'a').find((m) => m.move.type === 'build' && m.move.item === 'Wood collector' && m.move.core_pairing);
    expect(offer).toBeDefined();
    s = apply(s, 'a', offer!.move);
    expect(E.byId(s, 'a').collectorsAvailable['wood-collector-1']).toBe(1);
  });
});

describe('greyed-out moves (rules teaching)', () => {
  const itemOffered = (legal: ReturnType<typeof getLegalMoves>, type: string, item: string) => legal.some((m) => {
    const mv = m.move as Record<string, unknown>;
    if (mv['type'] !== type) return false;
    if (type === 'build') return mv['item'] === item;
    if (type === 'research') return item === 'battle strategy card' ? mv['kind'] === 'battle_card' : mv['tech'] === item;
    if (type === 'break_treaty') return `${mv['treaty_type']} with ${mv['partner']}` === item;
    return false;
  });

  it('never greys something that is offered, across whole AI games at 2, 4 and 6 players', () => {
    for (const n of [2, 4, 6]) {
      let s = E.createInitialState(Array.from({ length: n }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'ai' as const })), { seed: 40 + n });
      for (let step = 0; step < 600 && !s.result; step++) {
        const pid = s.activePlayerId;
        const legal = getLegalMoves(s, pid);
        const gates = nggMoveGates(s, pid, legal);
        expect(checkGateConsistency(gates, legal), `step ${step}`).toEqual([]);
        for (const g of gates.filter((x) => x.item !== undefined)) {
          expect(itemOffered(legal, g.move_type, g.item!), `${g.move_type} ${g.item} greyed but offered (step ${step})`).toBe(false);
          expect(g.reason?.length).toBeGreaterThan(5);
        }
        s = apply(s, pid, chooseMove(s, pid, 'medium').move);
      }
    }
  });

  it('a Build shows each blocked purchase with its live reason, and a rejected attempt carries it', () => {
    const s = act(fresh());
    const legal = getLegalMoves(s, 'a');
    const greys = unavailableMoves(nggMoveGates(s, 'a', legal), legal);
    expect(greys).toContainEqual(expect.objectContaining({ move_type: 'build', item: 'Dragon', reason: expect.stringMatching(/requires Dragon Hoard/) }));
    // Three starting Surfs (ruling #100) reach an Evoker; a four-resource building is still out of reach.
    expect(greys).toContainEqual(expect.objectContaining({ move_type: 'build', item: 'Amphitheatre', reason: expect.stringMatching(/costs 1 water \+ 3 wood/) }));
    // Nothing from a phase you are not in.
    expect(greys.some((g) => g.move_type === 'battle_activation' || g.move_type === 'plan_action')).toBe(false);
    let err: unknown;
    try { apply(s, 'a', { type: 'build', item: 'Dragon', payment: [] }); } catch (e) { err = e; }
    const enriched = enrichGateRejection(err, nggMoveGates(s, 'a', legal), { type: 'build', item: 'Dragon', payment: [] }) as Error;
    expect(enriched.message).toMatch(/Why: build Dragon — Dragon requires Dragon Hoard/);
  });

  it('robot reasons name the missing collector type', () => {
    const s = act(fresh(['ledger', 'covenant']));
    const legal = getLegalMoves(s, 'a');
    const greys = unavailableMoves(nggMoveGates(s, 'a', legal), legal);
    // A robot starts with water and wood collectors (#85) but none for ore:
    // the Oil collector (paid in ore) is greyed with that reason.
    expect(greys).toContainEqual(expect.objectContaining({ item: 'Oil collector', reason: expect.stringMatching(/no free ore collector/) }));
  });
});

describe('designer ruling #82', () => {
  it('the Chronicler pays +5 culture a round (ruling #114), and nothing while reserved', () => {
    const s = fresh();
    const a = E.byId(s, 'a');
    const base = E.cultureIncomeFor(s, a);
    const h = addHero(s, 'chronicler', 'a', '-2,10');
    expect(E.cultureIncomeFor(s, a)).toBe(base + 5);
    h.coord = null;
    expect(E.cultureIncomeFor(s, a)).toBe(base);
  });
});
