// Transition rules for Word Debauchee, authored from the pinned rulebook
// (rules-v1.txt, next to this file: a verbatim copy of rules/rules.md). Every
// rule cites its licensing sentence word for word; __tests__/oracleCitations.test.ts
// string-searches the pinned text for each.
//
// The rules keep no state of their own: each predicts facts about the next
// state from the previous state and the move (docs/rules-verification.md).
// They reason from the rulebook; the card list (synonyms) comes from the data
// the data tests already check.

import type { OracleRule, RuleViolation } from '@zekel/dev/verify/exec/types';
import { CLUES } from '../../data/clues.js';
import { cardFor } from '../../data/deck.js';
import { TILE_TOTAL } from '../../data/tiles.js';
import type { WDVerifyRound, WDVerifyState } from './project.js';

const S = (v: unknown): string => JSON.stringify(v);
const CLUE_CARDS = CLUES.reduce((a, c) => a + c.copies, 0);
const WORD_CARDS = 500;
const kindOf = (id: string): string => CLUES.find((c) => c.id === id)?.kind ?? '?';

function v(field: string, predicted: unknown, actual: unknown): RuleViolation {
  return { field, predicted: S(predicted), actual: S(actual) };
}

function tilesOnTable(r: WDVerifyRound): number {
  const pool = Object.values(r.pool).reduce((a, b) => a + b, 0);
  const build = r.buildArea.reduce((a, t) => a + t.length, 0);
  return pool + build + r.revealed.length;
}

function onList(word: string, spelled: string): boolean {
  return cardFor(word)?.synonyms.includes(spelled.toLowerCase()) ?? false;
}

/** The round went on (no new round, no game end) between prev and next. */
function sameRound(prev: WDVerifyState, next: WDVerifyState): boolean {
  return !!prev.round && !!next.round && next.history.length === prev.history.length;
}

function roundEnded(prev: WDVerifyState, next: WDVerifyState): boolean {
  return next.history.length === prev.history.length + 1;
}

function leftOf(seats: string[], id: string): string {
  return seats[(seats.indexOf(id) + 1) % seats.length]!;
}

function clockwiseFrom(seats: string[], debauchee: string): string[] {
  const at = seats.indexOf(debauchee);
  return seats.slice(at + 1).concat(seats.slice(0, at));
}

function perLap(s: WDVerifyState): number {
  const n = s.round!.guessers.length;
  return n === 1 ? s.settings.tilesPerReveal : n;
}

