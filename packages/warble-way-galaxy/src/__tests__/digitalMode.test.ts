import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { applyMove, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { getView } from '../views.js';
import { nextSeed, rollDice } from '../rng.js';
import { warbleWayGalaxy } from '../index.js';
import type { AbilityScores, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// Digital mode for Warble Way Galaxy (docs/digital-mode.md): a digital human
// holds no physical dice or deck — the server owns the deck ORDER and rolls
// real seeded dice when the player presses the resolve_report button. The
// physical path (composition-only deck + payload reports) is unchanged.

const PHYSICAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
const DIGITAL: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke', table: 'digital' }];

function makeChar(players: PlayerConfig[], scores: AbilityScores, seed = 7): WarbleWayGalaxyState {
  const s = createInitialState(players, { seed });
  return applyMove(s, {
    type: 'create_character',
    character_name: 'Zara',
    race: 'human',
    ship_name: 'Wandering Star',
    method: 'recommended',
    scores,
  }).newState;
}

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

/** Pilot-mechanic (no RES → no peek noise). */
function digitalPilot(seed = 7): WarbleWayGalaxyState {
  return makeChar(DIGITAL, { PIL: 3, MEC: 2, LEA: 1 }, seed);
}

function sessionOf(gameState: WarbleWayGalaxyState, players: PlayerConfig[] = DIGITAL): SessionState<WarbleWayGalaxyState> {
  const s = warbleWayGalaxy.createSession(players, { seed: 7 });
  return { ...s, gameState };
}

describe('session creation (deck order)', () => {
  it('a digital human gets a real shuffled deck: order present, 52 unique PHYS cards, remaining === order', () => {
    const s = warbleWayGalaxy.createSession(DIGITAL, { seed: 7 }).gameState;
    expect(s.digital_seat).toBe(true);
    expect(s.seat_kind).toBe('human');
    expect(s.deck.order).toBeDefined();
    expect(s.deck.order).toHaveLength(52);
    expect(new Set(s.deck.order).size).toBe(52);
    expect(s.deck.remaining).toEqual(s.deck.order);
    expect(s.deck.discard).toEqual([]);
  });

  it('a physical human gets NO order and the exact same remaining as before (bit-identical regression)', () => {
    const s = warbleWayGalaxy.createSession(PHYSICAL, { seed: 7 }).gameState;
    expect(s.digital_seat).toBe(false);
    expect(s.deck.order).toBeUndefined();
    // The pre-digital initial deck: rank-major AH..KC, untouched.
    expect(s.deck.remaining[0]).toBe('AH');
    expect(s.deck.remaining[51]).toBe('KC');
    expect(s.seed).toBe(7);
  });

  it('an all-AI (bot) session also shuffles a real deck (the bot is digital)', () => {
    const s = createInitialState([{ player_id: 'bot', kind: 'ai' }], { seed: 11 });
    expect(s.digital_seat).toBe(true);
    expect(s.deck.order).toHaveLength(52);
  });
});

describe('the Roll button (roll pendings)', () => {
  function openRepairRoll(seed = 7): WarbleWayGalaxyState {
    const s = digitalPilot(seed);
    s.habitat_progress[1]!.repair_rolled_this_arrival = false; // simulate arrival-after-travel
    return apply(s, { type: 'attempt_repair' });
  }

  it('a digital human is offered resolve_report exactly once, never report_roll', () => {
    const s = openRepairRoll();
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'repair', dice_count: 3 });
    const legal = getLegalMoves(s, 'p1');
    expect(legal.filter((m) => m.move.type === 'resolve_report')).toHaveLength(1);
    expect(legal.filter((m) => m.move.type === 'report_roll')).toHaveLength(0);
    expect(legal[0]!.description).toMatch(/server rolls when you press this/);
  });

  it('describeNextStep says "Press Roll" for a digital human', () => {
    const ns = warbleWayGalaxy.describeNextStep(sessionOf(openRepairRoll()));
    expect(ns?.instruction).toMatch(/Press Roll/);
    expect(ns?.instruction).toContain('resolve_report{}');
  });

  it('a digital roll pending keeps the consumable use_item offers alongside the button', () => {
    let s = digitalPilot();
    s.habitat_progress[1]!.repair_rolled_this_arrival = false;
    s = apply(s, { type: 'buy_item', item_name: 'Consumable +1 Any' });
    s = apply(s, { type: 'attempt_repair' }); // 3d6 + MEC(2) vs 12
    const legal = getLegalMoves(s, 'p1');
    expect(legal.filter((m) => m.move.type === 'resolve_report')).toHaveLength(1);
    expect(legal.filter((m) => m.move.type === 'use_item')).toHaveLength(1);
    // Declare it, then press the button — the declaration rides the pending.
    s = apply(s, { type: 'use_item', item_name: 'Consumable +1 Any' });
    expect(s.pending).toMatchObject({ kind: 'roll', declared_items: ['h1-s1'] });
    const r = applyMove(s, { type: 'resolve_report' });
    expect(r.newState.consumed_item_ids).toContain('h1-s1'); // consumed by the resolution
    expect(r.newState.pending === null || r.newState.pending.kind !== 'roll').toBe(true);
  });

  it('resolve_report rolls the real seeded dice — same seed stream, same values; pending clears', () => {
    const expected = rollDice(digitalPilot(7).seed, 3).dice;
    const r = applyMove(openRepairRoll(7), { type: 'resolve_report' });
    expect(r.summary).toMatch(/pressed Roll/);
    expect(r.summary).toContain(expected.join(', '));
    expect(r.newState.pending === null || r.newState.pending.kind !== 'roll').toBe(true);
    expect(r.newState.habitat_progress[1]!.repair_rolled_this_arrival).toBe(true);
    // A second session on the same seed rolls the same dice (deterministic).
    const r2 = applyMove(openRepairRoll(7), { type: 'resolve_report' });
    expect(r2.summary).toContain(expected.join(', '));
    // And the SAME seed stream's next roll differs — two presses, two streams:
    // a second fresh seat on the seed AFTER the first press gets a new set.
    // The stream advanced: the seat's NEXT press rolls the next stream dice.
    const afterFirst = rollDice(digitalPilot(7).seed, 3);
    // applyReportRoll bumps the stream once more (nextSeed(seed + 3)).
    const expected2 = rollDice(nextSeed(afterFirst.nextSeed + 3), 3).dice;
    const s2 = r.newState;
    (s2.ship as { damage: string }).damage = 'used';
    s2.habitat_progress[1]!.repair_rolled_this_arrival = false;
    const r3 = applyMove(apply(s2, { type: 'attempt_repair' }), { type: 'resolve_report' });
    expect(r3.summary).toContain(expected2.join(', '));
  });

  it('a physical seat with a roll pending is REJECTED from pressing the button (/physical seat/)', () => {
    const s = makeChar(PHYSICAL, { PIL: 3, MEC: 2, LEA: 1 });
    s.habitat_progress[1]!.repair_rolled_this_arrival = false;
    const t = apply(s, { type: 'attempt_repair' });
    expect(t.pending).toMatchObject({ kind: 'roll' });
    expect(() => applyMove(t, { type: 'resolve_report' })).toThrow(/physical seat/);
  });

  it('a report_roll payload on a digital seat is REJECTED — no bypass', () => {
    expect(() => applyMove(openRepairRoll(), { type: 'report_roll', dice: [4, 4, 4] })).toThrow(/digital seat/);
  });

  it('resolve_report with no pending is rejected', () => {
    expect(() => applyMove(digitalPilot(), { type: 'resolve_report' })).toThrow(/No roll or card draw/);
  });
});

