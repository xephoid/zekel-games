import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { applyMove, createInitialState, inAttackRange, ruinMapForLevel } from '../engine.js';
import { warbleWayGalaxy } from '../index.js';
import type { AbilityScores, CrewMember, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// POST-PORT coverage suite: locks the implemented-but-previously-untested
// rules found by the two-pass traceability walk (POST-PORT.md §3 matrix).

const HUMAN: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];

function makeChar(scores: AbilityScores): WarbleWayGalaxyState {
  const s = createInitialState(HUMAN, { seed: 7 });
  return applyMove(s, {
    type: 'create_character',
    character_name: 'Zara',
    race: 'human',
    ship_name: 'Wandering Star',
    method: 'distribute',
    scores,
  }).newState;
}

function crew(name: string, abilities: AbilityScores): CrewMember {
  return { name, race: 'grull', idealized: 'finesse', abilities, anger_tokens: 0, gear: { weapon: null, armor: null } };
}

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

/** A ruin encounter with Zara parked at `cell` and A1 at `attackerCell`. */
function ruinDuel(scores: AbilityScores, cell: string, attackerCell: string, extraCrew: CrewMember[] = []): WarbleWayGalaxyState {
  let s = makeChar(scores);
  s.crew.push(...extraCrew);
  s.ship!.capacity = 9;
  const mission = (scores.MEC ?? 0) >= 1 ? 'h1-m3' : (scores.RES ?? 0) >= 1 ? 'h1-m1' : (scores.DIP ?? 0) >= 1 ? 'h1-m2' : 'h1-m5';
  s = apply(s, { type: 'take_mission', mission_name: mission });
  if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
  s = apply(s, { type: 'report_card_draw', card: '10♦' });
  s = apply(s, { type: 'enter_ruin', depth: 1 });
  s = apply(s, {
    type: 'setup_encounter',
    crew_names: extraCrew.map((c) => c.name),
    include_character: true,
    start_location: 'r9c1',
    threat_level: 1,
    attacker_placements: ['r1c2', 'r1c9', 'r4c7'],
  });
  const enc = s.encounter;
  if (enc?.kind !== 'ruin_run' || !enc.board) throw new Error('no board');
  enc.board.tokens.find((t) => t.is_character)!.cell = cell;
  enc.board.attackers[0]!.cell = attackerCell;
  return s;
}

describe('advanced-skill combat riders (WR §5)', () => {
  it('Reinforced Armor: the defender rolls a 5th die and adds ARM to the defense', () => {
    let s = ruinDuel({ ARM: 3, MEC: 2, GUN: 1 }, 'r3c1', 'r2c1');
    // End the character's turn → A1 (adjacent) attacks; defender has natural ARM 3.
    s = apply(s, { type: 'end_being_turn', being: 'Zara' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'ground_combat', dice_count: 5, context: { ground: 'ruin_defense', rider_dice: 1 } });
    // Pairs from [3,3,2,2]: 5/5; ARM basic → advantage? No SWA/Sniper → LOWER pair 5 + ARM 3 + rider 6 = 14 vs 5+5=10 → survive.
    s = apply(s, { type: 'report_roll', dice: [3, 3, 2, 2, 6] });
    expect(s.result).toBeNull();
    expect(s.crew).toHaveLength(0);
  });

  it('Sniper (natural GUN≥3) alone grants ground advantage and 2+GUN range', () => {
    let s = ruinDuel({ GUN: 3, MEC: 2, RES: 1 }, 'r7c1', 'r7c6'); // 5 apart on an open row
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    const r = applyMove(s, { type: 'attack', being: 'Zara', target: 'A1' }); // range 2+3=5 reaches
    expect(r.summary).toMatch(/HIGHER \(ground advantage\)/);
  });

  it('Personal Teleporter (natural RES≥3) moves through walls but lands legally', () => {
    let s = ruinDuel({ RES: 3, MEC: 2, PIL: 1 }, 'r3c1', 'r1c9');
    // r3c1 → r3c3 requires passing the wall at r3c2 — only a Teleporter can.
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r3c3' });
    const enc = s.encounter;
    if (enc?.kind !== 'ruin_run') throw new Error('gone');
    expect(enc.board!.tokens[0]!.cell).toBe('r3c3');
    // Still cannot END on a wall.
    expect(() => applyMove(s, { type: 'move_being', being: 'Zara', to: 'r3c2' })).toThrow(/wall or pit/);
  });

  it('Personal Cloaking (natural SNE≥3): attackers see no one and stay put', () => {
    let s = ruinDuel({ SNE: 3, MEC: 2, GUN: 1 }, 'r3c1', 'r2c1');
    const before = (s.encounter as { board: { attackers: Array<{ cell: string }> } }).board.attackers.map((a) => a.cell);
    const r = applyMove(s, { type: 'end_being_turn', being: 'Zara' });
    s = r.newState;
    const enc = s.encounter;
    if (enc?.kind !== 'ruin_run') throw new Error('gone');
    // Nobody attackable (Zara is cloaked and has not attacked) → no defense roll; round advances.
    expect(s.pending).toEqual({ kind: 'ruin_turn' });
    expect(enc.board!.round).toBe(2);
    expect(enc.board!.attackers.map((a) => a.cell)).toEqual(before); // all stayed
  });
});

