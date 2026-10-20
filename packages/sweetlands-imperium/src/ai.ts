// Sweetlands Imperium — AI (skill ladder + strategy archetypes).
//
// Three tiers via getAIMove(state, playerId, difficulty?, strategy?):
//   easy   = uniform-random over the legal set (seeded; a true floor)
//   medium = the baseline color->unit heuristic (the authored default), plus two
//            generic use-your-actions rules (no objective awareness): spend
//            leftover influence on Intel tokens; Green-unlock to dump a big hand
//   hard   = objective-aware: actively COMPLETES owned secret objectives (trash 5
//            influence / discard 5 sugar = 2 free points each — the lever medium
//            lacks), prioritizes captures + castle, then the medium policy.
//
// Strategy archetypes (orthogonal to skill) are derived from the scoring vectors
// (the objective groups): aggro / castle / economy / spread; undefined = adaptive.
// All randomness routes through the seeded rng (no Math.random) — §8.

import { getLegalMoves } from './legalMoves.js';
import { randomInt } from './rng.js';
import { regionOf, advanceToColor, colorOf } from './geometry.js';
import type {
  SweetlandsState, SweetlandsMove, PlayerState, SpaceColor, UnitType, IntelCard, SecretObjectiveId,
} from './types.js';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Strategy = 'aggro' | 'castle' | 'economy' | 'spread' | 'adaptive';

const UNITS: UnitType[] = ['leader', 'knight', 'ambassador'];

function threeRegionsDone(p: PlayerState): boolean {
  return Object.values(p.turn.unitRegionsVisited).some((rs) => (rs?.length ?? 0) >= 3);
}
function isGreenCard(p: PlayerState, cardId: string): boolean {
  const c = p.hand.find((x) => x.cardId === cardId);
  return !!c && (c.kind === 'single' || c.kind === 'double') && c.color === 'green';
}
/** The unit furthest along the "3 regions" rush (most regions visited this turn). */
function focusUnit(p: PlayerState): UnitType {
  let best: UnitType = 'ambassador', n = -1;
  for (const u of UNITS) { const c = p.turn.unitRegionsVisited[u]?.length ?? 0; if (c > n) { n = c; best = u; } }
  return best;
}

const POLICY_UNIT: Record<SpaceColor, UnitType> = {
  red: 'knight', green: 'knight',
  orange: 'leader', yellow: 'leader', purple: 'leader',
  blue: 'ambassador',
};

/** Map a free-form strategy name (+ aliases) to an archetype; undefined ⇒ adaptive. */
export function parseStrategy(s?: string): Strategy {
  switch ((s ?? '').toLowerCase().trim()) {
    case 'aggro': case 'aggressive': case 'capture': case 'warlord': return 'aggro';
    case 'castle': case 'siege': case 'foe': case 'dragonslayer': return 'castle';
    case 'economy': case 'control': case 'tax': case 'influence': return 'economy';
    case 'spread': case 'expansion': case 'explorer': case 'positional': return 'spread';
    default: return 'adaptive';
  }
}

type Move = SweetlandsMove;
type Play = Extract<SweetlandsMove, { type: 'play_intel' }>;
type Token = Extract<SweetlandsMove, { type: 'play_token' }>;
type AnyPlay = Play | Token;

