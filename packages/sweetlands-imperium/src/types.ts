// Sweetlands Imperium — state & move types.
//
// ============================================================================
// PHYSICAL-FIRST STATE CATEGORIZATION (required by CLAUDE.md — read first)
// ============================================================================
// The human plays with a PHYSICAL copy; the server is bookkeeper for shared
// state and brain for AI opponents. Every zone categorized by (a) source of
// truth and (b) who can see it.
//
//   PUBLIC / SHARED — source: SERVER · visible: BOTH
//     - Board: every unit's location (Leader/Knight/Ambassador per player),
//       on ring / road / castle / start tile / treat side-node.
//     - Per region: tax level (0..3).
//     - Castle: which single foe is in play + whether it's been defeated;
//       current castle occupant (a Leader), and "uncontested since" bookkeeping.
//     - Random treat placement (which random treat tile sits in which `?` slot).
//     - Per player (all public): influence (0..5), sugar cubes, owned Intel
//       tokens (<=1 of each color), points, which PUBLIC objectives they've scored.
//     - First player, round number, turn order.
//
//   SERVER-DEALT, SHARED, HIDDEN — source: SERVER · visible: nobody (order)
//     - The single 80-card Intel DECK. Server owns the shuffled order. Drawing
//       is hidden/random. Report-draw pattern (src/core/reportHand.ts): a HUMAN
//       draws physical cards and REPORTS them; the server removes them from its
//       model and deals the AI from the remainder. Discard pile is public count,
//       hidden contents (cards return face-down) — track as needed.
//
//   SERVER-TRACKED, AI-PRIVATE — source: SERVER · visible: that AI's brain
//     - Each AI player's Intel HAND (dealt from the deck remainder), and that
//       AI's chosen SECRET objective(s). Never revealed to the human except as
//       the public *effects* of plays.
//
//   SERVER-DEALT, HUMAN-PRIVATE — source: SERVER (modeled) · visible: that human
//     - Each human player's Intel HAND. The human holds the physical cards; the
//       server tracks them (via report-draw) to validate plays, and filters
//       responses so opponents never see hand contents.
//     - Each human's chosen SECRET objective(s): the human holds the card; the
//       server tracks the id for scoring but never reveals it to opponents. The
//       human DECLARES completion (server validates against public state where it
//       can; some secret objectives are self-attested — documented per objective).
//
// NOTE: there are NO opaque/human-shuffled zones — the Intel deck is shared and
// server-owned, so even the human's hand is server-tracked (server-dealt human-
// private), not the opaque category used by per-player-deck games.
// ============================================================================

import type { SpaceColor, RegionId, TreatId } from './data/board.js';

export type { SpaceColor, RegionId, TreatId } from './data/board.js';

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

export type FactionId =
  | 'milkshake' | 'fudge' | 'jellybean' | 'cheesecake' | 'nomads';

export interface FactionDef {
  id: FactionId;
  /** Display name printed on the faction board. */
  name: string;
  /** Region this faction holds; null for the region-less Nomads. */
  homeRegion: RegionId | null;
  /** Player color from the rulebook. */
  color: string;
  ability: string;
}

// ---------------------------------------------------------------------------
// Units & locations
// ---------------------------------------------------------------------------

export type UnitType = 'leader' | 'knight' | 'ambassador';

/** Where a unit physically sits. Movement resolves by jumping to the next
 *  matching-color space along the ordered ring/road; these locations carry the
 *  exact node so distance and adjacency are unambiguous. */
export type UnitLocation =
  // Off the board entirely — the Nomads' units begin here and choose an entry
  // region the first time they move (and return here on Recall).
  | { zone: 'offboard' }
  | { zone: 'start'; region: RegionId }
  | { zone: 'ring'; region: RegionId; ringIndex: number } // 0..11
  | { zone: 'road'; region: RegionId; roadIndex: number } // 0..5 (5 = castle entrance)
  // A treat side-node, identified by the physical SLOT it sits in (region +
  // whether it's the regional or random slot). The treat TILE on that slot is
  // derived from state (regional = the region's faction treat; random = the
  // setup placement). Reached only via treat Intel cards, not color moves.
  | { zone: 'treat'; region: RegionId; slotKind: 'regional' | 'random' }
  | { zone: 'castle' };

