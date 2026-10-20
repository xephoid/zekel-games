import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { applyMove, createInitialState } from '../engine.js';
import { warbleWayGalaxy } from '../index.js';
import type { AbilityScores, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// M2 (missions/travel/hazards/losses) + M3 (space combat) suite — every rule
// cites the frozen WARBLE-RULES.md (WR).

const HUMAN: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
const BOT: PlayerConfig[] = [{ player_id: 'bot', kind: 'ai', difficulty: 'medium' }];

function makeChar(scores: AbilityScores, method: 'recommended' | 'distribute' = 'recommended'): WarbleWayGalaxyState {
  const s = createInitialState(HUMAN, { seed: 7 });
  return applyMove(s, {
    type: 'create_character',
    character_name: 'Zara',
    race: 'human',
    ship_name: 'Wandering Star',
    method,
    scores,
  }).newState;
}

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

/** Default pilot-mechanic (no RES → no peek noise in travel tests). */
function pilot(): WarbleWayGalaxyState {
  return makeChar({ PIL: 3, MEC: 2, LEA: 1 });
}

/** Take the MEC 10 mission at Habitat #1 (distance 3): 3 outbound + 3 return cards. */
function onMission(state = pilot()): WarbleWayGalaxyState {
  return apply(state, { type: 'take_mission', mission_name: 'h1-m3' });
}

describe('take_mission (WR §7)', () => {
  it('deals both legs, marks the one-shot, and asks for the first card', () => {
    const s = onMission();
    expect(s.phase).toBe('traveling');
    expect(s.pending).toEqual({ kind: 'card_draw' });
    expect(s.journey_stack).toHaveLength(2);
    expect(s.journey_stack[1]).toMatchObject({ purpose: { kind: 'mission_outbound', mission_id: 'h1-m3' }, cards_remaining: 3 });
    expect(s.journey_stack[0]).toMatchObject({ purpose: { kind: 'mission_return', mission_id: 'h1-m3' }, cards_remaining: 3 });
    expect(s.habitat_progress[1]!.missions_attempted).toContain('h1-m3');
    expect(() => applyMove(pilot(), { type: 'take_mission', mission_name: 'h1-m1' })).toThrow(/nobody aboard has RES/i);
  });

  it('ship speed reduces the cards per direction; speed ≥ distance skips straight to arrival (WR §7)', () => {
    const s = pilot();
    s.ship!.speed = 5; // > distance 3
    const t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(t.pending).toMatchObject({ kind: 'roll', reason: 'mission_check', min_roll: 10 });
    expect(t.journey_stack).toHaveLength(1); // outbound popped instantly; return (0 cards) remains
  });

  it('a repeat attempt is rejected (ruling #7)', () => {
    const s = onMission();
    // finish nothing — the mark is at take time
    expect(() => applyMove({ ...s, phase: 'at_habitat', pending: null, journey_stack: [] }, { type: 'take_mission', mission_name: 'h1-m3' })).toThrow(
      /already attempted/,
    );
  });

  it('RES triggers the peek: report the discarded card, then the journey starts (WR §4)', () => {
    const s = makeChar({ RES: 2, MEC: 3, PIL: 1 }, 'distribute');
    const t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(t.pending).toEqual({ kind: 'res_discard', peek_count: 2 });
    const u = apply(t, { type: 'report_res_discard', card: '4D' });
    expect(u.deck.discard).toContain('4D');
    expect(u.pending).toEqual({ kind: 'card_draw' });
  });

  it('the RES peek is OPTIONAL — declining leaves the deck unread (WR §4; post-port §5)', () => {
    const s = makeChar({ RES: 2, MEC: 3, PIL: 1 }, 'distribute');
    const t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    const u = apply(t, { type: 'skip_res_peek' });
    expect(u.deck.discard).toHaveLength(0);
    expect(u.pending).toEqual({ kind: 'card_draw' });
    expect(() => applyMove(u, { type: 'skip_res_peek' })).toThrow(/No Research peek/);
  });
});

describe('the travel deck model (ruling #6)', () => {
  it('rejects an impossible duplicate with a table-check message', () => {
    let s = onMission();
    s = apply(s, { type: 'report_card_draw', card: '2H' }); // a recruit offer
    s = apply(s, { type: 'decline_recruit' });
    expect(() => applyMove(s, { type: 'report_card_draw', card: 'two of hearts' })).toThrow(/already in your discard/);
  });

  it('rejects an unreadable card with format examples', () => {
    const s = onMission();
    expect(() => applyMove(s, { type: 'report_card_draw', card: 'the blue one' })).toThrow(/seven of spades/);
  });

  it('an empty draw pile reshuffles the discards (ruling #6)', () => {
    let s = onMission();
    // Simulate a nearly-exhausted deck: everything but one card is discarded.
    s.deck.discard = s.deck.remaining.slice(1);
    s.deck.remaining = s.deck.remaining.slice(0, 1);
    const only = s.deck.remaining[0]!;
    expect(only).toBe('AH');
    const r = applyMove(s, { type: 'report_card_draw', card: only });
    s = r.newState; // A♥ = recruit offer
    s = apply(s, { type: 'decline_recruit' });
    // The next draw needed a reshuffle: ALL 52 discards fold back into the draw pile.
    expect(s.deck.remaining.length).toBe(52);
    expect(s.deck.discard.length).toBe(0);
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });
});

describe('♠ hazards (WR §10)', () => {
  it('one matching ability forces that option; a pass earns 1 XP (ruling #4)', () => {
    let s = onMission(); // PIL aboard; A♠ = PIL 10 / HAK 15
    s = apply(s, { type: 'report_card_draw', card: 'A♠' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'hazard_check', min_roll: 10, score_source: { ability: 'PIL', bonus: 3 } });
    s = apply(s, { type: 'report_roll', dice: [4, 3, 3] }); // 10+3 ≥ 10
    expect(s.character!.xp).toBe(1);
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });

  it('a failed Finesse hazard damages the ship; a hobbled ship is destroyed → GAME OVER', () => {
    let s = onMission();
    s = apply(s, { type: 'report_card_draw', card: 'A♠' });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 2] }); // 4+3 < 10 → ship damage
    expect(s.ship!.damage).toBe('damaged'); // used → damaged
    expect(s.character!.xp).toBe(1); // survived the consequence (ruling #4)

    let d = onMission();
    d.ship!.damage = 'hobbled';
    d = apply(d, { type: 'report_card_draw', card: 'A♠' });
    d = apply(d, { type: 'report_roll', dice: [1, 1, 2] });
    expect(d.result).not.toBeNull();
    expect(d.result!.summary).toMatch(/destroyed/i);
    expect(warbleWayGalaxy.isGameOver({ ...warbleWayGalaxy.createSession(HUMAN), gameState: d })?.winners).toEqual([]);
  });

});

