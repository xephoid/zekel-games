// Neither Guts nor Gears — state & move types.
//
// ============================================================================
// PHYSICAL-FIRST STATE CATEGORIZATION (required by CLAUDE.md — read first)
// ============================================================================
// The server is the bookkeeper for a table game; humans may play PHYSICALLY
// (their own deck/draws on a real table, reported to the server) or DIGITALLY
// (server-held hidden state revealed on a button). AI seats are always
// digital/tracked. Zone plan = PORT-PLAN.md §4; every hidden zone below is
// named with its category.
//
//   PUBLIC / SHARED — source: SERVER · visible: BOTH/ALL
//     - Map: tiles, terrain overlays, every unit's location + owner, bases,
//       collector placements (a committed collector sits visibly on the map
//       until upkeep), Coreless/allocated platform status.
//     - Culture totals, mana (current + max), acquired technology types,
//       research sets, faction-board buildings, public supplies (unit tokens,
//       Cores in supply, collector supply, treaty tokens), the shared hero pool.
//     - Action Stack + played/unplayed action-card counts (face-up stack);
//       the public battle-card DISCARD pile.
//     - Active treaties (type + partners), first-player order, round number.
//     - Hero identity / ownership / location / Leader status / reserved
//       ownership (rulings 15–16), and spy RECRUITMENT events (an Illusionist
//       / Infiltrator purchase is public — but its record never names the
//       chosen hero).
//     - Unallocated owned Cores (off-map count), collector availability,
//       Subjects (off-map count) — public tracked quantities (§15.1 last row).
//
//   TRACKED PER-SEAT PRIVATE — source: SERVER · visible: owning seat (+Shared
//   Tactics partner where the rules say so)
//     - Spy ASSIGNMENTS (which owned hero carries an Illusionist/Infiltrator):
//       per-seat secret until reveal (Decoy/Spy Attack/Invisible).
//       AI seats' assignments are AI-private, same channel.
//     - Battle-card HANDS: server-tracked per seat, validated against the
//       server-owned deck; extended visibility to the active Shared Tactics
//       partner only (ruling 64) — never broadcast.
//     - Battle-card COMMITMENTS: secret until all required participants have
//       committed, then revealed together (§9.2). Exists only inside the
//       battle pending.
//     - Per-seat KNOWLEDGE log (learned spy facts):
//       recorded, without live access to later assignments (§15.1).
//
//   SHARED DECK (battle strategy cards, 20) — SERVER-OWNED (§15.1): one set
//     of 20 card instances, always split exactly across the draw pile
//     (`battleDeck`), hands, cards in play in a battle, and the public discard.
//     - AI / digital human seat: the server deals from its shuffled pile
//       (a digital human presses `resolve_report` to see it — a randomness
//       reveal, never a hidden choice).
//     - PHYSICAL human seat: the human draws from the real deck and REPORTS
//       the card (`report_draw`, Zeke's call 2026-09-21); the server takes that
//       card out of its draw pile, so a report is valid only while the pile
//       still holds one.
//     - Reshuffle on depletion (§10.1): an empty pile is replaced by the
//       shuffled discard — the server's pile and the table's together.
//
//   OPAQUE / HUMAN-PRIVATE — none. No zone is human-shuffled-and-untracked.
// ============================================================================

import type {
  BattleCardId, ResourceType, Species, TreatyType,
} from './data/catalogs.js';
import type { LayoutId, MapTile } from './data/maps.js';

/** Map coordinate label — the "c,r" key of a listed tile (§13.2). */
export type Coord = string;

// ---------------------------------------------------------------------------
// Pieces on the map
// ---------------------------------------------------------------------------

/** A unit instance on the map. `typeId` is the catalog id (surf, dragon,
 *  spinner, ...). */
export interface MapUnit {
  /** Stable per-session instance id (e.g. "u-surf-3"). */
  id: string;
  typeId: string;
  ownerId: string;
  coord: Coord;
  /** Robot platforms: the allocated Core instance, or null when Coreless
   *  (a Coreless platform is not a unit, cannot act, gives no protection). */
  allocatedCoreId: string | null;
}

