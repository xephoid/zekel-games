// Cybernoir 2127 — A 2-player hidden-movement deduction game.
//
// ZONE CATEGORIZATION (physical-first, per AGENTS.md):
//
// | Zone                          | Category                    | Owner     |
// |-------------------------------|------------------------------|-----------|
// | Hacker's hideout              | tracked AI-private / opaque  | Hacker    |
// | Hacker's Contacts deck        | tracked AI-private / opaque  | Hacker    |
// | Hacker's hand                 | tracked AI-private / opaque  | Hacker    |
// | Hacker's discard pile          | Public/shared               | —         |
// | Hacker's Evidence zone         | Public/shared               | —         |
// | Detective's Location deck      | tracked AI-private / opaque | Detective  |
// | Detective's Location hand      | tracked AI-private / opaque | Detective  |
// | Detective's POI deck          | tracked AI-private / opaque | Detective  |
// | Face-up board Locations        | Public/shared               | —         |
// | Informants (facedown)          | tracked AI-private / opaque | Detective  |
// | Informants (revealed)          | Public/shared               | —         |
// | Jail track                     | Public/shared               | —         |
// | Clue tokens (truthful)         | Public/shared               | —         |
// | Clue tokens (negative)          | Public/shared               | —         |
// | Weapon card (in Contacts)      | tracked AI-private / opaque | Hacker    |
// | Safehouse card (v1.7)          | held by the Hacker           | Hacker    |
// | Location discard pile          | Public/shared               | —         |
//
// Human hands are NEVER server-dealt (reviewer ruling). Humans physically own
// and shuffle their own Contacts/Location/POI decks. The server validates named
// moves only. POI deck is not shuffled (reviewer ruling).
// Negative Clues are Jailbreak-only; never substitute for truthful clues.
//
// RULES v1.7 (Burn the Safehouse, 2026-08-11): the Hacker now physically TAKES
// their hideout's Location card out of the Location deck at setup (deck = 17),
// and may once per game spend 3 AP to relocate (burn_safehouse below).
// Two consequences for the seat matrix:
// - The server now STORES an opaque (human) Hacker's hideout. This relaxes the
//   original "server never knows" ruling — required so the server can remove
//   the safehouse card from a tracked (AI) Detective's Location deck and
//   rebuild that deck on a burn. Views still never expose the hideout to the
//   Detective seat; validating the human's clue declarations is a side benefit.
// - AI Hacker vs human Detective is a DOCUMENTED DIVERGENCE: the human cannot
//   blindly remove the AI's secret card from their physical deck, so in that
//   seating the safehouse card stays in circulation (v1.6 behavior;
//   `hideout_card_removed = false`) and a burn swaps no physical cards.

export type PlayerKind = 'tracked' | 'opaque';

export type AffiliationId = 'none' | 'corp_1' | 'corp_2' | 'gang_1' | 'gang_2' | 'gang_3';
export type BoroughId = 'downtown' | 'the_hive' | 'boonies';
export type ClueCategory = 'borough' | 'population' | 'affiliation';

export interface Person {
  id: string;
  name: string;
  affiliation: AffiliationId;
  home_location: string;
  cost: number;
  ability: string;
  is_witness: boolean;
}

export interface LocationData {
  id: string;
  name: string;
  borough: BoroughId;
  population: number;
  residents: string[];
  affiliation: AffiliationId;
}

export interface Hideout {
  borough: BoroughId;
  population: number;
  affiliation: AffiliationId;
}

export interface Informant {
  person_id: string;
  revealed: boolean;
}

// v2.3 jail rework (designer ruling 2026-08-14): each slot holds a STACK of
// POI cards — arrests never shift the track (the old single-occupancy model
// shifted everyone forward on each arrest, desyncing the physical sheet and
// bump-releasing prisoners early). Slots are named to match the printed
// sheet: 1 Booked, 2 Processing, 3 Release Pending.
export type JailSlot = string[];

// v1.9 (2026-08-12): a Motive set is 3 unique people from 3 DIFFERENT
// affiliations (any affiliations — witnesses/'none' and gang_1 eligible; the
// combination may repeat across sets, at most ONE gang affiliation per set),
// and there are THREE sets. No ordering gate. Evidence total: weapon +
// 3 witnesses + 9 motive = 13. (Dial history: 3 sets uncapped = Hacker 62%;
// 4 sets capped = Detective 85%; 3 sets + gang cap is the measured middle.)
// motive_set_4 is retained for state compatibility but unused since the
// 4-set experiment; motive_set_3/4 default on clone().
export interface Evidence {
  weapon: boolean;
  witnesses: string[];
  motive_set_1: string[];
  motive_set_2: string[];
  motive_set_3: string[];
  motive_set_4: string[];
}

export interface TruthfulClues {
  borough: boolean;
  population: boolean;
  affiliation: boolean;
}

// The revealed VALUES of truthful clues (public physical facts — the tokens are
// face-up on the table). A field is set iff the matching TruthfulClues flag is
// true. Required by the AI's candidate-elimination model and the public view.
export interface TruthfulClueValues {
  borough?: BoroughId;
  population?: number;
  affiliation?: AffiliationId;
}

