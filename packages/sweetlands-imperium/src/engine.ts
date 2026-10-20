// Sweetlands Imperium — engine (setup + turn machine + move dispatch).
//
// applyMove is PURE: it clones the incoming state and never mutates the input
// (CLAUDE.md Game contract). Source of truth: SWEETLANDS-RULES.md.

import type { PlayerConfig } from '@zekel/game-kit';
import { isDigitalSeat } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import {
  type RegionId, type SpaceColor, type TreatId, REGION_TREAT,
} from './data/board.js';
import { FACTIONS, FACTION_IDS, isNomads, availableFactionIds } from './data/factions.js';
import { SECRET_OBJECTIVES, PUBLIC_OBJECTIVES, POINTS_TO_WIN, SECRET_OBJECTIVE_POINTS, INFLUENCE_CAP } from './data/objectives.js';
import { buildIntelDeck, ALL_TREATS } from './data/intel.js';
import {
  advanceToColor, ringDistance, regionOf, intelGainForDistance,
  influenceGainForDistance, CASTLE_INFLUENCE_GAIN, regionsOnPath, colorOf, JUNCTION_INDEX,
} from './geometry.js';
import { shuffle, rollDice, rollSugarDice, randomSeed } from './rng.js';
import type {
  SweetlandsState, SweetlandsMove, PlayerState, PlayerTurnFlags, IntelCard,
  UnitType, UnitLocation, FactionId, FoeType, Phase, SecretObjectiveId, ColorPlayParams, LastBattle,
} from './types.js';
import { FOE_DICE } from './types.js';

export interface SweetlandsOptions {
  seed?: number;
  firstPlayerId?: string;
  /** Balance harness (--sweep=faction): per-seat faction assignment by creation
   *  order, decoupling faction identity from seat. Filtered to the factions valid
   *  for this player count (Nomads only at 5p). Ignored when a human is present. */
  factionAssignment?: string[];
}

