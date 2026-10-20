import { describe, expect, it } from 'vitest';
import { cybernoir2127 } from '../index.js';
import { createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { LOCATIONS } from '../data/index.js';
import { candidateLocations } from '../ai.js';
import type { PlayerConfig } from '@zekel/game-kit';

type RecruitMove = { type: 'recruit_informant'; target_person?: string };
type UpkeepMove = { type: 'upkeep_choice'; keep: string[]; release: string[] };

const PHYS_HAK: PlayerConfig = { player_id: 'hak', kind: 'human', name: 'H', table: 'physical' };
const DIG_HAK:  PlayerConfig = { player_id: 'hak', kind: 'human', name: 'H', table: 'digital' };
const PHYS_DET: PlayerConfig = { player_id: 'det', kind: 'human', name: 'D' };
const DIG_DET:  PlayerConfig = { player_id: 'det', kind: 'human', name: 'D', table: 'digital' };
const AI_HAK:   PlayerConfig = { player_id: 'hak', kind: 'ai' };
const AI_DET:   PlayerConfig = { player_id: 'det', kind: 'ai' };

describe('cybernoir digital mode (docs/digital-mode.md)', () => {
  it('kind swap: digital human Detective becomes tracked', () => {
    const s = cybernoir2127.createSession([DIG_DET, AI_HAK]);
    expect(s.gameState.players.det!.kind).toBe('tracked');
    expect(s.gameState.players.hak!.kind).toBe('tracked');
  });

  it('digital human Detective gets deck dealt once report_hideout lands', () => {
    let s = cybernoir2127.createSession([DIG_DET, PHYS_HAK]);
    // Physical human Hacker names their hideout
    const any = cybernoir2127.getLegalMoves(s, 'hak')[0]!;
    expect(any.move.type).toBe('report_hideout');
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'The Junction' }).newState;
    // Detective tracked: server dealt 3 opening + 1 turn-1 draw = 4 cards visible in the engine
    expect(s.gameState.detective.location_hand.length).toBe(4);
    // Views return the actual hand list, not the "physical" placeholder
    const view = cybernoir2127.getPlayerView(s, 'det') as { location_hand: unknown };
    expect(Array.isArray(view.location_hand)).toBe(true);
    expect((view.location_hand as unknown[]).length).toBe(4);
  });

  it('a physical Detective seat still gets the "physical" placeholder view', () => {
    let s = cybernoir2127.createSession([PHYS_DET, PHYS_HAK]);
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'The Junction' }).newState;
    const view = cybernoir2127.getPlayerView(s, 'det') as { location_hand: unknown };
    expect(typeof view.location_hand).toBe('string');
    expect(String(view.location_hand)).toMatch(/physical/i);
  });

  it('burn safehouse vs a tracked (digital or AI) Detective never arms burn_hand_report_pending', () => {
    // AI Hacker vs digital human Detective — both tracked, no humans involved.
    let s = cybernoir2127.createSession([DIG_DET, AI_HAK]);
    // all-tracked auto-setup drops straight into play
    expect(s.gameState.phase).toBe('play');
    // Make it the Hacker's turn with AP and let them burn
    s = { ...s, activePlayerId: 'hak', gameState: { ...s.gameState, activePlayerId: 'hak' } };
    s.gameState.players.hak!.ap = 3;
    const next = cybernoir2127.applyMove(s, 'hak', { type: 'burn_safehouse' } as never).newState;
    expect(next.gameState.pending).toBeNull();
  });

  it('burn safehouse vs an opaque Detective still arms the report pending (regression)', () => {
    let s = cybernoir2127.createSession([PHYS_DET, AI_HAK]);
    expect(s.gameState.phase).toBe('setup'); // human present → setup handshake
    // drive setup: AI hacker auto-picks (report_hideout via run_ai_turn equivalent — just apply it)
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout' }).newState;
    expect(s.gameState.phase).toBe('play');
    s = { ...s, activePlayerId: 'hak', gameState: { ...s.gameState, activePlayerId: 'hak' } };
    s.gameState.players.hak!.ap = 3;
    const next = cybernoir2127.applyMove(s, 'hak', { type: 'burn_safehouse' } as never).newState;
    expect(next.gameState.pending?.type).toBe('burn_hand_report_pending');
  });
});

