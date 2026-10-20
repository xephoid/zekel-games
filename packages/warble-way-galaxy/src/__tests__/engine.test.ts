import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { applyMove, createInitialState } from '../engine.js';
import { getLegalMoves } from '../legalMoves.js';
import { warbleWayGalaxy } from '../index.js';
import type { WarbleMove, WarbleWayGalaxyState } from '../types.js';

// M1 engine suite: creation, habitat actions, the shared check resolver, and
// pending hygiene — every rule cites the frozen WARBLE-RULES.md (WR).

const HUMAN: PlayerConfig[] = [{ player_id: 'p1', kind: 'human', name: 'Zeke' }];
const BOT: PlayerConfig[] = [{ player_id: 'bot', kind: 'ai', difficulty: 'medium' }];

function fresh(): WarbleWayGalaxyState {
  return createInitialState(HUMAN, { seed: 7 });
}

function created(): WarbleWayGalaxyState {
  return applyMove(fresh(), {
    type: 'create_character',
    character_name: 'Zara',
    race: 'human',
    ship_name: 'Wandering Star',
    method: 'recommended',
    scores: { PIL: 3, MEC: 2, LEA: 1 },
    disposition: 'brash',
  }).newState;
}

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

/** Simulate the state after a real arrival-after-travel: the once-per-arrival
 * repair/unrest rolls are AVAILABLE (game start pre-spends them, WR §6). */
function arrived(): WarbleWayGalaxyState {
  const s = created();
  s.habitat_progress[1]!.repair_rolled_this_arrival = false;
  s.habitat_progress[1]!.unrest_rolled_this_arrival = false;
  return s;
}

describe('character creation (WR §2)', () => {
  it('recommended method requires exactly 3/2/1', () => {
    const bad = { type: 'create_character', character_name: 'X', race: 'human', ship_name: 'Y', method: 'recommended' } as const;
    expect(() => applyMove(fresh(), { ...bad, scores: { PIL: 3, MEC: 3 } } as WarbleMove)).toThrow(/3, 2 and 1/);
    expect(() => applyMove(fresh(), { ...bad, scores: { PIL: 3, MEC: 2, LEA: 1, SNE: 1 } } as WarbleMove)).toThrow(/3, 2 and 1/);
  });

  it('distribute method spends exactly 6, max 3 per ability (ruling #1)', () => {
    const bad = { type: 'create_character', character_name: 'X', race: 'grull', ship_name: 'Y', method: 'distribute' } as const;
    expect(() => applyMove(fresh(), { ...bad, scores: { PIL: 4, MEC: 2 } } as WarbleMove)).toThrow(/Max 3 points/);
    expect(() => applyMove(fresh(), { ...bad, scores: { PIL: 3, MEC: 2 } } as WarbleMove)).toThrow(/exactly 6 points/);
    const ok = apply(fresh(), { ...bad, scores: { PIL: 2, MEC: 2, LEA: 2 } } as WarbleMove);
    expect(ok.phase).toBe('at_habitat');
  });

  it('starting resources: 200c, level 1, ship used/cap3/speed0 at Habitat #1', () => {
    const s = created();
    expect(s.character).toMatchObject({ credits: 200, level: 1, xp: 0, race: 'human', disposition: 'brash' });
    expect(s.ship).toMatchObject({ capacity: 3, speed: 0, handling: 0, armor: 0, damage: 'used' });
    expect(s.current_habitat).toBe(1);
  });

  it('an AI seat gets an empty checklist and creates its character via getAIMove (strategic pick)', async () => {
    const s = createInitialState(BOT, { seed: 1 });
    expect(s.phase).toBe('creation'); // creation is a getAIMove decision now (ai-development gate)
    const session = warbleWayGalaxy.createSession(BOT, { seed: 1 });
    expect(warbleWayGalaxy.getSetupChecklist(session)).toEqual([]); // all-AI: immediately playable
    const pick = await warbleWayGalaxy.getAIMove(session, 'bot', 'medium');
    expect(pick.move).toMatchObject({ type: 'create_character', scores: { PIL: 3, MEC: 2, RES: 1 } });
    // hard keeps the same proven creation core; its edge is policy (AI-NOTES §1).
    const hard = await warbleWayGalaxy.getAIMove(session, 'bot', 'hard');
    expect(hard.move).toMatchObject({ type: 'create_character', scores: { PIL: 3, MEC: 2, RES: 1 } });
    const easy = await warbleWayGalaxy.getAIMove(session, 'bot', 'easy');
    expect(easy.move).toMatchObject({ type: 'create_character' }); // random-but-valid 3/2/1
  });

  it('a human session starts in creation with a one-step checklist', () => {
    const session = warbleWayGalaxy.createSession(HUMAN, { seed: 1 });
    expect(session.gameState.phase).toBe('creation');
    const checklist = warbleWayGalaxy.getSetupChecklist(session);
    expect(checklist).toHaveLength(1);
    expect(checklist[0]!.move_type).toBe('create_character');
    const step = warbleWayGalaxy.describeNextStep(session);
    expect(step?.status).toBe('human_to_move');
    expect(step?.instruction).toMatch(/never pick for them/i);
  });
});