const UNIT_TYPES: UnitType[] = ['leader', 'knight', 'ambassador'];
const COLOR_ACTIONS: Record<SpaceColor, string> = {
  red: 'Battle / Capture',
  orange: 'Acquire influence',
  yellow: 'Collect & raise taxes',
  green: 'Move / unlock unlimited plays',
  blue: 'Collect Intel',
  purple: 'Enter / attack the castle',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createInitialState(
  players: PlayerConfig[],
  options: SweetlandsOptions | undefined,
  seedIn?: number,
): SweetlandsState {
  let seed = seedIn ?? options?.seed ?? randomSeed();
  const anyHuman = players.some((p) => p.kind === 'human');

  const ps: PlayerState[] = players.map((p) => ({
    playerId: p.player_id,
    kind: p.kind,
    digital: isDigitalSeat(p),
    faction: 'milkshake', // placeholder until setup_factions resolves
    homeRegion: 1,
    units: { leader: { zone: 'start', region: 1 }, knight: { zone: 'start', region: 1 }, ambassador: { zone: 'start', region: 1 } },
    influence: 2,
    sugarCubes: 3,
    intelTokens: {},
    points: 0,
    hand: [],
    secretObjectives: [],
    secretObjectivesScored: [],
    publicObjectivesScored: [],
    turn: emptyTurnFlags(),
    progress: {
      capturedLeader: false, capturedAmbassador: false, defeatedKnight: false,
      collectedTaxFromOpponent: false, enteredCastleWithLeader: false,
      raisedTaxToThree: false, intelDiscardedTotal: 0, sugarDiscardedTotal: 0, influenceTrashedTotal: 0,
    },
  }));

  // Shuffle the Intel deck once; server owns the order.
  const sh = shuffle(buildIntelDeck(), seed);
  seed = sh.nextSeed;

  const firstPlayerIndex = options?.firstPlayerId
    ? Math.max(0, players.findIndex((p) => p.player_id === options.firstPlayerId))
    : 0;

  const state: SweetlandsState = {
    phase: 'setup_factions',
    round: 0,
    players: ps,
    firstPlayerIndex,
    currentPlayerIndex: firstPlayerIndex,
    seed,
    intelDeck: sh.items,
    intelDiscard: [],
    taxes: { 1: 0, 2: 0, 3: 0, 4: 0 },
    foe: null,
    castleOccupantId: null,
    castleHeldSinceRound: null,
    randomTreatPlacement: {},
    setup: { secretDeal: {}, secretReceived: {}, awaitingSecretFrom: [] },
    pending: null,
    activePlayerId: players[firstPlayerIndex]!.player_id,
  };

  // Place the 4 random treat tiles into the 4 region slots.
  const rt = shuffle<TreatId>(['ice_cream', 'chocolate_bar', 'gummy_bear', 'cupcake'], state.seed);
  state.seed = rt.nextSeed;
  ([1, 2, 3, 4] as RegionId[]).forEach((r, i) => { state.randomTreatPlacement[r] = rt.items[i]!; });

  // All-AI sessions auto-run the whole setup so the harness has a playable game
  // with no human handshake. Sessions with a human block on each setup choice.
  if (!anyHuman) {
    autoAssignFactions(state, options?.factionAssignment);
    autoChooseFoe(state);
    dealSecretObjectives(state);
    autoResolveSecrets(state);
    beginPlay(state);
  }
  return state;
}

function emptyTurnFlags(): PlayerTurnFlags {
  return { step: 'recall', unlimitedPlays: false, intelGainedThisTurn: 0, influenceGainedThisTurn: 0, influenceSpentThisTurn: 0, intelDiscardedThisTurn: 0, sugarDiscardedThisTurn: 0, unitRegionsVisited: {}, tradedThisTurn: false };
}

function autoAssignFactions(state: SweetlandsState, assignment?: string[]): void {
  const n = state.players.length;
  const valid = new Set(availableFactionIds(n));
  // Sweep assignment: take the provided order, keep only factions valid for this
  // count (Nomads only at 5p), and fill any shortfall from the remaining valid set.
  let factions: FactionId[];
  if (assignment && assignment.length > 0) {
    const picked = assignment.filter((f): f is FactionId => valid.has(f as FactionId));
    const rest = availableFactionIds(n).filter((f) => !picked.includes(f));
    factions = [...new Set([...picked, ...rest])].slice(0, n);
  } else {
    factions = availableFactionIds(n).slice(0, n); // default: distinct by seat index
  }
  state.players.forEach((p, i) => assignFaction(state, p, factions[i % factions.length]!));
}

export function assignFaction(state: SweetlandsState, p: PlayerState, faction: FactionId): void {
  p.faction = faction;
  const def = FACTIONS[faction];
  p.homeRegion = def.homeRegion;
  if (isNomads(faction)) {
    // Nomads have no region: units start OFF the board and choose an entry region
    // the first time they move. They also start with 0 sugar and no secrets.
    for (const u of UNIT_TYPES) p.units[u] = { zone: 'offboard' };
    p.sugarCubes = 0;
  } else {
    for (const u of UNIT_TYPES) p.units[u] = { zone: 'start', region: def.homeRegion! };
  }
}

function autoChooseFoe(state: SweetlandsState): void {
  const foes: FoeType[] = ['dragon', 'orc', 'fiend'];
  const idx = state.seed % 3;
  state.foe = { type: foes[idx]!, defeated: false };
}

function dealSecretObjectives(state: SweetlandsState): void {
  const sh = shuffle(SECRET_OBJECTIVES.map((o) => o.id), state.seed);
  state.seed = sh.nextSeed;
  let k = 0;
  for (const p of state.players) {
    if (isNomads(p.faction)) continue; // Nomads get no secret objectives
    state.setup.secretDeal[p.playerId] = [sh.items[k++]!, sh.items[k++]!];
  }
}

/** All-AI: each player keeps the first dealt objective, passes the other right. */
function autoResolveSecrets(state: SweetlandsState): void {
  const eligible = state.players.filter((p) => !isNomads(p.faction));
  eligible.forEach((p, i) => {
    const deal = state.setup.secretDeal[p.playerId] ?? [];
    const kept = deal[0];
    const passed = deal[1];
    if (kept) p.secretObjectives.push(kept);
    if (passed) {
      const right = eligible[(i + 1) % eligible.length]!;
      right.secretObjectives.push(passed);
    }
  });
}

function beginPlay(state: SweetlandsState): void {
  state.phase = 'play';
  state.round = 1;
  state.currentPlayerIndex = state.firstPlayerIndex;
  // Each player draws 3 starting Intel. The all-AI path deals everyone now.
  // (Human sessions reach here only via setup_intel, which deals per-seat as
  // each human reports or presses the Draw button.)
  for (const p of state.players) if (p.kind === 'ai') dealIntelToPlayer(state, p, 3);
  startTurn(state);
}

// ---------------------------------------------------------------------------
// Deck handling
// ---------------------------------------------------------------------------

function dealIntelToPlayer(state: SweetlandsState, p: PlayerState, n: number): IntelCard[] {
  const drawn: IntelCard[] = [];
  for (let i = 0; i < n; i++) {
    if (state.intelDeck.length === 0) reshuffleDiscard(state);
    const card = state.intelDeck.shift();
    if (!card) break; // deck + discard both empty — degenerate, stop
    drawn.push(card);
    p.hand.push(card);
  }
  return drawn;
}

/** Pull one single-color card of `color` from the deck (reshuffling the discard
 *  in if needed) for the discard-for-color conversion. Falls back to a synthesized
 *  card only in the degenerate case where all copies of that color are in hands —
 *  preserving the conversion's guarantee without normally breaking deck conservation. */
function takeColorFromDeck(state: SweetlandsState, color: SpaceColor): IntelCard {
  const find = (): number => state.intelDeck.findIndex((c) => c.kind === 'single' && c.color === color);
  let idx = find();
  if (idx < 0 && state.intelDiscard.length > 0) { reshuffleDiscard(state); idx = find(); }
  if (idx >= 0) return state.intelDeck.splice(idx, 1)[0]!;
  return { cardId: `conv-${color}-${state.seed}`, kind: 'single', color }; // degenerate fallback
}

function reshuffleDiscard(state: SweetlandsState): void {
  if (state.intelDiscard.length === 0) return;
  const sh = shuffle(state.intelDiscard, state.seed);
  state.seed = sh.nextSeed;
  state.intelDeck.push(...sh.items);
  state.intelDiscard = [];
}

// ---------------------------------------------------------------------------
// Turn lifecycle
// ---------------------------------------------------------------------------

function activePlayer(state: SweetlandsState): PlayerState {
  return state.players[state.currentPlayerIndex]!;
}

function startTurn(state: SweetlandsState): void {
  const p = activePlayer(state);
  p.turn = emptyTurnFlags();
  state.activePlayerId = p.playerId;
}

/** How much Intel a player gains from their Ambassador's region distance. */
function intelGainCount(p: PlayerState): number {
  if (isNomads(p.faction)) return 2; // Nomads always gain 2
  const ambRegion = regionOf(p.units.ambassador) ?? p.homeRegion!;
  return intelGainForDistance(ringDistance(p.homeRegion!, ambRegion));
}

/** Server owns this seat's hand/deck (docs/digital-mode.md) — AI always, and
 *  digital humans by opt-in. Legacy persisted rows may lack `digital`; derive
 *  it from kind in that case (AI = true, physical human = false). */
function isServerOwned(p: PlayerState): boolean {
  return p.digital ?? p.kind === 'ai';
}

/** Hand a player `n` Intel: a SERVER-OWNED seat is dealt from the deck
 *  directly; a PHYSICAL human must REPORT what they drew, so we open a report
 *  pending and reconcile on report. */
function grantIntel(state: SweetlandsState, p: PlayerState, n: number, reason: 'gain' | 'collect'): void {
  if (n <= 0) return;
  if (p.kind === 'ai') {
    // AI: silent direct deal — the AI "presses its own button" during play.
    const drawn = dealIntelToPlayer(state, p, n); // caps to the drawable pool
    p.turn.intelGainedThisTurn += drawn.length;
    return;
  }
  // Human (physical OR digital): arm a pending that blocks play until the
  // player resolves it. Physical humans REPORT the cards they drew
  // (report_intel_draw); digital humans PRESS the button (resolve_report) and
  // the server fills the cards in via autoReportMove.
  // CAP to the drawable pool (deck + discard): you can't draw cards that don't
  // exist. A player who has hoarded most of the deck would otherwise open a report
  // pending for more cards than remain — unsatisfiable, so the report (and the
  // game) deadlocks forever.
  const existing = state.pending?.kind === 'report_intel' && state.pending.forPlayerId === p.playerId ? state.pending.count : 0;
  const drawable = state.intelDeck.length + state.intelDiscard.length;
  const capped = Math.min(existing + n, drawable);
  if (capped <= 0) { if (existing === 0) state.pending = null; return; }
  if (state.pending && state.pending.kind === 'report_intel' && state.pending.forPlayerId === p.playerId) {
    state.pending.count = capped;
  } else {
    state.pending = { kind: 'report_intel', forPlayerId: p.playerId, count: capped, reason };
  }
}

function advanceToNextPlayer(state: SweetlandsState): void {
  const next = (state.currentPlayerIndex + 1) % state.players.length;
  // A full round completes when we wrap back to the first player.
  if (next === state.firstPlayerIndex) {
    runScoringPhase(state);
    if (state.phase === 'game_over') return;
    state.round += 1;
  }
  state.currentPlayerIndex = next;
  startTurn(state);
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

export function applyMove(
  prev: SweetlandsState,
  playerId: string,
  move: SweetlandsMove,
): { newState: SweetlandsState; summary: string } {
  const state = structuredClone(prev) as SweetlandsState;
  const summary = dispatch(state, playerId, move);
  syncCastleClaim(state);
  state.activePlayerId = currentActorId(state);
  return { newState: state, summary };
}

/** Who the engine currently expects to act (active player, or a setup reporter). */
function currentActorId(state: SweetlandsState): string {
  if (state.phase === 'game_over') return state.players[state.firstPlayerIndex]!.playerId;
  return activePlayer(state).playerId;
}

function dispatch(state: SweetlandsState, playerId: string, move: SweetlandsMove): string {
  // A pending Intel report blocks everything else until the human reports (or
  // a digital human presses the Draw button).
  if (state.pending?.kind === 'report_intel' && move.type !== 'report_intel_draw' && move.type !== 'resolve_report') {
    throw new GameError('ILLEGAL_MOVE', `${state.pending.forPlayerId} must report their ${state.pending.count} drawn Intel first (report_intel_draw, or the resolve_report button for a digital seat)`);
  }
  switch (move.type) {
    // ---- setup ----
    case 'assign_setup_choices': return doAssignFactions(state, playerId, move.selections);
    case 'choose_foe': return doChooseFoe(state, playerId, move.foe);
    case 'choose_secret_objective': return doChooseSecret(state, playerId, move.objective);
    case 'report_intel_draw': return doReportIntelDraw(state, playerId, move.cards);
    case 'resolve_report': return doResolveReport(state, playerId);
    // ---- turn ----
    case 'recall': return doRecall(state, playerId, move.units);
    case 'play_intel': return doPlayIntel(state, playerId, move);
    case 'play_token': return doPlayToken(state, playerId, move);
    case 'pass': return doPass(state, playerId);
    case 'discard_for_color': return doDiscardForColor(state, playerId, move.cardIds, move.color);
    case 'discard_sugar': return doDiscardSugar(state, playerId, move.count);
    case 'trash_influence': return doTrashInfluence(state, playerId, move.count);
    case 'trade': return doTrade(state, playerId, move);
    case 'buy_intel_token': return doBuyToken(state, playerId, move.color);
    case 'buy_sugar_cube': return doBuySugar(state, playerId);
    case 'end_turn': return doEndTurn(state, playerId);
    default: {
      const _exhaustive: never = move;
      throw new GameError('ILLEGAL_MOVE', `Unknown move type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function requireActive(state: SweetlandsState, playerId: string): PlayerState {
  const p = activePlayer(state);
  if (p.playerId !== playerId) throw new GameError('NOT_YOUR_TURN', `It is ${p.playerId}'s turn, not ${playerId}`);
  return p;
}

function findPlayer(state: SweetlandsState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.playerId === playerId);
  if (!p) throw new GameError('ILLEGAL_MOVE', `No such player: ${playerId}`);
  return p;
}

// ---- setup handlers (human path) ----

function doAssignFactions(state: SweetlandsState, playerId: string, selections: Record<string, FactionId>): string {
  if (state.phase !== 'setup_factions') throw new GameError('ILLEGAL_MOVE', 'Not in faction-setup phase');
  for (const p of state.players) {
    const f = selections[p.playerId];
    if (!f || !FACTION_IDS.includes(f)) throw new GameError('ILLEGAL_MOVE', `Missing/invalid faction for ${p.playerId}`);
  }
  const used = new Set(Object.values(selections));
  if (used.size !== state.players.length) throw new GameError('ILLEGAL_MOVE', 'Each player must pick a distinct faction');
  // The Nomads faction is ONLY available in a 5-player game (4 regions + Nomads).
  if (state.players.length !== 5 && used.has('nomads')) {
    throw new GameError('ILLEGAL_MOVE', 'The Unsweetened Nomads can only be played in a 5-player game');
  }
  for (const p of state.players) assignFaction(state, p, selections[p.playerId]!);
  state.phase = 'setup_foe';
  return `Factions assigned: ${state.players.map((p) => `${p.playerId}=${FACTIONS[p.faction].name}`).join(', ')}.`;
}

function doChooseFoe(state: SweetlandsState, _playerId: string, foe: FoeType): string {
  if (state.phase !== 'setup_foe') throw new GameError('ILLEGAL_MOVE', 'Not in foe-setup phase');
  state.foe = { type: foe, defeated: false };
  dealSecretObjectives(state);
  state.phase = 'setup_secrets';
  // queue the human-eligible players to pick a kept objective, in turn order
  state.setup.awaitingSecretFrom = state.players.filter((p) => !isNomads(p.faction)).map((p) => p.playerId);
  resolveAISecretsAtHead(state);
  if (state.setup.awaitingSecretFrom.length === 0) finalizeSecrets(state);
  return `Foe chosen: the ${foe.toUpperCase()} (rolls ${FOE_DICE[foe]} dice) guards the castle.`;
}

function doChooseSecret(state: SweetlandsState, playerId: string, objective: SecretObjectiveId): string {
  if (state.phase !== 'setup_secrets') throw new GameError('ILLEGAL_MOVE', 'Not in secret-objective phase');
  const head = state.setup.awaitingSecretFrom[0];
  if (head !== playerId) throw new GameError('NOT_YOUR_TURN', `Waiting on ${head} to pick a secret objective`);
  const deal = state.setup.secretDeal[playerId] ?? [];
  if (!deal.includes(objective)) throw new GameError('ILLEGAL_MOVE', `${objective} was not dealt to ${playerId}`);
  keepSecret(state, playerId, objective);
  state.setup.awaitingSecretFrom.shift();
  resolveAISecretsAtHead(state);
  if (state.setup.awaitingSecretFrom.length === 0) finalizeSecrets(state);
  return `${playerId} kept a secret objective.`;
}

/** Auto-resolve AI players sitting at the head of the secret-pick queue. */
function resolveAISecretsAtHead(state: SweetlandsState): void {
  while (state.setup.awaitingSecretFrom.length > 0) {
    const head = state.setup.awaitingSecretFrom[0]!;
    const p = findPlayer(state, head);
    if (p.kind !== 'ai') break;
    const deal = state.setup.secretDeal[head] ?? [];
    if (deal[0]) keepSecret(state, head, deal[0]);
    state.setup.awaitingSecretFrom.shift();
  }
}

function keepSecret(state: SweetlandsState, playerId: string, kept: SecretObjectiveId): void {
  const eligible = state.players.filter((p) => !isNomads(p.faction));
  const idx = eligible.findIndex((p) => p.playerId === playerId);
  const deal = state.setup.secretDeal[playerId] ?? [];
  const passed = deal.find((o) => o !== kept) ?? deal[1];
  const me = findPlayer(state, playerId);
  me.secretObjectives.push(kept);
  if (passed) {
    const right = eligible[(idx + 1) % eligible.length]!;
    (state.setup.secretReceived[right.playerId] ??= []).push(passed);
  }
}

function finalizeSecrets(state: SweetlandsState): void {
  // fold received objectives in, then move to intel draws
  for (const p of state.players) {
    for (const o of state.setup.secretReceived[p.playerId] ?? []) p.secretObjectives.push(o);
  }
  state.phase = 'setup_intel';
  // AI seats auto-draw their 3; HUMANS (physical and digital) arm a pending —
  // physical report what they drew, digital press the Draw button. Deal AI now.
  for (const p of state.players) if (p.kind === 'ai') dealIntelToPlayer(state, p, 3);
  maybeFinishIntelSetup(state);
}

function doReportIntelDraw(state: SweetlandsState, playerId: string, cards: Array<{ kind?: IntelCard['kind']; color?: SpaceColor; colors?: [SpaceColor, SpaceColor]; treat?: TreatId }>): string {
  // A digital human holds no physical cards — they press resolve_report and
  // the server deals. Rejecting a payload report here keeps a hallucinated
  // client submission from desyncing the server's tracked hand.
  const seat = findPlayer(state, playerId);
  if (seat.digital === true) {
    throw new GameError('ILLEGAL_MOVE', `${playerId} is a digital seat — press the Draw button (resolve_report) and the server deals the cards, instead of reporting them.`);
  }
  // Mid-game report (turn-start gain or a Blue collect) — resolves a pending.
  if (state.pending?.kind === 'report_intel') {
    const pend = state.pending;
    if (pend.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', `Waiting on ${pend.forPlayerId} to report drawn Intel`);
    if (cards.length !== pend.count) throw new GameError('ILLEGAL_MOVE', `Report exactly ${pend.count} drawn Intel card(s)`);
    const p = findPlayer(state, playerId);
    for (const c of cards) p.hand.push(reconcileReportedCard(state, c));
    p.turn.intelGainedThisTurn += pend.count;
    state.pending = null;
    // resume the turn: a 'gain' keeps the play step; a 'collect' ends it (unless
    // a Green discard left unlimited plays open).
    if (pend.reason === 'collect') p.turn.step = p.turn.unlimitedPlays ? 'play' : 'influence';
    scoreSecretObjectives(state, p);
    return `${playerId} reported ${pend.count} drawn Intel.`;
  }
  // Setup: each human reports their 3 starting Intel.
  if (state.phase !== 'setup_intel') throw new GameError('ILLEGAL_MOVE', 'Not in intel-draw phase');
  const p = findPlayer(state, playerId);
  if (p.kind !== 'human') throw new GameError('ILLEGAL_MOVE', 'Only human seats report draws');
  if (p.hand.length > 0) throw new GameError('ILLEGAL_MOVE', `${playerId} already drew`);
  if (cards.length !== 3) throw new GameError('ILLEGAL_MOVE', 'Report exactly 3 starting Intel cards');
  for (const c of cards) p.hand.push(reconcileReportedCard(state, c));
  maybeFinishIntelSetup(state);
  return `${playerId} drew 3 Intel.`;
}

/** Digital-mode button: the player pressed Draw/Roll. Synthesize the pending
 *  report from the server's tracked deck (the same resolver autoResolveReport
 *  uses) and apply it via the normal report path so the state update, pending
 *  clearing, and narration all behave identically to a physical report.
 *  Only legal when the seat owes a report pending AND is digital — a physical
 *  human must REPORT the cards (they hold them); the server cannot guess. */
function doResolveReport(state: SweetlandsState, playerId: string): string {
  const p = findPlayer(state, playerId);
  if (p.kind !== 'human') throw new GameError('ILLEGAL_MOVE', 'AI seats never press the randomness button (the server plays their cards directly)');
  if (!(p.digital === true)) throw new GameError('ILLEGAL_MOVE', `${playerId} is a physical seat — report the cards you drew (report_intel_draw), don't press a button`);
  const synthesized = autoReportMove(state, playerId);
  if (!synthesized) throw new GameError('ILLEGAL_MOVE', `${playerId} has no pending report to resolve`);
  if (synthesized.type !== 'report_intel_draw') throw new GameError('ILLEGAL_MOVE', `Unexpected synthesized move type ${synthesized.type}`);
  const cards = synthesized.cards;

  // Mid-game pending: deal in the pending count, then resume the turn — same
  // bookkeeping as the physical doReportIntelDraw path.
  if (state.pending?.kind === 'report_intel') {
    const pend = state.pending;
    if (pend.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', `Waiting on ${pend.forPlayerId} to draw their Intel`);
    for (const c of cards) p.hand.push(reconcileReportedCard(state, c));
    p.turn.intelGainedThisTurn += pend.count;
    state.pending = null;
    if (pend.reason === 'collect') p.turn.step = p.turn.unlimitedPlays ? 'play' : 'influence';
    scoreSecretObjectives(state, p);
    return `${playerId} pressed Draw — the server dealt ${pend.count} Intel.`;
  }
  // Setup: the digital human's 3 starting Intel.
  if (state.phase !== 'setup_intel') throw new GameError('ILLEGAL_MOVE', 'Not in intel-draw phase');
  if (p.hand.length > 0) throw new GameError('ILLEGAL_MOVE', `${playerId} already drew`);
  for (const c of cards) p.hand.push(reconcileReportedCard(state, c));
  maybeFinishIntelSetup(state);
  return `${playerId} pressed Draw — the server dealt 3 Intel.`;
}

/** Resolve a human-reported treat to its TreatId, accepting the PRINTED name in
 *  any case/spacing/punctuation ("Chocolate Bar", "chocolate bar", "chocolate_bar"
 *  all → 'chocolate_bar'). The model reads the treat name off the card, never the
 *  internal underscore id, so requiring the exact id would silently desync the
 *  report. (CLAUDE.md "don't make the model guess — accept the printed name".) */
function resolveTreatId(raw: string): TreatId | null {
  // Drop the type words a human/model commonly appends ("ice cream treat", "the
  // gummy bear card") and any separators, then compare. No treat name contains
  // "treat"/"card", so this can't collide.
  const norm = (s: string): string => s.toLowerCase().replace(/\b(treat|card|the|a|an)\b/g, '').replace(/[\s_-]+/g, '');
  const want = norm(raw);
  return want ? (ALL_TREATS.find((t) => norm(t) === want) ?? null) : null;
}

/** Remove a human-reported card from the server's tracked deck remainder. */
function reconcileReportedCard(state: SweetlandsState, c: { kind?: IntelCard['kind']; color?: SpaceColor; colors?: [SpaceColor, SpaceColor]; treat?: TreatId }): IntelCard {
  const treatId = c.treat != null ? resolveTreatId(String(c.treat)) : null;
  // Tolerate an omitted `kind`: a human reporting "a red card" most naturally
  // yields {color:'red'} with no kind, which the model produced and we'd otherwise
  // reject. Infer from the fields present (treat → treat, paired colors → double,
  // else single). Doubles are still distinguished by the explicit kind/colors the
  // report template asks for, so single is the safe default for a lone color.
  const kind: IntelCard['kind'] = c.kind ?? (treatId != null ? 'treat' : c.colors != null ? 'double' : 'single');
  const find = (): number => state.intelDeck.findIndex((d) => {
    if (d.kind !== kind) return false;
    if (d.kind === 'single') return d.color === c.color;
    if (d.kind === 'double') return c.colors ? d.color === c.colors[0] : d.color === c.color;
    return treatId != null && d.kind === 'treat' && d.treat === treatId;
  });
  let matchIdx = find();
  if (matchIdx < 0 && state.intelDiscard.length > 0) { reshuffleDiscard(state); matchIdx = find(); }
  if (matchIdx < 0) throw new GameError('ILLEGAL_MOVE', `Reported Intel card not available in the deck: ${JSON.stringify(c)}`);
  const [card] = state.intelDeck.splice(matchIdx, 1);
  return card!;
}

/** Synthesize a valid Intel report from the server's tracked deck (the top
 *  `count` cards). Callers: (a) doResolveReport when a digital human presses
 *  the Draw button; (b) autoResolveReport for the test/desync harness driving
 *  a seat past a report it can't know. Never called silently for a digital
 *  human — only on their explicit button press. */
export function autoReportMove(state: SweetlandsState, playerId: string): SweetlandsMove | null {
  const pend = state.pending;
  let count = 0;
  if (pend?.kind === 'report_intel' && pend.forPlayerId === playerId) count = pend.count;
  else if (state.phase === 'setup_intel' && findPlayer(state, playerId).hand.length === 0) count = 3;
  else return null;
  if (state.intelDeck.length < count) reshuffleDiscard(state);
  const top = state.intelDeck.slice(0, count);
  const cards = top.map((d) => d.kind === 'single' ? { kind: 'single' as const, color: d.color }
    : d.kind === 'double' ? { kind: 'double' as const, color: d.color }
    : { kind: 'treat' as const, treat: d.treat });
  return { type: 'report_intel_draw', cards };
}

function maybeFinishIntelSetup(state: SweetlandsState): void {
  const humansPending = state.players.filter((p) => p.kind === 'human' && p.hand.length === 0);
  if (humansPending.length > 0) return;
  beginPlayAfterSetupIntel(state);
}

function beginPlayAfterSetupIntel(state: SweetlandsState): void {
  state.phase = 'play';
  state.round = 1;
  state.currentPlayerIndex = state.firstPlayerIndex;
  startTurn(state);
}

// ---- turn handlers ----

function doRecall(state: SweetlandsState, playerId: string, units: UnitType[]): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play' || p.turn.step !== 'recall') throw new GameError('ILLEGAL_MOVE', 'Recall happens at the start of your turn');
  for (const u of units) p.units[u] = isNomads(p.faction) ? { zone: 'offboard' } : { zone: 'start', region: p.homeRegion! };
  // After recall, gain Intel and proceed to the play step. For a human this opens
  // a report pending (they physically drew); legalMoves blocks play until reported.
  const gained = intelGainCount(p);
  grantIntel(state, p, gained, 'gain');
  p.turn.step = 'play';
  const recalled = units.length ? `recalled ${units.join(', ')}; ` : '';
  const drew = p.kind === 'ai'
    ? `gained ${gained} Intel`
    : p.digital === true
      ? `drew ${gained} Intel (press the Draw button to reveal)`
      : `must report ${gained} drawn Intel`;
  return `${playerId} ${recalled}${drew}. ${p.kind === 'ai' ? 'Play an Intel card.' : ''}`;
}

function doPlayIntel(state: SweetlandsState, playerId: string, move: Extract<SweetlandsMove, { type: 'play_intel' }>): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play' || p.turn.step !== 'play') throw new GameError('ILLEGAL_MOVE', 'Not the play step');
  const cardIdx = p.hand.findIndex((c) => c.cardId === move.cardId);
  if (cardIdx < 0) throw new GameError('ILLEGAL_MOVE', `Card ${move.cardId} not in hand`);
  const card = p.hand[cardIdx]!;
  p.hand.splice(cardIdx, 1);
  state.intelDiscard.push(card);

  let endsPlayStep = true;
  let summary: string;
  if (card.kind === 'treat') {
    summary = resolveTreatPlay(state, p, card.treat, move);
  } else if (card.kind === 'single') {
    const r = resolveColorPlay(state, p, card.color, move);
    summary = r.summary;
    if (r.keepPlaying) endsPlayStep = false;
  } else {
    // double card = the SAME color played twice (move+action, then move+action).
    const r0 = resolveColorPlay(state, p, card.color, move);
    const r1 = resolveColorPlay(state, p, card.color, move);
    summary = `${playerId} played a double ${card.color} card — ${r0.summary}, then ${r1.summary}`;
    if (r0.keepPlaying || r1.keepPlaying) endsPlayStep = false;
  }
  // unlimitedPlays (from a Green discard) keeps the play step open.
  if (p.turn.unlimitedPlays) endsPlayStep = false;
  // A human Blue collect opens a report pending; the step advances only after the
  // report (doReportIntelDraw), so don't advance here while one is outstanding.
  if (endsPlayStep && !state.pending) p.turn.step = 'influence';
  scoreSecretObjectives(state, p);
  return summary;
}

/** Resolve a single color's "move then optional action". Returns whether the play
 *  step should stay open (Green discard-for-unlimited). */
function resolveColorPlay(
  state: SweetlandsState,
  p: PlayerState,
  color: SpaceColor,
  move: ColorPlayParams,
): { summary: string; keepPlaying: boolean } {
  // GREEN with takeAction = discard the card (no move) to unlock unlimited plays.
  if (color === 'green' && move.takeAction) {
    p.turn.unlimitedPlays = true;
    return { summary: `${p.playerId} discarded Green to play unlimited Intel this turn`, keepPlaying: true };
  }
  // Off-board (Nomad) unit: enter at the chosen region's start, then advance.
  let from = p.units[move.unit];
  if (from.zone === 'offboard') {
    const entry = move.entryRegion;
    if (!entry) throw new GameError('ILLEGAL_MOVE', 'Nomads must choose an entry region (entryRegion) to move an off-board unit');
    from = { zone: 'start', region: entry };
    p.units[move.unit] = from;
  }
  const dest = advanceToColor(from, color, move.viaRoad ?? false);
  const parts: string[] = [];
  if (dest) {
    // Accumulate the distinct regions THIS unit has visited this turn (for the
    // "move one unit through 3 regions in one turn" objective).
    const visited = p.turn.unitRegionsVisited[move.unit] ?? [];
    for (const r of regionsOnPath(from, dest, move.viaRoad ?? false)) if (!visited.includes(r)) visited.push(r);
    p.turn.unitRegionsVisited[move.unit] = visited;
    p.units[move.unit] = dest;
    parts.push(`moved ${move.unit} (${color})`);
  } else {
    parts.push(`${move.unit} could not advance (${color})`);
  }
  if (move.takeAction) parts.push(resolveColorAction(state, p, color, move));
  return { summary: parts.join(', '), keepPlaying: false };
}

/** Resolve the action tied to a color (after the move). */
function resolveColorAction(
  state: SweetlandsState,
  p: PlayerState,
  color: SpaceColor,
  move: ColorPlayParams,
): string {
  switch (color) {
    case 'orange': return actionAcquireInfluence(p);
    case 'yellow': return actionTaxes(state, p, move.raiseTaxes ?? false);
    case 'blue': return actionCollectIntel(state, p);
    case 'red': return actionBattleCapture(state, p, move);
    case 'purple': return actionCastle(state, p, move);
    case 'green': return 'pushed'; // Green move already applied; push folded into movement
  }
}

// ---- the six color actions ----

function actionAcquireInfluence(p: PlayerState): string {
  let gain: number;
  if (isNomads(p.faction)) gain = 3;
  else if (p.units.leader.zone === 'castle') gain = CASTLE_INFLUENCE_GAIN;
  else gain = influenceGainForDistance(ringDistance(p.homeRegion!, regionOf(p.units.leader) ?? p.homeRegion!));
  gainInfluence(p, gain);
  return `gained ${gain} influence (now ${p.influence})`;
}

function actionCollectIntel(state: SweetlandsState, p: PlayerState): string {
  const n = intelGainCount(p);
  grantIntel(state, p, n, 'collect');
  return p.kind === 'ai'
    ? `collected ${n} Intel`
    : p.digital === true
      ? `drew ${n} Intel (press the Draw button to reveal)`
      : `must report ${n} collected Intel`;
}

function actionTaxes(state: SweetlandsState, p: PlayerState, raise: boolean): string {
  if (isNomads(p.faction)) return 'cannot collect taxes (Nomads)';
  const region = p.homeRegion!;
  const level = state.taxes[region];
  const parts: string[] = [];
  if (level > 0) {
    for (const other of state.players) {
      if (other.playerId === p.playerId) continue;
      if (other.faction === 'milkshake') continue; // never pays taxes
      // Units standing on a special-treat space are tax-exempt.
      const taxable = UNIT_TYPES.filter((u) => regionOf(other.units[u]) === region && other.units[u].zone !== 'treat');
      if (taxable.length === 0) continue;
      if (other.influence >= level) {
        other.influence -= level; gainInfluence(p, level);
        p.progress.collectedTaxFromOpponent = true;
        parts.push(`collected ${level} from ${other.playerId}`);
      } else {
        // can't pay → their taxable units in this region go home
        for (const u of taxable) other.units[u] = isNomads(other.faction) ? { zone: 'offboard' } : { zone: 'start', region: other.homeRegion! };
        parts.push(`${other.playerId} could not pay — units sent home`);
      }
    }
  }
  if (raise && level < 3 && p.influence >= 1) {
    spendInfluence(p, 1);
    state.taxes[region] = level + 1;
    if (level + 1 >= 3) p.progress.raisedTaxToThree = true;
    parts.push(`raised region ${region} tax to ${level + 1}`);
  }
  return parts.length ? `taxes: ${parts.join('; ')}` : 'collected taxes (none owed)';
}

function actionBattleCapture(state: SweetlandsState, p: PlayerState, move: ColorPlayParams): string {
  const kloc = p.units.knight;
  // Red action: Attack the castle foe ONLY if the knight is already inside the
  // castle (entered previously by a Purple play). Red does NOT carry a unit
  // into the castle — movement does that.
  if (state.foe && !state.foe.defeated && kloc.zone === 'castle') {
    return battleFoe(state, p, move.battleTotal);
  }
  const knightRegion = regionOf(p.units.knight);
  if (knightRegion == null) return 'no battle/capture available (knight is in the castle / off-board)';
  // find an enemy leader/ambassador in the knight's region
  const targets: Array<{ owner: PlayerState; unit: UnitType }> = [];
  for (const other of state.players) {
    if (other.playerId === p.playerId) continue;
    for (const u of ['leader', 'ambassador'] as UnitType[]) {
      if (regionOf(other.units[u]) === knightRegion) targets.push({ owner: other, unit: u });
    }
  }
  if (targets.length === 0) return 'no capture target in range';
  // if an enemy knight is in-region, must battle it first
  const enemyKnight = state.players.find((o) => o.playerId !== p.playerId && regionOf(o.units.knight) === knightRegion);
  // choose target: explicit, else prioritize leaders
  let chosen = targets.find((t) => t.owner.playerId === move.targetPlayerId && t.unit === move.targetUnit)
    ?? targets.find((t) => t.unit === 'leader') ?? targets[0]!;
  if (enemyKnight && enemyKnight.playerId !== chosen.owner.playerId) {
    const r = battleKnight(state, p, enemyKnight);
    if (!r.win) return r.summary; // lost the knight battle, no capture
  } else if (enemyKnight && enemyKnight.playerId === chosen.owner.playerId) {
    const r = battleKnight(state, p, enemyKnight);
    if (!r.win) return r.summary;
  }
  // capture
  chosen.owner.units[chosen.unit] = isNomads(chosen.owner.faction)
    ? { zone: 'offboard' }
    : { zone: 'start', region: chosen.owner.homeRegion! };
  if (chosen.unit === 'leader') { p.progress.capturedLeader = true; scorePublic(state, p, 'capture_leader'); }
  else if (chosen.unit === 'ambassador') p.progress.capturedAmbassador = true;
  return `captured ${chosen.owner.playerId}'s ${chosen.unit}`;
}

/** Keep a battle's dice for the views (SweetlandsState.lastBattle). */
function recordBattle(state: SweetlandsState, battle: Omit<LastBattle, 'id' | 'round'>): void {
  state.lastBattle = { id: (state.lastBattle?.id ?? 0) + 1, round: state.round, ...battle };
}

function battleKnight(state: SweetlandsState, attacker: PlayerState, defender: PlayerState): { win: boolean; summary: string } {
  if (attacker.faction === 'jellybean') {
    attacker.progress.defeatedKnight = true;
    recordBattle(state, { kind: 'knight', attacker: { playerId: attacker.playerId, faces: [], total: 0 }, defender: { playerId: defender.playerId, foe: null, faces: [], total: 0 }, winner: 'attacker', automatic: true });
    return { win: true, summary: `Jellybean's knight automatically wins vs ${defender.playerId}` };
  }
  const a = rollSugarDice(attacker.sugarCubes, state.seed); state.seed = a.nextSeed;
  const d = rollSugarDice(defender.sugarCubes, state.seed); state.seed = d.nextSeed;
  const as = a.total; const ds = d.total;
  const win = as > ds; // tie -> defender wins
  if (win) attacker.progress.defeatedKnight = true;
  recordBattle(state, { kind: 'knight', attacker: { playerId: attacker.playerId, faces: a.faces, total: as }, defender: { playerId: defender.playerId, foe: null, faces: d.faces, total: ds }, winner: win ? 'attacker' : 'defender' });
  return { win, summary: win ? `won knight battle ${as} vs ${ds}` : `lost knight battle ${as} vs ${ds} (defender holds)` };
}

function battleFoe(state: SweetlandsState, p: PlayerState, declaredTotal?: number): string {
  if (!state.foe) return 'no foe';
  // NOTE: Jellybean's "knight always wins when attacking" applies ONLY to battles vs
  // other knights (battleKnight), NOT to the foe (designer ruling). The foe is always
  // a real dice fight for every faction.
  const dice = FOE_DICE[state.foe.type];
  let as: number;
  let attackerFaces: number[] | null = null; // null: a physical seat rolled its own and reported the total
  if (p.kind === 'human' && p.digital !== true) {
    // Physical-first: the human rolls their own sugar cubes and reports the total.
    // The declared total must be supplied; otherwise the move is incomplete.
    // A DIGITAL human seat owns no dice (docs/digital-mode.md): the server
    // rolls their sugar cubes below, exactly as it does for an AI, when they
    // press the move that starts the battle.
    if (declaredTotal == null) {
      throw new GameError('ILLEGAL_MOVE', `Roll your ${p.sugarCubes} sugar cube(s) and include the total pips in battleTotal`);
    }
    const max = p.sugarCubes * 3;
    if (!Number.isInteger(declaredTotal) || declaredTotal < 0 || declaredTotal > max) {
      throw new GameError('ILLEGAL_MOVE', `Invalid battleTotal ${declaredTotal} — must be an integer between 0 and ${max} (one custom die per sugar cube: faces 0/0/0/1/2/3)`);
    }
    as = declaredTotal;
  } else {
    // AI / no declaration: server rolls the attacker's sugar dice.
    const a = rollSugarDice(p.sugarCubes, state.seed); state.seed = a.nextSeed;
    as = a.total;
    attackerFaces = a.faces;
  }
  const f = rollSugarDice(dice, state.seed); state.seed = f.nextSeed;
  const fs = f.total;
  recordBattle(state, { kind: 'foe', attacker: { playerId: p.playerId, faces: attackerFaces, total: as }, defender: { playerId: null, foe: state.foe.type, faces: f.faces, total: fs }, winner: as > fs ? 'attacker' : 'defender' });
  if (as > fs) { state.foe.defeated = true; scorePublic(state, p, 'defeat_foe'); return `defeated the ${state.foe.type} (${as} vs ${fs})!`; }
  return `failed to defeat the ${state.foe.type} (${as} vs ${fs})`;
}

function actionCastle(state: SweetlandsState, p: PlayerState, move: ColorPlayParams): string {
  const unit = move.unit;
  const loc = p.units[unit];
  // Purple "enter the castle from the road": a unit on the road or at the junction
  // moves into the castle node. The road's final Purple (Purple-card action) enters
  // the castle (SWEETLANDS-RULES.md §10).
  const canEnter = loc.zone === 'road' || (loc.zone === 'ring' && loc.ringIndex === JUNCTION_INDEX);
  if (loc.zone !== 'castle' && canEnter) p.units[unit] = { zone: 'castle' };
  if (p.units[unit].zone !== 'castle') return `${unit} must be on the road or at the junction to enter the castle`;
  if (unit === 'leader') {
    p.progress.enteredCastleWithLeader = true;
    if (state.foe && !state.foe.defeated) return "the leader entered the castle but the foe still guards it — defeat it with your knight to hold the castle";
    // The claim itself is owned by syncCastleClaim (runs after every move).
    const contested = state.players.some((o) => o.playerId !== p.playerId && UNIT_TYPES.some((u) => o.units[u].zone === 'castle'));
    return contested
      ? `${p.playerId}'s leader entered the castle, but it is contested by another player's unit`
      : `${p.playerId}'s leader holds the castle`;
  }
  // Knight Purple entry: the knight enters the castle and, if the foe lives, attacks it.
  if (state.foe && !state.foe.defeated) return battleFoe(state, p, move.battleTotal);
  return `${p.playerId}'s ${unit} entered the castle`;
}

function resolveTreatPlay(state: SweetlandsState, p: PlayerState, treat: TreatId, move: Extract<SweetlandsMove, { type: 'play_intel' }>): string {
  // Determine the slot the treat sits in. Cheesecake may move to ANY treat slot.
  const slot = findTreatSlot(state, p, treat, move);
  if (!slot) throw new GameError('ILLEGAL_MOVE', `Cannot resolve a slot for treat ${treat}`);
  p.units[move.unit] = { zone: 'treat', region: slot.region, slotKind: slot.slotKind };
  if (p.turn.step !== undefined && !p.turn.unlimitedPlays) p.turn.step = 'influence';
  return `${p.playerId} used the ${treat} treat to move ${move.unit} to its special location (region ${slot.region})`;
}

function findTreatSlot(state: SweetlandsState, p: PlayerState, treat: TreatId, move: Extract<SweetlandsMove, { type: 'play_intel' }>): { region: RegionId; slotKind: 'regional' | 'random' } | null {
  // CHEESECAKE ONLY: a treat card may be played to ANY treat slot. Every other
  // faction must move to the slot that holds THIS treat.
  if (move.treatRegion && move.treatSlot) {
    if (p.faction !== 'cheesecake') throw new GameError('ILLEGAL_MOVE', 'Only Grand Vizier Cheesecake may move to an arbitrary treat location');
    return { region: move.treatRegion, slotKind: move.treatSlot };
  }
  // regional treats sit in their faction's region
  for (const r of [1, 2, 3, 4] as RegionId[]) if (REGION_TREAT[r] === treat) return { region: r, slotKind: 'regional' };
  // random treats: find the region whose random slot holds this treat
  for (const r of [1, 2, 3, 4] as RegionId[]) if (state.randomTreatPlacement[r] === treat) return { region: r, slotKind: 'random' };
  return null;
}

function doPlayToken(state: SweetlandsState, playerId: string, move: Extract<SweetlandsMove, { type: 'play_token' }>): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play' || p.turn.step !== 'play') throw new GameError('ILLEGAL_MOVE', 'Not the play step');
  if (!p.intelTokens[move.color]) throw new GameError('ILLEGAL_MOVE', `You do not own a ${move.color} Intel token`);
  // A token is spent like a single Intel card of its color, then returns to supply.
  delete p.intelTokens[move.color];
  const r = resolveColorPlay(state, p, move.color, move);
  const endsPlayStep = !r.keepPlaying && !p.turn.unlimitedPlays;
  if (endsPlayStep && !state.pending) p.turn.step = 'influence';
  scoreSecretObjectives(state, p);
  return `${playerId} spent a ${move.color} Intel token — ${r.summary}.`;
}

function doPass(state: SweetlandsState, playerId: string): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play') throw new GameError('ILLEGAL_MOVE', 'Cannot pass now');
  // Pass to gain +1 influence; ends the turn.
  gainInfluence(p, 1);
  const summary = `${playerId} passed and gained 1 influence.`;
  endTurnInternal(state);
  return summary;
}

function doDiscardForColor(state: SweetlandsState, playerId: string, cardIds: string[], color: SpaceColor): string {
  const p = requireActive(state, playerId);
  const need = isNomads(p.faction) ? 4 : (p.faction === 'fudge' ? 2 : 4);
  if (cardIds.length !== need) throw new GameError('ILLEGAL_MOVE', `Discard exactly ${need} Intel to convert`);
  removeCards(state, p, cardIds);
  p.turn.intelDiscardedThisTurn += need;
  p.progress.intelDiscardedTotal += need;
  // Take a single card of the chosen color from the deck (conserves the 80-card
  // deck — the 4 discarded go to the discard pile, this one comes from the deck).
  const pick = takeColorFromDeck(state, color);
  p.hand.push(pick);
  return `${playerId} discarded ${need} Intel and took a ${color} Intel.`;
}

function doDiscardSugar(state: SweetlandsState, playerId: string, count: number): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play') throw new GameError('ILLEGAL_MOVE', 'Cannot discard sugar now');
  if (!Number.isInteger(count) || count <= 0) throw new GameError('ILLEGAL_MOVE', 'Discard a positive number of sugar cubes');
  if (p.sugarCubes < count) throw new GameError('ILLEGAL_MOVE', `Only have ${p.sugarCubes} sugar cubes`);
  p.sugarCubes -= count;
  p.turn.sugarDiscardedThisTurn += count;
  p.progress.sugarDiscardedTotal += count;
  scoreSecretObjectives(state, p);
  return `${playerId} discarded ${count} sugar cube(s).`;
}

function doTrashInfluence(state: SweetlandsState, playerId: string, count: number): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play') throw new GameError('ILLEGAL_MOVE', 'Cannot trash influence now');
  if (!Number.isInteger(count) || count <= 0) throw new GameError('ILLEGAL_MOVE', 'Trash a positive amount of influence');
  if (p.influence < count) throw new GameError('ILLEGAL_MOVE', `Only have ${p.influence} influence`);
  p.influence -= count;
  p.progress.influenceTrashedTotal += count;
  scoreSecretObjectives(state, p);
  return `${playerId} trashed ${count} influence.`;
}

