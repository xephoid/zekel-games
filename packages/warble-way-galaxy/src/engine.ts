import { GameError } from '@zekel/game-kit';
import { isDigitalSeat, type PlayerConfig } from '@zekel/game-kit';
import { ABILITY_NAMES, ABILITY_STAT, HAZARD_CONSEQUENCE_BY_STAT, STAT_ABILITIES } from './data/abilities.js';
import { archetypeNameList, resolveArchetype } from './data/archetypes.js';
import type { HazardConsequence } from './data/abilities.js';
import { cardId, cardName, fullDeckIds, resolveCardName } from './data/cards.js';
import { HABITATS } from './data/habitats.js';
import { minXpForLevel } from './data/levels.js';
import {
  CLUB_MISSIONS,
  DIAMOND_PIRATES,
  DIAMOND_RUINS,
  HEART_RECRUITS,
  SPADE_HAZARDS,
} from './data/travelTables.js';
import type { PirateDefinition, PirateRank, RuinDiamondRank } from './data/travelTables.js';
import { nextSeed, randomSeed, rollDice, shuffle } from './rng.js';
import type {
  AbilityId,
  AbilityScores,
  CrewMember,
  HabitatProgress,
  ItemDefinition,
  MissionDefinition,
  PlayingCard,
  Race,
  RecruitDefinition,
  ShipDamage,
  SpaceCombatEncounter,
  StatId,
  WarbleEnding,
  WarbleMove,
  WarbleOptions,
  WarbleWayGalaxyState,
} from './types.js';

// The complete Season 1 engine: creation + habitat (M1), missions/travel/
// hazards/losses (M2), space combat/hacking/boarding/capture (M3), and the
// ruins grid game + finale win condition (M4). Every rule cites the frozen
// WARBLE-RULES.md (WR §n).

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function freshHabitatProgress(startingHere: boolean): HabitatProgress {
  return {
    missions_attempted: [],
    missions_succeeded: [],
    purchased: [],
    recruits_failed: [],
    recruits_hired: [],
    // Repair/unrest rolls happen "every time you arrive at a habitat AFTER
    // SPACE TRAVEL" (WR §6). Game start is not an arrival, so the starting
    // habitat's once-per-arrival rolls are already spent.
    repair_rolled_this_arrival: startingHere,
    unrest_rolled_this_arrival: startingHere,
  };
}

export function createInitialState(players: PlayerConfig[], options?: WarbleOptions): WarbleWayGalaxyState {
  const seat = players[0];
  // Digital mode (docs/digital-mode.md): a digital seat's hidden state lives
  // on the server. For this game that means the travel deck's ORDER and the
  // dice — so digital sessions shuffle a real deck from the seed, and the
  // `seed` field stops being bot-only. Physical sessions see no change: seed
  // was always present, and deck.order stays absent.
  const digital = seat !== undefined && isDigitalSeat(seat);
  const seed = options?.seed ?? randomSeed();
  const state: WarbleWayGalaxyState = {
    phase: 'creation',
    pending: null,
    character: null,
    crew: [],
    ship: null,
    items: [],
    consumed_item_ids: [],
    current_habitat: 1,
    habitat_progress: { 1: freshHabitatProgress(true), 2: freshHabitatProgress(false), 3: freshHabitatProgress(false) },
    deck: { remaining: fullDeckIds(), discard: [] },
    journey_stack: [],
    encounter: null,
    final_ruin_started: false,
    seed,
    seat_kind: seat?.kind,
    digital_seat: digital,
    result: null,
  };
  if (digital) {
    const sh = shuffle(state.deck.remaining, state.seed);
    state.deck.remaining = sh.items;
    state.deck.order = [...sh.items];
    state.seed = sh.nextSeed;
  }
  // AI seats create their character via getAIMove (a STRATEGIC choice — the
  // tier/strategy picks the scores; ai-development gate). Humans walk the
  // setup checklist. Both paths go through the same create_character move.
  return state;
}

// ---------------------------------------------------------------------------
// Score helpers: natural (advanced skills) vs effective (natural + equipped gear)
// ---------------------------------------------------------------------------

interface Being {
  name: string;
  natural: AbilityScores;
  gear: { weapon: string | null; armor: string | null };
  is_character: boolean;
}

function beings(state: WarbleWayGalaxyState): Being[] {
  const all: Being[] = [];
  if (state.character) {
    all.push({ name: state.character.name, natural: state.character.abilities, gear: state.character.gear, is_character: true });
  }
  for (const c of state.crew) all.push({ name: c.name, natural: c.abilities, gear: c.gear, is_character: false });
  return all;
}

function itemById(state: WarbleWayGalaxyState, id: string | null): ItemDefinition | null {
  if (!id) return null;
  return state.items.find((i) => i.id === id) ?? null;
}

/** Effective score = natural + equipped weapon/armor ability bonuses (WR §2:
 * items boost scores). Amendment A4: a WOUNDED character takes −1 on every
 * effective score (floor 0) until healed at a habitat arrival. */
export function effectiveScore(state: WarbleWayGalaxyState, being: Being, ability: AbilityId): number {
  let score = being.natural[ability] ?? 0;
  for (const gearId of [being.gear.weapon, being.gear.armor]) {
    const item = itemById(state, gearId);
    if (item && item.effect.kind === 'ability_bonus' && item.effect.ability === ability) score += item.effect.bonus;
  }
  if (being.is_character && state.character?.wounded === true) score = Math.max(0, score - 1);
  return score;
}

/** Highest effective score for one ability across character + crew. */
export function bestForAbility(
  state: WarbleWayGalaxyState,
  ability: AbilityId,
): { bonus: number; who: 'self' | 'crew'; crew_name?: string } {
  let best: { bonus: number; who: 'self' | 'crew'; crew_name?: string } = { bonus: 0, who: 'self' };
  for (const b of beings(state)) {
    const s = effectiveScore(state, b, ability);
    if (s > best.bonus) best = b.is_character ? { bonus: s, who: 'self' } : { bonus: s, who: 'crew', crew_name: b.name };
  }
  return best;
}

/** Highest effective score under a STAT (any of its 3 abilities) — recruiting (WR §6). */
export function bestForStat(
  state: WarbleWayGalaxyState,
  stat: StatId,
): { bonus: number; ability: AbilityId | null; who: 'self' | 'crew'; crew_name?: string } {
  let best: { bonus: number; ability: AbilityId | null; who: 'self' | 'crew'; crew_name?: string } = {
    bonus: 0,
    ability: null,
    who: 'self',
  };
  for (const ability of STAT_ABILITIES[stat]) {
    const b = bestForAbility(state, ability);
    if (b.bonus > best.bonus) best = { ...b, ability };
  }
  return best;
}

export function anyoneHasEffective(state: WarbleWayGalaxyState, ability: AbilityId): boolean {
  return beings(state).some((b) => effectiveScore(state, b, ability) >= 1);
}

/** Natural score ≥3 on the CHARACTER — advanced skills; item boosts don't count (WR §5). */
export function characterHasAdvanced(state: WarbleWayGalaxyState, ability: AbilityId): boolean {
  return (state.character?.abilities[ability] ?? 0) >= 3;
}

// ---------------------------------------------------------------------------
// Ship damage ladder
// ---------------------------------------------------------------------------

const DAMAGE_ORDER: ShipDamage[] = ['hobbled', 'damaged', 'used', 'pristine'];

export function repairShipOneLevel(damage: ShipDamage): ShipDamage {
  const i = DAMAGE_ORDER.indexOf(damage);
  return DAMAGE_ORDER[Math.min(i + 1, DAMAGE_ORDER.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Name resolution (accept the printed name)
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function describeRecruit(r: RecruitDefinition): string {
  const abil = Object.entries(r.abilities)
    .map(([a, v]) => `${a} +${v}`)
    .join(' ');
  const race = r.race.charAt(0).toUpperCase() + r.race.slice(1);
  return `${race} (${abil}, min roll ${r.min_roll})`;
}

function resolveCantinaRecruit(state: WarbleWayGalaxyState, requested: string): RecruitDefinition {
  const habitat = HABITATS[state.current_habitat]!;
  const want = normalize(requested);
  const hit =
    habitat.cantina.find((r) => normalize(r.id) === want) ??
    habitat.cantina.find((r) => normalize(describeRecruit(r)).includes(want) && want.length >= 4) ??
    habitat.cantina.find((r) => normalize(`${r.race} ${Object.entries(r.abilities).map(([a, v]) => `${a}${v}`).join(' ')}`) === want);
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No cantina recruit at ${habitat.name} matches "${requested}". Available: ${habitat.cantina
        .map((r) => describeRecruit(r))
        .join('; ')}. Use the description or pick from get_legal_moves.`,
    );
  }
  return hit;
}

function resolveShopItem(state: WarbleWayGalaxyState, requested: string): ItemDefinition & { cost: number } {
  const habitat = HABITATS[state.current_habitat]!;
  const want = normalize(requested);
  const hit =
    habitat.shop.find((i) => normalize(i.id) === want) ??
    habitat.shop.find((i) => normalize(i.name) === want) ??
    habitat.shop.find((i) => normalize(i.name).includes(want) && want.length >= 4);
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No shop item at ${habitat.name} matches "${requested}". On offer: ${habitat.shop
        .map((i) => `${i.name} (${i.cost}c)`)
        .join('; ')}.`,
    );
  }
  return hit;
}

function resolveOwnedItem(state: WarbleWayGalaxyState, requested: string): ItemDefinition {
  const want = normalize(requested);
  // Duplicate printed names are real (a looted "Consumable PIL +3" alongside a
  // bought one) — among name matches, prefer an instance that is still USABLE
  // (not consumed, not already declared on the open roll), so referring to an
  // item by its printed name always reaches a live copy.
  const usable = (i: ItemDefinition) =>
    !state.consumed_item_ids.includes(i.id) &&
    !(state.pending?.kind === 'roll' && state.pending.declared_items.includes(i.id));
  const pickPreferUsable = (candidates: ItemDefinition[]): ItemDefinition | undefined =>
    candidates.find(usable) ?? candidates[0];
  const hit =
    pickPreferUsable(state.items.filter((i) => normalize(i.id) === want)) ??
    pickPreferUsable(state.items.filter((i) => normalize(i.name) === want)) ??
    pickPreferUsable(state.items.filter((i) => normalize(i.name).includes(want) && want.length >= 4));
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `You don't own an item matching "${requested}". Owned: ${state.items.map((i) => i.name).join('; ') || '(none)'}.`,
    );
  }
  return hit;
}

function resolveBeingName(state: WarbleWayGalaxyState, requested: string): Being {
  const want = normalize(requested);
  const hit = beings(state).find((b) => normalize(b.name) === want) ?? beings(state).find((b) => normalize(b.name).includes(want) && want.length >= 3);
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No one aboard matches "${requested}". Aboard: ${beings(state)
        .map((b) => b.name)
        .join('; ')}.`,
    );
  }
  return hit;
}

function resolveCrewName(state: WarbleWayGalaxyState, requested: string): CrewMember {
  const want = normalize(requested);
  const hit =
    state.crew.find((c) => normalize(c.name) === want) ?? state.crew.find((c) => normalize(c.name).includes(want) && want.length >= 3);
  if (!hit) {
    throw new GameError('ILLEGAL_MOVE', `No crew member matches "${requested}". Crew: ${state.crew.map((c) => c.name).join('; ') || '(none)'}.`);
  }
  return hit;
}

// ---------------------------------------------------------------------------
// Pending settlement — after any resolution, surface the next owed decision.
// Pending-state hygiene (CLAUDE.md): every path that can set a pending also
// explicitly clears it; this is the single place follow-on pendings arise.
// ---------------------------------------------------------------------------

function settlePending(state: WarbleWayGalaxyState): void {
  if (state.pending !== null) return;
  const char = state.character;
  if (!char || !state.ship) return;
  // Over capacity (recruit/capture): someone must go (WR §6).
  if (state.crew.length + 1 > state.ship.capacity) {
    state.pending = { kind: 'release_crew' };
    return;
  }
  // Level-up owed (WR §15) — the ABILITY CHOICE is the player's, never auto.
  if (char.xp >= minXpForLevel(char.level)) {
    state.pending = { kind: 'level_up' };
  }
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

export interface EngineResult {
  newState: WarbleWayGalaxyState;
  summary: string;
}

// Deliberate one-direction-at-call-time cycle: legalMoves.ts uses this
// module's helpers; the stranded check below enumerates legal moves. Neither
// executes the other at module load, so the ESM cycle is safe.
import { getLegalMoves as enumerateLegalMoves } from './legalMoves.js';

/** The marooned corner (POST-PORT edge case 2; ⚠ clarification): a player at a
 * habitat with NO legal action left (missions exhausted/unqualified, broke,
 * recruits resolved) cannot continue by the printed rules — the run ends as a
 * loss rather than wedging forever. */
function maybeStrand(state: WarbleWayGalaxyState): string | null {
  if (state.phase !== 'at_habitat' || state.pending !== null || state.result !== null) return null;
  if (enumerateLegalMoves(state, 'stranded-check').length > 0) return null;
  setLoss(
    state,
    `Marooned at Habitat #${state.current_habitat} — no mission you qualify for, nothing affordable, no one left to recruit. The run is over (post-freeze clarification #9).`,
  );
  return 'MAROONED — no legal action remains: the run ends here (⚠ post-freeze clarification #9).';
}

export function applyMove(prior: WarbleWayGalaxyState, move: WarbleMove): EngineResult {
  const r = applyMoveInner(prior, move);
  const note = maybeStrand(r.newState);
  return note ? { newState: r.newState, summary: `${r.summary} ${note}` } : r;
}

