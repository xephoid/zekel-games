// Adventurer Olympics — what a screen reads from the view instead of working
// rules out itself (the Universe client never holds a second copy of a rule):
// the placement preview while a tile waits to be placed.

import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics } from '../index.js';
import type { AOState } from '../types.js';
import { availableColours } from '../engine.js';
import { iconHexesForTile, tileHexes } from '../hexMap.js';
import { TILES } from '../data.js';

type Move = Record<string, unknown> & { type: string };
const g = (s: SessionState<AOState>): AOState => s.gameState;

/** A digital human (a) and an AI (b); one tile on the map; a to move from
 *  the centre with 2 steps. */
function table(tileId: number, aTable: 'digital' | 'physical' = 'digital'): SessionState<AOState> {
  let s = adventurerOlympics.createSession(
    [
      { player_id: 'a', kind: 'human', table: aTable, name: 'Alice' } as PlayerConfig,
      { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig,
    ],
    { seed: 777 },
  );
  let guard = 0;
  while (g(s).pending?.kind === 'setup_standee_colour' && guard++ < 8) {
    s = adventurerOlympics.applyMove(s, g(s).pending!.seat, { type: 'setup_standee', colour: availableColours(g(s))[0] }).newState;
  }
  const st = g(s);
  const t = { tileId, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  st.placedTiles = [t];
  st.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === tileId)!);
  st.hexes = {};
  for (const k of tileHexes('0,0')) st.hexes[k] = true;
  const blanks = tileHexes('0,0').filter((k) => k !== '0,0' && !st.iconHexes.some((i) => i.key === k));
  st.players.a.hexKey = '0,0';
  st.players.b.hexKey = blanks[0]!;
  st.players.a.stepsLeft = 2;
  st.players.a.initiative = 1;
  st.players.b.initiative = 2;
  st.pending = { kind: 'move', seat: 'a' };
  st.activeSeat = 'a';
  return s;
}
const view = (s: SessionState<AOState>) => adventurerOlympics.getPlayerView(s, 'a') as Record<string, any>;

describe('the placement preview', () => {
  it('is empty until a tile waits to be placed', () => {
    const s = table(5);
    expect(view(s).placementOptions).toBeNull();
  });

  it('offers exactly the placements get_legal_moves offers, and each lands where it says', () => {
    let s = table(7); // Tile 7: NW Dungeon, S Diamonds, NE + SE Little Monster
    const st = g(s);
    st.players.a.hexKey = tileHexes('0,0').find((k) => k !== '0,0' && k !== st.players.b.hexKey && !st.iconHexes.some((i) => i.key === k))!;
    s = adventurerOlympics.applyMove(s, 'a', { type: 'explore' }).newState;
    const opts = view(s).placementOptions;
    expect(opts.tileId).toBe(g(s).pending!.payload!.tileId);
    expect(opts.context).toBe('ordinary');

    const offered = opts.slots.flatMap((sl: any) => sl.rotations.map((r: any) => JSON.stringify(r.move))).sort();
    const legal = adventurerOlympics.getLegalMoves(s, 'a').map((m) => JSON.stringify(m.move)).sort();
    expect(offered).toEqual(legal);

    for (const sl of opts.slots) {
      expect(sl.hexes).toHaveLength(7);
      expect(sl.against.length).toBeGreaterThan(0);
      for (const h of sl.hexes) expect(g(s).hexes[h]).toBeUndefined(); // no overlap with the map
      for (const r of sl.rotations) {
        const placed = adventurerOlympics.applyMove(s, 'a', r.move as Move).newState;
        for (const h of sl.hexes) expect(g(placed).hexes[h]).toBe(true);
        const newIcons = g(placed).iconHexes.filter((i) => i.tileId === opts.tileId)
          .map((i) => `${i.key}:${i.kind}`).sort();
        expect(newIcons).toEqual(r.icons.map((i: any) => `${i.hex}:${i.kind}`).sort());
      }
    }
  });
});

