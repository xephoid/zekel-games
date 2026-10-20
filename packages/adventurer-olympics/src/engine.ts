// Adventurer Olympics — engine core: state, turn order, movement, explore,
// icon resolution, quests, and the ending sequence.
//
// Faithful to src/games/adventurer-olympics/RULES.md (2026-09-27). No engine
// shortcuts that change rule behavior. The TILE-GEOMETRY mirror convention is
// pinned to the no-overlap/nestle snap (see hexMap.ts; Zeke confirmed
// 2026-09-29 that physical tiles never overlap).

import { GameError } from '@zekel/game-kit';
import { seatDisplayName } from '@zekel/game-kit';
import {
  OLD_QUEST_NAMES,
  COMPANION_CARDS,
  LITTLE_MONSTER_CARDS,
  BIG_MONSTER_CARDS,
  DUNGEON_COMPOSITION,
  DUNGEON_KIND_NAMES,
  SUIT_ARTIFACTS,
  QUESTS,
  TILES,
  STARTING_STATS,
} from './data.js';
import {
  hexKey,
  neighbors,
  keyToHex,
  localHexAbsolute,
  tileCenter,
  tileHexes,
  slotHexes,
  sideLabelOf,
  iconHexesForTile,
  hexDistance,
  hexLabelOf,
  rotationLabel,
} from './hexMap.js';
import type {
  AOState,
  PlayerState,
  PlacedTile,
  IconHex,
  GameLogEntryLocal,
} from './types.js';
import type { ArtifactId, DungeonCardKind, StatKey, HexName } from './data.js';
import type { PlayerConfig } from '@zekel/game-kit';

// ---------------------------------------------------------------------------
// Seeded RNG (deterministic per session) — mulberry32, same family as the
// repo's other rng.ts.
// ---------------------------------------------------------------------------
export function makeRng(seed: number) {
  let a = seed >>> 0;
  return {
    next(): number {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxExclusive: number): number {
      return Math.floor(this.next() * maxExclusive);
    },
  };
}

type Rng = ReturnType<typeof makeRng>;

function player(state: AOState, pid: string): PlayerState {
  const p = state.players[pid];
  if (!p) throw new GameError('PLAYER_NOT_FOUND', `unknown seat ${pid}`);
  return p;
}

/** Do this seat's draws come from the server's deck order? Deck ownership is
 *  TABLE-WIDE, not per seat: the decks are one shared pile, so once a physical
 *  human is at the table the real cards are shuffled by hand and the server
 *  does not know their order — for anyone, the AI included (REVIEW-r4 #1: the
 *  pre-fix check let an AI draw from the server's unrelated shuffle while the
 *  human drew from the real deck). `pid` is kept so callers read naturally. */
export function isServerServed(state: AOState, _pid: string): boolean {
  return state.serverOwnsDecks;
}

/** Who reports a draw made by `seat` at a table with real decks: the seat
 *  itself if it is a physical human, otherwise the first physical human, who
 *  draws the card from the real deck on that seat's behalf. */
function drawReporter(state: AOState, seat: string): string {
  const p = player(state, seat);
  if (p.kind === 'human' && p.table !== 'digital') return seat;
  return firstPhysicalHuman(state);
}

/** Open a report of a real draw made by `seat`. The pending belongs to the
 *  human who reports it; `forSeat` records whose draw it is, and play goes
 *  back to that seat once the card is known. */
function openDrawReport(state: AOState, seat: string, payload: Record<string, unknown>): void {
  const reporter = drawReporter(state, seat);
  state.pending = { kind: 'report_card', seat: reporter, payload: { ...payload, forSeat: seat } };
}

/** What a draw is for: the deck, and where play goes once the card is known
 *  (the same payload a real-cards report carries, less `forSeat`). */
export interface DrawPayload {
  deck: 'companion' | 'little' | 'big' | 'dungeon' | 'tile';
  iconKey?: string;
  test?: TestKind;
  dungeon?: true;
  fightsLeft?: number;
  context?: ExploreContext;
}

/** Every draw from a face-down deck or the tile stack goes through here.
 *  - Real cards at the table: the draw is reported (`report_card`).
 *  - Server-owned decks, a digital human's draw: a `draw` pending that only
 *    the Draw button (`resolve_report`) settles — never a silent deal
 *    (docs/digital-mode.md "Randomness is server-owned, but only on a button").
 *  - Server-owned decks, an AI's draw: the server deals it at once. */
function openDraw(state: AOState, seat: string, payload: DrawPayload): void {
  if (!isServerServed(state, seat)) {
    openDrawReport(state, seat, { ...payload });
    return;
  }
  if (player(state, seat).kind === 'human') {
    state.pending = { kind: 'draw', seat, payload: { ...payload } };
    return;
  }
  completeDraw(state, seat, payload);
}

/** Server-owned decks: take the real top card (or tile) and carry on exactly
 *  as a report of that card would. */
function completeDraw(state: AOState, seat: string, payload: DrawPayload): void {
  if (payload.deck === 'tile') {
    const tileId = state.tileStack[0]!;
    log(state, (payload.context ?? 'ordinary') === 'ordinary'
      ? `${nameOf(state, seat)} explores and turns over the top map tile: Tile ${tileId}.`
      : `${nameOf(state, seat)} turns over the top map tile: Tile ${tileId}.`, 'explore', seat);
    state.pending = {
      kind: 'explore_place', seat,
      payload: { tileId, context: payload.context ?? 'ordinary', iconKey: payload.iconKey },
    };
    return;
  }
  const icon = state.iconHexes.find((h) => h.key === payload.iconKey)!;
  if (payload.deck === 'dungeon') {
    openDungeonCard(state, seat, icon, state.decks.dungeon[0]!);
    return;
  }
  const cardId = state.decks[payload.deck][0]!;
  if (payload.dungeon) {
    openDungeonTestRoll(state, seat, icon, payload.test!, cardId, payload.fightsLeft);
  } else {
    openTestRoll(state, seat, icon, payload.test!, cardId, {});
  }
}

/** The Draw button: a digital human reveals the draw they owe. */
export function applyDraw(state: AOState, seat: string): void {
  const p = state.pending;
  if (p?.kind !== 'draw' || p.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'you have no draw to make');
  completeDraw(state, seat, p.payload as unknown as DrawPayload);
}

// ---------------------------------------------------------------------------
// Log helper
// ---------------------------------------------------------------------------
function log(state: AOState, summary: string, phase?: string, playerId?: string | null, deltas?: Record<string, number>) {
  state.log.push({
    seq: state.log.length + 1,
    turn: state.round,
    phase,
    playerId: playerId ?? null,
    summary,
    deltas,
  });
}

/** A log line that changes the table at a glance (a tile placed, an icon
 *  completed, a card kept or sent under its deck, a rune taken, a quest
 *  claimed, the turn order, the ending): a client may show these alone. */
function headline(state: AOState, summary: string, phase?: string, playerId?: string | null) {
  log(state, summary, phase, playerId);
  state.log[state.log.length - 1]!.headline = true;
}

// ---------------------------------------------------------------------------
// Shuffle
// ---------------------------------------------------------------------------
function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

function buildDecks(rng: Rng): { decks: AOState['decks']; tileStack: number[]; quests: string[] } {
  const companion = shuffle(COMPANION_CARDS.map((c) => c.id), rng);
  const little = shuffle(LITTLE_MONSTER_CARDS.map((c) => c.id), rng);
  const big = shuffle(BIG_MONSTER_CARDS.map((c) => c.id), rng);
  const dungeon: DungeonCardKind[] = [];
  for (const [kind, n] of Object.entries(DUNGEON_COMPOSITION)) {
    for (let i = 0; i < n; i++) dungeon.push(kind as DungeonCardKind);
  }
  const tiles = shuffle(TILES.map((t) => t.id), rng);
  const quests = shuffle(QUESTS.map((q) => q.kind), rng);
  return { decks: { companion, little, big, dungeon: shuffle(dungeon, rng) }, tileStack: tiles, quests };
}

// ---------------------------------------------------------------------------
// createInitialState — setup (RULES.md §2)
// ---------------------------------------------------------------------------
export function createAOState(players: PlayerConfig[], seed: number): AOState {
  const rng = makeRng(seed);
  const { decks, tileStack, quests } = buildDecks(rng);
  const serverOwnsDecks = players.every((p) => p.kind === 'ai' || p.table === 'digital');
  const state: AOState = {
    players: {},
    playerOrder: players.map((p) => p.player_id),
    placedTiles: [],
    iconHexes: [],
    hexes: {},
    decks,
    tileStack,
    serverOwnsDecks,
    inPlayQuests: {},
    questBoxRemaining: QUESTS.length,
    round: 0,
    activeSeat: setupPickOrder(players)[0]!,
    endingPhase: 0,
    gameOver: false,
    drawStack: [],
    baseTotals: {},
    groupTotals: {},
    tieBand: null,
    rankGroups: [],
    turnOrder: {},
    pending: { kind: 'setup_standee_colour', seat: setupPickOrder(players)[0]! },
    dungeonResolving: null,
    log: [],
    rngSeed: seed,
    rngState: seed >>> 0,
  };

  for (const p of players) {
    state.players[p.player_id] = {
      player_id: p.player_id,
      name: p.name ?? p.player_id,
      kind: p.kind,
      table: p.table,
      standee: '',
      colour: '',
      companions: [],
      littleMonsters: [],
      bigMonsters: [],
      artifacts: [],
      questPoints: 0,
      claimedQuests: [],
      exploredTileIds: [],
      dungeonsCompleted: 0,
      tokensSpent: 0,
      stepsLeft: STARTING_STATS.movement,
      hexKey: '',
      initiative: 0,
    };
  }

  // Stash the setup draw orders. At an all-digital table these are the real
  // seeded shuffles; with a physical human the human reports the drawn quests
  // and the starting tile before setup can finish (R1: the server must never
  // assert the identity of a draw a physical deck hasn't revealed).
  (state as { setupQuestOrder?: string[] }).setupQuestOrder = quests;

  log(state, 'Setup: each player chooses an Adventurer standee and a colour.', 'setup');
  return state;
}

