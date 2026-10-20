// AI determinism (ai-development §8): no Math.random anywhere in the AI; the
// same seed plays the same game move for move at every tier; different seeds
// differ. A stray unseeded roll would desync the desync harness's lockstep
// sessions and make balance batches unrepeatable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';

async function play(seed: number, tiers: string[], strategy?: string): Promise<string[]> {
  const ids = tiers.map((_, i) => String.fromCharCode(97 + i));
  let s = game.createSession(ids.map((id) => ({ player_id: id, kind: 'ai' })) as PlayerConfig[], { seed });
  const moves: string[] = [];
  while (!game.isGameOver(s) && moves.length < 3000) {
    const seat = s.gameState.pending!.seat;
    const r = await game.getAIMove!(s, seat, tiers[ids.indexOf(seat)]!, strategy);
    moves.push(JSON.stringify(r.move));
    s = game.applyMove(s, seat, r.move).newState;
  }
  expect(game.isGameOver(s)).not.toBeNull();
  return moves;
}

describe('AI determinism', () => {
  it('no Math.random in the AI files', () => {
    for (const f of ['ai.ts', 'aiPlanner.ts', 'mctsHooks.ts', 'engine.ts']) {
      expect(readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf-8'), f).not.toMatch(/Math\.random/);
    }
  });

  for (const tiers of [['easy', 'medium'], ['hard', 'medium', 'easy'], ['hard', 'hard', 'hard', 'hard']]) {
    it(`same seed, same game; different seed, different game (${tiers.join(' vs ')})`, async () => {
      const a = await play(21, tiers);
      const b = await play(21, tiers);
      const c = await play(22, tiers);
      expect(b).toEqual(a);
      expect(c).not.toEqual(a);
    });
  }

  it('a strategy lean is deterministic too', async () => {
    expect(await play(8, ['hard', 'hard'], 'hunter')).toEqual(await play(8, ['hard', 'hard'], 'hunter'));
  });
});
