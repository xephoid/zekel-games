import type {
  Game, PlayerConfig, SessionState, GameResult, LegalMove, ApplyMoveResult,
  AIMoveResult, NextStep, SetupStep, BalanceAxis, PlayerChoice,
} from '@zekel/game-kit';
import { GameError, folderOf } from '@zekel/game-kit';
import { createInitialState, applyMove as engineApply, checkGameOver, autoReportMove, type SweetlandsOptions } from './engine.js';
import { getLegalMoves as legal } from './legalMoves.js';
import { getPublicView, getPlayerView } from './views.js';
import { chooseMove, type Difficulty } from './ai.js';
import { randomSeed } from './rng.js';
import { FACTIONS, FACTION_IDS, availableFactionIds } from './data/factions.js';
import { PUBLIC_OBJECTIVES, SECRET_OBJECTIVES, POINTS_TO_WIN, INFLUENCE_CAP } from './data/objectives.js';
import { ALL_TREATS } from './data/intel.js';
import { FOE_DICE } from './types.js';
import type { SweetlandsState, SweetlandsMove } from './types.js';
import { SWEETLANDS_CHOICES } from './choices.js';
import { seatDisplayName } from '@zekel/game-kit';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'RNG seed for reproducible games. Random if omitted.' },
    firstPlayerId: { type: 'string', description: 'Player id who is first player. Defaults to the first seat.' },
    factionAssignment: { type: 'array', items: { type: 'string' }, description: 'Balance harness: per-seat faction assignment (by creation order), filtered to valid factions for the count. All-AI only.' },
  },
} as const;

const moveSchema = {
  oneOf: [
    { type: 'object', required: ['type', 'selections'], properties: { type: { const: 'assign_setup_choices' }, selections: { type: 'object' } } },
    { type: 'object', required: ['type', 'foe'], properties: { type: { const: 'choose_foe' }, foe: { enum: ['dragon', 'orc', 'fiend'] } } },
    { type: 'object', required: ['type', 'objective'], properties: { type: { const: 'choose_secret_objective' }, objective: { type: 'string' } } },
    { type: 'object', required: ['type', 'cards'], properties: { type: { const: 'report_intel_draw' }, cards: { type: 'array' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'resolve_report' } } },
    { type: 'object', required: ['type', 'units'], properties: { type: { const: 'recall' }, units: { type: 'array', items: { enum: ['leader', 'knight', 'ambassador'] } } } },
    { type: 'object', required: ['type', 'cardId', 'unit', 'takeAction'], properties: { type: { const: 'play_intel' }, cardId: { type: 'string' }, unit: { enum: ['leader', 'knight', 'ambassador'] }, takeAction: { type: 'boolean' }, viaRoad: { type: 'boolean' }, entryRegion: { type: 'integer', minimum: 1, maximum: 4 }, targetPlayerId: { type: 'string' }, targetUnit: { enum: ['leader', 'knight', 'ambassador'] }, raiseTaxes: { type: 'boolean' }, treatRegion: { type: 'integer' }, treatSlot: { enum: ['regional', 'random'] }, battleTotal: { type: 'integer', minimum: 0 } } },
    { type: 'object', required: ['type', 'color', 'unit', 'takeAction'], properties: { type: { const: 'play_token' }, color: { enum: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] }, unit: { enum: ['leader', 'knight', 'ambassador'] }, takeAction: { type: 'boolean' }, viaRoad: { type: 'boolean' }, entryRegion: { type: 'integer', minimum: 1, maximum: 4 }, targetPlayerId: { type: 'string' }, targetUnit: { enum: ['leader', 'knight', 'ambassador'] }, raiseTaxes: { type: 'boolean' }, battleTotal: { type: 'integer', minimum: 0 } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'pass' } } },
    { type: 'object', required: ['type', 'cardIds', 'color'], properties: { type: { const: 'discard_for_color' }, cardIds: { type: 'array', items: { type: 'string' } }, color: { enum: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] } } },
    { type: 'object', required: ['type', 'count'], properties: { type: { const: 'discard_sugar' }, count: { type: 'integer', minimum: 1 } } },
    { type: 'object', required: ['type', 'count'], properties: { type: { const: 'trash_influence' }, count: { type: 'integer', minimum: 1 } } },
    { type: 'object', required: ['type', 'withPlayerId'], properties: { type: { const: 'trade' }, withPlayerId: { type: 'string' }, giveInfluence: { type: 'integer' }, giveSugar: { type: 'integer' }, giveIntelCardIds: { type: 'array', items: { type: 'string' } }, giveTokens: { type: 'array' }, receiveInfluence: { type: 'integer' }, receiveSugar: { type: 'integer' }, receiveIntelCardIds: { type: 'array', items: { type: 'string' } }, receiveTokens: { type: 'array' }, swapUnits: { type: 'array' } } },
    { type: 'object', required: ['type', 'color'], properties: { type: { const: 'buy_intel_token' }, color: { enum: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'buy_sugar_cube' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'end_turn' } } },
  ],
} as const;

const sessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. The human has a PHYSICAL copy of Sweetlands Imperium. You are the bookkeeper for shared state (the board, units, taxes, the castle foe, scores) and the brain for the AI faction(s). The 80-card Intel deck is shared and face-down: when a HUMAN gains/draws Intel they draw the physical cards and REPORT them; the server deals each AI's hand from the remainder. Trust the human's declarations; never reveal an AI's hand.

2. SETUP CHOICES ARE THE HUMANS' — ASK, DON'T PICK. Each player chooses a FACTION (Milkshake / Fudge / Jellybean / Cheesecake / Nomads); the table picks ONE foe (Dragon / Orc / Fiend) for the game; each non-Nomads player keeps one of two dealt SECRET objectives. Obey next_step and the setup_checklist.

3. TURN STRUCTURE — ONE INTEL CARD PER TURN. On your turn: (a) optionally RECALL units to your start, (b) GAIN Intel by your Ambassador's region distance, (c) play exactly ONE Intel card — MOVE one of your units to the next space of that color (counter-clockwise; at a junction purple you may branch onto the road to the castle), then optionally take the card's color action (Red=battle/capture, Orange=influence, Yellow=taxes, Green=move or discard-for-unlimited, Blue=collect Intel, Purple=castle), (d) an INFLUENCE phase to buy Intel tokens (1 each) or a sugar cube (3). Do NOT chain steps from memory — obey next_step and get_legal_moves.

4. REPORT AI MOVES IN FULL. The AI's units are virtual but the human moves the physical pieces: relay exactly which card the AI played, which unit moved and where, and every capture / influence / tax / Intel / castle / score change. Never reveal the AI's hidden HAND. Plain game terms, no flavor.

5. WIN at 5 points (public objectives + secret objectives worth 2 each). Use get_rules for the objective list and faction abilities. Never invent card values or counts — read them from this session's tools.`;

// Digital variant (docs/digital-mode.md): a digital human has no physical
// cards — the server holds the shared Intel deck and the player's private hand,
// dealt on Draw button press (resolve_report). The physical instructions
// ("they draw the physical Intel cards and REPORT them") go away.
const digitalSessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. DIGITAL SESSION: the human has NO physical copy. The server shuffles and holds the 80-card Intel deck, deals each starting hand of 3 (and every gain/Blue collect draw) when the digital human presses the Draw button. The human sees their own hand via get_state. AI seats are still server-dealt silently.

2. SETUP CHOICES ARE THE HUMANS' — ASK, DON'T PICK (unchanged). Each human picks faction, the table picks one foe, each human keeps one of two dealt secret objectives. Physical setup rituals (shuffling, drawing, gathering) are gone — replaced by the button.

3. THE DRAW BUTTON. Whenever next_step says a digital human "draws Intel from the shared deck", the legal move offered is resolve_report — a no-payload button. The human presses it and the server deals; the dealt cards appear in their player view. Never invent the draw — the server is the deck.

4. TURN STRUCTURE: recall (optional) → gain Intel (button) → play ONE Intel card (move + optional color action) → influence phase.

5. REPORT AI MOVES IN FULL. The AI's plays are virtual but relay every board-changing fact plainly; never reveal the AI's hand.

