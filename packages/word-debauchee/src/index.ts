// Word Debauchee as a zekel game module. The rules live in engine/ (PLAN.md);
// this file adapts them to the Game interface. The server is the deck, the
// referee, the scorekeeper and any AI seat; the tiles are the table's own or
// held here as text. Hidden from every seat but the debauchee: the dealt
// words, the chosen word and the clue hand.

import type {
  AIMoveResult,
  ApplyMoveResult,
  BalanceAxis,
  Game,
  GameResult,
  LegalMove,
  MoveGateStatus,
  NextStep,
  PhysicalSetupStep,
  PlayerChoice,
  PlayerConfig,
  ReportVoice,
  RuleSection,
  SessionState,
  SetupStep,
} from '@zekel/game-kit';
import { GameError, renderRulesText, seatDisplayName } from '@zekel/game-kit';
import { chooseAIMove } from './ai.js';
import { WORD_DEBAUCHEE_CHOICES } from './choices.js';
import { CLUES, clue } from './data/clues.js';
import { CARDS } from './data/deck.js';
import { TILE_COUNTS, TILE_TOTAL } from './data/tiles.js';
import { CATEGORIES, WORD_TYPES } from './data/wordCard.js';
import { applyMove as engineApply } from './engine/apply.js';
import { RuleError } from './engine/errors.js';
import { activeSeatId, nameOf } from './engine/helpers.js';
import { MOVE_TYPES, type WordDebaucheeMove } from './engine/moves.js';
import { createState, DEFAULT_TILES_PER_REVEAL, MAX_PLAYERS, MIN_CRACK_PAYOUT, MIN_PLAYERS } from './engine/round.js';
import { SCOREKEEPER_VOICE, SESSION_START_GUIDANCE } from './guidance.js';
import { getLegalMoves as legal } from './legalMoves.js';
import { moveGates } from './moveGates.js';
import { describeNextStep as nextStep } from './nextStep.js';
import { WORD_DEBAUCHEE_RULE_SECTIONS } from './rulesSections.js';
import type { Seat, WordDebaucheeOptions, WordDebaucheeState } from './types.js';
import { getPlayerView, getPublicView } from './views.js';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'RNG seed: the decks and the first debauchee. Random if omitted.' },
    tiles: {
      enum: ['table', 'server'],
      description:
        'Who holds the 144 tiles. "table" (default): the players\' own tiles; the server tracks none, and checks are trusted as declared. ' +
        '"server": the pool and build area are held here as text, one tile per turn. Forced to "server" when any seat is an AI.',
    },
    timer: {
      enum: ['laps', 'sand'],
      description: '"laps" (default): a reveal each time the turn comes back round to the first guesser. "sand": the table runs the 30-second timer and reports timer_out.',
    },
    tilesPerReveal: { type: 'integer', minimum: 1, description: `Two-player duel under laps: tiles between reveals (default ${DEFAULT_TILES_PER_REVEAL}).` },
    rounds: { type: 'integer', minimum: 1, description: 'Rounds in the game. Default: once round the table with 5–8 players, twice with 2–4.' },
    firstDebauchee: { type: 'string', description: 'player_id of the first debauchee (whoever most recently got away with something). Default: random.' },
  },
} as const;

const clueIds = CLUES.map((c) => c.id);

