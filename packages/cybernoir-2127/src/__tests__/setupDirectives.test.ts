import { describe, it, expect } from 'vitest';
import { cybernoir2127 } from '../index.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import type { CNState } from '../types.js';

function session(players: PlayerConfig[], seed = 7): SessionState<CNState> {
  const s = cybernoir2127.createSession(players, { seed });
  s.sessionId = 'test';
  return s;
}

const AI_ONLY: PlayerConfig[] = [
  { player_id: 'det', kind: 'ai', difficulty: 'medium', name: 'Detective' },
  { player_id: 'hak', kind: 'ai', difficulty: 'medium', name: 'Hacker' },
];
const HUMAN_HACKER: PlayerConfig[] = [
  { player_id: 'det', kind: 'ai', difficulty: 'medium', name: 'Detective' },
  { player_id: 'hak', kind: 'human', name: 'Hacker' },
];
const HUMAN_BOTH: PlayerConfig[] = [
  { player_id: 'det', kind: 'human', name: 'Detective' },
  { player_id: 'hak', kind: 'human', name: 'Hacker' },
];

function applyAll(s: SessionState<CNState>, playerId: string, move: import('../types.js').CNMove): SessionState<CNState> {
  const r = cybernoir2127.applyMove(s, playerId, move);
  // applyMove returns ApplyMoveResult<CNState> where newState is a SessionState wrapper;
  // unwrap its inner gameState while keeping the wrapper's metadata in sync.
  const inner = r.newState.gameState;
  return {
    ...s,
    gameState: inner,
    activePlayerId: inner.activePlayerId,
    turnNumber: inner.turn,
  };
}

describe('Setup checklist', () => {
  it('all-AI session returns empty checklist (setup auto-completes)', () => {
    const s = session(AI_ONLY);
    expect(cybernoir2127.getSetupChecklist(s)).toEqual([]);
  });

  it('human Hacker session returns setup steps', () => {
    // Human Hacker → setup phase (not auto-completed)
    const s = cybernoir2127.createSession(HUMAN_HACKER, { seed: 7 });
    s.sessionId = 'test';
    const checklist = cybernoir2127.getSetupChecklist(s);
    expect(checklist.length).toBeGreaterThan(0);
    // v2.3: step 0 is the ROLE ECHO (silent positional roles bit the designer);
    // the hideout choice follows.
    expect(checklist[0]!.move_type).toBe('confirm_roles');
    expect(checklist[0]!.description).toMatch(/DETECTIVE/);
    expect(checklist[0]!.description).toMatch(/HACKER/);
    expect(checklist[1]!.move_type).toBe('report_hideout');
    expect(checklist[1]!.ask_human_for).toMatch(/hideout/i);
  });

  it('v2.3: the detective option assigns roles (by id or name) and echoes them', () => {
    const players = [
      { player_id: 'zeke', kind: 'human' as const, name: 'Zeke' },
      { player_id: 'ai', kind: 'ai' as const, difficulty: 'hard' },
    ];
    // Zeke asked to be the HACKER → the AI is the detective
    const s = cybernoir2127.createSession(players, { seed: 7, detective: 'ai' });
    expect(s.gameState.playerOrder[0]).toBe('ai');    // detective seat
    expect(s.gameState.playerOrder[1]).toBe('zeke');  // hacker seat
    s.sessionId = 'test';
    const roles = cybernoir2127.getSetupChecklist(s)[0]!;
    expect(roles.description).toContain('ai');
    expect(roles.description).toMatch(/zeke.*HACKER|HACKER.*zeke/s);
    // Seat NAME works too, case-tolerant
    const s2 = cybernoir2127.createSession(players, { seed: 7, detective: 'zeke' });
    expect(s2.gameState.playerOrder[0]).toBe('zeke');
    const s3 = cybernoir2127.createSession(players, { seed: 7, detective: ' ZEKE ' });
    expect(s3.gameState.playerOrder[0]).toBe('zeke');
    // Unknown value rejects loudly
    expect(() => cybernoir2127.createSession(players, { seed: 7, detective: 'nobody' })).toThrow(/must name one of the players/);
  });

  it('human-both session returns setup steps', () => {
    const s = cybernoir2127.createSession(HUMAN_BOTH, { seed: 7 });
    s.sessionId = 'test';
    const checklist = cybernoir2127.getSetupChecklist(s);
    expect(checklist.length).toBeGreaterThan(0);
  });

  it('returns empty checklist after setup is complete (phase !== setup)', () => {
    const s = session(AI_ONLY);
    // All-AI starts in 'play' phase → empty checklist
    expect(cybernoir2127.getSetupChecklist(s)).toEqual([]);
  });
});

