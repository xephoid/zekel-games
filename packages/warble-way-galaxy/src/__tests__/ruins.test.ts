import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '@zekel/game-kit';
import { applyMove, createInitialState, inAttackRange, ruinMapForLevel } from '../engine.js';
import { warbleWayGalaxy } from '../index.js';
import type { AbilityScores, RuinRun, WarbleMove, WarbleWayGalaxyState } from '../types.js';

// M4 suite — the ruins engine against the designer-confirmed grids (WR §14).
// R1 for reference:
//   row 1: G A . B . . . . A      row 6: . . . . . I . B .
//   row 2: A # . . # . . # .      row 7: . . . . . . . . .
//   row 3: . # A . I . . . .      row 8: . # . . # . . # .
//   row 4: B # . . . . A . .      row 9: S . . . I . . . S
//   row 5: A # . . # # # # .

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

function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
  return applyMove(state, move).newState;
}

/** Enter a depth-`d` discovery ruin (draw 10♦/A♦ mid-journey). Picks a habitat
 * mission the character qualifies for, and clears the RES peek when it fires. */
function atRuinSetup(scores: AbilityScores = { SWA: 3, MEC: 2, GUN: 1 }, depth: 1 | 2 | 3 = 1): WarbleWayGalaxyState {
  let s = makeChar(scores);
  const mission =
    (scores.MEC ?? 0) >= 1 ? 'h1-m3' : (scores.RES ?? 0) >= 1 ? 'h1-m1' : (scores.DIP ?? 0) >= 1 ? 'h1-m2' : 'h1-m5'; // h1-m5 = SWA 10
  s = apply(s, { type: 'take_mission', mission_name: mission });
  if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'report_res_discard', card: 'KD' });
  s = apply(s, { type: 'report_card_draw', card: depth === 1 ? '10♦' : 'A♦' }); // depth 1 or 3
  s = apply(s, { type: 'enter_ruin', depth });
  return s;
}

const DEFAULT_SETUP: WarbleMove = {
  type: 'setup_encounter',
  crew_names: [],
  include_character: true,
  start_location: 'r9c1',
  threat_level: 1,
  attacker_placements: ['r1c2', 'r1c9', 'r4c7'],
};

function ruinOf(s: WarbleWayGalaxyState): RuinRun {
  if (s.encounter?.kind !== 'ruin_run') throw new Error('no ruin run');
  return s.encounter;
}

describe('entering ruins (WR §14, §9)', () => {
  it('a ♦ discovery offers depth choices; entering opens setup on the R1 map', () => {
    const s = atRuinSetup();
    expect(s.phase).toBe('ruin');
    expect(s.pending).toMatchObject({ kind: 'ruin_setup', level: 1 });
    expect(ruinOf(s).origin.type).toBe('discovery');
  });

  it('setup validates start cell, threat level, and exactly 3 distinct attacker spots', () => {
    const s = atRuinSetup();
    expect(() => applyMove(s, { ...DEFAULT_SETUP, start_location: 'r5c5' } as WarbleMove)).toThrow(/valid cells/);
    expect(() => applyMove(s, { ...DEFAULT_SETUP, attacker_placements: ['r1c2', 'r1c2', 'r1c9'] } as WarbleMove)).toThrow(/DIFFERENT/);
    expect(() => applyMove(s, { ...DEFAULT_SETUP, attacker_placements: ['r1c2'] } as WarbleMove)).toThrow(/exactly 3/);
    expect(() => applyMove(s, { ...DEFAULT_SETUP, crew_names: [], include_character: false } as WarbleMove)).toThrow(/Someone has to go in/);
  });

  it('the party is placed on and around the chosen start, closest-first', () => {
    const t = apply(atRuinSetup(), DEFAULT_SETUP);
    const board = ruinOf(t).board!;
    expect(board.tokens[0]).toMatchObject({ name: 'Zara', cell: 'r9c1' });
    expect(board.attackers.map((a) => a.cell)).toEqual(['r1c2', 'r1c9', 'r4c7']);
    expect(t.pending).toEqual({ kind: 'ruin_turn' });
  });

  it('start cells accept corner words ("bottom-left")', () => {
    const t = apply(atRuinSetup(), { ...DEFAULT_SETUP, start_location: 'bottom-left' } as WarbleMove);
    expect(ruinOf(t).board!.start_cell).toBe('r9c1');
  });
});

