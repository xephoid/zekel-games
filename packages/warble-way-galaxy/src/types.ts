// Warble Way Galaxy — Season 1 solo RPG. Canonical rules: the FROZEN
// port/warble-way-galaxy/WARBLE-RULES.md (designer sign-off 2026-07-07); this
// module must never re-derive a rule from the PDFs or memory.
//
// ============================================================================
// ZONE CATEGORIZATION (mandatory declaration — PORT-PLAN.md §5)
// Solo game: exactly one human seat. No shared-hidden zones exist.
//
// | Zone                                        | Category                       |
// |---------------------------------------------|--------------------------------|
// | Character sheet (scores/skills/XP/level/credits) | Public, server-tracked    |
// | Crew roster (stats, anger tokens, equips)   | Public, server-tracked         |
// | Ship (damage/speed/capacity/handling/armor/parts) | Public, server-tracked   |
// | Habitat flags (purchased/attempted/missions)| Public, server-tracked         |
// | Journey stack (legs, cards remaining)       | Public, server-tracked         |
// | Travel deck (player's own 52 cards)         | OPAQUE, HUMAN-OWNED PHYSICAL — |
// |                                             | human reports draws; server    |
// |                                             | mirrors COMPOSITION only (to   |
// |                                             | reject impossible duplicates + |
// |                                             | know when a reshuffle is due), |
// |                                             | never the order                |
// | All dice (3d6 checks, 4d6 combat, riders)   | HUMAN-ROLLED, REPORTED         |
// | Travel tables / habitat / ruins data        | Server data (frozen ruleset)   |
//
// Harness mode: the solvability bot (kind:'ai' seat) simulates the SAME report
// moves faithfully — seeded real 3d6 and a real shuffled deck drawn by
// position (rng.ts). Simulation-fidelity rule: no distribution shortcuts.
// ============================================================================

// ---------------------------------------------------------------------------
// Vocabulary: stats, abilities, races (WR §3)
// ---------------------------------------------------------------------------

export type StatId = 'brawn' | 'smarts' | 'finesse' | 'moxie';

export type AbilityId =
  | 'SWA' // Swashbuckling (Brawn)
  | 'ARM' // Armor (Brawn)
  | 'DEM' // Demolitions (Brawn)
  | 'HAK' // Hacking (Smarts)
  | 'RES' // Research (Smarts)
  | 'MEC' // Mechanics (Smarts)
  | 'PIL' // Piloting (Finesse)
  | 'GUN' // Gunslinging (Finesse)
  | 'SNE' // Sneaking (Finesse)
  | 'LEA' // Leadership (Moxie)
  | 'DIP' // Diplomacy (Moxie)
  | 'ACT'; // Acting (Moxie)

export type Race = 'human' | 'kralkin' | 'hexapod' | 'grull';

export type AbilityScores = Partial<Record<AbilityId, number>>;

// ---------------------------------------------------------------------------
// Playing cards (the player's own travel deck; WR §8–§9)
// ---------------------------------------------------------------------------

export type CardRank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type CardSuit = 'hearts' | 'diamonds' | 'spades' | 'clubs';

export interface PlayingCard {
  rank: CardRank;
  suit: CardSuit;
}

// ---------------------------------------------------------------------------
// Items (WR §6; 4 printed types) — used by habitat shops and ruins finds
// ---------------------------------------------------------------------------

export type ItemEffect =
  /** +bonus to one ability (or ANY: player picks the ability when using/equipping). */
  | { kind: 'ability_bonus'; ability: AbilityId | 'ANY'; bonus: number }
  | { kind: 'ground_combat_advantage' }
  | { kind: 'space_combat_advantage' }
  | { kind: 'ship_stat'; stat: 'speed' | 'capacity' | 'handling' | 'armor'; bonus: number };

export type ItemType = 'consumable' | 'weapon' | 'armor' | 'ship_part';

