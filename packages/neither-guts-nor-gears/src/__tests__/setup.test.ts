// M1 setup pipeline lock. Fixture pinned by PORT-PLAN §7b: a scripted 4-player
// session (Leaders CHAIMIDIOUS (wizard 1), SMYTH (wizard 2), MARSHAL (robot 1),
// MOTHERBOARD (robot 2)), with Chaimidious's seat HUMAN PHYSICAL and
// Motherboard's seat AI, asserting the Leader benefits land as setup state and
// the battle deck accounting is exact. A vanilla-Leader control at all-physical
// seats asserts deck = 20 and all hands empty.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { cardByInstanceId, physicalRemainderOf } from '../engine.js';
import { BATTLE_CARDS } from '../data/catalogs.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function mkPlayers(): PlayerConfig[] {
  return [
    { player_id: 'w1', kind: 'human' }, // Chaimidious (human physical)
    { player_id: 'w2', kind: 'human' }, // Smyth
    { player_id: 'r1', kind: 'human' }, // Marshal (human)
    { player_id: 'r2', kind: 'ai' },    // Motherboard (AI)
  ];
}

function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): SessionState<NGGState> {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return r.newState;
}

/** Drive setup through to round 1 with a script. */
function setupNamed(options?: { vanillaLeaders?: boolean }): SessionState<NGGState> {
  const players = mkPlayers();
  let s = neitherGutsNorGears.createSession(players, { seed: 42, setupFirstPlayerId: 'w1', aiLeaderAssignment: ['Motherboard'] });
  // Factions: w1 Covenant(wiz), w2 Schism(wiz), r1 Ledger(robot), r2 Foundry(robot).
  s = apply(s, 'w1', { type: 'assign_setup_choices', selections: { w1: 'covenant', w2: 'schism', r1: 'ledger', r2: 'foundry' } });
  const leaders = options?.vanillaLeaders
    ? { w1: 'Warden Hesper Quill', w2: 'Dowser Wren Calloway', r1: 'Warden Hesper Quill', r2: 'Dowser Wren Calloway' }
    : { w1: 'Archmage Chaimidious', w2: 'Dr. Elayn Smyth', r1: 'Marshal Corvin Ashlock', r2: 'Motherboard' };
  // The draft runs in player order from the setup first player: w1, w2, r1, r2
  // (r2 is AI; its pick resolves inside the engine, and its pending for Motherboard
  // opens no human step). Drive off the live pending; settle nested grants inline.
  const leadersBySeat = options?.vanillaLeaders
    ? { w1: 'Warden Hesper Quill', w2: 'Dowser Wren Calloway', r1: 'Prospector Ida Marrs', r2: 'Kestrel Nine' }
    : { w1: 'Archmage Chaimidious', w2: 'Dr. Elayn Smyth', r1: 'Marshal Corvin Ashlock', r2: 'Motherboard' };
  while (s.gameState.phase === 'setup_leaders') {
    const pend = s.gameState.pending;
    if (pend?.kind === 'report_draw') {
      s = apply(s, pend.forPlayerId, { type: 'report_draw', card: 'Retreat' });
      continue;
    }
    if (pend?.kind === 'smyth_reward') {
      s = apply(s, pend.forPlayerId, { type: 'research', kind: 'tech', tech: 'Dehance', payment: [] });
      continue;
    }
    expect(pend?.kind).toBe('choose_leader');
    s = apply(s, pend!.forPlayerId, { type: 'choose_leader', hero: leadersBySeat[pend!.forPlayerId as keyof typeof leadersBySeat] });
  }
  // Starting locations: reverse order [r2(AI, auto), r1, w2, w1] — the AI pick
  // happens inside the engine; the first HUMAN pending is r1.
  const locOrder = ['r1', 'w2', 'w1'];
  const starts = ['@1', '@2', '@3'];
  let i = 0;
  while (s.gameState.phase === 'setup_locations') {
    const pend = s.gameState.pending;
    expect(pend?.kind).toBe('choose_starting_location');
    const pid = pend!.forPlayerId;
    expect(pid, `location pick ${i}`).toBe(locOrder[i]);
    s = apply(s, pid, { type: 'choose_starting_location', location: starts[i]! });
    i++;
  }
  return keepCores(s);
}

