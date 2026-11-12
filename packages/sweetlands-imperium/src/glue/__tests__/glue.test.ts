// The Sweetlands Imperium glue against views in the shape this game's rules give
// them. Legal move fixtures follow the engine's LegalMove shape:
// { move_id, description, move }. These tests came from Zekel Universe's
// apps/web/src/tests/glue.test.ts when the screen moved here.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { CardData, CardZoneData, MapData, PoolData, TableauData, TrackData } from '@zekel/primitives';
import type { GlueInput, LegalMove, TablePlan, Zone } from '@zekel/glue-kit';
import { formForMove, isSubmissionAllowed, movesForSelect, templateForm } from '@zekel/glue-kit';
import { sweetlandsGlue } from '../index.js';
import { SPACES, JUNCTION_ROADS, TREATS, CASTLE_POS } from '../sweetlands-board.js';

function input(view: unknown, legalMoves: GlueInput['legalMoves'] = [], extra: Partial<GlueInput> = {}): GlueInput {
  return {
    view, previous: null, legalMoves, playerId: extra.playerId ?? null, reference: extra.reference ?? null,
    seq: extra.seq ?? 1, engineMove: extra.engineMove ?? null, actorPlayerId: extra.actorPlayerId ?? null,
    memory: extra.memory ?? new Map(),
  };
}

const ids = (zones: Zone[]) => zones.map((z) => z.id);
const cards = (z: Zone | undefined) => ((z?.data as CardZoneData | undefined)?.cards ?? []);

// zekel/src/games/sweetlands-imperium/views.ts getPlayerView. Treat ids and
// random placements are the engine's ids (data/board.ts TreatId).
const SL_VIEW = {
  game_id: 'sweetlands-imperium',
  phase: 'play', round: 1, active_player_id: 's1', first_player_id: 's1',
  taxes: { '1': 0, '2': 1, '3': 0, '4': 2 }, foe: { type: 'dragon', defeated: false }, castle_occupant_id: null,
  intel_deck_count: 72, intel_discard_count: 4,
  random_treat_placement: { '1': 'ice_cream', '2': 'chocolate_bar', '3': 'gummy_bear', '4': 'cupcake' },
  players: [
    {
      player_id: 's1', kind: 'human', faction: 'milkshake', faction_name: 'Arch Duchess of Milkshake',
      home_region: 1, points: 1, influence: 2, sugar_cubes: 3, intel_tokens: ['red'],
      hand_count: 3,
      units: { leader: 'region 1 start', knight: 'region 1 ring space 2 (yellow)', ambassador: 'off-board' },
      unit_locations: {
        leader: { zone: 'start', region: 1 },
        knight: { zone: 'ring', region: 1, ringIndex: 2 },
        ambassador: { zone: 'offboard' },
      },
    },
    { player_id: 's2', kind: 'ai', faction: 'fudge', faction_name: 'General Fudge', home_region: 2, points: 0, influence: 0, sugar_cubes: 2, intel_tokens: [], hand_count: 3, units: {}, unit_locations: { leader: { zone: 'castle' } } },
  ],
  your_hand: [
    { card_id: 'i1', kind: 'single', color: 'red' },
    { card_id: 'i2', kind: 'double', color: 'blue' },
    { card_id: 'i3', kind: 'treat', treat: 'ice_cream' },
    { card_id: 'i4', kind: 'single', color: 'red' },
  ],
  your_secret_objectives: ['so1'], your_turn_step: 'play',
};

const SL_REFERENCE: GameReferenceResponse = {
  gameId: 'sweetlands-imperium', rules: '', moveSchema: {}, optionsSchema: {},
  referenceData: {
    points_to_win: 5,
    factions: [
      { id: 'milkshake', name: 'Arch Duchess of Milkshake', region: 1, color: 'yellow', ability: 'You never pay taxes.' },
      { id: 'fudge', name: 'General Fudge', region: 2, color: 'brown', ability: 'Discard 2 Intel to convert.' },
      { id: 'jellybean', name: 'Princess Jellybean', region: 3, color: 'purple', ability: 'Knight wins vs knights.' },
      { id: 'cheesecake', name: 'Grand Vizier Cheesecake', region: 4, color: 'white', ability: 'Treats go anywhere.' },
      { id: 'nomads', name: 'Deposed Queen Quiche', region: null, color: 'black', ability: '5-player only.' },
    ],
  },
};

