// Quick MCTS integration test for Fractured Fist.
//
// FF has tiny state (~1KB) and benchmarks at 230k clones/sec, so MCTS
// runs fast here. This test verifies the wiring works and the engine
// produces legal moves from a real session.

import { describe, expect, it } from 'vitest';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { fracturedFist } from '../index.js';

describe('Generic MCTS on Fractured Fist', () => {
  it('FracturedFistGame exposes the MCTS hooks', () => {
    expect(typeof fracturedFist.getRewardForPlayer).toBe('function');
    expect(typeof fracturedFist.selectRolloutMove).toBe('function');
    expect(typeof fracturedFist.getHeuristicValue).toBe('function');
  });

  it('chooseMoveMCTS returns a legal move from initial state', () => {
    const state = fracturedFist.createSession([
      { player_id: 'ai1', kind: 'ai', difficulty: 'mcts' },
      { player_id: 'ai2', kind: 'ai', difficulty: 'mcts' },
    ]);
    const pid = state.activePlayerId;
    const legal = fracturedFist.getLegalMoves(state, pid);
    const result = chooseMoveMCTS(fracturedFist, state, pid, {
      max_iterations: 200,
      budget_ms: 10000,
      seed: 1,
    });
    const legalTypes = new Set(legal.map((lm) => lm.move.type));
    expect(legalTypes.has(result.move.type)).toBe(true);
    expect(result.root_visits).toBeGreaterThan(0);
  });

  it('candidates report valid avg_reward bounds', () => {
    const state = fracturedFist.createSession([
      { player_id: 'ai1', kind: 'ai', difficulty: 'mcts' },
      { player_id: 'ai2', kind: 'ai', difficulty: 'mcts' },
    ]);
    const pid = state.activePlayerId;
    const r = chooseMoveMCTS(fracturedFist, state, pid, {
      max_iterations: 150,
      budget_ms: 5000,
      seed: 7,
    });
    for (const c of r.candidates) {
      expect(c.avg_reward).toBeGreaterThanOrEqual(0);
      expect(c.avg_reward).toBeLessThanOrEqual(1);
    }
  });
});
