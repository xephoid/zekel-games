// Adventurer Olympics — the Draw button (docs/digital-mode.md: "Randomness is
// server-owned, but only on a button"). When the server owns the decks, a
// digital human's draw waits on a `draw` pending that only their own press of
// resolve_report settles: the card for a test, each Dungeon card (every "draw
// again" too), and the tile for a forced explore or a Dungeon Map card. An AI
// seat is still dealt at once, and a table with real cards still reports.

import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics } from '../index.js';
import type { AOState } from '../types.js';
import { availableColours } from '../engine.js';
import { iconHexesForTile, tileHexes } from '../hexMap.js';
import { TILES } from '../data.js';

type Move = Record<string, unknown> & { type: string };
const g = (s: SessionState<AOState>): AOState => s.gameState;

/** Seat a (human, digital or physical) and seat b (AI), setup done, one tile
 *  on the map, a standing on its centre with 2 steps and the move pending. */
function table(tileId: number, aTable: 'digital' | 'physical' = 'digital'): SessionState<AOState> {
  let s = adventurerOlympics.createSession(
    [
      { player_id: 'a', kind: 'human', table: aTable, name: 'Alice' } as PlayerConfig,
      { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig,
    ],
    { seed: 4242 },
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
  const blank = tileHexes('0,0').find((k) => k !== '0,0' && !st.iconHexes.some((i) => i.key === k))!;
  st.players.a.hexKey = '0,0';
  st.players.b.hexKey = blank;
  st.players.a.stepsLeft = 2;
  st.players.a.initiative = 1;
  st.players.b.initiative = 2;
  st.pending = { kind: 'move', seat: 'a' };
  st.activeSeat = 'a';
  return s;
}

function play(s: SessionState<AOState>, pid: string, move: Move): SessionState<AOState> {
  return adventurerOlympics.applyMove(s, pid, move).newState;
}
const iconKey = (s: SessionState<AOState>, kind: string) => g(s).iconHexes.find((i) => i.kind === kind)!.key;
const legalTypes = (s: SessionState<AOState>, pid: string) =>
  adventurerOlympics.getLegalMoves(s, pid).map((m) => m.move.type);

describe('the Draw button (digital human, server-owned decks)', () => {
  it('stepping onto a City waits for Draw; the card stays face down until then', () => {
    let s = table(1); // Tile 1: SW City, NE Dungeon
    const top = g(s).decks.companion[0];
    const before = g(s).decks.companion.length;
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'city') });
    expect(g(s).pending).toMatchObject({ kind: 'draw', seat: 'a', payload: { deck: 'companion' } });
    expect(g(s).pending!.payload).not.toHaveProperty('cardId');
    expect(JSON.stringify(g(s).log)).not.toContain(String(top));
    expect(g(s).decks.companion.length).toBe(before);
    expect(legalTypes(s, 'a')).toEqual(['resolve_report']);

    const r = adventurerOlympics.applyMove(s, 'a', { type: 'resolve_report' });
    expect(r.summary).toMatch(/pressed Draw/);
    expect(g(r.newState).pending).toMatchObject({ kind: 'roll', seat: 'a', payload: { rollKind: 'test', cardId: top } });
  });

  it('nothing but the seat\'s own button settles it', () => {
    let s = table(1);
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'city') });
    expect(() => adventurerOlympics.applyMove(s, 'b', { type: 'resolve_report' })).toThrow();
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'report_card', card: 'number 2, +1 Strength' })).toThrow();
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: 6 })).toThrow();
    expect(g(s).pending?.kind).toBe('draw');
  });

  it('an AI seat at the same table is still dealt at once', () => {
    let s = table(1);
    const st = g(s);
    st.players.a.hexKey = st.players.b.hexKey;
    st.players.b.hexKey = '0,0';
    st.players.b.stepsLeft = 2;
    st.pending = { kind: 'move', seat: 'b' };
    st.activeSeat = 'b';
    const top = st.decks.companion[0];
    s = play(s, 'b', { type: 'step', to: iconKey(s, 'city') });
    expect(g(s).pending).toMatchObject({ kind: 'roll', seat: 'b', payload: { cardId: top } });
  });

  it('a table with real cards still reports the draw', () => {
    let s = table(1, 'physical');
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'city') });
    expect(g(s).pending?.kind).toBe('report_card');
    expect(() => adventurerOlympics.applyMove(s, 'a', { type: 'resolve_report' })).toThrow();
  });

  it('a Dungeon: Draw for the Dungeon card, then Draw again for the card it asks for', () => {
    let s = table(1);
    g(s).decks.dungeon = ['companion', 'little_monster', 'big_monster'];
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'dungeon') });
    expect(g(s).pending).toMatchObject({ kind: 'draw', payload: { deck: 'dungeon' } });
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).dungeonResolving?.kind).toBe('companion');
    expect(g(s).pending).toMatchObject({ kind: 'draw', payload: { deck: 'companion', dungeon: true } });
    const top = g(s).decks.companion[0];
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).pending).toMatchObject({ kind: 'roll', payload: { cardId: top, dungeon: true } });
  });

  it('a Dungeon card that gives nothing waits for Draw before the next card', () => {
    let s = table(1);
    g(s).players.a.artifacts = ['hearts', 'spades', 'diamonds', 'clubs'];
    g(s).decks.dungeon = ['any_artifact', 'little_monster', 'companion'];
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'dungeon') });
    s = play(s, 'a', { type: 'resolve_report' });
    // "Any artifact" gives nothing (a holds all four), so it goes under the deck
    // and the next Dungeon card is owed, still face down.
    expect(g(s).decks.dungeon).toEqual(['little_monster', 'companion', 'any_artifact']);
    expect(g(s).pending).toMatchObject({ kind: 'draw', payload: { deck: 'dungeon' } });
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).dungeonResolving?.kind).toBe('little_monster');
  });

  it('declining "Any artifact" waits for Draw before the next card', () => {
    let s = table(1);
    g(s).decks.dungeon = ['any_artifact', 'big_monster'];
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'dungeon') });
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).pending?.kind).toBe('take_artifact');
    s = play(s, 'a', { type: 'decline_artifact' });
    expect(g(s).pending).toMatchObject({ kind: 'draw', payload: { deck: 'dungeon' } });
  });

  it('a Dungeon Map card: Draw turns the tile over, then the player places it anywhere', () => {
    let s = table(1);
    g(s).decks.dungeon = ['map', 'companion'];
    const tile = g(s).tileStack[0];
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'dungeon') });
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).pending).toMatchObject({ kind: 'draw', payload: { deck: 'tile', context: 'dungeon_map' } });
    expect(g(s).tileStack[0]).toBe(tile);
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).pending).toMatchObject({ kind: 'explore_place', payload: { tileId: tile, context: 'dungeon_map' } });
  });

  it('a forced explore at the start of the turn waits for Draw', () => {
    let s = table(1);
    const st = g(s);
    for (const i of st.iconHexes) { i.completed = true; i.completedBy = 'b'; }
    st.players.a.initiative = 2;
    st.players.b.initiative = 1;
    st.pending = { kind: 'move', seat: 'b' };
    st.activeSeat = 'b';
    const tile = st.tileStack[0];
    s = play(s, 'b', { type: 'stop' });
    expect(g(s).pending).toMatchObject({ kind: 'draw', seat: 'a', payload: { deck: 'tile', context: 'forced' } });
    s = play(s, 'a', { type: 'resolve_report' });
    expect(g(s).pending).toMatchObject({ kind: 'explore_place', payload: { tileId: tile, context: 'forced' } });
  });

  it('an ordinary Explore is the press itself: the tile turns over at once', () => {
    let s = table(1);
    const st = g(s);
    const outer = tileHexes('0,0').find((k) => k !== '0,0' && k !== st.players.b.hexKey && !st.iconHexes.some((i) => i.key === k))!;
    st.players.a.hexKey = outer;
    const tile = st.tileStack[0];
    s = play(s, 'a', { type: 'explore' });
    expect(g(s).pending).toMatchObject({ kind: 'explore_place', payload: { tileId: tile, context: 'ordinary' } });
  });

  it('a placement with no rotation is refused, not read as 0', () => {
    let s = table(1);
    const st = g(s);
    st.players.a.hexKey = tileHexes('0,0').find((k) => k !== '0,0' && k !== st.players.b.hexKey && !st.iconHexes.some((i) => i.key === k))!;
    s = play(s, 'a', { type: 'explore' });
    const place = adventurerOlympics.getLegalMoves(s, 'a')[0]!.move as Move;
    expect(place).toHaveProperty('rotation');
    const { rotation: _r, ...noRotation } = place;
    expect(() => adventurerOlympics.applyMove(s, 'a', noRotation as Move)).toThrow(/which way is the tile turned/);
    expect(g(s).pending?.kind).toBe('explore_place');
    s = play(s, 'a', place);
    expect(g(s).placedTiles).toHaveLength(2);
  });

  it('the Draw step names no card in the move list or the gates', () => {
    let s = table(1);
    s = play(s, 'a', { type: 'step', to: iconKey(s, 'city') });
    const top = String(g(s).decks.companion[0]);
    const legal = adventurerOlympics.getLegalMoves(s, 'a');
    expect(legal).toHaveLength(1);
    expect(legal[0]!.description).toMatch(/Draw the top Companion card/);
    expect(JSON.stringify(legal)).not.toContain(top);
    const gates = adventurerOlympics.describeMoveGates!(s, 'a');
    expect(gates.find((x) => x.move_type === 'resolve_report')?.status).toBe('available');
  });
});
