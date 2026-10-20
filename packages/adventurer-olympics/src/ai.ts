// Adventurer Olympics — AI brain (AI-NOTES.md).
//
// The ladder:
//   easy   — uniform-random over the offered moves (seeded rng).
//   medium — the planner (aiPlanner.ts) with a flat 60% guess at every test
//            and only its own progress in view.
//   hard   — the same planner reading its real odds (its dice against the
//            cards left in each deck), the rivals' standing, and the end of
//            the game.
//   mcts   — the generic search (src/ai/mcts.ts) over the hooks in
//            mctsHooks.ts, with `hard` as its rollout policy.
// `strategy` leans the planner toward one path to quest points (§4).
//
// Dice are never a decision: every tier rolls its own dice with the seeded
// rng, as the rules say the server rolls for AI players (RULES.md §12). An AI
// seat never reports a draw: with real cards a human draws for it.

import type { AOState } from './types.js';
import { getLegalMoves } from './legalMoves.js';
import { makeRng } from './engine.js';
import { seatDisplayName } from '@zekel/game-kit';
import {
  artifactValueFor, firstStepToward, parseStrategy, rankPlacements, rankTargets, type PlanCtx,
} from './aiPlanner.js';

type Move = Record<string, unknown> & { type: string };

/** Pick the AI's next move for `difficulty` (easy / medium / hard; `mcts` is
 *  handled in index.ts and uses `hard` for its dice and rollouts). */
