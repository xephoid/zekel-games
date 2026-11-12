// The candy board's drawing geometry (glue/sl/geometry.ts): every square is
// painted as a land, the castle as nobody's, and every road arrow points
// along the road to the castle.

import { describe, expect, it } from 'vitest';
import { CASTLE_POS, SPACES } from '../sweetlands-board.js';
import { COLS, LAND, ROAD_ARROW, ROWS, TILES, landEdges } from '../geometry.js';
import { readTable, tileOf } from '../read.js';
import { pieceTitle } from '../Piece.js';
import { hopTiles } from '../motion.js';
import type { GlueInput } from '@zekel/glue-kit';

describe('the candy board', () => {
  it('paints every grid square as a land, the four castle squares as nobody', () => {
    expect(Object.keys(LAND)).toHaveLength(ROWS * COLS);
    for (const [r, c] of CASTLE_POS) expect(LAND[`${r},${c}`]).toBe(0);
    for (const t of TILES) expect(LAND[`${t.row},${t.col}`], t.id).toBe(t.region);
    expect(Object.values(LAND).filter((x) => x === 0)).toHaveLength(4);
  });

  it('gives an empty square the nearest tile’s land', () => {
    // (11,8) sits between Milkshake ring spaces at (10,8) and (11,9): region 1.
    expect(LAND['11,8']).toBe(1);
    // (1,13) is nearest Fudge's ring space at (2,12), nearer than Jellybean's start at (1,11).
    expect(LAND['1,13']).toBe(2);
  });

  it('outlines a land only where it meets another land, the castle or the edge', () => {
    const e = landEdges(11, 3); // Milkshake ring 0, on the bottom row
    expect(e.bottom).toBe(true); // the board's edge
    expect(e.right).toBe(false); // Milkshake's home at (11,4)
    expect(landEdges(5, 6).right).toBe(true); // Cheesecake's land meets the castle at (5,7)
  });

  it('points every road arrow along the road, the last one into the castle', () => {
    const roads = SPACES.filter((s) => s.zone === 'road');
    expect(roads).toHaveLength(24);
    for (const s of roads) expect(ROAD_ARROW[s.id], s.id).toBeTypeOf('number');
    // Milkshake's road ends at (7,8), under the castle square (6,8): up.
    expect(ROAD_ARROW['r1-road-5']).toBe(-90);
    // Jellybean's ends at (4,8), above (5,8): down.
    expect(ROAD_ARROW['r3-road-5']).toBe(90);
    // Fudge's ends at (5,9), right of (5,8): left. Cheesecake's at (6,6), left of (6,7): right.
    expect(ROAD_ARROW['r2-road-5']).toBe(180);
    expect(ROAD_ARROW['r4-road-5']).toBe(0);
  });

  it('reads where every unit stands from the view’s structured locations', () => {
    expect(tileOf({ zone: 'ring', region: 2, ringIndex: 7 })).toBe('r2-ring-7');
    expect(tileOf({ zone: 'road', region: 4, roadIndex: 0 })).toBe('r4-road-0');
    expect(tileOf({ zone: 'treat', region: 3, slotKind: 'random' })).toBe('r3-treat-random');
    expect(tileOf({ zone: 'start', region: 1 })).toBe('r1-start');
    expect(tileOf({ zone: 'castle' })).toBe('castle');
    expect(tileOf({ zone: 'offboard' })).toBeNull();
  });

  it('reads the foe’s dice from the reference data, not from a table of its own', () => {
    const view = { game_id: 'sweetlands-imperium', phase: 'play', players: [], foe: { type: 'orc', defeated: false }, taxes: {} };
    const base = { view, previous: null, legalMoves: [], unavailable: [], playerId: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map() } as unknown as GlueInput;
    expect(readTable({ ...base, reference: null })!.foe).toEqual({ type: 'orc', dice: null, defeated: false });
    const reference = { gameId: 'sweetlands-imperium', rules: '', moveSchema: {}, optionsSchema: {}, referenceData: { foes: [{ type: 'orc', dice: 3 }] } };
    expect(readTable({ ...base, reference } as GlueInput)!.foe!.dice).toBe(3);
  });

  it('names a piece by owner, piece and place in its tooltip', () => {
    const player = (pid: string, faction: string, home: number, knight: unknown) => ({
      player_id: pid, faction, faction_name: faction, home_region: home, kind: 'human',
      unit_locations: { leader: { zone: 'start', region: home }, knight, ambassador: { zone: 'treat', region: 3, slotKind: 'random' } },
    });
    const view = {
      game_id: 'sweetlands-imperium', phase: 'play', taxes: {}, random_treat_placement: { 3: 'ice_cream' },
      players: [player('p1', 'milkshake', 1, { zone: 'road', region: 1, roadIndex: 2 }), player('p2', 'fudge', 2, { zone: 'ring', region: 2, ringIndex: 6 })],
    };
    const t = readTable({ view, previous: null, legalMoves: [], unavailable: [], playerId: 'p1', reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map() } as unknown as GlueInput)!;
    const [me, fudge] = t.players;
    expect(pieceTitle(t, fudge!, 'knight')).toBe('Fudge’s Knight — red space · Fudge’s land');
    expect(pieceTitle(t, me!, 'knight')).toBe('Your Knight — yellow road space · your land');
    expect(pieceTitle(t, me!, 'leader')).toBe('Your Leader — at home (start tile)');
    expect(pieceTitle(t, fudge!, 'ambassador')).toBe('Fudge’s Ambassador — on the Ice Cream treat · Jellybean’s land');
  });

  it('hops a piece over the spaces the engine listed for its move, and nowhere it did not say', () => {
    const ring = (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex });
    const listed = {
      move_id: 'm', description: '', move: { type: 'play_intel', unit: 'knight' },
      landing: { piece: 'knight', from: ring(1, 4), to: { zone: 'road', region: 1, roadIndex: 0 }, path: [ring(1, 5), { zone: 'road', region: 1, roadIndex: 0 }] },
    };
    expect(hopTiles(listed as never, 'knight')).toEqual(['r1-ring-5', 'r1-road-0']);
    // Another piece, or a move with no landing, gets no path: it moves in one arc.
    expect(hopTiles(listed as never, 'leader')).toEqual([]);
    expect(hopTiles({ move_id: 'p', description: '', move: { type: 'pass' } } as never, 'knight')).toEqual([]);
    expect(hopTiles(null, 'knight')).toEqual([]);
  });
});
