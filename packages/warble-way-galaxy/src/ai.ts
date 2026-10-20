import { GameError } from '@zekel/game-kit';
import type { AIMoveResult } from '@zekel/game-kit';
import { ABILITY_STAT, HAZARD_CONSEQUENCE_BY_STAT } from './data/abilities.js';
import { HABITATS } from './data/habitats.js';
import { CLUB_MISSIONS, DIAMOND_PIRATES, HEART_RECRUITS, SPADE_HAZARDS } from './data/travelTables.js';
import {
  anyoneHasEffective,
  bestForAbility,
  bestForStat,
  cellsWhere,
  describeMission,
  describeRecruit,
  inAttackRange,
  parseCellId,
  partyQualifiesFor,
  ruinAttackRange,
  ruinDistanceToGoal,
  ruinStepToward,
  unnamedCap,
  ruinGoalCell,
  ruinMapForLevel,
  ruinReachable,
} from './engine.js';
import { getLegalMoves } from './legalMoves.js';
import { randomInt, rollDice } from './rng.js';
import type { AbilityId, AbilityScores, ItemDefinition, MissionDefinition, WarbleMove, WarbleWayGalaxyState } from './types.js';

// The solvability bot (ai-development gate; solo reinterpretation of the tier
// ladder — see AI-NOTES.md):
//   easy   = uniform-random over the concrete legal set (seeded; the outcome
//            FLOOR — how badly does random play die?)
//   medium = the baseline priority policy
//   hard   = verified-stronger: survival-first creation (Ms/Mr Fix-it from
//            turn 1), pick-your-fights combat, consequence-aware hazards,
//            crew-carrier risk shifting, speed-part economy
// Report moves (dice/cards) are NEVER decisions: every tier simulates them
// faithfully — seeded real d6, deck draws sampled uniformly without
// replacement from the tracked composition (simulation-fidelity rule).
//
// Strategies (the balance metagame axis; parseStrategy maps names → archetype;
// undefined = the adaptive default). Derived from the game's distinct paths
// through Season 1 (see AI-NOTES §4):
//   runner    — survival economy: never trades blows, buys speed, skips ruins
//   privateer — pirate hunting: fights with advantage, always boards, takes ships
//   delver    — ruin looting: enters discovery ruins, prioritizes caches/beings

export type Tier = 'easy' | 'medium' | 'hard';
export type Strategy = 'runner' | 'privateer' | 'delver' | 'ghost' | 'dread' | 'tycoon' | null;

export function parseTier(difficulty?: string): Tier {
  if (difficulty === 'easy') return 'easy';
  if (difficulty === 'hard' || difficulty === 'mcts') return 'hard'; // no adversary → no search tier; hard is the anchor
  return 'medium';
}

export function parseStrategy(s?: string): Strategy {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  if (['runner', 'cautious', 'survivor', 'trader'].includes(v)) return 'runner';
  if (['privateer', 'pirate', 'fighter', 'hunter'].includes(v)) return 'privateer';
  if (['delver', 'explorer', 'looter', 'digger'].includes(v)) return 'delver';
  if (['ghost', 'stealth', 'sneak', 'infiltrator'].includes(v)) return 'ghost';
  if (['dread', 'dreadpirate', 'corsair', 'terror'].includes(v)) return 'dread';
  if (['tycoon', 'hoarder', 'merchant', 'magnate'].includes(v)) return 'tycoon';
  return null;
}

/** THE evaluation function — the one "how well is this run going" number.
 * Consumers: the tier self-test, the harness leaderScalar (same formula inlined
 * in harness/analysis.ts — keep them in sync), and future search tiers.
 * Reads the getScoreboard row shape. */
export function progressScore(row: Record<string, number>): number {
  return (
    (row.credits ?? 0) +
    150 * Math.max(0, (row.level ?? 1) - 1) +
    25 * (row.xp ?? 0) +
    40 * (row.crew ?? 0) +
    300 * Math.max(0, (row.habitat ?? 1) - 1) +
    50 * (row.ship_damage_level ?? 0) // 0 hobbled … 3 pristine
  );
}

const AVG_D6 = 3.5;

function say(playerId: string, move: WarbleMove, narration: string): AIMoveResult<WarbleMove> {
  return { move, narration: `${playerId} (bot) ${narration}` };
}

/** Expected margin of an Nd6+bonus check vs a minimum (positive = favored). */
function margin(bonus: number, min: number, dice = 3): number {
  return AVG_D6 * dice + bonus - min;
}

// ---------------------------------------------------------------------------
// Creation — the strategic setup choice (runbook §6): the archetype IS the pick
// ---------------------------------------------------------------------------

const CREATION_BY_STRATEGY: Record<Exclude<Strategy, null>, AbilityScores> = {
  runner: { MEC: 3, PIL: 2, RES: 1 }, // Fix-it + escapes + peeks
  privateer: { PIL: 3, SWA: 2, MEC: 1 }, // advantage everywhere + boarding
  delver: { SWA: 3, DIP: 2, SNE: 1 }, // ground combat + conversions + movement
  // ghost = the amendment-A3 finale specialist: the proven survival core, then
  // levels 2-3-4 all go to SNE (Personal Cloaking) for a solo stealth finale.
  // The XP-doubling curve makes the commitment early-or-never (AI-NOTES §4).
  ghost: { PIL: 3, MEC: 2, RES: 1 },
  // dread = the A9 shakedown corsair: DEM 3 is Fearsome Reputation (tribute),
  // PIL 2 keeps space advantage + escapes, DIP 1 opens the A10 body channels.
  dread: { DEM: 3, PIL: 2, DIP: 1 },
  // tycoon = the A11 Fortune chaser: the captain aura farms crew-carried
  // missions forever; every credit is banked, nothing is bought but hull.
  tycoon: { LEA: 3, MEC: 2, RES: 1 },
};

const CREATION_MEDIUM: AbilityScores = { PIL: 3, MEC: 2, RES: 1 };
/** Hard keeps the proven survival core — natural PIL 3 is Flying Ace + space
 * advantage (winning an exchange beats a failed escape's guaranteed damage),
 * MEC repairs, RES purges pirates from the deck via the peek. Hard's edge is
 * POLICY: speed-first economy, shorter missions, crew-carrier risk shifting,
 * and leveling MEC→3 for Ms/Mr Fix-it. (An earlier MEC-3/PIL-2/LEA-1 build
 * measured WORSE than medium — losing Flying Ace + the peek cost more than
 * turn-1 Fix-it bought; see AI-NOTES §1.) */
const CREATION_HARD: AbilityScores = { PIL: 3, MEC: 2, RES: 1 };

const ALL_ABILITIES: AbilityId[] = ['SWA', 'ARM', 'DEM', 'HAK', 'RES', 'MEC', 'PIL', 'GUN', 'SNE', 'LEA', 'DIP', 'ACT'];