export interface ItemDefinition {
  /** Stable id, e.g. "h1-weapon-gun-1". */
  id: string;
  /** The printed label the player reads off the page, e.g. "Weapon +1 GUN". */
  name: string;
  type: ItemType;
  effect: ItemEffect;
  /** A16 Tinker: MK-II'd once (bonus +1, renamed) — once per item. */
  upgraded?: boolean;
}

// ---------------------------------------------------------------------------
// Missions (WR §7, §16)
// ---------------------------------------------------------------------------

export type RuinDepth = 1 | 2 | 3;

export type MissionGoal =
  | { kind: 'ability_check'; ability: AbilityId; min_roll: number }
  | { kind: 'ruin'; depth: RuinDepth };

export interface MissionDefinition {
  id: string;
  distance: number;
  goal: MissionGoal;
  credits: number;
  xp: number;
}

// ---------------------------------------------------------------------------
// Recruits (cantina rows, ♥ table, ruins beings; WR §6, §9, §14)
// ---------------------------------------------------------------------------

export interface RecruitDefinition {
  id: string;
  race: Race;
  /** The stat this recruit idealizes — as PRINTED (ruins beings may diverge from their race's canon ideal, e.g. H(S); WR §14). */
  idealized: StatId;
  min_roll: number;
  abilities: AbilityScores;
}

// ---------------------------------------------------------------------------
// Character / crew / ship state (public, server-tracked)
// ---------------------------------------------------------------------------

export type Disposition = 'brash' | 'risk_averse';

export interface EquippedGear {
  /** Item ids from the owned-items ledger; one weapon + one armor per being (WR §6). */
  weapon: string | null;
  armor: string | null;
}

export interface CrewMember {
  /** Auto-generated unique label ("Kralkin (DIP+2 ARM+1)"); the DM may flavor it in narration. A rename affordance is a possible nicety (POST-PORT §5). */
  name: string;
  race: Race;
  idealized: StatId;
  abilities: AbilityScores;
  anger_tokens: number; // 0–3; at 3 they leave with their gear (WR §10)
  gear: EquippedGear;
}

export type ShipDamage = 'pristine' | 'used' | 'damaged' | 'hobbled';

export interface ShipState {
  name: string;
  capacity: number; // includes the character (start 3)
  speed: number; // start 0
  handling: number; // start 0
  armor: number; // start 0
  damage: ShipDamage; // start 'used'; below hobbled = destroyed, game over
  /** Installed ship-part item ids (abandoned with the ship on capture — ruling #8). */
  parts: string[];
}

export interface CharacterState {
  name: string;
  race: Race;
  disposition: Disposition | null; // roleplay hint only — never a rule (WR §2)
  abilities: AbilityScores;
  level: number;
  xp: number;
  credits: number; // may go negative; < -300 = game over
  gear: EquippedGear;
  /** Amendment A4 (WR balance amendments): first failed death check wounds
   * (−1 all effective scores) instead of killing; heals on habitat arrival.
   * Optional so pre-amendment persisted sessions load (absent = false). */
  wounded?: boolean;
}

// ---------------------------------------------------------------------------
// Travel deck model. PHYSICAL sessions track COMPOSITION only (remaining/
// discard — the order is the player's shuffle). DIGITAL sessions (a digital
// human, or the solvability bot) also carry `order` — the actual shuffled
// draw order the server owns; remaining === order always (two views of the
// same pile). Additive/tolerate-absence: pre-digital sessions load with no
// order and behave exactly as before.
// ---------------------------------------------------------------------------

export interface DeckModel {
  /** Card ids (e.g. "7S") still in the player's draw pile — as far as the server knows. */
  remaining: string[];
  /** Card ids in the face-up discard. remaining+discard+peeked == 52 always. */
  discard: string[];
  /** DIGITAL ONLY: the server's actual draw order (top = order[0]). Absent on
   * physical sessions — every physical path keys off remaining/discard only. */
  order?: string[];
}

