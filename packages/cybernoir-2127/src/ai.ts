// AI for Cybernoir 2127 — tier ladder per docs/ai-development-runbook.md.
//
//   easy   = seeded uniform-random over the legal set (true floor)
//   medium = the full policy SOFTENED with seeded epsilon-noise (25% of
//            non-forced turns play a uniform-random legal move). Designer
//            ruling 2026-08-12: the full policy measures at this game's
//            ceiling (the Detective seat's decisions are mostly forced, so
//            nothing verifiable beats it — heuristic variants and MCTS at
//            feasible budgets all landed within noise), so the ladder is
//            built DOWN from the ceiling instead of up past it. Softening
//            never applies to pending resolutions (final guesses, block
//            decisions, clue reveals stay sharp) or setup.
//   hard   = the full policy, unsoftened. Since 2026-08-19 the Detective
//            default IS the `patient` policy (guess only when certain or
//            post-burn, narrowed-only clue buys, denial-only arrests, final
//            guess keeps pre-burn memory) — the A/B in
//            PLAYTEST-NOTES-2026-08-19.md measured it better in every
//            matchup. The pre-promotion greedy timing lives on as the
//            `deduction` lever. Formerly labeled medium; pre-relabel balance
//            numbers (e.g. the frozen Detective 67.3%) describe the OLD
//            policy at this tier.
//   mcts   = opt-in experimental search tier; budget-dependent, unverified
//            stronger than hard on v1.9 at batch-feasible budgets.
//
// Strategy (parseStrategy) is an orthogonal lever per seat — see AI-NOTES §4.

import type { AIMoveResult, LegalMove } from '@zekel/game-kit';
import type { CNMove, CNState, LocationData, Person } from './types.js';
import { getLegalMoves, recruitablePersonIds } from './legalMoves.js';
import { PEOPLE, LOCATIONS, CLUE_TOKENS, EVIDENCE_TOTAL, WEAPON_ID, getPerson, getLocation, isTwinLocation, boroughName, affiliationName } from './data/index.js';
import { randomInt } from './rng.js';

// ---------------------------------------------------------------------------
// Strategy archetypes (runbook §4) — derived from the two seats' victory paths
// ---------------------------------------------------------------------------

export type CNArchetype =
  | 'denial'    // Detective: informant-first, win on blocks + upkeep pressure
  | 'deduction' // Detective: buy clues aggressively, guess early — since the
                // 2026-08-19 promotion this IS the pre-promotion default hard
                // policy, kept as a lever (measured worse in every matchup).
  | 'pressure'  // Detective: arrest tempo, strip witnesses/residents to jail
  | 'rush'      // Hacker: evidence ASAP, draw engine
  | 'tempo'     // Hacker: disruption (hand_discard/board_discard), no overclock
  | 'engine'    // Hacker: cycle Contacts (draw_3, Corp 2 retrieval)
  | 'cautious'  // Hacker: the human-playtest freeze policy — hold Evidence while
                // ANY facedown informant is out, flush via Corp 1 + win back.
                // MEASURED AS A TRAP (2026-08-12: Detective 87.1% vs 73.6% for
                // the default EV policy) — kept as a lever to model human-like
                // fields, deliberately NOT the default.
  | 'patient'   // Detective: the designer-described human style (playtest
                // 2026-08-19). Hold the mid-game guess until CERTAIN (pool of
                // exactly 1) or until the Hacker has burned; hold clue buys
                // until eliminations have concentrated the pool (or post-burn);
                // arrests/recruits only deny FUTURE plays (zero for people
                // already inside placed Evidence); the final guess remembers
                // the pre-burn pool. PROMOTED TO THE DEFAULT 2026-08-19 after
                // winning the A/B in every matchup — the tag is now a synonym
                // for the default policy; the OLD default lives on as
                // `deduction`.
  | 'escape';   // Hacker: the line Zeke won with (playtest 2026-08-19).
                // Engine-style middlegame, but HOLD the Weapon and HOLD the
                // burn; when the Weapon is the last piece, burn (3 AP) and
                // play the Weapon (free) in the same turn so the final guess
                // faces a freshly wiped board. A/B lever, not the default.

const STRATEGY_ALIASES: Record<string, CNArchetype> = {
  denial: 'denial', informants: 'denial', informant: 'denial', block: 'denial',
  deduction: 'deduction', clues: 'deduction', clue: 'deduction', deduce: 'deduction',
  pressure: 'pressure', arrests: 'pressure', arrest: 'pressure', jail: 'pressure',
  rush: 'rush', evidence: 'rush', fast: 'rush',
  tempo: 'tempo', disruption: 'tempo', disrupt: 'tempo', slow: 'tempo',
  engine: 'engine', cycle: 'engine', cycling: 'engine', draw: 'engine',
  cautious: 'cautious', careful: 'cautious', freeze: 'cautious', humanlike: 'cautious',
  patient: 'patient', stakeout: 'patient', hold: 'patient', conservative: 'patient',
  escape: 'escape', ghost: 'escape', burnlast: 'escape', endgame: 'escape',
};

const DETECTIVE_ARCHETYPES: ReadonlySet<string> = new Set(['denial', 'deduction', 'pressure', 'patient']);
const HACKER_ARCHETYPES: ReadonlySet<string> = new Set(['rush', 'tempo', 'engine', 'cautious', 'escape']);

/** Map a free-form strategy name (+aliases) to an archetype; undefined = adaptive default. */
export function parseStrategy(s?: string): CNArchetype | undefined {
  if (!s) return undefined;
  return STRATEGY_ALIASES[s.trim().toLowerCase()];
}

// ---------------------------------------------------------------------------
// The candidate-elimination model (runbook §2) — the Detective's public knowledge
// ---------------------------------------------------------------------------

/** Locations consistent with every revealed truthful value and every negative clue.
 *  v1.7: when the safehouse card left the deck (`hideout_card_removed`), face-up
 *  board Locations are publicly impossible — both seats can see those cards are
 *  not in the Hacker's hand. */
/**
 * Why this location cannot be the hideout, in words, or undefined while it
 * still stands. The elimination itself — a played card is out once the
 * safehouse card has left the deck, a truthful clue excludes everything that
 * does not match it, a NOT token excludes everything that does — is a rule,
 * so it is stated once, here, and every caller filters on it. Publishing the
 * reason is what lets a client cross a location off without holding the rule.
 */
export function ruledOutReason(state: CNState, l: LocationData): string | undefined {
  if (state.hideout_card_removed && state.detective.board.includes(l.id)) {
    return 'the Detective played this card, so it is not the safehouse';
  }
  const tv = state.hacker.truthful_values;
  if (tv.borough !== undefined && l.borough !== tv.borough) {
    return `the borough clue says ${boroughName(tv.borough)}`;
  }
  if (tv.population !== undefined && l.population !== tv.population) {
    return `the population clue says ${tv.population}`;
  }
  if (tv.affiliation !== undefined && l.affiliation !== tv.affiliation) {
    return `the affiliation clue says ${affiliationName(tv.affiliation)}`;
  }
  for (const tokId of state.hacker.negative_clues) {
    const t = CLUE_TOKENS.find(tok => tok.id === tokId);
    if (!t) continue;
    if (t.type === 'borough' && l.borough === t.value) return `a NOT token rules out ${boroughName(l.borough)}`;
    if (t.type === 'population' && l.population === Number(t.value)) return `a NOT token rules out population ${l.population}`;
    if (t.type === 'affiliation' && l.affiliation === t.value) return `a NOT token rules out ${affiliationName(l.affiliation)}`;
  }
  return undefined;
}