describe('describeNextStep', () => {
  it('returns ai_to_move for all-AI session in play phase', () => {
    const s = session(AI_ONLY);
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
  });

  it('names board_discard_pending with specific instruction', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = { type: 'board_discard_pending', source_person: 'test' };
    s.gameState.activePlayerId = 'hak';
    s.activePlayerId = 'hak';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
    expect(step?.instruction).toMatch(/board Location to discard/i);
    expect(step?.instruction).toMatch(/Gang 2\/3/i);
  });

  it('names reveal_informant_pending with specific instruction', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = { type: 'reveal_informant_pending', source_person: 'test' };
    s.gameState.activePlayerId = 'hak';
    s.activePlayerId = 'hak';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
    expect(step?.instruction).toMatch(/facedown informant to reveal/i);
    expect(step?.instruction).toMatch(/Corp 1/i);
  });

  it('names discard_retrieval_pending with specific instruction', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = { type: 'discard_retrieval_pending', source_person: 'test' };
    s.gameState.activePlayerId = 'hak';
    s.activePlayerId = 'hak';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
    expect(step?.instruction).toMatch(/discard pile to retrieve/i);
    expect(step?.instruction).toMatch(/Corp 2/i);
  });

  it('uses person name (not id) in block_pending instruction', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = {
      type: 'block_pending',
      hacker_move: { type: 'play_person', person_name: 'x' },
      matching_informant: 'eddie_the_doorman',
      person_id: 'eddie_the_doorman',
    };
    s.gameState.activePlayerId = 'det';
    s.activePlayerId = 'det';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.instruction).toContain('Eddie the Doorman');
    expect(step?.instruction).not.toContain('eddie_the_doorman');
  });

  it('returns game_over status when game is over', () => {
    const s = session(AI_ONLY);
    s.gameState.phase = 'game_over';
    s.gameState.resultSummary = 'Detective wins';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('game_over');
    expect(step?.instruction).toBe('Detective wins');
  });

  it('returns ai_to_move for AI seat on clue_reveal_pending', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = { type: 'clue_reveal_pending', source: 'block' };
    s.gameState.activePlayerId = 'hak';
    s.activePlayerId = 'hak';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
    expect(step?.active_player_id).toBe('hak');
  });

  it('returns ai_to_move for AI seat on block_pending', () => {
    const s = session(AI_ONLY);
    s.gameState.pending = {
      type: 'block_pending',
      hacker_move: { type: 'play_person', person_name: 'Felix the Concierge' },
      matching_informant: 'felix_the_concierge',
      person_id: 'felix_the_concierge',
    };
    s.gameState.activePlayerId = 'det';
    s.activePlayerId = 'det';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('ai_to_move');
    expect(step?.active_player_id).toBe('det');
  });

  it('returns human_to_move for human seat on clue_reveal_pending', () => {
    const s = session(HUMAN_HACKER);
    s.gameState.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.gameState.activePlayerId = 'hak';
    s.activePlayerId = 'hak';
    const step = cybernoir2127.describeNextStep(s);
    expect(step?.status).toBe('human_to_move');
    expect(step?.active_player_id).toBe('hak');
  });
});

