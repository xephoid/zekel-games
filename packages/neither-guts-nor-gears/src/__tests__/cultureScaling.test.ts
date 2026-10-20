// Rulings #83–#84 (2026-09-24): the Culture Treaty pays +5 like every other
// treaty, and the culture target (35 per player since #119) and the hero milestones
// (5/15/30/50/75 at two players, times players ÷ 2, rounded up) scale with
// player count.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { TREATIES, cultureTargetFor, milestonesFor } from '../data/catalogs.js';
import { beginCulturePhase, checkVictory, cultureIncomeFor } from '../engine.js';

function session(n: number) {
  const players = Array.from({ length: n }, (_, i) => ({ player_id: `ai${i}`, kind: 'ai' as const }));
  return game.createSession(players, { seed: 7 } as never);
}

describe('culture scales with player count', () => {
  it('target is 35 per player (ruling #119); milestones are shares of it, rounded up', () => {
    expect([2, 3, 4, 5, 6].map(cultureTargetFor)).toEqual([70, 105, 140, 175, 210]);
    expect(milestonesFor(2)).toEqual([4, 11, 21, 35, 53]);
    expect(milestonesFor(3)).toEqual([6, 16, 32, 53, 79]);
    expect(milestonesFor(4)).toEqual([7, 21, 42, 70, 105]);
    expect(milestonesFor(5)).toEqual([9, 27, 53, 88, 132]);
    expect(milestonesFor(6)).toEqual([11, 32, 63, 105, 158]);
  });

  it('each treaty type pays its own amount (ruling #112): Open Borders 5, Shared Resources 4, Peace 3, Shared Tactics 2, Culture Treaty 1', () => {
    expect(Object.fromEntries(TREATIES.map((t) => [t.id, t.cultureIncome]))).toEqual({
      'open-borders': 5, 'shared-resources': 4, 'peace': 3, 'shared-tactics': 2, 'culture-treaty': 1,
    });
  });

  it('at four players 139 culture does not win; 140 does', () => {
    const g = session(4).gameState;
    const p = g.players[0]!;
    p.culture = 139;
    expect(checkVictory(g, p.playerId)).toBe(false);
    p.culture = 140;
    expect(checkVictory(g, p.playerId)).toBe(true);
    expect(g.result?.summary).toMatch(/Cultural/);
  });

  it('at four players the first milestone is 7, not 4', () => {
    const g = session(4).gameState;
    for (const p of g.players) p.culture = 0;
    const p = g.players[0]!;
    // Income this round lands p between the two-player 4 and the scaled 7.
    p.culture = 6 - cultureIncomeFor(g, p);
    beginCulturePhase(g);
    expect(p.culture).toBe(6);
    expect(g.milestonesCrossed[p.playerId] ?? []).toEqual([]);
  });

  it('views show the scaled target and remaining milestones', () => {
    const s = session(6);
    const view = game.getPublicView(s) as { players: Array<{ culture_target: number; next_milestones: number[] }> };
    expect(view.players[0]!.culture_target).toBe(210);
    expect(view.players[0]!.next_milestones).toEqual(milestonesFor(6).filter((m) => m > s.gameState.players[0]!.culture));
  });
});
