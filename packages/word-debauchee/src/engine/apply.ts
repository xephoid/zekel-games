// The move dispatcher: copy the state, apply one move, return the new state
// and a plain-words summary for the table. The summary never carries the
// secret word, the dealt words or the clue hand before the round ends.

import { CLUES, clue, clueByName, type ClueCard, type ClueId, type ClueKind } from '../data/clues.js';
import { cardFor, isSynonymOf } from '../data/deck.js';
import type { Card } from '../data/wordCard.js';
import type { Round, WordDebaucheeState } from '../types.js';
import { notYourTurn, refuse, RuleError } from './errors.js';
import { clone, currentGuesser, isGuesser, listNames, nameOf, normaliseWord, round, turnsPerReveal, unrevealedLetters } from './helpers.js';
import type { WordDebaucheeMove } from './moves.js';
import { CLUES_PLAYED, dealClues, endRound, resolveSeat, setFirstDebauchee } from './round.js';

export interface ApplyResult {
  newState: WordDebaucheeState;
  summary: string;
}

export function applyMove(prev: WordDebaucheeState, playerId: string, move: WordDebaucheeMove): ApplyResult {
  if (prev.phase === 'game_over') throw new RuleError('GAME_OVER', 'The game is over.');
  if (!prev.seats.some((s) => s.id === playerId)) notYourTurn(`"${playerId}" has no seat in this game.`);
  const state = clone(prev);
  state.turn++;
  const lines: string[] = [];
  if (state.phase === 'setup' && move.type !== 'choose_first_debauchee') {
    refuse('First the table says who is the first debauchee (whoever most recently got away with something).');
  }
  switch (move.type) {
    case 'choose_first_debauchee':
      chooseFirstDebauchee(state, playerId, move.player, lines);
      break;
    case 'choose_word':
      chooseWord(state, playerId, move, lines);
      break;
    case 'play_clues':
      playClues(state, playerId, move.cards, lines);
      break;
    case 'answer_clue':
      answerClue(state, playerId, move.card, move.text, lines);
      break;
    case 'place':
      place(state, playerId, move, lines);
      break;
    case 'move':
      moveTile(state, playerId, move, lines);
      break;
    case 'check':
      check(state, playerId, move, lines);
      break;
    case 'call_reveal':
      callReveal(state, playerId, move, lines);
      break;
    case 'burn':
      burn(state, playerId, move.word, lines);
      break;
    case 'timer_out':
      timerOut(state, lines);
      break;
    case 'reveal':
      reveal(state, playerId, move.letter, move.row, lines);
      break;
    default:
      refuse(`Unknown move type "${String((move as { type: unknown }).type)}".`);
  }
  return { newState: state, summary: lines.join(' ') };
}

// --- setup ------------------------------------------------------------------

function chooseFirstDebauchee(state: WordDebaucheeState, playerId: string, player: string, lines: string[]): void {
  if (state.phase !== 'setup') refuse('The first debauchee has already been chosen.');
  if (state.seats.find((x) => x.id === playerId)?.ai) notYourTurn('A person at the table says who is the first debauchee.');
  const first = resolveSeat(state.seats, player);
  if (!first) refuse(`"${player}" is not at the table. Seats: ${state.seats.map((x) => `${x.name} (${x.id})`).join(', ')}.`);
  setFirstDebauchee(state, first.id);
  lines.push(`${first.name} most recently got away with something and is the first debauchee. ${first.name} draws three word cards.`);
}

// --- the debauchee's half ---------------------------------------------------

function requireDebauchee(state: WordDebaucheeState, playerId: string, doing: string): void {
  const r = round(state);
  if (r.debauchee !== playerId) notYourTurn(`Only the debauchee (${nameOf(state, r.debauchee)}) ${doing}.`);
}

function secretCard(state: WordDebaucheeState): Card {
  const w = round(state).word;
  if (!w) refuse('No word has been chosen yet.');
  return cardFor(w)!;
}