function creationMove(state: WarbleWayGalaxyState, playerId: string, tier: Tier, strategy: Strategy): AIMoveResult<WarbleMove> {
  let scores: AbilityScores;
  if (tier === 'easy') {
    // Random 3/2/1 over three distinct abilities (seeded — the true floor).
    const pool = [...ALL_ABILITIES];
    let s = state.seed;
    scores = {};
    for (const v of [3, 2, 1]) {
      const r = randomInt(s, pool.length);
      s = r.nextSeed;
      scores[pool.splice(r.value, 1)[0]!] = v;
    }
  } else if (strategy) {
    scores = CREATION_BY_STRATEGY[strategy];
  } else {
    scores = tier === 'hard' ? CREATION_HARD : CREATION_MEDIUM;
  }
  const label = Object.entries(scores)
    .map(([a, v]) => `${a} ${v}`)
    .join('/');
  return say(playerId, {
    type: 'create_character',
    character_name: 'Bot Pilot',
    race: 'human',
    ship_name: 'Harness Runner',
    method: 'recommended',
    scores,
  }, `creates a ${strategy ?? tier} build: ${label}.`);
}

// ---------------------------------------------------------------------------
// easy — uniform-random over the concrete legal set
// ---------------------------------------------------------------------------

/** Moves whose legal-move entry is a fill-in skeleton (values the bot must supply). */
function isFillIn(move: WarbleMove): boolean {
  switch (move.type) {
    case 'create_character':
      return true;
    case 'report_roll':
      return move.dice.length === 0;
    case 'report_card_draw':
    case 'report_res_discard':
      return move.card === '';
    case 'move_being':
      return move.to === '';
    case 'setup_encounter':
      return move.attacker_placements.length === 0;
    default:
      return false;
  }
}

/** Dynamic salt for the easy tier's randomness: `state.seed` only advances on
 * REPORT moves, so decision-only stretches (e.g. ruin rounds with no rolls)
 * would freeze a pure seed-keyed coin into a deterministic loop — harness-
 * caught as 5000-turn SAFETY_LIMITs. The salt folds in state that changes
 * every round, keeping runs deterministic per seed but never frozen. */
function easySalt(state: WarbleWayGalaxyState): number {
  let salt = state.deck.remaining.length * 101 + state.crew.length * 13 + state.current_habitat * 7;
  if (state.encounter?.kind === 'ruin_run' && state.encounter.board) {
    const b = state.encounter.board;
    salt += b.round * 7919 + b.tokens.reduce((a, t) => a + t.moved + (t.ended ? 3 : 0), 0) * 31;
  }
  const char = state.character;
  if (char) salt += char.credits + char.xp * 5;
  return salt >>> 0;
}

function randomFrom<T>(state: WarbleWayGalaxyState, items: T[]): T {
  return items[randomInt(state.seed + easySalt(state), items.length).value]!;
}

function easyMove(state: WarbleWayGalaxyState, playerId: string): AIMoveResult<WarbleMove> {
  const pending = state.pending;
  // Physical randomness is not a decision — always faithful.
  if (pending?.kind === 'roll') return simulatedRoll(state, playerId);
  if (pending?.kind === 'card_draw') return simulatedDraw(state, playerId);
  if (pending?.kind === 'res_discard') {
    // The peek IS a decision: coin-flip it, then discard a random peeked card.
    if (randomInt(state.seed + easySalt(state) + 1, 2).value === 0) return say(playerId, { type: 'skip_res_peek' }, 'skips the peek (random).');
    const pick = randomInt(state.seed, Math.min(pending.peek_count, state.deck.remaining.length));
    return say(playerId, { type: 'report_res_discard', card: state.deck.remaining[pick.value]! }, 'peeks and discards at random.');
  }
  if (pending?.kind === 'ruin_setup') {
    // Random-but-valid setup.
    const map = ruinMapForLevel(pending.level);
    const starts = cellsWhere(map, 'S');
    const spots = [...cellsWhere(map, 'A')];
    let s = state.seed;
    const placements: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = randomInt(s, spots.length);
      s = r.nextSeed;
      placements.push(spots.splice(r.value, 1)[0]!);
    }
    const threat = (randomInt(s + 1, 3).value + 1) as 1 | 2 | 3;
    return say(playerId, {
      type: 'setup_encounter',
      crew_names: state.crew.map((c) => c.name),
      include_character: true,
      start_location: randomFrom(state, starts),
      threat_level: threat,
      attacker_placements: placements,
    }, `sets up at random (threat ${threat}).`);
  }
  // Ruin party phase: random play must include MOVEMENT, or a cloaked (natural
  // SNE≥3, never-attacking) random build stalls forever with attackers that
  // "see no one" (a real harness-caught liveness hole). 50%: wander to a
  // random reachable cell; else a random concrete action.
  if (pending?.kind === 'ruin_turn' && state.encounter?.kind === 'ruin_run' && state.encounter.board) {
    const token = state.encounter.board.tokens.find((t) => !t.ended);
    if (token && randomInt(state.seed + easySalt(state) + 3, 2).value === 0) {
      const cells = [...ruinReachable(state, token.name).keys()].sort();
      if (cells.length > 0) {
        const to = randomFrom(state, cells);
        return say(playerId, { type: 'move_being', being: token.name, to }, `wanders to ${to} (random).`);
      }
    }
  }
  // Equip is a FREE, reversible action — a uniform-random agent oscillates
  // gear between beings forever (harness-caught: 5000-turn SAFETY_LIMIT).
  // Keep first-time equips (progress); drop re-shuffles of worn gear.
  const isGearShuffle = (m: WarbleMove): boolean => {
    if (m.type !== 'equip_item') return false;
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    const item = state.items.find((i) => norm(i.name) === norm(m.item_name) || norm(i.id) === norm(m.item_name));
    if (!item) return false;
    const worn =
      state.character?.gear.weapon === item.id ||
      state.character?.gear.armor === item.id ||
      state.crew.some((c) => c.gear.weapon === item.id || c.gear.armor === item.id);
    return worn;
  };
  const concrete = getLegalMoves(state, playerId).filter((m) => !isFillIn(m.move) && !isGearShuffle(m.move));
  if (concrete.length === 0) {
    // Only fill-ins remain (e.g. every being still has movement but nothing
    // else to do) — end the first unended being's turn if possible.
    throw new GameError('NO_SUGGESTION', 'easy tier found no concrete legal move (unexpected — investigate).');
  }
  const pick = randomFrom(state, concrete);
  return say(playerId, pick.move, `plays at random: ${pick.move_id}.`);
}

// ---------------------------------------------------------------------------
// Faithful physical-randomness simulation (all tiers)
// ---------------------------------------------------------------------------

function simulatedRoll(state: WarbleWayGalaxyState, playerId: string): AIMoveResult<WarbleMove> {
  const pending = state.pending;
  if (pending?.kind !== 'roll') throw new GameError('NO_SUGGESTION', 'no roll pending');
  const { dice } = rollDice(state.seed, pending.dice_count);
  return say(playerId, { type: 'report_roll', dice }, `rolls ${pending.dice_count}d6 for the ${pending.reason.replace(/_/g, ' ')}: ${dice.join(', ')}.`);
}

function simulatedDraw(state: WarbleWayGalaxyState, playerId: string): AIMoveResult<WarbleMove> {
  const pick = randomInt(state.seed, state.deck.remaining.length);
  const card = state.deck.remaining[pick.value]!;
  return say(playerId, { type: 'report_card_draw', card }, `draws ${card} from the simulated travel deck.`);
}

// ---------------------------------------------------------------------------
// The policy (medium baseline; `hard` and strategies adjust the knobs)
// ---------------------------------------------------------------------------

