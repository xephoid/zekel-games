// Regression lock: the harness caught a SAFETY_LIMIT — a refused collector
// access left the menu offering the SAME payment forever; a deterministic AI
// resubmitted it to a forever-refusing seat. The fix: refusals are recorded on
// the resolving action and suggestPayment excludes refused collectors.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, playerId, move).newState;
}

describe('access-refusal livelock regression (harness-harness SAFETY_LIMIT)', () => {
  it('after refusal, the menu no longer offers a payment needing that collector; the buyer can finish the action another way', () => {
    const players: PlayerConfig[] = [
      { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
    ];
    let s = neitherGutsNorGears.createSession(players, { seed: 29, setupFirstPlayerId: 'wiz' });
    s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } });
    s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' });
    s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' });
    s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' });
    s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' });
    s = keepCores(s);
    // Drive to wiz's Build action.
    let placed = false;
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'wiz' && !placed;
      s = apply(s, head, { type: 'plan_action', card: want ? 'build' : 'pass' });
      if (want) placed = true;
    }
    expect(s.gameState.activeAction?.ownerId).toBe('wiz');
    // wiz declares a Surf whose payment includes the opponent's collector tile:
    // the wiz Leader stands adjacent to rob's base so the anchor is legal.
    const robBase = s.gameState.bases.find((b) => b.ownerId === 'rob')!.coord;
    const [rc, rr] = robBase.split(',').map((v) => parseInt(v, 10));
    const nbr = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dc, dr]) => `${rc! + dc},${rr! + dr}`)
      .find((k) => s.gameState.tiles.some((t) => `${t.c},${t.r}` === k))!;
    s.gameState.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = nbr;
    // wiz builds a Subject (1Wa + 1Wo per §7.2): 1Wa from rob's base tile
    // (consent), 1Wo from (-1,9) anchored by wiz's base at (-2,10).
    s.gameState.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '1,3';
    const pay = [
      { collectorId: 'surf-1', coord: robBase },   // Wa on rob's tile — needs consent
      { collectorId: 'surf-2', coord: '-1,9' },    // Wo anchored by the wiz base
    ];
    s = apply(s, 'wiz', { type: 'build', item: 'Subject', payment: pay });
    expect(s.gameState.pending?.kind).toBe('access_request');
    expect(s.gameState.pending?.forPlayerId).toBe('rob');
    // rob REFUSES.
    s = apply(s, 'rob', { type: 'respond_access_request', grant: false });
    expect(s.gameState.pending).toBeNull();
    expect(s.gameState.activeAction?.ownerId).toBe('wiz');
    // The menu must NOT again offer a Surf whose payment includes robBase for wiz.
    const menu = neitherGutsNorGears.getLegalMoves(s, 'wiz');
    for (const m of menu) {
      if (m.move.type !== 'build') continue;
      const mm = m.move as Extract<NGGMove, { type: 'build' }>;
      expect(mm.payment?.some((c) => c.coord === robBase)).toBe(false);
    }
    // And the wiz can still end the action (skip or a revised build).
    expect(menu.some((m) => m.move.type === 'skip_action')).toBe(true);
  });
});
