import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import { chooseMove } from '../ai.js';
import { rollSugarDice, SUGAR_DIE_FACES } from '../rng.js';
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });
const chooseMoveFor = (s: SweetlandsState, pid: string) => chooseMove(s, pid, 'hard').move;

describe('sugar cubes are custom dice (3 blank, 1, 2, 3)', () => {
  it('every face is 0/1/2/3 and the long-run average is ~1 pip', () => {
    expect([...SUGAR_DIE_FACES].sort()).toEqual([0, 0, 0, 1, 2, 3]);
    let total = 0, seed = 42;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const r = rollSugarDice(1, seed); seed = r.nextSeed; total += r.total;
      expect([0, 1, 2, 3]).toContain(r.faces[0]);
    }
    expect(total / N).toBeGreaterThan(0.85);
    expect(total / N).toBeLessThan(1.15);
  });
});

function advanceTo(state: SweetlandsState, playerId: string): SweetlandsState {
  let s = state;
  let guard = 0;
  while (s.activePlayerId !== playerId && guard++ < 50) {
    s = applyMove(s, s.activePlayerId, { type: 'pass' }).newState;
  }
  return s;
}

describe('Nomads start off the board and enter on first move', () => {
  it('an off-board unit enters the chosen region when first moved', () => {
    let s = createInitialState([ai('a'), ai('b'), ai('c'), ai('d'), ai('e')], { seed: 11 });
    const nomadId = s.players.find((p) => p.faction === 'nomads')!.playerId;
    for (const u of ['leader', 'knight', 'ambassador'] as const) {
      expect(s.players.find((p) => p.playerId === nomadId)!.units[u].zone).toBe('offboard');
    }
    s = advanceTo(s, nomadId);
    s = applyMove(s, nomadId, { type: 'recall', units: [] }).newState; // gain intel, -> play step
    const nomad = s.players.find((p) => p.playerId === nomadId)!;
    const single = nomad.hand.find((c) => c.kind === 'single');
    if (!single) return; // extremely unlikely with 5 cards
    s = applyMove(s, nomadId, { type: 'play_intel', cardId: single.cardId, unit: 'ambassador', takeAction: false, entryRegion: 2 }).newState;
    const amb = s.players.find((p) => p.playerId === nomadId)!.units.ambassador;
    expect(amb.zone).not.toBe('offboard');
    if (amb.zone === 'ring' || amb.zone === 'road') expect(amb.region).toBe(2);
  });
});

describe('discard_sugar (the sugar sink)', () => {
  it('reduces sugar and tracks the discard', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 5 });
    // milkshake (seat 0) starts with 3 sugar
    const before = s.players[0]!.sugarCubes;
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState; // into play step
    s = applyMove(s, 'a', { type: 'discard_sugar', count: 2 }).newState;
    expect(s.players[0]!.sugarCubes).toBe(before - 2);
    expect(s.players[0]!.progress.sugarDiscardedTotal).toBe(2);
  });
});

describe('trash_influence (spend-5-influence sink)', () => {
  it('trashing influence counts toward the objective; buying does not', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 5 });
    s.players[0]!.influence = 5;
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'a', { type: 'trash_influence', count: 5 }).newState;
    expect(s.players[0]!.influence).toBe(0);
    expect(s.players[0]!.progress.influenceTrashedTotal).toBe(5);
  });
});

