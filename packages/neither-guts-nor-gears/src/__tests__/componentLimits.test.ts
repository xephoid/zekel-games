// §7a component limits — the bounded quantities all enforced where they're
// spent/gained, locked with explicit rejection + conservation tests:
//  - 11 Surfs / 10 Subjects (#118) / 15 Cores per player (printed components)
//  - 2 claimed heroes per player (rules cap, not components)
//  - battle-deck 20-instance conservation through every move (covered per-move
//    in battlecards.test.ts; here the report_draw path is asserted directly)

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { physicalRemainderOf } from '../engine.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return neitherGutsNorGears.applyMove(s, playerId, move);
}

function wizBuildableSession(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 29, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).newState;
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).newState;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
  s = keepCores(s);
  // wiz takes a Build action.
  let placed = false;
  while (s.gameState.phase === 'planning') {
    const head = s.gameState.planningOrder[0]!;
    const want = head === 'wiz' && !placed;
    s = apply(s, head, { type: 'plan_action', card: want ? 'build' : 'pass' }).newState;
    if (want) placed = true;
  }
  expect(s.gameState.activeAction?.ownerId).toBe('wiz');
  return s;
}

function pay(coord: string) {
  return [{ collectorId: 'surf-x', coord }];
}

describe('component limits (PORT-RUNBOOK §7a)', () => {
  it('the 13th Surf build is rejected (two-player cap 12, ruling #89)', () => {
    let s = wizBuildableSession();
    // wiz owns 12 already (test-side ownership: Surfs are owned pieces
    // whether placed or on the faction board).
    const wiz = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    for (let i = 1; i <= 12; i++) wiz.collectorsAvailable[`surf-${i}`] = 1;
    wiz.research = [];
    // Menu never offers the 13th Surf.
    const menu = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    expect(menu.some((m) => m.move.type === 'build' && (m.move as { item: string }).item === 'Surf')).toBe(false);
    // And a declared one rejects at the validator.
    expect(() => apply(s, 'wiz', { type: 'build', item: 'Surf', payment: pay('-2,8') }))
      .toThrowError(/limited to 12/);
  });

  it('the 11th Subject purchase is rejected (cap 10, designer ruling #118)', () => {
    let s = wizBuildableSession();
    const wiz = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    wiz.subjects = 10;
    expect(() => apply(s, 'wiz', { type: 'build', item: 'Subject', payment: [{ collectorId: 'surf-0', coord: '-2,6' }] }))
      .toThrowError(/limited to 10/);
  });

  it('a Core purchase with the printed supply (15) exhausted rejects', () => {
    // Robot-driven Build session.
    const players: PlayerConfig[] = [
      { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
    ];
    let s = neitherGutsNorGears.createSession(players, { seed: 29, setupFirstPlayerId: 'wiz' });
    s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
    s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).newState;
    s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).newState;
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
    s = keepCores(s);
    let placed = new Set<string>();
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'rob' && !placed.has('rob') ? 'build' : head === 'wiz' && !placed.has('wiz') ? 'research' : 'pass';
      if (want !== 'pass') placed.add(head);
      s = apply(s, head, { type: 'plan_action', card: want }).newState;
    }
    if (s.gameState.activeAction?.ownerId !== 'rob') {
      s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' }).newState;
    }
    expect(s.gameState.activeAction?.ownerId).toBe('rob');
    const rob = s.gameState.players.find((p) => p.playerId === 'rob')!;
    rob.coresInSupply = 0; // the printed box holds 15 — all allocated
    // Pay with rob's committed water collector (its own tile).
    expect(() => apply(s, 'rob', { type: 'build', item: 'Core', payment: [{ collectorId: 'water-collector-rob', coord: '2,4' }] }))
      .toThrowError(/supply|empty|15|no.*[Cc]ore/);
  });

  it('the 2-hero cap: a milestone claim with 2 heroes owned surfaces no choices', () => {
    let s = wizBuildableSession();
    const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    g.heroPool = g.heroPool.filter((h) => h !== 'rook' && h !== 'elara');
    g.heroes.push({ id: 'rook', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    g.heroes.push({ id: 'elara', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    g.culture = 5;
    g.milestonesCrossed['wiz'] = [5];
    g.phase = 'claims';
    g.claimsOwed = { wiz: 1 };
    // The arm would find 'wiz' at cap → skips them → endOfRound.
    const { armClaims } = { armClaims: null };
    void armClaims;
    // Rather than reach internals: assert via the catalog that no
    // choose_milestone_hero pending surfaces with 2 heroes owned.
    const moves = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    expect(moves.some((m) => m.move.type === 'choose_milestone_hero')).toBe(false);
  });

  it('a physical report_draw refuses card names the derived remainder says are exhausted', () => {
    let s = wizBuildableSession();
    const g = s.gameState;
    // Spend both Counter copies: wiz holds one, the other is in the public discard.
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    const c1 = g.battleDeck.findIndex((id) => id.startsWith('counter-'));
    wiz.hand.push(g.battleDeck.splice(c1, 1)[0]!);
    g.cardOwners[wiz.hand[wiz.hand.length - 1]!] = 'wiz';
    const c2 = g.battleDeck.findIndex((id) => id.startsWith('counter-'));
    const disc = g.battleDeck.splice(c2, 1)[0]!;
    g.battleDiscard.push(disc);
    expect(physicalRemainderOf(g, 'counter')).toBe(0);
    // Now rob reports drawing a Counter: must reject (both copies accounted).
    g.pending = { kind: 'report_draw', forPlayerId: 'rob', reason: 'leader_grant' };
    expect(() => apply(s, 'rob', { type: 'report_draw', card: 'Counter' }))
      .toThrowError(/draw pile holds no "Counter"/i);
  });
});
