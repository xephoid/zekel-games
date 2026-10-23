// Glue: engine state/moves -> the common comparison shape. This file is
// ALLOWED to know the engine's types (unlike rule content, which cites the
// rulebook); it is also, per the brief, the likeliest home of its own bugs —
// keep it a dumb field-by-field copy with no interpretation.

import type { CNMove, CNState } from '../../types.js';
import type { VerifyEvent } from '@zekel/dev/verify/exec/types';

/** Cybernoir's common comparison shape. Every field is server-known (both
 * seats tracked). Set-valued zones are SORTED so diffs are order-independent;
 * the jail track is the exception — slot order IS the physical fact under
 * test. */
export interface CybernoirVerifyState {
  turn: number;
  phase: string;
  /** Which ROLE is on the clock (stable across seat ids). */
  active: 'detective' | 'hacker';
  pendingType: string | null;
  detective: {
    ap: number;
    locationHand: string[];
    locationDeckCount: number;
    locationDiscard: string[];
    board: string[];
    poiDeck: string[];
    informantsFacedown: string[];
    informantsRevealed: string[];
    /** Slot 1 (Booked) .. slot 3 (Release Pending); each a sorted stack. */
    jail: [string[], string[], string[]];
    midGameGuessSpent: boolean;
    upkeepPaid: boolean;
  };
  hacker: {
    ap: number;
    hand: string[];
    contactsDeckCount: number;
    contactsDiscard: string[];
    evidenceWeapon: boolean;
    evidenceWitnesses: string[];
    /** Completed motive sets, each a sorted trio. */
    evidenceMotiveSets: string[][];
    truthfulCluesGiven: string[];
    negativeClueCount: number;
    overclockUsed: boolean;
  };
  overclockDrawsOwed: number;
  endgameTriggered: boolean;
  winners: string[];
}

function sorted(xs: readonly string[]): string[] {
  return [...xs].sort();
}

export function detectiveSeat(state: CNState): string {
  const seat = state.playerOrder[0];
  if (seat === undefined) throw new Error('cybernoir state has no seats');
  return seat;
}

export function hackerSeat(state: CNState): string {
  const seat = state.playerOrder[1];
  if (seat === undefined) throw new Error('cybernoir state has no second seat');
  return seat;
}

export function roleOf(state: CNState, playerId: string): 'detective' | 'hacker' {
  return playerId === detectiveSeat(state) ? 'detective' : 'hacker';
}

export function projectCybernoir(state: CNState): CybernoirVerifyState {
  const det = state.detective;
  const hak = state.hacker;
  const detPlayer = state.players[detectiveSeat(state)];
  const hakPlayer = state.players[hackerSeat(state)];
  if (!detPlayer || !hakPlayer) throw new Error('cybernoir seats missing from players map');
  if (hakPlayer.kind !== 'tracked') throw new Error('verify driver requires a tracked hacker seat');

  const motiveSets = [
    hak.evidence.motive_set_1,
    hak.evidence.motive_set_2,
    hak.evidence.motive_set_3,
    hak.evidence.motive_set_4,
  ]
    .filter((set) => set.length > 0)
    .map(sorted);

  const truthful: string[] = [];
  if (hak.truthful_clues.borough) truthful.push('borough');
  if (hak.truthful_clues.population) truthful.push('population');
  if (hak.truthful_clues.affiliation) truthful.push('affiliation');

  return {
    turn: state.turn,
    phase: state.phase,
    active: roleOf(state, state.activePlayerId),
    pendingType: state.pending?.type ?? null,
    detective: {
      ap: detPlayer.ap,
      locationHand: sorted(det.location_hand),
      locationDeckCount: det.location_deck.length,
      locationDiscard: sorted(det.location_discard),
      board: sorted(det.board),
      poiDeck: sorted(det.poi_deck),
      informantsFacedown: sorted(det.informants.filter((i) => !i.revealed).map((i) => i.person_id)),
      informantsRevealed: sorted(det.informants.filter((i) => i.revealed).map((i) => i.person_id)),
      jail: [sorted(det.jail[0] ?? []), sorted(det.jail[1] ?? []), sorted(det.jail[2] ?? [])],
      midGameGuessSpent: det.mid_game_guess_spent,
      upkeepPaid: det.upkeep_paid,
    },
    hacker: {
      ap: hakPlayer.ap,
      hand: sorted(hakPlayer.hand),
      contactsDeckCount: hak.contacts_deck.length,
      contactsDiscard: sorted(hak.contacts_discard),
      evidenceWeapon: hak.evidence.weapon,
      evidenceWitnesses: sorted(hak.evidence.witnesses),
      evidenceMotiveSets: motiveSets.sort((a, b) => (a.join(',') < b.join(',') ? -1 : 1)),
      truthfulCluesGiven: truthful,
      negativeClueCount: hak.negative_clues.length,
      overclockUsed: hakPlayer.overclock_used,
    },
    overclockDrawsOwed: state.overclock_draws_owed,
    endgameTriggered: state.endgame_triggered,
    winners: sorted(state.winners),
  };
}

export function toEvent(state: CNState, playerId: string, move: CNMove, moveIndex: number): VerifyEvent {
  return {
    moveIndex,
    actor: roleOf(state, playerId),
    moveType: move.type,
    move: move as unknown as Record<string, unknown>,
  };
}
