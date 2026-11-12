// Red capture: WHO you take, and WHICH "capture a leader" objective it scores,
// are the player's choices. Both used to be settled by the engine:
//   - an unnamed target took the enemy LEADER, so a player whose secret
//     objective was "capture an ambassador" got the wrong unit;
//   - one leader capture scored BOTH the public (1) and the secret (2) objective,
//     against the designer's ruling that a single capture scores only one
//     (rules §7 item 2).

import { describe, it, expect } from 'vitest';
import { createInitialState, applyMove } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { chooseMove } from '../ai.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { lintNextStepFacts } from '@zekel/game-kit';
import { sweetlandsImperium as game } from '../index.js';
import type { SweetlandsState, SecretObjectiveId, IntelCard } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });
const RED_CARD: IntelCard = { cardId: 'test-red', kind: 'single', color: 'red' };

/** 'a' (Jellybean: its knight always wins against knights, so no dice enter the
 *  checks) has its knight parked in region 2 beside both of 'b's capturable
 *  units, holds one red card, and is on its play step. `secrets` sets 'a's kept
 *  secret objectives. */
function standoff(secrets: SecretObjectiveId[], card: IntelCard = RED_CARD, bFaction: 'fudge' | 'milkshake' = 'fudge'): SweetlandsState {
  let s = createInitialState([ai('a'), ai('b')], { seed: 5, factionAssignment: ['jellybean', bFaction] });
  s = applyMove(s, 'a', { type: 'recall', units: [] }).newState; // -> play step
  const a = s.players.find((p) => p.playerId === 'a')!;
  const b = s.players.find((p) => p.playerId === 'b')!;
  // 'a' moves its AMBASSADOR, so the knight stays put and the capture region is
  // known exactly.
  a.units.knight = { zone: 'ring', region: 2, ringIndex: 0 };
  a.units.ambassador = { zone: 'start', region: 1 };
  b.units.leader = { zone: 'ring', region: 2, ringIndex: 3 };
  b.units.ambassador = { zone: 'ring', region: 2, ringIndex: 4 };
  b.units.knight = { zone: 'start', region: 3 }; // out of the way: no knight battle
  a.hand = [card];
  a.secretObjectives = secrets;
  a.secretObjectivesScored = [];
  a.publicObjectivesScored = [];
  a.points = 0;
  return s;
}

const playRed = (s: SweetlandsState, extra: Record<string, unknown>, cardId = RED_CARD.cardId) =>
  applyMove(s, 'a', { type: 'play_intel', cardId, unit: 'ambassador', takeAction: true, ...extra });

type RedMove = { type: string; cardId?: string; takeAction?: boolean; unit?: string; targetPlayerId?: string; targetUnit?: string; captureLeaderScores?: string };
const redPlays = (s: SweetlandsState) => getLegalMoves(s, 'a').filter((m) => {
  const mv = m.move as RedMove;
  return mv.type === 'play_intel' && mv.cardId === RED_CARD.cardId && mv.takeAction === true && mv.unit === 'ambassador';
});

describe('Red capture target is offered, not chosen for the player', () => {
  it('getLegalMoves gives one option per reachable enemy unit, with the target filled in', () => {
    const plays = redPlays(standoff([]));
    const targets = plays.map((m) => {
      const mv = m.move as RedMove;
      return `${mv.targetPlayerId}/${mv.targetUnit}`;
    });
    expect(new Set(targets)).toEqual(new Set(['b/leader', 'b/ambassador']));
    expect(targets.length).toBe(2);
    // the option text names the unit, so the human can pick by reading it
    expect(plays.some((m) => m.description.includes("capturing b's ambassador"))).toBe(true);
  });

  it('a named ambassador target is captured, and the leader is NOT taken instead', () => {
    const r = playRed(standoff(['capture_ambassador']), { targetPlayerId: 'b', targetUnit: 'ambassador' });
    const b = r.newState.players.find((p) => p.playerId === 'b')!;
    expect(b.units.ambassador.zone).toBe('start'); // captured -> home
    expect(b.units.leader).toEqual({ zone: 'ring', region: 2, ringIndex: 3 }); // untouched
    const a = r.newState.players.find((p) => p.playerId === 'a')!;
    expect(a.progress.capturedAmbassador).toBe(true);
    expect(a.secretObjectivesScored).toContain('capture_ambassador');
  });

  it('an unnamed target still falls back to leaders first', () => {
    const r = playRed(standoff([]), {});
    const b = r.newState.players.find((p) => p.playerId === 'b')!;
    expect(b.units.leader.zone).toBe('start');
    expect(b.units.ambassador.zone).toBe('ring');
  });

  it('an enemy knight in the region: each option says it must be beaten first', () => {
    const s = standoff([]);
    s.players.find((p) => p.playerId === 'b')!.units.knight = { zone: 'ring', region: 2, ringIndex: 2 };
    const plays = redPlays(s);
    expect(plays.length).toBe(2);
    for (const m of plays) expect(m.description).toContain("you must first beat b's knight");
  });

  it('the AI keeps its policy: leader first, scoring the 2-point secret', () => {
    const s = standoff(['capture_leader']);
    const a = s.players.find((p) => p.playerId === 'a')!;
    a.units.knight = { zone: 'ring', region: 2, ringIndex: 0 };
    const { move } = chooseMove(s, 'a', 'hard');
    const mv = move as RedMove;
    if (mv.type === 'play_intel' && mv.takeAction && mv.targetUnit) {
      expect(mv.targetUnit).toBe('leader');
      expect(mv.captureLeaderScores).toBe('secret');
    }
    // and the order of the options puts that one first
    const first = redPlays(s)[0]!.move as RedMove;
    expect(first.targetUnit).toBe('leader');
    expect(first.captureLeaderScores).toBe('secret');
  });
});

