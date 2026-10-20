// Hexes, slots and rotations in table words (post-port 2026-09-29): a player at
// a physical table cannot find an axial key like "-1,0", so every hex is named
// by its tile and printed hex name, and every rotation by which way the tile's
// printed N hex points relative to the (unturned) starting tile.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { adventurerOlympics as game } from '../index.js';
import { applyTurnOrderTotal } from '../engine.js';
import {
  hexLabelOf, localHexAbsolute, resolveHexRef, resolveRotation, resolveSlotRef,
  rotationLabel, sideLabelOf, tileCenter,
} from '../hexMap.js';
import type { HexName } from '../data.js';

const NAMES: Array<Exclude<HexName, 'C'>> = ['N', 'NE', 'SE', 'S', 'SW', 'NW'];

describe('table words for hexes, slots and rotations', () => {
  it('every hex of a tile, at every rotation, round-trips through its label', () => {
    for (let rot = 0; rot < 6; rot++) {
      const placed = [{ tileId: 4, center: { key: '3,-1' }, rotation: rot }];
      for (const ln of NAMES) {
        const key = localHexAbsolute('3,-1', rot, ln);
        expect(hexLabelOf(placed, key)).toBe(`the ${ln} hex of Tile 4`);
        expect(resolveHexRef(placed, `the ${ln} hex of Tile 4`)).toBe(key);
        expect(resolveHexRef(placed, `tile 4 ${ln.toLowerCase()}`)).toBe(key);
      }
      expect(resolveHexRef(placed, 'centre of Tile 4')).toBe('3,-1');
    }
  });

  it('every rotation round-trips through the hex its N points toward', () => {
    for (let rot = 0; rot < 6; rot++) {
      const toward = rotationLabel(rot).match(/starting tile's (\w+) hex/)![1]!;
      expect(resolveRotation(toward)).toBe(rot);
      // The named starting-tile hex lies in the same direction as the new N hex.
      const newN = localHexAbsolute('0,0', rot, 'N');
      expect(localHexAbsolute('0,0', 0, toward as Exclude<HexName, 'C'>)).toBe(newN);
    }
    expect(resolveRotation(3)).toBe(3);
    expect(resolveRotation('7')).toBeNull();
  });

  it('every side of a turned tile resolves from its printed label, in either order', () => {
    for (let rot = 0; rot < 6; rot++) {
      const placed = [{ tileId: 2, center: { key: '0,0' }, rotation: rot }];
      for (let s = 0; s < 6; s++) {
        const [a, b] = sideLabelOf('0,0', rot, s).replace('side ', '').split('–');
        expect(resolveSlotRef(placed, `side ${a}–${b} of Tile 2`)).toBe(tileCenter('0,0', s));
        expect(resolveSlotRef(placed, `Tile 2 ${b} to ${a}`)).toBe(tileCenter('0,0', s));
      }
    }
  });

  it('a human steps by naming the hex, and the summary names it the same way', () => {
    let s = game.createSession(
      [{ player_id: 'a', kind: 'human', name: 'Alice', table: 'digital' } as PlayerConfig, { player_id: 'b', kind: 'ai', name: 'Bob' } as PlayerConfig],
      { seed: 3 },
    );
    while (s.gameState.pending?.kind === 'setup_standee_colour') {
      const seat = s.gameState.pending.seat;
      s = game.applyMove(s, seat, game.getLegalMoves(s, seat)[0]!.move).newState;
    }
    applyTurnOrderTotal(s.gameState, 'a', 12);
    applyTurnOrderTotal(s.gameState, 'b', 2);
    const start = s.gameState.placedTiles[0]!;
    const blank = NAMES.find((ln) => !s.gameState.iconHexes.some((h) => h.key === localHexAbsolute(start.center.key, 0, ln)))!;
    const r = game.applyMove(s, 'a', { type: 'step', to: `the ${blank} hex of Tile ${start.tileId}` });
    expect(r.summary).toBe(`Alice moves their standee to the ${blank} hex of Tile ${start.tileId}.`);
    expect(r.summary).not.toMatch(/-?\d+,-?\d+/);
  });
});