// ---------------------------------------------------------------------------
// Intel cards (the shared deck)
// ---------------------------------------------------------------------------

export type IntelCard =
  | { cardId: string; kind: 'single'; color: SpaceColor }
  // A double card is a SINGLE color played twice (move+action, then move+action).
  | { cardId: string; kind: 'double'; color: SpaceColor }
  | { cardId: string; kind: 'treat'; treat: TreatId };

// ---------------------------------------------------------------------------
// Foes & objectives
// ---------------------------------------------------------------------------

export type FoeType = 'dragon' | 'orc' | 'fiend';
/** Battle dice each foe rolls. */
export const FOE_DICE: Record<FoeType, number> = { dragon: 5, orc: 3, fiend: 2 };

export type PublicObjectiveId =
  | 'units_all_matching_color'   // unit in each opposing region, all on matching-color spaces (3)
  | 'units_all_treats'           // unit in each opposing region, all on treat spaces (3)
  | 'defeat_foe'                 // defeat the castle foe (3)
  | 'capture_leader'             // capture a leader (1)
  | 'leader_castle_uncontested'; // leader in castle, uncontested for 1 round (1)

export type SecretObjectiveId =
  | 'defeat_knight' | 'capture_leader' | 'capture_ambassador' | 'raise_taxes_3'
  | 'spend_5_influence' | 'discard_5_intel' | 'gain_5_intel_one_turn'
  | 'collect_taxes_from_opponent' | 'collect_5_influence_one_turn'
  | 'unit_through_3_regions' | 'discard_5_sugar' | 'enter_castle_with_leader';

// ---------------------------------------------------------------------------
// Per-player state
// ---------------------------------------------------------------------------

/** Per-turn bookkeeping, reset at the start of each turn. Drives the turn step
 *  machine and the "in one turn" secret objectives. */
export interface PlayerTurnFlags {
  step: 'recall' | 'play' | 'influence';
  /** Set by a Green discard — lets the player keep playing Intel this turn. */
  unlimitedPlays: boolean;
  intelGainedThisTurn: number;
  influenceGainedThisTurn: number;
  influenceSpentThisTurn: number;
  intelDiscardedThisTurn: number;
  sugarDiscardedThisTurn: number;
  /** Distinct regions each unit has passed through THIS turn (cumulative across all
   *  its moves) — for the "move one unit through 3 regions in one turn" objective.
   *  Plain arrays (not Sets) so the state JSON-serializes in the stores. */
  unitRegionsVisited: Partial<Record<UnitType, RegionId[]>>;
  /** Whether this player has already made a trade this turn (AI self-limit). */
  tradedThisTurn: boolean;
}

export interface PlayerState {
  playerId: string;
  kind: 'human' | 'ai';
  /** Server holds this seat's hidden state (docs/digital-mode.md). Always true
   *  for AI seats; true for a human seat configured `table: 'digital'`.
   *  Additive/optional: sessions persisted before digital mode tolerate its
   *  absence (treat as kind-derived legacy default). */
  digital?: boolean;
  faction: FactionId;
  homeRegion: RegionId | null; // null for Nomads
  units: Record<UnitType, UnitLocation>;
  influence: number; // 0..5
  sugarCubes: number;
  /** Owned Intel tokens — at most one of each color. */
  intelTokens: Partial<Record<SpaceColor, true>>;
  points: number;
  /** Server-tracked hand. For humans this is server-dealt-human-private (filtered
   *  from opponents); for AI it is server-tracked-AI-private. */
  hand: IntelCard[];
  /** Chosen secret objective ids (hidden from opponents). */
  secretObjectives: SecretObjectiveId[];
  /** Secret objectives already scored (so they only score once). */
  secretObjectivesScored?: SecretObjectiveId[];
  /** Public objectives this player has already scored (one-time each). */
  publicObjectivesScored: PublicObjectiveId[];
  turn: PlayerTurnFlags;
  /** Cumulative achievement tracking for objective scoring. */
  progress: PlayerProgress;
}

