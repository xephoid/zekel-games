import { describe, expect, it } from 'vitest';
import { applyMove, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { candidateLocations, chooseMove, detectiveCandidateLocations, parseStrategy, pickHideoutLocation, progressScore } from '../ai.js';
import { cybernoir2127 } from '../index.js';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { PEOPLE, LOCATIONS, getLocation, getPerson, WEAPON_ID } from '../data/index.js';
import type { CNState } from '../types.js';
import type { PlayerConfig } from '@zekel/game-kit';

function setupTwoAI(seed = 42): CNState {
  return createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, undefined, seed);
}

describe('block-aware Hacker (informant check applies to Evidence plays)', () => {
  function riskState(facedown: number): CNState {
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: ['Sewers'] }, 42);
    const p = s.players['hak']!;
    // v2.4: Witness evidence is an atomic trio — the Hacker needs all three
    // in hand for any witness Evidence play to be legal at all.
    if (p.kind === 'tracked') { p.hand = ['eddie_the_doorman', 'marisol_the_janitor', 'gus_the_noodle_guy']; p.hand_size = 3; }
    // Narrow the Detective's pool to 1 (borough + population revealed → Sewers)
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    s.hacker.truthful_clues.population = true;
    s.hacker.truthful_values.population = 0;
    s.hacker.safehouse_burned = true; // remove the burn escape so scores compare cleanly
    for (const id of ['zero_kelvin', 'permafrost', 'blackice', 'sleet', 'frostbyte'].slice(0, facedown)) {
      s.detective.informants.push({ person_id: id, revealed: false });
    }
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    return s;
  }

  it('hard defers a needed witness Evidence play under heavy informant density', () => {
    const risky = chooseMove(riskState(5), 'hak', 'hard');
    expect(risky.move.type).not.toBe('play_evidence');
    const safe = chooseMove(riskState(0), 'hak', 'hard');
    expect(safe.move.type).toBe('play_evidence');
  });

  it('the cautious lever freezes Evidence while ANY facedown informant is out; the default plays through', () => {
    // Wide pool, early game, no desperation — one facedown informant is enough
    // to freeze the human-playtest policy (measured as a trap; opt-in only).
    const s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: ['Sewers'] }, 42);
    const p = s.players['hak']!;
    // v2.4: Witness evidence is an atomic trio — the Hacker needs all three
    // in hand for any witness Evidence play to be legal at all.
    if (p.kind === 'tracked') { p.hand = ['eddie_the_doorman', 'marisol_the_janitor', 'gus_the_noodle_guy']; p.hand_size = 3; }
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    s.detective.informants.push({ person_id: 'zero_kelvin', revealed: false });
    const frozen = chooseMove(s, 'hak', 'hard', parseStrategy('cautious')); // hard = unsoftened policy (medium adds epsilon-noise)
    expect(frozen.move.type).not.toBe('play_evidence');
    // The adaptive default pays the small expected cost and plays through.
    const evPolicy = chooseMove(s, 'hak', 'hard');
    expect(evPolicy.move.type).toBe('play_evidence');
    // Cautious thaws once the informant is revealed — the freeze is about
    // UNKNOWN threats; a revealed informant is a known, per-person block
    // handled by the EV model (rulebook §6: revealed informants keep blocking).
    s.detective.informants[0]!.revealed = true;
    const thawed = chooseMove(s, 'hak', 'hard', parseStrategy('cautious'));
    expect(thawed.move.type).toBe('play_evidence');
  });
});

describe('medium epsilon-softening (ladder built down from the ceiling)', () => {
  it('medium diverges from hard on some seeded turns, never on pendings', () => {
    let diverged = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const s = setupTwoAI(seed);
      s.activePlayerId = 'hak';
      s.players['hak']!.ap = 3;
      const m = chooseMove(s, 'hak', 'medium');
      const h = chooseMove(s, 'hak', 'hard');
      if (JSON.stringify(m.move) !== JSON.stringify(h.move)) diverged++;
    }
    // ~25% softening over 40 seeds: expect some divergence, not total chaos
    expect(diverged).toBeGreaterThan(2);
    expect(diverged).toBeLessThan(30);
    // Pendings are never softened — forced choices stay sharp
    const s = setupTwoAI(7);
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = 'det';
    const m = chooseMove(s, 'det', 'medium');
    const h = chooseMove(s, 'det', 'hard');
    expect(m.move).toEqual(h.move);
  });
});

