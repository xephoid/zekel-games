import type {
  AIMoveResult, ApplyMoveResult, BalanceAxis, Game, GameResult,
  GameLogEntry, LegalMove, NextStep, PlayerConfig, RuleSection, SessionState, SetupStep, PlayerChoice,
} from '@zekel/game-kit';
import { renderRulesText } from '@zekel/game-kit';
import { CYBERNOIR_RULE_SECTIONS } from './rulesSections.js';
import { GameError } from '@zekel/game-kit';
import { isDigitalSeat } from '@zekel/game-kit';
import { applyMove as engineApply, createInitialState, isGameOver } from './engine.js';
import { getLegalMoves as legalMovesFn } from './legalMoves.js';
import { getPublicView, getPlayerView } from './views.js';
import { candidateLocations, chooseMove, evidenceCardCount, parseStrategy, pickHideoutLocation, progressScore } from './ai.js';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { cloneCNState, determinizeCN, getCNHeuristicValue, getCNReward, getCNSearchMoves, pickCNRolloutMove } from './mctsHooks.js';
import { PEOPLE, LOCATIONS, ABILITIES, AFFILIATIONS, BOROUGHS, CLUE_TOKENS, EVIDENCE_SHAPE, EVIDENCE_TOTAL, WEAPON_ID, getPerson, getLocation } from './data/index.js';
import { deriveReportSeed } from '@zekel/game-kit';
import { randomInt } from './rng.js';
import type { CNMove, CNOptions, CNState } from './types.js';
import { CYBERNOIR_CHOICES } from './choices.js';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'RNG seed for reproducible setup. Random if omitted.' },
    overclock_draw_timing: {
      enum: ['immediate', 'next_turn', 'optional'],
      description: 'When Overclock grants the Detective 2 Location draws. Default: immediate.',
    },
    hideout: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 1,
      description: 'Balance-sweep lever: force the Hacker\'s hideout (single printed location name). Omit for normal play.',
    },
    detective: {
      type: 'string',
      description: "player_id (or the seat's name) of the player who is the DETECTIVE; the other player is the Hacker. ROLE IS A SETUP CHOICE THAT BELONGS TO THE HUMAN: ASK the human which role they want BEFORE create_session and set this to match. If omitted, the FIRST player in the players array is the Detective.",
    },
  },
} as const;

const moveSchema = {
  oneOf: [
    { type: 'object', properties: { type: { const: 'report_hideout' }, location_name: { type: 'string', description: 'Human Hacker: your hideout location (printed name). AI Hacker: OMIT — the server picks secretly; never choose for the AI.' } }, required: ['type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'play_location' }, location_name: { type: 'string' } }, required: ['type', 'location_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'arrest' }, target_person: { type: 'string' } }, required: ['type', 'target_person'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'recruit_informant' }, target_person: { type: 'string' } }, required: ['type', 'target_person'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'draw_extra_location' } }, required: ['type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'guess_location' }, location_name: { type: 'string' } }, required: ['type', 'location_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'buy_clue' }, discard_locations: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } }, required: ['type', 'discard_locations'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'upkeep_choice' }, keep: { type: 'array', items: { type: 'string' } }, release: { type: 'array', items: { type: 'string' } } }, required: ['type', 'keep', 'release'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'final_guess' }, location_name: { type: 'string' } }, required: ['type', 'location_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'block_decide' }, block: { type: 'boolean' } }, required: ['type', 'block'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'draw_contact' } }, required: ['type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'play_person' }, person_name: { type: 'string' } }, required: ['type', 'person_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'play_evidence' }, person_name: { type: 'string', description: 'Weapon evidence ONLY (optional): "The Weapon". The Weapon is the only single-card Evidence.' }, people: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3, description: 'Witness AND Motive evidence: the COMPLETE set of 3 people, played at once. Motive sets need 3 different affiliations with at most two gangs; Witness sets need 3 Witnesses. Neither is ever played one card at a time.' }, evidence_type: { enum: ['weapon', 'witness', 'motive'] } }, required: ['type', 'evidence_type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'win_back' }, person_name: { type: 'string' } }, required: ['type', 'person_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'jailbreak' }, freed_person: { type: 'string' }, negative_clue_token: { type: 'string' } }, required: ['type', 'freed_person', 'negative_clue_token'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'overclock' } }, required: ['type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'burn_safehouse' }, new_location_name: { type: 'string', description: 'Optional: a human Hacker may declare the new location directly; omit to be walked through the pile first (AI Hackers always omit — the server picks secretly).' } }, required: ['type'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'burn_choice' }, new_location_name: { type: 'string' } }, required: ['type', 'new_location_name'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'report_location_hand' }, locations: { type: 'array', items: { type: 'string' }, description: 'The printed names of every Location card still in the Detective\'s hand.' } }, required: ['type', 'locations'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'clue_reveal' }, category: { enum: ['borough', 'population', 'affiliation'] }, value: { type: 'string' } }, required: ['type', 'category', 'value'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'reveal_informant' }, target_informant: { type: 'string' } }, required: ['type', 'target_informant'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'informant_removal_choice' }, target_informant: { type: 'string', description: 'Facedown informant: its position number (1-based). Revealed informant: the printed name.' } }, required: ['type', 'target_informant'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'board_discard_choice' }, target_location: { type: 'string' } }, required: ['type', 'target_location'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'discard_retrieval_choice' }, target_card: { type: 'string' } }, required: ['type', 'target_card'], additionalProperties: false },
    { type: 'object', properties: { type: { const: 'pass_turn' } }, required: ['type'], additionalProperties: false },
  ],
  description: 'Cybernoir 2127 move catalog. Every constrained-set field accepts the PRINTED name. One action per apply_move. get_legal_moves is the authoritative list.',
} as const;

const sessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. This is a 2-PLAYER hidden-movement deduction game. One player is the Detective (the actual criminal who framed the Hacker), the other is the Hacker (trying to clear their name). The Detective goes first. ROLES: the FIRST player in the session is the Detective and the SECOND is the Hacker — ASK the human which role they want BEFORE create_session and set the 'detective' option (their player_id) to match; never assume.

2. TURN STRUCTURE:
   - Detective (4 AP): mandatory draw+play Location, pay informant upkeep, then spend AP on: Arrest (X), Recruit Informant (XXX), Draw extra Location (XXXX), Guess location (XXXX, one mid-game chance), or Discard 3 Locations to buy a Clue.
   - Hacker (3 AP): Draw Contact (X), Play Person (printed cost), Play Evidence (free), Win Back a Contact (printed cost), Jailbreak (free + give Negative Clue), Overclock (free + give Detective 2 Location draws on their next turn, +1 AP, once/turn), or Burn the Safehouse (XXX, once per GAME — see 8).

3. WIN CONDITIONS: Detective wins by guessing the Hacker's hideout (mid-game guess or final guess). Hacker wins by completing all 3 Evidence and surviving the final guess. The Evidence: the Weapon (one card, unblockable); the 3 Witnesses, played ALL THREE AT ONCE in a single move; and 3 Motive sets — each a COMPLETE trio of 3 people from 3 DIFFERENT affiliations, also played ALL AT ONCE, with AT MOST TWO gang affiliations per set and NO TWO SETS using the same three affiliations. NEITHER the Witnesses NOR a Motive set is ever played one card at a time — there are no partial sets on the table. Every card in a set gets the informant check and ONE block bounces the whole set back to hand.

4. CLUES: When the Detective earns a Clue (buy or block), the HACKER chooses which truthful category to reveal (Borough/Population/Affiliation). Negative Clues are ONLY given as the cost of Jailbreak — never as a substitute for a truthful clue.

5. INFORMANTS: The Detective recruits POI cards facedown as informants. When the Hacker plays a matching person, the Detective may reveal the informant to BLOCK the play and gain a Clue. Revealed informants persist and cost upkeep. The Hacker can Win Back a revealed informant by playing the matching Contact.

6. HUMAN HANDS ARE NEVER SERVER-DEALT. Humans physically own their decks. The server validates named moves only.

7. One action per apply_move. Use next_step to see whose turn it is and what's owed.

8. SETUP + BURN THE SAFEHOUSE (rules v1.8): at setup a human Hacker TAKES their hideout's Location card out of the Location deck and keeps it facedown — the Detective shuffles the remaining ${LOCATIONS.length - 1}. (Against an AI Hacker the deck keeps all ${LOCATIONS.length} — a human cannot remove the AI's secret card.) Once per game, for 3 AP, the Hacker may Burn the Safehouse: gather the Detective's Location discard pile + remaining deck, add the old safehouse card, secretly take a DIFFERENT location's card as the new safehouse, shuffle the rest into the new Location deck. Then ALL Clue tokens come off the table — truthful AND Negative — so the Detective's investigation restarts from zero (categories become buyable again). When an AI Hacker burns, the human Detective is asked to report the Location cards still in their hand (the pile reveals this by elimination anyway) — ASK the human for that list, do NOT invent it. Relay the burn summary's physical steps to the human in full.`;

// Digital variant (docs/digital-mode.md): a digital human seat has no physical
// deck — the server holds the Location deck, deals hands, tracks the hideout's
// card pool. Physical-card instructions go away; everything else stays.
const digitalSessionStartGuidance = `
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. DIGITAL SESSION: at least one human seat has table:"digital" — that seat holds NO physical cards. The server shuffles and holds the Location deck, deals hands, and tracks each seat's hidden cards privately. get_state for a digital seat shows its own hand. The other seat may still be physical (mixed sessions).

2. TURN STRUCTURE and WIN CONDITIONS are unchanged from the base game (Detective first; 4 AP Detective / 3 AP Hacker; Evidence win for Hacker, hideout guess for Detective). See get_rules for card names and AP costs.

3. CLUES and INFORMANTS work identically. The Hacker still chooses which clue category to reveal.

4. DIGITAL-SPECIFIC: digital humans NEVER recite their hand and never "physically" draw or gather cards — the server deals directly at setup and at Burn. A digital Hacker still chooses their own hideout (it is their choice, not a random pick by the server). On Burn the Safehouse vs a digital Detective the engine resolves silently from tracked state (no hand-report pending; the server already knows).