// ---------------------------------------------------------------------------
// Journeys (WR §7): a LIFO stack of legs — sandwiched missions push on top
// ---------------------------------------------------------------------------

export interface JourneyLeg {
  /** What this leg is for: a mission's outbound/return, or a one-way habitat transfer. */
  purpose:
    | { kind: 'mission_outbound'; mission_id: string }
    | { kind: 'mission_return'; mission_id: string }
    | { kind: 'habitat_transfer'; to_habitat: number };
  /** Cards left to draw+resolve on this leg (already net of ship speed). */
  cards_remaining: number;
}

// ---------------------------------------------------------------------------
// Phases & pendings — the engine spine (built across M1–M4; see PORT-PLAN §8)
// ---------------------------------------------------------------------------

export type WarblePhase =
  | 'creation' // character creation (setup checklist)
  | 'at_habitat'
  | 'traveling' // resolving journey-leg card draws
  | 'space_combat' // a ♦ pirate encounter (M3)
  | 'ruin' // a ruins encounter on the grid (M4)
  | 'game_over';

export type RollReason =
  | 'recruit' // vs a recruit's min roll (cantina / ♥ / ruins being)
  | 'repair' // 3d6 + best MEC vs 12 (habitat arrival)
  | 'reduce_unrest' // 3d6 + best LEA vs 12 (habitat arrival)
  | 'mission_check' // arrival check (M2)
  | 'hazard_check' // ♠ option roll (M2)
  | 'death_check' // 3d6, below 9 = dead (M2)
  | 'escape' // space combat step 1 (M3)
  | 'hack' // vs min_hacking (M3)
  | 'evade' // amendment A5 "Running Silent": 3d6 + SNE vs 10 + pirate speed, BEFORE the encounter
  | 'volley' // amendment A6 "Opening Volley": 3d6 + GUN vs 12, once per encounter (−2 pirate totals)
  | 'intimidate' // amendment A7 "Stand Down or Burn": 3d6 + DEM vs 10 + pirate space attack (+Dread, A9b)
  | 'unnamed_recruit' // amendment A10: 3d6 + DIP vs 12 (habitat docks / post-victory survivors)
  | 'redline' // amendment A20: engine overcharge, 3d6 + MEC vs 12 → +2 player exchange totals
  | 'space_combat' // 4d6 pairing exchange (M3)
  | 'ground_combat' // 4d6 pairing (boarding M3 / ruins M4)
  | 'item_d6' // ruins item find (M4)
  | 'being_d6'; // ruins being find (M4)

/** Resolution context for a roll pending; fields by reason. */
export interface RollContext {
  recruit_id?: string;
  recruit_source?: 'cantina' | 'space' | 'ruin';
  mission_id?: string;
  hazard_card_id?: string;
  hazard_option?: 1 | 2;
  /** What a failed death check was triggered by (survival differs). */
  death_source?: 'hazard' | 'boarding' | 'ruin';
  /** Ruins ground combat: which kind and who is involved. */
  ground?: 'boarding' | 'ruin_attack' | 'ruin_defense';
  actor?: string; // acting player being (ruin_attack) or defending being (ruin_defense)
  target?: string; // targeted attacker id (ruin_attack) / attacking attacker id (ruin_defense)
  /** The I/B spot cell being rolled (item_d6 / being_d6 / ruin recruit). */
  cell?: string;
  /** A5 evade: the pirate card the check is slipping past (failure starts that encounter). */
  evade_card_id?: string;
  /** A10 unnamed-crew recruit: which channel rolled (habitat docks / post-victory survivors). */
  unnamed_source?: 'habitat' | 'survivors';
  /** Extra rider dice appended after the 4 pairing dice (Expert Combat Tactics / Reinforced Armor). */
  rider_dice?: number;
}