describe('DIP conversion (WR §4)', () => {
  it('a passed DIP roll converts the attacker; they join as UNNAMED crew (amendment A10)', () => {
    let s = ruinDuel({ DIP: 3, MEC: 2, GUN: 1 }, 'r3c1', 'r2c1');
    s = apply(s, { type: 'convert_attacker', being: 'Zara', target: 'A1' });
    // Threat-1 A1 has Atk +5 → min 15; DIP is Moxie and no ACT aboard → 3d6.
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'recruit', min_roll: 15, dice_count: 3 });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] }); // 18+3 ≥ 15
    // A10 (rewrites clarification #4): a counter + a Red Shirt token — NOT a CrewMember.
    expect(s.unnamed_crew).toBe(1);
    expect(s.crew.length).toBe(0);
    const enc = s.encounter;
    if (enc?.kind !== 'ruin_run') throw new Error('gone');
    expect(enc.board!.tokens.some((t) => t.unnamed === true && t.name.startsWith('Red Shirt'))).toBe(true);
    expect(enc.board!.attackers[0]!.defeated).toBe(true);
    expect(s.character!.xp).toBe(0); // no XP for conversions
  });

  it('rejects conversion without DIP', () => {
    const s = ruinDuel({ SWA: 3, MEC: 2, GUN: 1 }, 'r3c1', 'r2c1');
    expect(() => applyMove(s, { type: 'convert_attacker', being: 'Zara', target: 'A1' })).toThrow(/needs Diplomacy/);
  });
});

describe('hazard carrier ownership (POST-PORT §5)', () => {
  it('the player picks WHOSE score carries a hazard — a crew carrier takes the Brawn death', () => {
    let s = makeChar({ RES: 3, SWA: 2, PIL: 1 });
    s.crew.push(crew('Bruiser', { SWA: 3 }));
    s.ship!.capacity = 9;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m1' });
    s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card: '3♠' }); // RES 10 / SWA 15 — both aboard
    s = apply(s, { type: 'choose_hazard_option', option: 2, carrier: 'Bruiser' });
    expect(s.pending).toMatchObject({ kind: 'roll', score_source: { who: 'crew', crew_name: 'Bruiser', bonus: 3 } });
    s = apply(s, { type: 'report_roll', dice: [2, 2, 2] }); // fail the SWA 15 → the CARRIER dies
    expect(s.crew).toHaveLength(0);
    expect(s.result).toBeNull(); // the character lives; +1 XP survived
    expect(s.character!.xp).toBe(3); // 1 + 2 (A12: RES-3 scholar bonus)
  });

  it('a forced-single option with several carriers still asks who carries it', () => {
    let s = makeChar({ PIL: 3, MEC: 2, GUN: 1 });
    s.crew.push(crew('Ace', { PIL: 2 }));
    s.ship!.capacity = 9;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: 'A♠' }); // PIL 10 / HAK 15 — only PIL aboard, but TWO carriers
    expect(s.pending).toMatchObject({ kind: 'hazard_option', must_fail: false });
    s = apply(s, { type: 'choose_hazard_option', option: 1, carrier: 'Ace' });
    expect(s.pending).toMatchObject({ kind: 'roll', score_source: { who: 'crew', crew_name: 'Ace' } });
  });
});

