// One AI move for any AI seat: the debauchee's choices or a guesser's tile.
// Deterministic for a seed; index.ts derives the seed from the session.

import { chooseDebaucheeMove, tierOf, type Tier } from './ai/debauchee.js';
import { chooseGuesserMove } from './ai/guesser.js';
import { activeSeatId } from './engine/helpers.js';
import type { WordDebaucheeMove } from './engine/moves.js';
import type { WordDebaucheeState } from './types.js';

export { tierOf, type Tier };

export function chooseAIMove(state: WordDebaucheeState, playerId: string, difficulty: string | undefined, seed: number): WordDebaucheeMove {
  if (state.phase === 'game_over' || !state.round) throw new Error('The game is over.');
  if (activeSeatId(state) !== playerId) throw new Error(`It is not ${playerId}'s move.`);
  const tier = tierOf(difficulty);
  if (state.round.debauchee === playerId) return chooseDebaucheeMove(state, playerId, tier, seed);
  return chooseGuesserMove(state, playerId, tier, seed);
}
