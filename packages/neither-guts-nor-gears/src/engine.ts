// Neither Guts nor Gears — engine (setup + round machine + economy + dispatch).
//
// applyMove is PURE: it clones the incoming state and never mutates the input
// (CLAUDE.md Game contract). Source of truth: the pinned rules text
// (src/verify/neither-guts-nor-gears/rules-v2026-09-21.txt) — an unpublished
// designer game with 74 integrated rulings, no reference implementation.
//
// Physical-first note (PORT-PLAN §4, Zeke's call 2026-09-21): the battle
// strategy deck is one server-owned set of 20 (§15.1). A human playing at the
// table draws the real card and REPORTS it (`report_draw`); the server takes
// that card out of its draw pile. AI and digital seats are dealt from the same
// pile (digital humans surface the value via the `resolve_report` button —
// docs/digital-mode.md).

import type { GameLogEntry, PlayerConfig } from '@zekel/game-kit';
import { isDigitalSeat } from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { pushLogEntry } from '@zekel/game-kit';
import {
  ACTION_CARD_RESEARCH, BATTLE_CARD_TYPE_ID,
  BATTLE_CARDS, cultureTargetFor, ECONOMIC_COLLECTORS_NEEDED, ECONOMIC_SPEND,
  FACTIONS, HEROES, BASE_MAX_MANA, MANA_PER_RESERVE, MAX_BASES, MAX_HEROES_PER_PLAYER,
  MAX_RESERVES, milestonesFor, MILITARY_KILLS_NEEDED, ROBOT_COLLECTOR_SUPPLY, TREATIES,
  TECH_TARGET, buildBattleDeck, costCoveredBy, costTotal, describeCost,
  heroStatsForCategory, researchForSpecies,
  type BattleCardId, type ResourceCost, type ResourceType, type Species, type TreatyType, type UnitDef,
  BATTLE_CARD_PURCHASE, battleCardUnlocked,
  TREATY_UNLOCK,
  unitsForSpecies,
} from './data/catalogs.js';
import { coordKey, layoutForPlayerCount, neighborsOf, tilesForLayout, type MapTile } from './data/maps.js';
import { collectorCapFor, coreSupplyFor, economicCollectorsNeeded } from './economicScale.js';
import {
  heroesEligibleFor, resolveBattleCard, resolveCoord, resolveFaction, resolveHero,
  resolvePurchasable, resolveResearch, resolveStartLocation, resolveTreaty,
  buildingById, researchById, unitById,
} from './resolvers.js';
import { randomInt, randomSeed, shuffle } from './rng.js';
import { treatyBreakGate } from './gates.js';
import { aiPickLeaderId, aiPickLocationId } from './ai.js';
import { commitPath } from './ai-eval.js';
import type {
  BaseInstance, CollectorPlacement, Coord, HeroInstance, MapUnit, NGGMove,
  NGGState, Pending, PlayerState, ResumeAction,
} from './types.js';
import { seatName, tileName } from './names.js';
import {
  refreshOverlay, armOverlayChoice, startBattle, sweepLocation, effectiveDef, killHero,
  removeMapUnit, settleBattle,
} from './engine-battle.js';

export interface NGGOptions {
  seed?: number;
  factionAssignment?: string[]; // balance harness (all-AI)
  /** Balance harness / tests: per-seat AI Leader picks, in seat order for AI
   *  seats (hero ids or printed names). Humans always choose their own. */
  aiLeaderAssignment?: string[];
  setupFirstPlayerId?: string; // tests/harness
  /** Experimental override: collectors the Economic spend needs
   *  (economicScale.ts). Integer >= 11; default half the map (ruling #89). */
  economicCollectors?: number;
  /** Balance harness: AI seats draw a seeded random start tile instead of
   *  picking one, so a start tile can be measured apart from pick order. */
  aiRandomStarts?: boolean;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function byId(state: NGGState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.playerId === playerId);
  if (!p) throw new GameError('PLAYER_NOT_FOUND', `No such player: ${playerId}`);
  return p;
}

export function speciesOf(p: PlayerState): Species {
  if (!p.species) throw new GameError('ILLEGAL_MOVE', `${p.playerId} has no species yet`);
  return p.species;
}

/** An action card's printed name. */
export function actionCardName(kind: 'build' | 'move_battle' | 'research'): string {
  return kind === 'move_battle' ? 'Move/Battle' : kind === 'build' ? 'Build' : 'Research';
}

export function log(state: NGGState, entry: Omit<GameLogEntry, 'seq' | 'turn'>): void {
  pushLogEntry(state.log, { turn: state.round, ...entry });
}

/** The short form of a key log entry: a headline for a player-facing log and,
 *  when the line is about one seat, how that seat reads it. Seat ids and
 *  coords are written raw, as in summaries; the log reader names them. */
export function key(
  headline: string,
  subject?: { id: string; line: string; loss?: boolean; notify?: boolean },
): Pick<GameLogEntry, 'headline' | 'subject' | 'subject_headline' | 'tone' | 'notify'> {
  return {
    headline,
    ...(subject ? {
      subject: subject.id, subject_headline: subject.line,
      ...(subject.loss ? { tone: 'loss' as const } : {}),
      ...(subject.notify ? { notify: [subject.id] } : {}),
    } : {}),
  };
}

/** The seats that must be told of a log entry (see GameLogEntry.notify). */
export function tell(ids: string[]): Pick<GameLogEntry, 'notify'> {
  const seats = [...new Set(ids)];
  return seats.length ? { notify: seats } : {};
}

/** Every seat taking part in the current battle. */
export function battleSeats(state: NGGState): string[] {
  const b = state.battle;
  if (!b) return [];
  return [...new Set([...b.units.map((u) => u.ownerId), ...Object.keys(b.sides ?? {})])];
}

/** "a" or "an" before a printed name. */
export function aOrAn(name: string): string {
  return /^[AEIOU]/i.test(name) ? 'an' : 'a';
}

export function tileAt(state: NGGState, coord: Coord): MapTile {
  const t = state.tiles.find((x) => coordKey(x.c, x.r) === coord);
  if (!t) throw new GameError('ILLEGAL_MOVE', `${coord} is not a tile on this map`);
  return t;
}

/** The tile's CURRENT resource, honoring an active economy overlay (§8.3). The
 *  overlay is active only while that Economy hero occupies the tile. */
export function effectiveResourceAt(state: NGGState, coord: Coord): ResourceType {
  const heroId = state.overlays.activeByCoord[coord];
  if (heroId) {
    const hero = state.heroes.find((h) => h.id === heroId && !h.dead && h.coord === coord);
    const res = hero ? overlayResourceOf(heroId) : null;
    if (res) return res;
  }
  return tileAt(state, coord).resource;
}

/** The resource an Economy hero's overlay makes its tile, or null. */
export function overlayResourceOf(heroId: string): ResourceType | null {
  switch (heroId) {
    case 'ida': return 'ore';
    case 'derrick': return 'oil';
    case 'mayhew': return 'ether';
    default: return null;
  }
}

// Location occupancy helpers (exported for battle/legalMoves).
/** Where a new base may go (ruling 55): a tile holding an owned unit or hero,
 *  no opposing one, and no base of anyone's already — even with zero bases.
 *  The one statement of the rule: the purchase check and the move list both
 *  read it. */
export function isBaseSite(state: NGGState, playerId: string, coord: Coord): boolean {
  if (state.bases.some((b) => b.coord === coord)) return false;
  // A Coreless platform is not a unit (§7.7): it neither qualifies the tile
  // nor blocks it.
  const pieces = [...unitsAt(state, coord).filter(isUnitPiece), ...heroesAt(state, coord)];
  return pieces.some((u) => u.ownerId === playerId) && !pieces.some((u) => u.ownerId !== playerId);
}

export function unitsAt(state: NGGState, coord: Coord): MapUnit[] {
  return state.units.filter((u) => u.coord === coord);
}
export function heroesAt(state: NGGState, coord: Coord): HeroInstance[] {
  return state.heroes.filter((h) => h.coord === coord && !h.dead);
}
export function collectorsAt(state: NGGState, coord: Coord): CollectorPlacement[] {
  return state.placements.filter((c) => c.coord === coord);
}
export function baseAt(state: NGGState, coord: Coord): BaseInstance | undefined {
  return state.bases.find((b) => b.coord === coord);
}

/** §7.7: a Coreless platform is not a unit. Every other piece in
 *  `state.units` is one (collectors and Subjects never sit there). */
export function isUnitPiece(u: MapUnit): boolean {
  const def = unitById(u.typeId);
  if (!def) return false;
  return !(def.needsCore && !u.allocatedCoreId);
}

/** §7.7: a Coreless platform is not a unit at all. A combat unit carries a
 *  printed Init/DMG/DEF line and (if a platform) has a Core. */
export function isCombatUnit(u: MapUnit): boolean {
  const def = unitById(u.typeId);
  if (!def) return false;
  if (def.needsCore && !u.allocatedCoreId) return false;
  return def.init !== null;
}

/** §6.1: another player's unit or base makes the location theirs. */
export function locationOwner(state: NGGState, coord: Coord): string | null {
  const b = baseAt(state, coord);
  if (b) return b.ownerId;
  const u = unitsAt(state, coord);
  if (u.length) return u[0]!.ownerId;
  const h = heroesAt(state, coord);
  if (h.length) return h[0]!.ownerId;
  const c = collectorsAt(state, coord);
  if (c.length) return c[0]!.ownerId;
  return null;
}

// Treaties -------------------------------------------------------------------

export function treatyBetween(state: NGGState, a: string, b: string, type: TreatyType): boolean {
  return state.treaties.some((t) => t.type === type && t.partners.includes(a) && t.partners.includes(b));
}
export function anyTreatyBetween(state: NGGState, a: string, b: string) {
  return state.treaties.filter((t) => t.partners.includes(a) && t.partners.includes(b));
}
/** Military allies = Open Borders OR Peace only (§9.1). */
export function areMilitaryAllies(state: NGGState, a: string, b: string): boolean {
  return treatyBetween(state, a, b, 'open-borders') || treatyBetween(state, a, b, 'peace');
}
/** Collection access = Open Borders OR Shared Resources (§6.2). */
export function hasCollectionAccess(state: NGGState, a: string, b: string): boolean {
  return treatyBetween(state, a, b, 'open-borders') || treatyBetween(state, a, b, 'shared-resources');
}

export function heroAlivePlaced(state: NGGState, playerId: string, heroId: string): boolean {
  const h = state.heroes.find((x) => x.id === heroId && x.ownerId === playerId);
  return !!h && !h.dead && h.coord !== null;
}

/** The seats whose units anchor a player's collectors: Shared Resources and
 *  Open Borders partners (§6.1/§6.2, ruling 8). */
export function anchorPartners(state: NGGState, playerId: string): string[] {
  return state.treaties
    .filter((t) => (t.type === 'open-borders' || t.type === 'shared-resources') && t.partners.includes(playerId))
    .map((t) => (t.partners[0] === playerId ? t.partners[1] : t.partners[0]));
}

// ---------------------------------------------------------------------------
// Collectors (§2, §6.1, §7.7): owned pieces that stay off the map (on the
// faction board) until placed to pay, then sit on the map until upkeep.
// ---------------------------------------------------------------------------

/** The resource a robot collector collects ("ore-collector-2" → ore); null
 *  for a Surf, which collects any resource. */
export function collectorResourceOf(collectorId: string): ResourceType | null {
  const m = collectorId.match(/^(water|wood|ore|oil|ether)-collector-\d+$/);
  return m ? (m[1] as ResourceType) : null;
}

export function ownedCollectorIds(p: PlayerState): string[] {
  return Object.keys(p.collectorsAvailable).filter((id) => (p.collectorsAvailable[id] ?? 0) > 0);
}

/** A robot collector works only with a Core (§6.1/§7.7); a Surf needs none. */
export function collectorPowered(p: PlayerState, collectorId: string): boolean {
  if (p.species !== 'robot') return true;
  return !(p.corelessCollectors ?? []).includes(collectorId);
}

/** The printed name of a collector piece ("Surf", "Ore collector"). */
export function collectorLabel(collectorId: string): string {
  const res = collectorResourceOf(collectorId);
  return res ? `${res[0]!.toUpperCase()}${res.slice(1)} collector` : 'Surf';
}

/** Every Core a robot seat owns: the off-map reserve, plus those in its map
 *  platforms and in its collectors. */
export function ownedCoreCount(state: NGGState, p: PlayerState): number {
  return p.coresInReserve
    + state.units.filter((u) => u.ownerId === p.playerId && u.allocatedCoreId !== null).length
    + (p.species === 'robot' ? ownedCollectorIds(p).filter((id) => collectorPowered(p, id)).length : 0);
}

/** A placed collector is destroyed (§2, §9.7): it leaves the map AND its
 *  owner's pieces — back to the purchase supply, to be bought again at full
 *  cost — and a robot collector's Core is destroyed with it. */
export function destroyCollector(state: NGGState, c: CollectorPlacement, cause: string): void {
  state.placements = state.placements.filter((x) => x !== c);
  const p = byId(state, c.ownerId);
  const powered = collectorPowered(p, c.collectorId);
  delete p.collectorsAvailable[c.collectorId];
  if (p.species === 'robot') {
    if (powered) p.coresInSupply += 1;
    if (p.corelessCollectors) p.corelessCollectors = p.corelessCollectors.filter((x) => x !== c.collectorId);
  }
  log(state, {
    phase: state.phase, actor: null, category: 'destroyed',
    ...key(`${c.ownerId}'s ${collectorLabel(c.collectorId)} at ${c.coord} was destroyed`, { id: c.ownerId, line: `Your ${collectorLabel(c.collectorId)} at ${c.coord} was destroyed`, loss: true, notify: true }), summary: `${seatName(state, c.ownerId)}'s ${collectorLabel(c.collectorId)} at ${tileName(c.coord)} is destroyed (${cause}) and goes back to the supply${p.species === 'robot' && powered ? '; its Core is destroyed with it' : ''}`,
  });
}

/** Sessions saved before robot collectors became off-map pieces kept each one
 *  as a map unit at its base, with supply slots in collectorsAvailable (1 =
 *  still in the supply). Rewrite such a state to the current shape, in place;
 *  a no-op once current. */
export function upgradeLegacyState(state: NGGState): NGGState {
  if (state.collectorModel === 2) return state;
  for (const p of state.players) {
    if (p.species !== 'robot') continue;
    const owned: Record<string, number> = {};
    const coreless: string[] = [];
    const rename = new Map<string, string>();
    const mine = state.units.filter((x) => x.ownerId === p.playerId && unitById(x.typeId)?.collector === true);
    for (const u of mine) {
      const res = unitById(u.typeId)!.collectorResource!;
      let n = 1;
      while (owned[`${res}-collector-${n}`]) n++;
      const id = `${res}-collector-${n}`;
      owned[id] = 1;
      if (!u.allocatedCoreId) coreless.push(id);
      rename.set(u.id.replace(/^u-/, ''), id);
    }
    state.units = state.units.filter((x) => !mine.includes(x));
    for (const c of state.placements) {
      const to = c.ownerId === p.playerId ? rename.get(c.collectorId) : undefined;
      if (to) c.collectorId = to;
    }
    p.collectorsAvailable = owned;
    if (coreless.length > 0) p.corelessCollectors = coreless;
  }
  state.collectorModel = 2;
  return state;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function createInitialState(
  players: PlayerConfig[],
  options: NGGOptions | undefined,
  seedIn?: number,
): NGGState {
  let seed = seedIn ?? options?.seed ?? randomSeed();
  const anyHuman = players.some((p) => p.kind === 'human');
  const n = players.length;
  const layout = layoutForPlayerCount(n);
  const tiles = tilesForLayout(layout);
  const econN = options?.economicCollectors ?? ECONOMIC_COLLECTORS_NEEDED;
  if (!Number.isInteger(econN) || econN < ECONOMIC_COLLECTORS_NEEDED) {
    throw new GameError('INVALID_OPTIONS', `economicCollectors must be an integer >= ${ECONOMIC_COLLECTORS_NEEDED}; got ${String(econN)}`);
  }
  // Ruling #89: the spend is half the map by default (economicScale.ts); an
  // explicit option is an experimental override and is stored on the state.
  const econDial = options?.economicCollectors === undefined ? {} : { economicCollectors: econN };
  const econScale = { layout, ...econDial };

  const ps: PlayerState[] = players.map((p) => ({
    playerId: p.player_id,
    kind: p.kind,
    ...(p.difficulty ? { difficulty: p.difficulty } : {}),
    ...(p.strategy ? { strategy: p.strategy } : {}),
    digital: isDigitalSeat(p),
    factionId: null,
    species: null,
    culture: 0,
    manaCurrent: 0,
    manaMax: 0,
    buildings: [],
    buildingCounts: {},
    research: [],
    acquiredTypes: [],
    leaderKills: 0,
    collectorsAvailable: {},
    coresInReserve: 0,
    coresInSupply: coreSupplyFor(econScale), // §2 Core supply per robot player: 15 plus the spend's extra (ruling #89)
    subjects: 0,
    actionCards: { build: 1, moveBattle: 1, research: 1 },
    actionCardsPlayed: [],
    heroExtraCards: {},
    hand: [],
    spyAssignments: [],
    knowledge: [],
  }));

  // §4.4: setup first player via the server's seeded RNG (a test/harness may
  // pin it). The choice is logged and disclosed, never silent.
  let setupFirstPlayerIndex: number;
  if (options?.setupFirstPlayerId) {
    const idx = players.findIndex((p) => p.player_id === options.setupFirstPlayerId);
    setupFirstPlayerIndex = idx >= 0 ? idx : 0;
  } else {
    const r = randomInt(seed, n);
    setupFirstPlayerIndex = r.value;
    seed = r.nextSeed;
  }

  const state: NGGState = {
    phase: 'setup_factions',
    round: 0,
    seed,
    layout,
    tiles,
    ...econDial,
    players: ps,
    setupFirstPlayerIndex,
    firstPlayerIndex: setupFirstPlayerIndex, // rotates at the first upkeep (ruling 14)
    planningOrder: [],
    actionStack: [],
    activeAction: null,
    bases: [],
    units: [],
    aiLeaderPicks: resolveAILeaderPicks(players, options),
    ...(options?.aiRandomStarts ? { aiRandomStarts: true } : {}),
    heroes: [],
    heroPool: HEROES.map((h) => h.id),
    placements: [],
    overlays: { activeByCoord: {} },
    battleDeck: [],
    battleDiscard: [],
    physicalDeckRemainder: {},
    cardOwners: {},
    treaties: [],
    battle: null,
    pending: null,
    claimsOwed: {},
    milestonesCrossed: {},
    collectorModel: 2,
    log: [],
    result: null,
    activePlayerId: players[setupFirstPlayerIndex]!.player_id,
  };

  // §4.8: prepare the shared hero pool and shuffled 20-card battle deck. The
  // server-held order serves AI/digital seats; physical seats report real-table
  // draws against physicalDeckRemainder (conservation).
  const shuffled = shuffle(buildBattleDeck().map((d) => d.instanceId), state.seed);
  state.seed = shuffled.nextSeed;
  state.battleDeck = shuffled.items;
  for (const c of BATTLE_CARDS) state.physicalDeckRemainder[c.id] = c.copies;

  if (!anyHuman) {
    autoAssignFactions(state, options?.factionAssignment);
    runAllAISetup(state);
  } else {
    // Each human picks their own faction, in seat order. The reporting seat
    // (the first human) may instead assign several at once (assign_setup_choices).
    armNextFactionPick(state);
  }
  return state;
}

/** The next human seat without a faction owes a pick; once every human has
 *  one, AI seats take what is left (their own choice, made by the AI) and the
 *  Leader draft begins. */
function armNextFactionPick(state: NGGState): void {
  const next = state.players.find((p) => p.kind === 'human' && !p.factionId);
  if (next) {
    state.pending = { kind: 'choose_faction', forPlayerId: next.playerId };
    state.activePlayerId = next.playerId;
    return;
  }
  state.pending = null;
  for (const p of state.players.filter((x) => !x.factionId)) {
    const taken = new Set(state.players.map((x) => x.factionId).filter(Boolean));
    const f = FACTIONS.find((x) => !taken.has(x.id))!;
    assignFaction(state, p, f.id);
  }
  state.phase = 'setup_leaders';
  state.planningOrder = playerOrderFrom(state, state.setupFirstPlayerIndex);
  armNextLeaderPick(state);
}

/** Why a seat may not take a faction now, or null. One statement of the rule
 *  for the move, the menu and the pending's options. */
export function factionPickShut(state: NGGState, factionId: string): string | null {
  const holder = state.players.find((p) => p.factionId === factionId);
  if (holder) return `${FACTIONS.find((f) => f.id === factionId)!.name} is already taken`;
  return null;
}

function doChooseFaction(state: NGGState, playerId: string, name: string): string {
  if (state.pending?.kind !== 'choose_faction' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No faction pick is owed by you');
  }
  const f = resolveFaction(name);
  const shut = factionPickShut(state, f.id);
  if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  assignFaction(state, byId(state, playerId), f.id);
  log(state, { phase: 'setup', actor: playerId, category: 'setup', summary: `${playerId} chooses ${f.name}` });
  armNextFactionPick(state);
  return `${playerId} chooses ${f.name}.`;
}

function autoAssignFactions(state: NGGState, assignment?: string[]): void {
  const n = state.players.length;
  let ids: string[];
  if (assignment && assignment.length > 0) {
    const picked = assignment.filter((f) => FACTIONS.some((x) => x.id === f));
    const rest = FACTIONS.map((f) => f.id).filter((f) => !picked.includes(f));
    ids = [...new Set([...picked, ...rest])].slice(0, n);
  } else {
    ids = FACTIONS.map((f) => f.id).slice(0, n);
  }
  state.players.forEach((p, i) => assignFaction(state, p, ids[i % ids.length]!));
}

export function assignFaction(state: NGGState, p: PlayerState, factionId: string): void {
  const f = FACTIONS.find((x) => x.id === factionId);
  if (!f) throw new GameError('ILLEGAL_MOVE', `Unknown faction "${factionId}"`);
  p.factionId = f.id;
  p.species = f.species;
  if (f.species === 'wizard') {
    // §4.7: own THREE Surfs at setup (designer ruling #100, 2026-09-26; two
    // before it). The map's spend count is the supply cap, not ownership.
    p.collectorsAvailable = { 'surf-1': 1, 'surf-2': 1, 'surf-3': 1 };
    p.manaMax = BASE_MAX_MANA;
    p.manaCurrent = BASE_MAX_MANA; // §4: wizards start at maximum mana 5
  } else {
    // Robots own their two starting water collectors from the starting
    // package (placeStartingPackage); the rest are bought within §2's supply.
    p.collectorsAvailable = {};
  }
}

/** Ruling #117 (2026-10-01; one under #106): free collectors Dowser Wren grants a robot when placed. */
export const DOWSER_COLLECTORS = 4;
/** Ruling #124 (2026-10-08): free Surfs Dowser Wren grants a wizard (four under #117). */
export const DOWSER_SURFS = 2;

/** Ruling #106: the collector types a robot may take from Dowser now — under
 *  the type's cap, with a Core to power it (supply first, then reserve). */
export function dowserCollectorOptions(state: NGGState, p: PlayerState): UnitDef[] {
  if (speciesOf(p) !== 'robot' || (p.coresInSupply <= 0 && p.coresInReserve <= 0)) return [];
  return unitsForSpecies('robot').filter((u) => u.collector && countOwnedUnitsOfType(state, p, u.id) < collectorCapFor(state, u));
}

function doChooseDowserCollector(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'choose_dowser_collector' }>): string {
  if (state.pending?.kind !== 'dowser_collector' || state.pending.forPlayerId !== playerId) throw new GameError('ILLEGAL_MOVE', 'No Dowser collector choice is open for you');
  const p = byId(state, playerId);
  const options = dowserCollectorOptions(state, p);
  const want = String(move.collector).trim().toLowerCase();
  const unit = options.find((u) => u.name.toLowerCase() === want || u.id === want || u.id === want.replace(/\s+/g, '-'));
  if (!unit) throw new GameError('ILLEGAL_MOVE', `Choose one of: ${options.map((u) => u.name).join(', ') || 'none'}`);
  const prefix = `${unit.collectorResource}-collector`;
  const id = Array.from({ length: collectorCapFor(state, unit) }, (_, i) => `${prefix}-${i + 1}`).find((x) => !p.collectorsAvailable[x])!;
  if (p.coresInSupply > 0) p.coresInSupply -= 1; else p.coresInReserve -= 1;
  p.collectorsAvailable[id] = 1;
  if (!p.acquiredTypes.includes(unit.id)) p.acquiredTypes.push(unit.id);
  const remaining = (state.pending.remaining ?? 1) - 1;
  state.pending = null;
  log(state, { phase: state.phase, actor: playerId, category: 'hero', summary: `${playerId}'s Dowser grants a free ${unit.name} with a Core in it` });
  if (checkVictory(state, playerId)) return `${playerId} takes a free ${unit.name} from Dowser.`;
  // Ruling #117: four collectors, picked one at a time; the grant stops early
  // when no type is left under its cap with a Core to spare.
  if (remaining > 0 && dowserCollectorOptions(state, p).length > 0) {
    state.pending = { kind: 'dowser_collector', forPlayerId: playerId, remaining };
    return `${playerId} takes a free ${unit.name} from Dowser (${remaining} more to pick).`;
  }
  if (remaining > 0) log(state, { phase: state.phase, actor: playerId, category: 'hero', summary: `${playerId}'s Dowser grants nothing more — no collector type under its cap with a Core to spare` });
  resumeAfterReward(state, playerId);
  return `${playerId} takes a free ${unit.name} from Dowser.`;
}

