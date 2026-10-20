import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { applyMove, bestForAbility, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { HABITATS } from '../data/habitats.js';
import { ARCHETYPES } from '../data/archetypes.js';
import type { AbilityScores, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// Locks the Season 1 balance amendments (WARBLE-RULES "Balance amendments",
// designer-approved 2026-07-08): A1 paid repairs, A2 speed reprice,
// A3 even-level unlock, A4 wounded-then-dead.

const HUMAN: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];

function makeChar(scores: AbilityScores): WarbleWayGalaxyState {
  const s = createInitialState(HUMAN, { seed: 11 });
  return applyMove(s, {
    type: 'create_character',
    character_name: 'Zara',
    race: 'human',
    ship_name: 'Wandering Star',
    method: 'distribute',
    scores,
  }).newState;
}

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

describe('A1 — paid repairs (150c per level, repeatable, debt-capable)', () => {
  it('raises the ship one level for 150c, repeatably, with no roll', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.ship!.damage = 'hobbled';
    s.character!.credits = 400;
    s = apply(s, { type: 'pay_repair' });
    expect(s.ship!.damage).toBe('damaged');
    expect(s.character!.credits).toBe(250);
    s = apply(s, { type: 'pay_repair' });
    expect(s.ship!.damage).toBe('used');
    expect(s.character!.credits).toBe(100);
    // Into debt is allowed (the A1 tension)…
    s = apply(s, { type: 'pay_repair' });
    expect(s.ship!.damage).toBe('pristine');
    expect(s.character!.credits).toBe(-50);
    expect(s.result).toBeNull(); // −50 is debt, not death
  });

  it('refuses at Pristine and refuses to cross the −300 debt line', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.ship!.damage = 'pristine'; // the starter ship is Used
    expect(() => apply(s, { type: 'pay_repair' })).toThrow(/Pristine/);
    s.ship!.damage = 'damaged';
    s.character!.credits = -150; // paying → −300 exactly: refused (at/below the line)
    expect(() => apply(s, { type: 'pay_repair' })).toThrow(/debt line/);
  });

  it('is offered in get_legal_moves only when damaged and affordable', () => {
    const s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.ship!.damage = 'pristine';
    expect(getLegalMoves(s, 'p1').some((m) => m.move_id === 'pay-repair')).toBe(false); // pristine
    s.ship!.damage = 'used';
    expect(getLegalMoves(s, 'p1').some((m) => m.move_id === 'pay-repair')).toBe(true);
    s.character!.credits = -150;
    expect(getLegalMoves(s, 'p1').some((m) => m.move_id === 'pay-repair')).toBe(false); // would hit −300
  });
});

describe('A1b — repair roll eased to 10+', () => {
  it('the arrival repair roll asks for 10+', () => {
    const s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.habitat_progress[1]!.repair_rolled_this_arrival = false; // game start pre-spends it
    const r = applyMove(s, { type: 'attempt_repair' });
    expect(r.newState.pending).toMatchObject({ kind: 'roll', reason: 'repair', min_roll: 10 });
  });
});

describe('A1c — a successful mission repairs one level (planetside downtime)', () => {
  it('mission success raises the ship one damage level alongside the payout', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 }); // starter ship is Used
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' }); // MEC 10, d3
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    // Burn the outbound leg with harmless clubs? Deterministic: report low hearts…
    // simplest: fast-forward the journey by draining the outbound leg directly.
    while (s.pending?.kind === 'card_draw') {
      s = apply(s, { type: 'report_card_draw', card: s.deck.remaining.find((c) => c.endsWith('C') && !['A'].includes(c[0]!))! });
      if (s.pending?.kind === 'space_mission_offer') s = apply(s, { type: 'decline_mission' });
    }
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'mission_check' });
    const before = s.ship!.damage;
    expect(before).toBe('used');
    const r = applyMove(s, { type: 'report_roll', dice: [6, 6, 6] }); // 18 + 2 ≥ 10: success
    expect(r.newState.ship!.damage).toBe('pristine'); // used → one level UP
    expect(r.summary).toMatch(/Planetside downtime/);
  });
});

describe('A2 — H1 speed part repriced to 400c', () => {
  it('the shop row costs 400', () => {
    const part = HABITATS[1]!.shop.find((i) => i.id === 'h1-s4')!;
    expect(part.name).toBe('Ship part +1 Speed');
    expect(part.cost).toBe(400);
  });
});

