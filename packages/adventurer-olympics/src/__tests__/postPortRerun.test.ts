// Locks for the defects found by the 2026-09-29 post-port rerun (POST-PORT.md).
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';
import { applyTurnOrderTotal, resolveIcon, tileHexes, topCandidates } from '../engine.js';
import { iconHexesForTile } from '../hexMap.js';
import { TILES } from '../data.js';

function physical(): SessionState<AOState> {
  let s = game.createSession(
    [{ player_id: 'a', kind: 'human', name: 'Alice', table: 'physical' } as PlayerConfig, { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig],
    { seed: 4 },
  );
  while (s.gameState.pending?.kind === 'setup_standee_colour') {
    const seat = s.gameState.pending.seat;
    s = game.applyMove(s, seat, game.getLegalMoves(s, seat)[0]!.move).newState;
  }
  return s;
}

function onTile(s: SessionState<AOState>, tileId: number): SessionState<AOState> {
  if (s.gameState.pending?.kind === 'setup_explore_report') {
    s = game.applyMove(s, 'a', { type: 'setup_report', quests: ['Explore 3 tiles', 'Complete 2 dungeons', 'Recruit 2 companions'], tile: 'Tile 1' }).newState;
  }
  const g = s.gameState;
  applyTurnOrderTotal(g, 'a', 12);
  applyTurnOrderTotal(g, 'b', 2);
  const t = { tileId, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  g.placedTiles = [t];
  g.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === tileId)!);
  g.hexes = Object.fromEntries(tileHexes('0,0').map((k) => [k, true]));
  g.players.a.hexKey = '0,0';
  g.players.b.hexKey = '0,0';
  return s;
}

describe('setup report in pieces (the menu offered an unusable empty report)', () => {
  it('every offered setup piece is accepted, and the pieces finish setup', () => {
    let s = physical();
    expect(s.gameState.pending?.kind).toBe('setup_explore_report');
    let guard = 0;
    while (s.gameState.pending?.kind === 'setup_explore_report' && guard++ < 10) {
      const offers = game.getLegalMoves(s, 'a');
      for (const o of offers) expect(() => game.applyMove(structuredClone(s), 'a', o.move)).not.toThrow();
      s = game.applyMove(s, 'a', offers[0]!.move).newState;
    }
    expect(Object.keys(s.gameState.inPlayQuests)).toHaveLength(3);
    expect(s.gameState.placedTiles).toHaveLength(1);
  });

  it('a quest already reported is refused and nothing changes', () => {
    let s = physical();
    s = game.applyMove(s, 'a', { type: 'setup_report', quests: ['Most artifacts'] }).newState;
    const before = JSON.stringify(s.gameState.pending);
    expect(() => game.applyMove(s, 'a', { type: 'setup_report', quests: ['most artifacts'] })).toThrow(/already reported/);
    expect(JSON.stringify(s.gameState.pending)).toBe(before);
  });
});

describe('real cards: only a card that can be on top is accepted', () => {
  it('a failed Companion goes under the deck and cannot be reported as the next draw', () => {
    let s = onTile(physical(), 1);
    const city = s.gameState.iconHexes.find((h) => h.kind === 'city')!;
    resolveIcon(s.gameState, 'a', city);
    s = game.applyMove(s, 'a', { type: 'report_card', card: 'number 6, +4 Strength' }).newState;
    s = game.applyMove(s, 'a', { type: 'report_test_roll', total: 1 }).newState;
    expect(s.gameState.knownBottom?.companion).toEqual(['companion-15']);
    // Next attempt at the City: the +4 Strength card is at the bottom, not on top.
    s.gameState.pending = null;
    resolveIcon(s.gameState, 'a', s.gameState.iconHexes.find((h) => h.key === city.key)!);
    expect(() => game.applyMove(s, 'a', { type: 'report_card', card: 'number 6, +4 Strength' })).toThrow(/can only be/);
    expect(game.getLegalMoves(s, 'a').map((m) => m.move.card)).not.toContain('number 6, +4 Strength');
  });

  it('once every unseen card has been drawn, the next card must be the first one put under', () => {
    const g = onTile(physical(), 2).gameState;
    // Pretend every Little Monster but two has been won, and one of those two went under.
    const keep = ['little-1', 'little-6'];
    g.players.b.littleMonsters = g.decks.little.filter((c) => !keep.includes(c));
    g.decks.little = [...keep];
    g.knownBottom = { companion: [], little: ['little-6'], big: [], dungeon: [] };
    expect(topCandidates(g, 'little')).toEqual(['little-1']);
    g.knownBottom.little = ['little-6', 'little-1'];
    expect(topCandidates(g, 'little')).toEqual(['little-6']);
  });

  it('a Dungeon Map card that gave nothing cannot come straight back up (the endless-Map loop)', () => {
    let s = onTile(physical(), 1);
    const g = s.gameState;
    g.tileStack = []; // Map gives nothing when the stack is empty
    resolveIcon(g, 'a', g.iconHexes.find((h) => h.kind === 'dungeon')!);
    for (let i = 0; i < 3; i++) s = game.applyMove(s, 'a', { type: 'report_card', card: 'Map' }).newState;
    expect(() => game.applyMove(s, 'a', { type: 'report_card', card: 'Map' })).toThrow(/cannot be on top/);
    expect(game.getLegalMoves(s, 'a').map((m) => m.move.card)).not.toContain('Map');
  });
});

describe('view completeness (post-port §1a)', () => {
  it('the view names each standee\'s hex in table words, each tile\'s turn, and the artifact supply', () => {
    const s = onTile(physical(), 3);
    s.gameState.players.b.artifacts = ['hearts'];
    const view = game.getPublicView(s) as {
      players: Array<{ hexLabel: string }>;
      map: { tiles: Array<{ turned: string }>; icons: Array<{ hexLabel: string }> };
      artifactSupply: string[];
    };
    expect(view.players[0]!.hexLabel).toBe('the centre of Tile 3');
    expect(view.map.tiles[0]!.turned).toMatch(/same way as the starting tile/);
    expect(view.map.icons.every((i) => /hex of Tile 3$/.test(i.hexLabel))).toBe(true);
    expect(view.artifactSupply).toEqual(['spades', 'diamonds', 'clubs', 'star']);
  });

  it('the view carries the turn-order rolls mid roll-off and the cards known to be under each deck', () => {
    let s = physical();
    s = game.applyMove(s, 'a', { type: 'setup_report', quests: ['Explore 3 tiles', 'Complete 2 dungeons', 'Recruit 2 companions'], tile: 'Tile 1' }).newState;
    applyTurnOrderTotal(s.gameState, 'a', 7);
    applyTurnOrderTotal(s.gameState, 'b', 7);
    applyTurnOrderTotal(s.gameState, 'a', 9);
    const view = game.getPublicView(s) as { turnOrderRolls: Record<string, unknown>; tableUsesRealCards: boolean; cardsUnderDecks: Record<string, unknown> };
    expect(view.turnOrderRolls).toEqual({ totals: { a: 7, b: 7 }, tiedGroup: ['a', 'b'], reRolls: { a: 9 }, stillToRoll: ['b'] });
    expect(view.tableUsesRealCards).toBe(true);
    expect(view.cardsUnderDecks).toEqual({ companion: [], little: [], big: [], dungeon: [] });
  });
});
