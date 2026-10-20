import { describe, expect, it } from 'vitest';
import { fracturedFist } from '../index.js';
import { isDigitalSeat } from '@zekel/game-kit';
import type { PlayerConfig } from '@zekel/game-kit';
import type { TrackedPlayerState, OpaquePlayerState } from '../types.js';

const HUMAN_PHYSICAL: PlayerConfig = { player_id: 'p1', kind: 'human' };
const HUMAN_DIGITAL: PlayerConfig = { player_id: 'p1', kind: 'human', table: 'digital' };
const AI: PlayerConfig = { player_id: 'p2', kind: 'ai' };

describe('digital mode (docs/digital-mode.md)', () => {
  it('isDigitalSeat: physical human opaque, digital human + AI digital', () => {
    expect(isDigitalSeat(HUMAN_PHYSICAL)).toBe(false);
    expect(isDigitalSeat(HUMAN_DIGITAL)).toBe(true);
    expect(isDigitalSeat(AI)).toBe(true);
  });

  it('createSession keeps a default/omitted-table human opaque', () => {
    const s = fracturedFist.createSession([HUMAN_PHYSICAL, AI]);
    expect(s.gameState.players.p1!.kind).toBe('opaque');
    expect(s.gameState.players.p2!.kind).toBe('tracked');
  });

  it('createSession tracks a table:"digital" human seat like an AI seat', () => {
    const s = fracturedFist.createSession([HUMAN_DIGITAL, AI]);
    const p1 = s.gameState.players.p1! as TrackedPlayerState;
    expect(p1.kind).toBe('tracked');
    // Server holds the hidden state: hand dealt, deck tracked.
    expect(p1.hand.length).toBeGreaterThan(0);
    expect(p1.hand.length + p1.deck.length).toBe(10);
  });

  it('table:"physical" on a human stays opaque (explicit physical == default)', () => {
    const s = fracturedFist.createSession([{ ...HUMAN_PHYSICAL, table: 'physical' }, AI]);
    expect(s.gameState.players.p1!.kind).toBe('opaque');
  });

  it('mixed digital-human + physical-human session is coherent (per-seat)', () => {
    const s = fracturedFist.createSession([
      { player_id: 'p1', kind: 'human' }, // physical
      { player_id: 'p2', kind: 'human', table: 'digital' }, // digital
    ]);
    expect(s.gameState.players.p1!.kind).toBe('opaque');
    expect(s.gameState.players.p2!.kind).toBe('tracked');
  });
});