6. WIN at 5 points. Never invent card values or counts — read them from this session's tools.`;

// Player-facing rules only — the public rules page renders this verbatim. The
// agent's briefing (physical and digital variants) lives in
// sessionStartGuidance / digitalSessionStartGuidance (getSessionStartGuidance).
const rulesText = `\
Sweetlands Imperium — rules reference (canonical freeze)

Win by reaching ${POINTS_TO_WIN} points. The board is a ring of 4 regions (1 bottom, 2 right, 3 top, 4 left), each 12 ring spaces + a 6-space road to the central castle. Movement is counter-clockwise; spaces cycle ROYGBP. Play an Intel card of a color to move a unit to the next space of that color, then optionally take that color's action.

Factions: ${FACTION_IDS.map((id) => `${FACTIONS[id].name} — ${FACTIONS[id].ability}`).join(' · ')}

Public objectives (one-time each): ${PUBLIC_OBJECTIVES.map((o) => `${o.description} (${o.points})`).join(' · ')}. Secret objectives are worth 2 each, scored when completed.

One foe guards the castle (chosen at setup): Dragon rolls 5 dice, Orc 3, Fiend 2. Battle by rolling your sugar cubes vs the foe/knight; ties go to the defender. Only knights battle/capture. SUGAR CUBES ARE CUSTOM DICE — each has 3 blank faces (0), plus a 1, a 2, and a 3 (so each cube averages 1 pip). You roll one die per sugar cube you own.

Players may TRADE at any time on their turn (influence, sugar, Intel cards/tokens, or swap unit locations) — the table agrees and you record it with the trade move. A player may also voluntarily discard sugar cubes (discard_sugar). Nomads start OFF the board and pick an entry region the first time each unit moves.`;

export class SweetlandsImperiumGame implements Game<SweetlandsState, SweetlandsMove, SweetlandsOptions> {
  readonly id = 'sweetlands-imperium';
  // Serves viz/board.js (and what it imports) to the web debug client.
  readonly webAssetsDir = folderOf(import.meta.url);
  readonly name = 'Sweetlands Imperium';
  readonly description =
    'A 2-5 player candy-themed area-control game. Factions race to 5 points across ' +
    'a ring of 4 regions, playing colored Intel cards to move leaders, knights, and ' +
    'ambassadors, collect taxes and influence, capture rivals, and storm the castle ' +
    'foe. Played with a PHYSICAL board — the server is bookkeeper for shared state and ' +
    'brain for the AI factions; the shared Intel deck uses report-draw.';
  readonly minPlayers = 2;
  readonly maxPlayers = 5;
  readonly supportsAI = true;
  readonly hasHiddenInformation = true;
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;

  createSession(players: PlayerConfig[], options?: SweetlandsOptions): SessionState<SweetlandsState> {
    if (players.length < 2 || players.length > 5) {
      throw new GameError('INVALID_PLAYERS', `Sweetlands Imperium supports 2-5 players; got ${players.length}`);
    }
    const ids = new Set(players.map((p) => p.player_id));
    if (ids.size !== players.length) throw new GameError('INVALID_PLAYERS', 'Duplicate player_id');
    const seed = options?.seed ?? randomSeed();
    const initial = createInitialState(players, options, seed);
    return {
      sessionId: '', gameId: this.id, players,
      activePlayerId: initial.activePlayerId,
      turnNumber: initial.round,
      gameState: initial, moveLog: [], createdAt: new Date().toISOString(),
    };
  }

  getLegalMoves(state: SessionState<SweetlandsState>, playerId: string): LegalMove<SweetlandsMove>[] {
    return legal(state.gameState, playerId);
  }
  getPublicView(state: SessionState<SweetlandsState>): unknown { return getPublicView(state.gameState); }
  getPlayerView(state: SessionState<SweetlandsState>, playerId: string): unknown { return getPlayerView(state.gameState, playerId); }

  isGameOver(state: SessionState<SweetlandsState>): GameResult | null {
    const r = checkGameOver(state.gameState);
    if (!r.game_over) return null;
    return { game_over: true, winners: r.winners, scores: r.scores, summary: r.summary };
  }