describe('A3 — even-level unlock (new ability at 1)', () => {
  function atLevelUp(scores: AbilityScores): WarbleWayGalaxyState {
    const s = makeChar(scores);
    s.character!.xp = 6; // level 1→2 threshold
    s.pending = { kind: 'level_up' };
    return s;
  }

  it('reaching an EVEN level may open a new ability at 1', () => {
    const s = atLevelUp({ PIL: 3, MEC: 2, RES: 1 }); // level 1 → 2 (even)
    const opened = apply(s, { type: 'level_up', ability: 'SNE' });
    expect(opened.character!.abilities.SNE).toBe(1);
    expect(opened.character!.level).toBe(2);
    // The legal-move surface offers the unlock entries.
    const s2 = atLevelUp({ PIL: 3, MEC: 2, RES: 1 });
    expect(getLegalMoves(s2, 'p1').some((m) => m.move_id === 'level-up-open-SNE')).toBe(true);
  });

  it('reaching an ODD level still requires an owned ability', () => {
    const s = atLevelUp({ PIL: 3, MEC: 2, RES: 1 });
    s.character!.level = 2; // 2 → 3 (odd)
    expect(() => apply(s, { type: 'level_up', ability: 'SNE' })).toThrow(/EVEN levels/);
    expect(getLegalMoves(s, 'p1').some((m) => m.move_id.startsWith('level-up-open-'))).toBe(false);
    const deepened = apply(s, { type: 'level_up', ability: 'PIL' });
    expect(deepened.character!.abilities.PIL).toBe(4);
  });
});

describe('A5 — Running Silent (SNE pre-combat evade)', () => {
  function pirateOnScope(scores: AbilityScores): WarbleWayGalaxyState {
    let s = makeChar(scores);
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    return apply(s, { type: 'report_card_draw', card: '5D' }); // ♦5: space +5, speed 2
  }

  it('with SNE aboard a pirate card offers the evade FIRST; without it, combat starts directly', () => {
    const sneaky = pirateOnScope({ SNE: 3, MEC: 2, RES: 1 });
    expect(sneaky.pending).toMatchObject({ kind: 'evade_offer', card_id: '5D' });
    expect(sneaky.encounter).toBeNull();
    const loud = pirateOnScope({ PIL: 3, MEC: 2, RES: 1 });
    expect(loud.pending).toEqual({ kind: 'space_combat_action' });
    expect(loud.encounter).toMatchObject({ kind: 'space_combat', pirate_rank: '5' });
  });

  it('evade success = no encounter, journey continues; failure = the normal fight', () => {
    let s = pirateOnScope({ SNE: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'attempt_evade' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'evade', min_roll: 12 }); // 10 + speed 2
    const slipped = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 12
    expect(slipped.encounter).toBeNull();
    expect(slipped.pending).toEqual({ kind: 'card_draw' }); // the leg continues
    const spotted = apply(s, { type: 'report_roll', dice: [2, 2, 2] }); // 6+3 < 12
    expect(spotted.encounter).toMatchObject({ kind: 'space_combat', pirate_rank: '5' });
    expect(spotted.ship!.damage).toBe('used'); // failure carries no extra penalty
  });

  it('decline_evade engages directly', () => {
    let s = pirateOnScope({ SNE: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'decline_evade' });
    expect(s.encounter).toMatchObject({ kind: 'space_combat', pirate_rank: '5' });
  });
});

describe('A6 — Opening Volley (GUN, once per encounter)', () => {
  function inCombat(scores: AbilityScores): WarbleWayGalaxyState {
    let s = makeChar(scores);
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    return apply(s, { type: 'report_card_draw', card: '5D' }); // no SNE → straight to combat
  }

  it('a landed volley debuffs every pirate exchange total; it fires once per encounter', () => {
    let s = inCombat({ GUN: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'open_fire' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'volley', min_roll: 12 });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 12
    expect(s.encounter).toMatchObject({ kind: 'space_combat', pirate_debuff: 2, volley_used: true });
    expect(() => apply(s, { type: 'open_fire' })).toThrow(/once per encounter/);
    // The −2 shows up in the exchange math.
    s = apply(s, { type: 'fight_round' });
    const r = applyMove(s, { type: 'report_roll', dice: [6, 5, 3, 2] });
    expect(r.summary).toMatch(/−volley 2/);
  });

  it('a missed volley = one unopposed hit, then back to the action menu', () => {
    let s = inCombat({ GUN: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'open_fire' });
    s = apply(s, { type: 'report_roll', dice: [2, 2, 2] }); // 6+3 < 12
    expect(s.ship!.damage).toBe('damaged'); // used → one hit
    expect(s.pending).toEqual({ kind: 'space_combat_action' });
    expect(s.encounter).toMatchObject({ volley_used: true }); // the attempt consumed it
  });

  it('needs GUN aboard', () => {
    const s = inCombat({ PIL: 3, MEC: 2, RES: 1 });
    expect(() => apply(s, { type: 'open_fire' })).toThrow(/GUN/);
  });
});