function chooseWord(state: WordDebaucheeState, playerId: string, m: { word?: string; card?: number }, lines: string[]): void {
  if (state.phase !== 'choose_word') refuse('The word has already been chosen this round.');
  requireDebauchee(state, playerId, 'chooses the word');
  const r = round(state);
  let w: string;
  if (m.word !== undefined && String(m.word).trim() !== '') {
    w = normaliseWord(String(m.word));
    if (!r.dealtWords.includes(w)) refuse(`Choose one of the three cards dealt.`);
  } else {
    const n = Number(m.card);
    if (!Number.isInteger(n) || n < 1 || n > r.dealtWords.length) refuse(`Say the word, or which of the three cards (1, 2 or 3).`);
    w = r.dealtWords[n - 1]!;
  }
  const position = ['first', 'second', 'third'][r.dealtWords.indexOf(w)]!;
  r.word = w;
  state.wordDeck.push(...r.dealtWords.filter((x) => x !== w));
  dealClues(state);
  state.phase = 'play_clues';
  lines.push(
    `${nameOf(state, playerId)} keeps the ${position} of the three cards; the other two go under the deck. ${nameOf(state, playerId)} now ` +
      (state.settings.openHand ? 'chooses any three clue cards from the whole set, at least one a number clue.' : 'draws two number clues and two word clues and plays three.'),
  );
}

function playClues(state: WordDebaucheeState, playerId: string, cards: ClueId[], lines: string[]): void {
  if (state.phase !== 'play_clues') refuse(state.phase === 'choose_word' ? 'Choose the word first.' : 'The clues have been played this round.');
  requireDebauchee(state, playerId, 'plays the clues');
  const r = round(state);
  if (!Array.isArray(cards) || cards.length !== CLUES_PLAYED) {
    refuse(state.settings.openHand ? `Play exactly ${CLUES_PLAYED} clue cards from the whole set.` : `Play exactly ${CLUES_PLAYED} of the ${r.hand.length} cards in hand.`);
  }
  cards = cards.map((c) => clueByName(String(c))?.id ?? c);
  for (const id of cards) if (!CLUES.some((c) => c.id === id)) refuse(`"${String(id)}" is not a clue card. The cards: ${CLUES.map((c) => c.name).join(', ')}.`);
  if (state.settings.openHand) {
    // Open hand: any three different cards from the whole set, at least one a number clue.
    if (new Set(cards).size !== cards.length) refuse('Play three different clue cards.');
    if (!cards.some((id) => clue(id).kind === 'number')) refuse('At least one of the three must be a number clue.');
    for (const id of cards) {
      const deck = clue(id).kind === 'number' ? state.numberDeck : state.wordClueDeck;
      const at = deck.indexOf(id);
      if (at < 0) refuse(`No ${clue(id).name} card is left in its deck.`);
      deck.splice(at, 1);
    }
  } else {
    const left = [...r.hand];
    for (const id of cards) {
      const at = left.indexOf(id);
      if (at < 0) refuse(`"${String(id)}" is not in hand (or not twice). In hand: ${r.hand.join(', ')}.`);
      left.splice(at, 1);
    }
    const kinds = new Set(cards.map((id) => clue(id).kind));
    if (!kinds.has('number') || !kinds.has('word')) refuse('At least one number clue and one word clue must be among the three.');
    // The fourth card goes under its deck now; the played three follow at the round's end.
    const buried = left[0]!;
    (clue(buried).kind === 'number' ? state.numberDeck : state.wordClueDeck).push(buried);
  }
  const card = secretCard(state);
  const debauchee = state.seats.find((s) => s.id === playerId)!;
  r.played = cards.map((id) => {
    const c = clue(id);
    return { card: id, answer: c.judgment && !debauchee.ai ? null : c.answer(card) };
  });
  r.hand = cards;
  const answered = r.played.filter((p) => p.answer !== null);
  const pending = r.played.filter((p) => p.answer === null);
  lines.push(`${debauchee.name} lays down ${listNames(cards.map((id) => clue(id).name))}.`);
  if (answered.length) lines.push(answered.map((p) => spoken(clue(p.card), p.answer!)).join(' '));
  if (pending.length) {
    state.phase = 'answer_clues';
    lines.push(`${debauchee.name} still has to answer ${listNames(pending.map((p) => clue(p.card).name))}, in their own words.`);
  } else {
    beginBuild(state, lines);
  }
}