const moveSchema = {
  oneOf: [
    { type: 'object', required: ['type', 'player'], properties: { type: { const: 'choose_first_debauchee' }, player: { type: 'string', description: 'setup: the first debauchee, by seat id or name' } } },
    { type: 'object', required: ['type', 'word'], properties: { type: { const: 'choose_word' }, word: { type: 'string', description: 'one of the three dealt words (private view)' } } },
    { type: 'object', required: ['type', 'cards'], properties: { type: { const: 'play_clues' }, cards: { type: 'array', minItems: 3, maxItems: 3, items: { enum: clueIds }, description: 'three of the four clue card ids in hand' } } },
    { type: 'object', required: ['type', 'card'], properties: { type: { const: 'answer_clue' }, card: { enum: ['rhymes_with', 'opposite', 'register', 'goes_with'] }, text: { type: 'string', description: 'the answer in your own words; omit to use the card\'s answer' } } },
    { type: 'object', required: ['type', 'letter'], properties: { type: { const: 'place' }, letter: { type: 'string', minLength: 1, maxLength: 1 }, row: { type: 'integer', minimum: 0, description: 'omit for a new row' }, index: { type: 'integer', minimum: 0, description: 'omit for the end of the row' }, check: { type: 'boolean', description: 'call "Check!" on the row this tile completes' } } },
    { type: 'object', required: ['type', 'row', 'index'], properties: { type: { const: 'move' }, row: { type: 'integer', minimum: 0 }, index: { type: 'integer', minimum: 0 }, to_row: { anyOf: [{ type: 'integer', minimum: 0 }, { const: 'new' }], description: 'omit to return the tile to the pool' }, to_index: { type: 'integer', minimum: 0 }, check: { type: 'boolean' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'check' }, word: { type: 'string', description: 'table tiles: the word on the table' }, row: { type: 'integer', minimum: 0, description: 'server tiles: the row you just completed' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'call_reveal' } } },
    { type: 'object', required: ['type', 'word'], properties: { type: { const: 'burn' }, word: { type: 'string', description: 'a word a guesser said aloud' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'timer_out' } } },
    { type: 'object', required: ['type', 'letter'], properties: { type: { const: 'reveal' }, letter: { type: 'string', minLength: 1, maxLength: 1 } } },
  ],
  description: `One action. Types: ${MOVE_TYPES.join(', ')}. get_legal_moves lists exactly which are possible now.`,
} as const;

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) throw new GameError(e.code, e.message);
    throw e;
  }
}

function seatsFrom(players: PlayerConfig[]): Seat[] {
  return players.map((p) => ({ id: p.player_id, name: seatDisplayName(players, p.player_id), ai: p.kind === 'ai' }));
}

function session(state: SessionState<WordDebaucheeState>, gameState: WordDebaucheeState): SessionState<WordDebaucheeState> {
  return { ...state, gameState, activePlayerId: activeSeatId(gameState), turnNumber: gameState.turn };
}

/** What an AI seat did, in words that never carry the secret. */
function narrate(state: WordDebaucheeState, playerId: string, move: WordDebaucheeMove): string {
  const who = nameOf(state, playerId);
  switch (move.type) {
    case 'choose_first_debauchee':
      return `${who} names the first debauchee.`;
    case 'choose_word':
      return `${who} looks at the three cards and keeps one.`;
    case 'play_clues':
      return `${who} plays ${move.cards.map((c) => clue(c).name).join(', ')}.`;
    case 'answer_clue':
      return `${who} answers ${clue(move.card).name}.`;
    case 'place':
      return `${who} places ${move.letter.toUpperCase()}${move.row === undefined ? ' in a new row' : ` on row ${move.row}`}${move.check ? ' and calls "Check!"' : ''}.`;
    case 'move':
      return `${who} moves a tile${move.check ? ' and calls "Check!"' : ''}.`;
    case 'check':
      return `${who} calls "Check!"`;
    case 'call_reveal':
      return `${who} calls "Reveal!"`;
    case 'burn':
      return `${who} reports a word said aloud.`;
    case 'timer_out':
      return `${who} reports the timer.`;
    case 'reveal':
      return `${who} reveals ${move.letter.toUpperCase()}.`;
  }
}

const CHOICE_FOR_PHASE: Record<string, string | null> = {
  setup: 'first-debauchee',
  choose_word: 'which-word',
  play_clues: 'which-clues',
  answer_clues: 'judgment-answer',
  reveal: 'which-letter-to-reveal',
  build: 'which-tile',
  game_over: null,
};

export class WordDebaucheeGame implements Game<WordDebaucheeState, WordDebaucheeMove, WordDebaucheeOptions> {
  readonly id = 'word-debauchee';
  readonly name = 'Word Debauchee';
  readonly description =
    'A talking party word game for 2–8. One player, the debauchee, holds a secret word and gives three stingy clues; everyone else races to ' +
    'spell a synonym of it from letter tiles, never saying the word they want and never suggesting a letter. Every lap of the table the ' +
    'debauchee lays down one more letter and the payout shrinks. The server holds the 500 word cards and 48 clue cards, referees every ' +
    '"Check!", keeps score, and plays any AI seat; the tiles are the table\'s own (any 144-tile set) or held here as text.';
  readonly minPlayers = MIN_PLAYERS;
  readonly maxPlayers = MAX_PLAYERS;
  readonly supportsAI = true;
  readonly hasHiddenInformation = true; // the debauchee's word, dealt cards and clue hand
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;
  readonly reportVoice: ReportVoice = SCOREKEEPER_VOICE;