// ---------------------------------------------------------------------------
// Standee + colour picks (RULES.md §2.3). The four colours are printed on the
// token sets; the four standees have no printed names, so a standee is
// whatever the player calls their figure ("Standee 2" by default). Humans pick
// first, in seat order, then the AI seats take what is left — an AI never
// takes an option before every human has chosen. No two seats may share a
// colour or a standee.
// ---------------------------------------------------------------------------
export const PLAYER_COLOURS = ['Red', 'Blue', 'Yellow', 'Purple'] as const;

function setupPickOrder(players: { player_id: string; kind: string }[]): string[] {
  return [
    ...players.filter((p) => p.kind !== 'ai').map((p) => p.player_id),
    ...players.filter((p) => p.kind === 'ai').map((p) => p.player_id),
  ];
}

/** Colours no seat has taken yet, in printed order. */
export function availableColours(state: AOState): string[] {
  const taken = new Set(state.playerOrder.map((pid) => player(state, pid).colour.toLowerCase()));
  return PLAYER_COLOURS.filter((c) => !taken.has(c.toLowerCase()));
}

/** The first "Standee N" label no seat is using — the default name. */
export function nextFreeStandee(state: AOState): string {
  const taken = new Set(state.playerOrder.map((pid) => player(state, pid).standee.toLowerCase()));
  for (let i = 1; i <= 4; i++) if (!taken.has(`standee ${i}`)) return `Standee ${i}`;
  return `Standee ${state.playerOrder.length}`;
}

/** Record one seat's standee + colour pick. Validates everything before any
 *  change; finishes the pick phase once every seat has picked. Returns the
 *  resolved standee and colour. */
export function applySetupPick(state: AOState, seat: string, standeeIn: unknown, colourIn: unknown): { standee: string; colour: string } {
  if (state.pending?.kind !== 'setup_standee_colour') {
    throw new GameError('ILLEGAL_MOVE', 'setup is over — you cannot pick a standee now');
  }
  if (state.pending.seat !== seat) {
    throw new GameError('ILLEGAL_MOVE', 'it is not your turn to pick a standee');
  }
  const free = availableColours(state);
  const want = typeof colourIn === 'string' ? colourIn.trim().toLowerCase() : '';
  const colour = PLAYER_COLOURS.find((c) => c.toLowerCase() === want);
  if (!colour) {
    throw new GameError('ILLEGAL_MOVE', `choose one of the printed colours still free: ${free.join(', ')}`);
  }
  if (!free.includes(colour)) {
    throw new GameError('ILLEGAL_MOVE', `${colour} is already taken — the colours still free are: ${free.join(', ')}`);
  }
  const standee = (typeof standeeIn === 'string' && standeeIn.trim()) ? standeeIn.trim() : nextFreeStandee(state);
  const clash = state.playerOrder.find((pid) => pid !== seat && player(state, pid).standee.toLowerCase() === standee.toLowerCase());
  if (clash) {
    throw new GameError('ILLEGAL_MOVE', `${nameOf(state, clash)} already has the standee "${standee}" — pick a different figure`);
  }
  player(state, seat).standee = standee;
  player(state, seat).colour = colour;
  const next = setupPickOrder(state.playerOrder.map((pid) => player(state, pid)))
    .find((pid) => !player(state, pid).standee);
  if (next) {
    state.pending = { kind: 'setup_standee_colour', seat: next };
    state.activeSeat = next;
  } else {
    finishSetup(state);
  }
  return { standee, colour };
}

// ---------------------------------------------------------------------------
// Finish setup (R1): at an all-digital table the server draws quests + the
// starting tile from its seeded orders and finishes immediately. With ANY
// physical human at the table, finishSetup opens a report pending instead —
// the human reports the quest cards drawn and the tile flipped, and only then
// is setup complete (applySetupReport, called from the dispatcher).
// ---------------------------------------------------------------------------
export function finishSetup(state: AOState): void {
  const setupQuestOrder = ((state as { setupQuestOrder?: string[] }).setupQuestOrder ?? QUESTS.map((q) => q.kind));
  delete (state as { setupQuestOrder?: string[] }).setupQuestOrder;
  const questsInPlay = state.playerOrder.length + 1;

  if (state.serverOwnsDecks) {
    // All-digital / all-AI: the server's seeded order IS the draw.
    for (const kind of setupQuestOrder.slice(0, questsInPlay)) {
      state.inPlayQuests[kind] = 'unclaimed';
    }
    state.questBoxRemaining = QUESTS.length - questsInPlay;
    log(state, `Setup: ${questsInPlay} quest cards are face up in play (${setupQuestOrder.slice(0, questsInPlay).map((k) => questName(k)).join(', ')}).`, 'setup');
    const startingTileId = state.tileStack.shift()!;
    placeTileOnMap(state, startingTileId, '0,0', 0, null);
    log(state, `Setup: the starting tile (Tile ${startingTileId}) is placed; all standees begin on its centre hex.`, 'setup');
    for (const pid of state.playerOrder) player(state, pid).hexKey = '0,0';
    beginRollPhase(state);
    return;
  }

  // Physical table present: the human reports the drawn quests + starting tile.
  const reporter = firstPhysicalHuman(state);
  state.pending = {
    kind: 'setup_explore_report', seat: reporter,
    payload: { questsExpected: questsInPlay },
  };
  log(state, `Setup: ${nameOf(state, reporter)} draws ${questsInPlay} quest cards and flips the top map tile — report them.`, 'setup');
}

function firstPhysicalHuman(state: AOState): string {
  for (const pid of state.playerOrder) {
    const p = player(state, pid);
    if (p.kind === 'human' && p.table !== 'digital') return pid;
  }
  return state.playerOrder[0]!;
}

function questName(kind: string): string {
  return QUESTS.find((q) => q.kind === kind)?.name ?? kind;
}

/** The physical setup report: the drawn quest kinds + the starting tile
 *  number. Only legal while the setup report is pending and owed to `seat`. */
/** What is still owed in the physical setup report. */
export function setupReportOwed(state: AOState): { questsLeft: number; tileOwed: boolean; reportedQuests: string[]; reportedTile: number | null } {
  const payload = state.pending?.payload ?? {};
  const expected = (payload.questsExpected as number) ?? state.playerOrder.length + 1;
  const reportedQuests = (payload.reportedQuests as string[] | undefined) ?? [];
  const reportedTile = (payload.reportedTile as number | undefined) ?? null;
  return { questsLeft: expected - reportedQuests.length, tileOwed: reportedTile === null, reportedQuests, reportedTile };
}

/** The physical setup report: the drawn quest cards and the starting tile.
 *  May arrive all at once or in pieces (one quest card, or just the tile) —
 *  the pieces collect in the pending until everything is known, then setup
 *  finishes. Every piece is validated in full before anything is recorded, so
 *  a rejected report changes nothing. */
export function applySetupReport(state: AOState, seat: string, quests: string[] | undefined, tileId: number | undefined): void {
  const p = state.pending;
  if (p?.kind !== 'setup_explore_report' || p.seat !== seat) {
    throw new GameError('ILLEGAL_MOVE', 'no setup draw report pending for you');
  }
  const owed = setupReportOwed(state);
  const newQuests = quests ?? [];
  if (!Array.isArray(newQuests)) throw new GameError('ILLEGAL_MOVE', 'quests must be a list of quest card names');
  if (newQuests.length === 0 && tileId === undefined) {
    throw new GameError('ILLEGAL_MOVE', 'report a quest card you drew (its printed name, e.g. "Explore 3 tiles") or the starting tile you flipped (e.g. "Tile 4")');
  }
  if (newQuests.length > owed.questsLeft) {
    throw new GameError('ILLEGAL_MOVE', `only ${owed.questsLeft} more quest card${owed.questsLeft === 1 ? '' : 's'} to report — got ${newQuests.length}`);
  }
  const kinds: string[] = [];
  for (const q of newQuests) {
    const kind = resolveQuestName(String(q));
    if (!kind) throw new GameError('ILLEGAL_MOVE', `unknown quest "${q}" — name it as printed (${QUESTS.map((x) => x.name).join(', ')})`);
    if (kinds.includes(kind) || owed.reportedQuests.includes(kind)) {
      throw new GameError('ILLEGAL_MOVE', `"${q}" was already reported — each quest card is unique`);
    }
    kinds.push(kind);
  }
  if (tileId !== undefined) {
    if (!owed.tileOwed) throw new GameError('ILLEGAL_MOVE', `the starting tile was already reported (Tile ${owed.reportedTile})`);
    if (!state.tileStack.includes(tileId)) {
      throw new GameError('ILLEGAL_MOVE', `Tile ${tileId} is not in the stack — report the printed tile number you flipped`);
    }
  }
  const allQuests = [...owed.reportedQuests, ...kinds];
  const tile = tileId ?? owed.reportedTile;
  const left = owed.questsLeft - kinds.length;
  if (left > 0 || tile === null) {
    // Not complete yet: record this piece and say what is still owed.
    p.payload = { ...p.payload, reportedQuests: allQuests, reportedTile: tile ?? undefined };
    const parts = [
      ...(kinds.length ? [`quest card${kinds.length === 1 ? '' : 's'} ${kinds.map((k) => `"${questName(k)}"`).join(', ')}`] : []),
      ...(tileId !== undefined ? [`starting tile Tile ${tileId}`] : []),
    ];
    const still = [
      ...(left > 0 ? [`${left} more quest card${left === 1 ? '' : 's'}`] : []),
      ...(tile === null ? ['the starting tile'] : []),
    ];
    log(state, `Setup: recorded ${parts.join(' and ')}. Still to report: ${still.join(' and ')}.`, 'setup');
    return;
  }
  for (const kind of allQuests) state.inPlayQuests[kind] = 'unclaimed';
  state.questBoxRemaining = QUESTS.length - allQuests.length;
  state.tileStack = state.tileStack.filter((t) => t !== tile);
  placeTileOnMap(state, tile, '0,0', 0, null);
  for (const pid of state.playerOrder) player(state, pid).hexKey = '0,0';
  log(state, `Setup: quests in play — ${allQuests.map((k) => questName(k)).join(', ')}. Tile ${tile} is the starting tile, placed unturned; every standee starts on its centre hex.`, 'setup');
  beginRollPhase(state);
}

