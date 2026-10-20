import { describe, expect, it } from 'vitest';
import { applyMove, createInitialState, isGameOver } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { cybernoir2127 } from '../index.js';
import type { CNState, CNMove } from '../types.js';
import { PEOPLE, LOCATIONS, getPerson, getLocation, WEAPON_ID, resolvePerson, resolveLocation } from '../data/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTwoAI(seed = 1): CNState {
  return createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, undefined, seed);
}

function setupWithHideout(seed: number, hideoutName: string): CNState {
  // The options.hideout sweep lever keeps everything consistent (residents
  // gathered, safehouse card removed from the Location deck — v1.7).
  return createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: [hideoutName] }, seed);
}

function playLocation(s: CNState, pid: string, locName: string): CNState {
  return applyMove(s, pid, { type: 'play_location', location_name: locName }).newState;
}

function getTrackedHand(s: CNState, pid: string): string[] {
  const p = s.players[pid];
  if (p?.kind !== 'tracked') throw new Error(`${pid} not tracked`);
  return p.hand;
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('creates a 2-player all-AI game in play phase with correct starting state', () => {
    const s = setupTwoAI(42);
    expect(s.phase).toBe('play');
    expect(s.playerOrder).toEqual(['det', 'hak']);
    expect(s.activePlayerId).toBe('det');
    expect(s.turn).toBe(1);
    expect(s.pending).toBeNull();
    expect(s.endgame_triggered).toBe(false);
    expect(s.overclock_draw_timing).toBe('immediate');
    expect(s.overclock_draws_owed).toBe(0);
  });

  it('deals Detective 4 Location cards (3 hand + 1 from start-of-turn draw)', () => {
    const s = setupTwoAI(42);
    // Hand starts at 3, then detectiveStartTurn draws 1 more = 4
    expect(s.detective.location_hand).toHaveLength(4);
    expect(s.detective.location_deck).toHaveLength(14); // 19 (v2.0) - 1 safehouse card - 3 - 1
  });

  it('removes the safehouse card from the Location deck (v1.7)', () => {
    const s = setupTwoAI(42);
    const hideoutLoc = LOCATIONS.find(l =>
      l.borough === s.hacker.hideout!.borough &&
      l.population === s.hacker.hideout!.population &&
      l.affiliation === s.hacker.hideout!.affiliation)!;
    expect(s.detective.location_deck).not.toContain(hideoutLoc.id);
    expect(s.detective.location_hand).not.toContain(hideoutLoc.id);
    expect(s.hideout_card_removed).toBe(true);
    expect(s.detective.location_deck.length + s.detective.location_hand.length).toBe(18); // 19 - safehouse
  });

  it('deals Hacker 3 Contacts and sets hideout', () => {
    const s = setupTwoAI(42);
    expect(s.hacker.hideout).not.toBeNull();
    expect(getTrackedHand(s, 'hak')).toHaveLength(3);
  });

  it('sets Detective AP to 4 and Hacker AP to 0', () => {
    const s = setupTwoAI(42);
    expect(s.players['det']!.ap).toBe(4);
    expect(s.players['hak']!.ap).toBe(0);
  });

  it('initializes POI deck with 25 unshuffled people (v2.0)', () => {
    const s = setupTwoAI(42);
    expect(s.detective.poi_deck).toHaveLength(25);
    expect(s.detective.poi_deck).toEqual(PEOPLE.map(p => p.id));
  });

  it('initializes jail track with 3 empty slots', () => {
    const s = setupTwoAI(42);
    expect(s.detective.jail).toEqual([[], [], []]);
  });

  it('initializes Evidence zone empty', () => {
    const s = setupTwoAI(42);
    expect(s.hacker.evidence.weapon).toBe(false);
    expect(s.hacker.evidence.witnesses).toHaveLength(0);
    expect(s.hacker.evidence.motive_set_1).toHaveLength(0);
    expect(s.hacker.evidence.motive_set_2).toHaveLength(0);
  });

  it('rejects non-2-player setups', () => {
    expect(() => createInitialState(['only'], { only: 'tracked' }, undefined, 1)).toThrow(/exactly 2 players/);
  });

  it('respects overclock_draw_timing option', () => {
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { overclock_draw_timing: 'next_turn' }, 1);
    expect(s.overclock_draw_timing).toBe('next_turn');
  });
});

// ---------------------------------------------------------------------------
// Detective turn: play_location, upkeep, AP actions
// ---------------------------------------------------------------------------

describe('Detective turn', () => {
  it('plays a Location to the board from hand', () => {
    const s = setupTwoAI(42);
    const handLoc = s.detective.location_hand[0]!;
    const loc = getLocation(handLoc)!;
    const s2 = playLocation(s, 'det', loc.name);
    expect(s2.detective.board).toContain(handLoc);
    expect(s2.detective.location_hand).not.toContain(handLoc);
  });

  it('rejects playing a Location not in hand (tracked)', () => {
    const s = setupTwoAI(42);
    const boardLoc = LOCATIONS.find(l => !s.detective.location_hand.includes(l.id))!;
    expect(() => playLocation(s, 'det', boardLoc.name)).toThrow(/not in hand/);
  });

  it('arrests a person at a face-up location (1 AP)', () => {
    const s = setupTwoAI(42);
    // Find a hand location that has residents in the POI deck
    const handLoc = s.detective.location_hand
      .map(id => getLocation(id)!)
      .find(l => l.residents.some(r => s.detective.poi_deck.includes(r)))!;
    const s2 = playLocation(s, 'det', handLoc.name);
    const s2u = applyMove(s2, 'det', { type: 'upkeep_choice', keep: [], release: [] }).newState;
    const resident = handLoc.residents.find(r => s2u.detective.poi_deck.includes(r))!;
    const person = getPerson(resident)!;
    const s3 = applyMove(s2u, 'det', { type: 'arrest', target_person: person.name }).newState;
    expect(s3.detective.jail[0]).toEqual([resident]);
    expect(s3.detective.poi_deck).not.toContain(resident);
    expect(s3.players['det']!.ap).toBe(3); // 4 - 1
  });

  it('rejects arrest of a person not at a face-up location', () => {
    const s = setupTwoAI(42);
    // Find a hand location that has residents
    const handLoc = s.detective.location_hand
      .map(id => getLocation(id)!)
      .find(l => l.residents.length > 0)!;
    const s2 = playLocation(s, 'det', handLoc.name);
    const s2u = applyMove(s2, 'det', { type: 'upkeep_choice', keep: [], release: [] }).newState;
    // Find a person NOT at this location
    const otherPerson = PEOPLE.find(p => !handLoc.residents.includes(p.id))!;
    expect(() => applyMove(s2u, 'det', { type: 'arrest', target_person: otherPerson.name })).toThrow(/not at a face-up location/);
  });

  it('recruits an informant (3 AP, facedown) — only from a face-up location', () => {
    const s = setupTwoAI(42);
    // Play a location WITH residents so the recruit pool is non-empty
    const withResidents = s.detective.location_hand.find(id => (getLocation(id)?.residents.length ?? 0) > 0)
      ?? s.detective.location_hand[0]!;
    const loc = getLocation(withResidents)!;
    const s1 = playLocation(s, 'det', loc.name);
    if (loc.residents.length > 0) {
      const poi = loc.residents.find(id => s1.detective.poi_deck.includes(id))!;
      const person = getPerson(poi)!;
      const s2 = applyMove(s1, 'det', { type: 'recruit_informant', target_person: person.name }).newState;
      expect(s2.detective.informants).toHaveLength(1);
      expect(s2.detective.informants[0]!.revealed).toBe(false);
      expect(s2.detective.poi_deck).not.toContain(poi);
      expect(s2.players['det']!.ap).toBe(1); // 4 - 3
    }
    // v2.3 designer ruling: someone NOT at a face-up location cannot be flipped
    const offBoard = s1.detective.poi_deck.find(id =>
      !s1.detective.board.some(locId => getLocation(locId)?.residents.includes(id)))!;
    expect(() => applyMove(s1, 'det', { type: 'recruit_informant', target_person: getPerson(offBoard)!.name }))
      .toThrow(/face-up location/);
  });

  it('draws an extra Location (4 AP)', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    const deckBefore = s1.detective.location_deck.length;
    const s2 = applyMove(s1, 'det', { type: 'draw_extra_location' }).newState;
    expect(s2.detective.location_hand.length).toBe(s1.detective.location_hand.length + 1);
    expect(s2.detective.location_deck.length).toBe(deckBefore - 1);
    expect(s2.players['det']!.ap).toBe(0);
  });

  it('mid-game guess: wrong guess sets mid_game_guess_spent and continues play', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    const s2 = applyMove(s1, 'det', { type: 'guess_location', location_name: 'Shipyard' }).newState;
    expect(s2.detective.mid_game_guess_spent).toBe(true);
    expect(s2.phase).not.toBe('game_over');
    expect(s2.players['det']!.ap).toBe(0);
  });

  it('mid-game guess: correct guess wins the game for Detective', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    const s2 = applyMove(s1, 'det', { type: 'guess_location', location_name: 'The Back Alley' }).newState;
    expect(s2.phase).toBe('game_over');
    expect(s2.winners).toEqual(['det']);
  });

  it('buy_clue discards 3 from hand and sets clue_reveal_pending (v2.3 cost)', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    expect(s1.detective.location_hand).toHaveLength(3);
    const hand = s1.detective.location_hand.slice(0, 3).map(id => getLocation(id)!.name) as [string, string, string];
    const s2 = applyMove(s1, 'det', { type: 'buy_clue', discard_locations: hand }).newState;
    expect(s2.detective.location_hand).toHaveLength(0);
    expect(s2.pending?.type).toBe('clue_reveal_pending');
    expect(s2.activePlayerId).toBe('hak');
  });

  it('buy_clue with all categories revealed yields no effect', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    // Reveal all 3 categories
    s1.hacker.truthful_clues.borough = true;
    s1.hacker.truthful_clues.population = true;
    s1.hacker.truthful_clues.affiliation = true;
    const hand = s1.detective.location_hand.slice(0, 3).map(id => getLocation(id)!.name) as [string, string, string];
    const s2 = applyMove(s1, 'det', { type: 'buy_clue', discard_locations: hand }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('det');
  });

  it('buy_clue offers C(n,3) combinations, and none below 3 spares (v2.3 cost)', () => {
    const s = setupTwoAI(42);
    // Before mandatory play, buy_clue is not yet offered
    expect(getLegalMoves(s, 'det').filter(m => m.move.type === 'buy_clue')).toHaveLength(0);
    // Play one Location: 3 spares → exactly the 3-card price, C(3,3) = 1 offer
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    expect(getLegalMoves(s1, 'det').filter(m => m.move.type === 'buy_clue')).toHaveLength(1);
    // Top up to 5 spares → C(5,3) = 10 combinations
    s1.detective.location_hand.push(s1.detective.location_deck.shift()!, s1.detective.location_deck.shift()!);
    const buyClueMoves = getLegalMoves(s1, 'det').filter(m => m.move.type === 'buy_clue');
    expect(buyClueMoves).toHaveLength(10);
    // Below 3 spares: none
    s1.detective.location_hand = s1.detective.location_hand.slice(0, 2);
    expect(getLegalMoves(s1, 'det').filter(m => m.move.type === 'buy_clue')).toHaveLength(0);
  });
});

describe('Jail track', () => {
  it('advances jail cards at end of Detective turn', () => {
    const s = setupTwoAI(42);
    // Find a hand location that has residents in the POI deck
    const handLoc = s.detective.location_hand
      .map(id => getLocation(id)!)
      .find(l => l.residents.some(r => s.detective.poi_deck.includes(r)))!;
    const s2 = playLocation(s, 'det', handLoc.name);
    const resident = handLoc.residents.find(r => s2.detective.poi_deck.includes(r))!;
    const person = getPerson(resident)!;
    const s3 = applyMove(s2, 'det', { type: 'arrest', target_person: person.name }).newState;
    // Arrested person is in slot 0. Now pass turn (Detective side).
    const s4 = applyMove(s3, 'det', { type: 'pass_turn' }).newState;
    // After Detective turn ends, jail advances: person moves from slot 0 to slot 1
    expect(s4.detective.jail[0]).toEqual([]);
    expect(s4.detective.jail[1]).toEqual([resident]);
  });

  it('releases a person off slot 3 after enough turns', () => {
    const s = setupTwoAI(42);
    // Find a hand location that has residents in the POI deck
    const handLoc = s.detective.location_hand
      .map(id => getLocation(id)!)
      .find(l => l.residents.some(r => s.detective.poi_deck.includes(r)))!;
    const s2 = playLocation(s, 'det', handLoc.name);
    const resident = handLoc.residents.find(r => s2.detective.poi_deck.includes(r))!;
    const person = getPerson(resident)!;
    const s3 = applyMove(s2, 'det', { type: 'arrest', target_person: person.name }).newState;
    // Arrest → slot 0. After 3 Detective turns, person should be released.
    let s4 = s3;
    for (let i = 0; i < 3; i++) {
      s4 = applyMove(s4, 'det', { type: 'pass_turn' }).newState; // Detective passes
      s4 = applyMove(s4, 'hak', { type: 'pass_turn' }).newState; // Hacker passes
    }
    // After 3 end-of-turn advances: slot 0→1→2→released
    expect(s4.detective.jail[0]).toEqual([]);
    expect(s4.detective.jail[1]).toEqual([]);
    expect(s4.detective.jail[2]).toEqual([]);
    expect(s4.detective.poi_deck).toContain(resident);
  });
});