/** A hero instance. Heroes are units too (they carry stats); placement on the
 *  map is at a coordinate; reserved heroes sit off-map per §8.1. */
export interface HeroInstance {
  id: string; // hero def id (unique across the pool — 20 unique heroes)
  ownerId: string;
  /** Placed location, or null while reserved/baseless. */
  coord: Coord | null;
  isLeader: boolean;
  /** Permanently removed (killed non-Leader); Leaders cannot be replaced. */
  dead: boolean;
}

/** A base (Castle/Home) on the map. The starting base is free. */
export interface BaseInstance {
  id: string;
  ownerId: string;
  coord: Coord;
}

/** A collector committed onto the map this round (stays until upkeep). */
export interface CollectorPlacement {
  /** The collector piece identity: wizards "surf-N"; robots "<type>-collector-N". */
  collectorId: string;
  ownerId: string;
  coord: Coord;
  /** What it produced this commitment (the tile's resource at placement). */
  resource: ResourceType;
  /** How placement was authorized on another player's location, if it was. */
  authorizedBy: string | null; // ownerId of the consenting location owner
}

// ---------------------------------------------------------------------------
// Per-player state
// ---------------------------------------------------------------------------

/** The three action cards every player starts with, plus hero-granted extras. */
export interface ActionCardSet {
  build: number;
  moveBattle: number;
  research: number;
}

export interface PlayerState {
  playerId: string;
  kind: 'human' | 'ai';
  /** The AI seat's difficulty as declared at creation (additive; absent on
   *  older sessions and human seats). Read by the all-AI auto-setup so the
   *  easy tier's Leader/start picks are random like the rest of its play. */
  difficulty?: 'random' | 'easy' | 'medium' | 'hard' | 'mcts' | 'hyperon';
  /** The AI seat's strategy lever as declared at creation (additive). Read by
   *  the all-AI auto-setup so the Leader/start picks follow the archetype
   *  (ai-development §6: the archetype IS the identity pick). */
  strategy?: string;
  /** An AI seat's chosen way to win, written down at each upkeep so the hard
   *  AI keeps to it from round to round (ai-eval.ts commitPath). AI-private:
   *  no view shows it. Additive; absent on human seats, strategy seats and
   *  older sessions. */
  aiPlan?: { path: 'cultural' | 'technological' | 'economic' | 'military'; since: number; openingUntil?: number };
  /** digital = server holds this seat's hidden state (docs/digital-mode). */
  digital?: boolean;
  factionId: string | null; // until setup assigns
  species: Species | null;

  // ---- public tracked economy ----
  culture: number;
  manaCurrent: number;
  manaMax: number;
  /** Ids of ordinary faction-board buildings owned (one per type; Mana Reserve
   *  may repeat up to 4 — stored with count in buildingCounts). */
  buildings: string[];
  buildingCounts: Record<string, number>;
  research: string[];
  /** Permanent acquired-type tech progress (§12.5): set of type ids acquired
   *  from the species list (starting pieces count; loss never un-earns). */
  acquiredTypes: string[];
  /** Leader-kill credit ledger (§12.2): count of enemy Leaders THIS player
   *  killed (credit belongs only to the killing unit/ability's owner). */
  leaderKills: number;