/** Locations consistent with every revealed truthful value and every negative
 *  clue — the ones `ruledOutReason` has nothing to say about. */
export function candidateLocations(state: CNState): LocationData[] {
  return LOCATIONS.filter(l => ruledOutReason(state, l) === undefined);
}

/** The same, plus what only the Detective knows: a card they have held or
 *  discarded cannot be the safehouse either, once the safehouse card has left
 *  the deck. The Hacker must never see this one. */
export function detectiveRuledOutReason(state: CNState, l: LocationData): string | undefined {
  const shared = ruledOutReason(state, l);
  if (shared) return shared;
  if (!state.hideout_card_removed || state.detective.kind !== 'tracked') return undefined;
  const seen = new Set([...state.detective.location_hand, ...(state.detective.location_discard ?? []), ...(state.detective.seen_locations ?? [])]);
  return seen.has(l.id) ? 'you have held or discarded this card' : undefined;
}

/** The Detective's own candidate pool — candidateLocations minus the cards the
 *  Detective has personally seen in circulation (own hand + own discards). Only
 *  valid under the v1.7 card-removed regime, and only the Detective may use it
 *  (the Hacker cannot see the Detective's hand). */
export function detectiveCandidateLocations(state: CNState): LocationData[] {
  return LOCATIONS.filter(l => detectiveRuledOutReason(state, l) === undefined);
}

/** Candidate count if `category` were truthfully revealed with `value` (Hacker's clue-choice math). */
function candidatesIfRevealed(state: CNState, category: 'borough' | 'population' | 'affiliation', value: string): number {
  const sim: CNState = structuredClone(state);
  (sim.hacker.truthful_values as Record<string, unknown>)[category] =
    category === 'population' ? Number(value) : value;
  return candidateLocations(sim).length;
}

/** The `patient` clue-buy test (designer heuristic, playtest 2026-08-19: buy
 *  only when things are "already narrowed down — like a bunch of locations
 *  from the same borough played"). The Hacker answers a bought Clue with the
 *  category leaving the LARGEST remaining pool (their reveal policy below), so
 *  the buy's worst case is the largest same-value class among current
 *  candidates, maxed over the categories still unrevealed. */
export function worstCaseRemainingAfterClue(state: CNState): number {
  const cands = candidateLocations(state);
  const tc = state.hacker.truthful_clues;
  const largestClass = (key: (l: LocationData) => string): number => {
    const counts = new Map<string, number>();
    for (const l of cands) counts.set(key(l), (counts.get(key(l)) ?? 0) + 1);
    return counts.size === 0 ? 0 : Math.max(...counts.values());
  };
  const worsts: number[] = [];
  if (!tc.borough) worsts.push(largestClass(l => String(l.borough)));
  if (!tc.population) worsts.push(largestClass(l => String(l.population)));
  if (!tc.affiliation) worsts.push(largestClass(l => String(l.affiliation)));
  return worsts.length === 0 ? cands.length : Math.max(...worsts);
}

/** Locations eliminated if `tokenId` were declared false (Hacker's jailbreak math). */
function candidatesEliminatedByToken(state: CNState, tokenId: string): number {
  const t = CLUE_TOKENS.find(tok => tok.id === tokenId);
  if (!t) return 0;
  return candidateLocations(state).filter(l => {
    if (t.type === 'borough') return l.borough === t.value;
    if (t.type === 'population') return l.population === Number(t.value);
    return l.affiliation === t.value;
  }).length;
}

// ---------------------------------------------------------------------------
// The one "who's ahead" scalar (runbook §2) — three consumers share this
// ---------------------------------------------------------------------------

export function evidenceCardCount(state: CNState): number {
  const ev = state.hacker.evidence;
  return (ev.weapon ? 1 : 0) + ev.witnesses.length + ev.motive_set_1.length + ev.motive_set_2.length + (ev.motive_set_3 ?? []).length + (ev.motive_set_4 ?? []).length;
}

/** Progress toward that player's own win condition, normalized [0,1]. */
export function progressScore(state: CNState, playerId: string): number {
  if (state.playerOrder[0] === playerId) {
    // Detective: candidate elimination is the win path; informants are supporting pressure.
    const cands = candidateLocations(state).length;
    const base = (LOCATIONS.length - cands) / (LOCATIONS.length - 1);
    const informantBonus = Math.min(state.detective.informants.length, 3) * 0.02;
    return Math.min(1, base + informantBonus);
  }
  // Hacker: 13 evidence cards (v1.9 — weapon + 3 witnesses + 3 motive sets of 3).
  return evidenceCardCount(state) / EVIDENCE_TOTAL;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isDetectiveSeat(state: CNState, pid: string): boolean {
  return state.playerOrder[0] === pid;
}

function trackedHand(state: CNState, pid: string): string[] {
  const p = state.players[pid];
  return p && p.kind === 'tracked' ? p.hand : [];
}

/** Residents of a face-up board location whose POI card is still available to arrest. */
function availableResidents(state: CNState, locId: string): string[] {
  const loc = getLocation(locId);
  if (!loc) return [];
  return loc.residents.filter(r => state.detective.poi_deck.includes(r));
}

/** How much the Hacker wants this person in play (higher = worse to reveal/jail/lose). */
export function personValueToHacker(p: Person): number {
  if (p.ability === 'remove_informant') return 55; // witness + web-cutter
  if (p.is_witness) return 50;
  if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') return 35;
  if (p.ability === 'hand_discard' || p.ability === 'board_discard') return 25;
  if (p.ability === 'reveal_informant') return 15;
  return 10;
}

/** Witnesses the Hacker still needs for Evidence (not yet committed to any slot).
 *  v2.4: the Witness piece is atomic, so once it has landed NO witness is
 *  needed any more — the leftovers are ordinary 'none'-affiliation motive
 *  filler, covered by `motiveMissing`. Leaving them flagged made the Hacker
 *  pay Negative Clues to spring witnesses it no longer wanted (§29c triage)
 *  and made the Detective keep denying a piece already on the table. */
function witnessesNeeded(state: CNState): Person[] {
  const ev = state.hacker.evidence;
  if (ev.witnesses.length >= 3) return [];
  const committed = new Set([...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...ev.motive_set_3, ...(ev.motive_set_4 ?? [])]);
  return PEOPLE.filter(p => p.is_witness && !committed.has(p.id));
}

/** v2.4: witnesses the Hacker can still COMMIT — not already used as Evidence,
 *  not jailed (§5.1), and not locked behind a REVEALED informant (which blocks
 *  that person indefinitely, §6, until won back). The Witness piece needs 3 of
 *  these to exist at once, so this count is what every spend decision prices
 *  against. */
function reachableWitnesses(state: CNState): Person[] {
  const ev = state.hacker.evidence;
  const used = new Set([...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...ev.motive_set_3, ...(ev.motive_set_4 ?? [])]);
  const jailed = new Set(state.detective.jail.flat());
  const locked = new Set(state.detective.informants.filter(i => i.revealed).map(i => i.person_id));
  return PEOPLE.filter(p => p.is_witness && !used.has(p.id) && !jailed.has(p.id) && !locked.has(p.id));
}

/** v2.1: hand cards participating in a live near-trio. A pair with distinct,
 *  gang-legal affiliations whose completing third affiliation is still
 *  obtainable marks both members (full in-hand trios mark all three). Sets can
 *  only be played COMPLETE, so spending one of these as an ability play
 *  destroys assembled Motive progress. */
function nearTrioMembers(state: CNState, hand: string[]): Set<string> {
  const out = new Set<string>();
  const ev = state.hacker.evidence;
  const allSets = [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3 ?? []];
  if (!allSets.some(set => set.length === 0)) return out; // no open slots
  const used = new Set([...ev.witnesses, ...allSets.flat(), ...(ev.motive_set_4 ?? [])]);
  const completedTrios = new Set(allSets.filter(g => g.length >= 3).map(g => [...g.map(id => getPerson(id)!.affiliation as string)].sort().join('+')));
  const eligible = hand.filter(id => id !== WEAPON_ID && !!getPerson(id) && !used.has(id) && !state.detective.jail.flat().includes(id));
  const AFFS = ['none', 'corp_1', 'corp_2', 'gang_1', 'gang_2', 'gang_3'];
  const obtainable = new Set(AFFS.filter(a => PEOPLE.some(p => p.affiliation === a && !used.has(p.id) && !state.detective.jail.flat().includes(p.id))));
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = getPerson(eligible[i]!)!.affiliation as string;
      const b = getPerson(eligible[j]!)!.affiliation as string;
      if (a === b) continue;
      // v2.3-PROBE: at most two gangs per trio.
      const bothGang = a.startsWith('gang') && b.startsWith('gang');
      const completes = AFFS.some(c =>
        c !== a && c !== b && obtainable.has(c)
        && !(bothGang && c.startsWith('gang'))
        && !completedTrios.has([a, b, c].sort().join('+')));
      if (completes) { out.add(eligible[i]!); out.add(eligible[j]!); }
    }
  }
  return out;
}

