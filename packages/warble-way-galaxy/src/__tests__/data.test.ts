import { describe, expect, it } from 'vitest';
import { ABILITY_STAT, HAZARD_CONSEQUENCE_BY_STAT, RACE_IDEALIZED, STAT_ABILITIES } from '../data/abilities.js';
import { CARD_RANKS, fullDeckIds, resolveCardName } from '../data/cards.js';
import {
  CLUB_MISSIONS,
  DIAMOND_PIRATES,
  DIAMOND_RUINS,
  HEART_RECRUITS,
  SPADE_HAZARDS,
} from '../data/travelTables.js';
import { HABITATS } from '../data/habitats.js';
import { RUIN_MAPS } from '../data/ruins.js';
import { minXpForLevel, PRINTED_LEVEL_TABLE } from '../data/levels.js';

// Data-parity suite: locks the transcribed tables against the FROZEN
// port/warble-way-galaxy/WARBLE-RULES.md (WR). Any edit to data/ that drifts
// from the freeze fails here — the freeze changes first, then the data.

describe('vocabulary (WR §3)', () => {
  it('four stats × three abilities, bijective', () => {
    const all = Object.values(STAT_ABILITIES).flat();
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
    for (const [stat, abilities] of Object.entries(STAT_ABILITIES)) {
      for (const a of abilities) expect(ABILITY_STAT[a]).toBe(stat);
    }
  });

  it('race idealized stats as printed', () => {
    expect(RACE_IDEALIZED).toEqual({
      human: 'brawn',
      kralkin: 'moxie',
      hexapod: 'smarts',
      grull: 'finesse',
    });
  });
});

describe('travel tables cover all 52 cards exactly (WR §9)', () => {
  it('hearts / spades / clubs have all 13 ranks', () => {
    for (const table of [HEART_RECRUITS, SPADE_HAZARDS, CLUB_MISSIONS]) {
      expect(Object.keys(table).sort()).toEqual([...CARD_RANKS].sort());
    }
  });

  it('diamonds split 2–9 pirates + 10/J/Q/K/A ruins with no gap or overlap', () => {
    const pirates = Object.keys(DIAMOND_PIRATES);
    const ruins = Object.keys(DIAMOND_RUINS);
    expect(pirates.sort()).toEqual(['2', '3', '4', '5', '6', '7', '8', '9']);
    expect(ruins.sort()).toEqual(['10', 'A', 'J', 'K', 'Q']);
    expect([...pirates, ...ruins].sort()).toEqual([...CARD_RANKS].sort());
  });

  it('full deck is 52 unique ids', () => {
    const ids = fullDeckIds();
    expect(ids).toHaveLength(52);
    expect(new Set(ids).size).toBe(52);
  });
});

describe('♥ recruits spot checks (WR §9)', () => {
  it('matches printed rows', () => {
    expect(HEART_RECRUITS.A).toMatchObject({ race: 'hexapod', min_roll: 13, abilities: { PIL: 3 } });
    expect(HEART_RECRUITS.Q).toMatchObject({ race: 'grull', min_roll: 12, abilities: { RES: 2, MEC: 1 } });
    expect(HEART_RECRUITS.K).toMatchObject({ race: 'human', min_roll: 12, abilities: { ACT: 2, SWA: 1 } });
  });

  it('every recruit idealizes their race canon stat (♥ table has no divergent prints)', () => {
    for (const r of Object.values(HEART_RECRUITS)) {
      expect(r.idealized).toBe(RACE_IDEALIZED[r.race]);
    }
  });
});

describe('♦ pirates (WR §9)', () => {
  it('card 2 is the monster; specials on 4 and 8 only', () => {
    expect(DIAMOND_PIRATES['2']).toMatchObject({
      space_attack: 7, ground_attack: 5, capacity: 7, speed: 2, handling: 4, min_hacking: 15,
    });
    expect(DIAMOND_PIRATES['4'].special).toBe('space_combat_advantage');
    expect(DIAMOND_PIRATES['8'].special).toBe('minus_2_enemy_space_bonus');
    const specials = Object.values(DIAMOND_PIRATES).filter((p) => p.special !== null);
    expect(specials).toHaveLength(2);
  });

  it('ruins discovery depths as printed', () => {
    expect(DIAMOND_RUINS).toEqual({ A: 3, '10': 1, J: 2, Q: 3, K: 2 });
  });
});