  applyMove(state: SessionState<SweetlandsState>, playerId: string, move: SweetlandsMove): ApplyMoveResult<SweetlandsState> {
    const result = engineApply(state.gameState, playerId, move);
    return {
      newState: { ...state, gameState: result.newState, activePlayerId: result.newState.activePlayerId, turnNumber: result.newState.round },
      summary: result.summary,
    };
  }

  async getAIMove(state: SessionState<SweetlandsState>, playerId: string, difficulty?: string, strategy?: string): Promise<AIMoveResult<SweetlandsMove>> {
    const d: Difficulty = difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'medium';
    const { move, narration } = chooseMove(state.gameState, playerId, d, strategy);
    return { move, narration };
  }

  getScoreboard(state: SessionState<SweetlandsState>): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const p of state.gameState.players) {
      out[p.playerId] = { points: p.points, influence: p.influence, sugar_cubes: p.sugarCubes };
    }
    return out;
  }

  describeNextStep(state: SessionState<SweetlandsState>): NextStep | null {
    const s = state.gameState;
    // Mid-game: a human owes Intel from the shared deck (turn-start gain or
    // Blue collect). Digital humans press the Draw button; physical humans
    // report what they physically drew. Route to that human either way — even
    // when an AI looks "active".
    if (s.pending?.kind === 'report_intel') {
      const who = s.pending.forPlayerId;
      const seat = s.players.find((p) => p.playerId === who);
      const reason = s.pending.reason === 'gain' ? 'turn-start gain' : 'Blue collect';
      const n = s.pending.count;
      const cardsWord = n === 1 ? 'card' : 'cards';
      const factReason = s.pending.reason === 'gain'
        ? `${seatDisplayName(state.players, who)} gains Intel at the start of the turn.`
        : `${seatDisplayName(state.players, who)} collects Intel from a Blue space.`;
      const turnOwner = s.activePlayerId && s.activePlayerId !== who ? { turn_owner_id: s.activePlayerId } : {};
      if (seat?.digital === true) {
        return { status: 'human_to_move', active_player_id: who, instruction:
          `${who} draws ${s.pending.count} Intel from the shared deck (${reason}). Send resolve_report{} — the server deals the ${s.pending.count} card(s).`,
          human_response: {
            ask: `Ready to draw ${n} Intel ${cardsWord}?`,
            example: 'Draw',
            records_as: 'resolve_report {}',
          },
          facts: { phase: 'Play', ...turnOwner, reason: factReason, notes: [`${n} Intel ${cardsWord} come from the shared deck.`, 'The server deals the cards.'] } };
      }
      return { status: 'human_to_move', active_player_id: who, instruction:
        `${who} drew ${s.pending.count} Intel from the shared deck (${reason}). ASK which ${s.pending.count} card(s) (by color, or treat name) and send report_intel_draw{player_id:"${who}", cards:[...]}. Do NOT invent them.`,
        human_response: {
          ask: `Which ${n} Intel ${cardsWord} did you draw? Name each by colour, or by treat name.`,
          example: ['a red single', 'a blue double', 'Chocolate Bar'].slice(0, Math.min(n, 3)).join(', '),
          records_as: 'report_intel_draw { cards: [{ kind: single | double, color } or { kind: treat, treat }] }',
          // The drawn Intel joins a hidden hand.
          private: true,
        },
        facts: { phase: 'Play', ...turnOwner, reason: factReason, notes: [`${n} Intel ${cardsWord} drawn from the shared deck.`, 'Name each card by colour, or by treat name.'] } };
    }
    switch (s.phase) {
      case 'setup_factions': {
        const reporter = state.players.find((p) => p.kind === 'human')?.player_id;
        if (!reporter) return null;
        const pool = availableFactionIds(state.players.length);
        const nomadNote = state.players.length === 5 ? ' (5 players: one seat must be the Nomads).' : ' (Nomads are 5-player only).';
        const firstSeat = state.players[0]!;
        return { status: 'human_to_move', active_player_id: reporter, instruction:
          `SETUP — assign each player a faction (${pool.join(', ')})${nomadNote} Ask each human which they want; pick one for each AI seat (all distinct). Send assign_setup_choices{selections:{<player_id>:<faction>,...}}. Do NOT pick the humans' factions for them.`,
          human_response: {
            ask: 'Which faction does each player take? Each human picks their own first, then each AI seat gets one of the rest.',
            example: `${seatDisplayName(state.players, firstSeat.player_id)} takes ${FACTIONS[pool[0]!].name}`,
            records_as: `assign_setup_choices { selections: { <player_id>: <faction id: ${pool.join(' | ')}> } }`,
          },
          facts: {
            phase: 'Setup',
            options: pool.map((id) => FACTIONS[id].name),
            notes: [
              'Every player gets a different faction.',
              state.players.length === 5 ? 'With 5 players, one seat must be the Nomads.' : 'The Nomads are only used with 5 players.',
            ],
          } };
      }
      case 'setup_foe': {
        const reporter = state.players.find((p) => p.kind === 'human')?.player_id;
        if (!reporter) return null;
        const foes = Object.keys(FOE_DICE) as Array<keyof typeof FOE_DICE>;
        return { status: 'human_to_move', active_player_id: reporter, instruction:
          'SETUP — the table picks ONE foe to guard the castle: dragon (5 dice), orc (3), or fiend (2). Send choose_foe{foe}.',
          human_response: {
            ask: `Which foe guards the castle: ${foes.join(', ')}?`,
            example: foes[0]!,
            records_as: `choose_foe { foe: ${foes.join(' | ')} }`,
          },
          facts: {
            phase: 'Setup',
            reason: 'The table picks one foe to guard the castle.',
            options: foes.map((f) => `${f} (${FOE_DICE[f]} dice)`),
          } };
      }
      case 'setup_secrets': {
        const head = s.setup.awaitingSecretFrom[0];
        const seat = state.players.find((p) => p.player_id === head);
        if (!seat || seat.kind !== 'human') return null;
        const deal = s.setup.secretDeal[head!] ?? [];
        const describe = (id: string) => SECRET_OBJECTIVES.find((o) => o.id === id)?.description ?? id;
        return { status: 'human_to_move', active_player_id: head!, instruction:
          `SETUP — ${head} keeps ONE of their two dealt secret objectives (the other passes right). Call get_legal_moves for the two options and send choose_secret_objective{objective}.`,
          human_response: {
            ask: `Which secret objective do you keep: ${deal.map(describe).join(' or ')}`,
            example: deal[0] ? describe(deal[0]) : 'the first one',
            records_as: 'choose_secret_objective { objective }',
            // The kept objective is secret.
            private: true,
          },
          facts: {
            phase: 'Setup',
            options: deal.map(describe),
            notes: ['Keep 1 of the 2 dealt secret objectives.', 'The other one passes to the player on the right.'],
          } };
      }
      case 'setup_intel': {
        const human = s.players.find((p) => p.kind === 'human' && p.hand.length === 0);
        if (!human) return null;
        const STARTING_INTEL = 3; // the count legalMoves.ts offers and engine.ts deals each AI
        const humanName = seatDisplayName(state.players, human.playerId);
        if (human.digital === true) {
          return { status: 'human_to_move', active_player_id: human.playerId, instruction:
            `SETUP — ${human.playerId} draws 3 starting Intel from the shared deck. Send resolve_report{} — the server deals the 3 cards.`,
            human_response: {
              ask: `Ready to draw your ${STARTING_INTEL} starting Intel cards?`,
              example: 'Draw',
              records_as: 'resolve_report {}',
            },
            facts: { phase: 'Setup', reason: `${humanName} draws starting Intel.`, notes: [`${STARTING_INTEL} Intel cards come from the shared deck.`, 'The server deals the cards.'] } };
        }
        return { status: 'human_to_move', active_player_id: human.playerId, instruction:
          `SETUP — ${human.playerId} drew 3 starting Intel from the shared deck. ASK which 3 (by color, or treat name) and send report_intel_draw{cards:[...]}. Do NOT invent them.`,
          human_response: {
            ask: `Which ${STARTING_INTEL} Intel cards did you draw? Name each by colour, or by treat name.`,
            example: 'a red single, a blue double, Chocolate Bar',
            records_as: 'report_intel_draw { cards: [{ kind: single | double, color } or { kind: treat, treat }] }',
            // The starting Intel is a hidden hand.
            private: true,
          },
          facts: { phase: 'Setup', reason: `${humanName} draws starting Intel.`, notes: [`${STARTING_INTEL} Intel cards drawn from the shared deck.`, 'Name each card by colour, or by treat name.'] } };
      }
      default:
        return null; // play phase: generic kind-based directive stands
    }
  }

  getSetupChecklist(state: SessionState<SweetlandsState>): SetupStep[] {
    const humans = state.players.filter((p) => p.kind === 'human');
    if (humans.length === 0) return []; // all-AI auto-setup
    const anyDigital = state.players.some((p) => p.kind === 'human' && p.table === 'digital');
    return [
      { move_type: 'assign_setup_choices', count: 1, description: 'Assign each player a faction (distinct).', ask_human_for: "each human's chosen faction (and one for each AI seat)" },
      { move_type: 'choose_foe', count: 1, description: 'Pick the single castle foe (dragon/orc/fiend).', ask_human_for: 'which foe the table wants to face' },
      { move_type: 'choose_secret_objective', count: humans.length, description: 'Each human keeps one of two dealt secret objectives.', ask_human_for: "each human's kept secret objective" },
      anyDigital
        ? { move_type: 'resolve_report', count: humans.length, description: 'Each human draws their 3 starting Intel — digital seats press the button, physical seats report.', ask_human_for: "each digital human to press Draw; each physical human's 3 drawn Intel cards" }
        : { move_type: 'report_intel_draw', count: humans.length, description: 'Each human reports the 3 starting Intel cards they drew.', ask_human_for: "each human's 3 starting Intel cards" },
    ];
  }

  // The post-port §6 choice table as data — see src/core/choiceCatalog.ts.
  getChoiceCatalog(): PlayerChoice[] {
    return SWEETLANDS_CHOICES;
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      { name: 'faction', kind: 'identity', description: 'Which faction each seat plays (Milkshake/Fudge/Jellybean/Cheesecake/Nomads) — distinct abilities. Nomads are 5-player only.', levers: ['sweep'], recipe: '--sweep=faction (per-seat faction shuffle, decoupled from seat)' },
      { name: 'foe', kind: 'scenario', description: 'Which foe guards the castle (Dragon 5 / Orc 3 / Fiend 2 dice).', levers: ['scenario'], recipe: 'run per foe and compare' },
    ];
  }

  // Synthesize a valid Intel report from the server's tracked deck. Callers:
  // (a) a digital human pressing the Draw button — doResolveReport routes here;
  // (b) the test/desync harness driving a seat past a report it can't know.
  autoResolveReport(state: SessionState<SweetlandsState>, playerId: string): { move: SweetlandsMove } | null {
    const m = autoReportMove(state.gameState, playerId);
    return m ? { move: m } : null;
  }

  getRulesText(): string { return rulesText; }
  getSessionStartGuidance(table?: 'physical' | 'digital'): string {
    if (table === 'digital') return digitalSessionStartGuidance;
    return sessionStartGuidance;
  }

  getReferenceData(): unknown {
    return {
      factions: FACTION_IDS.map((id) => ({ id, name: FACTIONS[id].name, region: FACTIONS[id].homeRegion, color: FACTIONS[id].color, ability: FACTIONS[id].ability })),
      public_objectives: PUBLIC_OBJECTIVES,
      secret_objectives: SECRET_OBJECTIVES,
      foes: Object.entries(FOE_DICE).map(([type, dice]) => ({ type, dice })),
      treats: ALL_TREATS,
      points_to_win: POINTS_TO_WIN,
      influence_cap: INFLUENCE_CAP,
      colors_in_order: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
      sugar_die_faces: [0, 0, 0, 1, 2, 3],
      intel_deck: '60 single-color (10 each) + 12 double (2 per color, acts twice) + 8 treat',
    };
  }
}

export const sweetlandsImperium = new SweetlandsImperiumGame();
export default sweetlandsImperium;
