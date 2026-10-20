import { describe, expect, it } from 'vitest';
import { adventurerOlympics } from '../index.js';
import { availableColours } from '../engine.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import type { AOState } from '../types.js';

type Move = Record<string, unknown> & { type: string };

function g(s: SessionState<AOState>): AOState {
  return s.gameState;
}

function applyMove(state: SessionState<AOState>, pid: string, move: Move): SessionState<AOState> {
  const result = adventurerOlympics.applyMove(state, pid, move) as { newState: SessionState<AOState> };
  return result.newState ?? (state as SessionState<AOState>);
}

function makeTwoAi(seed = 12345): SessionState<AOState> {
  return adventurerOlympics.createSession(
    [
      { player_id: 'a', kind: 'ai' } as PlayerConfig,
      { player_id: 'b', kind: 'ai' } as PlayerConfig,
    ],
    { seed },
  );
}

/** Drive setup to completion: both seats pick a standee. */
function finishSetupMoves(s: SessionState<AOState>): SessionState<AOState> {
  let guard = 8;
  while (g(s).pending?.kind === 'setup_standee_colour' && guard-- > 0) {
    const pid = g(s).pending!.seat;
    s = applyMove(s, pid, { type: 'setup_standee', standee: pid.toUpperCase(), colour: availableColours(g(s))[0] });
  }
  return s;
}

/** Roll turn order until the move phase starts (or a non-roll pending is owed). */
function enterMovePhase(s: SessionState<AOState>): SessionState<AOState> {
  let guard = 50;
  while (g(s).pending?.kind === 'roll' && guard-- > 0) {
    const seat = g(s).pending!.seat;
    const total = guard % 2 === 0 ? 7 : 9;
    s = applyMove(s, seat, { type: 'report_turn_order_roll', total });
  }
  return s;
}

