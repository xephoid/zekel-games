// A spy (Illusionist / Infiltrator) is an assignment carried by one of the
// buyer's heroes (§7.3 / §7.9). A seat with no living hero must not be offered
// or allowed the purchase: the recruitment would open a choose_spy pending with
// zero legal answers and strand the game. Found by the 2026-09-22 balance
// batch (five errored games, all a dead-Leader seat buying a spy).

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, pid: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, pid, move).newState;
}

/** A 2p session with the wizard's Build action live, three Surfs available,
 *  and the Library of Illusion already owned (so Illusionist is purchasable). */
function wizardBuildLive(): { s: SessionState<NGGState>; wiz: string } {
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
  // Only the wizard places a card, so its Build is the one live action.
  if (s.gameState.planningOrder[0] === 'wiz') {
    s = apply(s, 'wiz', { type: 'plan_action', card: 'build' });
    s = apply(s, 'rob', { type: 'plan_action', card: 'pass' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' });
  } else {
    s = apply(s, 'rob', { type: 'plan_action', card: 'pass' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'build' });
    s = apply(s, 'wiz', { type: 'plan_action', card: 'pass' });
  }
  expect(s.gameState.phase).toBe('action');
  expect(s.gameState.activeAction).toMatchObject({ ownerId: 'wiz', cardKind: 'build' });
  const gs = structuredClone(s.gameState);
  const p = gs.players.find((x) => x.playerId === 'wiz')!;
  p.buildings.push('Library of Illusion');
  p.buildingCounts['library-of-illusion'] = 1;
  p.collectorsAvailable['surf-3'] = 1;
  return { s: { ...s, gameState: gs }, wiz: 'wiz' };
}

describe('spy recruitment needs a living hero to carry it', () => {
  it('with a living Leader the Illusionist is offered', () => {
    const { s, wiz } = wizardBuildLive();
    const legal = neitherGutsNorGears.getLegalMoves(s, wiz);
    expect(legal.some((m) => m.move.type === 'build' && m.move.item === 'Illusionist')).toBe(true);
  });

  it('with every hero dead the Illusionist is neither offered nor accepted', () => {
    const { s: live, wiz } = wizardBuildLive();
    const gs = structuredClone(live.gameState);
    for (const h of gs.heroes) if (h.ownerId === wiz) h.dead = true;
    const s = { ...live, gameState: gs };
    const legal = neitherGutsNorGears.getLegalMoves(s, wiz);
    const offered = legal.find((m) => m.move.type === 'build' && m.move.item === 'Illusionist');
    expect(offered).toBeUndefined();
    // A declared purchase with a plausible payment is rejected up front, before payment checks.
    const attempt: NGGMove = {
      type: 'build', item: 'Illusionist',
      payment: [{ collectorId: 'surf-1', coord: '-2,8' }, { collectorId: 'surf-2', coord: '-1,9' }, { collectorId: 'surf-3', coord: '-1,11' }],
    };
    expect(() => neitherGutsNorGears.applyMove(s, wiz, attempt)).toThrowError(/no living hero/i);
    // Other purchases stay available — the seat is not locked out of Build.
    expect(legal.some((m) => m.move.type === 'build')).toBe(true);
  });
});