export function chooseMove(
  state: SweetlandsState,
  playerId: string,
  difficulty: Difficulty = 'medium',
  strategyName?: string,
): { move: Move; narration: string } {
  const legal = getLegalMoves(state, playerId).map((l) => l.move);
  if (legal.length === 0) return { move: { type: 'pass' }, narration: 'No legal moves; passing.' };
  const p = state.players.find((x) => x.playerId === playerId)!;

  // An outstanding Intel report (defensive — AI seats are dealt directly, so this
  // is normally never set for an AI) has only the report move available. A
  // digital human seat would see resolve_report here instead; the AI is never
  // offered it because its Intel was dealt directly by grantIntel.
  if (legal.length === 1 && legal[0]!.type === 'report_intel_draw') {
    return { move: legal[0]!, narration: 'Reports drawn Intel.' };
  }

  if (difficulty === 'easy') return randomMove(state, legal);

  const strategy = parseStrategy(strategyName);

  // recall step: skip recall (keep units advancing)
  const recallSkip = legal.find((m) => m.type === 'recall' && m.units.length === 0);
  if (recallSkip) return { move: recallSkip, narration: 'Skips recall and gains Intel.' };

  // HARD: finish an owned secret objective that is one action away (free points).
  if (difficulty === 'hard') {
    const shortcut = objectiveShortcut(p, legal);
    if (shortcut) return shortcut;
  }

  // HARD Nomads: incite trade (their designed strength) — pay a small influence
  // premium to acquire an Intel card they need for the area-control path. Once/turn.
  if (difficulty === 'hard' && p.homeRegion == null && !p.turn.tradedThisTurn) {
    const t = findNomadTrade(state, p);
    if (t) return { move: t, narration: 'Trades (with an influence sweetener) for a needed Intel card.' };
  }

  // influence step
  if (p.turn.step === 'influence') return influenceMove(p, legal, difficulty, strategy);

  // play step: score the play_intel AND play_token options
  const plays = legal.filter((m): m is AnyPlay => m.type === 'play_intel' || m.type === 'play_token');
  const scored = plays.map((m) => ({ m, s: scorePlay(state, p, m, difficulty, strategy) })).sort((a, b) => b.s - a.s);
  if (scored.length > 0 && scored[0]!.s > -Infinity) {
    return { move: scored[0]!.m, narration: `Plays an Intel card, moving its ${scored[0]!.m.unit}.` };
  }
  const pass = legal.find((m) => m.type === 'pass');
  if (pass) return { move: pass, narration: 'Passes to gain influence.' };
  return { move: legal[0]!, narration: 'Takes the only available action.' };
}

// ---------------------------------------------------------------------------

function ownedUnscored(p: PlayerState): Set<SecretObjectiveId> {
  const scored = new Set(p.secretObjectivesScored ?? []);
  return new Set(p.secretObjectives.filter((o) => !scored.has(o)));
}

/** HARD: if an owned secret objective can be completed by a single available
 *  action right now, do it (each is worth 2 points). */
function objectiveShortcut(p: PlayerState, legal: Move[]): { move: Move; narration: string } | null {
  const owned = ownedUnscored(p);
  if (owned.has('spend_5_influence') && p.influence >= 5) {
    const m = legal.find((x) => x.type === 'trash_influence' && x.count === 5);
    if (m) return { move: m, narration: 'Trashes 5 influence to complete a secret objective.' };
  }
  if (owned.has('discard_5_sugar') && p.sugarCubes >= 5) {
    const m = legal.find((x) => x.type === 'discard_sugar' && x.count === 5);
    if (m) return { move: m, narration: 'Discards 5 sugar to complete a secret objective.' };
  }
  // discard_5_intel: convert Intel (each discard_for_color dumps 4) toward 5 discarded.
  if (owned.has('discard_5_intel') && p.progress.intelDiscardedTotal < 5) {
    const m = legal.find((x) => x.type === 'discard_for_color');
    if (m) return { move: m, narration: 'Converts Intel toward the discard-5-Intel objective.' };
  }
  // unit_through_3_regions: unlock unlimited plays (discard a Green) to rush one unit.
  if (owned.has('unit_through_3_regions') && !threeRegionsDone(p) && !p.turn.unlimitedPlays) {
    const g = legal.find((x): x is Play => x.type === 'play_intel' && x.takeAction && x.unit === 'leader' && x.viaRoad === undefined && isGreenCard(p, x.cardId));
    if (g) return { move: g, narration: 'Discards Green to unlock unlimited plays for a 3-region rush.' };
  }
  return null;
}

function influenceMove(p: PlayerState, legal: Move[], difficulty: Difficulty, strategy: Strategy): { move: Move; narration: string } {
  // Buy sugar when flush — fuels battles, first-player, and the discard objective.
  // Nomads START with 0 sugar and rely on fights (captures / defeat-foe) for points,
  // so they build a much bigger pool.
  const cap = difficulty === 'hard' ? (p.homeRegion == null ? 12 : 6) : Infinity;
  const wantSugar = p.sugarCubes < cap;
  const sugar = legal.find((m) => m.type === 'buy_sugar_cube');
  if (sugar && p.influence >= 3 && wantSugar) return { move: sugar, narration: 'Buys a sugar cube.' };
  // HARD: buy a USEFUL Intel token (a kept, guaranteed-color play) with spare
  // influence — the area-control target color, red (captures), or purple (castle).
  if (difficulty === 'hard' && p.influence >= 1) {
    const plan = areaPlan(p);
    const wanted: SpaceColor[] = [];
    if (plan) wanted.push(plan.target);
    wanted.push('red', 'purple');
    for (const c of wanted) {
      if (p.intelTokens[c]) continue;
      const tok = legal.find((m) => m.type === 'buy_intel_token' && m.color === c);
      if (tok) return { move: tok, narration: `Buys a ${c} Intel token.` };
    }
  }
  // MEDIUM: spend leftover influence (sugar costs 3, tokens 1) on an Intel token —
  // a kept, guaranteed-color play — instead of ending the turn with influence idle.
  // Income colors first, matching the scorer's small blue/orange preference.
  if (difficulty === 'medium' && p.influence >= 1) {
    const order: SpaceColor[] = ['blue', 'orange', 'red', 'green', 'yellow', 'purple'];
    for (const c of order) {
      if (p.intelTokens[c]) continue;
      const tok = legal.find((m) => m.type === 'buy_intel_token' && m.color === c);
      if (tok) return { move: tok, narration: `Buys a ${c} Intel token.` };
    }
  }
  const end = legal.find((m) => m.type === 'end_turn')!;
  return { move: end, narration: 'Ends its turn.' };
}

