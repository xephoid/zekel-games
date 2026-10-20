// MCTS hooks for Cybernoir 2127 (the strong "mcts" tier).
//
// The game has real hidden information (hasHiddenInformation = true): the
// Detective must not read the Hacker's hideout/hand, and the Hacker must not
// read the Detective's Location hand or facedown informants. `determinizeCN`
// samples a plausible full state consistent with what the observing player can
// see (SO-ISMCTS), so the search plays the information game honestly.

import type { GameLogEntry, LegalMove, SessionState } from '@zekel/game-kit';
import { candidateLocations, chooseMove, detectiveCandidateLocations, personValueToHacker, progressScore } from './ai.js';
import { getLegalMoves } from './legalMoves.js';
import { PEOPLE, LOCATIONS, WEAPON_ID, findLocationByAttributes } from './data/index.js';
import { randomInt } from './rng.js';
import type { CNMove, CNState } from './types.js';

function shuffleWith<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Terminal payoff: win 1, loss 0 (no draws in Cybernoir). */
export function getCNReward(state: SessionState<CNState>, playerId: string): number {
  return state.gameState.winners.includes(playerId) ? 1 : 0;
}

/** Non-terminal leaf value: the shared progress scalar (ai.ts §2). */
export function getCNHeuristicValue(state: SessionState<CNState>, playerId: string): number {
  return progressScore(state.gameState, playerId);
}

/** Rollout policy: reuse the medium heuristic (fast, synchronous). */
export function pickCNRolloutMove(state: SessionState<CNState>, playerId: string): CNMove | null {
  const legal = getLegalMoves(state.gameState, playerId);
  if (legal.length === 0) return null;
  try {
    return chooseMove(state.gameState, playerId, 'medium').move;
  } catch {
    // Defensive fallback must stay SEEDED (ai-development runbook §8): a stray
    // Math.random here desyncs lockstep sessions and makes batches non-reproducible.
    const gs = state.gameState;
    const seed = ((gs.rngSeed ^ Math.imul(legal.length + 1, 2654435761) ^ gs.turn) >>> 0);
    return legal[randomInt(seed, legal.length).value]!.move;
  }
}

/** Fast MCTS clone: strip the append-only game log to avoid cloning the
 *  ever-growing history on every simulation. The log is not used for MCTS
 *  decisions, and applyMove rebuilds seq numbers from scratch in rollouts. */
export function cloneCNState(state: SessionState<CNState>): SessionState<CNState> {
  const s: SessionState<CNState> = JSON.parse(JSON.stringify(state));
  s.gameState.log = [] as GameLogEntry[];
  s.moveLog = [];
  return s;
}

/**
 * Sample a plausible full state from `fromPlayerId`'s perspective.
 * Only the observer's OPPONENT's hidden zones are re-sampled; public zones
 * (board, jail, evidence, clues, revealed informants, discard) are never touched.
 */
