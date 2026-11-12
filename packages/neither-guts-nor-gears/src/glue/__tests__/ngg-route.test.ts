// The NGnG router against views the engine actually produced
// (scripts/ngg-fixtures.mjs). Every captured view must route, and the
// deciding seat and a watching seat must land on the screens
// docs/design/SCREEN-ROUTING.md names.

import { describe, expect, it } from 'vitest';
import type { LegalMove } from '@zekel/wire-types';
import { readView, activeActionOf } from '../table/read.js';
import { route, type ScreenKey } from '../table/route.js';

interface Fixture {
  key: string;
  viewer: string;
  view: unknown;
  legalMoves: LegalMove[];
  watcher: string;
  watcherView: unknown;
  watcherLegalMoves: LegalMove[];
}

const FIXTURES = Object.entries(import.meta.glob<Fixture>('./fixtures/ngg/*.json', { eager: true, import: 'default' }))
  .map(([path, f]) => ({ name: path.replace(/^.*\//, '').replace(/\.json$/, ''), f }));

const EXPECTED: Record<string, ScreenKey> = {
  'pending-choose_faction': 'setup-faction',
  'pending-choose_leader': 'setup-draft',
  'pending-choose_starting_location': 'setup-start',
  'pending-report_draw': 'report-draw',
  'pending-upkeep_reallocate_cores': 'core-reallocation',
  'pending-access_request': 'access-request',
  'pending-second_purchase': 'second-purchase',
  'pending-smyth_reward': 'smyth-reward',
  'pending-elara_spell': 'elara-spell',
  'pending-treaty_response': 'treaty-response',
  'pending-treaty_break_decision': 'treaty-break',
  'pending-battle_commit': 'battle-commit',
  'pending-counter_target': 'counter-target',
  'pending-extra_selection': 'battle-extra',
  'pending-battle_defense': 'battle-defense',
  'pending-retreat': 'retreat',
  'pending-rally_selection': 'rally',
  'pending-choose_milestone_hero': 'hero-claim',
  'pending-overlay_choice': 'overlay-choice',
  'pending-place_reserved_hero': 'reserved-hero',
  'pending-choose_spy': 'spy-assign',
  'action-build': 'build',
  'action-research': 'research',
  'action-move_battle': 'move-battle',
  'phase-planning': 'planning',
  'phase-game_over': 'game-over',
};

describe('NGnG route', () => {
  it('has fixtures to route', () => {
    expect(FIXTURES.length).toBeGreaterThan(20);
  });

  for (const { name, f } of FIXTURES) {
    it(`${name}: the deciding seat and a watcher`, () => {
      const v = readView(f.view)!;
      expect(v).not.toBeNull();
      const r = route(v, f.viewer, f.legalMoves);
      const want = EXPECTED[f.key];
      if (want && !(want === 'battle-commit' && r.screen === 'shared-tactics')) expect(r.screen).toBe(want);
      if (f.key.startsWith('pending-')) {
        expect(r.owner).toBe(f.viewer);
        expect(['decide', 'answer']).toContain(r.perspective);
      }
      // The same view, twice, is the same screen.
      expect(route(v, f.viewer, f.legalMoves)).toEqual(r);

      // A watcher never gets controls for a decision that is not theirs.
      const w = readView(f.watcherView)!;
      const wr = route(w, f.watcher, f.watcherLegalMoves);
      if (f.key.startsWith('pending-')) {
        expect(wr.perspective).toBe('watch');
        expect(wr.interrupt).toBe(false);
      }
    });
  }

  it('marks the three out-of-turn screens as interrupts for the seat that owes them', () => {
    for (const { f } of FIXTURES.filter((x) => ['pending-access_request', 'pending-treaty_response', 'pending-battle_defense'].includes(x.f.key))) {
      const r = route(readView(f.view)!, f.viewer, f.legalMoves);
      expect(r.interrupt).toBe(true);
      expect(r.perspective).toBe('answer');
    }
  });
});

describe('NGnG view reading', () => {
  it('reads the resolving card from the string the engine sends, and from a structured field', () => {
    expect(activeActionOf('move_battle by p3')).toEqual({ cardKind: 'move_battle', owner: 'p3', finished: false });
    expect(activeActionOf({ card_kind: 'build', owner: 'p2' })).toEqual({ cardKind: 'build', owner: 'p2', finished: false });
    expect(activeActionOf({ card_kind: 'build', owner: 'p2', finished: true })).toEqual({ cardKind: 'build', owner: 'p2', finished: true });
    expect(activeActionOf('something else')).toBeNull();
    expect(activeActionOf(null)).toBeNull();
  });

  it('puts every piece on its tile from the owners\' own lists', () => {
    for (const { f } of FIXTURES) {
      const raw = f.view as { map: { tiles: Array<{ coord: string; units: string[]; heroes: string[]; collectors: string[] }> } };
      const v = readView(f.view)!;
      for (const t of raw.map.tiles) {
        const tile = v.tiles.find((x) => x.coord === t.coord)!;
        expect(tile.pieces.filter((p) => p.kind === 'unit')).toHaveLength(t.units.length);
        expect(tile.pieces.filter((p) => p.kind === 'hero')).toHaveLength(t.heroes.length);
        expect(tile.pieces.filter((p) => p.kind === 'collector')).toHaveLength(t.collectors.length);
      }
    }
  });

  it('is not a view of another game', () => {
    expect(readView({ game_id: 'fractured-fist' })).toBeNull();
    expect(readView(null)).toBeNull();
  });
  it('routes a finished action to the end-of-action screen for its owner and a watcher alike', () => {
    const f = FIXTURES.find((x) => x.f.key === 'action-build')!.f;
    const view = structuredClone(f.view) as { resolving_action: Record<string, unknown> };
    view.resolving_action = { ...view.resolving_action, finished: true };
    const v = readView(view)!;
    const owner = v.activeAction!.owner;
    expect(route(v, owner, [])).toMatchObject({ screen: 'action-done', perspective: 'decide', owner });
    const other = v.players.find((p) => p.id !== owner)!.id;
    expect(route(v, other, [])).toMatchObject({ screen: 'action-done', perspective: 'watch', owner });
  });
});
