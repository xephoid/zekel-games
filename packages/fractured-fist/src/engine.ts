import { GameError } from '@zekel/game-kit';
import {
  DEFAULT_LOADOUT,
  FOCUS_RELOADS_PER_TURN,
  MAX_MISSTEPS,
  RESOURCE_SUPPLY_COUNT,
  STARTING_DECK,
  SUPPLY_RESOURCES,
  TECHNIQUE_SUPPLY_COUNT,
  getCard,
  resolveCardId,
  tryGetCard,
} from './cards.js';
import { shuffle } from '@zekel/game-kit';
import { cap, count, idAsName, listJoin, possessive, type NameOf } from './narration.js';
import type {
  FFMove,
  FFOptions,
  FFState,
  OpaquePlayerState,
  PlayerKind,
  PlayerState,
  TrackedPlayerState,
} from './types.js';

const DEFAULT_STAMINA = 7;
const DEFAULT_HAND_SIZE = 5;

// -------- Initialization --------

export function createInitialState(
  playerIds: string[],
  playerKinds: Record<string, PlayerKind>,
  options: FFOptions | undefined,
  seed: number,
): FFState {
  if (playerIds.length !== 2) {
    throw new GameError(
      'INVALID_PLAYERS',
      `Fractured Fist requires exactly 2 players; got ${playerIds.length}`,
    );
  }
  const startingStamina = options?.startingStamina ?? DEFAULT_STAMINA;
  const handSize = options?.handSize ?? DEFAULT_HAND_SIZE;
  const loadout = options?.loadout && options.loadout.length > 0 ? options.loadout : DEFAULT_LOADOUT;

  for (const id of loadout) {
    const c = tryGetCard(id);
    if (!c) throw new GameError('INVALID_OPTIONS', `Unknown loadout card: ${id}`);
    if (c.type !== 'TECHNIQUE') {
      throw new GameError('INVALID_OPTIONS', `Loadout must be technique cards: ${id} is ${c.type}`);
    }
  }

  let rng = seed;
  const players: Record<string, PlayerState> = {};

  const buildSupply = (): Record<string, number> => {
    const s: Record<string, number> = {};
    for (const id of SUPPLY_RESOURCES) s[id] = RESOURCE_SUPPLY_COUNT;
    for (const id of loadout) s[id] = TECHNIQUE_SUPPLY_COUNT;
    return s;
  };

  for (const pid of playerIds) {
    const kind = playerKinds[pid] ?? 'tracked';
    const startingMissteps = STARTING_DECK.filter((c) => c === 'misstep').length;
    if (kind === 'tracked') {
      const sh = shuffle(STARTING_DECK, rng);
      rng = sh.nextSeed;
      const deck = sh.items;
      const hand = deck.splice(0, handSize);
      const tracked: TrackedPlayerState = {
        kind: 'tracked',
        deck,
        hand,
        discard: [],
        played: [],
        stamina: startingStamina,
        maxStamina: startingStamina,
        actions: 1,
        channels: 1,
        spirit: 0,
        refinePending: 0,
        damageQueued: 0,
        defenseQueued: 0,
        deckSize: deck.length,
        handSize,
        discardSize: 0,
        misstepCount: startingMissteps,
        startingHandSize: handSize,
        focusReloadsThisTurn: 0,
        supply: buildSupply(),
      };
      players[pid] = tracked;
    } else {
      // Opaque: server tracks counts + the misstep tally, never card contents.
      const opaque: OpaquePlayerState = {
        kind: 'opaque',
        played: [],
        stamina: startingStamina,
        maxStamina: startingStamina,
        actions: 1,
        channels: 1,
        spirit: 0,
        refinePending: 0,
        damageQueued: 0,
        defenseQueued: 0,
        deckSize: STARTING_DECK.length - handSize,
        handSize,
        discardSize: 0,
        misstepCount: startingMissteps,
        startingHandSize: handSize,
        focusReloadsThisTurn: 0,
        supply: buildSupply(),
      };
      players[pid] = opaque;
    }
  }

  return {
    phase: 'technique',
    activePlayerId: playerIds[0]!,
    playerOrder: [...playerIds],
    players,
    round: 1,
    rngSeed: rng,
    playersDoneThisRound: [],
  };
}