/** Cumulative, game-long counters/flags used to score secret & public objectives. */
export interface PlayerProgress {
  capturedLeader: boolean;
  capturedAmbassador: boolean;
  defeatedKnight: boolean;
  collectedTaxFromOpponent: boolean;
  enteredCastleWithLeader: boolean;
  raisedTaxToThree: boolean;
  intelDiscardedTotal: number;
  sugarDiscardedTotal: number;
  /** Influence voluntarily TRASHED (the trash_influence action) — NOT influence
   *  spent on buys/taxes. Only this counts toward the "spend 5 influence" objective. */
  influenceTrashedTotal: number;
}

// ---------------------------------------------------------------------------
// Phases & pending
// ---------------------------------------------------------------------------

export type Phase =
  | 'setup_factions'   // human-owned faction picks (setupChoices)
  | 'setup_foe'        // choose the single foe
  | 'setup_secrets'    // deal/keep/pass secret objectives
  | 'setup_intel'      // initial 3-card draws
  | 'play'             // normal round play
  | 'scoring'          // end-of-round objective scoring
  | 'game_over';

/** Mid-action pendings — every path that sets one MUST also clear it (CLAUDE.md
 *  pending hygiene). The only pending is a HUMAN owing a report of Intel they
 *  physically drew from the shared deck (turn-start gain or a Blue collect); the
 *  server reconciles the report against its tracked deck remainder. AI draws are
 *  dealt directly and never set a pending. */
export type Pending =
  | { kind: 'report_intel'; forPlayerId: string; count: number; reason: 'gain' | 'collect' }
  | null;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

/** Setup-phase scratch state (deal/keep/pass of secret objectives). */
export interface SetupState {
  /** The 2 objectives dealt to each eligible player. */
  secretDeal: Record<string, SecretObjectiveId[]>;
  /** Objectives passed to each player by their left neighbor. */
  secretReceived: Record<string, SecretObjectiveId[]>;
  /** Players (in turn order) still owing a keep-one pick. */
  awaitingSecretFrom: string[];
}

export interface SweetlandsState {
  phase: Phase;
  round: number;
  players: PlayerState[];
  firstPlayerIndex: number;
  currentPlayerIndex: number;
  /** Advancing RNG seed (server-owned). */
  seed: number;
  /** Server-owned shuffled deck order (hidden). */
  intelDeck: IntelCard[];
  intelDiscard: IntelCard[];
  taxes: Record<RegionId, number>; // 0..3 each
  /** The single foe chosen for this game; null until setup_foe resolves. */
  foe: { type: FoeType; defeated: boolean } | null;
  /** Player whose leader currently holds the castle UNCONTESTED (leader in the
   *  castle node, foe defeated, no other player's unit there). Maintained
   *  exclusively by engine.ts syncCastleClaim after every move — null the
   *  moment the leader leaves or another player's unit intrudes. */
  castleOccupantId: string | null;
  /** Round index when the current uncontested claim began (for the
   *  "uncontested for 1 round" objective). Cleared with castleOccupantId. */
  castleHeldSinceRound: number | null;
  /** Which random treat tile sits in each region's `?` slot. */
  randomTreatPlacement: Partial<Record<RegionId, TreatId>>;
  setup: SetupState;
  pending: Pending;
  /** Mirror of the player the engine currently expects to act. */
  activePlayerId: string;
  /** The most recent battle's dice, rolled in the open, for the table to show.
   *  Additive: absent on sessions saved before it existed and before any battle. */
  lastBattle?: LastBattle;
}