describe('shop & equipment (WR §6)', () => {
  it('buying deducts credits, marks one-shot, and rejects a repeat', () => {
    let s = created();
    s = apply(s, { type: 'buy_item', item_name: 'Consumable +1 Any' });
    expect(s.character!.credits).toBe(0);
    expect(s.habitat_progress[1]!.purchased).toContain('h1-s1');
    expect(() => applyMove(s, { type: 'buy_item', item_name: 'Consumable +1 Any' })).toThrow(/one-shot/);
  });

  it('rejects an unaffordable purchase and an unknown item (names the offers)', () => {
    const s = created();
    expect(() => applyMove(s, { type: 'buy_item', item_name: 'Ship part +2 Capacity' })).toThrow(/700c; you have 200c/);
    expect(() => applyMove(s, { type: 'buy_item', item_name: 'photon torpedo' })).toThrow(/On offer/);
  });

  it('ship parts apply immediately to the ship', () => {
    let s = created();
    s.character!.credits = 1000;
    s = apply(s, { type: 'buy_item', item_name: 'Ship part +1 Speed' });
    expect(s.ship!.speed).toBe(1);
    expect(s.ship!.parts).toContain('h1-s4');
  });

  it('weapons equip one per being and swap cleanly', () => {
    let s = created();
    s.character!.credits = 1000;
    s = apply(s, { type: 'buy_item', item_name: 'Weapon +1 GUN' });
    s = apply(s, { type: 'equip_item', item_name: 'Weapon +1 GUN', being: 'Zara' });
    expect(s.character!.gear.weapon).toBe('h1-s2');
  });
});

describe('recruiting (WR §6)', () => {
  it('sets a 3d6 roll pending using the best score under the idealized stat', () => {
    const s = apply(created(), { type: 'attempt_recruit', recruit_name: 'h1-c4' }); // Grull idealizes finesse
    expect(s.pending).toMatchObject({
      kind: 'roll',
      reason: 'recruit',
      dice_count: 3,
      min_roll: 11,
      score_source: { who: 'self', ability: 'PIL', bonus: 3 }, // PIL 3 is the best finesse aboard
    });
  });

  it('ACT grants the extra die when recruiting Hexapods/Kralkin (WR §4)', () => {
    let s = created();
    s.character!.abilities.ACT = 1;
    const hexapod = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c3' });
    expect(hexapod.pending).toMatchObject({ dice_count: 4 });
    const human = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c1' });
    expect(human.pending).toMatchObject({ dice_count: 3 }); // humans: no ACT die
  });

  it('success adds crew + grants the Leadership XP; failure marks permanently', () => {
    let s = created(); // has LEA 1 → +1 XP on success
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c4' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] }); // 18+3 vs 11 — success
    expect(s.crew).toHaveLength(1);
    expect(s.character!.xp).toBe(1);
    expect(s.pending).toBeNull();

    let f = created();
    f = apply(f, { type: 'attempt_recruit', recruit_name: 'h1-c4' });
    f = apply(f, { type: 'report_roll', dice: [1, 1, 2] }); // 4+3 vs 11 — fail
    expect(f.crew).toHaveLength(0);
    expect(f.habitat_progress[1]!.recruits_failed).toContain('h1-c4');
    expect(() => applyMove(f, { type: 'attempt_recruit', recruit_name: 'h1-c4' })).toThrow(/permanently marked/);
  });

  it('over capacity forces a release_crew pending (WR §6)', () => {
    let s = created();
    // Capacity 3 incl. the character → room for 2 crew. Hire two, then a third.
    for (const id of ['h1-c1', 'h1-c2', 'h1-c3'] as const) {
      s = apply(s, { type: 'attempt_recruit', recruit_name: id });
      s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    }
    expect(s.crew).toHaveLength(3);
    expect(s.pending).toEqual({ kind: 'release_crew' });
    // Only release moves are legal while forced.
    const legal = getLegalMoves(s, 'p1');
    expect(legal.every((m) => m.move.type === 'release_crew')).toBe(true);
    s = apply(s, { type: 'release_crew', crew_name: s.crew[0]!.name });
    expect(s.crew).toHaveLength(2);
    expect(s.pending).toBeNull();
  });
});

