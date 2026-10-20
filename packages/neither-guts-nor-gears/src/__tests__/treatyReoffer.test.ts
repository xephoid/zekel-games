// A declined treaty offer cannot be re-offered to the same partner in the
// same round (engine ruling 2026-09-22). Found by the training gate: a
// learner seat playing the OFFERED list re-offered Shared Tactics 1,447 times
// in one round until the episode budget ran out. The built-in AI never
// repeats a declined offer, so no harness batch could see it.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, pid: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, pid, move).newState;
}

/** 2p, the wizard's Build live with an Embassy already owned, so treaty offers are on the menu. */
function wizardWithEmbassy(): SessionState<NGGState> {
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
  const gs = structuredClone(s.gameState);
  const p = gs.players.find((x) => x.playerId === 'wiz')!;
  p.buildings.push('Embassy');
  p.buildingCounts['embassy'] = 1;
  return { ...s, gameState: gs };
}

describe('a declined treaty offer is off the menu for the rest of the round', () => {
  it('offer, decline, then the same offer is neither offered nor accepted; other treaties stay open', () => {
    let s = wizardWithEmbassy();
    const offers = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'form_treaty');
    expect(offers.some((m) => m.move.type === 'form_treaty' && m.move.treaty_type === 'Shared Tactics')).toBe(true);
    s = apply(s, 'wiz', { type: 'form_treaty', partner: 'rob', treaty_type: 'Shared Tactics' });
    expect(s.gameState.pending).toMatchObject({ kind: 'treaty_response', forPlayerId: 'rob' });
    s = apply(s, 'rob', { type: 'respond_treaty', accept: false });
    expect(s.gameState.pending).toBeNull();
    const after = neitherGutsNorGears.getLegalMoves(s, 'wiz').filter((m) => m.move.type === 'form_treaty');
    expect(after.some((m) => m.move.type === 'form_treaty' && m.move.treaty_type === 'Shared Tactics')).toBe(false);
    expect(after.some((m) => m.move.type === 'form_treaty' && m.move.treaty_type === 'Open Borders')).toBe(true);
    expect(() => neitherGutsNorGears.applyMove(s, 'wiz', { type: 'form_treaty', partner: 'rob', treaty_type: 'Shared Tactics' }))
      .toThrowError(/already declined Shared Tactics/);
    // The Build action itself is still live for the wizard.
    expect(s.gameState.activeAction).toMatchObject({ ownerId: 'wiz', cardKind: 'build' });
  });
});