/** Resolve a printed quest name to its kind (case/punctuation tolerant). */
function resolveQuestName(name: string): string | null {
  const n = name.trim().toLowerCase();
  const hit = QUESTS.find((q) => q.name.toLowerCase() === n || q.kind === n);
  return hit?.kind ?? OLD_QUEST_NAMES[n] ?? null;
}

// ---------------------------------------------------------------------------
// Tile placement helper
// ---------------------------------------------------------------------------
function placeTileOnMap(state: AOState, tileId: number, centerKey: string, rotation: number, exploredBy: string | null): void {
  const { q, r } = keyToHex(centerKey);
  const placed: PlacedTile = { tileId, center: { q, r, key: centerKey }, rotation, isStarting: exploredBy === null, exploredBy };
  state.placedTiles.push(placed);
  for (const k of tileHexes(centerKey)) state.hexes[k] = true;
  const tileDef = TILES.find((t) => t.id === tileId)!;
  state.iconHexes.push(...iconHexesForTile(placed, tileDef));
}

// ---------------------------------------------------------------------------
// Turn order (RULES.md §4.1): every player rolls 2 dice; highest first; ties
// re-roll within their own rank band.
// ---------------------------------------------------------------------------
function beginRollPhase(state: AOState): void {
  // EVERY seat rolls again each round — the pre-fix engine kept last round's
  // entries in `turnOrder` and let round 2 start on one seat's roll.
  state.drawStack = [...state.playerOrder];
  state.baseTotals = {};
  state.groupTotals = {};
  state.tieBand = null;
  state.rankGroups = [];
  state.pending = { kind: 'roll', seat: state.drawStack[0]!, payload: { rollKind: 'turn_order', diceCount: 2 } };
  log(state, `${state.round === 0 ? 'Round 1' : 'Round complete'} — everyone rolls 2 dice for turn order.`, 'roll-order');
}