describe('why Explore is off', () => {
  const reason = (s: SessionState<AOState>) =>
    adventurerOlympics.describeMoveGates!(s, 'a').find((x) => x.move_type === 'explore');
  const outerBlank = (s: SessionState<AOState>) => {
    const st = g(s);
    return tileHexes('0,0').find((k) => k !== '0,0' && k !== st.players.b.hexKey && !st.iconHexes.some((i) => i.key === k))!;
  };

  it('is available on an outer hex with a step left and an empty slot', () => {
    const s = table(5);
    g(s).players.a.hexKey = outerBlank(s);
    expect(reason(s)?.status).toBe('available');
  });

  it('on a centre hex', () => {
    const s = table(5);
    expect(reason(s)).toMatchObject({ status: 'gated', reason: expect.stringMatching(/centre hex/) });
  });

  it('with no steps left', () => {
    const s = table(5);
    g(s).players.a.hexKey = outerBlank(s);
    g(s).players.a.stepsLeft = 0;
    expect(reason(s)).toMatchObject({ status: 'gated', reason: 'no steps left' });
  });

  it('with no tiles left', () => {
    const s = table(5);
    g(s).players.a.hexKey = outerBlank(s);
    g(s).tileStack = [];
    expect(reason(s)).toMatchObject({ status: 'gated', reason: 'no tiles left in the stack' });
  });

  it('when both slots next to the hex are taken', () => {
    let s = table(5);
    const here = outerBlank(s);
    g(s).players.a.hexKey = here;
    // Fill both of this hex's slots by placing the next two tiles there.
    for (let n = 0; n < 2; n++) {
      const st = g(s);
      const saved = { hex: st.players.a.hexKey, steps: st.players.a.stepsLeft };
      s = adventurerOlympics.applyMove(s, 'a', { type: 'explore' }).newState;
      const place = adventurerOlympics.getLegalMoves(s, 'a')[0]!.move as Move;
      s = adventurerOlympics.applyMove(s, 'a', place).newState;
      const after = g(s);
      after.players.a.hexKey = saved.hex;
      after.players.a.stepsLeft = saved.steps;
      after.pending = { kind: 'move', seat: 'a' };
      after.activeSeat = 'a';
    }
    expect(reason(s)).toMatchObject({ status: 'gated', reason: 'both slots next to your hex are already taken' });
  });
});

describe('the dice of each roll', () => {
  const toCity = (s: SessionState<AOState>) => {
    const city = g(s).iconHexes.find((i) => i.kind === 'city')!.key;
    s = adventurerOlympics.applyMove(s, 'a', { type: 'step', to: city }).newState;
    return adventurerOlympics.applyMove(s, 'a', { type: 'resolve_report' }).newState; // Draw
  };

  it('the Roll button records each die in the view', () => {
    let s = toCity(table(1)); // Tile 1: SW City
    const count = g(s).pending!.payload!.diceCount as number;
    const logBefore = g(s).log.length;
    s = adventurerOlympics.applyMove(s, 'a', { type: 'resolve_report' }).newState;
    const roll = view(s).lastRoll;
    expect(roll).toMatchObject({ seat: 'a', kind: 'test', logSeq: logBefore + 1 });
    expect(roll.dice).toHaveLength(count);
    expect(roll.dice.reduce((x: number, y: number) => x + y, 0)).toBe(roll.total);
  });

  it('a digital seat gets only the Roll button, and a reported total is refused', () => {
    const s = toCity(table(1));
    expect(adventurerOlympics.getLegalMoves(s, 'a').map((m) => m.move)).toEqual([{ type: 'resolve_report' }]);
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 12 })).toThrow(/Roll button/);
    expect(adventurerOlympics.describeMoveGates!(s, 'a').map((x) => x.move_type)).toEqual(['resolve_report']);
  });

  it('a reported roll (real dice) may name its dice; they must match the total', () => {
    let s = table(1, 'physical');
    const city = g(s).iconHexes.find((i) => i.kind === 'city')!.key;
    s = adventurerOlympics.applyMove(s, 'a', { type: 'step', to: city }).newState;
    s = adventurerOlympics.applyMove(s, 'a', adventurerOlympics.getLegalMoves(s, 'a')[0]!.move as Move).newState; // report the card
    expect(g(s).pending?.kind).toBe('roll');
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 3, dice: [4] })).toThrow(/add up to 4, not 3/);
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 3, dice: [1, 2] })).toThrow(/1 whole number/);
    const ok = adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 3, dice: [3] }).newState;
    expect(view(ok).lastRoll).toMatchObject({ dice: [3], total: 3 });
    const bare = adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 3 }).newState;
    expect(view(bare).lastRoll).toMatchObject({ dice: null, total: 3 });
  });

  it('an AI roll carries its dice in the move', async () => {
    const s = table(1);
    const st = g(s);
    st.drawStack = ['b']; st.baseTotals = {}; st.groupTotals = {}; st.tieBand = null;
    st.pending = { kind: 'roll', seat: 'b', payload: { rollKind: 'turn_order', diceCount: 2 } };
    const { move } = await adventurerOlympics.getAIMove!(s, 'b', 'hard');
    const m = move as { type: string; total: number; dice: number[] };
    expect(m.type).toBe('report_turn_order_roll');
    expect(m.dice).toHaveLength(2);
    expect(m.dice[0]! + m.dice[1]!).toBe(m.total);
  });
});

