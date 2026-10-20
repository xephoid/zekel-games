// Locks for the five defects in output/adventurer-olympics/REVIEW-r4.md.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import type { AOState } from '../types.js';
import { applyTurnOrderTotal, resolveIcon, tileHexes } from '../engine.js';
import { iconHexesForTile } from '../hexMap.js';
import { TILES, DUNGEON_KIND_NAMES } from '../data.js';

type Mode = 'ai' | 'mixed' | 'physical';

/** Seat a is AI in 'ai'/'mixed'; every other seat is a physical human except in 'ai'. */
function session(mode: Mode, seed = 123): SessionState<AOState> {
  const players = ['Alice', 'Bob'].map((name, i) => {
    const ai = mode === 'ai' || (mode === 'mixed' && i === 0);
    return { player_id: String.fromCharCode(97 + i), name, kind: ai ? 'ai' : 'human', ...(ai ? {} : { table: 'physical' }) };
  }) as PlayerConfig[];
  let s = game.createSession(players, { seed });
  while (s.gameState.pending?.kind === 'setup_standee_colour') {
    const seat = s.gameState.pending.seat;
    s = game.applyMove(s, seat, game.getLegalMoves(s, seat)[0]!.move).newState;
  }
  if (s.gameState.pending?.kind === 'setup_explore_report') {
    s = game.applyMove(s, s.gameState.pending.seat, { type: 'setup_report', quests: ['Explore 3 tiles', 'Complete 2 dungeons', 'Recruit 2 companions'], tile: 'Tile 1' }).newState;
  }
  return s;
}

/** Tile 1 alone on the map, both standees on its centre, Alice to move. */
function ready(mode: Mode): SessionState<AOState> {
  const s = session(mode);
  const g = s.gameState;
  applyTurnOrderTotal(g, 'a', 12);
  applyTurnOrderTotal(g, 'b', 2);
  const t = { tileId: 1, center: { q: 0, r: 0, key: '0,0' }, rotation: 0, isStarting: true, exploredBy: null };
  g.placedTiles = [t];
  g.iconHexes = iconHexesForTile(t, TILES[0]!);
  g.hexes = Object.fromEntries(tileHexes('0,0').map((k) => [k, true]));
  g.tileStack = TILES.filter((x) => x.id !== 1).map((x) => x.id);
  g.players.a.hexKey = '0,0';
  g.players.b.hexKey = '0,0';
  g.pending = { kind: 'move', seat: 'a' };
  g.activeSeat = 'a';
  s.activePlayerId = 'a';
  return s;
}