// ---------------------------------------------------------------------------
// Detective informant CHOICE (docs/digital-mode.md "Choices always stay with
// the person"). recruit-informant is choices.ts owner:'player', POST-PORT C05.
// The nameless/ordinal shapes are the §23 Hacker-facing privacy workaround for
// an AI Detective ONLY — they must NOT fire on a human seat just because
// digital mode made it tracked. Pinned split: a HUMAN Detective (physical or
// digital) names their own pick; an AI Detective stays nameless so its
// responses can't leak the facedown identity to the Hacker.
// ---------------------------------------------------------------------------

// Detective-to-act play-phase state: a populated location on the board (so the
// location-gated recruit pool is non-empty) and `informants` informants.
// `detKind` is detective trackedness; `detIsAI` is the DECIDER kind. The bug
// this file exists to pin: trackedness and decider-kind are different axes.
function detActingState(detKind: 'tracked' | 'opaque', detIsAI: boolean, informants = 2) {
  const s = createInitialState(['det', 'hak'], { det: detKind, hak: 'tracked' },
    { detective: 'det', seed: 42 }, 42);
  s.seat_kinds = { det: detIsAI ? 'ai' : 'human', hak: 'ai' };
  s.activePlayerId = 'det';
  s.players['det']!.ap = 4;
  s.detective.location_played_this_turn = true;
  s.detective.upkeep_paid = false;
  const populated = LOCATIONS.find(l => l.residents.length >= Math.max(3, informants + 1))!;
  s.detective.board.push(populated.id);
  // Seed real informants (from the location-gated pool) so upkeep offers fire.
  for (const personId of populated.residents.slice(0, informants)) {
    if (s.detective.poi_deck.includes(personId)) {
      s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== personId);
      s.detective.informants.push({ person_id: personId, revealed: false });
    }
  }
  return s;
}