/** Player order starting at an index, wrapping. */
export function playerOrderFrom(state: NGGState, startIndex: number): string[] {
  const n = state.players.length;
  return Array.from({ length: n }, (_, i) => state.players[(startIndex + i) % n]!.playerId);
}

/** Resolve NGGOptions.aiLeaderAssignment (ordered per AI seat) into a
 *  Record<playerId, heroId-or-name>. Returns undefined when unset. */
function resolveAILeaderPicks(players: PlayerConfig[], options?: NGGOptions): Record<string, string> | undefined {
  if (!options?.aiLeaderAssignment) return undefined;
  const aiSeats = players.filter((p) => p.kind === 'ai');
  const out: Record<string, string> = {};
  aiSeats.forEach((p, i) => {
    const pick = options.aiLeaderAssignment![i];
    if (pick) out[p.player_id] = pick;
  });
  return out;
}

// ---------------------------------------------------------------------------
// All-AI auto-setup (harness path): deterministic picks, no handshake.
// ---------------------------------------------------------------------------

function runAllAISetup(state: NGGState): void {
  const order = playerOrderFrom(state, state.setupFirstPlayerIndex);
  for (const pid of order) {
    const p = byId(state, pid);
    grantLeader(state, p, aiLeaderPick(state, p));
  }
  // easy = uniform-random over the legal set, at setup as in play: a seeded
  // random start tile (the Leader pick above already randomises for easy).
  const easyPick = (pid: string, n: number): number => {
    const salt = state.round * 7919 + state.log.length * 131 + pid.length * 17 + n;
    return randomInt((state.seed ^ salt) >>> 0, n).value;
  };
  const starts = state.tiles.filter((t) => t.start != null).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const reverseOrder = [...order].reverse();
  const used = new Set<Coord>();
  reverseOrder.forEach((pid) => {
    const avail = starts.filter((t) => !used.has(coordKey(t.c, t.r)));
    if (avail.length === 0) throw new GameError('ILLEGAL_MOVE', 'No unoccupied numbered starting location left');
    // ai-development §6: the AI picks its start tactically (neighborhood feeds
    // its path), not just "the lowest-numbered free start".
    const tile = avail.length === 1
      ? avail[0]!
      : byId(state, pid).difficulty === 'random' || state.aiRandomStarts
      ? avail[easyPick(pid, avail.length)]!
      : (() => {
          const coord = aiPickLocationId(state, byId(state, pid), avail.map((t) => coordKey(t.c, t.r)), byId(state, pid).strategy);
          return avail.find((t) => coordKey(t.c, t.r) === coord)!;
        })();
    used.add(coordKey(tile.c, tile.r));
    placeStartingPackage(state, byId(state, pid), coordKey(tile.c, tile.r));
  });
  // All-AI: resolve any leader-grant draws server-side (Chaimidious AI Leader).
  for (const p of state.players) {
    while (state.pending?.kind === 'report_draw' && state.pending.forPlayerId === p.playerId) {
      dealServerBattleCard(state, p);
      state.pending = null;
    }
    while (state.pending?.kind === 'smyth_reward' && state.pending.forPlayerId === p.playerId) {
      const def = researchFreePick(state, p);
      p.research.push(def);
      if (!p.acquiredTypes.includes(def)) p.acquiredTypes.push(def);
      state.pending = null;
    }
  }
  state.pending = null;
  beginRoundOne(state);
}

function researchFreePick(state: NGGState, p: PlayerState): string {
  const list = researchForSpecies(speciesOf(p)).filter((r) => !p.research.includes(r.id));
  const open = list.find((r) => researchPrerequisiteShut(state, p, r) === null) ?? list[0];
  if (!open) throw new GameError('ILLEGAL_MOVE', 'No unresearched technology remains');
  return open.id;
}

// ---------------------------------------------------------------------------
// Setup moves (human path)
// ---------------------------------------------------------------------------

function doAssignSetupChoices(state: NGGState, playerId: string, selections: Record<string, string>): string {
  if (state.phase !== 'setup_factions') throw new GameError('ILLEGAL_MOVE', 'Not in faction setup');
  const reporter = state.players.find((p) => p.kind === 'human')?.playerId;
  if (reporter && playerId !== reporter) throw new GameError('ILLEGAL_MOVE', `Only the reporting player (${reporter}) assigns factions`);
  // Any subset of the seats still without a faction; the rest pick their own.
  const named = state.players.filter((p) => selections[p.playerId]);
  if (named.length === 0) throw new GameError('ILLEGAL_MOVE', 'Name a faction for at least one seat');
  const used = new Set<string>(state.players.map((p) => p.factionId).filter((x): x is string => !!x));
  for (const p of named) {
    if (p.factionId) throw new GameError('ILLEGAL_MOVE', `${p.playerId} already has a faction`);
    const f = resolveFaction(selections[p.playerId]!);
    if (used.has(f.id)) throw new GameError('ILLEGAL_MOVE', `Two players cannot share ${f.name}`);
    used.add(f.id);
  }
  for (const p of named) assignFaction(state, p, resolveFaction(selections[p.playerId]!).id);
  armNextFactionPick(state);
  if (state.phase === 'setup_factions') {
    return `Factions assigned: ${named.map((p) => `${p.playerId}=${FACTIONS.find((f) => f.id === p.factionId)!.name}`).join(', ')}. ${state.pending?.forPlayerId} picks next.`;
  }
  return `Factions assigned: ${state.players.map((p) => `${p.playerId}=${FACTIONS.find((f) => f.id === p.factionId)!.name}`).join(', ')}. Leader draft begins with ${state.players[state.setupFirstPlayerIndex]!.playerId}.`;
}

/** The AI's Leader pick: the scripted pick from options, else a tactical pick
 *  from ai.ts (path-lean; species-recommended as the default), else the first
 *  eligible. Deterministic. */
/** The opening: the rounds an AI seat plays its drawn goal without switching
 *  (the designer's call, 2026-10-08: a Military goal needs a round or two to
 *  buy attackers before it can be judged). The early pivot follows (ai-eval.ts). */
export const AI_OPENING_ROUNDS = 2;

/** Not a rule: an adaptive AI seat (no strategy lever, not the random floor)
 *  draws its opening way to win at random, seeded per seat (the designer's
 *  ask, 2026-10-08: AIs should not all chase the same path; each picks its
 *  Leader for its goal and plays it for the opening rounds, then may pivot
 *  early to a clearly faster path).
 *  AI-private, like the rest of aiPlan. */
function drawOpeningGoal(state: NGGState, p: PlayerState): void {
  if (p.kind !== 'ai' || p.strategy || p.difficulty === 'random' || p.aiPlan) return;
  const paths = ['military', 'cultural', 'technological', 'economic'] as const;
  const seat = state.players.findIndex((x) => x.playerId === p.playerId);
  const path = paths[randomInt((state.seed ^ (seat * 7919 + 104729)) >>> 0, paths.length).value]!;
  p.aiPlan = { path, since: 0, openingUntil: AI_OPENING_ROUNDS };
}

function aiLeaderPick(state: NGGState, p: PlayerState): string {
  drawOpeningGoal(state, p);
  const scripted = state.aiLeaderPicks?.[p.playerId];
  const eligible = heroesEligibleFor(speciesOf(p)).filter((h) => state.heroPool.includes(h.id));
  if (scripted) {
    const hero = HEROES.find((h) => h.id === scripted || h.name === scripted);
    if (hero && eligible.some((x) => x.id === hero.id)) return hero.id;
  }
  if (eligible.length === 0) throw new GameError('ILLEGAL_MOVE', 'No eligible Leader');
  if (p.difficulty === 'random') {
    // The random floor drafts at random too (seeded), so the tier ladder
    // separates on setup as well as play.
    const salt = state.log.length * 131 + p.playerId.length * 17 + eligible.length;
    return eligible[randomInt((state.seed ^ salt) >>> 0, eligible.length).value]!.id;
  }
  // ai-development §6: the AI picks its Leader tactically, not "first eligible";
  // a strategy seat drafts for its archetype (tech → Kettering/Smyth, …), an
  // adaptive seat for its drawn opening goal.
  return aiPickLeaderId(state, p, eligible.map((h) => h.id), p.strategy ?? p.aiPlan?.path);
}

function armNextLeaderPick(state: NGGState): void {
  while (state.planningOrder.length > 0) {
    const pid = state.planningOrder[0]!;
    const p = byId(state, pid);
    if (p.kind === 'ai') {
      grantLeader(state, p, aiLeaderPick(state, p));
      state.planningOrder.shift();
      // A Leader's own reward (Smyth's free technology) is the AI seat's
      // decision to make; the draft resumes once it is settled.
      if (state.pending) return;
      continue;
    }
    state.pending = { kind: 'choose_leader', forPlayerId: pid };
    state.activePlayerId = pid;
    return;
  }
  state.phase = 'setup_locations';
  state.planningOrder = [...playerOrderFrom(state, state.setupFirstPlayerIndex)].reverse();
  armNextLocationPick(state);
}

function doChooseLeader(state: NGGState, playerId: string, heroName: string): string {
  if (state.phase !== 'setup_leaders') throw new GameError('ILLEGAL_MOVE', 'Not in the Leader draft');
  if (state.pending?.kind !== 'choose_leader' || state.pending.forPlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', 'It is not your turn to choose a Leader');
  }
  const p = byId(state, playerId);
  const hero = resolveHero(heroName);
  state.pending = null; // this pick is settling; a grant may re-arm a nested one
  grantLeader(state, p, hero.id);
  state.planningOrder.shift();
  // A Leader benefit may open a nested pending (Chaimidious's draw / Smyth's
  // waived pick) — it blocks before the next draft pick (§15.2: settle first).
  if (state.pending) return `${playerId} chooses ${hero.name} as Leader (+2 DEF). ${describePending(state.pending)} settles first.`;
  armNextLeaderPick(state);
  return `${playerId} chooses ${hero.name} as Leader (+2 DEF).`;
}

function armNextLocationPick(state: NGGState): void {
  while (state.planningOrder.length > 0) {
    const pid = state.planningOrder[0]!;
    const p = byId(state, pid);
    if (p.kind === 'ai') {
      const starts = state.tiles.filter((t) => t.start != null).filter((t) => !state.bases.some((b) => b.coord === coordKey(t.c, t.r)));
      const tile = starts[0]!;
      placeStartingPackage(state, p, coordKey(tile.c, tile.r));
      state.planningOrder.shift();
      continue;
    }
    state.pending = { kind: 'choose_starting_location', forPlayerId: pid };
    state.activePlayerId = pid;
    return;
  }
  beginRoundOne(state);
}

function doChooseStartingLocation(state: NGGState, playerId: string, location: string): string {
  if (state.phase !== 'setup_locations') throw new GameError('ILLEGAL_MOVE', 'Not in starting-location setup');
  if (state.pending?.kind !== 'choose_starting_location' || state.pending.forPlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', 'It is not your turn to choose a starting location');
  }
  const coord = resolveStartLocation(state.tiles, location);
  if (state.bases.some((b) => b.coord === coord)) throw new GameError('ILLEGAL_MOVE', `Starting location ${location} is already occupied`);
  placeStartingPackage(state, byId(state, playerId), coord);
  state.pending = null;
  state.planningOrder.shift();
  armNextLocationPick(state);
  return `${playerId} starts at ${coord} with their free base and Leader.`;
}

/** §4.5: Leader grant — hero from the pool to the seat, +2 DEF as a read-time
 *  flag (isLeader drives it at stat computation), benefits apply (ruling 46/63,
 *  §15.4: Chaimidious's card is a DIRECT grant — no Embassy/DRS needed). */
export function grantLeader(state: NGGState, p: PlayerState, heroId: string): void {
  const def = HEROES.find((h) => h.id === heroId);
  if (!def) throw new GameError('ILLEGAL_MOVE', `No such hero: ${heroId}`);
  if (!state.heroPool.includes(heroId)) throw new GameError('ILLEGAL_MOVE', `${def.name} is not in the hero pool`);
  if (def.species && def.species !== speciesOf(p)) {
    throw new GameError('ILLEGAL_MOVE', `${def.name} is ${def.species}-only`);
  }
  state.heroPool = state.heroPool.filter((h) => h !== heroId);
  state.heroes.push({ id: heroId, ownerId: p.playerId, coord: null, isLeader: true, dead: false });
  log(state, { phase: 'setup', actor: p.playerId, category: 'setup', ...key(`${p.playerId} drafted ${def.name} as Leader`, { id: p.playerId, line: `You drafted ${def.name} as Leader` }), summary: `${p.playerId} takes ${def.name} as Leader (+2 DEF)` });
  applyHeroBenefit(state, p, heroId);
}

/** The hero's printed benefit. One-time grants fire on ownership (placement-
 *  gated: reserved heroes get none until placed — ruling 49). */
export function applyHeroBenefit(state: NGGState, p: PlayerState, heroId: string): void {
  const hero = state.heroes.find((h) => h.id === heroId && h.ownerId === p.playerId);
  // Reserved heroes (no base) get NO benefit until placed (ruling 49) — except
  // that the Leader is always placed immediately at a starting location, so a
  // Leader grant here is always "placed-pending-coord" and fires the benefit.
  const isLeaderGrant = hero?.isLeader === true;
  if (hero && hero.coord === null && !isLeaderGrant) return;
  switch (heroId) {
    case 'chaimidious': {
      // "Gain a battle strategy card" — a direct reward draw (§15.4). The
      // reason keys the resume: the setup Leader draft vs a milestone claim.
      // Ruling #122 (2026-10-01): the card counts as the battle strategy card
      // type for technology, like a bought one (#87) — one point, once. If
      // that point completes the target the game ends here, before the draw.
      if (!p.acquiredTypes.includes(BATTLE_CARD_TYPE_ID)) {
        p.acquiredTypes.push(BATTLE_CARD_TYPE_ID);
        if (!state.phase.startsWith('setup') && checkVictory(state, p.playerId)) break;
      }
      drawBattleCard(state, p, (isLeaderGrant && state.phase !== 'claims') ? 'leader-grant' : 'hero-reward');
      break;
    }
    case 'wren': {
      // Rulings #106 / #117 / #124: free collectors at once — DOWSER_SURFS
      // Surfs for a wizard; DOWSER_COLLECTORS for a robot, which picks each
      // type, each with a Core (supply first, then reserve). The grant stops
      // at the supply's cap.
      if (speciesOf(p) === 'wizard') {
        const cap = collectorCapFor(state, unitById('surf')!);
        let granted = 0;
        for (let n = 0; n < DOWSER_SURFS; n++) {
          const id = Array.from({ length: cap }, (_, i) => `surf-${i + 1}`).find((x) => !p.collectorsAvailable[x]);
          if (!id) break;
          p.collectorsAvailable[id] = 1;
          granted += 1;
        }
        if (granted === 0) { log(state, { phase: state.phase, actor: p.playerId, category: 'hero', summary: `${p.playerId}'s Dowser grants nothing — every Surf is already owned` }); break; }
        if (!p.acquiredTypes.includes('surf')) p.acquiredTypes.push('surf');
        log(state, { phase: state.phase, actor: p.playerId, category: 'hero', summary: `${p.playerId}'s Dowser grants ${granted} free Surf${granted === 1 ? '' : 's'}` });
        break;
      }
      if (dowserCollectorOptions(state, p).length === 0) {
        log(state, { phase: state.phase, actor: p.playerId, category: 'hero', summary: `${p.playerId}'s Dowser grants nothing — no collector type under its cap with a Core to spare` });
        break;
      }
      state.pending = { kind: 'dowser_collector', forPlayerId: p.playerId, remaining: DOWSER_COLLECTORS };
      state.activePlayerId = p.playerId;
      break;
    }
    case 'smyth': {
      // Waived-cost research pick; a reserved Smyth waits for placement (§8.4).
      if (state.pending?.kind === 'smyth_reward' && state.pending.forPlayerId === p.playerId) break;
      if (state.heroes.some((h) => h.ownerId === p.playerId && h.id === 'smyth' && !h.dead)) {
        // Nothing left to pick ⇒ no pending (a pick with zero options stranded
        // the balance harness 2026-09-22: a technological seat that had
        // researched its whole list, then placed Smyth).
        const remaining = researchForSpecies(speciesOf(p)).filter((r) => !p.research.includes(r.id));
        if (remaining.length === 0) {
          log(state, { phase: state.phase, actor: p.playerId, category: 'hero', summary: `${p.playerId}'s Smyth reward grants nothing — every technology is already researched` });
          break;
        }
        state.pending = { kind: 'smyth_reward', forPlayerId: p.playerId };
        state.activePlayerId = p.playerId;
      }
      break;
    }
    case 'marshal': p.heroExtraCards.moveBattle = heroId; p.actionCards.moveBattle += 1; break;
    case 'quartermaster': p.heroExtraCards.build = heroId; p.actionCards.build += 1; break;
    case 'archivist': p.heroExtraCards.research = heroId; p.actionCards.research += 1; break;
    default: break; // Motherboard/Greymore's bonus point computes live in techTotal.
  }
}

