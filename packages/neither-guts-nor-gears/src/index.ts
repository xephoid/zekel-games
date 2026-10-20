// Neither Guts nor Gears — the Game module (MCP registration seam).

import type {
  AIMoveResult, ApplyMoveResult, BalanceAxis, Game, GameLogEntry, GameResult,
  LegalMove, NextStep, PlayerChoice, PlayerConfig, RuleSection, SessionState,
  SetupStep, MoveGateStatus,
} from '@zekel/game-kit';
import { GameError } from '@zekel/game-kit';
import { renderRulesText } from '@zekel/game-kit';
import {
  applyMove as engineApply, autoReportMove, byId, checkGameOver, createInitialState,
  hasLivingLeader, pendingAllowedMoveTypes, type NGGOptions, militaryThreshold, techTotal, speciesOf,
  upgradeLegacyState,
} from './engine.js';
import { collectorReach, getLegalMoves as legal } from './legalMoves.js';
import { nggMoveGates } from './moveGates.js';
import { getLogEntries, getPlayerView, getPublicView } from './views.js';
import { chooseMove, seededPick, searchChoices, type Difficulty } from './ai.js';
import { chanceAll } from './ai-eval.js';
import { sampleHiddenState } from './search.js';
import { nggScoreRow, type NGGScoreRow } from './eval.js';
import { chooseMoveMCTS } from '@zekel/game-kit';
import { randomSeed } from './rng.js';
import {
  BATTLE_CARDS, cultureTargetFor, ECONOMIC_SPEND, FACTIONS, HEROES, milestonesFor,
  MILITARY_KILLS_NEEDED, ROBOT_BUILDINGS, ROBOT_COLLECTOR_SUPPLY, ROBOT_RESEARCH, researchForSpecies,
  ROBOT_UNITS, TREATIES, TECH_TARGET, WIZARD_BUILDINGS, WIZARD_RESEARCH, WIZARD_UNITS,
  describeCost,
  BATTLE_CARD_PURCHASE,
  TREATY_UNLOCK,
  heroStatsForCategory,
} from './data/catalogs.js';
import { ECONOMIC_COLLECTORS_BY_LAYOUT, economicCollectorsNeeded } from './economicScale.js';
import { FIVE_SIX_PLAYER_TILES, THREE_FOUR_PLAYER_TILES, TWO_PLAYER_TILES, tileLabel } from './data/maps.js';
import { heroesEligibleFor } from './resolvers.js';
import { readableText } from './names.js';
import { NGG_CHOICES } from './choices.js';
import { NGG_SECTIONS } from './rulesSections.js';
import type { NGGMove, NGGState } from './types.js';

/** The session's game state in its current shape: a session saved before
 *  robot collectors became off-map pieces is upgraded in place on first read
 *  (engine.ts upgradeLegacyState; a no-op afterwards). */
function cur(state: SessionState<NGGState>): NGGState {
  return upgradeLegacyState(state.gameState);
}

const optionsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    seed: { type: 'integer', minimum: 0, description: 'RNG seed for reproducible games. Random if omitted.' },
    factionAssignment: { type: 'array', items: { type: 'string' }, description: 'Balance harness: per-seat faction assignment (creation order). All-AI only.' },
    aiLeaderAssignment: { type: 'array', items: { type: 'string' }, description: 'Balance harness: species-eligible Leader names or ids per AI seat (creation order).' },
    setupFirstPlayerId: { type: 'string', description: 'Tests/harness: pin the setup first player. Default: server seeded RNG.' },
    aiRandomStarts: { type: 'boolean', description: 'Balance harness: AI seats draw a seeded random start tile instead of picking one.' },
    economicCollectors: { type: 'integer', minimum: 11, description: 'Experimental override: collectors the Economic spend needs. Default is 12 / 16 / 26 by player count; the Surf cap and the Core supply follow it (robot collector caps follow the map).' },
  },
} as const;