describe('♠ hazard consequences by stat group', () => {
  function hazardState(scores: AbilityScores): WarbleWayGalaxyState {
    // RES 10 qualifies for h1-m1 (RES mission) — use RES chars for journeys here.
    const s = makeChar(scores, 'distribute');
    return apply(s, { type: 'take_mission', mission_name: 'h1-m1' });
  }

  it('both abilities aboard → the player chooses; Brawn failure → death check → WOUNDED, then dead (amendment A4)', () => {
    let s = hazardState({ RES: 3, SWA: 2, PIL: 1 }); // peek! RES 3 → res_discard first
    s = apply(s, { type: 'report_res_discard', card: 'KD' });
    s = apply(s, { type: 'report_card_draw', card: '3♠' }); // RES 10 / SWA 15
    expect(s.pending).toMatchObject({ kind: 'hazard_option', must_fail: false });
    s = apply(s, { type: 'choose_hazard_option', option: 2 }); // SWA 15 (death on fail)
    s = apply(s, { type: 'report_roll', dice: [2, 2, 2] }); // 6+2 < 15 → death check
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'death_check', min_roll: 9 });
    s = apply(s, { type: 'report_roll', dice: [2, 3, 3] }); // 8 < 9 → first failure WOUNDS (A4)
    expect(s.result).toBeNull();
    expect(s.character!.wounded).toBe(true);
    // A second failed death check while wounded kills.
    s.pending = {
      kind: 'roll', reason: 'death_check', dice_count: 3,
      score_source: { who: 'self', ability: null, bonus: 0 },
      min_roll: 9, declared_items: [], context: { death_source: 'hazard' },
    };
    s = apply(s, { type: 'report_roll', dice: [2, 3, 3] });
    expect(s.result?.summary).toMatch(/dies/i);
  });

  it('surviving the death check earns the hazard XP', () => {
    let s = hazardState({ RES: 3, SWA: 2, PIL: 1 });
    s = apply(s, { type: 'report_res_discard', card: 'KD' });
    s = apply(s, { type: 'report_card_draw', card: '3♠' });
    s = apply(s, { type: 'choose_hazard_option', option: 2 });
    s = apply(s, { type: 'report_roll', dice: [2, 2, 2] });
    s = apply(s, { type: 'report_roll', dice: [3, 3, 3] }); // 9 ≥ 9 → survive
    expect(s.result).toBeNull();
    expect(s.character!.xp).toBe(3); // 1 + 2 (A12: the RES-3 scholar learns from everything)
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });

  it('a failed Smarts hazard costs 100c; debt beyond 300c is GAME OVER (WR §10)', () => {
    let s = hazardState({ RES: 3, MEC: 2, PIL: 1 });
    s.character!.credits = -300; // owing exactly 300 is still alive (WR ruling)
    s = apply(s, { type: 'report_res_discard', card: 'KD' });
    s = apply(s, { type: 'report_card_draw', card: '2♠' }); // SNE 10 / RES 15 — only RES aboard → forced RES 15
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'hazard_check', min_roll: 15 });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 1] }); // fail → −100c → −400
    expect(s.result?.summary).toMatch(/debt/i);
  });

  it('neither ability → the player PICKS WHICH OPTION FAILS; Moxie = anger to each crew member', () => {
    let s = pilot(); // 4♠ = ACT 10 / RES 15 — has neither
    // Recruit a crew member first so unrest bites.
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c4' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: '4♠' });
    expect(s.pending).toMatchObject({ kind: 'hazard_option', must_fail: true });
    s = apply(s, { type: 'choose_hazard_option', option: 1 }); // fail ACT → crew unrest
    expect(s.crew[0]!.anger_tokens).toBe(1);
    expect(s.result).toBeNull();
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });
});