describe('setup pick privacy', () => {
  it('chooseMove returns a NAMELESS report_hideout (the pick must not ride in the move)', () => {
    const s = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 42);
    const r = chooseMove(s, 'hak', 'medium');
    expect(r.move.type).toBe('report_hideout');
    expect((r.move as { location_name?: string }).location_name).toBeUndefined();
    expect(r.narration).not.toMatch(/Downtown|Hive|Boonies|Sewers|Mall|Tower|Club|Alley|Station|Shipyard|Warehouse|Junktown|Junction|Furnace|Reserve|Apartments|Dump|Mel/);
  });
});

function setupWithHideout(seed: number, hideoutName: string): CNState {
  const s = setupTwoAI(seed);
  const loc = LOCATIONS.find(l => l.name === hideoutName)!;
  s.hacker.hideout = { borough: loc.borough, population: loc.population, affiliation: loc.affiliation };
  return s;
}

// ---------------------------------------------------------------------------
// parseStrategy
// ---------------------------------------------------------------------------

describe('parseStrategy', () => {
  it('maps canonical names and aliases', () => {
    expect(parseStrategy('denial')).toBe('denial');
    expect(parseStrategy('informants')).toBe('denial');
    expect(parseStrategy('clues')).toBe('deduction');
    expect(parseStrategy('arrests')).toBe('pressure');
    expect(parseStrategy('rush')).toBe('rush');
    expect(parseStrategy('disruption')).toBe('tempo');
    expect(parseStrategy('cycle')).toBe('engine');
  });

  it('undefined / unknown → adaptive default', () => {
    expect(parseStrategy(undefined)).toBeUndefined();
    expect(parseStrategy('')).toBeUndefined();
    expect(parseStrategy('banana')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Candidate-elimination model
// ---------------------------------------------------------------------------

describe('candidateLocations', () => {
  it('returns all 19 with no clues (v2.0)', () => {
    const s = setupTwoAI();
    expect(candidateLocations(s)).toHaveLength(19);
  });

  it('filters by a truthful borough value', () => {
    const s = setupTwoAI();
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    expect(candidateLocations(s)).toHaveLength(6);
  });

  it('filters by truthful borough + affiliation down to the unique location', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    s.hacker.truthful_clues.affiliation = true;
    s.hacker.truthful_values.affiliation = 'gang_1';
    const cands = candidateLocations(s);
    expect(cands).toHaveLength(1);
    expect(cands[0]!.name).toBe('The Back Alley');
  });

  it('excludes locations matching a negative clue', () => {
    const s = setupTwoAI();
    s.hacker.negative_clues = ['population_0', 'population_1'];
    const cands = candidateLocations(s);
    expect(cands.every(l => l.population >= 2)).toBe(true);
    expect(cands).toHaveLength(8); // 18 - 6 (pop0) - 4 (pop1)
  });
});

// ---------------------------------------------------------------------------
// progressScore (the shared eval scalar)
// ---------------------------------------------------------------------------

describe('progressScore', () => {
  it('Detective progress rises as candidates shrink', () => {
    const s = setupTwoAI();
    const before = progressScore(s, 'det');
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    const after = progressScore(s, 'det');
    expect(after).toBeGreaterThan(before);
  });

  it('Hacker progress rises with evidence cards', () => {
    const s = setupTwoAI();
    expect(progressScore(s, 'hak')).toBe(0);
    s.hacker.evidence.weapon = true;
    s.hacker.evidence.witnesses = ['a', 'b', 'c'];
    expect(progressScore(s, 'hak')).toBeCloseTo(4 / 13); // v1.9 (3 sets + gang cap): 13 evidence cards
  });
});

// ---------------------------------------------------------------------------
// Setup-choice policy (hideout = identity axis)
// ---------------------------------------------------------------------------

describe('pickHideoutLocation', () => {
  it('rush picks a pop-3 location', () => {
    const { loc } = pickHideoutLocation('rush', 1);
    expect(loc.population).toBe(3);
  });

  it('tempo picks a pop-0/1 location', () => {
    const { loc } = pickHideoutLocation('tempo', 1);
    expect(loc.population).toBeLessThanOrEqual(1);
  });

  it('adaptive default returns a real location', () => {
    const { loc } = pickHideoutLocation(undefined, 7);
    expect(LOCATIONS).toContainEqual(loc);
  });
});

// ---------------------------------------------------------------------------
// Pending-resolution policies
// ---------------------------------------------------------------------------

describe('Pending policies', () => {
  it('block_decide: blocks when a Witness is played', () => {
    const s = setupTwoAI(42);
    const witness = PEOPLE.find(p => p.is_witness)!;
    s.detective.informants.push({ person_id: witness.id, revealed: false });
    s.detective.poi_deck = s.detective.poi_deck.filter(id => id !== witness.id);
    s.activePlayerId = 'hak';
    s.players['hak']!.ap = 3;
    (s.players['hak'] as { hand: string[] }).hand = [witness.id];
    const s2 = applyMove(s, 'hak', { type: 'play_person', person_name: witness.name }).newState;
    expect(s2.pending?.type).toBe('block_pending');
    const pick = chooseMove(s2, 'det', 'medium');
    expect(pick.move.type).toBe('block_decide');
    expect((pick.move as { block: boolean }).block).toBe(true);
  });

  it('clue_reveal: picks the category leaving the largest candidate pool', () => {
    const s = setupWithHideout(42, 'The Back Alley'); // downtown / pop 2 / gang_1
    s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
    s.activePlayerId = 'hak';
    const pick = chooseMove(s, 'hak', 'medium');
    expect(pick.move.type).toBe('clue_reveal');
    // borough leaves 6, population leaves 4, affiliation leaves 3 → pick borough
    expect((pick.move as { category: string }).category).toBe('borough');
  });

  it('final_guess: picks the sole remaining candidate', () => {
    const s = setupWithHideout(42, 'The Back Alley');
    s.hacker.truthful_clues.borough = true;
    s.hacker.truthful_values.borough = 'downtown';
    s.hacker.truthful_clues.affiliation = true;
    s.hacker.truthful_values.affiliation = 'gang_1';
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = 'det';
    const pick = chooseMove(s, 'det', 'medium');
    expect(pick.move).toEqual({ type: 'final_guess', location_name: 'The Back Alley' });
  });

  it('discard_retrieval: retrieves a needed Witness', () => {
    const s = setupTwoAI(42);
    const witness = PEOPLE.find(p => p.is_witness)!;
    const other = PEOPLE.find(p => !p.is_witness && p.ability === 'hand_discard')!;
    s.hacker.contacts_discard = [other.id, witness.id];
    s.pending = { type: 'discard_retrieval_pending', source_person: 'kenji_watanabe' };
    s.activePlayerId = 'hak';
    const pick = chooseMove(s, 'hak', 'medium');
    expect(pick.move.type).toBe('discard_retrieval_choice');
    expect((pick.move as { target_card: string }).target_card).toBe(witness.name);
  });

  it('upkeep_choice: keeps the Witness informant, releases the low-value one', () => {
    const s = setupTwoAI(42);
    const witness = PEOPLE.find(p => p.is_witness)!;
    const vanilla = PEOPLE.find(p => !p.is_witness && p.ability === 'reveal_informant')!;
    s.detective.informants.push(
      { person_id: witness.id, revealed: false },
      { person_id: vanilla.id, revealed: false },
    );
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = applyMove(s, 'det', { type: 'play_location', location_name: locName }).newState;
    const pick = chooseMove(s1, 'det', 'medium');
    expect(pick.move.type).toBe('upkeep_choice');
    // v2.3 privacy: the tracked seat speaks in ORDINALS (witness = position 1,
    // vanilla = position 2) — facedown names never ride the move.
    const mv = pick.move as { keep: string[]; release: string[] };
    expect(mv.keep).toContain('1');
    expect(mv.keep).not.toContain('2');
    const carried = JSON.stringify(mv);
    expect(carried).not.toContain(witness.name);
    expect(carried).not.toContain(vanilla.name);
  });
});

// ---------------------------------------------------------------------------
// Setup phase + easy tier sanity
// ---------------------------------------------------------------------------

describe('chooseMove sanity', () => {
  it('setup phase: returns a nameless report_hideout (the engine picks the location)', () => {
    // The old contract ("naming a real location") was the leak: the move rides
    // the get_ai_move/run_ai_turn response, handing the client the AI's hideout.
    const s = createInitialState(['det', 'hak'], { det: 'opaque', hak: 'tracked' }, undefined, 5);
    expect(s.phase).toBe('setup');
    const pick = chooseMove(s, 'hak', 'medium');
    expect(pick.move.type).toBe('report_hideout');
    expect((pick.move as { location_name?: string }).location_name).toBeUndefined();
    // Applying it still yields a real hideout, chosen engine-side
    const s2 = applyMove(s, 'hak', pick.move).newState;
    expect(LOCATIONS.some(l =>
      l.borough === s2.hacker.hideout!.borough &&
      l.population === s2.hacker.hideout!.population &&
      l.affiliation === s2.hacker.hideout!.affiliation)).toBe(true);
  });

  it('easy tier returns a legal move', () => {
    const s = setupTwoAI(11);
    const pick = chooseMove(s, 'det', 'easy');
    const legal = getLegalMoves(s, 'det').map(lm => JSON.stringify(lm.move));
    expect(legal).toContain(JSON.stringify(pick.move));
  });

  it('the unsoftened policy never guesses blind (wide-open candidate pool)', () => {
    // hard = the pure policy; medium adds epsilon-noise and may legitimately
    // wander (that noise is the tier's design, not a policy bug).
    const s = setupTwoAI(42);
    const locName = getLocation(s.detective.location_hand[0]!)!.name;
    const s1 = applyMove(s, 'det', { type: 'play_location', location_name: locName }).newState;
    const pick = chooseMove(s1, 'det', 'hard');
    expect(pick.move.type).not.toBe('guess_location');
  });
});

// ---------------------------------------------------------------------------
// Determinism (runbook §8)
// ---------------------------------------------------------------------------

describe('AI determinism', () => {
  function playout(seed: number, difficulty: string): string[] {
    let s = createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, undefined, seed);
    const seq: string[] = [];
    for (let i = 0; i < 300 && s.phase !== 'game_over'; i++) {
      const r = chooseMove(s, s.activePlayerId, difficulty);
      seq.push(JSON.stringify(r.move));
      s = applyMove(s, s.activePlayerId, r.move).newState;
    }
    return seq;
  }

  it('identical seeds produce identical move sequences (medium)', () => {
    expect(playout(7, 'medium')).toEqual(playout(7, 'medium'));
  });

  it('identical seeds produce identical move sequences (easy)', () => {
    expect(playout(13, 'easy')).toEqual(playout(13, 'easy'));
  });

  it('different seeds produce different playouts', () => {
    expect(playout(7, 'medium')).not.toEqual(playout(8, 'medium'));
  });
});

// ---------------------------------------------------------------------------
// MCTS smoke — the hooks must not crash mid-rollout (pendings included)
// ---------------------------------------------------------------------------

describe('MCTS hooks', () => {
  const AI_ONLY: PlayerConfig[] = [
    { player_id: 'det', kind: 'ai', difficulty: 'medium' },
    { player_id: 'hak', kind: 'ai', difficulty: 'medium' },
  ];

  it('returns a legal move at a tiny budget', () => {
    const session = cybernoir2127.createSession(AI_ONLY, { seed: 42 });
    const result = chooseMoveMCTS(cybernoir2127, session, 'det', { budget_ms: 50, max_rollout_plies: 20, seed: 1 });
    const legal = getLegalMoves(session.gameState, 'det').map(lm => JSON.stringify(lm.move));
    expect(legal).toContain(JSON.stringify(result.move));
  });

  it('determinize produces a consistent state for both seats', () => {
    const session = cybernoir2127.createSession(AI_ONLY, { seed: 42 });
    let rngState = 12345;
    const rng = () => {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 0x100000000;
    };
    const d1 = cybernoir2127.determinize!(session, 'det', rng);
    expect(d1.gameState.hacker.hideout).not.toBeNull();
    expect(d1.gameState.hacker.contacts_deck.length + (d1.gameState.players['hak']!.hand_size)).toBeLessThanOrEqual(26); // 25 people + weapon (v2.0)
    const d2 = cybernoir2127.determinize!(session, 'hak', rng);
    expect(d2.gameState.detective.location_hand.length + d2.gameState.detective.location_deck.length).toBeLessThanOrEqual(18);
  });
});

// ---------------------------------------------------------------------------
// A/B strategy levers (playtest 2026-08-19): `patient` Detective + `escape`
// Hacker. Both are LEVERS — every test here also pins that the DEFAULT tier
// still shows the old behavior, so the measured baseline stays comparable.
// ---------------------------------------------------------------------------

describe('patient Detective lever (2026-08-19)', () => {
  function detTurnReady(s: CNState, ap = 4): CNState {
    s.activePlayerId = 'det';
    s.detective.location_played_this_turn = true;
    s.players['det']!.ap = ap;
    return s;
  }

  it('holds the mid-game guess at a pool of 2 (the default guesses); fires at exactly 1', () => {
    // Pool of exactly 2: the attribute twins — all three categories revealed
    // still leave both standing.
    const twin = LOCATIONS.find(l => l.name === 'Trailer Towers')!;
    const s2 = detTurnReady(createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: ['Trailer Towers'] }, 42));
    s2.hacker.truthful_clues = { borough: true, population: true, affiliation: true };
    s2.hacker.truthful_values = { borough: twin.borough, population: twin.population, affiliation: twin.affiliation };
    expect(candidateLocations(s2).length).toBe(2);
    // Since the 2026-08-19 promotion the DEFAULT holds at 2; the pre-promotion
    // greedy timing lives on as the `deduction` lever.
    expect(chooseMove(s2, 'det', 'hard').move.type).not.toBe('guess_location');
    expect(chooseMove(s2, 'det', 'hard', parseStrategy('patient')).move.type).not.toBe('guess_location');
    expect(chooseMove(s2, 'det', 'hard', parseStrategy('deduction')).move.type).toBe('guess_location');

    // Pool of exactly 1: "sure" — patient guesses (designer: sure = only 1 option).
    const s1 = detTurnReady(createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: ['Sewers'] }, 42));
    s1.hacker.truthful_clues.borough = true;
    s1.hacker.truthful_values.borough = 'downtown';
    s1.hacker.truthful_clues.population = true;
    s1.hacker.truthful_values.population = 0;
    expect(candidateLocations(s1).length).toBe(1);
    const pick = chooseMove(s1, 'det', 'hard', parseStrategy('patient'));
    expect(pick.move.type).toBe('guess_location');
    expect((pick.move as { location_name: string }).location_name).toBe('Sewers');
  });

  it('skips the wide-open early clue buy (kept as the deduction lever)', () => {
    const s = detTurnReady(setupTwoAI(42));
    s.detective.poi_deck = []; // no arrests/recruits — isolate the buy decision
    // The playtest turn-1 buy is no longer the default; `deduction` keeps it.
    expect(chooseMove(s, 'det', 'hard').move.type).not.toBe('buy_clue');
    expect(chooseMove(s, 'det', 'hard', parseStrategy('patient')).move.type).not.toBe('buy_clue');
    expect(chooseMove(s, 'det', 'hard', parseStrategy('deduction')).move.type).toBe('buy_clue');
  });

  it('never arrests a person already inside placed Evidence (the default does)', () => {
    let loc: (typeof LOCATIONS)[number] | undefined;
    let witId: string | undefined;
    for (const l of LOCATIONS) {
      const w = l.residents.find(r => getPerson(r)?.is_witness);
      if (w) { loc = l; witId = w; break; }
    }
    expect(loc).toBeDefined();
    const wits = PEOPLE.filter(p => p.is_witness && p.id !== witId).map(p => p.id);
    const s = detTurnReady(setupTwoAI(42));
    s.detective.board = [loc!.id];
    s.detective.poi_deck = [witId!];
    s.hacker.evidence.witnesses = [witId!, wits[0]!, wits[1]!]; // Witness piece PLACED, incl. the arrest target
    // A dead arrest was a bug, not a style — NO strategy makes it (the
    // playtest Detective spent four full turns on exactly this).
    expect(chooseMove(s, 'det', 'hard').move.type).not.toBe('arrest');
    expect(chooseMove(s, 'det', 'hard', parseStrategy('patient')).move.type).not.toBe('arrest');
    expect(chooseMove(s, 'det', 'hard', parseStrategy('pressure')).move.type).not.toBe('arrest');
  });

  it('final guess remembers a pinned pre-burn pool (the provably-wrong old hideout)', () => {
    const s = setupTwoAI(21);
    s.hacker.safehouse_burned = true;
    s.pending = { type: 'endgame_final_guess' };
    s.endgame_triggered = true;
    s.activePlayerId = 'det';
    // Pin the pre-burn pool to a location that IS in the Detective's current
    // candidate pool (the playtest AI guessed exactly such a location).
    const cands = detectiveCandidateLocations(s);
    expect(cands.length).toBeGreaterThanOrEqual(2);
    const pinned = cands[0]!;
    s.pre_burn_detective_pool = [pinned.id];
    // Pre-burn memory is DEFAULT behavior since the promotion.
    const pick = chooseMove(s, 'det', 'hard');
    expect(pick.move.type).toBe('final_guess');
    expect((pick.move as { location_name: string }).location_name).not.toBe(pinned.name);
    const patientPick = chooseMove(s, 'det', 'hard', parseStrategy('patient'));
    expect((patientPick.move as { location_name: string }).location_name).not.toBe(pinned.name);
  });
});