// ---------------------------------------------------------------------------
// Hacker turn: draw, play_person, play_evidence
// ---------------------------------------------------------------------------

describe('Hacker turn', () => {
  it('draws a Contact (1 AP, reshuffles on empty)', () => {
    const s = setupTwoAI(42);
    // Force Hacker's turn
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const handBefore = getTrackedHand(s, 'hak').length;
    const s2 = applyMove(s, 'hak', { type: 'draw_contact' }).newState;
    expect(getTrackedHand(s2, 'hak').length).toBe(handBefore + 1);
    expect(s2.players['hak']!.ap).toBe(2);
  });

  it('reshuffles the discard into a new deck when only the deck is empty', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const discarded = s.hacker.contacts_deck.slice(0, 5);
    s.hacker.contacts_deck = [];
    s.hacker.contacts_discard = discarded;
    const handBefore = getTrackedHand(s, 'hak').length;
    const s2 = applyMove(s, 'hak', { type: 'draw_contact' }).newState;
    expect(getTrackedHand(s2, 'hak').length).toBe(handBefore + 1);
    expect(s2.hacker.contacts_discard).toHaveLength(0);
    expect(s2.hacker.contacts_deck).toHaveLength(4);
    // No phantom cards — everything drawn is a real id
    expect(getTrackedHand(s2, 'hak').every(id => typeof id === 'string')).toBe(true);
  });

  it('PORT-NOTES §33: draw is unavailable when deck AND discard are both empty', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    s.hacker.contacts_deck = [];
    s.hacker.contacts_discard = [];
    // Not offered
    expect(getLegalMoves(s, 'hak').filter(m => m.move.type === 'draw_contact')).toHaveLength(0);
    // Rejected if forced — no AP charged, no undefined pushed into the hand
    expect(() => applyMove(s, 'hak', { type: 'draw_contact' })).toThrow(/nothing to draw/);
    expect(s.players['hak']!.ap).toBe(3);
    const hand = getTrackedHand(s, 'hak');
    expect(hand.every(id => typeof id === 'string')).toBe(true);
    expect(s.players['hak']!.hand_size).toBe(hand.length);
  });

  it('plays a person for ability (pay cost, resolve, discard)', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const hand = getTrackedHand(s, 'hak');
    const personId = hand[0]!;
    const person = getPerson(personId)!;
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: person.name }).newState;
    expect(s2.players['hak']!.ap).toBe(3 - person.cost);
    // Card should be in discard
    expect(s2.hacker.contacts_discard).toContain(personId);
    expect(getTrackedHand(s2, 'hak')).not.toContain(personId);
  });

  it('rejects playing a jailed person', () => {
    const s = setupTwoAI(42);
    // Put someone in jail first
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    // Add person to hand
    (s.players['hak'] as any).hand = [person.id, ...getTrackedHand(s, 'hak')];
    expect(() => applyMove(s, 'hak', { type: 'play_person', person_name: person.name })).toThrow(/jailed/);
  });

  it('plays Evidence: weapon', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [WEAPON_ID, ...getTrackedHand(s, 'hak').filter(id => id !== WEAPON_ID)];
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', person_name: 'The Weapon', evidence_type: 'weapon' }).newState;
    expect(s2.hacker.evidence.weapon).toBe(true);
    expect(getTrackedHand(s2, 'hak')).not.toContain(WEAPON_ID);
  });

  it('v2.4: plays Evidence: the COMPLETE Witness set of 3 at once', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const trio = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 3);
    (s.players['hak'] as any).hand = [...trio.map(p => p.id), ...getTrackedHand(s, 'hak').filter(id => !trio.some(t => t.id === id))];
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: trio.map(p => p.name) }).newState;
    expect(s2.hacker.evidence.witnesses).toEqual(trio.map(p => p.id));
    for (const t of trio) expect(getTrackedHand(s2, 'hak')).not.toContain(t.id);
  });

  it('v2.4: a single Witness is rejected — witnesses are never banked one at a time', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const witness = PEOPLE.find(p => p.is_witness)!;
    (s.players['hak'] as any).hand = [witness.id, ...getTrackedHand(s, 'hak').filter(id => id !== witness.id)];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', person_name: witness.name, evidence_type: 'witness' }))
      .toThrow(/COMPLETE set/);
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: [witness.name] }))
      .toThrow(/COMPLETE set/);
  });

  it('v2.4: a tracked Hacker is offered witness TRIOS, never a single witness', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const wits = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 4);
    (s.players['hak'] as any).hand = wits.map(p => p.id);
    const offers = getLegalMoves(s, 'hak')
      .filter(m => m.move.type === 'play_evidence' && (m.move as { evidence_type: string }).evidence_type === 'witness');
    // C(4,3) = 4 trios, every offer naming exactly 3 people
    expect(offers).toHaveLength(4);
    for (const o of offers) {
      const mv = o.move as { people?: string[]; person_name?: string };
      expect(mv.people).toHaveLength(3);
      expect(mv.person_name).toBeUndefined();
    }
    // With only 2 witnesses in hand the piece is unplayable — nothing offered.
    (s.players['hak'] as any).hand = wits.slice(0, 2).map(p => p.id);
    expect(getLegalMoves(s, 'hak')
      .filter(m => m.move.type === 'play_evidence' && (m.move as { evidence_type: string }).evidence_type === 'witness')).toHaveLength(0);
  });

  it('v2.4: the Witness set rejects non-witnesses, duplicates, and a second set', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const trio = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 3);
    const nonWitness = PEOPLE.find(p => !p.is_witness)!;
    (s.players['hak'] as any).hand = [...trio.map(p => p.id), nonWitness.id];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: [trio[0]!.name, trio[1]!.name, nonWitness.name] }))
      .toThrow(/is not a Witness/);
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: [trio[0]!.name, trio[0]!.name, trio[1]!.name] }))
      .toThrow(/3 DIFFERENT people/);
    const done = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: trio.map(p => p.name) }).newState;
    const more = PEOPLE.filter(p => p.is_witness && !trio.some(t => t.id === p.id)).slice(0, 3);
    (done.players['hak'] as any).hand = more.map(p => p.id);
    expect(() => applyMove(done, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: more.map(p => p.name) }))
      .toThrow(/Witness evidence is already complete/);
  });

  it('v2.1: plays a COMPLETE Motive set of 3 at once (fills the first empty slot)', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const g2 = PEOPLE.find(p => p.affiliation === 'gang_2')!;
    const c1 = PEOPLE.find(p => p.affiliation === 'corp_1')!;
    const c2 = PEOPLE.find(p => p.affiliation === 'corp_2')!;
    (s.players['hak'] as any).hand = [g2.id, c1.id, c2.id];
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g2.name, c1.name, c2.name] }).newState;
    expect(s2.hacker.evidence.motive_set_1).toEqual([g2.id, c1.id, c2.id]);
    expect((s2.players['hak'] as { hand: string[] }).hand).toHaveLength(0);
  });

  it('v2.1: motive cards can NOT be banked one at a time', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const person = PEOPLE.find(p => !p.is_witness)!;
    (s.players['hak'] as any).hand = [person.id];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', person_name: person.name, evidence_type: 'motive', motive_set: 1 }))
      .toThrow(/COMPLETE set/);
  });

  it('v2.1: a trio needs 3 DIFFERENT affiliations', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const gang1 = PEOPLE.filter(p => p.affiliation === 'gang_1');
    const corp2 = PEOPLE.find(p => p.affiliation === 'corp_2')!;
    (s.players['hak'] as any).hand = [gang1[0]!.id, gang1[1]!.id, corp2.id];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [gang1[0]!.name, gang1[1]!.name, corp2.name] }))
      .toThrow(/DIFFERENT affiliations|at most ONE gang/);
  });

  it('v2.3-PROBE: two-gang trios legal, all-gang trios rejected', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const g1 = PEOPLE.find(p => p.affiliation === 'gang_1')!;
    const g2 = PEOPLE.find(p => p.affiliation === 'gang_2')!;
    const g3 = PEOPLE.find(p => p.affiliation === 'gang_3')!;
    const c2 = PEOPLE.find(p => p.affiliation === 'corp_2')!;
    (s.players['hak'] as any).hand = [g1.id, g2.id, g3.id, c2.id];
    // v2.3-PROBE: an all-gang trio is NOT offered or accepted (max two gangs)
    const offers = getLegalMoves(s, 'hak').filter(m => m.move.type === 'play_evidence' && (m.move as { evidence_type: string }).evidence_type === 'motive');
    expect(offers.every(o => (o.move as { people: string[] }).people.filter(n => [g1.name, g2.name, g3.name].includes(n)).length <= 2)).toBe(true);
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g1.name, g2.name, g3.name] }))
      .toThrow(/at most TWO gang/);
    // A TWO-gang trio commits
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g1.name, g2.name, c2.name] }).newState;
    expect(s2.hacker.evidence.motive_set_1).toEqual([g1.id, g2.id, c2.id]);
    // But two members of the SAME gang stay illegal (distinct affiliations)
    const q = setupTwoAI(42);
    q.activePlayerId = 'hak';
    q.players['hak']!.ap = 3;
    const g1b = PEOPLE.filter(p => p.affiliation === 'gang_1')[1]!;
    const c1 = PEOPLE.find(p => p.affiliation === 'corp_1')!;
    (q.players['hak'] as any).hand = [g1.id, g1b.id, c1.id];
    expect(() => applyMove(q, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g1.name, g1b.name, c1.name] }))
      .toThrow(/DIFFERENT affiliations/);
  });

  it('v2.1: no two Motive sets may use the same affiliation trio', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const g1 = PEOPLE.filter(p => p.affiliation === 'gang_1');
    const c1 = PEOPLE.filter(p => p.affiliation === 'corp_1');
    const c2 = PEOPLE.filter(p => p.affiliation === 'corp_2');
    // Set 1 completed with gang_1 + corp_1 + corp_2
    s.hacker.evidence.motive_set_1 = [g1[0]!.id, c1[0]!.id, c2[0]!.id];
    const noneP = PEOPLE.filter(p => p.affiliation === 'none')[3]!;
    (s.players['hak'] as any).hand = [g1[1]!.id, c1[1]!.id, c2[1]!.id, noneP.id];
    // Same trio again is rejected
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g1[1]!.name, c1[1]!.name, c2[1]!.name] }))
      .toThrow(/cannot repeat an affiliation combination/);
    // The offered trios exclude the duplicate combination
    const offers = getLegalMoves(s, 'hak').filter(m => m.move.type === 'play_evidence' && (m.move as { evidence_type: string }).evidence_type === 'motive')
      .map(m => (m.move as { people: string[] }).people);
    expect(offers.some(p => p.includes(g1[1]!.name) && p.includes(c1[1]!.name) && p.includes(c2[1]!.name))).toBe(false);
    // A different trio is legal (swap corp_2 for none)
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [g1[1]!.name, c1[1]!.name, noneP.name] }).newState;
    expect(s2.hacker.evidence.motive_set_2).toEqual([g1[1]!.id, c1[1]!.id, noneP.id]);
  });

  it('v2.1: rejects a set play when all 3 Motive sets are complete', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const byAff = (a: string, i: number) => PEOPLE.filter(p => p.affiliation === a)[i]!.id;
    s.hacker.evidence.motive_set_1 = [byAff('gang_1', 0), byAff('corp_1', 0), byAff('corp_2', 0)];
    s.hacker.evidence.motive_set_2 = [byAff('gang_2', 0), byAff('corp_1', 1), byAff('none', 0)];
    s.hacker.evidence.motive_set_3 = [byAff('gang_3', 0), byAff('corp_2', 1), byAff('none', 1)];
    const trio = [byAff('gang_1', 1), byAff('corp_1', 2), byAff('none', 2)];
    (s.players['hak'] as any).hand = [...trio];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: trio }))
      .toThrow(/already complete/);
  });

  it('enforces no double-counting: a card in witnesses cannot go to motive', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const witness = PEOPLE.find(p => p.is_witness)!;
    const g2 = PEOPLE.find(p => p.affiliation === 'gang_2')!;
    const c1 = PEOPLE.find(p => p.affiliation === 'corp_1')!;
    s.hacker.evidence.witnesses = [witness.id];
    (s.players['hak'] as any).hand = [witness.id, g2.id, c1.id];
    expect(() => applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [witness.name, g2.name, c1.name] }))
      .toThrow(/already used as Evidence/);
  });

  it('overclock gives +1 AP once per turn', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const s2 = applyMove(s, 'hak', { type: 'overclock' }).newState;
    expect(s2.players['hak']!.ap).toBe(4);
    expect(s2.players['hak']!.overclock_used).toBe(true);
    // Can't overclock again
    expect(() => applyMove(s2, 'hak', { type: 'overclock' })).toThrow(/already used/);
  });

  it('overclock (immediate) gives Detective 2 Location draws', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const detHandBefore = s.detective.location_hand.length;
    const s2 = applyMove(s, 'hak', { type: 'overclock' }).newState;
    expect(s2.detective.location_hand.length).toBe(detHandBefore + 2);
  });

  it('overclock (next_turn) defers draws to next Detective turn', () => {
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { overclock_draw_timing: 'next_turn' }, 42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const detHandBefore = s.detective.location_hand.length;
    const s2 = applyMove(s, 'hak', { type: 'overclock' }).newState;
    // No immediate draws
    expect(s2.detective.location_hand.length).toBe(detHandBefore);
    expect(s2.overclock_draws_owed).toBe(2);
    // After Hacker passes and Detective starts next turn, draws should happen
    const s3 = applyMove(s2, 'hak', { type: 'pass_turn' }).newState;
    expect(s3.detective.location_hand.length).toBe(detHandBefore + 1 + 2); // +1 normal draw + 2 overclock
    expect(s3.overclock_draws_owed).toBe(0);
  });

  it('overclock (optional) defers draws to next Detective turn (no stuck state)', () => {
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { overclock_draw_timing: 'optional' }, 42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const detHandBefore = s.detective.location_hand.length;
    const s2 = applyMove(s, 'hak', { type: 'overclock' }).newState;
    expect(s2.detective.location_hand.length).toBe(detHandBefore);
    expect(s2.overclock_draws_owed).toBe(2);
    // Draws are taken automatically at the next Detective start-of-turn
    const s3 = applyMove(s2, 'hak', { type: 'pass_turn' }).newState;
    expect(s3.detective.location_hand.length).toBe(detHandBefore + 1 + 2);
    expect(s3.overclock_draws_owed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Informant block
// ---------------------------------------------------------------------------

describe('Informant block', () => {
  it('sets block_pending when Hacker plays a person matching a facedown informant', () => {
    const s = setupTwoAI(42);
    // Recruit an informant
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: false });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    // Hacker plays the matching person
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi, ...getTrackedHand(s, 'hak').filter(id => id !== poi)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: person.name }).newState;
    expect(s2.pending?.type).toBe('block_pending');
    expect(s2.activePlayerId).toBe('det');
  });

  it('Detective blocks: reveals informant, sets clue_reveal_pending', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: false });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi, ...getTrackedHand(s, 'hak').filter(id => id !== poi)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: person.name }).newState;
    const s3 = applyMove(s2, 'det', { type: 'block_decide', block: true }).newState;
    // Informant revealed
    expect(s3.detective.informants.find(i => i.person_id === poi)?.revealed).toBe(true);
    // Clue reveal pending for Hacker
    expect(s3.pending?.type).toBe('clue_reveal_pending');
    expect(s3.activePlayerId).toBe('hak');
  });

  it('Detective declines block: Hacker play proceeds, ability resolves', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: false });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi, ...getTrackedHand(s, 'hak').filter(id => id !== poi)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: person.name }).newState;
    const s3 = applyMove(s2, 'det', { type: 'block_decide', block: false }).newState;
    // Play proceeded: card in discard, AP spent
    expect(s3.pending).toBeNull();
    expect(s3.hacker.contacts_discard).toContain(poi);
    expect(s3.players['hak']!.ap).toBe(3 - person.cost);
    expect(s3.activePlayerId).toBe('hak');
  });
});

