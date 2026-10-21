// 8-bit Demon Hunter as a zekel game module. The rules live in engine/ and
// world/ (PORT-PLAN.md); this file adapts them to the Game interface. Solo,
// always digital: there are no physical components, the server rolls
// everything, and the narrating LLM sees only getPlayerView (hidden: the
// demon's identity, minion flags, unearned secrets, riddle answers).

import type {
  AIMoveResult,
  ApplyMoveResult,
  BalanceAxis,
  ExtraTool,
  Game,
  GameResult,
  LegalMove,
  NextStep,
  PlayerChoice,
  PlayerConfig,
  ReportVoice,
  RuleSection,
  SessionState,
} from '@zekel/game-kit';
import { GameError, renderRulesText } from '@zekel/game-kit';
import { DEMON_HUNTER_CHOICES } from './choices.js';
import { DEMON_HUNTER_RULE_SECTIONS } from './rulesSections.js';
import { chooseMove } from './ai.js';
import { ENEMIES } from './data/enemies.js';
import { MAGIC_ITEMS } from './data/magicItems.js';
import { MAX_LEVEL, STAT_MAX, STAT_STEP, XP_CURVE } from './data/progression.js';
import { RESOURCE_BASE_VALUE } from './data/resources.js';
import { applyMove as engineApply } from './engine/apply.js';
import { RuleError } from './engine/errors.js';
import { MOVE_TYPES, type DemonHunterMove } from './engine/moves.js';
import { GM_VOICE, SESSION_START_GUIDANCE } from './guidance.js';
import { getLegalMoves as legal } from './legalMoves.js';
import { loadLoreTopics, loreIndex, type LoreTopic } from './lore.js';
import { describeNextStep as nextStep } from './nextStep.js';
import { randomSeed } from './rng.js';
import type { DemonHunterOptions, DemonHunterState } from './types.js';
import { getView } from './views.js';
import { generateWorld } from './world/generate.js';

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'World seed. The same seed builds the same world, mystery and dice.' },
    clearings: { type: 'integer', minimum: 5, maximum: 8, description: 'How many clearings the map has (default: drawn from the seed, 5 to 8).' },
  },
} as const;

const moveSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: { enum: [...MOVE_TYPES] },
    to: { type: 'string', description: 'move: the id of an adjacent place; travel: a place the player knows of (see known_places in the view), by name or id' },
    nearest: { enum: ['inn', 'town'], description: 'travel: the nearest town (every town has an inn)' },
    via_inn: { type: 'boolean', description: 'travel: may pay an inn cart between towns when shorter' },
    target: { type: 'string', description: 'attack: an enemy, plant or tree id from look' },
    item: { type: 'string', description: 'buy_from_bandit: "bomb" or "lockpick"; search_town: who owns this item' },
    town: { type: 'string', description: 'teleport / ride: a town id or name' },
    stat: { enum: ['strength', 'agility', 'health', 'range'], description: 'level_up' },
    person: { type: 'string', description: 'talk / search_house / stab / mark_suspect: a person id (or name, in town)' },
    pet: { type: 'string', description: 'search_town: who keeps this pet' },
    color: { type: 'string', description: 'search_town: who likes this colour' },
    occupation: { type: 'string', description: 'search_town: who follows this trade' },
    task: { type: 'string', description: 'search_town: who wants help with this (a monster, "escort", "find", or a word of the task)' },
    truth: { type: 'boolean', description: 'search_town: who claims to know the truth' },
    contradictions: { type: 'boolean', description: 'search_town: which rumours in the clue book contradict a secret (works anywhere)' },
    reward: { enum: ['clue', 'power'], description: 'claim_reward' },
    resource: { enum: Object.keys(RESOURCE_BASE_VALUE), description: 'buy / sell' },
    amount: { anyOf: [{ type: 'integer', minimum: 1 }, { enum: ['all'] }], description: 'buy / sell / buy_from_bandit: how many (default 1). "all" = everything you hold (sell), or as many as the stock and your shuckles allow (buy).' },
    confirm: { type: 'boolean', description: 'search_house: true to spend a lockpick' },
    text: { type: 'string', description: "answer_riddle: the player's answer, verbatim" },
  },
  description: 'One action. get_legal_moves lists exactly which are possible now, with filled-in ids.',
} as const;