export function applyTurnOrderTotal(state: AOState, seat: string, total: number): void {
  if (state.pending?.kind !== 'roll' || state.pending.payload?.rollKind !== 'turn_order') {
    throw new GameError('ILLEGAL_MOVE', 'no turn-order roll pending');
  }
  if (state.pending.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your turn to roll');
  if (!Number.isInteger(total) || total < 2 || total > 12) {
    throw new GameError('ILLEGAL_MOVE', `turn-order total must be an integer from 2 to 12, got ${total}`);
  }
  log(state, `${nameOf(state, seat)} rolled ${total} for turn order.`, 'roll-order', seat);
  if (state.tieBand) {
    state.groupTotals[seat] = total;
  } else {
    state.baseTotals[seat] = total;
  }
  state.drawStack = state.drawStack.filter((s) => s !== seat);
  settleOrAdvance(state);
}

/** Rank bands: seats grouped by equal base totals, highest band first. */
function rankBands(state: AOState): string[][] {
  const totals = state.playerOrder.map((p) => state.baseTotals[p] ?? 0);
  const distinct = [...new Set(totals)].sort((a, b) => b - a);
  return distinct.map((v) => state.playerOrder.filter((p) => state.baseTotals[p] === v));
}

function settleOrAdvance(state: AOState): void {
  if (state.drawStack.length > 0) {
    state.pending = {
      kind: 'roll', seat: state.drawStack[0]!,
      payload: { rollKind: 'turn_order', diceCount: 2, band: state.tieBand ?? undefined },
    };
    return;
  }
  // The table's order is kept as an explicit ORDERED list of groups: a group
  // of one is a settled place, a group of several is still tied. A re-roll
  // only ever splits its own group in place, so a place that is already
  // settled never moves and every other tied group stays tied until it rolls.
  // (The pre-fix engine pinned places with fractional offsets on the totals;
  // offsets from different re-roll rounds overwrote each other and broke up
  // groups that had not rolled yet.)
  if (state.tieBand) {
    const band = state.tieBand;
    const groups = state.rankGroups?.length ? state.rankGroups : rankBands(state);
    const distinct = [...new Set(band.map((p) => state.groupTotals[p] ?? 0))].sort((a, b) => b - a);
    const subBands = distinct.map((v) => band.filter((p) => state.groupTotals[p] === v));
    const at = groups.findIndex((grp) => grp.length === band.length && grp.every((p) => band.includes(p)));
    state.rankGroups = at >= 0
      ? [...groups.slice(0, at), ...subBands, ...groups.slice(at + 1)]
      : groups;
    state.tieBand = null;
    state.groupTotals = {};
  } else {
    state.rankGroups = rankBands(state);
  }
  // The HIGHEST group still tied rolls next.
  const tied = state.rankGroups.find((grp) => grp.length > 1);
  if (tied) {
    state.tieBand = [...tied];
    state.groupTotals = {};
    state.drawStack = [...tied];
    log(state, `Tie — ${tied.map((p) => nameOf(state, p)).join(', ')} roll again to settle their places.`, 'roll-order');
    state.pending = { kind: 'roll', seat: state.drawStack[0]!, payload: { rollKind: 'turn_order', diceCount: 2, band: [...tied] } };
    return;
  }
  const order = state.rankGroups.flat();
  state.rankGroups = [];
  assignTurnOrder(state, order);
}

function assignTurnOrder(state: AOState, order: string[]): void {
  state.round += 1;
  order.forEach((p, i) => {
    player(state, p).initiative = i + 1;
    state.turnOrder[p] = i + 1;
  });
  state.tieBand = null;
  state.groupTotals = {};
  headline(state, `Turn order: ${order.map((p) => nameOf(state, p)).join(' → ')}.`, 'roll-order');
  beginTurn(state, order[0]!);
}

// ---------------------------------------------------------------------------
// Turn start / end (RULES.md §5)
// ---------------------------------------------------------------------------
function beginTurn(state: AOState, seat: string): void {
  state.activeSeat = seat;
  player(state, seat).stepsLeft = effectiveMovement(state, seat);
  // Forced explore (RULES.md §5.4): every icon completed → MUST explore first.
  const allIconsDone = state.iconHexes.length > 0 && state.iconHexes.every((h) => h.completed);
  if (allIconsDone && state.tileStack.length > 0) {
    startExplore(state, seat, 'forced', null);
    return;
  }
  // Standing on an uncompleted icon → may stay and try again (RULES.md §5.2).
  const onIcon = state.iconHexes.find((h) => h.key === player(state, seat).hexKey && !h.completed);
  if (onIcon) {
    state.pending = { kind: 'try_again', seat, payload: { iconKey: onIcon.key } };
    return;
  }
  state.pending = { kind: 'move', seat };
}

export function endTurn(state: AOState, seat: string): void {
  player(state, seat).stepsLeft = 0;
  const ordered = [...state.playerOrder].sort((a, b) => player(state, a).initiative - player(state, b).initiative);
  const i = ordered.indexOf(seat);
  if (i === ordered.length - 1) {
    // Full round complete.
    if (state.endingPhase === 1) {
      // The round the last tile was placed in is done; play ONE more full round.
      state.endingPhase = 2;
      headline(state, 'The current round is finished — one more full round begins.', 'ending');
    } else if (state.endingPhase === 2) {
      finishGame(state);
      return;
    }
    beginRollPhase(state);
    return;
  }
  beginTurn(state, ordered[i + 1]!);
}

function finishGame(state: AOState): void {
  for (const kind of QUESTS.filter((q) => q.endGame).map((q) => q.kind)) {
    awardEndgameQuest(state, kind, (s) => questProgress(state, s, kind));
  }
  state.gameOver = true;
  state.pending = null;
  headline(state, 'The game is over — quest points counted.', 'ending');
}

// ---------------------------------------------------------------------------
// Stats (RULES.md §7)
// ---------------------------------------------------------------------------
export function effectiveStat(state: AOState, seat: string, stat: StatKey): number {
  const base = STARTING_STATS[stat];
  let bonus = 0;
  for (const cid of player(state, seat).companions) {
    const card = COMPANION_CARDS.find((c) => c.id === cid);
    if (card?.bonus[stat]) bonus += card.bonus[stat]!;
  }
  return base + bonus;
}

function effectiveMovement(state: AOState, seat: string): number {
  return effectiveStat(state, seat, 'movement');
}

// ---------------------------------------------------------------------------
// Movement (RULES.md §5.1). One shared path walker serves both the ordinary
// `move` pending and walking away from a failed icon (`try_again`) — walking
// away is ordinary movement (RULES.md §5.1–5.2), so the mover chooses the
// route (never the engine), keeps unused steps, and triggers any icon landed
// on. The pre-fix `applyMoveAway` picked the first open neighbour itself and
// threw the rest of the turn away.
// ---------------------------------------------------------------------------
function walk(state: AOState, seat: string, path: string[], fromTryAgain: boolean): void {
  const me = player(state, seat);
  if (path.length === 0) {
    // Choose not to move (or stay put after declining to retry) — the turn is over.
    endTurn(state, seat);
    return;
  }
  if (path.length > me.stepsLeft) {
    throw new GameError('ILLEGAL_MOVE', `you can move at most ${me.stepsLeft} steps, not ${path.length}`);
  }
  let cur = me.hexKey;
  for (let i = 0; i < path.length; i++) {
    const target = path[i] as string;
    if (state.hexes[target] !== true) throw new GameError('ILLEGAL_MOVE', `${target} is not on the map`);
    if (!neighbors(cur).includes(target)) throw new GameError('ILLEGAL_MOVE', `${hexLabel(state, target)} is not next to ${hexLabel(state, cur)}`);
    const occupant = state.playerOrder.find((p) => p !== seat && player(state, p).hexKey === target);
    if (occupant) throw new GameError('ILLEGAL_MOVE', `${hexLabel(state, target)} is occupied by ${nameOf(state, occupant)} — go around`);
    const icon = state.iconHexes.find((h) => h.key === target);
    if (icon && !icon.completed) {
      // Uncompleted icon: stepping onto it triggers it; it is the LAST step.
      if (i !== path.length - 1) throw new GameError('ILLEGAL_MOVE', `you cannot pass through the uncompleted icon on ${hexLabel(state, target)}`);
      cur = target;
      me.hexKey = target;
      me.stepsLeft -= i + 1;
      log(state, `${nameOf(state, seat)} moves their standee to ${hexLabel(state, target)}.`, 'move', seat);
      resolveIcon(state, seat, icon);
      return; // turn ends after the icon resolves
    }
    cur = target;
  }
  me.hexKey = cur;
  me.stepsLeft -= path.length;
  log(state, `${nameOf(state, seat)} moves their standee to ${hexLabel(state, cur)}.`, 'move', seat);
  if (me.stepsLeft <= 0) {
    endTurn(state, seat);
  } else {
    state.pending = { kind: 'move', seat };
  }
}

export function applyMove(state: AOState, seat: string, path: string[]): void {
  if (state.pending?.kind !== 'move') throw new GameError('ILLEGAL_MOVE', 'not in the move phase');
  if (state.pending.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your move');
  walk(state, seat, path, false);
}

export function applyStop(state: AOState, seat: string): void {
  const k = state.pending?.kind;
  if (k !== 'move' && k !== 'try_again') throw new GameError('ILLEGAL_MOVE', 'not in the move phase');
  if (state.pending!.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your turn');
  endTurn(state, seat);
}

/** Walk away from a failed icon — the mover's chosen path (RULES.md §5.2 "or
 *  walk away"). Passing no path stays put and ends the turn. */
export function applyMoveAway(state: AOState, seat: string, path: string[]): void {
  if (state.pending?.kind !== 'try_again') throw new GameError('ILLEGAL_MOVE', 'no try-again pending');
  if (state.pending.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your try-again');
  walk(state, seat, path, true);
}

// ---------------------------------------------------------------------------
// Try again (RULES.md §5.2): stay on a failed icon and re-trigger with a fresh
// card.
// ---------------------------------------------------------------------------
export function applyTryAgain(state: AOState, seat: string): void {
  if (state.pending?.kind !== 'try_again') throw new GameError('ILLEGAL_MOVE', 'no try-again pending');
  if (state.pending.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your try-again');
  const icon = state.iconHexes.find((h) => h.key === player(state, seat).hexKey && !h.completed);
  if (!icon) throw new GameError('ILLEGAL_MOVE', 'not standing on an uncompleted icon');
  resolveIcon(state, seat, icon);
}

// ---------------------------------------------------------------------------
// Explore (RULES.md §5.3/§5.4, §6.3 Map). The tile is REVEALED first (the
// pending carries its id), then the player chooses the slot and rotation
// knowing what they placed. Three contexts:
//   ordinary    — in-turn explore: needs a step left and must touch the seat's
//                 own outer hex (never the centre: §5.3).
//   forced      — start-of-turn forced explore (all icons done): any slot, and
//                 the turn CONTINUES afterward (§5.4).
//   dungeon_map — a Dungeon Map card: any slot; placing completes the dungeon.
// ---------------------------------------------------------------------------
export type ExploreContext = 'ordinary' | 'forced' | 'dungeon_map';

function startExplore(state: AOState, seat: string, context: ExploreContext, iconKey: string | null): void {
  if (state.tileStack.length === 0) {
    if (context === 'dungeon_map') {
      // The Map card gives nothing (RULES.md §6.3): cycle it, draw again.
      givesNothingAndDrawAgain(state, seat, state.iconHexes.find((h) => h.key === iconKey)!);
      return;
    }
    throw new GameError('ILLEGAL_MOVE', 'the map tile stack is empty');
  }
  if (isServerServed(state, seat)) {
    // Server-owned stack (§5.3's "Take the top tile and turn it face up").
    // An ordinary explore is the player's own press of Explore, which turns
    // the tile over. A forced explore and a Dungeon Map card come without
    // that press, so a digital human turns the tile over with Draw.
    const payload: DrawPayload = { deck: 'tile', context, iconKey: iconKey ?? undefined };
    if (context !== 'ordinary') {
      log(state, context === 'forced'
        ? `Every icon is completed, so ${nameOf(state, seat)} must explore before moving.`
        : `The Map card sends ${nameOf(state, seat)} exploring: the tile may go in any empty slot touching the map.`, 'explore', seat);
      openDraw(state, seat, payload);
      return;
    }
    completeDraw(state, seat, payload);
    return;
  }
  // Physical seat: the server does NOT know the stack's order, so there is
  // nothing to reveal. Ask the seat to report the tile they actually drew;
  // placement choices follow ONLY after the identity is real (R1/R2: never
  // announce or pre-fill a guessed tile).
  const tileReporter = drawReporter(state, seat);
  log(state, tileReporter === seat
    ? `${nameOf(state, seat)} explores. Draw the top tile and report what it is.`
    : `${nameOf(state, seat)} explores. ${nameOf(state, tileReporter)}, draw the top map tile for ${nameOf(state, seat)} and report what it is.`, 'explore', seat);
  openDrawReport(state, seat, { deck: 'tile', context, iconKey: iconKey ?? undefined });
}

/** Begin an ordinary in-turn explore (pending move/try_again): validates
 *  eligibility, then opens the reveal/report step. */
export function applyExplore(state: AOState, seat: string): void {
  const k = state.pending?.kind;
  if ((k !== 'move' && k !== 'try_again') || state.pending!.seat !== seat) {
    throw new GameError('ILLEGAL_MOVE', 'not in a position to explore');
  }
  const me = player(state, seat);
  if (me.stepsLeft < 1) throw new GameError('ILLEGAL_MOVE', 'you need at least one step left to explore');
  if (state.tileStack.length === 0) throw new GameError('ILLEGAL_MOVE', 'the map tile stack is empty');
  // The seat must stand on an OUTER hex that touches at least one empty slot:
  // the centre hex touches no slot (RULES.md §5.3).
  const slots = emptySlotsTouching(state, me.hexKey);
  if (slots.length === 0) {
    const ownTile = state.placedTiles.find((t) => t.center.key === me.hexKey);
    if (ownTile) throw new GameError('ILLEGAL_MOVE', 'you cannot explore from a centre hex — it touches no slot');
    throw new GameError('ILLEGAL_MOVE', 'no empty tile slot touches the hex you are standing on');
  }
  startExplore(state, seat, 'ordinary', null);
}

/** Place the revealed/reported tile (the second half of every explore). */
export function applyPlaceTile(state: AOState, seat: string, slotCenterKey: string, rotation: number): void {
  const p = state.pending;
  if (p?.kind !== 'explore_place' || p.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'no tile placement pending');
  const context = p.payload!.context as ExploreContext;
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 5) {
    throw new GameError('ILLEGAL_MOVE', `rotation must be 0-5, got ${rotation}`);
  }
  if (state.placedTiles.some((t) => t.center.key === slotCenterKey)) {
    throw new GameError('ILLEGAL_MOVE', 'that slot already has a tile');
  }
  if (!isSlotOnMap(state, slotCenterKey)) {
    throw new GameError('ILLEGAL_MOVE', `${slotCenterKey} is not an empty slot touching the map`);
  }
  const me = player(state, seat);
  if (context === 'ordinary') {
    // The slot must touch the hex the seat is STANDING on (that hex must be an
    // outer hex of a placed tile — the centre touches no slot).
    if (!emptySlotsTouching(state, me.hexKey).includes(slotCenterKey)) {
      throw new GameError('ILLEGAL_MOVE', 'you may only explore into a slot that touches the hex you are standing on');
    }
  }

  // The tile's identity was fixed when the pending opened (server reveal or a
  // physical report) — never accept a changed identity at placement time.
  const tileId = p.payload!.tileId as number;
  if (!state.tileStack.includes(tileId)) {
    throw new GameError('ILLEGAL_MOVE', `Tile ${tileId} is not in the stack — it is already placed`);
  }
  state.tileStack = state.tileStack.filter((t) => t !== tileId);
  placeTileOnMap(state, tileId, slotCenterKey, rotation, seat);
  me.exploredTileIds.push(tileId);
  me.tokensSpent += 1;
  const where = slotLabel(state, slotCenterKey);
  headline(state, `${nameOf(state, seat)} places Tile ${tileId} against ${where}, ${rotationLabel(rotation)}, and puts a ${me.colour ? `${me.colour} ` : ''}token on its centre.`, 'explore', seat);
  checkExploreQuest(state, seat);
  if (state.tileStack.length === 0 && state.endingPhase === 0) {
    state.endingPhase = 1;
    headline(state, 'The last map tile is placed — finish the current round, then play one more full round.', 'ending');
  }

  if (context === 'dungeon_map') {
    // The placement succeeds, completes that dungeon, and cycles the card (§6.3).
    const icon = state.iconHexes.find((h) => h.key === p.payload!.iconKey)!;
    completeDungeon(state, seat, icon);
    return;
  }
  if (context === 'forced') {
    // Forced explore happens at the START of the turn; the player then takes
    // the rest of their turn normally (RULES.md §5.4).
    beginTurn(state, seat);
    return;
  }
  // Ordinary explore: remaining steps are used up and the turn ends (§5.3).
  me.stepsLeft = 0;
  endTurn(state, seat);
}

/** Human-readable slot label ("side NE–SE of Tile 4") for summaries/menus —
 *  rotation-aware: the side is named by the hexes as the tile STANDS (the
 *  tile's rotation is applied), so the label matches what a player sees. */
function slotLabel(state: AOState, centerKey: string): string {
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      if (tileCenter(t.center.key, s) === centerKey) {
        return `${sideLabelOf(t.center.key, t.rotation, s)} of Tile ${t.tileId}`;
      }
    }
  }
  return centerKey;
}

function isSlotOnMap(state: AOState, centerKey: string): boolean {
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      if (tileCenter(t.center.key, s) === centerKey) {
        const [a, b] = slotHexes(t.center.key, s);
        return state.hexes[a] === true && state.hexes[b] === true;
      }
    }
  }
  return false;
}

/** Empty slots touching the given hex: the hex must be an OUTER hex of a
 *  placed tile; the slots it belongs to are the two sides meeting there. */
function emptySlotsTouching(state: AOState, hex: string): string[] {
  const out: string[] = [];
  const placed = new Set(state.placedTiles.map((t) => t.center.key));
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      const [a, b] = slotHexes(t.center.key, s);
      if (a !== hex && b !== hex) continue;
      const c = tileCenter(t.center.key, s);
      if (!placed.has(c) && isSlotOnMap(state, c)) out.push(c);
    }
  }
  return out;
}