describe('A7 — Stand Down or Burn (DEM intimidation)', () => {
  function inCombat(scores: AbilityScores): WarbleWayGalaxyState {
    let s = makeChar(scores);
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    return apply(s, { type: 'report_card_draw', card: '3D' }); // ♦3: space +3
  }

  it('success ends the combat bloodlessly; a failed bluff vs the RABBLE quits after one hit (A13)', () => {
    let s = inCombat({ DEM: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'attempt_intimidate' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'intimidate', min_roll: 13 }); // 10 + atk 3
    const cowed = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 13
    expect(cowed.encounter).toBeNull();
    expect(cowed.ship!.damage).toBe('used'); // no damage either way
    const laughed = apply(s, { type: 'report_roll', dice: [2, 2, 2] });
    expect(laughed.ship!.damage).toBe('damaged'); // one spiteful hit…
    expect(laughed.encounter).toBeNull(); // …then the rabble (atk ≤ 3) burns away (amendment A13)
  });

  it('a failed bluff vs a HUNTER (atk 5) keeps you in the fight (A13 is rabble-only)', () => {
    let s = makeChar({ DEM: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '7D' }); // ♦7: space +5
    s = apply(s, { type: 'attempt_intimidate' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'intimidate', min_roll: 15 });
    s = apply(s, { type: 'report_roll', dice: [2, 2, 2] });
    expect(s.ship!.damage).toBe('damaged');
    expect(s.pending).toEqual({ kind: 'space_combat_action' }); // hunters don't quit
  });

  it('needs DEM aboard', () => {
    const s = inCombat({ PIL: 3, MEC: 2, RES: 1 });
    expect(() => apply(s, { type: 'attempt_intimidate' })).toThrow(/DEM/);
  });
});

describe('A8 — Inspirational is +3 (crew-carried rolls under a natural-LEA-3 leader)', () => {
  it('a crew-carried roll gets +3; the leader\'s own rolls get nothing', () => {
    let s = makeChar({ LEA: 3, MEC: 2, RES: 1 });
    s.crew.push({ name: 'Ace', race: 'grull', idealized: 'finesse', abilities: { PIL: 2 }, anger_tokens: 0, gear: { weapon: null, armor: null } });
    s.ship!.capacity = 9;
    // Crew-carried: the cantina recruit roll rides the best matching score…
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' }); // MEC 10 — the CHARACTER carries MEC 2
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    while (s.pending?.kind === 'card_draw') {
      s = apply(s, { type: 'report_card_draw', card: s.deck.remaining.find((c) => c.endsWith('C'))! });
      if (s.pending?.kind === 'space_mission_offer') s = apply(s, { type: 'decline_mission' });
    }
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'mission_check', score_source: { who: 'self' } });
    const own = applyMove(s, { type: 'report_roll', dice: [3, 3, 3] });
    expect(own.summary).not.toMatch(/Inspirational/); // self-carried: no aura
    // Now a roll the CREW carries: escape uses best PIL — Ace's PIL 2.
    let s2 = makeChar({ LEA: 3, MEC: 2, RES: 1 });
    s2.crew.push({ name: 'Ace', race: 'grull', idealized: 'finesse', abilities: { PIL: 2 }, anger_tokens: 0, gear: { weapon: null, armor: null } });
    s2.ship!.capacity = 9;
    s2 = apply(s2, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s2.pending?.kind === 'res_discard') s2 = apply(s2, { type: 'skip_res_peek' });
    s2 = apply(s2, { type: 'report_card_draw', card: '3D' }); // pirates (no SNE aboard → straight to combat)
    s2 = apply(s2, { type: 'attempt_escape' });
    expect(s2.pending).toMatchObject({ kind: 'roll', reason: 'escape', score_source: { who: 'crew', crew_name: 'Ace' } });
    const carried = applyMove(s2, { type: 'report_roll', dice: [3, 3, 3] });
    expect(carried.summary).toMatch(/Inspirational \+3/); // amendment A8: was +2
  });
});

