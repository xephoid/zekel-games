// route(view, seat) -> Screen. Pure and total: the same view gives the same
// screen, a reconnect lands on the right screen with nothing replayed, and
// nothing in the client decides what to show next. docs/design/SCREEN-ROUTING.md
// is the table this follows, in its order: a pending wins, then the battle,
// then the phase, then the resolving action card.
//
// The seat's legal moves are a third input for one case the view does not
// name: whose unit is up on the activation ladder, and whether it is a hero
// carrying a spy. They are the engine's own statement of it.

import type { LegalMove } from '@zekel/glue-kit';
import { moveType, type NggView } from './read.js';

export type ScreenKey =
  // setup
  | 'setup-table' | 'setup-faction' | 'setup-draft' | 'setup-start'
  // round
  | 'planning' | 'core-reallocation' | 'upkeep' | 'culture' | 'end-of-round'
  // build
  | 'build' | 'second-purchase' | 'access-request'
  // research
  | 'research' | 'smyth-reward'
  // move and battle
  | 'move-battle' | 'elara-spell'
  | 'battle-commit' | 'shared-tactics' | 'counter-target' | 'battle-extra' | 'battle-cards'
  | 'battle-activation' | 'infiltrator' | 'battle-defense' | 'retreat' | 'rally'
  // diplomacy and heroes
  | 'treaty-response' | 'treaty-break'
  | 'hero-claim' | 'reserved-hero' | 'overlay-choice' | 'spy-assign' | 'dowser-collector'
  // draws
  | 'report-draw'
  // an action whose effects are over: a treaty offer, or ending the turn
  | 'action-done'
  // the table with nothing to decide, and the end
  | 'table' | 'game-over';

/**
 * Four ways a seat can stand towards the state (SCREEN-ROUTING §5):
 * - decide: the pending or the action is mine, controls live;
 * - answer: an interrupt owed by me out of turn, drawn above whatever I was doing;
 * - watch: someone else owes the decision; same surface, controls dead;
 * - none: nothing is being decided that this screen shows.
 */
export type Perspective = 'decide' | 'answer' | 'watch' | 'none';

export interface Route {
  screen: ScreenKey;
  perspective: Perspective;
  /** the seat that owes the decision, when one does */
  owner: string | null;
  /** true for the three screens that take over a seat out of turn */
  interrupt: boolean;
}

const PENDING_SCREENS: Record<string, ScreenKey> = {
  choose_faction: 'setup-faction',
  choose_leader: 'setup-draft',
  choose_starting_location: 'setup-start',
  report_draw: 'report-draw',
  upkeep_reallocate_cores: 'core-reallocation',
  access_request: 'access-request',
  second_purchase: 'second-purchase',
  smyth_reward: 'smyth-reward',
  elara_spell: 'elara-spell',
  treaty_response: 'treaty-response',
  treaty_break_decision: 'treaty-break',
  battle_commit: 'battle-commit',
  counter_target: 'counter-target',
  extra_selection: 'battle-extra',
  // A mode on the activation ladder: the tied units become pickable.
  initiative_tie: 'battle-activation',
  battle_defense: 'battle-defense',
  retreat: 'retreat',
  rally_selection: 'rally',
  choose_milestone_hero: 'hero-claim',
  overlay_choice: 'overlay-choice',
  dowser_collector: 'dowser-collector',
  place_reserved_hero: 'reserved-hero',
  choose_spy: 'spy-assign',
};

/** The pendings that arrive uninvited, on a seat whose turn it is not. */
export const INTERRUPTS = new Set(['access_request', 'treaty_response', 'battle_defense']);

const ACTION_SCREENS: Record<string, ScreenKey> = {
  build: 'build',
  research: 'research',
  move_battle: 'move-battle',
};

const PHASE_SCREENS: Record<string, ScreenKey> = {
  setup_factions: 'setup-table',
  planning: 'planning',
  upkeep: 'upkeep',
  culture: 'culture',
  end_of_round: 'end-of-round',
  game_over: 'game-over',
};

