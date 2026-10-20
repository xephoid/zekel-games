// M6 scoring & victory — PORT-PLAN §7b M6 (a)–(h), replaying §14.6–§14.7:
// income-before-claims ordering, mid-income victory cutting claims off,
// dead-Leader no-initiate + Culture-Treaty sharing, the all-dead draw, the
// 3p first-kill end, the Economic spend, tech totals with bonuses, and the
// eligibility reject (ruling 74) on every path.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { checkAllLeadersDeadDraw, checkVictory, techTotal } from '../engine.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove): { s: SessionState<NGGState>; summary: string } {
  const r = neitherGutsNorGears.applyMove(s, playerId, move);
  return { s: r.newState, summary: r.summary };
}

/** 2p humans through setup with wizard 'wiz' + robot 'rob'. */
function baseSession2p(wizLeader = 'Warden Hesper Quill', robLeader = 'Kestrel Nine'): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 5, setupFirstPlayerId: 'wiz' });
  s = apply(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).s;
  s = apply(s, 'wiz', { type: 'choose_leader', hero: wizLeader }).s;
  s = apply(s, 'rob', { type: 'choose_leader', hero: robLeader }).s;
  s = apply(s, 'rob', { type: 'choose_starting_location', location: '@2' }).s;
  s = apply(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).s;
  s = keepCores(s);
  return s;
}

/** 4p humans through setup, wizard a + wizard b, robot c, robot d. */
function baseSession4p(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'a', kind: 'human' }, { player_id: 'b', kind: 'human' },
    { player_id: 'c', kind: 'human' }, { player_id: 'd', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 13, setupFirstPlayerId: 'a' });
  s = apply(s, 'a', { type: 'assign_setup_choices', selections: { a: 'covenant', b: 'schism', c: 'ledger', d: 'foundry' } }).s;
  const leaders: Record<string, string> = { a: 'Warden Hesper Quill', b: 'Dowser Wren Calloway', c: 'Kestrel Nine', d: 'Marshal Corvin Ashlock' };
  while (s.gameState.phase === 'setup_leaders') {
    const pend = s.gameState.pending!;
    s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).s;
  }
  const spots: Record<string, string> = { d: '@4', c: '@3', b: '@2', a: '@1' };
  while (s.gameState.phase === 'setup_locations') {
    const pend = s.gameState.pending!;
    s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: spots[pend.forPlayerId]! }).s;
  }
  return keepCores(s);
}

function killLeader(g: NGGState, pid: string, killerId: string): void {
  const hero = g.heroes.find((h) => h.ownerId === pid && h.isLeader)!;
  hero.dead = true;
  const killer = g.players.find((p) => p.playerId === killerId)!;
  killer.leaderKills += 1;
}