/** §4.6–4.8: free starting base + Leader at the chosen start; wizard Surfs
 *  stay off-map; robot 4 Cores in two water + two wood collectors (and
 *  count toward per-type supply); starting pieces seed acquired-type progress. */
function placeStartingPackage(state: NGGState, p: PlayerState, coord: Coord): void {
  const species = speciesOf(p);
  const baseType = species === 'wizard' ? 'castle' : 'home';
  state.bases.push({ id: `base-${p.playerId}-start`, ownerId: p.playerId, coord });
  const leader = state.heroes.find((h) => h.ownerId === p.playerId && h.isLeader && !h.dead);
  if (leader) leader.coord = coord;
  refreshOverlay(state, coord); // an Economy Leader's overlay starts at once (§8.3)
  if (species === 'robot') {
    // §4.7 (designer rulings #81, #85): four Cores powering two water and
    // two wood collectors. Collectors stay on the faction board until placed
    // to pay (§6.1). Each takes the next free id: a robot with Dowser as its
    // Leader already holds her four, picked at the draft, and a fixed id would
    // overwrite one of them (losing the collector and its Core).
    p.coresInSupply -= 4;
    for (const res of ['water', 'water', 'wood', 'wood'] as const) {
      let n = 1;
      while (p.collectorsAvailable[`${res}-collector-${n}`]) n++;
      p.collectorsAvailable[`${res}-collector-${n}`] = 1;
    }
    seedAcquiredTypes(p, ['core', 'water-collector', 'wood-collector', baseType]);
  } else {
    seedAcquiredTypes(p, ['surf', baseType]);
  }
  log(state, { phase: 'setup', actor: p.playerId, category: 'setup', ...key(`${p.playerId} started at ${coord}`, { id: p.playerId, line: `You started at ${coord}` }), summary: `${p.playerId} places their starting ${species === 'wizard' ? 'Castle' : 'Home'} and Leader at ${coord}` });
}

function seedAcquiredTypes(p: PlayerState, typeIds: string[]): void {
  for (const t of typeIds) if (!p.acquiredTypes.includes(t)) p.acquiredTypes.push(t);
}

// ---------------------------------------------------------------------------
// Round machine (§5): upkeep → planning → action → culture → claims → end.
// ---------------------------------------------------------------------------

function beginRoundOne(state: NGGState): void {
  state.round = 0; // upkeep bumps it to 1
  runUpkeep(state);
}

/** §5.1 upkeep, step by step; human robot reallocation is an optional pending. */
export function runUpkeep(state: NGGState): void {
  state.phase = 'upkeep';
  state.round += 1;
  log(state, { phase: 'upkeep', actor: null, category: 'phase', ...key('Upkeep'), summary: `— Round ${state.round} upkeep —` });
  // 1. Rotate the first-player token (incl. before round one's planning — r14).
  state.firstPlayerIndex = (state.firstPlayerIndex + 1) % state.players.length;
  // 2. Retrieve collectors from the map.
  if (state.placements.length > 0) {
    log(state, { phase: 'upkeep', actor: null, category: 'phase', summary: `Upkeep: ${state.placements.length} committed collector(s) return to availability` });
    state.placements = [];
  }
  // Ruling #101: Haste's bank of surplus production empties with the round.
  for (const p of state.players) if (p.bank && Object.keys(p.bank).length > 0) p.bank = {};
  // 5 later, but action cards: return played cards; remove dead-hero extras.
  for (const p of state.players) {
    p.actionCardsPlayed = [];
    for (const kind of ['build', 'moveBattle', 'research'] as const) {
      const granter = p.heroExtraCards[kind];
      if (granter) {
        const hero = state.heroes.find((h) => h.id === granter && h.ownerId === p.playerId);
        if (!hero || hero.dead) {
          p.actionCards[kind] -= 1;
          delete p.heroExtraCards[kind];
          log(state, { phase: 'upkeep', actor: p.playerId, category: 'action-card-removed', summary: `${p.playerId}'s extra ${kind} card leaves with its hero's death` });
        }
      }
    }
  }
  // 4. Wizards reset mana.
  for (const p of state.players) if (p.species === 'wizard') p.manaCurrent = p.manaMax;
  // Not a rule: each adaptive AI seat writes down its way to win for the
  // round (ai-eval.ts commitPath), so the hard AI keeps to a plan. AI-private.
  for (const p of state.players) {
    if (p.kind !== 'ai' || p.strategy || !p.species) continue;
    const plan = commitPath(state, p);
    if (plan) p.aiPlan = plan; else delete p.aiPlan;
  }
  // 3. Core reallocation: each robot seat may move its Cores, in first-player
  //    order (§5.6), one decision each.
  resumeUpkeepFrom(state, null);
}

/** Everything a robot seat's Cores can sit in: its map platforms and its
 *  collectors (all off the map at upkeep). `id` is the key a
 *  reallocate_cores move names. */
export function coreSlots(state: NGGState, p: PlayerState): Array<{ id: string; label: string; where: string | null; powered: boolean }> {
  const out: Array<{ id: string; label: string; where: string | null; powered: boolean }> = [];
  for (const u of state.units) {
    if (u.ownerId !== p.playerId || !unitById(u.typeId)?.needsCore) continue;
    out.push({ id: u.id, label: unitById(u.typeId)!.name, where: u.coord, powered: u.allocatedCoreId !== null });
  }
  if (p.species === 'robot') {
    for (const id of ownedCollectorIds(p)) out.push({ id, label: collectorLabel(id), where: null, powered: collectorPowered(p, id) });
  }
  return out;
}

/** §5.1 step 3: every robot seat that owns a Core and something to put it in
 *  is asked, in first-player order — also when every Core is already in use,
 *  since freeing one into the reserve is a legal choice (+1 culture). */
function resumeUpkeepFrom(state: NGGState, lastAsked: string | null): void {
  const order = playerOrderFrom(state, state.firstPlayerIndex);
  const start = lastAsked === null ? 0 : order.indexOf(lastAsked) + 1;
  for (const pid of order.slice(start)) {
    const p = byId(state, pid);
    if (p.species !== 'robot') continue;
    if (coreSlots(state, p).length === 0 || ownedCoreCount(state, p) === 0) continue;
    state.pending = { kind: 'upkeep_reallocate_cores', forPlayerId: pid };
    state.activePlayerId = pid;
    return;
  }
  beginPlanning(state);
}

function doReallocateCores(state: NGGState, playerId: string, allocations: Record<string, boolean>): string {
  if (state.pending?.kind !== 'upkeep_reallocate_cores' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No Core reallocation is owed by you');
  }
  const p = byId(state, playerId);
  if (!allocations || typeof allocations !== 'object') throw new GameError('INVALID_MOVE_SHAPE', 'allocations maps each platform or collector id to true (powered) or false (Core to reserve)');
  const slots = coreSlots(state, p);
  for (const key of Object.keys(allocations)) {
    if (!slots.some((x) => x.id === key)) {
      throw new GameError('ILLEGAL_MOVE', `${key} is not one of your platforms or collectors (${slots.map((x) => x.id).join(', ') || 'none'})`);
    }
  }
  const setPowered = (id: string, on: boolean): void => {
    const u = state.units.find((x) => x.id === id);
    if (u) { u.allocatedCoreId = on ? `core-${playerId}-${id}` : null; return; }
    const off = (p.corelessCollectors ?? []).filter((x) => x !== id);
    p.corelessCollectors = on ? off : [...off, id];
  };
  const ownedTotal = ownedCoreCount(state, p);
  // Two-phase: release every slot marked false into the reserve, then power
  // every slot marked true from the reserve. Owned Cores are conserved.
  for (const slot of slots) {
    if (allocations[slot.id] === false && slot.powered) { setPowered(slot.id, false); p.coresInReserve += 1; }
  }
  for (const slot of slots) {
    if (allocations[slot.id] === true && !slot.powered) {
      if (p.coresInReserve <= 0) throw new GameError('ILLEGAL_MOVE', `No free Core for ${slot.label} — you own ${ownedTotal} Core(s) in all`);
      p.coresInReserve -= 1;
      setPowered(slot.id, true);
    }
  }
  if (p.corelessCollectors && p.corelessCollectors.length === 0) delete p.corelessCollectors;
  const after = coreSlots(state, p);
  state.pending = null;
  log(state, { phase: 'upkeep', actor: playerId, category: 'upkeep', summary: `${playerId} arranges their Cores: ${after.filter((x) => x.powered).length} of ${after.length} platform(s)/collector(s) powered, ${p.coresInReserve} in reserve${after.some((x) => !x.powered) ? ` (no Core: ${after.filter((x) => !x.powered).map((x) => x.where ? `${x.label} at ${x.where}` : x.label).join(', ')})` : ''}` });
  resumeUpkeepFrom(state, playerId);
  return 'Cores reallocated.';
}

function beginPlanning(state: NGGState): void {
  state.phase = 'planning';
  state.planningOrder = playerOrderFrom(state, state.firstPlayerIndex);
  state.actionStack = [];
  state.activeAction = null;
  state.activePlayerId = state.planningOrder[0]!;
  log(state, { phase: 'planning', actor: null, category: 'phase', ...key(`Planning: ${state.activePlayerId} places first`), summary: `Round ${state.round} planning: ${state.activePlayerId} places first` });
}

function doPlanAction(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'plan_action' }>): string {
  if (state.phase !== 'planning') throw new GameError('ILLEGAL_MOVE', 'Not the planning phase');
  const head = state.planningOrder[0];
  if (head !== playerId) throw new GameError('NOT_YOUR_TURN', `Planning is on ${head}, not ${playerId}`);
  const p = byId(state, playerId);
  if (move.card === 'pass') {
    // §5.2: passing is final for the round.
    state.planningOrder = state.planningOrder.filter((pid) => pid !== playerId);
    log(state, { phase: 'planning', actor: playerId, category: 'planning', ...key(`${playerId} passed for the round`, { id: playerId, line: 'You passed for the round' }), summary: `${playerId} passes (final for the round)` });
    if (state.planningOrder.length === 0) beginActionPhase(state);
    else state.activePlayerId = state.planningOrder[0]!;
    return `${playerId} passes for the round.`;
  }
  const kindKey = move.card === 'move_battle' ? 'moveBattle' : move.card;
  const which = move.which ?? 'base';
  // Three copies of each card exist: the printed one, a hero's (Marshal /
  // Quartermaster / Archivist) and a researched one (ruling #86).
  if (which === 'hero_extra' && !p.heroExtraCards[kindKey]) {
    throw new GameError('ILLEGAL_MOVE', `You hold no hero-granted extra ${move.card} card`);
  }
  if (which === 'researched_extra' && !hasResearchedCard(p, kindKey)) {
    throw new GameError('ILLEGAL_MOVE', `You have not researched the extra ${move.card} card`);
  }
  const slotId = `${move.card}:${which}`;
  if (p.actionCardsPlayed.includes(slotId)) {
    throw new GameError('ILLEGAL_MOVE', `That ${move.card} card was already placed this round (each card once per round)`);
  }
  const playedOfKind = p.actionCardsPlayed.filter((s) => s.startsWith(`${move.card}:`)).length;
  if (playedOfKind >= p.actionCards[kindKey]) {
    throw new GameError('ILLEGAL_MOVE', `No unused ${move.card} card remains (you hold ${p.actionCards[kindKey]}, already placed ${playedOfKind})`);
  }
  state.actionStack.push({ ownerId: playerId, cardKind: move.card, slotId });
  p.actionCardsPlayed.push(slotId);
  // §5.2: the card goes down FACE DOWN — the log and the move's summary (both
  // read to the whole table) never name its kind; only its owner's view does.
  log(state, { phase: 'planning', actor: playerId, category: 'planning', ...key(`${playerId} placed an action card face down`, { id: playerId, line: 'You placed an action card face down' }), summary: `${playerId} places an action card face down on the Action Stack` });
  // Rotate within the not-yet-passed seats; passed seats are gone.
  state.planningOrder.push(state.planningOrder.shift()!);
  state.activePlayerId = state.planningOrder[0]!;
  return `${playerId} places an action card face down on the Action Stack.`;
}

function beginActionPhase(state: NGGState): void {
  state.phase = 'action';
  log(state, { phase: 'action', actor: null, category: 'phase', ...key(`Action phase: ${state.actionStack.length} cards on the stack resolve, last placed first`), summary: `Action phase: the ${state.actionStack.length} cards on the Action Stack resolve from the top down (last placed goes first)` });
  advanceActionStack(state);
}

/** Pop the top of the stack (LIFO) and let its owner perform or skip it. */
export function advanceActionStack(state: NGGState): void {
  if (state.actionStack.length > 0) {
    const top = state.actionStack[state.actionStack.length - 1]!;
    state.activeAction = top;
    state.activePlayerId = top.ownerId;
    // The pop is the reveal (design 2026-09-21: cards go down face-down; the
    // stack reads "X reveals Build" the moment it becomes live).
    log(state, { phase: 'action', actor: top.ownerId, category: 'action', ...key(`${top.ownerId} played ${actionCardName(top.cardKind)}`, { id: top.ownerId, line: `You played ${actionCardName(top.cardKind)}` }), summary: `${top.ownerId} turns over the top card of the Action Stack: ${actionCardName(top.cardKind)}` });
    return;
  }
  state.activeAction = null;
  beginCulturePhase(state);
}

/** One card on the stack. A slot ("build:base") names a card within one
 *  seat's hand, so every seat has the same slots: a card is its owner AND its
 *  slot. Matching on the slot alone took every seat's card of that kind off
 *  the stack when one resolved. */
export function sameStackCard(a: { ownerId: string; slotId: string }, b: { ownerId: string; slotId: string }): boolean {
  return a.ownerId === b.ownerId && a.slotId === b.slotId;
}

/** The action's effects are finished. §5.3/§11.1 allow treaty formation at the
 *  END of the active player's action as well as its start: when its owner has
 *  an offer they could make, the card stays open in its end window (treaty
 *  offers, or finish) before the stack advances. */
export function finishActionCard(state: NGGState): void {
  // Finishing the card ends any second-purchase right that rode on it; a
  // stale second_purchase pending survived into the next round's planning
  // (ai-development batch 2026-09-22) and stranded the game.
  if (state.pending?.kind === 'second_purchase') state.pending = null;
  const done = state.activeAction;
  if (done && !done.endWindow && !state.result && openTreatyOffers(state, done.ownerId).length > 0) {
    done.endWindow = true;
    state.activePlayerId = done.ownerId;
    log(state, { phase: 'action', actor: done.ownerId, category: 'action', summary: `${done.ownerId}'s ${actionCardName(done.cardKind)} action is done; they may offer a treaty before it ends` });
    return;
  }
  closeActionCard(state);
}

/** Take the resolving card off the stack and reveal the next one. */
function closeActionCard(state: NGGState): void {
  if (state.activeAction) {
    const done = state.activeAction;
    state.actionStack = state.actionStack.filter((a) => !sameStackCard(a, done));
    log(state, { phase: 'action', actor: done.ownerId, category: 'action', summary: `${done.ownerId}'s ${actionCardName(done.cardKind)} action is complete` });
    state.activeAction = null;
  }
  advanceActionStack(state);
}

// ===========================================================================
// Victory (§12) — immediate checks, eligibility gate, culture-treaty sharing.
// ===========================================================================

/** Living Leader ⇒ the seat may INITIATE a victory (ruling 74). */
export function hasLivingLeader(state: NGGState, playerId: string): boolean {
  return state.heroes.some((h) => h.ownerId === playerId && h.isLeader && !h.dead);
}

/** §12.5: permanent acquired-type count + live hero bonuses
 *  (Motherboard/Greymore: alive + owned + PLACED, ruling 44/63). */
export function techTotal(state: NGGState, p: PlayerState): number {
  let total = p.acquiredTypes.length;
  for (const bonusId of ['motherboard', 'greymore']) {
    const h = state.heroes.find((x) => x.id === bonusId && x.ownerId === p.playerId);
    if (h && !h.dead && h.coord !== null) total += 5; // ruling #113: +5 each (#110 had +4, #104 +3)
  }
  return total;
}

export function militaryThreshold(playerCount: number): number {
  return MILITARY_KILLS_NEEDED[playerCount] ?? 1;
}

/** Check every threshold victory path for one player (Economic fires from its
 *  spend directly). Ends the game honoring direct Culture-Treaty sharing. */
export function checkVictory(state: NGGState, playerId: string): boolean {
  if (state.result) return true;
  if (!hasLivingLeader(state, playerId)) return false;
  const p = byId(state, playerId);
  const n = state.players.length;
  const reasons: string[] = [];
  if (p.leaderKills >= militaryThreshold(n)) reasons.push('Military');
  if (p.culture >= cultureTargetFor(state.players.length)) reasons.push('Cultural');
  if (techTotal(state, p) >= TECH_TARGET[speciesOf(p)]) reasons.push('Technological');
  if (reasons.length === 0) return false;
  endGame(state, [playerId], `${playerId} wins (${reasons.join(' + ')})`, reasons);
  return true;
}

/** `kinds` names the victory paths that fired (Military, Cultural, Economic,
 *  Technological) for a screen; the summary stays the sentence. */
export function endGame(state: NGGState, winners: string[], summary: string, kinds: string[] = []): void {
  if (state.result) return; // a completed victory is never replaced
  const expanded = [...winners];
  if (state.players.length >= 4) {
    for (const w of winners) {
      for (const t of state.treaties.filter((x) => x.type === 'culture-treaty')) {
        const other = t.partners[0] === w ? t.partners[1] : t.partners[1] === w ? t.partners[0] : null;
        if (other && !expanded.includes(other)) expanded.push(other);
      }
    }
  }
  state.result = { winners: expanded, summary, kinds };
  state.phase = 'game_over';
  state.battle = null;
  state.pending = null;
  log(state, { phase: 'game_over', actor: null, category: 'game-end', ...key(`Game over: ${summary}`), summary: `GAME OVER — ${summary}. Winner(s): ${expanded.join(', ') || 'none'}` });
}

/** The all-Leaders-dead draw (§12.1; never replaces a completed win). */
export function checkAllLeadersDeadDraw(state: NGGState): boolean {
  if (state.result) return false;
  if (state.players.some((p) => hasLivingLeader(state, p.playerId))) return false;
  endGame(state, [], 'Every Leader is dead and nobody has won — draw', []);
  return true;
}

export function checkGameOver(state: NGGState): { game_over: boolean; winners: string[]; scores: Record<string, number>; summary: string } {
  if (!state.result) return { game_over: false, winners: [], scores: {}, summary: '' };
  const scores: Record<string, number> = {};
  for (const p of state.players) scores[p.playerId] = p.culture;
  return { game_over: true, winners: state.result.winners, scores, summary: state.result.summary };
}

// ===========================================================================
// applyMove — pure dispatch + pending discipline
// ===========================================================================

/** Moves whose own reply carries something only the mover may know (the card
 *  they drew, the hero they hid a spy on,. That
 *  reply goes to the mover privately; everyone hears only the public log. */
const PRIVATE_REPLY_MOVES = new Set<NGGMove['type']>(['report_draw', 'resolve_report', 'choose_spy', 'commit_battle_card']);

/** The AI's pretend battles (ai-strike.ts) only: the same dispatch as
 *  applyMove, on a state the caller owns and may change in place — no copy
 *  per step. Never used for a real game move. */
export function applyMoveInPlace(state: NGGState, playerId: string, move: NGGMove): void {
  dispatch(state, playerId, move);
  armOverlayChoice(state);
  refreshActor(state);
}

export function applyMove(prev: NGGState, playerId: string, move: NGGMove): { newState: NGGState; summary: string; privateReveals?: Array<{ player_id: string; text: string }> } {
  const state = upgradeLegacyState(structuredClone(prev) as NGGState);
  const firstNew = state.log.length;
  const knownBefore = byId(state, playerId).knowledge.length;
  const reply = dispatch(state, playerId, move);
  // An Economy overlay choice owed by a hero's arrival or departure is asked
  // as soon as no other decision is open (§8.3).
  armOverlayChoice(state);
  refreshActor(state);
  // The move's summary is everything it put in the public log, in order — a
  // whole battle pass or an AI's full card resolution, not just its first
  // step. The log never holds hidden information, so this is safe to speak.
  const logged = state.log.slice(firstNew).map((e) => e.summary);
  const secret = PRIVATE_REPLY_MOVES.has(move.type);
  const summary = logged.length ? logged.map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ') : secret ? `${playerId} made a hidden choice` : reply;
  if (!secret) return { newState: state, summary };
  const learned = byId(state, playerId).knowledge.slice(knownBefore)
    .map((k) => k.replace(/ is hero (\S+)$/, (_, id: string) => ` is carried by ${HEROES.find((h) => h.id === id)?.name ?? id}`));
  return { newState: state, summary, privateReveals: [{ player_id: playerId, text: [reply, ...learned].join(' ') }] };
}