export const WORD_DEBAUCHEE_ORACLE_RULES: OracleRule<WDVerifyState>[] = [
  // ---------------------------------------------------------------- components
  {
    id: 'tiles-conserved',
    on: '*',
    citation: { section: 'Setup', quote: 'Tip all 144 tiles face up in the middle of the table' },
    check: (_prev, _e, next) => {
      if (!next.round || next.settings.tiles !== 'server') return [];
      const n = tilesOnTable(next.round);
      return n === TILE_TOTAL ? [] : [v('pool + build area + revealed tiles', TILE_TOTAL, n)];
    },
  },
  {
    id: 'clue-cards-conserved',
    on: '*',
    citation: { section: 'A round / 2. The debauchee gives three clues', quote: 'The fourth card goes under its deck.' },
    check: (_prev, _e, next) => {
      const held = next.numberDeck.length + next.wordClueDeck.length + (next.round?.hand.length ?? 0);
      const out: RuleViolation[] = [];
      if (held !== CLUE_CARDS) out.push(v('number deck + word clue deck + the round\'s cards', CLUE_CARDS, held));
      if (next.numberDeck.some((id) => kindOf(id) !== 'number')) out.push(v('number deck kinds', 'number clues only', next.numberDeck));
      if (next.wordClueDeck.some((id) => kindOf(id) !== 'word')) out.push(v('word clue deck kinds', 'word clues only', next.wordClueDeck));
      return out;
    },
  },
  {
    id: 'word-cards-conserved',
    on: '*',
    citation: { section: 'A round / 1. The debauchee picks a word', quote: 'slides the other two under the deck' },
    check: (_prev, _e, next) => {
      // A played word stays out of the deck with the round's record (the book is silent: PORT-PLAN.md Q18).
      const inRound = next.round ? (next.round.word ? 1 : next.round.dealtWords.length) : 0;
      const n = next.wordDeck + inRound + next.history.length;
      return n === WORD_CARDS ? [] : [v('word deck + dealt + played words', WORD_CARDS, n)];
    },
  },
  // ---------------------------------------------------------------- the debauchee
  {
    id: 'three-words-dealt-one-kept',
    on: ['choose_word'],
    citation: { section: 'A round / 1. The debauchee picks a word', quote: 'The debauchee draws three word cards, secretly chooses one' },
    check: (prev, e, next) => {
      const out: RuleViolation[] = [];
      if (prev.round!.hand.length !== 0) out.push(v('clue cards drawn before the word is chosen', 0, prev.round!.hand.length));
      if (prev.round!.dealtWords.length !== 3) out.push(v('dealt words', 3, prev.round!.dealtWords.length));
      const kept = String(e.move.word).trim().toUpperCase();
      if (!prev.round!.dealtWords.includes(kept)) out.push(v('kept word among the dealt', prev.round!.dealtWords, kept));
      if (next.round!.word !== kept) out.push(v('round.word', kept, next.round!.word));
      if (next.wordDeck !== prev.wordDeck + 2) out.push(v('word deck after burying two', prev.wordDeck + 2, next.wordDeck));
      return out;
    },
  },
  {
    id: 'two-and-two-dealt',
    on: '*',
    citation: { section: 'A round / 2. The debauchee gives three clues', quote: 'The debauchee draws **two number clues and two word clues**' },
    check: (_prev, _e, next) => {
      const r = next.round;
      // The clues are drawn once the word is chosen, so the hand is two and two during play_clues only.
      if (!r || next.settings.openHand || next.phase !== 'play_clues') return [];
      const numbers = r.hand.filter((id) => kindOf(id) === 'number').length;
      return r.hand.length === 4 && numbers === 2 ? [] : [v('clue hand', '2 number + 2 word', r.hand)];
    },
  },
  {
    id: 'three-clues-played-one-of-each',
    on: ['play_clues'],
    citation: { section: 'A round / 2. The debauchee gives three clues', quote: 'at least one number clue and at least one word clue are always among them' },
    check: (prev, _e, next) => {
      const out: RuleViolation[] = [];
      const played = next.round!.played.map((p) => p.card);
      if (played.length !== 3) out.push(v('clues played', 3, played.length));
      const kinds = new Set(played.map(kindOf));
      if (prev.settings.openHand) {
        if (!kinds.has('number')) out.push(v('a number clue among the three (Open hand)', true, false));
        if (new Set(played).size !== played.length) out.push(v('three different cards (Open hand)', true, played));
      } else {
        if (!kinds.has('number') || !kinds.has('word')) out.push(v('one of each kind', 'number and word', played));
        for (const id of played) if (!prev.round!.hand.includes(id)) out.push(v('played from the hand', prev.round!.hand, id));
      }
      if (S(next.round!.hand) !== S(played)) out.push(v("the round's cards after playing", played, next.round!.hand));
      return out;
    },
  },
  {
    id: 'fact-clues-answered-from-the-card',
    on: ['play_clues', 'call_reveal'],
    citation: { section: 'A round / 2. The debauchee gives three clues', quote: 'answer each one out loud, truthfully' },
    check: (_prev, _e, next) => {
      const r = next.round;
      if (!r?.word) return [];
      const card = cardFor(r.word)!;
      return r.played.flatMap((p) => {
        const c = CLUES.find((x) => x.id === p.card)!;
        if (c.judgment || p.answer === null) return [];
        const truth = c.answer(card);
        return String(truth) === String(p.answer) ? [] : [v(`answer to ${c.name}`, truth, p.answer)];
      });
    },
  },
  // ---------------------------------------------------------------- the guessers
  {
    id: 'guessers-clockwise-from-the-left',
    on: '*',
    citation: { section: 'A round / 3. The guessers build', quote: "starting with the player to the debauchee's left" },
    check: (_prev, _e, next) => {
      const r = next.round;
      if (!r) return [];
      const want = clockwiseFrom(next.seats, r.debauchee);
      return S(r.guessers) === S(want) ? [] : [v('round.guessers', want, r.guessers)];
    },
  },
  {
    id: 'place-takes-one-tile-from-the-pool',
    on: ['place'],
    citation: { section: 'A round / 3. The guessers build', quote: 'one tile from the pool into the build area' },
    check: (prev, e, next) => {
      if (!sameRound(prev, next) || next.phase === 'answer_clues') return [];
      const letter = String(e.move.letter).toUpperCase();
      const out: RuleViolation[] = [];
      const p = prev.round!;
      const n = next.round!;
      if ((n.pool[letter] ?? 0) !== (p.pool[letter] ?? 0) - 1) out.push(v(`pool[${letter}]`, (p.pool[letter] ?? 0) - 1, n.pool[letter] ?? 0));
      const before = p.buildArea.reduce((a, t) => a + t.length, 0);
      const after = n.buildArea.reduce((a, t) => a + t.length, 0);
      if (after !== before + 1) out.push(v('tiles in the build area', before + 1, after));
      return out;
    },
  },
  {
    id: 'move-keeps-or-returns-one-tile',
    on: ['move'],
    citation: { section: 'A round / 3. The guessers build', quote: 'one tile already in the build area, or return it to the pool' },
    check: (prev, e, next) => {
      if (!sameRound(prev, next)) return [];
      const p = prev.round!;
      const n = next.round!;
      const poolBefore = Object.values(p.pool).reduce((a, b) => a + b, 0);
      const poolAfter = Object.values(n.pool).reduce((a, b) => a + b, 0);
      const returned = e.move.to_row === undefined;
      return poolAfter === poolBefore + (returned ? 1 : 0) ? [] : [v('pool size', poolBefore + (returned ? 1 : 0), poolAfter)];
    },
  },
  {
    id: 'one-action-then-the-next-guesser',
    on: ['place', 'move', 'call_reveal'],
    citation: { section: 'A round / 3. The guessers build', quote: 'Play passes clockwise among the guessers' },
    check: (prev, _e, next) => {
      if (!sameRound(prev, next) || prev.settings.tiles !== 'server') return [];
      const p = prev.round!;
      const n = next.round!;
      const want = (p.turnIndex + 1) % p.guessers.length;
      return n.turnIndex === want ? [] : [v('round.turnIndex', want, n.turnIndex)];
    },
  },
  {
    id: 'laps-a-reveal-when-the-turn-comes-back-round',
    on: ['place', 'move'],
    citation: { section: 'Variants', quote: 'the debauchee reveals a letter each time the turn comes back round to the first guesser' },
    check: (prev, _e, next) => {
      if (!sameRound(prev, next) || prev.settings.tiles !== 'server' || prev.settings.timer !== 'laps') return [];
      const turns = prev.round!.turnsSinceReveal + 1;
      const owed = turns >= perLap(prev);
      const out: RuleViolation[] = [];
      if (next.round!.turnsSinceReveal !== turns) out.push(v('turnsSinceReveal', turns, next.round!.turnsSinceReveal));
      if ((next.phase === 'reveal') !== owed) out.push(v('a reveal owed after this turn', owed, next.phase === 'reveal'));
      return out;
    },
  },
  {
    id: 'reveal-called-is-owed-at-once',
    on: ['call_reveal'],
    citation: { section: 'A round / 3. The guessers build', quote: 'The debauchee immediately reveals a letter' },
    check: (prev, e, next) => {
      if (e.move.clue !== undefined) return [];
      return next.phase === 'reveal' && sameRound(prev, next) ? [] : [v('phase after "Reveal!"', 'reveal', next.phase)];
    },
  },
  {
    id: 'bribe-a-clue-instead-of-a-letter',
    on: ['call_reveal'],
    citation: { section: 'Variants', quote: 'the caller draws the top card of either clue deck and the debauchee answers it' },
    check: (prev, e, next) => {
      if (e.move.clue === undefined) return [];
      const out: RuleViolation[] = [];
      if (!prev.settings.bribe) out.push(v('Bribe is on', true, false));
      const kind = String(e.move.clue).includes('word') ? 'word' : 'number';
      const deck = kind === 'number' ? prev.numberDeck : prev.wordClueDeck;
      const top = deck[0];
      const n = next.round!;
      if (n.bribed.length !== prev.round!.bribed.length + 1 || n.bribed[n.bribed.length - 1] !== top) out.push(v('bribed card', top, n.bribed[n.bribed.length - 1]));
      if (n.played.length !== prev.round!.played.length + 1) out.push(v('clues on the table', prev.round!.played.length + 1, n.played.length));
      if (n.revealed.length !== prev.round!.revealed.length) out.push(v('letters revealed by a bribe', prev.round!.revealed.length, n.revealed.length));
      return out;
    },
  },
  {
    id: 'burned-words-are-kept',
    on: ['burn'],
    citation: { section: 'A round / 3. The guessers build', quote: 'Any word a guesser says out loud is *burned*' },
    check: (_prev, e, next) => {
      const word = String(e.move.word).trim().toLowerCase();
      return next.round!.burned.includes(word) ? [] : [v('burned', word, next.round!.burned)];
    },
  },
  {
    id: 'check-is-yes-iff-on-the-list',
    on: ['check', 'place', 'move'],
    citation: { section: 'Components / A word card', quote: 'spelled word scores if and only if it is on the list' },
    check: (prev, e, next) => {
      if (e.moveType !== 'check' && !e.move.check) return [];
      const word = prev.round!.word!;
      if (roundEnded(prev, next)) {
        const h = next.history[next.history.length - 1]!;
        return h.outcome === 'cracked' && h.synonym !== null && onList(word, h.synonym) ? [] : [v('a "yes" ends the round on a listed synonym', 'cracked with a listed synonym', h)];
      }
      if (!next.round || next.round.number !== prev.round!.number) return [];
      const checks = next.round.checks;
      if (checks.length !== prev.round!.checks.length + 1) return [v('a check recorded', prev.round!.checks.length + 1, checks.length)];
      const last = checks[checks.length - 1]!;
      const out: RuleViolation[] = [];
      if (last.yes) out.push(v('a "yes" ends the round', 'round over', 'round continues'));
      if (onList(word, last.word) && !prev.round!.burned.includes(last.word.toLowerCase())) out.push(v(`"${last.word}" on the list answered`, 'yes', 'no'));
      return out;
    },
  },
  {
    id: 'burned-word-cannot-score',
    on: '*',
    citation: { section: 'A round / 3. The guessers build', quote: 'cannot score this round, even if it is on the list' },
    check: (prev, _e, next) => {
      if (!roundEnded(prev, next)) return [];
      const h = next.history[next.history.length - 1]!;
      return h.outcome === 'cracked' && h.synonym && prev.round!.burned.includes(h.synonym.toLowerCase()) ? [v('cracked with a burned word', 'refused', h.synonym)] : [];
    },
  },
  // ---------------------------------------------------------------- reveals
  {
    id: 'reveal-lays-a-letter-of-the-word',
    on: ['reveal'],
    citation: { section: 'A round / 4. The timer runs out', quote: 'take one tile matching a letter of the secret word from the pool and place it face up in a row in front of them' },
    check: (prev, e, next) => {
      const letter = String(e.move.letter).toUpperCase();
      const p = prev.round!;
      const word = p.word!;
      const out: RuleViolation[] = [];
      const have = [...word].filter((ch) => ch === letter).length;
      const shown = p.revealed.filter((ch) => ch === letter).length;
      if (shown >= have) out.push(v(`${letter} still to reveal`, `${have - shown} left`, 'none left'));
      if (roundEnded(prev, next)) {
        const h = next.history[next.history.length - 1]!;
        if (h.outcome !== 'stumped' || h.revealed !== word.length) out.push(v('the last letter ends the round stumped', { outcome: 'stumped', revealed: word.length }, h));
        return out;
      }
      const n = next.round!;
      if (S(n.revealed) !== S([...p.revealed, letter])) out.push(v('revealed', [...p.revealed, letter], n.revealed));
      if (prev.settings.tiles === 'server') {
        if ((p.pool[letter] ?? 0) > 0) {
          if ((n.pool[letter] ?? 0) !== p.pool[letter]! - 1) out.push(v(`pool[${letter}] (tile from the pool)`, p.pool[letter]! - 1, n.pool[letter] ?? 0));
        } else {
          const before = p.buildArea.reduce((a, t) => a + t.length, 0);
          const after = n.buildArea.reduce((a, t) => a + t.length, 0);
          if (after !== before - 1) out.push(v('tile taken from the build area', before - 1, after));
        }
      }
      if (next.phase !== 'build') out.push(v('play resumes', 'build', next.phase));
      if (n.turnsSinceReveal !== 0) out.push(v('the timer restarts', 0, n.turnsSinceReveal));
      return out;
    },
  },
  {
    id: 'stumped-when-the-last-letter-is-down',
    on: '*',
    citation: { section: 'A round / 5. The round ends', quote: 'guessers are stumped' },
    check: (_prev, _e, next) => {
      const r = next.round;
      if (!r?.word) return [];
      return r.revealed.length < r.word.length ? [] : [v('a round with every letter revealed', 'over', 'still running')];
    },
  },
  // ---------------------------------------------------------------- scoring
  {
    id: 'payouts-as-printed',
    on: '*',
    citation: { section: 'Scoring', quote: 'every guesser scores the number of letters in the synonym **minus** the number of tiles the debauchee has revealed, with a minimum of **1**' },
    check: (prev, _e, next) => {
      if (!roundEnded(prev, next)) return [];
      const h = next.history[next.history.length - 1]!;
      const guessers = clockwiseFrom(prev.seats, h.debauchee);
      const want: Record<string, number> = {};
      if (h.outcome === 'stumped') {
        want[h.debauchee] = h.word.length;
        for (const g of guessers) want[g] = 0;
      } else {
        want[h.debauchee] = 0;
        const each = Math.max(1, (h.synonym ?? '').length - h.revealed - h.bribes);
        for (const g of guessers) want[g] = each;
      }
      const out: RuleViolation[] = [];
      if (S(want) !== S(h.payouts)) out.push(v('payouts', want, h.payouts));
      for (const id of prev.seats) {
        const expect = (prev.scores[id] ?? 0) + (want[id] ?? 0);
        if (next.scores[id] !== expect) out.push(v(`scores[${id}]`, expect, next.scores[id]));
      }
      return out;
    },
  },
  {
    id: 'stumped-pays-the-word-length',
    on: '*',
    citation: { section: 'Scoring', quote: 'the debauchee scores the number of letters in the secret word' },
    check: (prev, _e, next) => {
      if (!roundEnded(prev, next)) return [];
      const h = next.history[next.history.length - 1]!;
      if (h.outcome !== 'stumped') return [];
      return h.payouts[h.debauchee] === h.word.length ? [] : [v('debauchee payout', h.word.length, h.payouts[h.debauchee])];
    },
  },
  {
    id: 'scores-only-change-at-round-end',
    on: '*',
    citation: { section: 'Scoring', quote: 'Write the scores down' },
    check: (prev, _e, next) => (roundEnded(prev, next) || S(prev.scores) === S(next.scores) ? [] : [v('scores mid-round', prev.scores, next.scores)]),
  },
  // ---------------------------------------------------------------- the next round, the end
  {
    id: 'next-round-to-the-left-with-a-fresh-table',
    on: '*',
    citation: { section: 'Scoring', quote: 'left becomes the next debauchee' },
    check: (prev, _e, next) => {
      if (!roundEnded(prev, next) || !next.round) return [];
      const n = next.round;
      const out: RuleViolation[] = [];
      const want = next.settings.house ?? leftOf(prev.seats, prev.round!.debauchee);
      if (n.debauchee !== want) out.push(v('next debauchee', want, n.debauchee));
      if (n.number !== prev.round!.number + 1) out.push(v('round number', prev.round!.number + 1, n.number));
      if (n.dealtWords.length !== 3 || n.word !== null) out.push(v('three new words dealt, none chosen', { dealt: 3, word: null }, { dealt: n.dealtWords.length, word: n.word }));
      if (n.revealed.length || n.bribed.length || n.burned.length || n.checks.length) out.push(v('a clean round record', 'empty', n));
      if (next.settings.tiles === 'server') {
        const pool = Object.values(n.pool).reduce((a, b) => a + b, 0);
        if (pool !== TILE_TOTAL || n.buildArea.length) out.push(v('every tile back in the pool', TILE_TOTAL, { pool, buildArea: n.buildArea }));
      }
      return out;
    },
  },
  {
    id: 'the-house-is-debauchee-every-round',
    on: '*',
    citation: { section: 'Variants', quote: 'the computer is the debauchee every round' },
    check: (_prev, _e, next) => {
      const house = next.settings.house;
      if (!house || !next.round) return [];
      return next.round.debauchee === house ? [] : [v('debauchee under The House', house, next.round.debauchee)];
    },
  },
  {
    id: 'game-ends-after-the-rounds',
    on: '*',
    citation: { section: 'Winning', quote: 'once each with 5–8 players, twice each with 2–4' },
    check: (_prev, _e, next) => {
      const over = next.roundsPlayed >= next.settings.rounds;
      return (next.phase === 'game_over') === over ? [] : [v('game over', over, next.phase === 'game_over')];
    },
  },
  {
    id: 'highest-total-wins-ties-share',
    on: '*',
    citation: { section: 'Winning', quote: 'Highest total wins; ties share the win.' },
    check: (_prev, _e, next) => {
      if (next.phase !== 'game_over') return next.winners === null ? [] : [v('winners before the end', null, next.winners)];
      const best = Math.max(...Object.values(next.scores));
      const want = next.seats.filter((id) => next.scores[id] === best);
      return S(next.winners) === S(want) ? [] : [v('winners', want, next.winners)];
    },
  },
];
