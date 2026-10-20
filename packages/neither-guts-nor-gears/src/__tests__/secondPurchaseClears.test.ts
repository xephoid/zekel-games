// Foreman's second Build purchase (and Kettering's second Research purchase)
// resumes through a `second_purchase` pending. When that second purchase
// lands, the pending must be gone before the action card finishes — it used
// to survive the end of the round, so the seat was offered a Build during
// PLANNING, an access request could open with no action resolving, and the
// game stranded (ai-development batch 2026-09-22, 4p, seeds 2021021/2021059).

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, pid: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, pid, move).newState;
}

/** 2p, the wizard's Build live, Foreman placed at its base, four Surfs. */
function foremanBuildLive(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } });
  s = apply(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' });
  s = apply(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' });
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' });
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' });
  s = keepCores(s);
  if (s.gameState.planningOrder[0] === 'wiz') {
    s = apply(s, 'wiz', { type: 'plan_action', card: 'build' });
    s = apply(s, 'rob', { type: 'plan_action', card: 'pass' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' });
  } else {
    s = apply(s, 'rob', { type: 'plan_action', card: 'pass' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'build' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' });
  }
  expect(s.gameState.activeAction).toMatchObject({ ownerId: 'wiz', cardKind: 'build' });
  const gs = structuredClone(s.gameState);
  const base = gs.bases.find((b) => b.ownerId === 'wiz')!;
  gs.heroPool = gs.heroPool.filter((id) => id !== 'foreman');
  gs.heroes.push({ id: 'foreman', ownerId: 'wiz', coord: base.coord, isLeader: false, dead: false });
  const p = gs.players.find((x) => x.playerId === 'wiz')!;
  p.collectorsAvailable['surf-3'] = 1;
  p.collectorsAvailable['surf-4'] = 1;
  return { ...s, gameState: gs };
}

describe('a completed second purchase clears its pending', () => {
  it('Foreman: first purchase arms the second; the second lands and the action ends cleanly', () => {
    let s = foremanBuildLive();
    // Start @1 is the wood tile -2,10 with water at -2,8 and wood at -1,9 / -1,11.
    s = apply(s, 'wiz', { type: 'build', item: 'Subject', payment: [{ collectorId: 'surf-1', coord: '-2,8' }, { collectorId: 'surf-2', coord: '-1,9' }] });
    expect(s.gameState.pending).toMatchObject({ kind: 'second_purchase', forPlayerId: 'wiz' });
    s = apply(s, 'wiz', { type: 'build', item: 'Embassy', payment: [{ collectorId: 'surf-3', coord: '-1,11' }, { collectorId: 'surf-4', coord: '-2,10' }] });
    expect(s.gameState.players.find((x) => x.playerId === 'wiz')!.buildings).toContain('Embassy');
    // No leftover second-purchase right. The new Embassy unlocks treaties, so
    // the finished Build first offers its end-of-action treaty window
    // (§5.3/§11.1) — treaty offers or finishing, never another purchase.
    expect(s.gameState.pending).toBeNull();
    expect(s.gameState.activeAction?.endWindow).toBe(true);
    // The view says so, so a client can show the action as done.
    expect((neitherGutsNorGears.getPlayerView(s, 'wiz') as { resolving_action: { finished: boolean } }).resolving_action.finished).toBe(true);
    expect(neitherGutsNorGears.getLegalMoves(s, 'wiz').some((m) => m.move.type === 'build')).toBe(false);
    s = apply(s, 'wiz', { type: 'skip_action' });
    // The one card on the stack was the wizard's Build, so the action phase is over.
    expect(s.gameState.pending?.kind).not.toBe('second_purchase');
    expect(s.gameState.activeAction).toBeNull();
    expect(s.gameState.phase).not.toBe('action');
    // Whoever is on the clock now has only that phase's moves — never a Build.
    const legal = neitherGutsNorGears.getLegalMoves(s, s.activePlayerId);
    expect(legal.some((m) => m.move.type === 'build')).toBe(false);
  });

  it('declining the second purchase also clears it', () => {
    let s = foremanBuildLive();
    s = apply(s, 'wiz', { type: 'build', item: 'Subject', payment: [{ collectorId: 'surf-1', coord: '-2,8' }, { collectorId: 'surf-2', coord: '-1,9' }] });
    s = apply(s, 'wiz', { type: 'skip_action' });
    // The round runs on (the next upkeep may ask the robot about its Cores),
    // but no second-purchase right survives.
    expect(s.gameState.pending?.kind).not.toBe('second_purchase');
    expect(s.gameState.activeAction).toBeNull();
  });
});