describe('View completeness', () => {
  it('getPublicView includes playerOrder', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPublicView(s) as Record<string, unknown>;
    expect(view).toHaveProperty('playerOrder');
    expect(view.playerOrder).toEqual(['det', 'hak']);
  });

  it('getPublicView includes ap for both players', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPublicView(s) as Record<string, unknown>;
    const det = view.detective as Record<string, unknown>;
    const hak = view.hacker as Record<string, unknown>;
    expect(det).toHaveProperty('ap');
    expect(hak).toHaveProperty('ap');
  });

  it('getPublicView includes overclock_used for both players', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPublicView(s) as Record<string, unknown>;
    const det = view.detective as Record<string, unknown>;
    const hak = view.hacker as Record<string, unknown>;
    expect(det).toHaveProperty('overclock_used');
    expect(hak).toHaveProperty('overclock_used');
  });

  it('getPublicView includes overclock_draws_owed', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPublicView(s) as Record<string, unknown>;
    expect(view).toHaveProperty('overclock_draws_owed');
  });

  it('getPublicView includes evidence contents (names, not just counts)', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPublicView(s) as Record<string, unknown>;
    const evidence = view.evidence as Record<string, unknown>;
    expect(evidence.witnesses).toBeInstanceOf(Array);
    expect(evidence.motive_set_1).toBeInstanceOf(Array);
    expect(evidence.motive_set_2).toBeInstanceOf(Array);
  });

  it('getPlayerView for Detective includes informants with names', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPlayerView(s, 'det') as Record<string, unknown>;
    expect(view).toHaveProperty('informants');
    expect(view).toHaveProperty('role', 'detective');
  });

  it('getPlayerView for Hacker includes hideout and hand', () => {
    const s = session(AI_ONLY);
    const view = cybernoir2127.getPlayerView(s, 'hak') as Record<string, unknown>;
    expect(view).toHaveProperty('role', 'hacker');
    expect(view).toHaveProperty('hideout');
    expect(view).toHaveProperty('hand');
  });

  it('getPlayerView does not leak Detective informants to Hacker', () => {
    const s = session(AI_ONLY);
    // Add a facedown informant
    s.gameState.detective.informants.push({ person_id: 'eddie_the_doorman', revealed: false });
    const hackerView = cybernoir2127.getPlayerView(s, 'hak') as Record<string, unknown>;
    // Hacker should NOT see informant names (only count)
    expect(hackerView).not.toHaveProperty('informants');
    const pub = hackerView as { informants_facedown_count: number; informants_revealed: unknown[] };
    expect(pub.informants_facedown_count).toBe(1);
  });
});