// ---------------------------------------------------------------------------
// Clue reveal
// ---------------------------------------------------------------------------

describe('Clue reveal', () => {
  it('Hacker reveals a truthful category', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    // The Back Alley: Gang 1, population 2, Downtown
    s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.activePlayerId = 'hak';
    const s2 = applyMove(s, 'hak', { type: 'clue_reveal', category: 'borough', value: 'downtown' }).newState;
    expect(s2.hacker.truthful_clues.borough).toBe(true);
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('det');
  });

  it('rejects revealing an already-revealed category', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.hacker.truthful_clues.borough = true;
    s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.activePlayerId = 'hak';
    expect(() => applyMove(s, 'hak', { type: 'clue_reveal', category: 'borough', value: 'downtown' })).toThrow(/already revealed/);
  });

  it('validates truthful value for tracked Hacker', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    // The Back Alley is Gang 1 affiliation
    s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.activePlayerId = 'hak';
    expect(() => applyMove(s, 'hak', { type: 'clue_reveal', category: 'affiliation', value: 'gang_2' })).toThrow(/must be truthful/);
  });

  it("a BLOCK's clue reveal resumes the Hacker's turn with remaining AP (§5.2: only the spent AP is lost)", () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.pending = { type: 'clue_reveal_pending', source: 'block' };
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 2; // blocked play charged 1 of 3
    const s2 = applyMove(s, 'hak', { type: 'clue_reveal', category: 'borough', value: 'downtown' }).newState;
    expect(s2.hacker.truthful_clues.borough).toBe(true);
    expect(s2.activePlayerId).toBe('hak'); // turn CONTINUES — not handed to the Detective
    expect(s2.players['hak']!.ap).toBe(2); // remaining AP intact, not reset
  });

  it("a BLOCK's clue reveal on the last AP ends the Hacker's turn normally", () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.pending = { type: 'clue_reveal_pending', source: 'block' };
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 0; // blocked play consumed the last AP
    const turnBefore = s.turn;
    const s2 = applyMove(s, 'hak', { type: 'clue_reveal', category: 'borough', value: 'downtown' }).newState;
    expect(s2.activePlayerId).toBe('det');
    expect(s2.turn).toBe(turnBefore + 1); // a REAL Detective turn started (switchTurn ran)
  });
});

// ---------------------------------------------------------------------------
// Win back
// ---------------------------------------------------------------------------

describe('Win back', () => {
  it('wins back a revealed informant (printed cost, POI returns facedown)', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: true });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi, ...getTrackedHand(s, 'hak').filter(id => id !== poi)];
    const s2 = applyMove(s, 'hak', { type: 'win_back', person_name: person.name }).newState;
    expect(s2.detective.informants.find(i => i.person_id === poi)).toBeUndefined();
    expect(s2.detective.poi_deck).toContain(poi);
    expect(s2.hacker.contacts_discard).toContain(poi);
    // Win-back cost: witnesses cost 1, others cost printed cost
    const winBackCost = person.is_witness ? 1 : person.cost;
    expect(s2.players['hak']!.ap).toBe(3 - winBackCost);
  });

  // Rulebook §6: "the Hacker may PLAY THE MATCHING CONTACT for its printed
  // cost ... and the Hacker's Contact goes to their discard". The original
  // port neither required the card nor took it from hand — it just pushed a
  // copy into the discard, MINTING a second copy of a card still sitting in
  // the deck. Found 2026-08-17 (PORT-NOTES §31).
  it('requires the matching Contact in hand, and takes it from hand (rulebook §6)', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: true });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    // Card NOT in hand — it is still down in the Contacts deck.
    (s.players['hak'] as any).hand = getTrackedHand(s, 'hak').filter(id => id !== poi);
    if (!s.hacker.contacts_deck.includes(poi)) s.hacker.contacts_deck.push(poi);
    expect(() => applyMove(s, 'hak', { type: 'win_back', person_name: person.name }))
      .toThrow(/requires playing your matching .* Contact card/);
    // And it is not offered while unheld.
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'win_back')).toBe(false);

    // With the card in hand it works, and the card LEAVES the hand for the
    // discard — never duplicated across zones.
    const held: CNState = {
      ...s,
      hacker: { ...s.hacker, contacts_deck: s.hacker.contacts_deck.filter(id => id !== poi) },
      players: { ...s.players, hak: { ...s.players['hak']!, hand: [poi], hand_size: 1 } as never },
    };
    const after = applyMove(held, 'hak', { type: 'win_back', person_name: person.name }).newState;
    expect(getTrackedHand(after, 'hak')).not.toContain(poi);
    expect(after.hacker.contacts_discard.filter(id => id === poi)).toHaveLength(1);
    expect(after.hacker.contacts_deck).not.toContain(poi);
  });

  it('card conservation: every Contact lives in exactly one zone after a win-back', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: true });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi];
    s.hacker.contacts_deck = s.hacker.contacts_deck.filter(id => id !== poi);
    const after = applyMove(s, 'hak', { type: 'win_back', person_name: person.name }).newState;
    const ev = after.hacker.evidence;
    const all = [
      ...getTrackedHand(after, 'hak'),
      ...after.hacker.contacts_deck,
      ...after.hacker.contacts_discard,
      ...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...ev.motive_set_3,
    ];
    expect(new Set(all).size).toBe(all.length);
    void person;
  });

  it('rejects win-back on a facedown informant', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi];
    expect(() => applyMove(s, 'hak', { type: 'win_back', person_name: person.name })).toThrow(/not a revealed informant/);
  });

  it('witnesses cost 1 AP for win-back', () => {
    const s = setupTwoAI(42);
    const witness = PEOPLE.find(p => p.is_witness)!;
    s.detective.informants.push({ person_id: witness.id, revealed: true });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [witness.id];
    const s2 = applyMove(s, 'hak', { type: 'win_back', person_name: witness.name }).newState;
    expect(s2.players['hak']!.ap).toBe(2); // 3 - 1 (witness cost)
  });
});

// ---------------------------------------------------------------------------
// Jailbreak
// ---------------------------------------------------------------------------

describe('Jailbreak', () => {
  // A Negative Clue must be FALSE of the hideout — derive one from the actual state.
  function falseToken(s: CNState): string {
    const h = s.hacker.hideout!;
    return h.borough === 'downtown' ? 'borough_boonies' : 'borough_downtown';
  }

  it('frees a jailed person and gives a Negative Clue', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const token = falseToken(s);
    const s2 = applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: token }).newState;
    expect(s2.detective.jail[0]).toEqual([]);
    expect(s2.detective.poi_deck).toContain(person.id);
    expect(s2.hacker.negative_clues).toContain(token);
  });

  it('rejects jailbreak of a non-jailed person', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    expect(() => applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: 'x' })).toThrow(/not jailed/);
  });

  it('rejects duplicate Negative Clue', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.hacker.negative_clues = ['borough_downtown'];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    expect(() => applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: 'borough_downtown' })).toThrow(/already declared/);
  });

  it('getLegalMoves enumerates eligible Negative Clue tokens for jailbreak', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const moves = getLegalMoves(s, 'hak');
    const jailbreakMoves = moves.filter(m => m.move.type === 'jailbreak');
    expect(jailbreakMoves.length).toBeGreaterThan(0);
    // Every jailbreak move should have a non-empty negative_clue_token
    for (const m of jailbreakMoves) {
      if (m.move.type === 'jailbreak') {
        expect(m.move.negative_clue_token).not.toBe('');
      }
    }
  });

  it('getLegalMoves excludes tokens in truthfully-revealed categories', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.hacker.truthful_clues.borough = true;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const moves = getLegalMoves(s, 'hak');
    const jailbreakMoves = moves.filter(m => m.move.type === 'jailbreak') as { move: { type: 'jailbreak'; negative_clue_token: string } }[];
    // No borough tokens should be offered
    for (const m of jailbreakMoves) {
      expect(m.move.negative_clue_token).not.toMatch(/^borough_/);
    }
  });

  it('rejects an invalid Negative Clue token', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    expect(() => applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: 'not_a_token' })).toThrow(/not a valid Clue token/);
  });

  it('rejects a Negative Clue token in a truthfully-revealed category', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.hacker.truthful_clues.borough = true;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    expect(() => applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: 'borough_downtown' })).toThrow(/truthfully-revealed borough/);
  });

  it('accepts a Negative Clue token given by printed value', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    // Printed value (not id) of a token that is false of the hideout
    const h = s.hacker.hideout!;
    const printedValue = h.borough === 'downtown' ? 'boonies' : 'downtown';
    const expectedId = h.borough === 'downtown' ? 'borough_boonies' : 'borough_downtown';
    const s2 = applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: printedValue }).newState;
    expect(s2.hacker.negative_clues).toContain(expectedId);
  });

  it('rejects a Negative Clue token that is true of the hideout', () => {
    const s = setupTwoAI(42);
    const person = PEOPLE[0]!;
    s.detective.jail[0] = [person.id];
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const trueToken = `borough_${s.hacker.hideout!.borough}`;
    expect(() => applyMove(s, 'hak', { type: 'jailbreak', freed_person: person.name, negative_clue_token: trueToken })).toThrow(/must be false/);
  });
});