describe('♠ hazards (WR §9–§10)', () => {
  it('option minimums are 10 / 15 across the table', () => {
    for (const h of Object.values(SPADE_HAZARDS)) {
      expect(h.option1.min_roll).toBe(10);
      expect(h.option2.min_roll).toBe(15);
    }
  });

  it('printed consequences match the stat-group derivation (self-consistency WR noted)', () => {
    // Spot the printed pairs: 3♠ opt2 SWA=Death, 9♠ opt1 ARM=Death,
    // A♠ opt1 PIL=Ship Damage, K♠ opt1 MEC=-100c, Q♠ opt1 DIP=Crew Unrest.
    expect(HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[SPADE_HAZARDS['3'].option2.ability]]).toBe('death');
    expect(HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[SPADE_HAZARDS['9'].option1.ability]]).toBe('death');
    expect(HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[SPADE_HAZARDS.A.option1.ability]]).toBe('ship_damage');
    expect(HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[SPADE_HAZARDS.K.option1.ability]]).toBe('lose_credits');
    expect(HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[SPADE_HAZARDS.Q.option1.ability]]).toBe('crew_unrest');
  });
});

describe('♣ missions (WR §9)', () => {
  it('2–10 are dual-option; J/Q/K/A are single ruins missions', () => {
    for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', '10'] as const) {
      expect(CLUB_MISSIONS[rank].kind).toBe('choice');
    }
    for (const rank of ['J', 'Q', 'K', 'A'] as const) {
      expect(CLUB_MISSIONS[rank].kind).toBe('ruins');
    }
  });

  it('spot checks match printed rows', () => {
    const two = CLUB_MISSIONS['2'];
    if (two.kind !== 'choice') throw new Error('2♣ must be a choice');
    expect(two.option1).toMatchObject({ distance: 4, credits: 200, xp: 1, goal: { ability: 'DIP', min_roll: 10 } });
    expect(two.option2).toMatchObject({ distance: 8, credits: 400, xp: 2, goal: { ability: 'HAK', min_roll: 15 } });
    const king = CLUB_MISSIONS.K;
    if (king.kind !== 'ruins') throw new Error('K♣ must be ruins');
    expect(king.mission).toMatchObject({ distance: 16, credits: 1800, xp: 4, goal: { kind: 'ruin', depth: 3 } });
  });
});

describe('habitats (WR §16)', () => {
  it('counts match the printed pages', () => {
    expect(HABITATS[1]!.missions).toHaveLength(7);
    expect(HABITATS[2]!.missions).toHaveLength(6);
    expect(HABITATS[3]!.missions).toHaveLength(6);
    expect(HABITATS[1]!.shop).toHaveLength(5);
    expect(HABITATS[2]!.shop).toHaveLength(6);
    expect(HABITATS[3]!.shop).toHaveLength(6);
    expect(HABITATS[1]!.cantina).toHaveLength(5);
    expect(HABITATS[2]!.cantina).toHaveLength(5);
    expect(HABITATS[3]!.cantina).toHaveLength(6);
  });

  it('progression gates as ruled (WR §16–§17)', () => {
    expect(HABITATS[1]!.progression).toEqual({ kind: 'missions_then_travel', missions_required: 4, distance_one_way: 6 });
    expect(HABITATS[2]!.progression).toEqual({ kind: 'travel', distance_one_way: 12 });
    expect(HABITATS[3]!.progression).toEqual({ kind: 'final_ruin', depth: 3 });
  });

  it('spot checks: the hardest printed missions', () => {
    expect(HABITATS[1]!.missions[6]).toMatchObject({ distance: 6, credits: 400, xp: 1, goal: { ability: 'ACT', min_roll: 12 } });
    expect(HABITATS[3]!.missions[5]).toMatchObject({ distance: 9, credits: 1500, xp: 5, goal: { ability: 'PIL', min_roll: 18 } });
    expect(HABITATS[1]!.missions[3]!.goal).toEqual({ kind: 'ruin', depth: 1 });
  });

  it('every habitat-1 cantina row has min roll 11 (printed)', () => {
    for (const r of HABITATS[1]!.cantina) expect(r.min_roll).toBe(11);
  });
});

