import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import type { PlayerConfig } from '@zekel/game-kit';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });

describe('engine spine (all-AI)', () => {
  it('auto-completes setup into the play phase with factions, hands, foe', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    expect(s.phase).toBe('play');
    expect(s.round).toBe(1);
    expect(s.foe).not.toBeNull();
    expect(s.players).toHaveLength(2);
    for (const p of s.players) {
      expect(p.hand.length).toBe(3);
      expect(['milkshake', 'fudge', 'jellybean', 'cheesecake', 'nomads']).toContain(p.faction);
    }
    // distinct factions
    expect(new Set(s.players.map((p) => p.faction)).size).toBe(2);
  });

  it('a pass advances to the next player', () => {
    const s = createInitialState([ai('a'), ai('b')], { seed: 7 });
    expect(s.activePlayerId).toBe('a');
    const r = applyMove(s, 'a', { type: 'pass' });
    expect(r.newState.activePlayerId).toBe('b');
  });

  it('recall -> play single-color -> end turn cycles turns', () => {
    let s = createInitialState([ai('a'), ai('b'), ai('c')], { seed: 3 });
    const a = s.players[0]!;
    // recall nothing (gains intel, moves to play step)
    s = applyMove(s, 'a', { type: 'recall', units: [] }).newState;
    expect(s.players[0]!.turn.step).toBe('play');
    // play the first single-color card in hand
    const single = s.players[0]!.hand.find((c) => c.kind === 'single')!;
    s = applyMove(s, 'a', { type: 'play_intel', cardId: single.cardId, unit: 'ambassador', takeAction: false }).newState;
    expect(s.players[0]!.turn.step).toBe('influence');
    s = applyMove(s, 'a', { type: 'end_turn' }).newState;
    expect(s.activePlayerId).toBe('b');
  });

  it('Nomads are 5-player only: auto-assign never picks them below 5p', () => {
    for (const n of [2, 3, 4]) {
      const ids = Array.from({ length: n }, (_, i) => ai(String.fromCharCode(97 + i)));
      const s = createInitialState(ids, { seed: 4 });
      expect(s.players.some((p) => p.faction === 'nomads')).toBe(false);
    }
  });

  it('human faction assignment rejects Nomads below 5 players', () => {
    const players: PlayerConfig[] = [{ player_id: 'h', kind: 'human' }, ai('b')];
    const s = createInitialState(players, { seed: 4 });
    expect(s.phase).toBe('setup_factions');
    expect(() => applyMove(s, 'h', { type: 'assign_setup_choices', selections: { h: 'nomads', b: 'milkshake' } })).toThrow(/5-player/);
    // a valid region-faction map is accepted
    const r = applyMove(s, 'h', { type: 'assign_setup_choices', selections: { h: 'milkshake', b: 'fudge' } });
    expect(r.newState.phase).toBe('setup_foe');
  });

  it('5-player game assigns all 5 factions including Nomads (0 sugar, no secrets)', () => {
    const s = createInitialState([ai('a'), ai('b'), ai('c'), ai('d'), ai('e')], { seed: 11 });
    const nomad = s.players.find((p) => p.faction === 'nomads')!;
    expect(nomad.homeRegion).toBeNull();
    expect(nomad.sugarCubes).toBe(0);
    expect(nomad.secretObjectives).toHaveLength(0);
    // region-holders got 2 secret objectives each
    for (const p of s.players.filter((x) => x.faction !== 'nomads')) {
      expect(p.secretObjectives.length).toBe(2);
    }
  });
});