function applyMoveInner(prior: WarbleWayGalaxyState, move: WarbleMove): EngineResult {
  if (prior.result !== null) throw new GameError('GAME_OVER', 'The game is over.');
  const state = structuredClone(prior);

  switch (move.type) {
    case 'create_character':
      return { newState: state, summary: applyCreation(state, move) };
    case 'buy_item':
      return { newState: state, summary: applyBuy(state, move.item_name) };
    case 'equip_item':
      return { newState: state, summary: applyEquip(state, move.item_name, move.being) };
    case 'attempt_recruit':
      // Routes by context: a ♥ space-recruit offer resolves the pending; else the cantina.
      return {
        newState: state,
        summary:
          state.pending?.kind === 'space_recruit_offer'
            ? applyAttemptSpaceRecruit(state)
            : applyAttemptRecruit(state, move.recruit_name),
      };
    case 'attempt_repair':
      return { newState: state, summary: applyAttemptRepair(state) };
    case 'pay_repair':
      return { newState: state, summary: applyPayRepair(state) };
    case 'recruit_unnamed':
      return { newState: state, summary: applyRecruitUnnamed(state) };
    case 'recruit_survivors':
      return { newState: state, summary: applyRecruitSurvivors(state) };
    case 'upgrade_item':
      return { newState: state, summary: applyUpgradeItem(state, move.item_name) };
    case 'fabricate_part':
      return { newState: state, summary: applyFabricatePart(state, move.stat) };
    case 'redline':
      return { newState: state, summary: applyRedline(state) };
    case 'sacrifice_unnamed':
      return { newState: state, summary: applySacrificeUnnamed(state) };
    case 'decline_sacrifice':
      return { newState: state, summary: applyDeclineSacrifice(state) };
    case 'attempt_reduce_unrest':
      return { newState: state, summary: applyAttemptUnrest(state) };
    case 'release_crew':
      return { newState: state, summary: applyReleaseCrew(state, move.crew_name) };
    case 'report_roll':
      return { newState: state, summary: applyReportRoll(state, move.dice) };
    case 'use_item':
      return { newState: state, summary: applyUseItem(state, move.item_name, move.ability) };
    case 'level_up':
      return { newState: state, summary: applyLevelUp(state, move.ability) };
    // ---- M2: missions & travel
    case 'take_mission':
      return { newState: state, summary: applyTakeMission(state, move.mission_name) };
    case 'depart_for_next_habitat':
      return { newState: state, summary: applyDepart(state) };
    case 'report_card_draw':
      return { newState: state, summary: applyReportCardDraw(state, move.card) };
    case 'resolve_report':
      return { newState: state, summary: applyResolveReport(state) };
    case 'report_res_discard':
      return { newState: state, summary: applyReportResDiscard(state, move.card) };
    case 'skip_res_peek':
      return { newState: state, summary: applySkipResPeek(state) };
    case 'choose_hazard_option':
      return { newState: state, summary: applyChooseHazardOption(state, move.option, move.carrier) };
    case 'accept_mission':
      return { newState: state, summary: applyAcceptMission(state, move.option) };
    case 'decline_mission':
      return { newState: state, summary: applyDeclineMission(state) };
    case 'decline_recruit':
      return { newState: state, summary: applyDeclineRecruit(state) };
    case 'skip_ruin':
      return { newState: state, summary: applySkipRuin(state) };
    case 'enter_ruin':
      return { newState: state, summary: applyEnterRuin(state, move.depth) };
    // ---- M3: space combat
    case 'attempt_evade':
      return { newState: state, summary: applyAttemptEvade(state) };
    case 'decline_evade':
      return { newState: state, summary: applyDeclineEvade(state) };
    case 'attempt_escape':
      return { newState: state, summary: applyAttemptEscape(state) };
    case 'attempt_hack':
      return { newState: state, summary: applyAttemptHack(state) };
    case 'open_fire':
      return { newState: state, summary: applyOpenFire(state) };
    case 'attempt_intimidate':
      return { newState: state, summary: applyAttemptIntimidate(state) };
    case 'fight_round':
      return { newState: state, summary: applyFightRound(state) };
    case 'use_reroll':
      return { newState: state, summary: applyUseReroll(state) };
    case 'accept_result':
      return { newState: state, summary: applyAcceptResult(state) };
    case 'board_ship':
      return { newState: state, summary: applyBoardShip(state) };
    case 'leave_pirate':
      return { newState: state, summary: applyLeavePirate(state) };
    case 'take_ship':
      return { newState: state, summary: applyTakeShip(state) };
    case 'abandon_ship':
      return { newState: state, summary: applyAbandonShip(state) };
    // ---- M4: ruins
    case 'setup_encounter':
      return { newState: state, summary: applySetupEncounter(state, move) };
    case 'move_being':
      return { newState: state, summary: applyMoveBeing(state, move.being, move.to) };
    case 'attack':
      return { newState: state, summary: applyAttack(state, move.being, move.target) };
    case 'collect_item':
      return { newState: state, summary: applyCollectItem(state, move.being) };
    case 'recruit_at':
      return { newState: state, summary: applyRecruitAt(state, move.being) };
    case 'convert_attacker':
      return { newState: state, summary: applyConvertAttacker(state, move.being, move.target) };
    case 'escape_to_start':
      return { newState: state, summary: applyEscapeToStart(state, move.being) };
    case 'end_being_turn':
      return { newState: state, summary: applyEndBeingTurn(state, move.being) };
    default: {
      const exhaustive: never = move;
      throw new GameError('INVALID_MOVE_SHAPE', `Unknown move type ${JSON.stringify(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const VALID_RACES: Race[] = ['human', 'kralkin', 'hexapod', 'grull'];

function applyCreation(
  state: WarbleWayGalaxyState,
  move: Extract<WarbleMove, { type: 'create_character' }>,
): string {
  if (state.phase !== 'creation') throw new GameError('ILLEGAL_MOVE', 'Character creation is already complete.');
  if (!move.character_name?.trim()) throw new GameError('ILLEGAL_MOVE', 'character_name must not be empty.');
  if (!move.ship_name?.trim()) throw new GameError('ILLEGAL_MOVE', 'ship_name must not be empty.');
  if (!VALID_RACES.includes(move.race)) {
    throw new GameError('ILLEGAL_MOVE', `race must be one of: ${VALID_RACES.join(', ')}. Got "${move.race}".`);
  }
  // Amendment A21 "Archetype cards": a named pre-built 3/2/1 spread with a
  // printed difficulty — the card defines the scores, the player skips the math.
  let archetypeNote = '';
  let scores = move.scores ?? {};
  if (move.method === 'archetype') {
    if (!move.archetype_name?.trim()) {
      throw new GameError('ILLEGAL_MOVE', `The archetype method needs archetype_name — one of: ${archetypeNameList()}.`);
    }
    const card = resolveArchetype(move.archetype_name);
    if (!card) {
      throw new GameError('ILLEGAL_MOVE', `Unknown archetype "${move.archetype_name}". The cards are: ${archetypeNameList()}.`);
    }
    scores = card.scores;
    archetypeNote = ` — the ${card.name} (difficulty ${card.stars})`;
  }
  // Canonical ability order, NOT the client's JSON key order: the ability map's
  // insertion order is real state (level-up options and their move_menu keys
  // enumerate it), and two clients declaring the same spread with differently
  // ordered keys must produce byte-identical characters. The desync harness
  // caught this as a phantom ref/model menu divergence 54 turns after creation.
  const abilityOrder = Object.keys(ABILITY_NAMES);
  const entries = (Object.entries(scores).filter(([, v]) => (v ?? 0) !== 0) as Array<[AbilityId, number]>)
    .sort((x, y) => abilityOrder.indexOf(x[0]) - abilityOrder.indexOf(y[0]));
  for (const [a, v] of entries) {
    if (!(a in ABILITY_NAMES)) throw new GameError('ILLEGAL_MOVE', `Unknown ability "${a}".`);
    if (!Number.isInteger(v) || v < 1) throw new GameError('ILLEGAL_MOVE', `Score for ${a} must be a positive integer.`);
  }
  if (move.method === 'recommended') {
    const values = entries.map(([, v]) => v).sort((x, y) => x - y);
    if (values.length !== 3 || values[0] !== 1 || values[1] !== 2 || values[2] !== 3) {
      throw new GameError(
        'ILLEGAL_MOVE',
        'The recommended method is exactly three abilities scored 3, 2 and 1 (WR §2). Example: { SWA: 3, HAK: 2, SNE: 1 }.',
      );
    }
  } else if (move.method === 'distribute') {
    const total = entries.reduce((sum, [, v]) => sum + v, 0);
    if (total !== 6) throw new GameError('ILLEGAL_MOVE', `The distribute method spends exactly 6 points (WR §2); you spent ${total}.`);
    for (const [a, v] of entries) {
      if (v > 3) throw new GameError('ILLEGAL_MOVE', `Max 3 points in one ability at creation (ruling #1); ${a} has ${v}.`);
    }
  } else if (move.method !== 'archetype') {
    throw new GameError('ILLEGAL_MOVE', 'method must be "recommended" (3/2/1), "distribute" (6 points, max 3 each), or "archetype" (a named card — amendment A21).');
  }

  state.character = {
    name: move.character_name.trim(),
    race: move.race,
    disposition: move.disposition ?? null,
    abilities: Object.fromEntries(entries) as AbilityScores,
    level: 1,
    xp: 0,
    credits: 200,
    gear: { weapon: null, armor: null },
  };
  state.ship = {
    name: move.ship_name.trim(),
    capacity: 3,
    speed: 0,
    handling: 0,
    armor: 0,
    damage: 'used',
    parts: [],
  };
  state.phase = 'at_habitat';
  const scoreText = entries.map(([a, v]) => `${a} +${v} (${ABILITY_NAMES[a]})`).join(', ');
  return (
    `${state.character.name} the ${move.race} takes command of the ${state.ship.name}${archetypeNote}: ${scoreText}. ` +
    `200 credits; ship capacity 3, speed 0, damage Used. Docked at Habitat #1 — ${HABITATS[1]!.name}.`
  );
}

function requireAtHabitatNoPending(state: WarbleWayGalaxyState, action: string): void {
  if (state.phase !== 'at_habitat') throw new GameError('ILLEGAL_MOVE', `${action} is only possible at a habitat.`);
  if (state.pending !== null) {
    throw new GameError('ILLEGAL_MOVE', `Resolve the open ${state.pending.kind} first (see next_step), then ${action}.`);
  }
}

function applyBuy(state: WarbleWayGalaxyState, itemName: string): string {
  requireAtHabitatNoPending(state, 'buying');
  const char = state.character!;
  const progress = state.habitat_progress[state.current_habitat]!;
  const item = resolveShopItem(state, itemName);
  if (progress.purchased.includes(item.id)) {
    throw new GameError('ILLEGAL_MOVE', `${item.name} was already purchased — habitat shop items are one-shot (WR §6).`);
  }
  if (char.credits < item.cost) {
    throw new GameError('ILLEGAL_MOVE', `${item.name} costs ${item.cost}c; you have ${char.credits}c.`);
  }
  char.credits -= item.cost;
  progress.purchased.push(item.id);
  const owned: ItemDefinition = { id: item.id, name: item.name, type: item.type, effect: item.effect };
  state.items.push(owned);
  let extra = '';
  if (item.type === 'ship_part') {
    const ship = state.ship!;
    ship.parts.push(item.id);
    if (item.effect.kind === 'ship_stat') {
      ship[item.effect.stat] += item.effect.bonus;
      extra = ` Ship ${item.effect.stat} is now ${ship[item.effect.stat]}.`;
    } else if (item.effect.kind === 'space_combat_advantage') {
      extra = ' The ship now has Space Combat Advantage.';
    }
  } else if (item.type === 'weapon' || item.type === 'armor') {
    extra = ` Equip it with equip_item (one ${item.type} per being).`;
  }
  settlePending(state);
  return `Bought ${item.name} for ${item.cost}c (${char.credits}c left).${extra}`;
}

function applyEquip(state: WarbleWayGalaxyState, itemName: string, beingName: string): string {
  // Equipping is a free action: at a habitat (no pending), or during the party
  // phase of a ruin encounter ("you may equip it immediately", WR §14).
  const inRuinPhase = state.phase === 'ruin' && state.pending?.kind === 'ruin_turn';
  if (!inRuinPhase) requireAtHabitatNoPending(state, 'equipping');
  const item = resolveOwnedItem(state, itemName);
  if (item.type !== 'weapon' && item.type !== 'armor') {
    throw new GameError('ILLEGAL_MOVE', `${item.name} is a ${item.type} — only weapons and armor are equipped (WR §6).`);
  }
  const being = resolveBeingName(state, beingName);
  const slot = item.type;
  // Unequip from any current holder (an item exists once).
  for (const b of beings(state)) {
    if (b.gear[slot] === item.id) setGear(state, b.name, slot, null);
  }
  const previous = being.gear[slot];
  setGear(state, being.name, slot, item.id);
  settlePending(state);
  return (
    `${being.name} equips ${item.name}${previous ? ` (replacing ${itemById(state, previous)!.name}, now unequipped)` : ''}.`
  );
}

function setGear(state: WarbleWayGalaxyState, beingName: string, slot: 'weapon' | 'armor', itemId: string | null): void {
  if (state.character && state.character.name === beingName) {
    state.character.gear[slot] = itemId;
    return;
  }
  const crew = state.crew.find((c) => c.name === beingName);
  if (crew) crew.gear[slot] = itemId;
}

function applyAttemptRecruit(state: WarbleWayGalaxyState, recruitName: string): string {
  requireAtHabitatNoPending(state, 'recruiting');
  const progress = state.habitat_progress[state.current_habitat]!;
  const recruit = resolveCantinaRecruit(state, recruitName);
  if (progress.recruits_failed.includes(recruit.id)) {
    throw new GameError('ILLEGAL_MOVE', `You already failed to recruit ${describeRecruit(recruit)} here — they are permanently marked (WR §6).`);
  }
  if (progress.recruits_hired.includes(recruit.id)) {
    throw new GameError('ILLEGAL_MOVE', `${describeRecruit(recruit)} already joined your crew.`);
  }
  const best = bestForStat(state, recruit.idealized);
  // ACT adds a d6 when recruiting Hexapods or Kralkin (WR §4 — their idealized
  // stats are Smarts/Moxie, consistent with the ACT skill text).
  const actDie = anyoneHasEffective(state, 'ACT') && (recruit.race === 'hexapod' || recruit.race === 'kralkin') ? 1 : 0;
  state.pending = {
    kind: 'roll',
    reason: 'recruit',
    dice_count: 3 + actDie,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: best.ability, bonus: best.bonus },
    min_roll: recruit.min_roll,
    declared_items: [],
    context: { recruit_id: recruit.id, recruit_source: 'cantina' },
  };
  return (
    `Recruiting ${describeRecruit(recruit)} — they idealize ${recruit.idealized}. ` +
    `Best ${recruit.idealized} aboard: ${best.ability ? `${best.ability} +${best.bonus} (${best.who === 'self' ? 'you' : best.crew_name})` : 'nothing (+0)'}. ` +
    `Roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} and report the dice; you need ${recruit.min_roll}+.`
  );
}

function applyAttemptRepair(state: WarbleWayGalaxyState): string {
  requireAtHabitatNoPending(state, 'repairing');
  const progress = state.habitat_progress[state.current_habitat]!;
  const ship = state.ship!;
  if (progress.repair_rolled_this_arrival) {
    throw new GameError('ILLEGAL_MOVE', 'The repair roll is once per arrival after space travel (WR §6) — already used here.');
  }
  if (ship.damage === 'pristine') throw new GameError('ILLEGAL_MOVE', `The ${ship.name} is already Pristine.`);
  const best = bestForAbility(state, 'MEC');
  if (best.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Repairing needs any amount of MEC among you or your crew (WR §6).');
  progress.repair_rolled_this_arrival = true; // the attempt consumes the once-per-arrival roll
  state.pending = {
    kind: 'roll',
    reason: 'repair',
    dice_count: 3,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: 'MEC', bonus: best.bonus },
    min_roll: 10, // amendment A1b: was 12 (repair reliability is the anti-monoculture lever)
    declared_items: [],
    context: {},
  };
  return `Repair attempt: roll 3d6 + MEC ${best.bonus} (${best.who === 'self' ? 'you' : best.crew_name}); 10+ raises the ship one damage level (amendment A1b).`;
}

/** Amendment A16 "Tinker" (natural MEC 3 aboard): at a habitat, pay 200c to
 * add +1 to one owned weapon's or armor's ability bonus — once per item
 * (an MK-II stamp, not an infinite forge). */
export const TINKER_COST = 200;
export function applyUpgradeItem(state: WarbleWayGalaxyState, itemName: string): string {
  requireAtHabitatNoPending(state, 'tinkering');
  if (!anyBeingHasAdvanced(state, 'MEC')) throw new GameError('ILLEGAL_MOVE', 'Tinkering needs natural MEC 3 aboard (Tinker, amendment A16).');
  const item = resolveOwnedItem(state, itemName);
  if (item.type !== 'weapon' && item.type !== 'armor') throw new GameError('ILLEGAL_MOVE', `${item.name} is a ${item.type} — Tinker upgrades weapons and armor (amendment A16).`);
  if (item.effect.kind !== 'ability_bonus') throw new GameError('ILLEGAL_MOVE', `${item.name} has no ability bonus to improve.`);
  if (item.upgraded === true) throw new GameError('ILLEGAL_MOVE', `${item.name} is already an MK-II — once per item (amendment A16).`);
  const char = state.character!;
  if (char.credits - TINKER_COST <= DEBT_LIMIT) {
    throw new GameError('ILLEGAL_MOVE', `Paying ${TINKER_COST}c would cross the −300 debt line.`);
  }
  char.credits -= TINKER_COST;
  item.effect.bonus += 1;
  item.upgraded = true;
  item.name = `${item.name} MK-II`;
  return `The workbench sings: ${item.name} now grants +${item.effect.bonus} ${item.effect.ability} (${TINKER_COST}c; Tinker, amendment A16). Credits: ${char.credits}.`;
}

/** Amendment A18 "Shipwright" (natural MEC 3 aboard): at a habitat, pay 400c
 * to FABRICATE a +1 ship part — speed, handling, or armor — once per habitat
 * visit. The point isn't the discount: it breaks the shop LOCATION LOCK
 * (one-way travel means H1 never sells armor and H3 never sells speed). */
export const FABRICATE_COST = 400;
export function applyFabricatePart(state: WarbleWayGalaxyState, stat: 'speed' | 'handling' | 'armor'): string {
  requireAtHabitatNoPending(state, 'fabricating');
  if (!anyBeingHasAdvanced(state, 'MEC')) throw new GameError('ILLEGAL_MOVE', 'Fabrication needs natural MEC 3 aboard (Shipwright, amendment A18).');
  if (!['speed', 'handling', 'armor'].includes(stat)) throw new GameError('ILLEGAL_MOVE', 'Shipwright fabricates speed, handling or armor (capacity stays shop-only).');
  const progress = state.habitat_progress[state.current_habitat]!;
  if (progress.fabricated_this_arrival === true) {
    throw new GameError('ILLEGAL_MOVE', 'The workshop is spent for this visit — one fabrication per habitat visit (amendment A18).');
  }
  const char = state.character!;
  if (char.credits - FABRICATE_COST <= DEBT_LIMIT) throw new GameError('ILLEGAL_MOVE', `Paying ${FABRICATE_COST}c would cross the −300 debt line.`);
  progress.fabricated_this_arrival = true;
  char.credits -= FABRICATE_COST;
  const ship = state.ship!;
  const owned: ItemDefinition = {
    id: `fabricated-${stat}-${state.items.length + 1}`,
    name: `Fabricated part: +1 ${stat}`,
    type: 'ship_part',
    effect: { kind: 'ship_stat', stat, bonus: 1 },
  };
  state.items.push(owned);
  ship.parts.push(owned.id);
  ship[stat] += 1;
  return `The Shipwright works through the night: ship ${stat} is now ${ship[stat]} (${FABRICATE_COST}c; amendment A18). Credits: ${char.credits}.`;
}

export const PAID_REPAIR_COST = 150; // amendment A1
export const DEBT_LIMIT = -300;

/** Amendment A1: pay 150c to raise the ship one damage level — repeatable, no
 * roll, independent of the once-per-arrival free roll. Credits may go negative
 * (the debt tension is the point) but never at/below the −300 line. */
function applyPayRepair(state: WarbleWayGalaxyState): string {
  requireAtHabitatNoPending(state, 'paying for repairs');
  const ship = state.ship!;
  const char = state.character!;
  if (ship.damage === 'pristine') throw new GameError('ILLEGAL_MOVE', `The ${ship.name} is already Pristine.`);
  if (char.credits - PAID_REPAIR_COST <= DEBT_LIMIT) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `Paying ${PAID_REPAIR_COST}c would put you at ${char.credits - PAID_REPAIR_COST}c — at or below the −300 debt line (amendment A1).`,
    );
  }
  char.credits -= PAID_REPAIR_COST;
  ship.damage = repairShipOneLevel(ship.damage);
  return `The yard crew patches the ${ship.name}: ${PAID_REPAIR_COST}c → ${ship.damage.toUpperCase()}. Credits: ${char.credits}.${
    char.credits < 0 ? ' You are in debt — below −300 the game is lost.' : ''
  }`;
}

function applyAttemptUnrest(state: WarbleWayGalaxyState): string {
  requireAtHabitatNoPending(state, 'easing unrest');
  const progress = state.habitat_progress[state.current_habitat]!;
  if (progress.unrest_rolled_this_arrival) {
    throw new GameError('ILLEGAL_MOVE', 'The unrest roll is once per arrival after space travel (WR §6) — already used here.');
  }
  if (!state.crew.some((c) => c.anger_tokens > 0)) throw new GameError('ILLEGAL_MOVE', 'No crew member has any anger tokens.');
  const best = bestForAbility(state, 'LEA');
  if (best.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Easing unrest needs any amount of LEA among you or your crew (WR §6).');
  progress.unrest_rolled_this_arrival = true;
  const actDie = actDieFor(state, 'LEA');
  state.pending = {
    kind: 'roll',
    reason: 'reduce_unrest',
    dice_count: 3 + actDie,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: 'LEA', bonus: best.bonus },
    min_roll: 12,
    declared_items: [],
    context: {},
  };
  return `Unrest attempt: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die on Moxie rolls)' : ''} + LEA ${best.bonus} (${best.who === 'self' ? 'you' : best.crew_name}); 12+ removes one anger token from each crew member.`;
}

