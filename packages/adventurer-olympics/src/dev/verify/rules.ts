// Transition rules for Adventurer Olympics, authored from the pinned rulebook
// (rules-v2-2026-09-30.txt, next to this file — a verbatim copy of
// RULES.md). Every rule cites its licensing sentence word for word;
// __tests__/oracleCitations.test.ts string-searches the pinned text for each.
//
// The rules keep no state of their own: each one predicts facts about the next
// state from the previous state and the move (docs/rules-verification.md).
// They reason from the rulebook — adjacency, stat totals and thresholds are
// computed here, not borrowed from the engine. The card tables (numbers,
// bonuses) come from data.ts, the transcription the data test already checks
// against the rules text.

import { COMPANION_CARDS, LITTLE_MONSTER_CARDS, BIG_MONSTER_CARDS, DUNGEON_COMPOSITION } from '../../data.js';
import type { OracleRule, RuleViolation } from '@zekel/dev/verify/exec/types';
import type { AOVerifyState } from './project.js';

const S = (v: unknown): string => JSON.stringify(v);

// --- rulebook facts, restated here ---------------------------------------
/** §2 "Starting stats": Charisma 1, Strength 1, Movement 2. */
const START = { charisma: 1, strength: 1, movement: 2 } as const;
/** Axial neighbour offsets: a hex has six neighbours. */
const OFFSETS: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const INSTANT_QUESTS: Record<string, (p: AOVerifyState['players'][string]) => boolean> = {
  explore_3_tiles: (p) => p.exploredTiles >= 3,
};
const END_QUESTS: Record<string, (p: AOVerifyState['players'][string]) => number> = {
  most_little_monsters: (p) => p.littleMonsters.length,
  most_big_monsters: (p) => p.bigMonsters.length,
  most_artifacts: (p) => p.artifacts.length,
  most_dungeons: (p) => p.dungeonsCompleted,
  most_companions: (p) => p.companions.length,
};

function adjacent(a: string, b: string): boolean {
  const [aq, ar] = a.split(',').map(Number) as [number, number];
  const [bq, br] = b.split(',').map(Number) as [number, number];
  return OFFSETS.some(([dq, dr]) => aq + dq === bq && ar + dr === br);
}

function stat(s: AOVerifyState, seat: string, k: 'charisma' | 'strength' | 'movement'): number {
  let total: number = START[k];
  for (const id of s.players[seat]!.companions) total += COMPANION_CARDS.find((c) => c.id === id)?.bonus[k] ?? 0;
  return total;
}

/** Is it still `seat`'s turn to move/act in the same round (not resolving a
 *  test or a card, not the next roll phase)? */
function stillMovingTurn(next: AOVerifyState, seat: string, round: number): boolean {
  return !next.gameOver && next.round === round && next.pendingSeat === seat
    && (next.pendingKind === 'move' || next.pendingKind === 'try_again');
}

function heldAll(s: AOVerifyState, zone: 'companions' | 'littleMonsters' | 'bigMonsters'): string[] {
  return s.playerOrder.flatMap((pid) => s.players[pid]![zone]);
}

function v(field: string, predicted: unknown, actual: unknown): RuleViolation {
  return { field, predicted: S(predicted), actual: S(actual) };
}