describe('space combat details (WR §12)', () => {
  function inCombat(scores: AbilityScores, card = '5D', extraCrew: CrewMember[] = []): WarbleWayGalaxyState {
    let s = makeChar(scores);
    s.crew.push(...extraCrew);
    s.ship!.capacity = 9;
    const mission = (scores.MEC ?? 0) >= 1 ? 'h1-m3' : 'h1-m5';
    s = apply(s, { type: 'take_mission', mission_name: mission });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' });
    s = apply(s, { type: 'report_card_draw', card });
    return s;
  }

  it('ship armor subtracts from the pirate total; a tie rerolls', () => {
    let s = inCombat({ PIL: 3, MEC: 2, LEA: 1 });
    s.ship!.armor = 1;
    s = apply(s, { type: 'fight_round' });
    // Pairs from [5,4,3,2]: 7/7 → tie is impossible here; craft: mine high 7+3=10 vs 7+3−1=9 → win.
    // For the tie: [6,5,2,2]: pairs 8/7 → mine 8+3=11 vs 7+3−1=9 → win. Use armor to force equality:
    // [6,3,3,1]: pairs 7/6 → mine 7+3=10 vs 6+3−1=8. Try [6,6,1,1]: pairs 7/7 → 7+3=10 vs 7+3−1=9.
    // Equality needs mine = theirs: pairA+3 = pairB+2 → pairB = pairA+1: [6,5,3,1]: pairs 7,8 → mine(high)=8+3=11, theirs 7+3−1=9. no.
    // mine low? we have advantage → high. high+3 = low+3-1 impossible (high ≥ low). So with armor 1 a tie cannot occur — assert the armor arithmetic instead.
    const r = applyMove(s, { type: 'report_roll', dice: [6, 6, 1, 1] });
    expect(r.summary).toMatch(/−armor 1 = 9/); // 7 + 3 − 1
  });

  it('a genuine tie rerolls the 4d6', () => {
    let s = inCombat({ MEC: 3, GUN: 2, SWA: 1 }); // no advantage → lower pair + 0 vs higher + 3
    s = apply(s, { type: 'fight_round' });
    // pairs must satisfy low + 0 == high + 3 → impossible; use ♦8? pirate +3 either way. Make totals equal:
    // low = high + 3 impossible, so tie needs equal pairs AND +0 vs +3 → no. Tie IS possible with advantage and no armor:
    let t = inCombat({ PIL: 3, MEC: 2, LEA: 1 });
    t = apply(t, { type: 'fight_round' });
    // advantage: mine high + 3 vs low + 3 → tie when pairs equal: [6,4,4,2]: pairs 8/8 → 11 vs 11 TIE.
    t = apply(t, { type: 'report_roll', dice: [6, 4, 4, 2] });
    expect(t.pending).toMatchObject({ kind: 'roll', reason: 'space_combat' }); // reroll owed
    expect(t.encounter).toMatchObject({ kind: 'space_combat', stage: 'choose_action' });
  });

  it('a crew-carried boarding loss kills the crew member, not the character (ruling #9)', () => {
    let s = inCombat({ PIL: 3, MEC: 2, LEA: 1 }, '2D', [crew('Bruiser', { SWA: 4 })]); // ♦2: ground +5
    const enc = s.encounter;
    if (enc?.kind !== 'space_combat') throw new Error('no combat');
    enc.stage = 'disabled';
    s.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
    s = apply(s, { type: 'board_ship' }); // best attack = Bruiser's SWA 4 → crew-carried
    expect(s.pending).toMatchObject({ kind: 'roll', score_source: { who: 'crew', crew_name: 'Bruiser' } });
    s = apply(s, { type: 'report_roll', dice: [6, 5, 3, 1] }); // mine 8+4=12 vs 7+5=12? tie... use [5,4,3,1]: pairs 6/7 → mine 7+4=11 vs 6+5=11 tie again.
    // dice [4,3,2,1]: pairs 5/5 → mine 5+4=9 vs 5+5=10 → LOSS.
    if (s.pending?.kind === 'roll' && s.pending.reason === 'ground_combat') {
      s = apply(s, { type: 'report_roll', dice: [4, 3, 2, 1] });
    }
    expect(s.crew).toHaveLength(0); // Bruiser died leading the boarding
    expect(s.result).toBeNull(); // the character never rolled a death check
    expect(s.pending).toEqual({ kind: 'boarding_decision', stage: 'board_or_leave' });
  });

  it('capturing a smaller ship than the party forces a release (WR §6)', () => {
    let s = inCombat({ PIL: 3, MEC: 2, LEA: 1 }, '3D', [crew('A', { SWA: 1 }), crew('B', { GUN: 1 }), crew('C', { RES: 1 })]);
    const enc = s.encounter;
    if (enc?.kind !== 'space_combat') throw new Error('no combat');
    enc.stage = 'captured';
    s.pending = { kind: 'boarding_decision', stage: 'take_or_abandon' };
    s = apply(s, { type: 'take_ship' }); // ♦3 capacity 3 < party of 4
    expect(s.pending).toEqual({ kind: 'release_crew' });
  });
});

describe('line of sight — the corner squeeze (WR §14)', () => {
  const map = ruinMapForLevel(1);
  it('a diagonal that grazes a wall corner is out of range (supercover)', () => {
    // R1 row 5: walls at c5-c8. Shooting r6c9 → r4c8 passes the corner of r5c8.
    expect(inAttackRange(map, 'r6c9', 'r4c8', 3)).toBe(false);
    // The mirrored open-corner diagonal is fine: r7c1 → r6c2 (nothing near).
    expect(inAttackRange(map, 'r7c1', 'r6c2', 2)).toBe(true);
  });
});

