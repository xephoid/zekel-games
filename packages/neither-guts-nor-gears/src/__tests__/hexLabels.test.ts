// Hex-label naming (design doc "Hex naming for Neither Guts nor Gears",
// 2026-09-21) — the engine's identity stays the (c, r) pair; labels are purely
// derived. Plus the face-down Action Stack rule restored in the same update.

import { describe, it, expect } from 'vitest';
import neitherGutsNorGears from '../index.js';
import type { NGGMove, NGGState } from '../types.js';
import { tileLabel, tileCoord, TILE_PROPER_NAMES } from '../data/maps.js';
import { resolveCoord } from '../resolvers.js';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';

import { keepCores } from './pendingFixtures.js';
const ALL_LAYOUTS = [
  { id: 'two' as const, tiles: (neitherGutsNorGears as { getReferenceData(): { maps: Record<string, Array<{ c: number; r: number; label: string }>> } }).getReferenceData().maps['2p']! },
  { id: 'threeFour' as const, tiles: (neitherGutsNorGears as { getReferenceData(): { maps: Record<string, Array<{ c: number; r: number; label: string }>> } }).getReferenceData().maps['3-4p']! },
  { id: 'fiveSix' as const, tiles: (neitherGutsNorGears as { getReferenceData(): { maps: Record<string, Array<{ c: number; r: number; label: string }>> } }).getReferenceData().maps['5-6p']! },
];