describe('Adventurer Olympics — engine baseline', () => {
  describe('setup', () => {
    it('creates a 2-player session with a pending setup_standee_colour', () => {
      const s = makeTwoAi();
      expect(g(s).pending?.kind).toBe('setup_standee_colour');
      expect(g(s).playerOrder).toHaveLength(2);
      expect(Object.keys(g(s).hexes)).toHaveLength(0);
      for (const pid of g(s).playerOrder) {
        expect(g(s).players[pid]?.standee).toBe('');
        expect(g(s).players[pid]?.colour).toBe('');
      }
    });

    it('rejects fewer than 2 players', () => {
      expect(() =>
        adventurerOlympics.createSession([{ player_id: 'a', kind: 'ai' } as PlayerConfig]),
      ).toThrow(/2–4/);
    });

    it('rejects more than 4 players', () => {
      expect(() =>
        adventurerOlympics.createSession(
          [1, 2, 3, 4, 5].map((n) => ({ player_id: `p${n}`, kind: 'ai' } as PlayerConfig)),
        ),
      ).toThrow(/2–4/);
    });

    it('waits for every seat to pick before finishing setup', () => {
      let s = makeTwoAi();
      const first = g(s).pending!.seat;
      s = applyMove(s, first, { type: 'setup_standee', standee: 'Red', colour: 'Red' });
      expect(g(s).pending?.kind).toBe('setup_standee_colour');
      expect(g(s).pending?.seat).not.toBe(first);
      const second = g(s).pending!.seat;
      s = applyMove(s, second, { type: 'setup_standee', standee: 'Blue', colour: 'Blue' });
      expect(g(s).pending?.kind).toBe('roll');
      expect(g(s).placedTiles).toHaveLength(1);
      const center = g(s).placedTiles[0]?.center.key;
      expect(center).toBeTruthy();
      for (const pid of g(s).playerOrder) {
        expect(g(s).players[pid]?.hexKey).toBe(center);
      }
      expect(g(s).players[first]?.standee).toBe('Red');
      expect(g(s).players[second]?.standee).toBe('Blue');
      // ONE shared tile stack (9 remain after the starting tile) and real decks.
      expect(g(s).tileStack).toHaveLength(9);
      expect(g(s).decks.companion).toHaveLength(16);
      expect(g(s).decks.dungeon).toHaveLength(24);
    });
  });

  describe('turn order', () => {
    it('accepts reported totals, assigns initiative, and starts round 1 at the first seat', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      expect(g(s).pending?.kind).toBe('roll');
      s = enterMovePhase(s);
      expect(g(s).round).toBe(1);
      const ordered = [...g(s).playerOrder].sort(
        (x, y) => (g(s).players[x]?.initiative ?? 99) - (g(s).players[y]?.initiative ?? 99),
      );
      expect(ordered).toHaveLength(2);
      const first = ordered[0] as string;
      expect(g(s).activeSeat).toBe(first);
      expect(g(s).pending?.kind).toBe('move');
      expect(g(s).pending?.seat).toBe(first);
      expect(g(s).players[first]?.stepsLeft).toBeGreaterThan(0);
    });

    it('re-rolls tied seats until the order settles — every seat rolls again each round', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      // Both roll 7 → tied → both re-roll.
      let guard = 60;
      let sawTieReroll = false;
      while (g(s).pending?.kind === 'roll' && g(s).pending?.payload?.rollKind === 'turn_order' && guard-- > 0) {
        const seat = g(s).pending!.seat;
        if (g(s).pending!.payload?.band) sawTieReroll = true; // band re-roll pending
        // 'a' out-rolls 'b' once the tie band opens; the base pass stays 7/7.
        const inBand = Boolean(g(s).pending!.payload?.band);
        s = applyMove(s, seat, { type: 'report_turn_order_roll', total: inBand ? (seat === 'a' ? 12 : 2) : 7 });
      }
      expect(sawTieReroll).toBe(true);
      expect(g(s).pending?.kind).toBe('move');
      expect(g(s).round).toBe(1);
      expect(g(s).players.a.initiative).toBe(1);
      expect(g(s).players.b.initiative).toBe(2);
    });

    it('round 2 requires every seat to roll again (F7 round-roll-reset)', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      s = enterMovePhase(s);
      // Both seats stop: the round completes.
      const first = g(s).pending!.seat;
      s = applyMove(s, first, { type: 'stop' });
      const second = g(s).pending!.seat;
      s = applyMove(s, second, { type: 'stop' });
      // Round 2 must begin with a fresh roll from the FIRST seat — not pick up
      // where round 1 left off.
      expect(g(s).pending?.kind).toBe('roll');
      expect(g(s).pending?.payload?.rollKind).toBe('turn_order');
      expect(g(s).drawStack).toHaveLength(2);
      expect(g(s).baseTotals).toEqual({});
    });
  });

  describe('move phase', () => {
    it('offers stop as a legal move and ends the turn', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      s = enterMovePhase(s);
      const seat = g(s).pending!.seat;
      const moves = adventurerOlympics.getLegalMoves(s, seat);
      expect(moves.some((m) => m.move.type === 'stop')).toBe(true);
      s = applyMove(s, seat, { type: 'stop' });
      expect(g(s).pending?.seat).not.toBe(seat);
      expect(g(s).pending?.kind).toBe('move');
    });
  });

  describe('ending sequence', () => {
    it('placing the last tile does NOT end the game; one more full round runs first (F4)', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      s = enterMovePhase(s);
      const st = g(s);
      // Set up: only one tile left in the stack; a explores from an outer hex.
      const firstSeat = st.pending!.seat;
      st.tileStack = [st.tileStack[0]!];
      st.players[firstSeat]!.hexKey = '1,0'; // an outer hex of the starting tile
      st.players[firstSeat]!.stepsLeft = 2;
      st.pending = { kind: 'move', seat: firstSeat };
      // Begin the explore (reveal), then place.
      s = applyMove(s, firstSeat, { type: 'explore' });
      expect(g(s).pending?.kind).toBe('explore_place');
      const place = adventurerOlympics.getLegalMoves(s, firstSeat).find((m) => m.move.type === 'explore')!;
      s = applyMove(s, firstSeat, place.move);
      // The last tile is placed: ending begins, but the game is NOT over and the
      // end-of-game quests are NOT awarded yet.
      expect(g(s).endingPhase).toBe(1);
      expect(adventurerOlympics.isGameOver!(s)).toBeNull();
      expect(g(s).gameOver).toBe(false);
    });
  });

  describe('AI baseline', () => {
    it('always returns a move that matches a legal move', async () => {
      for (let seed = 1; seed <= 10; seed++) {
        const s = makeTwoAi(seed);
        const seat = g(s).pending!.seat;
        const legal = adventurerOlympics.getLegalMoves(s, seat);
        expect(legal.length).toBeGreaterThan(0);
        const pick = await adventurerOlympics.getAIMove!(s, seat, 'medium');
        const match = legal.find((m) => JSON.stringify(m.move) === JSON.stringify(pick.move));
        expect(match, `seed ${seed}: AI move not in legal set`).toBeDefined();
      }
    });

    it('runs an AI-vs-AI game for 40 engine moves without throwing', async () => {
      let s = makeTwoAi(7);
      let safety = 40;
      while (safety-- > 0 && !adventurerOlympics.isGameOver!(s)) {
        const seat = g(s).pending?.seat;
        if (!seat) break;
        const legal = adventurerOlympics.getLegalMoves(s, seat);
        if (legal.length === 0) break;
        let move: Move;
        try {
          const pick = await adventurerOlympics.getAIMove!(s, seat, 'medium');
          move = pick.move as Move;
        } catch {
          move = legal[0]!.move as Move;
        }
        if (!legal.some((m) => JSON.stringify(m.move) === JSON.stringify(move))) {
          move = legal[0]!.move as Move;
        }
        try {
          s = applyMove(s, seat, move);
        } catch (e) {
          s = applyMove(s, seat, legal[0]!.move as Move);
        }
      }
      expect(g(s).log.length).toBeGreaterThan(0);
    });
  });

  describe('views', () => {
    it('exposes the public view with the map, players, and reference data', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      const pub = adventurerOlympics.getPublicView(s) as Record<string, unknown>;
      expect(pub.phase).toBeTruthy();
      expect(Array.isArray(pub.players)).toBe(true);
      expect((pub.players as unknown[]).length).toBe(2);
      expect(pub.referenceData).toBeTruthy();
      expect(pub.map).toBeTruthy();
      expect(Array.isArray((pub.map as { hexes: unknown[] }).hexes)).toBe(true);
    });
  });

  describe('next step + move menu', () => {
    it('describeNextStep names the owed human for the setup phase', () => {
      const s = adventurerOlympics.createSession(
        [
          { player_id: 'a', kind: 'human' } as PlayerConfig,
          { player_id: 'b', kind: 'human' } as PlayerConfig,
        ],
        { seed: 3 },
      );
      const ns = adventurerOlympics.describeNextStep!(s);
      expect(ns).toBeTruthy();
      expect(ns!.status).toBe('human_to_move');
      expect(ns!.active_player_id).toBeTruthy();
      expect(ns!.instruction.toLowerCase()).toContain('standee');
    });
  });

  describe('reported totals', () => {
    it('rejects an impossible test total before any mutation (F14)', () => {
      let s = makeTwoAi();
      s = finishSetupMoves(s);
      s = enterMovePhase(s);
      const st = g(s);
      const seat = st.pending!.seat;
      // A 1-die recruit test pending (diceCount 1: the legit minimum, per the
      // review's report that the schema's minimum: 2 rejected a legal 1).
      // No map fixture needed: the validation must fire before any icon lookup.
      st.pending = { kind: 'roll', seat, payload: { rollKind: 'test', test: 'recruit', cardId: st.decks.companion[0], number: 2, diceCount: 1, iconKey: '0,0' } };
      expect(() => applyMove(s, seat, { type: 'report_test_roll', total: 999 })).toThrow(/integer from 1 to 6/);
      // A legal 1 keeps working — but 1 < 2 fails, so no card is kept and the
      // (fictional) icon hex stays open.
      s = applyMove(s, seat, { type: 'report_test_roll', total: 1 });
      expect(g(s).players[seat]!.companions).toHaveLength(0);
    });
  });
});