function doTrade(state: SweetlandsState, playerId: string, move: Extract<SweetlandsMove, { type: 'trade' }>): string {
  const me = requireActive(state, playerId);
  if (state.phase !== 'play') throw new GameError('ILLEGAL_MOVE', 'Trades happen during your turn');
  const them = findPlayer(state, move.withPlayerId);
  if (them.playerId === me.playerId) throw new GameError('ILLEGAL_MOVE', 'Cannot trade with yourself');
  // Validate both sides can deliver (physical-first: the table agreed; we just record + check).
  assertCanGive(me, move.giveInfluence, move.giveSugar, move.giveIntelCardIds, move.giveTokens);
  assertCanGive(them, move.receiveInfluence, move.receiveSugar, move.receiveIntelCardIds, move.receiveTokens);
  transfer(me, them, move.giveInfluence, move.giveSugar, move.giveIntelCardIds, move.giveTokens);
  transfer(them, me, move.receiveInfluence, move.receiveSugar, move.receiveIntelCardIds, move.receiveTokens);
  for (const sw of move.swapUnits ?? []) {
    const tmp = me.units[sw.mine]; me.units[sw.mine] = them.units[sw.theirs]; them.units[sw.theirs] = tmp;
  }
  me.influence = Math.min(INFLUENCE_CAP, me.influence); them.influence = Math.min(INFLUENCE_CAP, them.influence);
  me.turn.tradedThisTurn = true;
  return `${playerId} traded with ${them.playerId}.`;
}

