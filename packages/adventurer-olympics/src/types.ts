// Adventurer Olympics — types & state categorization.
//
// STATE CATEGORIZATION (per CLAUDE.md "Physical-first design"):
//
// PUBLIC / SHARED (every seat sees equally — everything is face up on the table):
//   - the map: placed tiles, their hex positions, every icon hex and its
//     completed flag, every player's standee + token positions
//   - in-play quests (face up) and the quest box remainder (a known count)
//   - companion / monster cards each player holds (face up in front of them)
//   - the artifact supply (face up) and the artifacts each player holds
//   - initiative tokens 1–4 + the round/turn order
//   - per-seat remaining steps this turn
//
// THE DECKS AND THE TILE STACK — ONE CANONICAL ORDER PER DECK (RULES.md §12:
// "Every deck is shared and drawn face down"). There is ONE physical Companion
// deck on the table, not one per seat, so the server models ONE stack per deck
// — never per-seat copies (the pre-fix `deckOrders[seat]` aliased one object
// across seats; a save/reload snapped the alias into independent copies and
// draws stopped being shared). Whether the server's stored ORDER is real
// depends on who draws:
//   - ALL seats digital/AI: the server shuffles once at creation (seeded) and
//     the order drives every draw. A digital human reveals their draw with the
//     no-payload `resolve_report` button (never a silent deal); AI seats are
//     dealt by the server outright.
//   - ANY physical human seat: the table shuffles and owns the real order, so
//     the server treats the order as opaque — every human draw is reported
//     (`report_card` / the tile id in `explore`), validated against
//     conservation (a reported card must not already be held/placed), and the
//     deck count decremented. This holds for the WHOLE table: an AI seat's
//     draw is also made from the real deck, by a physical human who reports it
//     for the AI (`report_card` pending owned by the human, `forSeat` = the
//     AI), and a digital human's draw likewise. The server's order at such a
//     table is a bookkeeping remainder, never a source of draws.
//
// No secret hand exists in this game — every card drawn is resolved face up at
// once and kept face up — so there is no private-hand category at all.
//
// AI-PRIVATE: an AI seat's intentions (path, explore timing, artifact picks) —
// computed by the AI brain, never surfaced to humans.
//
// JSON-SAFE: every field below is plain JSON — no `Set`, no aliased object
// shared across keys (both break on a save/close/reopen; see the review's
// sqlite-resume probe). `hexes` is a key->true map, decks are string arrays.

import type {
  ArtifactId,
  DungeonCardKind,
  IconKind,
  StatKey,
} from './data.js';

// ---------------------------------------------------------------------------
// Map geometry (pointy-top axial hexes; centres run at half-integer coords)
// ---------------------------------------------------------------------------

/** Axial hex coordinate; `key` is the canonical string ("1,0" for unit hexes,
 *  "1.5,0.5" for half-integer tile-centre coordinates). */
export interface Hex {
  q: number;
  r: number;
  key: string;
}

/** A tile's placement on the map: its centre hex + rotation. */
export interface PlacedTile {
  tileId: number;          // printed tile number 1..10
  center: Hex;
  rotation: number;        // 0..5 (six orientations)
  isStarting: boolean;
  /** Which player explored / placed it (centre-hex token). null = starting. */
  exploredBy: string | null;
}

/** An icon hex on the map: absolute position + kind + completion. */
export interface IconHex {
  key: string;             // absolute unit-grid hex key
  tileId: number;          // printed tile it was printed on
  localHex: string;        // 'N' | 'NE' | ... on that tile (for display)
  kind: IconKind | ArtifactId;
  completed: boolean;
  completedBy: string | null;
}

// ---------------------------------------------------------------------------
// Per-seat state
// ---------------------------------------------------------------------------

export interface PlayerState {
  player_id: string;
  name: string;
  kind: 'human' | 'ai';
  table?: 'physical' | 'digital';
  standee: string;
  colour: string;
  /** Companion card ids held (face up in front of them). */
  companions: string[];
  /** Monster card ids defeated (face up in front of them). */
  littleMonsters: string[];
  bigMonsters: string[];
  /** Artifact ids held. */
  artifacts: ArtifactId[];
  /** Quest point total. */
  questPoints: number;
  /** Quest kinds claimed (instant-claim quests). */
  claimedQuests: string[];
  /** Tiles explored (centre-hex tokens) — feeds "Explore 3 tiles". */
  exploredTileIds: number[];
  /** Dungeon hexes completed — feeds "Most dungeons". */
  dungeonsCompleted: number;
  /** Player tokens spent (one per icon completed + one per tile explored). */
  tokensSpent: number;
  /** Remaining steps this turn. */
  stepsLeft: number;
  /** Current absolute hex key (standee position). */
  hexKey: string;
  /** Turn-order rank this round (1 = first). 0 = not yet assigned. */
  initiative: number;
}

// ---------------------------------------------------------------------------
// The shared decks — ONE canonical order per deck
// ---------------------------------------------------------------------------

/** The seven shared decks' canonical orders (top → bottom). At a table with a
 *  physical human the orders are a bookkeeping remainder (the table shuffles);
 *  with every seat digital they are the real seeded shuffle. Counts are always
 *  real: a draw pops one; a fail pushes the card back to the bottom. */
