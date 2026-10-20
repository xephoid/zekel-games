// Regression locks for CODE-REVIEW-2026-09-21.md findings #2–#13 (the
// engine-side set). Each test replays the probe and asserts the fixed behavior.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { cardByInstanceId } from '../engine.js';
import { HEROES } from '../data/catalogs.js';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return neitherGutsNorGears.applyMove(s, playerId, move);
}

function placeUnit(g: NGGState, pid: string, coord: string, typeId: string): string {
  const seq = g.units.filter((u) => u.ownerId === pid && u.typeId === typeId).length + 1;
  const isRobotPlatform = ['spinner', 'spitter', 'immobile-combat-platform', 'large-combat-platform', 'wall-platform', 'water-collector', 'wood-collector', 'ore-collector', 'oil-collector', 'ether-collector'].includes(typeId);
  const id = `u-${typeId}-${pid}-${seq}`;
  g.units.push({ id, typeId, ownerId: pid, coord, allocatedCoreId: isRobotPlatform ? `core-${pid}-${typeId}-${seq}` : null });
  return id;
}

function deal(g: NGGState, pid: string, cards: string[]): void {
  const p = g.players.find((x) => x.playerId === pid)!;
  for (const want of cards) {
    const idx = g.battleDeck.findIndex((id) => cardByInstanceId(id) === want);
    expect(idx).toBeGreaterThanOrEqual(0);
    const id = g.battleDeck.splice(idx, 1)[0]!;
    p.hand.push(id);
    g.cardOwners[id] = pid;
  }
}

/** 2p or 4p humans through setup; wizard 'wiz' (+ optionally more seats). */
function base2p(wizLeader = 'Warden Hesper Quill', robLeader = 'Kestrel Nine'): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: wizLeader }).newState;
  s = apply(s, 'rob', { type: 'choose_leader', hero: robLeader }).newState;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
  s = keepCores(s);
  return s;
}

/** Drive `mover` into a Move/Battle action resolving. */
function driveMoveBattle(s0: SessionState<NGGState>, mover: string): SessionState<NGGState> {
  let s = s0;
  const other = mover === 'wiz' ? 'rob' : 'wiz';
  const placed = new Set<string>();
  while (s.gameState.phase === 'planning') {
    const head = s.gameState.planningOrder[0]!;
    const card = head === mover && !placed.has(mover) ? 'move_battle' as const
      : head === other && !placed.has(other) ? 'research' as const
      : 'pass' as const;
    if (card !== 'pass') placed.add(head);
    s = apply(s, head, { type: 'plan_action', card }).newState;
  }
  let g0 = 0;
  while (g0++ < 6 && (s.gameState.activeAction?.ownerId !== mover || s.gameState.activeAction?.cardKind !== 'move_battle')) {
    s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).newState;
  }
  return s;
}

function settleComm(s: SessionState<NGGState>): SessionState<NGGState> {
  let guard = 0;
  while (s.gameState.pending?.kind === 'battle_commit' && guard++ < 10) {
    s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).newState;
  }
  return s;
}