interface Knobs {
  tier: Tier;
  strategy: Strategy;
  /** Fight a pirate only when advantaged AND its space attack ≤ this (privateer: 99). */
  fight_max_atk: number;
  /** Minimum expected hack margin to try it. */
  hack_min_margin: number;
  /** Board a disabled ship at all? */
  boards: boolean;
  /** Enter discovery ruins? */
  delves: boolean;
  /** Prefer speed ship-parts before other purchases (survival economy). */
  speed_first: boolean;
  /** Shift Brawn-hazard death risk onto a crew carrier when possible. */
  crew_carrier: boolean;
  /** Mission ranking: margin − distance × this (long trips are risk). */
  distance_weight: number;
  /** Pick hazard options by EXPECTED CONSEQUENCE COST, not raw odds — failing a
   * −100c option is nearly free; failing a ship-damage option can be lethal. */
  hazard_ev: boolean;
  /** Level MEC to 3 first (Ms/Mr Fix-it: auto-Pristine every arrival). */
  fixit_leveling: boolean;
  /** Space recruits are FREE attempts (no mark, no cost) — always try with room;
   * every crew member widens hazard coverage (fewer forced failures). */
  recruit_greedy: boolean;
  /** Targeted survival purchases: H2's +2 Handling (escapes: ♦2 clean-escape
   * odds ~2% → ~50%) and H3's +2 ship Armor (−2 off every pirate total). */
  survival_buys: boolean;
  /** A1 paid repairs: pay 150c/level while credits ≥ this (the working reserve). */
  repair_reserve: number;
}

function knobsFor(tier: Tier, strategy: Strategy): Knobs {
  const base: Knobs = {
    tier,
    strategy,
    // Fighting WITH advantage usually wins outright; a failed escape is a
    // guaranteed hit — so both tiers fight the +3/+5 pirates and only run
    // from the ♦2 monster (+7). Verified by the tier self-test.
    fight_max_atk: 5,
    hack_min_margin: -2,
    boards: true,
    delves: false,
    speed_first: false, // measured a LOSER even at 400c with A1 repairs: 400c = ~2.7 hull levels, and hull is king (AI-NOTES §1)
    repair_reserve: tier === 'hard' ? 300 : 450, // hard converts credits→hull more aggressively (A1)
    crew_carrier: tier === 'hard',
    distance_weight: 0, // measured: distance-weighted ranking starves the mission economy
    hazard_ev: tier === 'hard',
    fixit_leveling: false, // measured: MEC→3 (Fix-it) leveling HALVES survival vs PIL-stacking (AI-NOTES §1)
    recruit_greedy: false, // measured: junk crew crowd out good recruits (2045 → 1908)
    survival_buys: false, // measured: credits→durability wash (score −140, +4 moves) — keep the simpler policy
  };
  if (strategy === 'runner') return { ...base, fight_max_atk: -1, boards: false, speed_first: true };
  // Privateer fights every WINNABLE fight and always boards — the old
  // fight-anything gate (99) measured suicidal (64-move runs, 40/40 losses)
  // and left the A11 Bounty ending unreachable by its own specialist.
  if (strategy === 'privateer') return { ...base, fight_max_atk: 5, boards: true };
  if (strategy === 'delver') return { ...base, delves: true };
  return base;
}

function bestMissionOption(state: WarbleWayGalaxyState, missions: MissionDefinition[], k: Knobs): MissionDefinition | null {
  const ranked = missions
    .filter((m) => m.goal.kind === 'ability_check' && partyQualifiesFor(state, m.goal.ability))
    .map((m) => {
      const goal = m.goal as Extract<MissionDefinition['goal'], { kind: 'ability_check' }>;
      const rawMargin = margin(bestForAbility(state, goal.ability).bonus, goal.min_roll);
      // QUALIFY on the raw check margin; RANK by the distance-weighted score.
      // (Filtering on the weighted score made `hard` reject the last viable
      // habitat missions and fall through to suicidal ruins jobs — see the
      // tier self-test history in AI-NOTES §1.)
      return { m, rawMargin, score: rawMargin - m.distance * k.distance_weight };
    })
    .filter((x) => x.rawMargin >= -1.5)
    .sort((a, b) => b.score - a.score || b.m.credits - a.m.credits);
  return ranked[0]?.m ?? null;
}

/** A ruins job is survivable only with a real attack aboard (or a delver build). */
function canFightRuins(state: WarbleWayGalaxyState, k: Knobs): boolean {
  if (k.delves) return true;
  const attack = Math.max(bestForAbility(state, 'SWA').bonus, bestForAbility(state, 'GUN').bonus, bestForAbility(state, 'DEM').bonus);
  return attack >= 2;
}