const moveSchema = {
  oneOf: [
    { type: 'object', required: ['type', 'selections'], properties: { type: { const: 'assign_setup_choices' }, selections: { type: 'object' } } },
    { type: 'object', required: ['type', 'faction'], properties: { type: { const: 'choose_faction' }, faction: { type: 'string' } } },
    { type: 'object', required: ['type', 'hero'], properties: { type: { const: 'choose_leader' }, hero: { type: 'string' } } },
    { type: 'object', required: ['type', 'location'], properties: { type: { const: 'choose_starting_location' }, location: { type: 'string' } } },
    { type: 'object', required: ['type', 'card'], properties: { type: { const: 'report_draw' }, card: { type: 'string' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'resolve_report' } } },
    { type: 'object', required: ['type', 'allocations'], properties: { type: { const: 'reallocate_cores' }, allocations: { type: 'object' } } },
    { type: 'object', required: ['type', 'card'], properties: { type: { const: 'plan_action' }, card: { enum: ['build', 'move_battle', 'research', 'pass'] }, which: { enum: ['base', 'hero_extra', 'researched_extra'] } } },
    { type: 'object', required: ['type', 'item', 'payment'], properties: { type: { const: 'build' }, item: { type: 'string' }, payment: { type: 'array' }, core_pairing: { type: 'boolean' }, at_base: { type: 'string' } } },
    { type: 'object', required: ['type', 'payment'], properties: { type: { const: 'economic_victory_spend' }, payment: { type: 'array' } } },
    { type: 'object', required: ['type', 'grant'], properties: { type: { const: 'respond_access_request' }, grant: { type: 'boolean' } } },
    { type: 'object', required: ['type', 'from', 'to', 'units'], properties: { type: { const: 'move_units' }, from: { type: 'string' }, to: { type: 'string' }, units: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'cast_elara_spell' }, target_location: { type: ['string', 'null'] }, skip: { type: 'boolean' } } },
    { type: 'object', required: ['type', 'kind'], properties: { type: { const: 'research' }, kind: { enum: ['tech', 'battle_card'] }, tech: { type: 'string' }, payment: { type: 'array' } } },
    { type: 'object', required: ['type', 'partner', 'treaty_type'], properties: { type: { const: 'form_treaty' }, partner: { type: 'string' }, treaty_type: { type: 'string' } } },
    { type: 'object', required: ['type', 'accept'], properties: { type: { const: 'respond_treaty' }, accept: { type: 'boolean' } } },
    { type: 'object', required: ['type', 'treaty_type', 'partner'], properties: { type: { const: 'break_treaty' }, treaty_type: { type: 'string' }, partner: { type: 'string' } } },
    { type: 'object', required: ['type', 'card'], properties: { type: { const: 'commit_battle_card' }, card: { type: ['string', 'null'] } } },
    { type: 'object', required: ['type', 'card'], properties: { type: { const: 'choose_counter_target' }, card: { type: 'string' }, played_by: { type: 'string', description: 'the player who played the card to counter (when two players played the same card)' }, batch: { type: 'integer', minimum: 0 } } },
    { type: 'object', required: ['type', 'cards'], properties: { type: { const: 'select_extra_cards' }, cards: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', required: ['type', 'unit', 'action'], properties: { type: { const: 'battle_activation' }, unit: { type: 'string' }, action: { type: 'object' } } },
    { type: 'object', required: ['type', 'unit'], properties: { type: { const: 'choose_initiative_order' }, unit: { type: 'string', description: 'the tied allied unit (ref or printed name) that acts next' } } },
    {
      type: 'object', required: ['type', 'defense'],
      properties: {
        type: { const: 'resolve_battle_defense' },
        defense: {
          type: 'object',
          description: 'kind: "none" | "decoy" | "mana_shield" | "cleric_save". mana_shield carries mana (non-negative integer ≤ your mana). decoy may carry moveTo + hero. cleric_save carries cleric + target (the unit under attack).',
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: ['none', 'decoy', 'mana_shield', 'cleric_save'] },
            mana: { type: 'integer', minimum: 0 },
            hero: { type: 'string' },
            moveTo: { type: ['string', 'null'] },
            cleric: { type: 'string' },
            target: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    { type: 'object', required: ['type'], properties: { type: { const: 'choose_retreat' }, destination: { type: ['string', 'null'] }, stay: { type: 'boolean' } } },
    { type: 'object', required: ['type', 'units'], properties: { type: { const: 'select_rally_units' }, units: { type: 'array', items: { type: 'string' } } } },
    { type: 'object', required: ['type', 'hero'], properties: { type: { const: 'choose_milestone_hero' }, hero: { type: 'string' } } },
    { type: 'object', required: ['type', 'hero'], properties: { type: { const: 'resolve_overlay_choice' }, hero: { type: 'string' } } },
    { type: 'object', required: ['type', 'collector'], properties: { type: { const: 'choose_dowser_collector' }, collector: { type: 'string', description: 'printed collector name, e.g. "Water collector"' } } },
    { type: 'object', required: ['type', 'hero', 'coord'], properties: { type: { const: 'place_reserved_hero' }, hero: { type: 'string' }, coord: { type: 'string' } } },
    { type: 'object', required: ['type', 'hero'], properties: { type: { const: 'choose_spy' }, hero: { type: 'string' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'skip_action' } } },
  ],
} as const;

const sessionStartGuidance = `\
HOW TO RUN THIS GAME (read before continuing — overrides default behavior):

1. The humans play with a PHYSICAL copy on a real table. You are the bookkeeper for shared state (map, culture, mana, research, the Action Stack, treaties, the public discard) and the brain for AI seats. The 20-card battle strategy deck: when a HUMAN draws (a battle-card purchase or a reward), they draw physically and REPORT the card (report_draw, by its printed name); the server validates the deck's conservation. Never invent a drawn card. AI draws happen silently; never reveal an AI's hidden hand or a spy assignment.

2. SETUP CHOICES BELONG TO THE HUMANS — ASK, DON'T PICK. Each player chooses a FACTION, then each drafts a LEADER in player order (species-restricted; starred are recommended), then each picks a numbered STARTING LOCATION in reverse order. One human reporter submits factions via assign_setup_choices; Leaders and locations are per-seat choices. Obey next_step and the setup_checklist.

3. ROUND STRUCTURE — UPKEEP, PLAN, LIFO, INCOME, CLAIMS. Upkeep rotates the first-player token (yes, before round one), retrieves collectors, lets robots reallocate Cores, resets mana, returns played cards. Planning: each player in turn places one unused action card or passes (passing is final). The Action phase pops the stack LAST-IN-FIRST-OUT and its owner performs or declines it (declining uses the card but commits nothing). Then culture income in first-player order (victory checked immediately), then milestone hero claims one per player per cycle. One action per move — never chain from memory; obey next_step.

4. SETTLING SECRETS. Spy assignments (choose_spy) and battle-card commitments (commit_battle_card) are PRIVATE to the deciding seat: collect the value without announcing it to the table, and never read another seat's pending aloud. Commitments reveal only after every participant has committed.

5. REPORT AI MOVES IN FULL. The AI's economy and armies are virtual but the human moves physical pieces: relay every purchase, payment, movement, battle casualty, claim, treaty, and card play from the summaries and log. Plain mechanical terms, no flavor. Never reveal the AI's hidden hand or spy.

6. WIN by one of four paths, always with a living Leader: Military (kill the required enemy Leaders: 1 at 2-3 players, 2 at 4-6), Cultural (35 culture per player: 70 at 2 players up to 210 at 6), Economic (one Build action paying at least 3 water + 3 wood + 3 ore + 1 ether + 1 oil from collectors on distinct tiles: 12 at two players, 16 at three to four, 26 at five to six), Technological (26 unique-type points for either species, the battle strategy card type among them, earned by the first card bought or gained from Chaimidious; Motherboard and Greymore give +5 each while in play). Never invent values — read them from this session's tools.`;

const digitalSessionStartGuidance = `\
HOW TO RUN THIS GAME (DIGITAL SESSION — read before continuing):

1. DIGITAL SESSION: the human has NO physical copy. The server holds the battle deck and each seat's private hand; when the rules say a human draws a battle card, next_step will say to press Draw — send resolve_report{} and the server deals and shows the card privately. AI seats draw silently. Never invent the draw.

2. SETUP CHOICES BELONG TO THE HUMANS — ASK, DON'T PICK (unchanged). Factions → Leader draft → starting locations, per seat.

3. ROUND STRUCTURE: upkeep → planning → LIFO action stack → income → claims. Upkeep rotates the first-player token before round one. Skipping a queued action uses the card for the round without committing collectors.

4. SECRETS stay private: spy assignments and battle-card commitments ride the deciding seat's own view — commitments reveal together only after everyone commits.

5. REPORT AI MOVES IN FULL. Relay every purchase, payment, movement, casualty, claim, treaty, and card play from summaries and the log. Never reveal an AI's hand or spy.

6. WIN via Military / Cultural (35 per player) / Economic (12/16/26 collectors) / Technological (26 points) with a living Leader. Read values from this session's tools.`;

export class NeitherGutsNorGearsGame implements Game<NGGState, NGGMove, NGGOptions> {
  readonly id = 'neither-guts-nor-gears';
  readonly name = 'Neither Guts nor Gears';
  readonly description =
    'A 2-6 player hex-map game of wizards and robots. Collect the five resources, ' +
    'fight one-hit-kill battles in LIFO initiative passes, claim heroes off culture ' +
    'milestones, hold treaties, and win by Military, Cultural, Economic, or ' +
    'Technological victory. Physical-first: the server is the bookkeeper; the ' +
    'battle strategy deck is table-owned at a physical seat (report what you drew).';
  readonly minPlayers = 2;
  readonly maxPlayers = 6;
  readonly supportsAI = true;
  readonly hasHiddenInformation = true;
  readonly version = '0.1.0';
  readonly optionsSchema = optionsSchema as unknown as Record<string, unknown>;
  readonly moveSchema = moveSchema as unknown as Record<string, unknown>;

  createSession(players: PlayerConfig[], options?: NGGOptions): SessionState<NGGState> {
    if (players.length < 2 || players.length > 6) {
      throw new GameError('INVALID_PLAYERS', `Neither Guts nor Gears supports 2-6 players; got ${players.length}`);
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

  getLegalMoves(state: SessionState<NGGState>, playerId: string): LegalMove<NGGMove>[] {
    return legal(cur(state), playerId);
  }
  getPublicView(state: SessionState<NGGState>): unknown { return getPublicView(cur(state)); }
  getPlayerView(state: SessionState<NGGState>, playerId: string): unknown { return getPlayerView(cur(state), playerId); }

  isGameOver(state: SessionState<NGGState>): GameResult | null {
    const r = checkGameOver(cur(state));
    if (!r.game_over) return null;
    return { game_over: true, winners: r.winners, scores: r.scores, summary: r.summary };
  }

  applyMove(state: SessionState<NGGState>, playerId: string, move: NGGMove): ApplyMoveResult<NGGState> {
    const result = engineApply(cur(state), playerId, move);
    const say = (text: string) => readableText(result.newState, state.players, text);
    return {
      newState: { ...state, gameState: result.newState, activePlayerId: result.newState.activePlayerId, turnNumber: result.newState.round },
      summary: say(result.summary),
      ...(result.privateReveals ? { privateReveals: result.privateReveals.map((r) => ({ ...r, text: say(r.text) })) } : {}),
    };
  }

  async getAIMove(state: SessionState<NGGState>, playerId: string, difficulty?: string, strategy?: string): Promise<AIMoveResult<NGGMove>> {
    if (difficulty === 'mcts') {
      // Search runs on the module directly. Strength and feasibility are
      // measured at explicit budgets in BALANCE.md, not assumed from the name.
      const budgetMs = Number(process.env.MCTS_BUDGET_MS ?? '1000');
      // Short rollouts: the leaf is read by the hard AI's chance-of-winning
      // measure, so a long rollout mostly spends the budget.
      const result = chooseMoveMCTS(this, state, playerId, { budget_ms: budgetMs, max_rollout_plies: 8 });
      if (!result.move) {
        // No expandable move (e.g. an all-pass set the search pruned away).
        // Fall back to the seeded pick — deterministic, never a throw.
        const legalMoves = legal(cur(state), playerId);
        if (legalMoves.length === 0) throw new GameError('ILLEGAL_MOVE', `AI ${playerId} has no legal move (mcts)`);
        const pick = seededPick(cur(state), legalMoves);
        return { move: pick, narration: this.publicNarration(state, playerId, pick) };
      }
      return { move: result.move, narration: this.publicNarration(state, playerId, result.move) };
    }
    const d: Difficulty = difficulty === 'random' || difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'medium';
    const { move } = chooseMove(cur(state), playerId, d, strategy);
    return { move, narration: this.publicNarration(state, playerId, move) };
  }

  /** What the AI's move will be seen to do — the same public text its
   *  summary carries. The AI's reasoning is never narrated: it named cards
   *  that are still face down ("plans Move/Battle"). */
  publicNarration(state: SessionState<NGGState>, playerId: string, move: NGGMove): string {
    try { return this.applyMove(state, playerId, move).summary; } catch { return ''; }
  }

  // Rich per-event log (CLAUDE.md: getLog, not getScoreboard).
  getLog(state: SessionState<NGGState>): GameLogEntry[] {
    const g = cur(state);
    return getLogEntries(g).map((e) => ({
      ...e,
      summary: readableText(g, state.players, e.summary),
      ...(e.headline !== undefined ? { headline: readableText(g, state.players, e.headline) } : {}),
      ...(e.subject_headline !== undefined ? { subject_headline: readableText(g, state.players, e.subject_headline) } : {}),
    }));
  }

  // ---- Balance §4 instrumentation -----------------------------------------
  // One "who is ahead" scalar (eval.ts) — consumed by the heuristic, the MCTS
  // leaf, and the balance harness's per-turn leader read.
  getScoreboard(state: SessionState<NGGState>): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const p of cur(state).players) {
      const row: NGGScoreRow = nggScoreRow(cur(state), p.playerId);
      out[p.playerId] = {
        culture: row.culture,
        leader_kills: row.leader_kills,
        surfs_committed: row.surfs_committed,
        tech_points: row.tech_points,
        tech_target: row.tech_target,
        military_needed: row.military_needed,
        has_living_leader: row.has_living_leader,
      };
    }
    return out;
  }

  // ---- Generic-MCTS hooks (ai-development §3) ------------------------------
  getRewardForPlayer(state: SessionState<NGGState>, playerId: string): number {
    const r = checkGameOver(cur(state));
    if (!r.game_over) return 0.5;
    if (r.winners.length === 0) return 0.5;
    return r.winners.includes(playerId) ? 1 : 0;
  }
  cloneState(state: SessionState<NGGState>): SessionState<NGGState> {
    return structuredClone(state) as SessionState<NGGState>;
  }
  selectRolloutMove(state: SessionState<NGGState>, playerId: string): NGGMove | null {
    if (cur(state).result) return null;
    // Reuse medium as the rollout policy (fast, competent).
    const { move } = chooseMove(cur(state), playerId, 'medium');
    return move;
  }
  getHeuristicValue(state: SessionState<NGGState>, playerId: string): number {
    // The hard AI's own measure: the seat's chance of winning the race
    // (ai-eval.ts), read from its point of view.
    return chanceAll(cur(state), playerId);
  }
  getSearchMoves(state: SessionState<NGGState>, playerId: string): LegalMove<NGGMove>[] {
    return searchChoices(cur(state), playerId);
  }
  determinize(state: SessionState<NGGState>, observer: string, rng: () => number): SessionState<NGGState> {
    return sampleHiddenState(state, observer, rng);
  }

  // ---- Rules-teaching (port blocker): sections + gates + phase ------------
  /** Read-only questions a seat may ask while composing (core Game.queryChoice). */
  queryChoice(state: SessionState<NGGState>, playerId: string, name: string, args: Record<string, unknown>): unknown {
    if (name === 'collector_reach') {
      const raw = Array.isArray(args['prior']) ? args['prior'] : [];
      if (raw.length > economicCollectorsNeeded(state.gameState)) throw new GameError('ILLEGAL_MOVE', `At most ${economicCollectorsNeeded(state.gameState)} placements`);
      const prior = raw.map((x) => {
        const o = (x ?? {}) as { collectorId?: unknown; coord?: unknown };
        if (typeof o.collectorId !== 'string' || typeof o.coord !== 'string') {
          throw new GameError('INVALID_MOVE_SHAPE', 'Each prior placement is { collectorId, coord }');
        }
        return { collectorId: o.collectorId, coord: o.coord };
      });
      const purchase = args['purchase'] && typeof args['purchase'] === 'object' && !Array.isArray(args['purchase'])
        ? args['purchase'] as Record<string, unknown> : null;
      return collectorReach(cur(state), playerId, prior, purchase);
    }
    throw new GameError('ILLEGAL_MOVE', `Neither Guts nor Gears answers no question named "${name}"`);
  }

  getRulesSections(): RuleSection[] { return NGG_SECTIONS; }
  getRulesText(): string { return renderRulesText(NGG_SECTIONS); }

  describeMoveGates(state: SessionState<NGGState>, playerId: string): MoveGateStatus[] {
    // Live reasons, whole move types and single blocked options (moveGates.ts).
    const s = cur(state);
    return nggMoveGates(s, playerId, legal(s, playerId));
  }

  getCurrentPhase(state: SessionState<NGGState>): string | null {
    return cur(state).phase;
  }

  getSessionStartGuidance(table?: 'physical' | 'digital'): string {
    return table === 'digital' ? digitalSessionStartGuidance : sessionStartGuidance;
  }

  getReferenceData(): unknown {
    return {
      factions: FACTIONS,
      wizard_units: WIZARD_UNITS, wizard_buildings: WIZARD_BUILDINGS, wizard_research: WIZARD_RESEARCH,
      robot_units: ROBOT_UNITS, robot_buildings: ROBOT_BUILDINGS, robot_research: ROBOT_RESEARCH,
      robot_collector_supply: ROBOT_COLLECTOR_SUPPLY,
      // Each hero with its printed battle stats (§8.2 table by category); a
      // Leader adds the DEF in leader_stat_bonus.
      heroes: HEROES.map((h) => ({ ...h, stats: heroStatsForCategory(h.category, false) })),
      leader_stat_bonus: { def: heroStatsForCategory('military', true).def - heroStatsForCategory('military', false).def },
      battle_deck: BATTLE_CARDS,
      // What buying one battle card on a Research action costs, and what unlocks it.
      battle_card_purchase: { cost: BATTLE_CARD_PURCHASE.cost, either: BATTLE_CARD_PURCHASE.either, unlocked_by: BATTLE_CARD_PURCHASE.unlockedBy },
      // What unlocks treaty formation: a species building, or this hero placed.
      treaty_unlocked_by: { ...TREATY_UNLOCK.buildings, hero: HEROES.find((h) => h.id === TREATY_UNLOCK.heroId)!.name },
      treaties: TREATIES,
      victory: {
        // Both scale with player count (designer ruling 2026-09-24).
        milestones_by_player_count: Object.fromEntries([2, 3, 4, 5, 6].map((n) => [n, milestonesFor(n)])),
        culture_target_by_player_count: Object.fromEntries([2, 3, 4, 5, 6].map((n) => [n, cultureTargetFor(n)])),
        military_kills_needed: MILITARY_KILLS_NEEDED,
        economic_spend: ECONOMIC_SPEND, economic_collectors_by_layout: ECONOMIC_COLLECTORS_BY_LAYOUT,
        tech_target: TECH_TARGET,
      },
      maps: {
        // Labels ride the pair — the client renders what the engine says rather
        // than re-deriving (design doc "Hex naming", 2026-09-21).
        '2p': TWO_PLAYER_TILES.map((t) => ({ ...t, label: tileLabel(t.c, t.r) })),
        '3-4p': THREE_FOUR_PLAYER_TILES.map((t) => ({ ...t, label: tileLabel(t.c, t.r) })),
        '5-6p': FIVE_SIX_PLAYER_TILES.map((t) => ({ ...t, label: tileLabel(t.c, t.r) })),
        coordinate_convention: 'Doubled rows: (c,r) neighbors (c,r±2), (c±1,r±1); only listed coordinates are playable. Player-facing name = the derived label (e.g. E4, G7).',
      },
      eligible_leaders_by_species: {
        wizard: heroesEligibleFor('wizard').map((h) => h.name),
        robot: heroesEligibleFor('robot').map((h) => h.name),
      },
    };
  }

  getChoiceCatalog(): PlayerChoice[] { return NGG_CHOICES; }

  autoResolveReport(state: SessionState<NGGState>, playerId: string): { move: NGGMove } | null {
    const m = autoReportMove(cur(state), playerId);
    return m ? { move: m } : null;
  }

  getSetupChecklist(state: SessionState<NGGState>): SetupStep[] {
    const s = cur(state);
    const humans = state.players.filter((p) => p.kind === 'human');
    if (humans.length === 0) return [];
    const steps: SetupStep[] = [];
    if (s.phase === 'setup_factions' || s.phase === 'setup_leaders' || s.phase === 'setup_locations') {
      steps.push({
        move_type: 'assign_setup_choices', count: 1,
        description: 'Each human chooses their own faction in seat order (choose_faction; three wizard, three robot; distinct). The reporting seat may instead assign several seats at once (assign_setup_choices). AI seats take what is left.',
        ask_human_for: "each human's chosen faction FIRST (then pick a faction for any AI seat from what's left)",
      });
      steps.push({
        move_type: 'choose_leader', count: humans.length,
        description: 'Leader draft in player order: each human chooses a species-eligible hero from the shared pool (starred are recommended). The Leader keeps its abilities and gains +2 DEF.',
        ask_human_for: "each human's Leader pick, in turn, from the species-eligible pool",
      });
      steps.push({
        move_type: 'choose_starting_location', count: humans.length,
        description: 'Starting-location draft in REVERSE player order: each human picks an unoccupied numbered start; the free starting base and Leader go there. At 3 or 5 players one numbered site goes unused.',
        ask_human_for: 'each human\'s numbered starting location, in reverse order',
      });
      if (humans.some((p) => p.table === 'digital')) {
        steps.push({
          move_type: 'resolve_report', count: 0,
          description: 'Digital seats draw battle cards via the Draw button (resolve_report); physical seats report what they drew (report_draw).',
          ask_human_for: 'each digital human to press Draw when offered; each physical human to report their drawn card',
        });
      }
    }
    return steps;
  }

  describeNextStep(state: SessionState<NGGState>): NextStep | null {
    const s = cur(state);
    if (s.phase === 'game_over') return null;
    const pend = s.pending;
    if (pend) {
      const seat = state.players.find((p) => p.player_id === pend.forPlayerId);
      if (!seat) return null;
      if (seat.kind !== 'human') return null; // the AI brain resolves its own pendings
      return describePendingStep(s, pend, pend.forPlayerId, state.players.length);
    }
    if (s.phase === 'setup_factions') {
      const reporter = state.players.find((p) => p.kind === 'human')?.player_id;
      if (!reporter) return null;
      return {
        status: 'human_to_move', active_player_id: reporter,
        instruction: 'SETUP — assign each player a faction. FIRST ASK each human; then give each AI seat a remaining faction (all distinct). Wizard factions: Covenant, Schism, Brass Circle. Robot factions: Ledger, Foundry, Unbolted. Send assign_setup_choices{selections:{<player_id>:<faction id>, ...}}.',
        human_response: {
          ask: 'which faction does each player want? Ask each human FIRST. Choose from: The Covenant, The Schism, The Brass Circle (wizard); The Ledger, The Foundry, The Unbolted (robot).',
          example: 'I\'ll take The Covenant — and the AI can have The Ledger',
          records_as: 'assign_setup_choices with selections: a map of every player_id to its faction id',
        },
      };
    }
    return null;
  }

  getBalanceAxes(): BalanceAxis[] {
    return [
      { name: 'faction', kind: 'identity', description: 'Which faction each seat plays (three wizard / three robot; species drives the economy).', levers: ['sweep'], recipe: '--sweep=faction (per-seat faction shuffle)' },
      { name: 'leader', kind: 'identity', description: 'Which Leader each seat drafts (species-eligible hero).', levers: ['sweep'], recipe: '--sweep=setup (factions plus distinct species-eligible Leaders)' },
      { name: 'starting_location', kind: 'config', description: 'Reverse-order starting-location draft; measured from the setup log, conditional on the tactical AI draft.', levers: [], recipe: 'seeded draft order; inspect start and setup_order features per map' },
      { name: 'map', kind: 'scenario', description: 'The layout fixed by player count (2p / 3-4p / 5-6p).', levers: ['players'], recipe: '--players=2,3,4,5,6 (the map follows the count)' },
    ];
  }
}


function describePendingStep(s: NGGState, pend: NonNullable<NGGState['pending']>, forPlayerId: string, playerCount: number): NextStep {
  const base = { status: 'human_to_move' as const, active_player_id: forPlayerId };
  switch (pend.kind) {
    case 'choose_faction': {
      const open = FACTIONS.filter((f) => !s.players.some((x) => x.factionId === f.id));
      return {
        ...base,
        instruction: `SETUP — ${forPlayerId} chooses their own faction. ASK them; do NOT pick for them. Open: ${open.map((f) => `${f.name} (${f.species})`).join(', ')}. Send choose_faction{faction: "<faction id or name>"}. (The reporting seat may instead assign several seats at once with assign_setup_choices.)`,
        human_response: {
          ask: `${forPlayerId}, which faction do you play? Open: ${open.map((f) => f.name).join(', ')}.`,
          example: `I'll play ${open[0]?.name ?? 'The Covenant'}`,
          records_as: 'choose_faction{faction: "<faction id>"}',
        },
      };
    }
    case 'choose_leader': {
      const p = byId(s, forPlayerId);
      const pool = heroesEligibleFor(speciesOf(p)).filter((h) => s.heroPool.includes(h.id));
      return {
        ...base,
        instruction: `SETUP — ${forPlayerId} chooses their Leader from the ${p.species}-eligible pool. ASK them; do NOT pick for them. Pool: ${pool.map((h) => `${h.name}${h.recommendedLeader ? ' *' : ''}`).join(', ')} (* = recommended). Send choose_leader{hero: "<printed hero name>"}.`,
        human_response: {
          ask: `${forPlayerId}, which hero is your Leader? Species-eligible: ${pool.map((h) => h.name).join(', ')}.`,
          example: `I'll take ${pool.find((h) => h.recommendedLeader)?.name ?? pool[0]?.name ?? 'a hero'}`,
          records_as: 'choose_leader{hero: "<printed hero name>"}',
        },
      };
    }
    case 'choose_starting_location': {
      const starts = s.tiles.filter((t) => t.start != null && !s.bases.some((b) => b.coord === `${t.c},${t.r}`));
      return {
        ...base,
        instruction: `SETUP — ${forPlayerId} chooses an unoccupied numbered starting location (free base + Leader go there). Available: ${starts.map((t) => `@${t.start} ${tileLabel(t.c, t.r)} (${t.c},${t.r})`).join(', ')}. Send choose_starting_location{location: "@<n>"}.`,
        human_response: {
          ask: `${forPlayerId}, which numbered start do you take? (${starts.map((t) => `@${t.start}, ${tileLabel(t.c, t.r)}`).join(', ')})`,
          example: `@${starts[0]?.start ?? 1}`,
          records_as: 'choose_starting_location{location: "@<n>"}',
        },
      };
    }
    case 'report_draw': {
      const p = byId(s, forPlayerId);
      if (p.digital === true) {
        return { ...base, instruction: `${forPlayerId} draws a battle strategy card (${pend.reason === 'leader-grant' ? 'Leader grant' : pend.reason === 'hero-reward' ? 'hero reward' : 'Research purchase'}). Send resolve_report{} — the server deals and shows it privately.` };
      }
      return {
        ...base,
        instruction: `${forPlayerId} physically drew a battle strategy card (${pend.reason === 'leader-grant' ? 'Leader grant' : pend.reason === 'hero-reward' ? 'hero reward' : 'Research purchase'}). ASK which card they drew by its PRINTED name, then send report_draw{card: "<name>"}. Do NOT invent it.`,
        human_response: {
          ask: `${forPlayerId}, which battle strategy card did you draw? Report the name printed on it.`,
          example: 'I drew "Retreat"',
          records_as: 'report_draw{card: "<printed name>"}',
        },
      };
    }
    case 'upkeep_reallocate_cores':
      return { ...base, instruction: `UPKEEP — ${forPlayerId} may reallocate owned Cores among their platforms regardless of distance. Send reallocate_cores{allocations:{<unitId>: true|false}} — or keep the current layout (get_legal_moves shows it).` };
    case 'access_request':
      return {
        ...base,
        instruction: `ACCESS — ${pend.buyerId} asks ${forPlayerId} whether ${pend.collectorId} may collect at ${pend.coord} for this purchase. Granting lets the collector stay beside your combat units until upkeep protected from YOUR passive removal (no immunity otherwise). ASK ${forPlayerId} and send respond_access_request{grant: true|false}.`,
        human_response: {
          ask: `${forPlayerId}, do you allow ${pend.buyerId}'s collector at ${pend.coord}?`,
          example: 'yes, just this once' ,
          records_as: 'respond_access_request{grant: true|false}',
        },
      };
    case 'second_purchase':
      return { ...base, instruction: `${forPlayerId} may make a SECOND ${pend.action} purchase (separate collectors; get_legal_moves lists the options) or decline it. Send a ${pend.action} move or skip_action.` };
    case 'smyth_reward': {
      const p = byId(s, forPlayerId);
      const pool = researchFreePool(s, p);
      return { ...base, instruction: `Smyth's reward: ${forPlayerId} takes one unresearched ${p.species} technology FREE (cost and prerequisite waived). Pool: ${pool.join(', ')}. Send research{kind:"tech", tech:"<name>", payment:[]}.` };
    }
    case 'elara_spell':
      return { ...base, instruction: `Elara's spell (start of the Move/Battle action, before movement): ${forPlayerId} may spend 5 mana to deal 4 damage to all non-allied units in an ADJACENT space — not a battle. Send cast_elara_spell{target_location:"c,r"} or skip it with cast_elara_spell{skip:true}; moving afterwards is optional.` };
    case 'treaty_response': {
      return { ...base, instruction: `TREATY — ${pend.proposerId} offers ${forPlayerId}. ASK ${forPlayerId} whether they accept, then send respond_treaty{accept: true|false}.` };
    }
    case 'treaty_break_decision': {
      const mine = s.treaties.filter((t) => t.type !== 'culture-treaty' && t.partners.includes(forPlayerId));
      return { ...base, instruction: `END OF ROUND (treaty break window, §5.6) — ${forPlayerId} may break any of their breakable treaties now (${mine.map((t) => t.type).join(', ') || 'none'}) with break_treaty{treaty_type, partner}, or keep them all with skip_action.`, };
    }
    case 'battle_commit':
      return {
        ...base,
        instruction: `BATTLE — ${forPlayerId} secretly commits ONE eligible battle strategy card OR no card (passing is allowed with cards in hand). Ask them PRIVATELY; never announce the card before every participant has committed. Send commit_battle_card{card: "<printed name>" | null}.`,
        human_response: {
          ask: `${forPlayerId}, which battle card do you commit — privately? (or none)`,
          example: 'I commit "Counter" — keep this between us',
          records_as: 'commit_battle_card{card: "<printed name>" | null}',
        },
      };
    case 'counter_target':
      return { ...base, instruction: `${forPlayerId}'s Counter resolves: choose which UNRESOLVED card it cancels (get_legal_moves lists them by name + player). Send choose_counter_target{card:"<printed name>"}.` };
    case 'extra_selection':
      return { ...base, instruction: `${forPlayerId}'s Extra resolves: choose 0–2 additional battle cards, selected and revealed together; they form the next batch. Send select_extra_cards{cards:[...]}.` };
    case 'initiative_tie':
      return { ...base, instruction: `Allied initiative tie: allied units of different owners have the same initiative. The owners may agree the order; otherwise ${forPlayerId} (earliest in first-player order) decides. ASK ${forPlayerId} which of ${pend.tieGroup.join(', ')} acts next, then send choose_initiative_order{unit:"<ref>"}.` };
    case 'battle_defense':
      return { ...base, instruction: `DEFENSE — ${forPlayerId} decides on a defense (Decoy / Mana Shield amount / Cleric save / none — declining one keeps later ones). get_legal_moves lists the eligible options; send resolve_battle_defense{defense:{...}}.` };
    case 'retreat':
      if (pend.viaCard) {
        return { ...base, instruction: `RETREAT CARD — ${forPlayerId}'s Retreat card withdraws ALL their mobile units from the battle. ASK ${forPlayerId} which eligible adjacent tile they go to (get_legal_moves lists them — allied-unit spaces first; never the attack's origin), then send choose_retreat{destination:"<tile>"}.` };
      }
      return { ...base, instruction: `RETREAT — ${forPlayerId} may withdraw ALL their mobile units to one adjacent destination (allied-unit space first; never the attack's origin). get_legal_moves lists destinations; send choose_retreat{destination:"c,r"} or stay with {stay:true}.` };
    case 'rally_selection':
      return { ...base, instruction: `RALLY — ${forPlayerId} chooses which of their eligible mobile units on adjacent tiles enter the battle. Send select_rally_units{units:[...]}.` };
    case 'choose_milestone_hero': {
      const p = byId(s, forPlayerId);
      const pool = s.heroPool.length;
      return { ...base, instruction: `MILESTONE — ${forPlayerId} claims a hero from the shared pool (${pool} left; species restrictions apply). ASK which hero, then send choose_milestone_hero{hero:"<printed name>"}.` };
    }
    case 'overlay_choice':
      return { ...base, instruction: `Two Economy heroes share a tile: ${forPlayerId} picks which overlay is active (locked until one moves). Send resolve_overlay_choice{hero:"<printed name>"}.` };
    case 'dowser_collector':
      return { ...base, instruction: `${forPlayerId} placed Dowser Wren Calloway and takes free collectors with a Core in each, picked one at a time — ${(s.pending as { remaining?: number }).remaining ?? 1} left to pick. ASK which type for this one (get_legal_moves lists those under their cap), then send choose_dowser_collector{collector:"<printed name>"}.` };
    case 'place_reserved_hero':
      return { ...base, instruction: `${forPlayerId} places a reserved hero at an owned base (its benefits begin). Send place_reserved_hero{hero:"<name>", coord:"c,r"}.` };
    case 'choose_spy':
      return {
        ...base,
        instruction: `SPY — ${forPlayerId} privately chooses which of THEIR heroes carries the ${pend.source === 'illusionist' ? 'Illusionist' : 'Infiltrator'} spy. This is SECRET: get the answer privately and never reveal it to other seats. Send choose_spy{hero:"<printed name>"}.`,
        human_response: {
          ask: `${forPlayerId}, which of YOUR heroes secretly carries the spy? (never shown to opponents)`,
          example: 'My spy is Wren — do not repeat that',
          records_as: 'choose_spy{hero:"<printed name>"}',
        },
      };
  }
}

function researchFreePool(s: NGGState, p: import('./types.js').PlayerState): string[] {
  // Every unresearched technology of the species: Smyth waives cost AND
  // prerequisite (§6.5), so the Extra cards (ruling #86) are in the pool too.
  return researchForSpecies(p.species ?? 'wizard').filter((r) => !p.research.includes(r.id)).map((r) => r.name);
}

export const neitherGutsNorGears = new NeitherGutsNorGearsGame();
export default neitherGutsNorGears;