describe('cybernoir informant choice — decider-kind, not trackedness', () => {
  it('a HUMAN-tracked (digital) Detective is offered named recruit targets', () => {
    const s = detActingState('tracked', false, 0);
    s.detective.upkeep_paid = true;
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'recruit_informant');
    expect(offers.length).toBeGreaterThan(1);
    expect(offers.every(o => {
      const t = (o.move as RecruitMove).target_person;
      return typeof t === 'string' && t !== '';
    })).toBe(true);
  });

  it('an AI-tracked Detective stays nameless (the §23 Hacker-facing privacy pick)', () => {
    const s = detActingState('tracked', true, 0);
    s.detective.upkeep_paid = true;
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'recruit_informant');
    expect(offers).toHaveLength(1);
    expect((offers[0]!.move as RecruitMove).target_person).toBeUndefined();
  });

  it('a HUMAN-tracked (digital) Detective pays upkeep by NAME, not ordinal', () => {
    const s = detActingState('tracked', false, 2);
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'upkeep_choice');
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      const m = o.move as UpkeepMove;
      for (const k of [...m.keep, ...m.release]) expect(/^\d+$/.test(k)).toBe(false);
    }
  });

  it('an AI-tracked Detective still pays upkeep by ORDINAL (no facedown name in its moves)', () => {
    const s = detActingState('tracked', true, 2);
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'upkeep_choice');
    expect(offers.length).toBeGreaterThan(0);
    const hasOrdinal = offers.some(o =>
      [...(o.move as UpkeepMove).keep, ...(o.move as UpkeepMove).release].some(k => /^\d+$/.test(k)));
    expect(hasOrdinal).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The HIDEOUT is the Hacker's choice (choices.ts 'hideout', owner 'player';
// POST-PORT C01). Same bug as the informant rows above, in the other seat:
// digital mode makes a human Hacker tracked, and setup used to auto-complete
// for every tracked pair — so the engine picked the hideout and handed back a
// session already in the play phase. Found from the web client, where a human
// Hacker was never asked.
// ---------------------------------------------------------------------------

describe('cybernoir hideout — the Hacker chooses it, whatever holds the cards', () => {
  for (const [label, seats] of [
    ['digital human Hacker vs AI Detective', [AI_DET, DIG_HAK]],
    ['digital human Hacker vs digital human Detective', [DIG_DET, DIG_HAK]],
    ['physical human Hacker vs digital human Detective', [DIG_DET, PHYS_HAK]],
  ] as Array<[string, PlayerConfig[]]>) {
    it(`${label}: starts in setup with the Hacker to act and no hideout picked`, () => {
      const s = cybernoir2127.createSession(seats, { detective: 'det' });
      expect(s.gameState.phase).toBe('setup');
      expect(s.gameState.activePlayerId).toBe('hak');
      expect(s.gameState.hacker.hideout_location_id).toBeNull();
      expect(s.gameState.hacker.hideout).toBeNull();
      // And the move they are offered asks for a name rather than standing in
      // for them: the AI's nameless shape must not reach a human seat.
      const offers = cybernoir2127.getLegalMoves(s, 'hak');
      expect(offers).toHaveLength(1);
      expect(offers[0]!.move).toEqual({ type: 'report_hideout', location_name: '' });
    });
  }

  it('a digital human Hacker cannot hand the pick back: a blank name is refused', () => {
    const s = cybernoir2127.createSession([AI_DET, DIG_HAK], { detective: 'det' });
    expect(() => cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout' })).toThrow(/Name your hideout/);
    expect(() => cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: '' })).toThrow(/Name your hideout/);
  });

  it('the name they give is the hideout, and setup finishes on it', () => {
    const wanted = LOCATIONS.find(l => l.residents.length === 2)!;
    let s = cybernoir2127.createSession([AI_DET, DIG_HAK], { detective: 'det' });
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: wanted.name }).newState;
    expect(s.gameState.hacker.hideout_location_id).toBe(wanted.id);
    expect(s.gameState.phase).toBe('play');
    expect(s.gameState.activePlayerId).toBe('det');
    // The residents are in their hand and the safehouse card left the deck.
    expect(s.gameState.players.hak!.hand_size).toBe(3);
    expect(s.gameState.detective.location_deck).not.toContain(wanted.id);
    expect(s.gameState.detective.location_hand).not.toContain(wanted.id);
  });

  it('an AI Hacker still picks its own, secretly, with no setup phase to sit in', () => {
    const s = cybernoir2127.createSession([DIG_DET, AI_HAK], { detective: 'det' });
    expect(s.gameState.phase).toBe('play');
    expect(s.gameState.hacker.hideout_location_id).not.toBeNull();
    expect(s.gameState.activePlayerId).toBe('det');
  });

  it('a hand-built state with no seat kinds keeps the old tracked-means-AI read', () => {
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, undefined, 7);
    expect(s.phase).toBe('play');
    expect(getLegalMoves(s, 'hak').filter(m => m.move.type === 'report_hideout')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The Hacker's own view names their hideout (v2.5). Before this, the view gave
// only {borough, population, affiliation}, so the one seat entitled to know
// where they are hiding could not be shown it — the web client printed
// "Safehouse: Downtown · Gang 1" at a person who had just picked The Back
// Alley, and the map could mark nothing.
// ---------------------------------------------------------------------------

describe("cybernoir hideout — the Hacker's own view names it", () => {
  type HideoutView = { location_name: string | null; borough: string; population: number; affiliation: string };

  it('names it for the Hacker, beside the three printed facts', () => {
    const wanted = LOCATIONS.find(l => l.name === 'The Back Alley')!;
    let s = cybernoir2127.createSession([AI_DET, DIG_HAK], { detective: 'det' });
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: wanted.name }).newState;
    const view = cybernoir2127.getPlayerView(s, 'hak') as { hideout: HideoutView };
    expect(view.hideout.location_name).toBe('The Back Alley');
    expect(view.hideout.borough).toBe(wanted.borough);
    expect(view.hideout.population).toBe(wanted.population);
    expect(view.hideout.affiliation).toBe(wanted.affiliation);
  });

  it('tells the twins apart, which the three facts cannot', () => {
    // Trailer Towers and Little Ghana share borough, population and
    // affiliation on purpose; only the card itself separates them.
    const twins = LOCATIONS.filter(l => l.name === 'Trailer Towers' || l.name === 'Little Ghana');
    expect(twins).toHaveLength(2);
    expect(twins[0]!.borough).toBe(twins[1]!.borough);
    expect(twins[0]!.population).toBe(twins[1]!.population);
    expect(twins[0]!.affiliation).toBe(twins[1]!.affiliation);
    for (const t of twins) {
      let s = cybernoir2127.createSession([AI_DET, DIG_HAK], { detective: 'det' });
      s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: t.name }).newState;
      expect((cybernoir2127.getPlayerView(s, 'hak') as { hideout: HideoutView }).hideout.location_name).toBe(t.name);
    }
  });

  it('still tells the Detective nothing, and is null while nobody has hidden', () => {
    let s = cybernoir2127.createSession([DIG_DET, DIG_HAK], { detective: 'det' });
    expect((cybernoir2127.getPlayerView(s, 'hak') as { hideout: unknown }).hideout).toBeNull();
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'Junktown' }).newState;
    const det = cybernoir2127.getPlayerView(s, 'det') as Record<string, unknown>;
    expect(det).not.toHaveProperty('hideout');
    expect(JSON.stringify(det)).not.toContain('Junktown');
    expect(JSON.stringify(cybernoir2127.getPublicView(s))).not.toContain('Junktown');
  });

  it('a session from before the id was stored says null rather than guessing', () => {
    let s = cybernoir2127.createSession([AI_DET, DIG_HAK], { detective: 'det' });
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'Trailer Towers' }).newState;
    s.gameState.hacker.hideout_location_id = null; // the v1.6 shape
    const view = cybernoir2127.getPlayerView(s, 'hak') as { hideout: HideoutView };
    expect(view.hideout.location_name).toBeNull();
    expect(view.hideout.borough).toBe('boonies');
  });
});