  // ---- pieces ----
  /** OWNED collectors, by id (value 1). Wizards: "surf-1".."surf-11";
   *  robots: "<res>-collector-N" within the per-type supply (§2). A collector
   *  is off the map (on the faction board) until it is placed to pay; while
   *  placed it is in `placements`; destroyed, its key is removed (it goes
   *  back to the purchase supply, §2). Available to pay = owned, not placed
   *  this round, and (robots) powered by a Core. */
  collectorsAvailable: Record<string, number>;
  /** Robot collectors owned WITHOUT a Core (a Coreless collector cannot pay,
   *  §7.7). Absent = every owned collector is powered. */
  corelessCollectors?: string[];
  /** Owned unallocated Cores (public off-map reserve, +1 culture each). */
  coresInReserve: number;
  /** Core supply not yet purchased (destroyed Cores return here). */
  coresInSupply: number;
  /** Per-unit-type owned count not on the map (available to rebuild). Only
   *  meaningful at purchase-time validation — map units are the placements. */
  subjects: number; // wizard off-map faction-board tokens
  /** Action cards. Start 1/1/1; hero extras add; played cards return at upkeep. */
  /** Ruling #101 (Haste): surplus production banked this round, spendable
   *  on later purchases this round; empties at upkeep. Additive — older
   *  sessions tolerate its absence. */
  bank?: Partial<Record<ResourceType, number>>;
  actionCards: ActionCardSet;
  /** Cards played onto the stack this round (per-card once-per-round state). */
  actionCardsPlayed: string[]; // e.g. "build:1" slot ids
  /** Extra action cards granted by heroes (Marshal/Quartermaster/Archivist) —
   *  tracked separately so a died hero's card can be removed at next upkeep. */
  heroExtraCards: Partial<Record<'build' | 'moveBattle' | 'research', string>>; // card-kind -> granting hero id

  // ---- hidden (tracked per-seat private) ----
  /** Battle-card hand (card instance ids). Private; Shared Tactics partner sees. */
  hand: string[];
  /** Spy state: which owned hero carries the assignment, per spy source.
   *  wizard: one active Illusionist assignment; robot: one Infiltrator. */
  /** `endedUnseen`: the assignment ended with its hero's death, which is not
   *  announced — to the table it is still an unrevealed spy. */
  spyAssignments: Array<{ source: 'illusionist' | 'infiltrator'; heroId: string; active: boolean; endedUnseen?: boolean }>;
  /** Per-seat knowledge log: learned spy facts (recorded, no live access). */
  knowledge: string[];
}

// ---------------------------------------------------------------------------
// Battle state (one battle at a time; battles resolve inside the action phase)
// ---------------------------------------------------------------------------

export interface BattleUnit {
  /** MapUnit id or hero id. */
  unitRef: string;
  ownerId: string;
  isHero: boolean;
  side: 'attackers' | 'defenders';
  /** Live battle stats after persistent modifiers. */
  init: number; dmg: number; def: number;
  aoe: boolean;
  /** Activated this pass already. */
  activated: boolean;
  /** Cleric: save already used this pass. */
  clericUsedThisPass: boolean;
  /** The printed unit type (map units only). Additive; older sessions read
   *  the type from the unit ref. */
  typeId?: string;
  /** The unit type's printed name for views. */
  label: string;
}

export interface CommittedCard {
  cardInstanceId: string;
  card: BattleCardId;
  /** The seat PLAYING the card (Shared Tactics borrowing). */
  playingPlayerId: string;
  /** The seat that owns the card (for hand removal). */
  ownerId: string;
  resolved: boolean;
  countered: boolean;
  /** §10.2 batch it resolves in: 0 = the revealed commitments, n+1 = cards an
   *  Extra added during batch n. Additive; absent on older sessions = 0. */
  batch?: number;
}