describe('one leader capture scores only ONE "capture a leader" objective', () => {
  const capture = (secrets: SecretObjectiveId[], extra: Record<string, unknown> = {}) =>
    playRed(standoff(secrets), { targetPlayerId: 'b', targetUnit: 'leader', ...extra }).newState
      .players.find((p) => p.playerId === 'a')!;

  it('no secret held: the public objective scores (1)', () => {
    const a = capture([]);
    expect(a.publicObjectivesScored).toContain('capture_leader');
    expect(a.secretObjectivesScored ?? []).not.toContain('capture_leader');
    expect(a.points).toBe(1);
  });

  it('both open: the secret scores by default and the public stays open', () => {
    const a = capture(['capture_leader']);
    expect(a.secretObjectivesScored).toContain('capture_leader');
    expect(a.publicObjectivesScored).not.toContain('capture_leader');
    expect(a.points).toBe(2); // not 3
  });

  it('the capturer may take the public one instead, leaving the secret open', () => {
    const a = capture(['capture_leader'], { captureLeaderScores: 'public' });
    expect(a.publicObjectivesScored).toContain('capture_leader');
    expect(a.secretObjectivesScored ?? []).not.toContain('capture_leader');
    expect(a.points).toBe(1);
  });

  it('the objective left over scores on a later capture', () => {
    let s = standoff(['capture_leader']);
    s = playRed(s, { targetPlayerId: 'b', targetUnit: 'leader' }).newState; // secret (+2)
    // Set the board and hand up for a SECOND capture (a real game would take
    // another turn to get here; the scoring rule only cares that it is a new capture).
    const a = s.players.find((p) => p.playerId === 'a')!;
    const b = s.players.find((p) => p.playerId === 'b')!;
    a.hand = [RED_CARD];
    a.turn.step = 'play';
    b.units.leader = { zone: 'ring', region: 2, ringIndex: 3 };
    const r = playRed(s, { targetPlayerId: 'b', targetUnit: 'leader' });
    const after = r.newState.players.find((p) => p.playerId === 'a')!;
    expect(after.publicObjectivesScored).toContain('capture_leader');
    expect(after.points).toBe(3); // 2 (secret) + 1 (public), across TWO captures
  });

  it('both scoring options are offered when both objectives are open', () => {
    const leaderPlays = redPlays(standoff(['capture_leader'])).filter((m) => (m.move as RedMove).targetUnit === 'leader');
    const picks = leaderPlays.map((m) => (m.move as RedMove).captureLeaderScores);
    expect(new Set(picks)).toEqual(new Set(['secret', 'public']));
  });

  it('the move summary says which one scored and that the other stays open', () => {
    const r = playRed(standoff(['capture_leader']), { targetPlayerId: 'b', targetUnit: 'leader' });
    expect(r.summary ?? JSON.stringify(r)).toMatch(/secret "capture a leader".*public.*stays open/i);
  });
});

