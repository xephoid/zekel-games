import { GameError } from '@zekel/game-kit';
import { getCard, tryGetCard, FACTIONS, type CardDef, type FactionId } from './cards.js';
import { getLegalMoves } from './legalMoves.js';
import { randomInt } from '@zekel/game-kit';
import type { FFMove, FFState, TrackedPlayerState } from './types.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

// Strategy axis (§0), orthogonal to difficulty. For Fractured Fist a strategy is a
// FACTION allegiance — each faction is a fighting style (Titan = burst damage,
// The Awakened = spirit/heal sustain, Masters' Circle = defense/counter, Uncounted
// = misstep disruption). The loadout is SHARED and co-drafted by both seats toward
// their factions (see the harness draft); the AI then plays TOWARD its faction by
// preferring to buy its own faction's cards from that shared menu. Undefined ⇒ the
// generic adaptive heuristic (no faction lean). Generic aggro/control are removed.
export type Strategy = FactionId;

// Map a free-form strategy string to a faction id (tolerant of short aliases).
// Unknown / undefined ⇒ undefined (no faction lean).
export function parseStrategy(s?: string): Strategy | undefined {
  if (!s) return undefined;
  const k = s.toLowerCase().replace(/[\s-]/g, '_');
  if (k === 'titan' || k === 'titan_entertainment' || k === 'burst') return FACTIONS.TITAN_ENTERTAINMENT;
  if (k === 'awakened' || k === 'the_awakened' || k === 'sustain') return FACTIONS.THE_AWAKENED;
  if (k === 'masters' || k === 'masters_circle' || k === 'defense') return FACTIONS.MASTERS_CIRCLE;
  if (k === 'uncounted' || k === 'misstep' || k === 'disruption') return FACTIONS.UNCOUNTED;
  return undefined;
}

// How strongly the AI leans toward its faction's fighting STYLE when buying from
// the shared drafted menu. Moderate: enough to build a style-coherent deck, not so
// large it overrides the core damage/finisher priorities.
const FACTION_BUY_BONUS = 60;
const FACTION_PLAY_BONUS = 3; // tiebreak nudge when playing same-priority techniques

// A faction is a fighting STYLE = a signature effect. The lean keys on the effect
// (not the faction tag) so a player also leverages NEUTRAL cards of its style —
// e.g. Uncounted leans on neutral Distract/Smoke Bomb (both add_misstep), not just
// its faction-tagged misstep cards. Titan = damage, Awakened = heal/spirit/economy,
// Masters' Circle = defense, Uncounted = missteps.
export function fitsFactionStyle(strategy: Strategy, def: CardDef): boolean {
  const e = def.effects ?? {};
  switch (strategy) {
    case FACTIONS.TITAN_ENTERTAINMENT:
      return (e.damage ?? 0) > 0;
    case FACTIONS.THE_AWAKENED:
      return (e.heal ?? 0) > 0 || (e.spirit ?? 0) > 0 || (def.value ?? 0) > 0;
    case FACTIONS.MASTERS_CIRCLE:
      return (e.defense ?? 0) > 0;
    case FACTIONS.UNCOUNTED:
      return (e.add_misstep ?? 0) > 0;
    default:
      return false;
  }
}

