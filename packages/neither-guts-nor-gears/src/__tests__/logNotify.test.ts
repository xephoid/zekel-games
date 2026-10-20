// Some log entries name the seats that must be told and acknowledge them: a
// death or a destroyed base to its owner, a spy's recruitment to everyone
// else, a treaty or access answer to whoever asked, a retreat to the rest of
// the battle, a stalemate to everyone in it.

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
  return s.gameState.log;
}

describe('who is told', () => {
  it('tells an owner of every loss, everyone else of a spy, and an asker of the answer', async () => {
    // Seeds 6 and 11: games with real losses under rulings #86-#100 (three starting Surfs); 7, 19 and 23 ended before any, then 16, 4 and 22.
    const log = (await Promise.all([6, 11].map((seed) => playOut(seed)))).flat();
    const losses = log.filter((e) => e.tone === 'loss' && e.category !== 'treaty');
    expect(losses.length).toBeGreaterThan(0);
    for (const e of losses) expect(e.notify, e.summary).toEqual([e.subject]);
    for (const e of log.filter((x) => x.category === 'hero-death' || x.category === 'destroyed')) {
      expect(e.notify?.length, e.summary).toBe(1);
    }
    for (const e of log.filter((x) => x.category === 'spy-recruitment')) {
      expect(e.notify).not.toContain(e.actor);
      expect(e.notify).toHaveLength(2);
    }
    for (const e of log.filter((x) => x.category === 'treaty' && /formed|declined/.test(x.headline ?? ''))) {
      expect(e.notify).toEqual([e.subject]);
    }
    for (const e of log.filter((x) => x.category === 'access' && x.headline)) expect(e.notify).toEqual([e.subject]);
    for (const e of log.filter((x) => (x.headline ?? '').startsWith('Stalemate'))) expect(e.notify!.length).toBeGreaterThanOrEqual(2);
    for (const e of log.filter((x) => x.category === 'retreat' && x.headline)) {
      expect(e.notify!.length).toBeGreaterThanOrEqual(1);
      expect(e.notify).not.toContain(e.actor);
    }
    // Nothing else asks for acknowledgement.
    const told = new Set(log.filter((e) => e.notify).map((e) => e.category));
    for (const c of told) expect(['hero-death', 'battle', 'battle-cards', 'destroyed', 'spy-recruitment', 'treaty', 'access', 'retreat']).toContain(c);
  }, 180_000);
});