/** A ♦2–9 pirate encounter in progress (M3; WR §12). */
export interface SpaceCombatEncounter {
  kind: 'space_combat';
  card_id: string; // e.g. "4D"
  pirate_rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
  stage:
    | 'choose_action' // step 1: escape / hack / fight
    | 'loss_reroll_offer' // lost an exchange with Flying Ace unused: reroll or accept
    | 'disabled' // you won: board or move on
    | 'captured'; // boarding won: take the ship or abandon it
  reroll_used: boolean;
  /** A6: the Opening Volley is once per encounter (attempt consumes it). Optional: pre-A6 sessions load as false. */
  volley_used?: boolean;
  /** A6: −N to every pirate exchange total after a successful volley. */
  pirate_debuff?: number;
  /** A10: the post-victory "talk the survivors aboard" roll is spent for this encounter. */
  survivors_rolled?: boolean;
  /** A20 Redline: the once-per-encounter engine overcharge is spent. */
  redline_used?: boolean;
  /** A20 Redline: +N to every PLAYER exchange total this combat. */
  player_buff?: number;
}

// ---------------------------------------------------------------------------
// Ruins (M4; WR §14). Cells are addressed "r{row}c{col}", 1-based, matching
// the printed row numbers; grids from data/ruins.ts (designer-confirmed).
// ---------------------------------------------------------------------------

/** A being (character or crew) on the ruin map. */
export interface RuinToken {
  name: string;
  is_character: boolean;
  cell: string;
  /** Movement points spent this round (allowance = 3 + SNE). */
  moved: number;
  /** The one Act per round (attack / collect / recruit / convert) is used. */
  acted: boolean;
  /** Turn explicitly (or automatically) finished this round. */
  ended: boolean;
  /** Has attacked at least once this encounter (Personal Cloaking targeting). */
  has_attacked: boolean;
  /** Amendment A10: an unnamed crew body (backed by state.unnamed_crew, not a
   * CrewMember) — no scores, no gear; a death decrements the counter. */
  unnamed?: boolean;
}

/** One of the three placed attackers this encounter. */
export interface RuinAttackerPlaced {
  id: string; // "A1".."A3"
  atk: number;
  move: number;
  range: number;
  xp: number;
  cell: string;
  defeated: boolean;
}

export interface RuinBoard {
  threat_level: 1 | 2 | 3;
  start_cell: string; // the chosen S cell (escape target)
  tokens: RuinToken[];
  attackers: RuinAttackerPlaced[];
  /** I/B cells already rolled (looted, emptied, decoyed, or recruit-failed). */
  closed_spots: string[];
  round: number;
  /** null = player phase; an index = the attacker whose turn is resolving. */
  attacker_turn_index: number | null;
}

export interface RuinRun {
  kind: 'ruin_run';
  origin:
    | { type: 'mission'; mission_id: string }
    | { type: 'discovery'; card_id: string }
    | { type: 'finale' }; // Habitat #3's Season 1 ending (ruling #16)
  /** Reach the goal on this level to succeed (missions/finale) or to finish (discovery). */
  target_depth: RuinDepth;
  /** Current level 1..3 — always starts at 1 and maps to R1/R2/R3 (WR §14). */
  level: 1 | 2 | 3;
  /** null between levels (the setup pending is open). */
  board: RuinBoard | null;
}

export type WarbleEncounter = SpaceCombatEncounter | RuinRun;

/**
 * Every pending is HUMAN-OWED in real play (solo game) — describeNextStep must
 * name the exact move and the value to ask for, for every kind here.
 * The union grows with milestones M1→M4; kinds are listed up front from the
 * PORT-PLAN §6 catalog so no pending is invented ad hoc mid-build.
 */