function trackedAI(state: FFState, playerId: string): TrackedPlayerState {
  const p = state.players[playerId];
  if (!p) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId}`);
  if (p.kind !== 'tracked') {
    throw new GameError('NOT_AN_AI_PLAYER', `${playerId} is not a tracked (AI) player`);
  }
  return p;
}

export function chooseMove(
  state: FFState,
  playerId: string,
  difficulty: Difficulty = 'medium',
  strategy?: Strategy,
): { move: FFMove } {
  trackedAI(state, playerId); // assert before peeking at private state
  const legal = getLegalMoves(state, playerId);
  if (legal.length === 0) {
    throw new Error('No legal moves available for AI');
  }
  if (difficulty === 'easy') {
    const r = randomInt(state.rngSeed, legal.length);
    const pick = legal[r.value]!;
    return { move: pick.move };
  }
  // medium / hard: heuristic. 'medium' is the faithful port of the React
  // processEnemyTurn (locked by parity tests). 'hard' is a tuned variant whose
  // ONLY difference is buy scoring (see buyScore) — a damage-forward strategy
  // motivated by the 1000-game lift data. Technique-play ordering is shared.
  // `strategy` (if set) forces the buy-priority mode; it only affects buy scoring.
  const scored = legal.map((lm) => ({ lm, score: scoreMove(state, playerId, lm.move, difficulty, strategy) }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!.lm;
  return { move: best.move };
}

// Ported to match `processEnemyTurn` from
// antigravity-fist-and-form/src/hooks/useCombat.js (lines 324-552).
// The original plays its entire turn in one function: greedy technique loop →
// play all resources → buy once. We emulate that order in a one-move-at-a-time
// engine by scoring resource plays above any buy, and matching the original's
// exact priority/buy-score formulas.

function scoreMove(
  state: FFState,
  playerId: string,
  move: FFMove,
  difficulty: Difficulty = 'medium',
  strategy?: Strategy,
): number {
  const me = trackedAI(state, playerId);
  switch (move.type) {
    case 'play_card': {
      const def = tryGetCard(move.card_id);
      if (!def) return 0;
      if (def.type === 'TECHNIQUE') {
        // Match getPriorityScore exactly: flat values per effect, only these four signals.
        let v = 1; // baseline so any technique beats advance_phase/end_turn
        const e = def.effects ?? {};
        if (e.actions) v += 100;
        if (e.damage) v += 10;
        if (e.add_misstep) v += 5;
        if (e.defense) v += 1;
        // Faction lean: a small tiebreak toward playing style-fitting cards
        // (doesn't reorder the actions>damage>misstep>defense priority tiers).
        if (strategy && fitsFactionStyle(strategy, def)) v += FACTION_PLAY_BONUS;
        return v;
      }
      // RESOURCE in channel phase: original plays ALL resources before buying.
      // Score above any plausible buy_card (max ~300) so resources are exhausted first.
      return 1000 + (def.value ?? 0);
    }
    case 'buy_card': {
      // A skilled player NEVER buys Focus (a cost-0 base resource): it only
      // dilutes the deck, and being free it was previously taken as zero-cost
      // filler on otherwise-dead turns — which also masked the dead-turn metric
      // (every "empty" turn looked live because a free Focus was bought). Rank any
      // cost-0 resource buy below end_turn (0) so the AI never chooses it. This is
      // the BUY path only — PLAYING Focus for spirit (the resource branch above)
      // is unchanged, as is buying real resources (Momentum/Mastery, cost > 0).
      const bd = tryGetCard(move.card_id);
      if (bd && bd.type === 'RESOURCE' && bd.cost === 0) return -1;
      return buyScore(state, playerId, move.card_id, difficulty, strategy);
    }
    case 'advance_phase':
      return 0.5;
    case 'end_turn':
      return 0;
    case 'focus_reload':
      // Not in the original React AI; treat as a moderate catch-up move.
      // Loses to any meaningful technique but beats advance_phase/end_turn, so
      // a behind-on-stamina AI digs with Focus reloads before ending the turn.
      // Loop-safe because the engine caps reloads at FOCUS_RELOADS_PER_TURN —
      // after the cap, legalMoves stops offering it (the harness surfaced that
      // an uncapped reload loops forever, since the deck is Focus-heavy).
      return 30;
    case 'refine_card': {
      // Match original: refine missteps first, then focus, then anything else.
      const cardId = move.hand_index !== undefined ? me.hand[move.hand_index] : undefined;
      if (cardId === 'misstep') return 100;
      if (cardId === 'focus') return 10;
      return 1;
    }
    case 'skip_refine':
      return 0;
  }
}

function buyScore(
  state: FFState,
  playerId: string,
  cardId: string,
  difficulty: Difficulty = 'medium',
  strategy?: Strategy,
): number {
  const def = getCard(cardId);
  const e = def.effects ?? {};
  const me = trackedAI(state, playerId);

  // Original used enemyData.loadout (the static loadout this enemy was set up with).
  // We don't carry that as a separate field, but the supply keys ARE the loadout's
  // technique cards (resources are always present). Compute the max cost across
  // technique entries in supply — including depleted ones (count may be 0) so
  // the strategy doesn't flip mid-game when a card runs out.
  // Per-player supply (Fractured Fist rule: each player has their own pool).
  const maxLoadoutCost = Object.keys(me.supply)
    .map((id) => getCard(id))
    .filter((c) => c.type === 'TECHNIQUE')
    .reduce((m, c) => Math.max(m, c.cost), 0);

  const allMine = [...me.deck, ...me.hand, ...me.discard, ...me.played];
  const avgResourceValue =
    allMine.reduce((sum, id) => {
      const c = tryGetCard(id);
      return sum + (c?.value ?? c?.effects?.spirit ?? 0);
    }, 0) / Math.max(1, allMine.length);

  // "Useful" techniques = ones that actually contribute to winning (damage,
  // defense, misstep delivery). Actions-only / draw-only cards are setup
  // pieces — valuable only if you have useful techniques to play with the
  // actions. Without any useful techniques in deck, actions are worthless.
  // This is a divergence from the React app's heuristic, which always gave
  // actions a flat +25 — that blind spot causes the AI to stockpile React
  // cards forever when no damage/defense cards are affordable. See chat
  // log for the worked example.
  const usefulTechniqueCount = allMine.reduce((n, id) => {
    const c = tryGetCard(id);
    if (!c || c.type !== 'TECHNIQUE') return n;
    const ce = c.effects ?? {};
    const isUseful = (ce.damage ?? 0) > 0 || (ce.defense ?? 0) > 0 || (ce.add_misstep ?? 0) > 0;
    return isUseful ? n + 1 : n;
  }, 0);
  // Scale 0..1 over the first 4 useful techniques; saturates after.
  const actionsUsefulness = Math.min(usefulTechniqueCount, 4) / 4;

  // Adaptive ramp rule (the faithful original): ramp iff the loadout's payoff
  // cards are pricey relative to the deck's resource value. The strategy axis no
  // longer forces this — a faction lean is expressed as an own-faction BUY bonus
  // (below), so the AI builds its faction's deck from the shared drafted menu.
  const ramp = maxLoadoutCost > avgResourceValue * 6;

  // Faction lean: a bonus for buying a card matching the player's faction STYLE, so
  // seat A (e.g. Titan) and seat B (e.g. Awakened) build different decks from the
  // SAME shared supply. Folded into the base so it survives the ramp branch's early
  // returns. Style-keyed, so style-fitting neutrals count too (Uncounted ← Distract).
  const factionBonus = strategy && fitsFactionStyle(strategy, def) ? FACTION_BUY_BONUS : 0;

  if (difficulty === 'hard') {
    return buyScoreHard(def, e, ramp, actionsUsefulness) + factionBonus;
  }

  let score = def.cost + factionBonus; // tiebreak on cost; faction lean baked in

  if (ramp) {
    if (def.cost >= 6 && (e.damage ?? 0) > 0) return score + 200;
    if (def.type === 'RESOURCE' || (e.spirit ?? 0) > 0) return score + 100;
    if ((e.heal ?? 0) > 0) return score + 75;
    if ((e.defense ?? 0) > 0) return score + 50;
    if ((e.damage ?? 0) > 0) return score + 10;
  } else {
    if ((e.damage ?? 0) > 0) score += 100;
    if ((e.heal ?? 0) > 0) score += 20;
    if ((e.defense ?? 0) > 0) score += 15;
    if (def.type === 'RESOURCE' || (e.spirit ?? 0) > 0) score += 10;
  }
  if ((e.actions ?? 0) > 0) score += Math.round(25 * actionsUsefulness);
  if ((e.add_misstep ?? 0) > 0) score += 5;
  return score;
}

// Tuned buy heuristic for the 'hard' difficulty. Hypothesis from the 1000-game
// lift data (harness-out/ff-1000-report.md): the medium/React heuristic
// (a) ignores damage MAGNITUDE — every damage card gets the same flat bonus,
// so it won't prefer Grand Finale (+5) over Attack (+1) — and (b) over-ramps
// economy (resource/spirit cards bought ~90% with negative win-rate lift).
// This variant scales damage with its amount and trims economy so the AI still
// ramps enough to afford finishers but commits to damage sooner. It is a
// HYPOTHESIS to be adjudicated head-to-head vs medium, not a proven win.
function buyScoreHard(
  def: CardDef,
  e: NonNullable<CardDef['effects']>,
  ramp: boolean,
  actionsUsefulness: number,
): number {
  const dmg = e.damage ?? 0;
  const spirit = (def.value ?? 0) + (e.spirit ?? 0);
  const defense = e.defense ?? 0;
  let score = def.cost * 0.5; // mild tiebreak toward pricier (usually stronger) cards

  if (ramp) {
    // Loadout has expensive payoff cards: still value economy, but damage —
    // scaled by amount — leads, so the AI converts to offense rather than
    // ramping indefinitely. Attack(1)=105 < Mastery(3)≈94? No: 80+25*1=105 vs
    // 70+8*3=94 → cheap damage just edges economy; big damage dominates.
    if (dmg > 0) score += 80 + 25 * dmg;
    if (spirit > 0) score += 70 + 8 * spirit;
    if ((e.heal ?? 0) > 0) score += 40;
    if (defense > 0) score += 30 + 6 * defense;
  } else {
    // Aggro: damage is king and magnitude matters. Economy is a minor topup.
    if (dmg > 0) score += 90 + 30 * dmg;
    if ((e.heal ?? 0) > 0) score += 25;
    if (defense > 0) score += 20 + 6 * defense;
    if (spirit > 0) score += 30 + 6 * spirit;
  }
  if ((e.actions ?? 0) > 0) score += Math.round(25 * actionsUsefulness);
  if ((e.add_misstep ?? 0) > 0) score += 8;
  return score;
}