describe('getSuggestedMove harness hook', () => {
  it('returns a concrete hideout for a human Hacker at setup', () => {
    const s = session(HUMAN_HACKER);
    const suggested = cybernoir2127.getSuggestedMove!(s, 'hak');
    expect(suggested).not.toBeNull();
    expect(suggested!.move.type).toBe('report_hideout');
    expect((suggested!.move as { location_name?: string }).location_name).toBeDefined();
    expect((suggested!.move as { location_name?: string }).location_name).not.toBe('');
    // Must be a real location
    expect(cybernoir2127.getReferenceData()).toBeDefined();
    const ref = cybernoir2127.getReferenceData() as { locations?: Array<{ name: string }> };
    expect(ref.locations!.some(l => l.name === (suggested!.move as { location_name: string }).location_name)).toBe(true);
  });

  it('is deterministic for the same seed', () => {
    const s1 = session(HUMAN_HACKER, 42);
    const s2 = session(HUMAN_HACKER, 42);
    const m1 = cybernoir2127.getSuggestedMove!(s1, 'hak')!.move;
    const m2 = cybernoir2127.getSuggestedMove!(s2, 'hak')!.move;
    expect(m1).toEqual(m2);
  });

  it('varies across seeds', () => {
    const picks = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = session(HUMAN_HACKER, seed);
      const m = cybernoir2127.getSuggestedMove!(s, 'hak')!.move as { location_name: string };
      picks.add(m.location_name);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it('returns a concrete, playable Detective move after setup', () => {
    const s = session(AI_ONLY, 42);
    // All-AI auto-completes setup; Detective is active with a hand.
    const suggested = cybernoir2127.getSuggestedMove!(s, 'det');
    expect(suggested).not.toBeNull();
    const legal = cybernoir2127.getLegalMoves(s, 'det');
    expect(legal.some(lm => JSON.stringify(lm.move) === JSON.stringify(suggested!.move))).toBe(true);
    // Must not be a placeholder buy_clue with empty discards
    if (suggested!.move.type === 'buy_clue') {
      expect((suggested!.move as { discard_locations: string[] }).discard_locations).not.toContain('');
    }
  });

  it('getSuggestedMove buy_clue fills all 3 discards from hand', () => {
    // Build a minimal tracked-Detective state at the AP-action phase with
    // exactly 3 locations in hand so the concrete buy_clue is forced.
    const s = session(AI_ONLY, 7);
    // Use hard difficulty so the suggestion is deterministic (no medium-tier
    // randomization that could pick pass/draw instead).
    s.players[0]!.difficulty = 'hard';
    // This test checks the buy_clue move SHAPE (all 3 discards named), not the
    // buy's timing. The promoted default (2026-08-19) refuses wide-open early
    // buys, so use the `deduction` lever — the pre-promotion greedy buyer.
    s.players[0]!.strategy = 'deduction';
    // Play the mandatory location using the first legal move.
    const legalBefore = cybernoir2127.getLegalMoves(s, 'det');
    const playLoc = legalBefore.find(lm => lm.move.type === 'play_location')!;
    const s2 = applyAll(s, 'det', playLoc.move);
    // Set hand to exactly 4 known locations so the concrete buy_clue is forced.
    s2.gameState.detective.location_hand = ['shipyard', 'trailer_towers', 'warehouse'];
    // Remove arrest/recruit targets and other AP sinks so the policy picks buy_clue.
    s2.gameState.detective.poi_deck = [];
    s2.gameState.detective.location_deck = [];
    s2.gameState.detective.mid_game_guess_spent = true;
    // No informants, full 4 AP remains.
    const suggested = cybernoir2127.getSuggestedMove!(s2, 'det');
    expect(suggested).not.toBeNull();
    expect(suggested!.move.type).toBe('buy_clue');
    const disc = (suggested!.move as { discard_locations: string[] }).discard_locations;
    expect(disc).toHaveLength(3);
    expect(disc.every(x => x !== '')).toBe(true);
  });

  it('returns a concrete Hacker move after setup', () => {
    const s = session(AI_ONLY, 42);
    // Play one Detective move to reach Hacker turn
    const detFirst = cybernoir2127.getSuggestedMove!(s, 'det')!;
    let s2 = applyAll(s, 'det', detFirst.move);
    // Keep playing Detective moves until turn switches to Hacker or game ends
    let safety = 0;
    while (s2.gameState.activePlayerId !== 'hak' && s2.gameState.phase !== 'game_over' && safety < 10) {
      const m = cybernoir2127.getSuggestedMove!(s2, 'det');
      if (!m) break;
      s2 = applyAll(s2, 'det', m.move);
      safety++;
    }
    if (s2.gameState.phase === 'game_over') {
      // If the game ended on the first Detective turn, still assert we had concrete moves
      return;
    }
    expect(s2.gameState.activePlayerId).toBe('hak');
    const suggested = cybernoir2127.getSuggestedMove!(s2, 'hak');
    expect(suggested).not.toBeNull();
    const legal = cybernoir2127.getLegalMoves(s2, 'hak');
    expect(legal.some(lm => JSON.stringify(lm.move) === JSON.stringify(suggested!.move))).toBe(true);
  });
});