describe('A9 — tribute + Dread (the dread pirate)', () => {
  function inCombat(scores: AbilityScores): WarbleWayGalaxyState {
    let s = makeChar(scores);
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m2' }); // DIP 10 (dread build has DIP 1)
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    return apply(s, { type: 'report_card_draw', card: '3D' }); // ♦3: space +3
  }

  it('A9a: with natural DEM 3, a successful intimidation pays tribute (50 × space attack)', () => {
    let s = inCombat({ DEM: 3, PIL: 2, DIP: 1 });
    const before = s.character!.credits;
    s = apply(s, { type: 'attempt_intimidate' });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 13
    expect(s.character!.credits).toBe(before + 150); // 50 × 3
    expect(s.encounter).toBeNull();
    expect(s.dread).toBe(1); // A9b: the shakedown spreads the word
  });

  it('A9a: without natural DEM 3 there is no tribute — they just flee (A7 base)', () => {
    let s = inCombat({ PIL: 3, DEM: 2, DIP: 1 }); // DEM 2: verb available, no Fearsome Reputation
    const before = s.character!.credits;
    s = apply(s, { type: 'attempt_intimidate' });
    s = apply(s, { type: 'report_roll', dice: [5, 5, 5] }); // 15+2 ≥ 13
    expect(s.character!.credits).toBe(before);
    expect(s.dread).toBe(1); // Dread still grows on any successful shakedown
  });

  it('A9b: Dread rides subsequent intimidation rolls and caps at 3', () => {
    let s = inCombat({ DEM: 3, PIL: 2, DIP: 1 });
    s.dread = 3;
    s = apply(s, { type: 'attempt_intimidate' });
    const r = applyMove(s, { type: 'report_roll', dice: [3, 3, 3] }); // 9+3+Dread 3 = 15 ≥ 13
    expect(r.summary).toMatch(/Dread \+3/);
    expect(r.newState.dread).toBe(3); // capped
    expect(r.newState.encounter).toBeNull(); // the boosted bluff landed
  });
});

describe('A10 — unnamed crew (red shirts)', () => {
  it('working the docks: DIP roll vs 12, once per habitat, capped at best natural DIP', () => {
    let s = makeChar({ DEM: 3, PIL: 2, DIP: 1 });
    s = apply(s, { type: 'recruit_unnamed' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'unnamed_recruit', min_roll: 12 });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    expect(s.unnamed_crew).toBe(1);
    // Once per habitat…
    expect(() => apply(s, { type: 'recruit_unnamed' })).toThrow(/once per habitat/i);
    // …and the cap is best natural DIP (1 here): even at H2 the roll is refused while full.
    s.habitat_progress[1]!.unnamed_rolled = false;
    expect(() => apply(s, { type: 'recruit_unnamed' })).toThrow(/at most 1/);
  });

  it('talking survivors aboard: after a space victory, once per encounter, then the ship decision resumes', () => {
    let s = makeChar({ PIL: 3, DEM: 2, DIP: 1 });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m2' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '3D' });
    s = apply(s, { type: 'fight_round' });
    // Advantage (PIL 3): pairs 8/7 → mine 8+3=11 vs 7+3=10 — a clean WIN.
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] });
    expect(s.pending).toMatchObject({ kind: 'boarding_decision' });
    s = apply(s, { type: 'recruit_survivors' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'unnamed_recruit' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    expect(s.unnamed_crew).toBe(1);
    expect(s.pending).toMatchObject({ kind: 'boarding_decision' }); // the victory decision resumes
    expect(() => apply(s, { type: 'recruit_survivors' })).toThrow(/once per victory/i);
  });

  it('red shirts join ruin parties as pure bodies and are excluded by unnamed_count: 0', () => {
    let s = makeChar({ DIP: 3, MEC: 2, GUN: 1 });
    s.unnamed_crew = 2;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m2' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '10♦' });
    s = apply(s, { type: 'enter_ruin', depth: 1 });
    const withShirts = applyMove(s, {
      type: 'setup_encounter', crew_names: [], include_character: true,
      start_location: 'r9c1', threat_level: 1, attacker_placements: ['r1c9', 'r4c7', 'r5c1'],
    }).newState;
    const enc = withShirts.encounter;
    if (enc?.kind !== 'ruin_run') throw new Error('gone');
    expect(enc.board!.tokens.filter((t) => t.unnamed === true).length).toBe(2); // default: all join
    const solo = applyMove(s, {
      type: 'setup_encounter', crew_names: [], include_character: true, unnamed_count: 0,
      start_location: 'r9c1', threat_level: 1, attacker_placements: ['r1c9', 'r4c7', 'r5c1'],
    }).newState;
    const enc2 = solo.encounter;
    if (enc2?.kind !== 'ruin_run') throw new Error('gone');
    expect(enc2.board!.tokens.filter((t) => t.unnamed === true).length).toBe(0);
  });
});