/** Every empty slot touching the map (forced explore / Dungeon Map). */
export function allEmptySlots(state: AOState): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const placed = new Set(state.placedTiles.map((t) => t.center.key));
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      const c = tileCenter(t.center.key, s);
      if (placed.has(c) || seen.has(c)) continue;
      if (isSlotOnMap(state, c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

/** Every hex a player could explore from right now: the two hexes of each
 *  side that has an empty slot (one pass over the map, for the AI planner). */
export function exploreHexes(state: AOState): Set<string> {
  const out = new Set<string>();
  const placed = new Set(state.placedTiles.map((t) => t.center.key));
  for (const t of state.placedTiles) {
    for (let s = 0; s < 6; s++) {
      const c = tileCenter(t.center.key, s);
      if (placed.has(c) || !isSlotOnMap(state, c)) continue;
      for (const h of slotHexes(t.center.key, s)) out.add(h);
    }
  }
  return out;
}

/** Empty slots touching any hex (the AI planner looks ahead to hexes it
 *  could walk to before exploring). */
export function slotsTouchingHex(state: AOState, hex: string): string[] {
  return emptySlotsTouching(state, hex);
}

/** Export for legalMoves: empty slots touching the seat's current hex. */
export function explorableSlots(state: AOState, seat: string): string[] {
  return emptySlotsTouching(state, player(state, seat).hexKey);
}

// ---------------------------------------------------------------------------
// Icon resolution (RULES.md §6)
// ---------------------------------------------------------------------------
export function resolveIcon(state: AOState, seat: string, icon: IconHex): void {
  log(state, `The ${describeIcon(icon)} on ${hexLabel(state, icon.key)} triggers for ${nameOf(state, seat)}.`, 'icon', seat);
  switch (icon.kind) {
    case 'city': return startIconTest(state, seat, icon, 'recruit');
    case 'little_monster': return startIconTest(state, seat, icon, 'little');
    case 'big_monster': return startIconTest(state, seat, icon, 'big');
    case 'dungeon': return startDungeon(state, seat, icon);
    default:
      return takeArtifactFromHex(state, seat, icon);
  }
}

/** Mark an icon completed by `seat` and say so as a table instruction: the
 *  player's token goes on that icon's hex. Every completion that spends a
 *  token goes through here so the summary always carries the placement. */
function placeCompletionToken(state: AOState, seat: string, icon: IconHex): void {
  icon.completed = true; icon.completedBy = seat;
  const me = player(state, seat);
  me.tokensSpent += 1;
  const colour = me.colour ? `${me.colour} ` : '';
  headline(state, `${nameOf(state, seat)} places a ${colour}token on the ${describeIcon(icon)} (${hexLabel(state, icon.key)}) — it is completed.`, 'icon', seat);
}

/** "Alice recruited companion-13 (number 4, +3 Strength) — Strength 2 → 5." */
function recruitedText(state: AOState, seat: string, cardId: string, where: string): string {
  const card = COMPANION_CARDS.find((c) => c.id === cardId)!;
  const changes = STAT_WORDS.filter((k) => card.bonus[k]).map((k) => {
    const now = effectiveStat(state, seat, k);
    const label = `${k[0]!.toUpperCase()}${k.slice(1)}`;
    return `${label} ${now - card.bonus[k]!} → ${now}`;
  });
  return `${nameOf(state, seat)} recruited ${cardId} (${printedCardFace('companion', cardId)})${where} and keeps the card — ${changes.join(', ')} for the rest of the game.`;
}

function describeIcon(icon: IconHex): string {
  const kind = icon.kind as string;
  if (kind === 'city') return 'City';
  if (kind === 'dungeon') return 'Dungeon';
  if (kind === 'little_monster') return 'Little Monster';
  if (kind === 'big_monster') return 'Big Monster';
  if (kind === 'star') return 'Star';
  if (kind === 'hearts') return 'Hearts';
  if (kind === 'spades') return 'Spades';
  if (kind === 'diamonds') return 'Diamonds';
  if (kind === 'clubs') return 'Clubs';
  return kind;
}

export type TestKind = 'recruit' | 'little' | 'big';

function testDeck(test: TestKind): 'companion' | 'little' | 'big' {
  return test === 'recruit' ? 'companion' : test;
}

function cardOf(deck: 'companion' | 'little' | 'big', cardId: string): { id: string; number: number } {
  const list = deck === 'companion' ? COMPANION_CARDS : deck === 'little' ? LITTLE_MONSTER_CARDS : BIG_MONSTER_CARDS;
  const card = list.find((c) => c.id === cardId);
  if (!card) throw new GameError('ILLEGAL_MOVE', `unknown ${deck} card "${cardId}"`);
  return card;
}

/** A test outside a Dungeon. Digital/AI: the server reveals the top card and
 *  the seat rolls. Physical: the human draws the real card and reports it
 *  (report_card) before rolling. Exhaustion is PUBLIC — deck size is table
 *  knowledge — so an empty deck never depends on who draws (R5). */
function startIconTest(state: AOState, seat: string, icon: IconHex, test: TestKind): void {
  const deck = testDeck(test);
  if (state.decks[deck].length === 0) {
    // Empty deck on a map icon: nothing happens; icon stays open; turn ends
    // (RULES.md §6.2). (Cannot happen for companion/big by conservation.)
    log(state, `The ${deck === 'little' ? 'Little Monster' : deck === 'big' ? 'Big Monster' : 'Companion'} deck is empty — nothing happens. The icon stays open.`, 'icon', seat);
    player(state, seat).stepsLeft = 0;
    endTurn(state, seat);
    return;
  }
  openDraw(state, seat, { deck, iconKey: icon.key, test });
}

function openTestRoll(
  state: AOState, seat: string, icon: IconHex, test: TestKind, cardId: string,
  extra: { dungeon?: true; fightsLeft?: number },
): void {
  const card = cardOf(testDeck(test), cardId);
  const stat: StatKey = test === 'recruit' ? 'charisma' : 'strength';
  const diceCount = effectiveStat(state, seat, stat);
  const testName = test === 'recruit' ? `recruit ${cardName(cardId, card.number)}` : `fight ${cardName(cardId, card.number)}`;
  log(state, `${nameOf(state, seat)} must ${testName} — roll ${diceCount} ${diceCount === 1 ? 'die' : 'dice'} and beat ${card.number}.`, 'test', seat);
  state.pending = {
    kind: 'roll', seat,
    payload: {
      rollKind: 'test', test, cardId, number: card.number, diceCount,
      iconKey: icon.key, ...extra,
    },
  };
}

export function cardName(cardId: string, _number?: number): string {
  // Printed names are placeholders (RULES.md §1); what is printed — the number,
  // plus a Companion's bonus icons — is the identity, so say all of it.
  const deck = deckOfCard(cardId);
  return deck ? `${cardId} (${printedCardFace(deck, cardId)})` : cardId;
}

function deckOfCard(cardId: string): 'companion' | 'little' | 'big' | null {
  if (COMPANION_CARDS.some((c) => c.id === cardId)) return 'companion';
  if (LITTLE_MONSTER_CARDS.some((c) => c.id === cardId)) return 'little';
  if (BIG_MONSTER_CARDS.some((c) => c.id === cardId)) return 'big';
  return null;
}

// ---------------------------------------------------------------------------
// Reporting: a physical seat reports the card they drew (report_card); a
// digital seat presses the reveal button (resolve_report). Reports resolve
// printed names and, where a printed value (e.g. a card's NUMBER) does not
// pick one card, the resolver says what else to report — it never guesses
// (CLAUDE.md "Don't make the model guess").
// ---------------------------------------------------------------------------
export function applyReportCard(state: AOState, reporter: string, report: string): void {
  const p = state.pending;
  if (p?.kind !== 'report_card' || p.seat !== reporter) throw new GameError('ILLEGAL_MOVE', 'no card report pending');
  if (state.serverOwnsDecks) throw new GameError('ILLEGAL_MOVE', 'the server deals every card at this table — nobody reports cards');
  // The draw may belong to another seat (an AI's draw from the real deck is
  // reported by a human); everything after the report is that seat's.
  const seat = (p.payload?.forSeat as string | undefined) ?? reporter;
  const deck = p.payload!.deck as 'companion' | 'little' | 'big' | 'dungeon' | 'tile';

  // Tile report (an explore's draw): resolve the printed tile, fix the pending
  // placement's identity, and open the placement choices.
  if (deck === 'tile') {
    const m = String(report).trim().match(/(\d+)/);
    if (!m) throw new GameError('ILLEGAL_MOVE', `which tile did you draw? Answer with its printed number (e.g. "Tile 4")`);
    const tileId = Number(m[1]);
    if (!state.tileStack.includes(tileId)) {
      throw new GameError('ILLEGAL_MOVE', `Tile ${tileId} is not in the stack — it is already placed or was reported before`);
    }
    state.pending = {
      kind: 'explore_place', seat,
      payload: { tileId, context: p.payload!.context, iconKey: p.payload!.iconKey },
    };
    log(state, `${nameOf(state, seat)} drew Tile ${tileId} — now choose where it goes and its rotation.`, 'explore', seat);
    return;
  }

  if (deck === 'dungeon') {
    const kind = resolveDungeonKindName(report);
    if (!kind) throw new GameError('ILLEGAL_MOVE', `unknown Dungeon card "${report}" — name what is printed on it`);
    const possible = topCandidates(state, 'dungeon');
    if (!possible.includes(kind)) {
      throw new GameError('ILLEGAL_MOVE', `a ${DUNGEON_KIND_NAMES[kind]} card cannot be on top of the Dungeon deck now — the cards drawn so far went to the bottom in a known order. It must be one of: ${[...new Set(possible)].map((k) => DUNGEON_KIND_NAMES[k as DungeonCardKind]).join(', ')}`);
    }
    openDungeonCard(state, seat, state.iconHexes.find((h) => h.key === p.payload!.iconKey)!, kind, unknownPart(state, 'dungeon').length === 0);
    return;
  }

  // City/monster report: resolve a printed card (id or printed identity), and
  // when the printed number alone matches multiple cards, say what else to
  // report (the printed bonus icons) instead of guessing.
  const { id: cardId, error } = resolvePrintedCard(state, deck, report);
  if (!cardId) throw new GameError('ILLEGAL_MOVE', error ?? `unknown ${deck} card "${report}"`);
  const heldAnywhere = state.playerOrder.some((pid) => {
    const pl = player(state, pid);
    return pl.companions.includes(cardId) || pl.littleMonsters.includes(cardId) || pl.bigMonsters.includes(cardId);
  });
  if (heldAnywhere) {
    throw new GameError('ILLEGAL_MOVE', `${report} is already kept in front of a player — it cannot be drawn again`);
  }
  const icon = state.iconHexes.find((h) => h.key === p.payload!.iconKey);
  if (p.payload!.dungeon) {
    openDungeonTestRoll(state, seat, icon!, p.payload!.test as TestKind, cardId, p.payload!.fightsLeft as number | undefined);
  } else {
    openTestRoll(state, seat, icon!, p.payload!.test as TestKind, cardId, {});
  }
}

/** The stat words printed on Companion bonus icons, in printed order. */
const STAT_WORDS: StatKey[] = ['strength', 'charisma', 'movement'];

/** What is printed on a card, as a player reads it: the number to beat, and
 *  for a Companion its bonus icons — e.g. "number 2, +1 Strength, +1 Charisma".
 *  Cards with the same printed face are interchangeable copies. */
export function printedCardFace(deck: 'companion' | 'little' | 'big', cardId: string): string {
  if (deck === 'companion') {
    const c = COMPANION_CARDS.find((x) => x.id === cardId)!;
    return `number ${c.number}, ${bonusText(c.bonus)}`;
  }
  const list = deck === 'little' ? LITTLE_MONSTER_CARDS : BIG_MONSTER_CARDS;
  return `number ${list.find((x) => x.id === cardId)!.number}`;
}

/** "+3 Strength" / "+1 Strength, +1 Charisma" — a Companion's printed bonus. */
export function bonusText(bonus: Partial<Record<StatKey, number>>): string {
  return STAT_WORDS.filter((k) => bonus[k])
    .map((k) => `+${bonus[k]} ${k[0]!.toUpperCase()}${k.slice(1)}`)
    .join(', ');
}

type AnyDeck = 'companion' | 'little' | 'big' | 'dungeon';

function knownBottom(state: AOState): NonNullable<AOState['knownBottom']> {
  if (!state.knownBottom) state.knownBottom = { companion: [], little: [], big: [], dungeon: [] };
  return state.knownBottom;
}

/** The deck's cards minus its known bottom run: the part whose order nobody
 *  knows (a multiset — Dungeon cards repeat by kind). */
function unknownPart(state: AOState, deck: AnyDeck): string[] {
  const rest: string[] = [...state.decks[deck]];
  for (const c of knownBottom(state)[deck]) {
    const i = rest.indexOf(c);
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

/** What the top card of a deck can be right now. With every seat served by
 *  the server, it is the one card on top of the server's order. With real
 *  cards, it is any card of the unknown part while that part is not empty,
 *  and otherwise exactly the first card of the known bottom run. */
export function topCandidates(state: AOState, deck: AnyDeck): string[] {
  if (state.serverOwnsDecks) return state.decks[deck].slice(0, 1);
  const unknown = unknownPart(state, deck);
  return unknown.length > 0 ? unknown : knownBottom(state)[deck].slice(0, 1);
}

/** A drawn card leaves the top: if it came from the known bottom run (the
 *  unknown part was empty), that run loses its first card. Real-card tables. */
function leaveTop(state: AOState, deck: AnyDeck, card: string): void {
  if (state.serverOwnsDecks) return;
  const kb = knownBottom(state)[deck] as string[];
  if (unknownPart(state, deck).length === 0 && kb[0] === card) kb.shift();
}

/** Cards of a deck the player could have just drawn — see topCandidates. */
export function drawableCards(state: AOState, deck: 'companion' | 'little' | 'big'): string[] {
  return topCandidates(state, deck);
}

/** One entry per distinct printed face still drawable, for the report menu. */
export function drawableFaces(state: AOState, deck: 'companion' | 'little' | 'big'): { face: string; cardId: string }[] {
  const out: { face: string; cardId: string }[] = [];
  for (const id of drawableCards(state, deck)) {
    const face = printedCardFace(deck, id);
    if (!out.some((o) => o.face === face)) out.push({ face, cardId: id });
  }
  return out.sort((a, b) => a.face.localeCompare(b.face, 'en', { numeric: true }));
}

/** Resolve a physical card report to one drawable card. Accepts the id
 *  (harness/AI path) or the printed face: the number, plus — for a Companion
 *  whose number is shared by cards with different bonuses — the bonus icons
 *  ("number 2, +1 Strength"). Copies with the same printed face are
 *  interchangeable, so any drawable copy stands for the one drawn. Only
 *  cards still drawable are matched; it never guesses between different
 *  faces — it names them (CLAUDE.md "Don't make the model guess"). */
function resolvePrintedCard(state: AOState, deck: 'companion' | 'little' | 'big', report: string): { id: string | null; error?: string } {
  const drawable = drawableCards(state, deck);
  const text = report.trim().toLowerCase();
  if (drawable.includes(text)) return { id: text };
  if (drawable.length === 0) return { id: null, error: `the ${deckName(deck)} deck is empty` };

  // Bonus icons: "+1 strength", "1 strength". Pulled out first so their
  // digits are never mistaken for the card's number.
  const want: Partial<Record<StatKey, number>> = {};
  const stripped = text.replace(/\+?\s*(\d+)\s*(strength|charisma|movement)/g, (_m, n: string, stat: StatKey) => {
    want[stat] = (want[stat] ?? 0) + Number(n);
    return ' ';
  });
  const m = stripped.match(/(\d+)/);
  if (!m) {
    return { id: null, error: `which ${deckName(deck)} card did you draw? Report what is printed on it, e.g. "${drawableFaces(state, deck)[0]?.face ?? 'number 4'}"` };
  }
  const num = Number(m[1]);
  const faceOf = (id: string) => printedCardFace(deck, id);
  let matches = drawable.filter((id) => {
    const list = deck === 'companion' ? COMPANION_CARDS : deck === 'little' ? LITTLE_MONSTER_CARDS : BIG_MONSTER_CARDS;
    return list.find((c) => c.id === id)!.number === num;
  });
  if (matches.length === 0) {
    const faces = drawableFaces(state, deck).map((f) => `"${f.face}"`).join(', ');
    return { id: null, error: `no ${deckName(deck)} card with the printed number ${num} can be on top of the deck now — it can only be: ${faces}` };
  }
  if (deck === 'companion' && Object.keys(want).length > 0) {
    matches = matches.filter((id) => {
      const bonus = COMPANION_CARDS.find((c) => c.id === id)!.bonus;
      return STAT_WORDS.every((k) => (bonus[k] ?? 0) === (want[k] ?? 0));
    });
    if (matches.length === 0) {
      const faces = drawableFaces(state, deck).filter((f) => f.face.startsWith(`number ${num},`)).map((f) => `"${f.face}"`).join(', ');
      return { id: null, error: `no Companion showing number ${num} with ${bonusText(want)} can be on top of the deck now — the number-${num} Companions it can only be are: ${faces || 'none'}` };
    }
  }
  const faces = [...new Set(matches.map(faceOf))];
  if (faces.length > 1) {
    return {
      id: null,
      error: `several different Companion cards show the number ${num} — also report the printed bonus icons. It is one of: ${faces.map((f) => `"${f}"`).join(', ')}`,
    };
  }
  return { id: matches[0]! };
}

function deckName(deck: 'companion' | 'little' | 'big'): string {
  return deck === 'companion' ? 'Companion' : deck === 'little' ? 'Little Monster' : 'Big Monster';
}

/** Resolve a printed Dungeon card name to its kind. */
function resolveDungeonKindName(name: string): DungeonCardKind | null {
  const n = name.trim().toLowerCase();
  for (const [kind, printed] of Object.entries(DUNGEON_KIND_NAMES)) {
    if (printed.toLowerCase() === n) return kind as DungeonCardKind;
  }
  if (n === '2x little monsters' || n === 'two little monsters') return 'double_little_monsters';
  return null;
}

// ---------------------------------------------------------------------------
// Test rolls. The total is VALIDATED, never clamped (the pre-fix dispatcher
// decomposed any total into 1-6 dice and accepted 999 as 6).
// ---------------------------------------------------------------------------
export function applyTestRoll(state: AOState, seat: string, total: number): void {
  const p = state.pending;
  if (p?.kind !== 'roll' || p.payload?.rollKind !== 'test') throw new GameError('ILLEGAL_MOVE', 'no test pending');
  if (p.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'not your test');
  const diceCount = p.payload!.diceCount as number;
  if (!Number.isInteger(total) || total < diceCount || total > diceCount * 6) {
    throw new GameError('ILLEGAL_MOVE', `report an integer total from ${diceCount} dice (${diceCount} to ${diceCount * 6}), got ${total}`);
  }
  const number = p.payload!.number as number;
  const success = total >= number;
  const test = p.payload!.test as TestKind;
  const cardId = p.payload!.cardId as string;
  const icon = state.iconHexes.find((h) => h.key === p.payload!.iconKey)!;
  log(state, `${nameOf(state, seat)} rolled ${total} (needs ${number}) — ${success ? 'success' : 'fail'}.`, 'test', seat);
  if (p.payload!.dungeon) {
    dungeonTestResult(state, seat, icon, test, cardId, success, p.payload!.fightsLeft as number | undefined);
    return;
  }
  iconTestResult(state, seat, icon, test, cardId, success);
}

function iconTestResult(state: AOState, seat: string, icon: IconHex, test: TestKind, cardId: string, success: boolean): void {
  const deck = testDeck(test);
  const me = player(state, seat);
  if (success) {
    // Keep the card (server-served: pop the top; physical: the report already
    // recorded it — remove it from the tracked remainder either way).
    removeDeckCard(state, deck, cardId);
    if (test === 'recruit') {
      me.companions.push(cardId);
      headline(state, recruitedText(state, seat, cardId, ''), 'recruit', seat);
    } else {
      if (test === 'little') me.littleMonsters.push(cardId);
      else me.bigMonsters.push(cardId);
      headline(state, `${nameOf(state, seat)} defeated ${cardName(cardId)} and keeps the card.`, 'fight', seat);
    }
    placeCompletionToken(state, seat, icon);
  } else {
    // Fail: the card goes to the bottom of its deck (for a physical seat that
    // is bookkeeping: count preserved, order nominal).
    cycleDeckCard(state, deck, cardId);
    headline(state, `${nameOf(state, seat)} failed — ${cardName(cardId)} goes to the bottom of the ${deckName(deck)} deck; the icon stays open.`, 'icon', seat);
  }
  me.stepsLeft = 0;
  endTurn(state, seat);
}

/** Remove a drawn card from the tracked deck (no-op-safe for physical
 *  reports, whose order is nominal). */
function removeDeckCard(state: AOState, deck: 'companion' | 'little' | 'big', cardId: string): void {
  leaveTop(state, deck, cardId);
  const arr = state.decks[deck];
  const i = arr.indexOf(cardId);
  if (i >= 0) arr.splice(i, 1);
}

/** Cycle a failed card to the bottom of its deck. */
function cycleDeckCard(state: AOState, deck: 'companion' | 'little' | 'big', cardId: string): void {
  if (!state.serverOwnsDecks) {
    // Real cards: it goes under the deck, the newest card of the known run.
    leaveTop(state, deck, cardId);
    knownBottom(state)[deck].push(cardId);
  }
  const arr = state.decks[deck];
  const i = arr.indexOf(cardId);
  if (i === 0) {
    arr.push(arr.shift()!);
  } else if (i > 0) {
    arr.splice(i, 1);
    arr.push(cardId);
  }
  // Not present (a physical table whose remainder wasn't tracked) — nothing to cycle.
}

// ---------------------------------------------------------------------------
// Dungeon (RULES.md §6.3)
// ---------------------------------------------------------------------------
function startDungeon(state: AOState, seat: string, icon: IconHex): void {
  if (state.decks.dungeon.length === 0) {
    // RULES.md §6.3 guarantees this never happens (the deck always contains
    // Companion and Big Monster cards). If it ever did, mirror §6.2's empty
    // deck: nothing happens, the icon stays open, the turn ends.
    log(state, `${nameOf(state, seat)} reached a Dungeon but the deck is empty — nothing to draw. The icon stays open; the turn ends.`, 'dungeon', seat);
    player(state, seat).stepsLeft = 0;
    endTurn(state, seat);
    return;
  }
  openDraw(state, seat, { deck: 'dungeon', iconKey: icon.key });
}

/** The drawn Dungeon card is known (server reveal or physical report): open it. */
function openDungeonCard(state: AOState, seat: string, icon: IconHex, kind: DungeonCardKind, fromBottom = false): void {
  state.dungeonResolving = { iconKey: icon.key, kind, fromBottom };
  log(state, `${nameOf(state, seat)} drew a Dungeon card: ${DUNGEON_KIND_NAMES[kind]}.`, 'dungeon', seat);
  resolveDungeonCard(state, seat, icon, kind);
}

function resolveDungeonCard(state: AOState, seat: string, icon: IconHex, kind: DungeonCardKind): void {
  switch (kind) {
    case 'little_monster': return dungeonTestStart(state, seat, icon, 'little', 1);
    case 'big_monster': return dungeonTestStart(state, seat, icon, 'big', 1);
    case 'double_little_monsters': return dungeonTestStart(state, seat, icon, 'little', 2);
    case 'companion': return dungeonTestStart(state, seat, icon, 'recruit', 1);
    case 'any_artifact': {
      // Offers only REAL sources: supply artifacts no one holds, and artifacts
      // other players hold — never one the seat already holds (the pre-fix
      // offer let a player "take" their own artifact to complete the dungeon).
      const options = anyArtifactOptions(state, seat);
      if (options.length === 0) {
        givesNothingAndDrawAgain(state, seat, icon);
        return;
      }
      state.pending = { kind: 'take_artifact', seat, payload: { iconKey: icon.key } };
      return;
    }
    case 'map': {
      if (state.tileStack.length === 0) {
        givesNothingAndDrawAgain(state, seat, icon);
        return;
      }
      startExplore(state, seat, 'dungeon_map', icon.key);
      return;
    }
  }
}

/** Suit artifacts the seat may actually take: supply (not held by anyone) or
 *  ANOTHER player's holding — never the seat's own, never the Star. */
export function anyArtifactOptions(state: AOState, seat: string): Array<{ artifact: ArtifactId; from: 'supply' | string }> {
  const holderOf = new Map<ArtifactId, string>();
  for (const pid of state.playerOrder) {
    for (const a of player(state, pid).artifacts) holderOf.set(a, pid);
  }
  const out: Array<{ artifact: ArtifactId; from: 'supply' | string }> = [];
  for (const a of SUIT_ARTIFACTS) {
    const holder = holderOf.get(a);
    if (holder === seat) continue;          // can't "take" what you already hold
    if (holder) out.push({ artifact: a, from: holder });
    else out.push({ artifact: a, from: 'supply' });
  }
  return out;
}

/** A dungeon fight/recruit begins. `fightsLeft` counts the 2x-Monsters card:
 *  2 = first of two; 1 = second (or a single-fight card). Exhaustion is
 *  PUBLIC — a deck everyone can count never produces an unresolvable pending
 *  for a physical seat (R5). */
function dungeonTestStart(state: AOState, seat: string, icon: IconHex, test: TestKind, fightsLeft: number): void {
  const deck = testDeck(test);
  if (state.decks[deck].length === 0) {
    // The drawn card gives nothing (RULES.md §6.3): cycle it, draw again.
    givesNothingAndDrawAgain(state, seat, icon);
    return;
  }
  openDraw(state, seat, { deck, iconKey: icon.key, test, dungeon: true, fightsLeft });
}

function openDungeonTestRoll(state: AOState, seat: string, icon: IconHex, test: TestKind, cardId: string, fightsLeft: number | undefined): void {
  // Same announcement as an ordinary icon test, so the revealed card is
  // always said (REVIEW-r4 #2: the Dungeon path used to reveal nothing).
  openTestRoll(state, seat, icon, test, cardId, { dungeon: true, fightsLeft });
}

/** The dungeon test's result. Routes through the dungeon's continuation and
 *  completion rules (the pre-fix `applyTestRoll` never read `dungeon`/`count`:
 *  the first of two fights completed the icon outright, and no result ever
 *  recycled the Dungeon card or cleared `dungeonResolving`). */
function dungeonTestResult(state: AOState, seat: string, icon: IconHex, test: TestKind, cardId: string, success: boolean, fightsLeft: number | undefined): void {
  const deck = testDeck(test);
  const me = player(state, seat);
  // dungeonResolving stays set until cycleDungeonDeckTop moves the Dungeon card
  // — that is what names the card when it goes to the bottom.

  if (test === 'little' && fightsLeft === 2) {
    // First of two Little Monsters (§6.3 "2x Little Monsters").
    if (!success) {
      // Lose the first ⇒ no second fight; the Dungeon fails.
      cycleDeckCard(state, deck, cardId);
      headline(state, `${nameOf(state, seat)} lost the first fight — ${cardName(cardId)} goes to the bottom of the ${deckName(deck)} deck. There is no second fight; the Dungeon is not completed.`, 'dungeon', seat);
      cycleDungeonDeckTop(state, seat);
      me.stepsLeft = 0;
      endTurn(state, seat);
      return;
    }
    // Beat the first: keep it, then fight the second.
    removeDeckCard(state, deck, cardId);
    me.littleMonsters.push(cardId);
    log(state, `${nameOf(state, seat)} defeated ${cardName(cardId)} — one more Little Monster to fight.`, 'dungeon', seat);
    if (state.decks.little.length === 0) {
      // Deck empty before the second fight: the rest of the card gives nothing
      // (keep the first) — the Dungeon card is spent (cycled ONCE) and the next
      // is drawn (RULES.md §6.3). R10: the pre-fix code cycled once here and
      // again inside givesNothingAndDrawAgain, skipping a card.
      givesNothingAndDrawAgain(state, seat, icon);
      return;
    }
    state.dungeonResolving = { iconKey: icon.key, kind: 'double_little_monsters' };
    dungeonTestStart(state, seat, icon, 'little', 1);
    return;
  }

  if (success) {
    removeDeckCard(state, deck, cardId);
    if (test === 'recruit') {
      me.companions.push(cardId);
      headline(state, recruitedText(state, seat, cardId, ' in the Dungeon'), 'recruit', seat);
    } else {
      if (test === 'little') me.littleMonsters.push(cardId);
      else me.bigMonsters.push(cardId);
      headline(state, `${nameOf(state, seat)} defeated ${cardName(cardId)} in the Dungeon.`, 'fight', seat);
    }
    // Single-fight / recruit success or the SECOND fight won: the Dungeon is
    // completed (§6.3 table: "You defeat it" / "You defeat both" / "You recruit it").
    completeDungeon(state, seat, icon);
    return;
  }

  // A failed resolution: the Dungeon is NOT completed. The card and the drawn
  // card cycle to their decks; the seat may stay and try again next turn.
  cycleDeckCard(state, deck, cardId);
  if (test === 'recruit') {
    headline(state, `${nameOf(state, seat)} failed the recruit — ${cardName(cardId)} goes to the bottom of the Companion deck. A failed recruit fails the Dungeon; it is not completed.`, 'dungeon', seat);
  } else {
    headline(state, `${nameOf(state, seat)} lost the fight — ${cardName(cardId)} goes to the bottom of the ${deckName(deck)} deck; the Dungeon is not completed.`, 'dungeon', seat);
  }
  cycleDungeonDeckTop(state, seat);
  me.stepsLeft = 0;
  endTurn(state, seat);
}

/** Cycle the drawn (top) Dungeon card to the bottom and clear resolution.
 *  RULES.md §6.3: "When you are done with it, whatever happened, put it at the
 *  bottom of the Dungeon deck" — so the deck never runs out. */
function cycleDungeonDeckTop(state: AOState, seat: string): void {
  const kind = state.dungeonResolving?.kind;
  log(state, kind
    ? `The ${DUNGEON_KIND_NAMES[kind]} Dungeon card goes to the bottom of the Dungeon deck.`
    : 'The drawn Dungeon card goes to the bottom of the Dungeon deck.', 'dungeon', seat);
  if (isServerServed(state, seat)) {
    const d = state.decks.dungeon;
    d.push(d.shift()!);
  } else if (kind) {
    // Real cards: the card goes under the deck, the newest card of the known run.
    const kb = knownBottom(state).dungeon;
    if (state.dungeonResolving?.fromBottom && kb[0] === kind) kb.shift();
    kb.push(kind);
  }
  state.dungeonResolving = null;
}

/** The drawn card "gives nothing": cycle it and draw another (§6.3). */
function givesNothingAndDrawAgain(state: AOState, seat: string, icon: IconHex): void {
  log(state, 'The Dungeon card gives nothing — draw another.', 'dungeon', seat);
  cycleDungeonDeckTop(state, seat);
  if (isServerServed(state, seat) && state.decks.dungeon.length === 0) {
    // Defensive: §6.3 proves this cannot happen (Companion + Big Monster cards
    // always remain). End cleanly rather than loop.
    player(state, seat).stepsLeft = 0;
    endTurn(state, seat);
    return;
  }
  openDraw(state, seat, { deck: 'dungeon', iconKey: icon.key });
}

function completeDungeon(state: AOState, seat: string, icon: IconHex): void {
  cycleDungeonDeckTop(state, seat);
  const me = player(state, seat);
  placeCompletionToken(state, seat, icon);
  me.dungeonsCompleted += 1;
  state.pending = null;
  me.stepsLeft = 0;
  endTurn(state, seat);
}

// ---------------------------------------------------------------------------
// Artifacts (RULES.md §6.4, §6.5)
// ---------------------------------------------------------------------------
export function takeArtifactFromHex(state: AOState, seat: string, icon: IconHex): void {
  const artifact = icon.kind as ArtifactId;
  const from = artifactHolder(state, artifact);
  moveArtifactTo(state, artifact, seat);
  headline(state, from === seat
    ? `${nameOf(state, seat)} already holds the ${ARTIFACT_LABEL[artifact]} artifact and keeps it.`
    : `${nameOf(state, seat)} takes the ${ARTIFACT_LABEL[artifact]} artifact card ${from ? `from ${nameOf(state, from)}` : 'from the supply'}.`, 'artifact', seat);
  placeCompletionToken(state, seat, icon);
  player(state, seat).stepsLeft = 0;
  endTurn(state, seat);
}

const ARTIFACT_LABEL: Record<ArtifactId, string> = {
  hearts: 'Hearts', spades: 'Spades', diamonds: 'Diamonds', clubs: 'Clubs', star: 'Star',
};

function artifactHolder(state: AOState, artifact: ArtifactId): string | null {
  for (const pid of state.playerOrder) {
    if (player(state, pid).artifacts.includes(artifact)) return pid;
  }
  return null;
}

function moveArtifactTo(state: AOState, artifact: ArtifactId, toSeat: string): void {
  for (const pid of state.playerOrder) {
    const arr = player(state, pid).artifacts;
    const i = arr.indexOf(artifact);
    if (i >= 0) { arr.splice(i, 1); break; }
  }
  if (!player(state, toSeat).artifacts.includes(artifact)) {
    player(state, toSeat).artifacts.push(artifact);
  }
}

export function applyTakeArtifact(state: AOState, seat: string, artifact: ArtifactId, from: string): void {
  const p = state.pending;
  if (p?.kind !== 'take_artifact' || p.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'no artifact take pending');
  // Resolve the PRINTED name to the canonical id (R6: "Hearts" was stored as a
  // second, non-canonical identity and completed the dungeon). The canonical
  // domain is the four suit artifacts here — the Star is never takeable.
  const resolved = resolveArtifactName(artifact as unknown as string);
  if (!resolved) {
    throw new GameError('ILLEGAL_MOVE', `unknown artifact "${artifact}" — name it as printed (Hearts, Spades, Diamonds, Clubs)`);
  }
  if (resolved === 'star') {
    throw new GameError('ILLEGAL_MOVE', 'the Star can only be taken from its own map hex (Tile 6), never by an "Any artifact" card');
  }
  artifact = resolved;
  // Resolve the SOURCE: "supply", a player id, or a player's printed name.
  const sourceSeat = from === 'supply' ? 'supply' : resolvePlayerName(state, from);
  if (from !== 'supply' && !sourceSeat) {
    throw new GameError('ILLEGAL_MOVE', `no player named "${from}" — take from the supply or name the player holding it`);
  }
  // Validate against ACTUAL holdings: the supply holds it only if no player
  // does; a player source must actually hold it; and the seat can never
  // "take" an artifact they already hold.
  const holder = artifactHolder(state, artifact);
  if (sourceSeat === 'supply') {
    if (holder) throw new GameError('ILLEGAL_MOVE', `the ${ARTIFACT_LABEL[artifact]} artifact is not in the supply — ${nameOf(state, holder)} holds it`);
  } else {
    if (holder !== sourceSeat) throw new GameError('ILLEGAL_MOVE', `${nameOf(state, sourceSeat!)} does not hold the ${ARTIFACT_LABEL[artifact]} artifact`);
  }
  if (holder === seat) {
    throw new GameError('ILLEGAL_MOVE', `you already hold the ${ARTIFACT_LABEL[artifact]} artifact`);
  }
  moveArtifactTo(state, artifact, seat);
  headline(state, `${nameOf(state, seat)} took the ${ARTIFACT_LABEL[artifact]} artifact from ${sourceSeat === 'supply' ? 'the supply' : nameOf(state, sourceSeat!)}.`, 'artifact', seat);
  // Taking an artifact completes the Dungeon (§6.3).
  const icon = state.iconHexes.find((h) => h.key === p.payload!.iconKey)!;
  completeDungeon(state, seat, icon);
}

/** Resolve a printed artifact name (any casing) to the canonical id. */
function resolveArtifactName(name: string): ArtifactId | null {
  const n = String(name).trim().toLowerCase();
  return (['hearts', 'spades', 'diamonds', 'clubs', 'star'] as ArtifactId[]).find((a) => a === n) ?? null;
}

/** Resolve a player reference: exact player id, or the printed name (case-,
 *  space-tolerant). */
function resolvePlayerName(state: AOState, name: string): string | null {
  if (state.players[name]) return name;
  const n = String(name).trim().toLowerCase();
  for (const pid of state.playerOrder) {
    const p = player(state, pid);
    if (p.name.trim().toLowerCase() === n || p.standee.trim().toLowerCase() === n || p.colour.trim().toLowerCase() === n) return pid;
  }
  return null;
}

/** Decline the "Any artifact" card: it gives nothing — cycle it, draw again. */
export function applyDeclineArtifact(state: AOState, seat: string): void {
  const p = state.pending;
  if (p?.kind !== 'take_artifact' || p.seat !== seat) throw new GameError('ILLEGAL_MOVE', 'no artifact take pending');
  const icon = state.iconHexes.find((h) => h.key === p.payload!.iconKey)!;
  log(state, `${nameOf(state, seat)} declined the artifact.`, 'dungeon', seat);
  givesNothingAndDrawAgain(state, seat, icon);
}

// ---------------------------------------------------------------------------
// Quests (RULES.md §8)
// ---------------------------------------------------------------------------
function claimQuest(state: AOState, seat: string, kind: string, name: string): void {
  if (state.inPlayQuests[kind] !== 'unclaimed') return;
  state.inPlayQuests[kind] = seat;
  player(state, seat).questPoints += 1;
  player(state, seat).claimedQuests.push(kind);
  headline(state, `${nameOf(state, seat)} claimed the quest "${name}" (+1 point).`, 'quest', seat);
}

/** How far a seat has got toward a quest: the count that quest is judged by
 *  (RULES.md §8). The instant quests are claimed at their target; the
 *  end-of-game ones go to strictly the most. */
export function questProgress(state: AOState, seat: string, kind: string): number {
  const p = player(state, seat);
  switch (kind) {
    case 'explore_3_tiles': return p.exploredTileIds.length;
    case 'most_dungeons': return p.dungeonsCompleted;
    case 'most_companions': return p.companions.length;
    case 'most_little_monsters': return p.littleMonsters.length;
    case 'most_big_monsters': return p.bigMonsters.length;
    case 'most_artifacts': return p.artifacts.length;
    default: return 0;
  }
}

function checkInstantQuest(state: AOState, seat: string, kind: string): void {
  const q = QUESTS.find((x) => x.kind === kind)!;
  if (questProgress(state, seat, kind) >= q.target!) claimQuest(state, seat, kind, q.name);
}

function checkExploreQuest(state: AOState, seat: string): void {
  checkInstantQuest(state, seat, 'explore_3_tiles');
}


function awardEndgameQuest(state: AOState, kind: string, count: (seat: string) => number): void {
  if (state.inPlayQuests[kind] !== 'unclaimed') return;
  const q = QUESTS.find((x) => x.kind === kind)!;
  const counts = state.playerOrder.map((s) => count(s));
  const max = Math.max(...counts);
  const winners = state.playerOrder.filter((s, i) => counts[i] === max);
  // RULES.md §8: strictly the most; a tie means no one gets the point.
  if (winners.length === 1 && max > 0) {
    claimQuest(state, winners[0] as string, kind, q.name);
  } else {
    log(state, `The quest "${q.name}" is unclaimed (tie or none).`, 'quest');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** A hex in table words: "the NE hex of Tile 3". */
export function hexLabel(state: AOState, key: string): string {
  return hexLabelOf(state.placedTiles, key);
}

export function nameOf(state: AOState, seat: string): string {
  const p = state.players[seat];
  const given = p?.name?.trim();
  if (given && given !== seat) return given;
  const list = Object.values(state.players).map((pl) => ({ player_id: pl.player_id, kind: pl.kind, name: pl.name }));
  return seatDisplayName(list, seat);
}

// Re-exports used by legalMoves/ai/tests.
export { tileCenter, slotHexes, localHexAbsolute, hexKey, neighbors, keyToHex, tileHexes, hexDistance };
export type { HexName };