  createSession(players: PlayerConfig[], options?: WordDebaucheeOptions): SessionState<WordDebaucheeState> {
    const ids = new Set(players.map((p) => p.player_id));
    if (ids.size !== players.length) throw new GameError('INVALID_PLAYERS', 'Duplicate player_id.');
    const opts = { ...options };
    if (opts.firstDebauchee !== undefined && !ids.has(opts.firstDebauchee)) {
      const byName = players.find((p) => (p.name ?? '').trim().toLowerCase() === String(opts.firstDebauchee).trim().toLowerCase());
      if (byName) opts.firstDebauchee = byName.player_id;
    }
    const initial = wrap(() => createState(seatsFrom(players), opts));
    return {
      sessionId: '',
      gameId: this.id,
      players,
      activePlayerId: activeSeatId(initial),
      turnNumber: 0,
      gameState: initial,
      moveLog: [],
      createdAt: new Date().toISOString(),
    };
  }

  getLegalMoves(state: SessionState<WordDebaucheeState>, playerId: string): LegalMove<WordDebaucheeMove>[] {
    if (!state.players.some((p) => p.player_id === playerId)) return [];
    return legal(state.gameState, playerId);
  }

  getPublicView(state: SessionState<WordDebaucheeState>): unknown {
    return getPublicView(state.gameState);
  }

  getPlayerView(state: SessionState<WordDebaucheeState>, playerId: string): unknown {
    return getPlayerView(state.gameState, playerId);
  }

  isGameOver(state: SessionState<WordDebaucheeState>): GameResult | null {
    const s = state.gameState;
    if (s.phase !== 'game_over') return null;
    const winners = s.winners ?? [];
    const best = winners.length ? s.scores[winners[0]!] : 0;
    return {
      game_over: true,
      winners,
      scores: { ...s.scores },
      summary:
        winners.length === 1
          ? `${nameOf(s, winners[0]!)} is the best debauchee with ${best}.`
          : `${winners.map((w) => nameOf(s, w)).join(' and ')} share the win with ${best}.`,
    };
  }