/** A move that is a hero carrying a spy acting on it (Detection is gone, #121). */
function isSpyMove(m: LegalMove): boolean {
  const t = moveType(m.move);
  const action = m.move['action'];
  return t === 'battle_activation' && typeof action === 'object' && action !== null
    && ((action as Record<string, unknown>)['kind'] === 'spy_attack' || (action as Record<string, unknown>)['kind'] === 'invisible');
}

export function route(v: NggView, me: string | null, legalMoves: LegalMove[] = []): Route {
  if (v.phase === 'game_over' || v.result) {
    return { screen: 'game-over', perspective: 'none', owner: null, interrupt: false };
  }

  // 3a. A pending wins.
  const p = v.pending;
  if (p) {
    let screen = PENDING_SCREENS[p.kind] ?? 'table';
    const mine = me !== null && p.for === me;
    // Shared Tactics is the commit screen with a second hand on it.
    if (screen === 'battle-commit' && mine && Object.values(v.sharedHands).some((h) => h.length > 0)) screen = 'shared-tactics';
    const interrupt = INTERRUPTS.has(p.kind);
    return {
      screen,
      perspective: mine ? (interrupt ? 'answer' : 'decide') : 'watch',
      owner: p.for,
      interrupt: interrupt && mine,
    };
  }

  // 3b. Then the battle.
  const b = v.battle;
  if (b && b.phase !== 'done') {
    const byPhase: Record<string, ScreenKey> = {
      commit: 'battle-commit', cards: 'battle-cards', activations: 'battle-activation', retreat: 'retreat',
    };
    let screen = byPhase[b.phase] ?? 'battle-cards';
    const acting = legalMoves.some((m) => moveType(m.move) === 'battle_activation');
    if (screen === 'battle-activation' && acting && legalMoves.some(isSpyMove)) screen = 'infiltrator';
    return { screen, perspective: acting ? 'decide' : 'watch', owner: v.activePlayerId, interrupt: false };
  }

  // 3c/3d. Then the phase, and inside an action the card that resolves.
  if (v.phase === 'action' && v.activeAction) {
    const screen = v.activeAction.finished ? 'action-done' : ACTION_SCREENS[v.activeAction.cardKind] ?? 'table';
    const mine = me !== null && v.activeAction.owner === me;
    return { screen, perspective: mine ? 'decide' : 'watch', owner: v.activeAction.owner, interrupt: false };
  }
  const screen = PHASE_SCREENS[v.phase] ?? 'table';
  if (screen === 'planning') {
    const mine = me !== null && v.activePlayerId === me;
    return { screen, perspective: mine ? 'decide' : 'watch', owner: v.activePlayerId, interrupt: false };
  }
  if (screen === 'setup-table') {
    const mine = legalMoves.some((m) => moveType(m.move) === 'assign_setup_choices');
    return { screen, perspective: mine ? 'decide' : 'watch', owner: v.activePlayerId, interrupt: false };
  }
  return { screen, perspective: 'none', owner: null, interrupt: false };
}

/** What a waiting seat is told another seat is doing: the pending's kind in
 *  words, which is state the client holds, never a paraphrase of the rules. */
export const WAITING_ON: Record<string, string> = {
  choose_faction: 'choosing a faction',
  choose_leader: 'choosing a Leader',
  choose_starting_location: 'choosing a starting location',
  report_draw: 'drawing a battle card',
  upkeep_reallocate_cores: 'reallocating Cores',
  access_request: 'answering an access request',
  second_purchase: 'deciding on a second purchase',
  smyth_reward: "taking Smyth's reward",
  elara_spell: "deciding on Elara's spell",
  treaty_response: 'answering a treaty offer',
  treaty_break_decision: 'deciding whether to break a treaty',
  battle_commit: 'committing a battle card',
  counter_target: "choosing the Counter's target",
  extra_selection: 'choosing Extra cards',
  initiative_tie: 'ordering tied units',
  battle_defense: 'deciding a defense',
  retreat: 'deciding whether to retreat',
  rally_selection: 'choosing Rally units',
  choose_milestone_hero: 'claiming a hero',
  overlay_choice: 'choosing the Economy overlay',
  place_reserved_hero: 'placing a reserved hero',
  choose_spy: 'assigning a spy',
};
