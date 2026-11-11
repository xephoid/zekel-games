// Word Debauchee glue. The table is a game-drawn screen (WdScreen); this
// module gives the table its title and status line, the setup choices, the
// forms for the engine's fill-in moves, and the end-of-game stat. The view is
// the engine's (@zekel/word-debauchee views.ts) and every rule stays there.
// Plan: docs/implementation-plan.md §20; look: docs/design/word-debauchee/.

import type { GameReferenceResponse } from '@zekel/wire-types';
import type { FormField, GlueInput, GlueModule, LegalMove, MoveForm, SetupAnswers, SetupField, SetupSeat, TablePlan } from '@zekel/glue-kit';
import { answerText, asArr, asStr, isObj } from '@zekel/glue-kit';
import { WdScreen } from './WdScreen.js';
import { GAME, isTemplate, readTable, typeOf } from './read.js';

const TITLE = 'Word Debauchee';
const YES_NO = [{ value: 'no', label: 'Off' }, { value: 'yes', label: 'On' }];

function plan(input: GlueInput): TablePlan | null {
  const table = readTable(input.view);
  if (!table) return null;
  const r = table.round;
  const status = table.phase === 'game_over' ? 'Game over' : r ? `Round ${r.number} of ${r.of}` : 'Setting up';
  const statusShort = r ? `R${r.number}` : undefined;
  // The screen draws everything; the table draws a plan's zones even beside
  // a screen, so the plan gives none.
  return { board: [], bench: [], side: [], palette: {}, title: TITLE, status, statusShort };
}

/** The questions for the engine's fill-in moves, for the numbered menu: the
 *  screen sends its own, but a move picked from the menu must still ask. */
function formFor(move: LegalMove, input: GlueInput): MoveForm | null {
  if (!isTemplate(move)) return null;
  const type = typeOf(move);
  const text = (key: string, label: string, help: string, submitLabel: string): MoveForm => ({
    title: label, help, template: move, editableKeys: [key], submitLabel,
    fields: [{ kind: 'text', key, label, maxLength: 60 }],
    build(answers) { const t = answerText(answers, key); return t ? { ...move.move, [key]: t } : null; },
  });
  if (type === 'answer_clue') return text('text', 'Your answer', move.description ?? '', 'Say this');
  if (type === 'burn') return text('word', 'The word said out loud', move.description ?? '', "It can't score");
  if (type === 'check') return text('word', 'The word on the table', move.description ?? '', 'Check!');
  if (type === 'play_clues') {
    const ref = input.reference?.referenceData;
    const cards = isObj(ref) ? asArr(ref['clue_cards']).filter(isObj) : [];
    const fields: FormField[] = [{
      kind: 'multi', key: 'cards', label: 'Three clue cards', pick: 3,
      options: cards.map((c) => ({ value: asStr(c['id']), label: asStr(c['name']), hint: `${asStr(c['kind'])} clue: ${asStr(c['asks'])}` })),
    }];
    return {
      title: 'Play any three clues', help: move.description, fields, template: move, editableKeys: ['cards'], submitLabel: 'Play these three',
      build(answers) { const v = answers['cards']; return Array.isArray(v) && v.length === 3 ? { ...move.move, cards: v } : null; },
    };
  }
  return null;
}

const seatLabel = (s: SetupSeat) => (s.host ? 'You' : s.kind === 'ai' ? `The AI in seat ${s.position + 1}` : `The friend in seat ${s.position + 1}`);

export const wordDebaucheeGlue: GlueModule = {
  gameId: GAME,
  title: TITLE,
  plan,
  Screen: WdScreen,
  // One column that already fits a phone; the table's phone layout keeps the
  // top bar and moves the rest into its menu.
  phone: true,

  yourTurnLabel(input) {
    const table = readTable(input.view);
    const r = table?.round;
    if (!table || !r) return null;
    if (r.debauchee === input.playerId) {
      return table.phase === 'choose_word' ? 'Your turn · keep a word'
        : table.phase === 'play_clues' ? 'Your turn · play three clues'
        : table.phase === 'answer_clues' ? 'Your turn · answer a clue'
        : table.phase === 'reveal' ? 'Your turn · lay down a letter' : 'Your turn';
    }
    return 'Your turn · one tile';
  },

  litParts: () => [],
  moveForSelect: () => null,
  movesForSelect: () => [],
  formFor,
  resolveReportMove: () => null,

  /**
   * The rules' own choices, asked on the setup page. The server always holds
   * the tiles and letters come down every lap (plan §20). Who goes first is
   * asked here only when every seat is known; with a friend still to join the
   * table asks, through the engine's setup phase.
   */
  setupFields(_reference: GameReferenceResponse, seats?: SetupSeat[]): SetupField[] {
    const fields: SetupField[] = [];
    const known = !!seats && !seats.some((s) => s.kind === 'human' && !s.host);
    const ai = !!seats?.some((s) => s.kind === 'ai');
    if (ai) {
      fields.push({
        key: 'house', kind: 'choice', label: 'The House',
        help: 'The AI is the debauchee every round and the people play as one team against it.',
        options: YES_NO,
      });
    }
    if (known && seats) {
      fields.push({
        key: 'first', kind: 'choice', label: 'Who goes first',
        help: 'Whoever most recently got away with something is the first debauchee.',
        options: seats.map((s) => ({ value: `p${s.position + 1}`, label: seatLabel(s) })),
      });
    }
    fields.push(
      { key: 'bribe', kind: 'choice', label: 'Bribe', help: 'On Reveal!, a guesser may take a clue instead of a letter. It costs the same as a letter.', options: YES_NO },
      { key: 'openHand', kind: 'choice', label: 'Open hand', help: 'Kinder for new players. The debauchee picks any three clues, at least one a number clue.', options: YES_NO },
    );
    return fields;
  },

  setupInPlay(field: SetupField, answers: SetupAnswers): boolean {
    // Under The House the house is the debauchee every round.
    return !(field.key === 'first' && answers['house'] === 'yes');
  },

  setupOptions(answers: SetupAnswers): Record<string, unknown> {
    const on = (k: string) => answers[k] === 'yes';
    const house = on('house');
    const first = typeof answers['first'] === 'string' && answers['first'] ? answers['first'] : null;
    return {
      tiles: 'server',
      timer: 'laps',
      ...(on('bribe') ? { bribe: true } : {}),
      ...(on('openHand') ? { openHand: true } : {}),
      ...(house ? { house: true } : first ? { firstDebauchee: first } : {}),
    };
  },

  endStat(input) {
    const table = readTable(input.view);
    if (!table) return null;
    return { label: 'Points', values: Object.fromEntries(table.seats.map((s) => [s.id, String(s.score)])) };
  },
};

export default wordDebaucheeGlue;