export interface BattleState {
  coord: Coord;
  /** The attack's origin hex (ruling 69: no retreat/Decoy into it). */
  originCoord: Coord;
  units: BattleUnit[];
  /** Secret commitments per participant until all commit. */
  commitments: Record<string, { cardInstanceId: string; playingPlayerId: string } | 'pass' | 'pending'>;
  /** The resolution workspace: committed cards in batch order. */
  committed: CommittedCard[];
  /** Cards resolving in the current batch's Extra additions (next batch). */
  pendingBatch: CommittedCard[];
  phase: 'commit' | 'cards' | 'activations' | 'retreat' | 'done';
  /** Which committed-card index is resolving (for Counter/Extra pendings). */
  cardCursor: number;
  /** Current initiative pass number. */
  pass: number;
  /** Kill credited during this battle, for §12.2 ledger and §9.7 credit. */
  kills: Array<{ victimRef: string; killerOwnerId: string }>;
  /** Whose activation is on the clock (unit owner). */
  activationQueue: string[]; // unitRefs ordered for this pass
  activationCursor: number;
  /** A defense pending inside an attack resolution. */
  defense: BattleDefense | null;
  /** Rally cards waiting their owner to pick units (resolved in §10.3 order). */
  rallyPendings: Array<{ playingPlayerId: string; cardInstanceId: string }>;
  /** Retreat cards waiting (§10.3: Retreat type). */
  retreatCardPendings: Array<{ playingPlayerId: string; cardInstanceId: string }>;
  /** Persistent battle modifiers (spells + card bonuses), rest-of-battle. */
  modifiers: Array<{ targetRef: string | 'all-attacking' | 'all-defending' | 'all-opposing-of'; init?: number; dmg?: number; def?: number; source: string }>;
  /** Whether any kill happened this pass (stalemate = full pass, no kill). */
  killThisPass: boolean;
  /** The activation slot whose allied initiative tie was already settled
   *  (§9.3), so the pick is asked once per slot. Additive. */
  tieSettled?: number;
  /** The side each participant joined on (kept after its units leave).
   *  Additive; older sessions read the side from the units. */
  sides?: Record<string, 'attackers' | 'defenders'>;
  /** Seats already given their second look at a Shared Tactics partner's
   *  cards after the owner decided (§11.2 owner first). Additive. */
  borrowOffered?: string[];
}

export interface BattleDefense {
  /** The attack being defended against. */
  attackerRef: string;
  targetRef: string;
  damage: number;
  /** 'attack' normal | 'instant-kill' (spy abilities). */
  kind: 'attack' | 'instant-kill' | 'aoe';
  /** AoE: all would-die refs computed with frozen stats. */
  aoeWouldDie?: string[];
  /** AoE: refs confirmed dying after all defense decisions (removal batch). */
  aoeConfirmedDeaths?: string[];
  /** AoE: heroes the hit would NOT kill who may still reveal Decoy (it
   *  triggers on being attacked, §7.3); walked with the would-die set. */
  aoeNonLethal?: string[];
  /** AoE: defense-steps a player already declined per ref this attack. */
  aoeDeclined?: string[];
  /** Ruling #111: this area hit is a self-destruct — every side is hit and
   *  the attacker itself is lost when the batch resolves. */
  selfDestruct?: boolean;
  /** Reaction ladder step: decoy -> mana_shield -> cleric -> remove. */
  step: 'decoy' | 'mana_shield' | 'cleric' | 'done';
  /** Single-target: mana already spent on Mana Shield against this hit. */
  shieldSpent?: number;
  /** Single-target: Cleric owners who declined to save this target. */
  clericDeclinedBy?: string[];
}

// ---------------------------------------------------------------------------
// Pendings — every mid-game decision a seat owes. One contract: EVERY path
// that sets a pending also clears it on the degenerate branch (CLAUDE.md).
// ---------------------------------------------------------------------------

