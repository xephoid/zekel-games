// The Cybernoir 2127 glue against views in the shape this game's rules give
// them (src/views.ts). Legal move fixtures follow the engine's LegalMove
// shape: { move_id, description, move }. These tests came from Zekel
// Universe's apps/web/src/tests/glue.test.ts when the screen moved here.

import { describe, expect, it } from 'vitest';
import type { GameReferenceResponse } from '@zekel/wire-types';
import type { CardData, CardZoneData, MapData, PoolData, TableauData, TrackData } from '@zekel/primitives';
import type { GlueInput, LegalMove, TablePlan, Zone } from '@zekel/glue-kit';
import { isSubmissionAllowed, movesForSelect } from '@zekel/glue-kit';
import { cybernoirGlue } from '../index.js';

function input(view: unknown, legalMoves: GlueInput['legalMoves'] = [], extra: Partial<GlueInput> = {}): GlueInput {
  return {
    view, previous: null, legalMoves, playerId: extra.playerId ?? null, reference: extra.reference ?? null,
    seq: extra.seq ?? 1, engineMove: extra.engineMove ?? null, actorPlayerId: extra.actorPlayerId ?? null,
    memory: extra.memory ?? new Map(),
  };
}

const ids = (zones: Zone[]) => zones.map((z) => z.id);
const cards = (z: Zone | undefined) => ((z?.data as CardZoneData | undefined)?.cards ?? []);

// The hacker player's view, in the shape this package's views.ts gives it.
const CN_VIEW = {
  phase: 'play', turn: 3, activePlayerId: 'det', playerOrder: ['det', 'hak'],
  pending: null, endgame_triggered: false, endgame_reason: null,
  board: ['Dark City Central Station', 'Xistential Club'],
  informants_facedown_count: 1, informants_revealed: [{ person: 'Anansi the Spider' }],
  jail: { slot_1_booked: ['Blackice'], slot_2_processing: [], slot_3_release_pending_then_freed: [] },
  truthful_clues: { borough: true, population: false, affiliation: false },
  truthful_values: { borough: 'downtown' },
  negative_clues: ['population_0', 'affiliation_gang_1'],
  safehouse_burned: false, hideout_card_removed: false,
  evidence: { weapon: null, witnesses: ['Eddie the Doorman'], motive_set_1: [], motive_set_2: [], motive_set_3: [], motive_set_4: [] },
  contacts_discard: ['The Weapon'],
  detective: { location_deck_size: 12, location_hand_size: 3, location_discard: ['Shipyard'], poi_deck_size: 30, mid_game_guess_spent: false, ap: 3, overclock_used: false },
  hacker: { contacts_deck_size: 20, contacts_discard_size: 1, hand_size: 2, ap: 2, overclock_used: false },
  overclock_draws_owed: 0, overclock_draw_timing: null,
  role: 'hacker',
  hand: ['Blackice', 'The Weapon'],
  hideout: { location_name: 'The Junction', borough: 'boonies', population: 2, affiliation: 'gang_1' },
  evidence_detail: {},
};

const CN_REFERENCE: GameReferenceResponse = {
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
      { name: 'Anansi the Spider', home_location: 'The Junction', affiliation: 'gang_2', cost: 1, ability: 'reveal_informant', is_witness: false },
      { name: 'Eddie the Doorman', home_location: 'Xistential Club', affiliation: 'none', cost: 0, ability: 'witness', is_witness: true },
    ],
    affiliations: [
      { id: 'none', name: 'None' },
      { id: 'corp_1', name: 'OmniSuperUltra Corp' },
      { id: 'gang_1', name: 'Iceden Collective' },
      { id: 'gang_2', name: 'Crimson Clan' },
    ],
    boroughs: [
      { id: 'downtown', name: 'Downtown' },
      { id: 'boonies', name: 'Boonies' },
    ],
    evidence: { weapon: 1, witnesses: 3, motive_sets: 3, motive_set_size: 3, total: 13 },
    abilities: [
      { id: 'board_discard', name: 'Board discard', text: 'Discard one Location the Detective has already played from the board.' },
      { id: 'reveal_informant', name: 'Reveal an informant', text: "Turn one of the Detective's face-down informants face up." },
      { id: 'witness', name: 'Witness', text: 'No ability of its own. Witnesses are played as Evidence, three at once.' },
    ],
  },
};

// The same city with one place the subway map has no spot for.
const CN_UNMAPPED_REFERENCE: GameReferenceResponse = {
  ...CN_REFERENCE,
  referenceData: {
    ...(CN_REFERENCE.referenceData as Record<string, unknown>),
    locations: [
      ...(CN_REFERENCE.referenceData as { locations: unknown[] }).locations,
      { name: 'Somewhere New', borough: 'boonies', population: 1, affiliation: 'none' },
    ],
  },
};

// The setup phase, before the Hacker has hidden: no board, no hand, and one
// legal move with a blank for the location name.
const CN_SETUP_VIEW = {
  ...CN_VIEW, phase: 'setup', turn: 1, activePlayerId: 'hak',
  board: [], hand: [], hideout: null,
  hacker: { ...CN_VIEW.hacker, hand_size: 0, ap: 0 },
};
const CN_HIDEOUT_MOVE = {
  move_id: 'report_hideout', description: 'Choose your hideout location',
  move: { type: 'report_hideout', location_name: '' },
};

