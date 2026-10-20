// Designer ruling #111 (2026-09-27): Self Destruct, a robot research at Home
// (2 ore + 1 wood + 1 oil). In battle, any of the researcher's robot units
// (not heroes) with printed DMG 1 or more may blow itself up on its
// activation instead of attacking: current DMG + 3 to every other unit and
// hero in the battle, every side — the robot's own pieces included — with
// the reactions of an area attack. The unit is lost, its Core back to the
// supply. Killing your own Leader this way earns no Military credit.

import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { ROBOT_RESEARCH, TECH_TARGET } from '../data/catalogs.js';
import { battleActivation, commitBattleCard, startBattle } from '../engine-battle.js';
import { activationScore } from '../ai-battle.js';
import type { NGGState } from '../types.js';
import type { SessionState } from '@zekel/game-kit';
import { base2p, placeUnit } from './pendingFixtures.js';

function player(g: NGGState, id: string) { return g.players.find((p) => p.playerId === id)!; }

function settleCommits(g: NGGState) {
  let guard = 0;
  while (g.pending?.kind === 'battle_commit' && guard++ < 10) commitBattleCard(g, g.pending.forPlayerId, null);
}

/** Pass every activation until `ref` is up. */
function passUntil(g: NGGState, ref: string) {
  let guard = 0;
  while (guard++ < 12) {
    const b = g.battle!;
    const cur = b.activationQueue[b.activationCursor];
    if (cur === undefined || cur === ref) return;
    const owner = b.units.find((u) => u.unitRef === cur)!.ownerId;
    battleActivation(g, owner, { type: 'battle_activation', unit: cur, action: { kind: 'pass' } });
  }
}

/** rob's Spitter (initiative 95, DMG 1) and Spinner attack wiz's Evoker and
 *  Enchantress at (0,4) from (0,2). Both Leaders stay home. */
function skirmish(): { s: SessionState<NGGState>; g: NGGState; spitter: string; spinner: string; evoker: string; ench: string } {
  const s = base2p();
  const g = s.gameState;
  const spitter = placeUnit(g, 'rob', '0,2', 'spitter');
  const spinner = placeUnit(g, 'rob', '0,2', 'spinner');
  const evoker = placeUnit(g, 'wiz', '0,4', 'evoker');
  const ench = placeUnit(g, 'wiz', '0,4', 'enchantress');
  startBattle(g, player(g, 'rob'), '0,2', '0,4', [{ kind: 'unit', id: spitter }, { kind: 'unit', id: spinner }], []);
  settleCommits(g);
  passUntil(g, spitter);
  expect(g.battle!.activationQueue[g.battle!.activationCursor]).toBe(spitter);
  return { s, g, spitter, spinner, evoker, ench };
}

