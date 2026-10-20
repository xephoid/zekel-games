// AI locks (AI-NOTES.md): every tier plays only offered moves and finishes
// games at every player count; the stall found in this gate stays fixed; the
// strategy names parse; the one evaluation feeds the scoreboard and the search.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';
import { outlook, parseStrategy, pAtLeast, rankTargets } from '../aiPlanner.js';
import { aoHeuristic, aoSearchMoves } from '../mctsHooks.js';
import { tileHexes } from '../engine.js';

function session(n: number, seed: number): SessionState<AOState> {
  return game.createSession(Array.from({ length: n }, (_, i) => ({ player_id: String.fromCharCode(97 + i), kind: 'ai' })) as PlayerConfig[], { seed });
}

describe('every tier plays legal moves to the end of the game', () => {
  for (const n of [2, 3, 4]) {
    for (const tier of ['easy', 'medium', 'hard']) {
      it(`${tier}, ${n} players`, async () => {
        for (const seed of [1, 2]) {
          let s = session(n, seed);
          let moves = 0;
          while (!game.isGameOver(s) && moves < 3000) {
            const seat = s.gameState.pending!.seat;
            const { move } = await game.getAIMove!(s, seat, tier);
            const offered = game.getLegalMoves(s, seat).map((l) => JSON.stringify(l.move));
            // A roll carries its dice beside the offered total, so a screen can
            // show them; the dice must add up to the total the menu offered.
            const { dice, ...offeredShape } = move as Record<string, unknown> & { dice?: number[] };
            expect(offered, `${tier} seed ${seed} move ${moves}`).toContain(JSON.stringify(offeredShape));
            if (dice !== undefined) {
              expect(['report_turn_order_roll', 'report_test_roll']).toContain(move.type);
              expect(dice.reduce((a, b) => a + b, 0)).toBe((move as { total: number }).total);
            }
            s = game.applyMove(s, seat, move).newState;
            moves++;
          }
          expect(game.isGameOver(s), `${tier} ${n}p seed ${seed}`).not.toBeNull();
        }
      });
    }
  }
});

// The stall found in this gate: two tied hard AIs each held back the last tile
// forever. Removing the hold-back rule fixed the cause (exploring is now always
// worth something); the planner also falls back to exploring when nothing else
// has value. Either alone keeps this test green — it locks the outcome.
describe('the stall found in this gate', () => {
  it('with nothing else worth doing and the last tile left, hard explores instead of stopping', async () => {
    let s = session(2, 3);
    while (s.gameState.pending?.kind === 'setup_standee_colour') {
      const seat = s.gameState.pending.seat;
      s = game.applyMove(s, seat, (await game.getAIMove!(s, seat, 'hard')).move).newState;
    }
    const g = s.gameState;
    // Every icon done except ones worth nothing; one tile left; equal standing.
    g.round = 5;
    g.inPlayQuests = { most_little_monsters: 'unclaimed', most_big_monsters: 'unclaimed', explore_3_tiles: 'b' };
    g.players.b.questPoints = 0;
    g.tileStack = g.tileStack.slice(0, 1);
    for (const h of g.iconHexes) { h.completed = true; h.completedBy = 'b'; }
    g.iconHexes.push({ key: '99,99', tileId: 0, localHex: 'N', kind: 'hearts', completed: false, completedBy: null });
    const centre = g.placedTiles[0]!.center.key;
    const outer = tileHexes(centre).find((k) => k !== centre)!;
    g.players.a.hexKey = outer; g.players.a.stepsLeft = 2;
    g.pending = { kind: 'move', seat: 'a' };
    const t = rankTargets({ state: g, me: 'a', archetype: 'adaptive', careful: true }, null);
    expect(t[0]?.kind).toBe('explore');
  });
});

describe('planner pieces', () => {
  it('strategy names and aliases parse; unknown means adaptive', () => {
    expect(parseStrategy('Monsters')).toBe('hunter');
    expect(parseStrategy('dungeon')).toBe('delver');
    expect(parseStrategy('artifacts')).toBe('collector');
    expect(parseStrategy(undefined)).toBe('adaptive');
    expect(parseStrategy('nonsense')).toBe('adaptive');
  });

  it('dice odds are exact', () => {
    expect(pAtLeast(1, 7)).toBe(0);
    expect(pAtLeast(1, 4)).toBeCloseTo(0.5);
    expect(pAtLeast(2, 7)).toBeCloseTo(21 / 36);
  });

  it('the scoreboard, the search leaf and the planner read the same evaluation', () => {
    const s = session(3, 9);
    const g = s.gameState;
    g.inPlayQuests = { most_artifacts: 'unclaimed', recruit_2_companions: 'unclaimed', explore_3_tiles: 'unclaimed', most_big_monsters: 'unclaimed' };
    g.players.a.artifacts = ['hearts', 'spades'];
    const row = game.getScoreboard!(s).a!;
    expect(row.outlook).toBeCloseTo(outlook(g, 'a'), 3);
    expect(aoHeuristic(s, 'a')).toBeGreaterThan(0.5); // a leads the artifact race
  });

  it('the search never offers itself a choice of dice', async () => {
    let s = session(2, 4);
    while (!(s.gameState.pending?.kind === 'roll')) {
      const seat = s.gameState.pending!.seat;
      s = game.applyMove(s, seat, (await game.getAIMove!(s, seat, 'hard')).move).newState;
    }
    expect(aoSearchMoves(s, s.gameState.pending!.seat)).toHaveLength(1);
  });
});
