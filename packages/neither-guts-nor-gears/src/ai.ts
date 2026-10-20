// Neither Guts nor Gears — the AI (ai-development gate; rebuilt 2026-09-24).
//
// `chooseMove(state, playerId, difficulty?, strategy?)`:
//   random — uniform-random over the legal set (seeded, advancing with state).
//   easy   — the classic AI's medium (ai-classic.ts: the 2026-09-22 AI, kept
//            unchanged as a fixed yardstick).
//   medium — the classic AI's hard.
//   hard   — plans every decision against one measure: its chance of winning
//            the race (ai-eval.ts). A purchase, a move, a treaty, a hero claim
//            is tried with the engine (applyMove is pure) and the position it
//            leaves is read: how many rounds until each seat can win by
//            culture, technology, the Economic spend (ai-econ.ts) or a Leader
//            kill (ai-military.ts). The option that raises the chance most is
//            taken; doing nothing is always one of the options, so it never
//            moves or buys for the sake of it.
//   mcts   — generic search (index.ts).
//
// Planning places only the cards the round's plan will use, in the order the
// stack should resolve them: the Action Stack resolves last-in, first-out, so
// Research goes down first (resolving after the Builds it must not starve),
// then Build, then Move/Battle last (it resolves first, so a hero stepping
// toward wood makes the Amphitheatre payable in the same round).
//
// Strategy is orthogonal: the four printed victory paths are the archetypes;
// `parseStrategy` maps names/aliases; a strategy seat judges its own position
// by that path's finishing round only. `undefined` is the adaptive default.
//
// Nothing hidden is read: another seat's hand, spy carrier and face-down
// action cards never enter a decision.

import type { LegalMove } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import type { Coord, NGGMove, NGGState, PlayerState } from './types.js';
import {
  applyMove as engineApply, availableCollectorIds, byId, findPayment, hasCollectionAccess, locationOwner, militaryThreshold,
  purchaseCostOf, speciesOf,
} from './engine.js';
import { getLegalMoves } from './legalMoves.js';
import { heroesEligibleFor, unitById } from './resolvers.js';
import { attackKillsLeader } from './ai-strike.js';
import { HEROES, MAX_HEROES_PER_PLAYER, cultureTargetFor, milestonesFor, type Species } from './data/catalogs.js';
import { unitsForSpecies } from './data/catalogs.js';
import { collectorCapFor, coreSupplyFor, economicCollectorsNeeded } from './economicScale.js';
import { coordKey, neighborsOf } from './data/maps.js';
import { randomInt } from './rng.js';
import { chooseMoveClassic } from './ai-classic.js';
import {
  chanceAll, chanceSelf, leaderAgainst, readTable, STOP_SHARE, type Lean,
} from './ai-eval.js';
import {
  applyBuy, applyHero, available, cloneEcon, econFromState, itemsFor, raceOf, type Econ,
} from './ai-econ.js';
import { counterKillers, distancesFrom, leaderOf, strikesFirst, threatTo } from './ai-military.js';
import {
  activationScore, commitScore, counterScore, defenseScore, extraScore, rallyScore, retreatScore,
} from './ai-battle.js';

export type Difficulty = 'random' | 'easy' | 'medium' | 'hard';

export interface ScoredMove { move: NGGMove; score: number; narration: string }

// ---------------------------------------------------------------------------
// Strategy — the four victory paths as levers
// ---------------------------------------------------------------------------

export type NGGStrategy = 'military' | 'cultural' | 'economic' | 'technological';

const STRATEGY_ALIASES: Record<string, NGGStrategy> = {
  military: 'military', conquest: 'military', aggro: 'military', kill: 'military', kills: 'military',
  cultural: 'cultural', culture: 'cultural', income: 'cultural', subjects: 'cultural',
  economic: 'economic', economy: 'economic', eleven: 'economic', spend: 'economic', surfs: 'economic',
  technological: 'technological', tech: 'technological', science: 'technological', research: 'technological',
};

/** Free-form name (+ aliases) → an archetype; `undefined` ⇒ the adaptive
 *  default. Unknown strings return undefined (a typo degrades to adaptive). */