// -------- Helpers --------

function clone<T>(o: T): T {
  return structuredClone(o);
}

function getPlayer(state: FFState, playerId: string): PlayerState {
  const p = state.players[playerId];
  if (!p) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this session`);
  return p;
}

function opponentId(state: FFState, playerId: string): string {
  const opp = state.playerOrder.find((p) => p !== playerId);
  if (!opp) throw new GameError('PLAYER_NOT_FOUND', 'No opponent found');
  return opp;
}

function isTracked(p: PlayerState): p is TrackedPlayerState {
  return p.kind === 'tracked';
}

// "Card pool" for this player = their supply techniques + always-on resources + misstep.
// Used to validate that an opaque player's declared card_id is plausibly something
// they could be holding, without claiming to know which cards are actually in hand.
// Each player has their own supply (Fractured Fist rule), so the pool is per-player.
function inGamePool(player: PlayerState, cardId: string): boolean {
  if (cardId === 'misstep') return true;
  if (cardId === 'focus' || cardId === 'momentum' || cardId === 'mastery') return true;
  return Object.prototype.hasOwnProperty.call(player.supply, cardId);
}

function assertActive(state: FFState, playerId: string): void {
  if (state.phase === 'game_over') {
    throw new GameError('GAME_OVER', 'Game is over');
  }
  if (state.activePlayerId !== playerId) {
    throw new GameError('NOT_YOUR_TURN', `It is ${state.activePlayerId}'s turn`);
  }
}

// Tracked draw: pulls from deck (reshuffling discard if needed), updates contents + counts.
function trackedDraw(p: TrackedPlayerState, count: number, seed: number): number {
  let s = seed;
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      const sh = shuffle(p.discard, s);
      p.deck = sh.items;
      s = sh.nextSeed;
      p.discard = [];
    }
    const card = p.deck.pop();
    if (card !== undefined) p.hand.push(card);
  }
  p.deckSize = p.deck.length;
  p.handSize = p.hand.length;
  p.discardSize = p.discard.length;
  return s;
}

// Opaque draw: only updates counts. Reshuffles when deck hits 0.
function opaqueDraw(p: OpaquePlayerState, count: number): void {
  for (let i = 0; i < count; i++) {
    if (p.deckSize === 0) {
      if (p.discardSize === 0) break;
      p.deckSize = p.discardSize;
      p.discardSize = 0;
    }
    p.deckSize -= 1;
    p.handSize += 1;
  }
}

// Used by tracked players: pick a hand index for a card if not provided.
function findHandIndex(hand: string[], cardId: string, requested: number | undefined): number {
  if (requested !== undefined) {
    if (requested < 0 || requested >= hand.length) {
      throw new GameError('ILLEGAL_MOVE', `hand_index ${requested} out of range`);
    }
    if (hand[requested] !== cardId) {
      throw new GameError(
        'ILLEGAL_MOVE',
        `Card at hand_index ${requested} is ${hand[requested]}, not ${cardId}`,
      );
    }
    return requested;
  }
  const idx = hand.indexOf(cardId);
  if (idx < 0) throw new GameError('ILLEGAL_MOVE', `${cardId} not in hand`);
  return idx;
}

// A move's card_id may be an id or a printed name (cards.ts resolveCardId).
function cardIdFor(idOrName: string): string {
  const id = resolveCardId(idOrName);
  if (!id) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `No card named ${JSON.stringify(idOrName)}. Use the name printed on the card (e.g. "Devastating Blow") ` +
        'or its id (e.g. "devastating_blow"); get_legal_moves lists the cards you can play or buy right now.',
    );
  }
  return id;
}

// -------- Move application --------

