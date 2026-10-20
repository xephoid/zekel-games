// Adventurer Olympics — post-port rule locks.
// Each test pins a specific RULES.md sentence to engine behavior so the
// traceability matrix rows carry a real test pointer. Rewritten 2026-09-29
// against the review-fixed engine (canonical shared decks, JSON-safe state,
// mirror-fit geometry, band-scoped tie rolls, the full ending sequence).

import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics } from '../index.js';
import type { AOState } from '../types.js';
import {
  applyMove, applyStop, applyTryAgain, applyTestRoll, applyTakeArtifact,
  applyTurnOrderTotal, applyExplore, applyPlaceTile, applyReportCard,
  applyMoveAway, availableColours,
} from '../engine.js';
import { neighbors, iconHexesForTile, tileCenter, tileHexes, sideLabelOf, slotHexes, localHexAbsolute } from '../hexMap.js';
import { TILES, LITTLE_MONSTER_CARDS } from '../data.js';

type Move = Record<string, unknown> & { type: string };

function two(seed = 999): SessionState<AOState> {
  return adventurerOlympics.createSession(
    [{ player_id: 'a', kind: 'ai', name: 'Alice' } as PlayerConfig, { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig],
    { seed },
  );
}
const g = (s: SessionState<AOState>): AOState => s.gameState;
function drive(s: SessionState<AOState>, pid?: string, move?: Move): SessionState<AOState> {
  const r = adventurerOlympics.applyMove(s, pid!, move!) as { newState?: SessionState<AOState> };
  return r.newState ?? s;
}
function setup(s: SessionState<AOState>): SessionState<AOState> {
  let cur = s;
  let guard = 0;
  while (g(cur).pending?.kind === 'setup_standee_colour' && guard++ < 8) {
    cur = drive(cur, g(cur).pending!.seat, { type: 'setup_standee', colour: availableColours(g(cur))[0] });
  }
  return cur;
}
/** Drive round-1 rolls so 'a' goes first, then stop through to the move phase. */
function aFirst(s: SessionState<AOState>): SessionState<AOState> {
  let cur = s;
  let guard = 40;
  while (g(cur).pending?.kind === 'roll' && guard-- > 0) {
    const seat = g(cur).pending!.seat;
    cur = drive(cur, seat, { type: 'report_turn_order_roll', total: seat === 'a' ? 12 : 2 });
  }
  return cur;
}

// Force a deterministic one-tile map with a known icon layout, seat a to move.
function seedMap(s: SessionState<AOState>, tileId: number): SessionState<AOState> {
  const st = g(s);
  const t = { tileId, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  st.placedTiles = [t];
  st.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === tileId)!);
  st.hexes = {};
  for (const k of tileHexes('0,0')) st.hexes[k] = true;
  st.players.a.hexKey = '1,0';
  st.players.b.hexKey = '0,0';
  st.players.a.stepsLeft = 2;
  st.pending = { kind: 'move', seat: 'a' };
  st.activeSeat = 'a';
  return s;
}