export type Pending =
  // Setup sequence.
  // Each human seat picks its own faction, in seat order (distinct factions).
  | { kind: 'choose_faction'; forPlayerId: string }
  | { kind: 'choose_leader'; forPlayerId: string }
  | { kind: 'choose_starting_location'; forPlayerId: string }
  // A physical human drew a battle card (setup Leader grant / research
  // purchase / Chaimidious claim reward) and must report it.
  | { kind: 'report_draw'; forPlayerId: string; reason: 'leader-grant' | 'research-purchase' | 'hero-reward'; resume: ResumeAction }
  // Upkeep: a robot seat may reallocate owned Cores among platforms.
  | { kind: 'upkeep_reallocate_cores'; forPlayerId: string }
  // A cross-player collector access request, per purchase (§6.2).
  | { kind: 'access_request'; forPlayerId: string; buyerId: string; collectorId: string; coord: Coord; action: 'build' | 'research'; proposal: PurchaseProposal; resume: ResumeAction;
      /** Which of this purchase's consent requests this is (1-based) and how
       *  many it needs in all. Additive; absent on older sessions. */
      queue?: { index: number; total: number } }
  // A purchase was legal; the active player has a Foreman/Kettering second
  // purchase available (§6.2 two-purchase procedure, resolved separately).
  | { kind: 'second_purchase'; forPlayerId: string; action: 'build' | 'research' }
  // Hero reward: Smyth's waived-cost research pick (waits while reserved).
  | { kind: 'smyth_reward'; forPlayerId: string }
  /** Rulings #106 / #117: a robot placing Dowser Wren picks each of her free
   *  collectors, one at a time. `remaining` counts this pick; absent = 1
   *  (sessions saved before #117). */
  | { kind: 'dowser_collector'; forPlayerId: string; remaining?: number }
  // Elara's optional pre-movement spell.
  | { kind: 'elara_spell'; forPlayerId: string; resume: ResumeAction }
  // Treaty formation response on the partner.
  | { kind: 'treaty_response'; forPlayerId: string; proposerId: string; treatyType: TreatyType }
  // §5.6 end-of-round treaty-break decision (break one/several, or keep all —
  // the seat may keep choosing; the queue advances when it passes).
  | { kind: 'treaty_break_decision'; forPlayerId: string }
  // Battle commitments (secret until all in).
  | { kind: 'battle_commit'; forPlayerId: string }
  // Counter target chosen at resolution (the playing player).
  | { kind: 'counter_target'; forPlayerId: string; cardIndex: number }
  // Extra: 0–2 additional cards, chosen+revealed together.
  | { kind: 'extra_selection'; forPlayerId: string; cardIndex: number }
  // Allied initiative-tie order (fallback pick by the earlier FPO owner):
  // which of the tied allied units acts next.
  | { kind: 'initiative_tie'; forPlayerId: string; tieGroup: string[] }
  // A unit's activation choice lives in legalMoves; the nested DEFENSE is the pending.
  | { kind: 'battle_defense'; forPlayerId: string }
  // Retreat decision per player, defenders first. `viaCard` = a Retreat card
  // is resolving: the player must retreat and only picks the destination.
  | { kind: 'retreat'; forPlayerId: string; viaCard?: string }
  // Rally reinforcement selection.
  | { kind: 'rally_selection'; forPlayerId: string; cardInstanceId: string }
  // Milestone hero claims (alternating).
  | { kind: 'choose_milestone_hero'; forPlayerId: string; claimsOwed: number }
  // Overlay collision arbitration on one tile (two or more Economy heroes).
  | { kind: 'overlay_choice'; forPlayerId: string; heroIds: string[] }
  // Reserved hero placement once a base exists.
  | { kind: 'place_reserved_hero'; forPlayerId: string; heroId: string }
  // The private spy-assignment pick after recruiting (§7.3/§7.9).
  | { kind: 'choose_spy'; forPlayerId: string; source: 'illusionist' | 'infiltrator'; resume: ResumeAction }
  | null;

/** Everything needed to resume the originating action after a nested pending
 *  settles (§15.2: resume the originating action; never combine an unasked
 *  choice into the same move). */
export interface ResumeAction {
  action: 'build' | 'research' | 'move_battle';
  /** The purchase/move being made once the nested decision settles. */
  move: unknown;
}

/** A declared purchase + complete proposed collector payment (§6.2). */
export interface PurchaseProposal {
  item: string; // printed name of unit/building/base/research/battle-card
  placements: Array<{ collectorId: string; coord: Coord }>;
}

// ---------------------------------------------------------------------------
// The game state
// ---------------------------------------------------------------------------

export type Phase =
  | 'setup_factions'
  | 'setup_leaders'
  | 'setup_locations'
  | 'setup_done_pending_grants' // leader-grant draws (Chaimidious) + Smyth pending
  | 'upkeep'
  | 'planning'
  | 'action'      // stack resolution
  | 'culture'     // income
  | 'claims'      // milestone hero claims
  | 'treaty_break' // §5.6 breakable-treaty decision window (subset of end of round)
  | 'end_of_round'
  | 'game_over';

export interface TreatyInstance {
  type: TreatyType;
  partners: [string, string];
}

