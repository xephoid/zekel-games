// Designer ruling #93 (2026-09-25): a standing Wall Platform stops spies —
// while one stands on a side, neither Invisible nor Spy Attack can kill a
// hero on that side. The spy is not spent by the refusal.

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

/** wiz's Leader (Warden) carries an Invisible spy and attacks rob's Leader
 *  (Kestrel) at (-2,8); with `wall`, a robot Wall Platform stands there too. */
function battleWithSpy(wall: boolean): SessionState<NGGState> {
  let s = base2p();
  const g = s.gameState;
  g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8';
  if (wall) placeUnit(g, 'rob', '-2,8', 'wall-platform');
  g.players.find((p) => p.playerId === 'wiz')!.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
  g.players.find((p) => p.playerId === 'wiz')!.research.push('invisible');
  s = driveMoveBattle(s, 'wiz');
  s = apply(s, 'wiz', { type: 'move_units', from: '-2,10', to: '-2,8', units: ['warden'] }).newState;
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
    if (cur === 'warden') break;
    s = apply(s, s.gameState.activePlayerId, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } }).newState;
  }
  expect(s.gameState.battle!.activationQueue[s.gameState.battle!.activationCursor]).toBe('warden');
  return s;
}

describe('ruling #93: Wall Platforms stop spies', () => {
  it('with a Wall standing on the robot side, Invisible is neither offered nor accepted, and the spy stays hidden', () => {
    const s = battleWithSpy(true);
    const offered = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'invisible');
    expect(offered).toHaveLength(0);
    expect(() => apply(s, 'wiz', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: 'kestrel' } })).toThrow(/Wall Platform/);
    const wiz = s.gameState.players.find((p) => p.playerId === 'wiz')!;
    expect(wiz.spyAssignments.some((x) => x.active && x.heroId === 'warden')).toBe(true);
    expect(s.gameState.phase).not.toBe('game_over');
  });

  it('without the Wall the same spy kill lands', () => {
    const s = battleWithSpy(false);
    const offered = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'invisible');
    expect(offered.length).toBeGreaterThan(0);
    const after = apply(s, 'wiz', { type: 'battle_activation', unit: 'warden', action: { kind: 'invisible', target: 'kestrel' } }).newState;
    expect(after.gameState.phase).toBe('game_over');
    expect(after.gameState.result?.winners).toEqual(['wiz']);
  });
});