describe('M6 scoring & victory (§14.6–§14.7 replay)', () => {
  it("(a) §14.6 income ordering at 4p (milestones 7/21/42/70/105, #119): first player's 20+32→52 crosses {21,42}; later player's 5+2→7 crosses {7}; claim order first→later→first; Chronicler adds nothing retroactively", () => {
    let s = baseSession4p();
    const g = s.gameState;
    // Set the stage: a (first-player-order head after upkeep rotation is b;
    // §14.6's "first player" is first in FPO. Set cultures directly and give
    // everyone a treaty-free board; then drive the round out.
    // The 4 seats after rotation: b, c, d, a. §14.6 names "first player" =
    // the FPO head. We model: b has 14 culture and Subjects giving +16; d has 4
    // and a Subject-equivalent +1 (d is robot — +1 via an unallocated Core).
    // Four players: 35 per player (ruling #119 — milestones 7/21/42/70/105,
    // target 140).
    byId(g, 'b').culture = 20;
    byId(g, 'b').subjects = 32; // wizards: 32 Subjects * +1 = +32 (test-side big)
    byId(g, 'd').culture = 5;
    byId(g, 'd').coresInReserve = 2; // robot +1 per unallocated Core
    // Drive: no one places anything → culture phase runs.
    let guard = 0;
    while (s.gameState.phase !== 'culture' && guard++ < 20) {
      if (s.gameState.phase === 'planning') {
        s = apply(s, s.gameState.planningOrder[0]!, { type: 'plan_action', card: 'pass' }).s;
      } else break;
    }
    expect(s.gameState.phase).toBe('claims');
    // Read fresh: apply() clones per move, so the culture phase's state is on s.
    // b crossed 21 and 42 (owed 2); d crossed 7 (owed 1). Alternating FPO order.
    const fresh = s.gameState;
    expect(fresh.claimsOwed['b']).toBe(2);
    expect(fresh.claimsOwed['d']).toBe(1);
    // First claim offered: b (earlier in FPO than d? FPO from b → b,c,d,a).
    expect(fresh.pending?.kind).toBe('choose_milestone_hero');
    expect(fresh.pending!.forPlayerId).toBe('b');
    let r = apply(s, 'b', { type: 'choose_milestone_hero', hero: 'Foreman Hadrik Stoll' });
    s = r.s;
    // After b's first claim: the b Hero grant pending if Foreman — none. Next: d.
    expect(s.gameState.pending?.forPlayerId).toBe('d');
    r = apply(s, 'd', { type: 'choose_milestone_hero', hero: 'Evo Angel' }); // d is a robot seat — species-eligible
    void r;
    s = r.s;
    // Then b's second.
    expect(s.gameState.pending?.forPlayerId).toBe('b');
    expect((s.gameState.pending as { claimsOwed?: number }).claimsOwed).toBe(1);
  });

  it("(b) §14.6: a later player reaching the target (140 at 4p) DURING income ends the game before any claims — even when the first player's pending claim would be Motherboard for a tech win", () => {
    let s = baseSession4p();
    const g = s.gameState;
    // b (first in FPO) crosses a milestone; a (last in FPO) jumps to 140.
    byId(g, 'b').culture = 28;
    byId(g, 'b').subjects = 32;
    byId(g, 'a').culture = 138;
    byId(g, 'a').subjects = 2; // +2 → 140
    let guard = 0;
    while (s.gameState.phase !== 'culture' && s.gameState.phase !== 'game_over' && guard++ < 20) {
      if (s.gameState.phase === 'planning') {
        s = apply(s, s.gameState.planningOrder[0]!, { type: 'plan_action', card: 'pass' }).s;
      } else break;
    }
    // a wins mid-income (before claims): b's milestone claims never arm.
    expect(s.gameState.phase).toBe('game_over');
    expect(s.gameState.result?.winners).toEqual(['a']);
    expect(g.pending?.kind).not.toBe('choose_milestone_hero');
  });

  it("(c) §14.7: a dead-Leader player at the target with a Culture Treaty does NOT end the game; the direct partner's later eligible win is shared", () => {
    let s = baseSession4p();
    const g = s.gameState;
    // a × b Culture Treaty (4+ players OK). Kill a's Leader (credit c).
    g.treaties.push({ type: 'culture-treaty', partners: ['a', 'b'] });
    killLeader(g, 'a', 'c');
    byId(g, 'a').culture = 140;
    byId(g, 'b').culture = 138;
    byId(g, 'b').subjects = 2; // +2 → 140 at income
    let guard = 0;
    while (s.gameState.phase !== 'culture' && s.gameState.phase !== 'game_over' && guard++ < 20) {
      if (s.gameState.phase === 'planning') s = apply(s, s.gameState.planningOrder[0]!, { type: 'plan_action', card: 'pass' }).s;
      else break;
    }
    expect(s.gameState.phase).toBe('game_over');
    // b initiated (living Leader); a shares via the direct Culture Treaty.
    expect(s.gameState.result?.winners).toEqual(['b', 'a']);
  });

  it('(d) every Leader dead with no winner ⇒ draw (ruling 74 tail)', () => {
    let s = baseSession4p();
    const g = s.gameState;
    // Kill ALL four Leaders (the draw fires only when nobody's alive).
    killLeader(g, 'a', 'b');
    killLeader(g, 'b', 'c');
    killLeader(g, 'c', 'd');
    killLeader(g, 'd', 'a');
    // Drive a round so the draw detector runs (it runs at kill time in battle —
    // here we force it via a no-op move path: use checkAllLeadersDeadDraw
    // through the engine's victory sweep inside any apply).
    // Any legal apply triggers refreshActor only; the draw check runs in
    // battle/victory paths. Call the exported checker directly.
    
    expect(checkAllLeadersDeadDraw(g)).toBe(true);
    expect(g.phase).toBe('game_over');
    expect(g.result?.winners).toEqual([]);
  });

  it('(e) 3p first Leader kill ends the game immediately', () => {
    const players: PlayerConfig[] = [
      { player_id: 'a', kind: 'human' }, { player_id: 'b', kind: 'human' }, { player_id: 'c', kind: 'human' },
    ];
    let s = neitherGutsNorGears.createSession(players, { seed: 7, setupFirstPlayerId: 'a' });
    s = apply(s, 'a', { type: 'assign_setup_choices', selections: { a: 'covenant', b: 'schism', c: 'ledger' } }).s;
    const leaders: Record<string, string> = { a: 'Warden Hesper Quill', b: 'Kestrel Nine', c: 'Marshal Corvin Ashlock' };
    while (s.gameState.phase === 'setup_leaders') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).s;
    }
    while (s.gameState.phase === 'setup_locations') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: { a: '@1', c: '@3', b: '@2' }[pend.forPlayerId]! }).s;
    }
    s = keepCores(s);
    const g = s.gameState;
    killLeader(g, 'b', 'a');
    
    expect(checkVictory(g, 'a')).toBe(true);
    expect(g.result?.winners).toEqual(['a']);
  });

  it('(f) Economic spend: half the 5–6p map — 26 collectors on 26 distinct tiles incl. oil+ether — wins (ruling #89)', () => {
    const players: PlayerConfig[] = Array.from({ length: 5 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'human' as const }));
    let s = neitherGutsNorGears.createSession(players, { seed: 17, setupFirstPlayerId: 'p1' });
    s = apply(s, 'p1', { type: 'assign_setup_choices', selections: { p1: 'covenant', p2: 'schism', p3: 'brass-circle', p4: 'ledger', p5: 'foundry' } }).s;
    const leaders: Record<string, string> = { p1: 'Warden Hesper Quill', p2: 'Dowser Wren Calloway', p3: 'Prospector Ida Marrs', p4: 'Kestrel Nine', p5: 'Marshal Corvin Ashlock' };
    while (s.gameState.phase === 'setup_leaders') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_leader', hero: leaders[pend.forPlayerId]! }).s;
    }
    while (s.gameState.phase === 'setup_locations') {
      const pend = s.gameState.pending!;
      s = apply(s, pend.forPlayerId, { type: 'choose_starting_location', location: { p1: '@1', p2: '@2', p3: '@3', p4: '@4', p5: '@5' }[pend.forPlayerId]! }).s;
    }
    s = keepCores(s);
    const g = s.gameState;
    const wiz = g.players.find((p) => p.playerId === 'p1')!;
    wiz.collectorsAvailable = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`surf-${i + 1}`, 1]));
    // 26 Surfs (ruling #89), and an owned unit on every tile so any 26 tiles
    // are reachable; the engine's own suggested payment is applied below. The
    // hand-laid eleven-tile script that follows is kept as documentation of
    // the printed mix's geometry on this map.
    // Other seats' pieces come off the map first: a tile they hold would need
    // their consent, which is a different rule than the one under test.
    g.bases = g.bases.filter((b) => b.ownerId === 'p1');
    g.units = g.units.filter((u) => u.ownerId === 'p1');
    for (const h of g.heroes) if (h.ownerId !== 'p1') h.coord = null;
    g.tiles.forEach((t, i) => g.units.push({ id: `u-p1-anchor-${i}`, typeId: 'evoker', ownerId: 'p1', coord: `${t.c},${t.r}` }));
    // 11 Surfs; give the wizard an owned unit at a central tile from which the
    // chain reaches. The 5-6p center: Or at (-2,4), oil (0,6),(0,8), ether (-1,7),(1,7).
    // Park the wizard Leader at (0,4) [Or]; chain from there.
    g.heroes.find((h) => h.ownerId === 'p1' && h.isLeader)!.coord = '0,4';
    // The 3Wa/3Wo/3Or/1Oi/1Et via 11 tiles: use the §13.3 map coordinates.
    // Waters near (0,4): (0,0)? Wa@4. (-1,3) Wa, (1,3) Wa, (-1,5) Wo, (1,5) Wa, (0,2) Or...
    const payment = [
      { collectorId: 'surf-1', coord: '-1,3' },  // Wa, adj (0,4)
      { collectorId: 'surf-2', coord: '1,3' },   // Wa, adj (0,4)
      { collectorId: 'surf-3', coord: '1,5' },   // Wa, adj (0,4)
      { collectorId: 'surf-4', coord: '-1,5' },  // Wo, adj (0,4)
      { collectorId: 'surf-5', coord: '-2,6' },  // Wa, adj (-1,5) — chain off committed
      { collectorId: 'surf-6', coord: '-1,1' },  // Wo, adj (-1,3)
      { collectorId: 'surf-7', coord: '0,2' },   // Or, adj (0,4)
      { collectorId: 'surf-8', coord: '-2,4' },  // Or — adj to? (-1,3): yes ((-1,3)'s neighbors include (-2,4)? nbrs of (-1,3): (-1,1),(-1,5),(-2,2)∉? (-2,2)? is on 3-4p only. (-2,4) IS adj of (-1,3)? offsets for (-1,3): (-1,1),(-1,5),(-2,2),(-2,4),(0,2),(0,4). YES (-2,4).
      { collectorId: 'surf-9', coord: '0,10' },  // Or — adj (0,8)Oi? no... (0,10)'s nbrs incl (0,8). Chain: need oil first? Order in the SAME action: prior batch members anchor. Put Or (0,10) after oil:
      { collectorId: 'surf-10', coord: '0,6' },  // Oi — adj? (0,4)'s nbrs include (0,6): YES
      { collectorId: 'surf-11', coord: '-1,7' }, // Et — adj to (-2,6)/(0,6): yes
    ];
    // Cost needs 3Wa+3Wo+3Or+1Et+1Oi; the script above: Wa ×4 (over — surplus ok), Wo ×2 — SHORT one Wo. (4,4) is Wa@3; (1,1) Wo; (-1,7) Et, (0,4) Or is the base. Add Wo at (1,1): adj (0,2)? nbrs of (1,1): (1,-1)∉,(1,3),(0,0),(0,2),(2,0)∉,(2,2). (0,2) committed (surf-7) — okay. Replace surf-5 with a Wo tile: (-1,7) is Et (needed); take Wo at (-1,9)? far. Use (3,3)? too far.
    // Simplest: make surf-5 wood: (-2,6) is Wa. Wood adjacent to committed: (1,1)? not adjacent to any yet. (-1,9) is Wo on the 5-6p map? §13.3 c=-1: 1=Wo,3=Wa,5=Wo,7=Et,9=Wo,11=Wo,13=Wo — yes (-1,9) Wo, adj (-1,7)? nbrs of (-1,7): (-1,5),(-1,9),(0,6),(0,8),(-2,6),(-2,8). YES adj to (-1,7) when committed later.
    payment[4] = { collectorId: 'surf-5', coord: '-1,9' };  // Wo — chain off nothing yet; move after Et:
    // Reorder so anchors resolve: Wa, Wa, Or(base-adj), Oi, Et(adj Oi), Wo(adj Et), Wo(-1,5? adj base)... let me re-lay:
    const pay = [
      { collectorId: 'surf-1', coord: '-1,3' },  // Wa adj base
      { collectorId: 'surf-2', coord: '1,3' },   // Wa adj base
      { collectorId: 'surf-3', coord: '1,5' },   // Wa adj base
      { collectorId: 'surf-4', coord: '-1,5' },  // Wo adj base
      { collectorId: 'surf-5', coord: '0,2' },   // Or adj base
      { collectorId: 'surf-6', coord: '0,6' },   // Oi adj base
      { collectorId: 'surf-7', coord: '-1,7' },  // Et adj (0,6)
      { collectorId: 'surf-8', coord: '-1,9' },  // Wo adj (-1,7)
      { collectorId: 'surf-9', coord: '1,1' },   // Wo adj (0,2) [committed]
      { collectorId: 'surf-10', coord: '-2,4' }, // Or adj (-1,3) [committed]
      { collectorId: 'surf-11', coord: '0,10' }, // Or — adj (0,8)? not committed. (0,10)'s nbrs: (0,8),(0,12),(-1,9),(-1,11),(1,9),(1,11). (-1,9) committed (surf-8) ✓
    ];
    // Drive p1's Build action.
    let placed = false;
    let guard2 = 0;
    while (guard2++ < 30 && !(s.gameState.phase === 'action' && s.gameState.activeAction?.ownerId === 'p1' && s.gameState.activeAction.cardKind === 'build')) {
      if (s.gameState.phase === 'planning') {
        const head = s.gameState.planningOrder[0]!;
        const want = head === 'p1' && !placed;
        s = apply(s, head, { type: 'plan_action', card: want ? 'build' : 'pass' }).s;
        if (want) placed = true;
      } else if (s.gameState.phase === 'action' && s.gameState.activeAction) {
        s = apply(s, s.gameState.activeAction.ownerId, { type: 'skip_action' }).s;
      } else break;
    }
    void payment; void pay;
    const offer = neitherGutsNorGears.getLegalMoves(s, 'p1').find((m) => m.move.type === 'economic_victory_spend');
    expect(offer, 'the 26-collector spend is offered').toBeTruthy();
    const laid = (offer!.move as { payment: Array<{ coord: string }> }).payment;
    expect(laid).toHaveLength(26);
    expect(new Set(laid.map((x) => x.coord)).size).toBe(26);
    const r = apply(s, 'p1', offer!.move);
    s = r.s;
    expect(s.gameState.phase).toBe('game_over');
    expect(s.gameState.result?.winners).toEqual(['p1']);
  });

  it('(g) tech totals: wizard 16 types + Motherboard (+5) + Greymore (+5) = 26 wins; robot 21 + Motherboard = 26 wins (§12.5, rulings #86, #90, #101-#104, #110, #111, #113, #129)', () => {
    let s2 = baseSession2p();
    const g = s2.gameState;
    const wiz = g.players.find((p) => p.playerId === 'wiz')!;
    // 16 ordinary types + both bonus heroes alive+placed, +5 each (ruling #113).
    wiz.acquiredTypes = Array.from({ length: 16 }, (_, i) => `t${i}`);
    g.heroPool = g.heroPool.filter((h) => h !== 'motherboard' && h !== 'greymore');
    g.heroes.push({ id: 'motherboard', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    g.heroes.push({ id: 'greymore', ownerId: 'wiz', coord: '-2,10', isLeader: false, dead: false });
    expect(techTotal(g, wiz)).toBe(26);
    
    expect(checkVictory(g, 'wiz')).toBe(true);
    expect(g.result?.winners).toEqual(['wiz']);
    // Robot mirror: 21 types + Motherboard placed (+5) = 26 (the Advanced
    // Research Station, the three Extra cards, the robot technologies and the
    // battle card type raised the robot target, rulings #86, #90, #102, #103,
    // #111, #129).
    let s3 = baseSession2p();
    const g3 = s3.gameState;
    const rob = g3.players.find((p) => p.playerId === 'rob')!;
    rob.acquiredTypes = Array.from({ length: 21 }, (_, i) => `r${i}`);
    g3.heroPool = g3.heroPool.filter((h) => h !== 'motherboard');
    g3.heroes.push({ id: 'motherboard', ownerId: 'rob', coord: '2,4', isLeader: false, dead: false });
    expect(techTotal(g3, rob)).toBe(26);
    expect(checkVictory(g3, 'rob')).toBe(true);
    expect(g3.result?.winners).toEqual(['rob']);
  });

  it('(h) a dead-Leader player initiating ANY path rejects with the living-Leader message (ruling 74)', () => {
    let s = baseSession2p();
    const g = s.gameState;
    killLeader(g, 'wiz', 'rob');
    byId(g, 'wiz').culture = 100;
    
    expect(checkVictory(g, 'wiz')).toBe(false); // threshold met, but no initiation
    expect(g.phase).not.toBe('game_over');
    // Economic spend path also rejects at the move — drive to wiz's Build
    // action first so the rejection isolates the living-Leader gate.
    let placed = false;
    while (s.gameState.phase === 'planning') {
      const head = s.gameState.planningOrder[0]!;
      const want = head === 'wiz' && !placed;
      s = apply(s, head, { type: 'plan_action', card: want ? 'build' : 'pass' }).s;
      if (want) placed = true;
    }
    expect(s.gameState.phase).toBe('action');
    expect(s.gameState.activeAction?.ownerId).toBe('wiz');
    expect(() => neitherGutsNorGears.applyMove(s, 'wiz', { type: 'economic_victory_spend', payment: [] }))
      .toThrowError(/dead-Leader|living Leader|initiate/i);
  });
});

function byId(g: NGGState, pid: string) {
  return g.players.find((p) => p.playerId === pid)!;
}