export function applyMove(
  state: FFState,
  playerId: string,
  move: FFMove,
  // Seat id → spoken display name for the summary (narration.ts). The MCP
  // layer passes the session's names; engine-only callers get the raw ids.
  nameOf: NameOf = idAsName,
): { newState: FFState; summary: string } {
  // The switch must be exhaustive at the type level, but at runtime a client
  // can send anything. Cast to access an unknown `type` for the error message.
  const moveType = (move as { type?: unknown } | null | undefined)?.type;
  switch (move?.type) {
    case 'play_card':
      return doPlayCard(state, playerId, cardIdFor(move.card_id), move.hand_index, nameOf);
    case 'buy_card':
      return doBuyCard(state, playerId, cardIdFor(move.card_id), nameOf);
    case 'refine_card':
      return doRefineCard(state, playerId, move.hand_index, move.card_id, move.was_misstep, nameOf);
    case 'skip_refine':
      return doSkipRefine(state, playerId, nameOf);
    case 'advance_phase':
      return doAdvancePhase(state, playerId, nameOf);
    case 'end_turn':
      return doEndTurn(state, playerId, nameOf);
    case 'focus_reload':
      return doFocusReload(state, playerId, move.count, nameOf);
    default:
      throw new GameError(
        'INVALID_MOVE_SHAPE',
        `Unrecognized move type: ${JSON.stringify(moveType)}. ` +
          `Valid types are: play_card, buy_card, refine_card, skip_refine, advance_phase, end_turn, focus_reload. ` +
          `Use get_legal_moves to see the exact move objects to pass back to apply_move.`,
        { received_move: move },
      );
  }
}

function doPlayCard(
  state: FFState,
  playerId: string,
  cardId: string,
  handIndex: number | undefined,
  nameOf: NameOf,
): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);

  if (me.refinePending > 0) {
    throw new GameError('ILLEGAL_MOVE', 'Must finish refining before playing more cards');
  }

  const def = getCard(cardId);
  if (def.type === 'MISSTEP') {
    throw new GameError('ILLEGAL_MOVE', 'Misstep cards cannot be played');
  }
  if (def.type === 'TECHNIQUE') {
    if (ns.phase !== 'technique') {
      throw new GameError('ILLEGAL_MOVE', 'Technique cards can only be played in technique phase');
    }
    if (me.actions < 1) {
      throw new GameError('ILLEGAL_MOVE', 'Not enough actions');
    }
    me.actions -= 1;
  } else {
    if (ns.phase !== 'channel') {
      throw new GameError('ILLEGAL_MOVE', 'Resource cards can only be played in channel phase');
    }
  }

  // Remove from hand
  if (isTracked(me)) {
    const idx = findHandIndex(me.hand, cardId, handIndex);
    me.hand.splice(idx, 1);
    me.handSize = me.hand.length;
  } else {
    // Opaque: trust the player's declaration. Validate only that the card is
    // part of this game's pool (supply techniques + resources + misstep) and
    // that the player has at least one card in hand to play.
    if (me.handSize < 1) {
      throw new GameError('ILLEGAL_MOVE', 'No cards in hand');
    }
    if (!inGamePool(me, cardId)) {
      throw new GameError(
        'ILLEGAL_MOVE',
        `${cardId} is not part of your card pool for this game`,
      );
    }
    me.handSize -= 1;
  }

  // Apply effects
  const effects = def.effects ?? {};
  let healed = 0;
  if (effects.actions) me.actions += effects.actions;
  if (effects.spirit) me.spirit += effects.spirit;
  if (effects.defense) me.defenseQueued += effects.defense;
  if (effects.damage) me.damageQueued += effects.damage;
  if (effects.channels) me.channels += effects.channels;
  if (effects.heal) {
    const before = me.stamina;
    me.stamina = Math.min(me.stamina + effects.heal, me.maxStamina);
    healed = me.stamina - before;
  }
  if (def.value) me.spirit += def.value;
  const handBeforeDraw = me.handSize;
  if (effects.draw) {
    if (isTracked(me)) {
      ns.rngSeed = trackedDraw(me, effects.draw, ns.rngSeed);
    } else {
      opaqueDraw(me, effects.draw);
    }
  }
  if (effects.refine) me.refinePending += effects.refine;

  const drew = me.handSize - handBeforeDraw;
  let missteppedAmount = 0;
  if (effects.add_misstep) {
    const opp = getPlayer(ns, opponentId(ns, playerId));
    const room = Math.max(0, MAX_MISSTEPS - opp.misstepCount);
    const toAdd = Math.min(effects.add_misstep, room);
    if (isTracked(opp)) {
      for (let i = 0; i < toAdd; i++) opp.discard.push('misstep');
      opp.discardSize = opp.discard.length;
    } else {
      opp.discardSize += toAdd;
    }
    opp.misstepCount += toAdd;
    missteppedAmount = toAdd;
  }

  me.played.push(cardId);

  return {
    newState: ns,
    summary: playSummary(nameOf(playerId), nameOf(opponentId(ns, playerId)), def.name, def.value ?? 0, effects, {
      drew,
      healed,
      missteps: missteppedAmount,
    }),
  };
}

