import { describe, it, expect } from 'vitest';
import { PEOPLE, LOCATIONS, AFFILIATIONS, BOROUGHS, CLUE_TOKENS, EVIDENCE_SHAPE, EVIDENCE_TOTAL, getPerson, getLocation, WEAPON_ID, resolveAffiliation } from '../data/index.js';
import { cybernoir2127 } from '../index.js';

describe('affiliation real names (v1.9 cleanup)', () => {
  it('display names are the real faction names', () => {
    expect(AFFILIATIONS.map(a => a.name)).toEqual(
      ['None', 'OmniSuperUltra Corp', 'Shizuoka Inc', 'Iceden Collective', 'Crimson Clan', 'Chimera']);
  });

  it('legacy placeholder labels still resolve (aliases)', () => {
    expect(resolveAffiliation('Gang 1')).toBe('gang_1');
    expect(resolveAffiliation('corp 2')).toBe('corp_2');
    expect(resolveAffiliation('Iceden Collective')).toBe('gang_1');
    expect(resolveAffiliation('Crimson')).toBe('gang_2');
    expect(resolveAffiliation('gang_3')).toBe('gang_3');
  });

  it('every affiliation carries the category the Motive gang-cap rule needs', () => {
    expect(AFFILIATIONS.filter(a => a.category === 'gang').map(a => a.id)).toEqual(['gang_1', 'gang_2', 'gang_3']);
    expect(AFFILIATIONS.filter(a => a.category === 'corp').map(a => a.id)).toEqual(['corp_1', 'corp_2']);
  });
});