// ---------------------------------------------------------------------------
// Burning the safehouse relocates the Hacker, and WHERE TO is their choice —
// at a burn exactly as at setup. Keying the engine-side pick on trackedness
// moved a digital human's safehouse for them: reported from real play, the
// hideout changed from Shizuoka Megamall to Trailer Towers with no chooser.
// ---------------------------------------------------------------------------

describe('cybernoir burn — the new safehouse is the Hacker\'s choice', () => {
  /** A Hacker mid-game with the action points a burn costs. */
  function readyToBurn(seats: PlayerConfig[]) {
    let s = cybernoir2127.createSession(seats, { detective: 'det', seed: 11 });
    if (s.gameState.phase === 'setup') {
      s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'Shizuoka Megamall' }).newState;
    }
    s.gameState.activePlayerId = 'hak';
    s.gameState.players['hak']!.ap = 3;
    return s;
  }

  it('asks a digital human Hacker where to go, instead of moving them', () => {
    const s = readyToBurn([DIG_DET, DIG_HAK]);
    const before = s.gameState.hacker.hideout_location_id;
    const burned = cybernoir2127.applyMove(s, 'hak', { type: 'burn_safehouse' }).newState;
    // Nothing has moved yet: the engine is waiting on the person.
    expect(burned.gameState.pending?.type).toBe('burn_choice_pending');
    expect(burned.gameState.hacker.hideout_location_id).toBe(before);
    // And it offers the eligible locations by name, never the old one.
    const offers = cybernoir2127.getLegalMoves(burned, 'hak');
    expect(offers.length).toBeGreaterThan(1);
    expect(offers.every(o => o.move.type === 'burn_choice')).toBe(true);
    const named = offers.map(o => (o.move as { new_location_name: string }).new_location_name);
    expect(named).not.toContain('Shizuoka Megamall');
    // The person's pick is what lands.
    const wanted = named[0]!;
    const moved = cybernoir2127.applyMove(burned, 'hak', { type: 'burn_choice', new_location_name: wanted }).newState;
    expect(moved.gameState.hacker.hideout_location_id).not.toBe(before);
    expect(moved.gameState.pending).toBeNull();
    expect(moved.gameState.hacker.safehouse_burned).toBe(true);
  });

  it('tells a digital Hacker to choose, not to gather cards they do not hold', () => {
    const s = readyToBurn([DIG_DET, DIG_HAK]);
    const { summary } = cybernoir2127.applyMove(s, 'hak', { type: 'burn_safehouse' });
    expect(summary).toContain('choose your NEW safehouse');
    expect(summary).not.toContain('gather the');
    // A physical Hacker really does gather the pile, and is told to.
    const phys = readyToBurn([DIG_DET, PHYS_HAK]);
    expect(cybernoir2127.applyMove(phys, 'hak', { type: 'burn_safehouse' }).summary).toContain('gather the');
  });

  it('still lets the AI Hacker pick its own secretly, in one move', () => {
    const s = readyToBurn([DIG_DET, AI_HAK]);
    const before = s.gameState.hacker.hideout_location_id;
    const burned = cybernoir2127.applyMove(s, 'hak', { type: 'burn_safehouse' }).newState;
    expect(burned.gameState.pending).toBeNull();
    expect(burned.gameState.hacker.hideout_location_id).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Crossing a Location off is a rule — a played card is out once the safehouse
// card has left the deck, a clue excludes what does not match it, a NOT token
// excludes what does. The engine states it once and publishes the result with
// its reason, so a client can draw it without holding the rule. The
// Detective's own half (cards they have held) must never reach the Hacker.
// ---------------------------------------------------------------------------

describe('cybernoir ruled-out locations', () => {
  type Out = { location_name: string; reason: string };
  function midGame() {
    let s = cybernoir2127.createSession([DIG_DET, DIG_HAK], { detective: 'det', seed: 3 });
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'Shizuoka Megamall' }).newState;
    return s;
  }

  it('says why a played Location is out, once the safehouse card has left the deck', () => {
    const s = midGame();
    expect(s.gameState.hideout_card_removed).toBe(true);
    s.gameState.detective.board.push('the_back_alley');
    const out = (cybernoir2127.getPublicView(s) as { locations_ruled_out: Out[] }).locations_ruled_out;
    const alley = out.find(o => o.location_name === 'The Back Alley')!;
    expect(alley.reason).toBe('the Detective played this card, so it is not the safehouse');
  });

  it('says which clue did it, in printed words', () => {
    const s = midGame();
    s.gameState.hacker.truthful_values = { borough: 'downtown' };
    const out = (cybernoir2127.getPublicView(s) as { locations_ruled_out: Out[] }).locations_ruled_out;
    // Everything outside Downtown is out, and says so.
    const junktown = out.find(o => o.location_name === 'Junktown')!;
    expect(junktown.reason).toBe('the borough clue says Downtown');
    // Nothing inside Downtown is ruled out by that clue.
    expect(out.some(o => o.location_name === 'The Back Alley')).toBe(false);

    s.gameState.hacker.truthful_values = {};
    s.gameState.hacker.negative_clues = ['affiliation_gang_1'];
    const nots = (cybernoir2127.getPublicView(s) as { locations_ruled_out: Out[] }).locations_ruled_out;
    expect(nots.find(o => o.location_name === 'The Back Alley')!.reason)
      .toBe('a NOT token rules out Iceden Collective');
  });

  it('keeps the cards only the Detective has seen out of everyone else\'s view', () => {
    const s = midGame();
    const held = s.gameState.detective.location_hand[0]!;
    const heldName = LOCATIONS.find(l => l.id === held)!.name;

    const det = cybernoir2127.getPlayerView(s, 'det') as { your_locations_ruled_out: Out[] };
    expect(det.your_locations_ruled_out.find(o => o.location_name === heldName)!.reason)
      .toBe('you have held or discarded this card');

    // Not in the public view, and not in the Hacker's.
    const pub = cybernoir2127.getPublicView(s) as { locations_ruled_out: Out[] };
    expect(pub.locations_ruled_out.some(o => o.location_name === heldName)).toBe(false);
    const hak = cybernoir2127.getPlayerView(s, 'hak') as Record<string, unknown>;
    expect(hak).not.toHaveProperty('your_locations_ruled_out');
    expect(JSON.stringify(hak)).not.toContain('you have held');
  });

  it('is the same set the AI reasons from, so the two cannot drift', () => {
    const s = midGame();
    s.gameState.hacker.truthful_values = { borough: 'the_hive' };
    const out = new Set((cybernoir2127.getPublicView(s) as { locations_ruled_out: Out[] })
      .locations_ruled_out.map(o => o.location_name));
    const standing = candidateLocations(s.gameState).map(l => l.name);
    expect(standing.some(n => out.has(n))).toBe(false);
    expect(standing.length + out.size).toBe(LOCATIONS.length);
  });
});