describe("a double red card asks a human for its second capture", () => {
  const DOUBLE: IntelCard = { cardId: 'test-red2', kind: 'double', color: 'red' };
  /** 'a' as a human holding a double red. b is Fudge (home region 2) by default,
   *  so a captured b unit lands back beside the knight and the second Red has a
   *  real choice; as Milkshake (home region 1) it goes out of reach. */
  const humanDouble = (secrets: SecretObjectiveId[] = [], bFaction: 'fudge' | 'milkshake' = 'fudge') => {
    const s = standoff(secrets, DOUBLE, bFaction);
    s.players.find((p) => p.playerId === 'a')!.kind = 'human';
    return s;
  };
  const playDouble = (s: SweetlandsState, extra: Record<string, unknown>) => playRed(s, extra, DOUBLE.cardId);
  const A = (s: SweetlandsState) => s.players.find((p) => p.playerId === 'a')!;
  const B = (s: SweetlandsState) => s.players.find((p) => p.playerId === 'b')!;

  it('the option text says the second capture is asked after the knight moves again', () => {
    const plays = getLegalMoves(humanDouble(), 'a').filter((m) => (m.move as RedMove).cardId === DOUBLE.cardId && (m.move as RedMove).takeAction && (m.move as RedMove).unit === 'ambassador');
    expect(plays.length).toBe(2);
    for (const m of plays) expect(m.description).toMatch(/after your knight moves again you choose the second capture/i);
  });

  it('two possible targets: the game waits, offers both, and refuses anything else', () => {
    const s = playDouble(humanDouble(), { targetPlayerId: 'b', targetUnit: 'ambassador' }).newState;
    expect(s.pending).toEqual({ kind: 'capture_choice', forPlayerId: 'a' });
    expect(A(s).turn.step).toBe('play');
    expect(B(s).units.ambassador.zone).toBe('start'); // the first capture happened
    const legal = getLegalMoves(s, 'a');
    expect(legal.every((m) => m.move.type === 'choose_capture')).toBe(true);
    expect(new Set(legal.map((m) => `${(m.move as RedMove).targetPlayerId}/${(m.move as RedMove).targetUnit}`))).toEqual(new Set(['b/leader', 'b/ambassador']));
    expect(getLegalMoves(s, 'b')).toEqual([]);
    expect(() => applyMove(s, 'a', { type: 'pass' })).toThrow(/choose who the second Red/);
    expect(() => applyMove(s, 'a', { type: 'choose_capture', targetPlayerId: 'b', targetUnit: 'knight' })).toThrow(/not in your knight's region/);
  });

  it("the player's answer is captured and the turn moves on", () => {
    const s = playDouble(humanDouble(), { targetPlayerId: 'b', targetUnit: 'ambassador' }).newState;
    const r = applyMove(s, 'a', { type: 'choose_capture', targetPlayerId: 'b', targetUnit: 'leader' });
    expect(r.newState.pending).toBeNull();
    expect(B(r.newState).units.leader.zone).toBe('start');
    expect(A(r.newState).turn.step).toBe('influence');
    expect(A(r.newState).points).toBe(1); // the public "capture a leader"
    expect(r.summary).toMatch(/second Red: captured b's leader/);
  });

  it('only one way it can go: no question, the capture just happens', () => {
    const r = playDouble(humanDouble([], 'milkshake'), { targetPlayerId: 'b', targetUnit: 'ambassador' });
    expect(r.newState.pending).toBeNull();
    expect(B(r.newState).units.leader.zone).toBe('start');
    expect(A(r.newState).turn.step).toBe('influence');
  });

  it('one leader but both "capture a leader" objectives open: it asks which one scores', () => {
    const s = playDouble(humanDouble(['capture_leader'], 'milkshake'), { targetPlayerId: 'b', targetUnit: 'ambassador' }).newState;
    expect(s.pending?.kind).toBe('capture_choice');
    const picks = getLegalMoves(s, 'a').map((m) => (m.move as RedMove).captureLeaderScores);
    expect(picks).toEqual(['secret', 'public']);
    const a = A(applyMove(s, 'a', { type: 'choose_capture', targetPlayerId: 'b', targetUnit: 'leader', captureLeaderScores: 'public' }).newState);
    expect(a.points).toBe(1);
    expect(a.secretObjectivesScored ?? []).not.toContain('capture_leader');
  });

  it('a first capture that wins the game asks nothing more', () => {
    const s = humanDouble(['capture_ambassador']);
    A(s).points = 3; // the secret "capture an ambassador" (+2) reaches 5
    const r = playDouble(s, { targetPlayerId: 'b', targetUnit: 'ambassador' });
    expect(r.newState.phase).toBe('game_over');
    expect(r.newState.pending).toBeNull();
    expect(B(r.newState).units.leader).toEqual({ zone: 'ring', region: 2, ringIndex: 3 }); // no second capture
  });

  it('an AI seat is not asked: its second capture takes a leader first', () => {
    const r = playDouble(standoff([], DOUBLE), { targetPlayerId: 'b', targetUnit: 'ambassador' });
    expect(r.newState.pending).toBeNull();
    expect(B(r.newState).units.leader.zone).toBe('start');
    expect(r.summary).toMatch(/captured b's ambassador.*captured b's leader/);
  });

  it('next_step asks the human, lists the options, and passes the facts check', () => {
    const base: SessionState<SweetlandsState> = game.createSession([{ player_id: 'a', kind: 'human' }, ai('b')], { seed: 5 });
    const gs = playDouble(humanDouble(), { targetPlayerId: 'b', targetUnit: 'ambassador' }).newState;
    const step = game.describeNextStep({ ...base, gameState: gs, activePlayerId: gs.activePlayerId });
    expect(step?.status).toBe('human_to_move');
    expect(step?.active_player_id).toBe('a');
    expect(step?.facts?.options?.length).toBe(2);
    expect(lintNextStepFacts(step!)).toEqual([]);
  });
});