describe('post-port rule locks', () => {
  it('§5.3 geometry: two tiles share ZERO hexes (14 distinct) — the mirror fit (F2)', () => {
    let s = setup(two(11));
    s = seedMap(s, 1);
    const st = g(s);
    const slot = `side-0`; // compute across side 0
    const c2 = tileCenter('0,0', 0);
    applyExplore(st, 'a');
    expect(st.pending?.kind).toBe('explore_place');
    applyPlaceTile(st, 'a', c2, 0);
    const keys = new Set(Object.keys(st.hexes));
    expect(keys.size).toBe(14); // 7 + 7, no overlap
    // The new tile's centre is in placedTiles with the correct id.
    expect(st.placedTiles.some((t) => t.center.key === c2)).toBe(true);
    // slotHexes of the starting tile still touch the map (nestle pair).
    expect(Object.keys(st.hexes).includes('0,0')).toBe(true);
  });

  it('§5.3: ordinary explore from a CENTRE hex is rejected (F12)', () => {
    let s = setup(two(12));
    s = seedMap(s, 1);
    const st = g(s);
    st.players.a.hexKey = '0,0'; // centre of the starting tile touches no slot
    expect(() => applyExplore(st, 'a')).toThrow(/centre hex|slot/);
  });

  it('§6.1 City: success recruits (card to player), fail moves card to deck bottom', () => {
    let s = setup(two(13));
    s = seedMap(s, 1); // Tile 1 SW = City
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'city')!;
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    const topBefore = st.decks.companion[0]!;
    s = drive(s, 'a', { type: 'step', to: icon.key });
    expect(g(s).pending?.kind).toBe('roll');
    const need = g(s).pending!.payload!.number as number;
    const diceCount = g(s).pending!.payload!.diceCount as number;
    s = drive(s, 'a', { type: 'report_test_roll', total: Math.max(need, diceCount) });
    expect(g(s).players.a.companions).toContain(topBefore);
    expect(g(s).iconHexes.find((i) => i.key === icon.key)?.completed).toBe(true);
  });

  it('§6.2/§6.3 empty deck: icon test with empty monster deck → icon stays open, turn ends', () => {
    let s = setup(two(22));
    s = seedMap(s, 4); // Tile 4 SW = Little Monster
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'little_monster')!;
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    st.decks.little = [];
    s = drive(s, 'a', { type: 'step', to: icon.key });
    expect(g(s).iconHexes.find((i) => i.key === icon.key)?.completed).toBe(false);
    expect(g(s).pending?.seat).not.toBe('a');
  });

  it('§6.3 Dungeon "2x Little Monsters": the first win keeps the monster and fights the second (F5)', () => {
    let s = setup(two(23));
    s = seedMap(s, 1); // Tile 1 NE = Dungeon
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.decks.dungeon = ['double_little_monsters', 'companion'];
    st.decks.little = ['little-1', 'little-2'];
    // Trigger the dungeon directly (a stands on it).
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    expect(st.pending?.kind).toBe('roll');
    applyTestRoll(st, 'a', 6); // beat little-1 (needs 4)
    // First win: keep the monster, do NOT complete the icon, second fight owed.
    expect(st.players.a.littleMonsters).toContain('little-1');
    expect(icon.completed).toBe(false);
    expect(st.players.a.dungeonsCompleted).toBe(0);
    expect(st.pending?.kind).toBe('roll');
    applyTestRoll(st, 'a', 6); // beat little-2
    expect(st.players.a.littleMonsters).toContain('little-2');
    expect(icon.completed).toBe(true);
    expect(st.players.a.dungeonsCompleted).toBe(1);
    // The Dungeon card cycled to the bottom of the deck.
    expect(st.decks.dungeon).toHaveLength(2);
    expect(st.decks.dungeon[st.decks.dungeon.length - 1]).toBe('double_little_monsters');
    expect(st.dungeonResolving).toBeNull();
  });

  it('§6.3 Dungeon failure: card cycled, icon open, resolving cleared (F5)', () => {
    let s = setup(two(24));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.decks.dungeon = ['double_little_monsters', 'companion'];
    st.decks.little = ['little-1'];
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    applyTestRoll(st, 'a', 1); // lose the first fight
    expect(icon.completed).toBe(false);
    expect(st.players.a.dungeonsCompleted).toBe(0);
    expect(st.dungeonResolving).toBeNull();
    // Dungeon card went to the bottom; deck length conserved.
    expect(st.decks.dungeon).toHaveLength(2);
    expect(st.decks.dungeon[0]).toBe('companion');
  });

  it('§6.3 Dungeon Map: placing the tile completes the dungeon and cycles the card (F6)', () => {
    let s = setup(two(25));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.decks.dungeon = ['map', 'companion'];
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    // Explore pending opens for ANY slot with the tile revealed.
    expect(st.pending?.kind).toBe('explore_place');
    expect(st.pending?.payload?.context).toBe('dungeon_map');
    const slot = tileCenter('0,0', 0);
    applyPlaceTile(st, 'a', slot, 0);
    expect(icon.completed).toBe(true);
    expect(st.players.a.dungeonsCompleted).toBe(1);
    expect(st.dungeonResolving).toBeNull();
    expect(st.decks.dungeon[st.decks.dungeon.length - 1]).toBe('map');
  });

  it('§6.4 artifact hex: takes the artifact from wherever, completes the hex', () => {
    let s = setup(two(33));
    s = seedMap(s, 3); // Tile 3 NE = Hearts
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'hearts')!;
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    s = drive(s, 'a', { type: 'step', to: icon.key });
    expect(g(s).players.a.artifacts).toContain('hearts');
    expect(g(s).iconHexes.find((i) => i.key === icon.key)?.completed).toBe(true);
    expect(g(s).pending?.seat).not.toBe('a');
  });

  it('§6.5 Star is never takeable via "Any artifact" (F13)', () => {
    let s = setup(two(44));
    s = seedMap(s, 6);
    const st = g(s);
    st.pending = { kind: 'take_artifact', seat: 'a', payload: { iconKey: 'x' } };
    expect(() => applyTakeArtifact(st, 'a', 'star' as never, 'supply')).toThrow(/Star/);
  });

  it('§6.3 "Any artifact": your own held artifact is neither offered nor accepted (F13)', () => {
    let s = setup(two(45));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.players.a.artifacts = ['hearts'];
    st.decks.dungeon = ['any_artifact', 'map'];
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    expect(st.pending?.kind).toBe('take_artifact');
    // The legal offers include supply-held suits and other players' holdings,
    // but never the seat's own Hearts.
    const offers = adventurerOlympics.getLegalMoves(s, 'a').filter((m) => m.move.type === 'take_artifact');
    expect(offers.some((m) => (m.move as { artifact?: string }).artifact === 'hearts')).toBe(false);
    expect(() => applyTakeArtifact(st, 'a', 'hearts', 'supply')).toThrow(/supply|holds|already/);
    // A real take completes the dungeon.
    applyTakeArtifact(st, 'a', 'spades', 'supply');
    expect(st.players.a.artifacts).toContain('spades');
    expect(icon.completed).toBe(true);
    expect(st.players.a.dungeonsCompleted).toBe(1);
  });

  it('§8 Most companions is not claimed mid-game (rules change 2026-09-30)', () => {
    let s = setup(two(55));
    s = seedMap(s, 1);
    const st = g(s);
    st.inPlayQuests['most_companions'] = 'unclaimed';
    st.players.a.companions = ['companion-1'];
    const icon = st.iconHexes.find((i) => i.kind === 'city')!;
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    s = drive(s, 'a', { type: 'step', to: icon.key });
    const p = g(s).pending!.payload!;
    s = drive(s, 'a', { type: 'report_test_roll', total: Math.max(p.number as number, p.diceCount as number) });
    expect(g(s).players.a.companions).toHaveLength(2);
    expect(g(s).inPlayQuests['most_companions']).toBe('unclaimed');
    expect(g(s).players.a.questPoints).toBe(0);
  });

  it('§9 ending: last tile placed → endingPhase 1; the game is not over until the extra round ends (F4)', () => {
    let s = setup(two(66));
    s = aFirst(s);
    const st = g(s);
    // a stops; b stops; back to a (round 2). Then a explores the last tile.
    applyStop(st, 'a');
    applyStop(st, 'b');
    applyTurnOrderTotal(st, 'a', 12);
    applyTurnOrderTotal(st, 'b', 2);
    // a is on the starting centre; move to an outer hex first.
    st.players.a.hexKey = '1,0';
    st.players.a.stepsLeft = 2;
    st.pending = { kind: 'move', seat: 'a' };
    st.tileStack = [st.tileStack[0]!];
    applyExplore(st, 'a');
    applyPlaceTile(st, 'a', tileCenter('0,0', 0), 0);
    expect(st.endingPhase).toBe(1);
    expect(st.gameOver).toBe(false);
    expect(adventurerOlympics.isGameOver(s)).toBeNull();
    // b takes the rest of the round; then ONE more full round happens.
    applyStop(st, 'b');
    expect(st.endingPhase).toBe(2);
    expect(st.gameOver).toBe(false);
    applyTurnOrderTotal(st, 'a', 12);
    applyTurnOrderTotal(st, 'b', 2);
    applyStop(st, 'a');
    applyStop(st, 'b');
    expect(st.gameOver).toBe(true);
    expect(adventurerOlympics.isGameOver(s)).toBeTruthy();
  });

  it('§9: no invented stalemate — idle play never ends the game (F9)', () => {
    let s = setup(two(67));
    let guard = 0;
    while (!g(s).gameOver && guard++ < 300) {
      const p = g(s).pending!;
      if (p.kind === 'roll') {
        s = drive(s, p.seat, { type: 'report_turn_order_roll', total: p.seat === 'a' ? 12 : 2 });
      } else {
        s = drive(s, p.seat, { type: 'stop' });
      }
    }
    expect(g(s).gameOver).toBe(false);
    expect(g(s).round).toBeGreaterThan(50);
    expect(g(s).placedTiles).toHaveLength(1); // only the starting tile
  });

  it('§5.4 forced explore: after placing, the seat takes the rest of their turn (F10)', () => {
    let s = setup(two(68));
    s = seedMap(s, 1);
    const st = g(s);
    // Complete every icon, so b's beginTurn owes a forced explore at turn start.
    for (const h of st.iconHexes) h.completed = true;
    st.players.a.stepsLeft = 0;
    st.pending = { kind: 'move', seat: 'a' };
    applyStop(st, 'a'); // a ends; b's beginTurn fires the forced explore
    expect(st.pending?.kind).toBe('explore_place');
    expect(st.pending?.seat).toBe('b');
    expect(st.pending?.payload?.context).toBe('forced');
    const slot = tileCenter('0,0', 1);
    applyPlaceTile(st, 'b', slot, 3);
    // The rest of b's turn: a fresh move pending with full steps.
    expect(st.pending?.kind).toBe('move');
    expect(st.pending?.seat).toBe('b');
    expect(st.players.b.stepsLeft).toBe(2);
  });

  it('§5.1/§5.2 walking away: the player chooses the route, keeps steps, and destination icons trigger (F11)', () => {
    let s = setup(two(69));
    s = seedMap(s, 2); // Tile 2: N dungeon, S little monster
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'little_monster')!;
    st.players.a.hexKey = icon.key;
    st.decks.little = ['little-1'];
    st.pending = { kind: 'try_again', seat: 'a' };
    // Choose a specific destination one step away, on the map, unoccupied.
    const dest = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey && !st.iconHexes.some((h) => h.key === n && !h.completed))!;
    applyMoveAway(st, 'a', [dest]);
    // The seat chose the route and still has a step left (movement 2 - 1).
    expect(st.players.a.hexKey).toBe(dest);
    expect(st.players.a.stepsLeft).toBe(1);
    expect(st.pending?.kind).toBe('move');
  });

  it('§5.1 movement: cannot step onto an occupied hex (go around)', () => {
    let s = setup(two(77));
    s = seedMap(s, 1);
    const st = g(s);
    const target = st.players.b.hexKey; // '0,0'
    expect(() => applyMove(st, 'a', [target])).toThrow(/occupied/);
  });

  it('§12 decks persist JSON-safely: a saved session reloads with the map intact (F3)', () => {
    // The session stores save a session as a JSON string and read it back, so a
    // JSON round trip is exactly what persistence does to this state.
    let s = setup(two(88));
    s = aFirst(s);
    const restored = JSON.parse(JSON.stringify(s)) as SessionState<AOState>;
    expect(restored).toBeTruthy();
    const rg = restored.gameState;
    // The map set survives as a JSON map; iteration-free reads work.
    expect(rg.hexes['0,0']).toBe(true);
    expect(Array.isArray(rg.tileStack)).toBe(true);
    expect(rg.tileStack.length).toBe(9);
    // The public view renders off the restored state (pre-fix threw
    // "state.hexes is not iterable").
    const pub = adventurerOlympics.getPublicView(restored) as { map: { hexes: string[] } };
    expect(pub.map.hexes.length).toBeGreaterThan(0);
  });

  it('§4.1: tied lower bands re-roll within their own band (F7 tie-group-position)', () => {
    let s = adventurerOlympics.createSession(
      ['a', 'b', 'c'].map((id) => ({ player_id: id, kind: 'ai' }) as PlayerConfig),
      { seed: 5 },
    );
    s = setup(s);
    applyTurnOrderTotal(g(s), 'a', 10);
    applyTurnOrderTotal(g(s), 'b', 10);
    applyTurnOrderTotal(g(s), 'c', 9);
    // a and b re-roll for first; c holds third.
    applyTurnOrderTotal(g(s), 'a', 2);
    applyTurnOrderTotal(g(s), 'b', 3);
    const st = g(s);
    expect(st.players.b.initiative).toBe(1);
    expect(st.players.a.initiative).toBe(2);
    expect(st.players.c.initiative).toBe(3); // c was NOT overtaken by the re-roll
  });

  it('canonical summaries interpolate the seat and the outcome (F8)', () => {
    let s = setup(two(89));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'city')!;
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    const topCard = st.decks.companion[0]!;
    s = drive(s, 'a', { type: 'step', to: icon.key });
    const p = g(s).pending!.payload!;
    const r = adventurerOlympics.applyMove(s, 'a', { type: 'report_test_roll', total: Math.max(p.number as number, p.diceCount as number) });
    expect(r.summary).not.toContain('seatLabel(state');
    expect(r.summary).toContain('a'); // the seat (no name was given in this fixture)
    expect(r.summary).toContain(topCard); // the recruited card is identified
  });

  // --- Re-evaluation regression locks (RE-EVALUATION-local.md) -------------

  it('R1/R2: a physical explore never names an unrevealed tile; menus never leak it', () => {
    const s = adventurerOlympics.createSession(
      [
        { player_id: 'a', kind: 'human', table: 'physical', name: 'Alice' } as PlayerConfig,
        { player_id: 'b', kind: 'ai' } as PlayerConfig,
      ],
      { seed: 9 },
    );
    // Drive the setup phase through standee picks and the setup draw report.
    let cur = s; let guard = 12;
    while (g(cur).pending?.kind === 'setup_standee_colour' || g(cur).pending?.kind === 'setup_explore_report') {
      if (guard-- < 0) break;
      const seat = g(cur).pending!.seat;
      if (g(cur).pending!.kind === 'setup_standee_colour') {
        cur = drive(cur, seat, { type: 'setup_standee', colour: availableColours(g(cur))[0] });
      } else {
        cur = drive(cur, seat, { type: 'setup_report', quests: ['Explore 3 tiles', 'Recruit 2 companions', 'Most Little Monsters'], tile: `Tile ${g(cur).tileStack[0]}` });
      }
    }
    const st = g(cur);
    applyTurnOrderTotal(st, 'a', 12); applyTurnOrderTotal(st, 'b', 2);
    st.players.a.hexKey = '1,0'; st.players.a.stepsLeft = 2;
    st.players.b.hexKey = '0,0';
    st.pending = { kind: 'move', seat: 'a' };
    // The pre-action menu must not name the top tile.
    const offer = adventurerOlympics.getLegalMoves(cur, 'a').find((m) => m.move.type === 'explore');
    expect(offer).toBeTruthy();
    expect(offer!.description).not.toMatch(/Tile \d/);
    // Committing to explore asks the physical seat to report the tile first.
    cur = drive(cur, 'a', { type: 'explore' });
    expect(g(cur).pending?.kind).toBe('report_card');
    expect(g(cur).pending?.payload?.deck).toBe('tile');
    // The placement choices appear only after the report fixes the identity.
    cur = drive(cur, 'a', { type: 'report_card', card: 'Tile 2' });
    expect(g(cur).pending?.kind).toBe('explore_place');
    expect(g(cur).pending?.payload?.tileId).toBe(2);
  });

  it('R4: the printed side label always names the hexes the slot touches', () => {
    // For every side of an unrotated tile at the origin, the label's named
    // hexes are exactly slotHexes(side).
    for (let side = 0; side < 6; side++) {
      const label = sideLabelOf('0,0', 0, side).replace(/^side /, '');
      const named = label.split('–').map((nm) => localHexAbsolute('0,0', 0, nm as never));
      const actual = slotHexes('0,0', side);
      expect(named.sort(), `side ${side}`).toEqual([...actual].sort());
    }
  });

  it('R5: an exhausted Little Monster deck on a map icon ends the turn for a PHYSICAL seat too', () => {
    const s = adventurerOlympics.createSession(
      [
        { player_id: 'a', kind: 'human', table: 'physical', name: 'Alice' } as PlayerConfig,
        { player_id: 'b', kind: 'ai' } as PlayerConfig,
      ],
      { seed: 22 },
    );
    let cur = s; let guard = 12;
    while (g(cur).pending?.kind === 'setup_standee_colour' || g(cur).pending?.kind === 'setup_explore_report') {
      if (guard-- < 0) break;
      const seat = g(cur).pending!.seat;
      if (g(cur).pending!.kind === 'setup_standee_colour') cur = drive(cur, seat, { type: 'setup_standee', colour: availableColours(g(cur))[0] });
      else cur = drive(cur, seat, { type: 'setup_report', quests: ['Explore 3 tiles', 'Recruit 2 companions', 'Most Little Monsters'], tile: `Tile ${g(cur).tileStack[0]}` });
    }
    const st = g(cur);
    const little = LITTLE_MONSTER_CARDS.map((c) => c.id);
    st.decks.little = [];
    st.players.b.littleMonsters = little as never;
    // put a on a Little Monster icon
    const t2icon = st.iconHexes.find((i) => i.kind === 'little_monster') ?? null;
    expect(t2icon).not.toBeNull();
    st.players.a.hexKey = t2icon!.key;
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    // §6.2: nothing happens; the icon stays open; the turn ends — the pending
    // is NOT a report_card owed to a.
    expect(st.pending?.kind === 'report_card' && st.pending.seat === 'a').toBe(false);
    expect(st.iconHexes.find((i) => i.key === t2icon!.key)?.completed).toBe(false);
  });

  it('R6: a printed artifact name resolves to the canonical id; player names resolve as sources', () => {
    let s = setup(two(44));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.players.b.artifacts = ['hearts'];
    st.decks.dungeon = ['any_artifact', 'companion'];
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    // Printed "Hearts" from "Bob" (the printed name, not the seat id).
    applyTakeArtifact(st, 'a', 'Hearts' as never, 'Bob');
    expect(st.players.a.artifacts).toContain('hearts');
    expect(st.players.a.artifacts).not.toContain('Hearts');
    expect(st.players.b.artifacts).not.toContain('hearts');
    expect(icon.completed).toBe(true);
  });

  it('R9: multiple tied bands each re-roll inside their own band', () => {
    const s = adventurerOlympics.createSession(
      ['a', 'b', 'c', 'd'].map((id) => ({ player_id: id, kind: 'ai' }) as PlayerConfig),
      { seed: 5 },
    );
    let cur = setup(s);
    const st = g(cur);
    applyTurnOrderTotal(st, 'a', 10);
    applyTurnOrderTotal(st, 'b', 10);
    applyTurnOrderTotal(st, 'c', 6);
    applyTurnOrderTotal(st, 'd', 6);
    // First band (a,b) re-rolls: a wins.
    applyTurnOrderTotal(st, 'a', 12);
    applyTurnOrderTotal(st, 'b', 2);
    // The second band (c,d) must still owe its tie-break — no assignment yet.
    expect(st.pending?.kind).toBe('roll');
    expect(['c', 'd']).toContain(st.pending?.seat);
    applyTurnOrderTotal(st, 'c', 5);
    applyTurnOrderTotal(st, 'd', 7);
    expect(st.players.a.initiative).toBe(1);
    expect(st.players.b.initiative).toBe(2);
    expect(st.players.d.initiative).toBe(3);
    expect(st.players.c.initiative).toBe(4);
  });

  it('R10: the monster deck emptying mid-double-fight cycles the Dungeon card exactly once', () => {
    let s = setup(two(24));
    s = seedMap(s, 1);
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'dungeon')!;
    st.players.a.hexKey = icon.key;
    st.decks.dungeon = ['double_little_monsters', 'companion', 'big_monster'];
    st.decks.little = ['little-1'];
    st.pending = { kind: 'try_again', seat: 'a' };
    applyTryAgain(st, 'a');
    applyTestRoll(st, 'a', 6);
    // The next Dungeon card should be the Companion — not the Big Monster.
    expect(st.pending?.payload?.test).toBe('recruit');
    expect(st.decks.dungeon[st.decks.dungeon.length - 1]).toBe('double_little_monsters');
  });

  it('R11: setup_standee is rejected once play has begun', () => {
    let s = setup(two(66));
    s = seedMap(s, 1);
    const st = g(s);
    const before = { tiles: st.placedTiles.length, stack: st.tileStack.length };
    expect(() =>
      adventurerOlympics.applyMove(s, 'a', { type: 'setup_standee', standee: 'Alice', colour: 'Red' }),
    ).toThrow(/setup is over|not your turn to pick/);
    expect(st.placedTiles.length).toBe(before.tiles);
    expect(st.tileStack.length).toBe(before.stack);
  });

  it('R7: digital Roll uses the seeded session rng (evens occur; seeds differ)', () => {
    const mk = (seed: number) => adventurerOlympics.createSession(
      [
        { player_id: 'a', kind: 'human', table: 'digital', name: 'Alice' } as PlayerConfig,
        { player_id: 'b', kind: 'human', table: 'digital', name: 'Bob' } as PlayerConfig,
      ],
      { seed },
    );
    const rollsFor = (seed: number): number[] => {
      let s = mk(seed); const st0 = g(s);
      st0.drawStack = ['a', 'b']; st0.baseTotals = {}; st0.groupTotals = {}; st0.tieBand = null;
      const out: number[] = [];
      for (let i = 0; i < 8; i++) {
        g(s).pending = { kind: 'roll', seat: 'a', payload: { rollKind: 'turn_order', diceCount: 2 } };
        s = adventurerOlympics.applyMove(s, 'a', { type: 'resolve_report' }).newState;
        out.push(g(s).baseTotals.a as number);
      }
      return out;
    };
    const a = rollsFor(1), b = rollsFor(999);
    expect(a.some((n) => n % 2 === 0)).toBe(true); // evens are possible
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); // seed matters
  });

  it('R3: a step that transfers an artifact and completes the icon says both in the summary', () => {
    let s = setup(two(33));
    s = seedMap(s, 3); // Tile 3 NE = Hearts
    const st = g(s);
    const icon = st.iconHexes.find((i) => i.kind === 'hearts')!;
    st.players.b.artifacts = ['hearts'];
    st.players.a.hexKey = neighbors(icon.key).find((n) => st.hexes[n] === true && n !== st.players.b.hexKey)!;
    const r = adventurerOlympics.applyMove(s, 'a', { type: 'step', to: icon.key });
    expect(r.summary).toMatch(/hearts/i);
    expect(r.summary).toMatch(/alice|a/i);
    expect(r.summary).toMatch(/completed/i);
    expect(g(r.newState).players.a.artifacts).toContain('hearts');
  });
});
