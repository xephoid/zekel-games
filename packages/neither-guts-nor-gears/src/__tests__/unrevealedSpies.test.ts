// Each seat's public view counts the spies it has recruited and not publicly
// revealed or spent. A spy that ends with its hero's death still counts: that
// end is not announced, so dropping it would tell the table which hero
// carried it.

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

import { killHero } from '../engine-battle.js';

const unrevealed = (s: SessionState<NGGState>, viewer: string, pid: string) =>
  ((neitherGutsNorGears.getPlayerView(s, viewer) as { players: Array<{ player_id: string; unrevealed_spies: number }> }).players.find((p) => p.player_id === pid)!.unrevealed_spies);

describe('unrevealed spies', () => {
  it('counts a recruited spy for every viewer, and a reveal takes it off', () => {
    const s = spyAtCastle(false);
    expect(unrevealed(s, 'wiz', 'rob')).toBe(1);
    expect(unrevealed(s, 'rob', 'rob')).toBe(1);
    expect(unrevealed(s, 'wiz', 'wiz')).toBe(0);
    const after = apply(s, 'rob', { type: 'battle_activation', unit: 'kestrel', action: { kind: 'spy_attack', target: 'warden' } }).newState;
    expect(unrevealed(after, 'wiz', 'rob')).toBe(0);
  });

  it("does not change when the spy's hero dies unseen", () => {
    const s = spyAtCastle(false);
    const g = structuredClone(s.gameState);
    const kestrel = g.heroes.find((h) => h.id === 'kestrel')!;
    killHero(g, kestrel, 'wiz', true, true);
    const after = { ...s, gameState: g };
    expect(g.players.find((p) => p.playerId === 'rob')!.spyAssignments.some((x) => x.active)).toBe(false);
    expect(unrevealed(after, 'wiz', 'rob')).toBe(1);
  });
});
