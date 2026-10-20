// MCTS hooks for Fractured Fist.
//
// FF is a fast, small game — ~1k bytes state, 230k clones/sec. MCTS
// can do 5-10k simulations per decision in a 1-second budget.
//
// Three minimal hooks:
//   1. getRewardForPlayer — win=1, loss=0, draw=0.5.
//   2. selectRolloutMove — reuse existing chooseMove (medium).
//   3. getHeuristicValue — relative stamina if rollout cuts short.
//
// No determinize: AI-vs-AI sessions track both decks, so the game has
// no hidden information in this configuration. Human-in-the-loop
// sessions (opaque human deck) would need a determinize hook that
// samples the human's hand from the known card pool, but the AI never
// "sees" the human's actual cards anyway, so the public-view-driven
// MCTS produces correct decisions without it.

import type { SessionState } from '@zekel/game-kit';
import { chooseMove } from './ai.js';
import { checkGameOver } from './engine.js';
import { getLegalMoves } from './legalMoves.js';
import type { FFMove, FFState } from './types.js';

export function getFFReward(
  state: SessionState<FFState>,
  playerId: string,
): number {
  const r = checkGameOver(state.gameState);
  if (!r.game_over) return 0.5;
  if (r.winners.length === 0) return 0.5; // draw / both KO
  if (r.winners.includes(playerId)) return 1 / r.winners.length;
  return 0;
}

export function pickFFRolloutMove(
  state: SessionState<FFState>,
  playerId: string,
): FFMove | null {
  const legal = getLegalMoves(state.gameState, playerId);
  if (legal.length === 0) return null;
  // Reuse the existing medium heuristic as a strong rollout policy.
  // It's synchronous and reasonably fast.
  try {
    return chooseMove(state.gameState, playerId, 'medium').move;
  } catch {
    // Player isn't tracked (shouldn't happen for AI players, but be safe):
    // fall back to uniform random.
    const idx = Math.floor(Math.random() * legal.length);
    return legal[idx]!.move;
  }
}

export function getFFHeuristicValue(
  state: SessionState<FFState>,
  playerId: string,
): number {
  const me = state.gameState.players[playerId];
  if (!me) return 0;
  const opponents = state.players.filter((p) => p.player_id !== playerId);
  if (opponents.length === 0) return 1;
  const oppId = opponents[0]!.player_id;
  const opp = state.gameState.players[oppId];
  if (!opp) return 1;
  // Normalize relative stamina to [0, 1].
  const total = me.stamina + opp.stamina;
  if (total <= 0) return 0.5;
  return me.stamina / total;
}
