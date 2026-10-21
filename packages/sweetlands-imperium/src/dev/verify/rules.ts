// Transition rules for Sweetlands Imperium, authored from the pinned rules
// freeze (rules-freeze.txt, next to this file). Every rule cites
// its licensing sentence verbatim; __tests__/oracleCitations.test.ts
// string-searches the pinned text for each quote.
//
// Engine transition facts the rules respect: all-AI sessions begin in the
// play phase; the `recall` move BUNDLES the turn-start Intel gain (capped by
// what the deck + discard can supply); `pass` and `end_turn` advance the
// player, and when the round wraps to the first player the scoring phase runs
// inside that same transition (so points may change for several players at
// once — the scoring-arithmetic rule prices every change it sees).

import { ROUND_CAP } from '../../engine.js';
import type { OracleRule, RuleViolation } from '@zekel/dev/verify/exec/types';
import type { SweetlandsVerifyPlayer, SweetlandsVerifyState } from './project.js';

type V = SweetlandsVerifyState;

/** Public objective point values, from the section 6 table (3/3/3/1/1). */
const PUBLIC_VALUES: Record<string, number> = {
  units_all_matching_color: 3,
  units_all_treats: 3,
  defeat_foe: 3,
  capture_leader: 1,
  leader_castle_uncontested: 1,
};
const SECRET_VALUE = 2;

function byId(state: V, playerId: string): SweetlandsVerifyPlayer | undefined {
  return state.players.find((p) => p.playerId === playerId);
}

function eachPlayerPair(
  prev: V,
  next: V,
  check: (before: SweetlandsVerifyPlayer, after: SweetlandsVerifyPlayer) => RuleViolation[],
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const before of prev.players) {
    const after = byId(next, before.playerId);
    if (after) violations.push(...check(before, after));
  }
  return violations;
}

/** Counter-clockwise region distance 0..3 (regions cycle 1→2→3→4→1). */
function regionDistance(home: number, at: number): number {
  return (((at - home) % 4) + 4) % 4;
}

const GAIN_BY_DISTANCE = [1, 2, 3, 2] as const;

