// AI development 2026-09-26 (designer's playtest note): the hard AI did not
// defend its Leader. In 547 Leader kills at 4-6 players every victim's
// Leader was alone in the field, the killer's spy had been armed three rounds
// earlier, and no victim had bought a Cleric, a Wall or a Castle. Three
// changes: being killed before finishing now counts against a seat's own
// chances (ai-eval.ts, the survival discount); the guard count knows a Wall
// Platform (#93), a Castle (#98) and pieces that kill a spy carrier before it
// acts (an Immobile Combat Platform at a fortified base); and a fortified
// tile is answered with a bigger force — escorts, bought if short — not
// abandoned (the arms race).

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { chooseMove } from '../ai.js';
import { counterKillers, escortsOf, militaryRead } from '../ai-military.js';
import { chanceAll } from '../ai-eval.js';
import type { NGGMove, NGGState } from '../types.js';
import type { SessionState } from '@zekel/game-kit';
import { base2p, placeUnit } from './pendingFixtures.js';

function apply(s: SessionState<NGGState>, playerId: string, move: NGGMove) {
  return game.applyMove(s, playerId, move).newState;
}
function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }
function leaderCoord(g: NGGState, id: string) { return g.heroes.find((h) => h.ownerId === id && h.isLeader)!.coord!; }

// The fixture's carriers are each seat's Leader (Warden, Kestrel). A seat
// never plans its OWN strike with its Leader (2026-10-08), so these reads are
// taken from the rival's seat — how the defender sees the threat, Leader
// included, since a human may walk theirs in.

/** wiz's Warden carries an armed Invisible spy. */
function armWizard(g: NGGState) {
  const wiz = player(g, 'wiz');
  wiz.buildings.push('Library of Illusion');
  wiz.spyAssignments.push({ source: 'illusionist', heroId: 'warden', active: true });
  wiz.research.push('invisible');
}
/** rob's Kestrel carries an armed Spy Attack. */
function armRobot(g: NGGState) {
  const rob = player(g, 'rob');
  rob.buildings.push('Diplomatic Research Station');
  rob.spyAssignments.push({ source: 'infiltrator', heroId: 'kestrel', active: true });
}

describe('the guard count knows the rules', () => {
  it('a standing Wall Platform on the Leader\'s tile closes a rival\'s spy line (it used to count as two rounds, 2026-10-08)', () => {
    const g = base2p().gameState;
    armWizard(g);
    const before = militaryRead(g, player(g, 'wiz'), 'rob');
    expect(before.line).toBe('spy');
    placeUnit(g, 'rob', leaderCoord(g, 'rob'), 'wall-platform');
    const after = militaryRead(g, player(g, 'wiz'), 'rob');
    // Spies never get through a Wall: only a battle can kill that Leader now.
    expect(after.line).not.toBe('spy');
    expect(after.byTarget['rob']!).toBeGreaterThan(before.byTarget['rob']! + 2);
  });

  it('a wizard Leader at its Castle is safer than the same Leader one tile out', () => {
    const g = base2p().gameState;
    armRobot(g);
    const home = militaryRead(g, player(g, 'rob'), 'wiz').byTarget['wiz']!;
    g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '-2,8';
    const out = militaryRead(g, player(g, 'rob'), 'wiz').byTarget['wiz']!;
    // One tile nearer the robot, yet the Castle's guard is gone: net +1 for the attacker.
    expect(home - out).toBeGreaterThanOrEqual(1);
  });

  it('an Immobile Combat Platform (initiative 98, damage 6) kills a lone carrier first; a Rook-boosted hero counts too', () => {
    const g = base2p().gameState;
    const base = leaderCoord(g, 'rob');
    const carrier = { init: 30, def: 3 };
    expect(counterKillers(g, 'rob', base, carrier)).toBe(1); // Kestrel: 70 ≥ 30, 3 ≥ 3
    placeUnit(g, 'rob', base, 'immobile-combat-platform');
    expect(counterKillers(g, 'rob', base, carrier)).toBe(2);
    // A Leader carrier (defence 5) is beyond a military hero's 3 — until Rook stands beside it (+2).
    // Kestrel is a booster itself and never takes Rook's +2 (the engine's rule), so Marshal is the hitter.
    expect(counterKillers(g, 'rob', base, { init: 70, def: 5 })).toBe(1); // the platform only
    g.heroPool = g.heroPool.filter((h) => h !== 'rook' && h !== 'marshal');
    g.heroes.push({ id: 'marshal', ownerId: 'rob', coord: base, isLeader: false, dead: false });
    expect(counterKillers(g, 'rob', base, { init: 70, def: 5 })).toBe(2); // Marshal 3 + Kestrel's 2 = 5
    g.heroes.push({ id: 'rook', ownerId: 'rob', coord: base, isLeader: false, dead: false });
    expect(counterKillers(g, 'rob', base, { init: 70, def: 5 })).toBe(2); // identical +2s do not stack; Rook's own 3 is short
  });
});

