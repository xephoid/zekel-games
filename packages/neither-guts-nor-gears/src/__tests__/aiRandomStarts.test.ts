// Balance harness option (2026-10-09): `aiRandomStarts` makes AI seats draw a
// seeded random start tile instead of picking one, so a start tile can be
// measured apart from the order seats pick in.

import { describe, expect, it } from 'vitest';
import game from '../index.js';

const four = Array.from({ length: 4 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'ai' as const }));
function startsOf(seed: number, random: boolean): string {
  const g = game.createSession(four, { seed, ...(random ? { aiRandomStarts: true } : {}) } as never).gameState;
  return g.players.map((p) => g.bases.find((b) => b.ownerId === p.playerId)!.coord).join(' ');
}

describe('aiRandomStarts', () => {
  it('is seeded, and spreads the start tiles the hard AI would pick the same way', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => 900 + i);
    expect(seeds.map((s) => startsOf(s, true))).toEqual(seeds.map((s) => startsOf(s, true)));
    const picked = new Set(seeds.map((s) => startsOf(s, false)));
    const random = new Set(seeds.map((s) => startsOf(s, true)));
    expect(random.size).toBeGreaterThan(picked.size);
  });
});
