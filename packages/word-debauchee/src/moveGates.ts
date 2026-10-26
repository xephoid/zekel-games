// Move gates (rules teaching): the live status of every move type for one
// seat, with the reason when a rule blocks it, rendered against live state so
// the "why" never drifts from the engine. Must agree with getLegalMoves
// (available ⇔ at least one legal instance); moveGates.test.ts locks it with
// game-kit's checkGateConsistency. Typed to match MoveGateStatus structurally.

import { MOVE_TYPES, type MoveType } from './engine/moves.js';
import { currentGuesser, isGuesser, nameOf } from './engine/helpers.js';
import { getLegalMoves } from './legalMoves.js';
import type { WordDebaucheeState } from './types.js';

export interface MoveGate {
  move_type: string;
  status: 'available' | 'gated' | 'routine';
  reason?: string;
  rules_section?: string;
}

const SECTION: Record<MoveType, string> = {
  choose_first_debauchee: 'setup',
  choose_word: 'pick-a-word',
  play_clues: 'clues',
  answer_clue: 'clues',
  place: 'build',
  move: 'build',
  check: 'checking',
  call_reveal: 'build',
  burn: 'talking',
  timer_out: 'reveal',
  reveal: 'reveal',
};

export function moveGates(state: WordDebaucheeState, playerId: string): MoveGate[] {
  const legal = new Set(getLegalMoves(state, playerId).map((m) => m.move.type));
  const r = state.round;
  const server = state.settings.tiles === 'server';
  const me = state.seats.find((s) => s.id === playerId);
  const out: MoveGate[] = [];
  for (const type of MOVE_TYPES) {
    if (legal.has(type)) {
      out.push({ move_type: type, status: 'available', rules_section: SECTION[type] });
      continue;
    }
    const gate = (status: 'gated' | 'routine', reason: string): void => {
      out.push({ move_type: type, status, reason, rules_section: SECTION[type] });
    };
    if (state.phase === 'game_over') {
      gate('routine', 'the game is over');
      continue;
    }
    if (state.phase === 'setup') {
      if (type === 'choose_first_debauchee') gate('gated', 'a person at the table says who is the first debauchee; an AI seat may not');
      else gate('routine', 'first the table says who is the first debauchee');
      continue;
    }
    const deb = r ? nameOf(state, r.debauchee) : 'the debauchee';
    const guesser = r ? isGuesser(state, playerId) : false;
    switch (type) {
      case 'choose_first_debauchee':
        gate('routine', 'the first debauchee has been chosen');
        break;
      case 'choose_word':
        gate('routine', state.phase === 'choose_word' ? `${deb} chooses the word` : 'the word has been chosen this round');
        break;
      case 'play_clues':
        gate('routine', state.phase === 'play_clues' ? `${deb} plays the clues` : state.phase === 'choose_word' ? 'the word comes first' : 'the clues have been played this round');
        break;
      case 'answer_clue':
        gate('routine', state.phase === 'answer_clues' ? `${deb} answers the clues` : 'no clue is waiting for an answer');
        break;
      case 'place':
      case 'move':
        if (state.phase !== 'build') gate('routine', state.phase === 'reveal' ? `a reveal is owed first: ${deb} lays down a letter` : 'the guessers are not building yet');
        else if (!server) gate('gated', 'the table holds its own tiles; the server tracks none');
        else if (!guesser) gate('routine', 'the debauchee only listens');
        else if (type === 'move' && r!.buildArea.length === 0) gate('routine', 'the build area is empty');
        else gate('routine', `it is ${nameOf(state, currentGuesser(state))}'s turn`);
        break;
      case 'check':
        if (state.phase !== 'build') gate('routine', state.phase === 'reveal' ? 'a reveal is owed first' : 'the guessers are not building yet');
        else if (!guesser) gate('routine', 'the debauchee only answers checks');
        else gate('gated', 'only the player whose tile just completed a word may check it, and only before the next tile');
        break;
      case 'call_reveal':
        if (state.phase !== 'build') gate('routine', state.phase === 'reveal' ? 'a reveal is already owed' : 'the guessers are not building yet');
        else if (!guesser) gate('routine', 'the debauchee only listens');
        else gate('routine', `it is ${nameOf(state, currentGuesser(state))}'s turn`);
        break;
      case 'burn':
        gate('routine', 'words burn only while the guessers are building');
        break;
      case 'timer_out':
        if (state.phase !== 'build') gate('routine', state.phase === 'reveal' ? 'a reveal is already owed' : 'the timer is not running');
        else gate('gated', 'the server counts the laps in this game; a reveal comes by itself when the turn comes back round');
        break;
      case 'reveal':
        if (state.phase !== 'reveal') gate('routine', 'no reveal is owed right now');
        else gate('routine', `${deb} reveals the letter`);
        break;
    }
  }
  void me;
  return out;
}