describe('repair & unrest — once per arrival (WR §6)', () => {
  it('repair needs MEC, rolls 3d6+MEC vs 12, and is consumed by the attempt', () => {
    let s = arrived(); // MEC 2, ship used
    s = apply(s, { type: 'attempt_repair' });
    expect(s.habitat_progress[1]!.repair_rolled_this_arrival).toBe(true);
    s = apply(s, { type: 'report_roll', dice: [4, 4, 4] }); // 12+2 = 14 ≥ 12
    expect(s.ship!.damage).toBe('pristine');
    expect(() => applyMove(s, { type: 'attempt_repair' })).toThrow(/already Pristine|once per arrival/);
  });

  it('a failed repair still consumes the arrival roll', () => {
    let s = arrived();
    s = apply(s, { type: 'attempt_repair' });
    s = apply(s, { type: 'report_roll', dice: [1, 2, 3] }); // 6+2 < 12
    expect(s.ship!.damage).toBe('used');
    expect(() => applyMove(s, { type: 'attempt_repair' })).toThrow(/once per arrival/);
  });

  it('game start is NOT an arrival — the starting habitat rolls are pre-spent (WR §6)', () => {
    const s = createInitialState(HUMAN, { seed: 7 });
    expect(s.habitat_progress[1]!.repair_rolled_this_arrival).toBe(true);
    expect(s.habitat_progress[2]!.repair_rolled_this_arrival).toBe(false);
  });

  it('unrest roll removes ONE token from each crew member (ruling #5)', () => {
    let s = created();
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c4' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] });
    s.crew[0]!.anger_tokens = 2;
    s.habitat_progress[1]!.unrest_rolled_this_arrival = false; // post-arrival state
    s = apply(s, { type: 'attempt_reduce_unrest' });
    s = apply(s, { type: 'report_roll', dice: [6, 6, 6] }); // 18+1 ≥ 12
    expect(s.crew[0]!.anger_tokens).toBe(1);
  });
});

describe('the shared check resolver (report_roll)', () => {
  it('validates dice count and range', () => {
    const s = apply(arrived(), { type: 'attempt_repair' });
    expect(() => applyMove(s, { type: 'report_roll', dice: [4, 4] })).toThrow(/exactly 3d6/);
    expect(() => applyMove(s, { type: 'report_roll', dice: [4, 4, 7] })).toThrow(/1-6/);
    expect(() => applyMove(created(), { type: 'report_roll', dice: [1, 2, 3] })).toThrow(/No roll is owed/);
  });

  it('declared consumables add their bonus and are consumed by the roll (WR §6)', () => {
    let s = created();
    s = apply(s, { type: 'buy_item', item_name: 'Consumable +1 Any' });
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c1' }); // human/brawn: +0 aboard, min 11
    s = apply(s, { type: 'use_item', item_name: 'Consumable +1 Any' });
    s = apply(s, { type: 'report_roll', dice: [4, 3, 3] }); // 10 + 1 = 11 — exactly enough
    expect(s.crew).toHaveLength(1);
    expect(s.consumed_item_ids).toContain('h1-s1');
    // A consumed consumable can't be declared again.
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c2' });
    expect(() => applyMove(s, { type: 'use_item', item_name: 'Consumable +1 Any' })).toThrow(/already used/);
  });

  it('consumables must be declared while a roll is open (declare-before-roll)', () => {
    let s = created();
    s = apply(s, { type: 'buy_item', item_name: 'Consumable +1 Any' });
    expect(() => applyMove(s, { type: 'use_item', item_name: 'Consumable +1 Any' })).toThrow(/BEFORE a roll/);
  });
});

