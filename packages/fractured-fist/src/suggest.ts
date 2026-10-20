// suggest_move for a PHYSICAL (opaque) seat — harness-only (Game.getSuggestedMove
// is never called on a real session). The AI can't choose for a seat whose hand
// the server never sees (chooseMove refuses an untracked seat), so without this
// the desync and relay harnesses fall back to the FIRST offered move every
// time: the simulated human would play the first technique in the supply
// forever and never refine, reload or buy anything interesting. This picks
// among the offered moves the way a person plausibly would, varied by a hash
// of the state so a game is reproducible from its seed but not one-note.
//
// It declares only moves a physical player could make with the cards the
// server says they hold (hand count, Misstep count); it cannot know WHICH
// cards those are, and doesn't need to — every offered move is legal.

import type { LegalMove, SessionState } from '@zekel/game-kit';
import { getCard } from './cards.js';
import { getLegalMoves } from './legalMoves.js';
import type { FFMove, FFState } from './types.js';

function stateHash(gs: FFState, pid: string, moveCount: number): number {
  const p = gs.players[pid]!;
  let h = (gs.rngSeed ^ 0x9e3779b9) >>> 0;
  for (const n of [gs.round, moveCount, p.handSize, p.deckSize, p.discardSize, p.spirit, p.actions, p.channels]) {
    h = Math.imul(h ^ (n + 0x7f4a7c15), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

const pick = <T>(xs: T[], h: number): T => xs[h % xs.length]!;

export function suggestOpaqueMove(state: SessionState<FFState>, pid: string): { move: FFMove } | null {
  const gs = state.gameState;
  const me = gs.players[pid];
  if (!me || me.kind !== 'opaque') return null;
  const legal = getLegalMoves(gs, pid);
  if (legal.length === 0) return null;
  const h = stateHash(gs, pid, state.moveLog.length);
  const of = (type: FFMove['type']): LegalMove<FFMove>[] => legal.filter((lm) => lm.move.type === type);
  const chance = (percent: number): boolean => h % 100 < percent;

  // Refine window: a Misstep first when one exists, sometimes another card.
  if (me.refinePending > 0) {
    const misstep = legal.find((lm) => lm.move.type === 'refine_card' && lm.move.was_misstep === true);
    if (misstep && chance(80)) return { move: misstep.move };
    const other = legal.find((lm) => lm.move.type === 'refine_card' && lm.move.was_misstep === false);
    if (other && chance(30)) return { move: other.move };
    return { move: of('skip_refine')[0]!.move };
  }

  // Behind on stamina: sometimes reload with Focus (1 or 2 Focus cards).
  const reloads = of('focus_reload').filter((lm) => lm.move.type === 'focus_reload' && (lm.move.count ?? 0) <= 2);
  if (reloads.length > 0 && chance(35)) return { move: pick(reloads, h >>> 8).move };

  if (gs.phase === 'technique') {
    const plays = of('play_card');
    if (plays.length > 0 && chance(75)) return { move: pick(plays, h >>> 8).move };
    return { move: (chance(90) ? of('advance_phase')[0] : of('end_turn')[0])!.move };
  }

  // Channel phase: buy the dearest affordable card when spirit allows,
  // otherwise play resources (mostly Focus — the deck is Focus-heavy).
  const buys = of('buy_card').sort(
    (a, b) => getCard((b.move as { card_id: string }).card_id).cost - getCard((a.move as { card_id: string }).card_id).cost,
  );
  if (buys.length > 0 && (me.spirit >= 4 || me.handSize === 0)) return { move: buys[0]!.move };
  const resources = of('play_card');
  if (resources.length > 0 && me.handSize > 1) {
    const focus = resources.find((lm) => lm.move.type === 'play_card' && lm.move.card_id === 'focus');
    return { move: (focus && chance(75) ? focus : pick(resources, h >>> 8)).move };
  }
  if (buys.length > 0) return { move: buys[0]!.move };
  return { move: of('end_turn')[0]!.move };
}
