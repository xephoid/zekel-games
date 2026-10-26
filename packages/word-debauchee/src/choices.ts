// The choice catalog: every decision the game gives a player, who owns it,
// and which move settles it. Typed to match @zekel/game-kit's PlayerChoice
// structurally (index.ts hands it through). Nothing a player decides at the
// table is settled by the engine: the only `auto` row is the round count,
// which the rules fix by player count.

export interface ChoiceRow {
  id: string;
  description: string;
  owner: 'player' | 'auto';
  when: 'setup' | 'in-game';
  resolvedBy: string[];
  distinguishedBy?: string;
  dependsOn?: string;
  why?: string;
  balanceAxis?: string;
}

export const WORD_DEBAUCHEE_CHOICES: ChoiceRow[] = [
  // ---- Setup ----
  {
    id: 'who-holds-the-tiles',
    description: 'Whether the table uses its own tiles or the server holds them as text',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.tiles'],
    balanceAxis: 'tiles',
  },
  {
    id: 'which-timer',
    description: 'Laps of the table or the 30-second sand timer (and, in a duel, tiles per reveal)',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.timer', 'options.tilesPerReveal'],
    balanceAxis: 'timer',
  },
  {
    id: 'first-debauchee',
    description: 'Who is the first debauchee (whoever most recently got away with something)',
    owner: 'player',
    when: 'setup',
    resolvedBy: ['options.firstDebauchee'],
  },
  {
    id: 'how-many-rounds',
    description: 'How many rounds the game runs',
    owner: 'auto',
    when: 'setup',
    resolvedBy: ['options.rounds'],
    why: 'The rules fix it: once round the table with 5–8 players, twice with 2–4. An option overrides it.',
  },

  // ---- The debauchee ----
  {
    id: 'which-word',
    description: 'Which of the three dealt word cards to keep',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['choose_word'],
    distinguishedBy: 'word',
  },
  {
    id: 'which-clues',
    description: 'Which three of the four clue cards to play, and so which to bury',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['play_clues'],
    distinguishedBy: 'cards',
  },
  {
    id: 'judgment-answer',
    description: 'How to answer Rhymes with, Opposite, Register or Goes with: in your own words, or with the card\'s answer',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['answer_clue'],
    distinguishedBy: 'text',
    dependsOn: 'a human debauchee played a judgment clue',
  },
  {
    id: 'which-letter-to-reveal',
    description: 'Which letter of the secret word to lay down when a reveal is owed',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['reveal'],
    distinguishedBy: 'letter',
  },

  // ---- The guessers ----
  {
    id: 'which-tile',
    description: 'Which tile to take from the pool',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['place'],
    distinguishedBy: 'letter',
    dependsOn: 'the server holds the tiles',
  },
  {
    id: 'where-to-put-it',
    description: 'Which row, and where in it, the tile goes: a new row or an existing one',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['place'],
    distinguishedBy: 'row',
    dependsOn: 'the server holds the tiles',
  },
  {
    id: 'move-a-tile',
    description: 'Which tile in the build area to move, where to, or whether to return it to the pool',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['move'],
    distinguishedBy: 'to_row',
    dependsOn: 'the server holds the tiles and the build area is not empty',
  },
  {
    id: 'check',
    description: 'Whether to call "Check!" on a word you completed',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['check', 'place', 'move'],
    distinguishedBy: 'check',
  },
  {
    id: 'call-reveal',
    description: 'Whether to spend your turn calling "Reveal!" for a letter instead of acting',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['call_reveal'],
  },
  {
    id: 'burned-word',
    description: 'Reporting a word a guesser said aloud, which then cannot score',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['burn'],
    distinguishedBy: 'word',
  },
  {
    id: 'timer',
    description: 'Reporting that the sand ran out, or that the turn came back round at a table with its own tiles',
    owner: 'player',
    when: 'in-game',
    resolvedBy: ['timer_out'],
    dependsOn: 'the sand timer, or the table holds its own tiles',
  },
];