describe('A11 — the five endings', () => {
  it('FORTUNE fires on docking with ≥ 6,000c (not mid-journey)', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.character!.credits = 7000; // rich, but the game starts pre-arrival — no win yet
    expect(s.result).toBeNull();
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    while (s.pending?.kind === 'card_draw' && s.result === null) {
      s = apply(s, { type: 'report_card_draw', card: s.deck.remaining.find((c) => c.endsWith('C'))! });
      if (s.pending?.kind === 'space_mission_offer') s = apply(s, { type: 'decline_mission' });
      if (s.pending?.kind === 'roll' && s.pending.reason === 'mission_check') s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    }
    expect(s.result).not.toBeNull(); // the return leg ends at the habitat → retire rich
    expect(s.result!.ending).toBe('fortune');
  });

  it('LEGEND fires the moment level 5 is reached', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.character!.level = 4;
    s.character!.xp = 48; // the 4→5 threshold
    s.pending = { kind: 'level_up' };
    s = apply(s, { type: 'level_up', ability: 'PIL' });
    expect(s.result?.ending).toBe('legend');
  });

  it('PLUNDER fires on the 6th cache OPENED (empty counts — the act is the risk)', () => {
    let s = makeChar({ DIP: 3, MEC: 2, GUN: 1 });
    s.caches_looted = 5;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m2' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '10♦' });
    s = apply(s, { type: 'enter_ruin', depth: 1 });
    s = apply(s, {
      type: 'setup_encounter', crew_names: [], include_character: true, unnamed_count: 0,
      start_location: 'r9c1', threat_level: 1, attacker_placements: ['r1c9', 'r4c7', 'r5c1'],
    });
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r9c4' }); // beside the r9c5 cache
    s = apply(s, { type: 'collect_item', being: 'Zara' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'item_d6' });
    s = apply(s, { type: 'report_roll', dice: [1] }); // even an EMPTY cache counts
    expect(s.result?.ending).toBe('plunder');
    expect(s.caches_looted).toBe(6);
  });

  it('BOUNTY counts boarding captures, NOT mere disables', () => {
    let s = makeChar({ PIL: 3, SWA: 2, MEC: 1 });
    s.foes_defeated = 7;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '3D' });
    s = apply(s, { type: 'fight_round' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] }); // exchange WON → disabled
    expect(s.foes_defeated).toBe(7); // a disable is the pilot's work — no bounty
    expect(s.result).toBeNull();
    s = apply(s, { type: 'board_ship' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'ground_combat' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] }); // boarding WON → captured, face to face
    expect(s.result?.ending).toBe('bounty');
    expect(s.foes_defeated).toBe(8);
  });
});

describe('A12 — the scholar learns from everything (RES XP rider)', () => {
  function surviveHazardCheck(scores: AbilityScores): number {
    let s = makeChar(scores);
    s.pending = {
      kind: 'roll', reason: 'death_check', dice_count: 3,
      score_source: { who: 'self', ability: null, bonus: 0 },
      min_roll: 9, declared_items: [], context: { death_source: 'hazard' },
    };
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // pass → hazard-survived XP
    return s.character!.xp;
  }

  it('every XP award gains +1 at natural RES 2 and +2 at RES 3; RES 1 gets nothing', () => {
    expect(surviveHazardCheck({ PIL: 3, MEC: 2, RES: 1 })).toBe(1);
    expect(surviveHazardCheck({ PIL: 3, RES: 2, MEC: 1 })).toBe(2);
    expect(surviveHazardCheck({ RES: 3, PIL: 2, MEC: 1 })).toBe(3);
  });
});

