// AI development 2026-09-25: three things the hard AI could not see.
//   1. The damage kit — a 3-damage body plus Rook / Kestrel's +2 — is a
//      military plan, claimable at milestones, not only what stands today.
//   2. Its economy read no longer assumes rivals will grant access: a tile
//      another seat holds is out of a spend's reach.
//   3. The planner's kills-needed table follows ruling #95.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { militaryThreshold } from '../engine.js';
import { damageKit, militaryRead, roundsToNextMilestone } from '../ai-military.js';
import { econFromState, ECONOMIC_SPEND_ID, payProfiles } from '../ai-econ.js';
import { base2p, placeUnit } from './pendingFixtures.js';
import type { NGGState } from '../types.js';

/** rob's Leader made a culture hero: defence 5, where Kestrel (military)
 *  has 6. The kill reads play the battle out with the real numbers. */
function softRobLeader(g: NGGState): void {
  const l = g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!;
  l.id = 'chronicler';
  g.heroPool = g.heroPool.filter((h) => h !== 'chronicler');
}

describe('1. the damage kit is a military plan', () => {
  it('a 3-damage Leader with Rook in the pool reads a finite damage-kit clock: claiming Rook is the missing piece', () => {
    const s = base2p(); const g = s.gameState;
    softRobLeader(g);
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    // Warden (military, 3 damage) is wiz's Leader in the fixture; give it some income.
    wiz.subjects = 3; wiz.culture = 2;
    expect(g.heroPool).toContain('rook');
    const kit = damageKit(g, wiz, econFromState(g, wiz), 'rob');
    expect(kit.rounds).toBeLessThan(40);
    expect(kit.missing).toHaveLength(1);
    expect(roundsToNextMilestone(g, wiz)).toBe(1); // 2 culture + 3 a round crosses 5 next income
    // Read from rob's seat: the striker is wiz's Leader, which wiz's own plan leaves home.
    const withKit = militaryRead(g, wiz, 'rob', { econ: econFromState(g, wiz) });
    expect(withKit.eta).toBeLessThan(40);
  });

  it('Rook beside a 3-damage Leader makes the damage line immediate; against a military Leader (defence 6) it does not', () => {
    const s = base2p(); const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    const leader = g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!;
    g.heroPool = g.heroPool.filter((h) => h !== 'rook');
    g.heroes.push({ id: 'rook', ownerId: 'wiz', coord: leader.coord, isLeader: false, dead: false });
    // Body (Warden, 3) + Rook's +2 = 5: short of Kestrel's 6 as a Leader.
    // Read from rob's seat: Warden is wiz's Leader.
    expect(militaryRead(g, wiz, 'rob').line).not.toBe('damage');
    softRobLeader(g);
    expect(militaryRead(g, wiz, 'rob').line).toBe('damage');
  });
});

describe('2. the economy read does not assume access', () => {
  it('a rival standing on the oil and ether tiles takes the spend out of reach', () => {
    const s = base2p(); const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    const open = payProfiles(g, wiz).profiles[ECONOMIC_SPEND_ID];
    expect(open).not.toBeNull();
    // The two-player map has two oil (E4, E5) and two ether (D4, F4) tiles.
    for (const c of ['0,6', '0,8', '-1,7', '1,7']) placeUnit(g, 'rob', c, 'spinner');
    expect(payProfiles(g, wiz).profiles[ECONOMIC_SPEND_ID]).toBeNull();
  });

  it('a Shared Resources partner\'s tiles stay open', () => {
    const s = base2p(); const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    for (const c of ['0,6', '0,8', '-1,7', '1,7']) placeUnit(g, 'rob', c, 'spinner');
    g.treaties.push({ type: 'shared-resources', partners: ['wiz', 'rob'] });
    expect(payProfiles(g, wiz).profiles[ECONOMIC_SPEND_ID]).not.toBeNull();
  });
});

describe('3. kills needed follow the rules', () => {
  it('two kills at four, five and six players', () => {
    expect([2, 3, 4, 5, 6].map(militaryThreshold)).toEqual([1, 1, 2, 2, 2]);
  });

  it('a full AI game still runs clean at four players', async () => {
    const players = Array.from({ length: 4 }, (_, i) => ({ player_id: `ai${i}`, kind: 'ai' as const }));
    let s = game.createSession(players, { seed: 11 } as never);
    s.players = players as never;
    let n = 0;
    while (!s.gameState.result && n++ < 3000) {
      const pid = s.activePlayerId;
      const { move } = await game.getAIMove(s, pid, 'hard');
      s = game.applyMove(s, pid, move).newState;
    }
    expect(s.gameState.result).toBeTruthy();
  }, 180_000);
});