// "Zeke plays Devastating Blow: 3 damage queued and draws 1 card." Effects are
// spoken in a fixed order with the amounts that actually happened (a draw from
// an empty deck and discard, a heal at full stamina, or Missteps past the cap
// of MAX_MISSTEPS all say so rather than claiming the printed number).
function playSummary(
  actor: string,
  opponent: string,
  cardName: string,
  spiritValue: number,
  effects: NonNullable<ReturnType<typeof getCard>['effects']>,
  actual: { drew: number; healed: number; missteps: number },
): string {
  const who = cap(actor);
  if (spiritValue > 0 && Object.keys(effects).length === 0) {
    return `${who} plays ${cardName} for ${spiritValue} spirit.`;
  }
  const parts: string[] = [];
  if (effects.damage) parts.push(`${effects.damage} damage queued`);
  if (effects.defense) parts.push(`${effects.defense} defense queued`);
  if (effects.actions) parts.push(count(effects.actions, 'more action'));
  if (effects.spirit) parts.push(`${effects.spirit} spirit`);
  if (effects.channels) parts.push(count(effects.channels, 'more channel'));
  if (effects.draw) {
    parts.push(
      actual.drew === effects.draw
        ? `draws ${count(actual.drew, 'card')}`
        : `draws ${count(actual.drew, 'card')} (deck and discard pile ran out)`,
    );
  }
  if (effects.heal) {
    parts.push(
      actual.healed > 0 ? `heals ${actual.healed} stamina` : 'no healing (already at full stamina)',
    );
  }
  if (effects.refine) parts.push(`may now refine ${count(effects.refine, 'card')}`);
  let after = '';
  if (effects.add_misstep) {
    if (actual.missteps === 0) {
      parts.push(`no Missteps sent (${opponent} already has the limit of ${MAX_MISSTEPS})`);
    } else {
      const capped = actual.missteps < effects.add_misstep ? ` (the limit of ${MAX_MISSTEPS} is reached)` : '';
      parts.push(`sends ${count(actual.missteps, 'Misstep')} to ${opponent}${capped}`);
      after = ` Put ${count(actual.missteps, 'Misstep card')} in ${possessive(opponent)} discard pile.`;
    }
  }
  if (spiritValue > 0) parts.unshift(`${spiritValue} spirit`);
  return `${who} plays ${cardName}: ${listJoin(parts)}.${after}`;
}

function doBuyCard(
  state: FFState,
  playerId: string,
  cardId: string,
  nameOf: NameOf,
): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending > 0) {
    throw new GameError('ILLEGAL_MOVE', 'Must finish refining before buying');
  }
  if (ns.phase !== 'channel') {
    throw new GameError('ILLEGAL_MOVE', 'Can only buy in channel phase');
  }
  if (me.channels < 1) {
    throw new GameError('ILLEGAL_MOVE', 'No channel buys remaining');
  }
  const def = tryGetCard(cardId);
  if (!def) throw new GameError('ILLEGAL_MOVE', `Unknown card: ${cardId}`);
  if ((me.supply[cardId] ?? 0) < 1) {
    throw new GameError('ILLEGAL_MOVE', `${def.name} not available in your supply`);
  }
  if (me.spirit < def.cost) {
    throw new GameError('ILLEGAL_MOVE', `Need ${def.cost} spirit, have ${me.spirit}`);
  }
  me.spirit -= def.cost;
  me.channels -= 1;
  me.supply[cardId] = (me.supply[cardId] ?? 0) - 1;
  if (isTracked(me)) {
    me.discard.push(cardId);
    me.discardSize = me.discard.length;
  } else {
    me.discardSize += 1;
  }
  const actor = nameOf(playerId);
  return {
    newState: ns,
    summary: `${cap(actor)} buys ${def.name} for ${def.cost} spirit. ${def.name} goes into ${possessive(actor)} discard pile.`,
  };
}

