// Physical setup as ordered steps (Game.getPhysicalSetup), and the session
// context an orchestrated client gets instead of the LLM-driven guidance
// (Game.getSessionContext). The steps are the numbered list from
// getSessionStartGuidance, with this session's real numbers filled in: one
// physical action per step, short enough to read aloud. Fractured Fist has
// nothing to REPORT at setup (the loadout is a create_session option), so
// every step is an action.

import type { PhysicalSetupStep, SessionContext, SessionState } from '@zekel/game-kit';
import { seatDisplayName } from '@zekel/game-kit';
import { STARTING_DECK, SUPPLY_RESOURCES, getCard } from './cards.js';
import { count, listJoin, possessive } from './narration.js';
import type { FFState } from './types.js';

export function physicalSetupSteps(state: SessionState<FFState>): PhysicalSetupStep[] {
  const gs = state.gameState;
  const steps: PhysicalSetupStep[] = [];
  const focus = STARTING_DECK.filter((c) => c === 'focus').length;
  const missteps = STARTING_DECK.filter((c) => c === 'misstep').length;
  // Only a PHYSICAL human lays out cards; the server holds the AI's cards and
  // a digital human's.
  const physical = gs.playerOrder.filter((pid) => gs.players[pid]?.kind === 'opaque');
  for (const pid of physical) {
    const p = gs.players[pid]!;
    const name = seatDisplayName(state.players, pid);
    const who = physical.length > 1 ? `${name}: ` : '';
    const techniques = Object.keys(p.supply).filter((id) => getCard(id).type === 'TECHNIQUE');
    const perTechnique = p.supply[techniques[0] ?? ''] ?? 0;
    const perResource = p.supply[SUPPLY_RESOURCES[0]!] ?? 0;
    const add = (text: string) => steps.push({ kind: 'action', text: who + text, for_player_id: pid });
    add(`Find the technique cards for this game: ${listJoin(techniques.map((id) => getCard(id).name))}.`);
    add(`Make your supply: ${count(perTechnique, 'copy', 'copies')} of each of those techniques, one pile per card.`);
    add(`Add piles of Focus, Momentum and Mastery to your supply, ${perResource} of each.`);
    add(`Build your starting deck from ${focus} Focus cards and ${missteps} Misstep cards.`);
    add('Shuffle your starting deck.');
    add(`Draw ${count(p.startingHandSize, 'card')} for your opening hand.`);
    add(`Set your stamina to ${p.maxStamina}.`);
  }
  for (const pid of gs.playerOrder) {
    if (state.players.find((s) => s.player_id === pid)?.kind !== 'ai') continue;
    const name = seatDisplayName(state.players, pid);
    steps.push({
      kind: 'action',
      text: `Set ${possessive(name)} stamina to ${gs.players[pid]!.maxStamina}. The server keeps ${possessive(name)} cards, so do not lay them out.`,
      for_player_id: pid,
    });
  }
  if (physical.length > 0) {
    steps.push({ kind: 'action', text: 'Keep spare Misstep cards within reach: some cards put Missteps into a discard pile.' });
  }
  const first = gs.playerOrder[0];
  if (first !== undefined) {
    steps.push({ kind: 'action', text: `${seatDisplayName(state.players, first)} takes the first turn.` });
  }
  return steps;
}

// What an interpreting LLM needs at session start, with none of the turn-loop
// directions in getSessionStartGuidance (its §3's reporting rules and its
// tool-calling advice belong to an LLM that drives the loop).
export function sessionContext(table?: 'physical' | 'digital'): SessionContext {
  return {
    persona:
      'You are the bookkeeper and the AI opponent for a game of Fractured Fist played with real cards. ' +
      (table === 'digital'
        ? 'The server deals and tracks the player\'s hand and shows it only to them. '
        : 'The player shuffles their own deck and holds their own hand; the server never sees it, so trust what they say they played. ') +
      'Never coach the player, suggest plays, or ask what is in their hand. Never invent a card\'s cost or effect.',
    rules_context:
      'Two-player deck-building fight: reduce your opponent\'s stamina to 0. Each round, each player takes one turn ' +
      '(Technique phase: play technique cards, 1 action to start; Channel phase: play resource cards for spirit and buy ' +
      'cards; then discard the hand and draw a new one), and then both players\' queued damage and defense resolve at ' +
      'once in the strike. The full rules, by section, come from get_rules; every card\'s cost and effect is in its ' +
      'reference data.',
  };
}