function assertCanGive(p: PlayerState, inf?: number, sugar?: number, cardIds?: string[], tokens?: SpaceColor[]): void {
  if (inf && p.influence < inf) throw new GameError('ILLEGAL_MOVE', `${p.playerId} lacks ${inf} influence`);
  if (sugar && p.sugarCubes < sugar) throw new GameError('ILLEGAL_MOVE', `${p.playerId} lacks ${sugar} sugar`);
  for (const id of cardIds ?? []) if (!p.hand.some((c) => c.cardId === id)) throw new GameError('ILLEGAL_MOVE', `${p.playerId} does not hold Intel ${id}`);
  for (const t of tokens ?? []) if (!p.intelTokens[t]) throw new GameError('ILLEGAL_MOVE', `${p.playerId} has no ${t} token`);
}

function transfer(from: PlayerState, to: PlayerState, inf?: number, sugar?: number, cardIds?: string[], tokens?: SpaceColor[]): void {
  if (inf) { from.influence -= inf; to.influence += inf; }
  if (sugar) { from.sugarCubes -= sugar; to.sugarCubes += sugar; }
  for (const id of cardIds ?? []) {
    const idx = from.hand.findIndex((c) => c.cardId === id);
    if (idx >= 0) to.hand.push(from.hand.splice(idx, 1)[0]!);
  }
  for (const t of tokens ?? []) { delete from.intelTokens[t]; to.intelTokens[t] = true; }
}