export function parseStrategy(s: string | undefined): NGGStrategy | undefined {
  if (s === undefined) return undefined;
  return STRATEGY_ALIASES[s.trim().toLowerCase()];
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

interface Ctx {
  state: NGGState;
  p: PlayerState;
  me: string;
  lean: Lean;
  hard: boolean;
}

export function chooseMove(state: NGGState, playerId: string, difficulty: Difficulty = 'medium', strategy?: string): { move: NGGMove; narration: string } {
  // easy and medium are the classic AI's medium and hard, unchanged.
  if (difficulty === 'easy' || difficulty === 'medium') {
    return chooseMoveClassic(state, playerId, difficulty === 'easy' ? 'medium' : 'hard', strategy);
  }
  const legal = getLegalMoves(state, playerId);
  if (legal.length === 0) throw new GameError('ILLEGAL_MOVE', `AI ${playerId} has no legal move`);
  const p = byId(state, playerId);
  const completed = legal.map((lm) => completeMove(state, p, lm.move)).filter((m): m is NGGMove => m !== null);
  if (completed.length === 0) throw new GameError('ILLEGAL_MOVE', `AI ${playerId} has no completable move`);
  // A payment listed at menu time can go stale after an access refusal; never
  // propose a payment that names a collector no longer free.
  const avail = new Set(availableCollectorIds(state, p));
  const live = completed.filter((m) => {
    const pay = (m as { payment?: Array<{ collectorId: string }> }).payment;
    return !Array.isArray(pay) || pay.every((pl) => avail.has(pl.collectorId));
  });
  const pool = live.length > 0 ? live : completed;
  if (difficulty === 'random') return { move: pool[Math.floor(seededUnit(state) * pool.length)]!, narration: 'picks at random' };

  // A strategy lever wins; otherwise the seat keeps to the way to win it
  // wrote down at upkeep (commitPath).
  const strat = parseStrategy(strategy ?? p.strategy);
  // In the opening rounds the seat plays its drawn goal like a strategy lever
  // (leaning hard); any plan after that as a light commitment.
  const opening = p.aiPlan?.openingUntil !== undefined && state.round <= p.aiPlan.openingUntil;
  const lean: Lean = strat ?? (p.aiPlan ? (opening ? p.aiPlan.path : `commit:${p.aiPlan.path}`) : undefined);
  const ctx: Ctx = { state, p, me: playerId, lean, hard: true };
  const best = decide(ctx, pool)[0]!;
  return { move: best.move, narration: best.narration };
}

/** Fill the fields a menu skeleton leaves for a human to edit (a base's
 *  at_base). null when the move can't be made legal now. */
function completeMove(state: NGGState, p: PlayerState, move: NGGMove): NGGMove | null {
  if (move.type === 'build' && !move.at_base) {
    const species = speciesOf(p);
    const isBase = (species === 'wizard' && move.item === 'Castle') || (species === 'robot' && move.item === 'Home');
    if (isBase) return null; // the menu names every legal base tile as its own move
  }
  return payWithoutAsking(state, p, move);
}

/** A purchase whose offered payment uses a tile another seat holds needs
 *  that seat's consent, and the AI's try-it-out read stalls on the question
 *  (the access request is the other seat's to answer), so the purchase looks
 *  worth nothing. A military-lever seat one Illusionist short of its spy kill
 *  bought a Subject instead, round after round (2026-10-08). Pay from tiles
 *  needing nobody's consent when the engine's payment search finds a way;
 *  otherwise keep the offered payment and ask. */
function payWithoutAsking(state: NGGState, p: PlayerState, move: NGGMove): NGGMove {
  if (move.type !== 'build' && move.type !== 'research') return move;
  const asks = (pay: Array<{ coord: Coord }>) => pay.some((pl) => {
    const owner = locationOwner(state, pl.coord);
    return owner !== null && owner !== p.playerId && !hasCollectionAccess(state, p.playerId, owner);
  });
  if (!asks(move.payment)) return move;
  const others = state.players.filter((q) => q.playerId !== p.playerId && !hasCollectionAccess(state, p.playerId, q.playerId)).map((q) => q.playerId);
  let priced: ReturnType<typeof purchaseCostOf>;
  try { priced = purchaseCostOf(p, move); } catch { return move; }
  const costs = priced.either ? priced.either.map((leg) => ({ ...priced.cost, [leg]: (priced.cost[leg] ?? 0) + 1 })) : [priced.cost];
  for (const cost of costs) {
    const pay = findPayment(state, p, cost, others, 3000);
    if (pay && !asks(pay)) return { ...move, payment: pay } as NGGMove;
  }
  return move;
}

/** Search needs concrete choices: a bounded ranked frontier plus one of each
 *  move type. */
export function searchChoices(state: NGGState, playerId: string): LegalMove<NGGMove>[] {
  const p = byId(state, playerId);
  const legal = getLegalMoves(state, playerId).flatMap((lm) => {
    const move = completeMove(state, p, lm.move);
    return move ? [{ ...lm, move }] : [];
  });
  if (legal.length <= 12) return legal;
  const ranked = decide({ state, p, me: playerId, lean: undefined, hard: true }, legal.map((l) => l.move));
  const order = new Map(ranked.map((r, i) => [JSON.stringify(r.move), i]));
  const sorted = [...legal].sort((a, b) => (order.get(JSON.stringify(a.move)) ?? 99) - (order.get(JSON.stringify(b.move)) ?? 99));
  const selected = sorted.slice(0, 12);
  const types = new Set(selected.map((m) => m.move.type));
  for (const m of sorted) if (!types.has(m.move.type)) { selected.push(m); types.add(m.move.type); }
  return selected;
}

/** Deterministic 0..1 that advances with the state (seed + a per-state salt). */
function seededUnit(state: NGGState): number {
  const salt = state.round * 7919 + state.phase.length * 131 + state.log.length;
  return randomInt((state.seed ^ salt) >>> 0, 1000003).value / 1000003;
}

/** Uniform-random over the legal set, seeded and advancing with the state. */
export function seededPick(state: NGGState, legal: LegalMove<NGGMove>[]): NGGMove {
  const salt = state.round * 7919 + state.phase.length * 131 + legal.length * 17 + state.log.length;
  return legal[randomInt((state.seed ^ salt) >>> 0, legal.length).value]!.move;
}

// ---------------------------------------------------------------------------
// Trying a move
// ---------------------------------------------------------------------------

/** Apply a move for evaluation only (the log is left behind: it is output).
 *  During the action phase a spare card of the mover's sits at the bottom of
 *  the stack, so finishing the last real card never runs on into the income
 *  step: every option is read at the same point in the round. */
function tryMove(state: NGGState, pid: string, move: NGGMove): NGGState | null {
  const view: NGGState = state.phase === 'action'
    ? { ...state, log: [], actionStack: [{ ownerId: pid, cardKind: 'research', slotId: 'ai-probe:floor' }, ...state.actionStack] }
    : { ...state, log: [] };
  try { return engineApply(view, pid, move).newState; } catch { return null; }
}

/** Decisions a purchase or move can hand straight back to its own maker:
 *  which hero carries a new spy, Foreman's second purchase, where a claimed
 *  hero lands, an overlay pick, a card draw, a robot's Dowser collectors. */
const OWN_FOLLOW_UPS = new Set(['choose_spy', 'second_purchase', 'place_reserved_hero', 'overlay_choice', 'report_draw', 'smyth_reward', 'dowser_collector']);

/** Try a move and answer my own follow-up decisions the best way I can, so
 *  the position is judged once the move has really landed (a spy recruited
 *  counts only once a hero carries it; Foreman's two purchases are judged as
 *  a pair). `before` is the position the whole decision started from. */
function tryAndSettle(ctx: Ctx, before: NGGState, from: NGGState, move: NGGMove, depth = 0): NGGState | null {
  const after = tryMove(from, ctx.me, move);
  if (!after || depth >= 2) return after;
  const pend = after.pending;
  if (!pend || pend.forPlayerId !== ctx.me || !OWN_FOLLOW_UPS.has(pend.kind)) return after;
  let best: NGGState | null = null; let bestScore = -Infinity;
  for (const m of dedupe(legalOn(after, ctx.me))) {
    const next = tryAndSettle(ctx, before, after, m, depth + 1);
    if (!next) continue;
    const s = chanceSelf(before, next, ctx.me, ctx.lean);
    if (s > bestScore) { bestScore = s; best = next; }
  }
  return best ?? after;
}

/** A copy of the position with this seat's card of `kind` resolving now, so a
 *  purchase or move can be tried during planning. A second card of the seat's
 *  stays under it, so finishing the probe doesn't start the income step. */
function probeState(state: NGGState, me: string, kind: 'build' | 'research' | 'move_battle'): NGGState {
  const top = { ownerId: me, cardKind: kind, slotId: `ai-probe:${kind}` };
  const under = { ownerId: me, cardKind: 'research' as const, slotId: 'ai-probe:under' };
  return {
    ...state, phase: 'action', pending: null, battle: null,
    activeAction: { ...top }, actionStack: [under, top], log: [],
  };
}

interface Option { move: NGGMove; score: number; narration: string }

function opt(move: NGGMove, score: number): Option { return { move, score, narration: narrationFor(move) }; }

function rank(options: Option[]): Option[] {
  return options.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function decide(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, me } = ctx;
  const pend = state.pending;
  if (pend && pend.forPlayerId === me) return decidePending(ctx, pool);
  if (state.battle && state.battle.phase === 'activations') return rank(pool.map((m) => opt(m, battleScore(ctx, m))));
  if (state.phase === 'planning') return decidePlanning(ctx, pool);
  if (state.phase === 'action' && state.activeAction?.ownerId === me) return decideAction(ctx, pool);
  if (state.phase === 'treaty_break' || state.phase === 'end_of_round') return decideBreaks(ctx, pool);
  return rank(pool.map((m) => opt(m, 1)));
}

function battleScore(ctx: Ctx, m: NGGMove): number {
  const { state, p } = ctx;
  switch (m.type) {
    case 'battle_activation': return activationScore(state, p, m);
    case 'commit_battle_card': return commitScore(state, p, m);
    case 'resolve_battle_defense': return defenseScore(state, p, m);
    case 'choose_retreat': return retreatScore(state, p, m);
    case 'select_extra_cards': return extraScore(state, p, m);
    case 'choose_counter_target': return counterScore(state, p, m);
    case 'select_rally_units': return rallyScore(state, p, m);
    case 'choose_initiative_order': {
      // The spy carrier or the hardest hitter acts first.
      const b = state.battle!;
      const u = b.units.find((x) => x.unitRef === m.unit);
      const carrier = p.spyAssignments.some((s) => s.active && s.heroId === m.unit);
      return (carrier ? 100 : 0) + (u ? u.dmg : 0);
    }
    default: return 1;
  }
}

// ---------------------------------------------------------------------------
// Pendings
// ---------------------------------------------------------------------------

function decidePending(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, me, lean } = ctx;
  const pend = state.pending!;
  switch (pend.kind) {
    case 'battle_commit': case 'counter_target': case 'extra_selection': case 'initiative_tie':
    case 'battle_defense': case 'retreat': case 'rally_selection':
      return rank(pool.map((m) => opt(m, battleScore(ctx, m))));
    case 'report_draw': case 'upkeep_reallocate_cores': case 'choose_milestone_hero':
    case 'overlay_choice': case 'place_reserved_hero': case 'choose_spy': case 'smyth_reward': case 'dowser_collector':
      return rank(pool.map((m) => {
        const after = tryAndSettle(ctx, state, state, m);
        return opt(m, after ? chanceSelf(state, after, me, lean) : -1);
      }));
    case 'treaty_response':
      // A bad deal (see badDeal) is declined whatever the read says.
      return rank(pool.map((m) => {
        const after = tryMove(state, me, m);
        if (!after) return opt(m, -1);
        const accept = m.type === 'respond_treaty' && m.accept;
        if (accept && (badDeal(ctx, pend.proposerId, pend.treatyType) || recentlySplit(ctx, pend.proposerId))) return opt(m, -0.5);
        return opt(m, chanceAll(after, me, lean) + tieBreak(m));
      }));
    case 'treaty_break_decision':
      return decideBreaks(ctx, pool);
    case 'access_request': case 'elara_spell':
      return rank(pool.map((m) => {
        const after = tryMove(state, me, m);
        return opt(m, after ? chanceAll(after, me, lean) + tieBreak(m) : -1);
      }));
    case 'second_purchase':
      return decideSpend(ctx, pool);
    case 'choose_leader':
      return rank(pool.map((m) => opt(m, m.type === 'choose_leader' ? leaderValue(state, ctx.p, m.hero, lean?.startsWith('commit:') ? undefined : lean as NGGStrategy | undefined) : 0)));
    case 'choose_starting_location':
      return rank(pool.map((m) => opt(m, m.type === 'choose_starting_location' ? startValue(state, ctx.p, m.location) : 0)));
    default:
      return rank(pool.map((m) => opt(m, 1)));
  }
}

