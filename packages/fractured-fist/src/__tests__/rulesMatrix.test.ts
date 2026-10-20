// Rules that had no test of their own before the post-port walk (POST-PORT.md
// §3): heal cap, the Misstep limit, extra buys from Channel, draw effects,
// spirit lost when the turn ends, and the physical seat's refine/reload shapes.

import { describe, expect, it } from 'vitest';
import { applyMove, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { MAX_MISSTEPS } from '../cards.js';
import type { FFState, TrackedPlayerState } from '../types.js';

function tracked(): FFState {
  return createInitialState(['p1', 'p2'], { p1: 'tracked', p2: 'tracked' }, { loadout: ['inner_harmony', 'distract', 'combination_rush', 'quicken'] }, 1);
}

function give(s: FFState, pid: string, cards: string[]): void {
  const p = s.players[pid] as TrackedPlayerState;
  p.hand = [...cards];
  p.handSize = cards.length;
}

describe('rules without a test before the walk', () => {
  it('Heal never raises stamina above the starting stamina', () => {
    const s = tracked();
    give(s, 'p1', ['inner_harmony']);
    s.players.p1!.stamina = s.players.p1!.maxStamina - 1;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'inner_harmony' });
    expect(r.newState.players.p1!.stamina).toBe(s.players.p1!.maxStamina);
    expect(r.summary).toContain('heals 1 stamina');
  });

  it(`Missteps sent past the limit of ${MAX_MISSTEPS} are not added`, () => {
    const s = tracked();
    give(s, 'p1', ['distract']);
    s.players.p2!.misstepCount = MAX_MISSTEPS - 1;
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'distract' });
    expect(r.newState.players.p2!.misstepCount).toBe(MAX_MISSTEPS);
    expect(r.summary).toContain('sends 1 Misstep to p2 (the limit of 10 is reached)');
  });

  it('a Channel effect allows a second buy in the same turn', () => {
    let s = tracked();
    give(s, 'p1', ['combination_rush', 'mastery', 'mastery', 'mastery']);
    s = applyMove(s, 'p1', { type: 'play_card', card_id: 'combination_rush' }).newState;
    s = applyMove(s, 'p1', { type: 'advance_phase' }).newState;
    for (let i = 0; i < 3; i++) s = applyMove(s, 'p1', { type: 'play_card', card_id: 'mastery' }).newState;
    expect(s.players.p1!.channels).toBe(2);
    s = applyMove(s, 'p1', { type: 'buy_card', card_id: 'quicken' }).newState;
    s = applyMove(s, 'p1', { type: 'buy_card', card_id: 'quicken' }).newState;
    expect(s.players.p1!.channels).toBe(0);
    expect(s.players.p1!.supply.quicken).toBe(3);
  });

  it('a Draw effect draws that many cards at once', () => {
    const s = tracked();
    give(s, 'p1', ['quicken']);
    const r = applyMove(s, 'p1', { type: 'play_card', card_id: 'quicken' });
    expect(r.newState.players.p1!.handSize).toBe(2);
    expect(r.summary).toBe('P1 plays Quicken: draws 2 cards.'); // engine-only callers get the raw id
  });

  it('unspent spirit is lost when the turn ends', () => {
    let s = tracked();
    give(s, 'p1', ['focus', 'focus']);
    s = applyMove(s, 'p1', { type: 'advance_phase' }).newState;
    s = applyMove(s, 'p1', { type: 'play_card', card_id: 'focus' }).newState;
    expect(s.players.p1!.spirit).toBe(1);
    s = applyMove(s, 'p1', { type: 'end_turn' }).newState;
    expect(s.players.p1!.spirit).toBe(0);
  });
});

describe('a physical (opaque) seat is offered moves the engine accepts', () => {
  function physical(): FFState {
    return createInitialState(['p1', 'p2'], { p1: 'opaque', p2: 'tracked' }, undefined, 1);
  }

  it('Focus reload is offered once per possible count, each accepted', () => {
    const s = physical();
    s.players.p1!.stamina = 3; // behind, so the reload is legal
    const reloads = getLegalMoves(s, 'p1').filter((lm) => lm.move.type === 'focus_reload');
    expect(reloads.map((lm) => lm.move)).toEqual([1, 2, 3, 4, 5].map((count) => ({ type: 'focus_reload', count })));
    for (const lm of reloads) expect(() => applyMove(s, 'p1', lm.move)).not.toThrow();
  });

  it('an empty hand is offered no card plays and no refines', () => {
    const s = physical();
    s.players.p1!.handSize = 0;
    expect(getLegalMoves(s, 'p1').some((lm) => lm.move.type === 'play_card')).toBe(false);
    s.players.p1!.refinePending = 1;
    expect(getLegalMoves(s, 'p1').map((lm) => lm.move.type)).toEqual(['skip_refine']);
  });

  it('refining a Misstep is not offered once none are left, and is refused', () => {
    const s = physical();
    s.players.p1!.refinePending = 1;
    s.players.p1!.misstepCount = 0;
    const offered = getLegalMoves(s, 'p1').map((lm) => lm.move);
    expect(offered).not.toContainEqual({ type: 'refine_card', was_misstep: true });
    expect(() => applyMove(s, 'p1', { type: 'refine_card', was_misstep: true })).toThrow(/no Missteps left/);
  });
});