describe('escape Hacker lever (2026-08-19)', () => {
  function hakTurnReady(s: CNState, hand: string[], ap = 3): CNState {
    s.activePlayerId = 'hak';
    const p = s.players['hak']!;
    if (p.kind === 'tracked') { p.hand = hand; p.hand_size = hand.length; }
    s.players['hak']!.ap = ap;
    return s;
  }

  it('holds the Weapon while Evidence is incomplete (the default plays it)', () => {
    const s = hakTurnReady(setupTwoAI(42), [WEAPON_ID]);
    expect(chooseMove(s, 'hak', 'hard').move).toMatchObject({ type: 'play_evidence', evidence_type: 'weapon' });
    const escape = chooseMove(s, 'hak', 'hard', parseStrategy('escape'));
    expect(escape.move.type).not.toBe('play_evidence');
  });

  it('plays the full finisher: burn, then the Weapon, same turn — and the burn snapshots the pre-burn pool', () => {
    const wits = PEOPLE.filter(p => p.is_witness).map(p => p.id);
    const aff = (a: string) => PEOPLE.filter(p => !p.is_witness && p.affiliation === a).map(p => p.id);
    const s = hakTurnReady(setupTwoAI(42), [WEAPON_ID], 3);
    const ev = s.hacker.evidence;
    ev.witnesses = wits.slice(0, 3);
    ev.motive_set_1 = [wits[3]!, aff('corp_1')[0]!, aff('corp_2')[0]!];
    ev.motive_set_2 = [wits[4]!, aff('corp_1')[1]!, aff('gang_1')[0]!];
    ev.motive_set_3 = [aff('corp_2')[1]!, aff('gang_2')[0]!, aff('gang_3')[0]!];
    for (const set of [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3]) {
      for (const id of set) expect(id).toBeDefined();
    }
    // Move 1: the burn (2000 beats everything).
    const first = chooseMove(s, 'hak', 'hard', parseStrategy('escape'));
    expect(first.move.type).toBe('burn_safehouse');
    const s2 = applyMove(s, 'hak', first.move).newState;
    expect(s2.hacker.safehouse_burned).toBe(true);
    expect(Array.isArray(s2.pre_burn_detective_pool)).toBe(true); // engine snapshot for `patient`
    // Move 2: the free, unblockable Weapon at 0 AP — evidence complete, endgame fires.
    const second = chooseMove(s2, 'hak', 'hard', parseStrategy('escape'));
    expect(second.move).toMatchObject({ type: 'play_evidence', evidence_type: 'weapon' });
    const s3 = applyMove(s2, 'hak', second.move).newState;
    expect(s3.endgame_triggered).toBe(true);
    expect(s3.pending?.type).toBe('endgame_final_guess');
  });

  it('does not burn defensively once the mid-game guess is spent (the default does)', () => {
    // Pinned public pool of 2 (the twins), evidence far from done.
    const twin = LOCATIONS.find(l => l.name === 'Trailer Towers')!;
    const s = hakTurnReady(createInitialState(['det', 'hak'], { det: 'tracked', hak: 'tracked' }, { hideout: ['Trailer Towers'] }, 42), [], 3);
    s.hacker.truthful_clues = { borough: true, population: true, affiliation: true };
    s.hacker.truthful_values = { borough: twin.borough, population: twin.population, affiliation: twin.affiliation };
    expect(candidateLocations(s).length).toBe(2);
    expect(chooseMove(s, 'hak', 'hard').move.type).toBe('burn_safehouse'); // default: emergency burn
    // Guess NOT yet spent → escape also burns (the one emergency it honors).
    expect(chooseMove(s, 'hak', 'hard', parseStrategy('escape')).move.type).toBe('burn_safehouse');
    // Guess spent → only the final guess remains, and the finisher wipes it: hold.
    s.detective.mid_game_guess_spent = true;
    expect(chooseMove(s, 'hak', 'hard', parseStrategy('escape')).move.type).not.toBe('burn_safehouse');
  });
});