/** Small preferences between otherwise equal answers. */
function tieBreak(m: NGGMove): number {
  if (m.type === 'respond_access_request') return m.grant ? 0 : 0.0005; // don't feed a rival for nothing
  if (m.type === 'cast_elara_spell') return m.skip ? 0.0005 : 0;
  if (m.type === 'skip_action') return 0.0002;
  return 0;
}

// ---------------------------------------------------------------------------
// Spending (Build / Research, and a second purchase)
// ---------------------------------------------------------------------------

/** The purchases on offer, one per distinct thing (payments differ only in
 *  which collectors pay; the menu's payment is the engine's own search). */
function dedupe(pool: NGGMove[]): NGGMove[] {
  const seen = new Set<string>();
  const out: NGGMove[] = [];
  for (const m of pool) {
    const key = m.type === 'build' ? `b|${m.item}|${m.at_base ?? ''}|${m.core_pairing ?? ''}`
      : m.type === 'research' ? `r|${m.kind}|${m.kind === 'tech' ? m.tech : ''}`
      : JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key); out.push(m);
  }
  return out;
}

function decideSpend(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, me, lean } = ctx;
  const out: Option[] = [];
  for (const m of dedupe(pool)) {
    if (m.type === 'economic_victory_spend') { out.push(opt(m, 2)); continue; }
    if (m.type === 'form_treaty' || m.type === 'break_treaty') continue;
    const after = tryAndSettle(ctx, state, state, m);
    if (!after) continue;
    let s = chanceSelf(state, after, me, lean);
    // Collectors not spent this round are lost: an even purchase beats a skip.
    if (m.type === 'skip_action') s -= 1e-6;
    else if (m.type === 'research' && m.kind === 'battle_card') s += battleCardValue(ctx);
    out.push(opt(m, s));
  }
  if (out.length === 0) return rank(pool.map((m) => opt(m, m.type === 'skip_action' ? 1 : 0)));
  return rank(out);
}

/** A battle card is worth buying only when a fight is coming: an enemy able
 *  to strike my Leader soon, or my own Leader-kill plan by force. */
function battleCardValue(ctx: Ctx): number {
  const { state, p } = ctx;
  if (p.hand.length >= 3) return -0.001;
  const threat = threatTo(state, p);
  const mine = readTable(state, ctx.me, ctx.lean).bySeat.get(ctx.me);
  const fighting = threat.eta <= 3 || (mine?.military.line === 'damage' && mine.military.eta <= 4);
  return fighting ? 0.004 : -0.001;
}

// ---------------------------------------------------------------------------
// The action phase: the card on top of the stack is mine
// ---------------------------------------------------------------------------

function decideAction(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state } = ctx;
  const action = state.activeAction!;
  // Treaty offers ride the start and end of my action.
  const offers = pool.filter((m) => m.type === 'form_treaty');
  const offer = offers.length ? bestTreatyOffer(ctx, offers) : null;
  if (offer) return [offer, ...rank(pool.filter((m) => m !== offer.move).map((m) => opt(m, 0)))];
  if (action.endWindow) return rank(pool.map((m) => opt(m, m.type === 'skip_action' ? 1 : 0)));
  const rest = pool.filter((m) => m.type !== 'form_treaty' && m.type !== 'break_treaty');
  if (action.cardKind === 'move_battle') return decideMovement(ctx, rest);
  return decideSpend(ctx, rest);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function occupiedByOthers(state: NGGState, me: string, to: Coord): boolean {
  return state.units.some((u) => u.coord === to && u.ownerId !== me)
    || state.heroes.some((h) => h.coord === to && h.ownerId !== me && !h.dead)
    || state.placements.some((c) => c.coord === to && c.ownerId !== me)
    || state.bases.some((b) => b.coord === to && b.ownerId !== me);
}

