// The rules, one section per topic (rules-teaching: getRulesSections). The
// get_rules text is derived from these so the two cannot drift. The prose
// follows rules/rules.md; every move type is tagged to at least one section
// (rulesSections.test.ts).

import { NUMBER_CLUES, WORD_CLUES } from './data/clues.js';
import { TILE_COUNTS } from './data/tiles.js';
import { DEFAULT_TILES_PER_REVEAL, MAX_PLAYERS, MIN_CRACK_PAYOUT, MIN_PLAYERS } from './engine/round.js';

export interface RuleSectionShape {
  id: string;
  title: string;
  text: string;
  tags: { move_types?: string[]; phases?: string[] };
}

const clueRows = (cards: typeof NUMBER_CLUES) => cards.map((c) => `${c.name} (${c.copies}): ${c.prompt}.`).join(' ');

export const WORD_DEBAUCHEE_RULE_SECTIONS: RuleSectionShape[] = [
  {
    id: 'overview',
    title: 'The game',
    text:
      `${MIN_PLAYERS}–${MAX_PLAYERS} players, 20–40 minutes. One player, the debauchee, holds a secret word and gives away three stingy clues. ` +
      'Everyone else races to spell a synonym of that word from a pile of letter tiles, talking all the while, but never allowed to say the word they are spelling ' +
      'or to tell anyone which letter to grab. Every 30 seconds (or every lap of the table) the debauchee lays down one more letter of the secret word, and the ' +
      "guessers' payout shrinks. The best debauchee wins.",
    tags: { phases: ['choose_word', 'play_clues', 'answer_clues', 'build', 'reveal'] },
  },
  {
    id: 'components',
    title: 'Components',
    text:
      `144 letter tiles (${Object.entries(TILE_COUNTS).map(([l, n]) => `${l} ${n}`).join(', ')}), 500 word cards, 48 clue cards in two decks (20 number clues, 28 word clues), ` +
      'a 30-second sand timer and a score pad. A word card carries the word, its facts (letters, vowels, consonants, syllables, category, type, grade, difficulty) and its synonym list. ' +
      'The facts let the debauchee answer any clue card without counting or judging; the synonym list is the referee: a spelled word scores if and only if it is on the list. ' +
      'A, E, I, O and U are vowels; Y is a consonant. Grade is the US school grade the word is usually taught in. ' +
      'In this digital edition the server holds the word cards and the clue cards. The tiles can be the table\'s own (any 144-tile set with these counts) or held by the server as text.',
    tags: {},
  },
  {
    id: 'setup',
    title: 'Setup',
    text:
      'Tip all 144 tiles face up in the middle of the table and spread them so everyone can reach them: the pool. Leave an open space beside it: the build area. ' +
      'The word cards and the two clue decks are shuffled. Whoever most recently got away with something is the first debauchee (the server picks at random unless told).',
    tags: {},
  },
  {
    id: 'pick-a-word',
    title: 'The debauchee picks a word',
    text:
      'The debauchee draws three word cards, secretly chooses one, and slides the other two under the deck. The chosen card stays hidden: only the debauchee\'s private view shows it.',
    tags: { move_types: ['choose_word'], phases: ['choose_word'] },
  },
  {
    id: 'clues',
    title: 'The debauchee gives three clues',
    text:
      'The debauchee draws two number clues and two word clues, looks at them in secret, and chooses three to play. They lay the three face up where everyone can see them and answer each one out loud, truthfully. ' +
      'Four cards and three to play means at least one number clue and at least one word clue are always among them. The fourth card goes under its deck. ' +
      'The server answers every number and fact clue from the card; the four judgment clues (Rhymes with, Opposite, Register, Goes with) a human debauchee answers in their own words, or with the card\'s printed answer. ' +
      'A rhyme must not be on the synonym list. Nothing else may be said about the word, now or later, but any guesser may ask the debauchee to repeat an answer at any time. Then the timer flips.',
    tags: { move_types: ['play_clues', 'answer_clue'], phases: ['play_clues', 'answer_clues'] },
  },
  {
    id: 'build',
    title: 'The guessers build',
    text:
      'Play passes clockwise among the guessers, starting with the player to the debauchee\'s left, and keeps cycling until the round ends. On your turn do exactly one of these: ' +
      'place one tile from the pool into the build area; move one tile already in the build area, or return it to the pool; or call "Reveal!", on which the debauchee immediately reveals a letter and restarts the timer. ' +
      'You may not pass. Build wherever you like: several candidate words can sit in the build area at once. ' +
      'When the server holds the tiles, the build area is a list of rows; a row is a line of touching tiles read left to right.',
    tags: { move_types: ['place', 'move', 'call_reveal'], phases: ['build'] },
  },
  {
    id: 'talking',
    title: 'Talking',
    text:
      'Guessers may talk freely, with two exceptions. Never say the word you want spelled: any word a guesser says out loud is burned and cannot score this round, even if it is on the list. ' +
      'Hint around it: "the opposite of sad", "what a dog does with a bone". Never tell or suggest a letter to another player: no "starts with G", no "you need an L", no pointing at tiles. ' +
      'The debauchee may listen, smirk and say nothing. They never confirm or deny guesses about the secret word. Report every word a guesser says aloud so the server can burn it.',
    tags: { move_types: ['burn'], phases: ['build', 'reveal'] },
  },
  {
    id: 'checking',
    title: 'Checking a word',
    text:
      'When your tile completes a word you believe is a synonym, say "Check!" and point at it. The debauchee looks at the card and answers only "yes" or "no". ' +
      'A word reads only if its tiles sit touching, in one straight line, left to right. A "no" word may stay on the table; players can keep moving its tiles. ' +
      'A burned word cannot be checked. With the table\'s own tiles the check is trusted as declared; with server-held tiles the player whose tile just completed the row checks it, in the same action or right after.',
    tags: { move_types: ['check', 'place', 'move'], phases: ['build'] },
  },
  {
    id: 'reveal',
    title: 'The timer runs out',
    text:
      'When the sand runs out, the current turn finishes, then the debauchee reveals: they take one tile matching a letter of the secret word from the pool and place it face up in a row in front of them. ' +
      'The debauchee chooses which letter; positions are not shown. If the pool has no tile of that letter, the debauchee takes one from the build area instead. Then they flip the timer and play resumes with the next guesser in turn order. ' +
      `Under the laps timer there is no sand: the debauchee reveals a letter each time the turn comes back round to the first guesser (with a single guesser, every ${DEFAULT_TILES_PER_REVEAL} tiles unless set otherwise). ` +
      'A table with its own tiles reports the timer itself; a server that holds the tiles counts the laps.',
    tags: { move_types: ['timer_out', 'reveal', 'call_reveal'], phases: ['build', 'reveal'] },
  },
  {
    id: 'round-end',
    title: 'The round ends',
    text:
      'The round ends the instant one of these happens: a check gets a "yes" (the guessers cracked it), or the debauchee places the last letter of the secret word in front of them (the guessers are stumped). ' +
      'The debauchee turns the card face up and reads the word. Write the scores down, return every tile to the pool, and the player to the debauchee\'s left becomes the next debauchee.',
    tags: { move_types: ['check', 'reveal'], phases: ['build', 'reveal'] },
  },
  {
    id: 'scoring',
    title: 'Scoring',
    text:
      'Stumped: the debauchee scores the number of letters in the secret word; guessers score nothing. ' +
      `Cracked: every guesser scores the number of letters in the synonym minus the number of tiles the debauchee has revealed, with a minimum of ${MIN_CRACK_PAYOUT}; the debauchee scores nothing. ` +
      'For example, HAPPY cracked with GLAD and nothing revealed pays each guesser 4; cracked with CHEERFUL after two reveals pays 6; cracked with GLAD after four reveals pays 1; never cracked pays the debauchee 5.',
    tags: { move_types: ['check', 'reveal'], phases: ['build', 'reveal'] },
  },
  {
    id: 'winning',
    title: 'Winning',
    text:
      'The game ends once every player has been the debauchee the same number of times: once each with 5–8 players, twice each with 2–4. Highest total wins; ties share the win.',
    tags: { phases: ['game_over'] },
  },
  {
    id: 'clue-cards',
    title: 'The clue cards',
    text: `Number clues (20): ${clueRows(NUMBER_CLUES)} Word clues (28): ${clueRows(WORD_CLUES)}`,
    tags: { move_types: ['play_clues', 'answer_clue'], phases: ['play_clues', 'answer_clues'] },
  },
  {
    id: 'variants',
    title: 'Variants',
    text:
      'Laps instead of sand: drop the timer; the debauchee reveals a letter each time the turn comes back round to the first guesser (the digital default). ' +
      'Two-player duel: one guesser, no turn order; they place tiles freely while the sand runs; play four rounds each. ' +
      'Bribe and Open hand are in the printed rules and not yet in this edition.',
    tags: {},
  },
];

/** The get_rules text, derived from the sections. */
export function renderRules(): string {
  return WORD_DEBAUCHEE_RULE_SECTIONS.map((s) => `## ${s.title}\n\n${s.text}`).join('\n\n');
}