function refreshActor(state: NGGState): void {
  if (state.phase === 'game_over') return;
  if (state.pending) { state.activePlayerId = state.pending.forPlayerId; return; }
  if (state.battle) {
    if (state.battle.phase === 'activations') {
      const next = state.battle.activationQueue[state.battle.activationCursor];
      const u = next ? state.battle.units.find((x) => x.unitRef === next) : undefined;
      if (u) { state.activePlayerId = u.ownerId; return; }
    }
    return; // battle internals set activePlayerId at each step
  }
  if (state.phase === 'planning') { state.activePlayerId = state.planningOrder[0] ?? state.activePlayerId; return; }
  if (state.phase === 'action' && state.activeAction) { state.activePlayerId = state.activeAction.ownerId; return; }
}

export function pendingAllowedMoveTypes(pending: Exclude<Pending, null>): string[] {
  const base: string[] = [];
  switch (pending.kind) {
    // The reporting seat may still assign several seats at once.
    case 'choose_faction': base.push('choose_faction', 'assign_setup_choices'); break;
    case 'choose_leader': base.push('choose_leader'); break;
    case 'choose_starting_location': base.push('choose_starting_location'); break;
    case 'report_draw': base.push('report_draw', 'resolve_report'); break;
    case 'upkeep_reallocate_cores': base.push('reallocate_cores'); break;
    case 'access_request': base.push('respond_access_request'); break;
    case 'second_purchase': base.push(pending.action === 'build' ? 'build' : 'research', 'skip_action'); break;
    case 'smyth_reward': base.push('research'); break;
    case 'dowser_collector': base.push('choose_dowser_collector'); break;
    case 'elara_spell': base.push('cast_elara_spell'); break;
    case 'treaty_response': base.push('respond_treaty'); break;
    case 'battle_commit': base.push('commit_battle_card'); break;
    case 'counter_target': base.push('choose_counter_target'); break;
    case 'extra_selection': base.push('select_extra_cards'); break;
    case 'initiative_tie': base.push('choose_initiative_order'); break;
    case 'battle_defense': base.push('resolve_battle_defense'); break;
    case 'retreat': base.push('choose_retreat'); break;
    case 'rally_selection': base.push('select_rally_units'); break;
    case 'choose_milestone_hero': base.push('choose_milestone_hero'); break;
    case 'overlay_choice': base.push('resolve_overlay_choice'); break;
    case 'place_reserved_hero': base.push('place_reserved_hero'); break;
    case 'choose_spy': base.push('choose_spy'); break;
    case 'treaty_break_decision': base.push('break_treaty', 'skip_action'); break;
  }
  return base;
}

function describePending(p: Exclude<Pending, null>): string {
  switch (p.kind) {
    case 'choose_faction': return 'their faction pick';
    case 'choose_leader': return 'their Leader pick';
    case 'choose_starting_location': return 'their starting-location pick';
    case 'report_draw': return 'the battle card they physically drew (report_draw)';
    case 'upkeep_reallocate_cores': return 'their optional Core reallocation';
    case 'access_request': return `the access request for ${p.collectorId} at ${p.coord}`;
    case 'second_purchase': return 'their optional second purchase';
    case 'smyth_reward': return "Smyth's free research pick";
    case 'elara_spell': return "Elara's pre-movement spell decision";
    case 'treaty_response': return `the ${p.treatyType} offer from ${p.proposerId}`;
    case 'battle_commit': return 'their battle-card commitment';
    case 'counter_target': return "their Counter's target";
    case 'extra_selection': return 'their Extra card selection';
    case 'initiative_tie': return 'the tied-units order pick';
    case 'battle_defense': return 'a defense decision';
    case 'retreat': return 'their retreat decision';
    case 'rally_selection': return 'their Rally unit selection';
    case 'choose_milestone_hero': return 'a milestone hero claim';
    case 'overlay_choice': return 'which Economy overlay is active';
    case 'place_reserved_hero': return 'placing their reserved hero';
    case 'choose_spy': return 'their private spy assignment';
    case 'treaty_break_decision': return 'their end-of-round treaty-break decision (break or keep)';
    case 'dowser_collector': return 'their choice of each free collector Dowser grants';
  }
}

function dispatch(state: NGGState, playerId: string, move: NGGMove): string {
  if (state.phase === 'game_over') throw new GameError('GAME_OVER', 'The game is over');
  // A pending blocks everything except its resolving move(s).
  if (state.pending) {
    const allowed = pendingAllowedMoveTypes(state.pending);
    if (!allowed.includes(move.type)) {
      throw new GameError('ILLEGAL_MOVE', `${state.pending.forPlayerId} must settle ${describePending(state.pending)} first (expected one of: ${allowed.join(', ')})`);
    }
  } else {
    if (state.phase === 'setup_factions' && move.type !== 'assign_setup_choices') {
      throw new GameError('ILLEGAL_MOVE', 'Setup: assign factions first (assign_setup_choices)');
    }
  }

  switch (move.type) {
    case 'assign_setup_choices': return doAssignSetupChoices(state, playerId, move.selections);
    case 'choose_faction': return doChooseFaction(state, playerId, move.faction);
    case 'choose_leader': return doChooseLeader(state, playerId, move.hero);
    case 'choose_starting_location': return doChooseStartingLocation(state, playerId, move.location);
    case 'report_draw': return doReportDraw(state, playerId, move.card);
    case 'resolve_report': return doResolveReport(state, playerId);
    case 'reallocate_cores': return doReallocateCores(state, playerId, move.allocations);
    case 'plan_action': return doPlanAction(state, playerId, move);
    case 'build': return doBuild(state, playerId, move);
    case 'economic_victory_spend': return doEconomicVictorySpend(state, playerId, move);
    case 'respond_access_request': return doRespondAccessRequest(state, playerId, move.grant);
    case 'move_units': return doMoveUnits(state, playerId, move);
    case 'cast_elara_spell': return doCastElaraSpell(state, playerId, move);
    case 'research': return doResearch(state, playerId, move);
    case 'form_treaty': return doFormTreaty(state, playerId, move);
    case 'respond_treaty': return doRespondTreaty(state, playerId, move.accept);
    case 'break_treaty': return doBreakTreaty(state, playerId, move);
    case 'commit_battle_card': return commitBattleCard(state, playerId, move.card);
    case 'choose_counter_target': return chooseCounterTarget(state, playerId, move.card, move.played_by, move.batch);
    case 'select_extra_cards': return selectExtraCards(state, playerId, move.cards);
    case 'battle_activation': return battleActivation(state, playerId, move);
    case 'choose_initiative_order': return chooseInitiativeOrder(state, playerId, move.unit);
    case 'resolve_battle_defense': return resolveBattleDefense(state, playerId, move.defense);
    case 'choose_retreat': return chooseRetreat(state, playerId, move);
    case 'select_rally_units': return selectRallyUnits(state, playerId, move.units);
    case 'choose_milestone_hero': return doChooseMilestoneHero(state, playerId, move.hero);
    case 'resolve_overlay_choice': return resolveOverlayChoice(state, playerId, move.hero);
    case 'choose_dowser_collector': return doChooseDowserCollector(state, playerId, move);
    case 'place_reserved_hero': return doPlaceReservedHero(state, playerId, move);
    case 'choose_spy': return doChooseSpy(state, playerId, move.hero);
    case 'skip_action': return doSkipAction(state, playerId);
    default: {
      const _exhaustive: never = move;
      throw new GameError('ILLEGAL_MOVE', `Unknown move type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ===========================================================================
// Battle-card draws (physical report vs server deal)
// ===========================================================================

/** Draw one battle card for a seat. AI: silent server deal. Digital human: the
 *  resolve_report button. Physical human: report_draw pending (conservation-
 *  checked against the tracked table-deck remainder). */
/** Draw one battle card for a seat. AI: silent server deal. Digital human: the
 *  resolve_report button. Physical human: report_draw pending. An empty draw
 *  pile is first replenished from the discard (§10.1); with every card held
 *  or in play there is nothing to draw and no question is asked. Returns
 *  whether a draw happened or is now owed. */
export function drawBattleCard(state: NGGState, p: PlayerState, reason: 'leader-grant' | 'research-purchase' | 'hero-reward'): boolean {
  if (!replenishDrawPile(state)) {
    log(state, { phase: state.phase, actor: p.playerId, category: 'draw', summary: `${p.playerId} would draw a battle strategy card, but every card is held or in play — nothing is drawn` });
    return false;
  }
  if (p.kind === 'ai') { dealServerBattleCard(state, p); return true; }
  state.pending = { kind: 'report_draw', forPlayerId: p.playerId, reason, resume: { action: 'research', move: null } };
  state.activePlayerId = p.playerId;
  return true;
}

/** §10.1: when the draw pile is empty, the public discard is shuffled to
 *  become the new draw pile (at a physical table the players do this with
 *  the real cards). False when there is nothing to draw at all. */
function replenishDrawPile(state: NGGState): boolean {
  if (state.battleDeck.length > 0) return true;
  if (state.battleDiscard.length === 0) return false;
  const sh = shuffle(state.battleDiscard, state.seed);
  state.seed = sh.nextSeed;
  state.battleDeck = sh.items;
  state.battleDiscard = [];
  log(state, { phase: state.phase, actor: null, category: 'deck', summary: 'The draw pile is empty: shuffle the battle-card discard pile to form the new draw pile' });
  return true;
}

export function dealServerBattleCard(state: NGGState, p: PlayerState): string | null {
  if (!replenishDrawPile(state)) return null; // every card held/resolving
  const id = state.battleDeck.shift()!;
  p.hand.push(id);
  state.cardOwners[id] = p.playerId;
  return id;
}

/** The draw pile's remaining copies of a card. The server's draw pile is
 *  every card not in a hand, in play in a battle, or discarded, so a
 *  physical draw is checked against it too (§10.1 conservation across 20). */
export function physicalRemainderOf(state: NGGState, card: BattleCardId): number {
  return state.battleDeck.filter((id) => cardByInstanceId(id) === card).length;
}

export function cardByInstanceId(instanceId: string): BattleCardId {
  const base = instanceId.replace(/-\d+$/, '');
  const def = BATTLE_CARDS.find((c) => c.id === base);
  if (!def) throw new GameError('ILLEGAL_MOVE', `Unknown battle-card instance ${instanceId}`);
  return def.id;
}

function doReportDraw(state: NGGState, playerId: string, cardName: string): string {
  if (state.pending?.kind !== 'report_draw' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No battle-card draw is owed to you right now');
  }
  const p = byId(state, playerId);
  if (p.digital === true) {
    throw new GameError('ILLEGAL_MOVE', 'Digital seats press the Draw button (resolve_report) — the server is the deck');
  }
  const pend = state.pending;
  const card = resolveBattleCard(cardName);
  replenishDrawPile(state); // an empty pile was reshuffled from the discard (§10.1)
  // Conservation: the draw pile must still hold such a card (§15.3).
  if (physicalRemainderOf(state, card.id) <= 0) {
    const pile = [...new Set(state.battleDeck.map((id) => BATTLE_CARDS.find((c) => c.id === cardByInstanceId(id))!.label))];
    throw new GameError('ILLEGAL_MOVE', `The draw pile holds no "${card.label}" — every copy is in a hand, in play or discarded. It holds: ${pile.join(', ') || 'nothing'}`);
  }
  const instanceId = mintPhysicalInstance(state, card.id);
  p.hand.push(instanceId);
  state.cardOwners[instanceId] = playerId;
  state.pending = null;
  log(state, { phase: state.phase, actor: playerId, category: 'draw', ...key(`${playerId} drew a battle card`, { id: playerId, line: 'You drew a battle card' }), summary: `${playerId} drew a battle strategy card (${pend.reason === 'leader-grant' ? 'Leader grant' : pend.reason === 'hero-reward' ? 'hero reward' : 'Research purchase'})` });
  const after = resumeAfterDraw(state, pend);
  return `${playerId} drew "${card.label}".${after}`;
}

/** For the physical report path, mint a concrete card-instance id and REMOVE it
 *  from the server-held order (the instance pool is shared across the physical
 *  remainder and the server's AI/digital deal channel — one card dealt twice
 *  breaks conservation). */
function mintPhysicalInstance(state: NGGState, cardId: BattleCardId): string {
  const idx = state.battleDeck.findIndex((id) => cardByInstanceId(id) === cardId);
  if (idx >= 0) return state.battleDeck.splice(idx, 1)[0]!;
  throw new GameError('ILLEGAL_MOVE', `No free instance of ${cardId} exists (conservation would break)`);
}

function doResolveReport(state: NGGState, playerId: string): string {
  if (state.pending?.kind !== 'report_draw' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No report is owed by you');
  }
  const p = byId(state, playerId);
  if (p.kind !== 'human' || p.digital !== true) {
    throw new GameError('ILLEGAL_MOVE', 'Only a digital human presses the Draw button — report what you physically drew (report_draw)');
  }
  const pend = state.pending;
  const dealt = dealServerBattleCard(state, p);
  state.pending = null;
  if (!dealt) throw new GameError('ILLEGAL_MOVE', 'Deck and discard are both empty — every card is held or resolving');
  const label = BATTLE_CARDS.find((c) => c.id === cardByInstanceId(dealt))!.label;
  log(state, { phase: state.phase, actor: playerId, category: 'draw', ...key(`${playerId} drew a battle card`, { id: playerId, line: 'You drew a battle card' }), summary: `${playerId} pressed Draw; the server dealt a battle strategy card` });
  const after = resumeAfterDraw(state, pend);
  return `${playerId} drew "${label}" (server-dealt).${after}`;
}

function resumeAfterDraw(state: NGGState, pend: { reason: string; forPlayerId: string }): string {
  if (pend.reason === 'research-purchase') {
    // The purchase's draw completes it; arm any second purchase.
    if (state.phase === 'action') {
      if (maybeArmSecondPurchase(state)) return ' Kettering permits a second Research purchase.';
      finishActionCard(state);
    }
    return '';
  }
  // A Leader grant or a hero's reward: continue what it interrupted.
  resumeAfterReward(state, pend.forPlayerId);
  return '';
}

/** A hero's one-time reward (Smyth's free technology, Chaimidious's card) has
 *  settled: continue whatever it interrupted — the Leader draft; or the
 *  owner's remaining reserved-hero placements, then the claims or the Build
 *  action that raised their base (§15.2: resume the originating action). */
export function resumeAfterReward(state: NGGState, playerId: string): void {
  if (state.result || state.pending) return;
  if (state.phase === 'setup_leaders') { armNextLeaderPick(state); return; }
  if (armReservedPlacement(state, byId(state, playerId))) return;
  if (state.phase === 'claims') { armNextClaim(state); return; }
  if (state.phase === 'action' && state.activeAction && !maybeArmSecondPurchase(state)) finishActionCard(state);
}

function maybeArmSecondPurchase(state: NGGState): boolean {
  if (!state.activeAction) return false;
  const owner = byId(state, state.activeAction.ownerId);
  const kind = state.activeAction.cardKind;
  const heroId = kind === 'build' ? 'foreman' : kind === 'research' ? 'kettering' : null;
  if (!heroId || !heroAlivePlaced(state, owner.playerId, heroId)) return false;
  if (state.activeAction.secondUsed) return false; // one second purchase per action
  state.activeAction.secondUsed = true;
  state.pending = { kind: 'second_purchase', forPlayerId: owner.playerId, action: kind === 'build' ? 'build' : 'research' };
  state.activePlayerId = owner.playerId;
  return true;
}

// ===========================================================================
// Economy (§6) — placement legality, access handshake, build/research
// ===========================================================================

/** Collectors that can pay right now: owned, not placed this round, and (a
 *  robot's) powered by a Core (§6.1). */
export function availableCollectorIds(state: NGGState, p: PlayerState): string[] {
  const committed = new Set(state.placements.filter((c) => c.ownerId === p.playerId).map((c) => c.collectorId));
  return ownedCollectorIds(p).filter((id) => !committed.has(id) && collectorPowered(p, id));
}

/** §6.1 placement: the ONE statement of where a collector may go next, read
 *  by the payment check, the payment suggestions and the reach question.
 *  Never a tile holding a collector; anchored by an owned unit or hero on or
 *  next to it, an owned base on or next to it, an own collector placed
 *  earlier this round or earlier in this payment next to it, or — under
 *  Shared Resources / Open Borders — a partner's unit, hero or base on or
 *  next to it (ruling 8; designer rulings 2026-09-24: a partner's unit
 *  counts on its own tile too, and a partner's base counts). A Coreless platform is not a unit (§7.7) and anchors
 *  nothing. `prior` = this payment's earlier placements, canonical coords. */
/** May `p` add one more collector to `coord`, given what stands there and
 *  what this payment placed before? Normally a location holds one collector;
 *  with Collector Optimizations (ruling #102) two of the owner's may share it,
 *  and an access partner's may share it if that partner has the research too.
 *  Never more than two. */
export function stackAllowed(state: NGGState, p: PlayerState, coord: Coord, prior: Array<{ collectorId: string; coord: Coord }>): boolean {
  const here = collectorsAt(state, coord);
  const priorHere = prior.filter((x) => x.coord === coord).length;
  const count = here.length + priorHere;
  if (count === 0) return true;
  if (count >= 2) return false;
  if (!p.research.includes('collector-optimizations')) return false;
  const other = here.find((c) => c.ownerId !== p.playerId);
  if (!other) return true;
  const o = state.players.find((x) => x.playerId === other.ownerId);
  return !!o && o.research.includes('collector-optimizations') && anchorPartners(state, p.playerId).includes(other.ownerId);
}

export function isLegalPlacement(state: NGGState, p: PlayerState, coord: Coord, prior: Array<{ collectorId: string; coord: Coord }>): boolean {
  if (!stackAllowed(state, p, coord, prior)) return false;
  const tile = state.tiles.find((t) => coordKey(t.c, t.r) === coord);
  if (!tile) return false;
  const ns = neighborsOf(state.tiles, tile.c, tile.r).map((t) => coordKey(t.c, t.r));
  const near = (c: Coord | null) => c !== null && (c === coord || ns.includes(c));
  const unitNear = (owner: string) => state.units.some((u) => u.ownerId === owner && isUnitPiece(u) && near(u.coord))
    || state.heroes.some((h) => h.ownerId === owner && !h.dead && near(h.coord));
  if (unitNear(p.playerId)) return true;
  if (state.bases.some((b) => b.ownerId === p.playerId && near(b.coord))) return true;
  if (state.placements.some((c) => c.ownerId === p.playerId && ns.includes(c.coord))) return true;
  if (prior.some((x) => ns.includes(x.coord))) return true;
  // A partner's base anchors like your own (designer ruling 2026-09-24).
  return anchorPartners(state, p.playerId).some((partner) => unitNear(partner)
    || state.bases.some((b) => b.ownerId === partner && near(b.coord)));
}

/** A proposed payment with every tile in canonical "c,r" form (printed labels
 *  like "C5" accepted), so the check, the consent records and the commit all
 *  read the same tiles. */
export function canonicalPayment(state: NGGState, placements: unknown): Array<{ collectorId: string; coord: Coord }> {
  if (!Array.isArray(placements)) throw new GameError('INVALID_MOVE_SHAPE', 'payment is a list of { collectorId, coord } placements');
  return placements.map((pl) => {
    const o = (pl ?? {}) as { collectorId?: unknown; coord?: unknown };
    if (typeof o.collectorId !== 'string' || (typeof o.coord !== 'string' && (typeof o.coord !== 'object' || o.coord === null))) {
      throw new GameError('INVALID_MOVE_SHAPE', 'Each placement is { collectorId, coord }');
    }
    return { collectorId: o.collectorId, coord: resolveCoord(state.tiles, o.coord as string) };
  });
}

const RESOURCE_ORDER: ResourceType[] = ['water', 'wood', 'ore', 'oil', 'ether'];

/** The seats a buyer has been refused by this action (§6.2): the payment
 *  search stops proposing their locations; the buyer may still revise. */
export function refusingOwners(state: NGGState, buyerId: string): string[] {
  return [...new Set((state.activeAction?.refusedAccess ?? []).map((r) => r.ownerId).filter((o) => o !== buyerId))];
}

/**
 * A payment covering `cost` from the seat's available collectors, found by
 * search — the one payment finder the menus, the AI and the engine's
 * access-resume all use. Every placement passes isLegalPlacement, each
 * collector is used once, a robot collector only goes on its own resource,
 * and a collector may be placed only to reach further (surplus placement,
 * ruling 3) when that is the only way. Paying with fewer collectors is
 * tried first. `avoidOwners`: seats whose locations must not be used (they
 * refused access this action). Returns null when no payment exists — or,
 * on a very large position, when the search budget runs out first.
 */
export function findPayment(
  state: NGGState, p: PlayerState, cost: ResourceCost, avoidOwners: string[] = [], budget = 3000, extraAny = 0, distinctTiles = false,
): Array<{ collectorId: string; coord: Coord }> | null {
  // Ruling #101: a Haste wizard's bank pays first; its Surfs yield two each.
  const bank = bankOf(p);
  const maxYield = hasHaste(p) ? 2 : 1;
  const need0: Record<ResourceType, number> = { water: 0, wood: 0, ore: 0, oil: 0, ether: 0 };
  for (const r of RESOURCE_ORDER) need0[r] = Math.max(0, (cost[r] ?? 0) - (bank[r] ?? 0));
  if (distinctTiles) {
    // The Economic spend needs its full count of collectors (the cost's
    // resources plus `extraAny`) whatever they yield. A Haste wizard covers
    // the mix with fewer Surfs, and the bank may cover part of it, so pad
    // the extras up to the full count (playtest bug 2026-10-01: a Haste
    // wizard with 15 Surfs was offered a 12-collector payment, which the
    // offer then dropped).
    const count = RESOURCE_ORDER.reduce((a, r) => a + (cost[r] ?? 0), 0) + extraAny;
    const forMix = RESOURCE_ORDER.reduce((a, r) => a + Math.ceil(need0[r] / maxYield), 0);
    extraAny = Math.max(0, count - forMix);
  }
  if (RESOURCE_ORDER.every((r) => need0[r] === 0) && extraAny === 0) return [];
  const all = availableCollectorIds(state, p).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // Ruling #102: a location holding one collector is still open to a seat
  // that may stack — except for the Economic spend, which needs distinct tiles.
  const tiles = state.tiles.map((t) => coordKey(t.c, t.r)).filter((k) => {
    if (collectorsAt(state, k).length > 0 && (distinctTiles || !stackAllowed(state, p, k, []))) return false;
    const owner = locationOwner(state, k);
    return !(owner && owner !== p.playerId && avoidOwners.includes(owner));
  });
  const canMake = (cid: string, r: ResourceType) => { const t = collectorResourceOf(cid); return t === null || t === r; };
  // Quick bound: every tile a chain of placements could reach at all, and
  // whether it holds enough of each needed resource.
  const reach: Array<{ collectorId: string; coord: Coord }> = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const k of tiles) {
      if (reach.some((x) => x.coord === k)) continue;
      if (isLegalPlacement(state, p, k, reach)) { reach.push({ collectorId: '', coord: k }); grew = true; }
    }
  }
  for (const r of RESOURCE_ORDER) {
    if (need0[r] > 0 && reach.filter((x) => effectiveResourceAt(state, x.coord) === r).length * maxYield < need0[r]) return null;
  }
  let nodes = 0;
  const seen = new Set<string>();
  // `extraAny`: placements the purchase needs beyond the cost, on any
  // resource (the Economic spend under the experimental dial). Each one is
  // also a stepping stone, so they are tried before plain bridging.
  const rec = (placed: Array<{ collectorId: string; coord: Coord }>, need: Record<ResourceType, number>, left: string[], extraLeft: number, bridgesLeft: number): Array<{ collectorId: string; coord: Coord }> | null => {
    const short = RESOURCE_ORDER.filter((r) => need[r] > 0);
    if (short.length === 0 && extraLeft === 0) return placed;
    if (++nodes > budget) return null;
    const total = short.reduce((a, r) => a + Math.ceil(need[r] / maxYield), 0) + extraLeft;
    if (left.length < total) return null;
    for (const r of short) if (left.filter((c) => canMake(c, r)).length * maxYield < need[r]) return null;
    const key = `${placed.map((x) => x.coord).sort().join(';')}|${left.join(',')}|${extraLeft}|${bridgesLeft}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const spots = tiles.filter((k) => (distinctTiles ? !placed.some((x) => x.coord === k) : true) && isLegalPlacement(state, p, k, placed));
    // Robot collectors are spent on their own resource first; Surfs are the
    // flexible ones, kept for what the typed collectors cannot make.
    const pick = (r: ResourceType, bridging: boolean): string | undefined => {
      const typed = left.find((c) => collectorResourceOf(c) === r);
      if (typed) return typed;
      const surfs = left.filter((c) => collectorResourceOf(c) === null);
      if (!bridging) return surfs[0];
      const surfsNeeded = short.reduce((a, x) => a + Math.max(0, need[x] - left.filter((c) => collectorResourceOf(c) === x).length), 0);
      return surfs.length > surfsNeeded ? surfs[0] : undefined;
    };
    for (const k of spots) {
      const r = effectiveResourceAt(state, k);
      if (need[r] <= 0) continue;
      const cid = pick(r, false);
      if (!cid) continue;
      const got = rec([...placed, { collectorId: cid, coord: k }], { ...need, [r]: Math.max(0, need[r] - collectorYield(p, cid)) }, left.filter((x) => x !== cid), extraLeft, bridgesLeft);
      if (got) return got;
    }
    if (extraLeft > 0 || (left.length > total && bridgesLeft > 0)) {
      for (const k of spots) {
        const r = effectiveResourceAt(state, k);
        if (need[r] > 0) continue;
        const cid = pick(r, true);
        if (!cid) continue;
        const asExtra = extraLeft > 0;
        const got = rec([...placed, { collectorId: cid, coord: k }], need, left.filter((x) => x !== cid), asExtra ? extraLeft - 1 : 0, asExtra ? bridgesLeft : bridgesLeft - 1);
        if (got) return got;
      }
    }
    return null;
  };
  // Fewest stepping stones first: a payment with no surplus placement, then
  // one, then two — so a purchase never commits more collectors than it must
  // (with three starting Surfs a plain depth-first search found a longer
  // chain first, 2026-09-26).
  const spare = all.length - RESOURCE_ORDER.reduce((a, r) => a + need0[r], 0) - extraAny;
  for (let bridges = 0; bridges <= Math.max(0, spare); bridges++) {
    seen.clear();
    const got = rec([], need0, all, extraAny, bridges);
    if (got) return got;
    if (nodes > budget) return null;
  }
  return null;
}

/** Check a complete proposed payment (§6.1–6.2). Every placement names its
 *  own collector — one collector pays once — each placement is anchored by
 *  the ones before it, a robot collector collects only its own resource, and
 *  the whole covers the cost. Returns the canonical placements (printed tile
 *  labels resolved) that the consent check and the commit must use. */
export function validatePayment(
  state: NGGState, p: PlayerState, cost: ResourceCost,
  placementsIn: unknown,
): { produced: ResourceCost; accessNeeded: Array<{ ownerId: string; collectorId: string; coord: Coord }>; placements: Array<{ collectorId: string; coord: Coord }> } {
  const placements = canonicalPayment(state, placementsIn);
  // Ruling #101: a Haste wizard's bank may pay a purchase in full (no
  // collector placed) or in part.
  if (placements.length === 0 && costTotal(cost) > 0 && !costCoveredBy(cost, bankOf(p))) {
    throw new GameError('ILLEGAL_MOVE', `This purchase costs ${describeCost(cost)} — propose a complete collector payment${hasHaste(p) ? ` (your bank holds ${describeCost(bankOf(p))})` : ''}`);
  }
  const available = new Set(availableCollectorIds(state, p));
  const produced: ResourceCost = {};
  const accessNeeded: Array<{ ownerId: string; collectorId: string; coord: Coord }> = [];
  const prior: Array<{ collectorId: string; coord: Coord }> = [];
  for (const pl of placements) {
    if (prior.some((x) => x.collectorId === pl.collectorId)) {
      throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} is named twice — each placement needs its own collector, and a collector pays only once (§6.1)`);
    }
    if (!available.has(pl.collectorId)) {
      throw new GameError('ILLEGAL_MOVE', `Collector ${pl.collectorId} is not available (placed already this round, without a Core, or not yours). Available: ${[...available].join(', ') || 'none'}`);
    }
    const coord = pl.coord;
    if (!isLegalPlacement(state, p, coord, prior)) {
      throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} cannot be placed at ${tileName(coord)}: it needs an owned unit, hero or base on or next to it, an own collector placed this round next to it, or a Shared Resources/Open Borders partner's unit on or next to it — and no collector already there (§6.1)`);
    }
    const resource = effectiveResourceAt(state, coord);
    const typeRes = collectorResourceOf(pl.collectorId);
    if (typeRes && typeRes !== resource) {
      throw new GameError('ILLEGAL_MOVE', `${pl.collectorId} is a ${typeRes} collector but ${tileName(coord)} currently produces ${resource}`);
    }
    produced[resource] = (produced[resource] ?? 0) + collectorYield(p, pl.collectorId);
    const owner = locationOwner(state, coord);
    if (owner && owner !== p.playerId && !hasCollectionAccess(state, p.playerId, owner)) {
      accessNeeded.push({ ownerId: owner, collectorId: pl.collectorId, coord });
    }
    prior.push(pl);
  }
  if (!costCoveredBy(cost, addCosts(produced, bankOf(p)))) {
    throw new GameError('ILLEGAL_MOVE', `Payment produces ${describeCost(produced)}${hasHaste(p) ? ` (bank ${describeCost(bankOf(p))})` : ''} but the purchase costs ${describeCost(cost)} — unspent resources expire at action end${hasHaste(p) ? ', except what Haste banks' : ''}`);
  }
  return { produced, accessNeeded, placements };
}

