// Every move a seat may take right now, with a stable move_id and a
// plain-words description. Fill-in moves (a judgment answer, a declared
// word, a burned word) carry a template.

import { CLUES, clue, type ClueId } from './data/clues.js';
import { LETTERS } from './data/tiles.js';
import type { WordDebaucheeMove } from './engine/moves.js';
import { currentGuesser, isGuesser, nameOf, unrevealedLetters } from './engine/helpers.js';
import type { WordDebaucheeState } from './types.js';

export interface LegalMoveEntry {
  move_id: string;
  description: string;
  move: WordDebaucheeMove;
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

export function getLegalMoves(state: WordDebaucheeState, playerId: string): LegalMoveEntry[] {
  const out: LegalMoveEntry[] = [];
  const add = (move_id: string, description: string, move: WordDebaucheeMove): void => {
    out.push({ move_id, description, move });
  };
  if (state.phase === 'setup') {
    if (state.seats.find((s) => s.id === playerId)?.ai === false) {
      for (const s of state.seats) add(`choose_first_debauchee:${s.id}`, `${s.name} is the first debauchee`, { type: 'choose_first_debauchee', player: s.id });
    }
    return out;
  }
  if (state.phase === 'game_over' || !state.round) return out;
  const r = state.round;
  const me = playerId === r.debauchee;
  const server = state.settings.tiles === 'server';

  switch (state.phase) {
    case 'choose_word':
      if (me) for (const w of r.dealtWords) add(`choose_word:${w}`, `Keep ${w}`, { type: 'choose_word', word: w });
      return out;

    case 'play_clues': {
      if (!me) return out;
      if (state.settings.openHand) {
        // Any three of the 22 cards with a number clue among them: 1,320 combinations, so a template.
        const names = (kind: 'number' | 'word') => CLUES.filter((c) => c.kind === kind).map((c) => c.name).join(', ');
        add('play_clues', `Play any three different clue cards, at least one a number clue. Number clues: ${names('number')}. Word clues: ${names('word')}.`, {
          type: 'play_clues',
          cards: ['<a number clue>', '<any clue>', '<any clue>'] as unknown as ClueId[],
        });
        return out;
      }
      const seen = new Set<string>();
      for (const combo of combinations([...r.hand.keys()], 3)) {
        const cards = combo.map((i) => r.hand[i]!) as ClueId[];
        const key = [...cards].sort().join('+');
        if (seen.has(key)) continue;
        seen.add(key);
        const kinds = new Set(cards.map((c) => clue(c).kind));
        if (!kinds.has('number') || !kinds.has('word')) continue;
        const buried = r.hand.filter((_, i) => !combo.includes(i))[0]!;
        add(`play_clues:${key}`, `Play ${cards.map((c) => clue(c).name).join(', ')} (bury ${clue(buried).name})`, { type: 'play_clues', cards });
      }
      return out;
    }

    case 'answer_clues':
      if (me) {
        for (const p of r.played) {
          if (p.answer !== null) continue;
          const c = clue(p.card);
          add(`answer_clue:${p.card}:card`, `${c.name}: answer with the card's own answer`, { type: 'answer_clue', card: p.card });
          add(`answer_clue:${p.card}:own`, `${c.name}: answer in your own words (${c.prompt})`, { type: 'answer_clue', card: p.card, text: '<your answer>' });
        }
      }
      // A bribed clue is answered mid-round, while the guessers are still talking.
      if (r.bribed.length) add('burn', 'A guesser said a word aloud: burn it for this round', { type: 'burn', word: '<word>' });
      return out;

    case 'reveal':
      if (me) for (const l of [...unrevealedLetters(r).keys()].sort()) add(`reveal:${l}`, `Reveal ${l}`, { type: 'reveal', letter: l });
      return out;

    case 'build': {
      if (isGuesser(state, playerId)) {
        const bribes = (): void => {
          if (!state.settings.bribe) return;
          add('call_reveal:number', `Reveal! — but take a number clue instead of a letter (Bribe; counts as a reveal)`, { type: 'call_reveal', clue: 'number' });
          add('call_reveal:word', `Reveal! — but take a word clue instead of a letter (Bribe; counts as a reveal)`, { type: 'call_reveal', clue: 'word' });
        };
        if (!server) {
          add('check', 'Check! — say the word on the table', { type: 'check', word: '<word>' });
          add('call_reveal', `Reveal! — ask ${nameOf(state, r.debauchee)} for a letter instead of more time`, { type: 'call_reveal' });
          bribes();
        } else if (currentGuesser(state) === playerId) {
          for (const l of LETTERS) {
            if ((r.pool[l] ?? 0) <= 0) continue;
            add(`place:${l}:new`, `Place ${l} in a new row`, { type: 'place', letter: l });
            r.buildArea.forEach((text, row) => {
              add(`place:${l}:${row}`, `Add ${l} to the end of ${text} (set index to put it elsewhere, check to call "Check!")`, { type: 'place', letter: l, row });
            });
          }
          r.buildArea.forEach((text, row) => {
            add(`move:${row}`, `Move a tile of ${text} (row ${row}: set index, and to_row/to_index or leave to_row out to return it)`, { type: 'move', row, index: 0 });
          });
          add('call_reveal', `Reveal! — ask ${nameOf(state, r.debauchee)} for a letter instead of acting`, { type: 'call_reveal' });
          bribes();
        }
        if (server && r.lastTouched && r.lastTouched.by === playerId) {
          const row = r.lastTouched.row;
          add(`check:${row}`, `Check! ${r.buildArea[row]}`, { type: 'check', row });
        }
      }
      add('burn', 'A guesser said a word aloud: burn it for this round', { type: 'burn', word: '<word>' });
      if (!server || state.settings.timer === 'sand') {
        add('timer_out', state.settings.timer === 'sand' ? 'The sand has run out' : 'The turn has come back round to the first guesser', { type: 'timer_out' });
      }
      return out;
    }
  }
  return out;
}
