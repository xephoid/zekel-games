// AI development 2026-09-30 (designer's playtest + two ideas borrowed from
// Civilization V's AI):
//   - Zeke won every game by killing two Leaders with an Enchantress and a
//     Dragon: Enhance's +2 makes the Dragon's 3 a 5, a Leader's defence. The
//     AI only knew Rook and Kestrel as a +2, so it never saw the attack coming.
//   - Turn on whoever is about to win: the viewer's chance of killing the
//     leading seat's Leader first is worth something before the kill lands.
//   - Commit to a way to win: an adaptive AI seat writes its plan down at
//     upkeep and keeps it until another path is clearly faster.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { AI_OPENING_ROUNDS, applyMoveInPlace, runUpkeep } from '../engine.js';
import { runPretendBattle, startBattle } from '../engine-battle.js';
import { getLegalMoves } from '../legalMoves.js';
import { militaryRead } from '../ai-military.js';
import { strikeKills } from '../ai-strike.js';
import { chanceFrom, commitPath, readSeat, STOP_SHARE, type SeatRead } from '../ai-eval.js';
import type { NGGState } from '../types.js';
import { coordKey, neighborsOf } from '../data/maps.js';
import { base2p, placeUnit } from './pendingFixtures.js';

function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }

/** Both Leaders made culture heroes (defence 5), and every piece of wiz's
 *  beside rob's Leader, one step away. */
function soft(g: NGGState): { robTile: string; step: string } {
  g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.id = 'chronicler';
  g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.id = 'ida';
  g.heroPool = g.heroPool.filter((h) => h !== 'chronicler' && h !== 'ida');
  const robTile = g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord!;
  const [x, y] = robTile.split(',').map(Number);
  const n = neighborsOf(g.tiles, x!, y!)[0]!;
  return { robTile, step: coordKey(n.c, n.r) };
}

describe('the kill read plays the battle out (no named combos)', () => {
  it('a Dragon with an Enchantress beside it kills a defence-5 Leader; the Dragon alone does not', () => {
    const s = base2p(); const g = s.gameState;
    const { step } = soft(g);
    const wiz = player(g, 'wiz');
    wiz.buildings.push('Dragon Hoard', 'Library of Enchantment'); wiz.manaMax = 10;
    const dragon = placeUnit(g, 'wiz', step, 'dragon');
    expect(strikeKills(g, 'wiz', 'rob', [{ kind: 'unit', id: dragon }])).toBe(false);
    const ench = placeUnit(g, 'wiz', step, 'enchantress');
    expect(strikeKills(g, 'wiz', 'rob', [{ kind: 'unit', id: dragon }, { kind: 'unit', id: ench }])).toBe(true);
    expect(militaryRead(g, wiz, 'rob').byTarget.rob!).toBeLessThan(40);
  });

  it('Self Destruct counts: a researched Large Combat Platform (3 + 3) kills a defence-5 Leader; a Spinner dies first (the Leader acts before it)', () => {
    const s = base2p(); const g = s.gameState;
    soft(g);
    const wizTile = g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord!;
    const [x, y] = wizTile.split(',').map(Number);
    const n = neighborsOf(g.tiles, x!, y!)[0]!;
    const spinner = placeUnit(g, 'rob', coordKey(n.c, n.r), 'large-combat-platform');
    expect(strikeKills(g, 'rob', 'wiz', [{ kind: 'unit', id: spinner }])).toBe(false);
    player(g, 'rob').research.push('self-destruct');
    expect(strikeKills(g, 'rob', 'wiz', [{ kind: 'unit', id: spinner }])).toBe(true);
  });

  it('protection counts too: an Immobile Combat Platform on the Leader tile stops the Dragon and Enchantress', () => {
    const s = base2p(); const g = s.gameState;
    const { robTile, step } = soft(g);
    const wiz = player(g, 'wiz');
    wiz.buildings.push('Dragon Hoard', 'Library of Enchantment'); wiz.manaMax = 10;
    const force = [{ kind: 'unit' as const, id: placeUnit(g, 'wiz', step, 'dragon') }, { kind: 'unit' as const, id: placeUnit(g, 'wiz', step, 'enchantress') }];
    expect(strikeKills(g, 'wiz', 'rob', force)).toBe(true);
    placeUnit(g, 'rob', robTile, 'immobile-combat-platform');
    expect(strikeKills(g, 'wiz', 'rob', force)).toBe(false);
  });

  it('and a Cleric with mana on the Leader tile saves it from a Self Destruct', () => {
    const s = base2p(); const g = s.gameState;
    soft(g);
    const wizTile = g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord!;
    const [x, y] = wizTile.split(',').map(Number);
    const n = neighborsOf(g.tiles, x!, y!)[0]!;
    const spinner = placeUnit(g, 'rob', coordKey(n.c, n.r), 'large-combat-platform');
    player(g, 'rob').research.push('self-destruct');
    expect(strikeKills(g, 'rob', 'wiz', [{ kind: 'unit', id: spinner }])).toBe(true);
    const wiz = player(g, 'wiz');
    wiz.buildings.push('Temple'); wiz.manaMax = 10;
    placeUnit(g, 'wiz', wizTile, 'cleric');
    expect(strikeKills(g, 'rob', 'wiz', [{ kind: 'unit', id: spinner }])).toBe(false);
  });
});