export type WarblePending =
  /** Ask the player for dice: `dice_count` d6, resolving `reason`. */
  | {
      kind: 'roll';
      reason: RollReason;
      dice_count: number;
      /** Whose ability score is being added (self or a crew name) — drives Inspirational (WR §5). */
      score_source: { who: 'self' | 'crew'; crew_name?: string; ability: AbilityId | null; bonus: number };
      min_roll: number | null; // null when the roll has no threshold (e.g. item d6)
      /** Item ids declared for this roll (consumables; declare-before-roll, WR §6). */
      declared_items: string[];
      /** What the resolution needs to know (which recruit, which mission, ...). */
      context: RollContext;
    }
  /** Ask the player which card they drew from their physical deck. */
  | { kind: 'card_draw' }
  /** RES peek at mission start: player peeked N cards, reports the one discarded. */
  | { kind: 'res_discard'; peek_count: number }
  /** Hazard: choose which option to roll (or which to fail, when neither is held). */
  | { kind: 'hazard_option'; card_id: string; must_fail: boolean }
  /** ♣ space mission found: accept option 1/2 (or the single ruins mission) or decline. */
  | { kind: 'space_mission_offer'; card_id: string }
  /** ♥ recruit found in space: attempt or decline. */
  | { kind: 'space_recruit_offer'; card_id: string }
  /** ♦ ruin discovered: enter (choose depth up to printed) or skip. */
  | { kind: 'ruin_discovery'; card_id: string; max_depth: RuinDepth }
  /** Level-up: the player picks which owned ability gains +1 (never auto). */
  | { kind: 'level_up' }
  /** A5: a pirate appeared and SNE is aboard — try Running Silent, or engage. */
  | { kind: 'evade_offer'; card_id: string }
  /** A14a: a hazard check failed with unnamed crew aboard — spend one to survive it? */
  | { kind: 'sacrifice_offer'; hazard_card_id: string; hazard_option: 1 | 2; carrier_who: 'self' | 'crew'; carrier_name?: string }
  /** Space combat round: choose escape / hack / fight / volley / intimidate / use reroll (M3). */
  | { kind: 'space_combat_action' }
  /** Pirate disabled: board or move on; after capture: take or abandon (M3). */
  | { kind: 'boarding_decision'; stage: 'board_or_leave' | 'take_or_abandon' }
  /** Over capacity (recruit/capture): someone must be released. */
  | { kind: 'release_crew' }
  /** Ruins (M4): encounter setup for the current level. */
  | { kind: 'ruin_setup'; level: 1 | 2 | 3; depth_target: RuinDepth }
  /** Player-beings phase: unended tokens may move/act (legalMoves enumerates). */
  | { kind: 'ruin_turn' }
  /** A level's goal was reached below the target depth: go deeper or leave. */
  | { kind: 'ruin_continue'; next_level: 1 | 2 | 3; is_mission: boolean };

// ---------------------------------------------------------------------------
// Per-habitat progress flags (one-shot rules; WR §6–§7, §16)
// ---------------------------------------------------------------------------

export interface HabitatProgress {
  /** Mission ids attempted (success OR fail — one attempt each, ruling #7). */
  missions_attempted: string[];
  missions_succeeded: string[];
  /** Shop item ids purchased (once each). */
  purchased: string[];
  /** Cantina recruit ids failed (permanently marked) or hired. */
  recruits_failed: string[];
  recruits_hired: string[];
  /** Repair / unrest rolls are once per arrival-after-travel (WR §6). */
  repair_rolled_this_arrival: boolean;
  unrest_rolled_this_arrival: boolean;
  /** A10: the once-per-HABITAT "work the docks" unnamed-crew roll is spent. Optional: pre-A10 rows load as false. */
  unnamed_rolled?: boolean;
  /** A18 Shipwright: one fabrication per habitat VISIT (reset on arrival). */
  fabricated_this_arrival?: boolean;
}

// ---------------------------------------------------------------------------
// The game state
// ---------------------------------------------------------------------------

