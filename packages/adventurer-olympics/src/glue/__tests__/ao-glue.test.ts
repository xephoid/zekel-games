// The Adventurer Olympics glue against every captured engine view
// (tests/fixtures/ao, written by scripts/ao-fixtures.mjs). What it checks is
// what the table must never get wrong: every lit part is a move the engine
// listed, every button sends a listed move, Draw and Roll are only ever the
// table's own button, exploring sends nothing until Place, and the map draws
// exactly the engine's hexes.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MapData, TableauData } from '@zekel/primitives';
import type { LegalMove } from '@zekel/wire-types';
import { adventurerOlympicsGlue } from '../index.js';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import type { GlueInput, PromptAction, Zone } from '@zekel/glue-kit';

const g = adventurerOlympicsGlue;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ao');

interface Fixture { key: string; viewer: string; view: any; legalMoves: LegalMove[]; watcher: string; watcherView: any; watcherLegalMoves: LegalMove[] }
const FIXTURES: Fixture[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const fx = (key: string) => FIXTURES.find((f) => f.key === key)!;

function input(f: Fixture, extra: Partial<GlueInput> = {}): GlueInput {
  return { view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: null, seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(), ...extra };
}
const mapOf = (zones: Zone[]) => zones.find((z) => z.kind === 'map')!.data as MapData;
const moveActions = (a: PromptAction[] = []) => a.flatMap((x) => ('move' in x ? [x.move] : 'moves' in x ? x.moves : []));

describe('the Adventurer Olympics glue, on every captured view', () => {
  it('has views to test', () => expect(FIXTURES.length).toBeGreaterThan(30));

  for (const f of FIXTURES) {
    describe(f.key, () => {
      const inp = input(f);
      const plan = g.plan(inp)!;

      it('plans a table, and the map draws every hex the engine has, once', () => {
        expect(plan).not.toBeNull();
        const real = mapOf(plan.board).nodes.filter((n) => !n.ghost).map((n) => n.id.replace(/^ao:hex:/, ''));
        expect(new Set(real).size).toBe(real.length);
        expect(real.sort()).toEqual([...f.view.map.hexes].sort());
      });

      it('lights only moves the engine listed, and each lit hex means exactly one', () => {
        for (const id of g.litParts(inp)) {
          if (id.startsWith('ao:slot:')) continue; // a slot changes the choice being put together
          const moves = g.movesForSelect!({ component: 'map', id, label: '' }, inp);
          expect(moves, id).toHaveLength(1);
          expect(isSubmissionAllowed('tap', moves[0]!.move, f.legalMoves)).toBe(true);
        }
      });

      it('every button sends a listed move; none of them is the Roll or Draw button', () => {
        for (const m of moveActions(plan.prompt?.actions)) {
          expect(isSubmissionAllowed('tap', m.move, f.legalMoves)).toBe(true);
          expect(m.move['type']).not.toBe('resolve_report');
        }
      });

      it('a watching seat sees the table and can press nothing', () => {
        const w = input(f, { view: f.watcherView, legalMoves: f.watcherLegalMoves, playerId: f.watcher });
        const wp = g.plan(w)!;
        expect(wp).not.toBeNull();
        if (f.view.pending?.seat !== f.watcher) expect(wp.prompt).toBeUndefined();
      });
    });
  }
});

describe('Draw and Roll', () => {
  for (const key of ['draw-companion', 'draw-dungeon', 'draw-tile-forced', 'draw-dungeon-again', 'roll-test', 'roll-turn_order']) {
    it(`${key}: the only move is the button, and the plan offers nothing else to press`, () => {
      const f = fx(key);
      expect(f.legalMoves.map((m) => m.move)).toEqual([{ type: 'resolve_report' }]);
      expect(g.resolveReportMove(f.legalMoves)?.move).toEqual({ type: 'resolve_report' });
      const plan = g.plan(input(f))!;
      expect(moveActions(plan.prompt?.actions)).toEqual([]);
      expect(g.litParts(input(f))).toEqual([]);
    });
  }

  it('the card being tested is shown only once it is drawn', () => {
    const drawn = (key: string) => (g.plan(input(fx(key)))!.board.find((z) => z.id === 'ao:drawn')!.data as { cards: unknown[] }).cards;
    expect(drawn('draw-companion')).toEqual([]);
    expect(drawn('roll-test').length).toBe(1);
  });

});

describe('exploring', () => {
  const f = fx('explore_place-ordinary');
  const slots = f.view.placementOptions.slots as Array<{ slot: string; hexes: string[] }>;

  it('lights every hex of every slot, and a tap on one picks that slot and sends nothing', () => {
    const lit = g.litParts(input(f));
    for (const s of slots) for (const h of s.hexes) expect(lit).toContain(`ao:slot:${s.slot}:${h}`);
    expect(g.movesForSelect!({ component: 'map', id: `ao:slot:${slots[0]!.slot}:${slots[0]!.hexes[0]}`, label: '' }, input(f))).toEqual([]);
    expect(g.uiForSelect!({ component: 'map', id: `ao:slot:${slots[0]!.slot}:${slots[0]!.hexes[0]}`, label: '' }, input(f))).toEqual({ slot: slots[0]!.slot, rotation: 0 });
  });

  it('offers no Place until a slot is picked; then Place is the listed move for that slot and turn', () => {
    expect(moveActions(g.plan(input(f))!.prompt?.actions)).toEqual([]);
    for (const rotation of [0, 3, 5]) {
      const plan = g.plan(input(f, { ui: { slot: slots[0]!.slot, rotation } }))!;
      const place = plan.prompt!.actions.find((a) => a.id === 'place')!;
      expect('move' in place && place.move.move).toEqual({ type: 'explore', slot: slots[0]!.slot, rotation });
      const turns = plan.prompt!.actions.filter((a) => 'ui' in a);
      expect(turns.map((a) => a.label)).toEqual(['Turn left', 'Turn right']);
    }
  });

  it("the preview puts the tile's icons where the engine says this turn puts them", () => {
    const s = f.view.placementOptions.slots[0];
    for (const r of s.rotations) {
      const nodes = mapOf(g.plan(input(f, { ui: { slot: s.slot, rotation: r.rotation } }))!.board).nodes;
      const withArt = nodes.filter((n) => n.selected && n.artUrl).map((n) => n.id.split(':').pop()).sort();
      expect(withArt).toEqual(r.icons.map((i: { hex: string }) => i.hex).sort());
    }
  });
});

describe('seats and setup', () => {
  it('shows the stats the engine gives, and calls an unnamed AI by its colour', () => {
    const f = fx('move-late-multi');
    const plan = g.plan(input(f))!;
    const mine = plan.bench.find((z) => z.kind === 'tableau')!.data as TableauData;
    const me = f.view.players.find((p: any) => p.player_id === f.viewer);
    expect(mine.stats!.find((s) => s.label === 'Strength')!.value).toBe(me.stats.strength);
    // Beside the game-drawn screen the plan gives no side zones: the screen draws them.
    expect(plan.side).toEqual([]);
    expect(plan.points).toBeUndefined();
  });

  it('the setup page asks the host for an adventurer and a colour, and sends one setup move', () => {
    const seats = [{ position: 0, kind: 'human' as const, host: true }, { position: 1, kind: 'ai' as const, host: false }];
    expect(g.setupFields({} as never, seats).map((x) => x.key)).toEqual(['standee', 'colour']);
    expect(g.setupMoves!({ standee: 'Wizard', colour: 'Blue' }, seats, {} as never)).toEqual([{ type: 'setup_standee', standee: 'Wizard', colour: 'Blue' }]);
    // With a friend at the table, each person picks at the table.
    expect(g.setupFields({} as never, [...seats, { position: 2, kind: 'human', host: false }])).toEqual([]);
  });

  it('at the table, the setup form completes a listed template with the answers only', () => {
    const f = fx('setup_standee_colour');
    const template = f.legalMoves[0]!;
    const form = g.formFor!(template, input(f))!;
    expect(form.build({})).toBeNull();
    const move = form.build({ standee: 'Rogue', colour: String(template.move['colour']) })!;
    expect(isSubmissionAllowed('form', move, f.legalMoves, { template: template.move, editableKeys: form.editableKeys })).toBe(true);
  });
});
