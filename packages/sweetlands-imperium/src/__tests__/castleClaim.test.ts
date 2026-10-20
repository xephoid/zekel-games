import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

/** Pass every turn until the round counter reaches `untilRound`. */
function passUntilRound(state: SweetlandsState, untilRound: number): SweetlandsState {
  let s = state;
  let guard = 0;
  while (s.round < untilRound && s.phase === 'play' && guard++ < 200) {
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
  }
  return s;
}

/** Pass until it is `playerId`'s turn. */
function passTo(state: SweetlandsState, playerId: string): SweetlandsState {
  let s = state;
  let guard = 0;
  while (s.activePlayerId !== playerId && guard++ < 50) {
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
  }
  return s;
}

/** Fresh 2p game with the foe already defeated and a's leader in the castle.
 *  The claim itself is established by syncCastleClaim on the next applyMove. */
function castleGame(): SweetlandsState {
  const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
  s.foe = { type: 'dragon', defeated: true };
  s.players[0]!.units.leader = { zone: 'castle' };
  return s;
}

describe('castle claim lifecycle (leader_castle_uncontested)', () => {
  it('regression: leader enters then recalls out — the objective must NOT score later', () => {
    // Found 2026-08-30 by the rules-verification calibration run: the claim was
    // set on entry but never cleared, so a leader who left immediately still
    // scored "uncontested for 1 round" at a later scoring phase.
    let s = castleGame();
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState; // sync establishes the claim
    expect(s.castleOccupantId).toBe('a');

    s = passTo(s, 'a');
    s = applyMove(s, 'a', { type: 'recall', units: ['leader'] }).newState; // leader leaves the castle
    expect(s.players[0]!.units.leader.zone).not.toBe('castle');
    expect(s.castleOccupantId).toBeNull();
    expect(s.castleHeldSinceRound).toBeNull();

    s = passUntilRound(s, s.round + 3); // several scoring phases go by
    expect(s.players[0]!.publicObjectivesScored).not.toContain('leader_castle_uncontested');
  });

  it('leader that STAYS in the castle uncontested for a round does score', () => {
    let s = castleGame();
    const startRound = s.round;
    s = passUntilRound(s, startRound + 3);
    expect(s.players[0]!.publicObjectivesScored).toContain('leader_castle_uncontested');
  });

  it("another player's unit entering the castle contests it — no score, claim cleared", () => {
    let s = castleGame();
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState; // claim established
    expect(s.castleOccupantId).toBe('a');

    s.players[1]!.units.knight = { zone: 'castle' }; // intruder (any unit type contests)
    s = passUntilRound(s, s.round + 3);
    expect(s.castleOccupantId).toBeNull();
    expect(s.players[0]!.publicObjectivesScored).not.toContain('leader_castle_uncontested');
  });

  it('leaving and re-entering restarts the "uncontested for 1 round" clock', () => {
    let s = castleGame();
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
    const firstClaimRound = s.castleHeldSinceRound;
    expect(firstClaimRound).not.toBeNull();

    s = passTo(s, 'a');
    s = applyMove(s, 'a', { type: 'recall', units: ['leader'] }).newState;
    expect(s.castleHeldSinceRound).toBeNull();

    s = passUntilRound(s, s.round + 1); // move at least one round on
    const reEntryRound = s.round;
    s.players[0]!.units.leader = { zone: 'castle' };
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
    expect(s.castleOccupantId).toBe('a');
    expect(s.castleHeldSinceRound).toBeGreaterThanOrEqual(reEntryRound);
  });

  it('no claim while the foe still guards the castle', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    s.foe = { type: 'dragon', defeated: false };
    s.players[0]!.units.leader = { zone: 'castle' };
    const after = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
    expect(after.castleOccupantId).toBeNull();
  });
});
