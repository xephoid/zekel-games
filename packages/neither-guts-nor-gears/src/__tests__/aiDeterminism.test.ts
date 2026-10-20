// The AI must be DETERMINISTIC from the session seed: two games created with
// the same seed and stepped by the same policy must produce the identical move
// sequence. The desync harness runs reference + model in lockstep, so a stray
// Math.random or a non-advancing "seeded" pick reads as a phantom desync no
// assistant error can explain.
// The original port indexed the legal set by `state.seed % 1000003` — the seed
// never advances between calls, so identical states picked the identical index
// forever (also a fake-random floor tier). The fix: every tier reads a
// seeded rng advanced by state salt; no Math.random anywhere in the AI.

import { describe, expect, it } from 'vitest';
import { neitherGutsNorGears as game } from '../index.js';
import { chooseMove } from '../ai.js';
import type { SessionState } from '@zekel/game-kit';
import type { NGGState } from '../types.js';

function playOut(seed: number, players = 3, maxMoves = 4000, difficulty: 'medium' | 'hard' = 'medium'): string[] {
  const cfgs = Array.from({ length: players }, (_, i) => ({ player_id: `ai${i + 1}`, kind: 'ai' as const }));
  let s: SessionState<NGGState> = game.createSession(cfgs, { seed });
  const moves: string[] = [];
  let guard = maxMoves;
  while (!game.isGameOver(s) && guard > 0) {
    const pid = s.activePlayerId;
    const legal = game.getLegalMoves(s, pid);
    if (legal.length === 0) break;
    const { move } = chooseMove(s.gameState, pid, difficulty);
    moves.push(`${pid}:${JSON.stringify(move)}`);
    s = game.applyMove(s, pid, move).newState as SessionState<NGGState>;
    guard -= 1;
  }
  return moves;
}

describe('AI is deterministic from the seed', () => {
  it('two identical-seed playouts produce the identical move sequence', () => {
    const a = playOut(1);
    const b = playOut(1);
    expect(a.length).toBeGreaterThan(20);
    expect(a).toEqual(b);
  });

  it('the hard planner is deterministic too', () => {
    expect(playOut(3, 2, 4000, 'hard')).toEqual(playOut(3, 2, 4000, 'hard'));
  });

  it('different seeds produce different play (the seeded rng still varies)', () => {
    const a = playOut(1);
    const c = playOut(2);
    expect(a).not.toEqual(c);
  });

  it('the random tier is a true random floor (varies across seeds, deterministic per seed)', () => {
    // Same seed → same sequence.
    const a = randomPlayOut(1);
    const b = randomPlayOut(1);
    expect(a).toEqual(b);
    // Different seeds → different sequences (the fix for the frozen-seed bug).
    const c = randomPlayOut(2);
    expect(a).not.toEqual(c);
  });
});

function randomPlayOut(seed: number): string[] {
  const cfgs = [{ player_id: 'ai1', kind: 'ai' as const }, { player_id: 'ai2', kind: 'ai' as const }];
  let s: SessionState<NGGState> = game.createSession(cfgs, { seed });
  const moves: string[] = [];
  let guard = 4000;
  while (!game.isGameOver(s) && guard > 0) {
    const pid = s.activePlayerId;
    const legal = game.getLegalMoves(s, pid);
    if (legal.length === 0) break;
    const { move } = chooseMove(s.gameState, pid, 'random');
    moves.push(JSON.stringify(move));
    s = game.applyMove(s, pid, move).newState as SessionState<NGGState>;
    guard -= 1;
  }
  return moves;
}