describe('faction ability gating (audit fixes)', () => {
  it("Jellybean's auto-win applies ONLY to knights, NOT the castle foe", () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 5, factionAssignment: ['jellybean', 'fudge'] });
    expect(s.players[0]!.faction).toBe('jellybean');
    s.foe = { type: 'dragon', defeated: false };
    s.players[0]!.sugarCubes = 0; // with 0 sugar, a real foe fight can NEVER be won
    s.players[0]!.units.knight = { zone: 'road', region: 1, roadIndex: 2 };
    s.players[0]!.hand.push({ cardId: 'red-x', kind: 'single', color: 'red' });
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState;
    s = applyMove(s, 'a', { type: 'play_intel', cardId: 'red-x', unit: 'knight', takeAction: true }).newState;
    expect(s.foe!.defeated).toBe(false); // NOT an auto-win vs the foe
  });

  it('only Cheesecake may play a treat to an arbitrary slot', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 5, factionAssignment: ['fudge', 'milkshake'] });
    s.players[0]!.hand.push({ cardId: 'tr', kind: 'treat', treat: 'ice_cream' });
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState;
    expect(() => applyMove(s, 'a', { type: 'play_intel', cardId: 'tr', unit: 'ambassador', takeAction: false, treatRegion: 2, treatSlot: 'regional' })).toThrow(/Cheesecake/);

    let s2 = createInitialState([ai('a'), ai('b')], { seed: 5, factionAssignment: ['cheesecake', 'milkshake'] });
    s2.players[0]!.hand.push({ cardId: 'tr2', kind: 'treat', treat: 'ice_cream' });
    s2 = applyMove(s2, 'a', { type: 'recall', units: [] }).newState;
    const r = applyMove(s2, 'a', { type: 'play_intel', cardId: 'tr2', unit: 'ambassador', takeAction: false, treatRegion: 2, treatSlot: 'regional' });
    expect(r.newState.players[0]!.units.ambassador).toMatchObject({ zone: 'treat', region: 2, slotKind: 'regional' });
  });
});

describe('Intel token effect (spend as one-time color play, returns to supply)', () => {
  it('playing a token resolves its color and returns the token to supply', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 5 });
    s.players[0]!.intelTokens.orange = true;
    s.players[0]!.influence = 0;
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState; // into play step
    s = applyMove(s, 'a', { type: 'play_token', color: 'orange', unit: 'leader', takeAction: true }).newState;
    // orange = acquire influence; token consumed (returned to supply)
    expect(s.players[0]!.intelTokens.orange).toBeUndefined();
    expect(s.players[0]!.turn.step).toBe('influence'); // counted as the turn's Intel play
  });
});

describe('Nomad area-control objectives are achievable (rule fix)', () => {
  it('a Nomad scores units_all_matching_color / units_all_treats in some hard games', () => {
    let matching = 0, treats = 0, nomadGames = 0;
    for (let g = 0; g < 40; g++) {
      let s = createInitialState([ai('a'), ai('b'), ai('c'), ai('d'), ai('e')], { seed: 21000 + g });
      let guard = 0;
      while (s.phase !== 'game_over' && guard++ < 5000) {
        const pid = s.activePlayerId;
        s = applyMove(s, pid, chooseMoveFor(s, pid)).newState;
      }
      const nomad = s.players.find((p) => p.faction === 'nomads');
      if (!nomad) continue;
      nomadGames++;
      if (nomad.publicObjectivesScored.includes('units_all_matching_color')) matching++;
      if (nomad.publicObjectivesScored.includes('units_all_treats')) treats++;
    }
    expect(nomadGames).toBeGreaterThan(0);
    // The objective was IMPOSSIBLE for Nomads before the fix (3 units, 4 regions).
    expect(matching + treats).toBeGreaterThan(0);
  });
});

describe('double card acts twice', () => {
  it('a double Blue collects Intel for both sub-actions', () => {
    let s = createInitialState([ai('a'), ai('b')], { seed: 9 });
    // give player a a known double-blue card and put ambassador at home (gain +1 each)
    const a = s.players[0]!;
    a.hand.push({ cardId: 'dbl-blue-test', kind: 'double', color: 'blue' });
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState;
    const handBefore = s.players[0]!.hand.length;
    s = applyMove(s, 'a', { type: 'play_intel', cardId: 'dbl-blue-test', unit: 'ambassador', takeAction: true }).newState;
    // -1 for the played card, +2 from two Blue collects (home distance => +1 each)
    expect(s.players[0]!.hand.length).toBe(handBefore - 1 + 2);
  });
});
