// The AI plays with a plan, not move by move (ai-development gate, rebuilt
// 2026-09-24). Each case below is a blunder the earlier AI made in real games
// — queued cards thrown away, battle cards bought with no fight coming, a
// Leader walked back and forth, the same treaty offered four times a round to
// a seat that kept refusing, and two military seats trading Decoys forever.

import { describe, expect, it } from 'vitest';
import { neitherGutsNorGears as game } from '../index.js';
import { chooseMove } from '../ai.js';
import type { SessionState } from '@zekel/game-kit';
import type { NGGState } from '../types.js';

type S = SessionState<NGGState>;

function play(factions: string[], seed: number, opts: { strategy?: string; difficulty?: 'hard' | 'medium'; maxMoves?: number } = {}): S {
  const cfgs = factions.map((_, i) => ({ player_id: `p${i + 1}`, kind: 'ai' as const, ...(opts.strategy ? { strategy: opts.strategy } : {}) }));
  let s: S = game.createSession(cfgs, { seed, factionAssignment: factions });
  for (let i = 0; i < (opts.maxMoves ?? 4000) && !s.gameState.result; i++) {
    const pid = s.activePlayerId;
    s = game.applyMove(s, pid, chooseMove(s.gameState, pid, opts.difficulty ?? 'hard', opts.strategy).move).newState as S;
  }
  return s;
}

const summaries = (s: S, actor?: string) => s.gameState.log.filter((e) => actor === undefined || e.actor === actor).map((e) => e.summary);