function spoken(c: ClueCard, answer: string | number): string {
  return `${c.name}: ${answer}.`;
}

function answerClue(state: WordDebaucheeState, playerId: string, cardId: ClueId, text: string | undefined, lines: string[]): void {
  if (state.phase !== 'answer_clues') refuse('No clue is waiting for an answer.');
  requireDebauchee(state, playerId, 'answers the clues');
  const r = round(state);
  cardId = clueByName(String(cardId))?.id ?? cardId;
  const played = r.played.find((p) => p.card === cardId && p.answer === null);
  if (!played) refuse(`${String(cardId)} is not waiting for an answer. Waiting: ${r.played.filter((p) => p.answer === null).map((p) => p.card).join(', ')}.`);
  const c = clue(cardId);
  const card = secretCard(state);
  let answer: string | number;
  if (text === undefined || text.trim() === '') {
    answer = c.answer(card);
  } else {
    answer = text.trim();
    const lower = answer.toLowerCase();
    if (lower === card.word.toLowerCase()) refuse('That is the word itself. Nothing else may be said about the word.');
    if (cardId === 'rhymes_with' && isSynonymOf(card, lower)) refuse(`"${answer}" is on the synonym list; a rhyme must not be. Say another rhyme, or "nothing rhymes".`);
    if (cardId === 'register' && !['formal', 'everyday', 'slang'].includes(lower)) refuse('Register is formal, everyday or slang.');
  }
  played.answer = answer;
  lines.push(spoken(c, answer));
  if (r.played.every((p) => p.answer !== null)) beginBuild(state, lines);
}

/** The guessers build: at the start of the round, and again after every reveal
 *  or bribed clue (the timer flips, the lap starts over). */
function beginBuild(state: WordDebaucheeState, lines: string[]): void {
  state.phase = 'build';
  const r = round(state);
  r.turnsSinceReveal = 0;
  lines.push(timerLine(state) + (state.settings.tiles === 'server' ? ` ${nameOf(state, currentGuesser(state))} to act.` : ' The guessers build.'));
}

function timerLine(state: WordDebaucheeState): string {
  return state.settings.timer === 'sand' ? 'The timer flips.' : 'The lap begins.';
}

// --- the guessers' half -----------------------------------------------------

function requireBuild(state: WordDebaucheeState): void {
  if (state.phase === 'reveal') refuse(`A reveal is owed first: ${nameOf(state, round(state).debauchee)} lays down a letter.`);
  if (state.phase !== 'build') refuse('The guessers are not building yet.');
}

function requireServerTiles(state: WordDebaucheeState): void {
  if (state.settings.tiles !== 'server') refuse('The table holds its own tiles in this game; report only checks, reveals and burned words.');
}

function requireTurn(state: WordDebaucheeState, playerId: string): void {
  if (!isGuesser(state, playerId)) notYourTurn(`${nameOf(state, playerId)} is the debauchee this round and only listens.`);
  if (state.settings.tiles === 'server' && currentGuesser(state) !== playerId) {
    notYourTurn(`It is ${nameOf(state, currentGuesser(state))}'s turn.`);
  }
}

/** After a guesser's turn: next guesser, and under the laps timer a reveal
 *  when the turn comes back round. */
function endTurn(state: WordDebaucheeState, lines: string[]): void {
  const r = round(state);
  if (state.settings.tiles !== 'server') return;
  r.turnIndex = (r.turnIndex + 1) % r.guessers.length;
  r.turnsSinceReveal++;
  if (state.settings.timer === 'laps' && r.turnsSinceReveal >= turnsPerReveal(state)) {
    owedReveal(state, lines, r.guessers.length === 1 ? `${state.settings.tilesPerReveal} tiles are down` : 'The turn has come back round');
  } else {
    lines.push(`${nameOf(state, currentGuesser(state))} to act.`);
  }
}