/** Ruling #101: a Haste wizard's Surf produces two of its tile's resource. */
export function hasHaste(p: PlayerState): boolean {
  return p.research.includes('haste');
}
export function collectorYield(p: PlayerState, collectorId: string): number {
  return collectorResourceOf(collectorId) === null && hasHaste(p) ? 2 : 1;
}
/** The surplus a Haste wizard banked this round (empty for everyone else). */
export function bankOf(p: PlayerState): ResourceCost {
  return hasHaste(p) ? (p.bank ?? {}) : {};
}
function addCosts(a: ResourceCost, b: ResourceCost): ResourceCost {
  const out: ResourceCost = { ...a };
  for (const r of Object.keys(b) as ResourceType[]) out[r] = (out[r] ?? 0) + (b[r] ?? 0);
  return out;
}

function commitPayment(state: NGGState, p: PlayerState, placements: Array<{ collectorId: string; coord: Coord }>, produced: ResourceCost, cost?: ResourceCost): void {
  // Ruling #101: with Haste, whatever this purchase does not spend — the
  // bank's part included — stays in the bank for the rest of the round.
  if (hasHaste(p) && cost) {
    const bank: ResourceCost = {};
    for (const r of RESOURCE_ORDER) {
      const left = (p.bank?.[r] ?? 0) + (produced[r] ?? 0) - (cost[r] ?? 0);
      if (left > 0) bank[r] = left;
    }
    p.bank = bank;
    if (Object.keys(bank).length > 0) log(state, { phase: 'action', actor: p.playerId, category: 'payment', summary: `${p.playerId} banks ${describeCost(bank)} (Haste) for later purchases this round` });
  }
  for (const pl of placements) {
    const resource = effectiveResourceAt(state, pl.coord);
    const owner = locationOwner(state, pl.coord);
    state.placements.push({
      collectorId: pl.collectorId, ownerId: p.playerId, coord: pl.coord, resource,
      authorizedBy: owner && owner !== p.playerId ? owner : null,
    });
  }
  // The consent given was for THIS purchase (§6.2: agreed separately for each).
  if (state.activeAction) { delete state.activeAction.accessGrants; state.activeAction.acted = true; }
  log(state, { phase: 'action', actor: p.playerId, category: 'payment', summary: `${p.playerId} commits ${placements.length} collector(s) producing ${describeCost(produced)}: ${placements.map((x) => `${collectorLabel(x.collectorId)} on ${x.coord} (${effectiveResourceAt(state, x.coord)})`).join('; ')}` });
}

/** The access a payment still lacks: placements on another player's location
 *  that neither a Shared Resources/Open Borders treaty nor that owner's own
 *  answer to an access request (recorded by respond_access_request) covers.
 *  A buyer cannot supply consent on the owner's behalf (§6.2). */
function missingConsent(state: NGGState, buyerId: string, needed: Array<{ ownerId: string; collectorId: string; coord: Coord }>): Array<{ ownerId: string; collectorId: string; coord: Coord }> {
  const given = state.activeAction?.accessGrants ?? [];
  return needed.filter((n) => !hasCollectionAccess(state, buyerId, n.ownerId)
    && !given.some((g) => g.ownerId === n.ownerId && g.collectorId === n.collectorId && g.coord === n.coord));
}

function armAccessRequest(state: NGGState, buyer: PlayerState, missing: Array<{ ownerId: string; collectorId: string; coord: Coord }>, resume: ResumeAction, item: string, totalNeeded: number): string {
  const first = missing[0]!;
  if (state.activeAction) state.activeAction.acted = true; // a purchase is under way
  state.pending = {
    kind: 'access_request', forPlayerId: first.ownerId, buyerId: buyer.playerId,
    collectorId: first.collectorId, coord: first.coord, action: resume.action === 'move_battle' ? 'build' : resume.action,
    proposal: { item, placements: [{ collectorId: first.collectorId, coord: first.coord }] },
    resume,
    queue: { index: totalNeeded - missing.length + 1, total: totalNeeded },
  };
  state.activePlayerId = first.ownerId;
  log(state, { phase: 'action', actor: buyer.playerId, category: 'access', summary: `${buyer.playerId} asks ${first.ownerId} for collection access at ${first.coord}` });
  return `Access to ${first.coord} for ${first.collectorId} requires ${first.ownerId}'s consent (respond_access_request).`;
}

function doRespondAccessRequest(state: NGGState, playerId: string, grant: boolean): string {
  if (state.pending?.kind !== 'access_request' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No access request awaits your response');
  }
  const pend = state.pending;
  state.pending = null;
  if (!grant) {
    log(state, { phase: 'action', actor: playerId, category: 'access', ...key(`${playerId} refused ${pend.buyerId} access at ${pend.coord}`, { id: pend.buyerId, line: `${playerId} refused you access at ${pend.coord}`, notify: true }), summary: `${playerId} refuses ${pend.buyerId} access at ${pend.coord} — nothing commits` });
    // The buyer may revise (§6.2). The suggested payments stop proposing this
    // owner's locations for the rest of the action (a refusal is an answer;
    // asking again forever was a harness livelock); the collector itself stays
    // usable elsewhere.
    if (state.activeAction) {
      state.activeAction.refusedAccess = [...(state.activeAction.refusedAccess ?? []), { ownerId: playerId, collectorId: pend.collectorId, coord: pend.coord }];
    }
    state.activePlayerId = pend.buyerId;
    return `Access refused. ${pend.buyerId} may revise placements or choose another purchase (nothing was committed).`;
  }
  // Record the owner's own answer — the only proof of consent the purchase
  // accepts — and resume the originating purchase (§6.2: agreed before
  // commitment).
  if (state.activeAction) {
    state.activeAction.accessGrants = [...(state.activeAction.accessGrants ?? []), { ownerId: playerId, collectorId: pend.collectorId, coord: pend.coord }];
  }
  log(state, { phase: 'action', actor: playerId, category: 'access', ...key(`${playerId} let ${pend.buyerId} collect at ${pend.coord}`, { id: pend.buyerId, line: `${playerId} let you collect at ${pend.coord}`, notify: true }), summary: `${playerId} grants ${pend.buyerId} collection access at ${pend.coord} until upkeep` });
  const rawMv = pend.resume.move as (Record<string, unknown> & { payment?: Array<{ collectorId: string; coord: Coord }> }) | null;
  state.activePlayerId = pend.buyerId;
  if (rawMv && typeof rawMv === 'object') {
    delete rawMv['access']; // a buyer-supplied list is never consent
    const buyer = byId(state, pend.buyerId);
    // The stored payment may be stale: a prior granted collector in the SAME
    // action's grant chain is already committed, so replaying verbatim crashes
    // validatePayment (harness-4p ERR GET_AI_MOVE_ERROR: "surf-N not
    // available"). Re-solve the payment from the collectors still available;
    // if no fresh cover exists the purchase can't land — return it to the
    // buyer as a fresh offer (they may revise via the menu) instead of throwing.
    const paymentArr = Array.isArray(rawMv.payment) ? rawMv.payment : [];
    const availNow = new Set(availableCollectorIds(state, buyer));
    const stale = paymentArr.some((pl) => !availNow.has(pl.collectorId));
    if (stale) {
      // The purchasable's identity lives in `item` (build) or `tech`/`kind`
      // (research). Re-solve against THAT cost; if the row can't be resolved
      // (or no fresh cover exists) re-open the offer instead of crashing.
      // The same cost the purchase will check (a paired Core included); the
      // battle card's ether-or-oil leg is re-checked by doResearch.
      let costDef: { cost: ResourceCost; either: ResourceType[] | null } | null = null;
      try {
        costDef = purchaseCostOf(buyer, { ...rawMv, type: pend.resume.action === 'build' ? 'build' : 'research' } as { type: string });
      } catch {
        costDef = null;
      }
      // A battle card's fourth resource is ether OR oil: try each.
      const legs: ResourceCost[] = !costDef ? [] : costDef.either
        ? costDef.either.map((r) => ({ ...costDef!.cost, [r]: (costDef!.cost[r] ?? 0) + 1 }))
        : [costDef.cost];
      let fresh: Array<{ collectorId: string; coord: Coord }> | null = null;
      for (const leg of legs) {
        fresh = findPayment(state, buyer, leg, refusingOwners(state, buyer.playerId));
        if (fresh) break;
      }
      if (!fresh) {
        state.pending = null;
        log(state, { phase: 'action', actor: pend.buyerId, category: 'access', summary: `${pend.buyerId}'s payment was superseded mid-grant-chain (collectors spent); the purchase offer re-opens` });
        return `The payment changed mid-grant — propose the purchase again with a fresh payment (get_legal_moves re-enumerates).`;
      }
      rawMv.payment = fresh;
    }
  }
  const mv = rawMv as unknown;
  // Economic-victory spends resume as doEconomicVictorySpend, NOT doBuild — the
  // original move carries `payment` but no `item`, so doBuild's resolve would
  // crash on an undefined name (harness-4p probe). Detect by the move's own
  // type field rather than the stored action bucket.
  const mvType = (rawMv && typeof rawMv === 'object' ? (rawMv as { type?: string }).type : undefined);
  if (mvType === 'economic_victory_spend' && mv) return doEconomicVictorySpend(state, pend.buyerId, mv as Extract<NGGMove, { type: 'economic_victory_spend' }>);
  if (pend.resume.action === 'build' && mv) return doBuild(state, pend.buyerId, mv as Extract<NGGMove, { type: 'build' }>);
  if (pend.resume.action === 'research' && mv) return doResearch(state, pend.buyerId, mv as Extract<NGGMove, { type: 'research' }>);
  return 'Access granted.';
}

// ---- Build (§6.3) -----------------------------------------------------------

/** Why a seat may not buy this item now, apart from paying for it (and the
 *  exact base tile, checked with the purchase), or null. The ONE statement of
 *  those rules: the purchase throws it, and the greyed-out list shows it
 *  beside the item. `corePairing` undefined = either way of getting a Core. */
export function buildItemShut(state: NGGState, p: PlayerState, itemId: string, opts: { corePairing?: boolean } = {}): string | null {
  const bdef = buildingById(itemId);
  const udef = unitById(itemId);
  const name = bdef?.name ?? udef?.name ?? itemId;
  if (udef?.requiresBuilding && !p.buildings.includes(udef.requiresBuilding)) {
    return `${name} requires ${udef.requiresBuilding} first (you have: ${p.buildings.join(', ') || 'none'})`;
  }
  if (bdef && !bdef.isBase) {
    const cap = bdef.repeatableMax ?? 1;
    if ((p.buildingCounts[bdef.id] ?? 0) >= cap) return cap === 1 ? `You already have ${bdef.name} (one per player)` : `${bdef.name} is limited to ${cap} per player`;
  }
  if (bdef?.isBase) {
    if (state.bases.filter((b) => b.ownerId === p.playerId).length >= MAX_BASES) return `Maximum ${MAX_BASES} bases (the starting base counts)`;
    if (!state.tiles.some((t) => isBaseSite(state, p.playerId, coordKey(t.c, t.r)))) {
      return 'A new base goes on a tile holding your unit or hero, no opposing unit and no base — no tile qualifies now';
    }
  }
  if (udef) {
    const owned = countOwnedUnitsOfType(state, p, udef.id);
    const cap = collectorCapFor(state, udef);
    if (owned >= cap) return `${name} is limited to ${cap} per player (you own ${owned})`;
    if (udef.id === 'core' && p.coresInSupply <= 0) {
      return `The Core supply is empty (${coreSupplyFor(state)} per player — ${owned} already owned; destroyed Cores return to the supply first)`;
    }
    if (udef.grantsSpy && p.spyAssignments.some((x) => x.active)) return 'Only one active spy assignment per player';
    if (udef.grantsSpy && !state.heroes.some((h) => h.ownerId === p.playerId && !h.dead)) {
      return `${name} is a spy assignment carried by one of your heroes — you have no living hero to carry it`;
    }
    if (udef.needsCore) {
      const reserve = p.coresInReserve > 0;
      const supply = p.coresInSupply > 0;
      if (opts.corePairing === false && !reserve) return `${name} needs a Core — install an owned unallocated Core (reserve: ${p.coresInReserve}) or buy Core+platform together (core_pairing)`;
      if (opts.corePairing === true && !supply) return `No Core left in the supply to buy with ${name}`;
      if (opts.corePairing === undefined && !reserve && !supply) return `${name} needs a Core — none in your reserve and the Core supply is empty`;
    }
    const mapPiece = !udef.collector && udef.id !== 'subject' && udef.id !== 'core' && !udef.grantsSpy;
    if (mapPiece && !state.bases.some((b) => b.ownerId === p.playerId)) {
      return `${name} appears at one of your bases — you have none (rebuild a base first, §6.3)`;
    }
  }
  return null;
}