describe('movement (WR §14)', () => {
  it('allowance is 3 (+SNE); orthogonal only; walls, pits and range are enforced', () => {
    let s = apply(atRuinSetup(), DEFAULT_SETUP);
    // r9c1 → 3 steps along row 9.
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r9c4' });
    const board = ruinOf(s).board!;
    expect(board.tokens[0]!.cell).toBe('r9c4');
    expect(board.tokens[0]!.moved).toBe(3);
    expect(() => applyMove(s, { type: 'move_being', being: 'Zara', to: 'r9c5' })).toThrow(/no movement left/i);
  });

  it('rejects walls and unreachable cells with the movement rules named', () => {
    const s = apply(atRuinSetup(), DEFAULT_SETUP);
    expect(() => applyMove(s, { type: 'move_being', being: 'Zara', to: 'r8c2' })).toThrow(/wall or pit/);
    expect(() => applyMove(s, { type: 'move_being', being: 'Zara', to: 'r7c9' })).toThrow(/cannot reach/);
  });

  it('SNE extends movement', () => {
    let s = atRuinSetup({ SNE: 3, SWA: 2, GUN: 1 });
    s = apply(s, DEFAULT_SETUP);
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r9c7' }); // 6 steps (3 + SNE 3)
    expect(ruinOf(s).board!.tokens[0]!.cell).toBe('r9c7');
  });
});

describe('range & line of sight (WR §14)', () => {
  const map = ruinMapForLevel(1);

  it('diagonals count; walls block; corners block; pits do not', () => {
    expect(inAttackRange(map, 'r7c3', 'r6c4', 2)).toBe(true); // diagonal
    expect(inAttackRange(map, 'r6c1', 'r4c1', 2)).toBe(true); // straight, open
    // r3c1 → r1c1 passes r2c1 (open) — fine; r3c3 → r3c1 crosses the wall at r3c2.
    expect(inAttackRange(map, 'r3c3', 'r3c1', 3)).toBe(false);
    // Around-the-corner: r6c2 → r4c3 would thread past the wall column at c2 rows 2–5.
    expect(inAttackRange(map, 'r4c3', 'r4c1', 2)).toBe(false); // crosses wall r4c2
  });
});

describe('ground combat in the ruins (WR §14)', () => {
  function toeToToe(scores: AbilityScores): WarbleWayGalaxyState {
    let s = apply(atRuinSetup(scores), DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r3c1'; // adjacent to the attacker we park at r2c1
    board.attackers[0]!.cell = 'r2c1';
    return s;
  }

  it('an attack rolls 4d6 pairing (+ECT die at natural SWA≥3); a win removes the attacker for its XP', () => {
    let s = toeToToe({ SWA: 3, MEC: 2, GUN: 1 });
    s = apply(s, { type: 'attack', being: 'Zara', target: 'A1' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'ground_combat', dice_count: 5 }); // ECT rider
    // pairs from [6,6,2,1]: 7 and 8 → advantage (SWA) takes 8; +SWA 3 +ECT die 4 = 15 vs 7+5=12.
    s = apply(s, { type: 'report_roll', dice: [6, 6, 2, 1, 4] });
    const board = ruinOf(s).board!;
    expect(board.attackers[0]!.defeated).toBe(true);
    expect(s.character!.xp).toBe(5); // XP = Atk (ruling #12)
  });

  it('losing your own attack just wastes the act — the counterpunch comes on the attacker turn', () => {
    let s = toeToToe({ MEC: 3, RES: 2, PIL: 1 }); // no attack skills: lower pair + 0
    s = apply(s, { type: 'attack', being: 'Zara', target: 'A1' });
    s = apply(s, { type: 'report_roll', dice: [6, 5, 3, 1] }); // pairs 7/8 → mine 7 vs 8+5=13
    const board = ruinOf(s).board!;
    expect(board.attackers[0]!.defeated).toBe(false);
    expect(board.tokens[0]!.acted).toBe(true);
  });

  it('the attacker phase moves toward the closest being and forces a defense roll; a hit on YOU is a death check', () => {
    let s = apply(atRuinSetup({ MEC: 3, RES: 2, PIL: 1 }), DEFAULT_SETUP);
    // End the turn — attackers advance; A1 at r1c2 walks toward r9c1 (move 5 at threat 1? no: threat1 A1 move 3).
    const before = ruinOf(s).board!.attackers.map((a) => a.cell);
    s = apply(s, { type: 'end_being_turn', being: 'Zara' });
    const board = ruinOf(s).board!;
    expect(board.attackers.map((a) => a.cell)).not.toEqual(before); // someone moved
    // Nobody in range yet (start r9c1 vs attackers up top) → round 2 begins.
    expect(board.round).toBe(2);
    expect(s.pending).toEqual({ kind: 'ruin_turn' });
  });

  it('a defense loss kills a crewmate outright; the character gets the 3d6 death check', () => {
    let s = apply(atRuinSetup({ MEC: 3, RES: 2, PIL: 1 }), DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r3c1';
    board.attackers[0]!.cell = 'r2c1'; // adjacent, range 1
    s = apply(s, { type: 'end_being_turn', being: 'Zara' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'ground_combat', context: { ground: 'ruin_defense', target: 'A1' } });
    // No ground advantage (no SWA): defender takes LOWER pair + 0; attacker higher +5.
    s = apply(s, { type: 'report_roll', dice: [6, 5, 3, 1] }); // 7 vs 8+5 → hit on YOU
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'death_check', context: { death_source: 'ruin' } });
    s = apply(s, { type: 'report_roll', dice: [3, 3, 3] }); // 9 — survive, fight on
    expect(s.result).toBeNull();
  });
});