5. One action per apply_move. Use next_step to see whose turn it is and what's owed.
`;

export class Cybernoir2127Game implements Game<CNState, CNMove, CNOptions> {
  readonly id = 'cybernoir-2127';
  readonly name = 'Cybernoir 2127';
  readonly description = 'A 2-player hidden-movement deduction game of frame-ups and false leads. The Detective (who committed the crime) races to arrest the framed Hacker before the Hacker assembles 3 pieces of Evidence and clears their name.';
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly supportsAI = true;
  readonly hasHiddenInformation = true;
  readonly version = '0.2.0'; // rules v1.9 FROZEN 2026-08-12
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;

  createSession(players: PlayerConfig[], options?: CNOptions): SessionState<CNState> {
    if (players.length !== 2) {
      throw new GameError('INVALID_PLAYERS', `Cybernoir 2127 requires exactly 2 players; got ${players.length}`);
    }
    // Role assignment: seat 0 is the DETECTIVE, seat 1 the HACKER. The
    // `detective` option (player_id or seat name, case-tolerant) reorders the
    // seats; without it the given order stands. Role is an identity pick the
    // human owns — the option description tells the model to ASK first.
    let ordered = players;
    if (options?.detective !== undefined) {
      const want = String(options.detective).trim().toLowerCase();
      const match = players.find(p =>
        p.player_id.toLowerCase() === want || (p.name ?? '').trim().toLowerCase() === want);
      if (!match) {
        throw new GameError('INVALID_PLAYERS',
          `options.detective must name one of the players (got "${options.detective}"; players: ${players.map(p => p.player_id + (p.name ? ` / ${p.name}` : '')).join(', ')})`);
      }
      ordered = [match, ...players.filter(p => p !== match)];
    }
    const ids = ordered.map(p => p.player_id);
    const kinds: Record<string, 'tracked' | 'opaque'> = {};
    const deciderKinds: Record<string, 'human' | 'ai'> = {};
    const strategies: Record<string, string | undefined> = {};
    for (const p of players) {
      // State ownership follows the seat's table mode (docs/digital-mode.md):
      // physical humans are opaque, digital seats (AI always; humans by opt-in)
      // are tracked. Cybernoir-specific: the Detective seat reversed from
      // "human hands are never server-dealt" (port-plan ruling) to
      // "server-dealt for digital sessions".
      kinds[p.player_id] = isDigitalSeat(p) ? 'tracked' : 'opaque';
      deciderKinds[p.player_id] = p.kind;
      strategies[p.player_id] = p.strategy;
    }
    const seed = options?.seed ?? Math.floor(Math.random() * 0xffffffff);
    const initial = createInitialState(ids, kinds, options, seed, strategies, deciderKinds);
    return {
      sessionId: '',
      gameId: this.id,
      players: ordered,
      activePlayerId: initial.activePlayerId,
      turnNumber: 1,
      gameState: initial,
      moveLog: [],
      createdAt: new Date().toISOString(),
    };
  }

  getLegalMoves(state: SessionState<CNState>, playerId: string): LegalMove<CNMove>[] {
    return legalMovesFn(state.gameState, playerId);
  }

  getPublicView(state: SessionState<CNState>): unknown {
    return getPublicView(state.gameState);
  }

  getPlayerView(state: SessionState<CNState>, playerId: string): unknown {
    return getPlayerView(state.gameState, playerId);
  }

  isGameOver(state: SessionState<CNState>): GameResult | null {
    const r = isGameOver(state.gameState);
    if (!r.game_over) return null;
    return {
      game_over: true,
      winners: r.winners,
      scores: r.scores,
      summary: r.summary,
    };
  }

  applyMove(state: SessionState<CNState>, playerId: string, move: CNMove): ApplyMoveResult<CNState> {
    const logCursor = state.gameState.log.length;
    let result = engineApply(state.gameState, playerId, move);
    // v2.3 privacy: a block decision owed to a TRACKED (AI) Detective resolves
    // INLINE. A human Detective decides silently at the table — if the pending
    // were surfaced, its mere existence would tell the Hacker their card
    // matched a facedown informant. (A set play can chain up to 3 checks.)
    let guard = 0;
    while (result.newState.pending?.type === 'block_pending' && guard++ < 5) {
      const seat = state.players.find(p => p.player_id === result.newState.activePlayerId);
      if (seat?.kind !== 'ai') break;
      const decide = chooseMove(result.newState, seat.player_id, seat.difficulty ?? 'medium', parseStrategy(seat.strategy));
      result = engineApply(result.newState, seat.player_id, decide.move);
    }
    // Jail transitions fire inside switchTurn (a side effect of whatever move
    // ended the Detective's turn) — they are not moves, so without this they
    // never reach the relay contract and the physical jail track drifts.
    const jailNotes = result.newState.log.slice(logCursor)
      .filter(e => e.category === 'jail' && e.actor === null)
      .map(e => e.summary);
    const summary = jailNotes.length > 0
      ? `${result.summary} | Jail track: ${jailNotes.join('; ')}`
      : result.summary;
    return {
      newState: {
        ...state,
        gameState: result.newState,
        activePlayerId: result.newState.activePlayerId,
        turnNumber: result.newState.turn,
      },
      summary,
    };
  }

  async getAIMove(state: SessionState<CNState>, playerId: string, difficulty?: string, strategy?: string): Promise<AIMoveResult<CNMove>> {
    const d = difficulty ?? 'medium';
    if (d === 'mcts') {
      // Opt-in experimental tier. NOT verified stronger than hard on v1.9 at
      // batch-feasible budgets (worker + orchestrator probes, 2026-08-12);
      // hard is the shipped strong tier (the heuristic ceiling — see ai.ts).
      const budgetMs = Number(process.env.MCTS_BUDGET_MS) || 300;
      const mcts = chooseMoveMCTS(this, state, playerId, {
        budget_ms: budgetMs,
        max_rollout_plies: 20,
        seed: state.gameState.rngSeed ^ (state.gameState.turn * 2654435761),
      });
      return { move: mcts.move, narration: `MCTS (${mcts.iterations} sims): plays ${mcts.move.type}.` };
    }
    return chooseMove(state.gameState, playerId, d, parseStrategy(strategy));
  }

  // ------------------------------------------------------------------
  // MCTS hooks (the strong tier) — implemented in mctsHooks.ts
  // ------------------------------------------------------------------

  getRewardForPlayer(state: SessionState<CNState>, playerId: string): number {
    return getCNReward(state, playerId);
  }

  selectRolloutMove(state: SessionState<CNState>, playerId: string): CNMove | null {
    return pickCNRolloutMove(state, playerId);
  }

  getHeuristicValue(state: SessionState<CNState>, playerId: string): number {
    return getCNHeuristicValue(state, playerId);
  }

  getSearchMoves(state: SessionState<CNState>, playerId: string): LegalMove<CNMove>[] {
    return getCNSearchMoves(state, playerId);
  }

  determinize(state: SessionState<CNState>, fromPlayerId: string, rng: () => number): SessionState<CNState> {
    return determinizeCN(state, fromPlayerId, rng);
  }

  cloneState(state: SessionState<CNState>): SessionState<CNState> {
    return cloneCNState(state);
  }

  // Cheap scoreboard for the harness (rich getLog remains the log path).
  // `progress` is the shared §2 scalar — same quantity getHeuristicValue returns.
  getScoreboard(state: SessionState<CNState>): Record<string, Record<string, number>> {
    const gs = state.gameState;
    const detId = gs.playerOrder[0]!;
    const hakId = gs.playerOrder[1]!;
    const tc = gs.hacker.truthful_clues;
    return {
      [detId]: {
        candidates_remaining: candidateLocations(gs).length,
        clues_revealed: Number(tc.borough) + Number(tc.population) + Number(tc.affiliation),
        informants: gs.detective.informants.length,
        jailed: gs.detective.jail.flat().length,
        progress: progressScore(gs, detId),
      },
      [hakId]: {
        evidence_cards: evidenceCardCount(gs),
        hand_size: gs.players[hakId]?.hand_size ?? 0,
        negative_clues: gs.hacker.negative_clues.length,
        progress: progressScore(gs, hakId),
      },
    };
  }

  getSessionStartGuidance(table?: 'physical' | 'digital'): string {
    if (table === 'digital') return digitalSessionStartGuidance;
    return sessionStartGuidance;
  }

  /** Sectioned rules from the v2.3 rulebook (docs/rules-teaching.md). Added to
   *  close the integration gate's finding D: with no rules text on the server,
   *  assistants answered rules questions from training memory. */
  getRulesSections(): RuleSection[] {
    return CYBERNOIR_RULE_SECTIONS;
  }

  getRulesText(): string {
    return renderRulesText(CYBERNOIR_RULE_SECTIONS);
  }

  getReferenceData(): unknown {
    return {
      people: PEOPLE.map(p => ({ name: p.name, affiliation: p.affiliation, home_location: p.home_location, cost: p.cost, ability: p.ability, is_witness: p.is_witness })),
      locations: LOCATIONS.map(l => ({ name: l.name, borough: l.borough, population: l.population, affiliation: l.affiliation, residents: l.residents })),
      affiliations: AFFILIATIONS,
      boroughs: BOROUGHS,
      clue_tokens: CLUE_TOKENS,
      weapon: { id: WEAPON_ID, name: 'The Weapon' },
      // The shape of the Hacker's win, so a client can draw the case file's
      // slots from turn one instead of counting them itself.
      evidence: { ...EVIDENCE_SHAPE, total: EVIDENCE_TOTAL },
      // One line per ability, so a client can say what playing a card does
      // rather than showing the ability's id.
      abilities: ABILITIES,
    };
  }

  getLog(state: SessionState<CNState>): GameLogEntry[] {
    return state.gameState.log;
  }

  // ------------------------------------------------------------------
  // Integration harness hooks (desync/relay ground truth)
  // ------------------------------------------------------------------

  /** autoResolveReport synthesizes a valid move for a human-owed REPORT whose
   *  value depends on hidden state the client cannot see. Cybernoir has no
   *  server-dealt human hands, so most "reports" are not auto-resolvable. The
   *  one exception is the Hacker's setup hideout pick when the Hacker is
   *  tracked (AI) — but that is not a human seat. For human seats we return
   *  null and let getSuggestedMove / get_legal_moves handle it.
   */
  autoResolveReport(_state: SessionState<CNState>, _playerId: string): { move: CNMove } | null {
    return null;
  }

  /** getSuggestedMove returns a directly-applyable concrete move for any seat.
   *  Used by the desync/relay harness to derive deterministic ground-truth
   *  human turns. It fills placeholder moves (buy_clue with empty discards,
   *  human Hacker hideout) using the same deterministic policy the AI uses.
   */
  getSuggestedMove(state: SessionState<CNState>, playerId: string): { move: CNMove } | null {
    const gs = state.gameState;

    // Setup: fill a human Hacker's hideout with a concrete, deterministic pick.
    if (gs.phase === 'setup' && gs.playerOrder[1] === playerId) {
      if (gs.hacker.kind !== 'opaque') return null; // AI Hacker uses the nameless engine-side pick
      const strat = parseStrategy(state.players.find(p => p.player_id === playerId)?.strategy);
      const sideSeed = deriveReportSeed(gs.rngSeed, `hideout-${playerId}`);
      const pick = this._pickHideout(strat, sideSeed);
      return { move: { type: 'report_hideout', location_name: pick.name } };
    }

    // Pending states: pick the first concrete legal option (no placeholders).
    if (gs.pending) {
      const legal = legalMovesFn(gs, playerId);
      const concrete = legal.find(lm => this._isConcreteMove(lm.move));
      if (concrete) return { move: concrete.move };
      return legal[0] ? { move: legal[0].move } : null;
    }

    // Normal turn: ask the AI brain, but reject any placeholder move and fall
    // back to the first concrete legal move.
    const config = state.players.find(p => p.player_id === playerId);
    const suggested = chooseMove(gs, playerId, config?.difficulty ?? 'medium', parseStrategy(config?.strategy));
    if (this._isConcreteMove(suggested.move)) return { move: suggested.move };
    const legal = legalMovesFn(gs, playerId);
    const concrete = legal.find(lm => this._isConcreteMove(lm.move));
    return concrete ? { move: concrete.move } : (legal[0] ? { move: legal[0].move } : null);
  }

  private _isConcreteMove(move: CNMove): boolean {
    // A move is "concrete" if every string field that is part of the payload is
    // non-empty. Moves with optional/missing fields (report_hideout for AI,
    // draw_extra_location) are still concrete.
    const strings: string[] = [];
    if ('location_name' in move && typeof move.location_name === 'string') strings.push(move.location_name);
    if ('target_person' in move && typeof move.target_person === 'string') strings.push(move.target_person);
    if ('person_name' in move && typeof move.person_name === 'string') strings.push(move.person_name);
    if ('new_location_name' in move && typeof move.new_location_name === 'string') strings.push(move.new_location_name);
    if ('target_informant' in move && typeof move.target_informant === 'string') strings.push(move.target_informant);
    if ('target_location' in move && typeof move.target_location === 'string') strings.push(move.target_location);
    if ('target_card' in move && typeof move.target_card === 'string') strings.push(move.target_card);
    if ('freed_person' in move && typeof move.freed_person === 'string') strings.push(move.freed_person);
    if ('negative_clue_token' in move && typeof move.negative_clue_token === 'string') strings.push(move.negative_clue_token);
    if ('category' in move && typeof move.category === 'string') strings.push(move.category);
    if ('value' in move && typeof move.value === 'string') strings.push(move.value);
    if ('discard_locations' in move && Array.isArray(move.discard_locations)) {
      if (move.discard_locations.some(x => typeof x !== 'string' || x === '')) return false;
    }
    if ('locations' in move && Array.isArray(move.locations)) {
      if (move.locations.some(x => typeof x !== 'string' || x === '')) return false;
    }
    if ('keep' in move && Array.isArray(move.keep)) {
      if (move.keep.some(x => typeof x !== 'string' || x === '')) return false;
    }
    if ('release' in move && Array.isArray(move.release)) {
      if (move.release.some(x => typeof x !== 'string' || x === '')) return false;
    }
    return strings.every(s => s.trim() !== '');
  }

  private _pickHideout(strategy: ReturnType<typeof parseStrategy>, seed: number) {
    // Delegate to the AI's real policy — a drifting inline copy here would
    // silently diverge from ai.ts (and ai.js is already an import above).
    return pickHideoutLocation(strategy, seed).loc;
  }

  describeNextStep(state: SessionState<CNState>): NextStep | null {
    const s = state.gameState;
    if (s.phase === 'game_over') {
      return { status: 'game_over', active_player_id: null, instruction: s.resultSummary };
    }

    const activePlayer = s.activePlayerId;
    const activeConfig = state.players.find(p => p.player_id === activePlayer);
    const isHuman = activeConfig?.kind === 'human';
    // Pending states are resolvable by the active seat's AI when that seat is
    // tracked (AI). Returning 'human_to_move' for an AI seat strands run_ai_turn
    // in a livelock, because the framework keys AI loops on 'ai_to_move'.
    const pendingStatus: 'human_to_move' | 'ai_to_move' = isHuman ? 'human_to_move' : 'ai_to_move';

    // Answer-shape hints and structured facts exist only for a human seat; an AI
    // seat's pending is resolved by its own brain (status ai_to_move).
    const forHuman = (step: NextStep, hr: NextStep['human_response'], facts: NextStep['facts']): NextStep =>
      isHuman ? { ...step, human_response: hr, facts } : step;

    if (s.pending) {
      if (s.pending.type === 'block_pending') {
        const personName = getPerson(s.pending.person_id)?.name ?? s.pending.person_id;
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: `Detective: block ${personName} by revealing the matching informant, or let the play proceed.`,
          },
          {
            ask: `Do you block ${personName} by revealing your matching informant, or let the play go ahead?`,
            example: `I block it with my informant ${personName}`,
            records_as: 'block_decide with block true to block by revealing the matching informant, or block false to let it proceed',
          },
          { phase: 'Detective', reason: `The Hacker is playing ${personName}.`, options: ['Block', 'Let it proceed'] },
        );
      }
      if (s.pending.type === 'clue_reveal_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: choose which truthful clue category to reveal (Borough/Population/Affiliation).',
          },
          {
            ask: 'Which truthful clue do you reveal: Borough, Population or Affiliation?',
            example: 'I reveal the Borough',
            records_as: 'clue_reveal with category (borough, population or affiliation) and its true value for your hideout',
          },
          { phase: 'Hacker', options: ['Borough', 'Population', 'Affiliation'], notes: ['The clue must be true for your hideout.'] },
        );
      }
      if (s.pending.type === 'endgame_final_guess') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Detective: make your final guess at the Hacker\'s hideout.',
          },
          {
            ask: "What is your final guess for the Hacker's hideout?",
            example: 'My final guess is the Docks',
            records_as: 'final_guess with location_name',
          },
          { phase: 'Detective', notes: ['This is the last guess of the game.'] },
        );
      }
      if (s.pending.type === 'board_discard_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: choose which face-up board Location to discard (Gang 2/3 ability).',
          },
          {
            ask: 'Which face-up Location on the board do you discard?',
            example: 'I discard the Market',
            records_as: 'board_discard_choice with target_location',
          },
          { phase: 'Hacker', reason: 'A Gang 2 or Gang 3 ability lets you discard a board Location.' },
        );
      }
      if (s.pending.type === 'reveal_informant_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: choose which facedown informant to reveal (Corp 1 ability).',
          },
          {
            ask: 'Which face-down informant do you reveal?',
            example: 'I reveal informant number 2',
            records_as: 'reveal_informant with target_informant (its position number)',
          },
          { phase: 'Hacker', reason: 'The Corp 1 ability lets you reveal a face-down informant.' },
        );
      }
      if (s.pending.type === 'informant_removal_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: choose an informant to REMOVE (Anansi) — a facedown one by its position number (it goes home unseen), or a revealed one by name.',
          },
          {
            ask: 'Which informant do you remove: a face-down one by its position number, or a revealed one by name?',
            example: 'I remove face-down informant number 1',
            records_as: 'informant_removal_choice with target_informant (a position number or a revealed name)',
          },
          {
            phase: 'Hacker',
            reason: 'Anansi lets you remove an informant.',
            notes: [
              'A face-down informant is named by its position number and goes home unseen.',
              'A revealed informant is named by its name.',
            ],
          },
        );
      }
      if (s.pending.type === 'discard_retrieval_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: choose which card from the discard pile to retrieve (Corp 2 ability).',
          },
          {
            ask: 'Which card from the discard pile do you take back?',
            example: 'I take back Anansi',
            records_as: 'discard_retrieval_choice with target_card',
          },
          { phase: 'Hacker', reason: 'The Corp 2 ability lets you take a card back from the discard pile.' },
        );
      }
      if (s.pending.type === 'burn_choice_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Hacker: gather the Location discard pile and remaining Location deck, add your old safehouse card, then name your NEW safehouse location from that pile (burn_choice). It must be a DIFFERENT location. ASK the human for their pick; do NOT choose for them.',
          },
          {
            ask: 'Which Location is your new safehouse?',
            example: 'My new safehouse is the Arcade',
            records_as: 'burn_choice with new_location_name',
            // The new hideout is the Hacker's secret.
            private: true,
          },
          {
            phase: 'Hacker',
            reason: 'You are burning your safehouse.',
            notes: [
              'Gather the Location discard pile and the rest of the Location deck, and add your old safehouse card.',
              'Pick your new safehouse from that pile.',
              'It must be a different Location from your old one.',
            ],
          },
        );
      }
      if (s.pending.type === 'burn_hand_report_pending') {
        return forHuman(
          {
            status: pendingStatus,
            active_player_id: activePlayer,
            instruction: 'Detective: the Hacker is burning their safehouse. Gather your Location discard pile and remaining Location deck into ONE pile (do not shuffle yet), then report every Location card still in your HAND via report_location_hand. ASK the human for the exact list; do NOT invent it.',
          },
          {
            ask: 'Which Location cards are still in your hand?',
            example: 'I have the Docks and the Arcade in my hand',
            records_as: 'report_location_hand with locations: every Location card name in your hand',
            // The Detective's hand is secret from the Hacker.
            private: true,
          },
          {
            phase: 'Detective',
            reason: 'The Hacker is burning their safehouse.',
            notes: [
              'Gather your Location discard pile and the rest of your Location deck into one pile, and do not shuffle yet.',
              'Report every Location card still in your hand.',
              'If no Location cards are left in your hand, the answer is none.',
            ],
          },
        );
      }
    }

    if (s.phase === 'setup') {
      if (s.playerOrder[1] === activePlayer) {
        const hackerHuman = state.players.find(p => p.player_id === s.playerOrder[1])?.kind === 'human';
        if (!hackerHuman) {
          // AI Hacker: let run_ai_turn drive the nameless engine-side hideout pick.
          return { status: 'ai_to_move', active_player_id: activePlayer, instruction: 'AI Hacker: choosing hideout secretly.' };
        }
        return {
          status: 'human_to_move',
          active_player_id: activePlayer,
          instruction: `Hacker: choose your hideout from the ${LOCATIONS.length} locations, and take that Location card out of the Location deck — keep it facedown as your safehouse card (the Detective shuffles the remaining ${LOCATIONS.length - 1}).`,
          human_response: {
            ask: 'Which Location is your hideout?',
            example: 'My hideout is the Docks',
            records_as: 'report_hideout with location_name',
            // The hideout is the Hacker's secret for the whole game.
            private: true,
          },
          facts: {
            phase: 'Setup',
            notes: [
              `Choose your hideout from the ${LOCATIONS.length} Locations.`,
              'Take that Location card out of the Location deck and keep it face down as your safehouse card.',
              `The Detective shuffles the other ${LOCATIONS.length - 1} Location cards.`,
            ],
          },
        };
      }
    }

    if (isHuman) {
      if (s.playerOrder[0] === activePlayer) {
        // Detective: name the current mandatory sub-step
        if (!s.detective.location_played_this_turn) {
          return {
            status: 'human_to_move',
            active_player_id: activePlayer,
            instruction: 'Detective: play a Location card to the board (mandatory).',
            human_response: {
              ask: 'Which Location card do you play to the board?',
              example: 'I play the Market',
              records_as: 'play_location with location_name',
            },
            facts: { phase: 'Detective', notes: ['Playing a Location card to the board is required every turn.'] },
          };
        }
        if (s.detective.informants.length > 0 && !s.detective.upkeep_paid) {
          return {
            status: 'human_to_move',
            active_player_id: activePlayer,
            instruction: 'Detective: pay informant upkeep — choose which informants to keep (1 AP each) or release.',
            human_response: {
              ask: 'Which informants do you keep, and which do you release?',
              example: 'I keep Anansi and release the rest',
              records_as: 'upkeep_choice with keep and release: informant names',
              // Face-down informants are the Detective's secret.
              private: true,
            },
            facts: { phase: 'Upkeep', notes: ['Keeping an informant costs 1 AP.'] },
          };
        }
        return {
          status: 'human_to_move',
          active_player_id: activePlayer,
          instruction: 'Detective: spend AP on actions (arrest/recruit/draw/guess/buy clue), or pass.',
          human_response: {
            ask: 'What do you do next: arrest, recruit an informant, draw a Location, guess the hideout, buy a clue, or pass?',
            example: 'I arrest Anansi',
            records_as:
              'arrest (target_person), recruit_informant (target_person), draw_extra_location, guess_location (location_name), buy_clue (discard_locations), or pass_turn',
            // A recruit names a person who becomes a FACE-DOWN informant — the
            // Detective's secret — so this step is entered privately when two
            // humans share one device (arrests and guesses are harmless to hide).
            private: true,
          },
          facts: {
            phase: 'Detective',
            options: ['Arrest', 'Recruit an informant', 'Draw a Location', 'Guess the hideout', 'Buy a clue', 'Pass'],
            notes: ['Each action costs AP.'],
          },
        };
      }
      return {
        status: 'human_to_move',
        active_player_id: activePlayer,
        instruction: 'Hacker: spend AP on draw/play/evidence/win-back/jailbreak/overclock.',
        human_response: {
          ask: 'What do you do next: draw a Contact, play a person, play Evidence, win someone back, jailbreak, overclock, burn your safehouse, or pass?',
          example: 'I play Anansi',
          records_as:
            'draw_contact, play_person (person_name), play_evidence (evidence_type and the people), win_back (person_name), jailbreak (freed_person, negative_clue_token), overclock, burn_safehouse, or pass_turn',
        },
        facts: {
          phase: 'Hacker',
          options: ['Draw a Contact', 'Play a person', 'Play Evidence', 'Win someone back', 'Jailbreak', 'Overclock', 'Burn the safehouse', 'Pass'],
          notes: ['Each action costs AP.'],
        },
      };
    }

    return { status: 'ai_to_move', active_player_id: activePlayer, instruction: 'AI to move.' };
  }

  getSetupChecklist(state: SessionState<CNState>): SetupStep[] {
    if (state.gameState.phase !== 'setup') return [];
    // All-AI sessions skip the handshake (setup auto-completes in createInitialState)
    const hasHuman = state.players.some(p => p.kind === 'human');
    if (!hasHuman) return [];
    const steps: SetupStep[] = [];
    const detSeat = state.players.find(p => p.player_id === state.gameState.playerOrder[0]);
    const hakSeat = state.players.find(p => p.player_id === state.gameState.playerOrder[1]);
    const seatLabel = (p: typeof detSeat) => p ? `${p.player_id}${p.name ? ` (${p.name})` : ''} [${p.kind}]` : '?';
    // Step 0: role echo — a wrong assignment must be visible NOW, not two
    // turns in. Roles were silently positional before v2.3 (found by the
    // designer asking to play Hacker and always getting Detective).
    steps.push({
      move_type: 'confirm_roles',
      count: 0,
      description: `SEAT ROLES THIS SESSION: ${seatLabel(detSeat)} is the DETECTIVE; ${seatLabel(hakSeat)} is the HACKER. If this is not what the human asked for, re-create the session with options.detective set to the right player_id — do not play on with swapped roles.`,
      ask_human_for: 'confirmation that these roles match what they asked for',
    });
    const hackerHuman = hakSeat?.kind === 'human';
    const hackerDigital = hakSeat?.table === 'digital';
    const detectiveDigital = detSeat?.table === 'digital';
    // Step 1: Hacker chooses hideout
    steps.push({
      move_type: 'report_hideout',
      count: 1,
      description: hackerHuman
        ? hackerDigital
          ? `Hacker: choose your hideout from the ${LOCATIONS.length} locations. The server removes that Location card and deals your starting Contact hand (residents + draw-to-3).`
          : `Hacker: choose your hideout from the ${LOCATIONS.length} locations, and TAKE that Location card out of the Location deck — keep it facedown as your safehouse card (rules v1.7). You physically gather the resident Contacts from your deck.`
        : 'AI Hacker: run_ai_turn (or get_ai_move) makes this pick — the server chooses secretly. Do NOT supply a location_name and do NOT choose for the AI.',
      ask_human_for: hackerHuman
        ? 'hideout location name (one of the 18 printed locations)'
        : 'nothing — the AI picks its own hideout secretly',
    });
    // Steps 2-5 (physical setup actions) only apply when a seat is physical;
    // for digital-human sessions the server holds and deals every hand, so no
    // physical shuffles are owed. Skip those steps entirely.
    if (hackerDigital && detectiveDigital) return steps;
    // Step 2: Hacker gathers resident Contacts (physical, no server move — reported via report_hideout)
    steps.push({
      move_type: 'report_hideout',
      count: 0,
      description: hackerDigital
        ? 'Hacker: (no physical action — the server dealt your resident Contacts.)'
        : 'Hacker: gather the Contact cards for people resident at your chosen location (0–3 cards). Go through the motions even if population 0.',
      ask_human_for: hackerDigital
        ? 'nothing — server already dealt the resident Contacts to the digital Hacker'
        : 'physical gathering of resident cards (no server move — done as part of report_hideout)',
    });
    // Step 3: Hacker draws to 3 (physical, no server move)
    steps.push({
      move_type: 'report_hideout',
      count: 0,
      description: hackerDigital
        ? 'Hacker: (no physical action — the server drew your hand to 3.)'
        : 'Hacker: shuffle remaining Contacts (including Weapon) and draw until you have 3 cards total (residents + draws).',
      ask_human_for: hackerDigital
        ? 'nothing — server already drew to 3'
        : 'physical shuffle and draw to 3 (no server move — done as part of report_hideout)',
    });
    // Step 4: Detective draws 3 Locations (physical for physical Detective)
    steps.push({
      move_type: 'play_location',
      count: 0,
      description: detectiveDigital
        ? 'Detective: (no physical action — the server held the Location deck and dealt your opening 3.)'
        : hackerHuman
          ? `Detective: shuffle your Location deck (${LOCATIONS.length - 1} cards — the Hacker holds their safehouse card) and draw 3 cards. You will play one on your first turn.`
          : `Detective: shuffle your Location deck (all ${LOCATIONS.length} cards — against an AI Hacker no card is removed) and draw 3 cards. You will play one on your first turn.`,
      ask_human_for: detectiveDigital
        ? 'nothing — server already dealt the opening 3 Locations'
        : 'physical shuffle and draw 3 Locations (no server move — first play_location reports the card)',
    });
    // Step 5: Detective takes POI deck (physical)
    steps.push({
      move_type: 'play_location',
      count: 0,
      description: detectiveDigital
        ? 'Detective: (no physical action — informants are recruited by name from the server-held POI pool.)'
        : 'Detective: take the 24-card POI deck facedown. It is NOT shuffled. You will recruit informants by naming the person.',
      ask_human_for: detectiveDigital
        ? 'nothing — POI deck lives on the server for digital sessions'
        : 'physical POI deck facedown (no server move)',
    });
    return steps;
  }

  // The choice catalog as data — see src/core/choiceCatalog.ts.
  getChoiceCatalog(): PlayerChoice[] {
    return CYBERNOIR_CHOICES;
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      {
        name: 'hideout',
        kind: 'identity',
        description: 'The Hacker\'s chosen hideout location — determines starting Contacts and clue strategy',
        levers: ['sweep', 'strategy'],
        recipe: '--sweep=hideout',
      },
      {
        name: 'overclock_draw_timing',
        kind: 'config',
        description: 'When Overclock grants the Detective 2 Location draws (immediate / next_turn / optional) — AMBIG-4 parameterize-and-measure',
        levers: ['sweep'],
        recipe: '--sweep=overclock_draw_timing',
      },
    ];
  }
}

export const cybernoir2127 = new Cybernoir2127Game();
export default cybernoir2127;