describe('the Draw button (card_draw pendings)', () => {
  function onMission(): WarbleWayGalaxyState {
    return apply(digitalPilot(), { type: 'take_mission', mission_name: 'h1-m3' });
  }

  it('a digital human on a card_draw pending gets resolve_report and "Press Draw" wording', () => {
    const s = onMission();
    expect(s.pending).toEqual({ kind: 'card_draw' });
    const legal = getLegalMoves(s, 'p1');
    expect(legal.map((m) => m.move.type)).toEqual(['resolve_report']);
    const ns = warbleWayGalaxy.describeNextStep(sessionOf(s));
    expect(ns?.instruction).toMatch(/Press Draw/);
    expect(ns?.instruction).toContain('resolve_report{}');
  });

  it('resolve_report pops the top of the server order; remaining and order stay in sync', () => {
    const s = onMission();
    const top = s.deck.order![0]!;
    const r = applyMove(s, { type: 'resolve_report' });
    expect(r.summary).toMatch(/pressed Draw/);
    expect(r.summary).toContain(top);
    expect(r.newState.deck.discard).toContain(top);
    expect(r.newState.deck.remaining).toEqual(r.newState.deck.order);
    expect(r.newState.deck.order).toHaveLength(51);
  });

  it('a physical report_card_draw on a digital seat is rejected', () => {
    const s = onMission();
    expect(() => applyMove(s, { type: 'report_card_draw', card: '7S' })).toThrow(/digital seat/);
  });

  it('the physical path still resolves card_draw pendings off remaining (composition only)', () => {
    const s = makeChar(PHYSICAL, { PIL: 3, MEC: 2, LEA: 1 });
    const t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    const u = apply(t, { type: 'report_card_draw', card: 'AH' });
    expect(u.deck.discard).toContain('AH');
    expect(u.deck.remaining).not.toContain('AH');
    expect(u.deck.order).toBeUndefined();
    // Duplicate rejection still holds on the physical path: with AH already
    // discarded, a report of AH on an open card_draw pending is refused.
    const t2 = structuredClone(t);
    t2.deck.remaining = t2.deck.remaining.filter((c) => c !== 'AH');
    t2.deck.discard.push('AH');
    expect(() => applyMove(t2, { type: 'report_card_draw', card: 'AH' })).toThrow(/already in your discard/);
  });
});

