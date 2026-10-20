// The log and each move's summary tell the table everything that happened —
// who attacked whom with what numbers, what each card did — and nothing that
// is still secret: face-down action cards, battle cards before the reveal,
// the hero a spy hides on, a card a human drew.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { BATTLE_CARDS, HEROES } from '../data/catalogs.js';
import type { NGGMove } from '../types.js';

const three = [
  { player_id: 'ai0', kind: 'ai' as const },
  { player_id: 'ai1', kind: 'ai' as const },
  { player_id: 'ai2', kind: 'ai' as const },
];

type Step = { pid: string; move: NGGMove; summary: string; narration: string; battleStillCommitting: boolean };

// "easy" (the classic AI's medium) still fights with ordinary attacks at
// three players; hard's kills are spy reveals. Seeds 6 and 10 hold battles
// with ordinary attacks since AI seats draw an opening goal (2026-10-08); 4
// and 5 did under rulings #124-#129 (same day); 6 and 8 did
// after the AI's Leader pick learned Dowser (same day); 1 and 2 did under rulings #86–#121 (Detection removed); 7 and 19 before
// them, then 8 and 24, 5 and 4, 16 and 4, 6 and 11, 5 and 23, 13 and 28,
// then 19 and 22.
async function play(seed: number, maxMoves = 3000): Promise<Step[]> {
  let s = game.createSession(three, { seed } as never);
  s.players = three as never;
  const steps: Step[] = [];
  for (let i = 0; i < maxMoves && !s.gameState.result; i++) {
    const pid = s.activePlayerId;
    const { move, narration } = await game.getAIMove(s, pid, 'easy');
    const r = game.applyMove(s, pid, move);
    s = r.newState;
    steps.push({ pid, move, summary: r.summary, narration, battleStillCommitting: s.gameState.battle?.phase === 'commit' });
  }
  return steps;
}

const cardLabels = BATTLE_CARDS.map((c) => c.label);

describe('log detail and privacy', () => {
  it('describes battles fully, names seats by faction, and hides secrets', async () => {
    const steps = (await Promise.all([6, 10].map((seed) => play(seed)))).flat();
    const attacks = steps.filter((x) => / attacks .*: \d+ damage against defense \d+/.test(x.summary));
    expect(attacks.length, 'some unit attacked').toBeGreaterThan(0);
    expect(steps.some((x) => /A battle begins at [A-Z]\d+; .* Attacking: .*initiative \d+, damage \d+, defense \d+/.test(x.summary))).toBe(true);
    for (const x of steps) {
      // Seats are named, never by player id; tiles by label, never "c,r".
      expect(x.summary).not.toMatch(/\bai[012]\b/);
      expect(x.summary).not.toMatch(/-?\d+,-?\d+/);
      // The AI's narration is the public summary — never its private plan.
      expect(x.narration).toBe(x.summary);
      if (x.move.type === 'plan_action' && x.move.card !== 'pass') {
        expect(x.summary).toMatch(/face down/);
        expect(x.summary).not.toMatch(/Build|Research|Move\/Battle|move_battle/);
      }
      if (x.move.type === 'commit_battle_card' && x.battleStillCommitting) {
        for (const label of cardLabels) expect(x.summary).not.toContain(label);
      }
      if (x.move.type === 'choose_spy') {
        const hero = HEROES.find((h) => h.id === x.move.hero || h.name === x.move.hero);
        if (hero) expect(x.summary).not.toContain(hero.name);
      }
    }
  }, 120_000);

  it('a human’s drawn card goes to them privately, not into the summary or log', () => {
    const players = [{ player_id: 'zeke', kind: 'human' as const, name: 'Zeke' }, { player_id: 'ai1', kind: 'ai' as const }];
    const s = game.createSession(players, { seed: 3 } as never);
    s.players = players as never;
    s.gameState.pending = { kind: 'report_draw', forPlayerId: 'zeke', reason: 'leader-grant' } as never;
    s.gameState.activePlayerId = 'zeke'; s.activePlayerId = 'zeke';
    const label = 'Counter';
    const report = { move: { type: 'report_draw', card: label } as NGGMove };
    const r = game.applyMove(s, 'zeke', report.move);
    expect(r.summary).toMatch(/^Zeke drew a battle strategy card/);
    expect(r.summary).not.toContain(label);
    expect(r.privateReveals).toEqual([{ player_id: 'zeke', text: expect.stringContaining(label) }]);
    for (const e of game.getLog!(r.newState)) expect(e.summary).not.toContain(`"${label}"`);
  });
});
