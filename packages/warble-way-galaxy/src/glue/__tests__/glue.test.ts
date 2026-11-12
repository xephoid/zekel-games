// The Warble Way Galaxy glue against views in the shape this game's rules give
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
import { warbleWayGlue } from '../index.js';

function input(view: unknown, legalMoves: GlueInput['legalMoves'] = [], extra: Partial<GlueInput> = {}): GlueInput {
  return {
    view, previous: null, legalMoves, playerId: extra.playerId ?? null, reference: extra.reference ?? null,
    seq: extra.seq ?? 1, engineMove: extra.engineMove ?? null, actorPlayerId: extra.actorPlayerId ?? null,
    memory: extra.memory ?? new Map(),
  };
}

const ids = (zones: Zone[]) => zones.map((z) => z.id);
const cards = (z: Zone | undefined) => ((z?.data as CardZoneData | undefined)?.cards ?? []);

// zekel/src/games/warble-way-galaxy/views.ts getView output.
const WW_VIEW = {
  phase: 'habitat',
  pending: { kind: 'research_roll' },
  character: {
    name: 'Zara', race: 'human', level: 1,
    xp: 2, xp_to_next_level: 4, credits: 200, wounded: false, dread: 0,
    abilities: { sne: { name: 'Sneak', stat: 'body', natural: 3, effective: 3 } },
    skills: ['Sneak (SNE basic)'], equipped: [],
  },
  crew: [{ name: 'Bolt', race: 'kralkin', anger_tokens: 1 }],
  unnamed_crew: 2,
  season_endings: { fortune: '200/6000 credits', legend: 'level 1/5' },
  ship: { name: 'Wasp', damage: 'Used', capacity: 3 },
  items: [{ id: 'it1', name: 'Laser Pistol', type: 'weapon', consumed: false }],
  habitat: { number: 1, name: 'Xaxalon 4', shop: [], cantina: [], missions: [] },
  journey: { legs: [{ position: 'current', cards_remaining: 3 }] },
  ruin: { map: 'R1', level: 1, round: 1, board_rows: ['row 1: # # # # #', 'row 2: # 1 . a #'] },
  travel_deck: { cards_in_draw_pile: 40, cards_in_discard: 3, discard: ['3♠', 'Q♥', '7♣'] },
  result: null,
};