export function chooseMove(
  state: WarbleWayGalaxyState,
  playerId: string,
  tier: Tier = 'medium',
  strategy: Strategy = null,
): AIMoveResult<WarbleMove> {
  if (state.phase === 'creation') return creationMove(state, playerId, tier, strategy);
  if (tier === 'easy') return easyMove(state, playerId);
  const k = knobsFor(tier, strategy);
  const pending = state.pending;

  if (pending?.kind === 'roll') {
    // Declare a matching consumable first when the check is unfavored (WR §6).
    const declared = pending.declared_items.reduce((sum, id) => {
      const item = state.items.find((i) => i.id === id);
      return sum + (item?.effect.kind === 'ability_bonus' ? item.effect.bonus : 0);
    }, 0);
    if (pending.min_roll !== null && pending.score_source.ability) {
      const m = margin(pending.score_source.bonus + declared, pending.min_roll, pending.dice_count);
      if (m < 0) {
        const boost = state.items.find(
          (i) =>
            i.type === 'consumable' &&
            !state.consumed_item_ids.includes(i.id) &&
            !pending.declared_items.includes(i.id) &&
            i.effect.kind === 'ability_bonus' &&
            (i.effect.ability === 'ANY' || i.effect.ability === pending.score_source.ability),
        );
        if (boost) return say(playerId, { type: 'use_item', item_name: boost.name }, `declares ${boost.name} for the unfavored roll.`);
      }
    }
    return simulatedRoll(state, playerId);
  }
  if (pending?.kind === 'card_draw') return simulatedDraw(state, playerId);

  if (pending?.kind === 'res_discard') {
    // Peek + dump the most dangerous card (a pirate, else a hazard).
    const remaining = [...state.deck.remaining];
    const peeked: string[] = [];
    let s = state.seed;
    for (let i = 0; i < pending.peek_count && remaining.length > 0; i++) {
      const r = randomInt(s, remaining.length);
      s = r.nextSeed;
      peeked.push(remaining.splice(r.value, 1)[0]!);
    }
    const isPirate = (c: string) => c.endsWith('D') && ['2', '3', '4', '5', '6', '7', '8', '9'].includes(c.slice(0, -1));
    const discard = peeked.find(isPirate) ?? peeked.find((c) => c.endsWith('S')) ?? peeked[0]!;
    return say(playerId, { type: 'report_res_discard', card: discard }, `peeks ${pending.peek_count} card(s) and discards ${discard}.`);
  }

  if (pending?.kind === 'hazard_option') {
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
    const hazard = SPADE_HAZARDS[rank]!;
    if (pending.must_fail) {
      const cost = (ability: AbilityId): number => {
        const c = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[ability]];
        if (c === 'lose_credits') return state.character!.credits >= -100 ? 0 : 3;
        if (c === 'crew_unrest') return state.crew.length > 0 ? 1 : 0;
        if (c === 'ship_damage') return state.ship!.damage === 'hobbled' ? 4 : 2;
        return 3; // death — avoid
      };
      const option = cost(hazard.option1.ability) <= cost(hazard.option2.ability) ? 1 : 2;
      return say(playerId, { type: 'choose_hazard_option', option }, `has neither ability and fails option ${option} (least-bad consequence).`);
    }
    const consequenceCost = (ability: AbilityId): number => {
      const c = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[ability]];
      // Recalibrated for amendment A1: a damage level is repairable for 150c,
      // so −100c ≈ 0.67 repair-units — but mid-journey damage still carries a
      // death-spiral premium (no yard until arrival).
      if (c === 'lose_credits') return 0.7;
      if (c === 'crew_unrest') return state.crew.length > 0 ? 1.2 : 0.2;
      if (c === 'ship_damage') return state.ship!.damage === 'pristine' ? 3 : 6; // the killer, but now repairable
      return 5; // death check (A4: wounds first, but a wounded run is fragile)
    };
    const options = ([
      [1, hazard.option1],
      [2, hazard.option2],
    ] as const)
      .filter(([, o]) => anyoneHasEffective(state, o.ability))
      .map(([n, o]) => {
        const isDeath = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[o.ability]] === 'death';
        const m = margin(bestForAbility(state, o.ability).bonus, o.min_roll);
        // P(pass) via a coarse 3d6 curve (σ≈3): 0.5 + margin/8, clamped.
        const pFail = Math.min(1, Math.max(0, 0.5 - m / 8));
        // hard: minimize expected consequence cost; medium: raw odds.
        const score = k.hazard_ev ? -pFail * consequenceCost(o.ability) : m;
        return { n, o, score, isDeath };
      })
      .sort((a, b) => b.score - a.score);
    const pick = options[0]!;
    // Risk-shift: stake a crew carrier on a Brawn (death) option (WR §10 —
    // the carrier takes the consequence).
    let carrier: string | undefined;
    if (k.crew_carrier && pick.isDeath) {
      // Only shift the risk when it costs NO odds: the crew carrier's score
      // must equal the best aboard (a weaker carrier fails — and dies — more).
      const best = bestForAbility(state, pick.o.ability).bonus;
      const equal = state.crew.find((c) => (c.abilities[pick.o.ability] ?? 0) >= best);
      if (equal) carrier = equal.name;
    }
    return say(
      playerId,
      { type: 'choose_hazard_option', option: pick.n, ...(carrier ? { carrier } : {}) },
      `faces the hazard with its best option${carrier ? ` — ${carrier} carries the risk` : ''}.`,
    );
  }

  if (pending?.kind === 'space_mission_offer') {
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof CLUB_MISSIONS;
    const entry = CLUB_MISSIONS[rank]!;
    // Journey-depth cap (harness-caught, post-A5): with evasion making space
    // survivable indefinitely, accepting every sandwich turns the journey
    // into perpetual motion — the bot never docks again (5000-turn runs).
    if (state.journey_stack.length >= 4) {
      return say(playerId, { type: 'decline_mission' }, 'declines — the job stack is deep enough; time to make port.');
    }
    if (entry.kind === 'choice') {
      const one = bestMissionOption(state, [entry.option1], k);
      const two = bestMissionOption(state, [entry.option2], k);
      const pick = one && two ? (entry.option2.credits > entry.option1.credits ? 2 : 1) : one ? 1 : two ? 2 : null;
      if (pick) {
        const m = pick === 1 ? entry.option1 : entry.option2;
        return say(playerId, { type: 'accept_mission', option: pick }, `accepts space mission option ${pick} (${describeMission(m)}).`);
      }
    } else if (k.delves) {
      return say(playerId, { type: 'accept_mission', option: 1 }, `accepts the ruins job (${describeMission(entry.mission)}).`);
    }
    return say(playerId, { type: 'decline_mission' }, 'declines the mission (unqualified, bad odds, or off-strategy).');
  }

  if (pending?.kind === 'space_recruit_offer') {
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof HEART_RECRUITS;
    const recruit = HEART_RECRUITS[rank]!;
    const room = state.crew.length + 1 < state.ship!.capacity;
    // A space recruit attempt is FREE (no permanent mark, no cost — WR §9), so
    // greedy tiers always try with room; medium keeps a sanity threshold.
    if (room && (k.recruit_greedy || margin(bestForStat(state, recruit.idealized).bonus, recruit.min_roll) >= -1.5)) {
      return say(playerId, { type: 'attempt_recruit', recruit_name: recruit.id }, `tries to recruit the drifting ${describeRecruit(recruit)}.`);
    }
    return say(playerId, { type: 'decline_recruit' }, 'leaves the drifter (no room or bad odds).');
  }

  if (pending?.kind === 'ruin_discovery') {
    if (k.delves) return say(playerId, { type: 'enter_ruin', depth: 1 }, 'docks with the ruin to loot the first level (delver).');
    return say(playerId, { type: 'skip_ruin' }, 'passes the ruins by (staying on mission).');
  }

  if (pending?.kind === 'ruin_setup') {
    const map = ruinMapForLevel(pending.level);
    const start = cellsWhere(map, 'S')[0]!;
    const sp = parseCellId(start)!;
    const goalCell = cellsWhere(map, 'G')[0] ?? start;
    const gp = parseCellId(goalCell)!;
    // Place attackers (a) NEVER sealing the start→goal path — sweep-caught on
    // R3: the line-clearance heuristic put an attacker on the only door out
    // of the start pocket, deterministically jailing every retry — and (b)
    // among path-preserving combos, as far as possible from the straight
    // walking line (each cell of clearance is a round of unmolested walking).
    const rows = map.grid!.rows;
    const walkable = (r: number, c: number, blocked: Set<string>): boolean => {
      const ch = rows[r - 1]?.[c - 1];
      return ch !== undefined && ch !== '#' && ch !== '~' && !blocked.has(`r${r}c${c}`);
    };
    const pathOpen = (blocked: Set<string>): boolean => {
      const seen = new Set<string>([start]);
      const queue = [sp];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.r === gp.r && cur.c === gp.c) return true;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const id = `r${cur.r + dr}c${cur.c + dc}`;
          if (seen.has(id) || !walkable(cur.r + dr, cur.c + dc, blocked)) continue;
          seen.add(id);
          queue.push({ r: cur.r + dr, c: cur.c + dc });
        }
      }
      return false;
    };
    const lineSamples: Array<{ r: number; c: number }> = [];
    for (let t = 0; t <= 10; t++) {
      lineSamples.push({ r: sp.r + ((gp.r - sp.r) * t) / 10, c: sp.c + ((gp.c - sp.c) * t) / 10 });
    }
    const spots = cellsWhere(map, 'A').map((cell) => {
      const p = parseCellId(cell)!;
      const clearance = Math.min(...lineSamples.map((s) => Math.max(Math.abs(p.r - s.r), Math.abs(p.c - s.c))));
      return { cell, clearance };
    });
    let bestCombo: { cells: string[]; score: number } | null = null;
    for (let i = 0; i < spots.length; i++)
      for (let j = i + 1; j < spots.length; j++)
        for (let l = j + 1; l < spots.length; l++) {
          const combo = [spots[i]!, spots[j]!, spots[l]!];
          if (!pathOpen(new Set(combo.map((x) => x.cell)))) continue;
          const score = combo.reduce((a, x) => a + x.clearance, 0);
          if (!bestCombo || score > bestCombo.score) bestCombo = { cells: combo.map((x) => x.cell).sort(), score };
        }
    const placements =
      bestCombo?.cells ??
      spots
        .sort((a, b) => b.clearance - a.clearance || a.cell.localeCompare(b.cell))
        .slice(0, 3)
        .map((x) => x.cell); // every combo seals the path (shouldn't happen on the printed maps) — fall back to clearance
    // The stealth line (probe-verified: 0 ground deaths): a natural-SNE≥3
    // character enters ALONE and goal-walks cloaked — Personal Cloaking means
    // attackers can never target a being that never attacks. Delvers keep
    // their party looting game instead.
    if ((state.character?.abilities.SNE ?? 0) >= 3 && k.strategy !== 'delver') {
      return say(playerId, {
        type: 'setup_encounter',
        crew_names: [],
        include_character: true,
        unnamed_count: 0, // the purist cloak-walk: nobody to trip over (A10)
        start_location: start,
        threat_level: 1,
        attacker_placements: placements,
      }, 'slips in ALONE under Personal Cloaking (threat 1) — the crew guards the ship.');
    }
    return say(playerId, {
      type: 'setup_encounter',
      crew_names: state.crew.map((c) => c.name),
      include_character: true,
      start_location: start,
      threat_level: 1,
      attacker_placements: placements,
    }, `sets up the ${map.id} encounter (threat 1, everyone in, attackers far).`);
  }

  if (pending?.kind === 'ruin_turn') {
    const enc = state.encounter;
    if (enc?.kind !== 'ruin_run' || !enc.board) throw new GameError('NO_SUGGESTION', 'ruin_turn without a board.');
    const board = enc.board;
    const map = ruinMapForLevel(enc.level);
    const token = board.tokens.find((t) => !t.ended)!;
    // A cloaked character NEVER acts (attacking breaks Personal Cloaking) —
    // pure pacifist goal-walk (the probe-verified stealth line). EXCEPTION,
    // sweep-caught: attackers who see no one STAND STILL, and standing still
    // can BODY-BLOCK a corridor forever (26 finale attempts, 0 completions,
    // all move-capped). A cloak-build can't fight its way through — so when
    // the walk is physically blocked, RETREAT and RE-ENTER: an abandoned run
    // fails, the finale is retriable (WR §17), and a fresh setup re-rolls the
    // blockers' placement. The cloak makes the walk back free.
    const pacifist = token.is_character && (state.character?.abilities.SNE ?? 0) >= 3 && k.strategy !== 'delver';
    if (pacifist) {
      // One consistent, occupant-aware metric (ruinStepToward) decides both
      // "advance" and "blocked" — mixing wall-only distance with blocked
      // reachability made the walker oscillate between two heuristics.
      const goalCell = ruinGoalCell(state);
      const reach = ruinReachable(state, token.name);
      if (reach.has(goalCell)) {
        return say(playerId, { type: 'move_being', being: token.name, to: goalCell }, `${token.name} ghosts onto the goal!`);
      }
      const step = token.moved === 0 ? ruinStepToward(state, token.name, goalCell) : null;
      if (step) return say(playerId, { type: 'move_being', being: token.name, to: step }, `${token.name} slips forward to ${step}.`);
      if (token.moved === 0) {
        // BLOCKED: unseeing attackers body-block corridors forever. Retreat
        // and re-enter — the run fails, the finale is retriable (WR §17), and
        // a fresh setup re-rolls the blockers. The cloak makes the walk free.
        if (token.cell === board.start_cell) {
          return say(playerId, { type: 'escape_to_start', being: token.name }, `${token.name} slips back out — blocked; reset the board rather than break cloak.`);
        }
        const back = ruinStepToward(state, token.name, board.start_cell);
        if (back) return say(playerId, { type: 'move_being', being: token.name, to: back }, `${token.name} ghosts back toward the entrance (${back}).`);
      }
      return say(playerId, { type: 'end_being_turn', being: token.name }, `${token.name} waits, unseen.`);
    }
    if (!token.acted && !pacifist) {
      // 1. Clear a standing attacker in true range — delvers with DIP try to
      //    CONVERT weak attackers first (a crewmate instead of a corpse).
      const range = ruinAttackRange(state, token.name);
      const target = board.attackers.find((a) => !a.defeated && inAttackRange(map, token.cell, a.cell, range));
      if (target) {
        const crew = state.crew.find((c) => c.name === token.name);
        const dip = token.is_character ? (state.character!.abilities.DIP ?? 0) : (crew?.abilities.DIP ?? 0);
        if (k.delves && dip >= 2 && target.atk <= 3 && state.crew.length + 1 < state.ship!.capacity) {
          return say(playerId, { type: 'convert_attacker', being: token.name, target: target.id }, `${token.name} calls for ${target.id}'s surrender.`);
        }
        return say(playerId, { type: 'attack', being: token.name, target: target.id }, `${token.name} attacks ${target.id}.`);
      }
      // 2. Loot an adjacent cache (delver: also beings) — free value en route.
      const adjacentTo = (ch: 'I' | 'B') => {
        const p = parseCellId(token.cell)!;
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const id = `r${p.r + dr}c${p.c + dc}`;
            const pr = parseCellId(id)!;
            const row = map.grid!.rows[pr.r - 1];
            if (row && row[pr.c - 1] === ch && !board.closed_spots.includes(id)) return true;
          }
        return false;
      };
      if (adjacentTo('I')) return say(playerId, { type: 'collect_item', being: token.name }, `${token.name} opens the adjacent cache.`);
      if (k.delves && adjacentTo('B')) return say(playerId, { type: 'recruit_at', being: token.name }, `${token.name} hails the adjacent figure.`);
    }
    // 3. Delvers detour to reachable loot: end movement next to an open cache.
    const reachable = ruinReachable(state, token.name);
    if (k.delves && !token.acted) {
      const lootAdjacent = [...reachable.keys()]
        .filter((cell) => {
          const p = parseCellId(cell)!;
          for (let dr = -1; dr <= 1; dr++)
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const row = map.grid!.rows[p.r + dr - 1];
              const ch = row?.[p.c + dc - 1];
              const id = `r${p.r + dr}c${p.c + dc}`;
              if ((ch === 'I' || ch === 'B') && !board.closed_spots.includes(id)) return true;
            }
          return false;
        })
        .sort((a, b) => reachable.get(a)! - reachable.get(b)! || a.localeCompare(b))[0];
      if (lootAdjacent && token.moved === 0) {
        return say(playerId, { type: 'move_being', being: token.name, to: lootAdjacent }, `${token.name} moves to the cache at arm's reach (${lootAdjacent}).`);
      }
    }
    // 4. Advance toward the goal by real walking distance.
    const goal = ruinGoalCell(state);
    if (reachable.has(goal)) return say(playerId, { type: 'move_being', being: token.name, to: goal }, `${token.name} makes for the goal!`);
    const current = ruinDistanceToGoal(state, token.cell);
    const best = [...reachable.keys()].sort(
      (a, b) => ruinDistanceToGoal(state, a) - ruinDistanceToGoal(state, b) || a.localeCompare(b),
    )[0];
    if (best && ruinDistanceToGoal(state, best) < current && token.moved === 0) {
      return say(playerId, { type: 'move_being', being: token.name, to: best }, `${token.name} advances to ${best}.`);
    }
    return say(playerId, { type: 'end_being_turn', being: token.name }, `${token.name} holds.`);
  }

  if (pending?.kind === 'ruin_continue') {
    if (pending.is_mission) {
      return say(playerId, { type: 'enter_ruin', depth: pending.next_level }, `descends to level ${pending.next_level} (the job needs it).`);
    }
    return say(playerId, { type: 'skip_ruin' }, 'takes the loot and leaves.');
  }

  if (pending?.kind === 'sacrifice_offer') {
    // A14a: shirts absorb what actually kills runs — the character's death
    // check and hull damage. Credits/unrest land as rolled (bodies are dearer).
    const rank = pending.hazard_card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
    const hazard = SPADE_HAZARDS[rank]!;
    const opt = pending.hazard_option === 2 ? hazard.option2 : hazard.option1;
    const consequence = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[opt.ability]];
    const worthIt = (consequence === 'death' && pending.carrier_who === 'self') || consequence === 'ship_damage';
    if (worthIt) return say(playerId, { type: 'sacrifice_unnamed' }, 'lets an unnamed hand take the hit — the ship and the captain matter more.');
    return say(playerId, { type: 'decline_sacrifice' }, 'takes the consequence — no need to spend a life on it.');
  }

  if (pending?.kind === 'evade_offer') {
    // A5: the evade attempt is FREE on failure (the normal fight just starts),
    // so try it whenever the encounter isn't a PROFITABLE fight. Ghosts and
    // runners always slip away.
    const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof DIAMOND_PIRATES;
    const pirate = DIAMOND_PIRATES[rank]!;
    const wouldFight =
      bestForAbility(state, 'PIL').bonus >= 1 && pirate.special !== 'space_combat_advantage' && pirate.space_attack <= k.fight_max_atk;
    const evadeMargin = margin(bestForAbility(state, 'SNE').bonus, 10 + pirate.speed);
    // The dread corsair WANTS the encounter when the shakedown is favored —
    // tribute is the build's economy (A9).
    if (k.strategy === 'dread' && margin(bestForAbility(state, 'DEM').bonus + (state.dread ?? 0), 10 + pirate.space_attack) >= 0) {
      return say(playerId, { type: 'decline_evade' }, `turns TOWARD the ♦${rank} — easy tribute.`);
    }
    // Near-certain slips beat even profitable fights (a fight's upside never
    // repays a hull-loss tail — sweep-verified: SNE3+PIL2 declining evades to
    // fight died 10× sooner than SNE3 alone).
    if (!wouldFight || evadeMargin >= 2 || k.strategy === 'ghost' || k.strategy === 'runner') {
      return say(playerId, { type: 'attempt_evade' }, `runs silent past the ♦${rank}.`);
    }
    return say(playerId, { type: 'decline_evade' }, `engages the ♦${rank} — a winnable fight is loot and XP.`);
  }

  if (pending?.kind === 'space_combat_action') {
    if (state.encounter?.kind !== 'space_combat') throw new GameError('NO_SUGGESTION', 'space_combat_action without a space combat.');
    const enc = state.encounter;
    if (enc.stage === 'loss_reroll_offer') return say(playerId, { type: 'use_reroll' }, 'burns the Flying Ace reroll.');
    const pirate = DIAMOND_PIRATES[enc.pirate_rank];
    const debuff = enc.pirate_debuff ?? 0;
    const effectiveAtk = pirate.space_attack - debuff - (enc.player_buff ?? 0); // A6 volley + Redline prototype
    const hasAdvantage = bestForAbility(state, 'PIL').bonus >= 1 && pirate.special !== 'space_combat_advantage';
    const hak = bestForAbility(state, 'HAK').bonus;
    const gun = bestForAbility(state, 'GUN').bonus;
    const dem = bestForAbility(state, 'DEM').bonus;
    // A20 Redline: overcharge before committing to exchanges.
    if (
      enc.redline_used !== true &&
      bestForAbility(state, 'MEC').bonus >= 2 &&
      margin(bestForAbility(state, 'MEC').bonus, 12) >= 0 &&
      hasAdvantage &&
      pirate.space_attack - debuff <= k.fight_max_atk + 2
    ) {
      return say(playerId, { type: 'redline' }, 'redlines the engines before the exchange.');
    }
    // A6: soften a tough-but-plannable fight with the once-per-encounter volley.
    if (
      enc.volley_used !== true &&
      gun >= 1 &&
      margin(gun, 12) >= 0 &&
      hasAdvantage &&
      pirate.space_attack >= 3 &&
      effectiveAtk <= k.fight_max_atk
    ) {
      return say(playerId, { type: 'open_fire' }, `opens the engagement with a ranged volley at the ♦${enc.pirate_rank}.`);
    }
    if (hasAdvantage && effectiveAtk <= k.fight_max_atk) {
      return say(playerId, { type: 'fight_round' }, `fights ♦${enc.pirate_rank} — advantage and acceptable odds.`);
    }
    if (hak >= 1 && margin(hak, pirate.min_hacking) >= k.hack_min_margin) {
      return say(playerId, { type: 'attempt_hack' }, 'goes for the hack.');
    }
    // A7/A9: bluff the rabble off entirely when the odds beat a running exit —
    // an intimidate failure keeps you IN the fight, so it must clearly
    // outroll the escape (whose failure still gets you out). Dread (A9b) rides
    // the roll; the dread corsair leans in harder (tribute pays for the risk).
    const escapeMargin = margin(state.ship!.handling + bestForAbility(state, 'PIL').bonus, 10 + pirate.space_attack);
    const intimidateMargin = margin(dem + (state.dread ?? 0), 10 + pirate.space_attack);
    // A13: vs the rabble (atk ≤ 3) a failed bluff now EXITS like a failed
    // escape (one hit, they quit) — so the gate drops to plain better-odds.
    const rabble = pirate.space_attack <= 3;
    const intimidateGate =
      k.strategy === 'dread'
        ? intimidateMargin >= -2
        : rabble
          ? intimidateMargin >= escapeMargin && intimidateMargin >= -1
          : intimidateMargin >= escapeMargin + 1 && intimidateMargin >= -1;
    if (dem >= 1 && intimidateGate) {
      return say(playerId, { type: 'attempt_intimidate' }, `orders the ♦${enc.pirate_rank} to stand down or burn.`);
    }
    return say(playerId, { type: 'attempt_escape' }, 'runs for it.');
  }

  if (pending?.kind === 'boarding_decision') {
    if (state.encounter?.kind !== 'space_combat') throw new GameError('NO_SUGGESTION', 'boarding_decision without a space combat.');
    const enc = state.encounter;
    const pirate = DIAMOND_PIRATES[enc.pirate_rank];
    // A10: free value first — canvass the beaten crew for a body (the pending
    // returns here after the roll).
    if (
      enc.survivors_rolled !== true &&
      bestForAbility(state, 'DIP').bonus >= 1 &&
      (state.unnamed_crew ?? 0) < unnamedCap(state)
    ) {
      return say(playerId, { type: 'recruit_survivors' }, 'canvasses the beaten crew for a spare hand.');
    }
    if (pending.stage === 'board_or_leave') {
      const attack = Math.max(bestForAbility(state, 'SWA').bonus, bestForAbility(state, 'GUN').bonus, bestForAbility(state, 'DEM').bonus);
      const threshold = k.strategy === 'privateer' ? 1 : 2;
      if (k.boards && attack >= threshold && pirate.ground_attack <= (k.strategy === 'privateer' ? 5 : 2)) {
        return say(playerId, { type: 'board_ship' }, 'boards the disabled ship.');
      }
      return say(playerId, { type: 'leave_pirate' }, 'leaves the disabled pirates adrift.');
    }
    const upgrade =
      k.strategy === 'runner'
        ? pirate.speed > state.ship!.speed
        : pirate.capacity > state.ship!.capacity || pirate.speed > state.ship!.speed + 1 || pirate.handling > state.ship!.handling + 1;
    if (upgrade) return say(playerId, { type: 'take_ship' }, 'takes the captured ship (an upgrade, despite arriving Hobbled).');
    return say(playerId, { type: 'abandon_ship' }, 'keeps its own ship.');
  }

  if (pending?.kind === 'level_up') {
    const char = state.character!;
    // Ghost strategy — amendment-A3 arc, level INTO the finale: open SNE at
    // the first even level, deepen to 3 (Personal Cloaking → solo stealth
    // finale). Measured as a DEFAULT policy this halves survival (same trap
    // as fixit-leveling: anything but PIL-stacking costs the midgame), so it
    // is a specialist archetype, not the baseline (AI-NOTES §1/§4).
    if (k.strategy === 'ghost') {
      const sne = char.abilities.SNE ?? 0;
      const reachingEven = (char.level + 1) % 2 === 0;
      if (sne === 0 && reachingEven) return say(playerId, { type: 'level_up', ability: 'SNE' }, 'opens SNE (even-level unlock) — training toward Personal Cloaking.');
      if (sne >= 1 && sne < 3) return say(playerId, { type: 'level_up', ability: 'SNE' }, 'deepens SNE toward Personal Cloaking.');
    }
    if (k.fixit_leveling) {
      const mec = char.abilities.MEC ?? 0;
      if (mec >= 1 && mec < 3) return say(playerId, { type: 'level_up', ability: 'MEC' }, 'levels MEC toward Ms/Mr Fix-it.');
    }
    const owned = (Object.entries(char.abilities) as Array<[AbilityId, number]>)
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return say(playerId, { type: 'level_up', ability: owned[0]![0] }, `levels up ${owned[0]![0]}.`);
  }

  if (pending?.kind === 'release_crew') {
    const weakest = [...state.crew].sort(
      (a, b) => Object.values(a.abilities).reduce((x, y) => x + y, 0) - Object.values(b.abilities).reduce((x, y) => x + y, 0),
    )[0]!;
    return say(playerId, { type: 'release_crew', crew_name: weakest.name }, 'releases the weakest crew member.');
  }

  if (state.phase === 'at_habitat') return habitatMove(state, playerId, k);

  throw new GameError('NO_SUGGESTION', `Bot has no policy for phase ${state.phase} (unexpected — investigate).`);
}