/** How many quiet moves get the full reading; the rest are ranked out by a
 *  quick look first (big maps offer dozens). */
const QUIET_MOVES_READ = 6;

/** A quick look at a quiet move: does it bring a piece nearer the Leader I
 *  mean to kill, open tiles my collectors couldn't reach, or walk my own
 *  Leader out? New ground is credited to cheap pieces and other heroes,
 *  not the Leader (designer's note, 2026-09-26: send smaller units out to
 *  expand reach; the Leader stays where it is guarded). */
function quickMoveLook(ctx: Ctx, m: Extract<NGGMove, { type: 'move_units' }>): number {
  const { state, me } = ctx;
  let s = 0;
  const mine = readTable(state, me, ctx.lean).bySeat.get(me);
  const target = mine?.military.targetCoord;
  if (target) {
    const d = distancesFrom(state, [target]);
    s += 2 * ((d.get(m.from) ?? 9) - (d.get(m.to) ?? 9));
  }
  // The seat closest to winning: a step toward its Leader is worth a full
  // reading too, whether or not it is my easiest kill (see ai-eval.ts
  // STOP_SHARE). My own Leader is not sent.
  const lead = STOP_SHARE > 0 ? leaderAgainst(state, me, readTable(state, me, ctx.lean).seats) : null;
  const leadLeader = lead ? leaderOf(state, lead.playerId) : null;
  const myLeader = leaderOf(state, me);
  if (STOP_SHARE > 0 && leadLeader?.coord && leadLeader.coord !== target && !(myLeader && m.units.includes(myLeader.id))) {
    const d = distancesFrom(state, [leadLeader.coord]);
    s += 2 * ((d.get(m.from) ?? 9) - (d.get(m.to) ?? 9));
  }
  // New anchor ground: tiles on or next to the destination that nothing of
  // mine anchors today.
  const anchored = new Set<string>();
  const mark = (c: string) => { anchored.add(c); const [x, y] = c.split(',').map(Number); for (const t of neighborsOf(state.tiles, x!, y!)) anchored.add(coordKey(t.c, t.r)); };
  for (const h of state.heroes) if (h.ownerId === me && !h.dead && h.coord && !m.units.includes(h.id)) mark(h.coord);
  for (const u of state.units) if (u.ownerId === me && !m.units.includes(u.id)) mark(u.coord);
  for (const b of state.bases) if (b.ownerId === me) mark(b.coord);
  const leader = leaderOf(state, me);
  const movesLeader = !!leader && m.units.includes(leader.id);
  const [tx, ty] = m.to.split(',').map(Number);
  if (!movesLeader) {
    for (const c of [m.to, ...neighborsOf(state.tiles, tx!, ty!).map((t) => coordKey(t.c, t.r))]) if (!anchored.has(c)) s += 1;
  } else {
    const threat = threatTo(state, ctx.p);
    s -= threat.eta <= 3 ? 3 : 1;
  }
  // Contest: when a rival's spend is close, a piece on a scarce tile it needs
  // (oil, ether, ore — two, two and seven of them) is worth a full reading.
  const table = readTable(state, me, ctx.lean);
  const rival = table.seats.filter((x) => x.playerId !== me && x.alive).sort((a, b) => a.race.byPath.economic - b.race.byPath.economic)[0];
  if (rival && rival.race.byPath.economic <= 6) {
    const res = state.tiles.find((t) => coordKey(t.c, t.r) === m.to)?.resource;
    if (res === 'oil' || res === 'ether') s += 3;
    else if (res === 'ore') s += 2;
  }
  return s;
}

function decideMovement(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, me, lean } = ctx;
  const base = chanceAll(state, me, lean);
  const out: Option[] = [];
  // Quiet moves: keep the most promising few for the full reading.
  const quiet = pool.filter((m): m is Extract<NGGMove, { type: 'move_units' }> => m.type === 'move_units' && !occupiedByOthers(state, me, m.to));
  const keep = new Set(quiet.map((m) => ({ m, s: quickMoveLook(ctx, m) }))
    .sort((a, b) => b.s - a.s).slice(0, QUIET_MOVES_READ).map((x) => x.m));
  // Everything but my Leader always gets the full reading: it is how a
  // strike leaves home (see below).
  for (const m of quiet) if (allButLeader(state, me, m)) keep.add(m);
  // So does my Leader stepping back onto one of my bases: the quick look
  // ranks moves by what they gain, and a retreat gains only safety, so it
  // never made the shortlist. A Chronicler one step from home with an
  // Enchantress, an Evoker and an Enchantress next door stayed out and died
  // (Zeke's game, 2026-10-01), though the read rated going home well above
  // staying (chance 0.21 → 0.36).
  const myLeader = leaderOf(state, me);
  for (const m of quiet) if (myLeader && m.units.includes(myLeader.id) && state.bases.some((b) => b.ownerId === me && b.coord === m.to)) keep.add(m);
  for (const m of pool) {
    if (m.type === 'move_units' && quiet.includes(m) && !keep.has(m)) continue;
    if (m.type === 'skip_action') { out.push(opt(m, base + 1e-4)); continue; }
    if (m.type === 'cast_elara_spell') {
      const after = tryMove(state, me, m);
      out.push(opt(m, after ? chanceAll(after, me, lean) + (m.skip ? 1e-4 : 0) : -1));
      continue;
    }
    if (m.type !== 'move_units') { out.push(opt(m, -1)); continue; }
    // A stack of pieces moves as one piece or as the whole stack; the mixes
    // in between rarely differ and are not worth trying one by one.
    const stack = state.heroes.filter((h) => h.ownerId === me && !h.dead && h.coord === m.from).length
      + state.units.filter((u) => u.ownerId === me && u.coord === m.from).length;
    if (m.units.length > 1 && m.units.length < stack && !allButLeader(state, me, m)) continue;
    if (occupiedByOthers(state, me, m.to)) { out.push(opt(m, attackValue(ctx, m, base))); continue; }
    const after = tryMove(state, me, m);
    if (!after) continue;
    if (leaderWalksIntoReach(ctx, after, m)) { out.push(opt(m, -1)); continue; }
    // A quiet move must earn its keep: at least a small real gain over
    // staying. Every seat is read fresh: a piece of mine standing on a tile a
    // rival's spend needs lengthens THEIR clock, not mine.
    out.push(opt(m, chanceAll(after, me, lean) - 0.002 - 0.0005 * m.units.length));
  }
  return rank(out);
}