/** An economy overlay on a tile: which Economy hero's alternate tile is active. */
export interface OverlayState {
  /** coord -> the hero def id whose overlay is currently active there. */
  activeByCoord: Record<Coord, string>;
  /** coord -> the Economy heroes present when the active overlay was chosen
   *  (sorted ids). The choice holds until that set changes (§8.3). Additive. */
  lockedWith?: Record<Coord, string[]>;
  /** Tiles whose Economy heroes changed and now owe an overlay choice; asked
   *  as soon as no other decision is open. Additive. */
  queue?: Coord[];
}

export interface NGGState {
  phase: Phase;
  round: number;
  seed: number;
  layout: LayoutId;
  tiles: MapTile[];
  /** Experimental override (economicScale.ts): collectors the Economic spend
   *  needs. Absent = the map's printed count (rulings #89, #91). Additive; older sessions
   *  tolerate its absence. */
  economicCollectors?: number;

  players: PlayerState[];
  /** Setup first player (drafts Leader first). */
  setupFirstPlayerIndex: number;
  /** First-player token position (rotates every upkeep incl. before round 1). */
  firstPlayerIndex: number;
  /** Planning: seats still to place-or-pass, in order; passing removes. */
  planningOrder: string[];
  /** The Action Stack (LIFO) as entries. */
  actionStack: Array<{ ownerId: string; cardKind: 'build' | 'move_battle' | 'research'; slotId: string }>;
  /** The action currently resolving (during 'action' phase). */
  activeAction: {
    ownerId: string; cardKind: 'build' | 'move_battle' | 'research'; slotId: string;
    secondUsed?: boolean; elaraOffered?: boolean;
    refusedAccess?: Array<{ ownerId: string; collectorId: string; coord: string }>;
    /** Consent the location owners actually gave (respond_access_request) for
     *  the purchase being composed — the only proof of consent (§6.2).
     *  Cleared when that purchase commits. */
    accessGrants?: Array<{ ownerId: string; collectorId: string; coord: string }>;
    /** The action's effects have begun (a payment proposed, a move, a
     *  spell): it is no longer at its start boundary (§5.3). */
    acted?: boolean;
    /** Elara's spell was cast this action (movement afterwards is optional). */
    elaraCast?: boolean;
    /** The action's effects are finished; only the end-of-action treaty
     *  window remains (§5.3/§11.1). */
    endWindow?: boolean;
  } | null;

  // ---- map ----
  bases: BaseInstance[];
  units: MapUnit[]; // non-hero, non-collector-committed map pieces (incl. platforms)
  /** Setup echo of NGGOptions.aiLeaderAssignment — resolved to
   *  Record<playerId, heroId> at creation so AI-seat draft picks during setup
   *  can read it without threading options through every move. Additive;
   *  sessions persisted before it tolerate its absence (all-AI default picks). */
  aiLeaderPicks?: Record<string, string>;
  /** Setup echo of NGGOptions.aiRandomStarts (balance harness). Additive. */
  aiRandomStarts?: boolean;
  heroes: HeroInstance[]; // the shared pool's owned heroes (dead or alive)
  /** Hero pool: hero def ids still claimable (not owned, not dead). */
  heroPool: string[];
  placements: CollectorPlacement[]; // this round's committed collectors
  overlays: OverlayState;

  // ---- battle cards (see zone block; per-seat ownership of the draw) ----
  /** Server-held shuffled order serving AI/digital seats (card instance ids). */
  battleDeck: string[];
  /** Card instances in the public discard (ids). */
  battleDiscard: string[];
  /** Physical-table deck remainder multiset (card -> count still in the table
   *  deck after physical reports). Validation-only for physical seats. */
  physicalDeckRemainder: Partial<Record<BattleCardId, number>>;
  /** Card instance ownership map: instanceId -> owning seat (hands), set when
   *  dealt/reported. */
  cardOwners: Record<string, string>;

  treaties: TreatyInstance[];

  battle: BattleState | null;
  pending: Pending;

