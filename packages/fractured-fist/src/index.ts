import type { Game, PlayerConfig, SessionState, GameResult, LegalMove, ApplyMoveResult, AIMoveResult, BalanceAxis, PlayerChoice,
  NextStep, SetupStep, MoveGateStatus, RuleSection, PhysicalSetupStep, SessionContext, PrivateReveal,
} from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { isDigitalSeat } from '@zekel/game-kit';
import { applyMove as engineApply, checkGameOver, createInitialState } from './engine.js';
import { getLegalMoves as moves } from './legalMoves.js';
import { getPlayerView, getPublicView } from './views.js';
import { chooseMove, parseStrategy, type Difficulty } from './ai.js';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { getFFHeuristicValue, getFFReward, pickFFRolloutMove } from './mctsHooks.js';
import { randomSeed } from '@zekel/game-kit';
import { CARDS } from './cards.js';
import type { FFMove, FFOptions, FFState } from './types.js';
import { FRACTURED_FIST_CHOICES } from './choices.js';
import { seatNamer } from './narration.js';
import { describeFFNextStep } from './nextStep.js';
import { describeFFMoveGates } from './moveGates.js';
import { suggestOpaqueMove } from './suggest.js';
import { physicalSetupSteps, sessionContext } from './setup.js';
import { getCard as cardDef } from './cards.js';
import { FF_RULE_SECTIONS } from './rulesSections.js';
import { renderRulesText } from '@zekel/game-kit';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: {
      type: 'integer',
      minimum: 0,
      description: 'RNG seed for reproducible games. Random if omitted.',
    },
    loadout: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Array of technique card IDs that form the shared supply for this game. ' +
        'A standard Fractured Fist game uses 7 techniques. ASK THE PLAYER which 7 ' +
        'techniques they want before calling create_session — do not silently use ' +
        'the default. Available technique IDs can be discovered by reading ' +
        'game://fractured-fist/rules or by inspecting card metadata. If omitted, a ' +
        'balanced 7-card default (the canonical "starter cards") is used.',
    },
    startingStamina: {
      type: 'integer',
      minimum: 1,
      default: 7,
    },
    handSize: {
      type: 'integer',
      minimum: 1,
      default: 5,
    },
  },
} as const;

const moveSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        type: { const: 'play_card' },
        card_id: {
          type: 'string',
          description: 'The card played, by id or printed name (e.g. "devastating_blow" or "Devastating Blow").',
        },
        hand_index: {
          type: 'integer',
          minimum: 0,
          description: 'Server-tracked hands only: which hand slot. A physical (opaque) player omits it.',
        },
      },
      required: ['type', 'card_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { const: 'buy_card' },
        card_id: {
          type: 'string',
          description: 'The card bought from your supply, by id or printed name.',
        },
      },
      required: ['type', 'card_id'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { const: 'refine_card' },
        hand_index: {
          type: 'integer',
          minimum: 0,
          description: 'Server-tracked hands only: which hand slot to refine (or name the card with card_id).',
        },
        card_id: {
          type: 'string',
          description: 'Server-tracked hands only: the card refined, by printed name (e.g. "Misstep").',
        },
        was_misstep: {
          type: 'boolean',
          description: 'Physical (opaque) player only, and required for them: true if the refined card was a Misstep.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { type: { const: 'skip_refine' } },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { type: { const: 'advance_phase' } },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: { type: { const: 'end_turn' } },
      required: ['type'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        type: { const: 'focus_reload' },
        count: {
          type: 'integer',
          minimum: 1,
          description: 'Physical (opaque) player only, and required for them: how many Focus cards they discarded.',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
  ],
} as const;

// Persona/voice guidance — embedded in the create_session response so the
// agent ALWAYS sees it on session start, regardless of whether it reads the
// rules resource separately.
const sessionStartGuidance = `\
HOW TO RUN THIS GAME (read this before continuing — it overrides default behavior):

1. This server assumes the human player has a PHYSICAL copy of Fractured Fist (the cards) in front of them. You are NOT running a virtual game on the human's behalf. The human shuffles their own deck, draws their own hand, and physically plays cards on the table. You track shared state (supply, stamina, damage/defense queued) and play the AI opponent. If the human gives any indication they don't have the physical cards, recommend they get the game out before continuing. If the table is not set up yet, walk them through PHYSICAL SETUP below, one step at a time.

PHYSICAL SETUP (one physical action per step; the numbers come from this session's get_state, never from memory):
   1. Find the technique cards in this game's loadout: the technique ids listed in your own supply in get_state.
   2. Make your supply: set out that many copies of each loadout technique (your supply count in get_state), one pile per card.
   3. Add Focus, Momentum and Mastery piles to your supply.
   4. Build your starting deck: 7 Focus cards and 3 Misstep cards.
   5. Shuffle your starting deck.
   6. Draw your opening hand (starting_hand_size in get_state).
   7. Set your stamina tracker to your max_stamina in get_state.
   8. Set a stamina tracker for the AI to its max_stamina in get_state. The server keeps the AI's deck, hand and supply, so do not lay those out.
   9. Put spare Misstep cards within reach: some AI cards put Missteps into your discard pile.
   10. The first seat in player_order takes the first turn.

2. The human's hand and deck contents are PRIVATE to them — the server does not track them and you must not pretend to know what they hold. When they declare a play ("I played Devastating Blow"), trust them. Don't ask "but did you actually have that card?" — they're holding it; you aren't.

3. REPORT MOVES IN PLAIN GAME TERMS — no flavor, no fight-commentary, no story. State what happened using the game's own vocabulary (card names, damage/defense queued, spirit spent, cards bought). The human can SEE their stamina chips, the cards on the table, the supply — don't recite that back. Each turn, keep it short:
   - State the action factually: "The opponent plays Devastating Blow — 3 damage queued, draws a card." Skip restating their stamina, your stamina, the supply contents, etc.
   - At end of round, report the strike plainly: "You queued 4, opponent had 2 defense — they take 2 stamina." The human can see the stamina drop happen physically.
   - DO NOT pre-recap state ("you're at 8 stamina, they're at 10, the supply has these cards..."). Just report what changed.
   - DO NOT enumerate the supply every channel phase. The human can read the cards.
   - Relay the per-move summary from get_ai_move / apply_move exactly — it is the authoritative fact. For an AI move report EVERY board-changing fact it contains (what it played, damage/defense queued, cards bought/drawn) so the human can update the table; the human cannot see the AI's play. Never add detail the summary didn't contain.

4. DO NOT do these things unless the human explicitly asks:
   - Give strategy advice ("you should buy a block now"). Call moves, don't grade them.
   - Predict what the AI will do next turn. You only know what already happened.
   - Speculate about rules or card effects you're not certain of. If a rules question isn't answered by what you've already been told, CALL the get_rules tool with game_id="fractured-fist" — it returns the full rules text AND the complete card catalog (every card's cost, effects, description). Read it before answering. Never invent card effects.

5. If you're confused about the state, ask the human a clarifying question instead of guessing. If the server rejects one of their declared moves, relay the error verbatim and ask what they meant.

6. NEVER INVENT VALUES. Do not guess any card's cost, value (spirit produced), effects, or description. If you need a card's stats and they aren't already in your context from a prior tool response, CALL get_rules first — its reference_data includes every card's full definition. If a value is still missing or ambiguous, ASK THE HUMAN to read it off the physical card. Hallucinating values is a hard correctness violation.

7. YOU ARE A BOOKKEEPER, NOT A COACH. Do not ask the human what's in their hand. Do not suggest plays, evaluate their choices, or hint at what they should do — even if they ask. They can see their own cards; they pick what to play and tell you what they played. If they ask for help, redirect: "you know your hand best." This is a hard rule.
`;

// Digital variant (docs/digital-mode.md): the human has NO physical cards —
// the server shuffles and deals their hand, tracked server-side. Physical
// rituals (shuffle / draw / "hold your cards") go away; report-of-play stays.
const digitalSessionStartGuidance = `\
HOW TO RUN THIS GAME (read this before continuing — it overrides default behavior):

1. DIGITAL SESSION: the human player has NO physical copy of Fractured Fist and no physical cards. The server shuffles and deals their deck, tracks their hand, and shows it to them privately via get_state. The AI's hand is also server-held. You are running a digital tabletop: the player sees their own cards in the player view, picks what to play, and submits the move.

2. The human's tracked hand is still PRIVATE to them — the AI never sees it and neither do opponents in mixed sessions. When the human declares a play, the server validates the card is actually in their tracked hand. They cannot claim cards they don't hold. Do not ask them to recite or prove what's in their hand — get_state shows it to them.

3. REPORT MOVES IN PLAIN GAME TERMS — no flavor, no fight-commentary, no story. State what happened using the game's own vocabulary (card names, damage/defense queued, spirit spent, cards bought). Keep each turn short: state the action factually; relay AI moves in full from the summary; never invent detail.

4. DO NOT give strategy advice, call predicted AI plays, or speculate about rules. If a rules question isn't answered by what you've been told, CALL get_rules with game_id="fractured-fist".

5. If you're confused about state, ask the human a clarifying question. If the server rejects a move, relay the error verbatim.

6. NEVER INVENT VALUES — no card cost / spirit / effects by memory. Use get_rules reference_data.
`;


// The AI's move in the form a person would say it: which CARD, never which
// hidden hand slot. A player copying the AI's turn onto the table (or a voice
// app reading it) can only know the card name — the slot is server-internal —
// so the AI hands back card-named moves and the engine finds the slot. Copies
// of a card are identical, so the result is the same.
function declaredForm(move: FFMove, gs: FFState, playerId: string): FFMove {
  if (move.type === 'play_card') return { type: 'play_card', card_id: move.card_id };
  const me = gs.players[playerId];
  if (move.type === 'refine_card' && move.hand_index !== undefined && me?.kind === 'tracked') {
    const card = me.hand[move.hand_index];
    if (card !== undefined) return { type: 'refine_card', card_id: card };
  }
  return move;
}

// A digital human's hand is server-tracked: the cards they just drew are theirs
// alone, so they go out as a private reveal (shown on their screen), never in
// the spoken summary. AI hands and physical hands are never revealed.
function drawnCardReveals(state: SessionState<FFState>, before: FFState, after: FFState): PrivateReveal[] {
  const reveals: PrivateReveal[] = [];
  for (const seat of state.players) {
    if (seat.kind !== 'human') continue;
    const b = before.players[seat.player_id];
    const a = after.players[seat.player_id];
    if (b?.kind !== 'tracked' || a?.kind !== 'tracked') continue;
    // Draws pop from the END of the deck. If the new deck is the front of the
    // old one, the drawn cards are exactly the popped tail, newest last.
    const kept = a.deck.length;
    const noReshuffle = kept <= b.deck.length && a.deck.every((c, i) => c === b.deck[i]);
    let text: string | null = null;
    if (noReshuffle && kept < b.deck.length) {
      const drawn = b.deck.slice(kept).reverse().map((id) => cardDef(id).name);
      text = `You drew ${listNames(drawn)}.`;
    } else if (!noReshuffle) {
      // The discard pile was shuffled into a new deck mid-draw: say the whole hand.
      text = `Your deck was reshuffled. Your hand is now ${listNames(a.hand.map((id) => cardDef(id).name))}.`;
    }
    if (text) reveals.push({ player_id: seat.player_id, text });
  }
  return reveals;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export class FracturedFistGame implements Game<FFState, FFMove, FFOptions> {
  readonly id = 'fractured-fist';
  readonly name = 'Fractured Fist';
  readonly description =
    'A two-player deck-building combat game played with PHYSICAL cards in ' +
    'front of the human — server tracks shared state + AI opponent only; ' +
    'human manages their own hand/deck on a real table. Channel spirit, ' +
    'play techniques, queue damage and defense, reduce your opponent\'s ' +
    'stamina to zero. Agent reports moves plainly in game terms.';
  readonly minPlayers = 2;
  readonly maxPlayers = 2;
  readonly supportsAI = true;
  readonly hasHiddenInformation = true;
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;

  createSession(players: PlayerConfig[], options?: FFOptions): SessionState<FFState> {
    if (players.length !== 2) {
      throw new GameError(
        'INVALID_PLAYERS',
        `Fractured Fist requires exactly 2 players; got ${players.length}`,
      );
    }
    const ids = players.map((p) => p.player_id);
    const kinds: Record<string, 'tracked' | 'opaque'> = {};
    for (const p of players) {
      // State ownership follows the seat's table mode (docs/digital-mode.md):
      // physical humans are opaque (server tracks counts, not contents);
      // digital seats — AI always, humans by opt-in — are fully tracked.
      kinds[p.player_id] = isDigitalSeat(p) ? 'tracked' : 'opaque';
    }
    const seed = options?.seed ?? randomSeed();
    const initial = createInitialState(ids, kinds, options, seed);
    return {
      sessionId: '',  // dispatcher fills in
      gameId: this.id,
      players,
      activePlayerId: initial.activePlayerId,
      turnNumber: 1,
      gameState: initial,
      moveLog: [],
      createdAt: new Date().toISOString(),
    };
  }

  getLegalMoves(state: SessionState<FFState>, playerId: string): LegalMove<FFMove>[] {
    return moves(state.gameState, playerId);
  }

  getPublicView(state: SessionState<FFState>): unknown {
    return getPublicView(state.gameState);
  }

  getPlayerView(state: SessionState<FFState>, playerId: string): unknown {
    return getPlayerView(state.gameState, playerId);
  }

  // Per-player PUBLIC scalar counters. The framework diffs this before/after each
  // move and attaches "spent X, gained Y" deltas to the moveLog — the cheap
  // auto-delta reporting path (this game does not author its own rich log).
  // Card CONTENTS stay private; only the public counts are exposed here.
  getScoreboard(state: SessionState<FFState>): Record<string, Record<string, number>> {
    const board: Record<string, Record<string, number>> = {};
    for (const [pid, p] of Object.entries(state.gameState.players)) {
      board[pid] = {
        stamina: p.stamina,
        actions: p.actions,
        channels: p.channels,
        spirit: p.spirit,
        damageQueued: p.damageQueued,
        defenseQueued: p.defenseQueued,
        handSize: p.handSize,
        deckSize: p.deckSize,
        discardSize: p.discardSize,
        misstepCount: p.misstepCount,
      };
    }
    return board;
  }

  isGameOver(state: SessionState<FFState>): GameResult | null {
    const r = checkGameOver(state.gameState);
    if (!r.game_over) return null;
    return {
      game_over: true,
      winners: r.winners,
      scores: r.scores,
      summary: r.summary,
    };
  }

  applyMove(state: SessionState<FFState>, playerId: string, move: FFMove): ApplyMoveResult<FFState> {
    const result = engineApply(state.gameState, playerId, move, seatNamer(state.players));
    const privateReveals = drawnCardReveals(state, state.gameState, result.newState);
    return {
      newState: {
        ...state,
        gameState: result.newState,
        activePlayerId: result.newState.activePlayerId,
        turnNumber: result.newState.round,
      },
      summary: result.summary,
      ...(privateReveals.length > 0 ? { privateReveals } : {}),
    };
  }

  async getAIMove(
    state: SessionState<FFState>,
    playerId: string,
    difficulty?: string,
    strategy?: string,
  ): Promise<AIMoveResult<FFMove>> {
    const move = declaredForm(this.chooseAIMove(state, playerId, difficulty, strategy), state.gameState, playerId);
    // The narration IS the move's spoken summary (docs/spoken-narration.md):
    // run_ai_turn returns both `narration` and `state_summary`, and the
    // summary is the canonical string zekel Live reads aloud, so the AI's line
    // is the same text — the two can never disagree.
    return { move, narration: this.applyMove(state, playerId, move).summary };
  }

  private chooseAIMove(
    state: SessionState<FFState>,
    playerId: string,
    difficulty?: string,
    strategy?: string,
  ): FFMove {
    const strat = parseStrategy(strategy);
    if (difficulty === 'mcts') {
      const legal = moves(state.gameState, playerId);
      if (legal.length === 0) {
        // Fall back to the existing heuristic's empty-case behavior.
        return chooseMove(state.gameState, playerId, 'medium', strat).move;
      }
      // MCTS searches the real game tree, so a buy-priority strategy doesn't apply
      // to its move choice; it ignores `strategy` (it already plays to win outright).
      // Per-move budget defaults to 1000ms but can be tuned via MCTS_BUDGET_MS so the
      // harness can run mcts batches at a feasible per-move cost.
      const envBudget = Number(process.env.MCTS_BUDGET_MS);
      const budget_ms = Number.isFinite(envBudget) && envBudget > 0 ? envBudget : 1000;
      const result = chooseMoveMCTS(this, state, playerId, { budget_ms });
      // Search detail is debugging output — the server log (stderr, only when
      // MCTS_DEBUG is set so batch runs stay quiet), never the spoken line.
      if (process.env.MCTS_DEBUG) process.stderr.write(
        `[fractured-fist] ${playerId} (mcts) picked ${result.move.type} after ${result.iterations} simulations
`,
      );
      return result.move;
    }
    const d: Difficulty = difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'medium';
    return chooseMove(state.gameState, playerId, d, strat).move;
  }

  // Generic-MCTS hooks (see src/core/game.ts and src/ai/mcts.ts).
  getRewardForPlayer(state: SessionState<FFState>, playerId: string): number {
    return getFFReward(state, playerId);
  }

  selectRolloutMove(state: SessionState<FFState>, playerId: string): FFMove | null {
    return pickFFRolloutMove(state, playerId);
  }

  getHeuristicValue(state: SessionState<FFState>, playerId: string): number {
    return getFFHeuristicValue(state, playerId);
  }

  describeNextStep(state: SessionState<FFState>): NextStep | null {
    return describeFFNextStep(state);
  }

  // Harness-only (suggest_move): a physical seat's plausible move — see suggest.ts.
  // Server-tracked seats return null and defer to getAIMove.
  getSuggestedMove(state: SessionState<FFState>, playerId: string): { move: FFMove } | null {
    return suggestOpaqueMove(state, playerId);
  }

  // Every human step is their own turn; setup is entirely physical, with
  // nothing for the human to report before play starts (the loadout is an
  // option passed to create_session), so the checklist is empty.
  getSetupChecklist(): SetupStep[] {
    return [];
  }

  getPhysicalSetup(state: SessionState<FFState>): PhysicalSetupStep[] {
    return physicalSetupSteps(state);
  }

  getSessionContext(table?: 'physical' | 'digital'): SessionContext {
    return sessionContext(table);
  }

  getRulesText(): string {
    return renderRulesText(FF_RULE_SECTIONS);
  }

  getRulesSections(): RuleSection[] {
    return FF_RULE_SECTIONS;
  }

  describeMoveGates(state: SessionState<FFState>, playerId: string): MoveGateStatus[] {
    return describeFFMoveGates(state, playerId);
  }

  getCurrentPhase(state: SessionState<FFState>): string | null {
    const phase = state.gameState.phase;
    return phase === 'game_over' ? null : phase;
  }

  getSessionStartGuidance(table?: 'physical' | 'digital'): string {
    // docs/digital-mode.md: a digital human holds no cards — the server deals
    // and tracks their hand, and the physical-only rules (§1, §2, §7) do not
    // apply. Relay that the server holds the deck and deals private hands.
    if (table === 'digital') return digitalSessionStartGuidance;
    return sessionStartGuidance;
  }

  getReferenceData(): unknown {
    // Full card catalog so the agent has authoritative answers to "what does
    // this card do" without speculating.
    return {
      cards: CARDS.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        cost: c.cost,
        ...(c.value !== undefined ? { value: c.value } : {}),
        description: c.description,
        ...(c.effects ? { effects: c.effects } : {}),
        ...(c.faction ? { faction: c.faction } : {}),
      })),
      starter_loadout: ['attack', 'block', 'assess', 'center', 'distract', 'quicken', 'react'],
      starting_deck: ['focus', 'focus', 'focus', 'focus', 'focus', 'focus', 'focus', 'misstep', 'misstep', 'misstep'],
      starting_stamina_default: 7,
      starting_hand_size_default: 5,
      max_missteps: 10,
    };
  }

  // The choice catalog as data — see src/core/choiceCatalog.ts.
  getChoiceCatalog(): PlayerChoice[] {
    return FRACTURED_FIST_CHOICES;
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      {
        name: 'faction',
        kind: 'identity',
        description: 'Fighting style each player pursues (Titan/burst, Awakened/sustain, Masters/defense, Uncounted/misstep).',
        levers: ['strategy'],
        recipe: '--strategy=titan,awakened,masters,uncounted (pool: random pairing per game)',
      },
      {
        name: 'loadout',
        kind: 'config',
        description: 'The shared 7-card pool both players draft from. Default fixes it; vary so the whole card pool is exercised.',
        levers: ['sweep', 'strategy'],
        recipe: '--sweep=loadout (random) OR --strategy=<factions> (co-drafts a faction-themed loadout)',
      },
    ];
  }
}

export const fracturedFist = new FracturedFistGame();
export default fracturedFist;