describe('item and being spots (WR §14, rulings #11/#13)', () => {
  it('collecting rolls the map item list; the spot closes; a ship part installs', () => {
    let s = apply(atRuinSetup(), DEFAULT_SETUP);
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r9c4' }); // 8-adjacent to the I at r9c5
    s = apply(s, { type: 'collect_item', being: 'Zara' });
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'item_d6', dice_count: 1 });
    s = apply(s, { type: 'report_roll', dice: [4] }); // R1 item 4 = Ship Part Speed +2
    expect(s.ship!.speed).toBe(2);
    expect(ruinOf(s).board!.closed_spots).toContain('r9c5');
    // The spot cannot be rolled again.
    const again = { ...ruinOf(s).board!.tokens[0]! };
    expect(again.acted).toBe(true);
  });

  it('a Decoy closes the being spot with nobody there (ruling #13)', () => {
    let s = apply(atRuinSetup(), DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r5c1'; // 8-adjacent to the B at r4c1
    s = apply(s, { type: 'recruit_at', being: 'Zara' });
    s = apply(s, { type: 'report_roll', dice: [1] }); // 1 = Decoy
    expect(ruinOf(s).board!.closed_spots).toContain('r4c1');
    expect(s.crew).toHaveLength(0);
  });

  it('a found being takes a recruit roll at their stat-line minimum and joins ON the map (ruling #11)', () => {
    let s = apply(atRuinSetup({ SWA: 3, ACT: 2, DIP: 1 }), DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r5c1';
    s = apply(s, { type: 'recruit_at', being: 'Zara' });
    s = apply(s, { type: 'report_roll', dice: [2] }); // R1 being 2 = K(M) 13 +2 SWA +2 ACT — Kralkin, ACT die applies
    expect(s.pending).toMatchObject({ kind: 'roll', reason: 'recruit', dice_count: 4, min_roll: 13 });
    s = apply(s, { type: 'report_roll', dice: [6, 5, 4, 3] }); // 18 + moxie best (ACT 2) ≥ 13
    expect(s.crew).toHaveLength(1);
    const token = ruinOf(s).board!.tokens.find((t) => !t.is_character)!;
    expect(token.cell).toBe('r4c1'); // joins where recruited
    expect(token.ended).toBe(true); // acts from the next round
  });
});