describe('REVIEW-r4 locks', () => {
  it('#1 at a table with real cards, an AI explore waits for a human to report the tile', () => {
    let s = ready('mixed');
    s = game.applyMove(s, 'a', { type: 'step', to: '0,1' }).newState;
    s = game.applyMove(s, 'a', { type: 'explore' }).newState;
    const p = s.gameState.pending!;
    expect(p).toMatchObject({ kind: 'report_card', seat: 'b', payload: { deck: 'tile', forSeat: 'a' } });
    expect(game.describeNextStep!(s)?.active_player_id).toBe('b');
    // Bob reports; the placement choice goes back to the AI.
    s = game.applyMove(s, 'b', { type: 'report_card', card: 'Tile 5' }).newState;
    expect(s.gameState.pending).toMatchObject({ kind: 'explore_place', seat: 'a', payload: { tileId: 5 } });
  });

  it('#1 at a table with real cards, an AI City draw waits for a human report, then the AI rolls', () => {
    let s = ready('mixed');
    const city = s.gameState.iconHexes.find((h) => h.kind === 'city')!;
    s = game.applyMove(s, 'a', { type: 'step', to: city.key }).newState;
    expect(s.gameState.pending).toMatchObject({ kind: 'report_card', seat: 'b', payload: { deck: 'companion', forSeat: 'a' } });
    expect(game.getLegalMoves(s, 'b')[0]!.description).toContain('drawn for Alice');
    s = game.applyMove(s, 'b', { type: 'report_card', card: 'number 4, +3 Strength' }).newState;
    expect(s.gameState.pending).toMatchObject({ kind: 'roll', seat: 'a', payload: { cardId: 'companion-13' } });
  });

  it('#1 a full game with an AI and a physical human finishes, every real draw reported by the human', async () => {
    let s = session('mixed', 7);
    let moves = 0;
    let aiReports = 0;
    while (!game.isGameOver(s) && moves < 3000) {
      const p = s.gameState.pending!;
      expect(s.gameState.players[p.seat]!.kind === 'ai' && p.kind === 'report_card').toBe(false);
      if (p.kind === 'report_card' && p.payload?.forSeat === 'a') aiReports++;
      const move = s.gameState.players[p.seat]!.kind === 'ai'
        ? (await game.getAIMove!(s, p.seat, 'medium')).move
        : (game.autoResolveReport!(s, p.seat) ?? { move: game.getLegalMoves(s, p.seat)[0]!.move }).move;
      s = game.applyMove(s, p.seat, move).newState;
      moves++;
    }
    expect(game.isGameOver(s)).not.toBeNull();
    expect(aiReports).toBeGreaterThan(0);
  });

  it('#2 a failed Dungeon recruit names the Companion and where both cards go', () => {
    const s = ready('ai');
    const g = s.gameState;
    const icon = g.iconHexes.find((h) => h.kind === 'dungeon')!;
    g.decks.dungeon = ['companion', ...g.decks.dungeon.filter((k, i) => !(k === 'companion' && i === g.decks.dungeon.indexOf('companion')))];
    g.decks.companion = ['companion-5', ...g.decks.companion.filter((c) => c !== 'companion-5')];
    const entry = game.applyMove(s, 'a', { type: 'step', to: icon.key });
    expect(entry.summary).toContain('companion-5 (number 6, +3 Charisma, +3 Movement)');
    const fail = game.applyMove(entry.newState, 'a', { type: 'report_test_roll', total: 1 });
    expect(fail.summary).toContain('goes to the bottom of the Companion deck');
    expect(fail.summary).toContain('The Companion Dungeon card goes to the bottom of the Dungeon deck');
    expect(fail.newState.gameState.decks.companion.at(-1)).toBe('companion-5');
    expect(fail.newState.gameState.decks.dungeon.at(-1)).toBe('companion');
  });

  it('#3 the session starts with the human who owes the first setup pick as the active player', () => {
    const s = game.createSession(
      [{ player_id: 'a', kind: 'ai', name: 'Alice' } as PlayerConfig, { player_id: 'b', kind: 'human', name: 'Bob', table: 'physical' } as PlayerConfig],
      { seed: 1 },
    );
    expect(s.activePlayerId).toBe('b');
    expect(s.gameState.activeSeat).toBe('b');
  });

  it('#4 the auto-report helper answers every Dungeon card with a report the engine accepts', () => {
    for (const kind of Object.keys(DUNGEON_KIND_NAMES)) {
      const s = ready('physical');
      const g = s.gameState;
      g.decks.dungeon = [kind as never, ...g.decks.dungeon.filter((k) => k !== kind)];
      resolveIcon(g, 'a', g.iconHexes.find((h) => h.kind === 'dungeon')!);
      const offer = game.autoResolveReport!(s, 'a');
      expect(() => game.applyMove(s, 'a', offer!.move)).not.toThrow();
    }
  });

  it('#5 standing on a failed icon offers stop, and stop ends the turn', () => {
    let s = ready('physical');
    const g = s.gameState;
    g.players.a.hexKey = g.iconHexes.find((h) => h.kind === 'city')!.key;
    g.pending = { kind: 'try_again', seat: 'a' };
    expect(game.getLegalMoves(s, 'a').some((m) => m.move.type === 'stop')).toBe(true);
    expect(game.describeNextStep!(s)?.instruction).toMatch(/stop/);
    s = game.applyMove(s, 'a', { type: 'stop' }).newState;
    expect(s.gameState.pending?.seat).toBe('b');
  });
});