export function chooseMove(
  state: AOState,
  playerId: string,
  difficulty: string = 'medium',
  strategy?: string,
): { move: Move; narration: string } {
  const legal = getLegalMoves(state, playerId);
  const kind = state.pending?.kind;
  const payload = state.pending?.payload ?? {};

  const pl = state.players[playerId] as { name?: string; standee?: string; colour?: string; kind: 'human' | 'ai' } | undefined;
  const stateList = Object.values(state.players).map((q) => ({ player_id: q.player_id, kind: q.kind, name: q.name }));
  const given = pl?.name?.trim();
  const name = (given && given !== playerId) ? given : seatDisplayName(stateList, playerId);

  // Setup standee: pick the standee (identity).
  if (kind === 'setup_standee_colour') {
    // Take the first colour still free (humans have already picked theirs).
    const m = legal.find((x) => x.move.type === 'setup_standee');
    if (!m) throw new Error(`no standee/colour left for ${name}`);
    return { move: m.move, narration: `${name} takes the ${String(m.move.colour)} tokens.` };
  }

  // Physical-only setup report: an AI seat is never the reporter for a
  // physical table's draw — but if somehow routed one, answer from the
  // server's own orders so the game never strands.
  if (kind === 'setup_explore_report') {
    const order = ((state as { setupQuestOrder?: string[] }).setupQuestOrder) ?? [];
    const quests = order.slice(0, (payload.questsExpected as number) ?? state.playerOrder.length + 1);
    const tile = state.tileStack[0];
    return {
      move: { type: 'setup_report', quests, tile: `Tile ${tile}` },
      narration: `${name} reports the setup draw.`,
    };
  }

  // Physical-only card/tile report pending: an AI seat is always server-served
  // and never receives one — but never strand the game if misrouted.
  if (kind === 'report_card') {
    if (payload.deck === 'tile') {
      const tile = state.tileStack[0];
      return { move: { type: 'report_card', card: `Tile ${tile}` }, narration: `${name} reports the tile.` };
    }
    const m = legal[0];
    if (m) return { move: m.move, narration: `${name} reports the card.` };
    throw new Error(`no report_card offer for ${playerId}`);
  }

  // A digital human's Draw button. An AI seat never owes one (the server deals
  // its draws outright), but a search playing out a human's turn presses it.
  if (kind === 'draw') {
    return { move: { type: 'resolve_report' }, narration: `${name} draws.` };
  }

  // Turn order: roll 2d6 with the seeded rng and report the total.
  if (kind === 'roll' && payload.rollKind === 'turn_order') {
    let seatHash = 0;
    for (let ci = 0; ci < playerId.length; ci++) seatHash = (seatHash * 31 + playerId.charCodeAt(ci)) | 0;
    const priorRolls = state.log.filter(
      (l) => l.phase === 'roll-order' && l.playerId === playerId && l.summary.includes('rolled'),
    ).length + state.round;
    const rng = makeRng(state.rngSeed + state.round * 97 + seatHash + priorRolls * 31);
    const d1 = rng.int(6) + 1;
    const d2 = rng.int(6) + 1;
    const total = d1 + d2;
    const m = legal.find((x) => x.move.type === 'report_turn_order_roll' && (x.move as { total?: number }).total === total)
      ?? legal.find((x) => x.move.type === 'report_turn_order_roll')
      ?? { move: { type: 'report_turn_order_roll', total } };
    // The dice go with the move so a screen can show them, not just the total.
    const dice = (m.move as { total?: number }).total === total ? { dice: [d1, d2] } : {};
    return { move: { ...m.move, ...dice }, narration: `${name} rolls ${total} for turn order.` };
  }

  // Test roll: roll diceCount d6, report the total.
  if (kind === 'roll' && payload.rollKind === 'test') {
    const count = payload.diceCount as number;
    let seatHash = 0;
    for (let ci = 0; ci < playerId.length; ci++) seatHash = (seatHash * 31 + playerId.charCodeAt(ci)) | 0;
    const prior = state.log.filter((l) => l.phase === 'test' && l.playerId === playerId).length;
    const rng = makeRng(state.rngSeed + state.round * 89 + seatHash + prior * 13);
    const rolled: number[] = [];
    for (let i = 0; i < count; i++) rolled.push(rng.int(6) + 1);
    const total = rolled.reduce((a, b) => a + b, 0);
    const m = legal.find((x) => x.move.type === 'report_test_roll' && (x.move as { total?: number }).total === total)
      ?? legal.find((x) => x.move.type === 'report_test_roll')
      ?? { move: { type: 'report_test_roll', total } };
    const dice = (m.move as { total?: number }).total === total ? { dice: rolled } : {};
    return { move: { ...m.move, ...dice }, narration: `${name} rolls ${total} (needs ${payload.number}).` };
  }

  // --- decisions -----------------------------------------------------------
  // easy = uniform-random over the offered moves (seeded rng, never unseeded).
  if (difficulty === 'easy' || difficulty === 'random') {
    if (legal.length === 0) return { move: { type: 'stop' }, narration: `${name} ends their turn.` };
    const rng = makeRng(state.rngSeed ^ (state.log.length * 7919 + hashSeat(playerId) + state.round * 104729));
    const pick = legal[rng.int(legal.length)]!;
    return { move: pick.move, narration: `${name} plays.` };
  }

  // medium / hard (and the MCTS rollout policy): the planner (aiPlanner.ts).
  const ctx: PlanCtx = { state, me: playerId, archetype: parseStrategy(strategy), careful: difficulty !== 'medium' };
  const me = state.players[playerId]!;
  const has = (m: Move) => legal.some((x) => JSON.stringify(x.move) === JSON.stringify(m));

  if (kind === 'take_artifact') {
    // Taking always completes the Dungeon, so never decline while a real
    // option exists; take the one worth most (a rival's lead counts).
    const options = legal.filter((x) => x.move.type === 'take_artifact');
    if (options.length) {
      const best = options
        .map((o) => ({ o, v: artifactValueFor(ctx, String(o.move.artifact)) }))
        .sort((a, b) => b.v - a.v)[0]!.o;
      return { move: best.move, narration: `${name} takes an artifact.` };
    }
    return { move: { type: 'decline_artifact' }, narration: `${name} declines the artifact.` };
  }

  if (kind === 'explore_place') {
    const ranked = rankPlacements(ctx, payload.tileId as number, payload.context as string);
    for (const r of ranked) {
      const m = { type: 'explore', slot: r.slot, rotation: r.rotation };
      if (has(m)) return { move: m, narration: `${name} places the tile.` };
    }
    const first = legal.find((x) => x.move.type === 'explore');
    if (!first) throw new Error(`no placement offered to ${playerId}`);
    return { move: first.move, narration: `${name} places the tile.` };
  }

  if (kind === 'move' || kind === 'try_again') {
    const onIcon = kind === 'try_again'
      ? state.iconHexes.find((h) => h.key === me.hexKey && !h.completed) ?? null
      : null;
    const targets = rankTargets(ctx, onIcon);
    for (const t of targets) {
      if (t.kind === 'stay' && has({ type: 'try_again' })) {
        return { move: { type: 'try_again' }, narration: `${name} stays and tries the icon again.` };
      }
      if (t.kind === 'explore' && t.hex === me.hexKey) {
        if (has({ type: 'explore' })) return { move: { type: 'explore' }, narration: `${name} explores.` };
        continue;
      }
      const step = firstStepToward(state, playerId, t.hex);
      if (!step) continue;
      const m = kind === 'move' ? { type: 'step', to: step } : { type: 'move_away', path: [step] };
      if (has(m)) return { move: m, narration: `${name} moves.` };
    }
    return { move: { type: 'stop' }, narration: `${name} ends their turn.` };
  }

  // No decision owed by this seat — end the turn to release it.
  return { move: { type: 'stop' }, narration: `${name} ends their turn.` };
}

function hashSeat(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Roll `n` dice deterministically for tests (not used in play; the engine
 *  trusts totals). Kept for harness helpers. */
export function rollDice(state: AOState, seat: string, n: number): number[] {
  const rng = makeRng(state.rngSeed + state.round * 31 + seat.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(rng.int(6) + 1);
  return out;
}