function applyReleaseCrew(state: WarbleWayGalaxyState, crewName: string): string {
  const forced = state.pending?.kind === 'release_crew';
  if (!forced && state.phase !== 'at_habitat') {
    throw new GameError('ILLEGAL_MOVE', 'Crew can be released voluntarily only at a habitat (or when over capacity).');
  }
  if (!forced && state.pending !== null) {
    throw new GameError('ILLEGAL_MOVE', `Resolve the open ${state.pending!.kind} first.`);
  }
  const crew = resolveCrewName(state, crewName);
  state.crew = state.crew.filter((c) => c.name !== crew.name);
  // Departing crew take their equipped gear (consistent with anger/death leavers, WR §10; PORT-NOTES decision).
  const taken: string[] = [];
  for (const gearId of [crew.gear.weapon, crew.gear.armor]) {
    const item = itemById(state, gearId);
    if (item) {
      taken.push(item.name);
      state.items = state.items.filter((i) => i.id !== item.id);
      if (state.ship) state.ship.parts = state.ship.parts.filter((p) => p !== item.id);
    }
  }
  // If they were standing on a ruin map, their token walks off with them.
  if (state.encounter?.kind === 'ruin_run' && state.encounter.board) {
    state.encounter.board.tokens = state.encounter.board.tokens.filter((t) => t.name !== crew.name);
  }
  if (forced) state.pending = null;
  const notes: string[] = [];
  afterResolution(state, notes); // a forced release mid-journey must resume the card draws
  return `${crew.name} leaves the crew${taken.length ? ` and takes ${taken.join(' and ')} with them` : ''}. ${state.crew.length + 1}/${state.ship!.capacity} aboard.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

function applyLevelUp(state: WarbleWayGalaxyState, ability: AbilityId): string {
  if (state.pending?.kind !== 'level_up') throw new GameError('ILLEGAL_MOVE', 'No level-up is owed right now.');
  const char = state.character!;
  if (!(ability in ABILITY_NAMES)) throw new GameError('ILLEGAL_MOVE', `Unknown ability "${ability}".`);
  // Amendment A3: an EVEN level being reached may OPEN a new ability at 1;
  // odd levels keep the original rule (+1 to an ability you have ≥1 in).
  const reachingEvenLevel = (char.level + 1) % 2 === 0;
  const opening = (char.abilities[ability] ?? 0) < 1;
  if (opening && !reachingEvenLevel) {
    const owned = Object.keys(char.abilities).join(', ');
    throw new GameError(
      'ILLEGAL_MOVE',
      `An ODD level adds +1 to an ability you already have at least 1 in (WR §15; new abilities open at EVEN levels — amendment A3). Yours: ${owned}.`,
    );
  }
  const cost = minXpForLevel(char.level);
  char.abilities[ability] = (char.abilities[ability] ?? 0) + 1;
  char.xp -= cost;
  char.level += 1;
  state.pending = null;
  const legend = checkLegend(state); // A11: level 5 ends the season in glory
  if (legend) return legend;
  const notes: string[] = [];
  afterResolution(state, notes); // a big XP haul can chain another level; mid-journey the draws resume
  const newScore = char.abilities[ability]!;
  const advanced = newScore >= 3 ? ` ${ABILITY_NAMES[ability]} ${newScore} unlocks its advanced skill (WR §5).` : '';
  const opened = opening ? ` (new ability opened — even-level unlock, amendment A3)` : '';
  return `Level ${char.level}! +1 ${ability} (${ABILITY_NAMES[ability]}) → ${newScore}${opened}; ${cost} XP spent, ${char.xp} XP remaining.${advanced}${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

function applyUseItem(state: WarbleWayGalaxyState, itemName: string, chosenAbility?: AbilityId): string {
  const pending = state.pending;
  if (pending?.kind !== 'roll') {
    throw new GameError('ILLEGAL_MOVE', 'Consumables are declared BEFORE a roll (WR §6) — there is no roll open right now.');
  }
  const item = resolveOwnedItem(state, itemName);
  if (item.type !== 'consumable') throw new GameError('ILLEGAL_MOVE', `${item.name} is a ${item.type}, not a consumable.`);
  if (state.consumed_item_ids.includes(item.id)) throw new GameError('ILLEGAL_MOVE', `${item.name} was already used.`);
  if (pending.declared_items.includes(item.id)) throw new GameError('ILLEGAL_MOVE', `${item.name} is already declared for this roll.`);
  if (item.effect.kind !== 'ability_bonus') throw new GameError('ILLEGAL_MOVE', `${item.name} does not grant an ability bonus.`);
  if (item.effect.ability !== 'ANY') {
    if (pending.score_source.ability !== item.effect.ability) {
      throw new GameError(
        'ILLEGAL_MOVE',
        `${item.name} boosts ${item.effect.ability}, but this roll uses ${pending.score_source.ability ?? 'no ability'} — it would do nothing.`,
      );
    }
  } else if (chosenAbility && pending.score_source.ability && chosenAbility !== pending.score_source.ability) {
    throw new GameError('ILLEGAL_MOVE', `This roll uses ${pending.score_source.ability}; the "+Any" consumable must be aimed at it.`);
  }
  pending.declared_items.push(item.id);
  return `${item.name} declared for this roll (+${item.effect.bonus}). It will be consumed when the dice are reported.`;
}

// ---------------------------------------------------------------------------
// The shared check resolver (report_roll)
// ---------------------------------------------------------------------------

function applyReportRoll(state: WarbleWayGalaxyState, dice: number[]): string {
  // A digital human holds no physical dice — they press resolve_report and the
  // server rolls. Rejecting a payload report keeps a hallucinated client
  // submission from desyncing the server's roll stream.
  if (state.digital_seat === true && state.seat_kind === 'human') {
    throw new GameError('ILLEGAL_MOVE', 'This is a digital seat — press the Roll button (resolve_report) and the server rolls the dice, instead of reporting them.');
  }
  const pending = state.pending;
  if (pending?.kind !== 'roll') throw new GameError('ILLEGAL_MOVE', 'No roll is owed right now — follow next_step.');
  if (!Array.isArray(dice) || dice.length !== pending.dice_count) {
    throw new GameError(
      'INVALID_MOVE_SHAPE',
      `This roll is exactly ${pending.dice_count}d6 — report ${pending.dice_count} dice values (got ${Array.isArray(dice) ? dice.length : 'none'}).`,
    );
  }
  for (const d of dice) {
    if (!Number.isInteger(d) || d < 1 || d > 6) throw new GameError('INVALID_MOVE_SHAPE', `Each die is 1-6; got ${d}.`);
  }

  // Total = all dice + the ability score + declared consumables + Inspirational.
  let bonus = pending.score_source.bonus;
  const bonusNotes: string[] = [];
  if (pending.score_source.ability) {
    bonusNotes.push(`${pending.score_source.ability} +${pending.score_source.bonus} (${pending.score_source.who === 'self' ? 'you' : pending.score_source.crew_name})`);
  }
  for (const itemId of pending.declared_items) {
    const item = itemById(state, itemId)!;
    if (item.effect.kind === 'ability_bonus') {
      bonus += item.effect.bonus;
      bonusNotes.push(`${item.name} +${item.effect.bonus}`);
    }
    state.consumed_item_ids.push(itemId);
  }
  // Inspirational (natural LEA≥3 ANYWHERE aboard — advanced skills apply to
  // crew too, WR §5): +3 to any roll adding a CREW member's score.
  // Amendment A8 (was +2): measured +144% LEA-primary survival with zero
  // collateral inflation — the aura is the leader build's whole engine.
  if (pending.score_source.who === 'crew' && anyBeingHasAdvanced(state, 'LEA')) {
    bonus += 3;
    bonusNotes.push('Inspirational +3');
  }
  // A9b Dread: reputation rides every intimidation.
  if (pending.reason === 'intimidate' && (state.dread ?? 0) > 0) {
    bonus += state.dread!;
    bonusNotes.push(`Dread +${state.dread}`);
  }
  const total = dice.reduce((a, b) => a + b, 0) + bonus;
  const passed = pending.min_roll === null ? true : total >= pending.min_roll;
  const rollText = `${dice.join('+')}${bonusNotes.length ? ` + ${bonusNotes.join(' + ')}` : ''} = ${total}${
    pending.min_roll !== null ? ` vs ${pending.min_roll} — ${passed ? 'SUCCESS' : 'FAIL'}` : ''
  }`;

  // Advance the bot RNG stream so consecutive simulated rolls differ; harmless
  // in real play (the human's dice are the randomness, seed goes unused).
  state.seed = nextSeed(state.seed + dice.length);

  state.pending = null;
  const notes: string[] = [];
  let outcome: string;
  switch (pending.reason) {
    case 'recruit':
      outcome = resolveRecruitRoll(state, pending.context.recruit_id!, pending.context.recruit_source ?? 'cantina', passed, pending.context.cell);
      break;
    case 'repair':
      outcome = resolveRepairRoll(state, passed);
      break;
    case 'reduce_unrest':
      outcome = resolveUnrestRoll(state, passed);
      break;
    case 'mission_check':
      outcome = resolveMissionCheck(state, pending.context.mission_id!, passed);
      break;
    case 'hazard_check':
      outcome = resolveHazardCheck(state, pending.score_source, pending.context, passed, notes);
      break;
    case 'death_check':
      outcome = resolveDeathCheck(state, pending.context.death_source ?? 'hazard', passed, notes);
      break;
    case 'evade':
      outcome = resolveEvadeRoll(state, pending.context.evade_card_id!, passed, notes);
      break;
    case 'unnamed_recruit':
      outcome = resolveUnnamedRecruitRoll(state, pending.context.unnamed_source ?? 'habitat', passed);
      break;
    case 'redline':
      outcome = resolveRedlineRoll(state, passed, notes);
      break;
    case 'volley':
      outcome = resolveVolleyRoll(state, passed, notes);
      break;
    case 'intimidate':
      outcome = resolveIntimidateRoll(state, passed, notes);
      break;
    case 'escape':
      outcome = resolveEscapeRoll(state, passed, notes);
      break;
    case 'hack':
      outcome = resolveHackRoll(state, passed, notes);
      break;
    case 'space_combat':
      outcome = resolveSpaceCombatRoll(state, dice, bonus, notes);
      break;
    case 'ground_combat':
      outcome =
        pending.context.ground === 'ruin_attack'
          ? resolveRuinAttackRoll(state, dice, bonus, pending.context, notes)
          : pending.context.ground === 'ruin_defense'
            ? resolveRuinDefenseRoll(state, dice, bonus, pending.context, notes)
            : resolveBoardingRoll(state, dice, bonus, pending.score_source, notes);
      break;
    case 'item_d6':
      outcome = resolveItemD6(state, dice[0]!, pending.context, notes);
      break;
    case 'being_d6':
      outcome = resolveBeingD6(state, dice[0]!, pending.context, notes);
      break;
  }
  afterResolution(state, notes);
  return `Rolled ${rollText}. ${outcome}${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

function uniqueCrewName(state: WarbleWayGalaxyState, recruit: RecruitDefinition): string {
  const race = recruit.race.charAt(0).toUpperCase() + recruit.race.slice(1);
  const abil = Object.entries(recruit.abilities)
    .map(([a, v]) => `${a}+${v}`)
    .join(' ');
  const base = `${race} (${abil})`;
  let name = base;
  let n = 2;
  const taken = new Set([state.character?.name ?? '', ...state.crew.map((c) => c.name)]);
  while (taken.has(name)) name = `${base} #${n++}`;
  return name;
}

function recruitDefinitionById(state: WarbleWayGalaxyState, recruitId: string, source: 'cantina' | 'space' | 'ruin'): RecruitDefinition {
  if (source === 'cantina') {
    const hit = HABITATS[state.current_habitat]!.cantina.find((r) => r.id === recruitId);
    if (!hit) throw new GameError('STORAGE_ERROR', `Recruit ${recruitId} vanished mid-roll.`);
    return hit;
  }
  if (source === 'space') {
    const hit = Object.values(HEART_RECRUITS).find((r) => r.id === recruitId);
    if (!hit) throw new GameError('STORAGE_ERROR', `Space recruit ${recruitId} vanished mid-roll.`);
    return hit;
  }
  // Ruin beings (r1-b2 ... r3-b6) — searched across all three maps.
  for (const map of Object.values(RUIN_MAPS)) {
    for (const being of Object.values(map.beings)) {
      if (being?.id === recruitId) return being;
    }
  }
  throw new GameError('STORAGE_ERROR', `Ruin being ${recruitId} vanished mid-roll.`);
}

function resolveRecruitRoll(
  state: WarbleWayGalaxyState,
  recruitId: string,
  source: 'cantina' | 'space' | 'ruin',
  passed: boolean,
  spotCell?: string,
): string {
  // DIP conversion of a ruin attacker (WR §4) — not a table recruit.
  if (recruitId.startsWith('convert-')) {
    const enc = state.encounter;
    if (!enc || enc.kind !== 'ruin_run' || !enc.board) throw new GameError('STORAGE_ERROR', 'Conversion outside a ruin encounter.');
    const attackerId = recruitId.replace('convert-', '');
    const attacker = enc.board.attackers.find((a) => a.id === attackerId && !a.defeated);
    if (!attacker) throw new GameError('STORAGE_ERROR', `Attacker ${attackerId} vanished mid-conversion.`);
    if (!passed) return `${attacker.id} snarls and keeps fighting — the conversion fails.`;
    attacker.defeated = true; // off the attacker roster (no XP — not defeated in combat)
    // Amendment A10 (rewrites clarification #4): converts join as UNNAMED CREW —
    // a counter, not a CrewMember. No capacity slot; cap = best natural DIP.
    const cap = unnamedCap(state);
    if ((state.unnamed_crew ?? 0) >= cap) {
      return `${attacker.id} lays down arms — but your crew can only hold ${cap} unnamed hand(s) together (cap = best natural DIP), so they scatter after the encounter (amendment A10).`;
    }
    state.unnamed_crew = (state.unnamed_crew ?? 0) + 1;
    const name = (() => {
      let n = `Red Shirt ${state.unnamed_crew}`;
      let i = state.unnamed_crew! + 1;
      const taken = new Set(enc.board.tokens.map((t) => t.name));
      while (taken.has(n)) n = `Red Shirt ${i++}`;
      return n;
    })();
    enc.board.tokens.push({ name, is_character: false, cell: attacker.cell, moved: 0, acted: true, ended: true, has_attacked: false, unnamed: true });
    return `${attacker.id} lays down arms and joins as ${name} — UNNAMED CREW ${state.unnamed_crew}/${cap} (a body: no scores, no gear; amendment A10). They act from your next round.`;
  }
  const recruit = recruitDefinitionById(state, recruitId, source);
  if (!passed) {
    if (source === 'cantina') {
      state.habitat_progress[state.current_habitat]!.recruits_failed.push(recruit.id);
      return `${describeRecruit(recruit)} declines — permanently marked; no further attempts at this cantina (WR §6).`;
    }
    return `${describeRecruit(recruit)} declines and drifts on — no mark for spacefaring recruits (WR §9).`;
  }
  if (source === 'cantina') state.habitat_progress[state.current_habitat]!.recruits_hired.push(recruit.id);
  const name = uniqueCrewName(state, recruit);
  state.crew.push({
    name,
    race: recruit.race,
    idealized: recruit.idealized,
    abilities: { ...recruit.abilities },
    anger_tokens: 0,
    gear: { weapon: null, armor: null },
  });
  // A being recruited inside a ruin joins the MAP where recruited ("add a
  // token to the board ... where you recruited them") and acts from the
  // player's next round (WR §14).
  if (source === 'ruin' && state.encounter?.kind === 'ruin_run' && state.encounter.board && spotCell) {
    const board = state.encounter.board;
    const map = ruinMapForLevel(state.encounter.level);
    const cell = !occupiedCells(board).has(spotCell)
      ? spotCell
      : ([...bfsDistances(map, board, spotCell, { ignore_occupants: true }).keys()].find((c) => !occupiedCells(board).has(c)) ?? spotCell);
    board.tokens.push({ name, is_character: false, cell, moved: 0, acted: true, ended: true, has_attacked: false });
  }
  let xpNote = '';
  if (anyoneHasEffective(state, 'LEA')) {
    awardXp(state, 1);
    xpNote = ' +1 XP (Leadership).';
  }
  const over = state.crew.length + 1 > state.ship!.capacity;
  return `${name} joins the crew! ${state.crew.length + 1}/${state.ship!.capacity} aboard.${xpNote}${
    over ? ' OVER CAPACITY — someone must be released (release_crew).' : ''
  }`;
}

function resolveRepairRoll(state: WarbleWayGalaxyState, passed: boolean): string {
  if (!passed) return `No luck — the ${state.ship!.name} stays ${state.ship!.damage}.`;
  state.ship!.damage = repairShipOneLevel(state.ship!.damage);
  return `The ${state.ship!.name} is repaired one level — now ${state.ship!.damage}.`;
}

function resolveUnrestRoll(state: WarbleWayGalaxyState, passed: boolean): string {
  if (!passed) return 'The crew is unmoved — anger tokens stay.';
  for (const c of state.crew) c.anger_tokens = Math.max(0, c.anger_tokens - 1);
  return 'One anger token removed from each crew member (WR §6, ruling #5).';
}

// ---------------------------------------------------------------------------
// Ms/Mr Fix-it arrival hook — exported for the M2 arrival path (and tested now):
// a natural MEC≥3 anywhere aboard auto-repairs the ship to Pristine on habitat
// arrival (WR §5). Character or crew (advanced skills apply to crew, WR §5).
// ---------------------------------------------------------------------------

export function applyArrivalAutoRepair(state: WarbleWayGalaxyState): string | null {
  const hasFixIt =
    (state.character?.abilities.MEC ?? 0) >= 3 || state.crew.some((c) => (c.abilities.MEC ?? 0) >= 3);
  if (!hasFixIt || !state.ship || state.ship.damage === 'pristine') return null;
  state.ship.damage = 'pristine';
  return `Ms/Mr Fix-it: the ${state.ship.name} auto-repairs to Pristine on arrival.`;
}

// ===========================================================================
// M2 — missions & space travel (WR §7–§10, §16)
// ===========================================================================

/** Any natural score ≥3 anywhere aboard — advanced skills apply to crew too (WR §5). */
function anyBeingHasAdvanced(state: WarbleWayGalaxyState, ability: AbilityId): boolean {
  return (state.character?.abilities[ability] ?? 0) >= 3 || state.crew.some((c) => (c.abilities[ability] ?? 0) >= 3);
}

/** Amendment A12 (prototype, designer-directed 2026-07-08): the scholar
 * learns from everything — every XP award is increased by +1 while the
 * character's natural RES ≥ 2, and by +2 at RES 3. Every xp-gain site routes
 * through here so the rider can't be missed. Returns the boosted amount. */
export function awardXp(state: WarbleWayGalaxyState, base: number): number {
  const res = state.character?.abilities.RES ?? 0;
  const bonus = res >= 3 ? 2 : res >= 2 ? 1 : 0;
  const total = base + bonus;
  state.character!.xp += total;
  return total;
}

export function setLoss(state: WarbleWayGalaxyState, summary: string): void {
  state.result = { winner: 'galaxy', summary };
  state.phase = 'game_over';
  state.pending = null;
  state.encounter = null;
}

// ---------------------------------------------------------------------------
// A11 — the five endings. Conquest lives in finishRuinRun; the four alternate
// victories below fire from their trigger points. Thresholds (designer-set
// 2026-07-08): Fortune 6,000c banked at a habitat · Legend level 5 ·
// Plunder 6 ruin caches opened · Bounty 10 foes defeated.
// ---------------------------------------------------------------------------

export const FORTUNE_CREDITS = 6000;
export const LEGEND_LEVEL = 5;
export const PLUNDER_CACHES = 6;
/** Face-to-face victories only: boarding captures + ruin attacker kills.
 * (Disables counted at first — the default policy stumbled into the ending
 * 60% of the time; a bounty is collected up close.) */
export const BOUNTY_FOES = 8;

function setWin(state: WarbleWayGalaxyState, ending: WarbleEnding, summary: string): void {
  state.result = { winner: 'player', summary, ending };
  state.phase = 'game_over';
  state.pending = null;
  state.encounter = null;
}

/** Fortune fires only while DOCKED — you retire rich, you don't win mid-dogfight. */
function checkFortune(state: WarbleWayGalaxyState, notes: string[]): void {
  if (state.result !== null || state.phase !== 'at_habitat') return;
  const credits = state.character?.credits ?? 0;
  if (credits >= FORTUNE_CREDITS) {
    setWin(state, 'fortune', `FORTUNE — SEASON 1 COMPLETE: you dock at ${HABITATS[state.current_habitat]!.name} with ${credits}c banked (≥ ${FORTUNE_CREDITS}) and retire rich (amendment A11).`);
    notes.push(state.result!.summary);
  }
}

function checkLegend(state: WarbleWayGalaxyState): string | null {
  if (state.result !== null) return null;
  if ((state.character?.level ?? 1) >= LEGEND_LEVEL) {
    setWin(state, 'legend', `LEGEND — SEASON 1 COMPLETE: level ${state.character!.level} (≥ ${LEGEND_LEVEL}). Your name now travels faster than your ship (amendment A11).`);
    return state.result!.summary;
  }
  return null;
}

function countCacheOpened(state: WarbleWayGalaxyState): string | null {
  if (state.result !== null) return null;
  state.caches_looted = (state.caches_looted ?? 0) + 1;
  if (state.caches_looted >= PLUNDER_CACHES) {
    setWin(state, 'plunder', `PLUNDER — SEASON 1 COMPLETE: ${state.caches_looted} ruin caches opened (≥ ${PLUNDER_CACHES}). The museums will argue about you for a century (amendment A11).`);
    return state.result!.summary;
  }
  return ` Caches opened this run: ${state.caches_looted}/${PLUNDER_CACHES} (Plunder, A11).`;
}

function countFoeDefeated(state: WarbleWayGalaxyState): string | null {
  if (state.result !== null) return null;
  state.foes_defeated = (state.foes_defeated ?? 0) + 1;
  if (state.foes_defeated >= BOUNTY_FOES) {
    setWin(state, 'bounty', `BOUNTY — SEASON 1 COMPLETE: ${state.foes_defeated} foes defeated (≥ ${BOUNTY_FOES}). The sector's pirates now check the boards before they check their scopes (amendment A11).`);
    return state.result!.summary;
  }
  return ` Foes defeated: ${state.foes_defeated}/${BOUNTY_FOES} (Bounty, A11).`;
}

/** Ship takes one damage level; returns false if it is destroyed (game over). */
function damageShip(state: WarbleWayGalaxyState, cause: string, notes: string[]): boolean {
  const ship = state.ship!;
  if (ship.damage === 'hobbled') {
    // Amendment A19 "Emergency Bulkheads" (natural ARM 3 aboard): the first
    // killing blow holds at Hobbled — once per run. Measured: +16% survival
    // ADDED to Shields; a REPLACE variant was measured and rejected (−53% —
    // a permanent −1 on every exchange beats one absorbed hit by a mile).
    if (anyBeingHasAdvanced(state, 'ARM') && state.bulkheads_spent !== true) {
      state.bulkheads_spent = true;
      notes.push('EMERGENCY BULKHEADS (amendment A19): the killing blow is held at Hobbled — the bulkheads are spent for this run.');
      return true;
    }
    setLoss(state, `The ${ship.name} is destroyed (${cause}) — below Hobbled the ship is lost, and with it the game (WR §13).`);
    notes.push(`The ${ship.name} is DESTROYED — GAME OVER.`);
    return false;
  }
  const order: ShipDamage[] = ['pristine', 'used', 'damaged', 'hobbled'];
  ship.damage = order[order.indexOf(ship.damage) + 1]!;
  notes.push(`The ${ship.name} takes damage (${cause}) — now ${ship.damage}.`);
  return true;
}

/** Mission lookup across habitat pages and the ♣ table. */
export function missionById(id: string): MissionDefinition {
  for (const habitat of Object.values(HABITATS)) {
    const hit = habitat.missions.find((m) => m.id === id);
    if (hit) return hit;
  }
  for (const entry of Object.values(CLUB_MISSIONS)) {
    if (entry.kind === 'choice') {
      if (entry.option1.id === id) return entry.option1;
      if (entry.option2.id === id) return entry.option2;
    } else if (entry.mission.id === id) {
      return entry.mission;
    }
  }
  throw new GameError('STORAGE_ERROR', `Unknown mission id ${id}.`);
}

export function describeMission(m: MissionDefinition): string {
  const goal =
    m.goal.kind === 'ability_check' ? `${m.goal.ability} ${m.goal.min_roll}` : `R${m.goal.depth} ruin`;
  return `distance ${m.distance}, ${goal}, ${m.credits}c, ${m.xp} XP`;
}

/** The ability gate (WR §7): someone aboard has ≥1 effective, or an owned
 * unconsumed consumable grants the ability ("an item would give you the ability"). */
export function partyQualifiesFor(state: WarbleWayGalaxyState, ability: AbilityId): boolean {
  if (anyoneHasEffective(state, ability)) return true;
  return state.items.some(
    (i) =>
      i.type === 'consumable' &&
      !state.consumed_item_ids.includes(i.id) &&
      i.effect.kind === 'ability_bonus' &&
      (i.effect.ability === ability || i.effect.ability === 'ANY'),
  );
}

function legCards(state: WarbleWayGalaxyState, distance: number): number {
  return Math.max(0, distance - state.ship!.speed);
}

/** RES peek at mission start (WR §4): the CHARACTER's effective RES sets the
 * peek count (skill text says "your RES score" — crew do not trigger it;
 * PORT-NOTES decision). Skipped when the journey deals no cards. */
function maybeStartResPeek(state: WarbleWayGalaxyState, totalCards: number, notes: string[]): void {
  if (totalCards === 0) return;
  const char = state.character!;
  const being = { name: char.name, natural: char.abilities, gear: char.gear, is_character: true };
  // Amendment A17 "Well-Connected": the journey look-ahead keys on the BEST of
  // the character's RES (Research) or DIP (rumor networks). Measured: DIP
  // spreads gain +35-44% survival with ZERO collateral; the transfer variant
  // (DIP only) was measured and REJECTED — stripping RES cost the flagship
  // build 8pp (the RES-1 peek was quietly load-bearing everywhere).
  const resScore = effectiveScore(state, being, 'RES');
  const dipScore = effectiveScore(state, being, 'DIP');
  const res = Math.max(resScore, dipScore);
  if (res < 1) return;
  ensureDeckHasCards(state, notes); // a faithful player reshuffles, THEN peeks
  const peek = Math.min(res, state.deck.remaining.length);
  if (peek < 1) return;
  state.pending = { kind: 'res_discard', peek_count: peek };
  const source = dipScore > resScore ? 'Well-Connected — your contacts tip you off (A17)' : 'Research';
  notes.push(
    `${source}: look at the top ${peek} card${peek > 1 ? 's' : ''} of your travel deck and discard one — report the discarded card (the rest go back in the same order).`,
  );
}

function resolveMissionName(state: WarbleWayGalaxyState, requested: string): MissionDefinition {
  const habitat = HABITATS[state.current_habitat]!;
  const want = requested.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit =
    habitat.missions.find((m) => m.id.toLowerCase().replace(/[^a-z0-9]/g, '') === want) ??
    habitat.missions.find((m) => describeMission(m).toLowerCase().replace(/[^a-z0-9]/g, '') === want) ??
    habitat.missions.find(
      (m) =>
        m.goal.kind === 'ability_check' &&
        `${m.goal.ability}${m.goal.min_roll}`.toLowerCase() === want.replace(/^d?\d+/, '').replace(/[^a-z0-9]/g, ''),
    ) ??
    habitat.missions.find((m) => m.goal.kind === 'ability_check' && want.includes(m.goal.ability.toLowerCase()) && want.includes(String(m.goal.min_roll)));
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No mission at ${habitat.name} matches "${requested}". Posted: ${habitat.missions.map((m) => `${m.id} (${describeMission(m)})`).join('; ')}.`,
    );
  }
  return hit;
}

export function applyTakeMission(state: WarbleWayGalaxyState, missionName: string): string {
  requireAtHabitatNoPending(state, 'taking a mission');
  const progress = state.habitat_progress[state.current_habitat]!;
  const mission = resolveMissionName(state, missionName);
  if (progress.missions_attempted.includes(mission.id)) {
    throw new GameError('ILLEGAL_MOVE', `Mission ${mission.id} was already attempted — habitat missions are one attempt each (ruling #7).`);
  }
  if (mission.goal.kind !== 'ruin' && !partyQualifiesFor(state, mission.goal.ability)) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `You cannot take a ${mission.goal.ability} mission — nobody aboard has ${mission.goal.ability} (and no item grants it) (WR §7).`,
    );
  }
  progress.missions_attempted.push(mission.id);
  const cards = legCards(state, mission.distance);
  // Return leg first (bottom), outbound on top — drawn first (LIFO).
  state.journey_stack.push({ purpose: { kind: 'mission_return', mission_id: mission.id }, cards_remaining: cards });
  state.journey_stack.push({ purpose: { kind: 'mission_outbound', mission_id: mission.id }, cards_remaining: cards });
  state.phase = 'traveling';
  const notes: string[] = [];
  maybeStartResPeek(state, cards * 2, notes);
  afterResolution(state, notes);
  return (
    `Mission accepted (${describeMission(mission)}). Deal ${cards} card${cards === 1 ? '' : 's'} face-down for the outbound trip ` +
    `and ${cards} for the return (distance ${mission.distance} − ship speed ${state.ship!.speed}).` +
    (notes.length ? ` ${notes.join(' ')}` : '')
  );
}

export function applyDepart(state: WarbleWayGalaxyState): string {
  requireAtHabitatNoPending(state, 'departing');
  const habitat = HABITATS[state.current_habitat]!;
  const progress = state.habitat_progress[state.current_habitat]!;
  const prog = habitat.progression;
  if (prog.kind === 'final_ruin') {
    // The Season 1 finale (ruling #16): the R3 ruin beyond FFD700 Base — no
    // travel cards printed for it; you enter directly.
    startRuinRun(state, { type: 'finale' }, prog.depth);
    return (
      `THE SEASON 1 FINALE — beyond ${habitat.name} waits the great ruin (depth ${prog.depth}). ` +
      'Complete a full run to its deepest goal to finish the season victorious (ruling #16). Every run starts at the R1 map — set up the encounter.'
    );
  }
  if (prog.kind === 'missions_then_travel' && progress.missions_attempted.length < prog.missions_required) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `${habitat.name} requires ${prog.missions_required} missions completed (success or fail) before moving on — you have ${progress.missions_attempted.length} (WR §16).`,
    );
  }
  const cards = legCards(state, prog.distance_one_way);
  state.journey_stack.push({
    purpose: { kind: 'habitat_transfer', to_habitat: state.current_habitat + 1 },
    cards_remaining: cards,
  });
  state.phase = 'traveling';
  const notes: string[] = [];
  afterResolution(state, notes);
  return (
    `Departing ${habitat.name} for Habitat #${state.current_habitat + 1} — a ONE-WAY trip: deal ${cards} card${cards === 1 ? '' : 's'} ` +
    `face-down (distance ${prog.distance_one_way} − speed ${state.ship!.speed}; no return stack, WR §16).` +
    (notes.length ? ` ${notes.join(' ')}` : '')
  );
}

