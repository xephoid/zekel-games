// Adventurer Olympics — MCP wiring (the Game interface + hooks).
//
// move_schema + apply_move dispatch + describeNextStep + getSetupChecklist +
// getSessionStartGuidance + getRulesSections + describeMoveGates +
// getReferenceData + getBalanceAxes + getLog + getChoiceCatalog.

import type {
  AIMoveResult,
  ApplyMoveResult,
  BalanceAxis,
  Game,
  GameLogEntry,
  GameResult,
  LegalMove,
  MoveGateStatus,
  NextStep,
  PlayerChoice,
  PlayerConfig,
  RuleSection,
  SessionState,
  SetupStep,
} from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { renderRulesText } from '@zekel/game-kit';
import {
  createAOState,
  applySetupPick,
  cardName,
  topCandidates,
  setupReportOwed,
  availableColours,
  applySetupReport,
  applyTurnOrderTotal,
  applyMove,
  applyStop,
  applyMoveAway,
  applyTryAgain,
  applyExplore,
  applyPlaceTile,
  applyTestRoll,
  applyTakeArtifact,
  applyDeclineArtifact,
  applyReportCard,
  applyDraw,
  makeRng,
  anyArtifactOptions,
} from './engine.js';
import { getLegalMoves } from './legalMoves.js';
import { getPublicView, getPlayerView } from './views.js';
import { chooseMove } from './ai.js';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { aoDeterminize, aoHeuristic, aoReward, aoRolloutMove, aoSearchMoves } from './mctsHooks.js';
import { outlook } from './aiPlanner.js';
import { randomSeed } from '@zekel/game-kit';
import { AOChoices } from './choices.js';
import { seatDisplayName } from '@zekel/game-kit';
import { AORuleSections } from './rulesSections.js';
import { aomoveGates } from './moveGates.js';
import { keyToHex, tileCenter, resolveHexRef, resolveSlotRef, resolveRotation } from './hexMap.js';
import type { AOState, Pending, PendingKind } from './types.js';
import type { ArtifactId } from './data.js';
import { DUNGEON_KIND_NAMES, QUESTS } from './data.js';

type Move = Record<string, unknown> & { type: string };

const optionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'RNG seed for reproducible setup. Random if omitted.' },
  },
};

/** Sessions saved before the 2026-09-29 state rewrite (schema version 1) hold
 *  per-seat `deckOrders` and a `Set` of hexes (which JSON flattened to `{}`).
 *  No faithful conversion exists — the old map geometry was wrong — so such a
 *  session is refused on its own, with a plain message, while every other
 *  session in the same database keeps working. Undo snapshots of the old
 *  format hit the same check when restored. */
function assertCurrentFormat(g: AOState): void {
  const raw = g as unknown as Record<string, unknown>;
  if ('deckOrders' in raw || !('decks' in raw)) {
    throw new GameError(
      'STORAGE_ERROR',
      'This Adventurer Olympics session was saved by an older version of the game whose saved format is no longer readable. Start a new session.',
    );
  }
  // The 2026-09-30 rules change turned "Complete 2 dungeons" and "Recruit 2
  // companions" into end-of-game "most" quests. A session that started under
  // the old quests is refused rather than finished under mixed rules.
  const oldKinds = ['complete_2_dungeons', 'recruit_2_companions'];
  const quests = [
    ...Object.keys(g.inPlayQuests ?? {}),
    ...((raw.setupQuestOrder as string[] | undefined) ?? []),
    ...Object.values(g.players ?? {}).flatMap((p) => p.claimedQuests ?? []),
  ];
  if (quests.some((k) => oldKinds.includes(k))) {
    throw new GameError(
      'STORAGE_ERROR',
      'This Adventurer Olympics session started under the old quest rules ("Complete 2 dungeons" / "Recruit 2 companions" are now "Most dungeons" / "Most companions"). Start a new session.',
    );
  }
}

const moveSchema = {
  type: 'object',
  required: ['type'],
  properties: {
    type: {
      type: 'string',
      enum: [
        'setup_standee',
        'setup_report',
        'report_turn_order_roll',
        'step',
        'stop',
        'try_again',
        'move_away',
        'explore',
        'report_test_roll',
        'report_card',
        'resolve_report',
        'take_artifact',
        'decline_artifact',
      ],
      description: 'The move type.',
    },
    standee: { type: 'string', description: 'setup_standee: your standee name.' },
    colour: { type: 'string', description: 'setup_standee: your colour name.' },
    quests: { type: 'array', items: { type: 'string' }, description: 'setup_report: the quest cards drawn at setup, by printed name.' },
    tile: { type: 'string', description: 'setup_report: the starting tile you flipped, by printed number (e.g. "Tile 4").' },
    total: { type: 'integer', description: 'The reported dice total. Turn order: 2..12. Test: any total your dice count can produce (1 die can total 1).' },
    dice: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 6 }, description: 'Optional with a reported roll: each die as rolled. Must be the right number of dice and add up to total.' },
    to: { type: 'string', description: 'step: the hex to step to — "the NE hex of Tile 3", "the centre of Tile 1", or the hex key from get_legal_moves.' },
    path: { type: 'array', items: { type: 'string' }, description: 'move_away: your chosen route off the failed icon, one hex per step ("the S hex of Tile 2", or hex keys).' },
    slot: { type: 'string', description: 'explore (placement): the empty slot for the revealed tile — "side NE–SE of Tile 4", or the slot key from get_legal_moves.' },
    rotation: { type: ['integer', 'string'], description: 'explore (placement): how the tile is turned — the starting-tile hex its printed N hex points toward ("N", "NE", "SE", "S", "SW", "NW"), or 0-5 as listed in get_legal_moves.' },
    card: { type: 'string', description: 'report_card: the printed name/number of the card you drew.' },
    artifact: { type: 'string', description: 'take_artifact: the printed name of a suit artifact (Hearts, Spades, Diamonds, Clubs). The Star is never takeable here.' },
    from: { type: 'string', description: 'take_artifact: "supply" or the printed name of the player holding it.' },
  },
};