export interface WarbleWayGalaxyState {
  phase: WarblePhase;
  pending: WarblePending | null;
  character: CharacterState | null; // null until creation completes
  crew: CrewMember[];
  ship: ShipState | null;
  /** Owned items ledger (bought/found); equips reference these by id. */
  items: ItemDefinition[];
  /** Consumable ids already spent. */
  consumed_item_ids: string[];
  current_habitat: number; // 1..3
  habitat_progress: Record<number, HabitatProgress>;
  deck: DeckModel;
  /** LIFO — the top leg is the one being drawn for (WR §7 sandwiching). */
  journey_stack: JourneyLeg[];
  /** Encounter state for the phase in progress (space combat or a ruin run). */
  encounter: WarbleEncounter | null;
  /** Season-1 finale flag: H3's R3 run (win condition, ruling #16). */
  final_ruin_started: boolean;
  /** Amendment A9b: reputation from shakedowns + boarding wins (cap 3);
   * each point adds +1 to intimidation rolls. Optional: pre-A9 sessions load as 0. */
  dread?: number;
  /** Amendment A10: unnamed crew ("red shirts") — a COUNT, not CrewMembers.
   * Pure bodies: no scores, no gear, no anger, no capacity slot; they act only
   * in ruin encounters (move 3, attack +0, soak one hit). Cap = best natural
   * DIP aboard. Optional: pre-A10 sessions load as 0. */
  unnamed_crew?: number;
  /** Amendment A19 "Emergency Bulkheads" (natural ARM 3 aboard): the first
   * killing blow holds the ship at Hobbled instead — once per run. */
  bulkheads_spent?: boolean;
  /** Amendment A11: ruin caches OPENED this run (Plunder ending at 6). */
  caches_looted?: number;
  /** Amendment A11: foes defeated FACE TO FACE — boarding captures + ruin
   * attackers slain in combat (disables, intimidations and conversions do
   * NOT count). Bounty ending at 8. */
  foes_defeated?: number;
  seed: number; // bot RNG state; in DIGITAL sessions also the real dice/deck stream
  /** Digital mode (docs/digital-mode.md), baked at creation: what kind of seat
   * plays this solo game and whether the server holds its hidden state
   * (digital human or bot → true). Both tolerate absence — a persisted session
   * without them is a physical human. */
  seat_kind?: 'human' | 'ai';
  digital_seat?: boolean;
  /** A11: `ending` names which of the five victories fired (analysis reads it). */
  result: { winner: 'player' | 'galaxy'; summary: string; ending?: WarbleEnding } | null;
}

/** A11: the five ways Season 1 ends in victory. */
export type WarbleEnding = 'conquest' | 'fortune' | 'legend' | 'plunder' | 'bounty';

// ---------------------------------------------------------------------------
// Moves — the PORT-PLAN §6 catalog. Implemented progressively (M1→M4); the
// engine rejects kinds whose milestone hasn't landed with a clear GameError,
// and legalMoves never offers them early.
// ---------------------------------------------------------------------------