describe('♥ recruits and ♣ missions in space (WR §9, §7)', () => {
  it('a spacefaring recruit can be declined, or recruited without a permanent mark', () => {
    let s = onMission();
    s = apply(s, { type: 'report_card_draw', card: '7♥' }); // Human DEM+3, min 13
    expect(s.pending).toMatchObject({ kind: 'space_recruit_offer' });
    let d = apply(s, { type: 'decline_recruit' });
    expect(d.pending).toEqual({ kind: 'card_draw' });
    // Attempt: brawn (human) — nothing aboard → +0, need 13.
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'heart-7' });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 2] }); // fail — no mark anywhere
    expect(s.crew).toHaveLength(0);
    expect(s.habitat_progress[1]!.recruits_failed).toHaveLength(0);
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });

  it('an accepted ♣ mission SANDWICHES on top and resolves before the outer journey resumes (WR §7)', () => {
    let s = onMission(); // outer: h1-m3, 3+3
    s.ship!.speed = 3; // inner missions of distance ≤3 deal 0 cards → instant arrival
    s = apply(s, { type: 'report_card_draw', card: '9♣' }); // MEC 10 opt1 (distance 4) / ACT 15 opt2
    expect(s.pending).toMatchObject({ kind: 'space_mission_offer' });
    s = apply(s, { type: 'accept_mission', option: 1 }); // MEC 10, distance 4 − speed 3 = 1 card each way
    // Stack: [outer_return, outer_outbound(2 left), inner_return(1), inner_outbound(1)]
    expect(s.journey_stack).toHaveLength(4);
    expect(s.journey_stack[3]!.purpose).toMatchObject({ kind: 'mission_outbound', mission_id: 'club-9-1' });
    s = apply(s, { type: 'report_card_draw', card: '5♥' }); // inner outbound card → recruit offer
    s = apply(s, { type: 'decline_recruit' });
    // Inner outbound exhausted → inner mission check.
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'mission_check', context: { mission_id: 'club-9-1' } });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+2 ≥ 10 → success 250c
    expect(s.character!.credits).toBe(450);
    s = apply(s, { type: 'report_card_draw', card: '6♥' }); // inner return card
    s = apply(s, { type: 'decline_recruit' });
    // Inner done → outer outbound resumes (2 cards left).
    expect(s.journey_stack).toHaveLength(2);
    expect(s.journey_stack[1]!.purpose).toMatchObject({ kind: 'mission_outbound', mission_id: 'h1-m3' });
  });

  it('a ♣ ruins mission may be declined, or accepted (ungated — WR §7)', () => {
    let s = onMission();
    s = apply(s, { type: 'report_card_draw', card: 'K♣' }); // 16 R3 1800 4
    const declined = apply(s, { type: 'decline_mission' });
    expect(declined.pending).toEqual({ kind: 'card_draw' });
    const accepted = apply(s, { type: 'accept_mission', option: 1 });
    // 16 − speed 0 = 16 cards each way, sandwiched on top of the current journey.
    expect(accepted.journey_stack).toHaveLength(4);
    expect(accepted.journey_stack[3]).toMatchObject({ purpose: { kind: 'mission_outbound', mission_id: 'club-K' }, cards_remaining: 16 });
  });

  it('a ♦ ruins discovery may be skipped (entry lands with M4)', () => {
    let s = onMission();
    s = apply(s, { type: 'report_card_draw', card: '10♦' });
    expect(s.pending).toMatchObject({ kind: 'ruin_discovery', max_depth: 1 });
    s = apply(s, { type: 'skip_ruin' });
    expect(s.pending).toEqual({ kind: 'card_draw' });
  });
});