function doRefineCard(
  state: FFState,
  playerId: string,
  handIndex: number | undefined,
  cardId: string | undefined,
  wasMisstep: boolean | undefined,
  nameOf: NameOf,
): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending <= 0) {
    throw new GameError('ILLEGAL_MOVE', 'No refines available');
  }

  let refinedSummary = 'a card';
  if (isTracked(me)) {
    // Name the card (card_id — id or printed name) or its hand slot; a named
    // card refines the first copy in hand, since copies are identical.
    if (handIndex === undefined && cardId === undefined) {
      throw new GameError('ILLEGAL_MOVE', 'Say which card to refine: card_id (its printed name) or hand_index');
    }
    let idx: number;
    if (cardId !== undefined) {
      idx = findHandIndex(me.hand, cardIdFor(cardId), handIndex);
    } else {
      idx = handIndex!;
      if (idx < 0 || idx >= me.hand.length) {
        throw new GameError('ILLEGAL_MOVE', `hand_index ${idx} out of range`);
      }
    }
    const removed = me.hand.splice(idx, 1)[0]!;
    me.handSize = me.hand.length;
    if (removed === 'misstep') me.misstepCount = Math.max(0, me.misstepCount - 1);
    const def = tryGetCard(removed);
    refinedSummary = def?.name ?? removed;
  } else {
    if (wasMisstep === undefined) {
      throw new GameError(
        'ILLEGAL_MOVE',
        'was_misstep flag required for opaque player refine (tell the server whether you removed a Misstep so it can keep the misstep count accurate)',
      );
    }
    if (me.handSize < 1) {
      throw new GameError('ILLEGAL_MOVE', 'No cards in hand to refine');
    }
    if (wasMisstep && me.misstepCount <= 0) {
      throw new GameError('ILLEGAL_MOVE', 'You have no Missteps left to refine');
    }
    me.handSize -= 1;
    if (wasMisstep) {
      me.misstepCount = Math.max(0, me.misstepCount - 1);
      refinedSummary = 'a Misstep';
    } else {
      refinedSummary = 'a card that is not a Misstep';
    }
  }

  me.refinePending -= 1;
  const actor = cap(nameOf(playerId));
  const from = isTracked(me) ? ` from ${possessive(nameOf(playerId))} hand` : '';
  return { newState: ns, summary: `${actor} refines ${refinedSummary}${from}, removing it from the game.` };
}

function doSkipRefine(state: FFState, playerId: string, nameOf: NameOf): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending <= 0) {
    throw new GameError('ILLEGAL_MOVE', 'No refines to skip');
  }
  const skipped = me.refinePending;
  me.refinePending = 0;
  return {
    newState: ns,
    summary: `${cap(nameOf(playerId))} skips the remaining ${count(skipped, 'refine')}.`,
  };
}

function doAdvancePhase(state: FFState, playerId: string, nameOf: NameOf): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending > 0) {
    throw new GameError('ILLEGAL_MOVE', 'Must finish refining first');
  }
  if (ns.phase !== 'technique') {
    throw new GameError('ILLEGAL_MOVE', 'Can only advance from technique to channel');
  }
  ns.phase = 'channel';
  return { newState: ns, summary: `${cap(nameOf(playerId))} moves on to the Channel phase.` };
}