export type WarbleMove =
  // -- creation (M1)
  | {
      type: 'create_character';
      character_name: string;
      race: Race;
      ship_name: string;
      /** 'recommended' = 3/2/1; 'distribute' = 6 points, max 3 per score (ruling #1);
       *  'archetype' = a named pre-built card with a printed difficulty (amendment A21). */
      method: 'recommended' | 'distribute' | 'archetype';
      /** Required for recommended/distribute; ignored for archetype (the card defines them). */
      scores?: AbilityScores;
      /** Required for archetype: the printed card name (case/spacing-tolerant). */
      archetype_name?: string;
      disposition?: Disposition;
    }
  // -- at habitat (M1)
  | { type: 'buy_item'; item_name: string }
  | { type: 'equip_item'; item_name: string; being: string } // being: character name or crew name
  | { type: 'attempt_recruit'; recruit_name: string }
  | { type: 'release_crew'; crew_name: string }
  | { type: 'attempt_repair' }
  | { type: 'pay_repair' } // amendment A1: 150c raises the ship one level, repeatable
  | { type: 'recruit_unnamed' } // amendment A10: once per habitat, 3d6 + DIP vs 12 → +1 unnamed crew
  | { type: 'recruit_survivors' } // amendment A10: after a space victory, 3d6 + DIP vs 12 → +1 unnamed crew
  | { type: 'upgrade_item'; item_name: string } // amendment A16 Tinker: 200c, +1 to an owned weapon/armor, once per item
  | { type: 'fabricate_part'; stat: 'speed' | 'handling' | 'armor' } // amendment A18 Shipwright: 400c, +1 ship stat, once per habitat visit
  | { type: 'redline' } // amendment A20: once per encounter, MEC check → +2 player exchange totals
  | { type: 'sacrifice_unnamed' } // amendment A14a: spend a red shirt — the failed hazard counts as survived
  | { type: 'decline_sacrifice' } // amendment A14a: let the consequence land as rolled
  | { type: 'attempt_reduce_unrest' }
  | { type: 'take_mission'; mission_name: string }
  | { type: 'depart_for_next_habitat' }
  // -- reports (M1+; the human's physical randomness)
  | { type: 'report_roll'; dice: number[] }
  | { type: 'report_card_draw'; card: string }
  // Digital mode (docs/digital-mode.md): the randomness button for a digital
  // human — no payload; the server rolls the dice / deals the card when it is
  // pressed. Legal ONLY for a digital human with a roll or card_draw pending.
  | { type: 'resolve_report' }
  | { type: 'report_res_discard'; card: string }
  | { type: 'skip_res_peek' } // the peek is OPTIONAL ("you can look", WR §4) — post-port §5 finding
  // -- pendings resolution (M2)
  | { type: 'use_item'; item_name: string; ability?: AbilityId } // declare on the open roll pending; ability for 'ANY' consumables
  | {
      type: 'choose_hazard_option';
      option: 1 | 2;
      /** WHOSE score carries the roll (character/crew name) — the carrier faces a
       * Brawn hazard's death risk (WR §10). Defaults to the best score aboard. */
      carrier?: string;
    }
  | { type: 'accept_mission'; option: 1 | 2 }
  | { type: 'decline_mission' }
  | { type: 'decline_recruit' }
  | { type: 'level_up'; ability: AbilityId }
  // -- space combat (M3)
  | { type: 'attempt_evade' } // A5: Running Silent — before the encounter starts
  | { type: 'decline_evade' } // A5: engage instead
  | { type: 'attempt_escape' }
  | { type: 'attempt_hack' }
  | { type: 'open_fire' } // A6: Opening Volley — once per encounter
  | { type: 'attempt_intimidate' } // A7: Stand Down or Burn
  | { type: 'fight_round' }
  | { type: 'use_reroll' }
  | { type: 'accept_result' } // decline the Flying Ace reroll and take the loss (catalog addition, PORT-NOTES)
  | { type: 'board_ship' }
  | { type: 'leave_pirate' }
  | { type: 'take_ship' }
  | { type: 'abandon_ship' }
  // -- ruins (M4)
  | { type: 'enter_ruin'; depth: RuinDepth }
  | { type: 'skip_ruin' }
  | {
      type: 'setup_encounter';
      crew_names: string[]; // may be empty; character optional too (WR §14)
      include_character: boolean;
      /** A10: how many unnamed crew join (default: all of them). */
      unnamed_count?: number;
      start_location: string; // an S cell, "r9c1" (or "bottom-left" etc.)
      threat_level: 1 | 2 | 3;
      attacker_placements: string[]; // exactly 3 distinct A cells
    }
  | { type: 'move_being'; being: string; to: string } // server validates a legal orthogonal path within remaining movement
  | { type: 'attack'; being: string; target: string }
  | { type: 'collect_item'; being: string }
  | { type: 'recruit_at'; being: string }
  | { type: 'convert_attacker'; being: string; target: string } // DIP (WR §4)
  | { type: 'escape_to_start'; being: string }
  | { type: 'end_being_turn'; being: string };

export interface WarbleOptions {
  seed?: number;
}