describe('mission arrival, payout & the return trip (WR §7)', () => {
  function arriveInstantly(scores: AbilityScores, missionId = 'h1-m3'): WarbleWayGalaxyState {
    const s = makeChar(scores, 'distribute');
    s.ship!.speed = 9;
    return apply(s, { type: 'take_mission', mission_name: missionId });
  }

  it('success pays credits + XP; failure pays nothing; the return leg always remains', () => {
    let s = arriveInstantly({ MEC: 3, PIL: 2, GUN: 1 });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 10
    expect(s.character!.credits).toBe(500);
    expect(s.character!.xp).toBe(1);
    expect(s.habitat_progress[1]!.missions_succeeded).toContain('h1-m3');
    // Return leg had 0 cards (speed 9) → straight back to the habitat, arrival flags reset.
    expect(s.phase).toBe('at_habitat');
    expect(s.habitat_progress[1]!.repair_rolled_this_arrival).toBe(false);

    let f = arriveInstantly({ MEC: 3, PIL: 2, GUN: 1 });
    f = apply(f, { type: 'report_roll', dice: [1, 1, 1] });
    expect(f.character!.credits).toBe(200);
    expect(f.habitat_progress[1]!.missions_succeeded).toHaveLength(0);
  });

  it('Silver Tongue doubles; Je ne sais quoi adds 100×ACT and compounds; ACT grants the Moxie die (WR §4-5)', () => {
    const s = makeChar({ DIP: 3, ACT: 3 }, 'distribute');
    s.ship!.speed = 9;
    let t = apply(s, { type: 'take_mission', mission_name: 'h1-m2' }); // DIP 10, 300c
    // DIP is a Moxie roll and ACT is aboard → 4d6 (WR §4, post-port fix).
    expect(t.pending).toMatchObject({ kind: 'roll', reason: 'mission_check', dice_count: 4 });
    t = apply(t, { type: 'report_roll', dice: [4, 4, 4, 1] }); // 13+3 ≥ 10
    // (300 + 100×3) × 2 = 1200
    expect(t.character!.credits).toBe(200 + 1200);
  });

  it('losing the qualifying ability by arrival is an automatic failure (WR §7)', () => {
    // Qualify via a crew member's MEC, then lose them mid-journey.
    let s = makeChar({ PIL: 3, GUN: 2, SWA: 1 });
    s.crew.push({
      name: 'Wrench', race: 'grull', idealized: 'finesse', abilities: { MEC: 2 }, anger_tokens: 0, gear: { weapon: null, armor: null },
    });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' }); // MEC via Wrench
    s.crew = []; // Wrench perishes off-screen (unit shortcut for a mid-journey death)
    s.journey_stack[1]!.cards_remaining = 1;
    const r = applyMove(s, { type: 'report_card_draw', card: '10♦' });
    const t = apply(r.newState, { type: 'skip_ruin' });
    // Outbound exhausted → arrival → nobody has MEC → auto-fail, straight onto the return leg.
    expect(r.summary + t.pending?.kind).toMatch(/./);
    expect(t.character!.credits).toBe(200);
    expect(t.journey_stack).toHaveLength(1);
    expect(t.journey_stack[0]!.purpose.kind).toBe('mission_return');
  });

  it('Ms/Mr Fix-it auto-repairs to Pristine on arrival (WR §5)', () => {
    const s = makeChar({ MEC: 3, PIL: 2, RES: 1 }, 'distribute');
    s.ship!.speed = 9; // zero-card journey — the RES peek is skipped (no cards to peek toward)
    s.ship!.damage = 'damaged';
    let t = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    expect(t.pending).toMatchObject({ kind: 'roll', reason: 'mission_check' });
    t = apply(t, { type: 'report_roll', dice: [4, 4, 4] }); // mission check success
    expect(t.phase).toBe('at_habitat');
    expect(t.ship!.damage).toBe('pristine');
  });
});