describe('log headlines', () => {
  it('a completed icon is a headline about its player; a trigger line is not', () => {
    let s = table(1, 'physical');
    const city = g(s).iconHexes.find((i) => i.kind === 'city')!.key;
    s = adventurerOlympics.applyMove(s, 'a', { type: 'step', to: city }).newState;
    s = adventurerOlympics.applyMove(s, 'a', adventurerOlympics.getLegalMoves(s, 'a')[0]!.move as Move).newState; // report the card
    s = adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 6 * (g(s).pending!.payload!.diceCount as number) }).newState;
    const log = adventurerOlympics.getLog!(s);
    const done = log.find((e) => /it is completed/.test(e.summary))!;
    expect(done.headline).toBe(done.summary);
    expect(done.subject).toBe('a');
    const trig = log.find((e) => /triggers for/.test(e.summary))!;
    expect(trig.headline).toBeUndefined();
  });
});

describe('stats and tile shapes in the view', () => {
  it("a player's stats are the starting values plus their companions' bonuses", () => {
    const s = table(1);
    const me = () => view(s).players.find((p: any) => p.player_id === 'a');
    expect(me().stats).toEqual({ charisma: 1, strength: 1, movement: 2 });
    g(s).players.a.companions = ['companion-4', 'companion-14']; // +1 S +1 C, +2 S +2 M
    expect(me().stats).toEqual({ charisma: 2, strength: 4, movement: 4 });
  });

  it('each tile lists the seven hexes it covers, centre first', () => {
    const s = table(1);
    const t = view(s).map.tiles[0];
    expect(t.hexes).toHaveLength(7);
    expect(t.hexes[0]).toBe(t.center);
    for (const h of t.hexes) expect(view(s).map.hexes).toContain(h);
  });
});

describe('tokens in the view', () => {
  it('each colour has 10 tokens; tokensLeft counts down as they go on the map', () => {
    const s = table(1);
    expect(view(s).referenceData.tokensPerColour).toBe(10);
    const me = () => view(s).players.find((p: any) => p.player_id === 'a');
    expect(me().tokensLeft).toBe(10);
    g(s).players.a.tokensSpent = 3;
    expect(me().tokensLeft).toBe(7);
  });
});

describe('quests in the view', () => {
  it('each quest in play gives its target and how far every seat has got', () => {
    const s = table(1);
    const st = g(s);
    st.inPlayQuests = { explore_3_tiles: 'unclaimed', most_artifacts: 'unclaimed' };
    st.players.a.exploredTileIds = [4, 7];
    st.players.b.artifacts = ['hearts'];
    const qs = view(s).quests;
    expect(qs.find((q: any) => q.kind === 'explore_3_tiles')).toMatchObject({ target: 3, endGame: false, claimedBy: null, progress: { a: 2, b: 0 } });
    expect(qs.find((q: any) => q.kind === 'most_artifacts')).toMatchObject({ target: null, endGame: true, progress: { a: 0, b: 1 } });
  });
});