describe('leveling (WR §15)', () => {
  it('reaching the threshold sets a level_up pending; the CHOICE is the player’s', () => {
    let s = created();
    s.character!.xp = 6;
    // settlePending fires on the next resolution — trigger via a recruit round-trip.
    s = apply(s, { type: 'attempt_recruit', recruit_name: 'h1-c1' });
    s = apply(s, { type: 'report_roll', dice: [1, 1, 1] }); // fail; then settle sees xp ≥ 6
    expect(s.pending).toEqual({ kind: 'level_up' });
    // Level 1→2 is EVEN: opening a new ability is legal now (amendment A3);
    // the odd-level restriction is locked by tuning.test.ts.
    s = apply(s, { type: 'level_up', ability: 'MEC' });
    expect(s.character!.level).toBe(2);
    expect(s.character!.abilities.MEC).toBe(3);
    expect(s.character!.xp).toBe(0);
    expect(s.pending).toBeNull();
  });
});

describe('pending hygiene & M2+ gating', () => {
  it('habitat actions are blocked while a roll is open', () => {
    const s = apply(arrived(), { type: 'attempt_repair' });
    expect(() => applyMove(s, { type: 'buy_item', item_name: 'Weapon +1 GUN' })).toThrow(/Resolve the open roll/);
  });

  it('phase-specific moves are context-checked, never silent', () => {
    const s = created();
    expect(() => applyMove(s, { type: 'enter_ruin', depth: 1 })).toThrow(/No ruin is open/);
    expect(() =>
      applyMove(s, {
        type: 'setup_encounter',
        crew_names: [],
        include_character: true,
        start_location: 'a',
        threat_level: 1,
        attacker_placements: [],
      }),
    ).toThrow(/no ruin encounter/i);
    expect(() => applyMove(s, { type: 'attempt_escape' })).toThrow(/no space combat/i);
  });

  it('describeNextStep covers every M1 pending kind (solo: all human-owed)', async () => {
    const session = warbleWayGalaxy.createSession(HUMAN, { seed: 7 });
    // roll pending
    let st = { ...session, gameState: apply(arrived(), { type: 'attempt_repair' }) };
    expect(warbleWayGalaxy.describeNextStep(st)?.instruction).toMatch(/roll 3d6.*do NOT invent/i);
    // level_up pending
    const lvl = created();
    lvl.character!.xp = 6;
    lvl.pending = { kind: 'level_up' };
    st = { ...session, gameState: lvl };
    expect(warbleWayGalaxy.describeNextStep(st)?.instruction).toMatch(/Never pick for them/);
    // release_crew pending
    const rel = created();
    rel.pending = { kind: 'release_crew' };
    st = { ...session, gameState: rel };
    expect(warbleWayGalaxy.describeNextStep(st)?.instruction).toMatch(/release/i);
  });
});

describe('solvability bot v0 (deterministic, faithful dice)', () => {
  it('drives creation, pendings, and habitat actions without inventing values', async () => {
    let session = warbleWayGalaxy.createSession(BOT, { seed: 42 });
    for (let i = 0; i < 30 && !warbleWayGalaxy.isGameOver(session); i++) {
      const pick = await warbleWayGalaxy.getAIMove(session, 'bot');
      const r = warbleWayGalaxy.applyMove(session, 'bot', pick.move);
      session = r.newState;
    }
    // The bot must have actually done things: recruited or bought or rolled.
    expect(session.gameState.character).not.toBeNull();
    expect(session.turnNumber).toBeGreaterThan(3);
  });

  it('is deterministic for a fixed seed', async () => {
    const run = async () => {
      let session = warbleWayGalaxy.createSession(BOT, { seed: 99 });
      const summaries: string[] = [];
      for (let i = 0; i < 10; i++) {
        let pick;
        try {
          pick = await warbleWayGalaxy.getAIMove(session, 'bot');
        } catch {
          break;
        }
        const r = warbleWayGalaxy.applyMove(session, 'bot', pick.move);
        summaries.push(r.summary);
        session = r.newState;
      }
      return summaries;
    };
    expect(await run()).toEqual(await run());
  });
});