/** The dice of a reported roll, when the report names them: each die a whole
 *  number from 1 to 6, the right count, adding up to the total. Null when
 *  only a total was reported (a physical player may say just the total). */
/** A digital seat has no dice: its rolls are made by the server when it
 *  presses Roll, so it may never report a total of its choosing. */
function refuseDigitalReport(state: SessionState<AOState>, playerId: string): void {
  const seat = state.players.find((p) => p.player_id === playerId);
  if (seat?.kind === 'human' && seat.table === 'digital') {
    throw new GameError('ILLEGAL_MOVE', 'a digital seat rolls with the Roll button (resolve_report) — the server rolls the dice; a total cannot be reported');
  }
}

function reportedDice(raw: unknown, count: number, total: number): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== count || !raw.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) {
    throw new GameError('ILLEGAL_MOVE', `dice must be ${count} whole number${count === 1 ? '' : 's'} from 1 to 6`);
  }
  const sum = (raw as number[]).reduce((a, b) => a + b, 0);
  if (sum !== total) throw new GameError('ILLEGAL_MOVE', `those dice add up to ${sum}, not ${total}`);
  return raw as number[];
}

export const adventurerOlympics: Game<AOState, Move> = {
  id: 'adventurer-olympics',
  name: 'Adventurer Olympics',
  description: 'A 2–4 player exploration race: move, explore new hex tiles, recruit companions, fight monsters, and claim quests before the last tile is placed.',
  minPlayers: 2,
  maxPlayers: 4,
  supportsAI: true,
  hasHiddenInformation: false,
  optionsSchema,
  moveSchema,
  version: '0.2.0',

  createSession(players: PlayerConfig[], options?: { seed?: number }): SessionState<AOState> {
    if (players.length < 2 || players.length > 4) {
      throw new GameError('ILLEGAL_MOVE', 'Adventurer Olympics supports 2–4 players');
    }
    const seed = options?.seed ?? randomSeed();
    const state = createAOState(players, seed);
    const now = new Date().toISOString();
    return {
      sessionId: `ao-${seed}`,
      gameId: 'adventurer-olympics',
      players,
      // The seat that owes the first setup pick (humans pick first), so the
      // session's active player matches the pending from the start.
      activePlayerId: state.pending?.seat ?? (players[0] as PlayerConfig).player_id,
      turnNumber: 0,
      gameState: state,
      moveLog: [],
      createdAt: now,
      hostPlayerId: players.find((p) => p.kind === 'human')?.player_id ?? (players[0] as PlayerConfig).player_id,
    };
  },

  getLegalMoves(state: SessionState<AOState>, playerId: string): LegalMove<Move>[] {
    assertCurrentFormat(state.gameState);
    return getLegalMoves(state.gameState, playerId);
  },

  getPublicView(state: SessionState<AOState>): unknown {
    assertCurrentFormat(state.gameState);
    return getPublicView(state.gameState);
  },

  getPlayerView(state: SessionState<AOState>, playerId: string): unknown {
    assertCurrentFormat(state.gameState);
    return getPlayerView(state.gameState, playerId);
  },

  isGameOver(state: SessionState<AOState>): GameResult | null {
    const g = state.gameState;
    assertCurrentFormat(g);
    // Terminal only when the ending sequence has fully run: last tile placed →
    // finish the current round → one more full round → endgame quests scored
    // (RULES.md §9). `endingPhase > 0` alone is NOT over (the pre-fix build
    // reported a 0–0 shared victory the moment the last tile landed).
    if (!g.gameOver) return null;
    const players = g.playerOrder.map((pid) => ({
      player_id: pid,
      name: (g.players[pid] as { name: string }).name,
      score: (g.players[pid] as { questPoints: number }).questPoints,
    }));
    const max = Math.max(...players.map((p) => p.score));
    const winners = players.filter((p) => p.score === max).map((p) => p.player_id);
    return {
      game_over: true,
      winners,
      scores: Object.fromEntries(players.map((p) => [p.player_id, p.score])),
      summary: winners.length > 1
        ? `Tie at ${max} quest point${max === 1 ? '' : 's'} — shared victory`
        : `${players.find((p) => p.player_id === winners[0])?.name} wins with ${max} quest point${max === 1 ? '' : 's'}`,
    };
  },

  applyMove(
    state: SessionState<AOState>,
    playerId: string,
    move: Move,
  ): ApplyMoveResult<AOState> {
    assertCurrentFormat(state.gameState);
    // The Game contract: never change the input. The engine functions below
    // edit the state they are handed, so they get a copy (copyForMove). A move
    // that throws partway leaves only the copy half-changed; the caller's
    // session is untouched.
    state = copyForMove(state);
    const g = state.gameState;
    const name = seatLabel(state, playerId);
    try {
      switch (move.type) {
        case 'setup_standee': {
          // Setup identity picks are legal ONLY during the setup phase, from the
          // seat that owes them — a replay during play must never touch the map
          // (R11: the pre-fix build re-ran finishSetup and reset the board).
          // Humans pick first; colours come from the printed four and no two
          // seats share a colour or a standee (applySetupPick validates).
          const { standee, colour } = applySetupPick(g, playerId, move.standee, move.colour);
          // If a physical table needs to report the setup draw, say so.
          const after = pendingIs(g, 'setup_explore_report');
          if (after) {
            const reporter = seatLabelLoose(state, after.seat);
            return summarize(state, g, `${name} takes ${standee} and the ${colour} tokens. Setup continues: ${reporter} reports the drawn quest cards and the starting tile.`);
          }
          return summarize(state, g, `${name} takes ${standee} and the ${colour} tokens.`);
        }
        case 'setup_report': {
          // A physical table's setup draw report (quests + starting tile).
          // May be the whole report or one piece of it (a quest card, or the tile).
          const quests = move.quests as string[] | undefined;
          const tileId = resolveReportedTile(move.tile);
          const logBefore = g.log.length;
          applySetupReport(g, playerId, quests, tileId);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'report_turn_order_roll': {
          refuseDigitalReport(state, playerId);
          const total = move.total as number;
          const dice = reportedDice(move.dice, 2, total);
          const logBefore = g.log.length;
          applyTurnOrderTotal(g, playerId, total);
          g.lastRoll = { seat: playerId, kind: 'turn_order', dice, total, logSeq: logBefore + 1 };
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'step': {
          const to = hexArg(g, move.to);
          const logBefore = g.log.length;
          applyMove(g, playerId, [to]);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'stop': {
          const logBefore = g.log.length;
          applyStop(g, playerId);
          return summarize(state, g, tailSummary(g, logBefore, `${name} stops — their turn ends.`));
        }
        case 'try_again': {
          const logBefore = g.log.length;
          applyTryAgain(g, playerId);
          return summarize(state, g, tailSummary(g, logBefore, `${name} stays and tries the icon again.`));
        }
        case 'move_away': {
          const rawPath = (move.path as unknown[] | undefined) ?? (move.to !== undefined ? [move.to] : []);
          const path = rawPath.map((h) => hexArg(g, h));
          const logBefore = g.log.length;
          applyMoveAway(g, playerId, path);
          return summarize(state, g, tailSummary(g, logBefore, `${name} walks away.`));
        }
        case 'explore': {
          // Two explore shapes share this type:
          //  (a) no `slot`: BEGIN an ordinary explore — the server reveals the
          //      tile for a digital/AI seat, or asks a physical seat to report
          //      the tile they drew. Legal in the move/try_again phases.
          //  (b) with `slot`: PLACE the revealed/reported tile. The context and
          //      the identity come from the PENDING — the dispatcher never
          //      trusts client flags or an identity asserted at placement.
          if (move.slot === undefined) {
            const logBefore = g.log.length;
            applyExplore(g, playerId);
            return summarize(state, g, tailSummary(g, logBefore, `${name} explores.`));
          }
          const logBefore = g.log.length;
          const slot = resolveSlotRef(g.placedTiles, move.slot);
          if (!slot) throw new GameError('ILLEGAL_MOVE', `could not read the slot "${String(move.slot)}" — name it like "side NE–SE of Tile 4" (get_legal_moves lists every slot)`);
          // Which way the tile is turned is the player's choice (RULES.md §5.3
          // step 3), so it is never filled in for them.
          if (move.rotation === undefined || move.rotation === null || move.rotation === '') {
            throw new GameError('ILLEGAL_MOVE', `which way is the tile turned? Give a rotation: 0-5, or the starting-tile hex the new tile's N hex points toward (e.g. "NW") — get_legal_moves lists every slot and rotation`);
          }
          const rotation = resolveRotation(move.rotation);
          if (rotation === null) throw new GameError('ILLEGAL_MOVE', `could not read the rotation "${String(move.rotation)}" — give 0-5, or the starting-tile hex the new tile's N hex points toward (e.g. "NW")`);
          applyPlaceTile(g, playerId, slot, rotation);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'report_test_roll': {
          refuseDigitalReport(state, playerId);
          const total = move.total as number;
          const diceCount = (g.pending?.payload?.diceCount as number) ?? 1;
          if (!Number.isInteger(total) || total < diceCount || total > diceCount * 6) {
            throw new GameError('ILLEGAL_MOVE', `a ${diceCount}-di(c)e test total must be an integer from ${diceCount} to ${diceCount * 6}, got ${total}`);
          }
          const dice = reportedDice(move.dice, diceCount, total);
          const logBefore = g.log.length;
          applyTestRoll(g, playerId, total);
          g.lastRoll = { seat: playerId, kind: 'test', dice, total, logSeq: logBefore + 1 };
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'report_card': {
          const logBefore = g.log.length;
          applyReportCard(g, playerId, move.card as string);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'resolve_report': {
          // The digital reveal button: resolve the pending randomness with the
          // session's seeded rng (mulberry32 seeded by the session seed — never
          // LCG low bits, which make every 2-die total odd).
          const p = g.pending;
          if (!p || p.seat !== playerId) throw new GameError('ILLEGAL_MOVE', 'nothing for you to resolve');
          const seatCfg = state.players.find((pl) => pl.player_id === playerId);
          if (seatCfg?.kind !== 'human' || seatCfg.table !== 'digital') {
            throw new GameError('ILLEGAL_MOVE', 'only a digital human presses the reveal button — report your physical roll/draw instead');
          }
          if (p.kind === 'draw') {
            const logBefore = g.log.length;
            applyDraw(g, playerId);
            return summarize(state, g, `${name} pressed Draw. ${tailSummary(g, logBefore)}`.trim());
          }
          if (p.kind !== 'roll') throw new GameError('ILLEGAL_MOVE', `the reveal button resolves a roll or a draw, not ${p.kind}`);
          const diceCount = (p.payload?.diceCount as number) ?? 2;
          const rollKind = p.payload?.rollKind as string;
          const rng = makeRng(g.rngState >>> 0);
          let total = 0;
          const dice: number[] = [];
          for (let i = 0; i < diceCount; i++) {
            const d = rng.int(6) + 1;
            dice.push(d);
            total += d;
          }
          g.rngState = (g.rngState + diceCount * 2654435761) >>> 0; // advance the stream
          const logBefore = g.log.length;
          const pressed = `${name} pressed Roll — the server rolled ${dice.join(' + ')} = ${total}.`;
          if (rollKind === 'turn_order') {
            applyTurnOrderTotal(g, playerId, total);
            g.lastRoll = { seat: playerId, kind: 'turn_order', dice, total, logSeq: logBefore + 1 };
            return summarize(state, g, `${pressed} ${tailSummary(g, logBefore)}`.trim());
          }
          applyTestRoll(g, playerId, total);
          g.lastRoll = { seat: playerId, kind: 'test', dice, total, logSeq: logBefore + 1 };
          return summarize(state, g, `${pressed} ${tailSummary(g, logBefore)}`.trim());
        }
        case 'take_artifact': {
          const from = (move.from as string) ?? 'supply';
          const logBefore = g.log.length;
          applyTakeArtifact(g, playerId, move.artifact as ArtifactId, from);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        case 'decline_artifact': {
          const logBefore = g.log.length;
          applyDeclineArtifact(g, playerId);
          return summarize(state, g, tailSummary(g, logBefore));
        }
        default:
          throw new GameError('ILLEGAL_MOVE', `unknown move type "${move.type}"`);
      }
    } catch (e) {
      if (e instanceof GameError) throw e;
      throw new GameError('ILLEGAL_MOVE', `move failed: ${(e as Error).message}`);
    }
  },

  async getAIMove(
    state: SessionState<AOState>,
    playerId: string,
    difficulty?: string,
    strategy?: string,
  ): Promise<AIMoveResult<Move>> {
    assertCurrentFormat(state.gameState);
    const g = state.gameState;
    // mcts: search only real decisions; dice and reports go to `hard`.
    if (difficulty === 'mcts' && g.pending?.seat === playerId
      && ['move', 'try_again', 'explore_place', 'take_artifact'].includes(g.pending.kind)) {
      const options = aoSearchMoves(state, playerId);
      if (options.length > 1) {
        const result = chooseMoveMCTS(this, state, playerId, {
          budget_ms: Number(process.env.MCTS_BUDGET_MS) || 1000,
          seed: (g.rngSeed ^ (g.log.length * 2654435761)) >>> 0,
          // Short playouts scored by the evaluation beat long ones at the
          // same budget (AI-NOTES.md §3): more simulations per decision.
          max_rollout_plies: 20,
        });
        return { move: result.move as Move, narration: chooseMove(g, playerId, 'hard').narration };
      }
    }
    const tier = difficulty === 'mcts' ? 'hard' : (difficulty ?? 'medium');
    const { move, narration } = chooseMove(g, playerId, tier, strategy);
    return { move, narration };
  },

  // Generic MCTS hooks (AI-NOTES.md §3; mctsHooks.ts).
  getRewardForPlayer: (state: SessionState<AOState>, playerId: string) => aoReward(state, playerId),
  getHeuristicValue: (state: SessionState<AOState>, playerId: string) => aoHeuristic(state, playerId),
  selectRolloutMove: (state: SessionState<AOState>, playerId: string) => aoRolloutMove(state, playerId),
  getSearchMoves: (state: SessionState<AOState>, playerId: string) => aoSearchMoves(state, playerId),
  determinize: (state: SessionState<AOState>, from: string, rng: () => number) => aoDeterminize(state, from, rng),

  // The public "who is ahead" row (balance §4 leaderScalar reads `outlook`).
  getScoreboard: (state: SessionState<AOState>): Record<string, Record<string, number>> => Object.fromEntries(
    state.gameState.playerOrder.map((pid) => [pid, {
      quest_points: state.gameState.players[pid]!.questPoints,
      outlook: Math.round(outlook(state.gameState, pid) * 1000) / 1000,
    }]),
  ),

  /** Harness-only: synthesize a valid answer to a physical seat's REPORT
   *  pending from the server's tracked orders. Never called on a real session —
   *  a physical human's draw is theirs to report. (docs/digital-mode.md.) */
  autoResolveReport(state: SessionState<AOState>, playerId: string): { move: Move } | null {
    const g = state.gameState;
    const p = g.pending;
    if (!p || p.seat !== playerId) return null;
    if (p.kind === 'setup_explore_report') {
      // Any distinct valid quest cards answer the report; a harness seat has
      // no physical deck, so answer with the first ones not yet reported.
      const owed = setupReportOwed(g);
      const quests = QUESTS.map((q) => q.name)
        .filter((q) => !owed.reportedQuests.includes(q.toLowerCase().replace(/ /g, '_')))
        .slice(0, owed.questsLeft);
      return { move: { type: 'setup_report', quests, ...(owed.tileOwed ? { tile: `Tile ${g.tileStack[0]}` } : {}) } };
    }
    if (p.kind === 'report_card') {
      const deck = p.payload?.deck as string;
      if (deck === 'tile') return { move: { type: 'report_card', card: `Tile ${g.tileStack[0]}` } };
      if (deck === 'dungeon') {
        const kind = topCandidates(g, 'dungeon')[0] as keyof typeof DUNGEON_KIND_NAMES | undefined;
        return { move: { type: 'report_card', card: kind ? DUNGEON_KIND_NAMES[kind] : DUNGEON_KIND_NAMES.companion } };
      }
      const top = topCandidates(g, deck as 'companion' | 'little' | 'big')[0];
      if (!top) return null;
      return { move: { type: 'report_card', card: top } };
    }
    if (p.kind === 'draw') return { move: { type: 'resolve_report' } };
    // A digital seat's roll is the Roll button; only a physical seat reports.
    const cfg = state.players.find((pl) => pl.player_id === playerId);
    if (p.kind === 'roll' && cfg?.kind === 'human' && cfg.table === 'digital') return { move: { type: 'resolve_report' } };
    if (p.kind === 'roll') {
      if (p.payload?.rollKind === 'turn_order') return { move: { type: 'report_turn_order_roll', total: 7 } };
      const n = (p.payload?.diceCount as number) ?? 1;
      return { move: { type: 'report_test_roll', total: n } };
    }
    return null;
  },

  getRulesText: () => renderRulesText(AORuleSections),

  getRulesSections: () => AORuleSections,

  describeMoveGates: (state: SessionState<AOState>, playerId: string) =>
    aomoveGates(state.gameState, playerId),

  getCurrentPhase: (state: SessionState<AOState>) =>
    state.gameState.pending?.kind ?? (state.gameState.gameOver ? 'game_over' : state.gameState.endingPhase > 0 ? 'ending' : null),

  getSessionStartGuidance: (table?: 'physical' | 'digital') =>
    table === 'digital'
      ? DIGITAL_GUIDANCE
      : PHYSICAL_GUIDANCE,

  getReferenceData: () => ({
    note: 'Adventurer Olympics reference data — card catalogs + tile icon map.',
    tiles: 'See the 10 tiles in the map (each 7 hexes; icons on outer hexes).',
    stats: 'Charisma (recruit), Strength (fight), Movement (steps). Start: 1/1/2.',
  }),

  getLog: (state: SessionState<AOState>): GameLogEntry[] => {
    const g = state.gameState;
    return g.log.map((e) => ({
      seq: e.seq,
      turn: e.turn,
      phase: e.phase,
      actor: e.playerId ?? null,
      category: e.phase ?? 'event',
      summary: e.summary,
      ...(e.headline ? { headline: e.summary, ...(e.playerId ? { subject: e.playerId } : {}) } : {}),
    }));
  },

  describeNextStep: (state: SessionState<AOState>): NextStep | null => {
    const g = state.gameState;
    assertCurrentFormat(g);
    if (g.gameOver) {
      return { status: 'game_over', active_player_id: null, instruction: 'The game is over — the result is in is_game_over.' };
    }    const p = g.pending;
    if (!p) return null;
    const pendingSeat = state.players.find((pl) => pl.player_id === p.seat);
    if (pendingSeat?.kind === 'ai') return null;
    // A digital human is never asked to report a roll or a draw: their client
    // shows the Roll / Draw button (resolve_report), which only the person
    // presses. The generic directive covers them. Only a physical human or a
    // genuine decision gets a directive here.
    if (pendingSeat?.table === 'digital' && (p.kind === 'setup_explore_report' || p.kind === 'report_card' || p.kind === 'roll' || p.kind === 'draw')) return null;
    const seat = seatDisplayName(state.players, p.seat);
    const base = (instruction: string, humanResponse?: NextStep['human_response']): NextStep => ({
      status: 'human_to_move',
      active_player_id: p.seat,
      instruction,
      human_response: humanResponse,
    });
    const payload = p.payload ?? {};
    switch (p.kind) {
      case 'setup_standee_colour':
        return base(`Setup: ${seat} chooses an Adventurer standee and a colour.`, {
          ask: `which standee (figure) and which colour do you want? Colours still free: ${availableColours(g).join(', ')}`,
          example: `I will take the knight figure and ${availableColours(g)[0] ?? 'Red'}.`,
          records_as: 'setup_standee with standee and colour',
          spoken_ask: 'Which standee and colour do you want?',
        });
      case 'setup_explore_report': {
        const owed = setupReportOwed(g);
        const still = [
          ...(owed.questsLeft > 0 ? [`${owed.questsLeft} quest card${owed.questsLeft === 1 ? '' : 's'}`] : []),
          ...(owed.tileOwed ? ['the starting tile'] : []),
        ].join(' and ');
        return base(`Setup: ${seat} draws ${payload.questsExpected} quest cards and flips the top map tile for the starting tile. ASK them what they drew — do NOT invent it. Still to report: ${still}. They can report it all at once or one piece at a time.`, {
          ask: `which quest cards did you draw, and which tile did you flip for the starting tile? (still to report: ${still})`,
          example: 'I drew Explore 3 tiles, Most companions and Most Little Monsters, and the starting tile is Tile 4.',
          records_as: 'setup_report with the quest names and/or the starting tile number',
          spoken_ask: 'Which quest cards did you draw, and which tile did you flip?',
        });
      }
      case 'roll': {
        if (payload.rollKind === 'turn_order') {
          return base(`Round order: ${seat} rolls 2 dice and reports the total (highest goes first; tied players roll again among themselves).`, {
            ask: 'roll 2 dice and tell me the total',
            example: 'I rolled a 3 and a 5, so 8.',
            records_as: 'report_turn_order_roll with the total',
            spoken_ask: 'Roll 2 dice — what is your total?',
          });
        }
        const dice = `${payload.diceCount} ${payload.diceCount === 1 ? 'die' : 'dice'}`;
        return base(`${seat} rolls ${dice} for the ${payload.test === 'recruit' ? 'Charisma' : 'Strength'} test against ${cardName(String(payload.cardId))} — needs ${payload.number} or more.`, {
          ask: `roll ${dice} and tell me the total (needs ${payload.number} or more)`,
          example: `I rolled ${payload.number}.`,
          records_as: 'report_test_roll with the total',
          spoken_ask: `Roll ${dice} — what is the total?`,
        });
      }
      case 'report_card': {
        // The draw may be another seat's (an AI's draw from the real deck): the
        // human at the pending draws the card for them and reports it.
        const forSeat = payload.forSeat as string | undefined;
        const other = forSeat && forSeat !== p.seat ? seatDisplayName(state.players, forSeat) : null;
        const deckWord = payload.deck === 'companion' ? 'Companion' : payload.deck === 'little' ? 'Little Monster' : payload.deck === 'big' ? 'Big Monster' : 'Dungeon';
        if (payload.deck === 'tile') {
          return base(other
            ? `${other} explores. ASK ${seat} to draw the top map tile from the real stack for ${other} and say which it is (its printed number) — do NOT invent it.`
            : `${seat} explores — they drew the top map tile. ASK which tile they drew (its printed number) — do NOT invent it.`, {
            ask: other ? `draw the top map tile for ${other} — which tile is it? (its printed number, e.g. "Tile 4")` : 'which map tile did you draw? (its printed number, e.g. "Tile 4")',
            example: 'It is Tile 4.',
            records_as: 'report_card with the printed tile',
            spoken_ask: other ? `Draw the top map tile for ${other}. Which tile is it?` : 'Which tile did you draw?',
          });
        }
        return base(other
          ? `${other} draws a ${deckWord} card. ASK ${seat} to draw the top ${deckWord} card from the real deck for ${other} and say what is printed on it — do NOT invent it.`
          : `${seat} drew a ${deckWord} card — ASK what is printed on it. Do NOT invent it.`, {
          ask: other ? `draw the top ${deckWord} card for ${other} — what is printed on it?` : `what ${deckWord} card did you draw? (what is printed on it)`,
          example: payload.deck === 'companion' ? 'Number 2, +1 Strength.' : payload.deck === 'dungeon' ? 'Big Monster.' : 'Number 4.',
          records_as: 'report_card with the printed card',
          spoken_ask: other ? `Draw the top ${deckWord} card for ${other}. What is on it?` : 'Which card did you draw?',
        });
      }
      case 'move':
        return base(`${seat}'s turn: move up to ${(g.players[p.seat] as { stepsLeft: number }).stepsLeft} steps (you may stop), step onto an icon to trigger it, or explore if you have a step left and are on an outer hex touching an empty slot.`, {
          ask: 'what do you want to do — move where, stop, or explore where?',
          example: 'I step to the hex with the Little Monster icon.',
          records_as: 'step / stop / explore',
          spoken_ask: 'Where do you move, do you stop, or do you explore?',
        });
      case 'try_again':
        return base(`${seat} is on a failed icon — stay and try again (fresh card), walk away along a path you choose, explore if this hex touches an empty slot, or stop and do nothing this turn.`, {
          ask: 'stay and try again, walk away (where?), explore, or stop?',
          example: 'I walk away one step and keep moving.',
          records_as: 'try_again, or move_away with your chosen path, or explore, or stop',
          spoken_ask: 'Try the icon again, walk away, explore, or stop?',
        });
      case 'explore_place': {
        const context = payload.context as string;
        const scope = context === 'ordinary' ? 'a slot touching your hex' : 'any empty slot touching the map';
        return base(`${seat} places the revealed Tile ${payload.tileId} — choose ${scope} and which way to turn the tile (named by where its printed N hex points, in terms of the starting tile).${context === 'forced' ? ' Then take the rest of your turn as normal.' : ''}`, {
          ask: `which empty slot (${scope}) for Tile ${payload.tileId}, and which way does its N hex point?`,
          example: "Against side NE–SE of Tile 4, with its N hex pointing where the starting tile's SE hex points.",
          records_as: 'explore with slot and rotation' + (context === 'ordinary' ? '' : ''),
          spoken_ask: 'Where do you place the tile?',
        });
      }
      case 'take_artifact': {
        const options = anyArtifactOptions(g, p.seat).map((o) => `${artifactLabel(o.artifact)} (${o.from === 'supply' ? 'supply' : seatLabelLoose(state, o.from)})`).join(', ');
        return base(`${seat} may take one of the four suit artifacts — ${options} — or decline and draw another Dungeon card. The Star is never takeable here.`, {
          ask: 'which artifact, and from where (or decline)?',
          example: 'I take Hearts from the supply.',
          records_as: 'take_artifact with artifact + from, or decline_artifact',
          spoken_ask: 'Which artifact do you take, or do you decline?',
        });
      }
      default:
        return base(`${seat} is waiting.`);
    }
  },

  getSetupChecklist: (state: SessionState<AOState>): SetupStep[] => {
    const g = state.gameState;
    if (g.playerOrder.every((pid) => (g.players[pid] as { kind: string }).kind === 'ai')) return [];
    // Humans pick first, then each AI seat takes a colour still free.
    const isAI = (pid: string) => (g.players[pid] as { kind: string }).kind === 'ai';
    const order = [...g.playerOrder.filter((pid) => !isAI(pid)), ...g.playerOrder.filter(isAI)];
    return order.map((pid) => ({
      move_type: 'setup_standee',
      count: 1,
      description: isAI(pid)
        ? `${seatLabelLoose(state, pid)} (AI) takes a colour no human chose.`
        : `Choose a standee and a colour (${seatLabelLoose(state, pid)}) — Red, Blue, Yellow or Purple, not one already taken.`,
      ask_human_for: isAI(pid) ? '' : 'your standee and colour',
    }));
  },

  getBalanceAxes: (): BalanceAxis[] => [
    {
      name: 'standee',
      kind: 'cosmetic',
      description: 'Standee + colour (no mechanical effect). AI seats take colours in seat order, so the seat win-rate table is the flatness check.',
      levers: [],
      recipe: 'no lever — read the "Win rate by seat" table; it should be flat',
    },
    {
      name: 'quest_draw',
      kind: 'scenario',
      description: 'Which players+1 of the 6 quests are drawn at setup. Random per game (seeded), not chosen; it decides which paths score at all.',
      levers: [],
      recipe: 'varies with --seed; the lift table carries quest_in_play:<quest> per player-game (analysis.ts playerFeatures)',
    },
  ],

  getChoiceCatalog: (): PlayerChoice[] => AOChoices,
};

// ---------------------------------------------------------------------------
// Summary + naming helpers. The canonical state_summary is built from the
// log lines the move produced — every observable board change the engine
// recorded — so the relayer never drops a quest claim, an artifact transfer,
// a completed icon, or the ending trigger (R3).
// ---------------------------------------------------------------------------
/** A hex argument: an axial key, or table words ("Tile 3 NE", "the centre of
 *  Tile 1"). Rejects with the accepted forms rather than guessing. */
function hexArg(g: AOState, ref: unknown): string {
  const key = resolveHexRef(g.placedTiles, ref);
  if (!key) throw new GameError('ILLEGAL_MOVE', `could not read the hex "${String(ref)}" — name it like "the NE hex of Tile 3" or "the centre of Tile 1" (get_legal_moves lists every hex you can step to)`);
  return key;
}

/** The copy applyMove works on. Everything is deep-copied through JSON (the
 *  state is JSON-safe by design — types.ts header) EXCEPT the log entries:
 *  the log only ever grows (engine.ts `log` pushes a new entry and never edits
 *  an old one), and late in a game it is most of the state, so the copy gets
 *  its own list holding the same entry objects. The MCTS search calls
 *  applyMove on every rollout step, where this halves the copy's cost.
 *  If the engine ever edits an existing log entry, copy the entries too
 *  (purity.test.ts fails if it does). Key order is kept, so a saved state
 *  serializes exactly as before. */
function copyForMove(input: SessionState<AOState>): SessionState<AOState> {
  const { log, ...rest } = input.gameState;
  const copy = JSON.parse(JSON.stringify({ ...input, gameState: rest })) as SessionState<AOState>;
  const copied = copy.gameState as unknown as Record<string, unknown>;
  copy.gameState = Object.fromEntries(
    Object.keys(input.gameState).map((k) => [k, k === 'log' ? log.slice() : copied[k]]),
  ) as unknown as AOState;
  return copy;
}

function summarize(state: SessionState<AOState>, g: AOState, summary: string): ApplyMoveResult<AOState> {
  const pendingSeat = g.pending?.seat;
  if (pendingSeat && state.players.some((p) => p.player_id === pendingSeat)) {
    state.activePlayerId = pendingSeat;
  }
  return { newState: state, summary };
}

/** Fold the log lines the move produced into one canonical summary. `prefix`
 *  is used only when the move produced no log lines (a bare step/stop). */
function tailSummary(g: AOState, logBefore: number, prefix?: string): string {
  const fresh = g.log.slice(logBefore).map((l) => l.summary);
  const body = fresh.join(' ');
  if (body && prefix && !body.startsWith(prefix)) return `${prefix} ${body}`.trim();
  return (body || (prefix ?? '')).trim();
}

function artifactLabel(a: ArtifactId): string {
  return { hearts: 'Hearts', spades: 'Spades', diamonds: 'Diamonds', clubs: 'Clubs', star: 'Star' }[a];
}

/** `move.tile` accepts a printed tile ("Tile 4", "4") and resolves to the id. */
function resolveReportedTile(tile: unknown): number | undefined {
  if (tile === undefined || tile === null) return undefined;
  const m = String(tile).trim().match(/(\d+)/);
  if (!m) throw new GameError('ILLEGAL_MOVE', `could not read a tile number from "${tile}"`);
  return Number(m[1]);
}

function seatLabel(state: SessionState<AOState>, playerId: string): string {
  const pl = (state.gameState.players[playerId] as { name?: string; standee?: string; colour?: string } | undefined);
  const given = pl?.name?.trim();
  if (given && given !== playerId) return given;
  const identity = (pl?.standee?.trim() ?? pl?.colour?.trim()) as string | undefined;
  if (identity) return identity;
  return seatDisplayName(state.players, playerId);
}

function seatLabelLoose(state: SessionState<AOState>, playerId: string): string {
  const pl = state.players.find((p) => p.player_id === playerId);
  return pl?.name?.trim() && pl.name !== playerId ? pl.name : seatDisplayName(state.players, playerId);
}

function pendingIs(g: AOState, kind: PendingKind): Pending | null {
  return g.pending?.kind === kind ? g.pending : null;
}

/** A digital HUMAN seat gets the no-payload reveal button (Roll). */
function isDigitalButton(state: AOState, playerId: string): boolean {
  const p = state.players[playerId];
  return p?.kind === 'human' && p.table === 'digital';
}

const PHYSICAL_GUIDANCE = `
ADVENTURER OLYMPICS — a 2–4 player exploration race. The humans have a PHYSICAL copy on the table: 10 hex map tiles, 5 decks, 5 artifact cards, 4 standees, dice. You are the bookkeeper for the shared table (map, quests, held cards, initiative) and the brain for AI seats.

TURN STRUCTURE (one action per apply_move):
1. Every round, everyone rolls 2 dice for turn order (highest first; tied players roll again among themselves). Humans roll their own dice and report the total.
2. In turn order, each player: may move (up to their Movement steps), may explore (if they have a step left and stand on an outer hex touching an empty tile slot). Stepping onto an uncompleted icon triggers it and ends the turn. Exploring REVEALS the top tile, then you choose the slot and rotation; it uses all remaining steps and ends the turn. A forced explore (all icons completed) happens at the START of the turn and the turn continues after it.
3. Icons: City = recruit a companion (Charisma roll); Little/Big Monster = fight (Strength roll); Dungeon = draw a Dungeon card and resolve it; Artifact = take it (no roll).

DICE AND CARDS BELONG TO THE PLAYERS. When next_step asks for a roll or a card, ask the human to roll/draw physically and report the result (report_turn_order_roll / report_test_roll / report_card) — never roll for them, never invent a card. The server rolls for AI seats and digital seats. The decks are one shared pile: if any player uses the real cards, the server does not know their order, so a human draws the AI's cards too and reports them (next_step says who and for whom).

NEVER INVENT VALUES. Read the board, held cards, and stats from get_state / get_legal_moves. Ask the human for their dice and cards.
`.trim();

const DIGITAL_GUIDANCE = `
ADVENTURER OLYMPICS — a 2–4 player exploration race, played DIGITALLY: the server holds the decks and the tile stack and rolls the dice.

TURN STRUCTURE (one action per apply_move):
1. Every round, everyone rolls 2 dice for turn order. When your roll is owed, press Roll (report_turn_order_roll reports a number; a digital seat may let the server roll with resolve_report).
2. On your turn: move up to your Movement steps with step (or stop). Step onto an uncompleted icon to trigger it. Explore with explore: the server reveals the top tile, then you choose the slot and rotation.
3. Icons: City = recruit (Charisma), Monster = fight (Strength), Dungeon = draw a Dungeon card, Artifact = take it. Every card is drawn only when the player presses Draw (resolve_report): the card for a test, each Dungeon card (including every "draw again"), and the tile for a forced explore or a Dungeon Map card. Then, when a test is owed, press Roll (resolve_report) or report the total with report_test_roll.

Never roll or draw silently; never report a number nobody rolled. Read the board from get_state and the menu from get_legal_moves.
`.trim();