// Off as shipped (ai-eval.ts STOP_SHARE = 0, measured to hurt at 4 players);
// these run when it is switched back on.
describe.skipIf(STOP_SHARE === 0)('turn on whoever is about to win', () => {
  const seat = (playerId: string, eta: number, byTarget: Record<string, number> = {}, alive = true) =>
    ({ playerId, eta, alive, military: { byTarget } }) as unknown as SeatRead;
  const g = { result: null, treaties: [] } as unknown as NGGState;

  it('being able to kill the leader soon raises my chance; landing the kill raises it more', () => {
    const far = chanceFrom(g, 'me', [seat('me', 8, { lead: 20 }), seat('lead', 4), seat('other', 9)]);
    const near = chanceFrom(g, 'me', [seat('me', 8, { lead: 3 }), seat('lead', 4), seat('other', 9)]);
    const killed = chanceFrom(g, 'me', [seat('me', 8, { lead: 3 }), seat('lead', 99, {}, false), seat('other', 9)]);
    expect(near).toBeGreaterThan(far);
    expect(killed).toBeGreaterThan(near);
  });

  it('a threat to a seat that is behind me is worth nothing extra', () => {
    const far = chanceFrom(g, 'me', [seat('me', 4, { back: 20 }), seat('back', 8)]);
    const near = chanceFrom(g, 'me', [seat('me', 4, { back: 3 }), seat('back', 8)]);
    expect(near).toBeCloseTo(far, 10);
  });

  it('a Culture Treaty partner is never the one to turn on', () => {
    const treaty = { result: null, treaties: [{ type: 'culture-treaty', partners: ['me', 'lead'] }] } as unknown as NGGState;
    const far = chanceFrom(treaty, 'me', [seat('me', 8, { lead: 20 }), seat('lead', 4), seat('other', 9)]);
    const near = chanceFrom(treaty, 'me', [seat('me', 8, { lead: 3 }), seat('lead', 4), seat('other', 9)]);
    expect(near).toBeCloseTo(far, 10);
  });
});