/** The stack on a tile minus my Leader: the group a strike sets out as,
 *  since the Leader stays home. The planner used to try one piece or the
 *  whole stack only, and the whole stack includes the Leader — so a strike
 *  that needed two pieces together never left the base (2026-10-08). */
function allButLeader(state: NGGState, me: string, m: Extract<NGGMove, { type: 'move_units' }>): boolean {
  const leader = leaderOf(state, me);
  if (!leader || leader.coord !== m.from || m.units.includes(leader.id) || m.units.length < 2) return false;
  const stack = state.heroes.filter((h) => h.ownerId === me && !h.dead && h.coord === m.from).length
    + state.units.filter((u) => u.ownerId === me && u.coord === m.from).length;
  return m.units.length === stack - 1;
}

/** A rival that could kill my Leader within this many rounds is dangerous. */
const LEADER_DANGER_ROUNDS = 3;
/** Steps from a dangerous rival's pieces my Leader will not walk alone into. */
const LEADER_KEEP_AWAY_STEPS = 3;

/** Does this move walk my Leader alone — no other hero or fighting unit in
 *  the moving group — toward a rival that could kill it soon, ending within
 *  LEADER_KEEP_AWAY_STEPS of that rival's pieces? The chance read cannot see
 *  this on its own: walking toward a rival shortens my kill clock on them by
 *  as much as theirs on me, and a rival whose clock is set by buying its spy
 *  reads the same danger wherever my Leader stands. Seen in the 2026-09-30
 *  head-to-head: a Foreman Leader carrying the seat's spy walked four rounds
 *  toward a Marshal + Rook and died. The designer's note (2026-09-26): the
 *  Leader stays where it is guarded; cheaper pieces go out. */
function leaderWalksIntoReach(ctx: Ctx, after: NGGState, m: Extract<NGGMove, { type: 'move_units' }>): boolean {
  const { state, me } = ctx;
  const leader = leaderOf(state, me);
  if (!leader?.coord || !m.units.includes(leader.id)) return false;
  const escorted = m.units.some((id) => id !== leader.id && (
    state.heroes.some((h) => h.id === id && h.ownerId === me && !h.dead)
    || state.units.some((u) => u.id === id && (unitById(u.typeId)?.dmg ?? 0) > 0)));
  if (escorted) return false;
  // Home is where it is guarded: stepping onto one of my bases is fine.
  if (state.bases.some((b) => b.ownerId === me && b.coord === m.to)) return false;
  // The same reads the position check makes on `after` (readTable caches
  // them per state), so this costs nothing extra.
  const table = readTable(after, me, ctx.lean);
  for (const q of after.players) {
    if (q.playerId === me || !q.species) continue;
    const soon = table.bySeat.get(q.playerId)?.military.byTarget[me];
    if (soon === undefined || soon > LEADER_DANGER_ROUNDS) continue;
    const theirs = [
      ...after.heroes.filter((h) => h.ownerId === q.playerId && !h.dead && h.coord).map((h) => h.coord!),
      ...after.units.filter((u) => u.ownerId === q.playerId && (unitById(u.typeId)?.dmg ?? 0) > 0 && !unitById(u.typeId)?.immobile).map((u) => u.coord),
    ];
    if (theirs.length === 0) continue;
    const d = distancesFrom(after, theirs);
    const before = d.get(leader.coord) ?? 99; const now = d.get(m.to) ?? 99;
    if (now < before && now <= LEADER_KEEP_AWAY_STEPS) return true;
  }
  return false;
}

/** Entering an opposing space: a sweep (no combat pieces there) is applied and
 *  read directly; a battle is judged by whether it can kill a Leader. */
function attackValue(ctx: Ctx, m: Extract<NGGMove, { type: 'move_units' }>, base: number): number {
  const { state, me, lean, p } = ctx;
  const after = tryMove(state, me, m);
  if (!after) return -1;
  if (!after.battle) return chanceAll(after, me, lean) - 0.001; // a sweep, resolved
  const b = after.battle;
  const enemyLeader = b.units.find((u) => u.ownerId !== me && state.heroes.some((h) => h.id === u.unitRef && h.isLeader && !h.dead));
  if (!enemyLeader) return base - 0.05; // a fight that can't win the game: stay out
  const carrier = p.spyAssignments.find((s) => s.active && m.units.includes(s.heroId));
  const spyArmed = !!carrier && (carrier.source === 'infiltrator' || p.research.includes('invisible'));
  const owner = byId(state, enemyLeader.ownerId);
  const guarded = owner.spyAssignments.some((s) => s.active && s.source === 'illusionist');
  const myUnits = b.units.filter((u) => u.ownerId === me);
  // Rook and Kestrel give +2 damage to the OTHER allied units, not themselves.
  // Would the fight itself kill that Leader? The engine plays the battle out
  // (ai-strike.ts): every bonus, spell, Self Destruct and defence counts.
  const hitsLeader = attackKillsLeader(after, me, enemyLeader.ownerId);
  // Their own armed spy on a hero at least as quick strikes my carrier first
  // (defenders win ties): my attack is spent on a Decoy, or my hero dies.
  const carrierUnit = carrier ? b.units.find((u) => u.unitRef === carrier.heroId) : undefined;
  const quickest = carrierUnit?.init ?? Math.max(...myUnits.map((u) => u.init));
  const struckFirst = strikesFirst(state, owner.playerId, m.to, quickest);
  const myLeaderGoes = m.units.some((id) => state.heroes.some((h) => h.id === id && h.isLeader));
  if (struckFirst && myLeaderGoes && !p.spyAssignments.some((s) => s.active && s.source === 'illusionist')) return base - 0.3;
  // A Decoy reveal is public. If this Leader has dodged with a Decoy in two
  // of the last three rounds, its owner keeps a spy on it and rebuys one each
  // time: attacking again only trades spies, and two seats doing that forever
  // freeze both economies (balance run 2026-09-24: a robot's Spy Attack and a
  // wizard's Decoy repeated to round 280). Stop until that changes.
  const leaderLabel = HEROES.find((h) => h.id === enemyLeader.unitRef)?.name ?? enemyLeader.label;
  const decoyRounds = new Set(state.log.filter((e) => e.turn >= state.round - 3 && e.actor === owner.playerId
    && e.category === 'battle' && e.summary.includes('revealed as a Decoy') && e.summary.includes(leaderLabel)).map((e) => e.turn));
  const decoyKeeps = decoyRounds.size >= 2;
  // Their first strike (an armed spy on a hero at least as quick) takes one
  // hero of my stack before my carrier acts. My carrier is hidden among my
  // heroes, so a bigger stack gets through more often; alone it never does.
  const myHeroesGoing = m.units.filter((id) => state.heroes.some((h) => h.id === id && h.ownerId === me && !h.dead)).length;
  let pKill = 0;
  if (spyArmed) {
    if (decoyKeeps) pKill = 0;
    else if (struckFirst) pKill = myHeroesGoing >= 2 ? 0.85 * (1 - 1 / myHeroesGoing) : 0;
    else pKill = guarded ? 0.15 : 0.85;
  } else if (hitsLeader) pKill = struckFirst ? 0.2 : 0.55;
  // A fortified tile: each defender that strikes before my carrier and hard
  // enough kills one body of my stack before the reveal. The carrier is
  // hidden, so a bigger stack is the answer (the arms race): with as many
  // escorts as killers the carrier probably lives; alone it surely dies.
  if (spyArmed && carrierUnit) {
    const killers = counterKillers(state, owner.playerId, m.to, { init: carrierUnit.init, def: carrierUnit.def });
    if (killers > 0) pKill *= Math.max(0, 1 - killers / myUnits.length);
  }
  if (pKill === 0) return base - 0.05;
  // If it lands: the kill, read as a dead Leader on the board.
  const killed: NGGState = { ...state, heroes: state.heroes.map((h) => h.id === enemyLeader.unitRef ? { ...h, dead: true } : h), log: [] };
  const killedP = { ...byId(state, me), leaderKills: byId(state, me).leaderKills + 1 };
  const killedState: NGGState = { ...killed, players: killed.players.map((x) => x.playerId === me ? killedP : x) };
  const win = chanceAll(killedState, me, lean);
  const winNow = killedP.leaderKills >= killsNeeded(state) ? 1 : win;
  return pKill * winNow + (1 - pKill) * (base - 0.02);
}