export function determinizeCN(
  state: SessionState<CNState>,
  fromPlayerId: string,
  rng: () => number,
): SessionState<CNState> {
  const s = structuredClone(state);
  const gs = s.gameState;
  const detId = gs.playerOrder[0]!;
  const hakId = gs.playerOrder[1]!;

  if (fromPlayerId === detId) {
    // --- Detective observes: re-sample the hideout + Hacker hand/deck ---
    // v1.7: use the Detective's own pool (excludes board + own hand/discard
    // under the card-removed regime — those cards can't be the hideout).
    const cands = detectiveCandidateLocations(gs);
    const pool = cands.length > 0 ? cands : LOCATIONS;
    const trueHideoutId = gs.hacker.hideout_location_id ?? findLocationByAttributes(gs.hacker.hideout)?.id;
    const pick = pool[Math.floor(rng() * pool.length)]!;
    gs.hacker.hideout = { borough: pick.borough, population: pick.population, affiliation: pick.affiliation };
    gs.hacker.hideout_location_id = pick.id;
    // Keep the tracked deck consistent with the sampled world: the sampled
    // hideout's card must be OUT of the deck and the true one back IN (both
    // are unseen by the Detective, so the swap is a legal determinization).
    if (gs.hideout_card_removed && gs.detective.kind === 'tracked' && trueHideoutId && pick.id !== trueHideoutId) {
      const i = gs.detective.location_deck.indexOf(pick.id);
      if (i >= 0) gs.detective.location_deck[i] = trueHideoutId;
    }

    const ev = gs.hacker.evidence;
    const publicCards = new Set<string>([
      ...gs.hacker.contacts_discard,
      ...ev.witnesses,
      ...ev.motive_set_1,
      ...ev.motive_set_2,
      ...(ev.motive_set_3 ?? []),
      ...(ev.motive_set_4 ?? []),
    ]);
    if (ev.weapon) publicCards.add(WEAPON_ID);
    const unknown = shuffleWith(
      [...PEOPLE.map(p => p.id), WEAPON_ID].filter(id => !publicCards.has(id)),
      rng,
    );
    const hp = gs.players[hakId];
    const handSize = hp ? hp.hand_size : 0;
    const hand = unknown.slice(0, Math.min(handSize, unknown.length));
    const deck = unknown.slice(hand.length);
    if (hp && hp.kind === 'tracked') {
      hp.hand = hand;
      hp.deck = [...deck];
    }
    gs.hacker.contacts_deck = deck;
  } else {
    // --- Hacker observes: re-split Detective Location hand/deck + facedown informants ---
    // Excluded from the re-split: board (public), the tracked discard pile
    // (seen face up), and — under the v1.7 card-removed regime — the Hacker's
    // own safehouse card (it is in the Hacker's hands, not the deck).
    const knownOut = new Set([...gs.detective.board, ...(gs.detective.location_discard ?? [])]);
    if (gs.hideout_card_removed) {
      const hid = gs.hacker.hideout_location_id ?? findLocationByAttributes(gs.hacker.hideout)?.id;
      if (hid) knownOut.add(hid);
    }
    const unknownLocs = shuffleWith(
      LOCATIONS.map(l => l.id).filter(id => !knownOut.has(id)),
      rng,
    );
    const handSize = gs.detective.location_hand.length; // hand count is public
    gs.detective.location_hand = unknownLocs.slice(0, Math.min(handSize, unknownLocs.length));
    gs.detective.location_deck = unknownLocs.slice(gs.detective.location_hand.length);

    const jailed = new Set(gs.detective.jail.flat());
    const revealed = gs.detective.informants.filter(i => i.revealed);
    const revealedIds = new Set(revealed.map(i => i.person_id));
    const facedownCount = gs.detective.informants.length - revealed.length;
    const pool = shuffleWith(
      PEOPLE.map(p => p.id).filter(id => !jailed.has(id) && !revealedIds.has(id)),
      rng,
    );
    const infIds = pool.slice(0, Math.min(facedownCount, pool.length));
    gs.detective.informants = [
      ...revealed,
      ...infIds.map(id => ({ person_id: id, revealed: false })),
    ];
    gs.detective.poi_deck = pool.slice(infIds.length);
  }
  return s;
}

/**
 * Curated search set (runbook §3 — pruning is mandatory). The full legal set
 * branches on 18 guesses, C(n,3) clue-buy trios, and 24 recruit targets; the
 * search only needs the informative slice of each.
 */
