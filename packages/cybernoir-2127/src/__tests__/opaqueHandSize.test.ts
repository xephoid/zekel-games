import { describe, it, expect } from 'vitest';
import { cybernoir2127 } from '../index.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import type { CNState, CNMove } from '../types.js';

// Integration-gate finding (INTEGRATION-NOTES.md run 3): a human (opaque)
// Hacker's hand_size was never maintained — born 0, stayed 0 — and the client
// refused legal evidence declarations off the phantom empty hand. hand_size is
// the one PUBLIC fact about the hand and must track declared moves.

function session(players: PlayerConfig[], seed = 7): SessionState<CNState> {
  const s = cybernoir2127.createSession(players, { seed });
  s.sessionId = 'test';
  return s;
}

const HUMAN_HACKER: PlayerConfig[] = [
  { player_id: 'det', kind: 'ai', difficulty: 'medium', name: 'Detective' },
  { player_id: 'hak', kind: 'human', name: 'Hacker' },
];

function apply(s: SessionState<CNState>, playerId: string, move: CNMove): SessionState<CNState> {
  const r = cybernoir2127.applyMove(s, playerId, move);
  const inner = r.newState.gameState;
  return { ...s, gameState: inner, activePlayerId: inner.activePlayerId, turnNumber: inner.turn };
}

function handSize(s: SessionState<CNState>): number {
  return s.gameState.players['hak']!.hand_size;
}

describe('opaque (human) Hacker hand_size', () => {
  it('is 3 after the hideout report (residents + draw to 3)', () => {
    let s = session(HUMAN_HACKER);
    expect(handSize(s)).toBe(0); // pre-setup
    s = apply(s, 'hak', { type: 'report_hideout', location_name: 'Dark City Central Station' } as CNMove);
    expect(handSize(s)).toBe(3);
  });

  it('increments on draw_contact and decrements on a witness evidence play', () => {
    let s = session(HUMAN_HACKER);
    s = apply(s, 'hak', { type: 'report_hideout', location_name: 'Dark City Central Station' } as CNMove);

    // Hand play/draw moves are Hacker-turn moves; force the turn state to the
    // Hacker with AP, as other engine tests do via direct state surgery.
    s.gameState.activePlayerId = 'hak';
    s.gameState.players['hak']!.ap = 3;

    s = apply(s, 'hak', { type: 'draw_contact' } as CNMove);
    expect(handSize(s)).toBe(4);
    s.gameState.players['hak']!.ap = 3;
    s = apply(s, 'hak', { type: 'draw_contact' } as CNMove);
    expect(handSize(s)).toBe(5);
  });

  // v2.4: Witness evidence is an atomic trio, so the piece takes THREE cards
  // out of the hand in one declared move (PORT-NOTES §31).
  it('decrements by 3 on the witness SET play, clamped at zero', () => {
    let s = session(HUMAN_HACKER);
    s = apply(s, 'hak', { type: 'report_hideout', location_name: 'Dark City Central Station' } as CNMove);
    expect(handSize(s)).toBe(3);

    s.gameState.activePlayerId = 'hak';
    s.gameState.players['hak']!.ap = 3;
    s = apply(s, 'hak', { type: 'draw_contact' } as CNMove);
    expect(handSize(s)).toBe(4);

    s.gameState.players['hak']!.ap = 3;
    s = apply(s, 'hak', {
      type: 'play_evidence', evidence_type: 'witness',
      people: ['Eddie the Doorman', 'Marisol the Janitor', 'Gus the Noodle Guy'],
    } as CNMove);
    if (s.gameState.pending?.type === 'block_pending') {
      s = apply(s, 'det', { type: 'block_decide', block: false } as CNMove);
    }
    expect(handSize(s)).toBe(1);

    // Clamp: with hand_size forced to 0, another declared play must not go negative.
    s.gameState.players['hak']!.hand_size = 0;
    s.gameState.players['hak']!.ap = 3;
    s.gameState.activePlayerId = 'hak';
    s = apply(s, 'hak', { type: 'play_evidence', evidence_type: 'weapon', person_name: 'The Weapon' } as CNMove);
    expect(handSize(s)).toBe(0);
  });
});