function doEndTurn(state: FFState, playerId: string, nameOf: NameOf): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending > 0) {
    throw new GameError('ILLEGAL_MOVE', 'Must finish refining before ending turn');
  }

  // Cleanup: discard hand, draw a fresh hand of startingHandSize. Played cards
  // (damage/defense) stay queued until strike resolution.
  if (isTracked(me)) {
    me.discard = [...me.discard, ...me.hand];
    me.hand = [];
    me.handSize = 0;
    me.discardSize = me.discard.length;
    me.deckSize = me.deck.length;
    ns.rngSeed = trackedDraw(me, me.startingHandSize, ns.rngSeed);
  } else {
    me.discardSize += me.handSize;
    me.handSize = 0;
    opaqueDraw(me, me.startingHandSize);
  }

  // Unspent spirit is lost when the Channel phase ends (rulebook: "Once the
  // Channel Phase ends the additional spirit is lost if it is not spent").
  // Found by the rules checker: the engine used to hold it until the strike,
  // so get_state showed stale spirit during the opponent's turn.
  me.spirit = 0;
  ns.playersDoneThisRound.push(playerId);
  const ended =
    `${cap(nameOf(playerId))} ends the turn, discards the rest of the hand, ` +
    `and draws ${count(me.startingHandSize, 'new card')}.`;

  const remaining = ns.playerOrder.filter((p) => !ns.playersDoneThisRound.includes(p));
  if (remaining.length > 0) {
    const nextId = remaining[0]!;
    ns.activePlayerId = nextId;
    ns.phase = 'technique';
    getPlayer(ns, nextId).focusReloadsThisTurn = 0; // fresh reload budget each turn
    return { newState: ns, summary: `${ended} Now it is ${possessive(nameOf(nextId))} turn.` };
  }

  const resolution = resolveStrike(ns, nameOf);
  return { newState: resolution.state, summary: `${ended} ${resolution.summary}` };
}

function doFocusReload(
  state: FFState,
  playerId: string,
  declaredCount: number | undefined,
  nameOf: NameOf,
): { newState: FFState; summary: string } {
  assertActive(state, playerId);
  const ns = clone(state);
  const me = getPlayer(ns, playerId);
  if (me.refinePending > 0) {
    throw new GameError('ILLEGAL_MOVE', 'Must finish refining first');
  }
  const opp = getPlayer(ns, opponentId(ns, playerId));
  if (me.stamina >= opp.stamina) {
    throw new GameError('ILLEGAL_MOVE', 'Focus reload requires lower stamina than opponent');
  }
  if ((me.focusReloadsThisTurn ?? 0) >= FOCUS_RELOADS_PER_TURN) {
    throw new GameError(
      'ILLEGAL_MOVE',
      `Focus reload limited to ${FOCUS_RELOADS_PER_TURN} per turn (already used ${me.focusReloadsThisTurn ?? 0})`,
    );
  }

  let focusCount: number;
  if (isTracked(me)) {
    focusCount = me.hand.filter((id) => id === 'focus').length;
    if (focusCount === 0) throw new GameError('ILLEGAL_MOVE', 'No Focus cards in hand');
    me.hand = me.hand.filter((id) => id !== 'focus');
    for (let i = 0; i < focusCount; i++) me.discard.push('focus');
    me.handSize = me.hand.length;
    me.discardSize = me.discard.length;
    ns.rngSeed = trackedDraw(me, focusCount, ns.rngSeed);
  } else {
    if (declaredCount === undefined || declaredCount < 1) {
      throw new GameError(
        'ILLEGAL_MOVE',
        'count required for opaque player focus_reload (number of Focus cards being discarded)',
      );
    }
    focusCount = declaredCount;
    if (me.handSize < focusCount) {
      throw new GameError(
        'ILLEGAL_MOVE',
        `Declared ${focusCount} Focus cards but hand only has ${me.handSize}`,
      );
    }
    me.handSize -= focusCount;
    me.discardSize += focusCount;
    opaqueDraw(me, focusCount);
  }
  me.focusReloadsThisTurn = (me.focusReloadsThisTurn ?? 0) + 1;
  const remainingReloads = FOCUS_RELOADS_PER_TURN - me.focusReloadsThisTurn;
  return {
    newState: ns,
    summary:
      `${cap(nameOf(playerId))} reloads with Focus: ${count(focusCount, 'Focus card')} to the discard pile, ` +
      `then draws ${count(focusCount, 'card')}. ${remainingReloads === 0 ? 'No' : remainingReloads} ` +
      `${remainingReloads === 1 ? 'reload' : 'reloads'} left this turn.`,
  };
}