// The engine's legal moves for one card: several per card (unit, action, route).
const SL_MOVES = [
  { move_id: 'a', description: 'Play red: move leader and take the red action.', move: { type: 'play_intel', cardId: 'i1', unit: 'leader', viaRoad: false, takeAction: true } },
  { move_id: 'b', description: 'Play red: move leader only (no action).', move: { type: 'play_intel', cardId: 'i1', unit: 'leader', viaRoad: false, takeAction: false } },
  { move_id: 'c', description: 'Play red: move knight via road and take the red action.', move: { type: 'play_intel', cardId: 'i1', unit: 'knight', viaRoad: true, takeAction: true } },
  { move_id: 'd', description: 'Use the ice_cream treat to move your ambassador to its special location.', move: { type: 'play_intel', cardId: 'i3', unit: 'ambassador', takeAction: false } },
  { move_id: 'e', description: 'Spend your red Intel token: move leader and take the red action.', move: { type: 'play_token', color: 'red', unit: 'leader', viaRoad: false, takeAction: true } },
  { move_id: 'f', description: 'Discard 4 Intel to gain one green Intel.', move: { type: 'discard_for_color', cardIds: ['i1', 'i2', 'i3', 'i4'], color: 'green' } },
  { move_id: 'g', description: 'Pass your turn to gain 1 influence.', move: { type: 'pass' } },
];

/** The printed board from docs/games/sweetlands-imperium.md, cell by cell. */
function referenceBoard(): Map<string, string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // A copy of Zekel Universe's docs/games/sweetlands-imperium.md, taken when the
  // screen moved here: the reference the board's positions are checked against.
  const doc = readFileSync(path.resolve(here, 'fixtures/sweetlands-imperium-reference.md'), 'utf8');
  const block = /The printed board[\s\S]*?```([\s\S]*?)```/.exec(doc);
  expect(block, 'the printed board block in the reference').toBeTruthy();
  const cells = new Map<string, string>();
  for (const line of block![1]!.split(/\r?\n/)) {
    const m = /^\s*r(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const row = Number(m[1]);
    m[2]!.trim().split(/\s+/).forEach((tok, col) => { if (tok !== '.') cells.set(`${row},${col}`, tok); });
  }
  return cells;
}