describe('Block + all-clues-revealed guard', () => {
  it('block with all clues revealed does not set clue_reveal_pending (no stuck state)', () => {
    const s = setupTwoAI(42);
    const poi = s.detective.poi_deck[0]!;
    const person = getPerson(poi)!;
    s.detective.informants.push({ person_id: poi, revealed: false });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== poi);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [poi, ...getTrackedHand(s, 'hak').filter(id => id !== poi)];
    // Reveal all 3 categories
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_clues.population = true;
    s.hacker.truthful_clues.affiliation = true;
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: person.name }).newState;
    expect(s2.pending?.type).toBe('block_pending');
    const s3 = applyMove(s2, 'det', { type: 'block_decide', block: true }).newState;
    // Should NOT set clue_reveal_pending — should clear pending and return to Hacker
    expect(s3.pending).toBeNull();
    expect(s3.activePlayerId).toBe('hak');
  });
});

// ---------------------------------------------------------------------------
// Sub-choice pending states (board_discard, reveal_informant, discard_retrieval)
// ---------------------------------------------------------------------------

describe('Ability sub-choices', () => {
  it('board_discard (Gang 2/3): sets pending, Hacker chooses which board location to discard', () => {
    const s = setupTwoAI(42);
    // Put 2 locations on the board
    s.detective.board = [s.detective.location_hand[0]!, s.detective.location_hand[1]!];
    // Add a Gang 2 person to Hacker hand
    const gang2 = PEOPLE.find(p => p.ability === 'board_discard')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [gang2.id, ...getTrackedHand(s, 'hak').filter(id => id !== gang2.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: gang2.name }).newState;
    expect(s2.pending?.type).toBe('board_discard_pending');
    expect(s2.activePlayerId).toBe('hak');
    // Legal moves should list board locations
    const moves = getLegalMoves(s2, 'hak');
    expect(moves.some(m => m.move.type === 'board_discard_choice')).toBe(true);
  });

  it('board_discard: Hacker discards chosen location and card goes to discard', () => {
    const s = setupTwoAI(42);
    const boardLoc1 = s.detective.location_hand[0]!;
    const boardLoc2 = s.detective.location_hand[1]!;
    s.detective.board = [boardLoc1, boardLoc2];
    const gang2 = PEOPLE.find(p => p.ability === 'board_discard')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [gang2.id, ...getTrackedHand(s, 'hak').filter(id => id !== gang2.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: gang2.name }).newState;
    const targetName = getLocation(boardLoc1)!.name;
    const s3 = applyMove(s2, 'hak', { type: 'board_discard_choice', target_location: targetName }).newState;
    expect(s3.detective.board).not.toContain(boardLoc1);
    expect(s3.detective.board).toContain(boardLoc2);
    expect(s3.pending).toBeNull();
    expect(s3.hacker.contacts_discard).toContain(gang2.id);
  });

  it('reveal_informant (Corp 1): sets pending, Hacker chooses which facedown informant to reveal', () => {
    const s = setupTwoAI(42);
    const inf1 = PEOPLE[0]!;
    const inf2 = PEOPLE[1]!;
    s.detective.informants.push({ person_id: inf1.id, revealed: false }, { person_id: inf2.id, revealed: false });
    const corp1 = PEOPLE.find(p => p.ability === 'reveal_informant')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [corp1.id, ...getTrackedHand(s, 'hak').filter(id => id !== corp1.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: corp1.name }).newState;
    expect(s2.pending?.type).toBe('reveal_informant_pending');
    const moves = getLegalMoves(s2, 'hak');
    expect(moves.some(m => m.move.type === 'reveal_informant')).toBe(true);
    // Should have 2 options (both facedown)
    const revealMoves = moves.filter(m => m.move.type === 'reveal_informant');
    expect(revealMoves).toHaveLength(2);
  });

  it('reveal_informant: Hacker reveals chosen informant (by facedown position)', () => {
    const s = setupTwoAI(42);
    const inf1 = PEOPLE[0]!;
    s.detective.informants.push({ person_id: inf1.id, revealed: false });
    const corp1 = PEOPLE.find(p => p.ability === 'reveal_informant')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [corp1.id, ...getTrackedHand(s, 'hak').filter(id => id !== corp1.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: corp1.name }).newState;
    // Identities are hidden from the Hacker — target is the 1-based facedown ordinal
    const s3 = applyMove(s2, 'hak', { type: 'reveal_informant', target_informant: '1' }).newState;
    expect(s3.detective.informants.find(i => i.person_id === inf1.id)?.revealed).toBe(true);
    expect(s3.pending).toBeNull();
    expect(s3.hacker.contacts_discard).toContain(corp1.id);
  });

  it('reveal_informant without a pending is illegal (no free reveal)', () => {
    const s = setupTwoAI(42);
    const inf1 = PEOPLE[0]!;
    s.detective.informants.push({ person_id: inf1.id, revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    expect(() => applyMove(s, 'hak', { type: 'reveal_informant', target_informant: '1' })).toThrow(/No reveal_informant pending/);
  });

  it('reveal_informant rejects an out-of-range ordinal', () => {
    const s = setupTwoAI(42);
    const inf1 = PEOPLE[0]!;
    s.detective.informants.push({ person_id: inf1.id, revealed: false });
    const corp1 = PEOPLE.find(p => p.ability === 'reveal_informant')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [corp1.id, ...getTrackedHand(s, 'hak').filter(id => id !== corp1.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: corp1.name }).newState;
    expect(() => applyMove(s2, 'hak', { type: 'reveal_informant', target_informant: '7' })).toThrow(/not a facedown informant position/);
  });

  it('discard_retrieval (Corp 2): sets pending, Hacker chooses which discard card to retrieve', () => {
    const s = setupTwoAI(42);
    // Put some cards in discard
    s.hacker.contacts_discard = [PEOPLE[0]!.id, PEOPLE[1]!.id];
    const corp2 = PEOPLE.find(p => p.ability === 'discard_retrieval')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [corp2.id, ...getTrackedHand(s, 'hak').filter(id => id !== corp2.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: corp2.name }).newState;
    expect(s2.pending?.type).toBe('discard_retrieval_pending');
    const moves = getLegalMoves(s2, 'hak');
    expect(moves.some(m => m.move.type === 'discard_retrieval_choice')).toBe(true);
    const retrieveMoves = moves.filter(m => m.move.type === 'discard_retrieval_choice');
    expect(retrieveMoves).toHaveLength(2);
  });

  it('discard_retrieval: Hacker retrieves chosen card from discard to hand', () => {
    const s = setupTwoAI(42);
    const discarded = PEOPLE[0]!;
    s.hacker.contacts_discard = [discarded.id];
    const corp2 = PEOPLE.find(p => p.ability === 'discard_retrieval')!;
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const handBefore = getTrackedHand(s, 'hak').length;
    (s.players['hak'] as any).hand = [corp2.id, ...getTrackedHand(s, 'hak').filter(id => id !== corp2.id)];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: corp2.name }).newState;
    const s3 = applyMove(s2, 'hak', { type: 'discard_retrieval_choice', target_card: discarded.name }).newState;
    expect(s3.hacker.contacts_discard).not.toContain(discarded.id);
    expect(getTrackedHand(s3, 'hak')).toContain(discarded.id);
    expect(s3.pending).toBeNull();
    expect(s3.hacker.contacts_discard).toContain(corp2.id);
  });
});

// ---------------------------------------------------------------------------
// Endgame
// ---------------------------------------------------------------------------

describe('Endgame', () => {
  it('trigger 1: Evidence complete triggers immediate final guess', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    // Set up near-complete evidence: just need weapon
    s.hacker.evidence.weapon = false;
    s.hacker.evidence.witnesses = PEOPLE.filter(p => p.is_witness).slice(0, 3).map(p => p.id);
    // v1.9 motive: three sets of 3, each spanning 3 different affiliations
    const byAff = (a: string, i: number) => PEOPLE.filter(p => p.affiliation === a)[i]!.id;
    // One gang per set, distinct trios (v1.9 gang cap, 3 sets)
    s.hacker.evidence.motive_set_1 = [byAff('gang_1', 0), byAff('corp_1', 0), byAff('corp_2', 0)];
    s.hacker.evidence.motive_set_2 = [byAff('gang_1', 1), byAff('corp_1', 1), byAff('none', 3)];
    s.hacker.evidence.motive_set_3 = [byAff('gang_2', 0), byAff('corp_1', 2), byAff('corp_2', 1)];
    // Add Weapon to hand
    (s.players['hak'] as any).hand = [WEAPON_ID, ...getTrackedHand(s, 'hak').filter(id => id !== WEAPON_ID)];
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', person_name: 'The Weapon', evidence_type: 'weapon' }).newState;
    expect(s2.endgame_triggered).toBe(true);
    expect(s2.endgame_reason).toBe('evidence_complete');
    expect(s2.pending?.type).toBe('endgame_final_guess');
    expect(s2.activePlayerId).toBe('det');
  });

  it('trigger 2: Location deck exhausted triggers final guess at start of turn', () => {
    const s = setupTwoAI(42);
    // Exhaust the Location deck
    s.detective.location_deck = [];
    // Force Detective start-of-turn by passing Hacker
    s.activePlayerId = 'hak';
    const s2 = applyMove(s, 'hak', { type: 'pass_turn' }).newState;
    expect(s2.endgame_triggered).toBe(true);
    expect(s2.endgame_reason).toBe('location_deck_exhausted');
    expect(s2.pending?.type).toBe('endgame_final_guess');
  });

  it('final guess correct: Detective wins', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = 'det';
    const s2 = applyMove(s, 'det', { type: 'final_guess', location_name: 'The Back Alley' }).newState;
    expect(s2.phase).toBe('game_over');
    expect(s2.winners).toEqual(['det']);
  });

  it('final guess wrong: Hacker wins', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = 'det';
    const s2 = applyMove(s, 'det', { type: 'final_guess', location_name: 'Shipyard' }).newState;
    expect(s2.phase).toBe('game_over');
    expect(s2.winners).toEqual(['hak']);
  });
});

// ---------------------------------------------------------------------------
// Detective mandatory turn order (draw → play → upkeep → AP actions)
// ---------------------------------------------------------------------------