function scorePlay(state: SweetlandsState, p: PlayerState, m: AnyPlay, difficulty: Difficulty, strategy: Strategy): number {
  // A token plays like a single card of its color; a hand card derives its color.
  const card: IntelCard = m.type === 'play_token'
    ? { cardId: `token-${m.color}`, kind: 'single', color: m.color }
    : (p.hand.find((c) => c.cardId === m.cardId) ?? { cardId: '', kind: 'single', color: 'red' });
  if (m.type === 'play_intel' && !p.hand.some((c) => c.cardId === m.cardId)) return -Infinity;
  const color = primaryColor(card);
  // Prefer a hand card over a token when both give the same color (save the kept
  // token for a color you LACK) — but a token is still played when it's the best option.
  const tokenBonus = m.type === 'play_token' ? -2 : 0;
  // Green + takeAction = discard for unlimited plays (no move) = an EXPLOSIVE turn.
  // Enable it when it pays off (3-region rush, or to position several units for an
  // area-control objective in one turn); otherwise it's a default-bad play.
  // MEDIUM uses a simpler tempo rule (no objective awareness): with a big hand
  // backlog the one-play-per-turn cap is the bottleneck, so unlock and dump the
  // hand. (Versus sparring 2026-08-30 found evolved "take every action" strategies
  // beating medium above parity — medium was leaving plays and influence unused.)
  if (color === 'green' && m.takeAction) {
    if (difficulty === 'hard' && !p.turn.unlimitedPlays && wantsExplosiveTurn(state, p)) return 35;
    if (difficulty === 'medium' && !p.turn.unlimitedPlays && p.hand.length >= 5) return 30;
    return -10;
  }

  let s = tokenBonus;
  if (m.takeAction) s += 5;
  if (color && m.unit === POLICY_UNIT[color]) s += 3;
  if (color === 'blue' || color === 'orange') s += 1; // income

  // Area-control pursuit (both Nomads and region-holders): converge units onto a
  // shared color / onto treats. Bonuses scale UP during an explosive (unlimited) turn,
  // which is how the AI positions several units in one turn.
  if (difficulty === 'hard') s += areaControlBonus(state, p, m, card, color);

  if (difficulty === 'hard' && color) {
    // capture: moving the knight into a region holding an enemy leader/ambassador
    if (color === 'red' && m.takeAction && captureAvailable(state, p)) s += 40;
    // raise taxes toward the objective
    if (color === 'yellow' && m.raiseTaxes && ownedUnscored(p).has('raise_taxes_3') && (state.taxes[p.homeRegion ?? 1] ?? 0) < 3) s += 20;
    // CASTLE: send the knight to defeat the foe (3 pts), then the leader to hold it.
    const foeAlive = !!state.foe && !state.foe.defeated;
    if (color === 'red' && foeAlive && m.unit === 'knight' && !captureAvailable(state, p)) {
      const kz = p.units.knight;
      const atCastle = kz.zone === 'castle' || kz.zone === 'road' || (kz.zone === 'ring' && kz.ringIndex === 5);
      if (m.takeAction && atCastle) s += 45; // ENTER + fight the foe now
      else if (m.viaRoad === true) s += 18; // branch onto the road toward the castle
    }
    if ((color === 'green') && foeAlive && m.unit === 'knight' && !captureAvailable(state, p) && m.viaRoad === true) s += 14;
    if (color === 'purple' && m.unit === 'leader' && pursuesCastle(p, strategy) && !foeAlive) {
      const lz = p.units.leader;
      const atCastle = lz.zone === 'castle' || lz.zone === 'road' || (lz.zone === 'ring' && lz.ringIndex === 5);
      if (m.takeAction && atCastle) s += 22; // ENTER / hold the castle
      else if (m.viaRoad === true) s += 14;
    }
    // 3-region rush: once unlimited plays are unlocked, concentrate moves on one unit
    // and prefer steps that carry it into a NEW region.
    if (ownedUnscored(p).has('unit_through_3_regions') && !threeRegionsDone(p) && p.turn.unlimitedPlays) {
      if (m.unit === focusUnit(p)) {
        s += 12;
        const dest = advanceToColor(p.units[m.unit], color, m.viaRoad ?? false);
        const dr = dest ? regionOf(dest) : null;
        if (dr != null && !(p.turn.unitRegionsVisited[m.unit] ?? []).includes(dr)) s += 25;
      }
    }
    // collect taxes from an opponent: prefer Yellow when a rival has a taxable unit in-region.
    if (color === 'yellow' && m.takeAction && p.homeRegion != null) {
      const region = p.homeRegion;
      const rival = state.players.some((o) => o.playerId !== p.playerId && o.faction !== 'milkshake'
        && UNITS.some((u) => regionOf(o.units[u]) === region && o.units[u].zone !== 'treat'));
      if (rival) s += 8;
    }
    // strategy bias keyed on the action's effect
    s += strategyBias(color, strategy);
  }
  return s;
}