export type ClueTokenId = string;

export interface PlayerStateShared {
  kind: PlayerKind;
  ap: number;
  hand_size: number;
  overclock_used: boolean;
}

export interface TrackedPlayerState extends PlayerStateShared {
  kind: 'tracked';
  hand: string[];
  deck: string[];
  discard: string[];
}

export interface OpaquePlayerState extends PlayerStateShared {
  kind: 'opaque';
}

export type PlayerState = TrackedPlayerState | OpaquePlayerState;

export interface DetectiveState {
  kind: PlayerKind;
  location_deck: string[];
  location_hand: string[];
  /** Location discard pile (buy_clue, Gang 1 hand_discard, Gang 2/3 board_discard).
   *  Additive v1.7 field (tolerate absence — clone() defaults it). For an opaque
   *  Detective it holds only the discards the server saw named (buy_clue and
   *  board_discard); a Gang 1 random discard from a physical hand is unknowable. */
  location_discard: string[];
  /** v2.0: every Location card the (tracked) Detective has personally seen —
   *  survives Anansi's discard-reshuffle (seen cards stay eliminated: the
   *  hideout card never re-enters the deck) but RESETS to the current hand on
   *  a Burn (the new hideout may be a previously-seen card). Additive. */
  seen_locations: string[];
  board: string[];
  poi_deck: string[];
  informants: Informant[];
  jail: JailSlot[];
  mid_game_guess_spent: boolean;
  upkeep_paid: boolean;
  location_played_this_turn: boolean;
}

export interface HackerState {
  kind: PlayerKind;
  contacts_deck: string[];
  contacts_discard: string[];
  evidence: Evidence;
  truthful_clues: TruthfulClues;
  truthful_values: TruthfulClueValues;
  negative_clues: string[];
  hideout: Hideout | null;
  /** v2.0: the hideout's LOCATION ID — required since Little Ghana twins
   *  Trailer Towers (attributes no longer unique). Additive; old sessions
   *  fall back to attribute lookup (unique in 18-location worlds). */
  hideout_location_id: string | null;
  /** Burn the Safehouse (v1.7) used — once per game. Additive; tolerate absence. */
  safehouse_burned: boolean;
}

export type Pending =
  // v2.1: a motive-set play is informant-checked CARD BY CARD — the Detective
  // gets one block decision per matching card (remaining_checks holds the
  // matches not yet decided). The first accepted block bounces the WHOLE set
  // back to the Hacker's hand (no partial commits — sets are atomic).
  | { type: 'block_pending'; hacker_move: CNMove; matching_informant: string; person_id: string; remaining_checks?: string[] }
  | { type: 'clue_reveal_pending'; source: 'buy_clue' | 'block' }
  | { type: 'endgame_final_guess' }
  | { type: 'board_discard_pending'; source_person: string }
  | { type: 'reveal_informant_pending'; source_person: string }
  | { type: 'discard_retrieval_pending'; source_person: string }
  // v2.0 Anansi: remove one informant — facedown by ordinal (goes home
  // UNSEEN) or revealed by name. The choice is the Hacker's.
  // scope 'revealed' (v2.0 Iceden rider): only revealed informants are
  // eligible — a free Win Back riding an Iceden motive commit. Absent scope
  // means 'any' (Anansi).
  // follow_up (v2.1): a motive set may contain BOTH Anansi (none) and an
  // Iceden member — the two riders fire in sequence; the second is queued here
  // and only set if its trigger still holds after the first removal resolves.
  | { type: 'informant_removal_pending'; source_person: string; scope?: 'any' | 'revealed'; follow_up?: { source_person: string; scope: 'revealed' } }
  // Burn the Safehouse (v1.7) sub-steps:
  // - burn_choice_pending: a human Hacker paid 3 AP and gathered the pile; they
  //   now name the new location (burn_choice). Physical order preserved — the
  //   pile's contents are only enumerated AFTER the action is committed.
  | { type: 'burn_choice_pending' }
  // - burn_hand_report_pending: an AI Hacker burned vs a human Detective; the
  //   human must report the Location cards still in their HAND so the server
  //   knows the gathered pile (deck + discard = everything else). The physical
  //   rule already reveals this by elimination — the Hacker looks through the pile.
  | { type: 'burn_hand_report_pending' };

