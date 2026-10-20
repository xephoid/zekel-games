// Adventurer Olympics — MCTS hooks (AI-NOTES.md §3).
//
// Two things make a naive search cheat here, and both are handled:
//   - Dice. An AI's own roll is a pending the AI "answers"; a search would
//     simply pick the best total. So at a roll the search is offered exactly
//     one child — the roll `hard` makes with the seeded rng — and
//     `determinize` re-seeds that rng per simulation, so the search sees a
//     fresh sample of dice every time instead of choosing them.
//   - Deck order. At an all-AI table the server's decks are in their real
//     order, which no player may know. `determinize` shuffles every deck and
//     the tile stack per simulation (contents unchanged — contents are public).
//
// Pruning (getSearchMoves): moving is one hex per move, so the tree is deep;
// the search only branches on the first step toward each of the planner's
// best 3 destinations, plus stop / explore / try again; a tile placement
// branches on the 6 best (slot, turn) pairs; an artifact pick on every real
// option (never decline — taking always completes the Dungeon).

import type { LegalMove, SessionState } from '@zekel/game-kit';
import type { AOState } from './types.js';
import { chooseMove } from './ai.js';
import { firstStepToward, outlook, rankPlacements, rankTargets, type PlanCtx } from './aiPlanner.js';
import { getLegalMoves } from './legalMoves.js';

type Move = Record<string, unknown> & { type: string };

export function aoReward(state: SessionState<AOState>, playerId: string): number {
  const g = state.gameState;
  if (!g.gameOver) return aoHeuristic(state, playerId);
  const top = Math.max(...g.playerOrder.map((p) => g.players[p]!.questPoints));
  const winners = g.playerOrder.filter((p) => g.players[p]!.questPoints === top);
  return winners.includes(playerId) ? 1 / winners.length : 0;
}

/** Leaf value in [0, 1]: my outlook against the best rival's (the one
 *  evaluation function, aiPlanner.ts `outlook`). */
export function aoHeuristic(state: SessionState<AOState>, playerId: string): number {
  const g = state.gameState;
  const mine = outlook(g, playerId);
  const best = Math.max(...g.playerOrder.filter((p) => p !== playerId).map((p) => outlook(g, p)));
  return 0.5 + 0.5 * Math.tanh(mine - best);
}

export function aoRolloutMove(state: SessionState<AOState>, playerId: string): Move | null {
  if (state.gameState.pending?.seat !== playerId) return null;
  return chooseMove(state.gameState, playerId, 'hard').move;
}

export function aoSearchMoves(state: SessionState<AOState>, playerId: string): LegalMove<Move>[] {
  const g = state.gameState;
  const legal = getLegalMoves(g, playerId) as LegalMove<Move>[];
  const p = g.pending;
  if (!p || p.seat !== playerId || legal.length <= 1) return legal;
  const key = (m: Move) => JSON.stringify(m);
  const keep = (moves: Move[]) => {
    const want = new Set(moves.map(key));
    const out = legal.filter((l) => want.has(key(l.move)));
    return out.length ? out : legal.slice(0, 1);
  };
  const ctx: PlanCtx = { state: g, me: playerId, archetype: 'adaptive', careful: true };

  if (p.kind === 'roll' || p.kind === 'draw' || p.kind === 'setup_standee_colour' || p.kind === 'setup_explore_report' || p.kind === 'report_card') {
    return keep([chooseMove(g, playerId, 'hard').move]);
  }
  if (p.kind === 'take_artifact') return legal.filter((l) => l.move.type === 'take_artifact').length
    ? legal.filter((l) => l.move.type === 'take_artifact') : legal;
  if (p.kind === 'explore_place') {
    return keep(rankPlacements(ctx, p.payload!.tileId as number, p.payload!.context as string)
      .slice(0, 6).map((r) => ({ type: 'explore', slot: r.slot, rotation: r.rotation })));
  }
  // move / try_again
  const me = g.players[playerId]!;
  const onIcon = p.kind === 'try_again' ? g.iconHexes.find((h) => h.key === me.hexKey && !h.completed) ?? null : null;
  const moves: Move[] = [{ type: 'stop' }, { type: 'explore' }];
  if (p.kind === 'try_again') moves.push({ type: 'try_again' });
  for (const t of rankTargets(ctx, onIcon).slice(0, 3)) {
    const step = firstStepToward(g, playerId, t.hex);
    if (step) moves.push(p.kind === 'move' ? { type: 'step', to: step } : { type: 'move_away', path: [step] });
  }
  return keep(moves);
}

/** Per simulation: shuffle every deck and the tile stack (order is hidden;
 *  contents are public), and re-seed the dice. */
export function aoDeterminize(state: SessionState<AOState>, _from: string, rng: () => number): SessionState<AOState> {
  const s = JSON.parse(JSON.stringify(state)) as SessionState<AOState>;
  const g = s.gameState;
  const shuffle = <T>(a: T[]): T[] => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  // A card already drawn and being tested stays where the engine expects it.
  const resolving = g.pending?.payload?.cardId as string | undefined;
  for (const deck of ['companion', 'little', 'big'] as const) {
    const rest = g.decks[deck].filter((c) => c !== resolving);
    g.decks[deck] = g.decks[deck].includes(resolving ?? '\u0000') ? [resolving!, ...shuffle(rest)] : shuffle(rest);
  }
  if (!g.dungeonResolving) g.decks.dungeon = shuffle(g.decks.dungeon);
  if (g.pending?.kind !== 'explore_place') g.tileStack = shuffle(g.tileStack);
  g.rngSeed = Math.floor(rng() * 2 ** 31);
  return s;
}
