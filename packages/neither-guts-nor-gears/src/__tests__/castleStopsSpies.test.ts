// Designer ruling #98 (2026-09-25): a wizard's Castle stops spies on its
// tile — in a battle there, neither Invisible nor Spy Attack can kill a hero
// on the Castle owner's side. The spy is not spent by the refusal. A robot's
// Home does not do this.

import { describe, expect, it } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { SessionState } from '@zekel/game-kit';
import { base2p, placeUnit } from './pendingFixtures.js';

function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return neitherGutsNorGears.applyMove(s, playerId, move);
}

/** Drive planning + the action stack until `mover` holds a resolving Move/Battle. */
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

function settleCommitments(s: SessionState<NGGState>): SessionState<NGGState> {
  let guard = 0;
  while (s.gameState.pending?.kind === 'battle_commit' && guard++ < 10) {
    s = apply(s, s.gameState.pending.forPlayerId, { type: 'commit_battle_card', card: null }).newState;
  }
  return s;
}

/** rob's Leader (Kestrel) carries a Spy Attack and moves onto wiz's starting
 *  Castle at (-2,10), where wiz's Leader (Warden) stands. With `castle`
 *  false the base is taken off that tile first. */
function spyAtCastle(castle: boolean): SessionState<NGGState> {
  let s = base2p();
  const g = s.gameState;
  g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
  if (!castle) g.bases = g.bases.filter((b) => !(b.ownerId === 'wiz' && b.coord === '-2,10'));
  g.players.find((p) => p.playerId === 'rob')!.spyAssignments.push({ source: 'infiltrator', heroId: 'kestrel', active: true });
  s = driveMoveBattle(s, 'rob');
  s = apply(s, 'rob', { type: 'move_units', from: '-2,8', to: '-2,10', units: ['kestrel'] }).newState;
  s = settleCommitments(s);
  expect(s.gameState.battle).not.toBeNull();
  let guard = 0;
  while (s.gameState.battle && s.gameState.battle.phase === 'activations' && guard++ < 12) {
    const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
    if (cur === undefined) break;
    if (s.gameState.pending?.kind === 'battle_defense') {
      s = apply(s, s.gameState.pending.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).newState;
      continue;
    }
    if (cur === 'kestrel') break;
    s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
  }
  expect(s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]).toBe('kestrel');
  return s;
}

const spyAttacks = (s: SessionState<NGGState>) => neitherGutsNorGears.getLegalMoves(s, 'rob')
  .filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'spy_attack');

describe('ruling #98: a Castle stops spies on its tile', () => {
  it("in a battle on a wizard's Castle, Spy Attack is neither offered nor accepted, and the spy stays hidden", () => {
    const s = spyAtCastle(true);
    expect(spyAttacks(s)).toHaveLength(0);
    expect(() => apply(s, 'rob', { type: 'battle_activation', unit: 'kestrel', action: { kind: 'spy_attack', target: 'warden' } })).toThrow(/Castle/);
    const rob = s.gameState.players.find((p) => p.playerId === 'rob')!;
    expect(rob.spyAssignments.some((x) => x.active && x.heroId === 'kestrel')).toBe(true);
  });

  it('without the Castle on that tile the same spy kill lands', () => {
    const s = spyAtCastle(false);
    expect(spyAttacks(s).length).toBeGreaterThan(0);
    const after = apply(s, 'rob', { type: 'battle_activation', unit: 'kestrel', action: { kind: 'spy_attack', target: 'warden' } }).newState;
    expect(after.gameState.phase).toBe('game_over');
    expect(after.gameState.result?.winners).toEqual(['rob']);
  });
  it("a robot's Home on the tile does not stop a spy", () => {
    let s = base2p();
    const g = s.gameState;
    // rob's Leader stands on a robot Home at (-2,8); wiz's Leader carries Invisible.
    g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
    g.bases.push({ id: 'base-rob-test', ownerId: 'rob', coord: '-2,8' });
    g.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
    g.players.find((p) => p.playerId === 'wiz')!.research.push('invisible');
    s = driveMoveBattle(s, 'wiz');
    s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).newState;
    s = settleCommitments(s);
    let guard = 0;
    while (s.gameState.battle && guard++ < 12) {
      const cur = s.gameState.battle.activationQueue[s.gameState.battle.activationCursor];
      if (cur === undefined || cur === 'warden') break;
      if (s.gameState.pending?.kind === 'battle_defense') {
        s = apply(s, s.gameState.pending.forPlayerId, { type: 'resolve_battle_defense', defense: { kind: 'none' } }).newState;
        continue;
      }
      s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
    }
    const offered = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'invisible');
    expect(offered.length).toBeGreaterThan(0);
  });
});