export interface CNState {
  phase: 'setup' | 'play' | 'game_over';
  activePlayerId: string;
  playerOrder: string[];
  detective: DetectiveState;
  hacker: HackerState;
  players: Record<string, PlayerState>;
  pending: Pending | null;
  turn: number;
  /** v1.7: true when the Hacker's safehouse card actually left the Location deck
   *  (every seating except AI Hacker vs human Detective — see header note).
   *  When true, face-up board Locations are publicly NOT the hideout.
   *  Additive; old persisted sessions default to false (v1.6 behavior). */
  hideout_card_removed: boolean;
  /** Per-seat strategy levers (from PlayerConfig.strategy), stored so the
   *  engine-side secret picks (setup hideout, burn relocation) can honor the
   *  Hacker's strategy without the AI brain sending the pick through a move.
   *  Additive; tolerate absence. */
  seat_strategies?: Record<string, string | undefined>;
  /** Per-seat DECIDER kind (PlayerConfig.kind) — who makes this seat's
   *  choices: a person or the AI brain. Distinct from state ownership
   *  (tracked/opaque): digital mode makes a tracked HUMAN. The §23 no-leak
   *  privacy shapes (nameless recruit, ordinal upkeep) exist so an AI
   *  Detective's responses can't carry facedown identities to the Hacker —
   *  they apply to decider kind 'ai', never to a human seat that happens to
   *  be tracked. A human Detective (physical or digital) names their own
   *  pick. Additive; tolerate absence (defaults to the old tracked⇒AI read). */
  seat_kinds?: Record<string, 'human' | 'ai'>;
  /** Snapshot of the Detective's own candidate pool (location ids) taken the
   *  moment a burn resolved, BEFORE the clue wipe. A burn erases the table but
   *  not a human's memory: the new safehouse must DIFFER from the old one, so
   *  when this pool had narrowed to exactly 1 that location is provably not
   *  the new hideout, and a larger pool is still worth down-weighting. Used by
   *  the `patient` Detective strategy lever only. Additive; tolerate absence
   *  (no schema bump). */
  pre_burn_detective_pool?: string[];
  rngSeed: number;
  overclock_draw_timing: 'immediate' | 'next_turn' | 'optional';
  overclock_draws_owed: number;
  endgame_triggered: boolean;
  endgame_reason: string | null;
  winners: string[];
  resultSummary: string;
  log: import('@zekel/game-kit').GameLogEntry[];
}

export interface CNOptions {
  /** v2.3: player_id (or seat name) of the DETECTIVE. Role was previously
   *  POSITIONAL only (seat 0 = Detective) and undocumented — the assistant
   *  always listed the human first, silently making them the Detective. */
  detective?: string;
  seed?: number;
  overclock_draw_timing?: 'immediate' | 'next_turn' | 'optional';
  /** Balance-sweep lever: force the Hacker's hideout (single printed location name). */
  hideout?: string[];
}

export type CNMove =
  | { type: 'play_location'; location_name: string }
  | { type: 'arrest'; target_person: string }
  // v2.3 privacy: an AI-decider Detective recruits NAMELESS — the engine picks
  // the target secretly (pickRecruitTarget) so no response can leak the
  // facedown identity to the Hacker. A HUMAN Detective (physical or digital —
  // see isAIDecider / seat_kinds) names their own pick in target_person.
  | { type: 'recruit_informant'; target_person?: string }
  | { type: 'draw_extra_location' }
  | { type: 'guess_location'; location_name: string }
  | { type: 'buy_clue'; discard_locations: [string, string, string] } // v2.3: back to 3 Location cards (4 was a v1.9 dial for the banking era)
  | { type: 'upkeep_choice'; keep: string[]; release: string[] }
  | { type: 'final_guess'; location_name: string }
  | { type: 'block_decide'; block: boolean; informant_person?: string }
  | { type: 'draw_contact' }
  | { type: 'play_person'; person_name: string }
  // MOTIVE evidence (v2.1, designer ruling 2026-08-13) and WITNESS evidence
  // (v2.4, 2026-08-17) are both played as a COMPLETE set of 3 people at once
  // (`people`), never banked card-by-card. Only the Weapon is single-card
  // (`person_name`, or just `evidence_type: 'weapon'`). `motive_set`/
  // `affiliation_slot` are legacy fields from the banking era, no longer read.
  | { type: 'play_evidence'; person_name?: string; people?: string[]; evidence_type: 'weapon' | 'witness' | 'motive'; motive_set?: 1 | 2 | 3; affiliation_slot?: string }
  | { type: 'win_back'; person_name: string }
  | { type: 'jailbreak'; freed_person: string; negative_clue_token: string }
  | { type: 'overclock' }
  | { type: 'clue_reveal'; category: ClueCategory; value: string }
  // Setup. A human Hacker names their hideout; an AI (tracked) Hacker OMITS the
  // name — the engine picks secretly so the hideout never travels through a
  // get_ai_move/run_ai_turn response (same no-leak pattern as burn_safehouse).
  | { type: 'report_hideout'; location_name?: string }
  // Burn the Safehouse (v1.7): 3 AP, once per game. A human Hacker omits the
  // name (server sets burn_choice_pending; they name it after gathering the
  // pile) or may declare it directly; a tracked (AI) Hacker always omits it —
  // the engine picks secretly so responses never leak the new hideout.
  | { type: 'burn_safehouse'; new_location_name?: string }
  | { type: 'burn_choice'; new_location_name: string }
  | { type: 'report_location_hand'; locations: string[] }
  | { type: 'reveal_informant'; target_informant: string }
  | { type: 'informant_removal_choice'; target_informant: string }
  | { type: 'board_discard_choice'; target_location: string }
  | { type: 'discard_retrieval_choice'; target_card: string }
  | { type: 'pass_turn' };