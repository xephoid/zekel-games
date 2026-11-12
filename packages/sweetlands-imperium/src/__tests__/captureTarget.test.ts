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
import type { PlayerConfig } from '@zekel/game-kit';
import type { SweetlandsState, SecretObjectiveId, IntelCard } from '../types.js';

const ai = (id: string): PlayerConfig => ({ player_id: id, kind: 'ai' });
const RED_CARD: IntelCard = { cardId: 'test-red', kind: 'single', color: 'red' };

/** 'a' (Jellybean: its knight always wins against knights, so no dice enter the
 *  checks) has its knight parked in region 2 beside both of 'b's capturable
 *  units, holds one red card, and is on its play step. `secrets` sets 'a's kept
 *  secret objectives. */
function standoff(secrets: SecretObjectiveId[], card: IntelCard = RED_CARD): SweetlandsState {
  let s = createInitialState([ai('a'), ai('b')], { seed: 5, factionAssignment: ['jellybean', 'fudge'] });
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

  it("a double card's second capture takes the same kind of unit the player named", () => {
    const DOUBLE: IntelCard = { cardId: 'test-red2', kind: 'double', color: 'red' };
    const s = standoff([], DOUBLE);
    const plays = getLegalMoves(s, 'a').filter((m) => (m.move as RedMove).cardId === DOUBLE.cardId && (m.move as RedMove).takeAction);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((m) => /resolves Red twice/i.test(m.description))).toBe(true);
    // Name only the KIND of unit. b is Fudge, whose home is region 2, so the
    // captured ambassador lands back beside the knight: the second leg can take
    // it again or the leader. It must keep to ambassadors.
    const r = playRed(s, { targetUnit: 'ambassador' }, DOUBLE.cardId);
    const b = r.newState.players.find((p) => p.playerId === 'b')!;
    expect(r.summary.match(/captured b's ambassador/g)?.length).toBe(2);
    expect(b.units.leader).toEqual({ zone: 'ring', region: 2, ringIndex: 3 });
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
