// Smyth's reward is a free, prerequisite-waived research pick (§8.4). A seat
// that has already researched every technology on its list has nothing to
// pick, so no pending may open — a pending with zero legal answers strands
// the game (balance batch 2026-09-22, hard technological mirror, 5p).

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import { applyHeroBenefit, byId } from '../engine.js';
import { researchForSpecies } from '../data/catalogs.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, pid: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, pid, move).newState;
}

function setUp(): NGGState {
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
  return structuredClone(s.gameState);
}

/** Put Smyth on the wizard's side as a placed, living hero. */
function giveSmyth(gs: NGGState): void {
  const base = gs.bases.find((b) => b.ownerId === 'wiz')!;
  gs.heroPool = gs.heroPool.filter((id) => id !== 'smyth');
  gs.heroes.push({ id: 'smyth', ownerId: 'wiz', coord: base.coord, isLeader: false, dead: false });
}

describe("Smyth's reward with nothing left to research", () => {
  it('opens the free pick while a technology remains', () => {
    const gs = setUp();
    giveSmyth(gs);
    applyHeroBenefit(gs, byId(gs, 'wiz'), 'smyth');
    expect(gs.pending).toMatchObject({ kind: 'smyth_reward', forPlayerId: 'wiz' });
  });

  it('opens no pending when every technology is researched, and says so in the log', () => {
    const gs = setUp();
    giveSmyth(gs);
    const p = byId(gs, 'wiz');
    p.research = researchForSpecies('wizard').map((r) => r.id);
    applyHeroBenefit(gs, p, 'smyth');
    expect(gs.pending).toBeNull();
    expect(gs.log.some((e) => /Smyth reward grants nothing/.test(e.summary))).toBe(true);
    // The seat is still on the clock with real moves, never a zero-option pending.
    const legal = neitherGutsNorGears.getLegalMoves({ ...neitherGutsNorGears.createSession([{ player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' }], { seed: 3, setupFirstPlayerId: 'wiz' }), gameState: gs }, gs.activePlayerId);
    expect(legal.length).toBeGreaterThan(0);
  });
});
