export type Phase = 'technique' | 'channel' | 'game_over';

// Fractured Fist splits per-player state by who knows what.
//   - tracked: the server fully models this player's deck/hand/discard
//     (used for AI players, where the deck must be shuffled secretly and
//     the AI brain needs to reason over its hand).
//   - opaque: the server only tracks counts + the set of cards that COULD
//     be in the player's hand. Contents live on the physical table with
//     the human player.
export type PlayerKind = 'tracked' | 'opaque';

// Shared between both kinds — visible to both players in a physical game.
interface PublicCounters {
  played: string[];        // face-up cards this turn; flushed at strike resolution
  stamina: number;
  maxStamina: number;
  actions: number;
  channels: number;
  spirit: number;
  refinePending: number;
  damageQueued: number;
  defenseQueued: number;
  // Card-count bookkeeping (always populated; for tracked players these mirror the contents arrays).
  deckSize: number;
  handSize: number;
  discardSize: number;
  // Missteps currently in this player's deck+hand+discard combined.
  // For tracked players this is derivable from the arrays; for opaque
  // players the server tracks it via declarations (refine_card with was_misstep).
  misstepCount: number;
  // Starting hand draw size (rule constant per player; could vary by species/options).
  startingHandSize: number;
  // Focus reloads used in the CURRENT turn (rule: max FOCUS_RELOADS_PER_TURN).
  // Reset to 0 at the start of each turn. Optional so sessions persisted before
  // this field existed deserialize cleanly — reading code defaults it to 0.
  focusReloadsThisTurn?: number;
  // Per-player supply: each player has their own 5 copies of each technique in
  // the loadout + their own pool of resources. Per Fractured Fist rules, supplies
  // are NOT shared — when player A buys an Attack, only their own Attack count
  // decreases; player B still has their full 5.
  supply: Record<string, number>;
}

export interface TrackedPlayerState extends PublicCounters {
  kind: 'tracked';
  deck: string[];
  hand: string[];
  discard: string[];
}

export interface OpaquePlayerState extends PublicCounters {
  kind: 'opaque';
  // The server intentionally tracks no card contents for opaque players — the
  // human is the source of truth for what's in their hand/deck/discard. Move
  // validation only checks that the named card exists in the game's pool
  // (state.supply + resources + 'misstep'); the server trusts the player's
  // declaration about which card they actually played from hand.
}

export type PlayerState = TrackedPlayerState | OpaquePlayerState;

export interface FFState {
  phase: Phase;
  activePlayerId: string;
  playerOrder: string[];
  players: Record<string, PlayerState>;
  // Supplies live on each player (see PublicCounters.supply). No shared pool.
  round: number;
  rngSeed: number;
  playersDoneThisRound: string[];
  // populated when phase === 'game_over'
  winners?: string[];
  scores?: Record<string, number>;
  resultSummary?: string;
}

export interface FFOptions {
  seed?: number;
  loadout?: string[];
  startingStamina?: number;
  handSize?: number;
}

// One move shape, used by both kinds. Some fields are only meaningful for
// tracked players (hand_index), others only for opaque (was_misstep, count).
export type FFMove =
  | { type: 'play_card'; card_id: string; hand_index?: number }
  | { type: 'buy_card'; card_id: string }
  | { type: 'refine_card'; hand_index?: number; card_id?: string; was_misstep?: boolean }
  | { type: 'skip_refine' }
  | { type: 'advance_phase' }
  | { type: 'end_turn' }
  | { type: 'focus_reload'; count?: number };