describe('M1 setup: named-Leader fixture (PORT-PLAN pinned)', () => {
  it('Chaimidious (human physical) is owed a report_draw at the Leader grant; reporting lands the card and conserves the deck', () => {
    // Run only w1's draft pick and stop at the pending.
    let s = neitherGutsNorGears.createSession(mkPlayers(), { seed: 42, setupFirstPlayerId: 'w1' });
    s = apply(s, 'w1', { type: 'assign_setup_choices', selections: { w1: 'covenant', w2: 'schism', r1: 'ledger', r2: 'foundry' } });
    expect(s.gameState.pending?.kind).toBe('choose_leader');
    s = apply(s, 'w1', { type: 'choose_leader', hero: 'Archmage Chaimidious' });
    // (a) the report_draw pending is owed to w1 immediately.
    expect(s.gameState.pending?.kind).toBe('report_draw');
    expect(s.gameState.pending?.forPlayerId).toBe('w1');
    const w1 = s.gameState.players.find((p) => p.playerId === 'w1')!;
    expect(w1.hand.length).toBe(0); // not yet settled
    // Report a Retreat card.
    s = apply(s, 'w1', { type: 'report_draw', card: 'Retreat' });
    const g = s.gameState;
    const w1After = g.players.find((p) => p.playerId === 'w1')!;
    expect(w1After.hand.length).toBe(1);
    expect(cardByInstanceId(w1After.hand[0]!)).toBe('retreat');
    // (a-deck) deck=19 across held-vs-server-dealt accounting: physical remainder
    // lost one Retreat; total across ALL zones = 20.
    const handsTotal = g.players.reduce((a, p) => a + p.hand.length, 0);
    expect(handsTotal).toBe(1);
    // Physical-view accounting: exactly one copy of 'retreat' left the table pile
    // (deck=19 across the derived remainder view; combined with hands = 20).
    expect(g.battleDeck.length).toBe(19);
    expect(physicalRemainderOf(g, 'retreat')).toBe(3);
    expect(g.battleDeck.length + handsTotal).toBe(20);
  });

  it('full 4p setup: Smyth holds a waived research (and its tech point), Marshal holds 4 action cards, Motherboard adds +1', () => {
    const s = setupNamed();
    const g = s.gameState;
    // Setup complete → round 1 began (upkeep rotated the token: planning starts
    // at the NEXT player after the setup first player, ruling 14).
    expect(g.phase).toBe('planning');
    expect(g.round).toBe(1);
    expect(g.players[g.firstPlayerIndex]!.playerId).toBe('w2');
    // (b) Smyth's owner holds the waived pick and its §12.5 point.
    const w2 = g.players.find((p) => p.playerId === 'w2')!;
    expect(w2.research).toContain('dehance');
    expect(w2.acquiredTypes).toContain('dehance');
    // (c) Marshal's owner has 4 action cards (base 3 + extra Move/Battle).
    const r1 = g.players.find((p) => p.playerId === 'r1')!;
    expect(r1.actionCards.build + r1.actionCards.moveBattle + r1.actionCards.research).toBe(4);
    expect(r1.actionCards.moveBattle).toBe(2);
    // (d) Motherboard's owner tech total = starting types + 1 bonus.
    const r2 = g.players.find((p) => p.playerId === 'r2')!;
    // Robot starting types: core, water-collector, wood-collector, home (4;
    // two water + two wood collectors, rulings #81/#85) + motherboard.
    expect(r2.acquiredTypes.length).toBe(4);
    expect(techTotals(g, 'r2')).toBe(5);
    // (e) non-benefit hands empty; deck short only by Leader draws (here: w1's).
    const handsTotal = g.players.reduce((a, p) => a + p.hand.length, 0);
    expect(handsTotal).toBe(1); // w1's reported Retreat
    expect(g.players.find((p) => p.playerId === 'w2')!.hand.length).toBe(0);
    expect(g.players.find((p) => p.playerId === 'r1')!.hand.length).toBe(0);
    // r2 (AI Motherboard): no card grant.
    expect(g.players.find((p) => p.playerId === 'r2')!.hand.length).toBe(0);
    // (f) a wizard without an Evoker starts with Surf + Castle; Chaimidious's
    // card adds the battle strategy card type (ruling #122).
    const w1 = g.players.find((p) => p.playerId === 'w1')!;
    expect(w1.acquiredTypes.sort()).toEqual(['battle-strategy-card', 'castle', 'surf']);
  });

  it('vanilla-Leader control (all physical): deck stays 20 and every hand is empty', () => {
    // All-human physical sessions; pick Leaders without card grants.
    const players: PlayerConfig[] = [
      { player_id: 'p1', kind: 'human' }, { player_id: 'p2', kind: 'human' },
      { player_id: 'p3', kind: 'human' }, { player_id: 'p4', kind: 'human' },
    ];
    let s = neitherGutsNorGears.createSession(players, { seed: 7, setupFirstPlayerId: 'p1' });
    s = apply(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism', p3: 'ledger', p4: 'foundry' } });
    const leaders = ['Warden Hesper Quill', 'Dowser Wren Calloway', 'Prospector Ida Marrs', 'Kestrel Nine'];
    for (let i = 0; i < 4; i++) {
      const pend = s.gameState.pending;
      expect(pend?.kind).toBe('choose_leader');
      s = apply(s, pend!.forPlayerId, { type: 'choose_leader', hero: leaders[i]! });
      // No vanilla Leader opens a nested pending.
    }
    for (let i = 0; i < 4; i++) {
      const pend = s.gameState.pending;
      expect(pend?.kind).toBe('choose_starting_location');
      s = apply(s, pend!.forPlayerId, { type: 'choose_starting_location', location: `@${i + 1}` });
    }
    s = keepCores(s);
    const g = s.gameState;
    expect(g.phase).toBe('planning');
    const handsTotal = g.players.reduce((a, p) => a + p.hand.length, 0);
    expect(handsTotal).toBe(0);
    expect(g.battleDeck.length).toBe(20);
    // The server-held order also exists for AI seats at other tables — here none
    // matter; the physical remainder IS the conservation anchor.
  });
});

function techTotals(g: NGGState, pid: string): number {
  const p = g.players.find((x) => x.playerId === pid)!;
  const bonus = g.heroes.filter((h) => h.ownerId === pid && !h.dead && h.coord !== null && (h.id === 'motherboard' || h.id === 'greymore')).length;
  return p.acquiredTypes.length + bonus;
}