describe('cybernoir-2127 glue', () => {
  const g = cybernoirGlue;
  /** A card as it reads, without where it flies in from (checked on its own). */
  const face = (c: CardData | undefined) => { const { arriveFrom: _from, ...rest } = c ?? ({} as CardData); return rest; };
  it('puts the rain and neon theme on the table in the seat\'s own voice, the plain city for a watcher, and nothing on another game', () => {
    expect(g.themeFor!(input(CN_VIEW, []))).toBe('cn-theme cn-theme-hacker');
    expect(g.themeFor!(input({ ...CN_VIEW, role: 'detective' }, []))).toBe('cn-theme cn-theme-detective');
    const { role: _role, hand: _hand, hideout: _hideout, ...watcher } = CN_VIEW;
    expect(g.themeFor!(input(watcher, []))).toBe('cn-theme');
    expect(g.themeFor!(input({ game_id: 'something-else' }, []))).toBeNull();
    expect(g.themeFor!(input(null, []))).toBeNull();
  });
  it('colours each faction with its subway line, keyed by the engine\'s affiliation ids', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    expect(plan.palette).toMatchObject({
      none: '#A7ADB8', corp_1: '#4D7CFF', corp_2: '#1ED19A', gang_1: '#5FE3FF', gang_2: '#FF3B5C', gang_3: '#B26BFF',
      detective: '#E23B45', hacker: '#5FE3FF',
    });
  });
  it('plans the city from the reference data with played and safehouse marks, and the hacker hand', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const map = plan.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(map.nodes).toHaveLength(4);
    expect(map.nodes.find((n) => n.id === 'cn:loc:dark-city-central-station')!.badges).toContain('played');
    // Each of the three facts a clue can name is said once, where it fits:
    // the borough is the band a region stands in, the faction is its colour,
    // and how many live there is its one badge.
    const junction = map.nodes.find((n) => n.id === 'cn:loc:the-junction')!;
    expect(junction.badges).toEqual(['safehouse', '2 residents']);
    expect(junction.area).toBe('boonies');
    expect(junction.colorKey).toBe('gang_1');
    expect(map.nodes.find((n) => n.id === 'cn:loc:dark-city-central-station')!.badges)
      .toEqual(['played', '3 residents']);
    // The borough columns carry the printed borough names: "Gang 1" is an
    // alias the engine happens to list, not a faction's name, and no id
    // reaches the eye.
    expect(map.areas!.map((a) => [a.key, a.label, a.note])).toEqual([
      ['downtown', 'Downtown', 'neon & concrete'],
      ['boonies', 'Boonies', 'off the grid'],
    ]);
    expect(map.nodeShape).toBe('station');
    expect(JSON.stringify(plan)).not.toContain('Gang ');
    // Without the reference data there is no name to print, so the id is put
    // into words rather than shown raw — and never guessed at.
    const bare = g.plan(input(CN_VIEW, [], { reference: { ...CN_REFERENCE, referenceData: { locations: (CN_REFERENCE.referenceData as { locations: unknown[] }).locations } } }))!;
    const bareMap = bare.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(bareMap.areas!.map((a) => a.label)).toEqual(['Downtown', 'Boonies']);
    expect(junction).toMatchObject({ mark: 'frame', markColorKey: 'safehouse' });
    // The table boards' layout: the hand along the bottom, everything else in
    // the side column (the case file is the table's points zone).
    expect(ids(plan.bench)).toEqual(['cn:hand']);
    expect(ids(plan.side)).toEqual(['cn:informants-facing', 'cn:jail', 'cn:detective', 'cn:hacker', 'cn:contacts-deck', 'cn:contacts-discard']);
    expect(plan.board.find((z) => z.id === 'cn:evidence')).toBeUndefined();
  });
  it('gives a Contact its cost, its field and what playing it does, without a tooltip', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const hand = cards(plan.bench.find((z) => z.id === 'cn:hand'));
    // A card that moved along the hand flies from its old place; a new one
    // from the discard (taken back) or the deck.
    expect(hand[0]!.arriveFrom!.split('|')).toEqual(expect.arrayContaining(['cn:hand:3:Blackice', 'cn:discard:contact:0:Blackice', 'cn:contacts-deck']));
    expect(face(hand[0])).toEqual({
      id: 'cn:hand:0:Blackice', label: 'Blackice', colorKey: 'gang_1',
      layout: 'portrait', costStyle: 'pips',
      artUrl: '/art/cybernoir/blackice-tall.jpg', emblemUrl: '/art/cybernoir/logos/gang_1.svg',
      groupKey: 'gang_1', cost: 2,
      subtitle: 'Discard one Location the Detective has already played from the board.',
      badges: ['Iceden Collective'],
    });
    // The Weapon is in the Contacts deck but not among the people; it is drawn
    // as itself rather than given facts it does not have.
    expect(face(hand[1])).toEqual({ id: 'cn:hand:1:The Weapon', label: 'The Weapon', colorKey: 'none' });
    // A Witness says so, and its ability line would only repeat the badge.
    const witness = g.plan(input({ ...CN_VIEW, hand: ['Eddie the Doorman'] }, [], { reference: CN_REFERENCE }))!;
    expect(face(cards(witness.bench.find((z) => z.id === 'cn:hand'))[0]))
      .toEqual({
        id: 'cn:hand:0:Eddie the Doorman', label: 'Eddie the Doorman', layout: 'portrait', costStyle: 'pips',
        artUrl: '/art/cybernoir/eddie_the_doorman-tall.jpg', emblemUrl: '/art/cybernoir/logos/witness.svg',
        colorKey: 'none', groupKey: 'none', cost: 0, badges: ['Witness'],
      });
  });

  it('draws the informants facing the Hacker: a dead feed for each face-down one, a blown portrait for each revealed one', () => {
    const facing = (view: Record<string, unknown>) => {
      const plan = g.plan(input(view, [], { reference: CN_REFERENCE }))!;
      return plan.side.find((z) => z.id === 'cn:informants-facing')!.data as CardZoneData;
    };
    const mine = facing(CN_VIEW);
    expect(mine.label).toBe('Informants facing you (2)');
    // Only how many are face down: no name, no picture, nothing to guess from.
    expect(mine.cards![0]).toEqual({ id: 'cn:informant:1', label: 'Face-down informant 1', face: 'down', backLabel: 'No signal' });
    expect(JSON.stringify(mine.cards![0])).not.toMatch(/art|Anansi|Blackice/);
    // The revealed one by name, with its portrait and the stamp. The id is
    // the engine's own name for the target, so a move at it lights the card.
    expect(mine.cards![1]).toMatchObject({
      id: 'cn:informant:Anansi the Spider', label: 'Anansi the Spider',
      artUrl: '/art/cybernoir/anansi_the_spider-tall.jpg', stamp: 'Blown',
    });
    const remove = { move_id: 'r1', description: 'Remove facedown informant #1', move: { type: 'informant_removal_choice', target_informant: '1' } };
    expect(g.litParts(input(CN_VIEW, [remove], { reference: CN_REFERENCE }))).toContain('cn:informant:1');
    // A watcher's table says whose they are.
    const { role: _r, hand: _h, hideout: _o, ...watcher } = CN_VIEW;
    expect(facing(watcher).label).toBe('Informants facing the Hacker (2)');
  });

  it("stamps a revealed informant BLOWN on the Detective's own row too", () => {
    const det = g.plan(input({ ...CN_VIEW, role: 'detective', hideout: null, location_hand: [],
      informants: [{ person: 'Blackice', revealed: true }, { person: 'Eddie the Doorman', revealed: false }] }, [], { reference: CN_REFERENCE }))!;
    const row = cards(det.bench.find((z) => z.id === 'cn:informants'));
    expect(row.map((c) => [c.label, c.stamp, c.artUrl])).toEqual([
      ['Blackice', 'Blown', '/art/cybernoir/blackice-tall.jpg'],
      ['Eddie the Doorman', undefined, '/art/cybernoir/eddie_the_doorman-tall.jpg'],
    ]);
    expect(det.side.find((z) => z.id === 'cn:informants-facing')).toBeUndefined();
  });

  it('tells the Hacker how many informants are facing them, which is their central risk', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const stats = (plan.side.find((z) => z.id === 'cn:hacker')!.data as TableauData).stats!;
    expect(stats.find((st) => st.label === 'Informants facing you')!.value).toBe(1);
  });

  it('gives each seat its own markers: no Overclock in the Detective panel', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const panel = (id: string) => {
      const z = [...plan.board, ...plan.bench, ...plan.side].find((b) => b.id === id)!;
      return (z.data as TableauData).stats!.map((st) => st.label);
    };
    // Overclock is the Hacker's, once per turn. The Detective's panel carried
    // one too, and the engine publishes `overclock_used` on both seats with
    // the Detective's always false — so it read "available" for an ability
    // the Detective can never use.
    expect(panel('cn:detective')).not.toContain('Overclock');
    expect(panel('cn:hacker')).toContain('Overclock');
    // The markers that do belong to each seat are still where they were.
    expect(panel('cn:detective')).toContain('Mid-game guess');
    expect(panel('cn:hacker')).toContain('Safehouse burned');
  });

  it("gives the Detective their own hand's facts, and their own informants' names", () => {
    const det = {
      ...CN_VIEW, role: 'detective', hideout: null,
      location_hand: ['The Junction'],
      informants: [{ person: 'Blackice', revealed: false }, { person: 'Anansi the Spider', revealed: true }],
    };
    const plan = g.plan(input(det, [], { reference: CN_REFERENCE }))!;
    // A Location is a station sign and shows who lives there: residents are
    // what playing it reaches.
    expect(cards(plan.bench.find((z) => z.id === 'cn:hand'))[0]!.arriveFrom).toMatch(/cn:hand:1:The Junction\|.*cn:location-deck$/);
    expect(face(cards(plan.bench.find((z) => z.id === 'cn:hand'))[0])).toEqual({
      id: 'cn:hand:0:The Junction', label: 'The Junction', colorKey: 'gang_1',
      layout: 'sign', code: 'ICE', groupKey: 'boonies', subtitle: 'Boonies',
      meter: { value: 2, max: 3 },
      badges: ['Iceden Collective'],
      faces: [
        { label: 'Blackice', artUrl: '/art/cybernoir/blackice.jpg' },
        { label: 'Anansi the Spider', artUrl: '/art/cybernoir/anansi_the_spider.jpg' },
      ],
    });
    // A card the engine puts in the Detective's own ruled-out list is
    // stamped NOT IT in their own hand; nothing else is.
    const held = g.plan(input({ ...det, location_hand: ['The Junction', 'Shipyard'],
      your_locations_ruled_out: [{ location_name: 'Shipyard', reason: 'in your hand' }] }, [], { reference: CN_REFERENCE }))!;
    expect(cards(held.bench.find((z) => z.id === 'cn:hand')).map((c) => [c.label, c.stamp]))
      .toEqual([['The Junction', undefined], ['Shipyard', 'Not it']]);
    // A place nobody lives says so.
    const empty = g.plan(input({ ...det, location_hand: ['Shipyard'] }, [], { reference: CN_REFERENCE }))!;
    expect(cards(empty.bench.find((z) => z.id === 'cn:hand'))[0]).toMatchObject({ code: 'OSU', badges: ['OmniSuperUltra Corp'], note: 'nobody home' });
    // They pay to hold their informants and are the one person entitled to
    // know who they are; the line says whether the Hacker has seen them.
    const informants = cards(plan.bench.find((z) => z.id === 'cn:informants'));
    // Each wears their own faction, not the seat that holds them.
    expect(informants.map((c) => [c.label, c.subtitle, c.cost, c.colorKey])).toEqual([
      ['Blackice', 'face down to the Hacker', 2, 'gang_1'],
      ['Anansi the Spider', 'revealed to the Hacker', 1, 'gang_2'],
    ]);
    expect(informants.every((c) => c.face !== 'down')).toBe(true);
  });

  it('puts the case file in the points track, in the shape the printed sheet has it', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const caseFile = plan.points!;
    expect(caseFile.kind).toBe('tableau');
    expect((caseFile.data as TableauData).label).toBe('Your case');
    // Five rows, and thirteen slots between them from turn one.
    const rows = (caseFile as { children?: Zone[] }).children!;
    const shape = rows.map((r) => {
      const d = r.data as CardZoneData;
      return [d.label, (d.cards ?? []).length, d.empty];
    });
    expect(shape).toEqual([
      ['Weapon', 0, 1],
      ['Witnesses', 1, 2],
      ['Motive First', 0, 3],
      ['Motive Second', 0, 3],
      ['Motive Third', 0, 3],
    ]);
    const slots = shape.reduce((n, [, cards, empty]) => n + (cards as number) + (empty as number), 0);
    expect(slots).toBe(13);
    // The count is the engine's: played over the total it publishes.
    expect((caseFile.data as TableauData).stats).toEqual([{ label: 'Evidence', value: 1, max: 13 }]);
    // The Detective sees the same thirteen, as the threat they are.
    const det = g.plan(input({ ...CN_VIEW, role: 'detective', hideout: null, location_hand: [] }, [], { reference: CN_REFERENCE }))!;
    expect((det.points!.data as TableauData).label).toBe("The Hacker's case");
  });

  it("gives the Detective what is printed on the Hacker's Evidence, which is how the case is solved", () => {
    const played = {
      ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], informants: [],
      evidence: {
        ...CN_VIEW.evidence,
        witnesses: ['Eddie the Doorman'],
        motive_set_1: ['Blackice', 'Anansi the Spider'],
      },
    };
    const rows = (g.plan(input(played, [], { reference: CN_REFERENCE }))!.points as { children?: Zone[] }).children!;
    const witnesses = cards(rows.find((r) => r.id === 'cn:case:witnesses'));
    // Where they live is the fact that narrows nineteen locations down. The
    // face shows in the slot, and the card flies in from the Hacker's hand.
    expect(witnesses[0]!.arriveFrom).toContain('cn:hand:0:Eddie the Doorman');
    expect(face(witnesses[0])).toEqual({
      id: 'cn:ev:witness:Eddie the Doorman', label: 'Eddie the Doorman', layout: 'portrait',
      artUrl: '/art/cybernoir/eddie_the_doorman-tall.jpg',
      colorKey: 'none', subtitle: 'at Xistential Club', cost: 0, badges: ['Witness'],
    });
    const motive = cards(rows.find((r) => r.id === 'cn:case:motive_set_1'));
    expect(motive.map((c) => [c.label, c.subtitle, c.badges])).toEqual([
      ['Blackice', 'at The Junction', ['Iceden Collective']],
      ['Anansi the Spider', 'at The Junction', ['Crimson Clan']],
    ]);
    // The Weapon is not a person and is drawn as itself.
    const weapon = cards(rows.find((r) => r.id === 'cn:case:weapon'));
    expect(weapon).toEqual([]);
    // The Hacker sees the same on their own case: it is their own card's
    // printed face either way.
    const mine = (g.plan(input({ ...played, role: 'hacker' }, [], { reference: CN_REFERENCE }))!.points as { children?: Zone[] }).children!;
    expect(cards(mine.find((r) => r.id === 'cn:case:witnesses'))[0]!.subtitle).toBe('at Xistential Club');
  });

  it('draws no slot outlines when the engine does not publish the shape of the win', () => {
    const rd = CN_REFERENCE.referenceData as Record<string, unknown>;
    const older = { ...CN_REFERENCE, referenceData: { ...rd, evidence: undefined } };
    const rows = (g.plan(input(CN_VIEW, [], { reference: older }))!.points as { children?: Zone[] }).children!;
    expect(rows.every((r) => (r.data as CardZoneData).empty === undefined)).toBe(true);
    // Still the rows the view names, with what is actually on the table.
    expect(rows.map((r) => (r.data as CardZoneData).label)).toEqual(['Weapon', 'Witnesses', 'Motive First', 'Motive Second', 'Motive Third', 'Motive Fourth']);
    expect((g.plan(input(CN_VIEW, [], { reference: older }))!.points!.data as TableauData).stats)
      .toEqual([{ label: 'Evidence', value: 1 }]);
  });

  it('keeps a played location its own colour, says what it is, and can always be looked at', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const map = plan.board.find((z) => z.kind === 'map')!.data as MapData;
    const played = map.nodes.find((n) => n.id === 'cn:loc:dark-city-central-station')!;
    // Played is what happened to it, not what it is: the faction colour stays,
    // and the red diamond says it was played.
    expect(played.colorKey).toBe('none');
    expect(played).toMatchObject({ mark: 'diamond', markColorKey: 'played', dim: false, glow: false });
    // A reader hears everything colour and position are carrying.
    expect(map.nodes.find((n) => n.id === 'cn:loc:the-junction')!.describedAs)
      .toBe('The Junction, Boonies, 2 residents, Iceden Collective, your safehouse');
    expect(played.describedAs).toContain('played');
    // And the colours say what they mean.
    expect(map.legend!.filter((k) => !k.shape).map((k) => k.label)).toEqual(['No faction', 'Crimson Clan', 'OmniSuperUltra Corp', 'Iceden Collective']);
    expect(map.inspectable).toBe(true);

    // The clues sit right under the city, not below everything else.
    expect(plan.board.map((z) => z.id).slice(0, 3)).toEqual(['cn:map', 'cn:clues', 'cn:not-clues']);
  });

  it('gives the city the height the table has left, and bands the short panels under it', () => {
    const subway = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!.board.find((z) => z.id === 'cn:map')!.data as MapData;
    expect(subway.fill).toEqual({ minHeight: 300 });
    expect(subway.aspect).toBeUndefined();
    // A location the subway map has no place for keeps the whole city in the
    // plain bands rather than guessing where to draw it.
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_UNMAPPED_REFERENCE }))!;
    const map = plan.board.find((z) => z.id === 'cn:map')!.data as MapData;
    expect(map.nodeShape).toBe('pill');
    // The city asks for the room that is there. Working its height out from
    // its width is what pushed the bottom borough behind the action bar on a
    // wide window, so there is no aspect to fall back on.
    expect(map.fill).toEqual({ minHeight: 236 });
    expect(map.aspect).toBeUndefined();

    // A borough is one row, not two: every location in a band shares its y.
    for (const area of map.areas!) {
      const ys = new Set(map.nodes.filter((n) => n.area === area.key).map((n) => n.y));
      expect(ys.size).toBe(1);
    }
    // Three bands, so three distinct rows down the board.
    expect(new Set(map.nodes.map((n) => n.y)).size).toBe(map.areas!.length);

    // The two clue panels share one band under the map; the jail is in the
    // side column with the case.
    const band = plan.board.filter((z) => z.span === 'row').map((z) => z.id);
    expect(band).toEqual(['cn:clues', 'cn:not-clues']);
    expect(plan.side.some((z) => z.id === 'cn:jail')).toBe(true);
  });

  it("draws the city as a subway map: a line per faction, each station marked from its own seat's view only", () => {
    const map = (view: Record<string, unknown>) =>
      g.plan(input(view, [], { reference: CN_REFERENCE }))!.board.find((z) => z.id === 'cn:map')!.data as MapData;
    const node = (m: MapData, name: string) => m.nodes.find((n) => n.id === `cn:loc:${name}`)!;
    const outs = {
      // Public: a clue rules out Shipyard (Central Station and the Club are played).
      locations_ruled_out: [{ location_name: 'Shipyard', reason: 'NOT OmniSuperUltra Corp' }],
      // The Detective's own: they have held The Junction. The engine sends this to them alone.
      your_locations_ruled_out: [
        { location_name: 'Shipyard', reason: 'NOT OmniSuperUltra Corp' },
        { location_name: 'The Junction', reason: 'in your discard' },
      ],
    };
    const det = map({ ...CN_VIEW, ...outs, role: 'detective', hideout: null, location_hand: [] });
    expect(node(det, 'shipyard')).toMatchObject({ dim: true, crossed: false, glow: false });
    expect(node(det, 'the-junction')).toMatchObject({ dim: false, crossed: true, glow: false });
    expect(node(det, 'the-junction').describedAs).toContain('ruled out: in your discard');
    expect(node(det, 'xistential-club')).toMatchObject({ mark: 'diamond', dim: false, crossed: false, glow: false });
    expect(det.nodes.some((n) => n.mark === 'frame')).toBe(false);

    // The Hacker's view never crosses anything off, even if a list arrived.
    const hak = map({ ...CN_VIEW, ...outs });
    expect(node(hak, 'the-junction')).toMatchObject({ crossed: false, glow: true, mark: 'frame' });
    expect(node(hak, 'shipyard').dim).toBe(true);
    expect(hak.legend!.some((k) => k.shape === 'crossed')).toBe(false);
    expect(det.legend!.some((k) => k.shape === 'frame')).toBe(false);

    // Lines: one per faction on the table, decoration only, inside the board.
    expect(hak.lines!.map((l) => l.key).sort()).toEqual(['corp_1', 'gang_1', 'gang_2', 'none']);
    for (const l of hak.lines!) {
      expect(l.colorKey).toBe(l.key);
      for (const p of l.points) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(100); }
    }
    expect(hak.legendNote).toMatch(/Nobody travels on them/);
    // Short names on the map; the full printed name is what a reader hears.
    expect(node(hak, 'dark-city-central-station').label).toBe('Central Station');
    expect(node(hak, 'dark-city-central-station').describedAs).toMatch(/^Dark City Central Station, Downtown, 3 residents/);
    expect(node(hak, 'dark-city-central-station').meter).toEqual({ value: 3, max: 3 });
    // Every station stands inside its own borough's column.
    for (const n of hak.nodes) {
      const col = hak.areas!.find((a) => a.key === n.area)!;
      expect(n.x).toBeGreaterThan(col.x!);
      expect(n.x).toBeLessThan(col.x! + col.width!);
    }
  });

  it('shows what a location is when there is no move behind it', () => {
    const inp = input(CN_VIEW, [], { reference: CN_REFERENCE });
    const detail = g.detailFor!({ component: 'map', id: 'cn:loc:the-junction', label: 'The Junction' }, inp)!;
    expect(detail.title).toBe('The Junction');
    expect(detail.lines).toEqual([
      'Borough: Boonies',
      'Lives here: Blackice, Anansi the Spider',
      'Faction: Iceden Collective',
      'This is your safehouse.',
    ]);
    // A played one says so, in a sentence rather than a badge.
    expect(g.detailFor!({ component: 'map', id: 'cn:loc:dark-city-central-station', label: '' }, inp)!.lines)
      .toContain('Played by the Detective.');
    // Something that is not a location has no detail to give.
    expect(g.detailFor!({ component: 'card', id: 'cn:hand:0:Blackice', label: '' }, inp)).toBeNull();
  });

  it("crosses a location off with the engine's reason, and never with one of its own", () => {
    const told = {
      ...CN_VIEW,
      locations_ruled_out: [
        { location_name: 'Dark City Central Station', reason: 'the Detective played this card, so it is not the safehouse' },
        { location_name: 'Shipyard', reason: 'a NOT token rules out Corp 1' },
      ],
    };
    const plan = g.plan(input(told, [], { reference: CN_REFERENCE }))!;
    const map = plan.board.find((z) => z.kind === 'map')!.data as MapData;
    const shipyard = map.nodes.find((n) => n.id === 'cn:loc:shipyard')!;
    expect(shipyard.dim).toBe(true);
    expect(shipyard.badges).toContain('ruled out');
    expect(shipyard.describedAs).toContain('ruled out: a NOT token rules out Corp 1');
    // How many still stand is the engine's arithmetic, not ours.
    expect(map.label).toBe('The city · 4 locations · 2 still standing');
    // And the reason is on the location's own sheet.
    expect(g.detailFor!({ component: 'map', id: 'cn:loc:shipyard', label: '' }, input(told, [], { reference: CN_REFERENCE }))!.lines)
      .toContain('Ruled out — a NOT token rules out Corp 1.');

    // Told nothing, it crosses nothing off — a played card is only out
    // because the safehouse card left the deck, which is the engine's to say.
    const silent = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const quietMap = silent.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(quietMap.nodes.every((n) => !(n.badges ?? []).includes('ruled out'))).toBe(true);
    expect(quietMap.label).toBe('The city · 4 locations · 4 still standing');
  });

  it('takes the Detective’s own crossing-off, which only their view carries', () => {
    const det = {
      ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], informants: [],
      locations_ruled_out: [],
      your_locations_ruled_out: [{ location_name: 'Shipyard', reason: 'you have held or discarded this card' }],
    };
    const map = g.plan(input(det, [], { reference: CN_REFERENCE }))!.board.find((z) => z.kind === 'map')!.data as MapData;
    const shipyard = map.nodes.find((n) => n.id === 'cn:loc:shipyard')!;
    expect(shipyard.badges).toContain('ruled out');
    expect(shipyard.describedAs).toContain('you have held or discarded this card');
    // A played one says "played" and not both: one label, the more specific.
    expect(map.nodes.find((n) => n.id === 'cn:loc:xistential-club')!.badges).not.toContain('ruled out');
  });

  it('puts the public discard piles on screen for both seats', () => {
    const spent = { ...CN_VIEW, contacts_discard: ['Blackice', 'The Weapon'] };
    const hacker = g.plan(input(spent, [], { reference: CN_REFERENCE }))!;
    expect((hacker.side.find((z) => z.id === 'cn:contacts-discard')!.data as CardZoneData).label)
      .toBe('Contacts discarded (2)');
    const det = g.plan(input({ ...spent, role: 'detective', hideout: null, location_hand: [], informants: [] }, [], { reference: CN_REFERENCE }))!;
    expect(det.side.find((z) => z.id === 'cn:contacts-discard')).toBeTruthy();
    // And the Detective's own discarded Locations, which they cross off.
    expect((det.side.find((z) => z.id === 'cn:location-discard')!.data as CardZoneData).label)
      .toBe('Locations discarded (1)');
  });

  it('draws the clue rail both seats share: a slot per category, and the ruled out tokens', () => {
    const plan = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const rail = plan.board.find((z) => z.id === 'cn:clues')!;
    expect(rail.span).toBe('row');
    expect((rail.data as TrackData).spaces).toEqual([
      { index: 'Borough', label: 'Downtown', filled: true },
      { index: 'Population', label: undefined, filled: false },
      { index: 'Affiliation', label: undefined, filled: false },
    ]);
    expect((rail.data as TrackData).spaceShape).toBe('token');
    // A ruled-out token is a category and a printed value, not "NOT ×4": a
    // fare token with the value inside, the category over it and a NOT sash.
    // An affiliation NOT wears its faction's line colour.
    const nots = plan.board.find((z) => z.id === 'cn:not-clues')!;
    expect((nots.data as PoolData).label).toBe('Ruled out (2)');
    expect((nots.data as PoolData).itemShape).toBe('token');
    expect((nots.data as PoolData).items).toEqual([
      { label: '0', caption: 'Population', sash: 'NOT', count: 1, colorKey: 'not' },
      { label: 'Iceden Collective', caption: 'Affiliation', sash: 'NOT', count: 1, colorKey: 'gang_1' },
    ]);
    // Both seats see the same rail: it is public.
    const det = g.plan(input({ ...CN_VIEW, role: 'detective', hideout: null, location_hand: [] }, [], { reference: CN_REFERENCE }))!;
    expect(det.board.find((z) => z.id === 'cn:clues')!.data).toEqual(rail.data);
  });

  it('draws an empty rail before any clue is given, and says so', () => {
    const fresh = { ...CN_VIEW, truthful_clues: {}, truthful_values: {}, negative_clues: [] };
    const plan = g.plan(input(fresh, [], { reference: CN_REFERENCE }))!;
    expect((plan.board.find((z) => z.id === 'cn:clues')!.data as TrackData).spaces.every((sp) => !sp.filled)).toBe(true);
    const nots = plan.board.find((z) => z.id === 'cn:not-clues')!.data as PoolData;
    expect(nots.label).toBe('Ruled out — nothing yet');
    expect(nots.items).toEqual([]);
  });

  it('offers the turn as verbs, only where the engine lists a move behind one', () => {
    const moves = [
      { move_id: 'pl1', description: 'Play Shipyard (mandatory)', move: { type: 'play_location', location_name: 'Shipyard' } },
      { move_id: 'pl2', description: 'Play The Junction (mandatory)', move: { type: 'play_location', location_name: 'The Junction' } },
      { move_id: 'a1', description: 'Arrest Blackice at The Junction', move: { type: 'arrest', target_person: 'Blackice' } },
      { move_id: 'burn', description: 'Burn the Safehouse (3 AP, once per game): relocate to a new secret hideout — discarded Locations return to the deck and ALL Clue tokens (truthful and Negative) are removed from the table', move: { type: 'burn_safehouse' } },
      { move_id: 'end', description: 'End turn', move: { type: 'pass_turn' } },
    ];
    const det = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], informants: [] };
    const prompt = g.plan(input(det, moves, { reference: CN_REFERENCE }))!.prompt!;
    expect(prompt.actions.map((a) => a.label)).toEqual(['Play a Location', 'Arrest', 'Burn the safehouse', 'End turn']);
    // A verb several moves stand behind says how many and carries them all;
    // one move behind it carries the engine's own sentence.
    const play = prompt.actions[0] as { note?: string; title?: string; moves: LegalMove[] };
    expect(play.note).toBe('2 to choose from');
    expect(play.moves).toHaveLength(2);
    const arrest = prompt.actions[1] as { note?: string; title?: string; moves: LegalMove[] };
    expect(arrest.note).toBeUndefined();
    expect(arrest.title).toBe('Arrest Blackice at The Junction');
    // The burn paragraph is the button's title, never its label.
    const burn = prompt.actions[2] as { label: string; title?: string };
    expect(burn.label).toBe('Burn the safehouse');
    expect(burn.title!.length).toBeGreaterThan(100);
    // No verb the engine did not list.
    expect(prompt.actions.some((a) => a.label === 'Recruit an informant')).toBe(false);
    // Nothing is offered when the engine lists nothing.
    expect(g.plan(input(det, [], { reference: CN_REFERENCE }))!.prompt).toBeUndefined();
    // But a move no verb claims still gets one, in the engine's own word for
    // it: the bar was empty at exactly the moment the engine was waiting.
    const followUp = [{
      move_id: 'bd', description: 'Discard a Location from the board: Shipyard',
      move: { type: 'board_discard_choice', target_location: 'Shipyard' },
    }];
    const asked = g.plan(input(det, followUp, { reference: CN_REFERENCE }))!.prompt!;
    expect(asked.actions.map((a) => [a.label, a.title])).toEqual([
      ['Board Discard', 'Discard a Location from the board: Shipyard'],
    ]);
  });

  it('draws who the Detective can reach, and what a tap on a person could mean', () => {
    const det = {
      ...CN_VIEW, role: 'detective', hideout: null, location_hand: [],
      board: ['The Junction'],
      informants: [{ person: 'Anansi the Spider', revealed: false }],
      jail: { slot_1_booked: [], slot_2_processing: [], slot_3_release_pending_then_freed: [] },
    };
    const moves = [
      { move_id: 'a', description: 'Arrest Blackice at The Junction', move: { type: 'arrest', target_person: 'Blackice' } },
      { move_id: 'r', description: 'Recruit Blackice as informant', move: { type: 'recruit_informant', target_person: 'Blackice' } },
    ];
    const inp = input(det, moves, { reference: CN_REFERENCE });
    const reach = g.plan(inp)!.side.find((z) => z.id === 'cn:reach')!;
    // Everyone living at a played Location, with the ones already spoken for
    // drawn unlit and saying where they are.
    expect(cards(reach).map((c) => [c.label, c.subtitle, c.colorKey])).toEqual([
      ['Blackice', 'Discard one Location the Detective has already played from the board.', 'gang_1'],
      ['Anansi the Spider', 'your informant', 'out_of_reach'],
    ]);
    // Not the Contact's play cost: that is the Hacker's price, not theirs.
    expect(cards(reach).every((c) => c.cost === undefined)).toBe(true);
    // Every arrest and recruit the engine lists has something on screen to tap.
    expect(g.litParts(inp)).toContain('cn:person:blackice');
    // Both prices on one person: the tap asks which, in the engine's words.
    const options = movesForSelect(g, { component: 'card', id: 'cn:person:blackice', label: 'Blackice' }, inp);
    expect(options.map((m) => m.description)).toEqual(['Arrest Blackice at The Junction', 'Recruit Blackice as informant']);
    // A person nobody can reach lights nothing.
    expect(g.litParts(inp)).not.toContain('cn:person:anansi-the-spider');
  });

  it('lights a card in hand wherever it can be played, for either seat', () => {
    // The Detective's Locations: the card in hand lights, not only the region.
    const det = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: ['Shipyard', 'The Junction'], informants: [] };
    const play = { move_id: 'pl', description: 'Play Shipyard', move: { type: 'play_location', location_name: 'Shipyard' } };
    const detIn = input(det, [play], { reference: CN_REFERENCE });
    const lit = g.litParts(detIn);
    expect(lit).toContain('cn:hand:0:Shipyard');
    expect(lit).toContain('cn:loc:shipyard');
    expect(lit).not.toContain('cn:hand:1:The Junction');
    // And tapping the card in hand means that move.
    expect(movesForSelect(g, { component: 'card', id: 'cn:hand:0:Shipyard', label: 'Shipyard' }, detIn).map((m) => m.move_id))
      .toEqual(['pl']);

    // The Hacker's Contacts, the same way.
    const hakIn = input(CN_VIEW, [
      { move_id: 'pp', description: 'Play Blackice (2 AP)', move: { type: 'play_person', person_name: 'Blackice' } },
    ], { reference: CN_REFERENCE });
    expect(g.litParts(hakIn)).toContain('cn:hand:0:Blackice');
    expect(movesForSelect(g, { component: 'card', id: 'cn:hand:0:Blackice', label: 'Blackice' }, hakIn).map((m) => m.move_id))
      .toEqual(['pp']);
  });

  it('names who is in each jail slot, rather than drawing them as dots', () => {
    const held = {
      ...CN_VIEW,
      jail: {
        slot_1_booked: ['Blackice'],
        slot_2_processing: [],
        slot_3_release_pending_then_freed: ['Anansi the Spider', 'Eddie the Doorman'],
      },
    };
    const jail = g.plan(input(held, [], { reference: CN_REFERENCE }))!.side.find((z) => z.id === 'cn:jail')!;
    const d = jail.data as TrackData;
    expect(d.label).toBe('Jail · 3 held');
    expect(d.pieceShape).toBe('named');
    expect(d.arrows).toBe(true);
    expect(d.spaces[0]!.pieces![0]!.artUrl).toBe('/art/cybernoir/blackice.jpg');
    expect(d.spaces.map((sp) => [sp.index, sp.filled, (sp.pieces ?? []).map((p) => [p.label, p.colorKey])])).toEqual([
      ['Booked', true, [['Blackice', 'gang_1']]],
      ['Processing', false, []],
      ['Release pending', true, [['Anansi the Spider', 'gang_2'], ['Eddie the Doorman', 'none']]],
    ]);
    // An empty jail says so rather than showing three bare slots.
    const none = { ...CN_VIEW, jail: { slot_1_booked: [], slot_2_processing: [], slot_3_release_pending_then_freed: [] } };
    const empty = g.plan(input(none, [], { reference: CN_REFERENCE }))!.side.find((z) => z.id === 'cn:jail')!;
    expect((empty.data as TrackData).label).toBe('Jail · nobody held');
  });

  it("puts the engine's price beside the decision, and never works one out", () => {
    const det = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], informants: [] };
    const moves = [
      { move_id: 'a1', description: 'Arrest Blackice at The Junction', cost: '1 AP', move: { type: 'arrest', target_person: 'Blackice' } },
      { move_id: 'a2', description: 'Arrest Anansi the Spider at The Junction', cost: '1 AP', move: { type: 'arrest', target_person: 'Anansi the Spider' } },
      { move_id: 'b', description: 'Burn the Safehouse: a very long sentence indeed', cost: '3 AP, once per game', move: { type: 'burn_safehouse' } },
      { move_id: 'e', description: 'End turn', cost: 'free; unspent AP is lost', move: { type: 'pass_turn' } },
    ];
    const inp = input(det, moves, { reference: CN_REFERENCE });
    const actions = g.plan(inp)!.prompt!.actions;
    // Several moves behind one verb that share a price still show the price.
    expect(actions.map((a) => [a.label, a.note])).toEqual([
      ['Arrest', '1 AP'],
      ['Burn the safehouse', '3 AP, once per game'],
      ['End turn', 'free; unspent AP is lost'],
    ]);
    // And a confirmation leads with what it costs, then the engine's sentence.
    expect(g.formFor!(moves[2]!, inp)!.help)
      .toBe('3 AP, once per game — Burn the Safehouse: a very long sentence indeed');
    // Without a price from the engine, nothing is invented.
    const unpriced = [{ move_id: 'x', description: 'End turn', move: { type: 'pass_turn' } }];
    expect(g.plan(input(det, unpriced, { reference: CN_REFERENCE }))!.prompt!.actions[0]!.note).toBeUndefined();
  });

  it('shows what an upkeep answer costs, in the engine’s own words', () => {
    const det = {
      ...CN_VIEW, role: 'detective', hideout: null, location_hand: [],
      informants: [{ person: 'Blackice', revealed: false }, { person: 'Anansi the Spider', revealed: true }],
    };
    const listed = [
      { move_id: 'u0', description: 'Release all informants (Blackice, Anansi the Spider)', cost: '1 AP for each informant you keep', move: { type: 'upkeep_choice', keep: [], release: ['Blackice', 'Anansi the Spider'] } },
      { move_id: 'u1', description: 'Keep Blackice (1 AP); release Anansi the Spider', cost: '1 AP for each informant you keep', move: { type: 'upkeep_choice', keep: ['Blackice'], release: ['Anansi the Spider'] } },
    ];
    const form = g.formFor!(listed[1]!, input(det, listed, { reference: CN_REFERENCE }))!;
    // Nothing to total yet while an answer is missing.
    expect(form.summarize!({})).toBeNull();
    expect(form.summarize!({ 'inf.Blackice': 'keep', 'inf.Anansi the Spider': 'release' }))
      .toBe('Keep Blackice (1 AP); release Anansi the Spider · 1 AP for each informant you keep');
  });

  it('asks who, then which clue, instead of listing every combination', () => {
    const jail = ['Blackice', 'Anansi the Spider'].flatMap((who) =>
      ['borough_downtown', 'population_0', 'affiliation_gang_1'].map((tok) => ({
        move_id: `jb_${who}_${tok}`,
        description: `Jailbreak: free ${who} (give Negative Clue: ${tok})`,
        cost: 'free, and gives the Detective a NOT clue',
        move: { type: 'jailbreak', freed_person: who, negative_clue_token: tok },
      })));
    const inp = input(CN_VIEW, jail, { reference: CN_REFERENCE });
    const form = g.formFor!(jail[0]!, inp)!;
    expect(form.title).toBe('Free someone from jail');

    // Two questions, not six rows. The first offers each person once.
    const opening = form.fieldsFor!({});
    expect(opening.map((f) => f.label)).toEqual(['Who do you free?', 'Which clue do you give?']);
    expect((opening[0] as { options: Array<{ label: string }> }).options.map((o) => o.label))
      .toEqual(['Blackice', 'Anansi the Spider']);

    // The clues are printed, never the raw token ids.
    const clues = (opening[1] as { options: Array<{ label: string }> }).options.map((o) => o.label);
    expect(clues).toEqual(['Borough — not Downtown', 'Population — not 0', 'Affiliation — not Iceden Collective']);
    expect(JSON.stringify(clues)).not.toContain('_');

    // Nothing is preselected, and a half-answered form sends nothing.
    expect(form.build({})).toBeNull();
    expect(form.build({ freed_person: 'Blackice' })).toBeNull();
    // What the answers add up to is visible while answering.
    expect(form.summarize!({ freed_person: 'Blackice' })).toBe('Who do you free?: Blackice');
    // And what goes out is the one move the engine listed for those answers.
    expect(form.build({ freed_person: 'Blackice', negative_clue_token: 'population_0' }))
      .toEqual({ type: 'jailbreak', freed_person: 'Blackice', negative_clue_token: 'population_0' });
  });

  it('chooses a set as a set, and says how many are still to pick', () => {
    const ev = [
      { move_id: 'w1', description: 'Play complete Witness evidence: Eddie the Doorman + Blackice + Anansi the Spider', cost: 'free', move: { type: 'play_evidence', evidence_type: 'witness', people: ['Eddie the Doorman', 'Blackice', 'Anansi the Spider'] } },
      { move_id: 'w2', description: 'Play complete Witness evidence: Eddie the Doorman + Blackice + Sleet', cost: 'free', move: { type: 'play_evidence', evidence_type: 'witness', people: ['Eddie the Doorman', 'Blackice', 'Sleet'] } },
    ];
    const form = g.formFor!(ev[0]!, input(CN_VIEW, ev, { reference: CN_REFERENCE }))!;
    expect(form.title).toBe('Play Evidence');
    const field = form.fields[0] as { kind: string; pick: number; options: Array<{ value: string }> };
    expect(field.kind).toBe('multi');
    expect(field.pick).toBe(3);
    expect(field.options.map((o) => o.value)).toEqual(['Eddie the Doorman', 'Blackice', 'Anansi the Spider', 'Sleet']);
    // Part way through it says what is left to do.
    expect(form.summarize!({ people: ['Blackice'] })).toBe('Blackice — 2 more to choose');
    expect(form.build({ people: ['Blackice'] })).toBeNull();
    // A trio the engine did not list cannot be sent.
    expect(form.build({ people: ['Blackice', 'Sleet', 'Anansi the Spider'] })).toBeNull();
    // A trio it did list goes out as the engine wrote it, order and all.
    expect(form.build({ people: ['Sleet', 'Blackice', 'Eddie the Doorman'] })).toEqual(ev[1]!.move);
  });

  it('asks twice before spending what you only get to spend once', () => {
    const det = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], informants: [] };
    const guess = {
      move_id: 'g', description: "Guess Shipyard as Hacker's hideout (4 AP)",
      cost: '4 AP, once per game',
      move: { type: 'guess_location', location_name: 'Shipyard' },
    };
    const inp = input(det, [guess], { reference: CN_REFERENCE });
    // A tap on the map means the guess now, and it does not go out on the tap.
    expect(movesForSelect(g, { component: 'map', id: 'cn:loc:shipyard', label: '' }, inp).map((m) => m.move_id)).toEqual(['g']);
    const sheet = g.formFor!(guess, inp)!;
    expect(sheet.title).toBe('Guess the hideout?');
    // What it costs comes from the engine's own sentence, not from here — and
    // the place's own facts come with it, because once a guess is on offer
    // every location has a move behind it and this is the only look left.
    expect(sheet.help).toContain("Guess Shipyard as Hacker's hideout (4 AP)");
    expect(sheet.help).toContain('4 AP, once per game');
    expect(sheet.help).toContain('Shipyard: Borough: Boonies');
    expect(sheet.fields).toEqual([]);
    expect(sheet.submitLabel).toBe('Guess it');
    expect(sheet.build({})).toEqual(guess.move);
    // And what it sends is the move the engine listed, unchanged.
    expect(isSubmissionAllowed('form', sheet.build({})!, [guess], {
      template: sheet.template.move, editableKeys: sheet.editableKeys,
    })).toBe(true);

    // Playing a Location is an ordinary turn action and still goes on the tap.
    const play = { move_id: 'p', description: 'Play Shipyard', move: { type: 'play_location', location_name: 'Shipyard' } };
    expect(g.formFor!(play, input(det, [play], { reference: CN_REFERENCE }))).toBeNull();
  });

  it('asks what happens to each informant at upkeep, with nothing preselected', () => {
    const det = {
      ...CN_VIEW, role: 'detective', hideout: null, location_hand: [],
      informants: [{ person: 'Blackice', revealed: false }, { person: 'Anansi the Spider', revealed: true }],
    };
    // The engine lists every combination; the form finds the one the answers make.
    const listed = [
      { move_id: 'u0', description: 'Release all informants (Blackice, Anansi the Spider)', move: { type: 'upkeep_choice', keep: [], release: ['Blackice', 'Anansi the Spider'] } },
      { move_id: 'u1', description: 'Keep Blackice (1 AP); release Anansi the Spider', move: { type: 'upkeep_choice', keep: ['Blackice'], release: ['Anansi the Spider'] } },
      { move_id: 'u3', description: 'Keep all informants (2 AP)', move: { type: 'upkeep_choice', keep: ['Blackice', 'Anansi the Spider'], release: [] } },
    ];
    const inp = input(det, listed, { reference: CN_REFERENCE });
    const form = g.formFor!(listed[1]!, inp)!;
    expect(form.title).toBe('Pay upkeep');
    expect(form.fields.map((f) => f.label)).toEqual(['Blackice', 'Anansi the Spider']);
    // Nothing is preselected, and a half-answered form sends nothing.
    expect(form.build({})).toBeNull();
    expect(form.build({ 'inf.Blackice': 'keep' })).toBeNull();
    // What it sends is a move the engine listed, not one assembled here.
    expect(form.build({ 'inf.Blackice': 'keep', 'inf.Anansi the Spider': 'release' }))
      .toEqual({ type: 'upkeep_choice', keep: ['Blackice'], release: ['Anansi the Spider'] });
    expect(form.build({ 'inf.Blackice': 'keep', 'inf.Anansi the Spider': 'keep' }))
      .toEqual({ type: 'upkeep_choice', keep: ['Blackice', 'Anansi the Spider'], release: [] });
    // And the verb bar offers it as one press rather than sixteen sentences.
    expect(g.plan(inp)!.prompt!.actions.map((a) => a.label)).toEqual(['Pay upkeep']);
  });

  it('stops the turn for a block, states both doors, and preselects neither', () => {
    const pending = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: [], pending: 'block_pending' };
    const moves = [
      { move_id: 'yes', description: 'Block Frostbyte by revealing informant', move: { type: 'block_decide', block: true } },
      { move_id: 'no', description: 'Decline to block — let the play proceed', move: { type: 'block_decide', block: false } },
    ];
    const prompt = g.plan(input(pending, moves, { reference: CN_REFERENCE }))!.prompt!;
    expect(prompt.title).toBe('Block this play?');
    expect(prompt.urgent).toBe(true);
    expect(prompt.actions.map((a) => [a.label, a.title])).toEqual([
      ['Block it', 'Block Frostbyte by revealing informant'],
      ['Let it through', 'Decline to block — let the play proceed'],
    ]);
    // The turn's own verbs wait: one question at a time.
    expect(prompt.actions.some((a) => a.label === 'End turn')).toBe(false);
  });

  it('asks the Hacker which clue the block bought, category by category', () => {
    const pending = { ...CN_VIEW, pending: 'clue_reveal_pending' };
    const moves = [
      { move_id: 'b', description: 'Reveal your hideout borough', move: { type: 'clue_reveal', category: 'borough', value: 'boonies' } },
      { move_id: 'p', description: 'Reveal your hideout population', move: { type: 'clue_reveal', category: 'population', value: 2 } },
    ];
    const prompt = g.plan(input(pending, moves, { reference: CN_REFERENCE }))!.prompt!;
    expect(prompt.title).toBe('Which clue do you give?');
    expect(prompt.urgent).toBe(true);
    expect(prompt.actions.map((a) => a.label)).toEqual(['Borough', 'Population']);
  });

  it('folds a big hand by what its cards stack with, and names the stacks', () => {
    const big = { ...CN_VIEW, hand: Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? 'Blackice' : 'Anansi the Spider')) };
    const zone = g.plan(input(big, [], { reference: CN_REFERENCE }))!.bench.find((z) => z.id === 'cn:hand')!;
    const d = zone.data as CardZoneData;
    expect(d.cards!.every((c) => !!c.groupKey)).toBe(true);
    expect(d.groupNames!['gang_1']).toBe('Iceden Collective');
    expect(d.groupNames!['gang_2']).toBe('Crimson Clan');
    // The Detective's Locations stack by borough instead.
    const det = { ...CN_VIEW, role: 'detective', hideout: null, location_hand: ['The Junction', 'Shipyard'] };
    const locZone = g.plan(input(det, [], { reference: CN_REFERENCE }))!.bench.find((z) => z.id === 'cn:hand')!;
    expect((locZone.data as CardZoneData).cards!.map((c) => c.groupKey)).toEqual(['boonies', 'boonies']);
    expect((locZone.data as CardZoneData).groupNames!['boonies']).toBe('Boonies');
  });

  it('lights locations named by play_location moves and informants by ordinal', () => {
    const moves = [
      { move_id: 'pl', description: 'Play Dark City Central Station', move: { type: 'play_location', location_name: 'Dark City Central Station' } },
      { move_id: 'ri', description: 'Reveal the first informant', move: { type: 'reveal_informant', target_informant: 'first' } },
    ];
    const inp = input(CN_VIEW, moves, { reference: CN_REFERENCE });
    expect(g.litParts(inp)).toEqual(['cn:loc:dark-city-central-station', 'cn:informant:first']);
    expect(g.moveForSelect({ component: 'map', id: 'cn:loc:dark-city-central-station', label: '' }, inp)?.move_id).toBe('pl');
  });

  it('lets the Hacker pick the hideout at setup: the whole city is lit and a tap names it back before it is sent', () => {
    const memory = new Map<string, unknown>();
    const inp = input(CN_SETUP_VIEW, [CN_HIDEOUT_MOVE], { reference: CN_REFERENCE, memory });
    expect(g.plan(inp)!.prompt!.title).toBe('Choose your hideout');
    expect(g.litParts(inp)).toEqual([
      'cn:loc:dark-city-central-station', 'cn:loc:xistential-club', 'cn:loc:shipyard', 'cn:loc:the-junction',
    ]);
    // The tap sends nothing on its own: it opens the sheet for that location.
    const tap = g.moveForSelect({ component: 'map', id: 'cn:loc:the-junction', label: '' }, inp);
    expect(tap?.move_id).toBe('report_hideout');
    const sheet = g.formFor!(tap!, inp)!;
    expect(sheet.title).toBe('Hide in The Junction?');
    expect(sheet.help).toContain('Boonies · 2 residents · Iceden Collective');
    expect(sheet.help).toContain('Blackice, Anansi the Spider live here');
    expect(sheet.fields).toEqual([]);
    expect(sheet.build({})).toEqual({ type: 'report_hideout', location_name: 'The Junction' });
    expect(sheet.editableKeys).toEqual(['location_name']);
    // And the door lets the finished move through, as a form the person sent.
    expect(isSubmissionAllowed('form', sheet.build({})!, [CN_HIDEOUT_MOVE], {
      template: sheet.template.move, editableKeys: sheet.editableKeys,
    })).toBe(true);
  });

  it('asks the whole city when the Hacker reaches the hideout through the move menu instead of the map', () => {
    const inp = input(CN_SETUP_VIEW, [CN_HIDEOUT_MOVE], { reference: CN_REFERENCE });
    const sheet = g.formFor!(CN_HIDEOUT_MOVE, inp)!;
    expect(sheet.title).toBe('Choose your hideout');
    expect(sheet.fields.map((f) => f.key)).toEqual(['location_name']);
    const options = (sheet.fields[0] as { options: Array<{ value: string; hint?: string }> }).options;
    expect(options.map((o) => o.value)).toHaveLength(4);
    expect(options.find((o) => o.value === 'Shipyard')!.hint).toBe('Boonies · 0 residents · OmniSuperUltra Corp');
    // Nothing is preselected, and a location the engine never named is refused.
    expect(sheet.build({})).toBeNull();
    expect(sheet.build({ location_name: 'Nowhere' })).toBeNull();
    expect(sheet.build({ location_name: 'Shipyard' })).toEqual({ type: 'report_hideout', location_name: 'Shipyard' });
  });

  it('reads a tap once, so a later press with no fresh tap asks the whole question again', () => {
    const memory = new Map<string, unknown>();
    const inp = input(CN_SETUP_VIEW, [CN_HIDEOUT_MOVE], { reference: CN_REFERENCE, memory });
    g.moveForSelect({ component: 'map', id: 'cn:loc:shipyard', label: '' }, inp);
    expect(g.formFor!(CN_HIDEOUT_MOVE, inp)!.title).toBe('Hide in Shipyard?');
    expect(g.formFor!(CN_HIDEOUT_MOVE, inp)!.title).toBe('Choose your hideout');
  });

  it('tells the Detective to wait while the Hacker hides, and lights nothing', () => {
    const waiting = { ...CN_SETUP_VIEW, role: 'detective', location_hand: [] };
    const inp = input(waiting, [], { reference: CN_REFERENCE });
    expect(g.plan(inp)!.prompt).toEqual({
      title: 'The Hacker is choosing a hideout', sub: 'The city opens once they have hidden.', actions: [],
    });
    expect(g.litParts(inp)).toEqual([]);
  });

  it("names the Hacker's own safehouse on the map and in their panel, and marks nothing when the view will not name it", () => {
    const named = g.plan(input(CN_VIEW, [], { reference: CN_REFERENCE }))!;
    const namedMap = named.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(namedMap.nodes.filter((n) => n.mark === 'frame').map((n) => n.id)).toEqual(['cn:loc:the-junction']);
    const panel = (z: TablePlan) => (z.side.find((b) => b.id === 'cn:hacker')!.data as TableauData).stats!;
    expect(panel(named).find((st) => st.label === 'Safehouse')!.value).toBe('The Junction');

    // A view that gives only the three printed facts marks no node: two
    // locations share them, so a mark would be a guess.
    const factsOnly = { ...CN_VIEW, hideout: { location_name: null, borough: 'boonies', population: 2, affiliation: 'gang_1' } };
    const quiet = g.plan(input(factsOnly, [], { reference: CN_REFERENCE }))!;
    const quietMap = quiet.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(quietMap.nodes.some((n) => n.mark === 'frame')).toBe(false);
    expect(panel(quiet).find((st) => st.label === 'Safehouse')!.value).toBe('Boonies · Iceden Collective');

    // The Detective's view carries no hideout at all: no mark, no stat.
    const det = g.plan(input({ ...CN_VIEW, role: 'detective', hideout: null, location_hand: [] }, [], { reference: CN_REFERENCE }))!;
    const detMap = det.board.find((z) => z.kind === 'map')!.data as MapData;
    expect(detMap.nodes.some((n) => n.mark === 'frame')).toBe(false);
    expect((det.side.find((z) => z.id === 'cn:hacker')!.data as TableauData).stats!.some((st) => st.label === 'Safehouse')).toBe(false);
  });

  it("leaves an AI Hacker's nameless hideout move alone — that one the engine picks secretly", () => {
    const nameless = { move_id: 'report_hideout', description: 'AI Hacker chooses its hideout secretly', move: { type: 'report_hideout' } };
    const inp = input(CN_SETUP_VIEW, [nameless], { reference: CN_REFERENCE });
    expect(g.formFor!(nameless, inp)).toBeNull();
    expect(g.litParts(inp)).toEqual([]);
    expect(g.plan(inp)!.prompt!.title).toBe('The Hacker is choosing a hideout');
  });
});