function doBuild(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'build' }>): string {
  // A second-purchase pending also accepts build (the same seat's resumed right).
  const isResume = state.pending?.kind === 'second_purchase' && state.pending.forPlayerId === playerId;
  if (!isResume) requireActionActive(state, playerId, 'build');
  const p = byId(state, playerId);
  const item = resolvePurchasable(move.item, speciesOf(p));
  const bdef = buildingById(item.id);
  const udef = unitById(item.id);
  const isBase = bdef?.isBase === true;

  const shut = buildItemShut(state, p, item.id, { corePairing: !!move.core_pairing });
  if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  if (move.core_pairing && udef && !udef.needsCore && udef.id !== 'core') {
    throw new GameError('ILLEGAL_MOVE', 'core_pairing applies to Core-needing platforms only');
  }
  // A base's site is checked BEFORE any collector commits (a refused site
  // must not cost the payment).
  if (isBase) {
    if (!move.at_base) throw new GameError('ILLEGAL_MOVE', `${item.name} is a base: declare at_base — a tile holding an owned unit and no opposing unit`);
    const site = resolveCoord(state.tiles, move.at_base);
    if (state.bases.filter((b) => b.ownerId === p.playerId).length >= MAX_BASES) {
      throw new GameError('ILLEGAL_MOVE', `Maximum ${MAX_BASES} bases (the starting base counts)`);
    }
    if (!isBaseSite(state, p.playerId, site)) {
      throw new GameError('ILLEGAL_MOVE', 'A new base goes on a tile holding an owned unit, no opposing unit and no base — even with zero bases');
    }
  } else if (udef && !udef.collector && udef.id !== 'subject' && udef.id !== 'core' && !udef.grantsSpy) {
    resolveSpawnBase(state, p, move.at_base ?? null); // a map unit needs an owned base to appear at
  }
  // Cost incl. the combined Core when core_pairing (ONE purchase, §6.3).
  const { cost } = purchaseCostOf(p, move);
  const { produced, accessNeeded, placements } = validatePayment(state, p, cost, move.payment);
  const missing = missingConsent(state, playerId, accessNeeded);
  if (missing.length > 0) {
    return armAccessRequest(state, p, missing, { action: 'build', move: { ...move, payment: placements } }, item.name, accessNeeded.length);
  }
  if (isResume) state.pending = null; // the second purchase is being spent now
  commitPayment(state, p, placements, produced, cost);
  const note = installPurchase(state, p, item.id, { isBase, atBase: move.at_base ?? null, corePairing: !!move.core_pairing });
  const victory = checkVictory(state, playerId);
  if (victory) return `${playerId} buys ${item.name} for ${describeCost(produced)}.`;
  // A spy purchase's private assignment pending already armed inside install.
  if (state.pending?.kind === 'choose_spy') return `${playerId} buys ${item.name} for ${describeCost(produced)}. ${note}`;
  // A new base gives a reserved hero somewhere to land: its owner places it
  // now, and the action resumes once it has.
  if (isBase && armReservedPlacement(state, p)) return `${playerId} buys ${item.name} for ${describeCost(produced)}. A reserved hero can now be placed.`;
  if (maybeArmSecondPurchase(state)) return `${playerId} buys ${item.name} for ${describeCost(produced)}. Foreman permits a second purchase — another build or skip_action.`;
  finishActionCard(state);
  return `${playerId} buys ${item.name} for ${describeCost(produced)}.`;
}

/** How many pieces of a type a seat owns now — the per-player supply cap
 *  (§2) reads this. Collectors count once each, placed or not. */
export function countOwnedUnitsOfType(state: NGGState, p: PlayerState, typeId: string): number {
  if (typeId === 'core') return ownedCoreCount(state, p);
  if (typeId === 'subject') return p.subjects;
  const def = unitById(typeId);
  if (def?.collector) {
    const prefix = def.collectorResource ? `${def.collectorResource}-collector-` : 'surf-';
    return ownedCollectorIds(p).filter((id) => id.startsWith(prefix)).length;
  }
  return state.units.filter((u) => u.ownerId === p.playerId && u.typeId === typeId).length;
}

/** Install the purchase (buildings → faction set, bases → map, units per spawn
 *  rules, spies as hero-assignment pendings). Every per-species branch. */
function installPurchase(state: NGGState, p: PlayerState, itemId: string, ctx: { isBase: boolean; atBase: string | null; corePairing: boolean }): string {
  const unit = unitById(itemId);
  const building = buildingById(itemId);
  if (unit) {
    if (unit.collector) {
      // Collectors (Surfs and robot collectors) stay off the map until placed
      // to pay; a new one is available at once (ruling 5). A robot
      // collector needs its Core, installed or bought with it.
      const prefix = unit.collectorResource ? `${unit.collectorResource}-collector` : 'surf';
      const cap = collectorCapFor(state, unit);
      const id = Array.from({ length: cap }, (_, i) => `${prefix}-${i + 1}`).find((x) => !p.collectorsAvailable[x]);
      if (!id) throw new GameError('ILLEGAL_MOVE', `${unit.name} is limited to ${cap} per player`);
      if (unit.needsCore) spendCore(state, p, ctx.corePairing);
      p.collectorsAvailable[id] = 1;
    } else if (unit.id === 'subject') {
      p.subjects += 1;
    } else if (unit.id === 'core') {
      p.coresInSupply -= 1;
      p.coresInReserve += 1; // an unallocated owned Core (off-map reserve)
    } else if (unit.grantsSpy) {
      // Spies are hero assignments, not map pieces (§7.3/§7.9). Recruitment is
      // public; the assignment pick is a seat-private pending.
      if (unit.needsCore) spendCore(state, p, ctx.corePairing);
      state.pending = {
        kind: 'choose_spy', forPlayerId: p.playerId,
        source: unit.id === 'illusionist' ? 'illusionist' : 'infiltrator',
        resume: { action: 'build', move: null },
      };
      state.activePlayerId = p.playerId;
      log(state, { phase: 'action', actor: p.playerId, category: 'spy-recruitment', ...key(`${p.playerId} recruited ${aOrAn(unit.name)} ${unit.name}`, { id: p.playerId, line: `You recruited ${aOrAn(unit.name)} ${unit.name}` }), ...tell(state.players.map((x) => x.playerId).filter((x) => x !== p.playerId)), summary: `${p.playerId} recruits an ${unit.name} (the hero carrying it is chosen privately)` });
    } else {
      // A map piece (combat unit, Wall, ICP): spawn at an owned base the buyer
      // names; Core-needing platforms consume a Core.
      const at = resolveSpawnBase(state, p, ctx.atBase);
      if (unit.needsCore) spendCore(state, p, ctx.corePairing);
      // Casualties leave holes in the live roster: count + 1 can collide with a
      // surviving piece. Pick an unused identity before allocating its Core.
      let seq = state.units.filter((u) => u.ownerId === p.playerId && u.typeId === itemId).length + 1;
      while (state.units.some((u) => u.id === `u-${itemId}-${p.playerId}-${seq}`)) seq++;
      state.units.push({
        id: `u-${itemId}-${p.playerId}-${seq}`, typeId: itemId, ownerId: p.playerId, coord: at,
        allocatedCoreId: unit.needsCore ? `core-${p.playerId}-${itemId}-${seq}` : null,
      });
    }
    if (!p.acquiredTypes.includes(itemId)) p.acquiredTypes.push(itemId);
    const placedAt = state.units.filter((u) => u.ownerId === p.playerId && u.typeId === itemId).at(-1);
    const where = !unit.collector && unit.id !== 'subject' && unit.id !== 'core' && !unit.grantsSpy && placedAt ? ` at ${placedAt.coord}` : '';
    log(state, { phase: 'action', actor: p.playerId, category: 'build', ...key(`${p.playerId} ${unit.id === 'core' ? 'bought' : 'recruited'} ${aOrAn(unit.name)} ${unit.name}`, { id: p.playerId, line: `You ${unit.id === 'core' ? 'bought' : 'recruited'} ${aOrAn(unit.name)} ${unit.name}` }), summary: `${p.playerId} builds ${unit.name}${where}` });
    return '';
  }
  if (building) {
    if (ctx.isBase) {
      if (!ctx.atBase) throw new GameError('ILLEGAL_MOVE', `${building.name} is a base: declare at_base — a tile holding an owned unit and no opposing unit`);
      const coord = resolveCoord(state.tiles, ctx.atBase);
      if (state.bases.filter((b) => b.ownerId === p.playerId).length >= MAX_BASES) {
        throw new GameError('ILLEGAL_MOVE', `Maximum ${MAX_BASES} bases (the starting base counts)`);
      }
      if (!isBaseSite(state, p.playerId, coord)) {
        throw new GameError('ILLEGAL_MOVE', 'A new base goes on a tile holding an owned unit, no opposing unit and no base — even with zero bases');
      }
      state.bases.push({ id: `base-${p.playerId}-${state.bases.length + 1}`, ownerId: p.playerId, coord });
      log(state, { phase: 'action', actor: p.playerId, category: 'build', ...key(`${p.playerId} built a new ${building.name} at ${coord}`, { id: p.playerId, line: `You built a new ${building.name} at ${coord}` }), summary: `${p.playerId} builds a new ${building.name} at ${coord}` });
    } else {
      p.buildingCounts[building.id] = (p.buildingCounts[building.id] ?? 0) + 1;
      if (!p.buildings.includes(building.name)) p.buildings.push(building.name);
      if (building.id === 'mana-reserve') {
        p.manaMax = BASE_MAX_MANA + MANA_PER_RESERVE * Math.min(p.buildingCounts['mana-reserve']!, MAX_RESERVES);
      }
      log(state, { phase: 'action', actor: p.playerId, category: 'build', ...key(`${p.playerId} built ${aOrAn(building.name)} ${building.name}`, { id: p.playerId, line: `You built ${aOrAn(building.name)} ${building.name}` }), summary: `${p.playerId} builds ${building.name}` });
    }
    if (!p.acquiredTypes.includes(itemId)) p.acquiredTypes.push(itemId);
  }
  return '';
}

function spendCore(state: NGGState, p: PlayerState, corePairing: boolean): void {
  if (corePairing) {
    if (p.coresInSupply <= 0) throw new GameError('ILLEGAL_MOVE', 'No Core left in supply to pair');
    p.coresInSupply -= 1;
  } else {
    if (p.coresInReserve <= 0) throw new GameError('ILLEGAL_MOVE', 'No owned unallocated Core in reserve (use core_pairing to buy one with the platform)');
    p.coresInReserve -= 1;
  }
  void state;
}

function resolveSpawnBase(state: NGGState, p: PlayerState, atBase: string | null): Coord {
  const myBases = state.bases.filter((b) => b.ownerId === p.playerId);
  if (myBases.length === 0) {
    throw new GameError('ILLEGAL_MOVE', `${p.playerId} has no base — baseless players cannot place new map units or heroes until a base is rebuilt (§6.3)`);
  }
  if (!atBase) {
    // Which base is the owner's choice (§6.3 "at any owned base"): only a
    // single base leaves nothing to ask.
    if (myBases.length === 1) return myBases[0]!.coord;
    throw new GameError('ILLEGAL_MOVE', `Name the base it appears at (at_base): ${myBases.map((b) => tileName(b.coord)).join(', ')}`);
  }
  const coord = resolveCoord(state.tiles, atBase);
  if (!myBases.some((b) => b.coord === coord)) throw new GameError('ILLEGAL_MOVE', `${coord} holds no base of yours`);
  return coord;
}

function requireActionActive(state: NGGState, playerId: string, kind: 'build' | 'research' | 'move_battle'): void {
  if (state.phase !== 'action' || !state.activeAction) throw new GameError('ILLEGAL_MOVE', 'No action card is resolving');
  if (state.activeAction.ownerId !== playerId) throw new GameError('NOT_YOUR_TURN', `The resolving action belongs to ${state.activeAction.ownerId}`);
  if (state.activeAction.cardKind !== kind) throw new GameError('ILLEGAL_MOVE', `The resolving action is ${state.activeAction.cardKind}, not ${kind}`);
  if (state.battle) throw new GameError('ILLEGAL_MOVE', 'A battle is resolving — finish it first');
  if (state.activeAction.endWindow) throw new GameError('ILLEGAL_MOVE', 'This action is finished — only a treaty offer or finishing it (skip_action) remains');
}

function doEconomicVictorySpend(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'economic_victory_spend' }>): string {
  requireActionActive(state, playerId, 'build');
  const p = byId(state, playerId);
  if (!hasLivingLeader(state, playerId)) throw new GameError('ILLEGAL_MOVE', 'A dead-Leader player cannot initiate victory');
  const payment = canonicalPayment(state, move.payment);
  // §12.4 + ruling #89: half the map's worth of DIFFERENT available
  // collectors on that many distinct tiles (economicScale.ts); the printed
  // mix is the minimum and the rest may collect anything.
  const needed = economicCollectorsNeeded(state);
  if (payment.length !== needed
    || new Set(payment.map((x) => x.collectorId)).size !== needed) {
    throw new GameError('ILLEGAL_MOVE', `The Economic spend needs exactly ${needed} different collectors on ${needed} distinct tiles`);
  }
  if (new Set(payment.map((x) => x.coord)).size !== payment.length) {
    throw new GameError('ILLEGAL_MOVE', 'Economic spend placements must be on distinct tiles');
  }
  const { produced, accessNeeded, placements } = validatePayment(state, p, ECONOMIC_SPEND, payment);
  const missing = missingConsent(state, playerId, accessNeeded);
  if (missing.length > 0) {
    return armAccessRequest(state, p, missing, { action: 'build', move: { ...move, payment: placements } }, 'Economic victory spend', accessNeeded.length);
  }
  commitPayment(state, p, placements, produced, ECONOMIC_SPEND);
  log(state, { phase: 'action', actor: playerId, category: 'victory', ...key(`${playerId} made the Economic victory spend`, { id: playerId, line: 'You made the Economic victory spend' }), summary: `${playerId} commits ${needed} collectors across the board incl. oil and ether — the spend is the action` });
  endGame(state, [playerId], `${playerId} wins (Economic)`, ['Economic']);
  return `${playerId} completes the Economic victory spend.`;
}

// ---- Research (§6.5) ---------------------------------------------------------

/**
 * What a purchase costs, as its own check computes it: an item's printed cost
 * (with the paired Core's when core_pairing), a technology's, the economic
 * spend, or a battle card's three fixed resources plus one leg that ether OR
 * oil may pay (`either`). The one statement of it: the purchase, the access
 * re-solve and the reach question read it.
 */
export function purchaseCostOf(p: PlayerState, move: { type: string; item?: unknown; core_pairing?: unknown; kind?: unknown; tech?: unknown }): { cost: ResourceCost; either: ResourceType[] | null } {
  if (move.type === 'economic_victory_spend') return { cost: { ...ECONOMIC_SPEND }, either: null };
  if (move.type === 'build') {
    const item = resolvePurchasable(String(move.item ?? ''), speciesOf(p));
    const cost: ResourceCost = { ...(item.cost as ResourceCost) };
    if (move.core_pairing) for (const [r, n] of Object.entries(pairedCoreCost(p)) as Array<[ResourceType, number]>) cost[r] = (cost[r] ?? 0) + n;
    return { cost, either: null };
  }
  if (move.kind === 'battle_card') return { cost: { ...BATTLE_CARD_PURCHASE.cost }, either: [...BATTLE_CARD_PURCHASE.either] };
  const def = resolveResearch(String(move.tech ?? ''), speciesOf(p));
  return { cost: { ...(def.cost as ResourceCost) }, either: def.either ? [...def.either] : null };
}

/** What the Core bought together with a platform adds to its price (§6.3):
 *  the Core's own cost, or nothing with Core Integration (ruling #103). The
 *  one statement of it: the purchase, the Build menu, its shut reasons and
 *  the view read it. */
export function pairedCoreCost(p: PlayerState): ResourceCost {
  return p.research.includes('core-integration') ? {} : { ...(unitById('core')!.cost as ResourceCost) };
}

/** Ruling #86: has the seat researched the extra card of this kind? */
export function hasResearchedCard(p: PlayerState, kind: 'build' | 'moveBattle' | 'research'): boolean {
  return Object.entries(ACTION_CARD_RESEARCH).some(([id, k]) => k === kind && p.research.includes(id));
}

export type ActionCardSlot = 'base' | 'hero_extra' | 'researched_extra';

/** The action-card copies a seat holds, per kind (§5.2, ruling #86): the
 *  printed card, a hero-granted extra, a researched extra. Public: heroes and
 *  research are public. */
export function actionCardSlots(p: PlayerState): Record<'build' | 'moveBattle' | 'research', ActionCardSlot[]> {
  const slotsOf = (key: 'build' | 'moveBattle' | 'research'): ActionCardSlot[] => [
    'base',
    ...(p.heroExtraCards[key] ? ['hero_extra' as const] : []),
    ...(hasResearchedCard(p, key) ? ['researched_extra' as const] : []),
  ];
  return { build: slotsOf('build'), moveBattle: slotsOf('moveBattle'), research: slotsOf('research') };
}

/** A technology type id by its printed name (a unit, building, technology,
 *  or the battle strategy card type, ruling #87). */
export function typeName(id: string): string {
  if (id === BATTLE_CARD_TYPE_ID) return 'Battle strategy card';
  return unitById(id)?.name ?? buildingById(id)?.name ?? researchById(id)?.name ?? id;
}

/** Ruling #86: a researched Extra card joins the seat's hand for good. */
function grantResearchedCard(state: NGGState, p: PlayerState, researchId: string, name: string): void {
  const kind = ACTION_CARD_RESEARCH[researchId];
  if (!kind) return;
  p.actionCards[kind] += 1;
  log(state, { phase: state.phase, actor: p.playerId, category: 'action-card-gained', summary: `${p.playerId} gains a second ${kind === 'moveBattle' ? 'Move/Battle' : kind} action card (${name}), permanent` });
}

/** Why a technology's prerequisite is not met, or null. Metal Platforms is
 *  researched "at Home" (§7.10): an owned Home base on the map — bases are
 *  map pieces, not faction-board buildings. */
export function researchPrerequisiteShut(state: NGGState, p: PlayerState, def: { name: string; prerequisite: string }): string | null {
  if (def.prerequisite === 'Home') {
    return state.bases.some((b) => b.ownerId === p.playerId) ? null : `${def.name} is researched at Home — you have no Home on the map`;
  }
  return p.buildings.includes(def.prerequisite) ? null : `${def.name} requires ${def.prerequisite} (you have: ${p.buildings.join(', ') || 'none'})`;
}

/** What a payment still lacks for a purchase: resources short, and whether
 *  the either-leg is unpaid. Empty and false when it covers. */
export function paymentShortOf(cost: ResourceCost, either: ResourceType[] | null, produced: ResourceCost): { short: ResourceCost; either: ResourceType[] | null } {
  const short: ResourceCost = {};
  for (const r of Object.keys(cost) as ResourceType[]) {
    const lack = (cost[r] ?? 0) - (produced[r] ?? 0);
    if (lack > 0) short[r] = lack;
  }
  const eitherShort = either && !either.some((r) => (produced[r] ?? 0) >= 1) ? either : null;
  return { short, either: eitherShort };
}