// ---------------------------------------------------------------------------
// The travel deck model. PHYSICAL: composition only, strict duplicate
// rejection (ruling #6), the order is the player's shuffle. DIGITAL: the
// server also owns the ORDER (deck.order; remaining is the same pile, two
// views) — draws pop the top.
// ---------------------------------------------------------------------------

function ensureDeckHasCards(state: WarbleWayGalaxyState, notes: string[]): void {
  if (state.deck.remaining.length > 0) return;
  state.deck.remaining = state.deck.discard;
  state.deck.discard = [];
  if (state.deck.order !== undefined) {
    // Digital: the reshuffle is the server's, so actually shuffle the order.
    // (Physical: the player shuffles their real deck; composition is all we track.)
    const sh = shuffle(state.deck.remaining, state.seed);
    state.deck.remaining = sh.items;
    state.deck.order = [...sh.items];
    state.seed = sh.nextSeed;
    notes.push('Your draw pile is empty — the discard pile is shuffled into a fresh draw pile (ruling #6).');
    return;
  }
  notes.push('Your draw pile is empty — SHUFFLE your discard pile into a fresh draw pile (ruling #6).');
}

function drawnCardOrThrow(state: WarbleWayGalaxyState, cardStr: string): PlayingCard {
  const card = resolveCardName(cardStr);
  if (!card) {
    throw new GameError(
      'INVALID_MOVE_SHAPE',
      `Could not read "${cardStr}" as a playing card. Say it like "7♠", "7S", or "seven of spades".`,
    );
  }
  const id = cardId(card);
  if (!state.deck.remaining.includes(id)) {
    if (state.deck.discard.includes(id)) {
      throw new GameError(
        'ILLEGAL_MOVE',
        `${cardName(card)} is already in your discard pile — it cannot be drawn again before a reshuffle. ` +
          'If the physical deck disagrees with the tracked state, check the table (or undo a misreported draw).',
      );
    }
    throw new GameError('ILLEGAL_MOVE', `${cardName(card)} is not in the tracked deck. Check the card and report it again.`);
  }
  state.deck.remaining = state.deck.remaining.filter((c) => c !== id);
  state.deck.discard.push(id);
  // Keep the digital draw order in sync (same pile, two views). Unreachable on
  // a card_draw for digital (those pop the top via resolve_report), but a
  // digital Research peek discard comes through here.
  if (state.deck.order !== undefined) state.deck.order = state.deck.order.filter((c) => c !== id);
  return card;
}

// ---------------------------------------------------------------------------
// Digital mode: the resolve_report button (docs/digital-mode.md). A digital
// human owes the same roll/card_draw pendings a physical player does — the
// pending is ARMED identically — but resolves them by pressing a button:
// the server rolls the seeded dice or deals the top of the tracked deck.
// Consumables declared before the roll (use_item) ride the same pending and
// are consumed by the shared resolver either way. Player-owned choices
// (res_discard, hazard_option, ...) are never resolved by a button.
// ---------------------------------------------------------------------------

export function applyResolveReport(state: WarbleWayGalaxyState): string {
  if (state.seat_kind === 'ai') {
    throw new GameError('ILLEGAL_MOVE', 'AI seats never press the randomness button (the bot resolves its own reports inline).');
  }
  if (state.digital_seat !== true) {
    throw new GameError('ILLEGAL_MOVE', "This is a physical seat — report the dice you rolled (report_roll) / the card you drew (report_card_draw); don't press a button.");
  }
  const pending = state.pending;
  // The shared report handlers reject payload reports from a digital human;
  // the button press IS the resolution, so toggle the seat-kind marking around
  // the call (in-place — this state is applyMove's clone) and restore after.
  const kind = state.seat_kind;
  state.seat_kind = 'ai';
  try {
    if (pending?.kind === 'roll') {
      // Roll the real dice off the seed stream, then take the SAME path a
      // physical report_roll would take.
      const { dice, nextSeed: after } = rollDice(state.seed, pending.dice_count);
      state.seed = after;
      const resolved = applyReportRoll(state, dice);
      return `You pressed Roll — the server rolled ${dice.join(', ')}. ${resolved}`;
    }
    if (pending?.kind === 'card_draw') {
      const notes: string[] = [];
      ensureDeckHasCards(state, notes);
      const top = state.deck.order?.[0];
      if (!top) throw new GameError('ILLEGAL_MOVE', 'The server-tracked deck has no order (a digital session needs a shuffled deck).');
      // Pop the top of the server's order; applyReportCardDraw removes it from
      // the remaining view (and its order-sync filter is a no-op — already gone).
      state.deck.order = state.deck.order!.slice(1);
      const resolved = applyReportCardDraw(state, top);
      return `You pressed Draw — the server dealt ${top} from the top of the deck.${notes.length ? ` ${notes.join(' ')}` : ''} ${resolved}`;
    }
    if (pending?.kind === 'res_discard') {
      throw new GameError('ILLEGAL_MOVE', 'The Research peek is a CHOICE, not randomness — which card you discard is yours: report_res_discard or skip_res_peek.');
    }
    throw new GameError('ILLEGAL_MOVE', 'No roll or card draw is owed right now — follow next_step.');
  } finally {
    state.seat_kind = kind;
  }
}

export function applySkipResPeek(state: WarbleWayGalaxyState): string {
  if (state.pending?.kind !== 'res_discard') throw new GameError('ILLEGAL_MOVE', 'No Research peek is open right now.');
  state.pending = null;
  const notes: string[] = [];
  afterResolution(state, notes);
  return `You leave the deck unread — the peek is optional (WR §4).${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applyReportResDiscard(state: WarbleWayGalaxyState, cardStr: string): string {
  if (state.pending?.kind !== 'res_discard') throw new GameError('ILLEGAL_MOVE', 'No Research peek is open right now.');
  const card = drawnCardOrThrow(state, cardStr);
  state.pending = null;
  state.seed = nextSeed(state.seed + 1);
  const notes: string[] = [];
  afterResolution(state, notes);
  return `Research: ${cardName(card)} discarded from the top of the deck; the other peeked cards go back in order.${
    notes.length ? ` ${notes.join(' ')}` : ''
  }`;
}

export function applyReportCardDraw(state: WarbleWayGalaxyState, cardStr: string): string {
  if (state.pending?.kind !== 'card_draw') throw new GameError('ILLEGAL_MOVE', 'No travel card draw is owed right now — follow next_step.');
  // A digital human holds no physical deck — the server owns the draw order;
  // they press resolve_report and the server deals.
  if (state.digital_seat === true && state.seat_kind === 'human') {
    throw new GameError('ILLEGAL_MOVE', 'This is a digital seat — press the Draw button (resolve_report) and the server deals the card, instead of reporting it.');
  }
  const card = drawnCardOrThrow(state, cardStr);
  state.pending = null;
  state.seed = nextSeed(state.seed + 1);
  const leg = state.journey_stack[state.journey_stack.length - 1]!;
  leg.cards_remaining -= 1;
  const notes: string[] = [];
  const event = dispatchTravelCard(state, card, notes);
  afterResolution(state, notes);
  return `${cardName(card)} — ${event}${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

function dispatchTravelCard(state: WarbleWayGalaxyState, card: PlayingCard, notes: string[]): string {
  const id = cardId(card);
  if (card.suit === 'hearts') {
    const recruit = HEART_RECRUITS[card.rank];
    state.pending = { kind: 'space_recruit_offer', card_id: id };
    return `a potential crewmate adrift: ${describeRecruit(recruit)} (idealizes ${recruit.idealized}). Attempt to recruit them, or move on (decline_recruit).`;
  }
  if (card.suit === 'spades') {
    const hazard = SPADE_HAZARDS[card.rank];
    const opt1Has = anyoneHasEffective(state, hazard.option1.ability);
    const opt2Has = anyoneHasEffective(state, hazard.option2.ability);
    const describe = (o: { ability: AbilityId; min_roll: number }) =>
      `${o.ability} ${o.min_roll} (fail: ${HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[o.ability]].replace(/_/g, ' ')})`;
    if (opt1Has && opt2Has) {
      state.pending = { kind: 'hazard_option', card_id: id, must_fail: false };
      return `a HAZARD — choose which to roll: option 1 ${describe(hazard.option1)} or option 2 ${describe(hazard.option2)} (WR §10).`;
    }
    if (opt1Has || opt2Has) {
      // Exactly one ability held → the rules force that option (no option choice).
      // But WHOSE score carries it is still the player's when several beings hold
      // the ability — the carrier faces a Brawn hazard's death risk (POST-PORT §5).
      const forced = opt1Has ? hazard.option1 : hazard.option2;
      const carriers = beings(state).filter((b) => effectiveScore(state, b, forced.ability) >= 1);
      if (carriers.length > 1) {
        state.pending = { kind: 'hazard_option', card_id: id, must_fail: false };
        return `a HAZARD — only ${forced.ability} is aboard, so that option is forced (WR §10), but CHOOSE whose score carries it (${carriers
          .map((b) => b.name)
          .join(' / ')}): the carrier takes the consequence on a failure.`;
      }
      startHazardRoll(state, id, opt1Has ? 1 : 2, forced);
      return `a HAZARD — only ${forced.ability} is aboard, so that option is forced: roll 3d6 + ${forced.ability} vs ${forced.min_roll} (fail: ${
        HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[forced.ability]].replace(/_/g, ' ')
      }).`;
    }
    state.pending = { kind: 'hazard_option', card_id: id, must_fail: true };
    return `a HAZARD and nobody aboard has either ability — you must PICK WHICH OPTION YOU FAIL: option 1 ${describe(hazard.option1)} or option 2 ${describe(hazard.option2)} (WR §10).`;
  }
  if (card.suit === 'clubs') {
    const entry = CLUB_MISSIONS[card.rank];
    state.pending = { kind: 'space_mission_offer', card_id: id };
    if (entry.kind === 'choice') {
      return `a MISSION offer — option 1: ${describeMission(entry.option1)}; option 2: ${describeMission(entry.option2)}. Accept one (accept_mission) or decline (decline_mission); accepted cards stack ON TOP of the journey in progress (WR §7).`;
    }
    return `a RUINS MISSION offer — ${describeMission(entry.mission)}. Accept it (accept_mission) or decline (decline_mission); accepted cards stack ON TOP of the journey in progress (WR §7).`;
  }
  // Diamonds: 2–9 pirates, 10/J/Q/K/A ruins discoveries.
  const pirate = DIAMOND_PIRATES[card.rank as PirateRank] as PirateDefinition | undefined;
  if (pirate) {
    // Amendment A5 "Running Silent": with SNE aboard, the crew may try to slip
    // past the pirates' sensors BEFORE the encounter exists.
    if (bestForAbility(state, 'SNE').bonus >= 1) {
      state.pending = { kind: 'evade_offer', card_id: id };
      return (
        `PIRATES on the scope (♦${card.rank}: space +${pirate.space_attack}, speed +${pirate.speed})` +
        ` — but they haven't seen you yet. RUN SILENT (attempt_evade: 3d6 + SNE vs ${10 + pirate.speed}; ` +
        `success slips past, failure just means they spot you — amendment A5) or engage (decline_evade).`
      );
    }
    return startPirateEncounter(state, id);
  }
  const depth = DIAMOND_RUINS[card.rank as RuinDiamondRank]!;
  state.pending = { kind: 'ruin_discovery', card_id: id, max_depth: depth };
  return `ancient RUINS drift into sensor range (depth ${depth}). Entering is optional (WR §9): enter_ruin with a target depth, or skip_ruin to move on.`;
}

// ---------------------------------------------------------------------------
// Hazards (WR §10)
// ---------------------------------------------------------------------------

function startHazardRoll(
  state: WarbleWayGalaxyState,
  cardId_: string,
  option: 1 | 2,
  opt: { ability: AbilityId; min_roll: number },
  carrier?: { who: 'self' | 'crew'; crew_name?: string; bonus: number },
): void {
  const source = carrier ?? bestForAbility(state, opt.ability);
  state.pending = {
    kind: 'roll',
    reason: 'hazard_check',
    dice_count: 3 + actDieFor(state, opt.ability),
    score_source: { who: source.who, ...(source.crew_name ? { crew_name: source.crew_name } : {}), ability: opt.ability, bonus: source.bonus },
    min_roll: opt.min_roll,
    declared_items: [],
    context: { hazard_card_id: cardId_, hazard_option: option },
  };
}

/** ACT basic skill (WR §4): +1d6 on ANY Moxie or Smarts roll — recruiting has
 * its own race-keyed wording; ship REPAIR is explicitly excluded. */
function actDieFor(state: WarbleWayGalaxyState, ability: AbilityId | null): number {
  if (!ability) return 0;
  const stat = ABILITY_STAT[ability];
  if (stat !== 'moxie' && stat !== 'smarts') return 0;
  return anyoneHasEffective(state, 'ACT') ? 1 : 0;
}

export function applyChooseHazardOption(state: WarbleWayGalaxyState, option: 1 | 2, carrierName?: string): string {
  const pending = state.pending;
  if (pending?.kind !== 'hazard_option') throw new GameError('ILLEGAL_MOVE', 'No hazard option is open right now.');
  const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
  const hazard = SPADE_HAZARDS[rank]!;
  const opt = option === 1 ? hazard.option1 : hazard.option2;
  if (pending.must_fail) {
    // Nobody has either ability: the player picks which option they FAIL — no roll.
    state.pending = null;
    const notes: string[] = [];
    const outcome = applyHazardConsequence(state, opt.ability, { who: 'self' }, notes);
    afterResolution(state, notes);
    return `Failing the ${opt.ability} option (nobody aboard has either ability). ${outcome}${notes.length ? ` ${notes.join(' ')}` : ''}`;
  }
  if (!anyoneHasEffective(state, opt.ability)) {
    throw new GameError('ILLEGAL_MOVE', `Nobody aboard has ${opt.ability} — choose the other option (WR §10).`);
  }
  // WHOSE score carries the roll is the player's call (the carrier faces a Brawn
  // hazard's death risk — POST-PORT §5). Default: the best score aboard.
  let source: { who: 'self' | 'crew'; crew_name?: string; bonus: number };
  if (carrierName) {
    const being = resolveBeingName(state, carrierName);
    const score = effectiveScore(state, being, opt.ability);
    if (score < 1) throw new GameError('ILLEGAL_MOVE', `${being.name} has no ${opt.ability} — pick a carrier who holds it (or omit carrier for the best aboard).`);
    source = being.is_character ? { who: 'self', bonus: score } : { who: 'crew', crew_name: being.name, bonus: score };
  } else {
    source = bestForAbility(state, opt.ability);
  }
  state.pending = null;
  startHazardRoll(state, pending.card_id, option, opt, source);
  const carrierText = source.who === 'self' ? 'your own score' : `${source.crew_name}'s score`;
  return `Facing the hazard with ${opt.ability} ${source.bonus} (${carrierText} — the carrier takes the consequence): roll 3d6 vs ${opt.min_roll}.`;
}

function resolveHazardCheck(
  state: WarbleWayGalaxyState,
  scoreSource: { who: 'self' | 'crew'; crew_name?: string },
  context: { hazard_card_id?: string; hazard_option?: 1 | 2 },
  passed: boolean,
  notes: string[],
): string {
  if (passed) {
    awardXp(state, 1);
    return 'Hazard survived — nothing happens. +1 XP (WR §10, ruling #4).';
  }
  // Amendment A14a: an unnamed crew hand can throw themselves into the breach —
  // spend one to turn the failure into a survival. The choice is the player's.
  if ((state.unnamed_crew ?? 0) > 0) {
    state.pending = {
      kind: 'sacrifice_offer',
      hazard_card_id: context.hazard_card_id ?? '',
      hazard_option: context.hazard_option === 2 ? 2 : 1,
      carrier_who: scoreSource.who,
      ...(scoreSource.crew_name ? { carrier_name: scoreSource.crew_name } : {}),
    };
    return (
      `The check FAILS — but an unnamed crew hand is close enough to take it (${state.unnamed_crew} aboard, amendment A14a): ` +
      'sacrifice_unnamed (they die; the hazard counts as survived) or decline_sacrifice (the consequence lands as rolled).'
    );
  }
  const rank = (context.hazard_card_id ?? '').replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
  const hazard = SPADE_HAZARDS[rank]!;
  const opt = context.hazard_option === 2 ? hazard.option2 : hazard.option1;
  return applyHazardConsequence(state, opt.ability, scoreSource, notes);
}

/** A14a: spend one unnamed crew — the failed hazard counts as survived. */
export function applySacrificeUnnamed(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'sacrifice_offer') throw new GameError('ILLEGAL_MOVE', 'No sacrifice is on offer right now.');
  if ((state.unnamed_crew ?? 0) < 1) throw new GameError('ILLEGAL_MOVE', 'No unnamed crew left to spend.');
  state.unnamed_crew = state.unnamed_crew! - 1;
  state.pending = null;
  const xp = awardXp(state, 1);
  const notes: string[] = [];
  afterResolution(state, notes);
  return (
    `An unnamed hand throws themselves into the breach and is GONE (${state.unnamed_crew} remain) — the hazard counts as ` +
    `SURVIVED (+${xp} XP; amendment A14a).${notes.length ? ` ${notes.join(' ')}` : ''}`
  );
}

export function applyDeclineSacrifice(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'sacrifice_offer') throw new GameError('ILLEGAL_MOVE', 'No sacrifice is on offer right now.');
  const rank = pending.hazard_card_id.replace(/[HDSC]$/, '') as keyof typeof SPADE_HAZARDS;
  const hazard = SPADE_HAZARDS[rank]!;
  const opt = pending.hazard_option === 2 ? hazard.option2 : hazard.option1;
  const source = { who: pending.carrier_who, ...(pending.carrier_name ? { crew_name: pending.carrier_name } : {}) };
  state.pending = null;
  const notes: string[] = [];
  const out = applyHazardConsequence(state, opt.ability, source, notes);
  afterResolution(state, notes);
  return `${out}${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

function applyHazardConsequence(
  state: WarbleWayGalaxyState,
  ability: AbilityId,
  scoreSource: { who: 'self' | 'crew'; crew_name?: string },
  notes: string[],
): string {
  const consequence: HazardConsequence = HAZARD_CONSEQUENCE_BY_STAT[ABILITY_STAT[ability]];
  switch (consequence) {
    case 'death': {
      if (scoreSource.who === 'crew' && scoreSource.crew_name) {
        const victim = state.crew.find((c) => c.name === scoreSource.crew_name);
        if (victim) removeCrewMember(state, victim, 'dies in the hazard');
        awardXp(state, 1);
        return `${scoreSource.crew_name} DIES — their score carried the roll (WR §10). Remove them and their equipped gear. +1 XP (you survived).`;
      }
      state.pending = {
        kind: 'roll',
        reason: 'death_check',
        dice_count: 3,
        score_source: { who: 'self', ability: null, bonus: 0 },
        min_roll: 9,
        declared_items: [],
        context: { death_source: 'hazard' },
      };
      return 'DEATH looms — the score was yours: roll 3d6; below 9 you die and the game is over (WR §10).';
    }
    case 'lose_credits': {
      state.character!.credits -= 100;
      if (state.character!.credits < -300) {
        setLoss(state, `Debt beyond 300c (${state.character!.credits}c) — the creditors take everything. GAME OVER (WR §10).`);
        return `Lose 100c → ${state.character!.credits}c. Your debt passes 300c — GAME OVER.`;
      }
      awardXp(state, 1);
      return `Lose 100c → ${state.character!.credits}c${state.character!.credits < 0 ? ' (in debt — beyond −300c is game over)' : ''}. +1 XP (survived).`;
    }
    case 'ship_damage': {
      if (!damageShip(state, 'hazard', notes)) return 'The hazard tears the ship apart.';
      awardXp(state, 1);
      return '+1 XP (survived).';
    }
    case 'crew_unrest': {
      const departures: string[] = [];
      for (const c of [...state.crew]) {
        c.anger_tokens += 1;
        if (c.anger_tokens >= 3) {
          removeCrewMember(state, c, 'storms off with 3 anger tokens');
          departures.push(c.name);
        }
      }
      awardXp(state, 1);
      return `Crew unrest: +1 anger token to each crew member${
        departures.length ? `; ${departures.join(' and ')} LEAVE (3 tokens), taking their gear` : ''
      }. +1 XP (survived).`;
    }
  }
}

function removeCrewMember(state: WarbleWayGalaxyState, crew: CrewMember, _why: string): void {
  state.crew = state.crew.filter((c) => c.name !== crew.name);
  for (const gearId of [crew.gear.weapon, crew.gear.armor]) {
    if (gearId) state.items = state.items.filter((i) => i.id !== gearId);
  }
}

function resolveDeathCheck(state: WarbleWayGalaxyState, source: 'hazard' | 'boarding' | 'ruin', passed: boolean, notes: string[]): string {
  const char = state.character!;
  let woundedNote = '';
  if (!passed) {
    // Amendment A4: the FIRST failed death check wounds (−1 all effective
    // scores, heals on habitat arrival); a failure while wounded kills.
    if (char.wounded === true) {
      setLoss(state, `${char.name} dies — a second failed death check while WOUNDED (WR §10, amendment A4).`);
      return `${char.name} DIES. GAME OVER.`;
    }
    char.wounded = true;
    woundedNote = `${char.name} is WOUNDED — −1 to all scores until the next habitat arrival; another failed death check kills (amendment A4). `;
  }
  const lived = passed ? 'You survive' : 'You barely survive';
  if (source === 'boarding') {
    const enc = spaceEnc(state);
    if (enc.kind === 'space_combat') {
      enc.stage = 'disabled';
      state.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
    }
    return `${woundedNote}${lived} the botched boarding. The pirate ship is still disabled — board again or move on.`;
  }
  if (source === 'ruin') {
    return `${woundedNote}${lived} the blow and keep fighting (WR §14).`; // advanceRuin resumes the attacker phase
  }
  awardXp(state, 1);
  return `${woundedNote}${lived} — you cling to life. +1 XP (hazard survived).`;
}

// ---------------------------------------------------------------------------
// ♣ space missions & ♥ space recruits & ♦ ruins discoveries
// ---------------------------------------------------------------------------

export function applyAcceptMission(state: WarbleWayGalaxyState, option: 1 | 2): string {
  const pending = state.pending;
  if (pending?.kind !== 'space_mission_offer') throw new GameError('ILLEGAL_MOVE', 'No mission offer is open right now.');
  const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof CLUB_MISSIONS;
  const entry = CLUB_MISSIONS[rank]!;
  const mission = entry.kind === 'choice' ? (option === 1 ? entry.option1 : entry.option2) : entry.mission;
  if (mission.goal.kind !== 'ruin' && !partyQualifiesFor(state, mission.goal.ability)) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `Nobody aboard has ${mission.goal.ability} (and no item grants it) — you cannot take this mission (WR §7). Decline it or pick the other option.`,
    );
  }
  state.pending = null;
  const cards = legCards(state, mission.distance);
  state.journey_stack.push({ purpose: { kind: 'mission_return', mission_id: mission.id }, cards_remaining: cards });
  state.journey_stack.push({ purpose: { kind: 'mission_outbound', mission_id: mission.id }, cards_remaining: cards });
  const notes: string[] = [];
  maybeStartResPeek(state, cards * 2, notes);
  afterResolution(state, notes);
  return (
    `Space mission accepted (${describeMission(mission)}) — SANDWICHED on top of the journey in progress (WR §7): ` +
    `deal ${cards} outbound + ${cards} return cards on top of your current stacks.` +
    (notes.length ? ` ${notes.join(' ')}` : '')
  );
}

export function applyDeclineMission(state: WarbleWayGalaxyState): string {
  if (state.pending?.kind !== 'space_mission_offer') throw new GameError('ILLEGAL_MOVE', 'No mission offer is open right now.');
  state.pending = null;
  const notes: string[] = [];
  afterResolution(state, notes);
  return `Mission declined — onward.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applyAttemptSpaceRecruit(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'space_recruit_offer') throw new GameError('ILLEGAL_MOVE', 'No space recruit is on offer right now.');
  const rank = pending.card_id.replace(/[HDSC]$/, '') as keyof typeof HEART_RECRUITS;
  const recruit = HEART_RECRUITS[rank]!;
  const best = bestForStat(state, recruit.idealized);
  const actDie = anyoneHasEffective(state, 'ACT') && (recruit.race === 'hexapod' || recruit.race === 'kralkin') ? 1 : 0;
  state.pending = {
    kind: 'roll',
    reason: 'recruit',
    dice_count: 3 + actDie,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: best.ability, bonus: best.bonus },
    min_roll: recruit.min_roll,
    declared_items: [],
    context: { recruit_id: recruit.id, recruit_source: 'space' },
  };
  return (
    `Recruiting the drifting ${describeRecruit(recruit)} — they idealize ${recruit.idealized}. ` +
    `Roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} + ${best.bonus}; you need ${recruit.min_roll}+.`
  );
}