describe('Cybernoir 2127 data integrity', () => {
  it('has exactly 25 people (v2.0: + Anansi the Spider)', () => {
    expect(PEOPLE).toHaveLength(25);
  });

  it('has exactly 19 locations (v2.0: + Little Ghana)', () => {
    expect(LOCATIONS).toHaveLength(19);
  });

  it('has exactly 6 affiliations', () => {
    expect(AFFILIATIONS).toHaveLength(6);
  });

  it('has exactly 3 boroughs', () => {
    expect(BOROUGHS).toHaveLength(3);
  });

  it('has exactly 13 clue tokens (3 borough + 4 population + 6 affiliation)', () => {
    expect(CLUE_TOKENS).toHaveLength(13);
    expect(CLUE_TOKENS.filter(t => t.type === 'borough')).toHaveLength(3);
    expect(CLUE_TOKENS.filter(t => t.type === 'population')).toHaveLength(4);
    expect(CLUE_TOKENS.filter(t => t.type === 'affiliation')).toHaveLength(6);
  });

  it('has correct ability distribution: 7 witnesses (one with remove_informant), 2 draw_3, 4 hand_discard, 3+3 board_discard, 3 reveal_informant, 3 discard_retrieval', () => {
    // v2.0: Anansi the Spider is is_witness with a real ability
    const witnesses = PEOPLE.filter(p => p.is_witness);
    expect(witnesses).toHaveLength(7);
    expect(witnesses.every(p => p.affiliation === 'none')).toBe(true);
    expect(PEOPLE.filter(p => p.ability === 'witness')).toHaveLength(6);
    expect(PEOPLE.filter(p => p.ability === 'remove_informant')).toHaveLength(1);
    expect(PEOPLE.find(p => p.ability === 'remove_informant')!.is_witness).toBe(true);

    expect(PEOPLE.filter(p => p.ability === 'draw_3')).toHaveLength(2);
    expect(PEOPLE.filter(p => p.ability === 'hand_discard')).toHaveLength(4);
    expect(PEOPLE.filter(p => p.ability === 'board_discard' && p.affiliation === 'gang_2')).toHaveLength(3);
    expect(PEOPLE.filter(p => p.ability === 'board_discard' && p.affiliation === 'gang_3')).toHaveLength(3);
    expect(PEOPLE.filter(p => p.ability === 'reveal_informant')).toHaveLength(3);
    expect(PEOPLE.filter(p => p.ability === 'discard_retrieval')).toHaveLength(3);
  });

  it('populations sum to 25 (the People count, v2.0)', () => {
    const totalPop = LOCATIONS.reduce((sum, l) => sum + l.population, 0);
    expect(totalPop).toBe(25);
  });

  it('resident affiliations tally correctly: None x6, Gang1 x6, Gang2 x3, Gang3 x3, Corp1 x3, Corp2 x3', () => {
    const tally: Record<string, number> = {};
    for (const loc of LOCATIONS) {
      for (const resId of loc.residents) {
        const p = getPerson(resId);
        expect(p, `Resident ${resId} not found in people`).toBeDefined();
        const aff = p!.affiliation;
        tally[aff] = (tally[aff] ?? 0) + 1;
      }
    }
    expect(tally['none']).toBe(7); // v2.0: + Anansi
    expect(tally['gang_1']).toBe(6);
    expect(tally['gang_2']).toBe(3);
    expect(tally['gang_3']).toBe(3);
    expect(tally['corp_1']).toBe(3);
    expect(tally['corp_2']).toBe(3);
  });

  it('each borough covers every affiliation; only the deliberate Boonies twin repeats (v2.0)', () => {
    for (const boroughId of ['downtown', 'the_hive', 'boonies'] as const) {
      const boroughLocs = LOCATIONS.filter(l => l.borough === boroughId);
      expect(boroughLocs).toHaveLength(boroughId === 'boonies' ? 7 : 6);
      const affs = boroughLocs.map(l => l.affiliation);
      const uniqueAffs = new Set(affs);
      expect(uniqueAffs.size).toBe(6);
      expect(affs).toContain('none');
      expect(affs).toContain('corp_1');
      expect(affs).toContain('corp_2');
      expect(affs).toContain('gang_1');
      expect(affs).toContain('gang_2');
      expect(affs).toContain('gang_3');
    }
  });

  it('population distribution is 0x6, 1x5 (v2.0: + Little Ghana), 2x4, 3x4', () => {
    const pops = LOCATIONS.map(l => l.population);
    expect(pops.filter(p => p === 0)).toHaveLength(6);
    expect(pops.filter(p => p === 1)).toHaveLength(5);
    expect(pops.filter(p => p === 2)).toHaveLength(4);
    expect(pops.filter(p => p === 3)).toHaveLength(4);
  });

  it('every person id is unique', () => {
    const ids = PEOPLE.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every location id is unique', () => {
    const ids = LOCATIONS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every person home_location matches a location name', () => {
    for (const p of PEOPLE) {
      const loc = LOCATIONS.find(l => l.name === p.home_location);
      expect(loc, `${p.name} home_location "${p.home_location}" not found`).toBeDefined();
    }
  });

  it('every location resident maps to a valid person', () => {
    for (const loc of LOCATIONS) {
      for (const resId of loc.residents) {
        const p = getPerson(resId);
        expect(p, `Location ${loc.name} resident ${resId} not found`).toBeDefined();
      }
    }
  });

  it('every person appears as a resident of their home location', () => {
    for (const p of PEOPLE) {
      const loc = LOCATIONS.find(l => l.name === p.home_location);
      expect(loc, `${p.name} home_location ${p.home_location} not found`).toBeDefined();
      expect(loc!.residents).toContain(p.id);
    }
  });

  it('has a Weapon card id', () => {
    expect(WEAPON_ID).toBe('__weapon__');
  });
});
describe('v2.0 twin pair (Little Ghana / Trailer Towers)', () => {
  it('the two share all three attributes — the only such pair', () => {
    const key = (l: { borough: string; population: number; affiliation: string }) =>
      `${l.borough}|${l.population}|${l.affiliation}`;
    const byKey: Record<string, string[]> = {};
    for (const l of LOCATIONS) (byKey[key(l)] ??= []).push(l.id);
    const twins = Object.values(byKey).filter(v => v.length > 1);
    expect(twins).toEqual([['trailer_towers', 'little_ghana']]);
  });
});

// ---------------------------------------------------------------------------
// The shape of the Hacker's win, published so a client can draw the case
// file's slots without counting them itself.
// ---------------------------------------------------------------------------

