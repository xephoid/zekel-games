// Neither Guts nor Gears — the choice catalog (core/choiceCatalog.ts).
//
// Every decision the printed rules give a player (PORT-PLAN §5 C1–C33). The
// port's discipline: anything marked player reaches a HUMAN through a pending
// or a move field — never settled silently. AI-internal policy is the
// ai-development gate's annotation, not the port's.

import type { PlayerChoice } from '@zekel/game-kit';

export const NGG_CHOICES: PlayerChoice[] = [
  // ---- Setup ----
  { id: 'faction', description: 'Which faction you play', owner: 'player', when: 'setup', resolvedBy: ['choose_faction', 'assign_setup_choices'], balanceAxis: 'faction' },
  { id: 'leader', description: 'Which species-eligible hero leads you', owner: 'player', when: 'setup', resolvedBy: ['choose_leader'], balanceAxis: 'leader' },
  { id: 'starting-location', description: 'Which numbered start your Leader + base take', owner: 'player', when: 'setup', resolvedBy: ['choose_starting_location'] },

  // ---- Upkeep / economy ----
  { id: 'upkeep-core-reallocation', description: 'Whether/how to reallocate owned Cores among platforms', owner: 'player', when: 'in-game', resolvedBy: ['reallocate_cores'], dependsOn: 'robot seat owning a Core and a platform or collector to hold it — asked at every upkeep' },
  { id: 'planning-card-or-pass', description: 'Which action card to place (or pass, final) each planning round', owner: 'player', when: 'in-game', resolvedBy: ['plan_action'] },
  { id: 'skip-queued-action', description: 'Whether to decline a queued action even when one is legal', owner: 'player', when: 'in-game', resolvedBy: ['skip_action'] },
  { id: 'build-purchase', description: 'What to buy on a Build action', owner: 'player', when: 'in-game', resolvedBy: ['build'] },
  { id: 'build-payment', description: 'Collector payment placements for a purchase (incl. surplus)', owner: 'player', when: 'in-game', resolvedBy: ['build'] },
  { id: 'collection-access', description: 'Grant or refuse a cross-player collection access request', owner: 'player', when: 'in-game', resolvedBy: ['respond_access_request'], dependsOn: 'another player proposes collecting from your location' },
  { id: 'foreman-second-purchase', description: "Foreman's optional second Build purchase + its payment", owner: 'player', when: 'in-game', resolvedBy: ['build', 'skip_action'], dependsOn: 'Foreman alive and placed', distinguishedBy: 'second_purchase' },
  { id: 'spawn-base', description: 'Which owned base spawns a new unit', owner: 'player', when: 'in-game', resolvedBy: ['build'], distinguishedBy: 'at_base' },
  { id: 'research-kind', description: 'Research a technology vs buy a battle card; which technology; ether-vs-oil leg of the card cost', owner: 'player', when: 'in-game', resolvedBy: ['research'] },
  { id: 'kettering-second-purchase', description: "Kettering's optional second Research purchase", owner: 'player', when: 'in-game', resolvedBy: ['research', 'skip_action'], dependsOn: 'Kettering alive and placed', distinguishedBy: 'second_purchase' },
  { id: 'smyth-reward', description: "Smyth's waived-cost technology pick", owner: 'player', when: 'in-game', resolvedBy: ['research'], dependsOn: 'Smyth claimed and placed' },
  { id: 'chaimidious-draw', description: "Chaimidious's battle-card draw — physical seat reports the drawn card; digital presses Draw (a randomness reveal, not a decision)", owner: 'player', when: 'in-game', resolvedBy: ['report_draw', 'resolve_report'], dependsOn: 'Chaimidious claimed' },

  // ---- Movement / battle entry ----
  { id: 'move-set', description: 'Move/Battle: origin, destination, which units move', owner: 'player', when: 'in-game', resolvedBy: ['move_units'] },
  { id: 'elara-spell', description: "Elara's pre-movement spell: cast or not, target space", owner: 'player', when: 'in-game', resolvedBy: ['cast_elara_spell'], dependsOn: 'Elara in play' },

  // ---- Battle ----
  { id: 'battle-commitment', description: 'Commit one eligible battle card or no card (secret until all commit)', owner: 'player', when: 'in-game', resolvedBy: ['commit_battle_card'], dependsOn: 'a battle you participate in' },
  { id: 'counter-target', description: "The Counter's target (chosen at resolution by the card's playing player)", owner: 'player', when: 'in-game', resolvedBy: ['choose_counter_target'], dependsOn: 'you played a Counter' },
  { id: 'extra-selection', description: "Extra's 0–2 additional cards (playing player, chosen+revealed together)", owner: 'player', when: 'in-game', resolvedBy: ['select_extra_cards'], dependsOn: 'you played an Extra that survived Counters' },
  { id: 'allied-initiative-tie', description: 'Tied allied units order (agreement / earlier-FPO-owner fallback)', owner: 'player', when: 'in-game', resolvedBy: ['choose_initiative_order', 'battle_activation'], dependsOn: 'allied units tie on initiative', why: 'Printed fallback assigns the pick to the earlier first-player-order owner; table agreement is table talk, not a server move' },
  { id: 'unit-activation', description: "Each unit's activation: attack + target / ability / spy reveal / pass", owner: 'player', when: 'in-game', resolvedBy: ['battle_activation'], dependsOn: 'your unit in a battle' },
  { id: 'defenses', description: 'Per-attack defenses: Decoy reveal? Mana Shield amount? Cleric save (which, whom)?', owner: 'player', when: 'in-game', resolvedBy: ['resolve_battle_defense'], dependsOn: 'an attack hits your unit' },
  { id: 'retreat', description: 'After a pass with both sides alive: retreat/stay, and the one destination', owner: 'player', when: 'in-game', resolvedBy: ['choose_retreat'], dependsOn: 'a battle you participate in' },
  { id: 'rally-units', description: 'Which adjacent units Rally moves into the battle', owner: 'player', when: 'in-game', resolvedBy: ['select_rally_units'], dependsOn: 'a Rally card you play' },

  // ---- Treaties ----
  { id: 'treaty-formation', description: 'Propose a treaty (pair + type) / accept or decline an offer', owner: 'player', when: 'in-game', resolvedBy: ['form_treaty', 'respond_treaty'], dependsOn: 'a treaty-unlock on one partner and a legal window' },
  { id: 'treaty-breaking', description: 'Whether/when to break a treaty within its condition', owner: 'player', when: 'in-game', resolvedBy: ['break_treaty'], dependsOn: 'an active treaty of yours in a legal break window' },

  // ---- Heroes ----
  { id: 'milestone-claim', description: 'Which hero each milestone claim takes', owner: 'player', when: 'in-game', resolvedBy: ['choose_milestone_hero'], dependsOn: 'a crossed culture milestone' },
  { id: 'reserved-hero-placement', description: 'Placing a reserved hero once a base exists', owner: 'player', when: 'in-game', resolvedBy: ['place_reserved_hero'], dependsOn: 'a reserved hero and a new base' },
  { id: 'overlay-arbitration', description: 'Two Economy heroes on one tile: which overlay is active', owner: 'player', when: 'in-game', resolvedBy: ['resolve_overlay_choice'], dependsOn: 'two Economy heroes share a tile' },
  { id: 'spy-assignment', description: 'Which owned hero carries the spy after an Illusionist/Infiltrator recruitment (seat-private)', owner: 'player', when: 'in-game', resolvedBy: ['choose_spy'], dependsOn: 'you recruit a spy unit' },

  // ---- Randomness ----
  { id: 'setup-first-player', description: 'Setup first player (server seeded RNG; the table may report instead)', owner: 'auto', when: 'setup', resolvedBy: ['options.setupFirstPlayerId'], why: 'The rulebook says "randomly select"; the server\'s seeded RNG is the default (PORT-PLAN PHYS-FIRST-COIN-FLIP disclosure) — a table report option exists for Zeke to flip on' },

  // ---- AI-internal ----
  { id: 'ai-policy', description: 'AI purchase/target/policy choices', owner: 'auto', when: 'in-game', resolvedBy: [], why: 'The AI brain decides its own seats; the human is never asked to decide for an AI' },
];