/** One battle's dice: each side's sugar-cube faces and total. */
export interface LastBattle {
  /** Counts up with each battle this game, so a client can tell a new one. */
  id: number;
  round: number;
  kind: 'knight' | 'foe';
  attacker: { playerId: string; faces: number[] | null; total: number };
  /** The defending knight's owner, or the foe. */
  defender: { playerId: string | null; foe: FoeType | null; faces: number[]; total: number };
  winner: 'attacker' | 'defender';
  /** Jellybean's knight wins a knight battle without rolling. */
  automatic?: boolean;
}

// ---------------------------------------------------------------------------
// Moves (first cut — grows as actions are implemented)
// ---------------------------------------------------------------------------

/** Shared parameters for resolving a colored play (a hand card OR an Intel token):
 *  which unit moves, whether to take the color's action, and the action's targets. */
export interface ColorPlayParams {
  unit: UnitType;
  takeAction: boolean;
  viaRoad?: boolean;
  entryRegion?: RegionId;
  targetPlayerId?: string;
  targetUnit?: UnitType;
  raiseTaxes?: boolean;
  battleTotal?: number;
}

export type SweetlandsMove =
  // setup
  | { type: 'assign_setup_choices'; selections: Record<string, FactionId> }
  | { type: 'choose_foe'; foe: FoeType }
  | { type: 'choose_secret_objective'; objective: SecretObjectiveId }
  | { type: 'report_intel_draw'; cards: Array<{ kind: IntelCard['kind']; color?: SpaceColor; colors?: [SpaceColor, SpaceColor]; treat?: TreatId }> }
  // digital-mode randomness button (docs/digital-mode.md): the player presses
  // "Draw"/"Roll", and the SERVER fills in the actual cards/dice from its
  // tracked hidden state via autoResolveReport and applies them as the report
  // that was pending. Only legal when the seat owes a report pending; never
  // silently resolved. No payload — the button IS the move.
  | { type: 'resolve_report' }
  // turn
  | { type: 'recall'; units: UnitType[] }
  | { type: 'pass' } // gain +1 influence
  | {
      type: 'play_intel';
      cardId: string;
      unit: UnitType; // which of your units to move
      takeAction: boolean; // resolve the card-color's action after moving
      viaRoad?: boolean; // at a junction, branch onto the road
      entryRegion?: RegionId; // Nomads: region to enter when moving an off-board unit
      // action params (used when takeAction resolves the relevant color)
      targetPlayerId?: string; // Red capture/battle target
      targetUnit?: UnitType; // Red capture target unit
      raiseTaxes?: boolean; // Yellow: raise your region's tax after collecting
      // treat-card destination (slot identified by region + kind)
      treatRegion?: RegionId;
      treatSlot?: 'regional' | 'random';
      // Red attack on the castle foe: the active human physically rolls their
      // sugar cubes and declares the total here. The server rolls the foe dice.
      battleTotal?: number;
    }
  // Play an owned Intel TOKEN as a one-time card of its color (move + optional
  // action), then the token returns to the supply.
  | ({ type: 'play_token'; color: SpaceColor; battleTotal?: number } & ColorPlayParams)
  | { type: 'discard_for_color'; cardIds: string[]; color: SpaceColor }
  | { type: 'discard_sugar'; count: number }
  | { type: 'trash_influence'; count: number }
  | { type: 'buy_intel_token'; color: SpaceColor }
  | { type: 'buy_sugar_cube' }
  // Any-time table-agreed transfer (physical-first: the server trusts that both
  // players agreed at the table and just records it). One counterparty.
  | {
      type: 'trade';
      withPlayerId: string;
      giveInfluence?: number; giveSugar?: number; giveIntelCardIds?: string[]; giveTokens?: SpaceColor[];
      receiveInfluence?: number; receiveSugar?: number; receiveIntelCardIds?: string[]; receiveTokens?: SpaceColor[];
      swapUnits?: Array<{ mine: UnitType; theirs: UnitType }>;
    }
  | { type: 'end_turn' };