describe('the Research peek (a choice, not randomness)', () => {
  function peekOpen(): WarbleWayGalaxyState {
    const s = makeChar(DIGITAL, { RES: 3, MEC: 2, PIL: 1 });
    return apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
  }

  it('the digital player view reveals the peeked cards; the button is NOT offered', () => {
    const s = peekOpen();
    expect(s.pending).toEqual({ kind: 'res_discard', peek_count: 3 });
    const view = getView(s) as Record<string, unknown>;
    expect(view['res_peek']).toEqual(s.deck.order!.slice(0, 3));
    const legal = getLegalMoves(s, 'p1').map((m) => m.move.type);
    expect(legal).not.toContain('resolve_report');
    expect(legal).toContain('report_res_discard');
    expect(legal).toContain('skip_res_peek');
  });

  it('the physical view carries no res_peek', () => {
    const s = makeChar(PHYSICAL, { RES: 3, MEC: 2, PIL: 1 });
    const t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(t.pending).toEqual({ kind: 'res_discard', peek_count: 3 });
    expect((getView(t) as Record<string, unknown>)['res_peek']).toBeUndefined();
  });

  it('pressing the button on a res_discard pending is rejected; report and skip still work', () => {
    const s = peekOpen();
    expect(() => applyMove(s, { type: 'resolve_report' })).toThrow(/CHOICE, not randomness/);
    const r = applyMove(s, { type: 'skip_res_peek' });
    expect(r.newState.pending).toEqual({ kind: 'card_draw' });
    const r2 = applyMove(s, { type: 'report_res_discard', card: s.deck.order![0]! });
    expect(r2.newState.deck.discard).toContain(s.deck.order![0]);
    expect(r2.newState.pending).toEqual({ kind: 'card_draw' });
  });
});