describe('ruins (WR §14)', () => {
  it('attacker XP equals attack bonus (ruling #12), 3 attackers per threat level', () => {
    for (const map of Object.values(RUIN_MAPS)) {
      for (const level of [1, 2, 3] as const) {
        expect(map.attackers[level]).toHaveLength(3);
        for (const atk of map.attackers[level]) expect(atk.xp).toBe(atk.atk);
      }
    }
  });

  it('d6 slot 1 is Empty (items) / Decoy (beings) on every map (ruling #13)', () => {
    for (const map of Object.values(RUIN_MAPS)) {
      expect(map.items[1]).toBeNull();
      expect(map.beings[1]).toBeNull();
      for (const slot of [2, 3, 4, 5, 6]) {
        expect(map.items[slot]).not.toBeNull();
        expect(map.beings[slot]).not.toBeNull();
      }
    }
  });

  it('R1 being 4 is the printed divergent H(S) — a Human idealizing Smarts (WR §14)', () => {
    expect(RUIN_MAPS.R1.beings[4]).toMatchObject({ race: 'human', idealized: 'smarts', min_roll: 13 });
  });

  it('grids are 9×9 with legend chars only (D1 first-pass, DATA_TEMPLATE.md)', () => {
    for (const map of Object.values(RUIN_MAPS)) {
      expect(map.grid).not.toBeNull();
      expect(map.grid!.rows).toHaveLength(9);
      for (const row of map.grid!.rows) {
        expect(row).toHaveLength(9);
        expect(row).toMatch(/^[.#~SGABI]+$/);
      }
    }
  });

  it('every grid has exactly one goal, 1-2 starts, and 6 attacker spots ("more spots than attackers")', () => {
    const count = (rows: string[], ch: string) => rows.join('').split('').filter((c) => c === ch).length;
    for (const map of Object.values(RUIN_MAPS)) {
      const rows = map.grid!.rows;
      expect(count(rows, 'G')).toBe(1);
      expect(count(rows, 'S')).toBeGreaterThanOrEqual(1);
      expect(count(rows, 'S')).toBeLessThanOrEqual(2);
      expect(count(rows, 'A')).toBe(6); // 6 spots, 3 attackers placed (WR §14)
      expect(count(rows, 'I')).toBeGreaterThanOrEqual(2);
      expect(count(rows, 'B')).toBeGreaterThanOrEqual(2);
    }
    // Transcription spot-checks (DATA_TEMPLATE.md first pass):
    expect(count(RUIN_MAPS.R1.grid!.rows, 'S')).toBe(2); // bottom corners
    expect(count(RUIN_MAPS.R1.grid!.rows, '~')).toBe(0); // R1 has no pits
    expect(count(RUIN_MAPS.R2.grid!.rows, 'S')).toBe(1); // bottom-right only
    expect(RUIN_MAPS.R3.grid!.rows[8]![0]).toBe('G'); // R3 goal is bottom-left
  });
});

describe('leveling (WR §15, ruling #14)', () => {
  it('printed table + doubling beyond', () => {
    expect(PRINTED_LEVEL_TABLE).toEqual({ 1: 6, 2: 12, 3: 24, 4: 48 });
    expect(minXpForLevel(1)).toBe(6);
    expect(minXpForLevel(4)).toBe(48);
    expect(minXpForLevel(5)).toBe(96);
    expect(minXpForLevel(6)).toBe(192);
  });
});

describe('resolveCardName — accept the printed name (WR §8)', () => {
  it('accepts glyphs, compact ids, and words', () => {
    expect(resolveCardName('7♠')).toEqual({ rank: '7', suit: 'spades' });
    expect(resolveCardName('7S')).toEqual({ rank: '7', suit: 'spades' });
    expect(resolveCardName('seven of spades')).toEqual({ rank: '7', suit: 'spades' });
    expect(resolveCardName('Queen of Hearts')).toEqual({ rank: 'Q', suit: 'hearts' });
    expect(resolveCardName('10d')).toEqual({ rank: '10', suit: 'diamonds' });
    expect(resolveCardName('ten of diamonds')).toEqual({ rank: '10', suit: 'diamonds' });
    expect(resolveCardName('♣A')).toEqual({ rank: 'A', suit: 'clubs' });
    expect(resolveCardName('ace of clubs')).toEqual({ rank: 'A', suit: 'clubs' });
  });

  it('returns null (never a guess) on garbage', () => {
    expect(resolveCardName('')).toBeNull();
    expect(resolveCardName('joker')).toBeNull();
    expect(resolveCardName('11 of spades')).toBeNull();
    expect(resolveCardName('7 of stars')).toBeNull();
  });
});
