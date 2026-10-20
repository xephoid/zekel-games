import { GameError } from '@zekel/game-kit';
import type { GameLogEntry, PlayerConfig } from '@zekel/game-kit';
import { PEOPLE, LOCATIONS, AFFILIATIONS, BOROUGHS, getPerson, getPersonByName, getLocation, getLocationByName, findLocationByAttributes, affiliationName, resolvePerson, resolveLocation, resolveAffiliation, resolveBorough, resolveClueToken, WEAPON_ID, CLUE_TOKENS } from './data/index.js';
import { detectiveCandidateLocations, parseStrategy, pickBurnLocation, pickHideoutLocation, pickRecruitTarget } from './ai.js';
import { recruitablePersonIds, isAIDecider } from './legalMoves.js';
import type {
  AffiliationId, BoroughId, ClueCategory, CNMove, CNOptions, CNState,
  DetectiveState, HackerState, Hideout, Informant, JailSlot, Evidence, LocationData,
  Pending, PlayerKind, TruthfulClues,
} from './types.js';

// RNG (deterministic for harness).
function nextRng(seed: number): { seed: number; value: number } {
  const next = (seed * 1664525 + 1013904223) >>> 0;
  return { seed: next, value: next };
}

function shuffle<T>(arr: T[], seed: number): { items: T[]; nextSeed: number } {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    const r = nextRng(s);
    s = r.seed;
    const j = r.value % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return { items: a, nextSeed: s };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

// The balance sweep assigns single-element arrays; accept both forms.
function normalizeTiming(t: CNOptions['overclock_draw_timing'] | string[] | undefined): 'immediate' | 'next_turn' | 'optional' {
  const v = Array.isArray(t) ? t[0] : t;
  return v === 'next_turn' || v === 'optional' ? v : 'immediate';
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

export function createInitialState(
  playerIds: string[],
  playerKinds: Record<string, PlayerKind>,
  options: CNOptions | undefined,
  seed: number,
  seatStrategies?: Record<string, string | undefined>,
  seatDeciderKinds?: Record<string, 'human' | 'ai'>,
): CNState {
  if (playerIds.length !== 2) {
    throw new GameError('INVALID_PLAYERS', `Cybernoir 2127 requires exactly 2 players; got ${playerIds.length}`);
  }
  const detectiveId = playerIds[0]!;
  const hackerId = playerIds[1]!;

  const detectiveKind = playerKinds[detectiveId] ?? 'tracked';
  const hackerKind = playerKinds[hackerId] ?? 'tracked';

  // Detective: Location deck (v1.7: 17 once the Hacker takes their safehouse
  // card; shuffled for AI, physical for human), hand 3, POI deck 24 facedown.
  // For a tracked Detective the deal happens AFTER the hideout is known — in
  // the all-AI block below, or in applyReportHideout for a human Hacker.
  const allLocationIds = LOCATIONS.map(l => l.id);
  let detLocDeck: string[];
  let rng = seed;
  if (detectiveKind === 'tracked') {
    const sh = shuffle(allLocationIds, rng);
    rng = sh.nextSeed;
    detLocDeck = sh.items;
  } else {
    detLocDeck = [...allLocationIds]; // human shuffles physically; order unknown to server
  }

  // v1.7: the safehouse card leaves the Location deck in every seating except
  // AI Hacker vs human Detective — the human cannot blindly remove the AI's
  // secret card from a physical deck they own (see types.ts header).
  const hideoutCardRemoved = !(hackerKind === 'tracked' && detectiveKind === 'opaque');

  const detective: DetectiveState = {
    kind: detectiveKind,
    location_deck: detLocDeck,
    location_hand: [],
    location_discard: [],
    seen_locations: [],
    board: [],
    poi_deck: PEOPLE.map(p => p.id), // 24 POI, facedown, NOT shuffled
    informants: [],
    jail: [[], [], []],
    mid_game_guess_spent: false,
    upkeep_paid: false,
    location_played_this_turn: false,
  };

  // Hacker: Contacts deck (24 people + weapon = 25). For tracked (AI), server shuffles.
  // For opaque (human), the human physically owns and shuffles.
  const allContactIds = [...PEOPLE.map(p => p.id), WEAPON_ID];
  let contactsDeck: string[];
  if (hackerKind === 'tracked') {
    const sh = shuffle(allContactIds, rng);
    contactsDeck = sh.items;
  } else {
    contactsDeck = [...allContactIds]; // human shuffles physically
  }

  const hacker: HackerState = {
    kind: hackerKind,
    contacts_deck: contactsDeck,
    contacts_discard: [],
    evidence: { weapon: false, witnesses: [], motive_set_1: [], motive_set_2: [], motive_set_3: [], motive_set_4: [] },
    truthful_clues: { borough: false, population: false, affiliation: false },
    truthful_values: {},
    negative_clues: [],
    hideout: null,
    hideout_location_id: null,
    safehouse_burned: false,
  };

  const players: CNState['players'] = {};
  for (const pid of playerIds) {
    const kind = playerKinds[pid] ?? 'tracked';
    if (kind === 'tracked') {
      players[pid] = { kind: 'tracked', ap: 0, hand_size: 0, overclock_used: false, hand: [], deck: [], discard: [] };
    } else {
      players[pid] = { kind: 'opaque', ap: 0, hand_size: 0, overclock_used: false };
    }
  }

  // Auto-complete setup — pick a hideout, gather residents, draw to 3, start in
  // the play phase — only when the AI plays the Hacker. It picks engine-side and
  // nobody is owed the choice. A DIGITAL human Hacker is tracked too, but the
  // hideout is THEIR choice (choices.ts 'hideout', owner 'player'): they stay in
  // setup and report it. Trackedness is who holds the cards; decider kind is who
  // decides. Absent seat kinds (legacy sessions, hand-built states) keep the old
  // "tracked ⇒ AI" read.
  const hackerIsAI = seatDeciderKinds ? seatDeciderKinds[hackerId] === 'ai' : true;
  const autoSetup = detectiveKind === 'tracked' && hackerKind === 'tracked' && hackerIsAI;
  let phase: 'setup' | 'play' = 'setup';
  // During setup the HACKER is the seat that must act (report_hideout) — the
  // active player must point there or run_ai_turn/next_step cannot drive an AI
  // Hacker through setup. The Detective becomes active when play begins.
  let activePlayer = hackerId;
  if (autoSetup) {
    phase = 'play';
    activePlayer = detectiveId;
    // Hideout pick: forced sweep option > Hacker's strategy policy > uniform random.
    let hideoutLoc: LocationData;
    if (options?.hideout && options.hideout.length > 0) {
      hideoutLoc = getLocation(resolveLocation(options.hideout[0]!))!;
    } else {
      const strat = parseStrategy(seatStrategies?.[hackerId]);
      if (strat) {
        const pick = pickHideoutLocation(strat, rng);
        rng = pick.nextSeed;
        hideoutLoc = pick.loc;
      } else {
        const hideoutIdx = nextRng(rng);
        rng = hideoutIdx.seed;
        hideoutLoc = LOCATIONS[hideoutIdx.value % LOCATIONS.length]!;
      }
    }
    hacker.hideout = { borough: hideoutLoc.borough, population: hideoutLoc.population, affiliation: hideoutLoc.affiliation };
    hacker.hideout_location_id = hideoutLoc.id;
    // v1.7: the Hacker takes the safehouse card out of the Location deck, THEN
    // the Detective's hand of 3 is dealt from the remaining.
    detective.location_deck = detective.location_deck.filter(id => id !== hideoutLoc.id);
    detective.location_hand = detective.location_deck.splice(0, 3);
    detective.seen_locations = [...detective.location_hand];
    // Gather residents from contacts deck
    const residentIds = hideoutLoc.residents;
    hacker.contacts_deck = hacker.contacts_deck.filter(id => !residentIds.includes(id));
    // Draw to 3
    const hand = [...residentIds];
    while (hand.length < 3 && hacker.contacts_deck.length > 0) {
      hand.push(hacker.contacts_deck.shift()!);
    }
    players[hackerId]!.hand_size = hand.length;
    const hp = players[hackerId];
    if (hp && hp.kind === 'tracked') {
      hp.hand = hand;
      hp.deck = [...hacker.contacts_deck];
    }
    // Detective start-of-turn: draw a location
    const detCard = detective.location_deck.shift()!;
    detective.location_hand.push(detCard);
  }

  // Detective goes first with 4 AP (applies to all sessions, not just all-AI —
  // a human Detective must also start with a full AP budget).
  players[detectiveId]!.ap = 4;

  return {
    phase,
    activePlayerId: activePlayer,
    playerOrder: [detectiveId, hackerId],
    detective,
    hacker,
    players,
    pending: null,
    turn: 1,
    hideout_card_removed: hideoutCardRemoved,
    seat_strategies: seatStrategies,
    seat_kinds: seatDeciderKinds,
    rngSeed: rng,
    overclock_draw_timing: normalizeTiming(options?.overclock_draw_timing),
    overclock_draws_owed: 0,
    endgame_triggered: false,
    endgame_reason: null,
    winners: [],
    resultSummary: '',
    log: [],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clone(state: CNState): CNState {
  const s = structuredClone(state);
  // Additive v1.7 fields — default them on sessions persisted before the change
  // (tolerate absence; hideout_card_removed=false is the v1.6 behavior).
  // v2.3 jail rework migration: old sessions stored (string|null)[]; wrap
  // into per-slot stacks.
  s.detective.jail = (s.detective.jail ?? [[], [], []]).map(
    (slot: unknown) => Array.isArray(slot) ? slot as string[] : (slot ? [slot as string] : []),
  );
  s.detective.location_discard ??= [];
  s.detective.seen_locations ??= [];
  s.hacker.hideout_location_id ??= null;
  s.hacker.safehouse_burned ??= false;
  s.hideout_card_removed ??= false;
  s.hacker.evidence.motive_set_3 ??= []; // additive v1.9 fields
  s.hacker.evidence.motive_set_4 ??= [];
  return s;
}

function isTrackedPlayer(state: CNState, pid: string): boolean {
  const p = state.players[pid];
  return p?.kind === 'tracked';
}

function isDetective(state: CNState, pid: string): boolean {
  return state.playerOrder[0] === pid;
}

function isHacker(state: CNState, pid: string): boolean {
  return state.playerOrder[1] === pid;
}

// Detective turn-order enforcement helper. draw is auto; play must come before
// upkeep (if informants exist) and both must come before AP actions.
function requireDetectiveActionPhase(s: CNState): void {
  const det = s.detective;
  if (!det.location_played_this_turn) {
    throw new GameError('ILLEGAL_MOVE', 'Detective must play a Location first');
  }
  if (det.informants.length > 0 && !det.upkeep_paid) {
    throw new GameError('ILLEGAL_MOVE', 'Detective must pay informant upkeep first');
  }
}

function detectiveId(state: CNState): string {
  return state.playerOrder[0]!;
}

function hackerId(state: CNState): string {
  return state.playerOrder[1]!;
}

function addLog(state: CNState, entry: Omit<GameLogEntry, 'seq' | 'turn'>): void {
  const seq = state.log.length + 1;
  state.log.push({ seq, turn: state.turn, ...entry });
}

/** The hideout's location id — stored (v2.0) or attribute-derived fallback
 *  for pre-v2.0 sessions (attributes were unique before Little Ghana). */
function hideoutLocId(s: CNState): string | undefined {
  return s.hacker.hideout_location_id ?? findLocationByAttributes(s.hacker.hideout)?.id;
}

/** Canonical key for a Motive set's affiliation trio (v1.9: trios must be
 *  pairwise distinct across the four sets). */
export function trioKey(affs: string[]): string {
  return [...affs].sort().join('+');
}

function personName(id: string): string {
  if (id === WEAPON_ID) return 'The Weapon';
  return getPerson(id)?.name ?? id;
}

function locationName(id: string): string {
  return getLocation(id)?.name ?? id;
}

// ---------------------------------------------------------------------------
// Setup moves
// ---------------------------------------------------------------------------

function applyReportHideout(state: CNState, pid: string, locationNameStr?: string): { newState: CNState; summary: string } {
  const s = clone(state);
  if (!isHacker(s, pid)) {
    throw new GameError('ILLEGAL_MOVE', 'Only the Hacker chooses the hideout');
  }

  let locId: string;
  if (locationNameStr && locationNameStr.trim() !== '') {
    locId = resolveLocation(locationNameStr);
  } else if (isAIDecider(s, pid)) {
    // AI Hacker: pick ENGINE-SIDE so the hideout never appears in a move or
    // response (the old flow leaked it through get_ai_move/run_ai_turn). A
    // human Hacker — physical or digital — names their own, below.
    const strat = parseStrategy(s.seat_strategies?.[hackerId(s)]);
    const pick = pickHideoutLocation(strat, s.rngSeed);
    s.rngSeed = pick.nextSeed;
    locId = pick.loc.id;
  } else {
    throw new GameError('ILLEGAL_MOVE', 'Name your hideout location (one of the 18 printed locations)');
  }
  const loc = getLocation(locId)!;
  const hideout: Hideout = { borough: loc.borough, population: loc.population, affiliation: loc.affiliation };

  s.hacker.hideout_location_id = locId;
  // v1.7: the server stores the hideout for BOTH kinds. An opaque (human)
  // Hacker's hideout is needed to take the safehouse card out of a tracked
  // Detective's deck (and rebuild it on a burn); validating the human's clue
  // declarations is a side benefit. Views never expose it to the Detective.
  s.hacker.hideout = hideout;

  if (s.hacker.kind === 'tracked') {
    // Gather resident contacts from the tracked deck
    const residentIds = loc.residents;
    s.hacker.contacts_deck = s.hacker.contacts_deck.filter(id => !residentIds.includes(id));
    // Draw to 3: pop remaining contacts until hand is 3
    const hand = [...residentIds];
    while (hand.length < 3 && s.hacker.contacts_deck.length > 0) {
      hand.push(s.hacker.contacts_deck.shift()!);
    }
    s.players[hackerId(s)]!.hand_size = hand.length;
    // Store hand on the player state for tracked
    const p = s.players[hackerId(s)];
    if (p && p.kind === 'tracked') {
      p.hand = hand;
      p.deck = [...s.hacker.contacts_deck];
    }
  }
  // For opaque (human) Hacker: the human physically gathers residents and draws
  // to 3 — the server tracks no Contacts hand, but the SIZE is known: always 3.
  {
    const p = s.players[hackerId(s)];
    if (p && p.kind === 'opaque') p.hand_size = 3;
  }

  // v1.7: the Hacker takes the safehouse card out of the Location deck. For a
  // tracked (AI) Detective the deck is virtual, so the deal was deferred to this
  // move: remove the card, deal the hand of 3, then make the turn-1 mandatory
  // draw (mirrors the all-AI auto-setup path).
  if (s.detective.kind === 'tracked') {
    s.detective.location_deck = s.detective.location_deck.filter(id => id !== locId);
    s.detective.location_hand = s.detective.location_deck.splice(0, 3);
    const firstDraw = s.detective.location_deck.shift();
    if (firstDraw) s.detective.location_hand.push(firstDraw);
    s.detective.seen_locations = [...s.detective.location_hand];
  }

  addLog(s, {
    actor: pid, category: 'setup',
    summary: s.hideout_card_removed
      ? `Hacker chose hideout (secret) and took the safehouse card from the Location deck (${LOCATIONS.length - 1} cards remain)`
      : 'Hacker chose hideout (secret)',
  });
  // If both players are done with setup, transition to play
  if (s.hacker.kind === 'tracked' || s.hacker.kind === 'opaque') {
    s.phase = 'play';
    s.activePlayerId = detectiveId(s); // Detective goes first
  }
  return { newState: s, summary: 'Hacker chose hideout' };
}

// ---------------------------------------------------------------------------
// Detective turn
// ---------------------------------------------------------------------------

function detectiveStartTurn(s: CNState): void {
  const det = s.detective;
  // Base AP for the turn is 4; informant upkeep will deduct from this.
  s.players[detectiveId(s)]!.ap = 4;
  // 1. Mandatory Location draw
  if (det.kind === 'tracked') {
    if (det.location_deck.length === 0) {
      // Endgame trigger: Location deck exhausted
      s.endgame_triggered = true;
      s.endgame_reason = 'location_deck_exhausted';
      s.pending = { type: 'endgame_final_guess' };
      return;
    }
    const card = det.location_deck.shift()!;
    det.location_hand.push(card);
    if (!det.seen_locations.includes(card)) det.seen_locations.push(card);
  }
  // For opaque Detective: the human physically draws. Server doesn't track hand contents.
  // The human will report which card they play in the next step.

  // 1b. Overclock draws owed (next_turn / optional timing: auto-draw at start of next Detective turn)
  if (s.overclock_draws_owed > 0) {
    if ((s.overclock_draw_timing === 'next_turn' || s.overclock_draw_timing === 'optional') && det.kind === 'tracked') {
      for (let i = 0; i < s.overclock_draws_owed; i++) {
        if (det.location_deck.length > 0) {
          const c = det.location_deck.shift()!;
          det.location_hand.push(c);
          if (!det.seen_locations.includes(c)) det.seen_locations.push(c);
        }
      }
      s.overclock_draws_owed = 0;
    }
    // For opaque human Detectives, the physical player draws the owed cards from their own deck.
    // The server tracks only that the draws are no longer owed; the human reports the played card normally.
  }

  // 2. Mandatory Location play — handled as a move (play_location), not auto.
  // 3. Informant upkeep — handled as a move (upkeep_choice).
}

function applyPlayLocation(state: CNState, pid: string, locationNameStr: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const det = s.detective;
  if (det.location_played_this_turn) {
    throw new GameError('ILLEGAL_MOVE', 'Already played a Location this turn');
  }
  const locId = resolveLocation(locationNameStr);

  if (det.kind === 'tracked') {
    const idx = det.location_hand.indexOf(locId);
    if (idx === -1) throw new GameError('ILLEGAL_MOVE', `Location ${locationNameStr} not in hand`);
    det.location_hand.splice(idx, 1);
  }
  // For opaque: human physically plays the card; server just records it on the board.
  det.board.push(locId);
  det.location_played_this_turn = true;
  addLog(s, { actor: pid, category: 'action', summary: `Detective played ${locationName(locId)} to the board` });
  return { newState: s, summary: `Played ${locationName(locId)}` };
}

function applyUpkeepChoice(state: CNState, pid: string, keep: string[], release: string[]): { newState: CNState; summary: string } {
  const s = clone(state);
  const det = s.detective;
  if (!det.location_played_this_turn) {
    throw new GameError('ILLEGAL_MOVE', 'Detective must play a Location before paying upkeep');
  }
  // Accept printed names or ids (repo rule #2) — resolve everything to person
  // ids. v2.3 privacy: integer strings are 1-based ORDINALS over the current
  // informants array (how an AI-decider Detective's nameless upkeep speaks;
  // human Detectives name their upkeep entries).
  const resolveEntry = (k: string): string => {
    const ord = Number(k);
    if (Number.isInteger(ord) && String(ord) === k.trim() && ord >= 1 && ord <= det.informants.length) {
      return det.informants[ord - 1]!.person_id;
    }
    return resolvePerson(k);
  };
  const keepIds = new Set(keep.map(resolveEntry));
  let upkeepCost = 0;
  for (const inf of det.informants) {
    if (keepIds.has(inf.person_id)) {
      upkeepCost += 1;
    } else {
      // Release: POI returns facedown to hidden deck
      det.poi_deck.push(inf.person_id);
    }
  }
  det.informants = det.informants.filter(inf => keepIds.has(inf.person_id));
  // Set AP: 4 - upkeep, mark upkeep paid for this turn
  s.players[pid]!.ap = 4 - upkeepCost;
  s.detective.upkeep_paid = true;
  if (keepIds.size > 0 || det.informants.length >= 0) {
    addLog(s, { actor: pid, category: 'upkeep', summary: `Detective kept ${keepIds.size} informant(s), released ${release.length}` });
  }
  return { newState: s, summary: `Upkeep: kept ${keepIds.size}, released ${release.length}, AP remaining ${4 - upkeepCost}` };
}

function applyArrest(state: CNState, pid: string, targetPerson: string): { newState: CNState; summary: string } {
  const s = clone(state);
  requireDetectiveActionPhase(s);
  const det = s.detective;
  const personId = resolvePerson(targetPerson);
  // Validate: person at a face-up location
  let found = false;
  for (const locId of det.board) {
    const loc = getLocation(locId);
    if (loc?.residents.includes(personId)) { found = true; break; }
  }
  if (!found) throw new GameError('ILLEGAL_MOVE', `${targetPerson} is not at a face-up location`);
  // Validate: POI card is available (in hidden deck, not already an informant or jailed)
  if (!det.poi_deck.includes(personId)) {
    throw new GameError('ILLEGAL_MOVE', `${targetPerson}'s POI card is not available (already informant or jailed)`);
  }
  // Remove from POI deck, stack in Booked (slot 1). v2.3 jail rework: an
  // arrest NEVER shifts the track — cards advance only at the Detective's
  // turn-end (the old shift-on-arrest desynced the physical sheet and
  // bump-released prisoners early; designer ruling: stacks share a slot).
  det.poi_deck = det.poi_deck.filter(id => id !== personId);
  det.jail[0]!.push(personId);
  s.players[pid]!.ap -= 1;
  addLog(s, { actor: pid, category: 'arrest', summary: `Detective arrested ${personName(personId)} — POI card to Booked (jail slot 1)` });
  return { newState: s, summary: `Arrested ${personName(personId)} — POI card to Booked (jail slot 1); the jail advances one slot at each Detective turn-end, and prisoners are released after Release Pending (slot 3)` };
}

function applyRecruitInformant(state: CNState, pid: string, targetPerson: string | undefined): { newState: CNState; summary: string } {
  const s = clone(state);
  requireDetectiveActionPhase(s);
  const det = s.detective;
  let personId: string;
  if (targetPerson === undefined || targetPerson === '') {
    // v2.3 privacy: the AI-decider Detective's pick happens HERE, engine-side,
    // so the nameless move (and every response built from it) can't leak the
    // facedown identity to the Hacker. Deterministic per state (chooseMove-style
    // seed). Only the AI decider may go nameless — a human Detective (physical
    // or digital) must name their pick.
    if (!isAIDecider(s, pid)) {
      throw new GameError('ILLEGAL_MOVE', 'Name the person to recruit (human Detectives declare their own pick)');
    }
    const seed = ((s.rngSeed ^ Math.imul(s.turn + 1, 2654435761) ^ Math.imul(s.log.length + 1, 40503)) >>> 0);
    const pick = pickRecruitTarget(s, seed);
    if (!pick) throw new GameError('ILLEGAL_MOVE', 'No POI cards left to recruit');
    personId = pick;
  } else {
    personId = resolvePerson(targetPerson);
  }
  if (!det.poi_deck.includes(personId)) {
    throw new GameError('ILLEGAL_MOVE', `${targetPerson ?? personId}'s POI card is not available`);
  }
  // v2.3 (designer ruling): recruits are LOCATION-GATED like arrests.
  if (!recruitablePersonIds(s).includes(personId)) {
    throw new GameError('ILLEGAL_MOVE',
      `${targetPerson ?? personId} is not at any face-up location — informants can only be recruited from locations you have played`);
  }
  det.poi_deck = det.poi_deck.filter(id => id !== personId);
  det.informants.push({ person_id: personId, revealed: false });
  s.players[pid]!.ap -= 3;
  addLog(s, { actor: pid, category: 'recruit', summary: `Detective recruited informant (facedown)` });
  return { newState: s, summary: `Recruited informant` };
}

function applyDrawExtraLocation(state: CNState, pid: string): { newState: CNState; summary: string } {
  const s = clone(state);
  requireDetectiveActionPhase(s);
  const det = s.detective;
  if (det.kind === 'tracked') {
    if (det.location_deck.length === 0) throw new GameError('ILLEGAL_MOVE', 'Location deck is empty');
    const card = det.location_deck.shift()!;
    det.location_hand.push(card);
    if (!det.seen_locations.includes(card)) det.seen_locations.push(card);
  }
  s.players[pid]!.ap -= 4;
  addLog(s, { actor: pid, category: 'action', summary: `Detective drew an extra Location card` });
  return { newState: s, summary: 'Drew extra Location' };
}

function applyGuessLocation(state: CNState, pid: string, locationNameStr: string): { newState: CNState; summary: string } {
  const s = clone(state);
  requireDetectiveActionPhase(s);
  const locId = resolveLocation(locationNameStr);
  s.detective.mid_game_guess_spent = true;
  s.players[pid]!.ap -= 4;

  // v2.0: the hideout is a CARD — match by id (Little Ghana twins Trailer
  // Towers, so attribute equality would wrongly accept the twin).
  const hid = hideoutLocId(s);
  if (hid) {
    if (locId === hid) {
      s.phase = 'game_over';
      s.winners = [pid];
      s.resultSummary = 'Detective guessed correctly!';
      addLog(s, { actor: pid, category: 'guess', summary: `Detective guessed ${locationName(locId)} — CORRECT! Detective wins!` });
      return { newState: s, summary: 'Correct guess — Detective wins!' };
    }
  }
  addLog(s, { actor: pid, category: 'guess', summary: `Detective guessed ${locationName(locId)} — wrong. Play continues.` });
  return { newState: s, summary: `Wrong guess (${locationName(locId)})` };
}

function applyBuyClue(state: CNState, pid: string, discardLocations: [string, string, string]): { newState: CNState; summary: string } {
  const s = clone(state);
  requireDetectiveActionPhase(s);
  const det = s.detective;
  if (discardLocations.length !== 3) {
    throw new GameError('ILLEGAL_MOVE', 'Buy Clue costs exactly 3 Location cards (v2.3 — name all 3)');
  }
  const discardIds = discardLocations.map(resolveLocation);
  if (det.kind === 'tracked') {
    for (const id of discardIds) {
      const idx = det.location_hand.indexOf(id);
      if (idx === -1) throw new GameError('ILLEGAL_MOVE', `${locationName(id)} not in hand`);
      det.location_hand.splice(idx, 1);
    }
  }
  det.location_discard.push(...discardIds); // both kinds — the 3 cards are named
  addLog(s, { actor: pid, category: 'clue', summary: `Detective discarded 3 Locations to buy a Clue` });
  // Check if all truthful categories are revealed
  const tc = s.hacker.truthful_clues;
  if (tc.borough && tc.population && tc.affiliation) {
    // No effect
    addLog(s, { actor: null, category: 'clue', summary: 'All clues already revealed — no effect' });
    return { newState: s, summary: 'Clue bought but all categories revealed — no effect' };
  }
  // Set clue_reveal_pending for Hacker
  s.pending = { type: 'clue_reveal_pending', source: 'buy_clue' };
  s.activePlayerId = hackerId(s);
  return { newState: s, summary: 'Bought a Clue — Hacker must reveal a category' };
}

function applyFinalGuess(state: CNState, pid: string, locationNameStr: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const locId = resolveLocation(locationNameStr);
  const hidF = hideoutLocId(s);
  s.pending = null;
  if (hidF) {
    if (locId === hidF) {
      s.phase = 'game_over';
      s.winners = [pid];
      s.resultSummary = 'Detective guessed correctly!';
      addLog(s, { actor: pid, category: 'endgame', summary: `Final guess ${locationName(locId)} — CORRECT! Detective wins!` });
      return { newState: s, summary: 'Correct final guess — Detective wins!' };
    }
  }
  s.phase = 'game_over';
  s.winners = [hackerId(s)];
  s.resultSummary = 'Detective guessed wrong — Hacker is exonerated!';
  addLog(s, { actor: pid, category: 'endgame', summary: `Final guess ${locationName(locId)} — WRONG! Hacker wins!` });
  return { newState: s, summary: 'Wrong final guess — Hacker wins!' };
}

function detectiveEndTurn(s: CNState): void {
  // Advance jail track. Every transition is LOGGED (category 'jail') — the
  // index.ts applyMove wrapper appends fresh jail entries to the move summary
  // so the physical jail track never moves silently (designer report,
  // 2026-08-13: "the LLM doesn't report the jail transitions").
  const det = s.detective;
  for (const id of det.jail[0] ?? []) {
    addLog(s, { actor: null, category: 'jail', summary: `${personName(id)} advances to Processing (jail slot 2)` });
  }
  for (const id of det.jail[1] ?? []) {
    addLog(s, { actor: null, category: 'jail', summary: `${personName(id)} advances to Release Pending (jail slot 3)` });
  }
  for (const id of det.jail[2] ?? []) {
    // Released off Release Pending
    det.poi_deck.push(id);
    addLog(s, { actor: null, category: 'jail', summary: `${personName(id)} released from jail — return their POI card to the deck` });
  }
  det.jail = [[], det.jail[0] ?? [], det.jail[1] ?? []];
}

// ---------------------------------------------------------------------------
// Hacker turn
// ---------------------------------------------------------------------------

/** hand_size is the one PUBLIC fact about the Hacker's hand and must stay
 *  correct for BOTH kinds. Tracked hands mirror hand.length at each mutation
 *  site; an opaque (human) hand is private, but its SIZE is derivable from the
 *  declared moves — this adjusts it by the move's delta. (Found by the
 *  integration gate: a human Hacker was born at hand_size 0 and stayed there,
 *  and the client refused legal evidence plays off the phantom empty hand.) */
function adjustOpaqueHandSize(s: CNState, pid: string, delta: number): void {
  const p = s.players[pid];
  if (p && p.kind === 'opaque') p.hand_size = Math.max(0, p.hand_size + delta);
}

function applyDrawContact(state: CNState, pid: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const hak = s.hacker;
  if (hak.kind === 'tracked') {
    // Rulebook is SILENT on drawing with deck AND discard both empty (every
    // Contact is in hand or on the table) — interim ruling pending the
    // designer, recorded in PORT-NOTES §33: the draw is unavailable, rather
    // than charging AP for nothing. Without this guard the reshuffle below
    // produces an empty deck and shift() pushes undefined into the hand
    // (found by the divergence hunter, 2026-08-30).
    if (hak.contacts_deck.length === 0 && hak.contacts_discard.length === 0) {
      throw new GameError('ILLEGAL_MOVE',
        'The Contacts deck and discard pile are both empty — every Contact is in your hand or on the table, so there is nothing to draw. Spend your AP on something else.');
    }
    if (hak.contacts_deck.length === 0) {
      // Reshuffle discard
      hak.contacts_deck = [...hak.contacts_discard];
      hak.contacts_discard = [];
      const sh = shuffle(hak.contacts_deck, s.rngSeed);
      s.rngSeed = sh.nextSeed;
      hak.contacts_deck = sh.items;
    }
    const card = hak.contacts_deck.shift()!;
    const p = s.players[pid];
    if (p && p.kind === 'tracked') {
      p.hand.push(card);
      p.deck = [...hak.contacts_deck];
      p.hand_size = p.hand.length;
    }
  }
  adjustOpaqueHandSize(s, pid, +1);
  s.players[pid]!.ap -= 1;
  addLog(s, { actor: pid, category: 'action', summary: `Hacker drew a Contact` });
  return { newState: s, summary: 'Drew a Contact' };
}

function checkInformantBlock(s: CNState, personId: string): string | null {
  // Rulebook §6: a facedown informant may be revealed to block — and a
  // REVEALED informant "stays in play face up: it continues to block that
  // person". (The facedown-only version was a missed printed rule that
  // shipped with the original port and survived until 2026-08-12 — it is why
  // Win Back measured useless: the lock it exists to break never existed.)
  for (const inf of s.detective.informants) {
    if (inf.person_id === personId) {
      return inf.person_id;
    }
  }
  return null;
}

function applyPlayPerson(state: CNState, pid: string, personNameStr: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const personId = resolvePerson(personNameStr);
  const person = getPerson(personId)!;
  // Check jailed
  if (s.detective.jail.flat().includes(personId)) {
    throw new GameError('ILLEGAL_MOVE', `${personNameStr} is jailed and cannot be played`);
  }
  // Check informant block
  const blockingInformant = checkInformantBlock(s, personId);
  if (blockingInformant) {
    // Rulebook §5.2: "the AP spent is lost" — the cost is paid at declaration
    // and is NOT refunded if the Detective blocks. (Missed in the original
    // port; the decline path must not charge it again.)
    s.players[pid]!.ap -= person.cost;
    // Set block_pending — Detective decides
    s.pending = { type: 'block_pending', hacker_move: { type: 'play_person', person_name: personNameStr }, matching_informant: blockingInformant, person_id: personId };
    s.activePlayerId = detectiveId(s);
    return { newState: s, summary: `Informant match — Detective may block ${personNameStr}` };
  }
  // Pay cost and resolve
  s.players[pid]!.ap -= person.cost;
  resolveAbility(s, pid, personId);
  // If the ability set a pending (sub-choice), defer card-to-discard to completePlayPerson
  if (!s.pending) {
    completePlayPerson(s, pid, personId);
    addLog(s, { actor: pid, category: 'action', summary: `Hacker played ${personName(personId)} for ability` });
    return { newState: s, summary: `Played ${personName(personId)}` };
  }
  addLog(s, { actor: pid, category: 'action', summary: `Hacker played ${personName(personId)} — awaiting sub-choice` });
  return { newState: s, summary: `Played ${personName(personId)} — awaiting choice` };
}

function resolveAbility(s: CNState, pid: string, personId: string): void {
  const person = getPerson(personId)!;
  switch (person.ability) {
    case 'draw_3': {
      const hak = s.hacker;
      if (hak.kind === 'tracked') {
        for (let i = 0; i < 3; i++) {
          if (hak.contacts_deck.length === 0) {
            hak.contacts_deck = [...hak.contacts_discard];
            hak.contacts_discard = [];
            const sh = shuffle(hak.contacts_deck, s.rngSeed);
            s.rngSeed = sh.nextSeed;
            hak.contacts_deck = sh.items;
          }
          if (hak.contacts_deck.length > 0) {
            const card = hak.contacts_deck.shift()!;
            const p = s.players[pid];
            if (p && p.kind === 'tracked') {
              p.hand.push(card);
              p.deck = [...hak.contacts_deck];
              p.hand_size = p.hand.length;
            }
            adjustOpaqueHandSize(s, pid, +1);
          }
        }
      }
      // Voice matters by seat kind: a tracked Hacker's draws happened
      // server-side; an opaque (human) Hacker must be TOLD to physically
      // draw (integration gate, INTEGRATION-NOTES finding B).
      addLog(s, {
        actor: pid, category: 'ability',
        summary: s.hacker.kind === 'tracked'
          ? `${personName(personId)}: drew 3 Contacts`
          : `${personName(personId)}: Hacker, DRAW 3 Contacts from your own deck now (physical draw — this ability grants it)`,
      });
      break;
    }
    case 'hand_discard': {
      // Force Detective to discard a random Location from hand
      const det = s.detective;
      if (det.kind === 'tracked') {
        if (det.location_hand.length > 0) {
          const idx = nextRng(s.rngSeed);
          s.rngSeed = idx.seed;
          const randIdx = idx.value % det.location_hand.length;
          const discarded = det.location_hand.splice(randIdx, 1)[0]!;
          det.location_discard.push(discarded);
          addLog(s, { actor: pid, category: 'ability', summary: `${personName(personId)}: forced Detective to discard ${locationName(discarded)} from hand` });
        }
      }
      break;
    }
    case 'board_discard': {
      // Gang 2/3: Hacker chooses a board location to discard.
      const det = s.detective;
      if (det.board.length > 0) {
        s.pending = { type: 'board_discard_pending', source_person: personId };
        s.activePlayerId = hackerId(s);
      }
      break;
    }
    case 'reveal_informant': {
      // Corp 1: Hacker chooses a facedown informant to reveal.
      const det = s.detective;
      const hasFacedown = det.informants.some(inf => !inf.revealed);
      if (hasFacedown) {
        s.pending = { type: 'reveal_informant_pending', source_person: personId };
        s.activePlayerId = hackerId(s);
      }
      break;
    }
    case 'discard_retrieval': {
      // Corp 2: Hacker chooses a card from the discard pile to retrieve.
      const hak = s.hacker;
      if (hak.contacts_discard.length > 0) {
        s.pending = { type: 'discard_retrieval_pending', source_person: personId };
        s.activePlayerId = hackerId(s);
      }
      break;
    }
    case 'remove_informant': {
      // Anansi's ability is a rider on his EVIDENCE commit (resolveEvidencePlay)
      // — playing him as a person is a plain witness no-op. Two played-ability
      // designs measured negative at their ceiling (PORT-NOTES §18): the play
      // itself costs more than any one-shot utility returns.
      break;
    }
    case 'witness': {
      // No ability — just a witness card
      break;
    }
  }
}

function applyPlayEvidence(state: CNState, pid: string, personNameStr: string | undefined, evidenceType: string, people?: string[]): { newState: CNState; summary: string } {
  const s = clone(state);

  // BOTH multi-card Evidence pieces are played as a COMPLETE SET OF 3 in a
  // single action — cards are never banked one at a time and there are no
  // partial sets on the table. Motive: v2.1 designer ruling 2026-08-13.
  // Witness: v2.4 (2026-08-17) — §7 reads "reveal/play 3 Witness cards", ONE
  // action for the whole piece; the port had been committing them singly.
  // Each card gets the §5.2 informant check, in declared order; ONE accepted
  // block bounces the whole set back to hand (a partial commit would recreate
  // banking).
  if (evidenceType === 'motive' || evidenceType === 'witness') {
    const label = evidenceType === 'motive' ? 'Motive' : 'Witness';
    if (!people || people.length !== 3) {
      throw new GameError('ILLEGAL_MOVE',
        `${label} evidence is played as a COMPLETE set: declare all 3 people at once (people: [name, name, name]). Cards are never banked one at a time.`);
    }
    const ids = evidenceType === 'motive' ? validateMotiveTrio(s, pid, people) : validateWitnessTrio(s, pid, people);
    const matches = ids.filter(id => checkInformantBlock(s, id) !== null);
    if (matches.length > 0) {
      const first = matches[0]!;
      s.pending = {
        type: 'block_pending',
        // people stored as resolved IDS — the declined-block path replays them
        // into the set resolver without re-resolution.
        hacker_move: { type: 'play_evidence', evidence_type: evidenceType, people: ids },
        matching_informant: checkInformantBlock(s, first)!,
        person_id: first,
        remaining_checks: matches.slice(1),
      };
      s.activePlayerId = detectiveId(s);
      return { newState: s, summary: `Informant match — Detective may block ${personName(first)} (a block bounces the whole set)` };
    }
    return evidenceType === 'motive' ? resolveMotiveSetPlay(s, pid, ids) : resolveWitnessSetPlay(s, pid, ids);
  }

  // The Weapon is the ONLY single-card Evidence. It has no POI copy, so it can
  // never be an informant, never be blocked, and never be arrested (§7).
  if (evidenceType !== 'weapon' && personNameStr !== 'The Weapon') {
    throw new GameError('ILLEGAL_MOVE', `Unknown evidence type "${evidenceType}" — use weapon, witness, or motive`);
  }
  return resolveEvidencePlay(s, pid, WEAPON_ID, 'The Weapon', 'weapon');
}

// The evidence resolution body, shared by the direct path and the
// declined-block path (`applyBlockDecide`). `s` is already a clone with the
// jail/informant gates passed.
function resolveEvidencePlay(s: CNState, pid: string, personId: string, personNameStr: string, evidenceType: string): { newState: CNState; summary: string } {
  // v2.4: the Weapon is the ONLY single-card Evidence — Witness and Motive are
  // both atomic trios (resolveWitnessSetPlay / resolveMotiveSetPlay), so this
  // path no longer carries a witness branch or the Anansi rider (his rider now
  // rides whichever SET he is committed in).
  if (evidenceType !== 'weapon' || personId !== WEAPON_ID) {
    throw new GameError('ILLEGAL_MOVE', 'Only the Weapon is played as single-card Evidence');
  }
  void personNameStr;
  s.hacker.evidence.weapon = true;
  addLog(s, { actor: pid, category: 'evidence', summary: 'Hacker played the Weapon as Evidence' });

  // Card stays on table (not in discard). Remove from hand if tracked.
  if (s.hacker.kind === 'tracked') {
    const p = s.players[pid];
    if (p && p.kind === 'tracked') {
      p.hand = p.hand.filter(id => id !== personId);
      p.hand_size = p.hand.length;
    }
  }
  adjustOpaqueHandSize(s, pid, -1);

  // Check if all 3 Evidence complete
  const ev = s.hacker.evidence;
  if (ev.weapon && ev.witnesses.length >= 3 && ev.motive_set_1.length >= 3 && ev.motive_set_2.length >= 3 && ev.motive_set_3.length >= 3) {
    // Evidence complete — endgame trigger 1: immediate final guess
    s.endgame_triggered = true;
    s.endgame_reason = 'evidence_complete';
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = detectiveId(s);
    addLog(s, { actor: pid, category: 'endgame', summary: 'All 3 Evidence complete! Detective must make final guess.' });
  }

  return { newState: s, summary: 'Played the Weapon as Evidence' };
}

/** v2.4: validate a declared Witness trio (names or ids) and return resolved
 *  ids. Witness evidence is atomic exactly like a Motive set — §7 "reveal/play
 *  3 Witness cards" is ONE action for the whole piece — so every rule is
 *  checked up front and one accepted block bounces all three. */
function validateWitnessTrio(s: CNState, pid: string, people: string[]): string[] {
  const ids = people.map(n => resolvePerson(n));
  if (new Set(ids).size !== 3) throw new GameError('ILLEGAL_MOVE', 'Witness evidence needs 3 DIFFERENT people');
  const ev = s.hacker.evidence;
  if (ev.witnesses.length > 0) throw new GameError('ILLEGAL_MOVE', 'Witness evidence is already complete');
  const allEvidence = [...ev.motive_set_1, ...ev.motive_set_2, ...ev.motive_set_3, ...(ev.motive_set_4 ?? [])];
  for (const id of ids) {
    if (id === WEAPON_ID) throw new GameError('ILLEGAL_MOVE', 'The Weapon is its own Evidence and cannot be a Witness');
    const person = getPerson(id);
    if (!person?.is_witness) throw new GameError('ILLEGAL_MOVE', `${personName(id)} is not a Witness`);
    if (s.detective.jail.flat().includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} is jailed and cannot be used as Evidence`);
    if (allEvidence.includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} already used as Evidence`);
  }
  // Tracked Hacker: every declared card must actually be in hand. (Opaque
  // Hackers hold physical cards — the declaration is trusted per doctrine.)
  const p = s.players[pid];
  if (p && p.kind === 'tracked') {
    for (const id of ids) {
      if (!p.hand.includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} is not in your hand`);
    }
  }
  return ids;
}

/** v2.4: commit a validated Witness trio as one atomic play. */
function resolveWitnessSetPlay(s: CNState, pid: string, ids: string[]): { newState: CNState; summary: string } {
  const ev = s.hacker.evidence;
  ev.witnesses.push(...ids);
  const described = ids.map(id => personName(id)).join(', ');
  addLog(s, { actor: pid, category: 'evidence', summary: `Hacker played the complete Witness set (3/3): ${described}` });

  // Cards stay on the table. Remove from hand if tracked.
  const p = s.players[pid];
  if (p && p.kind === 'tracked') {
    p.hand = p.hand.filter(cardId => !ids.includes(cardId));
    p.hand_size = p.hand.length;
  }
  // v2.4: the Witness piece leaves an opaque hand THREE cards lighter (§30 —
  // the public hand SIZE is derivable from the declared move even though the
  // contents are private).
  adjustOpaqueHandSize(s, pid, -ids.length);

  // Endgame precedence: a set that completes ALL Evidence triggers the final
  // guess immediately — riders are skipped (§5.3).
  if (ev.weapon && ev.witnesses.length >= 3 && ev.motive_set_1.length >= 3 && ev.motive_set_2.length >= 3 && ev.motive_set_3.length >= 3) {
    s.endgame_triggered = true;
    s.endgame_reason = 'evidence_complete';
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = detectiveId(s);
    addLog(s, { actor: pid, category: 'endgame', summary: 'All 3 Evidence complete! Detective must make final guess.' });
    return { newState: s, summary: `Played the complete Witness set: ${described} — ALL EVIDENCE COMPLETE, Detective must make the final guess` };
  }

  // v2.0 Anansi rider: his Evidence commit also removes an informant. (No
  // Iceden rider here — every Witness is 'none' affiliation, so a gang member
  // can only ride in on a Motive set.)
  const anansiId = ids.find(id => getPerson(id)?.ability === 'remove_informant');
  if (anansiId && s.detective.informants.length > 0) {
    s.pending = { type: 'informant_removal_pending', source_person: anansiId, scope: 'any' };
    s.activePlayerId = hackerId(s);
    addLog(s, { actor: pid, category: 'ability', summary: `${personName(anansiId)}'s testimony names the mole — the Hacker removes one informant` });
    return { newState: s, summary: `Played the complete Witness set: ${described} — choose an informant to remove (facedown by position, revealed by name)` };
  }

  return { newState: s, summary: `Played the complete Witness set: ${described}` };
}

/** v2.1: validate a declared Motive trio (names or ids) and return resolved ids.
 *  All-or-nothing — sets are atomic, so every rule is checked up front. */
function validateMotiveTrio(s: CNState, pid: string, people: string[]): string[] {
  const ids = people.map(n => resolvePerson(n));
  if (new Set(ids).size !== 3) throw new GameError('ILLEGAL_MOVE', 'A Motive set needs 3 DIFFERENT people');
  const ev = s.hacker.evidence;
  const allEvidence = [...ev.witnesses, ...ev.motive_set_1, ...ev.motive_set_2, ...ev.motive_set_3, ...(ev.motive_set_4 ?? [])];
  const affs: string[] = [];
  for (const id of ids) {
    if (id === WEAPON_ID) throw new GameError('ILLEGAL_MOVE', 'The Weapon cannot be part of a Motive set');
    if (s.detective.jail.flat().includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} is jailed and cannot be used as Evidence`);
    if (allEvidence.includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} already used as Evidence`);
    affs.push(getPerson(id)!.affiliation);
  }
  if (new Set(affs).size !== 3) throw new GameError('ILLEGAL_MOVE', 'A Motive set needs 3 DIFFERENT affiliations');
  // v2.3-PROBE (2026-08-13): at most TWO gangs per set — the midpoint of the
  // measured near-binary knob (one-gang cap ≈87% Detective, no cap ≈50%). A
  // credible motive needs at least one citizen or corporate voice.
  if (affs.filter(a => a === 'gang_1' || a === 'gang_2' || a === 'gang_3').length > 2) {
    throw new GameError('ILLEGAL_MOVE', 'A Motive set allows at most TWO gang affiliations — at least one member must be a citizen or corp');
  }
  const trio = trioKey(affs);
  const allSets = [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3];
  for (let i = 0; i < allSets.length; i++) {
    const other = allSets[i]!;
    if (other.length < 3) continue;
    if (trioKey(other.map(id => getPerson(id)!.affiliation)) === trio) {
      throw new GameError('ILLEGAL_MOVE',
        `Motive sets cannot repeat an affiliation combination — set ${i + 1} already uses ${trio.split('+').join(' + ')}`);
    }
  }
  if (!allSets.some(set => set.length === 0)) {
    throw new GameError('ILLEGAL_MOVE', 'All 3 Motive sets are already complete');
  }
  // Tracked Hacker: every declared card must actually be in hand. (Opaque
  // Hackers hold physical cards — the declaration is trusted per doctrine.)
  const p = s.players[pid];
  if (p && p.kind === 'tracked') {
    for (const id of ids) {
      if (!p.hand.includes(id)) throw new GameError('ILLEGAL_MOVE', `${personName(id)} is not in your hand`);
    }
  }
  return ids;
}

/** v2.1: commit a validated Motive trio as one atomic set play. */
function resolveMotiveSetPlay(s: CNState, pid: string, ids: string[]): { newState: CNState; summary: string } {
  const ev = s.hacker.evidence;
  const allSets = [ev.motive_set_1, ev.motive_set_2, ev.motive_set_3];
  const slot = allSets.findIndex(set => set.length === 0);
  if (slot === -1) throw new GameError('ILLEGAL_MOVE', 'All 3 Motive sets are already complete');
  allSets[slot]!.push(...ids);
  const described = ids.map(id => `${personName(id)} (${affiliationName(getPerson(id)!.affiliation)})`).join(', ');
  addLog(s, { actor: pid, category: 'evidence', summary: `Hacker played the complete Motive set ${slot + 1}: ${described}` });

  // Cards stay on the table. Remove from hand if tracked.
  const p = s.players[pid];
  if (p && p.kind === 'tracked') {
    p.hand = p.hand.filter(id => !ids.includes(id));
    p.hand_size = p.hand.length;
  }
  adjustOpaqueHandSize(s, pid, -ids.length);

  // Riders (both may live in one set — Anansi is affiliation 'none', the
  // Iceden member is the set's one gang slot). Anansi resolves first; the
  // Iceden win-back is queued as follow_up and fires only if a revealed
  // informant still exists after his removal.
  const anansiId = ids.find(id => getPerson(id)?.ability === 'remove_informant' && s.detective.informants.length > 0);
  const icedenId = ids.find(id => getPerson(id)?.affiliation === 'gang_1');
  const icedenLive = icedenId !== undefined && s.detective.informants.some(i => i.revealed);

  // Endgame precedence: a set that completes ALL Evidence triggers the final
  // guess immediately — riders are skipped (§5.3).
  if (ev.weapon && ev.witnesses.length >= 3 && ev.motive_set_1.length >= 3 && ev.motive_set_2.length >= 3 && ev.motive_set_3.length >= 3) {
    s.endgame_triggered = true;
    s.endgame_reason = 'evidence_complete';
    s.pending = { type: 'endgame_final_guess' };
    s.activePlayerId = detectiveId(s);
    addLog(s, { actor: pid, category: 'endgame', summary: 'All 3 Evidence complete! Detective must make final guess.' });
    return { newState: s, summary: `Played the complete Motive set ${slot + 1}: ${described} — ALL EVIDENCE COMPLETE, Detective must make the final guess` };
  }
  if (anansiId) {
    s.pending = {
      type: 'informant_removal_pending', source_person: anansiId, scope: 'any',
      ...(icedenLive ? { follow_up: { source_person: icedenId!, scope: 'revealed' as const } } : {}),
    };
    s.activePlayerId = hackerId(s);
    addLog(s, { actor: pid, category: 'ability', summary: `${personName(anansiId)}'s testimony names the mole — the Hacker removes one informant` });
    return { newState: s, summary: `Played the complete Motive set ${slot + 1}: ${described} — choose an informant to remove (facedown by position, revealed by name)` };
  }
  if (icedenLive) {
    s.pending = { type: 'informant_removal_pending', source_person: icedenId!, scope: 'revealed' };
    s.activePlayerId = hackerId(s);
    addLog(s, { actor: pid, category: 'ability', summary: `${personName(icedenId!)} (Iceden Collective) vouches — the Hacker wins back one revealed informant, free` });
    return { newState: s, summary: `Played the complete Motive set ${slot + 1}: ${described} — Iceden rider: choose a REVEALED informant to win back (free)` };
  }
  return { newState: s, summary: `Played the complete Motive set ${slot + 1}: ${described}` };
}

function applyWinBack(state: CNState, pid: string, personNameStr: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const personId = resolvePerson(personNameStr);
  const person = getPerson(personId)!;
  // Must match a revealed informant
  const inf = s.detective.informants.find(i => i.person_id === personId && i.revealed);
  if (!inf) throw new GameError('ILLEGAL_MOVE', `${personNameStr} is not a revealed informant`);
  // Rulebook §6: "the Hacker may PLAY THE MATCHING CONTACT for its printed
  // cost ... and the Hacker's Contact goes to their discard". The card is
  // played FROM HAND — a Hacker who does not hold it cannot win the informant
  // back. (Missed in the original port: the win-back neither required the card
  // nor took it from hand, it just PUSHED a copy into the discard. When the
  // real card was still in the deck that minted a SECOND copy, which the deck
  // reshuffle then dealt out — a duplicate id in hand. Found 2026-08-17 by the
  // v2.4 witness-trio enumeration, which offers a trio by hand position and so
  // produced "3 DIFFERENT people" violations; the motive enumeration had
  // masked the same corruption behind its distinct-affiliation filter.)
  const hp = s.players[pid];
  if (hp && hp.kind === 'tracked') {
    const handIdx = hp.hand.indexOf(personId);
    if (handIdx === -1) {
      throw new GameError('ILLEGAL_MOVE',
        `Winning back ${personName(personId)} requires playing your matching ${personName(personId)} Contact card — it is not in your hand`);
    }
    hp.hand.splice(handIdx, 1);
    hp.hand_size = hp.hand.length;
  }
  // Pay printed cost (Witnesses cost X=1)
  const cost = person.is_witness ? 1 : person.cost;
  s.players[pid]!.ap -= cost;
  // Remove informant: POI returns facedown to hidden deck
  s.detective.informants = s.detective.informants.filter(i => i !== inf);
  s.detective.poi_deck.push(personId);
  // Contact goes to Hacker discard (not Evidence)
  if (s.hacker.kind === 'tracked') {
    s.hacker.contacts_discard.push(personId);
    const p = s.players[pid];
    if (p && p.kind === 'tracked') {
      p.discard = [...s.hacker.contacts_discard];
    }
  }
  adjustOpaqueHandSize(s, pid, -1);
  addLog(s, { actor: pid, category: 'win_back', summary: `Hacker won back ${personName(personId)} — informant removed` });
  return { newState: s, summary: `Won back ${personName(personId)}` };
}

function applyJailbreak(state: CNState, pid: string, freedPerson: string, negativeClueToken: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const personId = resolvePerson(freedPerson);
  // Must be jailed
  const jailIdx = s.detective.jail.findIndex(slot => slot.includes(personId));
  if (jailIdx === -1) throw new GameError('ILLEGAL_MOVE', `${freedPerson} is not jailed`);
  // Free: POI returns to hidden deck
  s.detective.jail[jailIdx] = s.detective.jail[jailIdx]!.filter(id => id !== personId);
  s.detective.poi_deck.push(personId);
  // Negative Clue: must be a real token (printed value or id), new, and not in a truthfully-revealed category
  let tokenId: string;
  try {
    tokenId = resolveClueToken(negativeClueToken);
  } catch {
    throw new GameError('ILLEGAL_MOVE', `${negativeClueToken} is not a valid Clue token`);
  }
  const tokenDef = CLUE_TOKENS.find(t => t.id === tokenId)!;
  const tc = s.hacker.truthful_clues;
  if (s.hacker.negative_clues.includes(tokenId)) {
    throw new GameError('ILLEGAL_MOVE', `${tokenId} already declared as negative`);
  }
  if (tokenDef.type === 'borough' && tc.borough) {
    throw new GameError('ILLEGAL_MOVE', `${tokenId} is in a truthfully-revealed borough`);
  }
  if (tokenDef.type === 'population' && tc.population) {
    throw new GameError('ILLEGAL_MOVE', `${tokenId} is in a truthfully-revealed population`);
  }
  if (tokenDef.type === 'affiliation' && tc.affiliation) {
    throw new GameError('ILLEGAL_MOVE', `${tokenId} is in a truthfully-revealed affiliation`);
  }
  // For tracked Hacker (server knows the hideout): a Negative Clue must actually be FALSE
  if (s.hacker.hideout) {
    const h = s.hacker.hideout;
    const isTrue =
      (tokenDef.type === 'borough' && tokenDef.value === h.borough) ||
      (tokenDef.type === 'population' && Number(tokenDef.value) === h.population) ||
      (tokenDef.type === 'affiliation' && tokenDef.value === h.affiliation);
    if (isTrue) {
      throw new GameError('ILLEGAL_MOVE', `${tokenId} is true of the hideout — a Negative Clue must be false`);
    }
  }
  s.hacker.negative_clues.push(tokenId);
  addLog(s, { actor: pid, category: 'jailbreak', summary: `Hacker freed ${personName(personId)} from jail; gave Negative Clue ${tokenId}` });
  return { newState: s, summary: `Jailbreak: freed ${personName(personId)}, removing negative clue token ${tokenId}` };
}

function applyOverclock(state: CNState, pid: string): { newState: CNState; summary: string } {
  const s = clone(state);
  if (s.players[pid]!.overclock_used) {
    throw new GameError('ILLEGAL_MOVE', 'Overclock already used this turn');
  }
  s.players[pid]!.overclock_used = true;
  s.players[pid]!.ap += 1;
  // Give Detective 2 Location draws — timing depends on option
  const timing = s.overclock_draw_timing;
  if (timing === 'immediate') {
    const det = s.detective;
    if (det.kind === 'tracked') {
      for (let i = 0; i < 2; i++) {
        if (det.location_deck.length > 0) {
          const c = det.location_deck.shift()!;
          det.location_hand.push(c);
          if (!det.seen_locations.includes(c)) det.seen_locations.push(c);
        }
      }
    }
    addLog(s, { actor: pid, category: 'overclock', summary: 'Hacker Overclocked (+1 AP, Detective drew 2 Locations immediately)' });
  } else {
    s.overclock_draws_owed += 2;
    addLog(s, { actor: pid, category: 'overclock', summary: `Hacker Overclocked (+1 AP, Detective gets 2 Location draws ${timing === 'next_turn' ? 'next turn' : 'optionally next turn'})` });
  }
  return { newState: s, summary: 'Overclocked (+1 AP)' };
}

function applyClueReveal(state: CNState, pid: string, category: ClueCategory, value: string): { newState: CNState; summary: string } {
  const s = clone(state);
  // The reveal's source decides whose turn resumes afterward (see bottom).
  const source = s.pending?.type === 'clue_reveal_pending' ? s.pending.source : undefined;
  const tc = s.hacker.truthful_clues;
  if (tc[category]) {
    throw new GameError('ILLEGAL_MOVE', `Category ${category} already revealed`);
  }
  // Normalize the declared value (accept printed names as well as ids — repo rule #2)
  let normalized: string | number;
  try {
    if (category === 'borough') normalized = resolveBorough(value);
    else if (category === 'affiliation') normalized = resolveAffiliation(value);
    else {
      normalized = Number(value);
      if (!Number.isInteger(normalized) || normalized < 0 || normalized > 3) throw new Error('bad pop');
    }
  } catch {
    throw new GameError('ILLEGAL_MOVE', `${value} is not a valid ${category} clue value`);
  }
  // Mark as revealed and record the value (public physical fact — the token is on the table)
  (tc as unknown as Record<string, boolean>)[category] = true;
  (s.hacker.truthful_values as unknown as Record<string, string | number>)[category] = normalized;
  // For tracked Hacker: server knows hideout, validates the value is truthful
  if (s.hacker.hideout) {
    // Validate truthfulness
    const loc = s.hacker.hideout;
    if (category === 'borough' && normalized !== loc.borough) {
      throw new GameError('ILLEGAL_MOVE', `Borough clue must be truthful`);
    }
    if (category === 'population' && normalized !== loc.population) {
      throw new GameError('ILLEGAL_MOVE', `Population clue must be truthful`);
    }
    if (category === 'affiliation' && normalized !== loc.affiliation) {
      throw new GameError('ILLEGAL_MOVE', `Affiliation clue must be truthful`);
    }
  }
  s.pending = null;
  if (source === 'block') {
    // Rulebook §5.2/§6: a blocked play costs the Hacker the AP SPENT — nothing
    // ends their turn. Play resumes with the Hacker; the dispatcher's 0-AP
    // check ends the turn only if the blocked play consumed the last AP.
    // (Routing to the Detective here ended the Hacker's turn early AND opened
    // a phantom mid-turn Detective activation — the desync gate's livelock.)
    s.activePlayerId = hackerId(s);
  } else {
    // buy_clue: the Detective spent the cards mid-turn; their turn resumes.
    s.activePlayerId = detectiveId(s);
  }
  addLog(s, { actor: pid, category: 'clue', summary: `Hacker revealed ${category} clue: ${normalized}` });
  return { newState: s, summary: `Revealed ${category} = ${normalized}` };
}

function applyBlockDecide(state: CNState, pid: string, block: boolean): { newState: CNState; summary: string } {
  const s = clone(state);
  if (!s.pending || s.pending.type !== 'block_pending') {
    throw new GameError('ILLEGAL_MOVE', 'No block pending');
  }
  const pending = s.pending;
  if (block) {
    // Reveal the informant (idempotent — a standing revealed informant
    // blocks again without further ceremony, per §6).
    const inf = s.detective.informants.find(i => i.person_id === pending.matching_informant);
    const wasRevealed = inf?.revealed ?? false;
    if (inf) inf.revealed = true;
    void wasRevealed;
    // Detective gains a Clue — but only if there are unrevealed categories
    const tc = s.hacker.truthful_clues;
    if (tc.borough && tc.population && tc.affiliation) {
      // All categories revealed — no clue to reveal. Return play to the
      // Hacker so the normal turn-end AP check can run.
      s.pending = null;
      s.activePlayerId = hackerId(s);
      addLog(s, { actor: pid, category: 'block', summary: `Detective blocked ${personName(pending.person_id)} — informant revealed, but all clues already revealed (no effect)` });
      return { newState: s, summary: `Blocked ${personName(pending.person_id)} — no clue (all revealed)` };
    }
    s.pending = { type: 'clue_reveal_pending', source: 'block' };
    s.activePlayerId = hackerId(s);
    addLog(s, { actor: pid, category: 'block', summary: `Detective blocked ${personName(pending.person_id)} — informant revealed` });
    return { newState: s, summary: `Blocked ${personName(pending.person_id)}` };
  } else {
    // Don't block — the Hacker's original play proceeds.
    const personId = pending.person_id;
    s.pending = null; // clear block_pending before resolving

    if (pending.hacker_move.type === 'play_evidence') {
      // Evidence plays are free; the gates (jail, informant) were already
      // checked at declaration — just resolve the placement.
      const mv = pending.hacker_move;
      if ((mv.evidence_type === 'motive' || mv.evidence_type === 'witness') && mv.people) {
        // v2.1 set play: this card's check is declined — cascade to the next
        // matching card, or commit the whole set when every check is declined.
        const remaining = pending.remaining_checks ?? [];
        // v2.3 privacy: a declined block is physically INVISIBLE — no log.
        if (remaining.length > 0) {
          const next = remaining[0]!;
          s.pending = {
            type: 'block_pending',
            hacker_move: mv,
            matching_informant: checkInformantBlock(s, next)!,
            person_id: next,
            remaining_checks: remaining.slice(1),
          };
          s.activePlayerId = detectiveId(s);
          return { newState: s, summary: `Declined — Detective may still block ${personName(next)} (a block bounces the whole set)` };
        }
        const result = mv.evidence_type === 'motive'
          ? resolveMotiveSetPlay(s, hackerId(s), mv.people)
          : resolveWitnessSetPlay(s, hackerId(s), mv.people);
        if (!result.newState.pending) result.newState.activePlayerId = hackerId(result.newState);
        return result;
      }
      // v2.3 privacy: a declined block is physically INVISIBLE — no log.
      const result = resolveEvidencePlay(s, hackerId(s), personId, mv.person_name ?? personName(personId), mv.evidence_type);
      // Evidence completion sets the endgame pending (active → Detective);
      // otherwise play returns to the Hacker.
      if (!result.newState.pending) result.newState.activePlayerId = hackerId(result.newState);
      return result;
    }

    // play_person: the cost was already paid at declaration (rulebook §5.2 —
    // a blocked play loses the AP, so declaration is when it's charged).
    resolveAbility(s, hackerId(s), personId);
    // If ability set a new pending (sub-choice), defer card-to-discard
    if (s.pending) {
      // v2.3 privacy: a declined block is physically INVISIBLE — no log; the
      // summary is the play's own effect.
      return { newState: s, summary: `Played ${personName(personId)} — awaiting choice` };
    }
    completePlayPerson(s, hackerId(s), personId);
    s.activePlayerId = hackerId(s);
    return { newState: s, summary: `Played ${personName(personId)}` };
  }
}

// Sub-choice handler for Corp 1 "reveal informant" ability (triggered via pending).
// The target is a 1-based ORDINAL over the facedown informants (stable array order) —
// the Hacker points at a facedown card, never a named person (identities are hidden).
function applyRevealInformantAbility(state: CNState, pid: string, targetInformant: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const pending = s.pending;
  if (pending?.type !== 'reveal_informant_pending') throw new GameError('ILLEGAL_MOVE', 'No reveal_informant pending');
  const facedown = s.detective.informants.filter(i => !i.revealed);
  const ordinal = Number(targetInformant);
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > facedown.length) {
    throw new GameError('ILLEGAL_MOVE', `${targetInformant} is not a facedown informant position (1-${facedown.length})`);
  }
  const inf = facedown[ordinal - 1]!;
  inf.revealed = true;
  addLog(s, { actor: pid, category: 'ability', summary: `${personName(pending.source_person)}: revealed informant ${personName(inf.person_id)}` });
  // Complete the play: card to discard
  completePlayPerson(s, pid, pending.source_person);
  s.pending = null;
  s.activePlayerId = hackerId(s);
  return { newState: s, summary: `Revealed informant ${personName(inf.person_id)}` };
}

// Sub-choice handler for Gang 2/3 "board discard" ability
function applyBoardDiscardChoice(state: CNState, pid: string, targetLocation: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const pending = s.pending;
  if (pending?.type !== 'board_discard_pending') throw new GameError('ILLEGAL_MOVE', 'No board_discard pending');
  const locId = resolveLocation(targetLocation);
  const idx = s.detective.board.indexOf(locId);
  if (idx === -1) throw new GameError('ILLEGAL_MOVE', `${targetLocation} is not on the board`);
  s.detective.board.splice(idx, 1);
  s.detective.location_discard.push(locId);
  addLog(s, { actor: pid, category: 'ability', summary: `${personName(pending.source_person)}: discarded ${locationName(locId)} from the board` });
  completePlayPerson(s, pid, pending.source_person);
  s.pending = null;
  s.activePlayerId = hackerId(s);
  return { newState: s, summary: `Discarded ${locationName(locId)} from board` };
}

// Sub-choice handler for Anansi's "remove informant" ability (v2.0). The
// target is an ORDINAL over the facedown informants (blind pick — the card
// returns to the POI deck unseen and the summary must not leak the name) or a
// revealed informant's printed name.
function applyInformantRemovalChoice(state: CNState, pid: string, targetInformant: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const pending = s.pending;
  if (pending?.type !== 'informant_removal_pending') throw new GameError('ILLEGAL_MOVE', 'No informant_removal pending');
  const revealedOnly = pending.scope === 'revealed';
  const facedown = revealedOnly ? [] : s.detective.informants.filter(i => !i.revealed);
  const ordinal = Number(targetInformant);
  let removed: Informant | undefined;
  let publicLabel: string;
  if (!revealedOnly && Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= facedown.length && String(ordinal) === targetInformant.trim()) {
    removed = facedown[ordinal - 1]!;
    publicLabel = `the #${ordinal} facedown informant (returned to the POI deck UNSEEN)`;
  } else {
    const personId = resolvePerson(targetInformant);
    removed = s.detective.informants.find(i => i.person_id === personId && i.revealed);
    if (!removed) {
      throw new GameError('ILLEGAL_MOVE', revealedOnly
        ? `${targetInformant} is not a revealed informant (the Iceden rider wins back REVEALED informants only)`
        : `${targetInformant} is not a revealed informant (facedown informants are picked by position 1-${facedown.length})`);
    }
    publicLabel = `revealed informant ${personName(removed.person_id)}`;
  }
  s.detective.informants = s.detective.informants.filter(i => i !== removed);
  s.detective.poi_deck.push(removed.person_id);
  addLog(s, { actor: pid, category: 'ability', summary: `${personName(pending.source_person)}: removed ${publicLabel}` });
  // v2.1: a motive set can carry BOTH riders — fire the queued Iceden win-back
  // if a revealed informant still exists after this removal.
  if (pending.follow_up && s.detective.informants.some(i => i.revealed)) {
    s.pending = { type: 'informant_removal_pending', source_person: pending.follow_up.source_person, scope: 'revealed' };
    s.activePlayerId = hackerId(s);
    addLog(s, { actor: pid, category: 'ability', summary: `${personName(pending.follow_up.source_person)} (Iceden Collective) vouches — the Hacker wins back one revealed informant, free` });
    return { newState: s, summary: `Removed ${publicLabel} — Iceden rider: choose a REVEALED informant to win back (free)` };
  }
  // Rider path: Anansi is already committed in the Evidence zone — the card
  // does NOT go to the discard (unlike play_person abilities).
  s.pending = null;
  s.activePlayerId = hackerId(s);
  return { newState: s, summary: `Removed ${publicLabel}` };
}

// Sub-choice handler for Corp 2 "discard retrieval" ability
function applyDiscardRetrievalChoice(state: CNState, pid: string, targetCard: string): { newState: CNState; summary: string } {
  const s = clone(state);
  const pending = s.pending;
  if (pending?.type !== 'discard_retrieval_pending') throw new GameError('ILLEGAL_MOVE', 'No discard_retrieval pending');
  const cardId = resolvePerson(targetCard);
  const idx = s.hacker.contacts_discard.indexOf(cardId);
  if (idx === -1) throw new GameError('ILLEGAL_MOVE', `${targetCard} is not in the discard pile`);
  s.hacker.contacts_discard.splice(idx, 1);
  const p = s.players[pid];
  if (p && p.kind === 'tracked') {
    p.hand.push(cardId);
    p.hand_size = p.hand.length;
  }
  adjustOpaqueHandSize(s, pid, +1);
  addLog(s, { actor: pid, category: 'ability', summary: `${personName(pending.source_person)}: retrieved ${personName(cardId)} from discard` });
  completePlayPerson(s, pid, pending.source_person);
  s.pending = null;
  s.activePlayerId = hackerId(s);
  return { newState: s, summary: `Retrieved ${personName(cardId)} from discard` };
}

// Complete the play_person flow: move card to discard (called after sub-choice resolves)
function completePlayPerson(s: CNState, pid: string, personId: string): void {
  if (s.hacker.kind === 'tracked') {
    s.hacker.contacts_discard.push(personId);
    const p = s.players[pid];
    if (p && p.kind === 'tracked') {
      p.hand = p.hand.filter(id => id !== personId);
      p.hand_size = p.hand.length;
      p.discard = [...s.hacker.contacts_discard];
    }
  }
  adjustOpaqueHandSize(s, pid, -1);
}

// ---------------------------------------------------------------------------
// Burn the Safehouse (rules v1.7) — 3 AP, once per game
// ---------------------------------------------------------------------------

function clueValueLabel(category: ClueCategory | string, value: string | number): string {
  if (category === 'borough') return BOROUGHS.find(b => b.id === value)?.name ?? String(value);
  if (category === 'affiliation') {
    return AFFILIATIONS.find(x => x.id === value)?.name ?? String(value);
  }
  return String(value);
}

// Resolve a burn once the new location is known. `s` is already a clone with
// the 3 AP paid; callers validate pile membership the server cannot check
// itself (the hand-report path). The summary carries every physical action the
// human must take, but NEVER the new location's name — it is the new secret.
function completeBurn(s: CNState, pid: string, newLocId: string): { newState: CNState; summary: string } {
  const newLoc = getLocation(newLocId);
  if (!newLoc) throw new GameError('ILLEGAL_MOVE', `Unknown location: ${newLocId}`);
  const oldLocId = hideoutLocId(s);
  const oldLoc = oldLocId ? getLocation(oldLocId) : undefined;
  if (oldLoc && oldLoc.id === newLocId) {
    throw new GameError('ILLEGAL_MOVE', 'The new safehouse must be a DIFFERENT location');
  }
  if (s.detective.board.includes(newLocId)) {
    throw new GameError('ILLEGAL_MOVE', `${newLoc.name} is face up on the board — it is not in the gathered pile`);
  }
  if (s.detective.kind === 'tracked') {
    // The gathered pile is exactly deck + discard (server-known).
    const pool = new Set([...s.detective.location_deck, ...s.detective.location_discard]);
    if (!pool.has(newLocId)) {
      throw new GameError('ILLEGAL_MOVE', `${newLoc.name} is not in the gathered pile (it is in the Detective's hand or was never available)`);
    }
  }

  // Snapshot the Detective's pre-burn candidate pool BEFORE the clue wipe.
  // The table resets but a player's memory doesn't: the new safehouse must be
  // a DIFFERENT location, so a pool the Detective had pinned down stays useful
  // knowledge after the burn (consumed by the `patient` strategy lever).
  s.pre_burn_detective_pool = detectiveCandidateLocations(s).map(l => l.id);

  s.hacker.hideout = { borough: newLoc.borough, population: newLoc.population, affiliation: newLoc.affiliation };
  s.hacker.hideout_location_id = newLoc.id;
  s.hacker.safehouse_burned = true;
  // v2.0: a burn re-randomizes everything in the gathered pile — the new
  // hideout may be a card the Detective once saw. Elimination knowledge
  // resets to what they physically hold right now.
  s.detective.seen_locations = [...s.detective.location_hand];

  // v1.8: burning clears ALL clues — truthful tokens come off the table too
  // (v1.7 swapped them to stay true of the new hideout). The Detective's clue
  // investigation restarts from zero; categories become buyable again.
  const tc = s.hacker.truthful_clues;
  const tv = s.hacker.truthful_values;
  const removedTruthful: string[] = [];
  if (tc.borough) removedTruthful.push(`Borough ${clueValueLabel('borough', tv.borough ?? '?')}`);
  if (tc.population) removedTruthful.push(`Population ${tv.population ?? '?'}`);
  if (tc.affiliation) removedTruthful.push(`Affiliation ${clueValueLabel('affiliation', tv.affiliation ?? '?')}`);
  s.hacker.truthful_clues = { borough: false, population: false, affiliation: false };
  s.hacker.truthful_values = {};

  const removedTokens = s.hacker.negative_clues.map(id => {
    const t = CLUE_TOKENS.find(tok => tok.id === id);
    return t ? `${t.type} ${clueValueLabel(t.type, t.value)}` : id;
  });
  s.hacker.negative_clues = [];

  if (s.detective.kind === 'tracked') {
    // Rebuild the virtual deck: deck + discard + old safehouse card, minus the
    // new safehouse card, shuffled.
    let pool = [...s.detective.location_deck, ...s.detective.location_discard];
    if (s.hideout_card_removed && oldLoc && !pool.includes(oldLoc.id)) pool.push(oldLoc.id);
    pool = pool.filter(id => id !== newLocId);
    const sh = shuffle(pool, s.rngSeed);
    s.rngSeed = sh.nextSeed;
    s.detective.location_deck = sh.items;
  }
  // Opaque Detective: the humans gather, swap, and shuffle at the table.
  s.detective.location_discard = [];

  const parts: string[] = [];
  parts.push(s.hideout_card_removed
    ? 'Safehouse burned: the Hacker gathers the Location discard pile and the remaining Location deck, adds their old safehouse card, secretly takes a different location\'s card as the new safehouse, and shuffles the rest facedown as the new Location deck.'
    : 'Safehouse burned: gather the Location discard pile and the remaining Location deck; the Hacker secretly chose a new hideout from that pile; shuffle the pile facedown as the new Location deck (no cards are added or removed).');
  if (removedTruthful.length > 0) parts.push(`Remove ALL truthful Clue tokens from the table (${removedTruthful.join(', ')}).`);
  if (removedTokens.length > 0) parts.push(`Remove ALL Negative Clue tokens (${removedTokens.join(', ')}).`);
  if (removedTruthful.length === 0 && removedTokens.length === 0) parts.push('No Clue tokens were on the table.');

  const summary = parts.join(' ');
  addLog(s, { actor: pid, category: 'burn', summary });
  return { newState: s, summary };
}

function applyBurnSafehouse(state: CNState, pid: string, newLocationName?: string): { newState: CNState; summary: string } {
  const s = clone(state);
  if (!isHacker(s, pid)) throw new GameError('ILLEGAL_MOVE', 'Only the Hacker can Burn the Safehouse');
  if (s.hacker.safehouse_burned) throw new GameError('ILLEGAL_MOVE', 'Burn the Safehouse has already been used (once per game)');
  const ap = s.players[pid]!.ap;
  if (ap < 3) throw new GameError('ILLEGAL_MOVE', `Burn the Safehouse costs 3 AP; you have ${ap}`);
  s.players[pid]!.ap -= 3;

  // A declared name completes immediately (human Hacker who already knows the pick).
  if (newLocationName && newLocationName.trim() !== '') {
    return completeBurn(s, pid, resolveLocation(newLocationName));
  }

  // Only the AI's own burn is picked engine-side. A DIGITAL human Hacker is
  // tracked too, and so is a digital human Detective, so keying this on
  // trackedness relocated a person's safehouse for them without asking — the
  // same conflation as the setup hideout. Where the Hacker hides is theirs to
  // choose, at setup and at a burn (choices.ts 'hideout', owner 'player').
  if (isAIDecider(s, pid)) {
    if (s.detective.kind === 'tracked') {
      // Both AI: the engine picks secretly (same pattern as auto-setup's hideout pick).
      const currentId = hideoutLocId(s);
      const pool = [...new Set([...s.detective.location_deck, ...s.detective.location_discard])].filter(id => id !== currentId);
      if (pool.length === 0) throw new GameError('ILLEGAL_MOVE', 'No location available to relocate to');
      const pick = pickBurnLocation(s, pool, s.rngSeed);
      s.rngSeed = pick.nextSeed;
      return completeBurn(s, pid, pick.locId);
    }
    // AI Hacker vs human Detective: the pile's contents depend on the human's
    // hand — ask for it. The physical rule already reveals the hand to the
    // Hacker by elimination (they look through the gathered pile).
    s.pending = { type: 'burn_hand_report_pending' };
    s.activePlayerId = detectiveId(s);
    addLog(s, { actor: pid, category: 'burn', summary: 'Hacker burns the safehouse — Detective must gather the Location discard pile + remaining deck and report the cards still in their hand' });
    return { newState: s, summary: 'Burn the Safehouse: Detective, gather your Location discard pile and remaining Location deck into one pile, then report which Location cards are still in your HAND.' };
  }

  // Human Hacker: choose the new location (burn_choice). A digital Hacker
  // gathers nothing — the server holds the pile and offers it back as moves.
  s.pending = { type: 'burn_choice_pending' };
  addLog(s, { actor: pid, category: 'burn', summary: 'Hacker burns the safehouse — choosing a new location from the gathered pile' });
  return {
    newState: s,
    summary: s.hacker.kind === 'tracked'
      ? 'Burn the Safehouse: choose your NEW safehouse location (a different one). The server holds the pile — nothing to gather.'
      : 'Burn the Safehouse: gather the Location discard pile and remaining Location deck, add your old safehouse card, then name your NEW safehouse location from that pile (a different location).',
  };
}

function applyBurnChoice(state: CNState, pid: string, newLocationName: string): { newState: CNState; summary: string } {
  const s = clone(state);
  if (s.pending?.type !== 'burn_choice_pending') throw new GameError('ILLEGAL_MOVE', 'No burn choice pending');
  if (!isHacker(s, pid)) throw new GameError('ILLEGAL_MOVE', 'Only the Hacker names the new safehouse');
  if (!newLocationName || newLocationName.trim() === '') {
    throw new GameError('ILLEGAL_MOVE', 'Name the new safehouse location (a card from the gathered pile)');
  }
  const result = completeBurn(s, pid, resolveLocation(newLocationName));
  result.newState.pending = null;
  result.newState.activePlayerId = hackerId(result.newState);
  return result;
}

function applyReportLocationHand(state: CNState, pid: string, locations: string[]): { newState: CNState; summary: string } {
  const s = clone(state);
  if (s.pending?.type !== 'burn_hand_report_pending') throw new GameError('ILLEGAL_MOVE', 'No hand report pending');
  if (!isDetective(s, pid)) throw new GameError('ILLEGAL_MOVE', 'Only the Detective reports their Location hand');
  const handIds = [...new Set(locations.map(resolveLocation))];
  for (const id of handIds) {
    if (s.detective.board.includes(id)) {
      throw new GameError('ILLEGAL_MOVE', `${locationName(id)} is face up on the board — it cannot be in your hand`);
    }
  }
  const currentId = hideoutLocId(s);
  const candidates = LOCATIONS.map(l => l.id).filter(id =>
    !s.detective.board.includes(id) && !handIds.includes(id) && id !== currentId);
  if (candidates.length === 0) {
    // Degenerate: nothing to relocate to — cancel, refund, keep the once-per-game use.
    s.pending = null;
    s.activePlayerId = hackerId(s);
    s.players[hackerId(s)]!.ap += 3;
    const summary = 'Burn cancelled: every other location is on the board or in your hand, so there is nothing to relocate to. The Hacker keeps the 3 AP and may still burn later. Shuffle the gathered pile back as the Location deck.';
    addLog(s, { actor: pid, category: 'burn', summary });
    return { newState: s, summary };
  }
  const pick = pickBurnLocation(s, candidates, s.rngSeed);
  s.rngSeed = pick.nextSeed;
  const result = completeBurn(s, hackerId(s), pick.locId);
  result.newState.pending = null;
  result.newState.activePlayerId = hackerId(result.newState);
  return result;
}

// ---------------------------------------------------------------------------
// Turn switching
// ---------------------------------------------------------------------------

function switchTurn(state: CNState): CNState {
  const s = clone(state);
  if (s.phase === 'game_over') return s;
  if (s.endgame_triggered && s.pending?.type === 'endgame_final_guess') return s;

  // If Detective just finished, do end-of-turn jail advance
  if (s.activePlayerId === detectiveId(s)) {
    detectiveEndTurn(s);
  }

  // Switch active player
  const idx = s.playerOrder.indexOf(s.activePlayerId);
  s.activePlayerId = s.playerOrder[(idx + 1) % 2]!;
  if (s.activePlayerId === detectiveId(s)) {
    s.turn += 1;
    // Detective start-of-turn
    s.detective.upkeep_paid = false;
    s.detective.location_played_this_turn = false;
    detectiveStartTurn(s);
    // Reset overclock_used for hacker
    s.players[hackerId(s)]!.overclock_used = false;
  } else {
    // Hacker start-of-turn: reset AP to 3
    s.players[hackerId(s)]!.ap = 3;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Main applyMove dispatch
// ---------------------------------------------------------------------------

export function applyMove(
  state: CNState,
  pid: string,
  move: CNMove,
): { newState: CNState; summary: string } {
  if (state.phase === 'game_over') throw new GameError('GAME_OVER', 'Game is over');

  // Setup phase
  if (state.phase === 'setup') {
    if (move.type === 'report_hideout') {
      return applyReportHideout(state, pid, move.location_name);
    }
    throw new GameError('ILLEGAL_MOVE', `Setup requires report_hideout, got ${move.type}`);
  }

  // Handle pending states
  if (state.pending) {
    if (state.pending.type === 'block_pending') {
      if (move.type !== 'block_decide') {
        throw new GameError('ILLEGAL_MOVE', `Block pending — expected block_decide, got ${move.type}`);
      }
      const result = applyBlockDecide(state, pid, move.block);
      // A block uses no AP, but it resolves the Hacker's declared play. If the
      // Hacker now has 0 AP and there is no further pending (e.g. clue reveal),
      // their turn ends and play passes back to the Detective.
      if (!result.newState.pending && result.newState.phase === 'play') {
        if (result.newState.players[hackerId(result.newState)]!.ap <= 0) {
          result.newState = switchTurn(result.newState);
        }
      }
      return result;
    }
    if (state.pending.type === 'clue_reveal_pending') {
      if (move.type !== 'clue_reveal') {
        throw new GameError('ILLEGAL_MOVE', `Clue reveal pending — expected clue_reveal, got ${move.type}`);
      }
      const result = applyClueReveal(state, pid, move.category, move.value);
      // A block's reveal resumes the HACKER's turn (see applyClueReveal); if
      // the blocked play consumed their last AP, the turn ends here — same
      // 0-AP rule the dispatcher applies to non-pending moves below.
      const ns = result.newState;
      if (!ns.pending && ns.phase === 'play' && ns.activePlayerId === hackerId(ns)
        && ns.players[hackerId(ns)]!.ap <= 0) {
        result.newState = switchTurn(ns);
      }
      return result;
    }
    if (state.pending.type === 'endgame_final_guess') {
      if (move.type !== 'final_guess') {
        throw new GameError('ILLEGAL_MOVE', `Endgame — Detective must final_guess, got ${move.type}`);
      }
      return applyFinalGuess(state, pid, move.location_name);
    }
    if (state.pending.type === 'board_discard_pending') {
      if (move.type !== 'board_discard_choice') {
        throw new GameError('ILLEGAL_MOVE', `Board discard pending — expected board_discard_choice, got ${move.type}`);
      }
      return applyBoardDiscardChoice(state, pid, move.target_location);
    }
    if (state.pending.type === 'reveal_informant_pending') {
      if (move.type !== 'reveal_informant') {
        throw new GameError('ILLEGAL_MOVE', `Reveal informant pending — expected reveal_informant, got ${move.type}`);
      }
      return applyRevealInformantAbility(state, pid, move.target_informant);
    }
    if (state.pending.type === 'discard_retrieval_pending') {
      if (move.type !== 'discard_retrieval_choice') {
        throw new GameError('ILLEGAL_MOVE', `Discard retrieval pending — expected discard_retrieval_choice, got ${move.type}`);
      }
      return applyDiscardRetrievalChoice(state, pid, move.target_card);
    }
    if (state.pending.type === 'informant_removal_pending') {
      if (move.type !== 'informant_removal_choice') {
        throw new GameError('ILLEGAL_MOVE', `Informant removal pending — expected informant_removal_choice, got ${move.type}`);
      }
      return applyInformantRemovalChoice(state, pid, move.target_informant);
    }
    if (state.pending.type === 'burn_choice_pending') {
      // Accept burn_safehouse-with-name too (tolerant for weak clients).
      if (move.type === 'burn_choice') return applyBurnChoice(state, pid, move.new_location_name);
      if (move.type === 'burn_safehouse') return applyBurnChoice(state, pid, move.new_location_name ?? '');
      throw new GameError('ILLEGAL_MOVE', `Burn choice pending — expected burn_choice, got ${move.type}`);
    }
    if (state.pending.type === 'burn_hand_report_pending') {
      if (move.type !== 'report_location_hand') {
        throw new GameError('ILLEGAL_MOVE', `Hand report pending — expected report_location_hand, got ${move.type}`);
      }
      return applyReportLocationHand(state, pid, move.locations);
    }
  }

  // Check active player
  if (state.activePlayerId !== pid) {
    throw new GameError('NOT_YOUR_TURN', `It is ${state.activePlayerId}'s turn`);
  }

  let result: { newState: CNState; summary: string };

  switch (move.type) {
    case 'play_location':
      result = applyPlayLocation(state, pid, move.location_name);
      break;
    case 'upkeep_choice':
      result = applyUpkeepChoice(state, pid, move.keep, move.release);
      break;
    case 'arrest':
      result = applyArrest(state, pid, move.target_person);
      break;
    case 'recruit_informant':
      result = applyRecruitInformant(state, pid, move.target_person);
      break;
    case 'draw_extra_location':
      result = applyDrawExtraLocation(state, pid);
      break;
    case 'guess_location':
      result = applyGuessLocation(state, pid, move.location_name);
      break;
    case 'buy_clue':
      result = applyBuyClue(state, pid, move.discard_locations);
      break;
    case 'draw_contact':
      result = applyDrawContact(state, pid);
      break;
    case 'play_person':
      result = applyPlayPerson(state, pid, move.person_name);
      break;
    case 'play_evidence':
      result = applyPlayEvidence(state, pid, move.person_name, move.evidence_type, move.people);
      break;
    case 'win_back':
      result = applyWinBack(state, pid, move.person_name);
      break;
    case 'jailbreak':
      result = applyJailbreak(state, pid, move.freed_person, move.negative_clue_token);
      break;
    case 'overclock':
      result = applyOverclock(state, pid);
      break;
    case 'burn_safehouse':
      result = applyBurnSafehouse(state, pid, move.new_location_name);
      break;
    case 'burn_choice':
      throw new GameError('ILLEGAL_MOVE', 'No burn choice pending');
    case 'report_location_hand':
      throw new GameError('ILLEGAL_MOVE', 'No hand report pending');
    case 'informant_removal_choice':
      throw new GameError('ILLEGAL_MOVE', 'No informant_removal pending');
    case 'clue_reveal':
      result = applyClueReveal(state, pid, move.category, move.value);
      break;
    case 'reveal_informant':
      // Only legal while a Corp 1 reveal_informant_pending is active (handled above)
      throw new GameError('ILLEGAL_MOVE', 'No reveal_informant pending');
    case 'pass_turn':
      // Switch turn
      result = { newState: switchTurn(state), summary: 'Passed' };
      return result;
    case 'final_guess':
      result = applyFinalGuess(state, pid, move.location_name);
      break;
    case 'report_hideout':
      throw new GameError('ILLEGAL_MOVE', 'Hideout already chosen');
    case 'block_decide':
      throw new GameError('ILLEGAL_MOVE', 'No block pending');
    case 'board_discard_choice':
      throw new GameError('ILLEGAL_MOVE', 'No board_discard pending');
    case 'discard_retrieval_choice':
      throw new GameError('ILLEGAL_MOVE', 'No discard_retrieval pending');
    default:
      throw new GameError('ILLEGAL_MOVE', `Unknown move type: ${(move as { type: string }).type}`);
  }

  // After non-pending moves, check for endgame
  if (result.newState.phase === 'game_over') return result;

  // If the result didn't set a pending state, and the player has 0 AP, switch turn.
  // EXCEPT after a burn: burning costs all 3 AP by definition, but free plays
  // (Evidence, jailbreak) remain legal at 0 AP, and the human path — burn →
  // burn_choice pending — already keeps the turn (the 2026-08-19 playtest's
  // burn-then-Weapon finish rode exactly that). The direct-completion burn
  // paths (all-AI, and a human declaring the new location inline) must behave
  // the same, or the two seats play different rules.
  const s = result.newState;
  if (!s.pending && s.phase === 'play' && move.type !== 'burn_safehouse') {
    if (s.players[pid]!.ap <= 0) {
      result.newState = switchTurn(s);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Game over check
// ---------------------------------------------------------------------------

export function isGameOver(state: CNState): { game_over: boolean; winners: string[]; scores: Record<string, number>; summary: string } {
  if (state.phase !== 'game_over') {
    return { game_over: false, winners: [], scores: {}, summary: '' };
  }
  return {
    game_over: true,
    winners: state.winners,
    scores: {},
    summary: state.resultSummary,
  };
}