/** Intel token supply: 4 of each color (24 total). Tokens are only ever bought
 *  (and traded between players), never returned, so the remaining supply of a
 *  color = 4 − the number of players currently holding it. */
export const TOKENS_PER_COLOR = 4;
function tokensOwnedOfColor(state: SweetlandsState, color: SpaceColor): number {
  return state.players.filter((p) => p.intelTokens[color]).length;
}

function doBuyToken(state: SweetlandsState, playerId: string, color: SpaceColor): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play' || p.turn.step !== 'influence') throw new GameError('ILLEGAL_MOVE', 'Buy tokens in the influence phase');
  if (p.intelTokens[color]) throw new GameError('ILLEGAL_MOVE', `Already own a ${color} token`);
  if (tokensOwnedOfColor(state, color) >= TOKENS_PER_COLOR) throw new GameError('ILLEGAL_MOVE', `No ${color} Intel tokens left in the supply (only ${TOKENS_PER_COLOR} exist)`);
  if (p.influence < 1) throw new GameError('ILLEGAL_MOVE', 'Not enough influence');
  spendInfluence(p, 1);
  p.intelTokens[color] = true;
  return `${playerId} bought a ${color} Intel token.`;
}

/** Sugar cubes are a shared bank of 30 (designer-confirmed hard supply). Cubes only
 *  move between players and the bank (battles ROLL them; discards RETURN them), so
 *  the bank remaining = 30 − total held by players; no state field is needed. */