describe('hex labels (display change only)', () => {
  it('round-trips every tile of every layout', () => {
    for (const layout of ALL_LAYOUTS) {
      for (const t of layout.tiles) {
        const label = tileLabel(t.c, t.r);
        const back = tileCoord(label);
        expect([back.c, back.r]).toEqual([t.c, t.r]);
      }
    }
  });

  it('labels are unique within each layout', () => {
    for (const layout of ALL_LAYOUTS) {
      const labels = layout.tiles.map((t) => tileLabel(t.c, t.r));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('shared tiles keep one label across layouts (the E4 anchor)', () => {
    // E4 appears on all three; D4/F4 on the two larger ones; C3 on all three.
    for (const [letterNum, pair] of [['E4', '0,6'], ['D4', '-1,7'], ['F4', '1,7'], ['C3', '-2,4'], ['G6', '2,10']] as const) {
      const { c, r } = tileCoord(letterNum);
      expect(`${c},${r}`).toBe(pair);
      expect(tileLabel(c, r)).toBe(letterNum);
    }
  });

  it('the parity invariant holds and every label parses to a parity-legal pair', () => {
    for (const layout of ALL_LAYOUTS) {
      for (const t of layout.tiles) {
        expect((t.c + t.r) % 2).toBe(0);
        const back = tileCoord(tileLabel(t.c, t.r));
        expect((back.c + back.r) % 2).toBe(0);
      }
    }
  });

  it('the four named tiles carry their printed place names', () => {
    expect(TILE_PROPER_NAMES['E4']).toBe('North Oil');
    expect(TILE_PROPER_NAMES['E5']).toBe('South Oil');
    expect(TILE_PROPER_NAMES['D4']).toBe('West Cauldron');
    expect(TILE_PROPER_NAMES['F4']).toBe('East Cauldron');
  });

  it('label spelling is accepted by resolveCoord (case-insensitive, spaces tolerated)', () => {
    const tiles = ALL_LAYOUTS.map((l) => l.tiles as unknown as Array<{ c: number; r: number; resource: string }>);
    const map = tiles[0]!;
    for (const spell of ['E4', 'e4', 'E 4']) {
      expect(resolveCoord(map as never, spell)).toBe('0,6');
    }
    // Legacy pair forms still work.
    expect(resolveCoord(map as never, '0,6')).toBe('0,6');
    expect(resolveCoord(map as never, '(0, 6)')).toBe('0,6');
    expect(resolveCoord(map as never, { c: 0, r: 6 })).toBe('0,6');
    // Off-map labels reject.
    expect(() => resolveCoord(map as never, 'A1' as never)).toThrowError(/not on this map|not a tile label/i);
  });

  it('starting locations stay the printed sites after labeling (2p corners)', () => {
    const map = ALL_LAYOUTS.find((l) => l.id === 'two')!;
    const starts = map.tiles.filter((t) => (t as { start?: number }).start != null).map((t) => tileLabel(t.c, t.r));
    expect(starts.sort()).toEqual(['C6', 'G3']);
  });
});

// ---------------------------------------------------------------------------

function base2p(): SessionState<NGGState> {
  const players: PlayerConfig[] = [
    { player_id: 'wiz', kind: 'human' }, { player_id: 'rob', kind: 'human' },
  ];
  let s = neitherGutsNorGears.createSession(players, { seed: 3, setupFirstPlayerId: 'wiz' });
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'assign_setup_choices', selections: { wiz: 'covenant', rob: 'ledger' } }).newState;
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'choose_leader', hero: 'Warden Hesper Quill' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'rob', { type: 'choose_leader', hero: 'Kestrel Nine' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'rob', { type: 'choose_starting_location', location: '@2' }).newState;
  s = neitherGutsNorGears.applyMove(s, 'wiz', { type: 'choose_starting_location', location: '@1' }).newState;
  s = keepCores(s);
  return s;
}

describe('face-down action stack (restored §5 rule)', () => {
  it('the public view never names another seat\'s placed action kind; owner sees their own', () => {
    let s = base2p();
    // The first PLANNING seat is round-1's first player (upkeep rotated it to rob).
    const first = s.gameState.planningOrder[0]!;
    s = neitherGutsNorGears.applyMove(s, first, { type: 'plan_action', card: 'move_battle' }).newState;
    expect(s.gameState.phase).toBe('planning');
    // Public (no viewer scoping): every face-down slot hides the kind.
    const pub = neitherGutsNorGears.getPublicView(s) as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }> };
    expect(pub.action_stack.every((a) => a.face === 'down' && a.card_kind === undefined)).toBe(true);
    // The placer's own view reveals what they placed.
    const selfView = neitherGutsNorGears.getPlayerView(s, first) as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }> };
    expect(selfView.action_stack.some((a) => a.owner === first && a.card_kind === 'move_battle')).toBe(true);
    // The opponent's view cannot read that placed kind.
    const other = first === 'wiz' ? 'rob' : 'wiz';
    const otherView = neitherGutsNorGears.getPlayerView(s, other) as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }> };
    expect(otherView.action_stack.every((a) => a.owner !== first || a.face === 'down')).toBe(true);
    // The opponent also places a face-down card.
    s = neitherGutsNorGears.applyMove(s, other, { type: 'plan_action', card: 'build' }).newState;
    const pub2 = neitherGutsNorGears.getPublicView(s) as { action_stack: unknown[] };
    expect(pub2.action_stack.length).toBe(2); // both face-down in the shared view
    expect(JSON.stringify(pub2.action_stack)).not.toMatch(/card_kind/); // never leaks kinds in the public stack
    // Then both pass; the stack resolves LIFO — the LAST placed (build) resolves FIRST,
    // and the moment it pops, the log carries the reveal.
    s = neitherGutsNorGears.applyMove(s, first, { type: 'plan_action', card: 'pass' }).newState;
    s = neitherGutsNorGears.applyMove(s, other, { type: 'plan_action', card: 'pass' }).newState;
    expect(s.gameState.phase).toBe('action');
    expect(s.gameState.activeAction?.cardKind).toBe('build'); // the opponent's card popped first (LIFO)
    const log = neitherGutsNorGears.getLog(s);
    expect(log.some((e) => /top card of the Action Stack: Build/i.test(e.summary))).toBe(true);
  });

  it('the kind reaches nobody else\'s public text: labels only for the resolving card', () => {
    let s = base2p();
    const a = s.gameState.planningOrder[0]!;
    const b = a === 'wiz' ? 'rob' : 'wiz';
    s = neitherGutsNorGears.applyMove(s, a, { type: 'plan_action', card: 'move_battle' }).newState;
    s = neitherGutsNorGears.applyMove(s, b, { type: 'plan_action', card: 'build' }).newState;
    s = neitherGutsNorGears.applyMove(s, a, { type: 'plan_action', card: 'pass' }).newState;
    s = neitherGutsNorGears.applyMove(s, b, { type: 'plan_action', card: 'pass' }).newState;
    // While b's build resolves, a's entry is still on the stack face down in
    // the public view — only the ACTIVE (resolving/popped) entry reveals its kind.
    const pub = neitherGutsNorGears.getPublicView(s) as { action_stack: Array<{ owner: string; card_kind?: string; face?: string }>; active_action: string | null };
    expect(pub.active_action).toMatch(/build/);
    const others = pub.action_stack.filter((a) => !pub.active_action?.startsWith(`${a.card_kind} by ${a.owner}`));
    // The only face-up entry is the resolving one — every still-stacked card is down.
    expect(others.every((a) => a.face === 'down' && a.card_kind === undefined)).toBe(true);
  });
});