function killsNeeded(state: NGGState): number {
  return militaryThreshold(state.players.length);
}

// ---------------------------------------------------------------------------
// Planning: which card to lay down now
// ---------------------------------------------------------------------------

interface RoundPlan { research: number; build: number; move: number }

const PLAN_CACHE = new Map<string, RoundPlan>();

function decidePlanning(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, p } = ctx;
  // Keyed on the position as it stands at planning (facts that change only
  // between rounds), not only the seed and round: two games that share a
  // seed (tests, replays) must not hand each other a plan (2026-09-26).
  const key = `${state.seed}|${state.round}|${ctx.me}|${ctx.hard ? 'h' : 'm'}|${ctx.lean ?? ''}|${p.actionCards.build}${p.actionCards.research}${p.actionCards.moveBattle}|${p.culture}|${state.units.length}|${state.heroes.length}|${Object.keys(p.collectorsAvailable).length}|${state.players.map((x) => x.factionId ?? '').join(',')}|${state.heroes.map((h) => h.id).join(',')}`;
  let plan = PLAN_CACHE.get(key);
  if (!plan) {
    plan = roundPlan(ctx);
    if (PLAN_CACHE.size > 5000) PLAN_CACHE.clear();
    PLAN_CACHE.set(key, plan);
  }
  const placed = (kind: string) => p.actionCardsPlayed.filter((s) => s.startsWith(`${kind}:`)).length;
  // Laid down in the reverse of the order they should resolve.
  const want: Array<'research' | 'build' | 'move_battle'> = [];
  for (let i = 0; i < plan.research; i++) want.push('research');
  for (let i = 0; i < plan.build; i++) want.push('build');
  for (let i = 0; i < plan.move; i++) want.push('move_battle');
  const counts: Record<string, number> = { research: 0, build: 0, move_battle: 0 };
  let next: string | null = null;
  for (const k of want) {
    counts[k]!++;
    if (placed(k) < counts[k]!) { next = k; break; }
  }
  // Go last (the designer's games, 2026-10-07; the tech-rush bot does it):
  // the stack resolves last card first, so while any other seat is still
  // planning, lay a spare card — one of a kind this round's plan does not use
  // at all — and keep the planned ones for later, so they resolve first. A
  // spare card that flips is decided then (used if it helps, else declined).
  // Before this the AI laid its plan at once and passed, and a rival who held
  // cards back resolved first: the tech rush finished its win in the round
  // the AI's strike stood next door.
  const othersPlanning = state.planningOrder.some((pid) => pid !== ctx.me);
  const spare = othersPlanning
    ? (['move_battle', 'research', 'build'] as const).find((k) => (k === 'move_battle' ? plan.move : k === 'research' ? plan.research : plan.build) === 0
      && pool.some((m) => m.type === 'plan_action' && m.card === k))
    : undefined;
  if (spare) next = spare;
  const options = pool.map((m) => {
    if (m.type !== 'plan_action') return opt(m, -1);
    if (m.card === 'pass') return opt(m, next ? 0 : 1);
    return opt(m, m.card === next ? 2 : 0);
  });
  return rank(options);
}

/** What this round is worth doing, card by card, tried on probes of the
 *  position: the best purchase for each Build card, the best research after
 *  them, and the best move. A card goes down only if its use beats doing
 *  nothing. */
function roundPlan(ctx: Ctx): RoundPlan {
  const { state, me, p } = ctx;
  const plan: RoundPlan = { research: 0, build: 0, move: 0 };
  // Move/Battle resolves first: judge it on the position as it stands.
  const moveProbe = probeState(state, me, 'move_battle');
  const moves = decideMovement({ ...ctx, state: moveProbe }, legalOn(moveProbe, me));
  const bestMove = moves[0];
  let s: NGGState = state;
  if (bestMove && bestMove.move.type !== 'skip_action' && bestMove.score > -0.5) {
    const moveCards = Math.min(p.actionCards.moveBattle, 3);
    plan.move = 1;
    const moved = tryMove(moveProbe, me, bestMove.move);
    // A second Move/Battle card (Marshal) is worth laying when the next step
    // also pays (a walk toward a target).
    if (moved && moveCards > 1 && !moved.battle) {
      const again = decideMovement({ ...ctx, state: probeState({ ...moved, phase: state.phase }, me, 'move_battle') }, legalOn(probeState(moved, me, 'move_battle'), me))[0];
      if (again && again.move.type !== 'skip_action') plan.move = 2;
    }
    if (moved && !moved.battle) s = { ...moved, phase: state.phase, activeAction: null, actionStack: [] };
  }
  // Builds, one card at a time, each on the position the last one left.
  for (let i = 0; i < Math.min(p.actionCards.build, 3); i++) {
    const probe = probeState(s, me, 'build');
    const ranked = decideSpend({ ...ctx, state: probe }, legalOn(probe, me));
    const top = ranked[0];
    if (!top || top.move.type === 'skip_action') break;
    plan.build++;
    const after = tryMove(probe, me, top.move);
    if (!after) break;
    // Foreman's second purchase rides the same card.
    let next = after;
    if (after.pending?.kind === 'second_purchase' && after.pending.forPlayerId === me) {
      const second = decideSpend({ ...ctx, state: after }, legalOn(after, me))[0];
      const a2 = second && second.move.type !== 'skip_action' ? tryMove(after, me, second.move) : null;
      if (a2) next = a2;
    }
    s = { ...next, pending: null, phase: state.phase, activeAction: null, actionStack: [] };
  }
  // Research last, with what the Builds left over.
  for (let i = 0; i < Math.min(p.actionCards.research, 3); i++) {
    const probe = probeState(s, me, 'research');
    const ranked = decideSpend({ ...ctx, state: probe }, legalOn(probe, me));
    const top = ranked[0];
    if (!top || top.move.type === 'skip_action') break;
    plan.research++;
    const after = tryMove(probe, me, top.move);
    if (!after) break;
    s = { ...after, pending: null, phase: state.phase, activeAction: null, actionStack: [] };
  }
  return plan;
}

