// What the client should do next. The shape mirrors @zekel/game-kit's
// NextStep; index.ts hands it through. `facts` are plain game facts in
// speakable words, no tool or move names. Never the secret word.

import { clue } from './data/clues.js';
import { activeSeatId, currentGuesser, nameOf, turnsPerReveal } from './engine/helpers.js';
import type { WordDebaucheeState } from './types.js';

export interface HumanResponseShape {
  ask: string;
  example: string;
  records_as: string;
  private?: boolean;
}

export interface NextStepShape {
  status: 'game_over' | 'ai_to_move' | 'human_to_move';
  active_player_id: string | null;
  instruction: string;
  human_response?: HumanResponseShape;
  facts?: {
    phase?: string;
    turn_owner_id?: string;
    reason?: string;
    progress?: { current: number; total: number; of?: string };
    notes?: string[];
  };
}

const NO_HINTS = 'Never say, spell or hint at the secret word, and never suggest a letter or a word to a guesser.';

export function describeNextStep(state: WordDebaucheeState): NextStepShape {
  if (state.phase === 'game_over' || !state.round) {
    const winners = state.winners ?? [];
    return {
      status: 'game_over',
      active_player_id: null,
      instruction: `The game is over. ${winners.length === 1 ? `${nameOf(state, winners[0]!)} wins.` : `${winners.map((w) => nameOf(state, w)).join(' and ')} share the win.`} Final scores: ${state.seats.map((s) => `${s.name} ${state.scores[s.id]}`).join(', ')}.`,
    };
  }
  const r = state.round;
  const active = activeSeatId(state);
  const ai = state.seats.find((s) => s.id === active)?.ai ?? false;
  const status = ai ? 'ai_to_move' : 'human_to_move';
  const deb = nameOf(state, r.debauchee);
  const progress = { current: r.number, total: state.settings.rounds, of: 'rounds' };
  const clueLines = r.played.map((p) => `${clue(p.card).name}: ${p.answer ?? '(not yet answered)'}`);
  const revealed = r.revealed.length ? `Revealed so far: ${r.revealed.join(' ')} (${r.revealed.length}).` : 'Nothing revealed yet.';
  const server = state.settings.tiles === 'server';

  switch (state.phase) {
    case 'choose_word':
      return {
        status, active_player_id: active,
        instruction: `${deb} is the debauchee and has three word cards (in their private view only). Ask which one they keep. ${NO_HINTS}`,
        human_response: { ask: 'which of the three words to keep', example: 'I keep the first one', records_as: 'the chosen word', private: true },
        facts: { phase: 'Choosing the word', turn_owner_id: active, progress, notes: ['The other two cards go under the deck.'] },
      };
    case 'play_clues':
      return {
        status, active_player_id: active,
        instruction: `${deb} holds two number clues and two word clues (private view) and plays three of them face up. Ask which three; the fourth is buried. The server answers the number and fact clues from the card. ${NO_HINTS}`,
        human_response: { ask: 'which three clue cards to play', example: 'Letters, Type and Opposite', records_as: 'the three cards played', private: true },
        facts: { phase: 'Playing clues', turn_owner_id: active, progress, notes: ['Three of four, so at least one number clue and one word clue are played.'] },
      };
    case 'answer_clues': {
      const pending = r.played.filter((p) => p.answer === null).map((p) => clue(p.card));
      return {
        status, active_player_id: active,
        instruction: `${deb} answers ${pending.map((c) => c.name).join(' and ')} aloud, truthfully, in their own words (${pending.map((c) => c.prompt).join('; ')}), or takes the card's printed answer. Record each answer. ${NO_HINTS}`,
        human_response: { ask: `the answer to ${pending[0]!.name}`, example: pending[0]!.id === 'opposite' ? 'The opposite is "sad"' : 'Snappy', records_as: 'the clue answer, word for word' },
        facts: { phase: 'Answering clues', turn_owner_id: active, progress, notes: clueLines },
      };
    }
    case 'reveal':
      return {
        status, active_player_id: active,
        instruction: `A reveal is owed. ${deb} chooses one letter of the secret word still to reveal (listed in their private view) and lays its tile face up in a row in front of them. Ask which letter. Positions are never shown. ${NO_HINTS}`,
        human_response: { ask: 'which letter to reveal', example: 'I reveal a P', records_as: 'the letter revealed', private: true },
        facts: { phase: 'Reveal', turn_owner_id: active, progress, notes: [revealed, ...clueLines] },
      };
    case 'build': {
      const notes = [...clueLines, revealed];
      if (r.burned.length) notes.push(`Burned this round: ${r.burned.join(', ')}.`);
      if (server) {
        notes.push(r.buildArea.length ? `Build area: ${r.buildArea.join(' / ')}.` : 'The build area is empty.');
        if (state.settings.timer === 'laps') notes.push(`${Math.max(0, turnsPerReveal(state) - r.turnsSinceReveal)} turn(s) until the next reveal.`);
        const who = nameOf(state, currentGuesser(state));
        return {
          status, active_player_id: active,
          instruction: `${who}'s turn to act: place one tile from the pool into the build area, move one tile, or call "Reveal!". A tile that completes a word may be checked in the same action. Guessers talk freely but never say a word they want spelled (any word said aloud is burned: report it) and never suggest a letter. ${NO_HINTS}`,
          human_response: { ask: 'one action: a tile to place (which letter, which row), a tile to move, or "Reveal!"', example: 'I put a D on the end of GLA and check', records_as: 'one tile placed or moved, with a check if called, or a reveal called' },
          facts: { phase: 'Building', turn_owner_id: active, progress, notes },
        };
      }
      const timer = state.settings.timer === 'sand' ? 'When the sand runs out, report it' : 'When the turn comes back round to the first guesser, report it';
      return {
        status, active_player_id: active,
        instruction: `The guessers build with the table's tiles, one tile per turn, talking but never saying a word they want spelled. Report only: a "Check!" with the word on the table (the server answers yes or no), a "Reveal!" called by a guesser on their turn, any word a guesser says aloud (it is burned), and the timer. ${timer}: ${deb} then reveals a letter. ${NO_HINTS}`,
        human_response: { ask: 'what happened at the table: a check, a reveal called, a word said aloud, or the timer', example: 'Check: GLAD', records_as: 'the check, reveal, burned word or timer' },
        facts: { phase: 'Building', turn_owner_id: active, progress, notes },
      };
    }
    default:
      return { status, active_player_id: active, instruction: 'Continue.', facts: { phase: state.phase, progress } };
  }
}