/** Nomad trade: pay a 1-influence premium to swap an unwanted card for an Intel card
 *  the Nomad needs (target matching-color or a treat). Mutually beneficial — the
 *  partner nets +1 influence on a 1-for-1 card swap, so a rational table accepts.
 *  NOTE: uses server-side hand knowledge to find the swap — an abstraction of table
 *  negotiation (a human can't see hands); only mutually-beneficial swaps are made,
 *  and never available except all-AI play. Models the Nomads' designed "incite trade". */
function findNomadTrade(state: SweetlandsState, p: PlayerState): Move | null {
  if (p.influence < 2) return null; // keep an influence buffer
  const target = nomadTargetColor(p);
  const wants = (c: IntelCard): boolean =>
    c.kind === 'treat' || ((c.kind === 'single' || c.kind === 'double') && c.color === target);
  // a card the Nomad is willing to give up (not one it wants)
  const giveCard = p.hand.find((c) => !wants(c));
  if (!giveCard) return null;
  for (const o of state.players) {
    if (o.playerId === p.playerId) continue;
    if (o.hand.length < 2) continue; // don't cripple the partner
    const got = o.hand.find((c) => wants(c));
    if (!got) continue;
    return {
      type: 'trade', withPlayerId: o.playerId,
      giveIntelCardIds: [giveCard.cardId], giveInfluence: 1,
      receiveIntelCardIds: [got.cardId],
    };
  }
  return null;
}

/** The color the Nomad is converging its units onto (the most common already). */
function nomadTargetColor(p: PlayerState): SpaceColor | null {
  const cur = UNITS.map((u) => colorOf(p.units[u])).filter((c): c is SpaceColor => c != null);
  if (!cur.length) return null;
  const counts: Partial<Record<SpaceColor, number>> = {};
  for (const c of cur) counts[c] = (counts[c] ?? 0) + 1;
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]) as SpaceColor | undefined ?? null;
}

// ---- area-control objectives (units_all_matching_color / units_all_treats) ----
//
// Region-holders need a unit in each of the 3 OPPOSING regions on the same color
// (mode 'distinct'); Nomads (no home) just need ALL 3 units on the same color
// (mode 'all'). Treats are the same idea with treat spaces.

interface AreaPlan { target: SpaceColor; covered: number; needed: number; cards: number; nomad: boolean; }

/** How many of the player's units already count toward a same-color set on X. */
function coveredOnColor(p: PlayerState, x: SpaceColor): number {
  if (p.homeRegion == null) return UNITS.filter((u) => colorOf(p.units[u]) === x).length;
  const regs = new Set<number>();
  for (const u of UNITS) {
    const loc = p.units[u];
    if (colorOf(loc) === x) { const r = regionOf(loc); if (r != null && r !== p.homeRegion) regs.add(r); }
  }
  return regs.size;
}

/** The cheapest matching-color set to complete (target color + units still needed). */
function areaPlan(p: PlayerState): AreaPlan | null {
  let best: AreaPlan | null = null;
  for (const x of ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as SpaceColor[]) {
    const covered = coveredOnColor(p, x);
    const cards = p.hand.filter((c) => (c.kind === 'single' || c.kind === 'double') && c.color === x).length;
    const needed = 3 - covered;
    if (needed <= 0) continue;
    if (!best || covered > best.covered || (covered === best.covered && cards > best.cards)) {
      best = { target: x, covered, needed, cards, nomad: p.homeRegion == null };
    }
  }
  return best;
}

