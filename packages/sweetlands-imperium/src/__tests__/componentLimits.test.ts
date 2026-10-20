import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

function totalCards(s: SweetlandsState): number {
  return s.intelDeck.length + s.intelDiscard.length + s.players.reduce((n, p) => n + p.hand.length, 0);
}

describe('component-count limits', () => {
  it('the 80-card Intel deck is conserved through discard-for-color conversion', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    expect(totalCards(s)).toBe(80);
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState; // AI gains intel
    expect(totalCards(s)).toBe(80);
    const a = s.players[0]!;
    expect(a.hand.length).toBeGreaterThanOrEqual(4);
    const ids = a.hand.slice(0, 4).map((c) => c.cardId);
    s = applyMove(s, 'a', { type: 'discard_for_color', cardIds: ids, color: 'red' }).newState;
    // conversion takes one card FROM the deck (not minted) → still exactly 80
    expect(totalCards(s)).toBe(80);
  });

  it('Intel tokens are capped at 4 per color across all players', () => {
    let s = createInitialState([ai('a'), ai('b'), ai('c'), ai('d'), ai('e')], { seed: 3 });
    // advance the active player to the influence step
    s = applyMove(s, s.activePlayerId, { type: 'recall', units: [] }).newState;
    const active = s.players[s.currentPlayerIndex]!;
    const single = active.hand.find((c) => c.kind === 'single')!;
    s = applyMove(s, active.playerId, { type: 'play_intel', cardId: single.cardId, unit: 'leader', takeAction: false }).newState;
    expect(s.players[s.currentPlayerIndex]!.turn.step).toBe('influence');
    // hand out all 4 red tokens to OTHER players, give the active player influence
    const act = s.players[s.currentPlayerIndex]!;
    let given = 0;
    for (const p of s.players) { if (p.playerId !== act.playerId && given < 4) { p.intelTokens.red = true; given++; } }
    act.influence = 3;
    expect(() => applyMove(s, act.playerId, { type: 'buy_intel_token', color: 'red' })).toThrow(/supply/i);
    // a different, available color still works
    const r = applyMove(s, act.playerId, { type: 'buy_intel_token', color: 'blue' });
    expect(r.newState.players[r.newState.currentPlayerIndex]!.intelTokens.blue).toBe(true);
  });

  it('sugar is a hard bank of 30: buying blocked when empty, discards return it', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 2 });
    const act = () => s.players[s.currentPlayerIndex]!;
    // advance to influence step
    s = applyMove(s, s.activePlayerId, { type: 'recall', units: [] }).newState;
    const single = act().hand.find((c) => c.kind === 'single')!;
    s = applyMove(s, act().playerId, { type: 'play_intel', cardId: single.cardId, unit: 'leader', takeAction: false }).newState;
    // deplete the bank: put 30 cubes in the OTHER player's pool, give active influence
    const a = act();
    const other = s.players.find((p) => p.playerId !== a.playerId)!;
    a.sugarCubes = 0; other.sugarCubes = 30; a.influence = 3;
    expect(s.players.reduce((n, p) => n + p.sugarCubes, 0)).toBe(30);
    expect(() => applyMove(s, a.playerId, { type: 'buy_sugar_cube' })).toThrow(/supply/i);
    // the active player discards (returns cubes to the bank) — but they have none;
    // give them some, discard, and confirm the bank frees up for a buy
    a.sugarCubes = 2; other.sugarCubes = 28; // total still 30
    s = applyMove(s, a.playerId, { type: 'discard_sugar', count: 2 }).newState; // bank now 28
    const buyer = s.players[s.currentPlayerIndex]!;
    buyer.influence = 3;
    const r = applyMove(s, buyer.playerId, { type: 'buy_sugar_cube' });
    expect(r.newState.players.reduce((n, p) => n + p.sugarCubes, 0)).toBe(29);
  });

  it('influence stays capped at 5 and taxes at 3', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 1 });
    expect(s.players.every((p) => p.influence <= 5)).toBe(true);
    expect(Object.values(s.taxes).every((t) => t >= 0 && t <= 3)).toBe(true);
  });
});
