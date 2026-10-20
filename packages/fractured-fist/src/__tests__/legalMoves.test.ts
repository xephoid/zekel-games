import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import type { FFState, TrackedPlayerState } from '../types.js';

const PLAYERS = ['p1', 'p2'];

function initTracked(opts?: Parameters<typeof createInitialState>[2]): FFState {
  return createInitialState(PLAYERS, { p1: 'tracked', p2: 'tracked' }, opts, 1);
}

function initOpaqueHuman(opts?: Parameters<typeof createInitialState>[2]): FFState {
  return createInitialState(PLAYERS, { p1: 'opaque', p2: 'tracked' }, opts, 1);
}

function asTracked(s: FFState, pid: string): TrackedPlayerState {
  const p = s.players[pid]!;
  if (p.kind !== 'tracked') throw new Error('expected tracked');
  return p;
}

describe('getLegalMoves — tracked', () => {
  it('returns no moves when it is not your turn', () => {
    const s = initTracked();
    expect(getLegalMoves(s, 'p2')).toEqual([]);
  });

  it('returns no moves after game_over', () => {
    const s = initTracked();
    s.phase = 'game_over';
    expect(getLegalMoves(s, 'p1')).toEqual([]);
  });

  it('in technique phase, offers advance_phase and end_turn', () => {
    const s = initTracked();
    const moves = getLegalMoves(s, 'p1');
    expect(moves.some((m) => m.move.type === 'advance_phase')).toBe(true);
    expect(moves.some((m) => m.move.type === 'end_turn')).toBe(true);
  });

  it('in channel phase, offers play_card for resource cards in hand', () => {
    const s = initTracked();
    s.phase = 'channel';
    const moves = getLegalMoves(s, 'p1');
    expect(
      moves.some((m) => m.move.type === 'play_card' && m.move.card_id === 'focus'),
    ).toBe(true);
  });

  it('when refines pending, only refine_card / skip_refine are legal', () => {
    const s = initTracked();
    const p1 = asTracked(s, 'p1');
    p1.refinePending = 1;
    p1.hand = ['misstep', 'focus'];
    p1.handSize = 2;
    const moves = getLegalMoves(s, 'p1');
    for (const m of moves) {
      expect(['refine_card', 'skip_refine']).toContain(m.move.type);
    }
    expect(moves.length).toBe(3); // 2 refine + 1 skip
  });

  it('offers buy_card only when affordable', () => {
    const s = initTracked({ loadout: ['attack'] });
    s.phase = 'channel';
    asTracked(s, 'p1').spirit = 3;
    let moves = getLegalMoves(s, 'p1');
    expect(moves.some((m) => m.move.type === 'buy_card' && m.move.card_id === 'attack')).toBe(false);

    asTracked(s, 'p1').spirit = 4;
    moves = getLegalMoves(s, 'p1');
    expect(moves.some((m) => m.move.type === 'buy_card' && m.move.card_id === 'attack')).toBe(true);
  });
});

describe('getLegalMoves — opaque', () => {
  it('enumerates play_card moves without hand_index, one per possible card type', () => {
    const s = initOpaqueHuman();
    s.phase = 'channel';
    const moves = getLegalMoves(s, 'p1');
    const playMoves = moves.filter((m) => m.move.type === 'play_card');
    // At least focus should be enumerated (it's in the starting deck)
    expect(playMoves.some((m) => m.move.type === 'play_card' && m.move.card_id === 'focus')).toBe(true);
    // None should have hand_index
    for (const m of playMoves) {
      if (m.move.type === 'play_card') expect(m.move.hand_index).toBeUndefined();
    }
  });

  it('refine moves carry was_misstep flag, not hand_index', () => {
    const s = initOpaqueHuman();
    s.players.p1!.refinePending = 1;
    const moves = getLegalMoves(s, 'p1');
    const refineMoves = moves.filter((m) => m.move.type === 'refine_card');
    expect(refineMoves.length).toBeGreaterThan(0);
    for (const m of refineMoves) {
      if (m.move.type === 'refine_card') {
        expect(m.move.hand_index).toBeUndefined();
        expect(typeof m.move.was_misstep).toBe('boolean');
      }
    }
  });

  it('refine-pending opaque player gets exactly 3 legal moves (2 refine variants + skip)', () => {
    const s = initOpaqueHuman();
    s.players.p1!.refinePending = 2;
    const moves = getLegalMoves(s, 'p1');
    expect(moves.length).toBe(3);
    const types = moves.map((m) => m.move.type).sort();
    expect(types).toEqual(['refine_card', 'refine_card', 'skip_refine']);
  });

  it('opaque tech-phase enumeration matches the game supply exactly', () => {
    const s = initOpaqueHuman({ loadout: ['attack', 'block', 'distract'] });
    const moves = getLegalMoves(s, 'p1');
    const techIds = moves
      .filter((m) => m.move.type === 'play_card')
      .map((m) => (m.move.type === 'play_card' ? m.move.card_id : ''))
      .sort();
    expect(techIds).toEqual(['attack', 'block', 'distract']);
  });

  it('opaque channel-phase enumeration covers all three resources', () => {
    const s = initOpaqueHuman();
    s.phase = 'channel';
    const moves = getLegalMoves(s, 'p1');
    const resourceIds = moves
      .filter((m) => m.move.type === 'play_card')
      .map((m) => (m.move.type === 'play_card' ? m.move.card_id : ''))
      .sort();
    expect(resourceIds).toEqual(['focus', 'mastery', 'momentum']);
  });
});