/** Should the AI spend a Green to unlock an explosive (unlimited-play) turn? Worth it
 *  to rush the 3-region objective, or to position ≥2 units for an area-control set. */
function wantsExplosiveTurn(state: SweetlandsState, p: PlayerState): boolean {
  if (ownedUnscored(p).has('unit_through_3_regions') && !threeRegionsDone(p)) return true;
  const plan = areaPlan(p);
  return !!plan && plan.needed >= 2 && plan.cards >= plan.needed && p.hand.length >= plan.needed;
}

/** Area-control move bonus (both factions): reward moving a unit onto the target
 *  color in a coverage-increasing way; bigger during an explosive turn. Plus the
 *  Nomad treat + sugar-income bonuses. */
function areaControlBonus(state: SweetlandsState, p: PlayerState, m: AnyPlay, card: IntelCard, color: SpaceColor | null): number {
  let s = 0;
  const isNomad = p.homeRegion == null;
  // Nomads: build a combat pool (start at 0 sugar) by gaining influence to buy sugar.
  if (isNomad && color === 'orange' && p.sugarCubes < 5) s += 14;
  // units_all_treats: a treat card that brings a not-yet-treated unit onto a treat.
  if (card.kind === 'treat' && p.units[m.unit].zone !== 'treat' && !UNITS.every((u) => p.units[u].zone === 'treat')) {
    s += p.turn.unlimitedPlays ? 30 : 26;
  }
  // units_all_matching_color: converge onto the planned target color.
  const plan = areaPlan(p);
  if (plan && color) {
    const big = p.turn.unlimitedPlays ? 24 : 12;
    if (color === plan.target) {
      const dest = advanceToColor(p.units[m.unit], color, m.viaRoad ?? false);
      if (dest && colorOf(dest) === plan.target) {
        if (isNomad) {
          if (colorOf(p.units[m.unit]) !== plan.target) s += big; // a new unit onto target
        } else {
          const dr = regionOf(dest);
          const covered = new Set<number>();
          for (const u of UNITS) { const l = p.units[u]; if (u !== m.unit && colorOf(l) === plan.target) { const r = regionOf(l); if (r != null && r !== p.homeRegion) covered.add(r); } }
          if (dr != null && dr !== p.homeRegion && !covered.has(dr)) s += big; // a new opposing region on target
        }
      }
    } else if (colorOf(p.units[m.unit]) === plan.target && coveredOnColor(p, plan.target) >= 2) {
      s -= 15; // don't pull a unit off a nearly-complete set
    }
  }
  return s;
}

function captureAvailable(state: SweetlandsState, p: PlayerState): boolean {
  const kr = regionOf(p.units.knight);
  if (kr == null) return false;
  return state.players.some((o) => o.playerId !== p.playerId
    && (regionOf(o.units.leader) === kr || regionOf(o.units.ambassador) === kr));
}

function pursuesCastle(p: PlayerState, strategy: Strategy): boolean {
  if (strategy === 'castle') return true;
  if (strategy === 'adaptive') return ownedUnscored(p).has('enter_castle_with_leader') || !p.publicObjectivesScored.includes('defeat_foe');
  return false;
}

function strategyBias(color: SpaceColor, strategy: Strategy): number {
  switch (strategy) {
    case 'aggro': return color === 'red' ? 6 : 0;
    case 'castle': return color === 'purple' ? 6 : color === 'red' ? 3 : 0;
    case 'economy': return color === 'orange' || color === 'yellow' || color === 'blue' ? 4 : 0;
    case 'spread': return color === 'green' || color === 'blue' ? 4 : 0; // movement/positioning
    case 'adaptive': return 0;
  }
}

function primaryColor(card: IntelCard): SpaceColor | null {
  if (card.kind === 'single' || card.kind === 'double') return card.color;
  return null; // treat
}

/** Uniform-random pick over the legal set, seeded & deterministic from state. */
function randomMove(state: SweetlandsState, legal: Move[]): { move: Move; narration: string } {
  const mix = (state.seed ^ (state.round * 2654435761 + state.currentPlayerIndex * 40503 + legal.length * 97)) >>> 0;
  const idx = randomInt(mix, legal.length).value;
  return { move: legal[idx]!, narration: 'Plays a random legal move (easy).' };
}