describe('habitat progression (WR §16)', () => {
  it('H1 requires 4 attempted missions before departing; the transfer is one-way', () => {
    const s = pilot();
    expect(() => applyMove(s, { type: 'depart_for_next_habitat' })).toThrow(/requires 4 missions/);
    s.habitat_progress[1]!.missions_attempted = ['h1-m1', 'h1-m2', 'h1-m3', 'h1-m5'];
    s.ship!.speed = 6; // distance 6 − 6 = 0 cards → instant arrival
    const t = apply(s, { type: 'depart_for_next_habitat' });
    expect(t.current_habitat).toBe(2);
    expect(t.phase).toBe('at_habitat');
    expect(t.journey_stack).toHaveLength(0);
    expect(t.habitat_progress[2]!.repair_rolled_this_arrival).toBe(false);
  });

  it('H3 departure launches the Season 1 finale ruin (ruling #16)', () => {
    const s = pilot();
    s.current_habitat = 3;
    const t = apply(s, { type: 'depart_for_next_habitat' });
    expect(t.phase).toBe('ruin');
    expect(t.encounter).toMatchObject({ kind: 'ruin_run', origin: { type: 'finale' }, target_depth: 3, level: 1 });
    expect(t.pending).toMatchObject({ kind: 'ruin_setup', level: 1 });
  });
});