  /** Culture milestone claims owed this claims phase (playerId -> count). */
  claimsOwed: Record<string, number>;
  /** §5.5 alternating claims: the player who claimed most recently (so the next
   *  owed seat IN FPO AFTER them gets the next offer). */
  claimLastServed?: string;
  /** Milestones each player has already crossed (prevents re-award). */
  milestonesCrossed: Record<string, number[]>;

  /** 2 = robot collectors are off-map owned pieces (see PlayerState
   *  collectorsAvailable). Absent = an older session, upgraded on load. */
  collectorModel?: 2;

  /** The per-game rich log (rich path; getLog reads this). */
  log: import('@zekel/game-kit').GameLogEntry[];

  /** Game-over result once ended (kept for idempotent isGameOver). */
  result: { winners: string[]; summary: string; kinds?: string[] } | null;

  activePlayerId: string;
}

// ---------------------------------------------------------------------------
// Moves (one decision/action per move; constrained-set fields accept PRINTED
// NAMES — resolvers resolve them server-side)
// ---------------------------------------------------------------------------

export type NGGMove =
  | { type: 'assign_setup_choices'; selections: Record<string, string> }
  | { type: 'choose_faction'; faction: string }
  | { type: 'choose_leader'; hero: string }
  | { type: 'choose_starting_location'; location: string }
  | { type: 'report_draw'; card: string }
  | { type: 'resolve_report' }
  | { type: 'reallocate_cores'; allocations: Record<string, boolean> }
  | { type: 'plan_action'; card: 'build' | 'move_battle' | 'research' | 'pass'; which?: 'base' | 'hero_extra' | 'researched_extra' }
  | { type: 'build'; item: string; payment: Array<{ collectorId: string; coord: Coord }>; core_pairing?: boolean; at_base?: string }
  | { type: 'economic_victory_spend'; payment: Array<{ collectorId: string; coord: Coord }> }
  | { type: 'respond_access_request'; grant: boolean }
  | { type: 'move_units'; from: Coord; to: Coord; units: string[] }
  | { type: 'cast_elara_spell'; target_location: Coord | null; skip?: boolean }
  | { type: 'research'; kind: 'tech'; tech: string; payment: Array<{ collectorId: string; coord: Coord }> }
  | { type: 'research'; kind: 'battle_card'; payment: Array<{ collectorId: string; coord: Coord }> }
  | { type: 'form_treaty'; partner: string; treaty_type: string }
  | { type: 'respond_treaty'; accept: boolean }
  | { type: 'break_treaty'; treaty_type: string; partner: string }
  | { type: 'commit_battle_card'; card: string | null }
  | { type: 'choose_counter_target'; card: string; played_by?: string; batch?: number }
  | { type: 'select_extra_cards'; cards: string[] }
  | { type: 'battle_activation'; unit: string; action: BattleActionChoice }
  | { type: 'choose_initiative_order'; unit: string }
  | { type: 'resolve_battle_defense'; defense: DefenseChoice }
  | { type: 'choose_retreat'; destination: Coord | null; stay?: boolean }
  | { type: 'choose_milestone_hero'; hero: string }
  | { type: 'resolve_overlay_choice'; hero: string }
  | { type: 'choose_dowser_collector'; collector: string }
  | { type: 'place_reserved_hero'; hero: string; coord: Coord }
  | { type: 'choose_spy'; hero: string }
  | { type: 'skip_action' }
  | { type: 'select_rally_units'; units: string[] };

export type BattleActionChoice =
  | { kind: 'attack'; target: string }
  | { kind: 'ability'; ability: string; target?: string; mana?: number }
  | { kind: 'spy_attack'; target: string }
  | { kind: 'invisible'; target: string }
  /** Ruling #111: a robot unit blows itself up — current DMG + 3 to every
   *  other unit and hero in the battle, every side; the unit is lost. */
  | { kind: 'self_destruct' }
  | { kind: 'pass' };

export type DefenseChoice =
  | { kind: 'none' }
  | { kind: 'decoy'; moveTo?: Coord }
  | { kind: 'mana_shield'; mana: number }
  | { kind: 'cleric_save'; cleric: string; target: string };