describe('evidence shape', () => {
  it('adds up to the thirteen cards that win the game', () => {
    expect(EVIDENCE_TOTAL).toBe(13);
    expect(EVIDENCE_SHAPE).toEqual({ weapon: 1, witnesses: 3, motive_sets: 3, motive_set_size: 3 });
  });

  it('is the same shape the engine checks a win against', () => {
    // engine.ts: weapon && witnesses >= 3 && motive_set_1..3 >= 3.
    const ev = {
      weapon: true,
      witnesses: Array.from({ length: EVIDENCE_SHAPE.witnesses }, (_, i) => `w${i}`),
      motive_set_1: Array.from({ length: EVIDENCE_SHAPE.motive_set_size }, (_, i) => `a${i}`),
      motive_set_2: Array.from({ length: EVIDENCE_SHAPE.motive_set_size }, (_, i) => `b${i}`),
      motive_set_3: Array.from({ length: EVIDENCE_SHAPE.motive_set_size }, (_, i) => `c${i}`),
      motive_set_4: [],
    };
    const cards = (ev.weapon ? 1 : 0) + ev.witnesses.length
      + ev.motive_set_1.length + ev.motive_set_2.length + ev.motive_set_3.length;
    expect(cards).toBe(EVIDENCE_TOTAL);
  });

  it('rides the reference data', () => {
    const rd = cybernoir2127.getReferenceData() as { evidence: Record<string, number> };
    expect(rd.evidence).toEqual({ weapon: 1, witnesses: 3, motive_sets: 3, motive_set_size: 3, total: 13 });
  });
});

// ---------------------------------------------------------------------------
// What a move costs, and what an ability does, are rules — so they live here
// and ride out as fields. Reported from play: buttons hid their price in a
// tooltip, and a card said "Hand Discard", which does not tell you enough to
// choose. A client must not parse a cost back out of a sentence.
// ---------------------------------------------------------------------------

describe('prices on legal moves', () => {
  function hackerToAct() {
    let s = cybernoir2127.createSession(
      [{ player_id: 'det', kind: 'human', table: 'digital' }, { player_id: 'hak', kind: 'human', table: 'digital' }],
      { detective: 'det', seed: 5 });
    s = cybernoir2127.applyMove(s, 'hak', { type: 'report_hideout', location_name: 'Shizuoka Megamall' }).newState;
    s.gameState.activePlayerId = 'hak';
    s.gameState.players['hak']!.ap = 3;
    return s;
  }

  it('prices every move it has a price for, in printed words', () => {
    const s = hackerToAct();
    const moves = cybernoir2127.getLegalMoves(s, 'hak');
    const byType = new Map(moves.map(m => [m.move.type, m.cost]));
    expect(byType.get('draw_contact')).toBe('1 AP');
    expect(byType.get('burn_safehouse')).toBe('3 AP, once per game');
    expect(byType.get('overclock')).toBe('free, once per turn, and gives the Detective 2 Location draws');
    expect(byType.get('pass_turn')).toBe('free; unspent AP is lost');
  });

  it('prices a person at what is printed on them', () => {
    const s = hackerToAct();
    for (const m of cybernoir2127.getLegalMoves(s, 'hak')) {
      if (m.move.type !== 'play_person') continue;
      const person = PEOPLE.find(p => p.name === (m.move as { person_name: string }).person_name)!;
      expect(m.cost).toBe(`${person.cost} AP`);
    }
  });

  it('says what each ability does, for every ability a person carries', () => {
    const rd = cybernoir2127.getReferenceData() as { abilities: { id: string; name: string; text: string }[] };
    const carried = new Set(PEOPLE.map(p => p.ability));
    for (const id of carried) {
      const a = rd.abilities.find(x => x.id === id);
      expect(a, `no line for ability ${id}`).toBeTruthy();
      expect(a!.text.length).toBeGreaterThan(10);
      expect(a!.name).not.toBe(a!.id);
    }
    // And nothing is published for an ability nobody has.
    for (const a of rd.abilities) expect(carried.has(a.id), `${a.id} is published but unused`).toBe(true);
  });
});