describe('#111 Self Destruct', () => {
  it('is a robot research at Home for 2 ore + 1 wood + 1 oil, and is one of the 26 robot technology types (ruling #129 added the battle card type)', () => {
    const r = ROBOT_RESEARCH.find((x) => x.id === 'self-destruct')!;
    expect(r.prerequisite).toBe('Home');
    expect(r.cost).toEqual({ ore: 2, wood: 1, oil: 1 });
    expect(TECH_TARGET.robot).toBe(26);
  });

  it('is neither offered nor accepted without the research', () => {
    const { s, g, spitter } = skirmish();
    const offered = game.getLegalMoves(s, 'rob').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'self_destruct');
    expect(offered).toHaveLength(0);
    expect(() => battleActivation(g, 'rob', { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } })).toThrow(/not researched/);
  });

  it('with the research, a DMG-1 Spitter blows up for 4: every other unit dies, its own Spinner included; the Spitter is lost and both Cores go back to the supply', () => {
    const { s, g, spitter, spinner, evoker, ench } = skirmish();
    const rob = player(g, 'rob');
    rob.research.push('self-destruct');
    const offered = game.getLegalMoves(s, 'rob').filter((m) => m.move.type === 'battle_activation' && (m.move.action as { kind: string }).kind === 'self_destruct');
    expect(offered.map((m) => (m.move as { unit: string }).unit)).toEqual([spitter]); // the Spinner is not up yet
    expect(offered[0]!.description).toMatch(/4 DMG/);
    const supplyBefore = rob.coresInSupply;
    const summary = battleActivation(g, 'rob', { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } });
    expect(summary).toBeDefined();
    for (const id of [spitter, spinner, evoker, ench]) expect(g.units.some((u) => u.id === id)).toBe(false);
    expect(rob.coresInSupply).toBe(supplyBefore + 2);
    expect(g.log.some((e) => /self-destruct/.test(e.summary) && /kills/.test(e.summary))).toBe(true);
    expect(g.log.some((e) => /lost in its own blast/.test(e.summary))).toBe(true);
    expect(g.battle).toBeNull(); // nobody left: the battle settles
  });

  it("a defense against the blast is told it is a self-destruct", () => {
    const { s, g, spitter } = skirmish();
    player(g, 'rob').research.push('self-destruct');
    const wiz = player(g, 'wiz');
    wiz.research.push('mana-shield');
    wiz.manaCurrent = wiz.manaMax;
    battleActivation(g, 'rob', { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } });
    expect(g.pending?.kind).toBe('battle_defense');
    const view = game.getPlayerView!(s, g.pending!.forPlayerId) as { pending: { context: { self_destruct: boolean; attack_kind: string } } };
    expect(view.pending.context.self_destruct).toBe(true);
  });

  it('a hero cannot self-destruct', () => {
    const s = base2p();
    const g = s.gameState;
    player(g, 'rob').research.push('self-destruct');
    const kestrel = g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!;
    kestrel.coord = '0,2';
    placeUnit(g, 'wiz', '0,4', 'evoker');
    startBattle(g, player(g, 'rob'), '0,2', '0,4', [{ kind: 'hero', id: 'kestrel' }], []);
    settleCommits(g);
    passUntil(g, 'kestrel');
    expect(() => battleActivation(g, 'rob', { type: 'battle_activation', unit: 'kestrel', action: { kind: 'self_destruct' } })).toThrow(/Only a robot unit/);
  });

  it('a blast that kills the enemy Leader is a Military kill; killing your own Leader with it earns nothing', () => {
    const s = base2p();
    const g = s.gameState;
    player(g, 'rob').research.push('self-destruct');
    // Spitter beside Kestrel: 1 + 2 + 3 = 6, enough for wiz's Warden (Leader, DEF 5) and for Kestrel itself (Leader, DEF 6).
    const kestrel = g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!;
    kestrel.coord = '0,2';
    const spitter = placeUnit(g, 'rob', '0,2', 'spitter');
    g.heroes.find((h) => h.ownerId === 'wiz' && h.isLeader)!.coord = '0,4';
    startBattle(g, player(g, 'rob'), '0,2', '0,4', [{ kind: 'unit', id: spitter }, { kind: 'hero', id: 'kestrel' }], []);
    settleCommits(g);
    passUntil(g, spitter);
    // The hard AI would never take this one: its own Leader dies in the blast.
    expect(activationScore(g, player(g, 'rob'), { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } })).toBe(0);
    battleActivation(g, 'rob', { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } });
    expect(g.heroes.find((h) => h.id === 'warden')!.dead).toBe(true);
    expect(g.heroes.find((h) => h.id === 'kestrel')!.dead).toBe(true);
    expect(player(g, 'rob').leaderKills).toBe(1); // Warden, not Kestrel
    expect(player(g, 'wiz').leaderKills).toBe(0);
  });

  it('the hard AI rates a blast by what it kills on each side', () => {
    const { g, spitter } = skirmish();
    player(g, 'rob').research.push('self-destruct');
    // Two of theirs (Evoker, Enchantress) for one of ours (the Spinner): worth it.
    const blast = activationScore(g, player(g, 'rob'), { type: 'battle_activation', unit: spitter, action: { kind: 'self_destruct' } });
    expect(blast).toBeGreaterThan(5);
    const pass = activationScore(g, player(g, 'rob'), { type: 'battle_activation', unit: spitter, action: { kind: 'pass' } });
    expect(blast).toBeGreaterThan(pass);
  });
});