describe('♦ space combat (WR §12)', () => {
  function inCombat(scores: AbilityScores = { PIL: 3, MEC: 2, LEA: 1 }, pirateCard = '5D'): WarbleWayGalaxyState {
    let s = makeChar(scores, Object.values(scores).reduce((a, b) => a + (b ?? 0), 0) === 6 && Object.values(scores).length === 3 && Object.values(scores).includes(3) ? 'recommended' : 'distribute');
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: pirateCard });
    return s;
  }

  it('a pirate draw opens combat with the full stat line in the summary', () => {
    let s = onMission();
    const r = applyMove(s, { type: 'report_card_draw', card: '5♦' });
    expect(r.summary).toMatch(/space combat bonus \+3.*ground combat \+1.*capacity 3.*min\. hacking 12/s);
    expect(r.newState.phase).toBe('space_combat');
    expect(r.newState.pending).toEqual({ kind: 'space_combat_action' });
  });

  it('escape: pass = clean getaway; fail = one damage then you escape anyway', () => {
    let s = inCombat();
    s = apply(s, { type: 'attempt_escape' }); // min 10+3=13; bonus handling 0 + PIL 3
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 = 15 ≥ 13
    expect(s.phase).toBe('traveling');
    expect(s.encounter).toBeNull();

    let f = inCombat();
    f = apply(f, { type: 'attempt_escape' });
    f = apply(f, { type: 'report_roll', dice: [1, 1, 1] }); // 3+3 < 13
    expect(f.ship!.damage).toBe('damaged');
    expect(f.phase).toBe('traveling'); // escaped anyway
  });

  it('fight with advantage: higher pair + PIL; win disables the pirate', () => {
    let s = inCombat(); // PIL 3 → advantage vs ♦5 (no special)
    s = apply(s, { type: 'fight_round' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] }); // pairs 7 and 8 → player 8+3=11 vs 7+3=10
    expect(s.encounter?.stage).toBe('disabled');
    expect(s.pending).toEqual({ kind: 'boarding_decision', stage: 'board_or_leave' });
    s = apply(s, { type: 'leave_pirate' });
    expect(s.phase).toBe('traveling');
  });

  it('losing an exchange with Flying Ace offers the once-per-combat reroll (WR §5)', () => {
    let s = inCombat(); // natural PIL 3 = Flying Ace
    s = apply(s, { type: 'fight_round' });
    s = apply(s, { type: 'report_roll', dice: [2, 1, 1, 1] }); // pairs 3, 2 → player high 3+3=6 vs 2+3=5... wins!
    // Pick dice that lose despite advantage: player high pair + 3 < pirate low + 3 is impossible... use ♦2 (+7): player 8+3=11 vs 7+7=14.
    let t = inCombat({ PIL: 3, MEC: 2, LEA: 1 }, '2D');
    t = apply(t, { type: 'fight_round' });
    t = apply(t, { type: 'report_roll', dice: [6, 6, 2, 1] }); // player 8+3=11 vs 7+7=14 → loss
    expect(t.encounter?.stage).toBe('loss_reroll_offer');
    const accepted = apply(t, { type: 'accept_result' });
    expect(accepted.ship!.damage).toBe('damaged');
    expect(accepted.encounter?.stage).toBe('choose_action');
    const rerolled = apply(t, { type: 'use_reroll' });
    expect(rerolled.encounter?.reroll_used).toBe(true);
    expect(rerolled.pending).toMatchObject({ kind: 'roll', reason: 'space_combat' });
  });

  it('without advantage you take the LOWER pair and add nothing', () => {
    let s = inCombat({ MEC: 3, GUN: 2, SWA: 1 }); // no PIL, no ship part
    s = apply(s, { type: 'fight_round' });
    s = apply(s, { type: 'report_roll', dice: [6, 5, 3, 1] }); // pairs 7, 8 → player 7 vs 8+3=11 → loss, no Flying Ace
    expect(s.ship!.damage).toBe('damaged');
    expect(s.encounter?.stage).toBe('choose_action');
  });

  it('pirate ♦4 cancels your space-combat advantage (interpretation, PORT-NOTES)', () => {
    let s = inCombat({ PIL: 3, MEC: 2, LEA: 1 }, '4D');
    const r = applyMove(s, { type: 'fight_round' });
    expect(r.summary).toMatch(/LOWER \(no advantage\)/);
  });

  it('pirate ♦8 trims your PIL bonus by 2 (interpretation, PORT-NOTES)', () => {
    let s = inCombat({ PIL: 3, MEC: 2, LEA: 1 }, '8D');
    const r = applyMove(s, { type: 'fight_round' });
    expect(r.summary).toMatch(/\+ PIL 1/);
  });

  it('hacking: success disables (+200c with Hackers Delight); failure = unopposed hit', () => {
    let s = inCombat({ HAK: 3, PIL: 2, MEC: 1 }); // ♦5 min hacking 12
    s = apply(s, { type: 'attempt_hack' });
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+3 ≥ 12
    expect(s.encounter?.stage).toBe('disabled');
    expect(s.character!.credits).toBe(400); // 200 + Hackers Delight 200

    let f = inCombat({ HAK: 3, PIL: 2, MEC: 1 });
    f = apply(f, { type: 'attempt_hack' });
    f = apply(f, { type: 'report_roll', dice: [1, 1, 1] });
    expect(f.ship!.damage).toBe('damaged');
    expect(f.encounter?.stage).toBe('choose_action');
  });

  it('boarding a disabled ship: win captures it; taking it arrives HOBBLED and abandons your parts (ruling #8)', () => {
    let s = inCombat({ PIL: 3, SWA: 2, MEC: 1 });
    // Give the ship a purchased part to prove it is abandoned with the hull.
    s.character!.credits = 1000;
    // (buy happens at habitat; simulate an installed part directly)
    s.items.push({ id: 'test-part', name: 'Ship part +1 Speed', type: 'ship_part', effect: { kind: 'ship_stat', stat: 'speed', bonus: 1 } });
    s.ship!.parts.push('test-part');
    s = apply(s, { type: 'fight_round' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] }); // win → disabled
    s = apply(s, { type: 'board_ship' }); // SWA 2 → ground advantage, +SWA 2
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1] }); // player 8+2=10 vs 7+1=8 → captured
    expect(s.encounter?.stage).toBe('captured');
    s = apply(s, { type: 'take_ship' });
    expect(s.ship).toMatchObject({ capacity: 3, speed: 2, handling: 0, damage: 'hobbled', parts: [] });
    expect(s.items.find((i) => i.id === 'test-part')).toBeUndefined();
    expect(s.phase).toBe('traveling');
  });

  it('a lost boarding forces the death check; surviving returns to the disabled ship (ruling #9)', () => {
    let s = inCombat({ PIL: 3, SWA: 2, MEC: 1 }, '2D'); // ♦2 ground +5
    s.encounter!.stage = 'disabled';
    s.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
    s = apply(s, { type: 'board_ship' });
    s = apply(s, { type: 'report_roll', dice: [6, 5, 3, 1] }); // player 8+2=10 vs 7+5=12 → loss
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'death_check' });
    s = apply(s, { type: 'report_roll', dice: [3, 3, 3] }); // 9 → survive
    expect(s.encounter?.stage).toBe('disabled');
    expect(s.pending).toEqual({ kind: 'boarding_decision', stage: 'board_or_leave' });
  });
});