function seat(state: SessionState<DemonHunterState>): PlayerConfig {
  return state.players[0]!;
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RuleError) throw new GameError(e.code, e.message);
    throw e;
  }
}

let cachedTopics: LoreTopic[] | null = null;
function topics(): LoreTopic[] {
  cachedTopics ??= loadLoreTopics();
  return cachedTopics;
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export class EightBitDemonHunterGame implements Game<DemonHunterState, DemonHunterMove, DemonHunterOptions> {
  readonly id = '8-bit-demon-hunter';
  readonly name = '8-bit Demon Hunter';
  readonly description =
    'A solo text detective RPG: a demon hides as an ordinary person in one of five towns. Talk to townsfolk, do their tasks for ' +
    'clues, fight monsters across a map of clearings and temples, gather the five magic items, find the demon\'s bindings, ' +
    'and put the demon-killing knife in it. Stab the wrong person and the town turns on you. The server runs the whole world; the LLM client is the game master.';
  readonly minPlayers = 1;
  readonly maxPlayers = 1;
  readonly supportsAI = true; // the harness bot only (it may read the hidden demon)
  readonly hasHiddenInformation = true; // the demon's identity and its minions
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;
  readonly reportVoice: ReportVoice = GM_VOICE;

  createSession(players: PlayerConfig[], options?: DemonHunterOptions): SessionState<DemonHunterState> {
    if (players.length !== 1) {
      throw new GameError('INVALID_PLAYERS', `8-bit Demon Hunter is a solo game — exactly 1 player; got ${players.length}.`);
    }
    const seed = options?.seed ?? randomSeed();
    const initial = generateWorld(seed, { clearings: options?.clearings });
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

  getLegalMoves(state: SessionState<DemonHunterState>, playerId: string): LegalMove<DemonHunterMove>[] {
    if (playerId !== seat(state).player_id) return [];
    return legal(state.gameState);
  }

  getPublicView(state: SessionState<DemonHunterState>): unknown {
    return getView(state.gameState);
  }

  getPlayerView(state: SessionState<DemonHunterState>): unknown {
    return getView(state.gameState);
  }

  isGameOver(state: SessionState<DemonHunterState>): GameResult | null {
    const s = state.gameState;
    if (!s.result) return null;
    const pid = seat(state).player_id;
    return {
      game_over: true,
      winners: s.result.winner === 'player' ? [pid] : [],
      scores: { [pid]: s.player.xp },
      summary: s.result.summary,
    };
  }

  applyMove(state: SessionState<DemonHunterState>, playerId: string, move: DemonHunterMove): ApplyMoveResult<DemonHunterState> {
    if (playerId !== seat(state).player_id) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this solo session.`);
    const result = wrap(() => engineApply(state.gameState, move));
    return {
      newState: { ...state, gameState: result.newState, turnNumber: state.turnNumber + 1 },
      summary: result.summary,
    };
  }

  async getAIMove(state: SessionState<DemonHunterState>, playerId: string, difficulty?: string): Promise<AIMoveResult<DemonHunterMove>> {
    if (playerId !== seat(state).player_id) throw new GameError('PLAYER_NOT_FOUND', `No player ${playerId} in this solo session.`);
    const choice = chooseMove(state.gameState, difficulty);
    return { move: choice.move, narration: choice.reasoning };
  }

  getSuggestedMove(state: SessionState<DemonHunterState>, playerId: string): { move: DemonHunterMove } | null {
    if (playerId !== seat(state).player_id) return null;
    return { move: chooseMove(state.gameState, 'medium').move };
  }

  getScoreboard(state: SessionState<DemonHunterState>): Record<string, Record<string, number>> {
    const s = state.gameState;
    return {
      [seat(state).player_id]: {
        level: s.player.level,
        xp: s.player.xp,
        hp: s.player.hp,
        shuckles: s.player.shuckles,
        clues: s.player.knownClues.length,
        people_met: s.towns.flatMap((t) => t.people).filter((p) => p.hasMet).length,
        bindings: s.player.bindings.length,
        magic_items: s.player.magicItems.length,
        deaths: s.player.deaths,
      },
    };
  }

  describeNextStep(state: SessionState<DemonHunterState>): NextStep | null {
    const p = seat(state);
    if (p.kind !== 'human') return null;
    return nextStep(state.gameState, p.player_id) as NextStep;
  }

  getRulesText(): string {
    return renderRulesText(this.getRulesSections());
  }

  getRulesSections(): RuleSection[] {
    return DEMON_HUNTER_RULE_SECTIONS as RuleSection[];
  }

  getChoiceCatalog(): PlayerChoice[] {
    return DEMON_HUNTER_CHOICES as PlayerChoice[];
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      {
        name: 'world_seed',
        kind: 'scenario',
        description:
          'Solo reinterpretation: each seed is a different map, mystery and enemy layout; balance = solvability and ' +
          'difficulty across seeds (deaths before the accusation, levels reached), not seat symmetry.',
        levers: ['sweep'],
        recipe: 'vary options.seed across the batch (and options.clearings 5..8).',
      },
    ];
  }

  getSessionStartGuidance(): string {
    return SESSION_START_GUIDANCE;
  }

  getReferenceData(): unknown {
    return {
      // Enemy numbers are deliberately absent: the GM describes enemies by condition and behaviour.
      enemies: ENEMIES.filter((e) => !e.templeOnly).map((e) => ({ id: e.id, name: e.name, behaviour: e.behaviour })),
      progression: { xp_curve: XP_CURVE, max_level: MAX_LEVEL, stat_caps: STAT_MAX, stat_step: STAT_STEP },
      magic_items: Object.values(MAGIC_ITEMS).map((m) => ({ name: m.name, description: m.description })),
      resource_base_values: RESOURCE_BASE_VALUE,
      inn: { sleep: 5, train: 50, train_xp: 20, ride: 50, buy_price: 'ceil(base × town multiplier × 1.5)', sell_price: 'base × town multiplier (1 to 6)' },
      demon: { base_hp: 20, per_binding: -3, min: 1, times: 'your strength', speed: 8, range: 3, damage: 2 },
    };
  }

  getExtraTools(): ExtraTool[] {
    return [
      {
        name: 'get_demon_hunter_lore',
        description:
          'The 8-bit Demon Hunter lore repository: the old stories the townsfolk tell (the demon, Memlax and Chineera, ' +
          'the rebellion, the five artifacts, life in the towns). Call with no arguments for the topic index; call with a ' +
          'topic (topic_id or title) for the full entry. Fetch the relevant topic before narrating the old stories for the ' +
          'first time. Lore is canon: never contradict it. (8-bit Demon Hunter sessions only.)',
        args: {
          topic: { optional: true, description: 'topic_id or title from the index; omit to list all topics' },
        },
        run(args) {
          const all = topics();
          if (!args.topic) return { result: { game_id: '8-bit-demon-hunter', ...loreIndex(all) } };
          const want = normalise(String(args.topic));
          const hit = all.find((t) => normalise(t.topic_id) === want) ?? all.find((t) => normalise(t.title) === want);
          if (!hit) {
            return {
              error: {
                error_code: 'LORE_TOPIC_NOT_FOUND',
                message: `No lore topic matches "${String(args.topic)}". Valid topics: ${all.map((t) => t.topic_id).join(', ')}.`,
              },
            };
          }
          return { result: { topic_id: hit.topic_id, title: hit.title, summary: hit.summary, tags: hit.tags, lore: hit.body } };
        },
      },
    ];
  }
}

export const eightBitDemonHunter = new EightBitDemonHunterGame();
export default eightBitDemonHunter;