function habitatShopItem(state: WarbleWayGalaxyState, name: string): (ItemDefinition & { cost: number }) | null {
  return HABITATS[state.current_habitat]!.shop.find((s) => s.name === name) ?? null;
}

function habitatMove(state: WarbleWayGalaxyState, playerId: string, k: Knobs): AIMoveResult<WarbleMove> {
  const legal = getLegalMoves(state, playerId);
  const byId = (prefix: string) => legal.find((m) => m.move_id.startsWith(prefix));
  const repair = byId('attempt-repair');
  if (repair) return say(playerId, repair.move, 'attempts a repair roll.');
  // A10: work the docks when the option is open — a body costs one roll.
  const docks = byId('recruit-unnamed');
  if (docks) return say(playerId, docks.move, 'works the docks for an unnamed hand.');
  // A18 Shipwright: hull is king — fabricate ARMOR whenever the chest is deep
  // (armor is the one stat the early shops never sell).
  const fabricate = byId('fabricate-armor');
  if (fabricate && state.character!.credits >= 1200) {
    return say(playerId, fabricate.move, 'fabricates a +1 armor part (Shipwright, A18).');
  }
  // Amendment A1: paid repairs — the hull IS the health bar (95% of losses),
  // so convert surplus credits into damage levels while keeping a working
  // reserve for missions/speed. Free roll always tried first (above).
  if (byId('pay-repair') && state.character!.credits >= k.repair_reserve) {
    return say(playerId, { type: 'pay_repair' }, `pays 150c for yard repairs (${state.ship!.damage} ship, ${state.character!.credits}c).`);
  }
  const unrest = byId('attempt-reduce-unrest');
  if (unrest) return say(playerId, unrest.move, 'attempts to ease crew unrest.');

  // Equip anything bought/found and still unequipped (mechanic coverage, §9):
  // the character first, then crew (spare gear on a shelf helps no one).
  const char = state.character!;
  for (const item of state.items) {
    if (item.type !== 'weapon' && item.type !== 'armor') continue;
    const equippedSomewhere =
      char.gear.weapon === item.id || char.gear.armor === item.id || state.crew.some((c) => c.gear.weapon === item.id || c.gear.armor === item.id);
    if (equippedSomewhere) continue;
    const slot = item.type as 'weapon' | 'armor';
    if (char.gear[slot] === null) {
      return say(playerId, { type: 'equip_item', item_name: item.name, being: char.name }, `straps on the ${item.name}.`);
    }
    const openCrew = state.crew.find((c) => c.gear[slot] === null);
    if (openCrew) {
      return say(playerId, { type: 'equip_item', item_name: item.name, being: openCrew.name }, `hands ${openCrew.name} the ${item.name}.`);
    }
  }

  // GEAR UP, THEN GO: the finale ruin waits directly beyond H3 (no travel
  // cards — entering costs nothing but the run itself), and every H3 mission
  // flown "first" is 14-18 more cards of ship-loss lottery. So at H3: buy the
  // ground kit (+3 GUN / +3 ARM, 800c each — deep hull reserve, credits are
  // hull) and ENTER THE FINALE the moment the party is geared.
  // (The A11 tycoon never gears and never enters — it farms and BANKS toward
  // the Fortune ending; Legend catches the long grinds either way.)
  if (state.current_habitat === 3 && k.strategy !== 'tycoon') {
    // The war chest becomes the war party: gauntlet traces show the party
    // losing ~1 crew per level and dying at R3 with 0 crew + a wounded
    // character — while sitting on 3,600-6,500c. Capacity is BODIES, and
    // bodies are ablative armor (a landed hit kills ONE crew; the character
    // only wounds). Buy the kit, buy the hull space, recruit the cantina dry.
    for (const name of ['Weapon +3 GUN', 'Armor +3 ARM', 'Ship part Capacity +3']) {
      const item = habitatShopItem(state, name);
      if (!item) continue;
      if (state.items.some((i) => i.name === item.name)) continue; // one copy is enough
      if (item.effect.kind === 'ship_stat' && item.effect.stat === 'capacity' && state.ship!.capacity >= 6) continue;
      if (state.character!.credits >= item.cost + 1200 && legal.some((m) => m.move_id === `buy-${item.id}`)) {
        return say(playerId, { type: 'buy_item', item_name: item.name }, `buys the ${item.name} — the finale won't fight fair.`);
      }
    }
    // A16: MK-II the kit before the gauntlet when the chest is deep.
    const tinker = legal.find((m) => m.move_id.startsWith('upgrade-'));
    if (tinker && state.character!.credits >= 1400) {
      return say(playerId, tinker.move, 'puts the kit on the workbench (Tinker, A16).');
    }
    const geared = state.items.some((i) => i.name.startsWith('Weapon +3 GUN')) && state.items.some((i) => i.name.startsWith('Armor +3 ARM'));
    const recruitRows = legal.filter((m) => m.move_id.startsWith('recruit-') && m.move_id !== 'recruit-unnamed');
    const roomLeft = state.crew.length + 1 < state.ship!.capacity;
    if (geared && roomLeft && recruitRows.length > 0 && state.crew.length < 4) {
      // Any-margin attempts: a failed row only marks itself, and every body
      // recruited is a level of the gauntlet survived.
      const ranked = recruitRows
        .map((m) => {
          const r = HABITATS[3]!.cantina.find((c) => c.id === m.move_id.replace('recruit-', ''))!;
          return { m, margin: margin(bestForStat(state, r.idealized).bonus, r.min_roll) };
        })
        .sort((a, b) => b.margin - a.margin);
      return say(playerId, ranked[0]!.m.move, 'recruits for the war party (the gauntlet takes one body per level).');
    }
    const finaleDoor = byId('depart');
    if (geared && finaleDoor && (state.crew.length >= 4 || !roomLeft || recruitRows.length === 0)) {
      return say(playerId, finaleDoor.move, 'enters the SEASON 1 FINALE — geared, crewed, and done waiting.');
    }
  }

  // Everyone farms before marching — measured TWICE: early departure killed
  // the default (−25% score) AND the ghost (126-move runs, 193/200 ship
  // losses in the first harness batch). The uncapped harness shows farming
  // parties still reach the finale 37% of the time; the ghost's edge is the
  // SNE arc + the solo stealth finale, not a faster map.

  const habitat = HABITATS[state.current_habitat]!;
  const recruitMoves = legal.filter((m) => m.move_id.startsWith('recruit-') && m.move_id !== 'recruit-unnamed');
  if (recruitMoves.length > 0 && state.crew.length + 1 < state.ship!.capacity) {
    const ranked = recruitMoves
      .map((m) => {
        const r = habitat.cantina.find((c) => c.id === m.move_id.replace('recruit-', ''))!;
        return { m, r, margin: margin(bestForStat(state, r.idealized).bonus, r.min_roll) };
      })
      .sort((a, b) => b.margin - a.margin);
    if (ranked[0]!.margin >= 0) {
      return say(playerId, ranked[0]!.m.move, `tries to recruit the ${describeRecruit(ranked[0]!.r)}.`);
    }
  }

  // Speed-first economy: fewer cards drawn = fewer ways to die.
  const buys = legal.filter((m) => m.move_id.startsWith('buy-'));
  if (k.speed_first) {
    const speedBuy = buys.find((m) => {
      const item = habitat.shop.find((s) => s.id === m.move_id.replace('buy-', ''))!;
      return item.effect.kind === 'ship_stat' && item.effect.stat === 'speed';
    });
    if (speedBuy) return say(playerId, speedBuy.move, 'buys engine upgrades (fewer cards, fewer funerals).');
  }
  // Targeted survival buys: handling (escapes) and ship armor (every exchange).
  if (k.survival_buys) {
    const lifesaver = buys.find((m) => {
      const item = habitat.shop.find((s) => s.id === m.move_id.replace('buy-', ''))!;
      return item.effect.kind === 'ship_stat' && (item.effect.stat === 'handling' || item.effect.stat === 'armor');
    });
    if (lifesaver) return say(playerId, lifesaver.move, 'buys survival hardware (handling/armor).');
  }

  const missions = habitat.missions.filter((m) => legal.some((l) => l.move_id === `take-mission-${m.id}`));
  const mission = bestMissionOption(state, missions, k);
  if (mission) return say(playerId, { type: 'take_mission', mission_name: mission.id }, `takes the ${describeMission(mission)} mission.`);
  // Delvers take ruins missions when nothing better is on the board.
  if (k.delves) {
    const ruinsMission = missions.find((m) => m.goal.kind === 'ruin');
    if (ruinsMission) return say(playerId, { type: 'take_mission', mission_name: ruinsMission.id }, `takes the ${describeMission(ruinsMission)} ruins job.`);
  }
  const depart = byId('depart');
  if (depart) return say(playerId, depart.move, `departs Habitat #${state.current_habitat}.`);
  // Marginal missions beat idling (H1's 4-mission gate must be fed).
  const anyMission = missions.find((m) => m.goal.kind === 'ability_check');
  if (anyMission) return say(playerId, { type: 'take_mission', mission_name: anyMission.id }, `takes the ${describeMission(anyMission)} mission (nothing better to do).`);
  // A ruins job without a fighter aboard is a death march — take it only with
  // a real attack (or a delver build)…
  const anyRuins = missions.find((m) => m.goal.kind === 'ruin');
  if (anyRuins && canFightRuins(state, k)) {
    return say(playerId, { type: 'take_mission', mission_name: anyRuins.id }, `takes the ${describeMission(anyRuins)} ruins job (last resort).`);
  }
  // …otherwise dig out: any purchase can help (a "+1 Any" consumable
  // re-qualifies ability missions), and even a bad-odds recruit adds scores.
  if (buys.length > 0) {
    const cheapest = buys
      .map((m) => ({ m, cost: habitat.shop.find((s) => s.id === m.move_id.replace('buy-', ''))!.cost }))
      .sort((a, b) => a.cost - b.cost)[0]!;
    return say(playerId, cheapest.m.move, 'buys the cheapest useful gear (digging out of a dry habitat).');
  }
  const desperateRecruit = legal.find((m) => m.move_id.startsWith('recruit-') && m.move_id !== 'recruit-unnamed');
  if (desperateRecruit && state.crew.length + 1 < state.ship!.capacity) {
    return say(playerId, desperateRecruit.move, 'tries a long-shot recruit (any new scores help).');
  }
  // Truly cornered: the ruins job beats wedging (the printed game has the same
  // corner — see POST-PORT edge case 2).
  if (anyRuins) return say(playerId, { type: 'take_mission', mission_name: anyRuins.id }, `braves the ${describeMission(anyRuins)} ruins job (cornered).`);
  // Absolute backstop: if ANYTHING is legal, do it rather than throw — e.g.
  // pay-repair below the policy's credit reserve as the last action standing
  // (harness-caught with a PIL3/GUN2/MEC1 build). The engine's MAROONED rule
  // handles the truly-empty case; the bot must never wedge above it.
  const anything = legal[0];
  if (anything) return say(playerId, anything.move, `takes the only action left (${anything.move_id}).`);
  throw new GameError('NO_SUGGESTION', 'Bot has exhausted its actions at this habitat (unexpected — investigate).');
}
