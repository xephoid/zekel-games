// Locks for the six defects in output/adventurer-olympics/REVIEW-r3.md.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';
import { applyTurnOrderTotal, resolveIcon, tileHexes } from '../engine.js';
import { iconHexesForTile } from '../hexMap.js';
import { TILES } from '../data.js';

const COLOURS = ['Red', 'Blue', 'Yellow', 'Purple'];
const NAMES = ['Alice', 'Bob', 'Chris', 'Dana'];

function session(n: number, physical: boolean): SessionState<AOState> {
  let s = game.createSession(
    Array.from({ length: n }, (_, i) => ({
      player_id: String.fromCharCode(97 + i), name: NAMES[i], kind: physical ? 'human' : 'ai',
      ...(physical ? { table: 'physical' } : {}),
    })) as PlayerConfig[],
    { seed: 123 },
  );
  for (const [i, p] of s.players.entries()) {
    s = game.applyMove(s, p.player_id, { type: 'setup_standee', standee: p.name, colour: COLOURS[i] }).newState;
  }
  return s;
}

/** Two physical humans, setup reported, Alice first, Alice standing next to
 *  the given tile's icons. */
function physicalOnTile(tileId: number): SessionState<AOState> {
  let s = session(2, true);
  s = game.applyMove(s, 'a', { type: 'setup_report', quests: ['Explore 3 tiles', 'Complete 2 dungeons', 'Recruit 2 companions'], tile: 'Tile 1' }).newState;
  const g = s.gameState;
  applyTurnOrderTotal(g, 'a', 12);
  applyTurnOrderTotal(g, 'b', 2);
  const t = { tileId, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  g.placedTiles = [t];
  g.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === tileId)!);
  g.hexes = Object.fromEntries(tileHexes('0,0').map((k) => [k, true]));
  g.players.a.hexKey = '1,0';
  g.players.b.hexKey = '0,0';
  g.pending = { kind: 'move', seat: 'a' };
  g.activeSeat = 'a';
  return s;
}