describe('the arms race', () => {
  it('a fortified base slows the spy line; an escort in hand brings it back, and the AI never walks a lone carrier in', () => {
    const g = base2p().gameState;
    armWizard(g);
    const wiz = player(g, 'wiz');
    const base = leaderCoord(g, 'rob');
    const open = militaryRead(g, wiz, 'rob').byTarget['rob']!;
    placeUnit(g, 'rob', base, 'immobile-combat-platform');
    const fortified = militaryRead(g, wiz, 'rob').byTarget['rob']!;
    expect(fortified).toBeGreaterThan(open + 2);
    expect(escortsOf(g, wiz)).toBe(0);
    placeUnit(g, 'wiz', leaderCoord(g, 'wiz'), 'evoker');
    expect(escortsOf(g, wiz)).toBe(1);
    const escorted = militaryRead(g, wiz, 'rob').byTarget['rob']!;
    expect(escorted).toBeLessThan(fortified);
    expect(escorted).toBeGreaterThan(open);
  });
});

describe('a carrier that is not on the map', () => {
  it('an armed spy on a reserved hero closes the spy line instead of crashing the read (harness 2026-09-27)', () => {
    const g = base2p().gameState;
    const wiz = player(g, 'wiz');
    wiz.buildings.push('Library of Illusion');
    wiz.research.push('invisible');
    g.heroPool = g.heroPool.filter((h) => h !== 'quartermaster');
    g.heroes.push({ id: 'quartermaster', ownerId: 'wiz', coord: null, isLeader: false, dead: false }); // reserved
    wiz.spyAssignments.push({ source: 'illusionist', heroId: 'quartermaster', active: true });
    const read = militaryRead(g, wiz, 'wiz');
    expect(read.line).not.toBe('spy');
    expect(Number.isFinite(read.byTarget['rob'] ?? 0)).toBe(true);
    expect(() => chanceAll(structuredClone(g), 'wiz')).not.toThrow();
  });
});

describe('the survival discount', () => {
  it('a seat that can be killed before it finishes has less chance, and more again behind a Wall', () => {
    // Reads are cached per state object, so each read gets its own copy.
    const g = base2p().gameState;
    const before = chanceAll(structuredClone(g), 'rob');
    armWizard(g);
    const threatened = chanceAll(structuredClone(g), 'rob');
    expect(threatened).toBeLessThan(before);
    placeUnit(g, 'rob', leaderCoord(g, 'rob'), 'wall-platform');
    expect(chanceAll(structuredClone(g), 'rob')).toBeGreaterThan(threatened);
  });
});

// ---- the decision itself: attack an unguarded Leader, not a fortified one.
function driveMoveBattle(s: SessionState<NGGState>, mover: string): SessionState<NGGState> {
  const placed = new Set<string>();
  let guard = 0;
  while (s.gameState.phase === 'planning' && guard++ < 12) {
    const head = s.gameState.planningOrder[0]!;
    const card = head === mover && !placed.has(head) ? 'move_battle' as const : 'pass' as const;
    if (card === 'move_battle') placed.add(head);
    s = apply(s, head, { type: 'plan_action', card });
  }
  let g0 = 0;
  while (g0++ < 6 && (s.gameState.activeAction?.ownerId !== mover || s.gameState.activeAction?.cardKind !== 'move_battle')) {
    s = apply(s, s.gameState.activeAction!.ownerId, { type: 'skip_action' });
  }
  return s;
}

function readyToStrike(fortified: boolean): SessionState<NGGState> {
  let s = base2p();
  const g = s.gameState;
  g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!.coord = '-2,8'; // alone, one step from wiz's base
  player(g, 'rob').culture = 47; // about to win by culture: the kill has to land now
  if (fortified) placeUnit(g, 'rob', '-2,8', 'immobile-combat-platform');
  armWizard(g);
  s = driveMoveBattle(s, 'wiz');
  expect(s.gameState.activeAction?.ownerId).toBe('wiz');
  return s;
}

describe('the decision', () => {
  it('with an armed spy one step from a lone enemy Leader, the AI walks in and reveals it', () => {
    let s = readyToStrike(false);
    const mv = chooseMove(s.gameState, 'wiz', 'hard', 'military').move;
    expect(mv).toMatchObject({ type: 'move_units', to: '-2,8' });
    expect((mv as { units: string[] }).units).toContain('warden');
    s = apply(s, 'wiz', mv);
    let guard = 0;
    while (!s.gameState.result && guard++ < 20) {
      const pid = s.activePlayerId;
      s = apply(s, pid, chooseMove(s.gameState, pid, 'hard').move);
    }
    expect(s.gameState.result?.summary).toMatch(/wiz wins \(Military\)/);
  });

  it('with an Immobile Combat Platform beside that Leader, the lone carrier stays out', () => {
    const s = readyToStrike(true);
    const mv = chooseMove(s.gameState, 'wiz', 'hard', 'military').move;
    const walksIn = mv.type === 'move_units' && mv.to === '-2,8' && mv.units.includes('warden');
    expect(walksIn).toBe(false);
  });
});