describe('warble-way-galaxy glue', () => {
  const g = warbleWayGlue;
  it('puts the hologram logbook theme on the table for the captain and a watcher, and nothing on a view from another game', () => {
    expect(g.themeFor!(input(WW_VIEW, [], { playerId: 'p1' }))).toBe('ww-theme');
    expect(g.themeFor!(input(WW_VIEW, []))).toBe('ww-theme');
    expect(g.themeFor!(input({ game_id: 'something-else', phase: 'play' }, []))).toBeNull();
    expect(g.themeFor!(input(null, []))).toBeNull();
  });
  it('plans the character, crew, ship, travel deck, journey and ruin from the view', () => {
    const plan = g.plan(input(WW_VIEW))!;
    expect(ids(plan.bench)).toEqual(['ww:crew', 'ww:items']);
    // Beside the screen the side rides with the board (the screen draws its own sheet, ship and crew).
    expect(ids(plan.side)).toEqual([]);
    expect(ids(plan.board)).toEqual(['ww:travel-draw', 'ww:travel-discard', 'ww:journey', 'ww:ruin', 'ww:habitat', 'ww:character', 'ww:season', 'ww:ship']);
    // Item 3: the captain and each crew member wear their race's portrait; an unknown race gets none.
    expect((plan.board[5]!.data as { artUrl?: string }).artUrl).toBe('/art/warble-way/portraits/human.jpg');
    const crew = plan.bench[0]!.data as { cards: { artUrl?: string; label: string }[] };
    expect(crew.cards[0]).toMatchObject({ label: 'Bolt', artUrl: '/art/warble-way/portraits/kralkin.jpg' });
    // Crew capacity comes from the ship, level progress from xp_to_next_level.
    expect((plan.bench[0]!.data as CardZoneData).label).toBe('Crew (1/3) +2 unnamed');
    const stats = (plan.board[5]!.data as { stats: Array<{ label: string; value: unknown; max?: number }> }).stats;
    expect(stats.find((s) => s.label === 'XP to next level')).toEqual({ label: 'XP to next level', value: 2, max: 6 });
    const grid = plan.board[3]!.data as { extent: { maxX: number; maxY: number }; cells: Array<{ x: number; y: number }> };
    expect(grid.extent).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 1 });
    expect(grid.cells.find((c) => c.x === 1 && c.y === 1)).toBeDefined();
  });
  it('surfaces the Roll button only for resolve_report and reads dice from the summary', () => {
    const moves = [{ move_id: 'r', description: 'Roll 3d6 + SNE', move: { type: 'resolve_report' } }];
    expect(g.resolveReportMove(moves)?.move_id).toBe('r');
    expect(g.diceFor!({ engineMove: null, summary: 'Rolled 3, 5 + 1 for research.', view: null })).toEqual([3, 5, 1]);
  });
  it('names the discard pile cards from the reference data, and falls back to the code without it', () => {
    const ref: GameReferenceResponse = {
      gameId: 'warble-way-galaxy', rules: '', moveSchema: {}, optionsSchema: {},
      referenceData: {
        travel_tables: { spades_hazards: { '3': { option1: { ability: 'RES', min_roll: 10 }, option2: { ability: 'SWA', min_roll: 15 } } }, hearts_recruits: { Q: { race: 'grull', idealized: 'finesse', min_roll: 12, abilities: {} } }, clubs_missions: {} },
        cards: { '3S': { title: 'Gravity snare' }, QH: { title: 'Obsidian', line: 'Grull of Pumice, brood' } },
      },
    };
    const named = (g.plan(input(WW_VIEW, [], { reference: ref }))!.board[1]!.data as CardZoneData).cards!;
    expect(named.map((c) => [c.label, c.subtitle, c.colorKey])).toEqual([
      ['Gravity snare', '♠ 3 · Hazard', 'hazard'], ['Obsidian', '♥ Q · Recruit', 'recruit'], ['7♣', undefined, 'ship'],
    ]);
    const plain = (g.plan(input(WW_VIEW))!.board[1]!.data as CardZoneData).cards!;
    expect(plain.map((c) => c.label)).toEqual(['3♠', 'Q♥', '7♣']);
  });
  it('setup screen: the character is created from the answers, as one create_character move', () => {
    const ref: GameReferenceResponse = {
      gameId: 'warble-way-galaxy', rules: '', moveSchema: {}, optionsSchema: {},
      referenceData: {
        stats: { brawn: ['SWA (Swashbuckling)'], smarts: ['HAK (Hacking)'] },
        races: ['human', 'grull'],
        archetypes: [{ id: 'void-runner', name: 'Void Runner', scores: { SNE: 3 }, difficulty: 'easy', stars: '★' }],
      },
    };
    const seats = [{ position: 0, kind: 'human' as const, host: true }];
    const fields = g.setupFields(ref, seats);
    expect(fields.map((f) => f.key)).toEqual(['character_name', 'race', 'ship_name', 'method', 'score.SWA', 'score.HAK', 'archetype_name', 'disposition']);
    expect(g.setupMoves!({ character_name: 'Zara', race: 'grull', ship_name: 'Wasp', method: 'recommended', 'score.SWA': '3', 'score.HAK': '2', disposition: 'brash' }, seats, ref))
      .toEqual([{ type: 'create_character', character_name: 'Zara', race: 'grull', ship_name: 'Wasp', method: 'recommended', disposition: 'brash', scores: { SWA: 3, HAK: 2 } }]);
    expect(g.setupMoves!({ character_name: 'Zara', race: 'human', ship_name: 'Wasp', method: 'archetype', archetype_name: 'Void Runner', disposition: 'none' }, seats, ref))
      .toEqual([{ type: 'create_character', character_name: 'Zara', race: 'human', ship_name: 'Wasp', method: 'archetype', archetype_name: 'Void Runner' }]);
    // Unanswered: no move, so the table asks instead.
    expect(g.setupMoves!({ character_name: 'Zara' }, seats, ref)).toEqual([]);
  });
  it('character creation is a form the player fills in, with the races, abilities and archetypes from the reference data', () => {
    const ref: GameReferenceResponse = {
      gameId: 'warble-way-galaxy', rules: '', moveSchema: {}, optionsSchema: {},
      referenceData: {
        stats: { brawn: ['SWA (Swashbuckling)', 'ARM (Armor)'], smarts: ['HAK (Hacking)'] },
        races: ['human', 'kralkin', 'hexapod', 'grull'],
        archetypes: [{ id: 'void-runner', name: 'Void Runner', scores: { SNE: 3, MEC: 2, RES: 1 }, difficulty: 'easy', stars: '★' }],
      },
    };
    const skeleton = { move_id: 'create-character', description: 'Create your character … FILL IN the values the player chose — do not submit this skeleton.', move: { type: 'create_character', character_name: '', race: 'human', ship_name: '', method: 'recommended', scores: {} } };
    const inp = input({ phase: 'setup', character: null }, [skeleton], { reference: ref });
    const form = formForMove(g, skeleton, inp)!;
    expect(form.fields.map((f) => f.key)).toEqual(['character_name', 'race', 'ship_name', 'disposition', 'score.SWA', 'score.ARM', 'score.HAK']);
    expect((form.fields[1] as { options: Array<{ value: string }> }).options.map((o) => o.value)).toEqual(['human', 'kralkin', 'hexapod', 'grull']);
    // The template's "human" is a placeholder, not an answer: nothing builds until the player chooses.
    expect(form.build({ character_name: 'Zara', ship_name: 'Wasp', disposition: 'none', 'score.SWA': '3' })).toBeNull();
    expect(form.build({ character_name: 'Zara', race: 'grull', ship_name: 'Wasp', disposition: 'brash', 'score.SWA': '3', 'score.HAK': '2', 'score.ARM': '0' }))
      .toEqual({ type: 'create_character', character_name: 'Zara', race: 'grull', ship_name: 'Wasp', method: 'recommended', scores: { SWA: 3, HAK: 2 }, disposition: 'brash' });
    const arch = { ...skeleton, move_id: 'create-character-archetype', move: { type: 'create_character', character_name: '', race: 'human', ship_name: '', method: 'archetype', archetype_name: '' } };
    const af = formForMove(g, arch, input({ phase: 'setup' }, [arch], { reference: ref }))!;
    expect(af.fields.map((f) => f.key)).toEqual(['character_name', 'race', 'ship_name', 'disposition', 'archetype_name']);
    expect(af.build({ character_name: 'Zara', race: 'human', ship_name: 'Wasp', disposition: 'none', archetype_name: 'Void Runner' }))
      .toEqual({ type: 'create_character', character_name: 'Zara', race: 'human', ship_name: 'Wasp', method: 'archetype', archetype_name: 'Void Runner' });
  });
});