export function applyDeclineRecruit(state: WarbleWayGalaxyState): string {
  if (state.pending?.kind !== 'space_recruit_offer') throw new GameError('ILLEGAL_MOVE', 'No space recruit is on offer right now.');
  state.pending = null;
  const notes: string[] = [];
  afterResolution(state, notes);
  return `You leave them adrift — onward.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applySkipRuin(state: WarbleWayGalaxyState): string {
  if (state.pending?.kind === 'ruin_discovery') {
    state.pending = null;
    const notes: string[] = [];
    afterResolution(state, notes);
    return `The ruins slide past the viewport, unexplored.${notes.length ? ` ${notes.join(' ')}` : ''}`;
  }
  if (state.pending?.kind === 'ruin_continue') {
    const run = currentRun(state);
    state.pending = null;
    const notes: string[] = [];
    const out = finishRuinRun(state, run, false, 'you choose not to go deeper', notes);
    return `${out}${notes.length ? ` ${notes.join(' ')}` : ''}`;
  }
  throw new GameError('ILLEGAL_MOVE', 'No ruin decision is open right now.');
}

// ---------------------------------------------------------------------------
// Mission arrival & payout (WR §7)
// ---------------------------------------------------------------------------

function missionArrival(state: WarbleWayGalaxyState, missionId: string, notes: string[]): void {
  const mission = missionById(missionId);
  if (mission.goal.kind === 'ruin') {
    startRuinRun(state, { type: 'mission', mission_id: missionId }, mission.goal.depth);
    notes.push(
      `ARRIVED at the ruins (mission target: depth ${mission.goal.depth}). Every run starts at the R1 map (WR §14) — set up the encounter.`,
    );
    return;
  }
  if (!partyQualifiesFor(state, mission.goal.ability)) {
    notes.push(
      `Arrived at the mission site, but nobody aboard still has ${mission.goal.ability} — AUTOMATIC FAILURE, no reward (WR §7). The return trip remains.`,
    );
    return;
  }
  const best = bestForAbility(state, mission.goal.ability);
  const actDie = actDieFor(state, mission.goal.ability);
  state.pending = {
    kind: 'roll',
    reason: 'mission_check',
    dice_count: 3 + actDie,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: mission.goal.ability, bonus: best.bonus },
    min_roll: mission.goal.min_roll,
    declared_items: [],
    context: { mission_id: mission.id },
  };
  notes.push(
    `ARRIVED at the mission site: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} + ${mission.goal.ability} ${best.bonus} (${best.who === 'self' ? 'you' : best.crew_name}) vs ${mission.goal.min_roll}.`,
  );
}

function resolveMissionCheck(state: WarbleWayGalaxyState, missionId: string, passed: boolean): string {
  const mission = missionById(missionId);
  if (mission.goal.kind !== 'ability_check') throw new GameError('STORAGE_ERROR', 'Ruin missions resolve with M4.');
  if (!passed) {
    return `Mission FAILED — no credits, no XP (WR §7). The return trip remains.`;
  }
  const char = state.character!;
  let credits = mission.credits;
  const payoutNotes: string[] = [];
  // Je ne sais quoi (natural ACT≥3 anywhere aboard): +100 × that ACT score; compounds with Silver Tongue (WR §5).
  const actHolders = [char.abilities.ACT ?? 0, ...state.crew.map((c) => c.abilities.ACT ?? 0)].filter((v) => v >= 3);
  if (actHolders.length > 0) {
    const bonus = 100 * Math.max(...actHolders);
    credits += bonus;
    payoutNotes.push(`Je ne sais quoi +${bonus}c`);
  }
  // Silver Tongue (natural DIP≥3 anywhere aboard): mission credits doubled (WR §5).
  if (anyBeingHasAdvanced(state, 'DIP')) {
    credits *= 2;
    payoutNotes.push('Silver Tongue ×2');
  }
  char.credits += credits;
  awardXp(state, mission.xp);
  if (missionId.startsWith('h')) {
    state.habitat_progress[state.current_habitat]!.missions_succeeded.push(missionId);
  }
  // Amendment A1c ("more repair opportunities"): planetside downtime while
  // completing the job — a SUCCESSFUL mission also repairs one damage level.
  let repairNote = '';
  if (state.ship && state.ship.damage !== 'pristine') {
    state.ship.damage = repairShipOneLevel(state.ship.damage);
    repairNote = ` Planetside downtime: the ${state.ship.name} repairs one level → ${state.ship.damage.toUpperCase()} (amendment A1c).`;
  }
  return `Mission SUCCESS — claim ${credits}c${payoutNotes.length ? ` (${payoutNotes.join(', ')})` : ''} and ${mission.xp} XP → ${char.credits}c, ${char.xp} XP.${repairNote} The return trip remains.`;
}

// ---------------------------------------------------------------------------
// The journey loop — advance after every resolution (pending hygiene)
// ---------------------------------------------------------------------------

function arriveAtHabitat(state: WarbleWayGalaxyState, notes: string[]): void {
  state.phase = 'at_habitat';
  const progress = state.habitat_progress[state.current_habitat]!;
  progress.repair_rolled_this_arrival = false;
  progress.unrest_rolled_this_arrival = false;
  progress.fabricated_this_arrival = false; // A18: the workshop resets per visit
  const autoRepair = applyArrivalAutoRepair(state);
  if (autoRepair) notes.push(autoRepair);
  if (state.character?.wounded === true) {
    state.character.wounded = false; // amendment A4: wounds heal on arrival
    notes.push(`${state.character.name}'s wounds are treated at the habitat — no longer WOUNDED (amendment A4).`);
  }
  notes.push(`Docked at Habitat #${state.current_habitat} — ${HABITATS[state.current_habitat]!.name}. Repair and unrest rolls are available this arrival.`);
  checkFortune(state, notes); // A11: dock rich enough and the season ends in retirement
}

export function afterResolution(state: WarbleWayGalaxyState, notes: string[]): void {
  settlePending(state);
  if (state.phase === 'ruin' && state.pending === null) {
    advanceRuin(state, notes);
  }
  while (state.pending === null && state.phase === 'traveling' && state.result === null) {
    const top = state.journey_stack[state.journey_stack.length - 1];
    if (!top) {
      arriveAtHabitat(state, notes);
      break;
    }
    if (top.cards_remaining > 0) {
      ensureDeckHasCards(state, notes);
      state.pending = { kind: 'card_draw' };
      break;
    }
    state.journey_stack.pop();
    if (top.purpose.kind === 'mission_outbound') {
      missionArrival(state, top.purpose.mission_id, notes);
    } else if (top.purpose.kind === 'habitat_transfer') {
      state.current_habitat = top.purpose.to_habitat;
      arriveAtHabitat(state, notes);
      break;
    }
    // mission_return finished: keep unwinding (a sandwich resumes the outer leg).
  }
}

// ===========================================================================
// M3 — space combat (WR §12)
// ===========================================================================

function spaceEnc(state: WarbleWayGalaxyState): SpaceCombatEncounter {
  const enc = state.encounter;
  if (!enc || enc.kind !== 'space_combat') throw new GameError('STORAGE_ERROR', 'No space combat encounter in state.');
  return enc;
}

function encounterOrThrow(state: WarbleWayGalaxyState, ...stages: SpaceCombatEncounter['stage'][]): SpaceCombatEncounter {
  const enc = state.encounter;
  if (!enc || enc.kind !== 'space_combat' || state.phase !== 'space_combat') {
    throw new GameError('ILLEGAL_MOVE', 'There is no space combat in progress.');
  }
  if (!stages.includes(enc.stage)) {
    throw new GameError('ILLEGAL_MOVE', `Not possible right now (combat stage: ${enc.stage.replace(/_/g, ' ')}) — follow next_step.`);
  }
  return enc;
}

function pirateOf(enc: SpaceCombatEncounter): PirateDefinition {
  return DIAMOND_PIRATES[enc.pirate_rank];
}

/** Player space-combat advantage: PIL basic skill aboard, or a ship part —
 * CANCELLED by pirate ♦4's own Space Combat Advantage (interpretation, PORT-NOTES). */
function playerSpaceAdvantage(state: WarbleWayGalaxyState, enc: SpaceCombatEncounter): boolean {
  if (pirateOf(enc).special === 'space_combat_advantage') return false;
  if (anyoneHasEffective(state, 'PIL')) return true;
  return state.ship!.parts.some((p) => {
    const item = state.items.find((i) => i.id === p);
    return item?.effect.kind === 'space_combat_advantage';
  });
}

/** The PIL score added with advantage; pirate ♦8's special trims the player's
 * space-combat bonus by 2, min 0 (interpretation, PORT-NOTES). */
function playerSpaceBonus(state: WarbleWayGalaxyState, enc: SpaceCombatEncounter): number {
  if (!playerSpaceAdvantage(state, enc)) return 0;
  const pil = bestForAbility(state, 'PIL').bonus;
  const trim = pirateOf(enc).special === 'minus_2_enemy_space_bonus' ? 2 : 0;
  return Math.max(0, pil - trim);
}

function endEncounter(state: WarbleWayGalaxyState): void {
  state.encounter = null;
  state.phase = 'traveling';
}

/** Amendment A15 "Shields": natural ARM 3 anywhere aboard (advanced skills
 * apply to crew, WR §5) hardens the hull — ship armor +1. */
export function effectiveShipArmor(state: WarbleWayGalaxyState): number {
  return (state.ship?.armor ?? 0) + (anyBeingHasAdvanced(state, 'ARM') ? 1 : 0);
}

function startPirateEncounter(state: WarbleWayGalaxyState, cardId: string): string {
  const rank = cardId.replace(/[HDSC]$/, '') as PirateRank;
  const pirate = DIAMOND_PIRATES[rank];
  state.encounter = { kind: 'space_combat', card_id: cardId, pirate_rank: rank, stage: 'choose_action', reroll_used: false, volley_used: false };
  state.phase = 'space_combat';
  state.pending = { kind: 'space_combat_action' };
  return (
    `PIRATES! An aggressive ship attacks (♦${rank}): space combat bonus +${pirate.space_attack}, ground combat +${pirate.ground_attack}, ` +
    `capacity ${pirate.capacity}, speed +${pirate.speed}, handling ${pirate.handling}, min. hacking ${pirate.min_hacking}` +
    `${pirate.special === 'space_combat_advantage' ? ', SPACE COMBAT ADVANTAGE' : ''}${pirate.special === 'minus_2_enemy_space_bonus' ? ', −2 to your space-combat bonus' : ''}. ` +
    'You must engage: attempt_escape, attempt_hack (needs HAK), open_fire (GUN, once — A6), attempt_intimidate (DEM — A7), or fight_round (WR §12).'
  );
}

/** Amendment A5 "Running Silent": 3d6 + best SNE vs 10 + pirate speed, before
 * the encounter starts. Success = no encounter; failure = they spot you (the
 * normal encounter is the whole penalty). */
export function applyAttemptEvade(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'evade_offer') throw new GameError('ILLEGAL_MOVE', 'No pirates to slip past right now.');
  const rank = pending.card_id.replace(/[HDSC]$/, '') as PirateRank;
  const pirate = DIAMOND_PIRATES[rank];
  const sne = bestForAbility(state, 'SNE');
  state.pending = {
    kind: 'roll',
    reason: 'evade',
    dice_count: 3,
    score_source: { who: sne.who, ...(sne.crew_name ? { crew_name: sne.crew_name } : {}), ability: 'SNE', bonus: sne.bonus },
    min_roll: 10 + pirate.speed,
    declared_items: [],
    context: { evade_card_id: pending.card_id },
  };
  return `Running silent: roll 3d6 + SNE ${sne.bonus} (${sne.who === 'self' ? 'you' : sne.crew_name}) vs ${10 + pirate.speed} (10 + their speed). Success slips past; failure only means they spot you (amendment A5).`;
}

export function applyDeclineEvade(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'evade_offer') throw new GameError('ILLEGAL_MOVE', 'No pirates to slip past right now.');
  state.pending = null;
  return `Weapons hot — you engage. ${startPirateEncounter(state, pending.card_id)}`;
}

function resolveEvadeRoll(state: WarbleWayGalaxyState, cardId: string, passed: boolean, _notes: string[]): string {
  if (passed) {
    // The shared report_roll tail runs afterResolution — the journey continues.
    return 'You drift past on cold thrusters — the pirates never see you (Running Silent, amendment A5).';
  }
  return `They spot you on the scopes. ${startPirateEncounter(state, cardId)}`;
}

export function applyAttemptEscape(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const pirate = pirateOf(enc);
  const pil = bestForAbility(state, 'PIL');
  const bonus = state.ship!.handling + pil.bonus;
  state.pending = {
    kind: 'roll',
    reason: 'escape',
    dice_count: 3,
    score_source: { who: pil.bonus > 0 ? pil.who : 'self', ...(pil.crew_name && pil.bonus > 0 ? { crew_name: pil.crew_name } : {}), ability: 'PIL', bonus },
    min_roll: 10 + pirate.space_attack,
    declared_items: [],
    context: {},
  };
  return `Punching the engines: roll 3d6 + ship handling ${state.ship!.handling}${pil.bonus > 0 ? ` + PIL ${pil.bonus}` : ''} vs ${10 + pirate.space_attack}. Fail: the ship takes one damage, then (if it survives) you escape anyway (WR §12).`;
}

function resolveEscapeRoll(state: WarbleWayGalaxyState, passed: boolean, notes: string[]): string {
  if (passed) {
    endEncounter(state);
    return 'Clean getaway — the pirates shrink to a dot behind you.';
  }
  if (!damageShip(state, 'a parting shot as you flee', notes)) return 'The parting shot finds the reactor.';
  endEncounter(state);
  return 'The pirates land a parting shot, but you get away (WR §12: a failed escape damages the ship, then you escape).';
}