describe('the AI plays with a plan', () => {
  const games = [
    play(['covenant', 'schism'], 41),
    play(['ledger', 'covenant'], 42),
    play(['ledger', 'foundry'], 43),
  ];

  it('finishes every game', () => {
    for (const s of games) expect(s.gameState.result).not.toBeNull();
  });

  it('lays down only the action cards it uses (at most one thrown away a game per seat)', () => {
    for (const s of games) for (const p of s.gameState.players) {
      const thrown = summaries(s, p.playerId).filter((x) => /declines the queued/.test(x)).length;
      expect(thrown).toBeLessThanOrEqual(2);
    }
  });

  it('never offers a treaty again right after it was refused', () => {
    for (const s of games) {
      const log = s.gameState.log.filter((e) => e.category === 'treaty');
      for (let i = 0; i < log.length; i++) {
        const m = /^(\S+) declines .* from (\S+)$/.exec(log[i]!.summary);
        if (!m) continue;
        const [, partner, proposer] = m;
        const again = log.slice(i + 1).find((e) => e.turn === log[i]!.turn && e.summary.startsWith(`${proposer} offers `) && e.summary.endsWith(` to ${partner}`));
        expect(again, `${proposer} re-offered to ${partner} in round ${log[i]!.turn}`).toBeUndefined();
      }
    }
  });

  it('buys battle cards only when a fight is coming', () => {
    // An AI's card draw is silent; a Research action that paid collectors
    // and researched nothing was a battle-card purchase. The earlier AI
    // bought 10–13 of them in games that had no battle at all.
    for (const s of games) {
      if (s.gameState.log.some((e) => /^Battle at/.test(e.summary))) continue;
      let open: { actor: string; paid: boolean; researched: boolean; turn: number } | null = null;
      const bought: number[] = [];
      for (const e of s.gameState.log) {
        const reveal = /^(\S+) reveals their research action/.exec(e.summary);
        if (reveal) { open = { actor: reveal[1]!, paid: false, researched: false, turn: e.turn }; continue; }
        if (!open) continue;
        if (e.actor === open.actor && /commits \d+ collector/.test(e.summary)) open.paid = true;
        if (e.actor === open.actor && /researches /.test(e.summary)) open.researched = true;
        if (e.summary === `${open.actor}'s research action is complete`) {
          if (open.paid && !open.researched) bought.push(open.turn);
          open = null;
        }
      }
      expect(bought.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('Leader kills', () => {
  it('two military seats finish: no endless trade of spies and Decoys', () => {
    // Before the fix both Leaders carried spies, each attack was met by the
    // defender striking first and the attacker's Decoy, and the game ran past
    // round 400.
    for (const seed of [20000, 20003]) {
      const s = play(['covenant', 'schism'], seed, { strategy: 'military', maxMoves: 6000 });
      expect(s.gameState.result, `seed ${seed}`).not.toBeNull();
      expect(s.gameState.round).toBeLessThan(40);
    }
  }, 60_000);

  it('a military seat buys and arms the spy line; two guarded Leaders end in a standoff the culture race settles', () => {
    const cfgs = ['a', 'b'].map((player_id) => ({ player_id, kind: 'ai' as const }));
    // Ledger + Marshal vs Brass Circle + Elara, seed 82003 (see reverification.test.ts). Until 2026-09-26 the
    // wizard's spy killed a robot Leader that had wandered out alone; now the robot's Leader stays home with
    // an armed Spy Attack (it strikes first) and the wizard's carrier is its own Leader, so neither walks in
    // and the robot's culture engine wins. The kill itself is covered by aiDefends.test.ts.
    let s: S = game.createSession(cfgs, { seed: 82003, factionAssignment: ['ledger', 'brass-circle'], aiLeaderAssignment: ['marshal', 'elara'] });
    for (let i = 0; i < 2000 && !s.gameState.result; i++) {
      s = game.applyMove(s, s.activePlayerId, chooseMove(s.gameState, s.activePlayerId, 'hard', 'military').move).newState as S;
    }
    expect(s.gameState.result).not.toBeNull();
    expect(s.gameState.round).toBeLessThan(15);
    const b = summaries(s, 'b');
    expect(b.some((x) => /builds Library of Illusion/.test(x))).toBe(true);
    expect(b.some((x) => /researches Invisible/.test(x))).toBe(true);
  }, 20_000);
});

describe('attacks that cannot kill', () => {
  it('Rook alone does not walk onto a Leader it cannot hurt (its +2 is for the others)', () => {
    // Balance run 2026-09-24: the AI counted Rook's +2 on Rook itself (3+2 = a
    // Leader's 5 defence), attacked every round, got Decoyed, and the game ran
    // past round 300.
    const s = game.createSession([{ player_id: 'a', kind: 'ai' }, { player_id: 'b', kind: 'ai' }],
      { seed: 5021098, factionAssignment: ['brass-circle', 'schism'], aiLeaderAssignment: ['rook', 'archivist'] });
    const g = s.gameState;
    const rook = g.heroes.find((h) => h.id === 'rook')!;
    const target = g.heroes.find((h) => h.ownerId === 'b' && h.isLeader)!;
    // Put Rook next to the enemy Leader, on a Move/Battle action of its own.
    const next = (() => { const [c, r] = target.coord!.split(',').map(Number); return `${c! + 1},${r! + 1}`; })();
    const at = g.tiles.some((t) => `${t.c},${t.r}` === next) ? next : (() => { const [c, r] = target.coord!.split(',').map(Number); return `${c! - 1},${r! - 1}`; })();
    rook.coord = at;
    g.phase = 'action'; g.pending = null; g.battle = null; g.activePlayerId = 'a'; s.activePlayerId = 'a';
    g.actionStack = [{ ownerId: 'a', cardKind: 'move_battle', slotId: 'move_battle:base' }];
    g.activeAction = { ownerId: 'a', cardKind: 'move_battle', slotId: 'move_battle:base' };
    const pick = chooseMove(g, 'a', 'hard').move;
    expect(pick.type === 'move_units' && pick.to === target.coord).toBe(false);
  });
});

describe('setup', () => {
  it('the seat choosing its start first takes the wood-rich start (the Amphitheatre needs 3 wood)', () => {
    // 2-player map: @1 (-2,10) sits among wood tiles; @2 (2,4) reaches two.
    // Leaders pinned to ones without free collectors: a Dowser seat starts
    // with seven Surfs, reaches wood from either start, and may rightly
    // prefer the other tile.
    const s = game.createSession([{ player_id: 'p1', kind: 'ai' }, { player_id: 'p2', kind: 'ai' }], { seed: 1, factionAssignment: ['covenant', 'schism'], aiLeaderAssignment: ['chronicler', 'foreman'] } as never);
    const picks = s.gameState.log.filter((e) => /places their starting/.test(e.summary)).map((e) => e.summary);
    expect(picks[0]).toMatch(/-2,10/);
  });
});