/** v2.3 privacy: the AI-decider Detective's recruit target, chosen ENGINE-SIDE
 *  so the move (and every response built from it) stays nameless and can't
 *  leak the facedown identity to the Hacker. Same ordering as scoreDetective's
 *  recruit case: needed witnesses > engine abilities > anyone; seeded tiebreak. */
export function pickRecruitTarget(state: CNState, seed: number): string | null {
  // v2.3: location-gated (recruitablePersonIds) — only canvassed people flip.
  const pool = recruitablePersonIds(state).filter(id => getPerson(id));
  if (pool.length === 0) return null;
  const witnessInformants = state.detective.informants.filter(i => getPerson(i.person_id)?.is_witness).length;
  const score = (id: string): number => {
    const p = getPerson(id)!;
    if (p.is_witness) return witnessInformants < 2 ? 80 : 40;
    if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') return 40;
    return 20;
  };
  const best = Math.max(...pool.map(score));
  const tied = pool.filter(id => score(id) === best);
  return tied[randomInt(seed, tied.length).value]!;
}

/** Affiliations placeable in at least one incomplete Motive set (v1.9: three
 *  sets of 3, each needing 3 DIFFERENT affiliations — any affiliations). */
function motiveMissing(state: CNState): Set<string> {
  const ev = state.hacker.evidence;
  const out = new Set<string>();
  for (const target of [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3 ?? []]) {
    if (target.length >= 3) continue;
    const have = new Set(target.map(id => getPerson(id)?.affiliation));
    for (const a of ['none', 'corp_1', 'corp_2', 'gang_1', 'gang_2', 'gang_3']) {
      if (have.has(a as never)) continue;
      out.add(a); // v2.2: gang cap removed
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Move scoring — one function per context. Higher = preferred; ≤0 means pass.
// ---------------------------------------------------------------------------

type Scored = { lm: LegalMove<CNMove>; score: number };

function strategyFor(state: CNState, pid: string, strategy: CNArchetype | undefined): CNArchetype | undefined {
  // A strategy written for the other seat is ignored (adaptive default).
  if (!strategy) return undefined;
  const det = isDetectiveSeat(state, pid);
  if (det && DETECTIVE_ARCHETYPES.has(strategy)) return strategy;
  if (!det && HACKER_ARCHETYPES.has(strategy)) return strategy;
  return undefined;
}

function scorePending(moves: LegalMove<CNMove>[], state: CNState, pid: string, strat: CNArchetype | undefined): Scored[] {
  const pending = state.pending!;
  const det = isDetectiveSeat(state, pid);

  if (pending.type === 'block_pending') {
    const person = getPerson(pending.person_id);
    const worthBlocking = person ? personValueToHacker(person) : 0;
    const upkeepLoad = state.detective.informants.length;
    return moves.map(lm => {
      if (lm.move.type === 'block_decide' && lm.move.block) {
        let s = 25 + worthBlocking * 2;               // clue + denial
        if (upkeepLoad >= 3) s -= 40;                 // upkeep is already heavy
        if (strat === 'denial') s += 60;
        return { lm, score: s };
      }
      return { lm, score: 15 };                        // decline
    });
  }

  if (pending.type === 'clue_reveal_pending') {
    // Hacker: reveal the category that leaves the Detective the LARGEST remaining pool.
    return moves.map(lm => {
      if (lm.move.type !== 'clue_reveal') return { lm, score: 0 };
      const remaining = candidatesIfRevealed(state, lm.move.category, lm.move.value);
      let s = remaining * 10;
      if (lm.move.category === 'population') s += 3; // population is the redundant axis (rulebook §3)
      return { lm, score: s };
    });
  }

  if (pending.type === 'endgame_final_guess') {
    // Detective pending — use the Detective's own (hand/discard-aware) pool.
    const cands = new Set(detectiveCandidateLocations(state).map(l => l.name));
    // Pre-burn memory (default since the 2026-08-19 promotion): the new
    // safehouse must be a DIFFERENT location, so a pre-burn pool pinned to
    // exactly one is a provable exclusion, and a wider pre-burn pool is a soft
    // down-weight (the playtest's old hard AI final-guessed the old hideout).
    if (state.hacker.safehouse_burned ?? false) {
      const pre = state.pre_burn_detective_pool ?? [];
      const preNames = new Set(pre.map(id => getLocation(id)?.name ?? id));
      const certainOld = pre.length === 1;
      return moves.map(lm => {
        if (lm.move.type !== 'final_guess' || !cands.has(lm.move.location_name)) return { lm, score: 0 };
        if (certainOld && preNames.has(lm.move.location_name)) return { lm, score: 1 };
        return { lm, score: preNames.has(lm.move.location_name) ? 60 : 100 };
      });
    }
    return moves.map(lm => ({
      lm,
      score: lm.move.type === 'final_guess' && cands.has(lm.move.location_name) ? 100 : 0,
    }));
  }

  if (pending.type === 'informant_removal_pending') {
    // Anansi scope: prefer facedown (the unknown block threat). Revealed
    // picks (either scope) score by the value of the person being unlocked.
    const needed = new Set(witnessesNeeded(state).map(p => p.id));
    return moves.map(lm => {
      if (lm.move.type !== 'informant_removal_choice') return { lm, score: 0 };
      const target = lm.move.target_informant.trim();
      if (/^\d+$/.test(target)) return { lm, score: 30 };
      const p = PEOPLE.find(pp => pp.name === target);
      if (!p) return { lm, score: 5 };
      return { lm, score: needed.has(p.id) ? 60 : 10 + Math.round(personValueToHacker(p) / 5) };
    });
  }

  if (pending.type === 'burn_choice_pending') {
    // v1.8: every candidate leaves the same fully-reset pool — flat scores,
    // the seeded tiebreak picks one.
    return moves.map(lm => ({ lm, score: lm.move.type === 'burn_choice' ? 10 : 0 }));
  }

  if (pending.type === 'burn_hand_report_pending') {
    // Detective reports their hand — a single mechanical reporting move.
    return moves.map(lm => ({ lm, score: 10 }));
  }

  if (pending.type === 'board_discard_pending') {
    return moves.map(lm => {
      const mv = lm.move;
      if (mv.type !== 'board_discard_choice') return { lm, score: 0 };
      const loc = LOCATIONS.find(l => l.name === mv.target_location);
      if (!loc) return { lm, score: 0 };
      const avail = availableResidents(state, loc.id).length;
      const witnesses = loc.residents.filter(r => getPerson(r)?.is_witness).length;
      return { lm, score: avail * 10 + witnesses * 15 };
    });
  }

  if (pending.type === 'reveal_informant_pending') {
    // Facedown informant identities are HIDDEN from the Hacker — the Corp 1
    // choice is blind (point at a facedown card). All ordinals score equally;
    // the seeded tiebreak picks one.
    return moves.map(lm => ({ lm, score: 10 }));
  }

  // discard_retrieval_pending (Hacker)
  if (pending.type === 'discard_retrieval_pending') {
    const neededWit = new Set(witnessesNeeded(state).map(p => p.id));
    const missing = motiveMissing(state);
    return moves.map(lm => {
      if (lm.move.type !== 'discard_retrieval_choice') return { lm, score: 0 };
      const person = PEOPLE.find(p => p.name === (lm.move as { target_card: string }).target_card);
      if (!person) {
        return { lm, score: (lm.move as { target_card: string }).target_card === 'The Weapon' && !state.hacker.evidence.weapon ? 120 : 5 };
      }
      let s = 10 + person.cost;
      if (neededWit.has(person.id)) s += 100;
      if (missing.has(person.affiliation)) s += 60;
      if (person.ability === 'draw_3' || person.ability === 'discard_retrieval') s += 30;
      return { lm, score: s };
    });
  }

  return moves.map(lm => ({ lm, score: 1 }));
}

function scoreDetective(moves: LegalMove<CNMove>[], state: CNState, pid: string, strat: CNArchetype | undefined, hard: boolean): Scored[] {
  const det = state.detective;
  // The Detective's own pool: under v1.7 card-removal it also excludes cards
  // the Detective has seen in their own hand/discard (they can't be the hideout).
  const cands = detectiveCandidateLocations(state);
  const candNames = new Set(cands.map(l => l.name));
  const witnessCount = det.informants.filter(i => getPerson(i.person_id)?.is_witness).length;
  // `patient` lever inputs (playtest 2026-08-19). Everyone in placed Evidence
  // is beyond reach — arresting/recruiting them does nothing (four dead
  // arrest turns in the playtest). Witness denial only matters while the
  // Witness piece is still open.
  const ev = state.hacker.evidence;
  const evPlaced = new Set([...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...(ev.motive_set_3 ?? []), ...(ev.motive_set_4 ?? [])]);
  if (ev.weapon) evPlaced.add(WEAPON_ID);
  const witnessPieceOpen = ev.witnesses.length < 3;
  const burned = state.hacker.safehouse_burned ?? false;
  // Pre-burn memory: the burn wipes the table, not the Detective's head. The
  // new safehouse must DIFFER from the old one, so a pre-burn pool of exactly
  // one is a provable exclusion; a larger one is still worth down-weighting.
  const preBurnNames = new Set((state.pre_burn_detective_pool ?? []).map(id => getLocation(id)?.name ?? id));
  const preBurnCertain = (state.pre_burn_detective_pool ?? []).length === 1;

  return moves.map(lm => {
    const m = lm.move;
    switch (m.type) {
      case 'play_location': {
        const loc = LOCATIONS.find(l => l.name === m.location_name);
        if (!loc) return { lm, score: 0 };
        const avail = availableResidents(state, loc.id).length;
        const witnesses = loc.residents.filter(r => getPerson(r)?.is_witness).length;
        return { lm, score: 50 + avail * 10 + witnesses * 12 }; // mandatory — always best available
      }
      case 'upkeep_choice': {
        const upkeepMove = m as { keep: string[] };
        let s = 0;
        for (const name of upkeepMove.keep) {
          // v2.3 privacy: tracked-seat upkeep entries are ORDINALS over the
          // informants array (facedown identities never ride the move).
          const ord = Number(name);
          const byOrd = Number.isInteger(ord) && ord >= 1 && ord <= state.detective.informants.length
            ? getPerson(state.detective.informants[ord - 1]!.person_id)
            : undefined;
          const p = byOrd ?? PEOPLE.find(pp => pp.name === name || pp.id === name);
          if (!p) continue;
          let v = 15;
          if (p.is_witness) v = 80;
          else if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') v = 40;
          v -= 25; // AP cost
          if (strat === 'denial') v += 30;
          if (hard && (p.is_witness || p.ability === 'draw_3' || p.ability === 'discard_retrieval')) v += 20;
          s += v;
        }
        return { lm, score: s + 5 }; // any upkeep beats pass once informants exist
      }
      case 'arrest': {
        const p = PEOPLE.find(pp => pp.name === m.target_person);
        if (!p) return { lm, score: 0 };
        // Arrests only DENY FUTURE PLAYS — for EVERY style. A person already
        // inside placed Evidence is beyond reach: jailing their POI does
        // nothing (the 2026-08-19 playtest Detective spent four full turns on
        // exactly that — a bug, not a style, so no lever keeps it). Witness
        // denial likewise only matters while the Witness piece is open.
        if (evPlaced.has(p.id)) return { lm, score: 0 };
        let s = 10;
        if (p.is_witness && witnessPieceOpen) s = 100;   // deny Evidence pieces
        else if (p.ability === 'hand_discard' || p.ability === 'board_discard') s = 40;
        else if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') s = 30;
        else if (p.ability === 'reveal_informant') s = 20;
        if (strat === 'pressure') s += 60;
        if (hard && p.is_witness && witnessPieceOpen) s += 40;
        return { lm, score: s };
      }
      case 'recruit_informant': {
        // v2.3 privacy: the AI-decider seat's recruit move is NAMELESS — score
        // it by the quality of the engine's would-be pick (best available tier).
        // (A human-decider Detective is offered named targets instead.)
        const p = m.target_person
          ? PEOPLE.find(pp => pp.name === m.target_person)
          : getPerson(pickRecruitTarget(state, 1) ?? '');
        if (!p) return { lm, score: 0 };
        // Same denial-only rule as arrests, for EVERY style: an informant on a
        // placed-Evidence person can never block anything, and witness
        // informants only matter while the Witness piece is still open.
        // Informants are the ONE pre-burn investment that survives a burn, so
        // the promoted default stacks them more willingly than the old policy
        // did (-10/-40 vs the old -40/-80); `denial` still stacks hardest.
        if (evPlaced.has(p.id)) return { lm, score: 0 };
        let s = 20;
        if (p.is_witness) s = witnessPieceOpen ? (witnessCount < 2 ? 80 : 40) : 10;
        else if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') s = 40;
        if (det.informants.length >= 2) s -= 10;
        if (det.informants.length >= 3 && strat !== 'denial') s -= 40;
        if (strat === 'denial') s += 60;
        if (hard && ((p.is_witness && witnessPieceOpen) || p.ability === 'draw_3' || p.ability === 'discard_retrieval')) s += 25;
        return { lm, score: s };
      }
      case 'draw_extra_location': {
        // v1.9 clue-cost-4 economy: the steady-state hand is 3 spares, so the
        // 4-AP draw is the Detective's only self-serve path to clue fuel.
        const needClue = !(state.hacker.truthful_clues.borough && state.hacker.truthful_clues.population && state.hacker.truthful_clues.affiliation);
        if (det.location_hand.length >= 3 && cands.length > 2 && needClue) {
          return { lm, score: hard ? 85 : 65 };
        }
        return { lm, score: det.location_hand.length <= 1 ? 30 : -20 };
      }
      case 'guess_location': {
        if (!candNames.has(m.location_name)) return { lm, score: -200 };
        if (strat === 'deduction') {
          // The pre-promotion greedy timing, kept as a lever (this WAS the
          // default hard behavior until 2026-08-19 — the A/B measured it
          // worse in every matchup, see PLAYTEST-NOTES-2026-08-19.md).
          if (cands.length === 1) return { lm, score: 1000 };
          if (cands.length <= 2) return { lm, score: 900 };
          return { lm, score: -200 };
        }
        // DEFAULT (promoted 2026-08-19, designer ruling): pre-burn, guess ONLY
        // when certain — "sure" is exactly one candidate. The UNSPENT guess is
        // the pressure that forces an early burn; anything a speculative guess
        // pins gets wiped by the burn anyway.
        if (!burned) return { lm, score: cands.length === 1 ? 1000 : -200 };
        // Post-burn the guess is live. Apply pre-burn memory: a pinned old
        // pool is a provable exclusion; a wider one is a soft down-weight.
        if (preBurnCertain && preBurnNames.has(m.location_name)) return { lm, score: -200 };
        const effective = cands.filter(l => !(preBurnCertain && preBurnNames.has(l.name)));
        let s = -200;
        if (effective.length === 1) s = 1000;
        else if (effective.length <= 2) s = 900;
        if (s > 0 && preBurnNames.has(m.location_name)) s -= 50;
        return { lm, score: s };
      }
      case 'buy_clue': {
        if (cands.length <= 1) return { lm, score: 0 };
        if (strat !== 'deduction') {
          // DEFAULT (promoted 2026-08-19): buy only once eliminations have
          // NARROWED the pool — even the Hacker's best dodge must leave ≤3
          // candidates. Early buys get answered with the least informative
          // category and a later burn wipes them regardless. `deduction`
          // below keeps the pre-promotion aggressive buying as a lever.
          const worst = worstCaseRemainingAfterClue(state);
          const narrowed = worst <= 3 && worst < cands.length;
          if (!narrowed && !burned) return { lm, score: -100 };
          let s = narrowed ? 120 : 60; // post-burn clues stick — a loose buy is mediocre, not banned
          const handAfter = det.location_hand.length - 3; // v2.3: a buy discards 3
          if (handAfter < 1) s -= 25;
          for (const name of m.discard_locations) {
            const loc = LOCATIONS.find(l => l.name === name);
            if (loc && availableResidents(state, loc.id).length === 0) s += 8;
          }
          return { lm, score: s };
        }
        let s = cands.length > 4 ? 50 : 30;
        // Hard: clues are the actual win path (3 reveals ≈ unique identification);
        // prioritize the clue engine over arrests while the pool is wide.
        if (hard && cands.length > 2) s = 120;
        const handAfter = det.location_hand.length - 4;
        if (handAfter < 1) s -= 25;
        if (hard && cands.length > 2 && det.location_hand.length >= 3) s += 20;
        // Prefer trios of "dead" locations (no arrestable residents left)
        for (const name of m.discard_locations) {
          const loc = LOCATIONS.find(l => l.name === name);
          if (loc && availableResidents(state, loc.id).length === 0) s += 8;
        }
        if (strat === 'deduction') s += 60;
        return { lm, score: s };
      }
      case 'pass_turn':
        return { lm, score: 0 };
      default:
        return { lm, score: 0 };
    }
  });
}

function scoreHacker(moves: LegalMove<CNMove>[], state: CNState, pid: string, strat: CNArchetype | undefined, hard: boolean): Scored[] {
  const hak = state.hacker;
  const hand = trackedHand(state, pid);
  const ap = state.players[pid]?.ap ?? 0;
  const neededWit = new Set(witnessesNeeded(state).map(p => p.id));
  const missing = motiveMissing(state);
  const nearTrio = nearTrioMembers(state, hand); // v2.1: assembled Motive progress
  // v2.4: the Witness piece is an atomic trio too, so every uncommitted witness
  // is progress toward it — spending one (as an ability play, or as a 'none'
  // slot inside a Motive set) can put the piece out of reach for good. Price
  // the spend by what it leaves REACHABLE: below 3 the piece becomes
  // impossible, so that play is never worth making.
  const witnessPieceOpen = state.hacker.evidence.witnesses.length < 3;
  const reachableWit = reachableWitnesses(state).length;
  const heldWit = hand.filter(id => getPerson(id)?.is_witness && !state.detective.jail.flat().includes(id)).length;
  // Convex in scarcity: with only 7 Witnesses printed, and 3 needed in hand AT
  // ONCE off random draws, each one spent costs more than the last. (A flat
  // cheap early rate left the measured burn rate at ~1.9/game — the early
  // spends are exactly what makes the piece unreachable later.)
  const witnessSpendCost = (count: number): number => {
    if (!witnessPieceOpen || count <= 0) return 0;
    const after = reachableWit - count;
    if (after < 3) return 500;            // the piece can never be assembled — refuse
    const per = after >= 6 ? 90 : after === 5 ? 130 : after === 4 ? 170 : 220;
    return per * count;
  };
  const detHand = state.detective.kind === 'tracked' ? state.detective.location_hand.length : 3;
  // `escape` (playtest 2026-08-19, the line Zeke won with): engine-style
  // middlegame, but HOLD the Weapon and HOLD the burn — when the Weapon is the
  // last piece, burn (3 AP) and play the free Weapon in the same turn so the
  // final guess fires against a freshly wiped board.
  const cycling = strat === 'engine' || strat === 'escape';
  const evNow = hak.evidence;
  const motivesDone = [evNow.motive_set_1, evNow.motive_set_2, evNow.motive_set_3 ?? []].every(g => g.length >= 3);
  const weaponIsLastPiece = !evNow.weapon && evNow.witnesses.length >= 3 && motivesDone;
  // Urgency: when the Detective is close to a unique identification, disruption
  // (and not feeding their Location draws) matters more than engine value.
  const detClose = hard && candidateLocations(state).length <= 3;

  // ----- Block-risk model (informant check applies to person AND Evidence
  // plays — rulebook §5.2). Built only from what the Hacker can see: the
  // facedown-informant COUNT is public, identities are not. Any person not
  // jailed and not already revealed could be a facedown informant.
  const facedownCount = state.detective.informants.filter(i => !i.revealed).length;
  const revealedCount = state.detective.informants.filter(i => i.revealed).length;
  const jailedCount = state.detective.jail.flat().length;
  const possibleN = Math.max(1, PEOPLE.length - revealedCount - jailedCount);
  const pMatchBase = facedownCount > 0 ? Math.min(1, facedownCount / possibleN) : 0;
  // A block hands the Detective a clue: worth more to them when their pool is
  // already narrow, worth nothing when every category is revealed.
  const tcNow = state.hacker.truthful_clues;
  const allRevealed = tcNow.borough && tcNow.population && tcNow.affiliation;
  const poolNow = candidateLocations(state).length;
  // A block's clue is worth about a bought clue (the Detective's strongest
  // action per the lift table), scaling as the pool narrows.
  const clueDamage = allRevealed ? 0 : poolNow <= 3 ? 100 : poolNow <= 6 ? 70 : 35;
  /** Expected cost of the informant check for playing this person now. */
  const blockRisk = (p: Person, apAtStake: number): number => {
    // A REVEALED informant is a KNOWN standing block on this exact person
    // (rulebook §6) — the play can NEVER resolve until the informant is won
    // back or removed. Treat as impossible, not risky: a finite penalty let
    // the AI retry blocked Evidence plays (free) forever — the 25-blocks/game
    // infinite loop that move-capped 3 games in the first post-fix batch.
    if (state.detective.informants.some(i => i.revealed && i.person_id === p.id)) {
      return 500;
    }
    if (pMatchBase === 0) return 0;
    // Hard tier priors on WHO gets recruited: Detectives favor witnesses.
    const pMatch = hard && p.is_witness ? Math.min(1, pMatchBase * 3) : pMatchBase;
    // A blocked NEEDED witness locks a required Evidence piece behind a
    // win-back + replay cycle — denial costs more than the clue alone.
    const denial = neededWit.has(p.id) ? 45 : 0;
    return pMatch * (clueDamage + denial + apAtStake * 10 + 15); // +15 = lost tempo
  };

  // Human-playtest policy (designer observation, 2026-08-12): human Hackers
  // treat ANY facedown informant as a freeze on Evidence plays — dig for
  // alternatives, flush the informant (Corp 1 blind reveal → win back), then
  // resume — rather than paying the expected cost. The freeze lifts under
  // desperation: the Detective is about to identify the hideout, the Evidence
  // race is nearly won, or the deck clock is nearly out (stalling loses too).
  // MEASURED AS A TRAP (Detective 87.1% vs 73.6% for the EV policy, N=1000
  // each) — so it is gated behind the `cautious` strategy lever to model
  // human-like fields, never the adaptive default.
  const detNearWin = poolNow <= 2;
  const evidenceCount = evidenceCardCount(state);
  const lateGame = state.detective.kind === 'tracked'
    ? state.detective.location_deck.length <= 4
    : state.turn >= 8;
  const desperate = detNearWin || evidenceCount >= 10 || lateGame;
  const evidenceFreeze = strat === 'cautious' && facedownCount > 0 && !desperate;

  // Would +1 AP from Overclock convert to an extra play this turn?
  const playableCosts = hand
    .map(id => getPerson(id))
    .filter((p): p is Person => !!p && !state.detective.jail.flat().includes(p.id) && p.id !== WEAPON_ID)
    .map(p => p.cost)
    .sort((a, b) => a - b);
  let affordable = 0;
  let spend = ap;
  for (const c of playableCosts) { if (c <= spend) { affordable++; spend -= c; } }
  let affordableWithOC = 0;
  spend = ap + 1;
  for (const c of playableCosts) { if (c <= spend) { affordableWithOC++; spend -= c; } }
  const overclockConverts = affordableWithOC > affordable;

  return moves.map(lm => {
    const m = lm.move;
    switch (m.type) {
      case 'play_evidence': {
        let s = 0;
        if (m.evidence_type === 'weapon' && strat === 'escape') {
          // The Weapon is free and unblockable — the perfect finisher. Hold it
          // until it is the LAST piece, and finish through the burn when the
          // burn is still available (burn scores higher, so it goes first).
          if (!weaponIsLastPiece) return { lm, score: -150 };
          if (hak.safehouse_burned) return { lm, score: 1000 }; // board wiped — finish now
          return { lm, score: ap >= 3 ? 300 : -100 }; // burn first / wait for the burn turn
        }
        if (m.evidence_type === 'weapon') s = 200;
        else if (m.evidence_type === 'witness') {
          // v2.4: the COMPLETE Witness piece in one free play — three cards at
          // once, so it lands the same size of step as a Motive set.
          s = 150;
          const setPeople = (m.people ?? []).map(n => PEOPLE.find(pp => pp.name === n) ?? getPerson(n));
          // v2.0 Anansi rider: his Evidence commit ALSO removes an informant —
          // a two-for-one when the web exists. Under v2.4 he can no longer be
          // held back for later (the piece is all-or-nothing), so the old
          // "hold him unless he's the last one needed" discount is gone; a
          // trio that includes him is simply worth more while informants are
          // facedown.
          if (setPeople.some(pp => pp?.ability === 'remove_informant')) {
            const fd = state.detective.informants.filter(i => !i.revealed).length;
            if (fd > 0) s += 15 + fd * 10;
          }
        }
        else if (m.evidence_type === 'motive') {
          // v2.1: a COMPLETE set of 3 in one free play — the single biggest
          // progress step in the game.
          s = 150;
          const setPeople = (m.people ?? []).map(n => PEOPLE.find(pp => pp.name === n) ?? getPerson(n));
          // v2.4: a witness burned in a 'none' motive slot is a card the
          // atomic Witness piece can never get back. Priced by scarcity (the
          // old flat -30 was set when witnesses committed one at a time, and
          // measured at 1.96 witnesses burned per game once the piece went
          // atomic — the Hacker was spending its own win condition).
          s -= witnessSpendCost(setPeople.filter(pp => pp?.is_witness).length);
          // v2.0/2.1 Iceden rider: a set carrying the gang's member also wins
          // back a revealed informant — worth most when the lock holds a card
          // the Hacker still needs.
          if (setPeople.some(pp => pp?.affiliation === 'gang_1')) {
            const lockedNeeded = state.detective.informants.some(i => i.revealed && neededWit.has(i.person_id));
            const anyRevealed = state.detective.informants.some(i => i.revealed);
            if (anyRevealed) s += lockedNeeded ? 45 : 18;
          }
        }
        if (strat === 'rush') s += 60;
        // Hard: evidence is the win condition. Escalate as the race fills, and
        // reward safe plays (no facedown informants to block).
        if (hard) {
          const evc = evidenceCardCount(state);
          if (evc >= 9) s += 40; // endgame sprint
          if (facedownCount === 0) s += 25; // completely safe this turn
        }
        // Informant check applies to Evidence plays (free — no AP at stake).
        // The Weapon has no POI copy and can never be blocked. v2.1: a motive
        // SET is checked card by card and ONE block bounces all three — risk
        // accumulates across the trio.
        if (m.evidence_type !== 'weapon') {
          // v2.4: BOTH set types are checked card by card, so both price risk
          // the same way (the Weapon has no POI copy and is never checked).
          const checked = (m.people ?? [])
            .map(n => PEOPLE.find(pp => pp.name === n) ?? getPerson(n))
            .filter((p): p is Person => !!p);
          const risks = checked.map(p => evidenceFreeze
            ? (neededWit.has(p.id) ? 110 : 85)
            : blockRisk(p, 0));
          // A bounced set loses NO cards — one block's clue + tempo, not
          // three. Worst single-card risk at full weight, the rest discounted;
          // a revealed-lock (hard 500) stays full — that set WILL bounce until
          // the lock is broken.
          risks.sort((x, y) => y - x);
          s -= risks.reduce((sum, r, i) => sum + (r >= 500 || i === 0 ? r : r * 0.35), 0);
        }
        return { lm, score: s };
      }
      case 'draw_contact': {
        let s = hand.length <= 2 ? 60 : 25;
        // Hard: evidence needs 13 specific cards from a 25-card deck — volume wins races
        if (hard && hand.length < 4 && evidenceCardCount(state) < EVIDENCE_TOTAL) s = Math.max(s, 75);
        // v2.4: the Witness piece only plays with all 3 in hand at once, so
        // while it is short of three the Hacker must keep digging — a bigger
        // hand is the whole cost of an atomic piece (measured max held: 2.44).
        if (witnessPieceOpen && heldWit < 3) s = Math.max(s, 70);
        if (cycling) s += 40;
        // While Evidence is frozen, dig — cycling is what the freeze buys time for.
        if (evidenceFreeze) s += 30;
        return { lm, score: s };
      }
      case 'play_person': {
        const p = PEOPLE.find(pp => pp.name === m.person_name);
        if (!p) return { lm, score: 0 };
        let s = 10;
        switch (p.ability) {
          case 'draw_3': s = hand.length <= 3 ? 70 : 30; break;
          case 'discard_retrieval': {
            const hasNeeded = hak.contacts_discard.some(id => neededWit.has(id) || missing.has(getPerson(id)?.affiliation ?? ''));
            s = hasNeeded ? 65 : 15;
            break;
          }
          case 'hand_discard': s = detHand >= 3 ? 55 : 20; break;
          case 'board_discard': {
            const juicy = state.detective.board.some(locId => availableResidents(state, locId).length > 0);
            s = juicy ? 50 : 10;
            break;
          }
          case 'reveal_informant': {
            // Blind reveal (identities hidden). Under the freeze this is THE
            // unlock: flush the informant into the open, win it back, resume
            // Evidence — the reveal-then-win-back line human playtests use.
            s = facedownCount > 0 ? (evidenceFreeze ? 75 : 20) : 5;
            if (hard && facedownCount > 0) s += 15;
            break;
          }
          case 'remove_informant': {
            // Rider design: the removal rides his EVIDENCE commit; playing him
            // as a person wastes both halves. Plain-witness value only.
            s = 5;
            break;
          }
          case 'witness': s = 5; break; // better used as Evidence
        }
        if (strat === 'tempo' && (p.ability === 'hand_discard' || p.ability === 'board_discard')) s += 40;
        if (cycling && (p.ability === 'draw_3' || p.ability === 'discard_retrieval')) s += 40;
        if (strat === 'rush') s -= 10; // evidence first
        if (detClose && (p.ability === 'hand_discard' || p.ability === 'board_discard')) s += 50;
        // v2.1: sets only play COMPLETE — spending a near-trio card as an
        // ability torches assembled progress. Corps are the bottleneck
        // (3+3 cards for >=6 non-gang motive slots); gangs are plentiful.
        if (nearTrio.has(p.id)) {
          s -= p.affiliation === 'corp_1' || p.affiliation === 'corp_2' ? 50
            : p.affiliation === 'none' ? 30 : 15;
        }
        // v2.4: and a witness played as a PERSON is the same loss to the
        // atomic Witness piece as one burned in a Motive set.
        if (p.is_witness) s -= witnessSpendCost(1);
        // Informant check: a blocked person play loses the printed AP too.
        s -= blockRisk(p, p.cost);
        return { lm, score: s };
      }
      case 'win_back': {
        const p = PEOPLE.find(pp => pp.name === m.person_name);
        if (!p) return { lm, score: 0 };
        let s = 20;
        if (neededWit.has(p.id)) s = 90;
        else if (missing.has(p.affiliation)) s = 60;
        else if (p.ability === 'draw_3' || p.ability === 'discard_retrieval') s = 50;
        if (hard && neededWit.has(p.id)) s += 30;
        return { lm, score: s };
      }
      case 'jailbreak': {
        const p = PEOPLE.find(pp => pp.name === m.freed_person);
        if (!p) return { lm, score: 0 };
        // v2.3 jail-era policy (ceiling probe 2026-08-14, PORT-NOTES §29c):
        // springing non-witness prisoners paid a Negative Clue for a body the
        // Hacker rarely critically needed — measured as a ~9pp leak. Only
        // needed witnesses get sprung; everyone else serves their 3 turns
        // (the deck cycles them back; trios have no-cap alternatives).
        let s = -30;
        if (neededWit.has(p.id)) s = 80;
        if (hard && neededWit.has(p.id)) s += 30;
        // Least-informative token bonus: prefer tokens eliminating the fewest candidates
        const elim = candidatesEliminatedByToken(state, m.negative_clue_token);
        s += Math.max(0, 10 - elim * 3);
        return { lm, score: s };
      }
      case 'overclock': {
        if (strat === 'tempo') return { lm, score: -100 }; // hands the Detective draws
        if (detClose) return { lm, score: -50 };           // don't feed a closing Detective's clock
        let s = overclockConverts ? 45 : 15;
        if (strat === 'rush' && overclockConverts) s += 10;
        if (hard && overclockConverts) s += 20;
        return { lm, score: s };
      }
      case 'burn_safehouse': {
        // Escape hatch: v1.8 wipes EVERY clue token, so the gain is the full
        // reset — biggest when the Detective has nearly pinned the hideout.
        const publicPool = candidateLocations(state).length;
        const options = burnCandidates(state);
        if (options.length === 0) return { lm, score: -100 };
        const gain = postBurnAmbiguity(state) - publicPool;
        if (strat === 'escape') {
          // The finisher: Weapon in hand as the LAST piece → burn now and play
          // it this same turn (evidence plays are free at 0 AP). The final
          // guess then fires against a wiped board.
          if (weaponIsLastPiece && hand.includes(WEAPON_ID)) return { lm, score: 2000 };
          // Otherwise hold the burn HARDER than the default. The one emergency
          // is a live mid-game guess threat at a pinned pool; once that guess
          // is SPENT, only the final guess remains — and the finisher wipes it
          // ("the Detective can't guess again until the end", 2026-08-19).
          if (!state.detective.mid_game_guess_spent && publicPool <= 2 && gain > 0) {
            return { lm, score: 400 + gain * 10 };
          }
          return { lm, score: -50 };
        }
        if (publicPool <= 2 && gain > 0) return { lm, score: 400 + gain * 10 };
        if (hard && publicPool <= 4 && gain >= 3) return { lm, score: 240 };
        return { lm, score: -50 }; // save it for the emergency
      }
      case 'pass_turn':
        return { lm, score: 0 };
      default:
        return { lm, score: 0 };
    }
  });
}

// ---------------------------------------------------------------------------
// Burn the Safehouse policy (rules v1.7)
// ---------------------------------------------------------------------------

/** How many locations stay possible (from the Detective's public view) after a
 *  burn. v1.8: a burn clears ALL clues — truthful and negative — so the
 *  post-burn pool no longer depends on which location the Hacker picks; only
 *  the board exclusion (card-removed regime) constrains it. */
function postBurnAmbiguity(state: CNState): number {
  const sim: CNState = structuredClone(state);
  sim.hacker.truthful_clues = { borough: false, population: false, affiliation: false };
  sim.hacker.truthful_values = {};
  sim.hacker.negative_clues = [];
  return candidateLocations(sim).length;
}

/** New-hideout candidates from the HACKER's own knowledge. Detective tracked:
 *  the pile is exactly deck + discard. Detective opaque: the hand is unknown
 *  until reported, so this is the optimistic superset (all − board − current). */
export function burnCandidates(state: CNState): string[] {
  const currentId = state.hacker.hideout_location_id ?? LOCATIONS.find(l =>
    state.hacker.hideout &&
    l.borough === state.hacker.hideout.borough &&
    l.population === state.hacker.hideout.population &&
    l.affiliation === state.hacker.hideout.affiliation)?.id;
  if (state.detective.kind === 'tracked') {
    return [...new Set([...state.detective.location_deck, ...(state.detective.location_discard ?? [])])]
      .filter(id => id !== currentId);
  }
  return LOCATIONS.map(l => l.id).filter(id => !state.detective.board.includes(id) && id !== currentId);
}

/** Pick the new safehouse. v1.8: every candidate leaves the Detective the same
 *  (fully reset) information, so the pick is a seeded uniform draw. Used by the
 *  engine for tracked-Hacker burns so the pick never travels through a
 *  move/response (it must stay secret). */
export function pickBurnLocation(
  state: CNState,
  candidateIds: string[],
  seed: number,
): { locId: string; nextSeed: number } {
  // v2.0: prefer a clue-immune twin when one is in the pile — the post-burn
  // clue rebuild can never pinpoint it.
  const twins = candidateIds.filter(id => isTwinLocation(id));
  const pool = twins.length > 0 ? twins : candidateIds;
  const r = randomInt(seed, pool.length);
  return { locId: pool[r.value]!, nextSeed: r.nextSeed };
}

// ---------------------------------------------------------------------------
// Setup choice policy (runbook §6) — the hideout pick IS the identity axis
// ---------------------------------------------------------------------------

/**
 * Strategy-driven hideout pick. rush → pop-3 with high-value residents (opening
 * hand advantage); tempo/engine → pop-0/1 (information denial); adaptive → pop ≥2
 * with useful residents. Seeded tiebreak so batches vary within the policy.
 */
export function pickHideoutLocation(
  strategy: CNArchetype | undefined,
  seed: number,
): { loc: LocationData; nextSeed: number } {
  const scored = LOCATIONS.map(l => {
    const residents = l.residents.map(id => getPerson(id)).filter((p): p is Person => !!p);
    const residentValue = residents.reduce(
      (sum, p) => sum + (p.is_witness ? 15 : (p.ability === 'draw_3' || p.ability === 'discard_retrieval') ? 10 : 4),
      0,
    );
    let s: number;
    if (strategy === 'rush') s = l.population * 20 + residentValue;
    else if (strategy === 'tempo' || strategy === 'engine' || strategy === 'escape') s = (3 - l.population) * 15;
    else s = (l.population >= 2 ? 10 : 0) + residentValue;
    // v2.0: attribute twins are clue-immune (only elimination splits them) —
    // measured ≈ +5 pp for the Hacker. Every policy values that.
    if (isTwinLocation(l.id)) s += 15;
    return { l, s };
  });
  const best = Math.max(...scored.map(x => x.s));
  const tied = scored.filter(x => x.s === best);
  const r = randomInt(seed, tied.length);
  return { loc: tied[r.value]!.l, nextSeed: r.nextSeed };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function chooseMove(
  state: CNState,
  playerId: string,
  difficulty: string = 'medium',
  strategy?: CNArchetype,
): AIMoveResult<CNMove> {
  // The log length feeds the seed so a zero-state-change cycle (e.g. a FREE
  // Evidence play into a no-effect block: nothing changes but the log) can
  // never produce the same pick forever — the deterministic infinite loop
  // that move-capped 5 ladder games after the revealed-block rule landed.
  const seed = ((state.rngSeed ^ Math.imul(state.turn + 1, 2654435761) ^ Math.imul(state.log.length + 1, 40503)) >>> 0);

  // Setup: the Hacker reports a NAMELESS report_hideout — the engine picks the
  // location itself (strategy-aware via state.seat_strategies). The pick must
  // never ride in the move: get_ai_move/run_ai_turn echo applied moves to the
  // client, which would hand the human Detective the AI's hideout.
  if (state.phase === 'setup') {
    return { move: { type: 'report_hideout' }, narration: 'Chose hideout (secret).' };
  }

  const moves = getLegalMoves(state, playerId);
  if (moves.length === 0) {
    return { move: { type: 'pass_turn' }, narration: 'No legal moves — passing.' };
  }

  const moveSeed = (seed ^ Math.imul(moves.length, 97)) >>> 0;

  if (difficulty === 'easy') {
    const idx = randomInt(moveSeed, moves.length).value;
    return { move: moves[idx]!.move, narration: `Random move: ${moves[idx]!.move_id}` };
  }

  // Medium = softened ceiling (see header): 25% of non-forced turns play a
  // seeded uniform-random legal move instead of the policy pick.
  if (difficulty === 'medium' && !state.pending && moves.length > 1) {
    const roll = randomInt((moveSeed ^ 0x9e3779b9) >>> 0, 100);
    if (roll.value < 25) {
      const idx = randomInt(roll.nextSeed, moves.length).value;
      return { move: moves[idx]!.move, narration: `Medium move: ${moves[idx]!.move_id}` };
    }
  }

  const hard = difficulty === 'hard' || difficulty === 'medium';
  const strat = strategyFor(state, playerId, strategy);

  const scored: Scored[] = state.pending
    ? scorePending(moves, state, playerId, strat)
    : isDetectiveSeat(state, playerId)
      ? scoreDetective(moves, state, playerId, strat, hard)
      : scoreHacker(moves, state, playerId, strat, hard);

  let best = -Infinity;
  for (const s of scored) best = Math.max(best, s.score);
  const tied = scored.filter(s => s.score === best);
  const pick = tied[randomInt(moveSeed, tied.length).value]!;

  return { move: pick.lm.move, narration: `${hard ? 'Hard' : 'Medium'} move: ${pick.lm.move_id}` };
}