export function applyAttemptHack(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const hak = bestForAbility(state, 'HAK');
  if (hak.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Hacking needs HAK aboard (WR §4).');
  const actDie = actDieFor(state, 'HAK');
  state.pending = {
    kind: 'roll',
    reason: 'hack',
    dice_count: 3 + actDie,
    score_source: { who: hak.who, ...(hak.crew_name ? { crew_name: hak.crew_name } : {}), ability: 'HAK', bonus: hak.bonus },
    min_roll: pirateOf(enc).min_hacking,
    declared_items: [],
    context: {},
  };
  return `Hacking the pirate ship: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die on Smarts rolls)' : ''} + HAK ${hak.bonus} vs their min. hacking ${pirateOf(enc).min_hacking}. Success disables them; failure lets them attack unopposed this round (ruling #10).`;
}

function resolveHackRoll(state: WarbleWayGalaxyState, passed: boolean, notes: string[]): string {
  const enc = spaceEnc(state);
  if (passed) {
    let bounty = '';
    if (anyBeingHasAdvanced(state, 'HAK')) {
      state.character!.credits += 200;
      bounty = ` Hackers Delight: +200c (→ ${state.character!.credits}c).`;
    }
    enc.stage = 'disabled';
    state.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
    return `Their systems die mid-volley — the pirate ship is DISABLED.${bounty} Board it or move on (WR §12).`;
  }
  if (!damageShip(state, 'an unopposed pirate attack while you fumbled the hack', notes)) return 'The hack fails and their volley finds the reactor.';
  enc.stage = 'choose_action';
  state.pending = { kind: 'space_combat_action' };
  return 'The hack fails and the pirates pound the hull unopposed (ruling #10). Back to it: escape, hack, or fight.';
}

/** Amendment A6 "Opening Volley": 3d6 + best GUN vs 12, once per encounter.
 * Success holes their ship at range (−2 to every pirate exchange total for
 * the rest of the combat); failure = they close and attack unopposed. */
export function applyOpenFire(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const gun = bestForAbility(state, 'GUN');
  if (gun.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'The Opening Volley needs GUN aboard (amendment A6).');
  if (enc.volley_used === true) throw new GameError('ILLEGAL_MOVE', 'The Opening Volley is once per encounter (amendment A6) — already fired.');
  enc.volley_used = true; // the attempt consumes it
  state.pending = {
    kind: 'roll',
    reason: 'volley',
    dice_count: 3,
    score_source: { who: gun.who, ...(gun.crew_name ? { crew_name: gun.crew_name } : {}), ability: 'GUN', bonus: gun.bonus },
    min_roll: 12,
    declared_items: [],
    context: {},
  };
  return `Opening volley at range: roll 3d6 + GUN ${gun.bonus} (${gun.who === 'self' ? 'you' : gun.crew_name}) vs 12. Success: −2 to every pirate exchange total this combat; failure: they close and attack unopposed (amendment A6).`;
}

function resolveVolleyRoll(state: WarbleWayGalaxyState, passed: boolean, notes: string[]): string {
  const enc = spaceEnc(state);
  if (passed) {
    enc.pirate_debuff = 2;
    enc.stage = 'choose_action';
    state.pending = { kind: 'space_combat_action' };
    return 'The volley holes their hull at range — the pirate takes −2 to every exchange total this combat (amendment A6). Now: escape, hack, intimidate, or fight.';
  }
  if (!damageShip(state, 'the pirates close the distance while your volley goes wide', notes)) return 'The volley goes wide and their answer finds the reactor.';
  enc.stage = 'choose_action';
  state.pending = { kind: 'space_combat_action' };
  return 'The volley goes wide — they close and pound the hull unopposed (amendment A6). Back to it: escape, hack, intimidate, or fight.';
}

/** Amendment A20 "Redline" (designer-approved 2026-07-09): once per
 * encounter, an MEC check (3d6 + best MEC vs 12) overcharges the engines for
 * +2 on every PLAYER exchange total this combat; failure = they attack
 * unopposed while the engineer is elbow-deep in the reactor. Measured: the
 * ONLY lever that moved MEC-primary (1% → 6% wins at n=100, survival ×1.9,
 * every win a Legend) — repair-flavored buffs all measured null because the
 * engineer dies of exchange losses, not slow leaks. */
export function applyRedline(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const mec = bestForAbility(state, 'MEC');
  if (mec.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Redlining needs MEC aboard.');
  if (enc.redline_used === true) throw new GameError('ILLEGAL_MOVE', 'The engines are already redlined — once per encounter.');
  enc.redline_used = true;
  state.pending = {
    kind: 'roll',
    reason: 'redline',
    dice_count: 3,
    score_source: { who: mec.who, ...(mec.crew_name ? { crew_name: mec.crew_name } : {}), ability: 'MEC', bonus: mec.bonus },
    min_roll: 12,
    declared_items: [],
    context: {},
  };
  return `Redline: roll 3d6 + MEC ${mec.bonus} vs 12 — success overcharges the engines (+2 to YOUR exchange totals this combat); failure, they attack unopposed.`;
}

export function resolveRedlineRoll(state: WarbleWayGalaxyState, passed: boolean, notes: string[]): string {
  const enc = spaceEnc(state);
  if (passed) {
    enc.player_buff = 2;
    enc.stage = 'choose_action';
    state.pending = { kind: 'space_combat_action' };
    return 'The engines SCREAM — +2 to every exchange total this combat (Redline). Now: escape, hack, or fight.';
  }
  if (!damageShip(state, 'an unopposed volley while the engineer was in the reactor', notes)) return 'The overcharge fails and their volley finds the reactor.';
  enc.stage = 'choose_action';
  state.pending = { kind: 'space_combat_action' };
  return 'The overcharge sputters — they pound the hull unopposed. Back to it.';
}

/** Amendment A7 "Stand Down or Burn": 3d6 + best DEM vs 10 + pirate space
 * attack. Success: they break off (combat ends, no damage, no loot); failure:
 * insulted, they attack unopposed. */
export function applyAttemptIntimidate(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const dem = bestForAbility(state, 'DEM');
  if (dem.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Intimidation needs DEM aboard (amendment A7).');
  const pirate = pirateOf(enc);
  const actDie = actDieFor(state, 'DEM');
  state.pending = {
    kind: 'roll',
    reason: 'intimidate',
    dice_count: 3 + actDie,
    score_source: { who: dem.who, ...(dem.crew_name ? { crew_name: dem.crew_name } : {}), ability: 'DEM', bonus: dem.bonus },
    min_roll: 10 + pirate.space_attack,
    declared_items: [],
    context: {},
  };
  return `"Stand down or burn": roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} + DEM ${dem.bonus} (${dem.who === 'self' ? 'you' : dem.crew_name}) vs ${10 + pirate.space_attack} (10 + their space attack). Success: they break off; failure: insulted, they attack unopposed (amendment A7).`;
}

/** A9b Dread: +1 (cap 3) per successful shakedown or boarding victory; each
 * point adds +1 to intimidation rolls. Returns a note when it grows. */
function gainDread(state: WarbleWayGalaxyState, deed: string): string {
  const current = state.dread ?? 0;
  if (current >= 3) return '';
  state.dread = current + 1;
  return ` Word of ${deed} spreads — DREAD ${state.dread}/3 (+${state.dread} to intimidation, amendment A9b).`;
}

/** A10: the unnamed-crew cap — as many bodies as the best NATURAL DIP aboard
 * can hold together. */
export function unnamedCap(state: WarbleWayGalaxyState): number {
  let best = state.character?.abilities.DIP ?? 0;
  for (const c of state.crew) best = Math.max(best, c.abilities.DIP ?? 0);
  return best;
}

function resolveIntimidateRoll(state: WarbleWayGalaxyState, passed: boolean, notes: string[]): string {
  const enc = spaceEnc(state);
  if (passed) {
    // A9a Tribute (natural DEM 3 aboard): they buy their lives — 50c × their
    // space attack. A9b: any successful shakedown grows your Dread.
    const pirate = pirateOf(enc);
    let tributeNote = '';
    if (anyBeingHasAdvanced(state, 'DEM')) {
      const tribute = 50 * pirate.space_attack;
      state.character!.credits += tribute;
      tributeNote = ` They STRIKE THEIR COLORS and pay tribute: +${tribute}c (50 × their space attack; Fearsome Reputation, amendment A9a) → ${state.character!.credits}c.`;
    }
    const dreadNote = gainDread(state, 'the shakedown');
    endEncounter(state);
    return `Their captain blinks first — the pirates break off and burn away (Stand Down or Burn, amendment A7).${tributeNote}${dreadNote}`;
  }
  if (!damageShip(state, 'an unopposed pirate attack after the failed bluff', notes)) return 'They call the bluff and their volley finds the reactor.';
  // Amendment A13: the RABBLE (space attack ≤ 3) knows when to quit — even a
  // failed shakedown convinces them you're not worth it. One free hit, then
  // they burn away (removes the still-in-combat spiral that made failed
  // bluffs so much costlier than failed escapes).
  if (pirateOf(enc).space_attack <= 3) {
    endEncounter(state);
    return 'They land a spiteful volley — then think better of it and burn away (the rabble knows when to quit, amendment A13).';
  }
  enc.stage = 'choose_action';
  state.pending = { kind: 'space_combat_action' };
  return 'They laugh on an open channel and pound the hull unopposed (amendment A7). Back to it: escape, hack, or fight.';
}

/** A10: once per HABITAT, work the docks — 3d6 + best DIP vs 12 → +1 unnamed crew. */
export function applyRecruitUnnamed(state: WarbleWayGalaxyState): string {
  requireAtHabitatNoPending(state, 'working the docks');
  const progress = state.habitat_progress[state.current_habitat]!;
  if (progress.unnamed_rolled === true) {
    throw new GameError('ILLEGAL_MOVE', 'The docks have been worked at this habitat already (once per habitat, amendment A10).');
  }
  const dip = bestForAbility(state, 'DIP');
  if (dip.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Recruiting unnamed crew needs DIP aboard (amendment A10).');
  const cap = unnamedCap(state);
  if ((state.unnamed_crew ?? 0) >= cap) {
    throw new GameError('ILLEGAL_MOVE', `Your crew can hold together at most ${cap} unnamed hand(s) (cap = best natural DIP aboard, amendment A10).`);
  }
  progress.unnamed_rolled = true; // the attempt spends it
  const actDie = actDieFor(state, 'DIP');
  state.pending = {
    kind: 'roll',
    reason: 'unnamed_recruit',
    dice_count: 3 + actDie,
    score_source: { who: dip.who, ...(dip.crew_name ? { crew_name: dip.crew_name } : {}), ability: 'DIP', bonus: dip.bonus },
    min_roll: 12,
    declared_items: [],
    context: { unnamed_source: 'habitat' },
  };
  return `Working the docks: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} + DIP ${dip.bonus} (${dip.who === 'self' ? 'you' : dip.crew_name}) vs 12 — success signs one unnamed crew hand (amendment A10).`;
}

/** A10: after a space victory (pirate disabled/captured), talk the survivors
 * aboard — 3d6 + best DIP vs 12 → +1 unnamed crew. Once per encounter. */
export function applyRecruitSurvivors(state: WarbleWayGalaxyState): string {
  const pending = state.pending;
  if (pending?.kind !== 'boarding_decision') {
    throw new GameError('ILLEGAL_MOVE', 'Survivors are recruited off a beaten pirate ship — win the space fight first (amendment A10).');
  }
  const enc = spaceEnc(state);
  if (enc.survivors_rolled === true) {
    throw new GameError('ILLEGAL_MOVE', 'The survivors have already been canvassed this encounter (once per victory, amendment A10).');
  }
  const dip = bestForAbility(state, 'DIP');
  if (dip.bonus < 1) throw new GameError('ILLEGAL_MOVE', 'Talking survivors aboard needs DIP (amendment A10).');
  const cap = unnamedCap(state);
  if ((state.unnamed_crew ?? 0) >= cap) {
    throw new GameError('ILLEGAL_MOVE', `Your crew can hold together at most ${cap} unnamed hand(s) (cap = best natural DIP aboard, amendment A10).`);
  }
  enc.survivors_rolled = true; // the attempt spends it
  const actDie = actDieFor(state, 'DIP');
  state.pending = {
    kind: 'roll',
    reason: 'unnamed_recruit',
    dice_count: 3 + actDie,
    score_source: { who: dip.who, ...(dip.crew_name ? { crew_name: dip.crew_name } : {}), ability: 'DIP', bonus: dip.bonus },
    min_roll: 12,
    declared_items: [],
    context: { unnamed_source: 'survivors' },
  };
  return `Canvassing the beaten crew: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die)' : ''} + DIP ${dip.bonus} (${dip.who === 'self' ? 'you' : dip.crew_name}) vs 12 — success signs one unnamed hand (amendment A10). Then decide the ship.`;
}

function resolveUnnamedRecruitRoll(state: WarbleWayGalaxyState, source: 'habitat' | 'survivors', passed: boolean): string {
  let out: string;
  if (passed) {
    const cap = unnamedCap(state);
    state.unnamed_crew = Math.min(cap, (state.unnamed_crew ?? 0) + 1);
    out = `One drifting soul signs on — UNNAMED CREW ${state.unnamed_crew}/${cap} (bodies for the ground game; no scores, no gear, no name; amendment A10).`;
  } else {
    out = source === 'habitat' ? 'The docks turn you down — nobody bites this time.' : 'The survivors would rather drift than serve you.';
  }
  if (source === 'survivors' && state.encounter?.kind === 'space_combat') {
    // Restore the interrupted victory decision.
    state.pending = {
      kind: 'boarding_decision',
      stage: state.encounter.stage === 'captured' ? 'take_or_abandon' : 'board_or_leave',
    };
  }
  return out;
}

export function applyFightRound(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'choose_action');
  if (state.pending?.kind !== 'space_combat_action') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  const adv = playerSpaceAdvantage(state, enc);
  const pil = bestForAbility(state, 'PIL'); // attribute the carried score so Inspirational can apply (WR §5)
  state.pending = {
    kind: 'roll',
    reason: 'space_combat',
    dice_count: 4,
    score_source: {
      who: adv && pil.bonus > 0 ? pil.who : 'self',
      ...(adv && pil.crew_name && pil.bonus > 0 ? { crew_name: pil.crew_name } : {}),
      ability: adv ? 'PIL' : null,
      bonus: playerSpaceBonus(state, enc),
    },
    min_roll: null,
    declared_items: [],
    context: {},
  };
  return (
    `Exchange of fire: roll 4d6. Pair the highest+lowest and the two middles; you take the ${adv ? 'HIGHER (space combat advantage)' : 'LOWER (no advantage)'} pair` +
    `${state.pending.score_source.bonus > 0 ? ` + PIL ${state.pending.score_source.bonus}` : ''}; the pirate adds +${pirateOf(enc).space_attack} to the other, minus your ship armor ${effectiveShipArmor(state)}${anyBeingHasAdvanced(state, 'ARM') ? ' (incl. Shields +1, A15)' : ''} (WR §12).`
  );
}

function pairTotals(dice: number[]): { high: number; low: number } {
  const sorted = [...dice].sort((a, b) => b - a);
  const pairA = sorted[0]! + sorted[3]!; // highest + lowest
  const pairB = sorted[1]! + sorted[2]!; // the two middles
  return { high: Math.max(pairA, pairB), low: Math.min(pairA, pairB) };
}

function resolveSpaceCombatRoll(state: WarbleWayGalaxyState, dice: number[], flatBonus: number, notes: string[]): string {
  const enc = spaceEnc(state);
  const pirate = pirateOf(enc);
  const adv = playerSpaceAdvantage(state, enc);
  const { high, low } = pairTotals(dice);
  const playerPair = adv ? high : low;
  const piratePair = adv ? low : high;
  const buff = enc.player_buff ?? 0; // A20 Redline: the overcharged engines
  const playerTotal = playerPair + flatBonus + buff;
  const debuff = enc.pirate_debuff ?? 0; // A6: a landed Opening Volley holes them for the whole combat
  const armor = effectiveShipArmor(state); // A15: Shields (natural ARM 3) = +1
  const pirateTotal = Math.max(0, piratePair + pirate.space_attack - armor - debuff);
  const line = `Your pair ${playerPair}${flatBonus ? `+${flatBonus}` : ''}${buff ? `+redline ${buff}` : ''} = ${playerTotal} vs pirate ${piratePair}+${pirate.space_attack}−armor ${armor}${debuff ? `−volley ${debuff}` : ''} = ${pirateTotal}.`;
  if (playerTotal === pirateTotal) {
    state.pending = {
      kind: 'roll',
      reason: 'space_combat',
      dice_count: 4,
      score_source: { who: 'self', ability: adv ? 'PIL' : null, bonus: playerSpaceBonus(state, enc) },
      min_roll: null,
      declared_items: [],
      context: {},
    };
    return `${line} TIE — reroll the 4d6 (WR §12).`;
  }
  if (playerTotal > pirateTotal) {
    enc.stage = 'disabled';
    state.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
    // (A11 note: a mere DISABLE is the pilot's work — Bounty counts only
    // face-to-face victories: boarding captures and ruin kills. First
    // calibration counted disables and the DEFAULT policy stumbled into the
    // ending 60% of the time by move ~250.)
    return `${line} You WIN the exchange — the pirate ship is DISABLED. Board it or move on (WR §12).`;
  }
  // Lost the exchange. Flying Ace (natural PIL≥3 anywhere aboard) may reroll once per combat.
  if (!enc.reroll_used && anyBeingHasAdvanced(state, 'PIL')) {
    enc.stage = 'loss_reroll_offer';
    state.pending = { kind: 'space_combat_action' };
    return `${line} You LOSE the exchange — but Flying Ace can reroll space combat once (WR §5): use_reroll, or accept_result to take the hit.`;
  }
  return applyExchangeLoss(state, line, notes);
}

function applyExchangeLoss(state: WarbleWayGalaxyState, line: string, notes: string[]): string {
  const enc = spaceEnc(state);
  if (!damageShip(state, 'the pirates win the exchange', notes)) return `${line} The volley finds the reactor.`;
  enc.stage = 'choose_action';
  state.pending = { kind: 'space_combat_action' };
  return `${line} You LOSE the exchange. Back to it: escape, hack, or fight (WR §12).`;
}

export function applyUseReroll(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'loss_reroll_offer');
  enc.reroll_used = true;
  enc.stage = 'choose_action'; // the reroll replaces the exchange
  const adv = playerSpaceAdvantage(state, enc);
  state.pending = {
    kind: 'roll',
    reason: 'space_combat',
    dice_count: 4,
    score_source: { who: 'self', ability: adv ? 'PIL' : null, bonus: playerSpaceBonus(state, enc) },
    min_roll: null,
    declared_items: [],
    context: {},
  };
  return 'Flying Ace: scrap that exchange and reroll the 4d6 (once per combat, WR §5).';
}

export function applyAcceptResult(state: WarbleWayGalaxyState): string {
  encounterOrThrow(state, 'loss_reroll_offer');
  const notes: string[] = [];
  const out = applyExchangeLoss(state, 'Result accepted.', notes);
  return `${out}${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applyBoardShip(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'disabled');
  if (state.pending?.kind !== 'boarding_decision') throw new GameError('ILLEGAL_MOVE', 'Resolve the open pending first.');
  // Boarding rolls like ground combat: best attack ability aboard (WR §12 step 12).
  const candidates = (['SWA', 'GUN', 'DEM'] as const).map((a) => ({ a, ...bestForAbility(state, a) }));
  const best = candidates.sort((x, y) => y.bonus - x.bonus)[0]!;
  state.pending = {
    kind: 'roll',
    reason: 'ground_combat',
    dice_count: 4,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: best.a, bonus: best.bonus },
    min_roll: null,
    declared_items: [],
    context: {},
  };
  const adv = playerGroundAdvantage(state);
  return (
    `Boarding party away: roll 4d6, pair highest+lowest and the middles; you take the ${adv ? 'HIGHER (ground combat advantage)' : 'LOWER'} pair + ${best.a} ${best.bonus}; ` +
    `the pirates add their ground combat +${pirateOf(enc).ground_attack} to the other (WR §12).`
  );
}

/** Ground-combat advantage: SWA basic aboard, Sniper (natural GUN≥3), or
 * equipped ground-combat-advantage armor (WR §4–§6). */
function playerGroundAdvantage(state: WarbleWayGalaxyState): boolean {
  if (anyoneHasEffective(state, 'SWA')) return true;
  if (anyBeingHasAdvanced(state, 'GUN')) return true;
  const equipped = [state.character?.gear.armor, ...state.crew.map((c) => c.gear.armor)].filter(Boolean) as string[];
  return equipped.some((id) => state.items.find((i) => i.id === id)?.effect.kind === 'ground_combat_advantage');
}

function resolveBoardingRoll(
  state: WarbleWayGalaxyState,
  dice: number[],
  flatBonus: number,
  scoreSource: { who: 'self' | 'crew'; crew_name?: string },
  notes: string[],
): string {
  const enc = spaceEnc(state);
  const pirate = pirateOf(enc);
  const adv = playerGroundAdvantage(state);
  const { high, low } = pairTotals(dice);
  const playerTotal = (adv ? high : low) + flatBonus;
  const pirateTotal = (adv ? low : high) + pirate.ground_attack;
  const line = `Your pair ${adv ? high : low}${flatBonus ? `+${flatBonus}` : ''} = ${playerTotal} vs pirate ${adv ? low : high}+${pirate.ground_attack} = ${pirateTotal}.`;
  if (playerTotal === pirateTotal) {
    state.pending = {
      kind: 'roll',
      reason: 'ground_combat',
      dice_count: 4,
      score_source: { who: scoreSource.who, ...(scoreSource.crew_name ? { crew_name: scoreSource.crew_name } : {}), ability: null, bonus: flatBonus },
      min_roll: null,
      declared_items: [],
      context: {},
    };
    return `${line} TIE — reroll the boarding 4d6.`;
  }
  if (playerTotal > pirateTotal) {
    enc.stage = 'captured';
    state.pending = { kind: 'boarding_decision', stage: 'take_or_abandon' };
    // A9b: a boarding victory spreads the word. A11: and collects a bounty —
    // face to face is what counts.
    const dreadNote = gainDread(state, 'the boarding victory');
    const bounty = countFoeDefeated(state);
    if (state.result !== null) return `${line} The deck is yours — the pirate ship is CAPTURED!${dreadNote}${bounty ?? ''}`;
    return `${line} The deck is yours — the pirate ship is CAPTURED! Take it as your new ship or abandon it (WR §12).${dreadNote}${bounty ?? ''}`;
  }
  // Boarding lost → ground-combat loss rules (ruling #9): a CREW-carried
  // boarding kills that crew member outright (WR §14); your own score carries
  // the 3d6 death check.
  if (scoreSource.who === 'crew' && scoreSource.crew_name) {
    const victim = state.crew.find((c) => c.name === scoreSource.crew_name);
    if (victim) {
      removeCrewMember(state, victim, 'dies leading the boarding');
      enc.stage = 'disabled';
      state.pending = { kind: 'boarding_decision', stage: 'board_or_leave' };
      return `${line} ${victim.name} DIES leading the boarding party (their score carried the roll — ruling #9/WR §14). Remove them and their equipped gear. The pirate ship is still disabled — board again or move on.`;
    }
  }
  state.pending = {
    kind: 'roll',
    reason: 'death_check',
    dice_count: 3,
    score_source: { who: 'self', ability: null, bonus: 0 },
    min_roll: 9,
    declared_items: [],
    context: { death_source: 'boarding' },
  };
  notes.push('The boarding goes badly — roll 3d6; below 9 you die (ruling #9).');
  return line;
}

export function applyLeavePirate(state: WarbleWayGalaxyState): string {
  encounterOrThrow(state, 'disabled');
  state.pending = null;
  endEncounter(state);
  const notes: string[] = [];
  afterResolution(state, notes);
  return `You leave the disabled pirates drifting and fly on.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applyTakeShip(state: WarbleWayGalaxyState): string {
  const enc = encounterOrThrow(state, 'captured');
  const pirate = pirateOf(enc);
  const oldShip = state.ship!;
  // Installed parts are bolted to the abandoned hull (ruling #8) — drop them from the ledger.
  for (const partId of oldShip.parts) {
    state.items = state.items.filter((i) => i.id !== partId);
  }
  state.ship = {
    name: `Captured pirate ship (♦${enc.pirate_rank})`,
    capacity: pirate.capacity,
    speed: pirate.speed,
    handling: pirate.handling,
    armor: 0,
    damage: 'hobbled', // captured ships arrive Hobbled (ruling #8)
    parts: [],
  };
  state.pending = null;
  endEncounter(state);
  const notes: string[] = [];
  afterResolution(state, notes);
  return (
    `You take the pirate ship as your own: capacity ${pirate.capacity}, speed +${pirate.speed}, handling ${pirate.handling}, armor 0 — ` +
    `it arrives HOBBLED (ruling #8). The ${oldShip.name} and its installed parts are abandoned.` +
    (notes.length ? ` ${notes.join(' ')}` : '')
  );
}

export function applyAbandonShip(state: WarbleWayGalaxyState): string {
  encounterOrThrow(state, 'captured');
  state.pending = null;
  endEncounter(state);
  const notes: string[] = [];
  afterResolution(state, notes);
  return `You strip nothing worth taking and leave the hulk — the ${state.ship!.name} flies on.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

// ===========================================================================
// M4 — ruins (WR §14). Grids designer-confirmed 2026-07-07 (DATA_TEMPLATE.md).
// Cells are "r{row}c{col}", 1-based, matching the printed row numbers.
// ===========================================================================

import { RUIN_MAPS } from './data/ruins.js';
import type { RuinMapDefinition } from './data/ruins.js';
import type { RuinBoard, RuinRun, RuinToken, RuinDepth } from './types.js';

export function ruinMapForLevel(level: 1 | 2 | 3): RuinMapDefinition {
  return RUIN_MAPS[(['R1', 'R2', 'R3'] as const)[level - 1]!];
}

export function cellIdOf(r: number, c: number): string {
  return `r${r}c${c}`;
}

export function parseCellId(id: string): { r: number; c: number } | null {
  const m = /^r(\d+)c(\d+)$/.exec(id.trim().toLowerCase().replace(/\s+/g, ''));
  if (!m) return null;
  return { r: Number(m[1]), c: Number(m[2]) };
}

function gridChar(map: RuinMapDefinition, r: number, c: number): string | null {
  if (r < 1 || r > 9 || c < 1 || c > 9) return null;
  return map.grid!.rows[r - 1]![c - 1] ?? null;
}

export function cellsWhere(map: RuinMapDefinition, ch: string): string[] {
  const out: string[] = [];
  for (let r = 1; r <= 9; r++) {
    for (let c = 1; c <= 9; c++) if (gridChar(map, r, c) === ch) out.push(cellIdOf(r, c));
  }
  return out;
}

function describeCorner(cell: string): string {
  const p = parseCellId(cell)!;
  const v = p.r <= 3 ? 'top' : p.r >= 7 ? 'bottom' : 'middle';
  const h = p.c <= 3 ? 'left' : p.c >= 7 ? 'right' : 'center';
  return `${cell} (${v}-${h})`;
}

/** Resolve a cell the player named: "r9c1", "row 9 column 1", or a corner word for S cells. */
function resolveCellName(map: RuinMapDefinition, requested: string, allowed: string[]): string {
  const direct = parseCellId(requested.replace(/row\s*(\d+)\s*(?:,?\s*)col(?:umn)?\s*(\d+)/i, 'r$1c$2'));
  if (direct && allowed.includes(cellIdOf(direct.r, direct.c))) return cellIdOf(direct.r, direct.c);
  const want = requested.toLowerCase().replace(/[^a-z]/g, '');
  for (const cell of allowed) {
    const corner = describeCorner(cell).toLowerCase().replace(/[^a-z]/g, '');
    if (want.length >= 6 && corner.includes(want)) return cell;
  }
  throw new GameError(
    'ILLEGAL_MOVE',
    `"${requested}" does not name one of the valid cells: ${allowed.map(describeCorner).join('; ')}.`,
  );
}

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

function currentRun(state: WarbleWayGalaxyState): RuinRun {
  const enc = state.encounter;
  if (!enc || enc.kind !== 'ruin_run' || state.phase !== 'ruin') {
    throw new GameError('ILLEGAL_MOVE', 'There is no ruin encounter in progress.');
  }
  return enc;
}

function boardOrThrow(state: WarbleWayGalaxyState): { run: RuinRun; board: RuinBoard; map: RuinMapDefinition } {
  const run = currentRun(state);
  if (!run.board) throw new GameError('ILLEGAL_MOVE', 'The encounter is not set up yet — setup_encounter first.');
  return { run, board: run.board, map: ruinMapForLevel(run.level) };
}

function occupiedCells(board: RuinBoard): Set<string> {
  const s = new Set<string>();
  for (const t of board.tokens) s.add(t.cell);
  for (const a of board.attackers) if (!a.defeated) s.add(a.cell);
  return s;
}

function isOpenFloor(map: RuinMapDefinition, cell: string): boolean {
  const p = parseCellId(cell);
  if (!p) return false;
  const ch = gridChar(map, p.r, p.c);
  return ch !== null && ch !== '#' && ch !== '~';
}

/** Orthogonal BFS distances from a cell. blockers = tokens/attackers (and always walls+pits),
 * unless teleporter (Personal Teleporter ignores obstructions but lands legally). */
function bfsDistances(
  map: RuinMapDefinition,
  board: RuinBoard,
  from: string,
  opts: { teleporter?: boolean; ignore_occupants?: boolean } = {},
): Map<string, number> {
  const occupied = occupiedCells(board);
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    const p = parseCellId(cur)!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nr = p.r + dr;
      const nc = p.c + dc;
      const id = cellIdOf(nr, nc);
      if (dist.has(id)) continue;
      const ch = gridChar(map, nr, nc);
      if (ch === null) continue;
      if (!opts.teleporter && (ch === '#' || ch === '~')) continue;
      if (!opts.teleporter && !opts.ignore_occupants && occupied.has(id) && id !== from) continue;
      dist.set(id, d + 1);
      queue.push(id);
    }
  }
  return dist;
}

/** Ranged attacks: Chebyshev distance (diagonals allowed) AND a straight line
 * with no wall in the way — SUPERCOVER: when the segment grazes a cell
 * boundary or corner, BOTH touched cells are checked, so "rounding a corner"
 * is out of range (WR §14). Pits do not block. */
export function inAttackRange(map: RuinMapDefinition, from: string, to: string, range: number): boolean {
  const a = parseCellId(from)!;
  const b = parseCellId(to)!;
  const dist = Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
  if (dist > range || dist === 0) return false;
  const steps = dist * 8;
  const EPS = 1e-6;
  for (let i = 1; i < steps; i++) {
    const rf = a.r + ((b.r - a.r) * i) / steps;
    const cf = a.c + ((b.c - a.c) * i) / steps;
    // Candidate cells: the rounded cell, plus both neighbors when the exact
    // point sits on a cell boundary (fraction ≈ .5) — the corner-squeeze case.
    const rs = Math.abs(rf - Math.floor(rf) - 0.5) < EPS ? [Math.floor(rf), Math.ceil(rf)] : [Math.round(rf)];
    const cs = Math.abs(cf - Math.floor(cf) - 0.5) < EPS ? [Math.floor(cf), Math.ceil(cf)] : [Math.round(cf)];
    for (const r of rs) {
      for (const c of cs) {
        if ((r === a.r && c === a.c) || (r === b.r && c === b.c)) continue;
        if (gridChar(map, r, c) === '#') return false;
      }
    }
  }
  return true;
}

function tokenBeing(state: WarbleWayGalaxyState, token: RuinToken): Being {
  if (token.is_character) {
    const c = state.character!;
    return { name: c.name, natural: c.abilities, gear: c.gear, is_character: true };
  }
  // A10: unnamed crew are bodies backed by a counter, not a CrewMember record.
  // A14b: they brawl at SWA 1 (pirates and drifters know how to fight) —
  // ruins-only by construction, since only ruin tokens reach this path.
  if (token.unnamed === true) {
    return { name: token.name, natural: { SWA: 1 }, gear: { weapon: null, armor: null }, is_character: false };
  }
  const crew = state.crew.find((c) => c.name === token.name);
  if (!crew) throw new GameError('STORAGE_ERROR', `Token ${token.name} has no crew record.`);
  return { name: crew.name, natural: crew.abilities, gear: crew.gear, is_character: false };
}

function movementAllowance(state: WarbleWayGalaxyState, token: RuinToken): number {
  return 3 + effectiveScore(state, tokenBeing(state, token), 'SNE');
}

function hasTeleporter(state: WarbleWayGalaxyState, token: RuinToken): boolean {
  return (tokenBeing(state, token).natural.RES ?? 0) >= 3; // natural — advanced skill (WR §5)
}

function bestAttackAbility(state: WarbleWayGalaxyState, token: RuinToken): { ability: AbilityId; bonus: number } {
  const being = tokenBeing(state, token);
  const options: Array<{ ability: AbilityId; bonus: number }> = (['SWA', 'GUN', 'DEM'] as const).map((a) => ({
    ability: a,
    bonus: effectiveScore(state, being, a),
  }));
  return options.sort((a, b) => b.bonus - a.bonus)[0]!;
}

function attackRangeOf(state: WarbleWayGalaxyState, token: RuinToken): number {
  const being = tokenBeing(state, token);
  const gun = effectiveScore(state, being, 'GUN');
  const dem = effectiveScore(state, being, 'DEM');
  // Range = 2+GUN (GUN basic) or DEM (DEM basic); neither → 1 (WR §14).
  return Math.max(gun >= 1 ? 2 + gun : 0, dem >= 1 ? dem : 0, 1);
}

function tokenGroundAdvantage(state: WarbleWayGalaxyState, token: RuinToken): boolean {
  const being = tokenBeing(state, token);
  if (effectiveScore(state, being, 'SWA') >= 1) return true; // SWA basic
  if ((being.natural.GUN ?? 0) >= 3) return true; // Sniper (ruling #3)
  const armor = state.items.find((i) => i.id === being.gear.armor);
  return armor?.effect.kind === 'ground_combat_advantage';
}

/** Personal Cloaking (natural SNE≥3): can't be targeted until it attacks (ruling #3). */
function isCloaked(state: WarbleWayGalaxyState, token: RuinToken): boolean {
  return (tokenBeing(state, token).natural.SNE ?? 0) >= 3 && !token.has_attacked;
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

/** Bot/menu helper: cells a being can end movement on this round (cell → cost). */
export function ruinReachable(state: WarbleWayGalaxyState, beingName: string): Map<string, number> {
  const { board, map } = boardOrThrow(state);
  const token = tokenByName(board, beingName);
  const remaining = movementAllowance(state, token) - token.moved;
  const all = bfsDistances(map, board, token.cell, { teleporter: hasTeleporter(state, token) });
  const out = new Map<string, number>();
  const occupied = occupiedCells(board);
  for (const [cell, d] of all) {
    if (d === 0 || d > remaining) continue;
    if (occupied.has(cell)) continue;
    if (!isOpenFloor(map, cell)) continue;
    out.set(cell, d);
  }
  return out;
}

/** Bot/menu helper: the current level's goal cell. */
export function ruinGoalCell(state: WarbleWayGalaxyState): string {
  const { map } = boardOrThrow(state);
  return cellsWhere(map, 'G')[0]!;
}

/** Bot helper: walking distance from a cell to the goal over open floor
 * (occupants ignored — a routing heuristic, not a legality check). */
export function ruinDistanceToGoal(state: WarbleWayGalaxyState, cell: string): number {
  const { board, map } = boardOrThrow(state);
  const goal = cellsWhere(map, 'G')[0]!;
  const d = bfsDistances(map, board, goal, { ignore_occupants: true }).get(cell);
  return d ?? Number.POSITIVE_INFINITY;
}

/** Bot/menu helper: the best reachable-this-round cell along a REAL path
 * (occupant-aware — attackers and other tokens block, exactly like movement)
 * from a being toward `dest`. Returns null when no reachable step strictly
 * shortens the true path — i.e. the way is genuinely BLOCKED (or already
 * there). One consistent metric for both "advance" and "am I stuck?", so a
 * policy can't oscillate between disagreeing heuristics. */
export function ruinStepToward(state: WarbleWayGalaxyState, beingName: string, dest: string): string | null {
  const { board, map } = boardOrThrow(state);
  const token = tokenByName(board, beingName);
  // Distances FROM the destination with real blocking; the mover's own cell
  // must not block its own route, so measure on a board without this token.
  const boardSansSelf: RuinBoard = { ...board, tokens: board.tokens.filter((t) => t.name !== token.name) };
  const fromDest = bfsDistances(map, boardSansSelf, dest, { teleporter: hasTeleporter(state, token) });
  const here = fromDest.get(token.cell);
  if (here === undefined || here === 0) return null; // unreachable outright, or already there
  const reachable = ruinReachable(state, beingName);
  let best: { cell: string; d: number } | null = null;
  for (const cell of reachable.keys()) {
    const d = fromDest.get(cell);
    if (d === undefined || d >= here) continue;
    if (!best || d < best.d || (d === best.d && cell.localeCompare(best.cell) < 0)) best = { cell, d };
  }
  return best?.cell ?? null;
}

/** Bot helper: a token's true attack range (engine rule, gear included). */
export function ruinAttackRange(state: WarbleWayGalaxyState, beingName: string): number {
  const { board } = boardOrThrow(state);
  return attackRangeOf(state, tokenByName(board, beingName));
}

/** Legal-move surface helper: the open I/B spot next to a being, if any. */
export function ruinAdjacentSpot(state: WarbleWayGalaxyState, beingName: string, ch: 'I' | 'B'): string | null {
  const { board, map } = boardOrThrow(state);
  return adjacentSpot(map, board, tokenByName(board, beingName).cell, ch);
}

export function startRuinRun(state: WarbleWayGalaxyState, origin: RuinRun['origin'], targetDepth: RuinDepth): void {
  state.encounter = { kind: 'ruin_run', origin, target_depth: targetDepth, level: 1, board: null };
  state.phase = 'ruin';
  state.pending = { kind: 'ruin_setup', level: 1, depth_target: targetDepth };
}

export function applySetupEncounter(
  state: WarbleWayGalaxyState,
  move: Extract<WarbleMove, { type: 'setup_encounter' }>,
): string {
  const run = currentRun(state);
  if (state.pending?.kind !== 'ruin_setup') throw new GameError('ILLEGAL_MOVE', 'No encounter setup is owed right now.');
  const map = ruinMapForLevel(run.level);
  if (!map.grid) throw new GameError('STORAGE_ERROR', `Map ${map.id} has no grid data.`);
  if (![1, 2, 3].includes(move.threat_level)) throw new GameError('ILLEGAL_MOVE', 'threat_level is 1, 2 or 3 (WR §14 recommends starting at 1).');
  // Party: named crew (each must exist) + optionally the character; at least one being.
  const party: RuinToken[] = [];
  if (move.include_character) {
    party.push({ name: state.character!.name, is_character: true, cell: '', moved: 0, acted: false, ended: false, has_attacked: false });
  }
  for (const name of move.crew_names) {
    const crew = resolveCrewName(state, name);
    if (party.some((t) => t.name === crew.name)) throw new GameError('ILLEGAL_MOVE', `${crew.name} is listed twice.`);
    party.push({ name: crew.name, is_character: false, cell: '', moved: 0, acted: false, ended: false, has_attacked: false });
  }
  // A10: unnamed crew join as pure bodies (default: all of them).
  const available = state.unnamed_crew ?? 0;
  const bringing = Math.max(0, Math.min(move.unnamed_count ?? available, available));
  for (let i = 1; i <= bringing; i++) {
    party.push({ name: `Red Shirt ${i}`, is_character: false, cell: '', moved: 0, acted: false, ended: false, has_attacked: false, unnamed: true });
  }
  if (party.length === 0) throw new GameError('ILLEGAL_MOVE', 'Someone has to go in — bring the character and/or at least one crew member (WR §14).');
  // Start location (an S cell of this map).
  const startCells = cellsWhere(map, 'S');
  const start = resolveCellName(map, move.start_location, startCells);
  // Attacker placement: exactly 3 distinct A cells; the choice is the difficulty knob.
  const aCells = cellsWhere(map, 'A');
  if (!Array.isArray(move.attacker_placements) || move.attacker_placements.length !== 3) {
    throw new GameError('ILLEGAL_MOVE', `Place exactly 3 attackers on the marked spots: ${aCells.map(describeCorner).join('; ')}.`);
  }
  const placements = move.attacker_placements.map((p) => resolveCellName(map, p, aCells));
  if (new Set(placements).size !== 3) throw new GameError('ILLEGAL_MOVE', 'Attacker placements must be 3 DIFFERENT spots.');
  const defs = map.attackers[move.threat_level];
  const board: RuinBoard = {
    threat_level: move.threat_level,
    start_cell: start,
    tokens: party,
    attackers: defs.map((d, i) => ({ id: `A${i + 1}`, ...d, cell: placements[i]!, defeated: false })),
    closed_spots: [],
    round: 1,
    attacker_turn_index: null,
  };
  // Place the party on and around the start location, closest-first (WR §14).
  const seats = bfsDistances(map, board, start, { ignore_occupants: true });
  const ordered = [...seats.entries()]
    .filter(([cell]) => !board.attackers.some((a) => a.cell === cell))
    .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]))
    .map(([cell]) => cell);
  for (const t of party) t.cell = ordered.shift()!;
  run.board = board;
  state.pending = { kind: 'ruin_turn' };
  const placedAt = board.attackers.map((a) => `${a.id} (Atk +${a.atk}, Mv ${a.move}, Rng ${a.range}) at ${describeCorner(a.cell)}`);
  return (
    `${map.id} encounter, threat level ${move.threat_level}. Party in from ${describeCorner(start)}: ${party
      .map((t) => `${t.name} at ${t.cell}`)
      .join('; ')}. Attackers: ${placedAt.join('; ')}. Goal: ${describeCorner(cellsWhere(map, 'G')[0]!)}. ` +
    'Your beings act first, in any order — each may Move and Act (WR §14).'
  );
}

function requireRuinTurn(state: WarbleWayGalaxyState): { run: RuinRun; board: RuinBoard; map: RuinMapDefinition } {
  if (state.pending?.kind !== 'ruin_turn') throw new GameError('ILLEGAL_MOVE', 'It is not the party phase right now — follow next_step.');
  return boardOrThrow(state);
}

function tokenByName(board: RuinBoard, name: string): RuinToken {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = board.tokens.find((t) => norm(t.name) === norm(name)) ?? board.tokens.find((t) => norm(t.name).includes(norm(name)) && norm(name).length >= 3);
  if (!hit) throw new GameError('ILLEGAL_MOVE', `No party member on the map matches "${name}". On the map: ${board.tokens.map((t) => t.name).join('; ')}.`);
  return hit;
}

function attackerById(board: RuinBoard, id: string): RuinAttackerPlaced_ {
  const hit = board.attackers.find((a) => a.id.toLowerCase() === id.trim().toLowerCase() && !a.defeated);
  if (!hit) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No standing attacker matches "${id}". Standing: ${board.attackers.filter((a) => !a.defeated).map((a) => `${a.id} at ${a.cell}`).join('; ') || '(none)'}.`,
    );
  }
  return hit;
}
type RuinAttackerPlaced_ = RuinBoard['attackers'][number];