// -------- Strike resolution --------

function resolveStrike(state: FFState, nameOf: NameOf): { state: FFState; summary: string } {
  const ns = state;
  const [p1, p2] = ns.playerOrder;
  if (!p1 || !p2) throw new GameError('INVALID_PLAYERS', 'Expected 2 players');
  const a = ns.players[p1]!;
  const b = ns.players[p2]!;
  const netToB = Math.max(0, a.damageQueued - b.defenseQueued);
  const netToA = Math.max(0, b.damageQueued - a.defenseQueued);
  // Spoken before the counters reset below: who deals what, and the sum behind it.
  const nameA = nameOf(p1);
  const nameB = nameOf(p2);
  const deals = (from: string, to: string, net: number, dmg: number, def: number): string => {
    const why = dmg === 0 ? 'no damage queued' : `${dmg} damage against ${def} defense`;
    return net > 0
      ? `${cap(from)} deals ${net} damage to ${to} (${why}).`
      : `${cap(from)} deals no damage to ${to} (${why}).`;
  };
  const strikeLines = [
    `Round ${ns.round} strike.`,
    deals(nameA, nameB, netToB, a.damageQueued, b.defenseQueued),
    deals(nameB, nameA, netToA, b.damageQueued, a.defenseQueued),
  ];
  a.stamina -= netToA;
  b.stamina -= netToB;
  strikeLines.push(`${cap(nameA)} now has ${a.stamina} stamina and ${nameB} has ${b.stamina}.`);

  for (const pid of ns.playerOrder) {
    const p = ns.players[pid]!;
    if (isTracked(p)) {
      p.discard = [...p.discard, ...p.played];
      p.discardSize = p.discard.length;
    } else {
      p.discardSize += p.played.length;
    }
    p.played = [];
    p.damageQueued = 0;
    p.defenseQueued = 0;
    p.actions = 1;
    p.channels = 1;
    p.spirit = 0;
    p.focusReloadsThisTurn = 0; // new round → both players start with a full reload budget
  }
  ns.playersDoneThisRound = [];
  ns.round += 1;

  strikeLines.push("All played cards go to their owners' discard piles.");
  const summary = strikeLines.join(' ');

  const aDead = a.stamina <= 0;
  const bDead = b.stamina <= 0;
  if (aDead || bDead) {
    ns.phase = 'game_over';
    const winners: string[] = [];
    if (aDead && bDead) {
      // tie
    } else if (aDead) winners.push(p2);
    else winners.push(p1);
    ns.winners = winners;
    ns.scores = { [p1]: a.stamina, [p2]: b.stamina };
    ns.resultSummary =
      winners.length === 0
        ? 'The game is a tie: both players are out of stamina.'
        : `${cap(nameOf(winners[0]!))} wins the game.`;
    return { state: ns, summary: `${summary} ${ns.resultSummary}` };
  }

  ns.activePlayerId = ns.playerOrder[0]!;
  ns.phase = 'technique';
  return { state: ns, summary: `${summary} Round ${ns.round} begins with ${possessive(nameA)} turn.` };
}

// -------- Game-over check --------

export function checkGameOver(state: FFState): {
  game_over: boolean;
  winners: string[];
  scores: Record<string, number>;
  summary: string;
} {
  if (state.phase !== 'game_over') {
    const scores: Record<string, number> = {};
    for (const pid of state.playerOrder) scores[pid] = state.players[pid]!.stamina;
    return { game_over: false, winners: [], scores, summary: 'Game in progress' };
  }
  return {
    game_over: true,
    winners: state.winners ?? [],
    scores: state.scores ?? {},
    summary: state.resultSummary ?? 'Game over',
  };
}
