import type {
  AIMoveResult,
  ApplyMoveResult,
  BalanceAxis,
  Game,
  GameResult,
  LegalMove,
  NextStep,
  PlayerConfig,
  SessionState,
  SetupStep, PlayerChoice,
} from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { ABILITY_NAMES, ABILITY_STAT, HAZARD_CONSEQUENCE_BY_STAT, RACE_IDEALIZED, STAT_ABILITIES } from './data/abilities.js';
import { CLUB_MISSIONS, DIAMOND_PIRATES, DIAMOND_RUINS, HEART_RECRUITS, SPADE_HAZARDS } from './data/travelTables.js';
import { HABITATS } from './data/habitats.js';
import { PRINTED_LEVEL_TABLE } from './data/levels.js';
import { RUIN_MAPS } from './data/ruins.js';
import { ARCHETYPES } from './data/archetypes.js';
import { applyMove as engineApply, createInitialState } from './engine.js';
import { getLegalMoves as legal } from './legalMoves.js';
import { getView } from './views.js';
import { chooseMove, parseStrategy, parseTier } from './ai.js';
import { randomInt, rollDice } from './rng.js';
import { DM_VOICE } from './voice.js';
import type { WarbleMove, WarbleOptions, WarbleWayGalaxyState } from './types.js';
import { WARBLE_CHOICES } from './choices.js';
import { loreResources, loreTools } from './lore.js';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: {
      type: 'integer',
      minimum: 0,
      description: 'RNG seed for the solvability bot (harness runs). Unused in real play — the player rolls their own dice.',
    },
  },
} as const;

// The full move catalog is PORT-PLAN §6; milestones M2–M4 kinds are declared
// there and rejected until built. The schema documents the LIVE (M1) kinds.
const moveSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['type', 'character_name', 'race', 'ship_name', 'method'],
      properties: {
        type: { const: 'create_character' },
        character_name: { type: 'string' },
        race: { enum: ['human', 'kralkin', 'hexapod', 'grull'] },
        ship_name: { type: 'string' },
        method: { enum: ['recommended', 'distribute', 'archetype'], description: 'recommended = one 3, one 2, one 1; distribute = 6 points, max 3 per ability; archetype = a named pre-built card with a printed difficulty (A21)' },
        scores: { type: 'object', description: 'ability id -> points, e.g. { "SWA": 3, "HAK": 2, "SNE": 1 } — required for recommended/distribute, ignored for archetype' },
        archetype_name: { type: 'string', description: 'for method=archetype: the printed card name, e.g. "Ghost Smuggler" — get_legal_moves lists every card with its difficulty' },
        disposition: { enum: ['brash', 'risk_averse'], description: 'optional roleplay hint — never a rule' },
      },
    },
    { type: 'object', required: ['type', 'item_name'], properties: { type: { const: 'buy_item' }, item_name: { type: 'string', description: 'the printed shop label, e.g. "Weapon +1 GUN"' } } },
    { type: 'object', required: ['type', 'item_name', 'being'], properties: { type: { const: 'equip_item' }, item_name: { type: 'string' }, being: { type: 'string', description: 'character name or crew member name' } } },
    { type: 'object', required: ['type', 'recruit_name'], properties: { type: { const: 'attempt_recruit' }, recruit_name: { type: 'string', description: 'the cantina row as described in get_legal_moves' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'attempt_evade' }, description: { const: 'A5 Running Silent: 3d6 + SNE vs 10 + pirate speed, before the encounter; failure just starts the normal fight' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'decline_evade' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'open_fire' }, description: { const: 'A6 Opening Volley (needs GUN, once per encounter): 3d6 + GUN vs 12; success = −2 pirate exchange totals; failure = unopposed hit' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'attempt_intimidate' }, description: { const: 'A7 Stand Down or Burn (needs DEM): 3d6 + DEM vs 10 + pirate space attack; success = they break off; failure = unopposed hit' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'redline' }, description: { const: 'A20 Redline (needs MEC, once per encounter): 3d6 + MEC vs 12; success = +2 to YOUR exchange totals this combat; failure = unopposed hit' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'attempt_repair' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'pay_repair' }, description: { const: 'pay 150c: raise the ship one damage level; repeatable; may go into debt but never to −300' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'recruit_unnamed' }, description: { const: 'A10, once per habitat (needs DIP): 3d6 + DIP vs 12 — success signs one UNNAMED crew hand (a body: no scores/gear/slot; cap = best natural DIP)' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'recruit_survivors' }, description: { const: 'A10, after a space victory (needs DIP, once per victory): 3d6 + DIP vs 12 — success signs one UNNAMED crew hand' } } },
    { type: 'object', required: ['type', 'item_name'], properties: { type: { const: 'upgrade_item' }, item_name: { type: 'string', description: 'A16 Tinker (needs natural MEC 3, at a habitat): 200c — the owned weapon/armor becomes MK-II (+1 bonus, once per item)' } } },
    { type: 'object', required: ['type', 'stat'], properties: { type: { const: 'fabricate_part' }, stat: { enum: ['speed', 'handling', 'armor'], description: 'A18 Shipwright (needs natural MEC 3, at a habitat): 400c — fabricate a +1 ship part; once per habitat visit' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'sacrifice_unnamed' }, description: { const: 'A14a: spend one unnamed crew hand — the failed hazard counts as survived' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'decline_sacrifice' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'attempt_reduce_unrest' } } },
    { type: 'object', required: ['type', 'crew_name'], properties: { type: { const: 'release_crew' }, crew_name: { type: 'string' } } },
    { type: 'object', required: ['type', 'dice'], properties: { type: { const: 'report_roll' }, dice: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 6 }, description: 'the player\'s actual dice, exactly as rolled — count given by next_step (a digital seat presses resolve_report instead)' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'resolve_report' }, description: { const: 'DIGITAL seats only: the Roll / Draw button — the server rolls the dice or deals the card when you press this. No payload.' } } },
    { type: 'object', required: ['type', 'item_name'], properties: { type: { const: 'use_item' }, item_name: { type: 'string' }, ability: { type: 'string', description: 'for "+Any" consumables: which ability it boosts (must match the open roll)' } } },
    { type: 'object', required: ['type', 'ability'], properties: { type: { const: 'level_up' }, ability: { type: 'string', description: 'odd levels: an ability you already have ≥1 in; EVEN levels may instead open a new ability at 1 (amendment A3)' } } },
  ],
  description:
    'The creation + habitat surface, shown in full. Travel/combat/ruins moves (report_card_draw, choose_hazard_option, accept_mission, ' +
    'attempt_escape/hack/fight_round, setup_encounter, move_being, attack, ...) follow the same shape conventions — get_legal_moves is ' +
    'always the authoritative list, and next_step names the exact move a pending needs.',
} as const;

const sessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. This is a SOLO tabletop RPG. The player has physical six-sided dice, their own 52-card deck (jokers removed), and a printed character/ship/crew sheet. The server is the strict rules engine and bookkeeper; YOU are the game master — narrate the Warble Way Galaxy, voice its inhabitants, and make mechanical events feel like a story.

2. THE DM CONTRACT: color is ADDITIVE, mechanics are EXACT. Relay every number, cost, credit, XP value, damage level and token from each tool response's state_summary — completely — THEN add your in-world color. Never invent stats, prices, table entries, dice results, or outcomes; the server computes all of those.

3. GROUND STORY IN THE LORE: call get_lore (no arguments = topic index) before narrating a race, faction, place, or NPC for the first time. Each get_state carries lore_refs naming the topics currently in play. Never contradict a lore entry; if the lore is silent, keep color generic.

4. THE DICE AND CARDS BELONG TO THE PLAYER. When next_step asks for a roll, ask the player to roll exactly that many d6 and report the values — never roll for them, never assume. Dramatize the outcome AFTER the server rules on it.

5. CHARACTER CREATION IS THE PLAYER'S: walk the setup_checklist — ask their character name, race (human / kralkin / hexapod / grull), ship name, ability scores (recommended: one 3, one 2, one 1 — or distribute 6 points, max 3 each), and optionally a disposition (brash / risk-averse — a roleplay hint for you and them, never a rule). Never pick for them.

6. TURN STRUCTURE: exactly ONE action per apply_move. At a habitat the player may recruit, buy, equip, take missions, repair (once per arrival), ease unrest (once per arrival) — in any order; departing or taking a mission launches them into space. Obey next_step; get_legal_moves is the authoritative list of what is possible right now. Consumable items are declared BEFORE the roll they boost (use_item while the roll is open).

7. SPACE TRAVEL runs on the player's own 52-card deck: next_step asks for each drawn card; the server resolves it (recruits, hazards, missions, pirates, ruins). NEVER invent a card or a table result. In RUIN encounters, relay the board from get_state.ruin.board_rows each round so the player can mirror the physical map; moves are declared as cells ("r5c3") and the server validates paths, range and line of sight.