export const SUGAR_SUPPLY = 30;
function totalSugarHeld(state: SweetlandsState): number {
  return state.players.reduce((n, p) => n + p.sugarCubes, 0);
}

function doBuySugar(state: SweetlandsState, playerId: string): string {
  const p = requireActive(state, playerId);
  if (state.phase !== 'play' || p.turn.step !== 'influence') throw new GameError('ILLEGAL_MOVE', 'Buy sugar in the influence phase');
  if (p.influence < 3) throw new GameError('ILLEGAL_MOVE', 'Sugar costs 3 influence');
  if (totalSugarHeld(state) >= SUGAR_SUPPLY) throw new GameError('ILLEGAL_MOVE', `No sugar cubes left in the supply (only ${SUGAR_SUPPLY} exist)`);
  spendInfluence(p, 3);
  p.sugarCubes += 1;
  return `${playerId} bought a sugar cube for 3 influence.`;
}

function doEndTurn(state: SweetlandsState, playerId: string): string {
  requireActive(state, playerId);
  endTurnInternal(state);
  return `${playerId} ended their turn.`;
}

function endTurnInternal(state: SweetlandsState): void {
  scoreSecretObjectives(state, activePlayer(state));
  advanceToNextPlayer(state);
}

// ---------------------------------------------------------------------------
// Resource helpers
// ---------------------------------------------------------------------------