function owedReveal(state: WordDebaucheeState, lines: string[], why: string): void {
  state.phase = 'reveal';
  lines.push(`${why}: ${nameOf(state, round(state).debauchee)} reveals a letter.`);
}

/** A build-area row by its index, or by the letters it reads (as the summaries say
 *  it: "adds X to E"), so a player acting on the words need not count rows. */
export function resolveRow(state: WordDebaucheeState, row: number | string): number {
  const r = round(state);
  if (typeof row === 'string' && !/^\d+$/.test(row.trim())) {
    const text = row.trim().toUpperCase();
    const hits = r.buildArea.map((t, i) => (t === text ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 1) return hits[0]!;
    if (hits.length === 0) refuse(r.buildArea.length ? `No row reads ${text}. Rows: ${r.buildArea.map((t, i) => `${i}: ${t}`).join(', ')}.` : 'The build area is empty.');
    refuse(`${hits.length} rows read ${text} (rows ${hits.join(', ')}); say the row number.`);
  }
  const n = typeof row === 'string' ? Number(row) : row;
  if (!Number.isInteger(n) || n < 0 || n >= r.buildArea.length) {
    refuse(r.buildArea.length ? `Row ${String(row)} does not exist; rows are 0 to ${r.buildArea.length - 1}.` : 'The build area is empty.');
  }
  return n;
}

/** A row for a tile going in: by number, by the letters it reads now, or by the
 *  letters it will read with the tile in ("adds O to R, making RO": either R or RO). */
export function resolveRowForTile(state: WordDebaucheeState, given: number | string, letter: string, index: number | undefined): number {
  if (typeof given !== 'string' || /^\d+$/.test(given.trim())) return resolveRow(state, given);
  const r = round(state);
  const text = given.trim().toUpperCase();
  const reads = r.buildArea.map((t, i) => (t === text ? i : -1)).filter((i) => i >= 0);
  if (reads.length === 1) return reads[0]!;
  if (reads.length > 1) refuse(`${reads.length} rows read ${text} (rows ${reads.join(', ')}); say the row number.`);
  const makes = r.buildArea
    .map((t, i) => {
      const at = index ?? t.length;
      return at >= 0 && at <= t.length && t.slice(0, at) + letter + t.slice(at) === text ? i : -1;
    })
    .filter((i) => i >= 0);
  if (makes.length === 1) return makes[0]!;
  if (makes.length > 1) refuse(`${makes.length} rows would make ${text} (rows ${makes.join(', ')}); say the row number.`);
  refuse(r.buildArea.length ? `No row reads ${text}, and none makes ${text} with ${letter}. Rows: ${r.buildArea.map((t, i) => `${i}: ${t}`).join(', ')}.` : 'The build area is empty.');
}

function rowAt(state: WordDebaucheeState, row: number): string {
  return round(state).buildArea[resolveRow(state, row)]!;
}

function singleLetter(letter: string): string {
  const l = String(letter).trim().toUpperCase();
  if (!/^[A-Z]$/.test(l)) refuse(`"${letter}" is not a letter.`);
  return l;
}

function place(state: WordDebaucheeState, playerId: string, given: { letter: string; row?: number | string; index?: number; check?: boolean }, lines: string[]): void {
  requireBuild(state);
  requireServerTiles(state);
  requireTurn(state, playerId);
  const r = round(state);
  const letter = singleLetter(given.letter);
  const m = { ...given, letter, row: given.row === undefined ? undefined : resolveRowForTile(state, given.row, letter, given.index) };
  if ((r.pool[letter] ?? 0) <= 0) refuse(`No ${letter} is left in the pool.`);
  r.pool[letter]!--;
  let row: number;
  if (m.row === undefined) {
    r.buildArea.push(letter);
    row = r.buildArea.length - 1;
    lines.push(`${nameOf(state, playerId)} places ${letter} in a new row.`);
  } else {
    const text = rowAt(state, m.row);
    const index = m.index ?? text.length;
    if (!Number.isInteger(index) || index < 0 || index > text.length) refuse(`Index ${index} is off the end of ${text}.`);
    r.buildArea[m.row] = text.slice(0, index) + letter + text.slice(index);
    row = m.row;
    lines.push(`${nameOf(state, playerId)} adds ${letter} to ${text}, making ${r.buildArea[row]}.`);
  }
  r.lastTouched = { by: playerId, row };
  if (m.check) {
    if (checkRow(state, playerId, row, lines)) return;
  }
  endTurn(state, lines);
}

function moveTile(state: WordDebaucheeState, playerId: string, given: { row: number | string; index: number; to_row?: number | 'new' | string; to_index?: number; check?: boolean }, lines: string[]): void {
  requireBuild(state);
  requireServerTiles(state);
  requireTurn(state, playerId);
  const r = round(state);
  const fromRow = resolveRow(state, given.row);
  const moving = r.buildArea[fromRow]?.[given.index] ?? '';
  const toRow: number | 'new' | undefined = given.to_row === undefined ? undefined : given.to_row === 'new' ? 'new' : resolveRowForTile(state, given.to_row, moving, given.to_index);
  const m = { ...given, row: fromRow, to_row: toRow };
  const text = rowAt(state, m.row);
  if (!Number.isInteger(m.index) || m.index < 0 || m.index >= text.length) refuse(`${text} has no tile at index ${m.index}.`);
  const letter = text[m.index]!;
  const rest = text.slice(0, m.index) + text.slice(m.index + 1);
  const who = nameOf(state, playerId);
  if (m.to_row === undefined) {
    setRow(r.buildArea, m.row, rest);
    r.pool[letter] = (r.pool[letter] ?? 0) + 1;
    r.lastTouched = null;
    lines.push(`${who} returns ${letter} from ${text} to the pool${rest ? `, leaving ${rest}` : ''}.`);
    endTurn(state, lines);
    return;
  }
  let row: number;
  if (m.to_row === 'new') {
    setRow(r.buildArea, m.row, rest);
    r.buildArea.push(letter);
    row = r.buildArea.length - 1;
    lines.push(`${who} moves ${letter} from ${text} to a new row${rest ? `, leaving ${rest}` : ''}.`);
  } else {
    const target = rowAt(state, m.to_row);
    if (m.to_row === m.row) {
      const index = m.to_index ?? rest.length;
      if (!Number.isInteger(index) || index < 0 || index > rest.length) refuse(`Index ${index} is off the end of ${rest}.`);
      r.buildArea[m.row] = rest.slice(0, index) + letter + rest.slice(index);
      row = m.row;
      lines.push(`${who} moves the ${ordinal(m.index + 1)} tile of ${text} to position ${index + 1} of the same row, making ${r.buildArea[row]}.`);
    } else {
      const index = m.to_index ?? target.length;
      if (!Number.isInteger(index) || index < 0 || index > target.length) refuse(`Index ${index} is off the end of ${target}.`);
      r.buildArea[m.to_row] = target.slice(0, index) + letter + target.slice(index);
      lines.push(`${who} moves ${letter} from ${text} to ${target}, making ${r.buildArea[m.to_row]}${rest ? `; ${rest} remains` : ''}.`);
      // Dropping an emptied row shifts later indices; resolve the target first.
      const before = m.to_row;
      setRow(r.buildArea, m.row, rest);
      row = rest === '' && before > m.row ? before - 1 : before;
    }
  }
  r.lastTouched = { by: playerId, row };
  if (m.check) {
    if (checkRow(state, playerId, row, lines)) return;
  }
  endTurn(state, lines);
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function setRow(area: string[], row: number, text: string): void {
  if (text === '') area.splice(row, 1);
  else area[row] = text;
}

/** "Check!" on a row (`server` tiles) or a declared word (`table` tiles).
 *  Returns true when the round ended on a "yes". */
function check(state: WordDebaucheeState, playerId: string, m: { word?: string; row?: number | string }, lines: string[]): void {
  requireBuild(state);
  if (!isGuesser(state, playerId)) notYourTurn(`${nameOf(state, playerId)} is the debauchee and only answers checks.`);
  const r = round(state);
  if (state.settings.tiles === 'server') {
    // A row by number, or by its letters; the word itself names the row too.
    const given = m.row ?? m.word;
    if (given === undefined) refuse('Say which row to check.');
    const row = resolveRow(state, given);
    if (!r.lastTouched || r.lastTouched.by !== playerId || r.lastTouched.row !== row) {
      refuse('Only the player whose tile just completed a word may check it, and only before the next tile.');
    }
    checkRow(state, playerId, row, lines);
  } else {
    if (!m.word) refuse('Say which word is on the table.');
    const word = normaliseWord(m.word);
    if (!/^[A-Z]+$/.test(word)) refuse(`"${m.word}" is not a word of letters.`);
    checkWord(state, playerId, word, lines);
  }
}

function checkRow(state: WordDebaucheeState, playerId: string, row: number, lines: string[]): boolean {
  return checkWord(state, playerId, round(state).buildArea[row]!, lines);
}

function checkWord(state: WordDebaucheeState, playerId: string, word: string, lines: string[]): boolean {
  const r = round(state);
  const lower = word.toLowerCase();
  if (r.burned.includes(lower)) refuse(`${word} was said aloud this round, so it is burned and cannot score.`);
  const card = secretCard(state);
  const yes = isSynonymOf(card, lower);
  r.checks.push({ by: playerId, word, yes });
  r.lastTouched = null;
  lines.push(`${nameOf(state, playerId)}: "Check! ${word}." ${nameOf(state, r.debauchee)}: "${yes ? 'Yes' : 'No'}."`);
  if (yes) {
    lines.push(...endRound(state, 'cracked', lower));
    return true;
  }
  return false;
}

/** "number", "word", "number clue", "a word clue" → the deck. */
export function clueKindFrom(text: unknown): ClueKind {
  const t = String(text).trim().toLowerCase();
  if (/^(a |the )?number( clue)?s?$/.test(t)) return 'number';
  if (/^(a |the )?word( clue)?s?$/.test(t)) return 'word';
  refuse(`"${String(text)}" is not a clue deck: say "number" or "word".`);
}

function callReveal(state: WordDebaucheeState, playerId: string, m: { clue?: string }, lines: string[]): void {
  requireBuild(state);
  requireTurn(state, playerId);
  const r = round(state);
  const who = nameOf(state, playerId);
  if (m.clue !== undefined) {
    // Bribe: the caller draws the top card of a clue deck instead of getting a letter.
    if (!state.settings.bribe) refuse('Bribe is not on in this game: a "Reveal!" gets a letter, not a clue.');
    const kind = clueKindFrom(m.clue);
    const deck = kind === 'number' ? state.numberDeck : state.wordClueDeck;
    if (deck.length === 0) refuse(`The ${kind} clue deck is empty.`);
    if (state.settings.tiles === 'server') r.turnIndex = (r.turnIndex + 1) % r.guessers.length;
    r.lastTouched = null;
    const id = deck.shift()!;
    r.bribed.push(id);
    r.hand.push(id);
    const c = clue(id);
    const debauchee = state.seats.find((s) => s.id === r.debauchee)!;
    const answer = c.judgment && !debauchee.ai ? null : c.answer(secretCard(state));
    r.played.push({ card: id, answer });
    const count = r.revealed.length + r.bribed.length;
    lines.push(`${who}: "Reveal!" and takes a ${kind} clue instead of a letter: ${c.name}. It counts as a reveal (${count} so far).`);
    if (answer === null) {
      state.phase = 'answer_clues';
      lines.push(`${debauchee.name} answers ${c.name} in their own words (${c.prompt}).`);
    } else {
      lines.push(spoken(c, answer));
      beginBuild(state, lines);
    }
    return;
  }
  lines.push(`${who}: "Reveal!"`);
  if (state.settings.tiles === 'server') {
    r.turnIndex = (r.turnIndex + 1) % r.guessers.length;
  }
  r.lastTouched = null;
  owedReveal(state, lines, 'On request');
}

function burn(state: WordDebaucheeState, playerId: string, word: string, lines: string[]): void {
  if (state.phase !== 'build' && state.phase !== 'reveal' && state.phase !== 'answer_clues') refuse('Words burn only while the guessers are building.');
  const r = round(state);
  const w = normaliseWord(word);
  if (!/^[A-Z]+$/.test(w)) refuse(`"${word}" is not a word of letters.`);
  const lower = w.toLowerCase();
  if (!r.burned.includes(lower)) r.burned.push(lower);
  lines.push(`${w} was said aloud: it is burned for this round${playerId === r.debauchee ? '' : ''}.`);
}

function timerOut(state: WordDebaucheeState, lines: string[]): void {
  requireBuild(state);
  if (state.settings.tiles === 'server' && state.settings.timer === 'laps') {
    refuse('The server counts the laps in this game; a reveal comes by itself when the turn comes back round.');
  }
  const r = round(state);
  r.lastTouched = null;
  owedReveal(state, lines, state.settings.timer === 'sand' ? 'The sand has run out' : 'The turn has come back round');
}

/** Build-area rows holding a tile of this letter, for a reveal when the pool has none. */
export function rowsWith(r: Round, letter: string): number[] {
  return r.buildArea.map((text, i) => (text.includes(letter) ? i : -1)).filter((i) => i >= 0);
}

function reveal(state: WordDebaucheeState, playerId: string, letterIn: string, rowGiven: number | string | undefined, lines: string[]): void {
  if (state.phase !== 'reveal') refuse('No reveal is owed right now.');
  requireDebauchee(state, playerId, 'reveals letters');
  const r = round(state);
  const letter = singleLetter(letterIn);
  const left = unrevealedLetters(r);
  if (!left.has(letter)) {
    refuse(`${letter} is not a letter of the word still to reveal. Still to reveal: ${[...left.keys()].sort().join(', ')}.`);
  }
  let from = '';
  if (state.settings.tiles === 'server') {
    if ((r.pool[letter] ?? 0) > 0) {
      // The rules take the tile from the pool while it has one; a row given here is not needed.
      r.pool[letter]!--;
    } else {
      const rows = rowsWith(r, letter);
      if (rows.length === 0) refuse(`There is no ${letter} tile left anywhere on the table.`);
      let row: number;
      const rowIn = rowGiven === undefined ? undefined : resolveRow(state, rowGiven);
      if (rowIn === undefined) {
        if (rows.length > 1) {
          refuse(`The pool has no ${letter}; it sits in ${rows.length} rows (${rows.map((i) => `row ${i}: ${r.buildArea[i]}`).join(', ')}). Say which row to take it from.`);
        }
        row = rows[0]!;
      } else {
        if (!rows.includes(rowIn)) refuse(`Row ${rowIn} has no ${letter}. Rows with one: ${rows.join(', ')}.`);
        row = rowIn;
      }
      const text = r.buildArea[row]!;
      setRow(r.buildArea, row, text.replace(letter, ''));
      from = ` (taken from ${text} in the build area, as the pool has none)`;
      r.lastTouched = null;
    }
  }
  r.revealed.push(letter);
  const bribes = r.bribed.length ? `, plus ${r.bribed.length} bribed clue${r.bribed.length === 1 ? '' : 's'}` : '';
  lines.push(`${nameOf(state, playerId)} reveals ${letter}${from}. Revealed so far: ${r.revealed.join(' ')} (${r.revealed.length} of ${r.word!.length}${bribes}).`);
  if (r.revealed.length >= r.word!.length) {
    lines.push(...endRound(state, 'stumped', null));
    return;
  }
  beginBuild(state, lines);
}