export const SWEETLANDS_ORACLE_RULES: OracleRule<V>[] = [
  {
    id: 'influence-never-exceeds-five',
    on: '*',
    citation: { section: '8', quote: 'Max influence **5**.' },
    check: (_prev, _event, next) =>
      next.players
        .filter((p) => p.influence < 0 || p.influence > 5)
        .map((p) => ({
          field: `${p.playerId}.influence`,
          predicted: 'between 0 and 5',
          actual: String(p.influence),
        })),
  },
  {
    id: 'taxes-stay-between-zero-and-three',
    on: '*',
    citation: { section: '8', quote: 'raise +1 (1 influence, max 3)' },
    check: (_prev, _event, next) =>
      Object.entries(next.taxes)
        .filter(([, level]) => level < 0 || level > 3)
        .map(([region, level]) => ({
          field: `taxes.region${region}`,
          predicted: 'between 0 and 3',
          actual: String(level),
        })),
  },
  {
    id: 'sugar-is-a-shared-bank-of-thirty',
    on: '*',
    citation: {
      section: '1',
      quote:
        '**hard shared bank of 30** (no per-player cap, but the 30 total IS the supply — buying is blocked when the bank is empty; discards return to it)',
    },
    check: (_prev, _event, next) => {
      const total = next.players.reduce((n, p) => n + p.sugar, 0);
      const violations: RuleViolation[] = [];
      if (total > 30) {
        violations.push({ field: 'sugar.total', predicted: 'at most 30 in play', actual: String(total) });
      }
      for (const p of next.players) {
        if (p.sugar < 0) {
          violations.push({ field: `${p.playerId}.sugar`, predicted: 'not negative', actual: String(p.sugar) });
        }
      }
      return violations;
    },
  },
  {
    id: 'intel-cards-conserve-at-eighty',
    on: '*',
    citation: {
      section: '4',
      quote: 'ONE shared **face-down** 80-card deck, server-owns the order.',
    },
    check: (_prev, _event, next) => {
      const total = next.deckCount + next.discardCount + next.players.reduce((n, p) => n + p.handCount, 0);
      if (total !== 80) {
        return [
          {
            field: 'intel.conservation',
            predicted: '80 cards across deck, discard, and hands',
            actual: String(total),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'token-supply-four-per-color',
    on: '*',
    citation: { section: '1', quote: '24 (4× each of 6 colors)' },
    check: (_prev, _event, next) => {
      const owned = new Map<string, number>();
      for (const p of next.players) {
        for (const color of p.tokens) owned.set(color, (owned.get(color) ?? 0) + 1);
      }
      return [...owned.entries()]
        .filter(([, n]) => n > 4)
        .map(([color, n]) => ({
          field: `tokens.${color}`,
          predicted: 'at most 4 owned across all players',
          actual: String(n),
        }));
    },
  },
  {
    id: 'points-only-go-up-and-five-wins',
    on: '*',
    citation: { section: '8', quote: '**Win:** first to **5 points** (public + secret).' },
    check: (prev, _event, next) => {
      const violations = eachPlayerPair(prev, next, (before, after) =>
        after.points < before.points
          ? [{ field: `${after.playerId}.points`, predicted: `at least ${before.points} (points never come back)`, actual: String(after.points) }]
          : [],
      );
      if (next.phase === 'game_over' && prev.phase !== 'game_over') {
        // Tolerated documented divergence: the engine ends degenerate games at
        // ROUND_CAP (a commented harness backstop) even
        // though the rules freeze states only the 5-point win. Recorded in
        // the game's development notes; alerts here only for below-cap early endings.
        if (!next.players.some((p) => p.points >= 5) && next.round < ROUND_CAP) {
          violations.push({
            field: 'phase',
            predicted: 'game_over only when a player has 5+ points (or the documented round cap)',
            actual: `game_over at round ${next.round} with max ${Math.max(...next.players.map((p) => p.points))}`,
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'every-point-is-a-priced-objective',
    on: '*',
    citation: {
      section: '7',
      quote: 'Worth **2 points each** (PDF Teach, line 170), scored immediately when completed.',
    },
    check: (prev, _event, next) =>
      eachPlayerPair(prev, next, (before, after) => {
        const newPublic = after.publicScored.filter((o) => !before.publicScored.includes(o));
        const publicPoints = newPublic.reduce((n, o) => n + (PUBLIC_VALUES[o] ?? 0), 0);
        const secretPoints = (after.secretScoredCount - before.secretScoredCount) * SECRET_VALUE;
        const want = before.points + publicPoints + secretPoints;
        if (after.points !== want) {
          return [
            {
              field: `${after.playerId}.points`,
              predicted: `${want} (${publicPoints} public + ${secretPoints} secret on top of ${before.points})`,
              actual: String(after.points),
            },
          ];
        }
        return [];
      }),
  },
  {
    id: 'public-objectives-score-once',
    on: '*',
    citation: {
      section: '6',
      quote: 'every player may score each objective once, the first time they meet it.',
    },
    check: (prev, _event, next) =>
      eachPlayerPair(prev, next, (before, after) => {
        const violations: RuleViolation[] = [];
        for (const o of before.publicScored) {
          if (!after.publicScored.includes(o)) {
            violations.push({ field: `${after.playerId}.publicScored`, predicted: `${o} stays scored`, actual: 'removed' });
          }
        }
        if (new Set(after.publicScored).size !== after.publicScored.length) {
          violations.push({
            field: `${after.playerId}.publicScored`,
            predicted: 'no objective scored twice',
            actual: after.publicScored.join(','),
          });
        }
        return violations;
      }),
  },
  {
    id: 'pass-gains-one-influence',
    on: ['pass'],
    citation: { section: '4', quote: 'pass to gain **+1 influence**' },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const want = Math.min(5, before.influence + 1);
      if (after.influence !== want) {
        return [{ field: `${event.actor}.influence`, predicted: String(want), actual: String(after.influence) }];
      }
      return [];
    },
  },
  {
    id: 'sugar-costs-three-influence',
    on: ['buy_sugar_cube'],
    citation: { section: '4', quote: 'may buy 1 sugar cube for 3 influence' },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const violations: RuleViolation[] = [];
      if (after.influence !== before.influence - 3) {
        violations.push({
          field: `${event.actor}.influence`,
          predicted: String(before.influence - 3),
          actual: String(after.influence),
        });
      }
      if (after.sugar !== before.sugar + 1) {
        violations.push({ field: `${event.actor}.sugar`, predicted: String(before.sugar + 1), actual: String(after.sugar) });
      }
      const bankBefore = 30 - prev.players.reduce((n, p) => n + p.sugar, 0);
      if (bankBefore <= 0) {
        violations.push({
          field: 'sugar.bank',
          predicted: 'buy blocked — the bank is empty',
          actual: 'the engine accepted the buy',
        });
      }
      return violations;
    },
  },
  {
    id: 'token-costs-one-influence-max-one-per-color',
    on: ['buy_intel_token'],
    citation: {
      section: '4',
      quote: 'spend influence — 1 per Intel **token** (max 1 of each color owned)',
    },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const violations: RuleViolation[] = [];
      if (after.influence !== before.influence - 1) {
        violations.push({
          field: `${event.actor}.influence`,
          predicted: String(before.influence - 1),
          actual: String(after.influence),
        });
      }
      const added = after.tokens.filter((c) => !before.tokens.includes(c));
      if (added.length !== 1) {
        violations.push({ field: `${event.actor}.tokens`, predicted: 'exactly one new color', actual: added.join(',') || 'none' });
      }
      for (const color of added) {
        if (before.tokens.includes(color)) {
          violations.push({
            field: `${event.actor}.tokens`,
            predicted: `no second ${color} token (max 1 of each color)`,
            actual: 'duplicate accepted',
          });
        }
      }
      return violations;
    },
  },
  {
    id: 'trash-influence-burns-exactly-the-count',
    on: ['trash_influence'],
    citation: { section: '7', quote: 'a deliberate one-time TRASH of 5 influence' },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const count = Number(event.move['count'] ?? 0);
      if (after.influence !== before.influence - count) {
        return [
          {
            field: `${event.actor}.influence`,
            predicted: String(before.influence - count),
            actual: String(after.influence),
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'recall-returns-units-then-gains-intel-by-ambassador-distance',
    on: ['recall'],
    citation: {
      section: '4',
      quote:
        "**Gain Intel** based on **Ambassador's region distance** from home: home **+1**, next **+2**, then **+3**, then **+2**. (Nomads: always +2.)",
    },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const violations: RuleViolation[] = [];
      // Recalled units end at the start tile (Nomads: off the board).
      const recalled = (event.move['units'] as string[] | undefined) ?? [];
      for (const unit of recalled) {
        const at = after.units[unit as 'leader' | 'knight' | 'ambassador'];
        const want = after.isNomads ? 'offboard' : `start:${after.homeRegion}`;
        if (at !== want) {
          violations.push({ field: `${event.actor}.units.${unit}`, predicted: want, actual: at });
        }
      }
      // The bundled turn-start gain, computed from the POST-recall ambassador.
      let gain: number;
      if (after.isNomads) {
        gain = 2;
      } else {
        const amb = after.units.ambassador;
        const regionText = amb.split(':')[1];
        const ambRegion = regionText !== undefined ? Number(regionText) : after.homeRegion ?? 1;
        const at = amb === 'castle' || amb === 'offboard' ? after.homeRegion ?? 1 : ambRegion;
        gain = GAIN_BY_DISTANCE[regionDistance(after.homeRegion ?? 1, at)] ?? 1;
      }
      const drawable = prev.deckCount + prev.discardCount;
      const want = before.handCount + Math.min(gain, drawable);
      if (next.pendingKind === null && after.handCount !== want) {
        violations.push({
          field: `${event.actor}.handCount`,
          predicted: `${want} (gain ${gain}, drawable ${drawable})`,
          actual: String(after.handCount),
        });
      }
      return violations;
    },
  },
  {
    id: 'one-foe-chosen-at-start-defeat-is-final',
    on: '*',
    citation: {
      section: '8',
      quote: '**exactly ONE foe per game**, chosen by the players at game start from Dragon / Orc / Fiend.',
    },
    check: (prev, _event, next) => {
      const violations: RuleViolation[] = [];
      if (prev.foeType !== null && next.foeType !== prev.foeType) {
        violations.push({ field: 'foe.type', predicted: String(prev.foeType), actual: String(next.foeType) });
      }
      if (prev.foeDefeated && !next.foeDefeated) {
        violations.push({ field: 'foe.defeated', predicted: 'stays defeated', actual: 'undefeated' });
      }
      return violations;
    },
  },
  {
    id: 'castle-occupant-is-a-leader-in-the-castle',
    on: '*',
    citation: {
      section: '8',
      quote:
        'The foe occupies the castle; a Knight must defeat it before a Leader can hold the castle uncontested.',
    },
    check: (_prev, _event, next) => {
      if (next.castleOccupantId === null) return [];
      const occupant = byId(next, next.castleOccupantId);
      if (!occupant || occupant.units.leader !== 'castle') {
        return [
          {
            field: 'castleOccupantId',
            predicted: `${next.castleOccupantId}'s leader standing in the castle`,
            actual: occupant ? `leader at ${occupant.units.leader}` : 'unknown player',
          },
        ];
      }
      return [];
    },
  },
  {
    id: 'an-intel-play-moves-only-the-named-unit',
    on: ['play_intel', 'play_token'],
    citation: {
      section: '5',
      quote: '**One card per unit:** each Intel card moves exactly one unit (a double moves that one unit twice).',
    },
    check: (prev, event, next) => {
      const before = byId(prev, event.actor);
      const after = byId(next, event.actor);
      if (!before || !after) return [];
      const named = String(event.move['unit'] ?? '');
      const violations: RuleViolation[] = [];
      for (const unit of ['leader', 'knight', 'ambassador'] as const) {
        if (unit === named) continue;
        if (before.units[unit] !== after.units[unit]) {
          violations.push({
            field: `${event.actor}.units.${unit}`,
            predicted: `${before.units[unit]} (only the named unit "${named}" moves)`,
            actual: after.units[unit],
          });
        }
      }
      return violations;
    },
  },
];
