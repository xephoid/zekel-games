// Cybernoir 2127 on a phone: the glue lays every zone out in one column with
// the map as a list. These tests came from Zekel Universe's
// apps/web/src/tests/cn-phone.test.tsx when the screen moved here; the parts
// of that file about Universe's own map list and card sheet stayed there.

import { describe, expect, it } from 'vitest';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { CardZoneData, MapData } from '@zekel/primitives';
import type { GlueInput } from '@zekel/glue-kit';
import { cybernoirGlue } from '../index.js';

const REF: GameReferenceResponse = {
  gameId: 'cybernoir-2127', rules: '', moveSchema: {}, optionsSchema: {},
  referenceData: {
    locations: [
      { name: 'Dark City Central Station', borough: 'downtown', population: 3, affiliation: 'none' },
      { name: 'Xistential Club', borough: 'downtown', population: 1, affiliation: 'gang_2' },
      { name: 'Shipyard', borough: 'boonies', population: 0, affiliation: 'corp_1' },
      { name: 'The Junction', borough: 'boonies', population: 2, affiliation: 'gang_1' },
    ],
    people: [
      { name: 'Blackice', home_location: 'The Junction', affiliation: 'gang_1', cost: 2, ability: 'board_discard', is_witness: false },
    ],
    affiliations: [{ id: 'none', name: 'None' }, { id: 'corp_1', name: 'OmniSuperUltra Corp' }, { id: 'gang_1', name: 'Iceden Collective' }, { id: 'gang_2', name: 'Crimson Clan' }],
    boroughs: [{ id: 'downtown', name: 'Downtown' }, { id: 'boonies', name: 'Boonies' }],
    evidence: { weapon: 1, witnesses: 3, motive_sets: 3, motive_set_size: 3, total: 13 },
  },
};

const VIEW = {
  phase: 'play', turn: 3, activePlayerId: 'det', playerOrder: ['det', 'hak'],
  pending: null, board: ['Xistential Club'],
  informants_facedown_count: 0, informants_revealed: [],
  jail: { slot_1_booked: [], slot_2_processing: [], slot_3_release_pending_then_freed: [] },
  truthful_clues: {}, truthful_values: {}, negative_clues: [],
  evidence: { weapon: null, witnesses: [], motive_set_1: [], motive_set_2: [], motive_set_3: [] },
  contacts_discard: [],
  detective: { location_deck_size: 9, location_hand_size: 1, location_discard: [], ap: 4 },
  hacker: { contacts_deck_size: 20, contacts_discard_size: 0, hand_size: 1, ap: 0 },
  locations_ruled_out: [{ location_name: 'Dark City Central Station', reason: 'NOT No affiliation' }],
  your_locations_ruled_out: [{ location_name: 'Dark City Central Station', reason: 'x' }, { location_name: 'Shipyard', reason: 'you have held or discarded this card' }],
  role: 'detective', location_hand: ['Shipyard'], informants: [],
};

const input = (view: unknown, phone: boolean): GlueInput => ({
  view, previous: null, legalMoves: [], playerId: 'det', reference: REF, seq: 1,
  engineMove: null, actorPlayerId: null, memory: new Map(), phone,
});

describe('cybernoir phone plan', () => {
  const g = cybernoirGlue;
  it('says it has a phone layout, and on a phone puts every zone in one column', () => {
    expect(g.phone).toBe(true);
    const plan = g.plan(input(VIEW, true))!;
    expect(plan.side).toEqual([]);
    expect(plan.bench).toEqual([]);
    expect(plan.points).toBeUndefined();
    expect(plan.board.map((z) => z.id)).toEqual([
      'cn:map', 'cn:clues', 'cn:not-clues', 'cn:jail', 'cn:hand', 'cn:informants', 'cn:reach', 'cn:case', 'cn:hacker', 'cn:detective',
    ]);
    // The clues, NOT tokens and jail share a strip.
    expect(plan.board.filter((z) => z.span === 'row').map((z) => z.id)).toEqual(['cn:clues', 'cn:not-clues', 'cn:jail']);
    // The hand is a row to swipe, and any card can be opened up close.
    const hand = plan.board.find((z) => z.id === 'cn:hand')!.data as CardZoneData;
    expect(hand.mode).toBe('row');
    expect(hand.inspectable).toBe(true);
    expect(plan.statusShort).toBe('T3 · 9 left');
  });

  it("draws the city as a list, each station's state in a word, opening on the borough with most still possible", () => {
    const map = g.plan(input(VIEW, true))!.board[0]!.data as MapData;
    expect(map.listView).toEqual({ first: 'boonies' });
    expect(map.fill).toBeUndefined();
    const note = (id: string) => map.nodes.find((n) => n.id === `cn:loc:${id}`)!;
    expect(note('xistential-club').note).toBe('Canvassed');
    expect(note('dark-city-central-station').note).toBe('Ruled out');
    expect(note('shipyard').note).toBe('Seen in hand');
    expect(note('the-junction')).toMatchObject({ note: 'Still possible', code: 'ICE', faces: [{ label: 'Blackice', artUrl: '/art/cybernoir/blackice.jpg' }] });
    // The Hacker's own view says which is their hideout, and crosses nothing off.
    const hak = g.plan(input({ ...VIEW, role: 'hacker', hand: [], hideout: { location_name: 'The Junction' } }, true))!.board[0]!.data as MapData;
    expect(hak.nodes.find((n) => n.id === 'cn:loc:the-junction')!.note).toBe('Your hideout');
    expect(hak.nodes.find((n) => n.id === 'cn:loc:shipyard')!.note).toBe('Still possible');
  });

  it('keeps the desktop layout off a phone', () => {
    const plan = g.plan(input(VIEW, false))!;
    expect(plan.side.length).toBeGreaterThan(0);
    expect((plan.board[0]!.data as MapData).listView).toBeUndefined();
  });
});

