import { describe, expect, it } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { sweetlandsImperium } from '../index.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import type { SweetlandsState, SweetlandsMove } from '../types.js';

const wrap = (gameState: SweetlandsState, players: PlayerConfig[]): SessionState<SweetlandsState> => ({
  sessionId: 'test', gameId: 'sweetlands-imperium', players,
  activePlayerId: gameState.activePlayerId, turnNumber: gameState.round,
  gameState, moveLog: [], createdAt: '',
});

const PHYS: PlayerConfig = { player_id: 'a', kind: 'human' };
const DIG:  PlayerConfig = { player_id: 'a', kind: 'human', table: 'digital' };
const AI:   PlayerConfig = { player_id: 'b', kind: 'ai' };

/** Drive through setup to the setup_intel phase: factions → foe → secrets. */
function toSetupIntel(s: SweetlandsState): SweetlandsState {
  s = applyMove(s, 'a', { type: 'assign_setup_choices', selections: { a: 'milkshake', b: 'fudge' } } as SweetlandsMove).newState;
  s = applyMove(s, 'a', { type: 'choose_foe', foe: 'dragon' } as SweetlandsMove).newState;
  s = applyMove(s, 'a', { type: 'choose_secret_objective', objective: s.setup.secretDeal['a']![0]! } as SweetlandsMove).newState;
  // AI at head auto-resolves on the same call — both secrets now settled.
  return s;
}