export function gainInfluence(p: PlayerState, n: number): void {
  p.influence = Math.min(INFLUENCE_CAP, p.influence + n);
  p.turn.influenceGainedThisTurn += n;
}

/** Spend influence ON something (buy/raise). Does NOT count toward the trash objective. */
function spendInfluence(p: PlayerState, n: number): void {
  p.influence -= n;
  p.turn.influenceSpentThisTurn += n;
}

function removeCards(state: SweetlandsState, p: PlayerState, cardIds: string[]): void {
  for (const id of cardIds) {
    const idx = p.hand.findIndex((c) => c.cardId === id);
    if (idx < 0) throw new GameError('ILLEGAL_MOVE', `Card ${id} not in hand`);
    const [c] = p.hand.splice(idx, 1);
    state.intelDiscard.push(c!);
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Degenerate-game backstop: real games end at 5 points well before this; the cap
 *  guarantees an all-AI harness game terminates. Flagged in PORT-NOTES. */
export const ROUND_CAP = 60;

/** Single owner of castleOccupantId/castleHeldSinceRound. A player holds the
 *  castle only while their leader is IN the castle node, the foe is defeated,
 *  and no other player's unit is there (rules-freeze §6 "uncontested"). The
 *  leader leaving by ANY path (recall, movement, capture, tax send-home, unit
 *  swap) or an intruding unit clears the claim; re-establishing it restarts
 *  the "uncontested for 1 round" clock. Runs after every move and again just
 *  before scoring, because scoring fires mid-dispatch at the round wrap. */
export function syncCastleClaim(state: SweetlandsState): void {
  const leadersIn = state.players.filter((p) => p.units.leader.zone === 'castle');
  const foeAlive = state.foe != null && !state.foe.defeated;
  let holder: PlayerState | null = null;
  if (!foeAlive && leadersIn.length === 1) {
    const h = leadersIn[0]!;
    const intruded = state.players.some((o) => o.playerId !== h.playerId && UNIT_TYPES.some((u) => o.units[u].zone === 'castle'));
    if (!intruded) holder = h;
  }
  if (holder == null) {
    state.castleOccupantId = null;
    state.castleHeldSinceRound = null;
  } else if (state.castleOccupantId !== holder.playerId) {
    state.castleOccupantId = holder.playerId;
    state.castleHeldSinceRound = state.round;
  }
}

function runScoringPhase(state: SweetlandsState): void {
  syncCastleClaim(state);
  // End-of-round public objectives are evaluated in turn order.
  for (const p of turnOrder(state)) {
    if (state.phase === 'game_over') break;
    evaluateStatePublics(state, p);
  }
  // New first player = most sugar cubes (ties: roll-off).
  pickNewFirstPlayer(state);
  if (state.round >= ROUND_CAP) state.phase = 'game_over';
}

function turnOrder(state: SweetlandsState): PlayerState[] {
  const n = state.players.length;
  return Array.from({ length: n }, (_, i) => state.players[(state.firstPlayerIndex + i) % n]!);
}

function addPoints(state: SweetlandsState, p: PlayerState, n: number): void {
  p.points += n;
  if (p.points >= POINTS_TO_WIN) state.phase = 'game_over';
}

function scorePublic(state: SweetlandsState, p: PlayerState, id: PlayerState['publicObjectivesScored'][number]): void {
  if (p.publicObjectivesScored.includes(id)) return;
  p.publicObjectivesScored.push(id);
  addPoints(state, p, PUBLIC_OBJECTIVES.find((o) => o.id === id)!.points);
}

/** Opposing regions = every region but the player's home (all 4 for Nomads). */
function opposingRegions(p: PlayerState): RegionId[] {
  const all: RegionId[] = [1, 2, 3, 4];
  return p.homeRegion == null ? all : all.filter((r) => r !== p.homeRegion);
}

function evaluateStatePublics(state: SweetlandsState, p: PlayerState): void {
  if (isNomads(p.faction)) {
    // Nomads have no home region, so "a unit in each opposing region" can't apply
    // (3 units, 4 regions). Instead — as the wandering faction — they satisfy the
    // area-control objectives by getting ALL their units onto the qualifying space
    // type (designer ruling: Nomads achieve these MORE easily).
    const colors = UNIT_TYPES.map((u) => colorOf(p.units[u]));
    if (colors.every((c) => c != null) && new Set(colors).size === 1) scorePublic(state, p, 'units_all_matching_color');
    if (UNIT_TYPES.every((u) => p.units[u].zone === 'treat')) scorePublic(state, p, 'units_all_treats');
  } else {
    const regs = opposingRegions(p);
    // units_all_matching_color: a unit in each opposing region, all on same-color spaces
    {
      const colors: (SpaceColor | null)[] = regs.map((r) => {
        const u = UNIT_TYPES.find((ut) => regionOf(p.units[ut]) === r && colorOf(p.units[ut]) != null);
        return u ? colorOf(p.units[u]) : undefined as unknown as null;
      });
      if (colors.every((c) => c != null) && new Set(colors).size === 1 && regs.length > 0) {
        scorePublic(state, p, 'units_all_matching_color');
      }
    }
    // units_all_treats: a unit in each opposing region, all on treat spaces
    {
      const ok = regs.length > 0 && regs.every((r) => UNIT_TYPES.some((ut) => regionOf(p.units[ut]) === r && p.units[ut].zone === 'treat'));
      if (ok) scorePublic(state, p, 'units_all_treats');
    }
  }
  // leader in castle, uncontested for a full round
  if (state.castleOccupantId === p.playerId && state.castleHeldSinceRound != null && state.round > state.castleHeldSinceRound) {
    scorePublic(state, p, 'leader_castle_uncontested');
  }
}

function pickNewFirstPlayer(state: SweetlandsState): void {
  let best = -1; const tied: number[] = [];
  state.players.forEach((p, i) => {
    if (p.sugarCubes > best) { best = p.sugarCubes; tied.length = 0; tied.push(i); }
    else if (p.sugarCubes === best) tied.push(i);
  });
  let pick = tied[0]!;
  if (tied.length > 1) {
    // roll-off
    const r = rollDice(1, state.seed); state.seed = r.nextSeed;
    pick = tied[r.faces[0]! % tied.length]!;
  }
  state.firstPlayerIndex = pick;
}

/** Immediate secret-objective scoring — checked after each play and at turn end
 *  (turn-flag objectives are read before the next turn resets them). */
function scoreSecretObjectives(state: SweetlandsState, p: PlayerState): void {
  p.secretObjectivesScored ??= [];
  for (const id of p.secretObjectives) {
    if (p.secretObjectivesScored.includes(id)) continue;
    if (secretMet(p, id)) {
      p.secretObjectivesScored.push(id);
      addPoints(state, p, SECRET_OBJECTIVE_POINTS);
    }
  }
}

function secretMet(p: PlayerState, id: SecretObjectiveId): boolean {
  switch (id) {
    case 'defeat_knight': return p.progress.defeatedKnight;
    case 'capture_leader': return p.progress.capturedLeader;
    case 'capture_ambassador': return p.progress.capturedAmbassador;
    case 'raise_taxes_3': return p.progress.raisedTaxToThree;
    case 'spend_5_influence': return p.progress.influenceTrashedTotal >= 5;
    case 'discard_5_intel': return p.progress.intelDiscardedTotal >= 5;
    case 'gain_5_intel_one_turn': return p.turn.intelGainedThisTurn >= 5;
    case 'collect_taxes_from_opponent': return p.progress.collectedTaxFromOpponent;
    case 'collect_5_influence_one_turn': return p.turn.influenceGainedThisTurn >= 5;
    case 'unit_through_3_regions': return Object.values(p.turn.unitRegionsVisited).some((rs) => (rs?.length ?? 0) >= 3);
    case 'discard_5_sugar': return p.progress.sugarDiscardedTotal >= 5;
    case 'enter_castle_with_leader': return p.progress.enteredCastleWithLeader;
  }
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------

export function checkGameOver(state: SweetlandsState): { game_over: boolean; winners: string[]; scores: Record<string, number>; summary: string } {
  const scores: Record<string, number> = {};
  for (const p of state.players) scores[p.playerId] = p.points;
  if (state.phase !== 'game_over') return { game_over: false, winners: [], scores, summary: '' };
  // Winner = most points; ties broken by sugar cubes then influence (the game's own
  // sugar tiebreaker), so a co-win requires an exact tie on all three.
  const rank = (p: PlayerState): number => p.points * 1_000_000 + p.sugarCubes * 1_000 + p.influence;
  const best = Math.max(...state.players.map(rank));
  const winners = state.players.filter((p) => rank(p) === best).map((p) => p.playerId);
  const top = state.players.find((p) => p.playerId === winners[0])!;
  const how = top.points >= POINTS_TO_WIN ? `reached ${POINTS_TO_WIN} points` : `led on points (round cap)`;
  return { game_over: true, winners, scores, summary: `${winners.join(', ')} ${how}.` };
}