/**
 * §7 AI-policy annotation (ai-development gate, rebuilt 2026-09-24). Every
 * player-owned choice above has a real AI policy. One measure decides almost
 * all of them: the seat's chance of winning (ai-eval.ts), read from how many
 * rounds each seat needs to win by culture, technology, the Economic spend
 * (ai-econ.ts) or a Leader kill (ai-military.ts). An option is tried with the
 * engine and the position it leaves is read; doing nothing is always one of
 * the options.
 *
 * | Choice id | AI policy |
 * |---|---|
 * | faction | engine autoAssign (species is the mechanical side); scripted via factionAssignment in balance runs |
 * | leader | aiPickLeaderId — the Leader whose effect gets the seat's economy to a win soonest (printed costs, no map yet), a small bonus for a sturdier military Leader and for Rook/Kestrel's damage; a strategy seat judges by its own path; easy drafts at random (seeded) |
 * | starting-location | aiPickLocationId — the start the seat's economy runs fastest from (its real map reach), a little credit for distance from other bases; easy picks at random (seeded) |
 * | upkeep-core-reallocation | each arrangement tried; the one with the best chance |
 * | planning-card-or-pass | roundPlan: a card goes down only if its best use this round beats doing nothing; laid in reverse of the order it should resolve (Research first, then Build, Move/Battle last) |
 * | skip-queued-action | a queued card is skipped only when the plan's use for it vanished (rare: another seat took the tiles) |
 * | build-purchase | every legal purchase tried; own follow-ups (spy carrier, Foreman's second buy) answered before judging |
 * | build-payment | the engine's own payment search (the menu's payment) |
 * | collection-access | granting is tried: refuse unless the rival's purchase doesn't help them against me |
 * | foreman-second-purchase | judged together with the first purchase (the pair is read) |
 * | spawn-base | each legal base tile tried |
 * | research-kind | technologies tried like purchases; a battle card only when a fight is coming (a Leader-killer near my Leader, or my own damage-line attack) |
 * | kettering-second-purchase | judged with the first research |
 * | smyth-reward | each free technology tried |
 * | chaimidious-draw | always settled |
 * | move-set | the six most promising quiet moves (nearer a target, new collector ground, not toward a threat) tried; a quiet move must beat staying put; entering an opposing space judged as a kill attempt: spy or damage line, a guarded Leader (Decoy, a defender's spy that strikes first) is not attacked |
 * | elara-spell | each target tried; skip on a tie |
 * | battle-commitment | ai-battle.ts commitScore: Retreat only when losing or the Leader could die, Bonus/Initiative when they help |
 * | counter-target | ai-battle.ts counterScore: the opponent's highest-value card, never my own |
 * | extra-selection | ai-battle.ts extraScore: Initiative/Bonus/Rally only |
 * | allied-initiative-tie | the spy carrier or the hardest hitter first |
 * | unit-activation | ai-battle.ts activationScore: a spy reveal only on a hero (the Leader above all); only killing hits; area attacks by kills landed |
 * | defenses | ai-battle.ts defenseScore: a defense only against a lethal hit; Mana Shield spends just enough |
 * | retreat | ai-battle.ts retreatScore: leave when my Leader could die or they kill more |
 * | rally-units | never rally the Leader into danger; bring bodies when outnumbered |
 * | treaty-formation | an offer must raise my chance and give the partner a reason to accept; no offer to a seat that refused me this round or last; an answer is the treaty tried |
 * | treaty-breaking | the break tried; kept unless breaking clearly helps |
 * | spy-assignment | each carrier tried: on the Leader it guards (Decoy), on a hero near a target it strikes |
 *
 * No in-game choice falls back to a degenerate default. The easy tier is the
 * seeded uniform-random floor over the same live pool.
 */