export const ADVENTURER_OLYMPICS_ORACLE_RULES: OracleRule<AOVerifyState>[] = [
  // ---------------------------------------------------------------- zones
  {
    id: 'card-conservation',
    on: '*',
    citation: { section: '§6.1', quote: 'Keep the card in front of you.' },
    check: (_prev, _e, next) => {
      const out: RuleViolation[] = [];
      const decks: Array<[string, string[], string[], string]> = [
        ['companion', COMPANION_CARDS.map((c) => c.id), [...next.decks.companion, ...heldAll(next, 'companions')], 'companion'],
        ['little', LITTLE_MONSTER_CARDS.map((c) => c.id), [...next.decks.little, ...heldAll(next, 'littleMonsters')], 'little'],
        ['big', BIG_MONSTER_CARDS.map((c) => c.id), [...next.decks.big, ...heldAll(next, 'bigMonsters')], 'big'],
      ];
      for (const [name, all, seen] of decks) {
        const sorted = [...seen].sort();
        if (S(sorted) !== S([...all].sort())) out.push(v(`${name}: deck + kept cards`, 'every card exactly once', sorted));
      }
      return out;
    },
  },
  {
    id: 'dungeon-deck-never-shrinks',
    on: '*',
    citation: { section: '§6.3', quote: 'whatever happened, put it at the bottom of the Dungeon deck.' },
    check: (_prev, _e, next) => {
      const counts: Record<string, number> = {};
      for (const k of next.decks.dungeon) counts[k] = (counts[k] ?? 0) + 1;
      const ok = next.decks.dungeon.length === 24 && Object.entries(DUNGEON_COMPOSITION).every(([k, n]) => counts[k] === n);
      return ok ? [] : [v('decks.dungeon composition', DUNGEON_COMPOSITION, counts)];
    },
  },
  {
    id: 'tile-conservation',
    on: '*',
    citation: { section: '§2', quote: 'Shuffle the 10 map tiles face down into a stack.' },
    check: (prev, _e, next) => {
      const out: RuleViolation[] = [];
      const all = [...Object.values(next.tiles), ...next.tileStack].sort((a, b) => a - b);
      if (next.round > 0 && S(all) !== S([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])) out.push(v('placed tiles + stack', 'tiles 1-10 exactly once', all));
      for (const [key, id] of Object.entries(prev.tiles)) {
        if (next.tiles[key] !== id) out.push(v(`tiles[${key}]`, id, next.tiles[key] ?? null));
      }
      return out;
    },
  },
  {
    id: 'stats-never-go-down',
    on: '*',
    citation: { section: '§2', quote: 'Stats never go down.' },
    check: (prev, _e, next) => prev.playerOrder.flatMap((pid) =>
      (['charisma', 'strength', 'movement'] as const)
        .filter((k) => stat(next, pid, k) < stat(prev, pid, k))
        .map((k) => v(`${pid}.${k}`, `>= ${stat(prev, pid, k)}`, stat(next, pid, k)))),
  },
  {
    id: 'completed-icon-stays-completed',
    on: '*',
    citation: { section: '§6', quote: 'The icon is now completed and can never trigger again.' },
    check: (prev, _e, next) => prev.icons.filter((i) => i.completed).flatMap((i) => {
      const after = next.icons.find((n) => n.key === i.key);
      return after?.completed && after.completedBy === i.completedBy ? [] : [v(`icon ${i.key}`, { completed: true, by: i.completedBy }, after ?? null)];
    }),
  },
  {
    id: 'one-token-per-completion-and-explore',
    on: '*',
    citation: { section: '§6', quote: "put one of your tokens on that icon's hex." },
    check: (_prev, _e, next) => next.playerOrder.flatMap((pid) => {
      const p = next.players[pid]!;
      const expected = p.exploredTiles + next.icons.filter((i) => i.completedBy === pid).length;
      return p.tokensSpent === expected ? [] : [v(`${pid}.tokensSpent`, expected, p.tokensSpent)];
    }),
  },
  {
    id: 'dungeons-completed-counts-dungeon-tokens',
    on: '*',
    citation: { section: '§8', quote: 'Dungeon hexes with your token on them.' },
    check: (_prev, _e, next) => next.playerOrder.flatMap((pid) => {
      const n = next.icons.filter((i) => i.kind === 'dungeon' && i.completedBy === pid).length;
      return next.players[pid]!.dungeonsCompleted === n ? [] : [v(`${pid}.dungeonsCompleted`, n, next.players[pid]!.dungeonsCompleted)];
    }),
  },
  {
    id: 'artifact-in-one-place',
    on: '*',
    citation: { section: '§6.5', quote: 'An "Any artifact" card can never take it.' },
    check: (prev, e, next) => {
      const out: RuleViolation[] = [];
      const held = next.playerOrder.flatMap((pid) => next.players[pid]!.artifacts);
      if (new Set(held).size !== held.length) out.push(v('artifacts', 'each held by at most one player', held));
      // The Star moves only when someone completes its own map hex.
      const holder = (s: AOVerifyState) => s.playerOrder.find((pid) => s.players[pid]!.artifacts.includes('star')) ?? null;
      const before = holder(prev), after = holder(next);
      if (before !== after) {
        const starIcon = next.icons.find((i) => i.kind === 'star');
        const prevStar = prev.icons.find((i) => i.kind === 'star');
        if (!(starIcon?.completedBy === after && !prevStar?.completed)) {
          out.push(v('star holder', `${before} (only its own hex moves it)`, `${after} via ${e.moveType}`));
        }
      }
      return out;
    },
  },
  // ---------------------------------------------------------------- quests
  {
    id: 'claimed-quest-stays-claimed',
    on: '*',
    citation: { section: '§8', quote: 'Nobody else can claim it after that.' },
    check: (prev, _e, next) => {
      const out: RuleViolation[] = [];
      for (const [q, owner] of Object.entries(prev.inPlayQuests)) {
        if (owner !== 'unclaimed' && next.inPlayQuests[q] !== owner) out.push(v(`quest ${q}`, owner, next.inPlayQuests[q]));
      }
      for (const pid of next.playerOrder) {
        const p = next.players[pid]!;
        const owned = Object.entries(next.inPlayQuests).filter(([, o]) => o === pid).map(([q]) => q).sort();
        if (p.questPoints !== owned.length) out.push(v(`${pid}.questPoints`, owned.length, p.questPoints));
        if (S(p.claimedQuests) !== S(owned)) out.push(v(`${pid}.claimedQuests`, owned, p.claimedQuests));
      }
      return out;
    },
  },
  {
    id: 'instant-quest-claimed-at-once',
    on: '*',
    citation: { section: '§8', quote: 'Claimed the moment someone achieves it' },
    check: (_prev, _e, next) => Object.entries(INSTANT_QUESTS).flatMap(([q, met]) => {
      if (next.inPlayQuests[q] !== 'unclaimed') return [];
      const achievers = next.playerOrder.filter((pid) => met(next.players[pid]!));
      return achievers.length ? [v(`quest ${q}`, `claimed by ${achievers.join('/')}`, 'unclaimed')] : [];
    }),
  },
  {
    id: 'quests-in-play-players-plus-one',
    on: '*',
    citation: { section: '§2', quote: 'These are the only quests in this game.' },
    check: (_prev, _e, next) => {
      if (next.round === 0) return [];
      const n = Object.keys(next.inPlayQuests).length;
      return n === next.playerOrder.length + 1 ? [] : [v('inPlayQuests count', next.playerOrder.length + 1, n)];
    },
  },
  {
    id: 'end-quests-strict-most',
    on: '*',
    citation: { section: '§8', quote: 'If players tie for the most, no one gets the point.' },
    check: (prev, _e, next) => {
      if (prev.gameOver || !next.gameOver) return [];
      return Object.entries(END_QUESTS).flatMap(([q, count]) => {
        if (!(q in next.inPlayQuests)) return [];
        const counts = next.playerOrder.map((pid) => count(next.players[pid]!));
        const max = Math.max(...counts);
        const leaders = next.playerOrder.filter((_, i) => counts[i] === max);
        const want = leaders.length === 1 && max > 0 ? leaders[0] : 'unclaimed';
        return next.inPlayQuests[q] === want ? [] : [v(`quest ${q}`, want, next.inPlayQuests[q])];
      });
    },
  },
  // ---------------------------------------------------------------- round
  {
    id: 'turn-order-by-total',
    on: '*',
    citation: { section: '§4.1', quote: 'The highest total goes first, then the next highest, and so on.' },
    check: (prev, _e, next) => {
      if (next.round === prev.round) return [];
      const out: RuleViolation[] = [];
      for (const a of next.playerOrder) {
        for (const b of next.playerOrder) {
          if ((next.baseTotals[a] ?? 0) > (next.baseTotals[b] ?? 0) && !(next.turnOrder[a]! < next.turnOrder[b]!)) {
            out.push(v(`turn order ${a} vs ${b}`, `${a} before ${b} (${next.baseTotals[a]} > ${next.baseTotals[b]})`, next.turnOrder));
          }
        }
      }
      return out;
    },
  },
  {
    id: 'turns-follow-initiative',
    on: '*',
    citation: { section: '§4.2', quote: 'In turn order, each player takes one turn (§5).' },
    check: (prev, _e, next) => {
      if (next.gameOver || next.round !== prev.round || next.activeSeat === prev.activeSeat || prev.round === 0) return [];
      const want = prev.players[prev.activeSeat]!.initiative + 1;
      const got = next.players[next.activeSeat]!.initiative;
      return got === want ? [] : [v('next player initiative', want, got)];
    },
  },
  {
    id: 'game-ends-only-after-last-tile',
    on: '*',
    citation: { section: '§9', quote: 'Finish the current round as normal.' },
    check: (prev, _e, next) => {
      const out: RuleViolation[] = [];
      if (next.gameOver && next.tileStack.length > 0) out.push(v('gameOver', false, true));
      if (prev.endingPhase === 0 && prev.tileStack.length > 0 && next.tileStack.length === 0 && next.endingPhase === 0) {
        out.push(v('endingPhase after last tile', '>= 1', 0));
      }
      if (!prev.gameOver && next.gameOver && prev.endingPhase < 2) out.push(v('gameOver before the extra round', 'endingPhase 2 first', prev.endingPhase));
      return out;
    },
  },
  // ---------------------------------------------------------------- turn
  {
    id: 'step-to-adjacent-hex',
    on: ['step'],
    citation: { section: '§5.1', quote: 'Each step moves your standee to an adjacent hex.' },
    check: (prev, e, next) => {
      const from = prev.players[e.actor]!.hex, to = next.players[e.actor]!.hex;
      return adjacent(from, to) ? [] : [v(`${e.actor}.hex`, `a neighbour of ${from}`, to)];
    },
  },
  {
    id: 'no-entering-another-standee',
    on: ['step', 'move_away'],
    citation: { section: '§5.1', quote: "enter or pass through a hex with another player's standee on it." },
    check: (prev, e, next) => {
      const to = next.players[e.actor]!.hex;
      const other = prev.playerOrder.find((pid) => pid !== e.actor && prev.players[pid]!.hex === to);
      return other ? [v(`${e.actor}.hex`, `not ${other}'s hex`, to)] : [];
    },
  },
  {
    id: 'steps-limited-by-movement',
    on: '*',
    citation: { section: '§5.1', quote: 'as many steps as your Movement.' },
    check: (_prev, _e, next) => next.playerOrder.flatMap((pid) => {
      const p = next.players[pid]!;
      return p.stepsLeft < 0 || p.stepsLeft > stat(next, pid, 'movement') ? [v(`${pid}.stepsLeft`, `0..${stat(next, pid, 'movement')}`, p.stepsLeft)] : [];
    }),
  },
  {
    id: 'icon-ends-the-turn',
    on: ['step', 'move_away', 'try_again'],
    citation: { section: '§5', quote: 'your turn ends right after it is resolved, even if you had steps left.' },
    check: (prev, e, next) => {
      const to = e.moveType === 'try_again' ? prev.players[e.actor]!.hex : next.players[e.actor]!.hex;
      const icon = prev.icons.find((i) => i.key === to && !i.completed);
      if (!icon) return [];
      return stillMovingTurn(next, e.actor, prev.round) ? [v(`${e.actor} after triggering ${icon.kind}`, 'turn over (or resolving)', next.pendingKind)] : [];
    },
  },
  {
    id: 'explore-needs-a-step-and-an-outer-hex',
    on: ['explore'],
    citation: { section: '§5.3', quote: 'The centre hex touches no slot, so you can never explore from a centre hex.' },
    check: (prev, e, _next) => {
      if (e.move.slot !== undefined) return [];
      const p = prev.players[e.actor]!;
      const out: RuleViolation[] = [];
      if (p.stepsLeft < 1) out.push(v(`${e.actor}.stepsLeft at explore`, '>= 1', p.stepsLeft));
      if (p.hex in prev.tiles) out.push(v(`${e.actor} explored from`, 'an outer hex', `centre of Tile ${prev.tiles[p.hex]}`));
      if (prev.tileStack.length === 0) out.push(v('tile stack at explore', 'not empty', 0));
      return out;
    },
  },
  {
    id: 'explore-marks-the-tile-and-ends-the-turn',
    on: ['explore'],
    citation: { section: '§5.3', quote: 'Your remaining steps are used up and your turn ends.' },
    check: (prev, e, next) => {
      if (e.move.slot === undefined) return [];
      const out: RuleViolation[] = [];
      const before = prev.players[e.actor]!.exploredTiles, after = next.players[e.actor]!.exploredTiles;
      if (after !== before + 1) out.push(v(`${e.actor}.exploredTiles`, before + 1, after));
      if (next.tileStack.length !== prev.tileStack.length - 1) out.push(v('tileStack length', prev.tileStack.length - 1, next.tileStack.length));
      if (prev.pendingPayload.context === 'ordinary' && stillMovingTurn(next, e.actor, prev.round)) {
        out.push(v(`${e.actor} after exploring`, 'turn over', next.pendingKind));
      }
      return out;
    },
  },
  {
    id: 'forced-explore-before-moving',
    on: '*',
    citation: { section: '§5.4', quote: 'must explore at the' },
    check: (_prev, _e, next) => {
      if (next.pendingKind !== 'move' && next.pendingKind !== 'try_again') return [];
      const allDone = next.icons.length > 0 && next.icons.every((i) => i.completed);
      return allDone && next.tileStack.length > 0 ? [v(`${next.pendingSeat} pending`, 'forced explore first', next.pendingKind)] : [];
    },
  },
  // ---------------------------------------------------------------- tests
  {
    id: 'dice-equal-to-the-stat',
    on: '*',
    citation: { section: '§6', quote: 'roll a number of dice equal to one of your stats' },
    check: (_prev, _e, next) => {
      if (next.pendingKind !== 'roll' || next.pendingPayload.rollKind !== 'test') return [];
      const seat = next.pendingSeat!;
      const k = next.pendingPayload.test === 'recruit' ? 'charisma' : 'strength';
      const want = stat(next, seat, k);
      return next.pendingPayload.diceCount === want ? [] : [v(`${seat} dice for ${String(next.pendingPayload.test)}`, want, next.pendingPayload.diceCount)];
    },
  },
  {
    id: 'test-succeeds-at-or-above-the-number',
    on: ['report_test_roll'],
    citation: { section: '§6', quote: 'the number on the card, you succeed.' },
    check: (prev, e, next) => {
      const pay = prev.pendingPayload;
      const cardId = String(pay.cardId);
      const total = Number(e.move.total);
      const success = total >= Number(pay.number);
      const zone = pay.test === 'recruit' ? 'companions' : pay.test === 'little' ? 'littleMonsters' : 'bigMonsters';
      const kept = next.players[e.actor]![zone].includes(cardId);
      const out: RuleViolation[] = [];
      if (kept !== success) out.push(v(`${e.actor} keeps ${cardId} (rolled ${total}, needs ${String(pay.number)})`, success, kept));
      const icon = next.icons.find((i) => i.key === pay.iconKey);
      if (!pay.dungeon && icon && (icon.completedBy === e.actor) !== success) out.push(v(`icon ${String(pay.iconKey)} completed`, success, icon.completedBy === e.actor));
      if (!pay.dungeon && stillMovingTurn(next, e.actor, prev.round)) out.push(v(`${e.actor} after the test`, 'turn over', next.pendingKind));
      return out;
    },
  },
  {
    id: 'failed-card-to-the-bottom',
    on: ['report_test_roll', 'resolve_report'],
    citation: { section: '§6.1', quote: 'put the companion card at the bottom of the Companion deck.' },
    check: (prev, e, next) => {
      const pay = prev.pendingPayload;
      if (prev.pendingKind !== 'roll' || pay.rollKind !== 'test' || !next.serverOwnsDecks) return [];
      const cardId = String(pay.cardId);
      const deck = pay.test === 'recruit' ? 'companion' : pay.test === 'little' ? 'little' : 'big';
      const zone = pay.test === 'recruit' ? 'companions' : pay.test === 'little' ? 'littleMonsters' : 'bigMonsters';
      if (next.players[e.actor]![zone].includes(cardId)) return [];
      return next.decks[deck].at(-1) === cardId ? [] : [v(`decks.${deck} bottom after failing ${cardId}`, cardId, next.decks[deck].at(-1))];
    },
  },
];