export function getCNSearchMoves(state: SessionState<CNState>, playerId: string): LegalMove<CNMove>[] {
  const gs = state.gameState;
  const legal = getLegalMoves(gs, playerId);
  if (legal.length <= 1) return legal;

  const candNames = new Set(candidateLocations(gs).map(l => l.name));
  const out: LegalMove<CNMove>[] = [];
  let buyClueKept = 0;
  const jailbreakTokensKept = new Map<string, number>();
  const recruitByPriority: { lm: LegalMove<CNMove>; pri: number }[] = [];
  const hackerCardsByValue: { lm: LegalMove<CNMove>; value: number }[] = [];

  for (const lm of legal) {
    const m = lm.move;
    // Guesses: only clue-consistent candidates are worth searching; mid-game
    // guesses only when the pool is narrow enough to be meaningful.
    if ((m.type === 'guess_location' || m.type === 'final_guess') && !candNames.has(m.location_name)) continue;
    if (m.type === 'guess_location' && candidateLocations(gs).length > 3) continue;
    // buy_clue: one representative trio is enough for the search
    if (m.type === 'buy_clue') {
      if (buyClueKept >= 1) continue;
      buyClueKept++;
    }
    // recruit: top 4 by Detective priority (witness > board resident > engine > other)
    if (m.type === 'recruit_informant') {
      if (!m.target_person) {
        // v2.3 privacy: the AI-decider seat's single nameless recruit — keep it
        // (the engine's secret pick is already the priority-best target). A
        // human-decider Detective is never offered this shape; they name their pick.
        recruitByPriority.push({ lm, pri: 4 });
        continue;
      }
      const p = PEOPLE.find(pp => pp.name === m.target_person);
      if (!p) continue;
      const onBoard = gs.detective.board.some(locId => LOCATIONS.find(l => l.id === locId)?.residents.includes(p.id));
      const engine = p.ability === 'draw_3' || p.ability === 'discard_retrieval';
      let pri = p.is_witness ? 4 : onBoard ? 3 : engine ? 2 : 1;
      recruitByPriority.push({ lm, pri });
      continue;
    }
    // jailbreak: ≤2 tokens per jailed person
    if (m.type === 'jailbreak') {
      const key = m.freed_person;
      const kept = jailbreakTokensKept.get(key) ?? 0;
      if (kept >= 2) continue;
      jailbreakTokensKept.set(key, kept + 1);
    }
    // play_person / play_evidence: keep only the top 4 by Hacker value to
    // stop the search from drowning in low-value cards. v2.1+: a motive-set
    // play carries `people` (3 names) — value the TRIO (sum) so complete sets
    // compete at set scale and the C(hand,3) enumeration can't flood the tree.
    if (m.type === 'play_person' || m.type === 'play_evidence') {
      const mv = m as { person_name?: string; people?: string[] };
      // A REVEALED informant blocks its person indefinitely (§6) and blocked
      // evidence is free to retry — search without this prune rediscovers the
      // §19 infinite block loop (13 SAFETY_LIMIT games + 24% dead turns in the
      // 2026-08-13 MCTS trial). Such plays cannot succeed: drop them.
      const lockedBy = new Set(gs.detective.informants.filter(i => i.revealed).map(i => i.person_id));
      if (lockedBy.size > 0) {
        const named = [
          ...(mv.people ?? []),
          ...(mv.person_name ? [mv.person_name] : []),
        ].map(nm => PEOPLE.find(pp => pp.name === nm)?.id ?? nm);
        if (named.some(id => lockedBy.has(id))) continue;
      }
      if (mv.people && mv.people.length === 3) {
        const trio = mv.people.map(nm => PEOPLE.find(pp => pp.name === nm)).filter((p): p is NonNullable<typeof p> => !!p);
        if (trio.length === 3) {
          hackerCardsByValue.push({ lm, value: trio.reduce((s, p) => s + personValueToHacker(p), 0) + 100 });
          continue;
        }
      }
      const p = PEOPLE.find(pp => pp.name === mv.person_name);
      if (p) {
        hackerCardsByValue.push({ lm, value: personValueToHacker(p) });
        continue;
      }
    }
    out.push(lm);
  }

  // Add top recruit picks
  recruitByPriority.sort((a, b) => b.pri - a.pri);
  out.push(...recruitByPriority.slice(0, 4).map(x => x.lm));

  // Add top Hacker card plays
  hackerCardsByValue.sort((a, b) => b.value - a.value);
  out.push(...hackerCardsByValue.slice(0, 4).map(x => x.lm));

  // Drop pass_turn when a productive move exists (search never needs to concede early)
  const nonPass = out.filter(lm => lm.move.type !== 'pass_turn');
  return nonPass.length > 0 ? nonPass : out;
}