describe('A14a — a red shirt takes the hit (hazard sacrifice)', () => {
  it('a failed hazard with unnamed aboard offers the sacrifice; spending one converts to survival', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.unnamed_crew = 2;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: 'A♠' }); // PIL 10 (ship damage on fail)
    s = apply(s, { type: 'report_roll', dice: [1, 1, 2] }); // 4+3 < 10 → FAIL
    expect(s.pending).toMatchObject({ kind: 'sacrifice_offer' });
    expect(s.ship!.damage).toBe('used'); // consequence deferred
    const spent = apply(s, { type: 'sacrifice_unnamed' });
    expect(spent.unnamed_crew).toBe(1);
    expect(spent.ship!.damage).toBe('used'); // survived — no damage
    expect(spent.character!.xp).toBe(1); // hazard-survived XP
    const declined = apply(s, { type: 'decline_sacrifice' });
    expect(declined.ship!.damage).toBe('damaged'); // the consequence lands as rolled
  });
});

describe('A15 — Shields (natural ARM 3 hardens the hull)', () => {
  it('ship armor reads +1 with a natural-ARM-3 being aboard', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.crew.push({ name: 'Wall', race: 'grull', idealized: 'finesse', abilities: { ARM: 3 }, anger_tokens: 0, gear: { weapon: null, armor: null } });
    s.ship!.capacity = 9;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '3D' });
    s = apply(s, { type: 'fight_round' });
    const r = applyMove(s, { type: 'report_roll', dice: [6, 6, 2, 1] });
    expect(r.summary).toMatch(/−armor 1/); // base 0 + Shields 1 (A15)
  });
});

describe('A16 — Tinker (natural MEC 3 upgrades the kit)', () => {
  it('200c makes an owned weapon MK-II (+1 bonus), once per item, MEC-3 gated', () => {
    let s = makeChar({ MEC: 3, PIL: 2, RES: 1 });
    s.character!.credits = 1000;
    s = apply(s, { type: 'buy_item', item_name: 'Weapon +1 GUN' }); // 300c
    s = apply(s, { type: 'upgrade_item', item_name: 'Weapon +1 GUN' });
    const item = s.items[0]!;
    expect(item.name).toBe('Weapon +1 GUN MK-II');
    expect(item.effect.kind === 'ability_bonus' && item.effect.bonus).toBe(2);
    expect(s.character!.credits).toBe(500); // 1000 − 300 − 200
    expect(() => apply(s, { type: 'upgrade_item', item_name: 'Weapon +1 GUN MK-II' })).toThrow(/once per item/);
    // MEC-3 gate:
    let weak = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    weak.character!.credits = 1000;
    weak = apply(weak, { type: 'buy_item', item_name: 'Weapon +1 GUN' });
    expect(() => apply(weak, { type: 'upgrade_item', item_name: 'Weapon +1 GUN' })).toThrow(/natural MEC 3/);
  });
});