function doResearch(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'research' }>): string {
  const isSmythPick = state.pending?.kind === 'smyth_reward' && state.pending.forPlayerId === playerId;
  const isResume = state.pending?.kind === 'second_purchase' && state.pending.forPlayerId === playerId;
  if (!isSmythPick && !isResume) requireActionActive(state, playerId, 'research');
  const p = byId(state, playerId);
  if (move.kind === 'tech') {
    const def = resolveResearch(move.tech, speciesOf(p));
    if (p.research.includes(def.id)) throw new GameError('ILLEGAL_MOVE', `${def.name} is already researched`);
    if (isSmythPick) {
      p.research.push(def.id);
      if (!p.acquiredTypes.includes(def.id)) p.acquiredTypes.push(def.id);
      grantResearchedCard(state, p, def.id, def.name);
      state.pending = null;
      log(state, { phase: state.phase, actor: playerId, category: 'research', ...key(`${playerId} researched ${def.name} (Smyth's reward)`, { id: playerId, line: `You researched ${def.name} (Smyth's reward)` }), summary: `${playerId} takes ${def.name} free (Smyth's reward; cost and prerequisite waived)` });
      // The final technology point wins at once (§12.1) — before anything
      // else resumes. Otherwise the interrupted sequence continues.
      if (checkVictory(state, playerId)) return `Smyth's reward: ${def.name} researched free.`;
      resumeAfterReward(state, playerId);
      return `Smyth's reward: ${def.name} researched free.`;
    }
    const shut = researchPrerequisiteShut(state, p, def);
    if (shut) throw new GameError('ILLEGAL_MOVE', shut);
    const { produced, accessNeeded, placements } = validatePayment(state, p, def.cost, move.payment);
    if (def.either && !def.either.some((r) => (produced[r] ?? 0) + (bankOf(p)[r] ?? 0) >= 1)) {
      throw new GameError('ILLEGAL_MOVE', `${def.name} costs ${describeCost(def.cost)} + either ${def.either.map((r) => `1 ${r}`).join(' or ')}`);
    }
    const missing = missingConsent(state, playerId, accessNeeded);
    if (missing.length > 0) {
      return armAccessRequest(state, p, missing, { action: 'research', move: { ...move, payment: placements } }, def.name, accessNeeded.length);
    }
    const leg = def.either?.find((r) => (produced[r] ?? 0) >= 1 || (bankOf(p)[r] ?? 0) >= 1);
    commitPayment(state, p, placements, produced, leg ? { ...def.cost, [leg]: (def.cost[leg] ?? 0) + 1 } : def.cost);
    p.research.push(def.id);
    if (!p.acquiredTypes.includes(def.id)) p.acquiredTypes.push(def.id);
    grantResearchedCard(state, p, def.id, def.name);
    log(state, { phase: 'action', actor: playerId, category: 'research', ...key(`${playerId} researched ${def.name}`, { id: playerId, line: `You researched ${def.name}` }), summary: `${playerId} researches ${def.name} for ${describeCost(produced)}` });
    if (checkVictory(state, playerId)) return `${playerId} researches ${def.name}.`;
  } else {
    // Battle-card purchase: Embassy/DRS + 1Wa+1Wo+1Or + (1Et or 1Oi).
    if (!battleCardUnlocked(p.buildings)) {
      throw new GameError('ILLEGAL_MOVE', `Buying a battle strategy card requires the ${Object.values(BATTLE_CARD_PURCHASE.unlockedBy).join(' or ')}`);
    }
    const base: ResourceCost = { ...BATTLE_CARD_PURCHASE.cost };
    const { produced, accessNeeded, placements } = validatePayment(state, p, base, move.payment);
    if (!BATTLE_CARD_PURCHASE.either.some((r) => (produced[r] ?? 0) + (bankOf(p)[r] ?? 0) >= 1)) {
      throw new GameError('ILLEGAL_MOVE', `A battle-card purchase costs ${describeCost(BATTLE_CARD_PURCHASE.cost)} + either 1 ${BATTLE_CARD_PURCHASE.either.join(' or 1 ')}`);
    }
    const missing = missingConsent(state, playerId, accessNeeded);
    if (missing.length > 0) {
      return armAccessRequest(state, p, missing, { action: 'research', move: { ...move, payment: placements } }, 'battle strategy card', accessNeeded.length);
    }
    const leg = BATTLE_CARD_PURCHASE.either.find((r) => (produced[r] ?? 0) >= 1 || (bankOf(p)[r] ?? 0) >= 1) ?? 'ether';
    commitPayment(state, p, placements, produced, { ...base, [leg]: (base[leg] ?? 0) + 1 });
    // Ruling #87: the first purchased battle strategy card is an acquired
    // type. If that point completes the technology target the game ends here
    // (§12.1); the card itself no longer matters.
    if (!p.acquiredTypes.includes(BATTLE_CARD_TYPE_ID)) {
      p.acquiredTypes.push(BATTLE_CARD_TYPE_ID);
      if (checkVictory(state, playerId)) return `${playerId} buys a battle strategy card — the technology point completes the target.`;
    }
    drawBattleCard(state, p, 'research-purchase');
    if (state.pending?.kind === 'report_draw') {
      return 'Battle card purchased — draw it physically and report (report_draw), or press Draw (digital).';
    }
    // AI seat (or nothing left to draw): the purchase completes now.
  }
  if (maybeArmSecondPurchase(state)) return 'First Research purchase done — Kettering permits a second.';
  finishActionCard(state);
  return 'Research purchase complete.';
}

// ===========================================================================
// Movement (§6.4) + battle trigger (§9.1) — implementation in engine-battle.ts
// ===========================================================================

function doMoveUnits(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'move_units' }>): string {
  requireActionActive(state, playerId, 'move_battle');
  // Moving without casting first is simply not using Elara's spell: it comes
  // at the start of the action, before movement (§6.4), as its own move.
  return executeMove(state, byId(state, playerId), move);
}

/** The real movement resolution (also the resume target of Elara's spell). */
export function executeMove(state: NGGState, p: PlayerState, move: Extract<NGGMove, { type: 'move_units' }>): string {
  const from = resolveCoord(state.tiles, move.from);
  const to = resolveCoord(state.tiles, move.to);
  const fromTile = tileAt(state, from);
  if (!neighborsOf(state.tiles, fromTile.c, fromTile.r).some((t) => coordKey(t.c, t.r) === to)) {
    throw new GameError('ILLEGAL_MOVE', `${to} is not adjacent to ${from}`);
  }
  const movable = eligibleMovers(state, p, from);
  const chosen: Array<{ kind: 'unit' | 'hero'; id: string }> = [];
  for (const want of move.units) {
    const found = movable.filter((m) => !chosen.some((c) => c.id === m.id) && moverMatches(m, want));
    if (found.length === 0) throw new GameError('ILLEGAL_MOVE', `No eligible mobile unit "${want}" of yours at ${from}`);
    if (found.length > 1) throw new GameError('AMBIGUOUS_MOVE', `"${want}" matches several units at ${from} — name by unit id (${found.map((f) => f.id).join(', ')})`);
    chosen.push(found[0]!);
  }
  if (chosen.length === 0) throw new GameError('ILLEGAL_MOVE', 'move_units needs at least one unit');
  const conflict = entryConflict(state, p, to);
  if (conflict === 'peace-blocked') {
    throw new GameError('ILLEGAL_MOVE', `Peace with the partner at ${to} prohibits entering their locations or attacking them`);
  }
  if (state.activeAction) state.activeAction.acted = true;
  for (const c of chosen) {
    if (c.kind === 'unit') state.units.find((u) => u.id === c.id)!.coord = to;
    else state.heroes.find((x) => x.id === c.id)!.coord = to;
  }
  // The Economy overlays follow their heroes: both tiles' may change (§8.3).
  refreshOverlay(state, from);
  refreshOverlay(state, to);
  log(state, { phase: 'action', actor: p.playerId, category: 'movement', ...key(`${p.playerId} moved ${chosen.length} ${chosen.length === 1 ? 'unit' : 'units'} from ${from} to ${to}`, { id: p.playerId, line: `You moved ${chosen.length} ${chosen.length === 1 ? 'unit' : 'units'} from ${from} to ${to}` }), summary: `${p.playerId} moves ${movable.filter((m) => chosen.some((c) => c.id === m.id)).map((m) => m.label).join(', ')} from ${from} to ${to}` });
  if (typeof conflict === 'object' && conflict.kind === 'battle') {
    startBattle(state, p, from, to, chosen, conflict.defenders);
    return `Battle begins at ${to}!`;
  }
  if (typeof conflict === 'object' && conflict.kind === 'sweep') {
    const removed = sweepLocation(state, p, to);
    finishActionCard(state);
    return `${p.playerId} moves to ${to}; ${removed.length ? `${removed.join(', ')} removed` : 'nothing unprotected there'}.`;
  }
  finishActionCard(state);
  return `${p.playerId} moves ${chosen.length} unit(s) to ${to}.`;
}

export interface MoverEntry { kind: 'unit' | 'hero'; id: string; label: string }

function moverMatches(m: MoverEntry, want: string): boolean {
  if (m.id === want) return true;
  const hero = HEROES.find((h) => h.id === m.id);
  if (hero && hero.name.toLowerCase() === want.toLowerCase()) return true;
  const unit = unitById(m.label === m.id ? '' : '') ?? null;
  void unit;
  return m.label.toLowerCase() === want.toLowerCase();
}

export function eligibleMovers(state: NGGState, p: PlayerState, from: Coord): MoverEntry[] {
  const out: MoverEntry[] = [];
  for (const u of unitsAt(state, from)) {
    if (u.ownerId !== p.playerId) continue;
    const def = unitById(u.typeId)!;
    if (def.collector) continue;
    if (def.immobile) continue;
    if (def.needsCore && !u.allocatedCoreId) continue;
    out.push({ kind: 'unit', id: u.id, label: def.name });
  }
  for (const h of heroesAt(state, from)) {
    if (h.ownerId !== p.playerId) continue;
    out.push({ kind: 'hero', id: h.id, label: HEROES.find((x) => x.id === h.id)!.name });
  }
  return out;
}

function entryConflict(state: NGGState, p: PlayerState, to: Coord): { kind: 'free' } | 'peace-blocked' | { kind: 'battle'; defenders: string[] } | { kind: 'sweep' } {
  const others = new Set<string>([
    ...unitsAt(state, to).map((u) => u.ownerId),
    ...heroesAt(state, to).map((h) => h.ownerId),
    ...collectorsAt(state, to).map((c) => c.ownerId),
    ...(baseAt(state, to) ? [baseAt(state, to)!.ownerId] : []),
  ]);
  others.delete(p.playerId);
  for (const owner of others) {
    if (treatyBetween(state, p.playerId, owner, 'peace')) return 'peace-blocked';
  }
  if (others.size === 0) return { kind: 'free' };
  const hasOpposingCombat = unitsAt(state, to).some((u) => u.ownerId !== p.playerId && !areMilitaryAllies(state, p.playerId, u.ownerId) && isCombatUnit(u))
    || heroesAt(state, to).some((h) => h.ownerId !== p.playerId && !areMilitaryAllies(state, p.playerId, h.ownerId));
  if (hasOpposingCombat) {
    const defenders = [...others].filter((o) => unitsAt(state, to).some((u) => u.ownerId === o) || heroesAt(state, to).some((h) => h.ownerId === o));
    return { kind: 'battle', defenders };
  }
  return { kind: 'sweep' };
}

/** Why Elara's spell may not target a tile now, or null. A Peace partner's
 *  location cannot be attacked (§6.4); the spell reaches an ADJACENT space. */
export function elaraSpellShut(state: NGGState, playerId: string, target: Coord): string | null {
  const elara = state.heroes.find((h) => h.id === 'elara' && h.ownerId === playerId && !h.dead && h.coord !== null);
  if (!elara) return 'Elara is not in play';
  const elaraTile = tileAt(state, elara.coord!);
  if (!neighborsOf(state.tiles, elaraTile.c, elaraTile.r).some((t) => coordKey(t.c, t.r) === target)) {
    return `Elara's spell targets a space ADJACENT to her (${tileName(target)} is not)`;
  }
  const occupants = new Set<string>([
    ...unitsAt(state, target).map((u) => u.ownerId),
    ...heroesAt(state, target).map((h) => h.ownerId),
    ...collectorsAt(state, target).map((c) => c.ownerId),
  ]);
  occupants.delete(playerId);
  for (const o of occupants) {
    if (treatyBetween(state, playerId, o, 'peace')) return `Peace forbids attacking ${o}'s location`;
  }
  return null;
}

// Elara's spell (§6.4/§8.4): at the START of a Move/Battle action, before any
// movement: 5 mana, 4 damage to all units in an adjacent space except your own
// and Open Borders/Peace allies'; NOT a battle (no cards/Clerics/Decoy/Wall).
// Collectors there die to the hit (§7.1). Moving afterwards is optional.
function doCastElaraSpell(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'cast_elara_spell' }>): string {
  const p = byId(state, playerId);
  // Sessions saved mid-question under the old flow held an elara_spell
  // pending; settle it into the current flow (cast or not, then move freely).
  if (state.pending?.kind === 'elara_spell') {
    if (state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your Elara decision');
    state.pending = null;
    if (move.skip || move.target_location === null) return `Elara does not cast. Move, or end the action.`;
  } else {
    requireActionActive(state, playerId, 'move_battle');
    if (state.activeAction!.elaraCast) throw new GameError('ILLEGAL_MOVE', 'Elara already cast her spell this action');
    if (move.skip || move.target_location === null) throw new GameError('ILLEGAL_MOVE', 'To not cast, simply move or skip the action');
  }
  const target = resolveCoord(state.tiles, move.target_location!);
  const shut = elaraSpellShut(state, playerId, target);
  if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  if (p.manaCurrent < 5) throw new GameError('ILLEGAL_MOVE', `Elara's spell costs 5 mana (you have ${p.manaCurrent})`);
  p.manaCurrent -= 5;
  if (state.activeAction) { state.activeAction.elaraCast = true; state.activeAction.acted = true; }
  const removed: string[] = [];
  const spared = (owner: string) => owner === playerId || areMilitaryAllies(state, playerId, owner);
  // Units only: a Coreless platform is not a unit (§7.7) and is not hit.
  for (const u of [...unitsAt(state, target)]) {
    if (spared(u.ownerId) || !isUnitPiece(u)) continue;
    const def = effectiveDef(state, u);
    if (def !== null && def <= 4) { removeMapUnit(state, u); removed.push(`${u.ownerId}'s ${unitById(u.typeId)?.name ?? u.typeId}`); }
  }
  for (const c of [...collectorsAt(state, target)]) {
    if (spared(c.ownerId)) continue;
    destroyCollector(state, c, "Elara's spell");
    removed.push(`${c.ownerId}'s ${collectorLabel(c.collectorId)}`);
  }
  for (const h of [...heroesAt(state, target)]) {
    if (spared(h.ownerId)) continue;
    const def = heroStatsForCategory(HEROES.find((x) => x.id === h.id)!.category, h.isLeader).def;
    if (def <= 4) { killHero(state, h, playerId, false); removed.push(`${h.ownerId}'s ${h.isLeader ? 'Leader ' : ''}${HEROES.find((x) => x.id === h.id)!.name}`); }
  }
  refreshOverlay(state, target);
  // The headline names each owner once ("X's A, B, C"), so a spell that
  // kills three of one seat's heroes stays under the headline length cap.
  const byOwner = new Map<string, string[]>();
  for (const r of removed) { const at = r.indexOf("'s "); const owner = r.slice(0, at); const what = r.slice(at + 3); if (!byOwner.has(owner)) byOwner.set(owner, []); byOwner.get(owner)!.push(what); }
  const grouped = [...byOwner].map(([owner, whats]) => `${owner}'s ${whats.join(', ')}`).join('; ');
  log(state, { phase: 'action', actor: playerId, category: 'spell', ...key(`${playerId}'s Elara cast her spell on ${target}${removed.length ? `: ${grouped} killed` : ''}`, { id: playerId, line: `Your Elara cast her spell on ${target}${removed.length ? `: ${grouped} killed` : ''}` }), summary: `${playerId}'s Elara casts her spell on ${target} for 5 mana (this is not a battle): ${removed.length ? `${grouped} destroyed` : 'nothing is destroyed'}` });
  if (!state.result) checkAllLeadersDeadDraw(state);
  state.activePlayerId = playerId;
  return `Elara's spell hits ${target}: ${removed.join(', ') || 'no casualties'}. Moving is now optional — move, or end the action.`;
}

// ===========================================================================
// Treaties (§11)
// ===========================================================================

/** Ruling (2026-09-22, training gate): a treaty offer the partner declined
 *  cannot be re-offered by the same proposer to the same partner in the same
 *  round. The printed text names the windows but not a limit; without one
 *  the offer/decline pair repeats inside one action forever (a learner seat
 *  did it 1,447 times in one round, `TRAINING-NOTES.md` §2). The built-in
 *  AI already followed this as its own policy; the engine now enforces it
 *  for every seat. Next round the offer is open again. */
export function treatyDeclinedThisRound(state: NGGState, proposerId: string, partnerId: string, treatyName: string): boolean {
  return state.log.some((e) => e.turn === state.round && e.actor === partnerId && e.category === 'treaty'
    && e.summary === `${partnerId} declines ${treatyName} from ${proposerId}`);
}

/** Every treaty the active player could offer right now (§11.1): a partner
 *  they hold no treaty with, a type neither has committed, an unlock on
 *  either side, and not an offer already declined this round. The one
 *  statement of it: the menu lists these, and the end-of-action window opens
 *  only when there is one. */
export function openTreatyOffers(state: NGGState, playerId: string): Array<{ partner: string; treaty: (typeof TREATIES)[number] }> {
  const out: Array<{ partner: string; treaty: (typeof TREATIES)[number] }> = [];
  for (const q of state.players) {
    if (q.playerId === playerId) continue;
    if (anyTreatyBetween(state, playerId, q.playerId).length > 0) continue;
    if (!hasTreatyUnlock(state, playerId) && !hasTreatyUnlock(state, q.playerId)) continue;
    for (const t of TREATIES) {
      if (t.id === 'culture-treaty' && state.players.length < 4) continue;
      if (state.treaties.some((x) => x.type === t.id && (x.partners.includes(playerId) || x.partners.includes(q.playerId)))) continue;
      if (treatyDeclinedThisRound(state, playerId, q.playerId, t.name)) continue;
      out.push({ partner: q.playerId, treaty: t });
    }
  }
  return out;
}

function doFormTreaty(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'form_treaty' }>): string {
  if (state.battle) throw new GameError('ILLEGAL_MOVE', 'Treaties cannot form while a battle resolves');
  const activeId = state.activeAction?.ownerId ?? null;
  if (activeId !== playerId) throw new GameError('ILLEGAL_MOVE', `Treaties form only at the start or end of the ACTIVE player's action (${activeId ?? 'none'} is active)`);
  const partner = findPlayerByNameOrId(state, move.partner);
  if (partner.playerId === playerId) throw new GameError('ILLEGAL_MOVE', 'A treaty needs two different players');
  const treaty = resolveTreaty(move.treaty_type);
  if (treaty.id === 'culture-treaty' && state.players.length < 4) {
    throw new GameError('ILLEGAL_MOVE', 'The Culture Treaty is available only at four or more players (§11.2)');
  }
  if (anyTreatyBetween(state, playerId, partner.playerId).length > 0) {
    throw new GameError('ILLEGAL_MOVE', `You already hold a treaty with ${partner.playerId} (one active treaty per other player)`);
  }
  for (const who of [playerId, partner.playerId]) {
    if (state.treaties.some((t) => t.type === treaty.id && t.partners.includes(who))) {
      throw new GameError('ILLEGAL_MOVE', `${who}'s ${treaty.name} token is already committed (one per treaty type)`);
    }
  }
  if (!hasTreatyUnlock(state, playerId) && !hasTreatyUnlock(state, partner.playerId)) {
    throw new GameError('ILLEGAL_MOVE', 'Neither partner holds a treaty unlock (Embassy, Diplomatic Research Station, or active Envoy)');
  }
  if (treatyDeclinedThisRound(state, playerId, partner.playerId, treaty.name)) {
    throw new GameError('ILLEGAL_MOVE', `${partner.playerId} already declined ${treaty.name} from you this round — offer it again next round`);
  }
  state.pending = { kind: 'treaty_response', forPlayerId: partner.playerId, proposerId: playerId, treatyType: treaty.id };
  state.activePlayerId = partner.playerId;
  log(state, { phase: 'action', actor: playerId, category: 'treaty', ...key(`${playerId} offered ${treaty.name} to ${partner.playerId}`, { id: partner.playerId, line: `${playerId} offered you ${treaty.name}` }), summary: `${playerId} offers ${treaty.name} to ${partner.playerId}` });
  return `${playerId} offers ${treaty.name} to ${partner.playerId} — awaiting their response.`;
}

export function hasTreatyUnlock(state: NGGState, playerId: string): boolean {
  const p = byId(state, playerId);
  if (p.species && p.buildings.includes(TREATY_UNLOCK.buildings[p.species])) return true;
  if (heroAlivePlaced(state, playerId, TREATY_UNLOCK.heroId)) return true;
  return false;
}