describe('code-review 2026-09-21 regressions (engine)', () => {
  it('#2+#3 one Leader kill credits exactly once and the game ends at the kill (2p)', () => {
    let s = base2p();
    placeUnit(s.gameState, 'wiz', '-2,8', 'evoker'); // will die
    // The ROBOT Leader defends alone at (-2,8); wiz attacks.
    s.gameState.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
    s = driveMoveBattle(s, 'wiz');
    const r = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] });
    s = r.newState;
    s = settleComm(s);
    expect(s.gameState.battle).not.toBeNull();
    // Warden attacks Kestrel. DMG 5 (leader 3 + no bonus) vs 6 — the fixture
    // needs a kill: give Warden a helper bonus... simpler: make wiz's attacker
    // a Dragon with AoE 3? No — use the probe shape: the SPY instant kill.
    // wiz secretly assigned its spy to Warden.
    s.gameState.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    s.gameState.players.find((p) => p.playerId === 'wiz')!.research.push('invisible');
    // Drive to Warden's activation (I70 — likely first).
    let guard = 0;
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
    expect(s.gameState.battle).not.toBeNull();
    expect(s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]).toBe('warden');
    const r2 = apply(s, 'wiz', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: 'kestrel' } });
    s = r2.newState;
    // THE KILL ENDS THE GAME at once (§12.1): exactly ONE credit, battle over,
    // no further activations processed.
    const wizP = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    expect(wizP.leaderKills).toBe(1);
    expect(s.gameState.phase).toBe('game_over');
    expect(s.gameState.result?.winners).toEqual(['wiz']);
    expect(s.gameState.battle).toBeNull();
  });

  it('#2 the 4p double-credit is gone: one Leader kill at settlement = exactly 1 on the ledger (2 needed in 4p)', () => {
    const players: PlayerConfig[] = Array.from({ length: 4 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'human' as const }));
    let s = neitherGutsNorGears.createSession(players, { seed: 13, setupFirstPlayerId: 'p1' });
    s = apply(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism', p3: 'ledger', p4: 'foundry' } }).newState;
    const leaders: Record<string, string> = { p1: 'Warden Hesper Quill', p2: 'Dowser Wren Calloway', p3: 'Kestrel Nine', p4: 'Marshal Corvin Ashlock' };
    while (s.gameState.phase === 'setup_leaders') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).newState;
    }
    while (s.gameState.phase === 'setup_locations') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: { p4: '@4', p3: '@3', p2: '@2', p1: '@1' }[pend.forPlayerId]! }).newState;
    }
    s = keepCores(s);
    const g = s.gameState;
    // p1 kills p2's Leader via the battle path (killCreditOnce): call the
    // exported battle helpers directly through a crafted battle.
    // Instead of crafting: mark p2's leader killed via the battle ledger by
    // driving killHero's exported path... killHero is exported from engine-battle.
    // Here assert the settle path can't double-count: the ledger must move 0→1
    // at the kill and NEVER again at settlement.
    // Test-side: kill p2's leader with credit to p1 (as the battle helper does).
    // Drive an in-engine Leader kill: p2's leader stands adjacent to p1's
    // wizard base; Warden (hero) with a hidden spy + Invisible researched
    // kills it in one attack.
    const g2 = s.gameState;
    const p1base = g2.bases.find((b) => b.ownerId === 'p1')!.coord;
    const [bc, br] = p1base.split(',').map((v) => parseInt(v, 10));
    const nbr = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${bc! + dc},${br! + dr}`)
      .find((k) => g2.tiles.some((t) => `${t.c},${t.r}` === k))!;
    g2.heroes.find((h) => h.ownerId === 'p2' && h.isLeader)!.coord = nbr;
    g2.players.find((p) => p.playerId === 'p1')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    g2.players.find((p) => p.playerId === 'p1')!.research.push('invisible');
    // Drive p1's Move/Battle.
    let placed = new Set<string>();
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const card = head === 'p1' && !placed.has('p1') ? 'move_battle' as const : 'pass' as const;
      if (card !== 'pass') placed.add(head);
      s = apply(s, head, { type: 'plan_action', card }).newState;
    }
    let g0 = 0;
    while (g0++ < 8 && s.gameState.activeAction?.ownerId !== 'p1') {
      s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).newState;
    }
    s = apply(s, 'p1', { type: 'move_units', from: p1base, to: nbr, units: ['warden'] }).newState;
    while (s.gameState.pending?.kind === 'battle_commit') {
      s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).newState;
    }
    // Drive to warden's activation.
    let guard2 = 0;
    while (s.gameState.battle && s.gameState.battle.phase === 'activations' && guard2++ < 12) {
      const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
      if (cur === undefined) break;
      if (s.gameState.pending?.kind === 'battle_defense') {
        s = apply(s, s.gameState.pending.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).newState;
        continue;
      }
      if (cur === 'warden') break;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    const r2 = apply(s, 'p1', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: s.gameState.battle!.units.find((u: { isHero: boolean }) => u.isHero && u.unitRef !== 'warden')!.unitRef } });
    s = r2.newState;
    // Exactly ONE credit — and with 4p needing 2, the game is NOT over.
    expect(s.gameState.players.find((p) => p.playerId === 'p1')!.leaderKills).toBe(1);
    expect(s.gameState.phase).not.toBe('game_over');
  });

  it("#5 attack damage includes the hero bonus through to lethality", () => {
    let s = base2p();
    placeUnit(s.gameState, 'rob', '-2,8', 'spinner'); // DEF 2 target... probe: Spinner next to Kestrel
    // Rob attacks with a Spinner + Kestrel — the wizard's Rook defends at DEF 4.
    s.gameState.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,6';
    placeUnit(s.gameState, 'rob', '-2,6', 'spinner');
    // wiz defender: Rook (hero, military DEF 4) at (-2,8).
    s.gameState.heroPool = s.gameState.heroPool.filter((h) => h !== 'rook');
    s.gameState.heroes.push({ id: 'rook', ownerId: 'wiz', coord: '-2,8', isLeader: false, dead: false });
    s = driveMoveBattle(s, 'rob');
    s = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [s.gameState.units.filter((u) => u.typeId === 'spinner').find((u) => u.ownerId === 'rob' && u.coord === '-2,6')!.id, 'kestrel'] }).newState;
    s = settleComm(s);
    // Queue order: Rook (I70, defenders first on the tie with Kestrel's I70) →
    // Kestrel → Spinner (I5). Pass the earlier ones, then the Spinner hits at
    // DMG 2 + Kestrel's +2 = 4 vs Rook's DEF 4.
    let bLive = s.gameState.battle!;
    const spin = bLive.units.find((u) => u.typeId === 'spinner')!;
    let guard5 = 0;
    while (guard5++ < 6) {
      bLive = s.gameState.battle!;
      const cur = bLive.activationQueue[bLive.activationCursor]!;
      if (cur === spin.unitRef) break;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    expect(s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]).toBe(spin.unitRef);
    const r = apply(s, 'rob', { type: 'battle_activation', unit: spin.unitRef, action: { kind: 'attack', target: 'rook' } });
    s = r.newState;
    // 2 + 2 (Kestrel) = 4 vs DEF 4 → Rook DIES. (Before the fix, raw dmg=2 lived.)
    expect(s.gameState.heroes.find((h) => h.id === 'rook')!.dead).toBe(true);
  });

  it("#6 a +1 DEF card on a Dragon survives a Spinner 2 (heroes too via effective stats)", () => {
    let s = base2p();
    placeUnit(s.gameState, 'wiz', '-2,8', 'dragon');
    deal(s.gameState, 'wiz', ['bonus-def-plus']);
    s = driveMoveBattle(s, 'rob');
    // rob's Spinner attacks the fortified Dragon — must NOT kill.
    s.gameState.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,6';
    placeUnit(s.gameState, 'rob', '-2,6', 'spinner');
    s = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [s.gameState.units.filter((u) => u.typeId === 'spinner').find((u) => u.ownerId === 'rob')!.id] }).newState;
    // Commitments: wiz plays its +1 DEF card.
    while (s.gameState.pending?.kind === 'battle_commit') {
      const forPid = s.gameState.pending.forPlayerId;
      s = apply(s, forPid, { type: 'commit_battle_card', card: forPid === 'wiz' ? 'Bonus (+1 DEF to all your units)' : null }).newState;
    }
    expect(s.gameState.battle!.phase).toBe('activations');
    // Dragon (I10) outranks the Spinner (I5) — the Dragon passes first.
    let spinId = s.gameState.battle!.units.find((u) => u.typeId === 'spinner')!.unitRef;
    while (s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor] !== spinId) {
      const cur = s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]!;
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    const b = s.gameState.battle!;
    const r = apply(s, 'rob', { type: 'battle_activation', unit: spinId, action: { kind: 'attack', target: b.units.find((u) => u.label === 'Dragon')!.unitRef } });
    s = r.newState;
    expect(s.gameState.units.some((u) => u.typeId === 'dragon')).toBe(true);
  });

  it('#7 Shared Tactics partners cannot commit the same physical instance', () => {
    let s = base2p();
    s.gameState.treaties.push({ type: 'shared-tactics', partners: ['wiz', 'rob'] });
    deal(s.gameState, 'rob', ['bonus-dmg-plus']);
    deal(s.gameState, 'wiz', ['bonus-def-plus']);
    placeUnit(s.gameState, 'wiz', '-2,8', 'evoker');
    s = driveMoveBattle(s, 'rob');
    placeUnit(s.gameState, 'rob', '-2,6', 'spitter');
    const sp = s.gameState.units.filter((u) => u.typeId === 'spitter').find((u) => u.ownerId === 'rob')!.id;
    s = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [sp] }).newState;
    // Both participants; rob commits its bonus first.
    if (s.gameState.pending?.kind === 'battle_commit') {
      const first = s.gameState.pending.forPlayerId;
      s = apply(s, first, { type: 'commit_battle_card', card: 'Bonus (+1 DMG to all your units)' }).newState;
    }
    // Then wiz commits — it may NOT pick the same instance out of rob's hand
    // (rob's hand no longer offers that id). wiz's own hand lacks Bonus(+DMG).
    expect(s.gameState.pending?.kind).toBe('battle_commit');
    const wizer = s.gameState.pending!.forPlayerId;
    expect(() => apply(s, wizer, { type: 'commit_battle_card', card: 'Bonus (+1 DMG to all your units)' }))
      .toThrowError(/already committed this battle/);
  });

  it('#8 a broke Evoker is offered no attack (mana gates the menu and the validator)', () => {
    let s = base2p();
    placeUnit(s.gameState, 'wiz', '-2,8', 'evoker');
    placeUnit(s.gameState, 'rob', '-2,8', 'spinner'); // the defender on the battle tile
    s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 0;
    s = driveMoveBattle(s, 'wiz');
    s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).newState;
    s = settleComm(s);
    // Drive to the evoker's activation.
    let guard = 0;
    const evokerId = s.gameState.units.find((u) => u.typeId === 'evoker' && u.ownerId === 'wiz')!.id;
    while (s.gameState.battle && s.gameState.battle.activationQueue[s.gameState.battle.activationCursor] !== evokerId && guard++ < 12) {
      const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    const menu = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation');
    expect(menu.some((m) => (m.move as Extract<NGGMove, { type: 'battle_activation' }>).action.kind === 'attack')).toBe(false);
    // And the validator refuses it too.
    expect(() => apply(s, 'wiz', { type: 'battle_activation', unit: evokerId, action: { kind: 'attack', target: s.gameState.battle!.units.find((u) => u.ownerId === 'rob')!.unitRef } }))
      .toThrowError(/1 mana/);
  });

  it('#9 Decoy without movement keeps the hero IN the battle', () => {
    let s = base2p();
    s.gameState.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    placeUnit(s.gameState, 'rob', '-2,8', 'spitter');
    s = driveMoveBattle(s, 'wiz');
    s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).newState;
    s = settleComm(s);
    s.gameState.players.find((p) => p.playerId === 'wiz')!.research.push('invisible');
    // rob's Spitter (I95) attacks Warden first — Warden has a spy → Decoy offer.
    const sp = s.gameState.battle!.units.find((u) => u.label === 'Spitter Platform')!;
    s = apply(s, 'rob', { type: 'battle_activation', unit: sp.unitRef, action: { kind: 'attack', target: 'warden' } }).newState;
    expect(s.gameState.pending?.kind).toBe('battle_defense');
    // wiz picks Decoy but does NOT move.
    s = apply(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'decoy', hero: 'warden' } }).newState;
    // The Warden hero remains at the battle tile AND still participates.
    expect(s.gameState.heroes.find((h) => h.id === 'warden')!.coord).toBe('-2,8');
    expect(s.gameState.battle?.units.some((u) => u.unitRef === 'warden')).toBe(true);
    // Warden will still activate later in the pass order.
  });

  it('#10 Ice Blast re-sorts the remaining queue mid-pass', () => {
    let s = base2p();
    placeUnit(s.gameState, 'wiz', '-2,6', 'evoker');
    placeUnit(s.gameState, 'rob', '-2,8', 'spinner');
    placeUnit(s.gameState, 'rob', '-2,8', 'spinner');
    s.gameState.players.find((p) => p.playerId === 'wiz')!.research.push('ice-blast');
    s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 5;
    s = driveMoveBattle(s, 'wiz');
    s = apply(s, 'wiz', { type: 'move_units', from: '-2,6', to: '-2,8', units: [s.gameState.units.find((u) => u.typeId === 'evoker')!.id] }).newState;
    s = settleComm(s);
    const b0 = s.gameState.battle!;
    // Order: Spinners I5... Evoker I50 first. Blast the FIRST spinner.
    const firstSpin = b0.units.find((u) => u.typeId === 'spinner')!.unitRef;
    expect(b0.activationQueue[b0.activationCursor]).toBe(s.gameState.units.find((u) => u.typeId === 'evoker')!.id);
    s = apply(s, 'wiz', { type: 'battle_activation', unit: s.gameState.units.find((u) => u.typeId === 'evoker')!.id, action: { kind: 'ability', ability: 'ice_blast', target: firstSpin } }).newState;
    const b1 = s.gameState.battle!;
    // The blasted spinner (−100 modifier) must be AFTER the untouched one in
    // the remaining order. Compare effective initiative (raw + modifiers).
    const others = b1.units.filter((u) => u.typeId === 'spinner');
    const withMod = others.map((u) => [u.unitRef, u.init + (b1.modifiers?.filter((m) => m.targetRef === u.unitRef).reduce((a, m) => a + (m.init ?? 0), 0) ?? 0)] as const);
    const highest = withMod.reduce((a, x) => ((x[1] ?? -Infinity) > (a[1] ?? -Infinity) ? x : a))[0];
    expect(b1.activationQueue[b1.activationCursor]).toBe(highest);
  });

  it("#11 Smyths milestone reward survives the claim (pending armed, then claims resume)", () => {
    // 4p so claims can multi-arm; wiz crosses a milestone and claims Smyth.
    const players: PlayerConfig[] = Array.from({ length: 4 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'human' as const }));
    let s = neitherGutsNorGears.createSession(players, { seed: 13, setupFirstPlayerId: 'p1' });
    s = apply(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism', p3: 'ledger', p4: 'foundry' } }).newState;
    const leaders: Record<string, string> = { p1: 'Warden Hesper Quill', p2: 'Dowser Wren Calloway', p3: 'Kestrel Nine', p4: 'Marshal Corvin Ashlock' };
    while (s.gameState.phase === 'setup_leaders') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).newState;
    }
    while (s.gameState.phase === 'setup_locations') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: { p4: '@4', p3: '@3', p2: '@2', p1: '@1' }[pend.forPlayerId]! }).newState;
    }
    s = keepCores(s);
    const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'p1')!;
    wiz.culture = 6; // the first 4p milestone is 7 (rulings #84, #119)
    wiz.subjects = 1; // +1 at income
    let guard = 0;
    while (s.gameState.phase !== 'claims' && guard++ < 30) {
      if (s.gameState.phase === 'planning') s = apply(s, s.gameState.planningOrder[0]!, { type: 'plan_action', card: 'pass' }).newState;
      else break;
    }
    // p1 crosses {7} and claims Smyth.
    expect(s.gameState.pending?.kind).toBe('choose_milestone_hero');
    const s2 = apply(s, s.gameState.pending!.forPlayerId, { type: 'choose_milestone_hero', hero: 'Dr. Elayn Smyth' });
    s = s2.newState;
    void wiz;
    void guard;
    // The free-research reward pending must SURVIVE the claim (was dropped before).
    expect(s.gameState.pending?.kind).toBe('smyth_reward');
    expect(s.gameState.pending!.forPlayerId).toBe('p1');
    // Resolving it lands the technology and resumes any remaining claims.
    s = apply(s, 'p1', { type: 'research', kind: 'tech', tech: 'Ice Blast', payment: [] }).newState;
    expect(s.gameState.players.find((p) => p.playerId === 'p1')!.research).toContain('ice-blast');
  });

  it('#12 the end-of-round treaty break window is real: Peace can be broken there', () => {
    let s = base2p();
    s.gameState.treaties.push({ type: 'peace', partners: ['wiz', 'rob'] });
    // Roll the round out with everyone passing.
    let guard = 0;
    while (guard++ < 40 && s.gameState.phase !== 'treaty_break' && s.gameState.phase !== 'end_of_round' && s.gameState.round === 1) {
      if (s.gameState.phase === 'planning') s = apply(s, s.gameState.planningOrder[0]!, { type: 'plan_action', card: 'pass' }).newState;
      else if (s.gameState.pending?.kind === 'report_draw') s = apply(s, s.gameState.pending.forPlayerId, { type: 'report_draw', card: 'Retreat' }).newState;
      else if (s.gameState.pending?.kind === 'smyth_reward') s = apply(s, s.gameState.pending.forPlayerId, { type: 'research', kind: 'tech', tech: 'Ice Blast', payment: [] }).newState;
      else if (s.gameState.phase === 'action' && s.gameState.activeAction) s = apply(s, s.gameState.activeAction.ownerId, { type: 'skip_action' }).newState;
      else if (s.gameState.pending?.kind === 'choose_milestone_hero') {
        // Adaptive claim: first species-eligible hero actually in the pool.
        const pid = s.gameState.pending.forPlayerId;
        const pSpecies = pid === 'wiz' ? 'wizard' : 'robot';
        const pick = s.gameState.heroPool.find((h) => { const d = HEROES.find((x) => x.id === h)!; return !d.species || d.species === pSpecies; })!;
        s = apply(s, pid, { type: 'choose_milestone_hero', hero: HEROES.find((x) => x.id === pick)!.name }).newState;
      } else break;
    }
    expect(s.gameState.pending?.kind).toBe('treaty_break_decision');
    // Asked in first-player order (§5.6): the first seat declines, the other
    // (still holding the same breakable Peace) breaks it.
    const g = s.gameState;
    const order = [g.players[g.firstPlayerIndex]!.playerId, g.players[(g.firstPlayerIndex + 1) % 2]!.playerId];
    expect(g.pending!.forPlayerId).toBe(order[0]);
    s = apply(s, order[0]!, { type: 'skip_action' }).newState;
    expect(s.gameState.pending).toMatchObject({ kind: 'treaty_break_decision', forPlayerId: order[1] });
    s = apply(s, order[1]!, { type: 'break_treaty', treaty_type: 'Peace', partner: order[0]! }).newState;
    expect(s.gameState.treaties.some((t) => t.type === 'peace')).toBe(false);
    // After the window closes, upkeep has run and the NEXT round is live.
    expect(['planning', 'upkeep', 'action', 'culture', 'claims']).toContain(s.gameState.phase);
  });

  it('#13 defense input validation rejects malformed steps and mana amounts', () => {
    let s = base2p();
    placeUnit(s.gameState, 'wiz', '-2,8', 'evoker');
    s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent = 1;
    s.gameState.players.find((p) => p.playerId === 'wiz')!.research.push('mana-shield');
    placeUnit(s.gameState, 'rob', '-2,6', 'spitter');
    s = driveMoveBattle(s, 'rob');
    s = apply(s, 'rob', { type: 'move_units', from: '-2,6', to: '-2,8', units: [s.gameState.units.filter((u) => u.typeId === 'spitter').find((u) => u.ownerId === 'rob')!.id] }).newState;
    s = settleComm(s);
    // Spitter (I95) attacks the Evoker (DEF 1): the Mana Shield window arms.
    const sp = s.gameState.battle!.units.find((u) => u.label === 'Spitter Platform')!;
    s = apply(s, 'rob', { type: 'battle_activation', unit: sp.unitRef, action: { kind: 'attack', target: s.gameState.battle!.units.find((u) => u.label === 'Evoker')!.unitRef } }).newState;
    expect(s.gameState.pending?.kind).toBe('battle_defense');
    // Negative mana must reject WITHOUT touching state.
    expect(() => apply(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'mana_shield', mana: -100 } })).toThrowError(/non-negative integer/i);
    expect(s.gameState.players.find((p) => p.playerId === 'wiz')!.manaCurrent).toBe(1);
    // Over-spending your wallet must reject, too.
    expect(() => apply(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'mana_shield', mana: 99 } })).toThrowError(/hold 1 mana/i);
    // A wrong-step defense (decoy when mana_shield is armed) must reject.
    expect(() => apply(s, 'wiz', { type: 'resolve_battle_defense', defense: { kind: 'decoy', hero: 'Evoker' } })).toThrowError(/window/i);
    // The pending is STILL armed for the right owner.
    expect(s.gameState.pending?.kind).toBe('battle_defense');
  });
});