describe('REVIEW-r3 locks', () => {
  it('#4 a settled tie-break winner keeps first place through a later re-roll', () => {
    const g = session(3, false).gameState;
    for (const [pid, n] of [['a', 8], ['b', 8], ['c', 8], ['a', 10], ['b', 5], ['c', 5], ['b', 12], ['c', 2]] as const) {
      applyTurnOrderTotal(g, pid, n);
    }
    const order = [...g.playerOrder].sort((x, y) => g.turnOrder[x]! - g.turnOrder[y]!);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('#4 settling one tied pair leaves the other tied pair to roll', () => {
    const g = session(4, false).gameState;
    for (const [pid, n] of [['a', 8], ['b', 8], ['c', 8], ['d', 8], ['a', 10], ['b', 10], ['c', 5], ['d', 5], ['a', 12], ['b', 2]] as const) {
      applyTurnOrderTotal(g, pid, n);
    }
    expect(g.pending?.kind).toBe('roll');
    expect(g.pending?.payload?.band).toEqual(['c', 'd']);
    applyTurnOrderTotal(g, 'c', 3);
    applyTurnOrderTotal(g, 'd', 9);
    const order = [...g.playerOrder].sort((x, y) => g.turnOrder[x]! - g.turnOrder[y]!);
    expect(order).toEqual(['a', 'b', 'd', 'c']);
  });

  for (const [tile, kind] of [[1, 'city'], [2, 'little_monster'], [3, 'big_monster']] as const) {
    it(`#2 every offered ${kind} card report is accepted in the state that offered it`, () => {
      const s = physicalOnTile(tile);
      resolveIcon(s.gameState, 'a', s.gameState.iconHexes.find((h) => h.kind === kind)!);
      const offered = game.getLegalMoves(s, 'a');
      expect(offered.length).toBeGreaterThan(0);
      for (const o of offered) {
        expect(() => game.applyMove(structuredClone(s), 'a', o.move)).not.toThrow();
      }
    });
  }

  it('#2 a Companion named by number + bonus resolves to one of its identical copies', () => {
    let s = physicalOnTile(1);
    resolveIcon(s.gameState, 'a', s.gameState.iconHexes.find((h) => h.kind === 'city')!);
    s = game.applyMove(s, 'a', { type: 'report_card', card: 'number 2, +1 Strength' }).newState;
    expect(['companion-1', 'companion-2']).toContain(s.gameState.pending?.payload?.cardId);
  });

  it('#2 a number shared by different Companions asks for the bonus and lists the choices', () => {
    const s = physicalOnTile(1);
    resolveIcon(s.gameState, 'a', s.gameState.iconHexes.find((h) => h.kind === 'city')!);
    expect(() => game.applyMove(s, 'a', { type: 'report_card', card: '2' })).toThrow(/number 2, \+1 Charisma/);
  });

  it('#3 a successful recruit says where the token goes and the exact stat change', () => {
    const s = session(2, false);
    const g = s.gameState;
    applyTurnOrderTotal(g, 'a', 12);
    applyTurnOrderTotal(g, 'b', 2);
    const t = { tileId: 1, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
    g.placedTiles = [t];
    g.iconHexes = iconHexesForTile(t, TILES.find((x) => x.id === 1)!);
    g.decks.companion = ['companion-13', 'companion-1'];
    const icon = g.iconHexes.find((h) => h.kind === 'city')!;
    resolveIcon(g, 'a', icon);
    const r = game.applyMove(s, 'a', { type: 'report_test_roll', total: 4 });
    expect(r.summary).toContain('+3 Strength');
    expect(r.summary).toContain('Strength 1 → 4');
    expect(r.summary).toContain(`places a Red token on the City (the ${icon.localHex} hex of Tile 1)`);
  });

  it('#5 a rejected setup report changes nothing', () => {
    let s = session(2, true);
    expect(() => game.applyMove(s, 'a', { type: 'setup_report', quests: ['Explore 3 tiles', 'Complete 2 dungeons', 'Recruit 2 companions'], tile: 'Tile 999' })).toThrow();
    expect(s.gameState.inPlayQuests).toEqual({});
    expect(() => game.applyMove(s, 'a', { type: 'setup_report', quests: ['Explore 3 tiles', 'Nonsense', 'Most artifacts'], tile: 'Tile 1' })).toThrow();
    expect(s.gameState.inPlayQuests).toEqual({});
    s = game.applyMove(s, 'a', { type: 'setup_report', quests: ['Most Little Monsters', 'Most Big Monsters', 'Most artifacts'], tile: 'Tile 1' }).newState;
    expect(Object.keys(s.gameState.inPlayQuests)).toHaveLength(3);
  });

  it('#6 humans pick first, AI takes a free colour, and nobody shares a colour or standee', () => {
    let s = game.createSession(
      [{ player_id: 'a', kind: 'ai', name: 'Alice' } as PlayerConfig, { player_id: 'b', kind: 'human', name: 'Bob', table: 'physical' } as PlayerConfig, { player_id: 'c', kind: 'human', name: 'Chris', table: 'physical' } as PlayerConfig],
      { seed: 5 },
    );
    expect(s.gameState.pending).toEqual({ kind: 'setup_standee_colour', seat: 'b' });
    expect(game.getLegalMoves(s, 'a')).toEqual([]);
    expect(() => game.applyMove(s, 'b', { type: 'setup_standee', standee: 'Wizard', colour: 'Green' })).toThrow(/Red, Blue, Yellow, Purple/);
    s = game.applyMove(s, 'b', { type: 'setup_standee', standee: 'Wizard', colour: 'red' }).newState;
    expect(s.gameState.pending?.seat).toBe('c');
    expect(() => game.applyMove(s, 'c', { type: 'setup_standee', standee: 'Knight', colour: 'Red' })).toThrow(/already taken/);
    expect(() => game.applyMove(s, 'c', { type: 'setup_standee', standee: 'wizard', colour: 'Blue' })).toThrow(/already has the standee/);
    s = game.applyMove(s, 'c', { type: 'setup_standee', standee: 'Knight', colour: 'Blue' }).newState;
    expect(s.gameState.pending?.seat).toBe('a');
    expect(game.getLegalMoves(s, 'a').map((m) => m.move.colour)).toEqual(['Yellow', 'Purple']);
  });

  // #1 (a version-1 session database opens; only an old-format session of this
  // game is refused) tests the server's SQLite store, so it stays with the server.
});