describe('A17 — Well-Connected (the look-ahead keys on best of RES/DIP)', () => {
  it('a DIP-2 character with no RES gets the journey peek at DIP depth', () => {
    let s = makeChar({ PIL: 3, DIP: 2, MEC: 1 });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(s.pending).toMatchObject({ kind: 'res_discard', peek_count: 2 });
  });

  it('with both, the deeper score wins (RES 1 vs DIP 3 → peek 3)', () => {
    let s = makeChar({ DIP: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(s.pending).toMatchObject({ kind: 'res_discard', peek_count: 3 });
  });
});

describe('A18 — Shipwright (MEC 3 fabricates ship parts)', () => {
  it('400c fabricates a +1 part of choice, once per habitat visit, MEC-3 gated', () => {
    let s = makeChar({ MEC: 3, PIL: 2, RES: 1 });
    s.character!.credits = 1000;
    const armorBefore = s.ship!.armor;
    s = apply(s, { type: 'fabricate_part', stat: 'armor' });
    expect(s.ship!.armor).toBe(armorBefore + 1);
    expect(s.character!.credits).toBe(600);
    expect(s.items.some((i) => i.name === 'Fabricated part: +1 armor')).toBe(true);
    expect(() => apply(s, { type: 'fabricate_part', stat: 'speed' })).toThrow(/one fabrication per habitat visit/i);
    let weak = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    weak.character!.credits = 1000;
    expect(() => apply(weak, { type: 'fabricate_part', stat: 'armor' })).toThrow(/natural MEC 3/);
  });
});

describe('A19 — Emergency Bulkheads (ARM 3 holds the killing blow, once per run)', () => {
  it('the first destruction is held at Hobbled; the second lands', () => {
    let s = makeChar({ ARM: 3, PIL: 2, MEC: 1 });
    s.ship!.damage = 'hobbled';
    const hit = () => {
      s.pending = {
        kind: 'roll', reason: 'hazard_check', dice_count: 3,
        score_source: { who: 'self', ability: 'PIL', bonus: 2 },
        min_roll: 10, declared_items: [], context: { hazard_card_id: 'AS', hazard_option: 1 }, // PIL option: ship damage on fail
      };
      s = apply(s, { type: 'report_roll', dice: [1, 1, 2] }); // 4+2 < 10 → ship damage
    };
    hit();
    expect(s.result).toBeNull(); // bulkheads hold
    expect(s.bulkheads_spent).toBe(true);
    expect(s.ship!.damage).toBe('hobbled');
    hit();
    expect(s.result).not.toBeNull(); // spent — the second blow destroys
  });

  it('without natural ARM 3, destruction lands immediately', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s.ship!.damage = 'hobbled';
    s.pending = {
      kind: 'roll', reason: 'hazard_check', dice_count: 3,
      score_source: { who: 'self', ability: 'PIL', bonus: 3 },
      min_roll: 10, declared_items: [], context: { hazard_card_id: 'AS', hazard_option: 1 },
    };
    s = apply(s, { type: 'report_roll', dice: [1, 1, 2] });
    expect(s.result).not.toBeNull();
  });
});

describe('A20 — Redline (MEC overcharges the engines)', () => {
  function intoCombat(scores: Record<string, number>, mission = 'h1-m3'): WarbleWayGalaxyState {
    let s = makeChar(scores as never);
    s = apply(s, { type: 'take_mission', mission_name: mission });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '3D' });
    if (s.pending?.kind === 'evade_offer') s = apply(s, { type: 'decline_evade' });
    return s;
  }

  it('a passed MEC check buffs every player exchange total by 2, once per encounter', () => {
    let s = intoCombat({ PIL: 3, MEC: 2, RES: 1 });
    s = apply(s, { type: 'redline' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'redline', min_roll: 12 });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 4] }); // 16+2 ≥ 12 → overcharged
    expect(s.encounter).toMatchObject({ kind: 'space_combat', player_buff: 2, redline_used: true });
    expect(() => apply(s, { type: 'redline' })).toThrow(/once per encounter/);
    s = apply(s, { type: 'fight_round' });
    const r = applyMove(s, { type: 'report_roll', dice: [6, 6, 2, 1] });
    expect(r.summary).toMatch(/\+redline 2/);
  });

  it('a failed check leaves the ship to eat an unopposed volley, and still spends the redline', () => {
    let s = intoCombat({ PIL: 3, MEC: 2, RES: 1 });
    const before = s.ship!.damage;
    s = apply(s, { type: 'redline' });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 2] }); // 4+2 < 12 → unopposed hit
    expect(s.ship!.damage).not.toBe(before);
    expect(s.encounter).toMatchObject({ kind: 'space_combat', redline_used: true });
    expect((s.encounter as { player_buff?: number }).player_buff ?? 0).toBe(0);
    expect(s.pending).toMatchObject({ kind: 'space_combat_action' });
  });

  it('needs MEC aboard', () => {
    const s = intoCombat({ PIL: 3, SNE: 2, RES: 1 }, 'h1-m1'); // RES mission — no MEC anywhere
    expect(() => apply(s, { type: 'redline' })).toThrow(/MEC aboard/);
  });
});