describe('cybernoir-2127 setup', () => {
  const g = cybernoirGlue;
  const ref: GameReferenceResponse = {
    gameId: 'cybernoir-2127', rules: '', moveSchema: {}, referenceData: {},
    optionsSchema: { type: 'object', properties: {
      detective: { type: 'string', description: 'player_id of the Detective' },
      overclock_draw_timing: { enum: ['immediate', 'next_turn', 'optional'], description: 'When Overclock grants the draws.' },
    } },
  };
  const seats = [{ position: 0, kind: 'human' as const, host: true }, { position: 1, kind: 'ai' as const, host: false }];
  it("asks which role the host plays and turns it into the engine's detective option, beside the rules choice", () => {
    const fields = g.setupFields(ref, seats);
    expect(fields.map((f) => f.key)).toEqual(['role', 'overclock_draw_timing']);
    expect(g.setupOptions!({ role: 'hacker', overclock_draw_timing: 'optional' }, seats)).toEqual({ detective: 'p2', overclock_draw_timing: 'optional' });
    expect(g.setupOptions!({ role: 'detective', overclock_draw_timing: 'immediate' }, seats)).toEqual({ detective: 'p1', overclock_draw_timing: 'immediate' });
    // Unanswered: the engine's own default stands rather than a guess.
    expect(g.setupOptions!({}, seats)).toEqual({});
    // Without the option in the schema, no role field.
    expect(g.setupFields({ ...ref, optionsSchema: { type: 'object', properties: {} } }, seats)).toEqual([]);
  });
});