describe('sweetlands-imperium glue', () => {
  const g = sweetlandsGlue;
  it('puts the candy theme on the table for a seat and a watcher, and nothing on a view from another game', () => {
    expect(g.themeFor!(input(SL_VIEW, [], { playerId: 's1' }))).toBe('sl-theme');
    expect(g.themeFor!(input(SL_VIEW, []))).toBe('sl-theme');
    expect(g.themeFor!(input({ game_id: 'something-else', players: [], phase: 'play' }, []))).toBeNull();
    expect(g.themeFor!(input(null, []))).toBeNull();
  });
  it('board data matches the reference: 80 spaces + 4 junction roads', () => {
    expect(SPACES).toHaveLength(80);
    expect(Object.keys(JUNCTION_ROADS)).toHaveLength(4);
    expect(JUNCTION_ROADS['r1-ring-5']).toBe('r1-road-0');
  });
  it('every one of the 80 spaces, the 4 starts and the castle sits where the reference document prints it', () => {
    const cells = referenceBoard();
    const letter: Record<string, string> = { red: 'R', orange: 'O', yellow: 'Y', green: 'G', blue: 'B', purple: 'P' };
    const regional: Record<number, string> = { 1: 'MS', 2: 'FD', 3: 'JB', 4: 'CC' };
    const covered = new Set<string>();
    for (const sp of SPACES) {
      const tok = cells.get(`${sp.row},${sp.col}`);
      expect(tok, `${sp.id} at (${sp.row},${sp.col})`).toBeDefined();
      covered.add(`${sp.row},${sp.col}`);
      if (sp.zone === 'ring') expect(tok).toBe(`${letter[sp.color!]}${sp.region}`);
      else if (sp.zone === 'road') expect(tok).toMatch(new RegExp(`^${letter[sp.color!]}[<>^v]$`));
      else if (sp.index === 0) expect(tok).toBe(regional[sp.region]);
      else expect(tok).toBe('?');
    }
    for (const r of [1, 2, 3, 4] as const) {
      const [row, col] = TREATS[r]!.start;
      expect(cells.get(`${row},${col}`)).toBe(`S${r}`);
      covered.add(`${row},${col}`);
    }
    for (const [row, col] of CASTLE_POS) {
      expect(cells.get(`${row},${col}`)).toBe('XX');
      covered.add(`${row},${col}`);
    }
    // And nothing printed is left unplaced.
    for (const key of cells.keys()) expect(covered.has(key), `printed cell ${key} ${cells.get(key)} is on the table`).toBe(true);
    expect(cells.size).toBe(80 + 4 + 4);
  });
  it('plans the map with units, the foe and the treat art; the hand and tokens in the bench; points from the reference', () => {
    const plan = g.plan(input(SL_VIEW, [], { playerId: 's1', reference: SL_REFERENCE }))!;
    const map = plan.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(map.nodes.find((n) => n.id === 'r1-start')!.pieces).toEqual([{ label: 'leader (s1)', colorKey: 'milkshake' }]);
    expect(map.nodes.find((n) => n.id === 'r1-ring-2')!.pieces![0]!.label).toBe('knight (s1)');
    const castle = map.nodes.find((n) => n.id === 'castle')!;
    expect(castle.pieces!.map((p) => p.label)).toEqual(['foe:dragon']);
    expect(castle.badges).toEqual(['Dragon']);
    expect(map.nodes.find((n) => n.id === 'r1-treat-regional')!.artUrl).toBe('/art/sweetlands/treat-milkshake-1.png');
    expect(map.nodes.find((n) => n.id === 'r2-treat-random')!.artUrl).toBe('/art/sweetlands/treat-fudge-2.png');
    expect(map.nodes.find((n) => n.id === 'r2-treat-random')!.label).toBe('Chocolate Bar');
    expect(ids(plan.bench)).toEqual(['sl:p:s1', 'sl:tokens', 'sl:hand', 'sl:secrets']);
    expect(cards(plan.bench[2]).map((c) => c.id)).toEqual(['sl:card:i1', 'sl:card:i2', 'sl:card:i3', 'sl:card:i4']);
    expect(cards(plan.bench[2])[2]!.artUrl).toBe('/art/sweetlands/treat-milkshake-2.png');
    const me = plan.bench[0]!.data as { artUrl?: string; stats: Array<{ label: string; max?: number }> };
    expect(me.artUrl).toBe('/art/sweetlands/sweet-milkshake.jpg');
    expect(me.stats.find((s) => s.label === 'Points')!.max).toBe(5);
    expect(plan.side).toEqual([]);
    expect(ids(plan.board)).toEqual(['sl:map', 'sl:intel-deck', 'sl:intel-discard', 'sl:p:s2', 'sl:taxes', 'sl:points']);
    const points = plan.board.find((z) => z.id === 'sl:points')!.data as TrackData;
    expect(points.spaces).toHaveLength(6);
    expect(points.spaces[1]!.pieces).toEqual([{ label: 'milkshake (s1)', colorKey: 'milkshake' }]);
  });
  it('lights cards by the engine card id and tokens as a pool; a tap opens the chooser with that card\'s moves only', () => {
    const inp = input(SL_VIEW, SL_MOVES, { playerId: 's1', reference: SL_REFERENCE });
    expect(g.litParts(inp).sort()).toEqual(['sl:card:i1', 'sl:card:i3', 'sl:tokens']);
    // Three moves for the red card: the chooser gets all three, in the engine's words.
    const red = movesForSelect(g, { component: 'card', id: 'sl:card:i1', label: 'Red' }, inp);
    expect(red.map((m) => m.move_id)).toEqual(['a', 'b', 'c']);
    expect(g.moveForSelect({ component: 'card', id: 'sl:card:i1', label: 'Red' }, inp)).toBeNull();
    // One move for the treat: sent as is.
    expect(g.moveForSelect({ component: 'card', id: 'sl:card:i3', label: 'Ice Cream' }, inp)?.move_id).toBe('d');
    expect(movesForSelect(g, { component: 'pool', id: 'sl:tokens', label: 'tokens' }, inp).map((m) => m.move_id)).toEqual(['e']);
    // A second copy of a card the engine did not list is not lit.
    expect(g.litParts(inp)).not.toContain('sl:card:i4');
  });
  it('turns template moves into forms with nothing preselected: factions per seat, the Intel to discard, the treat slot', () => {
    const setupView = { ...SL_VIEW, phase: 'setup_factions', players: SL_VIEW.players.map((p) => ({ ...p, faction: null })) };
    const assign = { move_id: 'x', description: 'Assign each player a faction — default distinct map shown; edit to each human\'s choice.', move: { type: 'assign_setup_choices', selections: { s1: 'milkshake', s2: 'fudge' } } };
    const inp = input(setupView, [assign], { playerId: 's1', reference: SL_REFERENCE });
    const form = formForMove(g, assign, inp)!;
    expect(form.fields.map((f) => f.key)).toEqual(['seat.s1', 'seat.s2']);
    expect(form.fields[0]).toMatchObject({ kind: 'choice', label: 's1 (you)' });
    expect((form.fields[1] as { options: unknown[] }).options).toHaveLength(4); // no Nomads at two seats
    expect(form.build({})).toBeNull();
    expect(form.build({ 'seat.s1': 'fudge', 'seat.s2': 'fudge' })).toBeNull(); // no sharing
    expect(form.build({ 'seat.s1': 'jellybean', 'seat.s2': 'cheesecake' })).toEqual({ type: 'assign_setup_choices', selections: { s1: 'jellybean', s2: 'cheesecake' } });
    expect(form.editableKeys).toEqual(['selections']);

    const discard = SL_MOVES[5]!;
    const df = formForMove(g, discard, input(SL_VIEW, SL_MOVES, { playerId: 's1' }))!;
    expect(df.fields[0]).toMatchObject({ kind: 'multi', key: 'cardIds', pick: 4 });
    expect(df.build({ cardIds: ['i1'] })).toBeNull();
    expect(df.build({ cardIds: ['i4', 'i3', 'i2', 'i1'] })).toEqual({ type: 'discard_for_color', cardIds: ['i4', 'i3', 'i2', 'i1'], color: 'green' });

    const anySlot = { move_id: 'y', description: 'Cheesecake: use ice_cream to move your ambassador to ANY treat (region 1 regional shown — edit region/slot).', move: { type: 'play_intel', cardId: 'i3', unit: 'ambassador', takeAction: false, treatRegion: 1, treatSlot: 'regional' } };
    const tf = formForMove(g, anySlot, input(SL_VIEW, [anySlot], { playerId: 's1', reference: SL_REFERENCE }))!;
    expect(tf.build({})).toBeNull();
    expect(tf.build({ treatRegion: '3', treatSlot: 'random' })).toMatchObject({ treatRegion: 3, treatSlot: 'random', cardId: 'i3' });
    // A complete move has no form.
    expect(formForMove(g, SL_MOVES[6]!, inp)).toBeNull();
  });
  it('setup screen: against the AI the host picks every faction and the foe, which become the setup moves; with a friend the factions stay at the table', () => {
    const seats = [{ position: 0, kind: 'human' as const, host: true }, { position: 1, kind: 'ai' as const, host: false, aiDifficulty: 'easy' }];
    const ref: GameReferenceResponse = { ...SL_REFERENCE, referenceData: { ...(SL_REFERENCE.referenceData as object), foes: [{ type: 'dragon', dice: 5 }, { type: 'orc', dice: 3 }] } };
    const fields = g.setupFields(ref, seats);
    expect(fields.map((f) => [f.key, f.kind])).toEqual([['faction.p1', 'choice'], ['faction.p2', 'choice'], ['foe', 'choice']]);
    const f1 = fields[0]!;
    if (f1.kind !== 'choice') throw new Error('choice');
    expect(f1.options.map((o) => o.value)).toEqual(['milkshake', 'fudge', 'jellybean', 'cheesecake']); // no Nomads at two seats
    expect(g.setupMoves!({ 'faction.p1': 'cheesecake', 'faction.p2': 'jellybean', foe: 'orc' }, seats, ref)).toEqual([
      { type: 'assign_setup_choices', selections: { p1: 'cheesecake', p2: 'jellybean' } },
      { type: 'choose_foe', foe: 'orc' },
    ]);
    // Half an answer sends nothing for that step.
    expect(g.setupMoves!({ 'faction.p1': 'cheesecake', foe: 'orc' }, seats, ref)).toEqual([{ type: 'choose_foe', foe: 'orc' }]);
    // A friend's seat: their faction is theirs to choose at the table.
    const withFriend = [seats[0]!, { position: 1, kind: 'human' as const, host: false }];
    expect(g.setupFields(ref, withFriend)).toEqual([]);
    expect(g.setupFields(ref)).toEqual([]);
  });
  it('shows the Draw button for a pending report and reads no dice (sugar dice are not d6)', () => {
    const draw = { move_id: 'r', description: 'Draw 2 Intel card(s) (the server deals them when you press this).', move: { type: 'resolve_report' } };
    expect(g.resolveReportMove([draw])?.move_id).toBe('r');
    expect(g.diceFor!({ engineMove: null, summary: 'defeated the dragon (7 vs 4)!', view: null })).toBeNull();
  });
});