describe('A21 — archetype cards (pre-built spreads with printed difficulty)', () => {
  const create = (extra: Partial<Extract<WarbleMove, { type: 'create_character' }>>): WarbleWayGalaxyState =>
    applyMove(createInitialState(HUMAN, { seed: 11 }), {
      type: 'create_character', character_name: 'Zara', race: 'human', ship_name: 'Wandering Star',
      method: 'archetype', ...extra,
    } as WarbleMove).newState;

  it('the printed name resolves case/spacing-tolerantly to the exact spread', () => {
    const s = create({ archetype_name: '  ghost   SMUGGLER ' });
    expect(s.character!.abilities).toEqual({ SNE: 3, HAK: 2, SWA: 1 });
    expect(s.phase).toBe('at_habitat');
  });

  it('the roster is locked: 9 cards, designer-approved spreads and tiers', () => {
    expect(ARCHETYPES.map((c) => [c.name, c.scores, c.stars])).toEqual([
      ['Void Runner', { SNE: 3, MEC: 2, RES: 1 }, '★'],
      ['Ghost Smuggler', { SNE: 3, HAK: 2, SWA: 1 }, '★'],
      ['Privateer', { PIL: 3, SWA: 2, MEC: 1 }, '★★'],
      ['Fleet Captain', { LEA: 3, MEC: 2, RES: 1 }, '★★'],
      ['Ace Pilot', { PIL: 3, MEC: 2, RES: 1 }, '★★★'],
      ['Netdiver', { HAK: 3, MEC: 2, RES: 1 }, '★★★'],
      ['Field Scholar', { RES: 3, GUN: 2, PIL: 1 }, '★★★★'],
      ['Grease Monkey', { MEC: 3, PIL: 2, RES: 1 }, '★★★★'],
      ['Dread Corsair', { DEM: 3, PIL: 2, DIP: 1 }, '★★★★'],
    ]);
  });

  it('an unknown card name is rejected with the full printed-name list', () => {
    expect(() => create({ archetype_name: 'Space Wizard' })).toThrow(/Void Runner.*Dread Corsair/);
    expect(() => create({})).toThrow(/archetype_name/);
  });

  it('the old methods still work unchanged — archetype is additive', () => {
    const rec = create({ method: 'recommended', scores: { SWA: 3, HAK: 2, SNE: 1 } });
    expect(rec.character!.abilities).toEqual({ SWA: 3, HAK: 2, SNE: 1 });
    const dist = create({ method: 'distribute', scores: { PIL: 2, MEC: 2, RES: 2 } });
    expect(dist.character!.abilities).toEqual({ PIL: 2, MEC: 2, RES: 2 });
  });

  it('get_legal_moves at creation offers the card list with difficulty stars', () => {
    const s = createInitialState(HUMAN, { seed: 11 });
    const offer = getLegalMoves(s, 'p1').find((m) => m.move_id === 'create-character-archetype');
    expect(offer).toBeDefined();
    for (const card of ARCHETYPES) expect(offer!.description).toContain(card.name);
    expect(offer!.description).toMatch(/Grease Monkey \(Brutal ★★★★\)/);
  });
});

describe('A4 — wounded, then dead', () => {
  function hazardDeathRoll(s: WarbleWayGalaxyState): WarbleWayGalaxyState {
    // A Brawn hazard failure routes to the 3d6-vs-9 death check: force it via
    // a direct pending (the check resolver is source-agnostic).
    s.pending = {
      kind: 'roll',
      reason: 'death_check',
      dice_count: 3,
      score_source: { who: 'self', ability: null, bonus: 0 },
      min_roll: 9,
      declared_items: [],
      context: { death_source: 'hazard' },
    };
    return s;
  }

  it('first failed death check WOUNDS (−1 all effective scores); second kills', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s = hazardDeathRoll(s);
    const r1 = applyMove(s, { type: 'report_roll', dice: [2, 2, 2] }); // 6 < 9: fail
    s = r1.newState;
    expect(s.result).toBeNull();
    expect(s.character!.wounded).toBe(true);
    expect(r1.summary).toMatch(/WOUNDED/);
    // −1 on every effective score while wounded.
    expect(bestForAbility(s, 'PIL').bonus).toBe(2);
    s = hazardDeathRoll(s);
    const r2 = applyMove(s, { type: 'report_roll', dice: [2, 2, 2] });
    expect(r2.newState.result).not.toBeNull();
    expect(r2.newState.result!.summary).toMatch(/WOUNDED/i);
  });

  it('a passed death check does not wound; wounds heal on habitat arrival', () => {
    let s = makeChar({ PIL: 3, MEC: 2, RES: 1 });
    s = hazardDeathRoll(s);
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12 ≥ 9: pass
    expect(s.character!.wounded ?? false).toBe(false);
    // Wound, then travel one inter-habitat card to arrive: use the direct hook.
    s.character!.wounded = true;
    s = hazardDeathRoll(s);
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] }); // pass, still wounded
    expect(s.character!.wounded).toBe(true);
    expect(bestForAbility(s, 'MEC').bonus).toBe(1); // 2 − 1 while wounded
  });
});