describe('misc coverage', () => {
  it('the solo session rejects any other player count', () => {
    expect(() => warbleWayGalaxy.createSession([], {})).toThrow(/exactly 1 player/);
    expect(() =>
      warbleWayGalaxy.createSession(
        [
          { player_id: 'a', kind: 'human' },
          { player_id: 'b', kind: 'ai' },
        ],
        {},
      ),
    ).toThrow(/exactly 1 player/);
  });

  it('cards resolve on an inter-habitat transfer leg exactly like mission legs (ruling #15a)', () => {
    let s = makeChar({ PIL: 3, MEC: 2, LEA: 1 });
    s.habitat_progress[1]!.missions_attempted = ['h1-m1', 'h1-m2', 'h1-m3', 'h1-m5'];
    s = apply(s, { type: 'depart_for_next_habitat' }); // distance 6, speed 0
    expect(s.pending).toEqual({ kind: 'card_draw' });
    s = apply(s, { type: 'report_card_draw', card: 'A♠' }); // hazard on a transfer leg
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'hazard_check' });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 10
    expect(s.pending).toEqual({ kind: 'card_draw' }); // the transfer continues
    expect(s.journey_stack[0]!.purpose).toMatchObject({ kind: 'habitat_transfer', to_habitat: 2 });
  });

  it('a third anger token makes a crew member leave WITH their equipped gear (WR §10)', () => {
    let s = makeChar({ PIL: 3, MEC: 2, LEA: 1 });
    s.crew.push({ ...crew('Grump', { GUN: 1 }), anger_tokens: 2, gear: { weapon: 'w1', armor: null } });
    s.items.push({ id: 'w1', name: 'Weapon +1 GUN', type: 'weapon', effect: { kind: 'ability_bonus', ability: 'GUN', bonus: 1 } });
    s.ship!.capacity = 9;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: '4♠' }); // ACT 10 / RES 15 — neither → must-fail
    s = apply(s, { type: 'choose_hazard_option', option: 1 }); // fail ACT → +1 anger each
    expect(s.crew).toHaveLength(0); // Grump hit 3 and left
    expect(s.items.find((i) => i.id === 'w1')).toBeUndefined(); // took the weapon
  });

  it('a failed ruin recruit closes the being spot for the encounter (WR §14)', () => {
    let s = ruinDuel({ SWA: 3, MEC: 2, GUN: 1 }, 'r5c1', 'r1c9');
    const enc = s.encounter;
    if (enc?.kind !== 'ruin_run') throw new Error('gone');
    s = apply(s, { type: 'recruit_at', being: 'Zara' }); // adjacent to B at r4c1
    s = apply(s, { type: 'report_roll', dice: [2] }); // K(M) 13 — Kralkin, no ACT → 3d6
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'recruit' });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 1] }); // fail
    const enc2 = s.encounter;
    if (enc2?.kind !== 'ruin_run') throw new Error('gone');
    expect(enc2.board!.closed_spots).toContain('r4c1');
    expect(s.crew).toHaveLength(0);
  });

  it('a truly cornered habitat (no legal action left) ends the run as MAROONED (clarification #9)', () => {
    // A Finesse-only pilot: qualifies for NO H1 ability mission; the ruins job
    // is spent; broke; every cantina row resolved but one.
    let s = makeChar({ PIL: 3, GUN: 2, SNE: 1 });
    s.character!.credits = 0;
    s.ship!.damage = 'pristine'; // amendment A1 offers paid repairs on a damaged ship — close that exit too
    const progress = s.habitat_progress[1]!;
    progress.missions_attempted = ['h1-m4'];
    progress.recruits_failed = ['h1-c1', 'h1-c2', 'h1-c3', 'h1-c4'];
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c5' }); // the last legal action
    const r = applyMove(s, { type: 'report_roll', dice: [1, 1, 2] }); // fail → nothing remains
    expect(r.newState.result).not.toBeNull();
    expect(r.newState.result!.summary).toMatch(/Marooned/i);
    expect(r.summary).toMatch(/MAROONED/);
  });

  it('an abandoned finale limps back to Habitat #3 and can be retried (WR §17)', () => {
    let s = makeChar({ SWA: 3, MEC: 2, GUN: 1 });
    s.current_habitat = 3;
    s = apply(s, { type: 'depart_for_next_habitat' });
    s = apply(s, {
      type: 'setup_encounter',
      crew_names: [],
      include_character: true,
      start_location: 'r9c1',
      threat_level: 1,
      attacker_placements: ['r1c2', 'r1c9', 'r4c7'],
    });
    s = apply(s, { type: 'escape_to_start', being: 'Zara' }); // standing on the start cell
    expect(s.phase).toBe('at_habitat');
    expect(s.current_habitat).toBe(3);
    const retry = apply(s, { type: 'depart_for_next_habitat' });
    expect(retry.phase).toBe('ruin');
  });
});