export interface Decks {
  companion: string[];        // companion card ids
  little: string[];           // little monster card ids
  big: string[];              // big monster card ids
  dungeon: DungeonCardKind[]; // dungeon card kinds
}

// ---------------------------------------------------------------------------
// Pending (a human-owed decision the engine is waiting on)
// ---------------------------------------------------------------------------

export type PendingKind =
  | 'setup_standee_colour'      // pick standee + colour (setup identity)
  | 'setup_explore_report'      // physical setup: report the drawn quests + starting tile
  | 'roll'                      // report a roll (see RollKind)
  | 'move'                      // declare the move (path / stop)
  | 'try_again'                 // stay on a failed icon and re-trigger
  | 'explore_place'             // the tile is revealed/reported; choose slot + rotation
  | 'take_artifact'             // "Any artifact": which + from whom, or decline
  | 'report_card'               // physical seat reports a card/tile it drew
  | 'draw'                      // digital human presses Draw (resolve_report): the server deals the top card/tile
  ;

export type RollKind = 'turn_order' | 'test';

export interface Pending {
  kind: PendingKind;
  seat: string;              // player_id who owns this pending
  /** Kind-specific payload. */
  payload?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The full game state
// ---------------------------------------------------------------------------

export interface AOState {
  // players, keyed by player_id
  players: Record<string, PlayerState>;
  playerOrder: string[];     // seat order for the round

  // the map
  placedTiles: PlacedTile[];
  iconHexes: IconHex[];
  /** Every unit hex key on the map (for adjacency / pathing). JSON-safe map. */
  hexes: Record<string, true>;

  // the shared decks: ONE canonical order per deck (see file-top categorization)
  decks: Decks;
  /** The shared map-tile stack (one, canonical). */
  tileStack: number[];
  /** True iff every seat is digital/AI — i.e. the server owns the real deck
   *  order. With a physical human at the table this is false and the orders
   *  are a bookkeeping remainder (counts real, order nominal). */
  serverOwnsDecks: boolean;

  // in-play quests (face up): kind -> claimed by, or 'unclaimed'
  inPlayQuests: Record<string, string | 'unclaimed'>;
  questBoxRemaining: number;

  // round / turn
  round: number;
  activeSeat: string;
  /** Which phase of the ending we are in (RULES.md §9):
   *  0 = ongoing; 1 = last tile placed, finish the current round;
   *  2 = playing the one extra full round; when it completes the game is over. */
  endingPhase: 0 | 1 | 2;
  /** True once the extra round has completed and end-of-game quests are scored.
   *  This is the ONLY terminal flag; `isGameOver` keys on it. */
  gameOver: boolean;

  // turn-order roll bookkeeping (RULES.md §4.1)
  /** Seats that still owe a turn-order roll in the current roll phase. */
  drawStack: string[];
  /** This round's base roll totals per seat (rank bands are derived from these). */
  baseTotals: Record<string, number>;
  /** Re-roll totals for the currently unresolved tied band. */
  groupTotals: Record<string, number>;
  /** The tied band currently re-rolling (seats), or null between phases. */
  tieBand: string[] | null;
  /** This roll phase's places, highest first, as an ordered list of groups: a
   *  group of one is settled, a larger group is still tied. Optional so rows
   *  saved before it existed still load (rebuilt from `baseTotals`). */
  rankGroups?: string[][];
  /** The current round's final ranks (seat -> rank) once settled. */
  turnOrder: Record<string, number>;

  // the one open human-owed decision
  pending: Pending | null;

  // the resolving Dungeon card, if any (kind + which icon hex it came from)
  dungeonResolving: { iconKey: string; kind: DungeonCardKind; fromBottom?: boolean } | null;

  /** Tables with real cards only: the run of cards known to sit at the BOTTOM
   *  of each deck, top of the run first — every card put under a deck since the
   *  start, in order. The rest of the deck (its cards minus this run) is in an
   *  order nobody knows. So the next card drawn must be one of those unknown
   *  cards while any remain, and after that it must be the first card of this
   *  run. Lets the server reject a report of a card that cannot be on top.
   *  Optional so rows saved before it existed still load (read as empty). */
  knownBottom?: { companion: string[]; little: string[]; big: string[]; dungeon: DungeonCardKind[] };

  // log (rich)
  log: GameLogEntryLocal[];

  /** The most recent roll, so a screen can show the dice themselves: whose,
   *  which roll, each die (null when a player reported only a total), the
   *  total, and the seq of the first log line the roll wrote. Optional so rows
   *  saved before it existed still load. */
  lastRoll?: { seat: string; kind: 'turn_order' | 'test'; dice: number[] | null; total: number; logSeq: number } | null;

  // seeded rng state (deterministic per session)
  rngSeed: number;
  rngState: number;
}

// A local log entry shape (matches core GameLogEntry but is authored here).
export interface GameLogEntryLocal {
  seq: number;
  turn: number;
  phase?: string;
  playerId?: string | null;
  summary: string;
  deltas?: Record<string, number>;
  /** True on the lines that change the table at a glance (engine.ts
   *  `headline`). Optional: rows saved before it existed still load. */
  headline?: boolean;
}

export type AOStatKey = StatKey;