  applyMove(state: SessionState<WordDebaucheeState>, playerId: string, move: WordDebaucheeMove): ApplyMoveResult<WordDebaucheeState> {
    if (!state.players.some((p) => p.player_id === playerId)) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this session.`);
    const result = wrap(() => engineApply(state.gameState, playerId, move));
    return { newState: session(state, result.newState), summary: result.summary };
  }

  async getAIMove(state: SessionState<WordDebaucheeState>, playerId: string, difficulty?: string): Promise<AIMoveResult<WordDebaucheeMove>> {
    const p = state.players.find((x) => x.player_id === playerId);
    if (!p) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this session.`);
    const s = state.gameState;
    if (activeSeatId(s) !== playerId) throw new GameError('NOT_YOUR_TURN', `It is not ${nameOf(s, playerId)}'s move.`);
    const seed = (s.seed + s.turn * 7919) >>> 0;
    const move = chooseAIMove(s, playerId, difficulty ?? p.difficulty, seed);
    return { move, narration: narrate(s, playerId, move) };
  }

  getSuggestedMove(state: SessionState<WordDebaucheeState>, playerId: string): { move: WordDebaucheeMove } | null {
    const s = state.gameState;
    if (s.phase === 'game_over' || activeSeatId(s) !== playerId) return null;
    if (s.phase === 'build' && s.settings.tiles !== 'server') return null;
    const seed = (s.seed + s.turn * 7919) >>> 0;
    return { move: chooseAIMove(s, playerId, 'medium', seed) };
  }

  getScoreboard(state: SessionState<WordDebaucheeState>): Record<string, Record<string, number>> {
    const s = state.gameState;
    const out: Record<string, Record<string, number>> = {};
    for (const seat of s.seats) {
      const mine = s.history.filter((h) => h.debauchee === seat.id);
      out[seat.id] = {
        score: s.scores[seat.id] ?? 0,
        rounds_as_debauchee: mine.length,
        stumps: mine.filter((h) => h.outcome === 'stumped').length,
        cracks_against: mine.filter((h) => h.outcome === 'cracked').length,
      };
    }
    return out;
  }

  getCurrentPhase(state: SessionState<WordDebaucheeState>): string | null {
    return state.gameState.phase;
  }

  getSetupChecklist(state: SessionState<WordDebaucheeState>): SetupStep[] {
    if (state.gameState.phase !== 'setup') return [];
    return [
      {
        move_type: 'choose_first_debauchee',
        count: 1,
        description: 'The table says who is the first debauchee: whoever most recently got away with something.',
        ask_human_for: 'who goes first as debauchee (a seat id or name)',
      },
    ];
  }

  describeMoveGates(state: SessionState<WordDebaucheeState>, playerId: string): MoveGateStatus[] {
    return moveGates(state.gameState, playerId);
  }

  describeNextStep(state: SessionState<WordDebaucheeState>): NextStep | null {
    return nextStep(state.gameState) as NextStep;
  }

  getChoiceOwed(state: SessionState<WordDebaucheeState>, playerId: string): string | null {
    const s = state.gameState;
    if (activeSeatId(s) !== playerId) return null;
    if (s.phase === 'build' && s.settings.tiles !== 'server') return 'check';
    return CHOICE_FOR_PHASE[s.phase] ?? null;
  }

  getRulesText(): string {
    return renderRulesText(this.getRulesSections());
  }

  getRulesSections(): RuleSection[] {
    return WORD_DEBAUCHEE_RULE_SECTIONS as RuleSection[];
  }

  getChoiceCatalog(): PlayerChoice[] {
    return WORD_DEBAUCHEE_CHOICES as PlayerChoice[];
  }

  getSessionStartGuidance(): string {
    return SESSION_START_GUIDANCE;
  }

  getPhysicalSetup(state: SessionState<WordDebaucheeState>): PhysicalSetupStep[] {
    const s = state.gameState;
    const first = s.round ? nameOf(s, s.round.debauchee) : 'whoever most recently got away with something';
    if (s.settings.tiles !== 'server') {
      return [
        { kind: 'action', text: `Tip all ${TILE_TOTAL} tiles face up in the middle of the table and spread them so everyone can reach them: the pool. Leave an open space beside it: the build area.` },
        { kind: 'action', text: `${first} is the first debauchee. The word cards and clue cards are dealt here: the debauchee reads their three words in their private view.` },
        ...(s.settings.timer === 'sand' ? [{ kind: 'action' as const, text: 'Have the 30-second sand timer ready; report timer_out whenever it runs out.' }] : []),
      ];
    }
    return [{ kind: 'action', text: `No physical pieces: the server holds the tiles, the build area and the cards. ${first} is the first debauchee.` }];
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      {
        name: 'tiers',
        kind: 'config',
        description: 'AI debauchee tier against AI guesser tier: crack rate, reveals before a crack, payouts. scripts/harness.mjs reports it.',
        levers: ['difficulty'],
        recipe: 'all-AI seats; vary each seat\'s difficulty (easy, medium, hard); 200 debauchee rounds per pairing.',
      },
      {
        name: 'timer',
        kind: 'config',
        description: 'Laps against sand, and tilesPerReveal in a duel: how many reveals a crack takes.',
        levers: ['sweep'],
        recipe: 'vary options.timer and options.tilesPerReveal across the batch.',
      },
      {
        name: 'players',
        kind: 'config',
        description: 'Table size: tiles per lap go up with the number of guessers, so reveals per crack go down.',
        levers: ['players'],
        recipe: 'vary the number of seats from 2 to 8.',
      },
    ];
  }

  getReferenceData(): unknown {
    return {
      word_cards: CARDS.length,
      categories: CATEGORIES,
      types: WORD_TYPES,
      clue_cards: CLUES.map((c) => ({ id: c.id, name: c.name, kind: c.kind, copies: c.copies, asks: c.prompt, judgment: c.judgment })),
      tiles: TILE_COUNTS,
      scoring: {
        stumped: 'the debauchee scores the letters in the secret word',
        cracked: `every guesser scores the letters in the synonym minus the tiles revealed, at least ${MIN_CRACK_PAYOUT}`,
      },
    };
  }
}

export const wordDebauchee = new WordDebaucheeGame();
export default wordDebauchee;