function maybeAutoEnd(state: WarbleWayGalaxyState, token: RuinToken): void {
  if (token.acted && token.moved >= movementAllowance(state, token)) token.ended = true;
}

/** After a non-roll player action: when every token has ended, clear the
 * ruin_turn pending so afterResolution can run the attacker phase. */
function ruinTickAfterPlayerAction(state: WarbleWayGalaxyState, notes: string[]): void {
  const enc = state.encounter;
  if (enc?.kind === 'ruin_run' && enc.board && state.pending?.kind === 'ruin_turn' && enc.board.tokens.every((t) => t.ended)) {
    state.pending = null;
  }
  afterResolution(state, notes);
}

export function applyMoveBeing(state: WarbleWayGalaxyState, beingName: string, to: string): string {
  const { run, board, map } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended) throw new GameError('ILLEGAL_MOVE', `${token.name} has finished this round.`);
  const allowance = movementAllowance(state, token) - token.moved;
  if (allowance <= 0) throw new GameError('ILLEGAL_MOVE', `${token.name} has no movement left this round.`);
  const p = parseCellId(to);
  if (!p) throw new GameError('INVALID_MOVE_SHAPE', `"${to}" is not a cell — use "r5c3" (row 5, column 3).`);
  const dest = cellIdOf(p.r, p.c);
  if (!isOpenFloor(map, dest)) throw new GameError('ILLEGAL_MOVE', `${dest} is a wall or pit — tokens cannot end there (WR §14).`);
  if (occupiedCells(board).has(dest)) throw new GameError('ILLEGAL_MOVE', `${dest} is occupied — no two tokens share a space (WR §14).`);
  const dist = bfsDistances(map, board, token.cell, { teleporter: hasTeleporter(state, token) }).get(dest);
  if (dist === undefined || dist > allowance) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `${token.name} cannot reach ${dest} this round (${allowance} movement left; no diagonals; walls, pits and other tokens block${hasTeleporter(state, token) ? ' — Teleporter ignores obstructions but the distance still counts' : ''}).`,
    );
  }
  token.cell = dest;
  token.moved += dist;
  // The goal ends the encounter the moment anyone reaches it (WR §14).
  const goal = cellsWhere(map, 'G')[0]!;
  if (dest === goal) {
    const notes: string[] = [];
    const outcome = completeRuinLevel(state, run, notes);
    return `${token.name} reaches the goal at ${dest}! ${outcome}${notes.length ? ` ${notes.join(' ')}` : ''}`;
  }
  maybeAutoEnd(state, token);
  const notes: string[] = [];
  ruinTickAfterPlayerAction(state, notes);
  return `${token.name} moves to ${dest} (${allowance - dist} movement left${token.acted ? '' : '; their Act is still available'}).${
    notes.length ? ` ${notes.join(' ')}` : ''
  }`;
}

export function applyAttack(state: WarbleWayGalaxyState, beingName: string, targetId: string): string {
  const { board } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended) throw new GameError('ILLEGAL_MOVE', `${token.name} has finished this round.`);
  if (token.acted) throw new GameError('ILLEGAL_MOVE', `${token.name} has already acted this round (one Act per round, WR §14).`);
  const target = attackerById(board, targetId);
  const { map } = boardOrThrow(state);
  const range = attackRangeOf(state, token);
  if (!inAttackRange(map, token.cell, target.cell, range)) {
    throw new GameError('ILLEGAL_MOVE', `${target.id} at ${target.cell} is out of range/line-of-sight for ${token.name} (range ${range}; walls block, corners block, pits don't).`);
  }
  token.acted = true;
  token.has_attacked = true;
  const attack = bestAttackAbility(state, token);
  const ect = (tokenBeing(state, token).natural.SWA ?? 0) >= 3 ? 1 : 0; // Expert Combat Tactics rider die
  state.pending = {
    kind: 'roll',
    reason: 'ground_combat',
    dice_count: 4 + ect,
    score_source: { who: token.is_character ? 'self' : 'crew', ...(token.is_character ? {} : { crew_name: token.name }), ability: attack.ability, bonus: attack.bonus },
    min_roll: null,
    declared_items: [],
    context: { ground: 'ruin_attack', actor: token.name, target: target.id, rider_dice: ect },
  };
  const adv = tokenGroundAdvantage(state, token);
  return (
    `${token.name} attacks ${target.id} (Atk +${target.atk}) at ${target.cell}: roll ${4 + ect}d6${ect ? ' (the 5th die is Expert Combat Tactics, added to your total)' : ''} — ` +
    `pair the first four; you take the ${adv ? 'HIGHER (ground advantage)' : 'LOWER'} pair + ${attack.ability} ${attack.bonus}; the attacker adds +${target.atk} to the other (WR §14).`
  );
}

export function applyCollectItem(state: WarbleWayGalaxyState, beingName: string): string {
  const { board, map } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended || token.acted) throw new GameError('ILLEGAL_MOVE', `${token.name} cannot act (already acted or finished this round).`);
  const spot = adjacentSpot(map, board, token.cell, 'I');
  if (!spot) throw new GameError('ILLEGAL_MOVE', `${token.name} is not next to an unlooted item spot (◆).`);
  token.acted = true;
  state.pending = {
    kind: 'roll',
    reason: 'item_d6',
    dice_count: 1,
    score_source: { who: 'self', ability: null, bonus: 0 },
    min_roll: null,
    declared_items: [],
    context: { cell: spot, actor: token.name },
  };
  return `${token.name} pries open the cache at ${spot}: roll 1d6 on the ${map.id} item list.`;
}

export function applyRecruitAt(state: WarbleWayGalaxyState, beingName: string): string {
  const { board, map } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended || token.acted) throw new GameError('ILLEGAL_MOVE', `${token.name} cannot act (already acted or finished this round).`);
  const spot = adjacentSpot(map, board, token.cell, 'B');
  if (!spot) throw new GameError('ILLEGAL_MOVE', `${token.name} is not next to an unmet being spot (☺).`);
  token.acted = true;
  state.pending = {
    kind: 'roll',
    reason: 'being_d6',
    dice_count: 1,
    score_source: { who: 'self', ability: null, bonus: 0 },
    min_roll: null,
    declared_items: [],
    context: { cell: spot, actor: token.name },
  };
  return `${token.name} approaches the figure at ${spot}: roll 1d6 on the ${map.id} beings list.`;
}

function adjacentSpot(map: RuinMapDefinition, board: RuinBoard, cell: string, ch: 'I' | 'B'): string | null {
  const p = parseCellId(cell)!;
  // "Next to" — 8-adjacent (movement is orthogonal, but reaching over a corner
  // to a chest reads naturally; PORT-NOTES decision).
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const id = cellIdOf(p.r + dr, p.c + dc);
      if (gridChar(map, p.r + dr, p.c + dc) === ch && !board.closed_spots.includes(id)) return id;
    }
  }
  return null;
}