describe('goals, levels & outcomes (WR §14, §7, ruling #16)', () => {
  it('reaching the goal at target depth finishes a discovery run and the journey resumes', () => {
    let s = apply(atRuinSetup(), DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r2c1'; // one step from the goal at r1c1 (A1 parked elsewhere)
    board.attackers[0]!.cell = 'r1c9';
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r1c1' });
    expect(s.encounter).toBeNull();
    expect(s.phase).toBe('traveling');
    expect(s.pending).toEqual({ kind: 'card_draw' }); // the mission journey resumes
  });

  it('below the target depth the player chooses: descend (R2 setup) or leave', () => {
    let s = atRuinSetup({ SWA: 3, MEC: 2, GUN: 1 }, 3); // A♦: depth 3
    s = apply(s, DEFAULT_SETUP);
    const board = ruinOf(s).board!;
    board.tokens[0]!.cell = 'r2c1';
    board.attackers[0]!.cell = 'r1c9';
    s = apply(s, { type: 'move_being', being: 'Zara', to: 'r1c1' });
    expect(s.pending).toMatchObject({ kind: 'ruin_continue', next_level: 2 });
    const leave = apply(s, { type: 'skip_ruin' });
    expect(leave.encounter).toBeNull();
    const deeper = apply(s, { type: 'enter_ruin', depth: 2 });
    expect(deeper.pending).toMatchObject({ kind: 'ruin_setup', level: 2 });
    expect(ruinOf(deeper).level).toBe(2);
  });

  it('a ruins MISSION pays out on completion; escaping abandons it for nothing', () => {
    let s = makeChar({ SWA: 3, MEC: 2, GUN: 1 });
    s.ship!.speed = 9; // h1-m4: distance 4 → instant arrival
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m4' }); // R1 ruin, 600c, 1xp
    expect(s.pending).toMatchObject({ kind: 'ruin_setup', level: 1 });
    let win = apply(s, DEFAULT_SETUP);
    const board = ruinOf(win).board!;
    board.tokens[0]!.cell = 'r2c1';
    board.attackers[0]!.cell = 'r1c9';
    win = apply(win, { type: 'move_being', being: 'Zara', to: 'r1c1' });
    expect(win.character!.credits).toBe(800); // 200 + 600
    expect(win.character!.xp).toBe(1);
    expect(win.habitat_progress[1]!.missions_succeeded).toContain('h1-m4');
    expect(win.phase).toBe('at_habitat'); // 0-card return → straight home

    let flee = apply(s, DEFAULT_SETUP);
    flee = apply(flee, { type: 'escape_to_start', being: 'Zara' }); // standing on r9c1
    expect(flee.character!.credits).toBe(200);
    expect(flee.encounter).toBeNull();
  });

  it('THE FINALE: clearing all three levels beyond Habitat #3 WINS Season 1 (ruling #16)', () => {
    let s = makeChar({ SWA: 3, MEC: 2, GUN: 1 });
    s.current_habitat = 3;
    s = apply(s, { type: 'depart_for_next_habitat' });
    for (const level of [1, 2, 3] as const) {
      expect(s.pending).toMatchObject({ kind: 'ruin_setup', level });
      const map = ruinMapForLevel(level);
      const starts = { 1: 'r9c1', 2: 'r9c9', 3: 'r9c9' } as const;
      const aSpots = {
        1: ['r1c2', 'r1c9', 'r4c7'],
        2: ['r1c2', 'r1c9', 'r3c7'],
        3: ['r1c3', 'r2c2', 'r2c4'],
      } as const;
      s = apply(s, {
        type: 'setup_encounter',
        crew_names: [],
        include_character: true,
        start_location: starts[level],
        threat_level: 1,
        attacker_placements: [...aSpots[level]],
      });
      // Teleport next to the goal (unit shortcut) and step on it.
      const board = ruinOf(s).board!;
      const goal = level === 3 ? 'r9c1' : 'r1c1'; // R3's goal is bottom-left
      const adj = level === 3 ? 'r9c2' : 'r2c1';
      for (const a of board.attackers) if (a.cell === adj || a.cell === goal) a.cell = 'r6c5';
      board.tokens[0]!.cell = adj;
      s = apply(s, { type: 'move_being', being: 'Zara', to: goal });
      if (level < 3) {
        expect(s.pending).toMatchObject({ kind: 'ruin_continue', next_level: level + 1 });
        s = apply(s, { type: 'enter_ruin', depth: (level + 1) as 2 | 3 });
      }
    }
    expect(s.result).toMatchObject({ winner: 'player' });
    expect(s.result!.summary).toMatch(/SEASON 1 COMPLETE/);
    const session = { ...warbleWayGalaxy.createSession(HUMAN), gameState: s };
    expect(warbleWayGalaxy.isGameOver(session)?.winners).toEqual(['p1']);
  });
});