describe('Detective mandatory turn order', () => {
  it('rejects AP actions before playing a Location', () => {
    const s = setupTwoAI(42);
    expect(() => applyMove(s, 'det', { type: 'draw_extra_location' })).toThrow(/must play a Location first/);
    expect(() => applyMove(s, 'det', { type: 'recruit_informant', target_person: getPerson(s.detective.poi_deck[0]!)!.name })).toThrow(/must play a Location first/);
  });

  it('rejects upkeep before playing a Location', () => {
    const s = setupTwoAI(42);
    s.detective.informants.push({ person_id: PEOPLE[0]!.id, revealed: false });
    expect(() => applyMove(s, 'det', { type: 'upkeep_choice', keep: [PEOPLE[0]!.id], release: [] })).toThrow(/must play a Location before paying upkeep/);
  });

  it('rejects a second Location play in the same turn', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s2 = playLocation(s, 'det', locName);
    const second = getLocation(s2.detective.location_hand[0]!)!.name;
    expect(() => playLocation(s2, 'det', second)).toThrow(/Already played a Location this turn/);
  });

  it('blocks AP actions until upkeep is paid when informants exist', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    s1.detective.informants.push({ person_id: PEOPLE[0]!.id, revealed: false });
    s1.detective.upkeep_paid = false;
    // draw_extra_location costs 4 AP — should be rejected while upkeep is unpaid
    expect(() => applyMove(s1, 'det', { type: 'draw_extra_location' })).toThrow(/must pay informant upkeep first/);
    // After paying upkeep, AP actions unlock
    const s2 = applyMove(s1, 'det', { type: 'upkeep_choice', keep: [PEOPLE[0]!.id], release: [] }).newState;
    expect(s2.players['det']!.ap).toBe(3); // 4 - 1 upkeep
    expect(s2.detective.upkeep_paid).toBe(true);
  });

  it('resets location_played_this_turn and upkeep_paid at next Detective turn', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    expect(s1.detective.location_played_this_turn).toBe(true);
    const s2 = applyMove(s1, 'det', { type: 'pass_turn' }).newState; // → Hacker
    const s3 = applyMove(s2, 'hak', { type: 'pass_turn' }).newState; // → Detective
    expect(s3.detective.location_played_this_turn).toBe(false);
    expect(s3.detective.upkeep_paid).toBe(false);
    expect(s3.players['det']!.ap).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Opaque (human) Detective legal moves
// ---------------------------------------------------------------------------

describe('Opaque Detective legal moves', () => {
  function setupOpaqueDet(seed = 42): CNState {
    return createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, seed);
  }

  it('offers buy_clue for an opaque Detective after mandatory play', () => {
    const s = setupOpaqueDet();
    // Tracked Hacker completes setup by naming a hideout
    const s0 = applyMove(s, 'hak', { type: 'report_hideout', location_name: 'The Junction' }).newState;
    // Opaque: server doesn't know the hand; play any location by name
    const s1 = applyMove(s0, 'det', { type: 'play_location', location_name: 'The Back Alley' }).newState;
    const moves = getLegalMoves(s1, 'det');
    expect(moves.some(m => m.move.type === 'buy_clue')).toBe(true);
  });

  it('offers upkeep whenever informants exist and upkeep is unpaid (not gated on AP)', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = playLocation(s, 'det', locName);
    s1.detective.informants.push({ person_id: PEOPLE[0]!.id, revealed: false });
    s1.detective.upkeep_paid = false;
    s1.players['det']!.ap = 4; // AP present — upkeep must still be offered
    const moves = getLegalMoves(s1, 'det');
    expect(moves.some(m => m.move.type === 'upkeep_choice')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getLegalMoves
// ---------------------------------------------------------------------------

describe('getLegalMoves', () => {
  it('returns play_location moves for Detective on their turn', () => {
    const s = setupTwoAI(42);
    const moves = getLegalMoves(s, 'det');
    expect(moves.some(m => m.move.type === 'play_location')).toBe(true);
  });

  it('returns draw_contact and play_person moves for Hacker on their turn', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const moves = getLegalMoves(s, 'hak');
    expect(moves.some(m => m.move.type === 'draw_contact')).toBe(true);
    expect(moves.some(m => m.move.type === 'play_person')).toBe(true);
  });

  it('returns block_decide moves when block_pending', () => {
    const s = setupTwoAI(42);
    s.pending = { type: 'block_pending', hacker_move: { type: 'play_person', person_name: 'x' }, matching_informant: 'y', person_id: 'z' };
    s.activePlayerId = 'det';
    const moves = getLegalMoves(s, 'det');
    expect(moves.every(m => m.move.type === 'block_decide')).toBe(true);
    expect(moves).toHaveLength(2); // block yes / no
  });

  it('returns clue_reveal moves when clue_reveal_pending', () => {
    const s = setupTwoAI(42);
    s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.activePlayerId = 'hak';
    const moves = getLegalMoves(s, 'hak');
    expect(moves.every(m => m.move.type === 'clue_reveal')).toBe(true);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(3);
  });

  it('returns final_guess moves when endgame_final_guess', () => {
    const s = setupTwoAI(42);
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = 'det';
    const moves = getLegalMoves(s, 'det');
    expect(moves.every(m => m.move.type === 'final_guess')).toBe(true);
    expect(moves).toHaveLength(19); // all 19 locations (v2.0)
  });

  it('returns empty array for non-active player', () => {
    const s = setupTwoAI(42);
    // Active is 'det'
    const moves = getLegalMoves(s, 'hak');
    expect(moves).toHaveLength(0);
  });

  it('returns empty array when game is over', () => {
    const s = setupTwoAI(42);
    s.phase = 'game_over';
    const moves = getLegalMoves(s, 'det');
    expect(moves).toHaveLength(0);
  });

  it('excludes Weapon from play_person moves', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = [WEAPON_ID];
    const moves = getLegalMoves(s, 'hak');
    expect(moves.filter(m => m.move.type === 'play_person')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isGameOver
// ---------------------------------------------------------------------------

describe('isGameOver', () => {
  it('returns game_over=false during play', () => {
    const s = setupTwoAI(42);
    const r = isGameOver(s);
    expect(r.game_over).toBe(false);
  });

  it('returns game_over=true with winners when game over', () => {
    const s = setupTwoAI(42);
    s.phase = 'game_over';
    s.winners = ['det'];
    s.resultSummary = 'Detective wins';
    const r = isGameOver(s);
    expect(r.game_over).toBe(true);
    expect(r.winners).toEqual(['det']);
    expect(r.summary).toBe('Detective wins');
  });
});

// ---------------------------------------------------------------------------
// Turn switching
// ---------------------------------------------------------------------------

describe('Turn switching', () => {
  it('switches to Hacker when Detective passes', () => {
    const s = setupTwoAI(42);
    // Play a location first (mandatory)
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s2 = playLocation(s, 'det', locName);
    const s3 = applyMove(s2, 'det', { type: 'pass_turn' }).newState;
    expect(s3.activePlayerId).toBe('hak');
    expect(s3.players['hak']!.ap).toBe(3);
  });

  it('switches to Detective and increments turn when Hacker passes', () => {
    const s = setupTwoAI(42);
    // Set up: Detective has played, now Hacker's turn
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const turnBefore = s.turn;
    const s2 = applyMove(s, 'hak', { type: 'pass_turn' }).newState;
    expect(s2.activePlayerId).toBe('det');
    expect(s2.turn).toBe(turnBefore + 1);
    // Detective should have drawn a location at start of turn
    expect(s2.detective.location_hand.length).toBeGreaterThan(s.detective.location_hand.length);
  });

  it('auto-switches when AP reaches 0', () => {
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s2 = playLocation(s, 'det', locName);
    // Spend all 4 AP (draw_extra_location costs 4)
    const s3 = applyMove(s2, 'det', { type: 'draw_extra_location' }).newState;
    // AP is 0, should auto-switch to Hacker
    expect(s3.activePlayerId).toBe('hak');
  });
});

// ---------------------------------------------------------------------------
// Full game integration
// ---------------------------------------------------------------------------

describe('Full AI game', () => {
  it('completes a full AI-vs-AI game without errors', () => {
    const s = setupTwoAI(7);
    let state = s;
    for (let i = 0; i < 200; i++) {
      if (state.phase === 'game_over') break;
      const moves = getLegalMoves(state, state.activePlayerId);
      if (moves.length === 0) {
        // Safety: pass if no moves
        state = applyMove(state, state.activePlayerId, { type: 'pass_turn' }).newState;
        continue;
      }
      // Pick a non-pass move if possible, else pass
      const nonPass = moves.find(m => m.move.type !== 'pass_turn');
      const move = nonPass ?? moves[0]!;
      state = applyMove(state, state.activePlayerId, move.move).newState;
    }
    expect(state.phase).toBe('game_over');
    expect(state.winners).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Informant check on Evidence plays + blocked-play AP loss + evidence jail rule
// (missed printed rules found by the balance gate 2026-08-12)
// ---------------------------------------------------------------------------

describe('Evidence informant check (rulebook §5.2 "same informant check and penalty")', () => {
  // v2.4: Witness evidence is an atomic trio, so the informant check runs over
  // the whole declared set — Eddie is the one that matches an informant.
  const WITNESS_TRIO = ['eddie_the_doorman', 'marisol_the_janitor', 'gus_the_noodle_guy'];
  const WITNESS_TRIO_NAMES = ['Eddie the Doorman', 'Marisol the Janitor', 'Gus the Noodle Guy'];

  function withWitnessInHand(seed = 42) {
    const s = setupTwoAI(seed);
    const p = s.players['hak']!;
    if (p.kind === 'tracked') {
      for (const id of WITNESS_TRIO) if (!p.hand.includes(id)) p.hand.push(id);
      p.hand_size = p.hand.length;
    }
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    return s;
  }

  const playWitnessSet = { type: 'play_evidence', evidence_type: 'witness', people: WITNESS_TRIO_NAMES } as const;

  it('an Evidence play matching a facedown informant sets block_pending', () => {
    const s = withWitnessInHand();
    s.detective.informants.push({ person_id: 'eddie_the_doorman', revealed: false });
    const r = applyMove(s, 'hak', playWitnessSet);
    expect(r.newState.pending?.type).toBe('block_pending');
    expect(r.newState.activePlayerId).toBe('det');
    // Nothing placed yet; the card stays in hand
    expect(r.newState.hacker.evidence.witnesses).toHaveLength(0);
    expect(getTrackedHand(r.newState, 'hak')).toContain('eddie_the_doorman');
  });

  it('blocking reveals the informant, denies the Evidence, and grants a clue', () => {
    const s = withWitnessInHand();
    s.detective.informants.push({ person_id: 'eddie_the_doorman', revealed: false });
    const s1 = applyMove(s, 'hak', playWitnessSet).newState;
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: true }).newState;
    expect(s2.detective.informants[0]!.revealed).toBe(true);
    expect(s2.pending?.type).toBe('clue_reveal_pending');
    expect(s2.hacker.evidence.witnesses).toHaveLength(0);
    expect(getTrackedHand(s2, 'hak')).toContain('eddie_the_doorman');
  });

  it('declining the block resolves the Evidence play normally', () => {
    const s = withWitnessInHand();
    s.detective.informants.push({ person_id: 'eddie_the_doorman', revealed: false });
    const s1 = applyMove(s, 'hak', playWitnessSet).newState;
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: false }).newState;
    // v2.4: declining lets the WHOLE set land.
    expect(s2.hacker.evidence.witnesses).toEqual(WITNESS_TRIO);
    expect(getTrackedHand(s2, 'hak')).not.toContain('eddie_the_doorman');
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('hak');
  });

  it('the Weapon is never informant-checked (no POI copy)', () => {
    const s = setupTwoAI(42);
    const p = s.players['hak']!;
    if (p.kind === 'tracked' && !p.hand.includes(WEAPON_ID)) { p.hand.push(WEAPON_ID); p.hand_size = p.hand.length; }
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const r = applyMove(s, 'hak', { type: 'play_evidence', person_name: 'The Weapon', evidence_type: 'weapon' });
    expect(r.newState.pending).toBeNull();
    expect(r.newState.hacker.evidence.weapon).toBe(true);
  });

  it('a jailed person cannot be used as Evidence (engine + legal moves)', () => {
    const s = withWitnessInHand();
    s.detective.jail[0] = ['eddie_the_doorman'];
    expect(() => applyMove(s, 'hak', playWitnessSet))
      .toThrow(/jailed and cannot be used as Evidence/);
    // v2.4: no offered Evidence set may name a jailed person.
    const offered = getLegalMoves(s, 'hak').filter(m => m.move.type === 'play_evidence')
      .flatMap(m => (m.move as { people?: string[]; person_name?: string }).people
        ?? [(m.move as { person_name?: string }).person_name ?? '']);
    expect(offered).not.toContain('Eddie the Doorman');
  });

  it('a blocked play_person loses the AP (rulebook: "the AP spent is lost")', () => {
    const s = setupTwoAI(42);
    const p = s.players['hak']!;
    if (p.kind === 'tracked' && !p.hand.includes('blackice')) { p.hand.push('blackice'); p.hand_size = p.hand.length; }
    s.detective.informants.push({ person_id: 'blackice', revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const s1 = applyMove(s, 'hak', { type: 'play_person', person_name: 'Blackice' }).newState;
    expect(s1.pending?.type).toBe('block_pending');
    expect(s1.players['hak']!.ap).toBe(1); // 3 − cost 2, charged at declaration
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: true }).newState;
    expect(s2.players['hak']!.ap).toBe(1); // lost, not refunded
    // Declined path must not double-charge
    const t1 = applyMove(s, 'hak', { type: 'play_person', person_name: 'Blackice' }).newState;
    const t2 = applyMove(t1, 'det', { type: 'block_decide', block: false }).newState;
    expect(t2.players['hak']!.ap).toBe(1); // charged exactly once
  });

  it('blocking on the Hacker\'s last AP ends the Hacker\'s turn and passes to Detective', () => {
    const s = setupTwoAI(42);
    const p = s.players['hak']!;
    if (p.kind === 'tracked' && !p.hand.includes('blackice')) { p.hand.push('blackice'); p.hand_size = p.hand.length; }
    s.detective.informants.push({ person_id: 'blackice', revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 2; // exactly the cost of Zero Kelvin
    // Mark all clues revealed so the block has no clue_reveal_pending follow-up
    s.hacker.truthful_clues = { borough: true, population: true, affiliation: true };
    const s1 = applyMove(s, 'hak', { type: 'play_person', person_name: 'Blackice' }).newState;
    expect(s1.pending?.type).toBe('block_pending');
    expect(s1.players['hak']!.ap).toBe(0);
    // Blocking consumes the rest of the Hacker's turn
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: true }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('det');
    expect(s2.players['hak']!.ap).toBe(0);
    // It is now the Detective's next turn
    expect(s2.detective.location_played_this_turn).toBe(false);
    expect(s2.players['det']!.ap).toBe(4);
  });

  it('blocking with all clues revealed on the Hacker\'s last AP still ends the Hacker\'s turn', () => {
    const s = setupTwoAI(42);
    const p = s.players['hak']!;
    if (p.kind === 'tracked' && !p.hand.includes('blackice')) { p.hand.push('blackice'); p.hand_size = p.hand.length; }
    s.detective.informants.push({ person_id: 'blackice', revealed: false });
    s.hacker.truthful_clues = { borough: true, population: true, affiliation: true };
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 2;
    const s1 = applyMove(s, 'hak', { type: 'play_person', person_name: 'Blackice' }).newState;
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: true }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('det');
    expect(s2.players['hak']!.ap).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// v2.0 EXPERIMENT: Little Ghana / Anansi the Spider
// ---------------------------------------------------------------------------

describe('v2.0: twin hideout + Anansi reshuffle', () => {
  it('guessing the attribute twin FAILS — the hideout is a card, not a stat-line', () => {
    const s = setupWithHideout(42, 'Little Ghana');
    expect(s.hacker.hideout_location_id).toBe('little_ghana');
    s.detective.location_played_this_turn = true;
    s.players['det']!.ap = 4;
    // Trailer Towers shares all three attributes but is the WRONG card
    const wrong = applyMove(s, 'det', { type: 'guess_location', location_name: 'Trailer Towers' }).newState;
    expect(wrong.phase).toBe('play');
    expect(wrong.detective.mid_game_guess_spent).toBe(true);
    // The real card wins (final guess path)
    const s2 = setupWithHideout(42, 'Little Ghana');
    s2.pending = { type: 'endgame_final_guess' };
    s2.activePlayerId = 'det';
    const right = applyMove(s2, 'det', { type: 'final_guess', location_name: 'Little Ghana' }).newState;
    expect(right.phase).toBe('game_over');
    expect(right.winners).toEqual(['det']);
  });

  it('Anansi RIDER: committing him as Evidence removes an informant (facedown unseen / revealed by name)', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    // v2.4: Witness evidence is an atomic trio — Anansi rides in on the set.
    const p = s.players['hak']!;
    if (p.kind === 'tracked') {
      for (const id of ['anansi_the_spider', 'eddie_the_doorman', 'marisol_the_janitor']) {
        if (!p.hand.includes(id)) p.hand.push(id);
      }
      p.hand_size = p.hand.length;
    }
    s.detective.informants.push(
      { person_id: 'zero_kelvin', revealed: false },
      { person_id: 'rust', revealed: false },
      { person_id: 'wyrm', revealed: true },
    );
    const poiBefore = s.detective.poi_deck.length;

    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: ['Anansi the Spider', 'Eddie the Doorman', 'Marisol the Janitor'] }).newState;
    expect(s1.pending?.type).toBe('informant_removal_pending');
    expect(s1.hacker.evidence.witnesses).toContain('anansi_the_spider');
    expect(s1.hacker.evidence.witnesses).toHaveLength(3);
    // Offers: 2 facedown ordinals + 1 revealed name; ordinal offers never leak identities
    const offers = getLegalMoves(s1, 'hak');
    expect(offers).toHaveLength(3);
    expect(offers.filter(o => /facedown informant #\d/.test(o.description))).toHaveLength(2);
    expect(offers.some(o => o.description.includes('Zero Kelvin'))).toBe(false);
    // Remove facedown #2 (rust) — summary must not name them
    const r = applyMove(s1, 'hak', { type: 'informant_removal_choice', target_informant: '2' });
    expect(r.summary).not.toMatch(/Rust/);
    expect(r.newState.detective.informants).toHaveLength(2);
    expect(r.newState.detective.informants.some(i => i.person_id === 'rust')).toBe(false);
    expect(r.newState.detective.poi_deck).toContain('rust');
    expect(r.newState.detective.poi_deck.length).toBe(poiBefore + 1);
    // Rider path: Anansi stays in the Evidence zone, NOT the discard
    expect(r.newState.hacker.contacts_discard).not.toContain('anansi_the_spider');
    expect(r.newState.hacker.evidence.witnesses).toContain('anansi_the_spider');
  });

  it('Anansi rider is skipped when his commit completes all Evidence (final guess resolves first)', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const byAff = (a: string, i: number) => PEOPLE.filter(p => p.affiliation === a)[i]!.id;
    s.hacker.evidence.weapon = true;
    // v2.4: the Witness piece lands as one trio — Anansi's set is the final
    // Evidence played, so the endgame must pre-empt his rider.
    s.hacker.evidence.witnesses = [];
    s.hacker.evidence.motive_set_1 = [byAff('gang_1', 0), byAff('corp_1', 0), byAff('corp_2', 0)];
    s.hacker.evidence.motive_set_2 = [byAff('gang_1', 1), byAff('corp_1', 1), byAff('none', 3)];
    s.hacker.evidence.motive_set_3 = [byAff('gang_2', 0), byAff('corp_1', 2), byAff('corp_2', 1)];
    s.detective.informants.push({ person_id: 'zero_kelvin', revealed: false });
    const p = s.players['hak']!;
    if (p.kind === 'tracked') {
      for (const id of ['anansi_the_spider', 'eddie_the_doorman', 'marisol_the_janitor']) {
        if (!p.hand.includes(id)) p.hand.push(id);
      }
      p.hand_size = p.hand.length;
    }
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: ['Anansi the Spider', 'Eddie the Doorman', 'Marisol the Janitor'] }).newState;
    expect(s2.pending?.type).toBe('endgame_final_guess'); // NOT informant_removal
    expect(s2.detective.informants).toHaveLength(1); // removal skipped
  });

  it('Anansi with no informants: Evidence commit is a plain witness play (no pending)', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    const p = s.players['hak']!;
    if (p.kind === 'tracked') {
      for (const id of ['anansi_the_spider', 'eddie_the_doorman', 'marisol_the_janitor']) {
        if (!p.hand.includes(id)) p.hand.push(id);
      }
      p.hand_size = p.hand.length;
    }
    const s2 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: ['Anansi the Spider', 'Eddie the Doorman', 'Marisol the Janitor'] }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.hacker.evidence.witnesses).toContain('anansi_the_spider');
    // And playing him as a PERSON is a plain witness no-op (rider does not fire)
    const t0 = setupTwoAI(42);
    t0.activePlayerId = 'hak';
    t0.players['hak']!.ap = 3;
    const q = t0.players['hak']!;
    if (q.kind === 'tracked' && !q.hand.includes('anansi_the_spider')) {
      q.hand.push('anansi_the_spider'); q.hand_size = q.hand.length;
    }
    t0.detective.informants.push({ person_id: 'zero_kelvin', revealed: false });
    const t1 = applyMove(t0, 'hak', { type: 'play_person', person_name: 'Anansi the Spider' }).newState;
    expect(t1.pending).toBeNull();
    expect(t1.hacker.contacts_discard).toContain('anansi_the_spider');
    expect(t1.detective.informants).toHaveLength(1);
  });

  it('a Burn resets seen_locations to the current hand (the pile re-randomizes)', () => {
    const s = giveHackerTurn(setupWithHideout(42, 'Sewers'), 4);
    const discarded = s.detective.location_deck.splice(0, 2);
    s.detective.location_discard.push(...discarded);
    s.detective.seen_locations.push(...discarded);
    const s2 = applyMove(s, 'hak', { type: 'burn_safehouse' }).newState;
    expect(s2.detective.seen_locations).toEqual(s2.detective.location_hand);
  });
});

// ---------------------------------------------------------------------------
// v2.0 Iceden rider: gang_1 motive commits win back a revealed informant free
// ---------------------------------------------------------------------------

describe('v2.1: Iceden rider + motive-set block flow', () => {
  function hackerReady(seed = 42): CNState {
    const s = setupTwoAI(seed);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    return s;
  }
  // Helpers: pick set members that are NOT informants in the test fixture.
  const notIn = (excl: string[]) => (a: string, i = 0) =>
    PEOPLE.filter(p => p.affiliation === a && !excl.includes(p.id))[i]!;

  it('a set containing an Iceden member wins back a REVEALED informant, free', () => {
    const s = hackerReady();
    s.detective.informants.push(
      { person_id: 'rust', revealed: false },
      { person_id: 'wyrm', revealed: true },
    );
    const pick = notIn(['rust', 'wyrm', 'blackice']);
    const trio = ['blackice', pick('corp_1').id, pick('none').id];
    (s.players['hak'] as any).hand = [...trio];
    const poiBefore = s.detective.poi_deck.length;
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    expect(s1.pending).toEqual({ type: 'informant_removal_pending', source_person: 'blackice', scope: 'revealed' });
    expect(s1.hacker.evidence.motive_set_1).toEqual(trio);
    // Offers: revealed names ONLY; ordinal picks rejected under revealed scope
    const offers = getLegalMoves(s1, 'hak');
    expect(offers).toHaveLength(1);
    expect(offers[0]!.description).toContain('Wyrm');
    expect(() => applyMove(s1, 'hak', { type: 'informant_removal_choice', target_informant: '1' })).toThrow();
    // Free: no extra card spent beyond the committed set
    const r = applyMove(s1, 'hak', { type: 'informant_removal_choice', target_informant: 'Wyrm' });
    expect(r.newState.detective.informants).toHaveLength(1);
    expect(r.newState.detective.poi_deck.length).toBe(poiBefore + 1);
    expect((r.newState.players['hak'] as { hand: string[] }).hand).toHaveLength(0);
  });

  it('no rider when no informant is revealed', () => {
    const s = hackerReady();
    s.detective.informants.push({ person_id: 'rust', revealed: false });
    const pick = notIn(['rust', 'sleet']);
    const trio = ['sleet', pick('corp_2').id, pick('none').id];
    (s.players['hak'] as any).hand = [...trio];
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    expect(s1.pending).toBeNull();
  });

  it('no rider for sets without an Iceden member', () => {
    const s = hackerReady();
    s.detective.informants.push({ person_id: 'wyrm', revealed: true });
    const pick = notIn(['wyrm']);
    const trio = [pick('gang_2').id, pick('corp_1').id, pick('none').id];
    (s.players['hak'] as any).hand = [...trio];
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    expect(s1.pending).toBeNull();
    expect(s1.detective.informants).toHaveLength(1);
  });

  it('rider is skipped when the set completes all Evidence (final guess first)', () => {
    const s = hackerReady();
    const byAff = (a: string, i: number) => PEOPLE.filter(p => p.affiliation === a)[i]!.id;
    s.hacker.evidence.weapon = true;
    s.hacker.evidence.witnesses = [byAff('none', 0), byAff('none', 1), byAff('none', 2)];
    s.hacker.evidence.motive_set_1 = [byAff('gang_2', 0), byAff('corp_1', 0), byAff('corp_2', 0)];
    s.hacker.evidence.motive_set_2 = [byAff('gang_3', 0), byAff('corp_1', 1), byAff('none', 3)];
    s.detective.informants.push({ person_id: 'wyrm', revealed: true });
    const trio = ['permafrost', byAff('corp_1', 2), byAff('corp_2', 1)];
    (s.players['hak'] as any).hand = [...trio];
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    expect(s1.pending?.type).toBe('endgame_final_guess');
    expect(s1.detective.informants).toHaveLength(1); // win back skipped
  });

  it('v2.1: each card of a set is informant-checked; ONE block bounces the WHOLE set', () => {
    const s = hackerReady();
    const pick = notIn([]);
    const g1 = pick('gang_1');
    const c1 = pick('corp_1');
    const n0 = pick('none');
    // Two of the three match facedown informants
    s.detective.informants.push(
      { person_id: g1.id, revealed: false },
      { person_id: c1.id, revealed: false },
    );
    const trio = [g1.id, c1.id, n0.id];
    (s.players['hak'] as any).hand = [...trio];
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    expect(s1.pending?.type).toBe('block_pending');
    expect(s1.activePlayerId).toBe('det');
    // Decline the first check → the SECOND matching card is offered
    const s2 = applyMove(s1, 'det', { type: 'block_decide', block: false }).newState;
    expect(s2.pending?.type).toBe('block_pending');
    expect((s2.pending as { person_id: string }).person_id).toBe(c1.id);
    // Accept the second → informant revealed, whole set stays in hand, clue owed
    const s3 = applyMove(s2, 'det', { type: 'block_decide', block: true }).newState;
    expect(s3.hacker.evidence.motive_set_1).toHaveLength(0);
    expect((s3.players['hak'] as { hand: string[] }).hand).toEqual(trio);
    expect(s3.detective.informants.find(i => i.person_id === c1.id)?.revealed).toBe(true);
    expect(s3.pending?.type).toBe('clue_reveal_pending');
    // Fresh run: declining BOTH checks commits the set
    const q = hackerReady();
    q.detective.informants.push(
      { person_id: g1.id, revealed: false },
      { person_id: c1.id, revealed: false },
    );
    (q.players['hak'] as any).hand = [...trio];
    let qs = applyMove(q, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    qs = applyMove(qs, 'det', { type: 'block_decide', block: false }).newState;
    qs = applyMove(qs, 'det', { type: 'block_decide', block: false }).newState;
    expect(qs.hacker.evidence.motive_set_1).toEqual(trio);
    expect((qs.players['hak'] as { hand: string[] }).hand).toHaveLength(0);
  });

  it('v2.1: a set with BOTH Anansi and an Iceden member chains the two riders', () => {
    const s = hackerReady();
    s.detective.informants.push(
      { person_id: 'rust', revealed: false },
      { person_id: 'wyrm', revealed: true },
      { person_id: 'zero_kelvin', revealed: true },
    );
    const pick = notIn(['rust', 'wyrm', 'zero_kelvin', 'blackice', 'anansi_the_spider']);
    const trio = ['anansi_the_spider', 'blackice', pick('corp_1').id];
    (s.players['hak'] as any).hand = [...trio];
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'motive', people: [...trio] }).newState;
    // Anansi's removal first (scope any), Iceden win-back queued
    expect(s1.pending?.type).toBe('informant_removal_pending');
    expect((s1.pending as { scope?: string }).scope).toBe('any');
    expect((s1.pending as { follow_up?: object }).follow_up).toEqual({ source_person: 'blackice', scope: 'revealed' });
    // Resolve Anansi's pick (facedown #1 = rust, unseen) → Iceden fires next
    const s2 = applyMove(s1, 'hak', { type: 'informant_removal_choice', target_informant: '1' }).newState;
    expect(s2.pending).toEqual({ type: 'informant_removal_pending', source_person: 'blackice', scope: 'revealed' });
    // Win back Wyrm — both riders resolved, 1 informant left
    const s3 = applyMove(s2, 'hak', { type: 'informant_removal_choice', target_informant: 'Wyrm' }).newState;
    expect(s3.pending).toBeNull();
    expect(s3.detective.informants).toHaveLength(1);
    expect(s3.detective.informants[0]!.person_id).toBe('zero_kelvin');
  });
});

// ---------------------------------------------------------------------------
// v2.3 privacy: nothing a human Hacker sees may leak a facedown informant
// (found by the designer's first human game, 2026-08-13: run_ai_turn relayed
// recruit targets, upkeep name-lists, and block-decline announcements)
// ---------------------------------------------------------------------------

describe('v2.3 jail rework: arrests stack in Booked and NEVER shift the track', () => {
  it('two arrests in one turn share slot 1; nobody advances or bump-releases', () => {
    const s = setupTwoAI(42);
    // Two populated locations on the board, prisoners mid-track
    const locs = LOCATIONS.filter(l => l.residents.length >= 1).slice(0, 2);
    s.detective.board.push(...locs.map(l => l.id));
    const early = PEOPLE.find(p => !locs.some(l => l.residents.includes(p.id)))!;
    s.detective.jail = [[], [], [early.id]]; // Release Pending
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== early.id);
    s.activePlayerId = 'det';
    s.detective.location_played_this_turn = true;
    s.detective.upkeep_paid = true;
    s.players['det']!.ap = 4;
    const a = locs[0]!.residents.find(id => s.detective.poi_deck.includes(id))!;
    const b = locs[1]!.residents.find(id => s.detective.poi_deck.includes(id) && id !== a)!;
    const s1 = applyMove(s, 'det', { type: 'arrest', target_person: getPerson(a)!.name }).newState;
    const s2 = applyMove(s1, 'det', { type: 'arrest', target_person: getPerson(b)!.name }).newState;
    // Both stacked in Booked; the Release Pending prisoner did NOT bump out
    expect(s2.detective.jail[0]).toEqual([a, b]);
    expect(s2.detective.jail[1]).toEqual([]);
    expect(s2.detective.jail[2]).toEqual([early.id]);
    expect(s2.detective.poi_deck).not.toContain(early.id);
    // Turn-end advances the stacks together and releases off Release Pending
    const s3 = applyMove(s2, 'det', { type: 'pass_turn' }).newState;
    expect(s3.detective.jail[0]).toEqual([]);
    expect(s3.detective.jail[1]).toEqual([a, b]);
    expect(s3.detective.jail[2]).toEqual([]);
    expect(s3.detective.poi_deck).toContain(early.id);
  });

  it('the arrest summary teaches the track (Booked, turn-end advance, release)', () => {
    const s = setupTwoAI(42);
    const loc = LOCATIONS.find(l => l.residents.length >= 1)!;
    s.detective.board.push(loc.id);
    s.activePlayerId = 'det';
    s.detective.location_played_this_turn = true;
    s.detective.upkeep_paid = true;
    s.players['det']!.ap = 4;
    const target = loc.residents.find(id => s.detective.poi_deck.includes(id))!;
    const r = applyMove(s, 'det', { type: 'arrest', target_person: getPerson(target)!.name });
    expect(r.summary).toContain('Booked (jail slot 1)');
    expect(r.summary).toContain('released after Release Pending (slot 3)');
  });
});

describe('v2.3: jail transitions ride the turn-ending move summary', () => {
  it('advances and releases are reported, never silently applied', () => {
    const s = setupTwoAI(42);
    const jailed = PEOPLE.find(p => !p.is_witness)!;
    s.detective.jail = [[jailed.id], [], []];
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== jailed.id);
    s.activePlayerId = 'det';
    s.detective.location_played_this_turn = true;
    s.detective.upkeep_paid = true;
    s.players['det']!.ap = 1;
    const session = {
      sessionId: 'jail-test', gameId: 'cybernoir-2127',
      players: [
        { player_id: 'det', kind: 'ai' as const, difficulty: 'hard' },
        { player_id: 'hak', kind: 'ai' as const, difficulty: 'hard' },
      ],
      activePlayerId: 'det', turnNumber: s.turn, gameState: s,
      createdAt: '', updatedAt: '', moveLog: [], undoStack: [],
    };
    // The Detective's turn-ending move must carry the jail advance
    const r = cybernoir2127.applyMove(session as never, 'det', { type: 'pass_turn' });
    expect(r.summary).toContain('Jail track:');
    expect(r.summary).toContain(`${jailed.name} advances to Processing (jail slot 2)`);
    expect(r.newState.gameState.detective.jail).toEqual([[], [jailed.id], []]);
    // Two more Detective turn-ends: slot 3, then released with the physical instruction
    const s3 = r.newState.gameState;
    s3.activePlayerId = 'det';
    s3.detective.location_played_this_turn = true;
    s3.detective.upkeep_paid = true;
    s3.players['det']!.ap = 1;
    const r2 = cybernoir2127.applyMove({ ...session, gameState: s3 } as never, 'det', { type: 'pass_turn' });
    expect(r2.summary).toContain(`${jailed.name} advances to Release Pending (jail slot 3)`);
    const s4 = r2.newState.gameState;
    s4.activePlayerId = 'det';
    s4.detective.location_played_this_turn = true;
    s4.detective.upkeep_paid = true;
    s4.players['det']!.ap = 1;
    const r3 = cybernoir2127.applyMove({ ...session, gameState: s4 } as never, 'det', { type: 'pass_turn' });
    expect(r3.summary).toContain(`${jailed.name} released from jail`);
    expect(r3.summary).toContain('return their POI card');
    expect(r3.newState.gameState.detective.poi_deck).toContain(jailed.id);
  });
});

describe('v2.3 response privacy (facedown informants never leak)', () => {
  it('tracked Detective recruits NAMELESS: engine picks secretly and deterministically', () => {
    const s = setupTwoAI(42);
    s.activePlayerId = 'det';
    s.players['det']!.ap = 4;
    s.detective.location_played_this_turn = true;
    s.detective.upkeep_paid = true;
    // v2.3: recruits are location-gated — put a populated location on the board
    const populated = LOCATIONS.find(l => l.residents.length >= 2)!;
    s.detective.board.push(populated.id);
    // The offer list has exactly one nameless recruit entry
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'recruit_informant');
    expect(offers).toHaveLength(1);
    expect((offers[0]!.move as { target_person?: string }).target_person).toBeUndefined();
    // Applying it recruits facedown; neither move nor summary carries a name
    const r = applyMove(s, 'det', { type: 'recruit_informant' });
    expect(r.newState.detective.informants).toHaveLength(1);
    expect(r.newState.detective.informants[0]!.revealed).toBe(false);
    const recruited = getPerson(r.newState.detective.informants[0]!.person_id)!;
    expect(r.summary).not.toContain(recruited.name);
    // Deterministic: same state → same secret pick
    const r2 = applyMove(s, 'det', { type: 'recruit_informant' });
    expect(r2.newState.detective.informants[0]!.person_id).toBe(recruited.id);
    // A human Detective must still name their pick — a human decider (seat_kinds
    // records it) going nameless is rejected, regardless of trackedness.
    const q = setupTwoAI(42);
    q.detective.kind = 'opaque';
    q.seat_kinds = { det: 'human', hak: 'ai' };
    q.activePlayerId = 'det';
    q.players['det']!.ap = 4;
    q.detective.location_played_this_turn = true;
    q.detective.upkeep_paid = true;
    expect(() => applyMove(q, 'det', { type: 'recruit_informant' })).toThrow(/Name the person/);
    // …and a digital human (tracked seat, human decider) is rejected too.
    const d = setupTwoAI(42);
    d.seat_kinds = { det: 'human', hak: 'ai' };
    d.activePlayerId = 'det';
    d.players['det']!.ap = 4;
    d.detective.location_played_this_turn = true;
    d.detective.upkeep_paid = true;
    expect(() => applyMove(d, 'det', { type: 'recruit_informant' })).toThrow(/Name the person/);
  });

  it('tracked Detective upkeep speaks ordinals; the engine resolves them', () => {
    const s = setupTwoAI(42);
    const a = PEOPLE.find(p => p.is_witness)!;
    const b = PEOPLE.find(p => !p.is_witness)!;
    s.detective.informants.push(
      { person_id: a.id, revealed: false },
      { person_id: b.id, revealed: false },
    );
    s.activePlayerId = 'det';
    s.detective.location_played_this_turn = true;
    // Offered moves for the tracked seat carry NO facedown names
    const offers = getLegalMoves(s, 'det').filter(m => m.move.type === 'upkeep_choice');
    for (const o of offers) {
      const j = JSON.stringify(o.move);
      expect(j).not.toContain(a.name);
      expect(j).not.toContain(b.name);
    }
    // Ordinal resolution: keep "2" keeps b, releases a
    const r = applyMove(s, 'det', { type: 'upkeep_choice', keep: ['2'], release: ['1'] });
    expect(r.newState.detective.informants).toHaveLength(1);
    expect(r.newState.detective.informants[0]!.person_id).toBe(b.id);
    expect(r.newState.detective.poi_deck).toContain(a.id);
  });

  it('an AI Detective block decision resolves INLINE in the Hacker apply (no standing pending)', () => {
    const s = setupTwoAI(42);
    s.hacker.kind = 'opaque';
    // v2.4: the Witness piece is an atomic trio; the informant matches one of
    // the three, so the whole set rides on the block decision.
    const witnessTrio = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 3);
    const witnessTrioNames = witnessTrio.map(p => p.name);
    const witness = witnessTrio[0]!;
    s.detective.informants.push({ person_id: witness.id, revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = witnessTrio.map(p => p.id);
    const session = {
      sessionId: 'privacy-test', gameId: 'cybernoir-2127',
      players: [
        { player_id: 'det', kind: 'ai' as const, difficulty: 'hard' },
        { player_id: 'hak', kind: 'human' as const },
      ],
      activePlayerId: 'hak', turnNumber: s.turn, gameState: s,
      createdAt: '', updatedAt: '', moveLog: [], undoStack: [],
    };
    const r = cybernoir2127.applyMove(session as never, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: witnessTrioNames });
    // The human's single apply comes back with the AI's decision already made:
    // never a standing block_pending (its mere existence = "your card matched").
    expect(r.newState.gameState.pending?.type).not.toBe('block_pending');
    const blocked = r.newState.gameState.detective.informants[0]!.revealed;
    if (blocked) {
      // Block = a public physical reveal; announcing it is correct.
      expect(r.newState.gameState.hacker.evidence.witnesses).toHaveLength(0);
    } else {
      // Decline = invisible: the play just lands.
      expect(r.newState.gameState.hacker.evidence.witnesses).toEqual(witnessTrio.map(p => p.id));
      expect(r.summary.toLowerCase()).not.toContain('block');
    }
  });

  it('a declined block is INVISIBLE: no decline log, summary is the play itself', () => {
    const s = setupTwoAI(42);
    const witnessTrio = PEOPLE.filter(p => p.is_witness && p.ability === 'witness').slice(0, 3);
    const witnessTrioNames = witnessTrio.map(p => p.name);
    const witness = witnessTrio[0]!;
    s.detective.informants.push({ person_id: witness.id, revealed: false });
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as any).hand = witnessTrio.map(p => p.id);
    const s1 = applyMove(s, 'hak', { type: 'play_evidence', evidence_type: 'witness', people: witnessTrioNames }).newState;
    expect(s1.pending?.type).toBe('block_pending');
    const r = applyMove(s1, 'det', { type: 'block_decide', block: false });
    expect(r.newState.hacker.evidence.witnesses).toContain(witness.id);
    expect(r.summary.toLowerCase()).not.toContain('declin');
    expect(r.summary.toLowerCase()).not.toContain('block');
    const logText = JSON.stringify(r.newState.log).toLowerCase();
    expect(logText).not.toContain('declin');
    // The facedown informant stays facedown and unnamed in the summary.
    expect(r.newState.detective.informants[0]!.revealed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Burn the Safehouse (rules v1.7)
// ---------------------------------------------------------------------------

function hideoutLocationOf(s: CNState) {
  // v2.0: attributes are no longer unique (the Boonies twins) — resolve by
  // the stored id, attribute fallback only for states that predate it.
  if (s.hacker.hideout_location_id) return getLocation(s.hacker.hideout_location_id)!;
  return LOCATIONS.find(l =>
    l.borough === s.hacker.hideout!.borough &&
    l.population === s.hacker.hideout!.population &&
    l.affiliation === s.hacker.hideout!.affiliation)!;
}

function giveHackerTurn(s: CNState, ap = 3): CNState {
  s.activePlayerId = 'hak';
  s.players['hak']!.ap = ap;
  return s;
}

describe('Burn the Safehouse', () => {
  it('is offered to the Hacker at 3 AP and not after use', () => {
    const s = giveHackerTurn(setupTwoAI(42));
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(true);
    s.hacker.safehouse_burned = true;
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(false);
    s.hacker.safehouse_burned = false;
    s.players['hak']!.ap = 2;
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(false);
  });

  it('all-AI: relocates, rebuilds the deck, and spends 3 AP + the once-per-game use', () => {
    // 4 AP (as if Overclocked) so the turn does not auto-switch — the deck math
    // is checked before the Detective's next mandatory draw.
    const s = giveHackerTurn(setupWithHideout(42, 'Sewers'), 4);
    const oldLoc = hideoutLocationOf(s);
    expect(oldLoc.name).toBe('Sewers');
    // Seed a discard pile so the rebuild has something to fold back in
    const discarded = s.detective.location_deck.splice(0, 2);
    s.detective.location_discard.push(...discarded);
    const deckBefore = s.detective.location_deck.length;
    const discardBefore = s.detective.location_discard.length;

    const r = applyMove(s, 'hak', { type: 'burn_safehouse' });
    const s2 = r.newState;
    const newLoc = hideoutLocationOf(s2);
    expect(s2.hacker.safehouse_burned).toBe(true);
    expect(newLoc.id).not.toBe(oldLoc.id);
    // Deck = deck + discard + old card − new card
    expect(s2.detective.location_deck).toHaveLength(deckBefore + discardBefore);
    expect(s2.detective.location_deck).toContain(oldLoc.id);
    expect(s2.detective.location_deck).not.toContain(newLoc.id);
    expect(s2.detective.location_discard).toHaveLength(0);
    expect(s2.players['hak']!.ap).toBe(1); // 4 − 3
    // Second use rejected
    const s3 = giveHackerTurn(s2);
    expect(() => applyMove(s3, 'hak', { type: 'burn_safehouse' })).toThrow(/once per game/);
  });

  it('does not offer burn_safehouse when no relocation target exists (balance-gate find, seed 4124)', () => {
    const s = giveHackerTurn(setupTwoAI(42));
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(true);
    // Empty the pile: everything is in hand or on the board
    s.detective.board.push(...s.detective.location_deck, ...s.detective.location_discard);
    s.detective.location_deck = [];
    s.detective.location_discard = [];
    expect(getLegalMoves(s, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(false);
  });

  it('does not offer draw_extra_location on an empty tracked deck (balance-gate find, seed 2063)', () => {
    const s = setupTwoAI(42);
    s.detective.location_played_this_turn = true;
    s.players['det']!.ap = 4;
    expect(getLegalMoves(s, 'det').some(m => m.move.type === 'draw_extra_location')).toBe(true);
    s.detective.location_deck = [];
    expect(getLegalMoves(s, 'det').some(m => m.move.type === 'draw_extra_location')).toBe(false);
  });

  it('keeps the turn after a burn at 0 AP — free plays remain (matches the human burn_choice path)', () => {
    // A burn costs all 3 AP by definition, but Evidence plays and jailbreaks
    // are FREE, and the human path (burn → burn_choice pending) already keeps
    // the turn — the 2026-08-19 playtest finished burn-then-Weapon in one
    // turn. The direct-completion (all-AI) burn must play the same rule, or
    // the two seats play different games. Passing ends the turn as usual.
    const s = giveHackerTurn(setupTwoAI(42), 3);
    const s2 = applyMove(s, 'hak', { type: 'burn_safehouse' }).newState;
    expect(s2.activePlayerId).toBe('hak');
    expect(s2.players['hak']!.ap).toBe(0);
    const s3 = applyMove(s2, 'hak', { type: 'pass_turn' }).newState;
    expect(s3.activePlayerId).toBe('det');
  });

  it('rejects a burn with fewer than 3 AP', () => {
    const s = giveHackerTurn(setupTwoAI(42), 2);
    expect(() => applyMove(s, 'hak', { type: 'burn_safehouse' })).toThrow(/3 AP/);
  });

  it('clears ALL Clue tokens — truthful and Negative (v1.8)', () => {
    const s = giveHackerTurn(setupWithHideout(42, 'Sewers')); // downtown / 0 / gang_3
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    s.hacker.truthful_clues.population = true;
    s.hacker.truthful_values.population = 0;
    s.hacker.negative_clues.push('population_3', 'affiliation_corp_1');

    const r = applyMove(s, 'hak', { type: 'burn_safehouse' });
    const s2 = r.newState;
    // Every truthful token comes off the table; categories are buyable again
    expect(s2.hacker.truthful_clues).toEqual({ borough: false, population: false, affiliation: false });
    expect(s2.hacker.truthful_values).toEqual({});
    // All negative clues removed
    expect(s2.hacker.negative_clues).toHaveLength(0);
    expect(r.summary).toMatch(/Remove ALL truthful Clue tokens/);
    expect(r.summary).toMatch(/Remove ALL Negative Clue tokens/);
  });

  it('human Hacker: report_hideout stores the hideout and deals the AI Detective a 17-card deck', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'opaque' }, undefined, 42);
    expect(s0.phase).toBe('setup');
    expect(s0.detective.location_hand).toHaveLength(0);
    const s = applyMove(s0, 'hak', { type: 'report_hideout', location_name: 'Garbage Dump' }).newState;
    expect(s.phase).toBe('play');
    expect(s.hacker.hideout).toEqual({ borough: 'the_hive', population: 0, affiliation: 'none' });
    // 19 − 1 safehouse − 3 hand − 1 turn-1 draw = 14 (v2.0)
    expect(s.detective.location_hand).toHaveLength(4);
    expect(s.detective.location_deck).toHaveLength(14);
    expect(s.detective.location_deck).not.toContain('garbage_dump');
    expect(s.detective.location_hand).not.toContain('garbage_dump');
  });

  it('human Hacker: burn goes through burn_choice_pending and validates the pile', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'opaque' }, undefined, 42);
    const s1 = applyMove(s0, 'hak', { type: 'report_hideout', location_name: 'Garbage Dump' }).newState;
    const s = giveHackerTurn(s1);
    const r = applyMove(s, 'hak', { type: 'burn_safehouse' });
    expect(r.newState.pending?.type).toBe('burn_choice_pending');
    expect(r.newState.players['hak']!.ap).toBe(0);

    // The offered choices exclude the Detective's hand and the current hideout
    const offers = getLegalMoves(r.newState, 'hak');
    expect(offers.length).toBeGreaterThan(0);
    const offered = offers.map(m => (m.move as { new_location_name: string }).new_location_name);
    expect(offered).not.toContain('Garbage Dump');
    const handLocName = getLocation(r.newState.detective.location_hand[0]!)!.name;
    expect(offered).not.toContain(handLocName);

    // Picking a card from the Detective's hand is rejected
    expect(() => applyMove(r.newState, 'hak', { type: 'burn_choice', new_location_name: handLocName }))
      .toThrow(/not in the gathered pile/);
    // Picking the current hideout is rejected
    expect(() => applyMove(r.newState, 'hak', { type: 'burn_choice', new_location_name: 'Garbage Dump' }))
      .toThrow(/DIFFERENT location/);
    // A valid pick completes: old card back in the deck, new card out
    const validName = offered[0]!;
    const validId = resolveLocation(validName);
    const s2 = applyMove(r.newState, 'hak', { type: 'burn_choice', new_location_name: validName }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.hacker.safehouse_burned).toBe(true);
    expect(hideoutLocationOf(s2).id).toBe(validId);
    expect(s2.detective.location_deck).toContain('garbage_dump');
    expect(s2.detective.location_deck).not.toContain(validId);
  });

  it('AI Hacker vs human Detective: hand report flow (card stays in circulation)', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42);
    expect(s0.hideout_card_removed).toBe(false);
    const s1 = applyMove(s0, 'hak', { type: 'report_hideout', location_name: 'Sewers' }).newState;
    const s = giveHackerTurn(s1);
    // Put two locations on the board
    s.detective.board.push('shipyard', 'warehouse');

    const r = applyMove(s, 'hak', { type: 'burn_safehouse' });
    expect(r.newState.pending?.type).toBe('burn_hand_report_pending');
    expect(r.newState.activePlayerId).toBe('det');

    const hand = ['Trailer Towers', 'The Junction', 'Junktown'];
    const s2 = applyMove(r.newState, 'det', { type: 'report_location_hand', locations: hand }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.activePlayerId).toBe('hak');
    expect(s2.hacker.safehouse_burned).toBe(true);
    const newLoc = hideoutLocationOf(s2);
    expect(newLoc.id).not.toBe('sewers');
    expect(['shipyard', 'warehouse']).not.toContain(newLoc.id);
    expect(hand.map(resolveLocation)).not.toContain(newLoc.id);
  });

  it('AI Hacker vs human Detective: cancels with a refund when nothing is available', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42);
    const s1 = applyMove(s0, 'hak', { type: 'report_hideout', location_name: 'Sewers' }).newState;
    const s = giveHackerTurn(s1);
    // Board covers everything except the current hideout and 3 hand cards
    const handIds = ['trailer_towers', 'the_junction', 'junktown'];
    s.detective.board.push(...LOCATIONS.map(l => l.id).filter(id => id !== 'sewers' && !handIds.includes(id)));

    const r = applyMove(s, 'hak', { type: 'burn_safehouse' });
    const s2 = applyMove(r.newState, 'det', {
      type: 'report_location_hand',
      locations: ['Trailer Towers', 'The Junction', 'Junktown'],
    }).newState;
    expect(s2.pending).toBeNull();
    expect(s2.hacker.safehouse_burned).toBe(false);
    expect(s2.players['hak']!.ap).toBe(3); // refunded
    expect(s2.activePlayerId).toBe('hak');
  });

  it('AI Hacker setup: nameless report_hideout picks engine-side (no leak) and setup activates the Hacker', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42);
    // Setup must point at the seat that acts, or run_ai_turn can't drive it
    expect(s0.phase).toBe('setup');
    expect(s0.activePlayerId).toBe('hak');
    // The move carries no location — the engine picks
    const s1 = applyMove(s0, 'hak', { type: 'report_hideout' }).newState;
    expect(s1.phase).toBe('play');
    expect(s1.activePlayerId).toBe('det');
    expect(s1.hacker.hideout).not.toBeNull();
  });

  it('AI Hacker setup honors the seat strategy for the engine-side pick', () => {
    const s0 = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42, { hak: 'rush' });
    const s1 = applyMove(s0, 'hak', { type: 'report_hideout' }).newState;
    // rush policy picks a population-3 location (opening-hand advantage)
    expect(s1.hacker.hideout!.population).toBe(3);
  });

  it('report_hideout is Hacker-only, and a human Hacker must name it', () => {
    const mixed = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42);
    expect(() => applyMove(mixed, 'det', { type: 'report_hideout' })).toThrow(/Only the Hacker/);
    const humanHak = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'opaque' }, undefined, 42);
    expect(() => applyMove(humanHak, 'hak', { type: 'report_hideout' })).toThrow(/Name your hideout/);
  });

  it('tolerates pre-v1.7 sessions missing the new fields', () => {
    const s = giveHackerTurn(setupTwoAI(42)) as unknown as Record<string, unknown>;
    delete s.hideout_card_removed;
    delete (s.hacker as Record<string, unknown>).safehouse_burned;
    delete (s.detective as Record<string, unknown>).location_discard;
    const state = s as unknown as CNState;
    // Legal moves + a burn still work (fields defaulted on clone)
    expect(getLegalMoves(state, 'hak').some(m => m.move.type === 'burn_safehouse')).toBe(true);
    const s2 = applyMove(state, 'hak', { type: 'burn_safehouse' }).newState;
    expect(s2.hacker.safehouse_burned).toBe(true);
  });
});