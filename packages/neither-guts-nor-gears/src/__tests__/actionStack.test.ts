// §5.3: the Action Stack resolves LAST-IN, FIRST-OUT until it is EMPTY. Every
// card every seat placed gets its turn. Regression lock for the 2026-09-22
// finding: finishing one seat's card used to delete every other seat's card of
// the same kind (the removal matched on the kind-only slot id, not the owner),
// so at N players only three cards resolved per round — one Build, one
// Research, one Move/Battle for the whole table. Every balance number
// measured before this test was measured on that game, not the printed one.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, pid: string, move: NGGMove): SessionState<NGGState> {
  return neitherGutsNorGears.applyMove(s, pid, move).newState;
}

function planned2p(): SessionState<NGGState> {
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
  expect(s.gameState.phase).toBe('planning');
  return s;
}

/** Resolve whatever is live for the active seat by declining it (skip is
 *  always legal for a queued action, ruling 13) until the phase changes. */
function skipThroughActionPhase(s: SessionState<NGGState>): { s: SessionState<NGGState>; completed: string[] } {
  const completed: string[] = [];
  let guard = 0;
  while (s.gameState.phase === 'action' && guard++ < 50) {
    const pid = s.activePlayerId;
    const live = s.gameState.activeAction!;
    completed.push(`${live.ownerId}:${live.cardKind}`);
    s = apply(s, pid, { type: 'skip_action' });
  }
  return { s, completed };
}

describe('Action Stack resolves every placed card, LIFO, until empty (§5.3)', () => {
  it('two seats each place all three cards: six pops, in reverse placement order', () => {
    let s = planned2p();
    const order = [...s.gameState.planningOrder];
    const a = order[0]!; const b = order[1]!;
    // Interleaved planning, same kinds from both seats: a build, b build, a research, b research, a move, b move.
    s = apply(s, a, { type: 'plan_action', card: 'build' });
    s = apply(s, b, { type: 'plan_action', card: 'build' });
    s = apply(s, a, { type: 'plan_action', card: 'research' });
    s = apply(s, b, { type: 'plan_action', card: 'research' });
    s = apply(s, a, { type: 'plan_action', card: 'move_battle' });
    s = apply(s, b, { type: 'plan_action', card: 'move_battle' });
    s = apply(s, a, { type: 'plan_action', card: 'pass' });
    s = apply(s, b, { type: 'plan_action', card: 'pass' });
    expect(s.gameState.phase).toBe('action');
    expect(s.gameState.actionStack).toHaveLength(6);

    const { s: after, completed } = skipThroughActionPhase(s);
    // Last placed resolves first; nothing is dropped.
    expect(completed).toEqual([
      `${b}:move_battle`, `${a}:move_battle`,
      `${b}:research`, `${a}:research`,
      `${b}:build`, `${a}:build`,
    ]);
    expect(after.gameState.phase).not.toBe('action');
    expect(after.gameState.actionStack).toHaveLength(0);
    // The log carries one completion per placed card.
    const log = neitherGutsNorGears.getLog(after);
    expect(log.filter((e) => /action is complete$/.test(e.summary))).toHaveLength(6);
  });

  it('finishing one seat\'s card leaves the other seat\'s same-kind card on the stack, still face down', () => {
    let s = planned2p();
    const [a, b] = s.gameState.planningOrder as [string, string];
    s = apply(s, a, { type: 'plan_action', card: 'build' });
    s = apply(s, b, { type: 'plan_action', card: 'build' });
    s = apply(s, a, { type: 'plan_action', card: 'research' });
    s = apply(s, b, { type: 'plan_action', card: 'pass' });
    s = apply(s, a, { type: 'plan_action', card: 'pass' });
    // a's research popped first (placed last).
    expect(s.gameState.activeAction).toMatchObject({ ownerId: a, cardKind: 'research' });
    s = apply(s, a, { type: 'skip_action' });
    // Now b's Build is live and a's identical-kind Build is still queued.
    expect(s.gameState.phase).toBe('action');
    expect(s.gameState.activeAction).toMatchObject({ ownerId: b, cardKind: 'build' });
    expect(s.gameState.actionStack.map((e) => e.ownerId)).toEqual([a, b]);
    // The public view reveals only the live entry's kind; a's same-kind entry stays face down.
    const pub = neitherGutsNorGears.getPublicView(s) as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }> };
    expect(pub.action_stack.find((e) => e.owner === b)).toMatchObject({ card_kind: 'build' });
    expect(pub.action_stack.find((e) => e.owner === a)).toMatchObject({ face: 'down' });
    // And after b's Build completes, a's Build resolves rather than vanishing.
    s = apply(s, b, { type: 'skip_action' });
    expect(s.gameState.activeAction).toMatchObject({ ownerId: a, cardKind: 'build' });
  });
});