/** What a seat has not unlocked yet, and what it needs (§6.3, §6.5, §11.1):
 *  units whose building is not built, technologies whose prerequisite is
 *  missing, treaty formation, and the battle-card purchase. Only unlocks —
 *  never cost, caps or timing. Keyed by printed name. Public: buildings and
 *  heroes are public. */
export function lockedFor(state: NGGState, p: PlayerState): {
  units: Record<string, string>; research: Record<string, string>; treaties: string | null; battle_cards: string | null;
} {
  const out = { units: {} as Record<string, string>, research: {} as Record<string, string>, treaties: null as string | null, battle_cards: null as string | null };
  if (!p.species) return out;
  const species = p.species;
  for (const u of unitsForSpecies(species)) {
    if (u.requiresBuilding && !p.buildings.includes(u.requiresBuilding)) out.units[u.name] = `needs ${aOrAn(u.requiresBuilding)} ${u.requiresBuilding}`;
  }
  for (const r of researchForSpecies(species)) {
    if (p.research.includes(r.id)) continue;
    if (researchPrerequisiteShut(state, p, r)) out.research[r.name] = r.prerequisite === 'Home' ? 'needs a Home on the map' : `needs ${aOrAn(r.prerequisite)} ${r.prerequisite}`;
  }
  if (!hasTreatyUnlock(state, p.playerId)) {
    const b = TREATY_UNLOCK.buildings[species];
    const envoy = HEROES.find((h) => h.id === TREATY_UNLOCK.heroId)!.name;
    out.treaties = `needs ${aOrAn(b)} ${b} or ${envoy} placed; a partner who has one can still form treaties with you`;
  }
  if (!battleCardUnlocked(p.buildings)) {
    const b = BATTLE_CARD_PURCHASE.unlockedBy[species];
    out.battle_cards = `needs ${aOrAn(b)} ${b}`;
  }
  return out;
}

function doRespondTreaty(state: NGGState, playerId: string, accept: boolean): string {
  if (state.pending?.kind !== 'treaty_response' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No treaty offer awaits your response');
  }
  const { proposerId, treatyType } = state.pending;
  state.pending = null;
  const def = TREATIES.find((t) => t.id === treatyType)!;
  if (!accept) {
    log(state, { phase: 'action', actor: playerId, category: 'treaty', ...key(`${playerId} declined ${def.name} from ${proposerId}`, { id: proposerId, line: `${playerId} declined your ${def.name} offer`, notify: true }), summary: `${playerId} declines ${def.name} from ${proposerId}` });
    state.activePlayerId = proposerId;
    return `${playerId} declines.`;
  }
  state.treaties.push({ type: treatyType, partners: [proposerId, playerId] });
  log(state, { phase: 'action', actor: playerId, category: 'treaty', ...key(`${proposerId} and ${playerId} formed ${def.name}`, { id: proposerId, line: `${playerId} accepted your ${def.name} offer`, notify: true }), summary: `${proposerId} and ${playerId} form ${def.name} (+${def.cultureIncome} culture to each per round)` });
  state.activePlayerId = proposerId;
  return `${def.name} formed between ${proposerId} and ${playerId}.`;
}

function doBreakTreaty(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'break_treaty' }>): string {
  const treaty = resolveTreaty(move.treaty_type);
  const partner = findPlayerByNameOrId(state, move.partner);
  const t = state.treaties.find((x) => x.type === treaty.id && x.partners.includes(playerId) && x.partners.includes(partner.playerId));
  if (!t) throw new GameError('ILLEGAL_MOVE', `You hold no ${treaty.name} with ${partner.playerId}`);
  const shut = treatyBreakGate.check(state, playerId, t);
  if (shut) throw new GameError('ILLEGAL_MOVE', shut);
  state.treaties = state.treaties.filter((x) => x !== t);
  log(state, { phase: state.phase, actor: playerId, category: 'treaty', ...key(`${playerId} broke ${treaty.name} with ${partner.playerId}`, { id: partner.playerId, line: `${playerId} broke ${treaty.name} with you`, loss: true, notify: true }), summary: `${playerId} breaks ${treaty.name} with ${partner.playerId}` });
  if (state.phase === 'treaty_break' && state.pending?.kind === 'treaty_break_decision' && state.pending.forPlayerId === playerId) {
    // The decision still belongs to the same seat until it explicitly passes
    // (they may hold more breakable treaties of their own).
    if (!holdsBreakableTreaty(state, playerId)) {
      state.pending = null;
      advanceTreatyBreak(state);
    }
  }
  return `${treaty.name} broken.`;
}

export function findPlayerByNameOrId(state: NGGState, who: string): PlayerState {
  const byPid = state.players.find((p) => p.playerId === who);
  if (byPid) return byPid;
  const norm = who.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byName = state.players.filter((p) => {
    const fname = p.factionId ? (FACTIONS.find((f) => f.id === p.factionId)?.name ?? '') : '';
    return fname.toLowerCase().replace(/[^a-z0-9]+/g, '') === norm || (p.playerId.toLowerCase() === who.toLowerCase());
  });
  if (byName.length === 1) return byName[0]!;
  throw new GameError('ILLEGAL_MOVE', `Unknown player "${who}" — use a player_id (${state.players.map((p) => p.playerId).join(', ')})`);
}

// ===========================================================================
// choose_spy — the private assignment pick (§7.3/§7.9)
// ===========================================================================

function doChooseSpy(state: NGGState, playerId: string, heroName: string): string {
  if (state.pending?.kind !== 'choose_spy' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No spy assignment is owed by you');
  }
  const hero = resolveHero(heroName);
  const mine = state.heroes.find((h) => h.id === hero.id && h.ownerId === playerId && !h.dead);
  if (!mine) throw new GameError('ILLEGAL_MOVE', `${hero.name} is not your living hero`);
  if (state.players.some((pl) => pl.spyAssignments.some((s) => s.active && s.heroId === hero.id))) {
    throw new GameError('ILLEGAL_MOVE', `${hero.name} already carries an active spy assignment`);
  }
  const pend = state.pending;
  byId(state, playerId).spyAssignments.push({ source: pend.source, heroId: hero.id, active: true });
  state.pending = null;
  // The summary must never name the hero (recruitment public, assignment secret).
  log(state, { phase: state.phase, actor: playerId, category: 'spy', summary: `${playerId} privately assigns their ${pend.source === 'illusionist' ? 'Illusionist' : 'Infiltrator'} spy (hero undisclosed)` });
  if (state.phase === 'action' && state.activeAction) {
    if (maybeArmSecondPurchase(state)) return 'Spy assigned (privately). A second purchase is available.';
    finishActionCard(state);
    return 'Spy assigned (privately). The purchase completes.';
  }
  return 'Spy assigned (privately).';
}

// ===========================================================================
// Battle moves — implemented in engine-battle.ts
// ===========================================================================

import {
  commitBattleCard, chooseCounterTarget, selectExtraCards, battleActivation,
  resolveBattleDefense, chooseRetreat, selectRallyUnits, resolveOverlayChoice,
  advanceAfterActivation, chooseInitiativeOrder, probeUnitDef,
} from './engine-battle.js';

// ===========================================================================
// Culture phase / claims / end of round (§5.4–5.6)
// ===========================================================================

export function beginCulturePhase(state: NGGState): void {
  state.phase = 'culture';
  log(state, { phase: 'culture', actor: null, category: 'phase', ...key('Culture income'), summary: 'Culture phase: each player gains their culture income, in first-player order' });
  const order = playerOrderFrom(state, state.firstPlayerIndex);
  for (const pid of order) {
    const p = byId(state, pid);
    const gain = cultureIncomeFor(state, p);
    const before = p.culture;
    if (gain > 0) {
      p.culture += gain;
      log(state, { phase: 'culture', actor: pid, category: 'income', ...key(`${pid} gained ${gain} culture (now ${p.culture})`, { id: pid, line: `You gained ${gain} culture (now ${p.culture})` }), summary: `${pid} gains ${gain} culture (${before} → ${p.culture})`, gained: [{ resource: 'culture', amount: gain }] });
      markMilestones(state, p, before);
      if (checkVictory(state, pid)) return; // mid-income win ends before claims (§14.6)
    } else {
      markMilestones(state, p, before);
    }
  }
  beginClaimsPhase(state);
}

function markMilestones(state: NGGState, p: PlayerState, beforeCulture: number): void {
  const already = state.milestonesCrossed[p.playerId] ?? [];
  const fresh = milestonesFor(state.players.length).filter((m) => beforeCulture < m && p.culture >= m && !already.includes(m));
  if (fresh.length === 0) return;
  state.milestonesCrossed[p.playerId] = [...already, ...fresh];
  state.claimsOwed[p.playerId] = (state.claimsOwed[p.playerId] ?? 0) + fresh.length;
}

export function cultureIncomeFor(state: NGGState, p: PlayerState): number {
  let inc = 0;
  if (p.species === 'wizard') {
    const amph = p.buildings.includes('Amphitheatre');
    inc += p.subjects * (amph ? 2 : 1);
  } else {
    inc += p.coresInReserve;
    if (p.buildings.includes('Third Space')) inc += 5;
  }
  // Chronicler: +5 a round (designer ruling #114, 2026-09-30; #82 had +2).
  if (heroAlivePlaced(state, p.playerId, 'chronicler')) inc += 5;
  for (const t of state.treaties) {
    if (t.partners.includes(p.playerId)) inc += TREATIES.find((x) => x.id === t.type)!.cultureIncome;
  }
  return inc;
}

function beginClaimsPhase(state: NGGState): void {
  state.phase = 'claims';
  state.claimLastServed = undefined;
  if (state.heroPool.length === 0) state.claimsOwed = {};
  armNextClaim(state);
}

/** §5.5: proceed in first-player order, each owed player choosing ONE, and
 *  repeat the order while anyone is still owed — a player owed two does not
 *  take both before another gets their first. Runs until every owed claim is
 *  settled (or the pool runs out), however many cycles that takes. */
function armNextClaim(state: NGGState): void {
  if (state.result || state.pending) return;
  const order = playerOrderFrom(state, state.firstPlayerIndex);
  // The next owed seat AFTER the last claimant, in first-player order.
  const last = state.claimLastServed ?? null;
  const ordered = last === null
    ? order
    : [...order.slice(order.indexOf(last) + 1), ...order.slice(0, order.indexOf(last) + 1)];
  for (const pid of ordered) {
    const owed = state.claimsOwed[pid] ?? 0;
    if (owed <= 0) continue;
    const p = byId(state, pid);
    const owned = state.heroes.filter((h) => h.ownerId === pid && !h.dead).length;
    const eligible = heroesEligibleFor(speciesOf(p)).filter((h) => state.heroPool.includes(h.id));
    if (eligible.length === 0 || owned >= MAX_HEROES_PER_PLAYER) { state.claimsOwed[pid] = 0; continue; }
    // Every seat — AI included — makes its own pick through the claim
    // question; the claims resume from doChooseMilestoneHero.
    state.pending = { kind: 'choose_milestone_hero', forPlayerId: pid, claimsOwed: owed };
    state.activePlayerId = pid;
    return;
  }
  endOfRound(state);
}

function grantHeroToPlayer(state: NGGState, p: PlayerState, heroId: string): void {
  const def = HEROES.find((h) => h.id === heroId)!;
  state.heroPool = state.heroPool.filter((h) => h !== heroId);
  const hero: HeroInstance = { id: heroId, ownerId: p.playerId, coord: null, isLeader: false, dead: false };
  state.heroes.push(hero);
  const myBases = state.bases.filter((b) => b.ownerId === p.playerId);
  if (myBases.length > 1) {
    // A claimed hero goes to any base its owner chooses: with more than one,
    // the claimant is asked (the reserved-hero placement), and the benefit
    // begins when the hero lands.
    log(state, { phase: 'claims', actor: p.playerId, category: 'hero-claim', ...key(`${p.playerId} claimed ${def.name}`, { id: p.playerId, line: `You claimed ${def.name}` }), summary: `${p.playerId} claims ${def.name} and chooses which base they go to` });
    state.pending = { kind: 'place_reserved_hero', forPlayerId: p.playerId, heroId };
    state.activePlayerId = p.playerId;
  } else if (myBases.length === 1) {
    hero.coord = myBases[0]!.coord;
    log(state, { phase: 'claims', actor: p.playerId, category: 'hero-claim', ...key(`${p.playerId} claimed ${def.name}`, { id: p.playerId, line: `You claimed ${def.name}` }), summary: `${p.playerId} claims ${def.name} and places them at ${hero.coord}` });
    refreshOverlay(state, hero.coord);
    applyHeroBenefit(state, p, heroId);
    // A bonus technology point (Motherboard/Greymore) can complete the
    // technological victory: checked at once (§12.1, §12.5).
    checkVictory(state, p.playerId);
  } else {
    log(state, { phase: 'claims', actor: p.playerId, category: 'hero-claim', ...key(`${p.playerId} claimed ${def.name} (reserved: no base)`, { id: p.playerId, line: `You claimed ${def.name} (reserved: no base)` }), summary: `${p.playerId} claims ${def.name} and RESERVES them (no base) — no benefits until placed` });
  }
}

function doChooseMilestoneHero(state: NGGState, playerId: string, heroName: string): string {
  if (state.pending?.kind !== 'choose_milestone_hero' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No milestone claim is owed by you');
  }
  const p = byId(state, playerId);
  const hero = resolveHero(heroName);
  if (!state.heroPool.includes(hero.id)) throw new GameError('ILLEGAL_MOVE', `${hero.name} is not in the hero pool`);
  if (hero.species && hero.species !== speciesOf(p)) throw new GameError('ILLEGAL_MOVE', `${hero.name} is ${hero.species}-only`);
  // Clear the CLAIM pending first — a grant (Smyth's free research,
  // Chaimidious's draw) arms its OWN pending and must survive (§8.4;
  // probe finding #11 dropped it between claim and reward).
  state.claimsOwed[playerId] = (state.claimsOwed[playerId] ?? 1) - 1;
  state.claimLastServed = playerId;
  state.pending = null;
  grantHeroToPlayer(state, p, hero.id);
  // A win ends it here; a grant that nested a pending (a base to choose,
  // Chaimidious's draw, Smyth's pick) resumes the claims when it resolves.
  if (state.result || state.pending) return `${playerId} claims ${hero.name}.`;
  armNextClaim(state);
  return `${playerId} claims ${hero.name}.`;
}

/** A hero reserved for want of a base is placed as soon as its owner has one
 *  (rules decision 2026-09-24): arm the placement for the first such hero.
 *  Nothing is paid back for the rounds it waited. */
function armReservedPlacement(state: NGGState, p: PlayerState): boolean {
  if (!state.bases.some((b) => b.ownerId === p.playerId)) return false;
  const reserved = state.heroes.find((h) => h.ownerId === p.playerId && !h.dead && h.coord === null);
  if (!reserved) return false;
  state.pending = { kind: 'place_reserved_hero', forPlayerId: p.playerId, heroId: reserved.id };
  state.activePlayerId = p.playerId;
  return true;
}

function doPlaceReservedHero(state: NGGState, playerId: string, move: Extract<NGGMove, { type: 'place_reserved_hero' }>): string {
  if (state.pending?.kind !== 'place_reserved_hero' || state.pending.forPlayerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No reserved-hero placement is owed by you');
  }
  const p = byId(state, playerId);
  const heroDef = resolveHero(move.hero);
  const hero = state.heroes.find((h) => h.id === heroDef.id && h.ownerId === playerId && !h.dead && h.coord === null);
  if (!hero) throw new GameError('ILLEGAL_MOVE', `${heroDef.name} is not reserved by you`);
  if (!move.coord && state.bases.filter((b) => b.ownerId === playerId).length > 1) {
    throw new GameError('ILLEGAL_MOVE', 'Name the base the hero goes to (coord)');
  }
  const coord = resolveSpawnBase(state, p, move.coord ?? null);
  hero.coord = coord;
  state.pending = null;
  log(state, { phase: state.phase, actor: playerId, category: 'hero-placement', ...key(`${playerId} placed ${heroDef.name} at ${coord}`, { id: playerId, line: `You placed ${heroDef.name} at ${coord}` }), summary: `${playerId} places ${heroDef.name} at ${coord} — its benefits are now live` });
  refreshOverlay(state, coord);
  applyHeroBenefit(state, p, hero.id);
  // A bonus technology point can win at once (§12.1).
  if (checkVictory(state, playerId)) return `${playerId} places ${heroDef.name} at ${coord}.`;
  // Unless the benefit opened a decision of its own (Smyth's reward,
  // Chaimidious's draw — each resumes from there): the next reserved hero,
  // then whatever was running (the claims, or the Build that raised a base).
  resumeAfterReward(state, playerId);
  return `${playerId} places ${heroDef.name} at ${coord}.`;
}

function endOfRound(state: NGGState): void {
  state.phase = 'end_of_round';
  log(state, { phase: 'end_of_round', actor: null, category: 'phase', ...key('End of the round'), summary: `End of round ${state.round}: treaties may be broken now, then the next round's upkeep` });
  state.claimsOwed = {};
  // §5.6: end of round is a REAL window — every seat holding a treaty it may
  // break now (Culture Treaties included) is asked, break or keep, in
  // first-player order, before upkeep runs.
  state.phase = 'treaty_break';
  (state as { treatyBreakQueue?: string[] }).treatyBreakQueue = playerOrderFrom(state, state.firstPlayerIndex);
  advanceTreatyBreak(state);
}

/** Whether a seat holds any treaty it may break right now. */
function holdsBreakableTreaty(state: NGGState, playerId: string): boolean {
  return state.treaties.some((t) => t.partners.includes(playerId) && treatyBreakGate.check(state, playerId, t) === null);
}

/** Continue the treaty-break decision queue; when empty, upkeep starts. */
function advanceTreatyBreak(state: NGGState): void {
  const queue = [...((state as { treatyBreakQueue?: string[] }).treatyBreakQueue ?? [])];
  delete (state as { treatyBreakQueue?: string[] }).treatyBreakQueue;
  while (queue.length > 0) {
    const pid = queue.shift()!;
    const p = state.players.find((x) => x.playerId === pid)!;
    // AI seats are asked too (2026-09-26): until now the engine skipped them
    // here, so no AI ever broke a treaty whatever its policy said.
    if (!holdsBreakableTreaty(state, pid)) continue;
    if (queue.length > 0) (state as { treatyBreakQueue?: string[] }).treatyBreakQueue = queue;
    state.pending = { kind: 'treaty_break_decision', forPlayerId: pid };
    state.activePlayerId = pid;
    return;
  }
  state.pending = null;
  state.phase = 'end_of_round';
  runUpkeep(state);
}

function doSkipAction(state: NGGState, playerId: string): string {
  if (state.pending?.kind === 'treaty_break_decision') {
    if (state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your treaty-break decision');
    state.pending = null;
    log(state, { phase: 'treaty_break', actor: playerId, category: 'treaty', summary: `${playerId} keeps all treaties (end of round)` });
    advanceTreatyBreak(state);
    return `${playerId} breaks nothing.`;
  }
  if (state.pending?.kind === 'second_purchase') {
    if (state.pending.forPlayerId !== playerId) throw new GameError('NOT_YOUR_TURN', 'Not your second-purchase decision');
    state.pending = null;
    finishActionCard(state);
    return `${playerId} declines the second purchase.`;
  }
  if (!state.activeAction || state.activeAction.ownerId !== playerId) {
    throw new GameError('ILLEGAL_MOVE', 'No queued action of yours is resolving to skip');
  }
  if (state.battle) throw new GameError('ILLEGAL_MOVE', 'A battle is resolving — skipping is no longer available');
  const kind = state.activeAction.cardKind;
  if (state.activeAction.endWindow) {
    closeActionCard(state);
    return `${playerId} ends the ${actionCardName(kind)} action.`;
  }
  if (state.activeAction.elaraCast) {
    // Elara's spell was the action; moving afterwards is optional (§6.4).
    log(state, { phase: 'action', actor: playerId, category: 'action', summary: `${playerId} does not move after Elara's spell` });
    finishActionCard(state);
    return `${playerId} ends the Move/Battle action without moving.`;
  }
  log(state, { phase: 'action', actor: playerId, category: 'action', ...key(`${playerId} skipped their ${actionCardName(kind)}`, { id: playerId, line: `You skipped your ${actionCardName(kind)}` }), summary: `${playerId} declines their ${actionCardName(kind)} action (the card is used up for the round)` });
  closeActionCard(state);
  return `${playerId} skips the ${kind} action.`;
}

// autoResolveReport — the digital draw-button filler + harness driver. Never
// settles an owner:'player' choice; only the randomness reveal of a card draw.
export function autoReportMove(state: NGGState, playerId: string): NGGMove | null {
  if (state.pending?.kind === 'report_draw' && state.pending.forPlayerId === playerId) {
    const p = byId(state, playerId);
    if (p.digital === true) return { type: 'resolve_report' };
  }
  return null;
}

// settleBattle is re-exported so legalMoves/ai can probe battle completion.
export { settleBattle, effectiveResourceAt as currentResource };

// researchById/unitById re-export used by views/legalMoves.
export { researchById, unitById };