export function applyConvertAttacker(state: WarbleWayGalaxyState, beingName: string, targetId: string): string {
  const { board, map } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended || token.acted) throw new GameError('ILLEGAL_MOVE', `${token.name} cannot act (already acted or finished this round).`);
  const being = tokenBeing(state, token);
  const dip = effectiveScore(state, being, 'DIP');
  if (dip < 1) throw new GameError('ILLEGAL_MOVE', `${token.name} has no DIP — converting an attacker needs Diplomacy (WR §4).`);
  const target = attackerById(board, targetId);
  if (!inAttackRange(map, token.cell, target.cell, attackRangeOf(state, token))) {
    throw new GameError('ILLEGAL_MOVE', `${target.id} is out of range for ${token.name} (interpretation: DIP conversion uses your attack range; PORT-NOTES).`);
  }
  token.acted = true;
  const actDie = actDieFor(state, 'DIP');
  state.pending = {
    kind: 'roll',
    reason: 'recruit',
    dice_count: 3 + actDie,
    score_source: { who: token.is_character ? 'self' : 'crew', ...(token.is_character ? {} : { crew_name: token.name }), ability: 'DIP', bonus: dip },
    min_roll: 10 + target.atk,
    declared_items: [],
    context: { recruit_source: 'ruin', recruit_id: `convert-${target.id}`, target: target.id, actor: token.name },
  };
  return `${token.name} calls for ${target.id}'s surrender: roll ${3 + actDie}d6${actDie ? ' (ACT grants the extra die on Moxie rolls)' : ''} + DIP ${dip} vs ${10 + target.atk} (10 + their attack bonus, WR §4).`;
}

export function applyEscapeToStart(state: WarbleWayGalaxyState, beingName: string): string {
  const { run, board } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.cell !== board.start_cell) {
    throw new GameError('ILLEGAL_MOVE', `${token.name} must be standing on the starting location (${board.start_cell}) to slip out (WR §14).`);
  }
  board.tokens = board.tokens.filter((t) => t.name !== token.name);
  if (board.tokens.length === 0) {
    const notes: string[] = [];
    const out = finishRuinRun(state, run, false, 'everyone escaped back to the ship', notes);
    return `${token.name} slips out — the party has escaped. ${out}${notes.length ? ` ${notes.join(' ')}` : ''}`;
  }
  const notes: string[] = [];
  ruinTickAfterPlayerAction(state, notes);
  return `${token.name} slips out through the entrance. ${board.tokens.length} still inside.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function applyEndBeingTurn(state: WarbleWayGalaxyState, beingName: string): string {
  const { board } = requireRuinTurn(state);
  const token = tokenByName(board, beingName);
  if (token.ended) throw new GameError('ILLEGAL_MOVE', `${token.name} already finished this round.`);
  token.ended = true;
  const notes: string[] = [];
  ruinTickAfterPlayerAction(state, notes);
  return `${token.name} holds position.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Enter / continue / leave
// ---------------------------------------------------------------------------

export function applyEnterRuin(state: WarbleWayGalaxyState, depth: RuinDepth): string {
  const pending = state.pending;
  if (pending?.kind === 'ruin_discovery') {
    if (depth < 1 || depth > pending.max_depth) {
      throw new GameError('ILLEGAL_MOVE', `This ruin goes down to depth ${pending.max_depth} — pick a target depth 1..${pending.max_depth}.`);
    }
    state.pending = null;
    startRuinRun(state, { type: 'discovery', card_id: pending.card_id }, depth);
    return `You dock with the ancient ruin (target depth ${depth}). Every run starts at the R1 map (WR §14) — set up the encounter.`;
  }
  if (pending?.kind === 'ruin_continue') {
    const run = currentRun(state);
    state.pending = { kind: 'ruin_setup', level: pending.next_level, depth_target: run.target_depth };
    run.level = pending.next_level;
    run.board = null;
    return `Deeper: turn to the R${pending.next_level} map and set up the next encounter (full re-setup, WR §14).`;
  }
  throw new GameError('ILLEGAL_MOVE', 'No ruin is open to enter right now.');
}

function completeRuinLevel(state: WarbleWayGalaxyState, run: RuinRun, notes: string[]): string {
  if (run.level >= run.target_depth) {
    return finishRuinRun(state, run, true, `the depth-${run.target_depth} goal is reached`, notes);
  }
  run.board = null;
  state.pending = { kind: 'ruin_continue', next_level: (run.level + 1) as 1 | 2 | 3, is_mission: run.origin.type !== 'discovery' };
  return `Level ${run.level} cleared — the encounter ends the moment the goal is reached. Go deeper (level ${run.level + 1}) or leave.`;
}

function finishRuinRun(state: WarbleWayGalaxyState, run: RuinRun, success: boolean, why: string, notes: string[]): string {
  state.encounter = null;
  state.pending = null;
  let outcome: string;
  if (run.origin.type === 'finale') {
    if (success) {
      const char = state.character!;
      state.result = {
        winner: 'player',
        summary:
          `SEASON 1 COMPLETE — the R3 ruin beyond FFD700 Base is conquered! Final tally: ${char.credits}c, ` +
          `level ${char.level} (${char.xp} XP banked), ${state.crew.length} crew aboard the ${state.ship!.name}.`,
      };
      state.phase = 'game_over';
      return state.result.summary;
    }
    state.phase = 'at_habitat';
    outcome = `The finale attempt ends (${why}) — you limp back to FFD700 Base. The R3 ruin waits; depart again when ready.`;
  } else if (run.origin.type === 'mission') {
    const missionId = run.origin.mission_id;
    if (success) {
      outcome = `Ruins mission complete! ${payoutMission(state, missionId)}`;
    } else {
      outcome = `The ruins mission is abandoned (${why}) — no reward (WR §7). The return trip remains.`;
    }
    state.phase = 'traveling';
  } else {
    outcome = success
      ? `The ruin is plundered to your target depth (${why}) — whatever you carried out is yours, plus the XP of the fallen.`
      : `You withdraw from the ruin (${why}) — keeping whatever was already collected.`;
    state.phase = 'traveling';
  }
  afterResolution(state, notes);
  return outcome;
}

/** Shared mission payout (Silver Tongue / Je ne sais quoi; WR §5, §7). */
function payoutMission(state: WarbleWayGalaxyState, missionId: string): string {
  const mission = missionById(missionId);
  const char = state.character!;
  let credits = mission.credits;
  const payoutNotes: string[] = [];
  const actHolders = [char.abilities.ACT ?? 0, ...state.crew.map((c) => c.abilities.ACT ?? 0)].filter((v) => v >= 3);
  if (actHolders.length > 0) {
    const bonus = 100 * Math.max(...actHolders);
    credits += bonus;
    payoutNotes.push(`Je ne sais quoi +${bonus}c`);
  }
  if (anyBeingHasAdvanced(state, 'DIP')) {
    credits *= 2;
    payoutNotes.push('Silver Tongue ×2');
  }
  char.credits += credits;
  awardXp(state, mission.xp);
  if (missionId.startsWith('h')) state.habitat_progress[state.current_habitat]!.missions_succeeded.push(missionId);
  // Amendment A1c ("more repair opportunities"): planetside downtime while
  // completing the job — a SUCCESSFUL mission also repairs one damage level.
  // (Yard-only recovery measured insufficient vs 8-20 cards of between-yard
  // exposure — the ship-loss monoculture's remaining root.)
  let repairNote = '';
  if (state.ship && state.ship.damage !== 'pristine') {
    state.ship.damage = repairShipOneLevel(state.ship.damage);
    repairNote = ` Planetside downtime: the ${state.ship.name} repairs one level → ${state.ship.damage.toUpperCase()} (amendment A1c).`;
  }
  return `Claim ${credits}c${payoutNotes.length ? ` (${payoutNotes.join(', ')})` : ''} and ${mission.xp} XP → ${char.credits}c, ${char.xp} XP.${repairNote}`;
}

// ---------------------------------------------------------------------------
// The ruin loop: player phase ↔ attacker phase (driven from afterResolution)
// ---------------------------------------------------------------------------

export function advanceRuin(state: WarbleWayGalaxyState, notes: string[]): void {
  const enc = state.encounter;
  if (!enc || enc.kind !== 'ruin_run' || state.result !== null) return;
  const run = enc;
  if (!run.board) {
    if (state.pending === null) state.pending = { kind: 'ruin_setup', level: run.level, depth_target: run.target_depth };
    return;
  }
  const board = run.board;
  const map = ruinMapForLevel(run.level);
  while (state.pending === null && state.result === null && state.encounter === enc) {
    // Party wiped/removed?
    if (board.tokens.length === 0) {
      notes.push(finishRuinRun(state, run, false, 'no one is left on the map', notes));
      return;
    }
    if (board.attacker_turn_index === null) {
      // Player phase: anyone still to act?
      if (board.tokens.some((t) => !t.ended)) {
        state.pending = { kind: 'ruin_turn' };
        return;
      }
      board.attacker_turn_index = 0;
      notes.push(`Round ${board.round}: the attackers move.`);
    }
    // Attacker phase.
    let acted = false;
    while (board.attacker_turn_index! < board.attackers.length) {
      const attacker = board.attackers[board.attacker_turn_index!]!;
      board.attacker_turn_index! += 1;
      if (attacker.defeated) continue;
      const outcome = runAttackerTurn(state, run, board, map, attacker, notes);
      if (outcome === 'attacking') {
        acted = true;
        break; // a defense roll pending is open; resume on resolution
      }
    }
    if (acted) return;
    if (board.attacker_turn_index! >= board.attackers.length) {
      // Round over — everyone resets.
      board.attacker_turn_index = null;
      board.round += 1;
      for (const t of board.tokens) {
        t.moved = 0;
        t.acted = false;
        t.ended = false;
      }
      notes.push(`Round ${board.round}: your beings act (each may Move and Act, any order).`);
      state.pending = { kind: 'ruin_turn' };
      return;
    }
  }
}

function runAttackerTurn(
  state: WarbleWayGalaxyState,
  run: RuinRun,
  board: RuinBoard,
  map: RuinMapDefinition,
  attacker: RuinAttackerPlaced_,
  notes: string[],
): 'attacking' | 'done' {
  // Target the CLOSEST attackable being; cloaked beings are invisible (WR §14).
  const attackable = board.tokens.filter((t) => !isCloaked(state, t));
  if (attackable.length === 0) {
    notes.push(`${attacker.id} sees no one to attack and stays at ${attacker.cell}.`);
    return 'done';
  }
  const distances = bfsDistances(map, board, attacker.cell, { ignore_occupants: false });
  // Distance to a target = shortest BFS distance to any cell adjacent to it (tokens block paths).
  const byTarget = attackable
    .map((t) => {
      const p = parseCellId(t.cell)!;
      let best = Infinity;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const d = distances.get(cellIdOf(p.r + dr, p.c + dc));
        if (d !== undefined && d < best) best = d;
      }
      return { t, approach: best };
    })
    .sort((a, b) => a.approach - b.approach || a.t.name.localeCompare(b.t.name));
  const target = byTarget[0]!.t;
  // Move toward the target up to `move` steps (orthogonal, everything blocks).
  if (!inAttackRange(map, attacker.cell, target.cell, attacker.range)) {
    const path = shortestPathToward(map, board, attacker.cell, target.cell);
    let steps = 0;
    for (const cell of path) {
      if (steps >= attacker.move) break;
      attacker.cell = cell;
      steps += 1;
      if (inAttackRange(map, attacker.cell, target.cell, attacker.range)) break;
    }
    if (steps > 0) notes.push(`${attacker.id} advances to ${attacker.cell}.`);
  }
  if (!inAttackRange(map, attacker.cell, target.cell, attacker.range)) {
    return 'done';
  }
  // Attack: the DEFENDER rolls (the player owns all dice).
  const being = tokenBeing(state, target);
  const arm = effectiveScore(state, being, 'ARM');
  const rider = (being.natural.ARM ?? 0) >= 3 ? 1 : 0; // Reinforced Armor die
  state.pending = {
    kind: 'roll',
    reason: 'ground_combat',
    dice_count: 4 + rider,
    score_source: { who: target.is_character ? 'self' : 'crew', ...(target.is_character ? {} : { crew_name: target.name }), ability: arm >= 1 ? 'ARM' : null, bonus: arm },
    min_roll: null,
    declared_items: [],
    context: { ground: 'ruin_defense', actor: target.name, target: attacker.id, rider_dice: rider },
  };
  notes.push(
    `${attacker.id} attacks ${target.name} from ${attacker.cell}! Roll ${4 + rider}d6${rider ? ' (5th die = Reinforced Armor, added to the defense)' : ''} — ` +
      `pair the first four; ${target.name} takes the ${tokenGroundAdvantage(state, target) ? 'HIGHER (ground advantage)' : 'LOWER'} pair${arm >= 1 ? ` + ARM ${arm}` : ''}; ${attacker.id} adds +${attacker.atk} to the other.`,
  );
  return 'attacking';
}

/** Orthogonal path toward a target cell (occupants block; the target's own cell excluded). */
function shortestPathToward(map: RuinMapDefinition, board: RuinBoard, from: string, targetCell: string): string[] {
  const p = parseCellId(targetCell)!;
  const goals = new Set<string>();
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const id = cellIdOf(p.r + dr, p.c + dc);
    if (isOpenFloor(map, id) && !occupiedCells(board).has(id)) goals.add(id);
  }
  if (goals.size === 0) return [];
  // BFS from `from`, tracking parents.
  const parent = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  let found: string | null = null;
  while (queue.length > 0 && !found) {
    const cur = queue.shift()!;
    const cp = parseCellId(cur)!;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const id = cellIdOf(cp.r + dr, cp.c + dc);
      if (parent.has(id)) continue;
      if (!isOpenFloor(map, id)) continue;
      if (occupiedCells(board).has(id) && id !== from) continue;
      parent.set(id, cur);
      if (goals.has(id)) {
        found = id;
        break;
      }
      queue.push(id);
    }
  }
  if (!found) return [];
  const path: string[] = [];
  let cur: string | null = found;
  while (cur && cur !== from) {
    path.unshift(cur);
    cur = parent.get(cur) ?? null;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Ruin roll resolutions (wired from applyReportRoll)
// ---------------------------------------------------------------------------

export function resolveRuinAttackRoll(
  state: WarbleWayGalaxyState,
  dice: number[],
  flatBonus: number,
  context: { actor?: string; target?: string; rider_dice?: number },
  notes: string[],
): string {
  const { run, board, map } = boardOrThrow(state);
  const token = tokenByName(board, context.actor!);
  const rider = dice.slice(4).reduce((a, b) => a + b, 0);
  const pairing = dice.slice(0, 4);
  const { high, low } = pairTotals(pairing);
  const adv = tokenGroundAdvantage(state, token);
  const myPair = adv ? high : low;
  const theirPair = adv ? low : high;
  const myTotal = myPair + flatBonus + rider;
  const splash = (tokenBeing(state, token).natural.DEM ?? 0) >= 3;
  const targets = splash
    ? board.attackers.filter((a) => !a.defeated && inAttackRange(map, token.cell, a.cell, attackRangeOf(state, token)))
    : [attackerById(board, context.target!)];
  const results: string[] = [];
  let anyTie = false;
  for (const t of targets) {
    const theirTotal = theirPair + t.atk;
    if (myTotal > theirTotal) {
      t.defeated = true;
      awardXp(state, t.xp);
      const bounty = countFoeDefeated(state); // A11: a slain attacker is a beaten foe
      results.push(`${t.id} FALLS (${myTotal} vs ${theirTotal}) — +${t.xp} XP${bounty ?? ''}`);
      if (state.result !== null) return `${token.name}'s attack: ${results.join('; ')}.`;
    } else if (myTotal === theirTotal && !splash) {
      anyTie = true;
    } else {
      results.push(`${t.id} holds (${myTotal} vs ${theirTotal})`);
    }
  }
  if (anyTie) {
    const target = targets[0]!;
    const ect = context.rider_dice ?? 0;
    state.pending = {
      kind: 'roll',
      reason: 'ground_combat',
      dice_count: 4 + ect,
      score_source: { who: token.is_character ? 'self' : 'crew', ...(token.is_character ? {} : { crew_name: token.name }), ability: bestAttackAbility(state, token).ability, bonus: flatBonus },
      min_roll: null,
      declared_items: [],
      context: { ground: 'ruin_attack', actor: token.name, target: target.id, rider_dice: ect },
    };
    return `TIE against ${target.id} — reroll the attack (WR §14).`;
  }
  maybeAutoEnd(state, token);
  if (board.attackers.every((a) => a.defeated)) notes.push('The level is cleared of attackers — move freely.');
  return `${token.name}'s attack${splash ? ' (Splash Damage hits everything in range)' : ''}: ${results.join('; ')}.`;
}

export function resolveRuinDefenseRoll(
  state: WarbleWayGalaxyState,
  dice: number[],
  flatBonus: number,
  context: { actor?: string; target?: string; rider_dice?: number },
  notes: string[],
): string {
  const { run, board } = boardOrThrow(state);
  const token = tokenByName(board, context.actor!);
  const attacker = board.attackers.find((a) => a.id === context.target!)!;
  const rider = dice.slice(4).reduce((a, b) => a + b, 0);
  const { high, low } = pairTotals(dice.slice(0, 4));
  const adv = tokenGroundAdvantage(state, token);
  const myTotal = (adv ? high : low) + flatBonus + rider;
  const theirTotal = (adv ? low : high) + attacker.atk;
  if (myTotal === theirTotal) {
    const riderCount = context.rider_dice ?? 0;
    state.pending = {
      kind: 'roll',
      reason: 'ground_combat',
      dice_count: 4 + riderCount,
      score_source: { who: token.is_character ? 'self' : 'crew', ...(token.is_character ? {} : { crew_name: token.name }), ability: flatBonus > 0 ? 'ARM' : null, bonus: flatBonus },
      min_roll: null,
      declared_items: [],
      context: { ground: 'ruin_defense', actor: token.name, target: attacker.id, rider_dice: riderCount },
    };
    return `TIE (${myTotal}) — reroll the defense (WR §14).`;
  }
  if (myTotal > theirTotal) {
    return `${token.name} weathers ${attacker.id}'s attack (${myTotal} vs ${theirTotal}).`;
  }
  // Hit lands.
  if (token.is_character) {
    state.pending = {
      kind: 'roll',
      reason: 'death_check',
      dice_count: 3,
      score_source: { who: 'self', ability: null, bonus: 0 },
      min_roll: 9,
      declared_items: [],
      context: { death_source: 'ruin' },
    };
    return `${attacker.id} lands the hit on YOU (${theirTotal} vs ${myTotal}) — roll 3d6; below 9 you die (WR §14).`;
  }
  // A10: an unnamed body just stops being — decrement the counter, no gear,
  // no record, no funeral.
  if (token.unnamed === true) {
    state.unnamed_crew = Math.max(0, (state.unnamed_crew ?? 0) - 1);
    board.tokens = board.tokens.filter((t) => t.name !== token.name);
    notes.push(`${token.name} falls (${theirTotal} vs ${myTotal}) — unnamed crew remaining: ${state.unnamed_crew}.`);
    return `${attacker.id}'s attack drops ${token.name}.`;
  }
  // A crewmate dies outright (WR §14) — gear lost with them, token removed.
  const crew = state.crew.find((c) => c.name === token.name)!;
  removeCrewMember(state, crew, 'dies in the ruins');
  board.tokens = board.tokens.filter((t) => t.name !== token.name);
  notes.push(`${token.name} DIES (${theirTotal} vs ${myTotal}) — remove them and their equipped gear.`);
  return `${attacker.id}'s attack kills ${token.name}.`;
}

export function resolveItemD6(state: WarbleWayGalaxyState, die: number, context: { cell?: string }, notes: string[]): string {
  const { run, board } = boardOrThrow(state);
  const map = ruinMapForLevel(run.level);
  board.closed_spots.push(context.cell!);
  const found = map.items[die];
  let text: string;
  if (!found) {
    text = `The cache at ${context.cell} is EMPTY (rolled ${die}). The spot is spent.`;
  } else {
    const owned: ItemDefinition = { id: `${found.id}#${state.items.length + 1}`, name: found.name, type: found.type, effect: found.effect };
    state.items.push(owned);
    let extra = '';
    if (found.type === 'ship_part') {
      const ship = state.ship!;
      ship.parts.push(owned.id);
      if (found.effect.kind === 'ship_stat') {
        ship[found.effect.stat] += found.effect.bonus;
        extra = ` Installed on return: ship ${found.effect.stat} is now ${ship[found.effect.stat]}.`;
      } else if (found.effect.kind === 'space_combat_advantage') {
        extra = ' The ship gains Space Combat Advantage.';
      }
    } else if (found.type === 'weapon' || found.type === 'armor') {
      extra = ' Equip it immediately if you like (equip_item — free during your phase).';
    }
    text = `Rolled ${die}: ${found.name}!${extra}`;
  }
  // A11 Plunder: OPENING the cache counts (the act is the risk), full or not.
  const plunder = countCacheOpened(state);
  return `${text}${plunder ?? ''}`;
}

export function resolveBeingD6(state: WarbleWayGalaxyState, die: number, context: { cell?: string; actor?: string }, notes: string[]): string {
  const { run, board } = boardOrThrow(state);
  const map = ruinMapForLevel(run.level);
  board.closed_spots.push(context.cell!);
  const found = map.beings[die];
  if (!found) return `Rolled ${die}: a DECOY — nobody was ever there. The spot is spent (ruling #13).`;
  const best = bestForStat(state, found.idealized);
  const actDie = anyoneHasEffective(state, 'ACT') && (found.race === 'hexapod' || found.race === 'kralkin') ? 1 : 0;
  state.pending = {
    kind: 'roll',
    reason: 'recruit',
    dice_count: 3 + actDie,
    score_source: { who: best.who, ...(best.crew_name ? { crew_name: best.crew_name } : {}), ability: best.ability, bonus: best.bonus },
    min_roll: found.min_roll,
    declared_items: [],
    context: { recruit_id: found.id, recruit_source: 'ruin', cell: context.cell! },
  };
  return `Rolled ${die}: ${describeRecruit(found)} — they idealize ${found.idealized}. Roll ${3 + actDie}d6 + ${best.bonus}; you need ${found.min_roll}+ (their stat line's min roll, ruling #11).`;
}