describe('digital mode (docs/digital-mode.md)', () => {
  it('digital human is dealt their starting hand via a resolve_report button press', () => {
    let s = toSetupIntel(createInitialState([DIG, AI], undefined, 7));
    expect(s.phase).toBe('setup_intel');
    const a = s.players.find((p) => p.playerId === 'a')!;
    expect(a.digital).toBe(true);
    expect(a.hand).toHaveLength(0);

    // Legal moves for the digital human offer the button, not the report shape.
    const legal = getLegalMoves(s, 'a');
    expect(legal).toHaveLength(1);
    expect(legal[0]!.move.type).toBe('resolve_report');
    // Physical humans would get report_intel_draw; digital must NOT.
    expect(legal[0]!.description).toMatch(/[Dd]raw/);

    // Press the button.
    s = applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove).newState;
    const after = s.players.find((p) => p.playerId === 'a')!;
    expect(after.hand).toHaveLength(3);
    expect(s.phase).toBe('play'); // setup done — all humans drew
  });

  it('a digital knight in the castle battles the foe with a server roll: no battleTotal to fill in', () => {
    let s = toSetupIntel(createInitialState([DIG, AI], undefined, 7));
    s = applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove).newState;
    expect(s.phase).toBe('play');
    // Put the digital knight in the castle with a red card in hand, foe alive.
    const a = s.players.find((p) => p.playerId === 'a')!;
    a.units.knight = { zone: 'castle' };
    a.hand = [{ cardId: 'test-red', kind: 'single', color: 'red' }];
    a.turn.step = 'play';
    s.activePlayerId = 'a';
    s.currentPlayerIndex = s.players.indexOf(a);
    expect(s.foe && !s.foe.defeated).toBe(true);

    const red = getLegalMoves(s, 'a').filter((m) => m.move.type === 'play_intel' && (m.move as { unit?: string }).unit === 'knight' && (m.move as { takeAction?: boolean }).takeAction);
    expect(red.length).toBeGreaterThan(0);
    for (const m of red) {
      expect('battleTotal' in m.move).toBe(false);
      expect(m.description).toMatch(/server rolls/);
    }
    // Pressing it battles: the summary reports both totals, nothing was demanded of the player.
    const r = applyMove(s, 'a', red[0]!.move);
    expect(r.summary).toMatch(/(defeated|failed to defeat) the \w+ \(\d+ vs \d+\)/);
  });

  it('a physical knight in the castle must still declare the roll (regression)', () => {
    let s = toSetupIntel(createInitialState([PHYS, AI], undefined, 7));
    s = applyMove(s, 'a', { type: 'report_intel_draw', cards: [{ kind: 'single', color: 'red' }, { kind: 'single', color: 'red' }, { kind: 'single', color: 'red' }] } as SweetlandsMove).newState;
    const a = s.players.find((p) => p.playerId === 'a')!;
    a.units.knight = { zone: 'castle' };
    a.turn.step = 'play';
    s.activePlayerId = 'a';
    s.currentPlayerIndex = s.players.indexOf(a);
    const red = getLegalMoves(s, 'a').filter((m) => m.move.type === 'play_intel' && (m.move as { unit?: string }).unit === 'knight' && (m.move as { takeAction?: boolean }).takeAction && (m.move as { raiseTaxes?: boolean }).raiseTaxes !== true);
    expect(red.length).toBeGreaterThan(0);
    expect((red[0]!.move as { battleTotal?: number }).battleTotal).toBe(0);
    const { battleTotal: _drop, ...noTotal } = red[0]!.move as Record<string, unknown>;
    expect(() => applyMove(s, 'a', noTotal as SweetlandsMove)).toThrowError(/battleTotal/);
  });

  it('physical human still gets report_intel_draw (regression)', () => {
    const s = toSetupIntel(createInitialState([PHYS, AI], undefined, 7));
    const legal = getLegalMoves(s, 'a');
    expect(legal).toHaveLength(1);
    expect(legal[0]!.move.type).toBe('report_intel_draw');
  });

  it('a physical seat pressing the button is rejected', () => {
    const s = toSetupIntel(createInitialState([PHYS, AI], undefined, 7));
    expect(() => applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove)).toThrowError(/physical seat/);
  });

  it('a digital seat submitting a payload report is still rejected (no bypass)', () => {
    const s = toSetupIntel(createInitialState([DIG, AI], undefined, 7));
    expect(() => applyMove(s, 'a', { type: 'report_intel_draw', cards: [{ kind: 'single', color: 'red' }, { kind: 'single', color: 'red' }, { kind: 'single', color: 'red' }] } as SweetlandsMove)).toThrowError(/Not in intel-draw phase|report|exactly 3/i);
  });

  it('mid-game gain on a digital seat arms the button pending, deals on resolve_report', () => {
    // Drive the digital human into play phase, then trigger a turn-start gain.
    let s = toSetupIntel(createInitialState([DIG, AI], undefined, 7));
    s = applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove).newState;
    expect(s.phase).toBe('play');
    // Hand the turn to the human (skip AI turns): play pass till human active.
    let guard = 40;
    while (s.activePlayerId !== 'a' && guard-- > 0) {
      const m = sweetlandsImperium;
      const r = applyMove(s, s.activePlayerId, { type: 'pass' } as SweetlandsMove).newState;
      s = r;
      if (s.phase === 'game_over') break;
    }
    expect(s.activePlayerId).toBe('a');
    // Skip recall — grants Intel, which for a digital human arms the pending.
    s = applyMove(s, 'a', { type: 'recall', units: [] } as SweetlandsMove).newState;
    expect(s.pending?.kind).toBe('report_intel');
    expect(s.pending?.forPlayerId).toBe('a');
    // Legal surface is the button.
    const legal = getLegalMoves(s, 'a');
    expect(legal).toHaveLength(1);
    expect(legal[0]!.move.type).toBe('resolve_report');
    const before = s.players.find((p) => p.playerId === 'a')!.hand.length;
    s = applyMove(s, 'a', { type: 'resolve_report' } as SweetlandsMove).newState;
    expect(s.pending).toBeNull();
    const after = s.players.find((p) => p.playerId === 'a')!.hand.length;
    expect(after).toBeGreaterThan(before); // the pending count was dealt in
  });

  it('choices stay with the digital human — secret objective NOT auto-resolved', () => {
    // The setup_secrets phase must ask the digital human which objective to keep;
    // auto-picking happens only for AI (kind === 'ai'), never for digital humans.
    const s = createInitialState([DIG, AI], undefined, 7);
    const s2 = applyMove(s, 'a', { type: 'assign_setup_choices', selections: { a: 'milkshake', b: 'fudge' } } as SweetlandsMove).newState;
    const s3 = applyMove(s2, 'a', { type: 'choose_foe', foe: 'dragon' } as SweetlandsMove).newState;
    expect(s3.phase).toBe('setup_secrets');
    expect(s3.setup.awaitingSecretFrom[0]).toBe('a'); // human at head, not auto-resolved
    expect(s3.setup.secretDeal['a']!.length).toBe(2);
  });
});
