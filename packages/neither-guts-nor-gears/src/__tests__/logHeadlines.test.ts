// A player-facing log shows only what matters at a glance: each key entry
// carries a short headline beside its full summary (which keeps every detail,
// payments included, for MCP play), and a line about one seat also reads in
// the second person for that seat ("Your base at C4 was destroyed!").

import { describe, expect, it } from 'vitest';
import game from '../index.js';

const three = [
  { player_id: 'ai0', kind: 'ai' as const },
  { player_id: 'ai1', kind: 'ai' as const },
  { player_id: 'ai2', kind: 'ai' as const },
];

async function playOut(seed: number, maxMoves = 3000) {
  let s = game.createSession(three, { seed } as never);
  s.players = three as never;
  for (let i = 0; i < maxMoves && !s.gameState.result; i++) {
    const pid = s.activePlayerId;
    const { move } = await game.getAIMove(s, pid, 'easy');
    s = game.applyMove(s, pid, move).newState;
  }
  return game.getLog(s);
}

describe('log headlines', () => {
  it('marks the key events with short lines, named like the summaries, and keeps the rest as detail', async () => {
    // Seeds 13 and 28 (rulings #112-#114): between them a battle with an attack, a loss, a claim and a build. Earlier rules used 6 and 11, then 5 and 23.
    const log = (await Promise.all([13, 28].map((seed) => playOut(seed)))).flat();
    const keyed = log.filter((e) => e.headline !== undefined);
    expect(keyed.length).toBeGreaterThan(0);
    expect(keyed.length).toBeLessThan(log.length);
    const cats = new Set(keyed.map((e) => e.category));
    for (const c of ['build', 'battle', 'battle-cards', 'hero-claim']) expect(cats, c).toContain(c);
    // A loss for a seat reads to that seat as its own.
    const losses = keyed.filter((e) => e.tone === 'loss');
    expect(losses.length, 'something was lost').toBeGreaterThan(0);
    for (const e of keyed) {
      expect(e.headline!.length).toBeLessThan(160);
      for (const text of [e.headline!, e.subject_headline ?? '']) {
        expect(text).not.toMatch(/\bai[012]\b/);
        expect(text).not.toMatch(/-?\d+,-?\d+/);
      }
      expect(e.subject === undefined).toBe(e.subject_headline === undefined);
      if (e.subject_headline) expect(e.subject_headline).toMatch(/\b(You|Your|you|your)\b/);
      if (e.tone) expect(e.subject).toBeDefined();
    }
    // Culture income, action cards and the phases are key; payments and
    // Core arrangements stay detail.
    for (const c of ['income', 'planning', 'action', 'phase', 'movement']) expect(cats, c).toContain(c);
    // A move says how many units went, and from where to where.
    for (const e of keyed.filter((x) => x.category === 'movement')) expect(e.headline).toMatch(/ moved \d+ units? from [A-Z]\d+ to [A-Z]\d+$/);
    expect(keyed.some((e) => e.headline === 'Culture income')).toBe(true);
    expect(keyed.some((e) => e.headline === 'End of the round')).toBe(true);
    for (const e of log.filter((x) => ['payment', 'upkeep'].includes(x.category))) {
      expect(e.headline, e.summary).toBeUndefined();
    }
  }, 120_000);
});