8. THE STAKES ARE REAL: the game ends in defeat on death, a destroyed ship, or debt beyond 300 credits — and in VICTORY five ways (amendment A11): CONQUEST (the great ruin beyond Habitat #3), FORTUNE (6,000c banked at a habitat), LEGEND (reach level 5), PLUNDER (open 6 ruin caches), BOUNTY (defeat 8 foes face to face — boarding captures and ruin kills). The season_endings block in get_state tracks all five. Report game-over results plainly, then give the season its ending.`;

// Digital variant (docs/digital-mode.md): voice-only / no-tablet play. The
// player owns no physical dice or deck — the server rolls and draws; the human
// presses a button to trigger. Narration contract and lore stay identical.
const digitalSessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. DIGITAL SOLO SESSION: the player has NO physical dice and NO physical deck. The server holds the 52-card travel deck (shuffled) and rolls all dice when they press a button. You are the game master AND the interface — narrate the Warble Way Galaxy, voice its inhabitants, and make the world's events a story.

2. THE DM CONTRACT: color is ADDITIVE, mechanics are EXACT. Relay every number, cost, credit, XP value, damage level, and token from each tool response's state_summary — completely — THEN add your in-world color. Never invent stats, prices, table entries, dice results, or outcomes; the server computes all of those.

3. GROUND STORY IN THE LORE: call get_lore before narrating a race, faction, place, or NPC for the first time. Each get_state carries lore_refs. Never contradict a lore entry; if silent, keep color generic.

4. THE ROLL/DRAW BUTTON: when a roll or a card draw is owed, the legal move resolve_report IS the button. The player says "roll" / "draw" / "go" and presses it; the server rolls or draws from its tracked deck and the result appears in the response. NEVER roll silently; never tell the player the number before they press. Consumable items are still declared BEFORE the roll (use_item while the roll pending is open) — the player can buff a roll before committing to the button.

5. CHARACTER CREATION IS THE PLAYER'S: see setup_checklist. Ask name, race (human / kralkin / hexapod / grull), ship name, ability scores, optional disposition. Never pick for them.

6. TURN STRUCTURE: one action per apply_move. Obey next_step.

7. SPACE TRAVEL: the server draws cards one at a time and resolves them on the travel tables. The player never draws physically; the deck is server-owned and shown to them per-draw via the pending resolution. In RUINS, relay get_state.ruin.board_rows each round so they can visualize the board; moves are declared as cells ("r5c3").

8. THE STAKES ARE REAL: the season ends in defeat on death, a destroyed ship, or debt beyond 300 credits — and in VICTORY five ways: CONQUEST, FORTUNE (6,000c banked), LEGEND (level 5), PLUNDER (6 ruin caches), BOUNTY (8 face-to-face defeats). Report game-over results plainly, then give the season its ending.`;

// Player-facing rules only — the public rules page renders this verbatim. The
// agent's DM briefing lives in sessionStartGuidance (getSessionStartGuidance).
const rulesText = `\
Warble Way Galaxy — Season 1 rules reference (canonical: WARBLE-RULES.md, frozen 2026-07-07)

CHECKS: roll 3d6 + your ability score; meet or beat the minimum. Extra dice (ACT skill, consumables) are added to the sum.

STATS & ABILITIES: Brawn (SWA Swashbuckling / ARM Armor / DEM Demolitions) — Humans idealize it; Smarts (HAK Hacking / RES Research / MEC Mechanics) — Hexapods; Finesse (PIL Piloting / GUN Gunslinging / SNE Sneaking) — Grull; Moxie (LEA Leadership / DIP Diplomacy / ACT Acting) — Kralkin. Score >=1 grants the basic skill; a NATURAL score >=3 grants the advanced skill (item boosts don't count).

CHARACTER CREATION: race + name (no mechanical effect), ship name, scores (3/2/1 recommended, or distribute 6 points max 3 each), optional disposition. Start: 200 credits, level 1, 0 XP, ship capacity 3 / speed 0 / handling 0 / armor 0 / damage Used, at Habitat #1 (Xaxalon 4).

HABITATS: recruit (cantina; roll 3d6 + your best score under the recruit's idealized stat vs their minimum; ACT adds a d6 for Hexapods/Kralkin; a failed cantina attempt is permanently marked), buy items (one-shot per shop row; consumables are one-use and declared before a roll; one weapon + one armor per being; ship parts stack), take missions (one attempt each; travel = deal distance−speed cards per direction face-down, resolve one at a time on the travel tables), repair (once per arrival: 3d6+MEC vs 12 = +1 damage level), ease unrest (once per arrival: 3d6+LEA vs 12 = remove one anger token from each crew member). Ship capacity includes you; over capacity, someone must go.

SPACE: ♥ = a recruit adrift (optional, no mark on failure). ♠ = a hazard (choose an option you have; neither → pick which you FAIL; consequences by stat group: Brawn death / Smarts −100c / Finesse ship damage / Moxie crew anger; +1 XP for surviving). ♣ = mission offers (sandwich on top of the current journey). ♦ 2–9 = PIRATES (mandatory: escape, hack, or fight — 4d6 pairing, advantage = PIL skill or ship part; win → board and maybe capture the ship, which arrives Hobbled). ♦ 10/J/Q/K/A = ruins discoveries (optional).

RUINS: multi-level (always start at the R1 map); per level choose party, entrance, threat 1-3, and where the 3 attackers stand. Rounds: your beings first (Move 3+SNE orthogonal + one Act: attack 4d6-pairing at range GUN+2/DEM/1 with straight line of sight, open a cache, approach a figure, or DIP-convert an attacker), then attackers close in. Reaching the goal ends the level instantly; at your target depth the run is complete. The Season 1 FINALE is a full depth-3 run beyond Habitat #3 — completing it WINS the game.

LEVELING: at 6/12/24/48 XP (doubling beyond), +1 to an ability you already have >=1 in, then subtract the threshold.

LOSSES: character death (a second failed 3d6-under-9 death check while WOUNDED — A4), ship destroyed (below Hobbled), debt beyond 300c, marooned. WINS (Season 1, amendment A11 — five endings): CONQUEST — after Habitat #3, complete the full depth-3 ruin; FORTUNE — 6,000c banked while at a habitat; LEGEND — reach character level 5; PLUNDER — open 6 ruin caches (empty or full) across the run; BOUNTY — defeat 8 foes FACE TO FACE (boarding captures + ruin attackers slain; disables, intimidations and conversions do not count).

reference_data carries every table: travel tables (by playing-card), habitat pages, ruins stats, level table.`;

function firstSeat(state: SessionState<WarbleWayGalaxyState>): PlayerConfig {
  return state.players[0]!;
}

export class WarbleWayGalaxyGame implements Game<WarbleWayGalaxyState, WarbleMove, WarbleOptions> {
  readonly id = 'warble-way-galaxy';
  readonly name = 'Warble Way Galaxy';
  readonly description =
    'A solo sci-fi tabletop RPG (Season 1): build a character and crew, fly missions between habitats, ' +
    'survive hazards, pirates and ancient ruins. The player rolls their own dice and draws their own cards; ' +
    'the server is the strict rules engine and the LLM client is the game master, grounding its story in the get_lore repository.';
  readonly minPlayers = 1;
  readonly maxPlayers = 1;
  readonly supportsAI = true; // the solvability bot (harness); real play is a human seat
  readonly hasHiddenInformation = true; // the player's physical travel deck order
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;
  // The DM voice: apply_move resolves outcomes the solo player can't see, so
  // its report_to_human demands a full relay (then invites lore-grounded
  // color) instead of the board default's brief confirm.
  readonly reportVoice = DM_VOICE;

  createSession(players: PlayerConfig[], options?: WarbleOptions): SessionState<WarbleWayGalaxyState> {
    if (players.length !== 1) {
      throw new GameError('INVALID_PLAYERS', `Warble Way Galaxy is a solo game — exactly 1 player; got ${players.length}.`);
    }
    const initial = createInitialState(players, options);
    return {
      sessionId: '',
      gameId: this.id,
      players,
      activePlayerId: players[0]!.player_id,
      turnNumber: 1,
      gameState: initial,
      moveLog: [],
      createdAt: new Date().toISOString(),
    };
  }

  getLegalMoves(state: SessionState<WarbleWayGalaxyState>, playerId: string): LegalMove<WarbleMove>[] {
    if (playerId !== firstSeat(state).player_id) return [];
    return legal(state.gameState, playerId);
  }

  getPublicView(state: SessionState<WarbleWayGalaxyState>): unknown {
    return getView(state.gameState);
  }
  getPlayerView(state: SessionState<WarbleWayGalaxyState>): unknown {
    // Solo: nothing server-side is hidden from the player.
    return getView(state.gameState);
  }

  isGameOver(state: SessionState<WarbleWayGalaxyState>): GameResult | null {
    const r = state.gameState.result;
    if (!r) return null;
    const seat = firstSeat(state).player_id;
    return {
      game_over: true,
      winners: r.winner === 'player' ? [seat] : [],
      scores: { [seat]: state.gameState.character?.credits ?? 0 },
      summary: r.summary,
    };
  }

  applyMove(state: SessionState<WarbleWayGalaxyState>, playerId: string, move: WarbleMove): ApplyMoveResult<WarbleWayGalaxyState> {
    if (playerId !== firstSeat(state).player_id) {
      throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this solo session.`);
    }
    const result = engineApply(state.gameState, move);
    return {
      newState: { ...state, gameState: result.newState, turnNumber: state.turnNumber + 1 },
      summary: result.summary,
    };
  }

  async getAIMove(
    state: SessionState<WarbleWayGalaxyState>,
    playerId: string,
    difficulty?: string,
    strategy?: string,
  ): Promise<AIMoveResult<WarbleMove>> {
    return chooseMove(state.gameState, playerId, parseTier(difficulty), parseStrategy(strategy));
  }

  // Several of this game's legal moves are fill-in skeletons a PERSON completes:
  // create_character wants a name, report_roll wants the dice you actually
  // rolled, move_being wants a destination (ai.ts `isFillIn` lists them all).
  // A test harness driving the human seat therefore cannot submit anything the
  // engine accepts — it got stuck on move one. This exposes the AI's own filled
  // -in choice for that purpose, exactly as the hook is meant to be used.
  // NOT used in real play: a real player supplies their own values.
  getSuggestedMove(
    state: SessionState<WarbleWayGalaxyState>,
    playerId: string,
  ): { move: WarbleMove } | null {
    return { move: chooseMove(state.gameState, playerId, parseTier('medium'), parseStrategy(undefined)).move };
  }

  getScoreboard(state: SessionState<WarbleWayGalaxyState>): Record<string, Record<string, number>> {
    const seat = firstSeat(state).player_id;
    const s = state.gameState;
    const char = s.character;
    const damageLevel = s.ship ? { hobbled: 0, damaged: 1, used: 2, pristine: 3 }[s.ship.damage] : 0;
    return {
      [seat]: {
        credits: char?.credits ?? 0,
        xp: char?.xp ?? 0,
        level: char?.level ?? 0,
        crew: s.crew.length,
        habitat: s.current_habitat,
        ship_damage_level: damageLevel,
      },
    };
  }

  describeNextStep(state: SessionState<WarbleWayGalaxyState>): NextStep | null {
    const s = state.gameState;
    const seat = firstSeat(state);
    if (seat.kind !== 'human') return null; // the bot resolves its own pendings
    const pid = seat.player_id;
    // Digital mode (docs/digital-mode.md): a digital human presses a button
    // for randomness; physical wording stays untouched.
    const seatDigital = seat.table === 'digital';

    if (s.phase === 'creation') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'CHARACTER CREATION — walk the setup_checklist and ASK the player for each value (never pick for them): ' +
          'character name, race (human/kralkin/hexapod/grull — get_lore has each race\'s story), ship name, ability scores ' +
          '(recommended: one 3, one 2, one 1; or distribute 6 points, max 3 per ability; OR an archetype card — a pre-built ' +
          'spread with a printed difficulty from Easy ★ to Brutal ★★★★, listed with spreads in get_legal_moves), and optionally ' +
          'a disposition (brash / risk-averse — a roleplay hint). OFFER the archetype cards to a new player. ' +
          'Then submit ONE create_character move with their answers.',
        human_response: {
          ask: 'your character\'s name, race, ship name, ability scores (e.g. SWA 3 / HAK 2 / SNE 1) or an archetype card, and optional disposition',
          example: 'Zara, human, ship "Wandering Star", the Ghost Smuggler card, brash',
          records_as: 'create_character with those values',
        },
        facts: {
          phase: 'Character creation',
          notes: [
            `Races: ${Object.keys(RACE_IDEALIZED).join(', ')}.`,
            'Recommended ability scores: one 3, one 2 and one 1.',
            'Or distribute 6 points, at most 3 in any one ability.',
            'Or take an archetype card: a pre-built spread with a printed difficulty from Easy ★ to Brutal ★★★★.',
            `Archetype cards: ${ARCHETYPES.map((a) => `${a.name} (${a.difficulty.charAt(0).toUpperCase()}${a.difficulty.slice(1)} ${a.stars})`).join(', ')}.`,
            'Disposition is optional: brash or risk-averse. It is a roleplay hint only.',
          ],
        },
      };
    }

    const pending = s.pending;
    if (pending?.kind === 'roll') {
      const forWhat = pending.reason.replace(/_/g, ' ');
      const score =
        pending.score_source.ability !== null
          ? `${pending.score_source.ability} +${pending.score_source.bonus} (${pending.score_source.who === 'self' ? 'their own' : pending.score_source.crew_name})`
          : 'no ability bonus';
      const rollNotes = [
        `${pending.dice_count}d6.`,
        ...(pending.min_roll !== null ? [`It needs ${pending.min_roll} or more.`] : []),
        pending.score_source.ability !== null
          ? `The roll adds ${pending.score_source.ability} (${ABILITY_NAMES[pending.score_source.ability]}) +${pending.score_source.bonus}, from ${pending.score_source.who === 'self' ? "the character's own score" : `${pending.score_source.crew_name}'s score`}.`
          : 'No ability bonus is added.',
        'A consumable item must be declared before the roll.',
      ];
      if (seatDigital) {
        return {
          status: 'human_to_move',
          active_player_id: pid,
          instruction:
            `DIGITAL SEAT — Press Roll for the ${forWhat}: ${pending.dice_count}d6${pending.min_roll !== null ? ` (needs ${pending.min_roll}+ with ${score})` : ''}. ` +
            `The server rolls when the button is pressed. Send resolve_report{} — do NOT invent or assume dice values. ` +
            `If the player wants to declare a consumable, use_item BEFORE pressing Roll.`,
          human_response: {
            ask: `press Roll for the ${forWhat} (${pending.dice_count}d6 — the server rolls)`,
            example: 'roll them for me',
            records_as: 'resolve_report{}',
          },
          facts: { reason: `A roll for the ${forWhat}.`, notes: [...rollNotes, 'The server rolls the dice.'] },
        };
      }
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          `ASK the player to roll ${pending.dice_count}d6 for the ${forWhat}${pending.min_roll !== null ? ` (needs ${pending.min_roll}+ with ${score})` : ''} ` +
          `and report the individual dice — do NOT invent or assume them. If they want to declare a consumable, use_item BEFORE the roll is reported. ` +
          `Submit apply_move { type: "report_roll", dice: [d, d, ...] } with exactly ${pending.dice_count} values.`,
        human_response: {
          ask: `roll ${pending.dice_count}d6 for the ${forWhat} and tell me each die`,
          example: `I rolled ${Array.from({ length: pending.dice_count }, (_, i) => (i % 6) + 1).join(', ')}`,
          records_as: `report_roll with the ${pending.dice_count} dice values`,
        },
        facts: { reason: `A roll for the ${forWhat}.`, notes: rollNotes },
      };
    }
    if (pending?.kind === 'level_up') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'LEVEL UP — the player chooses which ability gains +1 (must already be at least 1). ASK them; get_legal_moves lists the options. Never pick for them.',
        human_response: {
          ask: 'which of your abilities gets the +1?',
          example: 'put it in Piloting',
          records_as: 'level_up with the chosen ability',
        },
        facts: { phase: 'Level up', notes: ['The chosen ability must already be at least 1.'] },
      };
    }
    if (pending?.kind === 'release_crew') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'OVER CAPACITY — the ship cannot hold everyone; the player must choose a crew member to release (they take their equipped gear). ASK who goes; get_legal_moves lists the crew.',
        human_response: {
          ask: 'the ship is over capacity — which crew member do you let go?',
          example: 'release the Kralkin',
          records_as: 'release_crew with the chosen name',
        },
        facts: {
          reason: 'The ship is over capacity.',
          ...(s.crew.length > 0 ? { options: s.crew.map((c) => c.name) } : {}),
          notes: ['The released crew member takes their equipped gear.'],
        },
      };
    }
    if (pending?.kind === 'card_draw') {
      if (seatDigital) {
        return {
          status: 'human_to_move',
          active_player_id: pid,
          instruction:
            'SPACE TRAVEL, DIGITAL SEAT — Press Draw for the next travel card. The server deals it from the tracked deck when the button is pressed. ' +
            'Send resolve_report{} — do NOT invent or assume a card.',
          human_response: {
            ask: 'press Draw for the next travel card (the server deals it)',
            example: 'draw for me',
            records_as: 'resolve_report{}',
          },
          facts: { phase: 'Space travel', notes: ['The server deals the next travel card from the tracked deck.'] },
        };
      }
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'SPACE TRAVEL — ASK the player to draw the next card from THEIR physical travel deck and say which card it is. ' +
          'Do NOT invent or assume a card. Submit apply_move { type: "report_card_draw", card: "<their card>" } — "7♠", "7S", and "seven of spades" all work.',
        human_response: {
          ask: 'draw the next travel card from your deck — which card is it?',
          example: 'I drew the seven of spades',
          records_as: 'report_card_draw with that card',
        },
        facts: {
          phase: 'Space travel',
          notes: ["The card is drawn from the player's own travel deck.", 'A card can be named as "7♠", "7S", or "seven of spades".'],
        },
      };
    }
    if (pending?.kind === 'res_discard') {
      const resPeekNotes = [
        'The peek is optional.',
        'Peeking requires discarding one of the peeked cards.',
        'The rest go back in the same order.',
        'Declining leaves the deck unread.',
      ];
      if (seatDigital) {
        return {
          status: 'human_to_move',
          active_player_id: pid,
          instruction:
            `RESEARCH PEEK (optional), DIGITAL SEAT — the peeked cards are revealed in get_state.res_peek (top ${pending.peek_count} card(s)). Peeking REQUIRES discarding one of them ` +
            '(the rest go back in the same order) — report the discarded card via report_res_discard. Declining is fine: skip_res_peek leaves the deck unread.',
          human_response: {
            ask: `use your Research peek (top ${pending.peek_count} card(s), must discard one), or skip it?`,
            example: 'peek — I discard the four of diamonds',
            records_as: 'report_res_discard { card } or skip_res_peek',
          },
          facts: {
            phase: 'Research peek',
            notes: [`The top ${pending.peek_count} card(s) are revealed on screen.`, ...resPeekNotes],
          },
        };
      }
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          `RESEARCH PEEK (optional) — ASK the player: peek at the top ${pending.peek_count} card(s) of their travel deck? Peeking REQUIRES discarding one of them ` +
          '(the rest go back in the same order) — report the discarded card via report_res_discard. Declining is fine: skip_res_peek leaves the deck unread.',
        human_response: {
          ask: `use your Research peek (top ${pending.peek_count} card(s), must discard one), or skip it?`,
          example: 'peek — I discard the four of diamonds',
          records_as: 'report_res_discard { card } or skip_res_peek',
        },
        facts: {
          phase: 'Research peek',
          notes: [`The peek is at the top ${pending.peek_count} card(s) of the travel deck.`, ...resPeekNotes],
        },
      };
    }
    if (pending?.kind === 'hazard_option') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction: pending.must_fail
          ? 'HAZARD, no matching abilities — the player must PICK WHICH OPTION THEY FAIL (the consequence differs). ASK them; get_legal_moves shows both options with their consequences.'
          : 'HAZARD — the player chooses which ability option to roll, and (when several beings hold it) WHOSE score carries the roll — the carrier takes the consequence, which on a Brawn option can be lethal. ASK them; get_legal_moves lists the options. Omitting carrier uses the best score aboard.',
        human_response: {
          ask: pending.must_fail
            ? 'neither ability is aboard — which option do you fail?'
            : 'which hazard option do you roll — and whose score carries it (they face the consequence)?',
          example: 'option 1, using the Kralkin\'s score',
          records_as: 'choose_hazard_option with option 1|2 and optional carrier (a being\'s name)',
        },
        facts: pending.must_fail
          ? {
              phase: 'Hazard',
              reason: 'No being aboard has either ability.',
              options: ['option 1', 'option 2'],
              notes: ['The player picks which option to fail.', 'The two consequences differ.'],
            }
          : {
              phase: 'Hazard',
              options: ['option 1', 'option 2'],
              notes: [
                'When several beings hold the ability, the player picks whose score carries the roll.',
                'The carrier takes the consequence.',
                'On a Brawn option the consequence can be lethal.',
                'With no carrier named, the best score aboard carries the roll.',
              ],
            },
      };
    }
    if (pending?.kind === 'space_mission_offer') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'A MISSION OFFER was drawn — the player accepts one option (it stacks on top of the current journey) or declines. ASK them; get_legal_moves lists the qualified options.',
        human_response: {
          ask: 'accept mission option 1, option 2, or decline?',
          example: 'accept option 2',
          records_as: 'accept_mission { option } or decline_mission',
        },
        facts: {
          phase: 'Mission offer',
          notes: ['An accepted mission stacks on top of the current journey.', 'Declining is allowed.'],
        },
      };
    }
    if (pending?.kind === 'space_recruit_offer') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction: 'A DRIFTING RECRUIT — the player may attempt to recruit them (a roll follows) or decline. ASK them.',
        human_response: {
          ask: 'attempt to recruit them, or move on?',
          example: 'try to recruit them',
          records_as: 'attempt_recruit or decline_recruit',
        },
        facts: { phase: 'Drifting recruit', notes: ['Attempting to recruit means a roll follows.'] },
      };
    }
    if (pending?.kind === 'ruin_discovery') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          `ANCIENT RUINS discovered (they go down to depth ${pending.max_depth}). Entering is OPTIONAL — ASK the player: dock and explore (they pick a target depth, 1..${pending.max_depth}), or sail past? Set the scene with get_lore: ancient-ruins.`,
        human_response: {
          ask: `ruins on the sensors, depth ${pending.max_depth} — dock and explore (how deep?), or sail past?`,
          example: 'dock — let\'s try depth 1',
          records_as: 'enter_ruin { depth } or skip_ruin',
        },
      };
    }
    if (pending?.kind === 'ruin_setup') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          `RUIN ENCOUNTER SETUP (the R${pending.level} map) — ASK the player for each choice (never pick for them): who goes in (any crew; the character is optional), ` +
          'which starting location (get_state.ruin lists the S cells), the threat level (1-3 — 1 is recommended for a first run), and where to place the 3 attackers ' +
          '(any 3 of the marked A spots — farther away or behind walls is easier). Submit ONE setup_encounter move with their answers. Relay the board from get_state.ruin.board_rows so they can mirror the physical map.',
        human_response: {
          ask: 'who goes in, which entrance, what threat level, and which 3 attacker spots?',
          example: 'everyone including me, the bottom-left entrance, threat 1, attackers at the far spots',
          records_as: 'setup_encounter with those values',
        },
        facts: {
          phase: `Ruin setup, map R${pending.level}`,
          notes: [
            'Any crew may go in; the character is optional.',
            'The starting location is one of the S cells on the map.',
            'Threat level is 1 to 3; 1 is recommended for a first run.',
            'The 3 attackers go on any 3 of the marked A spots.',
            'Attackers farther away or behind walls make the run easier.',
          ],
        },
      };
    }
    if (pending?.kind === 'ruin_turn') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'RUIN — PARTY PHASE: each being may Move and Act, in any order (movement is splittable around the act). ASK the player what each remaining being does; ' +
          'get_legal_moves lists the options (moves are declared as cells like "r5c3"; the server validates paths, range and line of sight). ' +
          'Relay the current board from get_state.ruin.board_rows. Reaching the goal (G) ends the encounter instantly.',
        human_response: {
          ask: 'what does each being do this round? (move to a cell, attack, open a cache, approach a figure, or hold)',
          example: 'Zara moves to r7c2 and attacks A1; the Kralkin holds',
          records_as: 'move_being / attack / collect_item / recruit_at / escape_to_start / end_being_turn per being',
        },
        facts: {
          phase: 'Ruin, party phase',
          notes: [
            'Each being may move and act, in any order.',
            'Movement can be split around the action.',
            'Cells are named by row and column, like r5c3.',
            'Paths, range and line of sight are checked.',
            'Reaching the goal G ends the encounter at once.',
          ],
        },
      };
    }
    if (pending?.kind === 'ruin_continue') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          `LEVEL CLEARED — the party stands at the goal. ASK: descend to level ${pending.next_level} (full re-setup on the next map)${pending.is_mission ? ' — the mission requires the deeper goal (leaving abandons it, no reward)' : ''}, or leave with what they have?`,
        human_response: {
          ask: `go deeper (level ${pending.next_level}) or leave?`,
          example: 'deeper!',
          records_as: 'enter_ruin { depth: next level } or skip_ruin',
        },
        facts: {
          phase: 'Level cleared',
          reason: 'The party stands at the goal.',
          options: [`go deeper to level ${pending.next_level}`, 'leave'],
          notes: [
            'Going deeper means a full re-setup on the next map.',
            ...(pending.is_mission ? ['The mission needs the deeper goal; leaving abandons it with no reward.'] : []),
          ],
        },
      };
    }
    if (pending?.kind === 'space_combat_action') {
      if (s.encounter?.kind !== 'space_combat') return null;
      const enc = s.encounter;
      if (enc.stage === 'loss_reroll_offer') {
        return {
          status: 'human_to_move',
          active_player_id: pid,
          instruction: 'LOST EXCHANGE, Flying Ace available — the player may reroll the 4d6 (once per combat) or accept the hit. ASK them.',
          human_response: { ask: 'use your Flying Ace reroll, or take the hit?', example: 'reroll!', records_as: 'use_reroll or accept_result' },
          facts: {
            phase: 'Space combat',
            reason: 'The exchange was lost.',
            options: ['reroll', 'take the hit'],
            notes: ['The Flying Ace reroll rerolls the 4d6.', 'It can be used once per combat.'],
          },
        };
      }
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'SPACE COMBAT — the player chooses: attempt_escape, attempt_hack (needs HAK), open_fire (needs GUN; once per encounter — A6), attempt_intimidate (needs DEM — A7), redline (needs MEC; once per encounter — A20), or fight_round. ASK them; the pirate\'s full stats are in get_state.space_combat and the exact options in get_legal_moves.',
        human_response: {
          ask: 'pirates! run, hack, open fire, intimidate, redline the engines, or fight?',
          example: 'fight',
          records_as: 'attempt_escape / attempt_hack / open_fire / attempt_intimidate / redline / fight_round',
        },
        facts: {
          phase: 'Space combat',
          options: ['escape', 'hack', 'open fire', 'intimidate', 'redline', 'fight a round'],
          notes: [
            'Hack needs HAK.',
            'Open fire needs GUN and works once per encounter.',
            'Intimidate needs DEM.',
            'Redline needs MEC and works once per encounter.',
          ],
        },
      };
    }
    if (pending?.kind === 'sacrifice_offer') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'HAZARD FAILED with unnamed crew aboard (amendment A14a) — the player may SPEND one (they die; the hazard counts as survived) or let the consequence land. ASK them.',
        human_response: {
          ask: 'the check fails — does a red shirt take it for you?',
          example: 'spend one',
          records_as: 'sacrifice_unnamed or decline_sacrifice',
        },
        facts: {
          phase: 'Hazard',
          reason: 'The hazard check failed with unnamed crew aboard.',
          notes: [
            'Spending one unnamed crew member kills them, and the hazard counts as survived.',
            'Otherwise the consequence lands.',
          ],
        },
      };
    }
    if (pending?.kind === 'evade_offer') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          'PIRATES ON THE SCOPE, not yet spotted (amendment A5) — with SNE aboard the player may RUN SILENT (attempt_evade: 3d6 + SNE vs 10 + their speed; failure only starts the normal fight) or engage (decline_evade). ASK them.',
        human_response: {
          ask: 'pirates ahead — run silent, or engage?',
          example: 'run silent',
          records_as: 'attempt_evade or decline_evade',
        },
        facts: {
          phase: 'Pirates',
          reason: 'The pirates have not spotted the ship yet, and SNE is aboard.',
          options: ['run silent', 'engage'],
          notes: [
            "Running silent rolls 3d6 plus SNE against 10 plus the pirate's speed.",
            'A failed attempt only starts the normal fight.',
          ],
        },
      };
    }
    if (pending?.kind === 'boarding_decision') {
      return {
        status: 'human_to_move',
        active_player_id: pid,
        instruction:
          pending.stage === 'board_or_leave'
            ? 'The pirate ship is DISABLED — the player may board it (ground-combat roll; capture on a win) or fly on. ASK them.'
            : 'The pirate ship is CAPTURED — take it as the new ship (it arrives Hobbled; the old ship and its parts are abandoned) or keep the current one. ASK them.',
        human_response:
          pending.stage === 'board_or_leave'
            ? { ask: 'board the disabled ship, or leave it? (with DIP you may first talk survivors aboard — recruit_survivors, A10)', example: 'board it', records_as: 'board_ship / leave_pirate / recruit_survivors' }
            : { ask: 'take the captured ship, or keep yours? (with DIP you may first talk survivors aboard — recruit_survivors, A10)', example: 'take it', records_as: 'take_ship / abandon_ship / recruit_survivors' },
        facts:
          pending.stage === 'board_or_leave'
            ? {
                phase: 'Boarding',
                reason: 'The pirate ship is disabled.',
                notes: ['Boarding is a ground-combat roll.', 'A win captures the ship.'],
              }
            : {
                phase: 'Boarding',
                reason: 'The pirate ship is captured.',
                notes: ['A captured ship arrives Hobbled.', 'Taking it abandons the old ship and its parts.'],
              },
      };
    }
    return null; // at_habitat action selection: the generic human_to_move directive is right
  }

  getSetupChecklist(state: SessionState<WarbleWayGalaxyState>): SetupStep[] {
    const s = state.gameState;
    if (s.phase !== 'creation') return [];
    // An AI seat creates its character strategically via getAIMove — the
    // all-AI session is immediately playable (empty checklist convention).
    if (firstSeat(state).kind !== 'human') return [];
    return [
      {
        move_type: 'create_character',
        count: 1,
        description:
          'Create the character: ask the player their character name, race (human/kralkin/hexapod/grull), ship name, ' +
          'ability scores (recommended: one 3, one 2, one 1 — or distribute 6 points, max 3 per ability — or an A21 ' +
          'archetype card: a pre-built spread with a printed difficulty, Easy ★ to Brutal ★★★★; get_legal_moves lists ' +
          'the cards — OFFER them to a new player), and optionally a disposition (brash/risk-averse, roleplay hint only). ' +
          'Submit ONE create_character move with all values.',
        ask_human_for: 'character name; race; ship name; ability scores OR an archetype card; optional disposition',
      },
    ];
  }

  // Harness/desync hook: resolve a human seat's report pendings with the same
  // faithful simulation the bot uses (seeded real dice — never averages).
  autoResolveReport(state: SessionState<WarbleWayGalaxyState>, playerId: string): { move: WarbleMove } | null {
    const s = state.gameState;
    if (playerId !== firstSeat(state).player_id) return null;
    if (s.pending?.kind === 'roll') {
      const { dice } = rollDice(s.seed, s.pending.dice_count);
      return { move: { type: 'report_roll', dice } };
    }
    if (s.pending?.kind === 'card_draw') {
      const pick = randomInt(s.seed, s.deck.remaining.length);
      return { move: { type: 'report_card_draw', card: s.deck.remaining[pick.value]! } };
    }
    if (s.pending?.kind === 'res_discard') {
      const pick = randomInt(s.seed, Math.min(s.pending.peek_count, s.deck.remaining.length));
      return { move: { type: 'report_res_discard', card: s.deck.remaining[pick.value]! } };
    }
    return null;
  }

  getRulesText(): string {
    return rulesText;
  }
  getSessionStartGuidance(table?: 'physical' | 'digital'): string {
    if (table === 'digital') return digitalSessionStartGuidance;
    return sessionStartGuidance;
  }

  // The lore repository: the get_lore tool and the game://warble-way-galaxy/lore
  // resources (lore.ts). The server builds the real MCP tool from these.
  getExtraTools() {
    return loreTools();
  }

  getExtraResources() {
    return loreResources();
  }

  getReferenceData(): unknown {
    return {
      stats: Object.fromEntries(
        Object.entries(STAT_ABILITIES).map(([stat, abilities]) => [
          stat,
          abilities.map((a) => `${a} (${ABILITY_NAMES[a]})`),
        ]),
      ),
      race_idealized_stats: RACE_IDEALIZED,
      // Character creation choices, so a digital table can offer them as
      // printed rather than parse them out of a move description.
      races: Object.keys(RACE_IDEALIZED),
      archetypes: ARCHETYPES.map((a) => ({ id: a.id, name: a.name, scores: a.scores, difficulty: a.difficulty, stars: a.stars })),
      hazard_consequence_by_stat: HAZARD_CONSEQUENCE_BY_STAT,
      ability_stats: ABILITY_STAT,
      level_table: { printed: PRINTED_LEVEL_TABLE, beyond: 'doubling continues (96, 192, ...)' },
      travel_tables: {
        note: 'Resolved per drawn card during space travel (M2).',
        hearts_recruits: HEART_RECRUITS,
        diamonds_2_to_9_pirates: DIAMOND_PIRATES,
        diamonds_10_J_Q_K_A_ruin_depths: DIAMOND_RUINS,
        spades_hazards: SPADE_HAZARDS,
        clubs_missions: CLUB_MISSIONS,
      },
      habitats: HABITATS,
      ruins: {
        note: 'Attacker/item/being lists and map grids are locked (designer-confirmed). Cells are addressed r{row}c{col}, 1-based.',
        maps: RUIN_MAPS,
      },
    };
  }

  // The post-port §6 choice table as data — see src/core/choiceCatalog.ts.
  getChoiceCatalog(): PlayerChoice[] {
    return WARBLE_CHOICES;
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      {
        name: 'creation_archetype',
        kind: 'config',
        description:
          'Solo reinterpretation: which abilities carry the 3/2/1 spread (or the 6-point split) defines the build. ' +
          'Balance = solvability/difficulty per archetype (win rate vs the three loss conditions), not seat symmetry.',
        levers: ['sweep'],
        recipe: 'drive the solvability bot with varied create_character scores across batches (bot archetype is fixed PIL/MEC/RES in v0; sweep lands with the balance gate).',
      },
      {
        name: 'race_and_disposition',
        kind: 'cosmetic',
        description: 'Race and disposition have no mechanical effect (WR §2) — flavor only.',
        levers: [],
        recipe: 'no evaluation needed; verify no code path reads them mechanically.',
      },
    ];
  }
}

export const warbleWayGalaxy = new WarbleWayGalaxyGame();
export default warbleWayGalaxy;