describe('solvability bot: the full M1–M3 loop', () => {
  it('plays a long deterministic stretch without errors (until a loss or the M4 wall)', async () => {
    let session = warbleWayGalaxy.createSession(BOT, { seed: 1234 });
    let moves = 0;
    let stoppedAtM4 = false;
    for (let i = 0; i < 400; i++) {
      if (warbleWayGalaxy.isGameOver(session)) break;
      let pick;
      try {
        pick = await warbleWayGalaxy.getAIMove(session, 'bot');
      } catch (e) {
        expect(String(e)).toMatch(/M4/);
        stoppedAtM4 = true;
        break;
      }
      session = warbleWayGalaxy.applyMove(session, 'bot', pick.move).newState;
      moves++;
    }
    // The bot must have flown real missions: credits changed or the game ended or it hit the finale wall.
    const char = session.gameState.character!;
    const over = warbleWayGalaxy.isGameOver(session);
    expect(moves).toBeGreaterThan(20);
    expect(over !== null || stoppedAtM4 || char.credits !== 200 || char.xp > 0).toBe(true);
  });

  it('two bot runs with the same seed are identical', async () => {
    const run = async () => {
      let session = warbleWayGalaxy.createSession(BOT, { seed: 555 });
      const log: string[] = [];
      for (let i = 0; i < 60; i++) {
        if (warbleWayGalaxy.isGameOver(session)) break;
        let pick;
        try {
          pick = await warbleWayGalaxy.getAIMove(session, 'bot');
        } catch {
          break;
        }
        const r = warbleWayGalaxy.applyMove(session, 'bot', pick.move);
        log.push(r.summary);
        session = r.newState;
      }
      return log;
    };
    expect(await run()).toEqual(await run());
  });
});
