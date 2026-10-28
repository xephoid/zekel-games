// What the client should do next. The shape mirrors @zekel/game-kit's
// NextStep; index.ts hands it through. `facts` are plain game facts in
// speakable words, no tool or move names. Never the secret word.

import { clue } from './data/clues.js';
import { activeSeatId, currentGuesser, nameOf, turnsPerReveal } from './engine/helpers.js';
import { CLUES_PLAYED, scoreLine } from './engine/round.js';
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

const AI_DOING: Record<string, string> = {
  choose_word: 'is choosing a word from three cards',
  play_clues: 'is choosing three clue cards to play',
  answer_clues: 'is answering the clues played',
  reveal: 'owes a reveal and is choosing a letter',
  build: 'is on turn to place a tile, move one, or call "Reveal!"',
};

function aiStep(state: WordDebaucheeState, active: string, status: 'ai_to_move' | 'human_to_move'): NextStepShape {
  const r = state.round!;
  const notes = r.played.map((p) => `${clue(p.card).name}: ${p.answer ?? '(not yet answered)'}`);
  if (r.revealed.length) notes.push(`Revealed so far: ${r.revealed.join(' ')} (${r.revealed.length}).`);
  if (state.settings.tiles === 'server' && r.buildArea.length) notes.push(`Build area: ${r.buildArea.join(' / ')}.`);
  return {
    status,
    active_player_id: active,
    instruction: `${nameOf(state, active)} is an AI seat and ${AI_DOING[state.phase] ?? 'is acting'}. Let the server play it (run_ai_turn), then relay what it did. ${NO_HINTS}`,
    facts: { phase: state.phase, turn_owner_id: active, progress: { current: r.number, total: state.settings.rounds, of: 'rounds' }, notes },
  };
}

export function describeNextStep(state: WordDebaucheeState): NextStepShape {
  if (state.phase === 'setup') {
    const active = activeSeatId(state);
    return {
      status: 'human_to_move',
      active_player_id: active,
      instruction: `Setup: ask the table who most recently got away with something; that player is the first debauchee. Any person at the table may report it; do NOT pick for them. Seats: ${state.seats.map((s) => `${s.name} (${s.id})`).join(', ')}.`,
      human_response: { ask: 'who is the first debauchee', example: 'Ann goes first', records_as: 'the first debauchee, by seat id or name' },
      facts: { phase: 'Setup', turn_owner_id: active, notes: ['The next debauchee is always the player to the left.'] },
    };
  }
  if (state.phase === 'game_over' || !state.round) {
    const winners = state.winners ?? [];
    const house = state.settings.house;
    const verdict = house
      ? winners.includes(house) && winners.length === 1 ? 'The house wins.' : winners.includes(house) ? 'The table and the house tie.' : 'The table beats the house.'
      : winners.length === 1 ? `${nameOf(state, winners[0]!)} wins.` : `${winners.map((w) => nameOf(state, w)).join(' and ')} share the win.`;
    return {
      status: 'game_over',
      active_player_id: null,
      instruction: `The game is over. ${verdict} Final ${scoreLine(state).replace(/^Scores/, 'scores')}`,
    };
  }
  const r = state.round;
  const active = activeSeatId(state);
  const ai = state.seats.find((s) => s.id === active)?.ai ?? false;
  const status = ai ? 'ai_to_move' : 'human_to_move';
  const deb = nameOf(state, r.debauchee);
  if (ai) return aiStep(state, active, status);
  const progress = { current: r.number, total: state.settings.rounds, of: 'rounds' };
  // The first three played were the debauchee's; anything after was bribed.
  const clueLines = r.played.map((p, i) => `${clue(p.card).name}: ${p.answer ?? '(not yet answered)'}${i >= CLUES_PLAYED ? ' (bribed)' : ''}`);
  const bribes = r.bribed.length ? ` Bribed clues: ${r.bribed.length}, each counting as a reveal.` : '';
  const revealed = (r.revealed.length ? `Revealed so far: ${r.revealed.join(' ')} (${r.revealed.length}).` : 'Nothing revealed yet.') + bribes;
  const server = state.settings.tiles === 'server';
  const bribeTalk = state.settings.bribe ? ' Under Bribe, a guesser who calls "Reveal!" may take the top card of either clue deck instead of a letter; it counts as a reveal.' : '';

  switch (state.phase) {
    case 'choose_word':
      return {
        status, active_player_id: active,
        instruction: `${deb} is the debauchee and has three word cards (in their private view only). Ask which one they keep. ${NO_HINTS}`,
        human_response: { ask: 'which of the three words to keep', example: 'I keep the first one', records_as: 'the chosen word', private: true },
        facts: { phase: 'Choosing the word', turn_owner_id: active, progress, notes: ['The other two cards go under the deck.'] },
      };
    case 'play_clues':
      if (state.settings.openHand) {
        return {
          status, active_player_id: active,
          instruction: `Open hand: ${deb} chooses any three different clue cards from the whole set, at least one of them a number clue, and lays them face up. Ask which three (the card names are in get_legal_moves). The server answers the number and fact clues from the card. ${NO_HINTS}`,
          human_response: { ask: 'which three clue cards to play', example: 'Letters, Syllables and Category', records_as: 'the three cards played', private: true },
          facts: { phase: 'Playing clues', turn_owner_id: active, progress, notes: ['Open hand: no deal; any three cards, one a number clue.'] },
        };
      }
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
          instruction: `${who}'s turn to act: place one tile from the pool into the build area, move one tile, or call "Reveal!". A tile that completes a word may be checked in the same action. Guessers talk freely but never say a word they want spelled (any word said aloud is burned: report it) and never suggest a letter.${bribeTalk} ${NO_HINTS}`,
          human_response: { ask: 'one action: a tile to place (which letter, which row), a tile to move, or "Reveal!"', example: 'I put a D on the end of GLA and check', records_as: 'one tile placed or moved, with a check if called, or a reveal called' },
          facts: { phase: 'Building', turn_owner_id: active, progress, notes },
        };
      }
      const timer = state.settings.timer === 'sand' ? 'When the sand runs out, report it' : 'When the turn comes back round to the first guesser, report it';
      return {
        status, active_player_id: active,
        instruction: `The guessers build with the table's tiles, one tile per turn, talking but never saying a word they want spelled. Report only: a "Check!" with the word on the table (the server answers yes or no), a "Reveal!" called by a guesser on their turn, any word a guesser says aloud (it is burned), and the timer. ${timer}: ${deb} then reveals a letter.${bribeTalk} ${NO_HINTS}`,
        human_response: { ask: 'what happened at the table: a check, a reveal called, a word said aloud, or the timer', example: 'Check: GLAD', records_as: 'the check, reveal, burned word or timer' },
        facts: { phase: 'Building', turn_owner_id: active, progress, notes },
      };
    }
    default:
      return { status, active_player_id: active, instruction: 'Continue.', facts: { phase: state.phase, progress } };
  }
}