function legalOn(state: NGGState, me: string): NGGMove[] {
  const p = byId(state, me);
  try {
    return getLegalMoves(state, me).map((l) => completeMove(state, p, l.move)).filter((m): m is NGGMove => m !== null);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Treaties
// ---------------------------------------------------------------------------

/** Rounds by which a treaty partner must be ahead before a treaty is a bad
 *  deal to offer or accept, and the wider margin before an existing one is
 *  broken. Breaking needs more than forming: with the same margin both ways
 *  the lead flipped round to round and pairs broke and re-formed constantly
 *  (first measured batch: about half of 1,631 breaks re-formed within two
 *  rounds at five players). */
const AHEAD_ROUNDS = 1;
const BREAK_AHEAD_ROUNDS = 2;

/** Is `other` pulling ahead of me by `margin` rounds — finishing sooner on
 *  its best path (any goal), and at least as soon as anyone else? */
function pullingAhead(ctx: Ctx, other: string, margin = AHEAD_ROUNDS): boolean {
  const { state, me, lean } = ctx;
  const table = readTable(state, me, lean);
  const mine = table.bySeat.get(me);
  const theirs = table.bySeat.get(other);
  if (!mine || !theirs || !theirs.alive) return false;
  if (theirs.eta > mine.eta - margin) return false;
  const bestOther = Math.min(...table.seats.filter((s) => s.playerId !== me && s.alive).map((s) => s.eta));
  return theirs.eta <= bestOther + 0.5;
}

/** Am I pulling ahead of `other` by `margin` rounds — finishing sooner than
 *  it, and at least as soon as anyone at the table? */
function aheadOf(ctx: Ctx, other: string, margin = AHEAD_ROUNDS): boolean {
  const { state, me, lean } = ctx;
  const table = readTable(state, me, lean);
  const mine = table.bySeat.get(me);
  const theirs = table.bySeat.get(other);
  if (!mine || !theirs || !mine.alive) return false;
  if (mine.eta > theirs.eta - margin) return false;
  const best = Math.min(...table.seats.filter((s) => s.alive).map((s) => s.eta));
  return mine.eta <= best + 0.5;
}

/** Did `other` and I split (either of us broke a treaty with the other) in
 *  the last two rounds? A split pair does not re-form at once. */
function recentlySplit(ctx: Ctx, other: string): boolean {
  const { state, me } = ctx;
  return state.log.some((e) => e.turn >= state.round - 2 && e.category === 'treaty'
    && ((e.summary.startsWith(`${me} breaks `) && e.summary.endsWith(` with ${other}`))
      || (e.summary.startsWith(`${other} breaks `) && e.summary.endsWith(` with ${me}`))));
}

function isCultureTreaty(name: string): boolean {
  return name.toLowerCase().includes('culture');
}

/** A treaty that is a bad deal for me (designer's playtest note, 2026-09-26):
 *  a Culture Treaty shares the win, so it is a bad deal only when I am the
 *  one pulling ahead — it would hand half my win to a partner who is behind.
 *  Every other treaty shares nothing, so it is a bad deal when the PARTNER
 *  is pulling ahead — the income or access is feeding the seat most likely
 *  to beat me. Such a treaty is not offered, not accepted, and is broken at
 *  the first legal window. */
function badDeal(ctx: Ctx, other: string, treatyName: string, margin = AHEAD_ROUNDS): boolean {
  return isCultureTreaty(treatyName) ? aheadOf(ctx, other, margin) : pullingAhead(ctx, other, margin);
}

/** The best treaty worth offering now: it must raise my chance, and the
 *  partner must have a reason to accept (it raises theirs too). Never repeat
 *  an offer a partner turned down in the last two rounds, and never offer to
 *  a seat that is already pulling ahead. */
function bestTreatyOffer(ctx: Ctx, offers: NGGMove[]): Option | null {
  const { state, me, lean } = ctx;
  const base = chanceAll(state, me, lean);
  let best: Option | null = null;
  for (const m of offers) {
    if (m.type !== 'form_treaty') continue;
    if (badDeal(ctx, m.partner, m.treaty_type) || recentlySplit(ctx, m.partner)) continue;
    const refused = state.log.some((e) => e.turn >= state.round - 1 && e.actor === m.partner
      && e.category === 'treaty' && e.summary.startsWith(`${m.partner} declines `) && e.summary.endsWith(` from ${me}`));
    if (refused) continue;
    const formed = withTreaty(state, me, m.partner, m.treaty_type);
    if (!formed) continue;
    const mine = chanceAll(formed, me, lean) - base;
    const theirs = chanceAll(formed, m.partner) - chanceAll(state, m.partner);
    if (mine <= 0.003 || theirs <= 0) continue;
    const s = 10 + mine;
    if (!best || s > best.score) best = opt(m, s);
  }
  return best;
}

/** The position with a treaty formed (for judging an offer before making it). */
function withTreaty(state: NGGState, a: string, b: string, treatyName: string): NGGState | null {
  const t = treatyName.toLowerCase().replace(/\s+/g, '-');
  const known = ['open-borders', 'shared-resources', 'peace', 'culture-treaty', 'shared-tactics'];
  if (!known.includes(t)) return null;
  return { ...state, treaties: [...state.treaties, { type: t as NGGState['treaties'][number]['type'], partners: [a, b] }], log: [] };
}

/** A bad deal (see badDeal) is broken outright, above any reading of the
 *  position: the read alone never breaks, since the treaty's income shows up
 *  on my own clock too (2026-09-26: 1,598 treaties formed in a batch, none
 *  broken). */
const BAD_DEAL_BREAK = 2;

function decideBreaks(ctx: Ctx, pool: NGGMove[]): Option[] {
  const { state, me, lean } = ctx;
  return rank(pool.map((m) => {
    if (m.type === 'skip_action') return opt(m, chanceAll(state, me, lean) + 0.01);
    const after = tryMove(state, me, m);
    if (!after) return opt(m, -1);
    if (m.type === 'break_treaty' && badDeal(ctx, m.partner, m.treaty_type, BREAK_AHEAD_ROUNDS)) return opt(m, BAD_DEAL_BREAK);
    return opt(m, chanceAll(after, me, lean));
  }));
}

// ---------------------------------------------------------------------------
// Setup: Leader and starting location
// ---------------------------------------------------------------------------

/** A Leader's worth before the map is set: the seat's economy on printed
 *  costs with the hero's effect applied, as rounds to a win, plus how hard
 *  the Leader is to kill (a military Leader has 6 defence, not 5). */
function leaderValue(state: NGGState, p: PlayerState, heroName: string, lean: NGGStrategy | undefined): number {
  const hero = HEROES.find((h) => h.name.toLowerCase() === heroName.toLowerCase() || h.id === heroName.toLowerCase());
  if (!hero || !p.species) return 0;
  const e = synthEcon(p.species, state.players.length, state);
  e.heroPool = e.heroPool.filter((id) => id !== hero.id);
  applyHero(e, hero.id);
  const race = raceOf(e);
  let eta = lean && lean !== 'military' ? race.byPath[lean] : race.eta;
  if (lean === 'military') eta = hero.category === 'military' || hero.category === 'evo-angel' ? 5 : 8;
  let s = -eta;
  if (hero.category === 'military' || hero.category === 'evo-angel') s += 0.3; // sturdier Leader
  if (['rook', 'kestrel'].includes(hero.id)) s += 0.4; // opens the damage line on Leaders
  return s;
}

/** A starting economy for a species on printed costs (no map yet). */
function synthEcon(species: Species, playerCount: number, state: NGGState): Econ {
  const typed = { water: species === 'robot' ? 2 : 0, wood: species === 'robot' ? 2 : 0, ore: 0, oil: 0, ether: 0 };
  // Robots start with four Cores installed (ruling #85): supply minus four.
  return {
    species, culture: 0, cultureTarget: cultureTargetFor(playerCount), economicTarget: economicCollectorsNeeded(state),
    collectorCaps: Object.fromEntries(unitsForSpecies(species).filter((u) => u.collector).map((u) => [u.id, collectorCapFor(state, u)])),
    otherIncome: 0, subjects: 0, coresReserve: 0, coresSupply: species === 'robot' ? coreSupplyFor(state) - 4 : coreSupplyFor(state),
    surfs: species === 'wizard' ? 3 : 0, typed, // three starting Surfs (ruling #100)
    tileCap: { water: 4, wood: 4, ore: 4, oil: 2, ether: 2 }, profiles: {}, profileKey: 'synthetic',
    owned: species === 'wizard' ? { surf: 3, castle: 1 } : { 'water-collector': 2, 'wood-collector': 2, core: 4, home: 1 },
    buildings: new Set(), research: new Set(), types: new Set(species === 'wizard' ? ['surf', 'castle'] : ['core', 'water-collector', 'wood-collector', 'home']),
    techBonus: 0, buildSlots: 1, researchSlots: 1, foreman: false, kettering: false,
    treatyPotential: 2.5, hasUnlock: false, partnerUnlock: false,
    // Milestone claims to come: the public pool as it stands at the draft.
    milestonesLeft: milestonesFor(playerCount),
    heroPool: heroesEligibleFor(species).map((h) => h.id).filter((id) => (state.heroPool ?? []).includes(id)),
    heroRoom: MAX_HEROES_PER_PLAYER - 1,
  };
}

/** A starting tile's worth: the seat's economy from there (its base and
 *  Leader placed), minus closeness to another seat's base. */
function startValue(state: NGGState, p: PlayerState, location: string): number {
  const tile = state.tiles.find((t) => `@${t.start}` === location);
  if (!tile) return -99;
  const coord = `${tile.c},${tile.r}`;
  const bases = [...state.bases, { id: `probe-${p.playerId}`, ownerId: p.playerId, coord }];
  const heroes = state.heroes.map((h) => h.ownerId === p.playerId && h.isLeader ? { ...h, coord } : h);
  const probe: NGGState = { ...state, bases, heroes, log: [] };
  const seat = { ...p };
  if (seat.species === 'robot' && Object.keys(seat.collectorsAvailable).length === 0) {
    seat.collectorsAvailable = { 'water-collector-1': 1, 'water-collector-2': 1, 'wood-collector-1': 1, 'wood-collector-2': 1 };
  }
  let e: Econ;
  try { e = econFromState({ ...probe, players: probe.players.map((x) => x.playerId === p.playerId ? seat : x) }, seat); } catch { return 0; }
  const eta = raceOf(e).eta;
  const others = state.bases.filter((b) => b.ownerId !== p.playerId).map((b) => b.coord);
  const d = others.length ? (distancesFrom(state, others).get(coord) ?? 9) : 9;
  return -eta + Math.min(d, 5) * 0.15;
}

/** The AI's Leader pick at setup (engine's all-AI auto-setup and AI seats):
 *  a scripted pick first (balance sweeps pin Leaders), else the best Leader
 *  by leaderValue. */
export function aiPickLeaderId(state: NGGState, p: PlayerState, eligibleIds: string[], strategy?: string): string {
  const lean = parseStrategy(strategy);
  let best = eligibleIds[0]!; let bestScore = -Infinity;
  for (const id of eligibleIds) {
    const h = HEROES.find((x) => x.id === id);
    if (!h) continue;
    const s = leaderValue(state, p, h.name, lean);
    if (s > bestScore) { best = id; bestScore = s; }
  }
  return best;
}

/** The AI's starting-location pick: the start its economy runs best from. */
export function aiPickLocationId(state: NGGState, p: PlayerState, startCoords: Coord[], _strategy?: string): Coord {
  let best = startCoords[0]!; let bestScore = -Infinity;
  for (const coord of startCoords) {
    const t = state.tiles.find((x) => `${x.c},${x.r}` === coord);
    if (!t) continue;
    const s = startValue(state, p, `@${t.start}`);
    if (s > bestScore) { best = coord; bestScore = s; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function narrationFor(move: NGGMove): string {
  switch (move.type) {
    case 'plan_action': return move.card === 'pass' ? 'passes planning' : `plans ${move.card}`;
    case 'build': return `builds ${move.item}`;
    case 'economic_victory_spend': return 'commits collectors across half the map for the Economic victory';
    case 'research': return move.kind === 'tech' ? `researches ${move.tech}` : 'buys a battle strategy card';
    case 'move_units': return `moves units from ${move.from} to ${move.to}`;
    case 'commit_battle_card': return move.card ? 'commits a battle card' : 'commits no battle card';
    case 'battle_activation': return `activates ${move.unit}`;
    case 'choose_retreat': return move.stay || move.destination === null ? 'stays in the battle' : `retreats toward ${move.destination}`;
    case 'form_treaty': return `offers ${move.treaty_type} to ${move.partner}`;
    case 'break_treaty': return `breaks ${move.treaty_type}`;
    case 'choose_milestone_hero': return `claims ${move.hero}`;
    case 'resolve_report': return 'presses Draw';
    default: return move.type;
  }
}