describe('commit to a way to win', () => {
  it('keeps its plan while it is within three rounds of the best path, and drops it when it is not', () => {
    const s = base2p(); const g = s.gameState;
    g.round = 4; // after the first three rounds (see the next case)
    const rob = player(g, 'rob');
    const r = readSeat(g, rob, 'rob');
    const byPath = { ...r.race.byPath, military: r.military.eta };
    const paths = Object.keys(byPath) as Array<keyof typeof byPath>;
    const best = paths.reduce((a, b) => (byPath[b] < byPath[a] ? b : a));
    expect(commitPath(g, rob)!.path).toBe(best);
    const close = paths.find((k) => k !== best && byPath[k] <= byPath[best] + 3);
    if (close) {
      rob.aiPlan = { path: close, since: 1 };
      expect(commitPath(g, rob)!.path).toBe(close);
    }
    const far = paths.find((k) => byPath[k] > byPath[best] + 3);
    expect(far).toBeDefined();
    rob.aiPlan = { path: far!, since: 1 };
    expect(commitPath(g, rob)).toEqual({ path: best, since: g.round });
  });

  it('an AI seat draws an opening goal (seeded), holds it through the opening, then pivots early to a path half a round faster (2026-10-08)', () => {
    // Every adaptive AI seat in an all-AI game starts on a drawn goal, marked
    // as its opening; the same seed draws the same goals.
    const four = Array.from({ length: 4 }, (_, i) => ({ player_id: `p${i + 1}`, kind: 'ai' as const }));
    const a = game.createSession(four, { seed: 4242 } as never).gameState;
    const b = game.createSession(four, { seed: 4242 } as never).gameState;
    for (const p of a.players) expect(p.aiPlan).toMatchObject({ openingUntil: AI_OPENING_ROUNDS });
    expect(a.players.map((p) => p.aiPlan!.path)).toEqual(b.players.map((p) => p.aiPlan!.path));
    // Held through the opening rounds even when another path reads faster;
    // then the early pivot: a goal half a round slower is dropped.
    const g = base2p().gameState;
    g.round = AI_OPENING_ROUNDS;
    const rob = player(g, 'rob');
    const r = readSeat(g, rob, 'rob');
    const byPath = { ...r.race.byPath, military: r.military.eta };
    const paths = Object.keys(byPath) as Array<keyof typeof byPath>;
    const best = paths.reduce((x, y) => (byPath[y] < byPath[x] ? y : x));
    const slower = paths.find((k) => byPath[k] > byPath[best] + 0.5)!;
    expect(slower).toBeDefined();
    rob.aiPlan = { path: slower, since: 0, openingUntil: AI_OPENING_ROUNDS };
    expect(commitPath(g, rob)!.path).toBe(slower);
    g.round = AI_OPENING_ROUNDS + 1;
    expect(commitPath(g, rob)).toEqual({ path: best, since: AI_OPENING_ROUNDS + 1 });
  });

  it('upkeep writes the plan for AI seats only, and no view shows it', () => {
    const s = base2p(); const g = s.gameState;
    player(g, 'rob').kind = 'ai';
    runUpkeep(g);
    expect(player(g, 'rob').aiPlan).toBeDefined();
    expect(player(g, 'wiz').aiPlan).toBeUndefined();
    for (const view of [game.getPublicView(s), game.getPlayerView(s, 'wiz'), game.getPlayerView(s, 'rob')]) {
      expect(JSON.stringify(view)).not.toContain('aiPlan');
    }
  });
});

describe('a pretend battle stops when the battle ends', () => {
  it('the game does not carry on into the end of the round or upkeep (which would start more pretend battles)', () => {
    const s = base2p(); const g = structuredClone(s.gameState);
    const { robTile, step } = soft(g);
    const wiz = player(g, 'wiz');
    wiz.buildings.push('Dragon Hoard');
    const dragon = placeUnit(g, 'wiz', step, 'dragon');
    g.pending = null; g.actionStack = []; g.activeAction = null;
    for (const p of g.players) p.hand = [];
    const round = g.round; const phase = g.phase;
    runPretendBattle(() => {
      startBattle(g, wiz, step, robTile, [{ kind: 'unit', id: dragon }], ['rob']);
      for (let i = 0; i < 200 && g.battle; i++) {
        const pid = g.pending?.forPlayerId ?? g.activePlayerId;
        applyMoveInPlace(g, pid, getLegalMoves(g, pid)[0]!.move);
      }
    });
    expect(g.battle).toBeNull();
    expect(g.round).toBe(round);
    expect(g.phase).toBe(phase);
  });
});
