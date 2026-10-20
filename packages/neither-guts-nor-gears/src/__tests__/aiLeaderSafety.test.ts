// Zeke won Military games against the hard AI by turning the units he had
// bought for technology on AI Leaders standing alone away from their bases
// (saved games, 2026-09-30 / 2026-10-01). Two faults let it happen:
//   1. Threats read a round or two late. A force next door strikes this
//      round, during the actions, but the read added a round for the strike
//      itself and counted walks a round behind the economy's clock — so an
//      AI whose culture win was due at this round's income thought it would
//      finish first.
//   2. The move planner never fully scored the Leader stepping home: its
//      quick first look ranks moves by what they gain, and a retreat gains
//      only safety.
// `data/leader-out-alone-r10.json` is the position at the start of round 10
// of one of those games (log stripped): p4's Chronicler stands one step from
// its base with Zeke's Enchantress, Evoker and Enchantress next door; in the
// real game it stayed and died that round.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import game from '../index.js';
import { chooseMove } from '../ai.js';
import { readTable } from '../ai-eval.js';
import { militaryRead, threatFrom } from '../ai-military.js';
import { coordKey, neighborsOf } from '../data/maps.js';
import { base2p, placeUnit } from './pendingFixtures.js';
import type { SessionState } from '@zekel/game-kit';
import type { NGGState } from '../types.js';

type S = SessionState<NGGState>;

function savedPosition(): S {
  return JSON.parse(readFileSync(new URL('./data/leader-out-alone-r10.json', import.meta.url), 'utf8')) as S;
}

describe('a strike from next door reads as this round', () => {
  it('a Dragon and an Enchantress beside a lone Leader read 0 — before this round\'s income — not two rounds', () => {
    const g = base2p().gameState;
    const leader = g.heroes.find((h) => h.ownerId === 'rob' && h.isLeader)!;
    leader.id = 'chronicler'; // defence 5
    g.heroPool = g.heroPool.filter((h) => h !== 'chronicler');
    const free = (k: string) => !g.bases.some((b) => b.coord === k) && !g.units.some((u) => u.coord === k)
      && !g.heroes.some((h) => h.coord === k) && !g.placements.some((p) => p.coord === k);
    const around = (k: string) => { const [c, r] = k.split(',').map(Number); return neighborsOf(g.tiles, c!, r!).map((t) => coordKey(t.c, t.r)); };
    leader.coord = around(leader.coord!).find(free)!;
    const next = around(leader.coord).find(free)!;
    placeUnit(g, 'wiz', next, 'dragon');
    placeUnit(g, 'wiz', next, 'enchantress');
    const read = militaryRead(g, g.players.find((p) => p.playerId === 'wiz')!, 'rob');
    expect(read.byTarget['rob']!).toBeLessThanOrEqual(0);
  });

  it('in the saved game, the threat to the Chronicler reads before its own culture win', () => {
    const g = savedPosition().gameState;
    const t = readTable(g, 'p4');
    expect(threatFrom(t.seats, 'p4')).toBeLessThan(t.bySeat.get('p4')!.eta);
  });
});

describe('a threatened Leader goes home', () => {
  it('in the saved game, p4 plays a Move/Battle card and walks its Chronicler back onto its base', () => {
    let s = savedPosition();
    const leader = s.gameState.heroes.find((h) => h.ownerId === 'p4' && h.isLeader)!;
    const base = s.gameState.bases.find((b) => b.ownerId === 'p4')!.coord;
    expect(leader.coord).not.toBe(base);
    // Play the round: AI seats by the hard AI, the human seat passes.
    for (let i = 0; i < 400 && s.gameState.round === 10 && !s.gameState.result; i++) {
      const pid = s.activePlayerId;
      const move = pid === 'p1'
        ? (game.getLegalMoves(s, pid).map((l) => l.move).find((m) => (m.type === 'plan_action' && m.card === 'pass') || m.type === 'skip_action') ?? game.getLegalMoves(s, pid)[0]!.move)
        : chooseMove(s.gameState, pid, 'hard').move;
      s = game.applyMove(s, pid, move).newState as S;
    }
    expect(s.gameState.heroes.find((h) => h.ownerId === 'p4' && h.isLeader)!.coord).toBe(base);
  });
});
