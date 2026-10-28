# Port plan — Word Debauchee

Plan for `@zekel/word-debauchee`, a game module for the zekel MCP server, built from
[rules.md](rules.md), [design-notes.md](design-notes.md) and the 500 cards in
[words.csv](words.csv). The printed rule is the rule; where this plan changes or adds
something for digital play it says so, and every open point is in section 10 for the
designer. Questions are numbered Q1… and rulings get recorded at the top of this file,
dated, as the Demon Hunter plan does. (This file was `PLAN.md` until 2026-10-26; it is
the port-planning runbook's `PORT-PLAN.md`. Its sections are in the order the plan was
written, not the runbook template's: §0 sources, §4a the feature inventory, §10a the
risk register and divergence ledger, §14 the review gate.)

Rulings 2026-10-26 (designer): all eleven suggestions in section 10 accepted as
written. Both tile modes, `table` default, `server` whenever a guesser is AI (Q1);
`laps` default timer, `sand` reportable at a table, 5 tiles per reveal in the duel (Q2);
a human debauchee's word only in that seat's private view (Q3); `opposite`,
`goes_with`, `rhymes_with` and `register` added to every card as a generated first pass
to check at the table (Q4); burned words reported by the relayer and a check on one
refused as burned (Q5); `table` checks trusted as declared (Q6); *The House* is a
variant and the `house` option (Q7); the synonym floor is four (Q8); AI guessers read
the whole deck, never the hidden word (Q9); first debauchee random unless named (Q10);
all four printed variants in v1, *Bribe* and *Open hand* last (Q11).

## 0. Sources and extraction

- **The rulebook:** `rules/rules.md`, the designer's own text (this is a Zekel Games
  game, so there is no publisher's edition). Pinned for the rules checker as
  `src/dev/verify/rules-v1.txt`, a verbatim copy; a ruling that changes the rules
  updates the pin in the same change.
- **The design notes:** `rules/design-notes.md`, the reasoning behind the numbers.
- **The components:** no photos or scans. The 500 word cards are `rules/words.csv`
  (one row per card, every printed field a column); the clue cards and tile counts are
  the rulebook's appendix, transcribed into `src/data/clues.ts` and `src/data/tiles.ts`.
  Extraction coverage: every card has every fact column; the four judgment columns
  (opposite, goes_with, rhymes_with, register) were generated on 2026-10-26 (Q4) and are
  to be checked at the table. Nothing illegible, nothing missing.
- **Reference implementation:** none. This is a rulebook-only port, so the counts
  below are the engine's correctness anchors: 144 tiles conserved across pool, build
  area and the debauchee's row; 500 word cards across deck, dealt and chosen; 48 clue
  cards across the two decks and the round's hand.

## 1. What the server is for this game

Word Debauchee is a talking game. The server cannot hear the table, so it does not try
to. It does the three things a table needs and nothing else:

- **The cards.** The word deck and the two clue decks exist only as data today, so the
  server is the deck: it deals three words to the debauchee, deals two and two clue cards,
  answers every number clue from the card facts, and judges "Check!" against the synonym
  list. Players never need printed cards.
- **The referee and scorekeeper.** Reveal count, the row of revealed letters, burned
  words, round end, the scoring table from the rules, game end.
- **The AI.** An AI debauchee (the role the name is about: one versus the table) and AI
  guessers, so one person can play, or a table can play against the house.

The 144 tiles are exactly a Bananagrams set (same letter counts), so a table already has
them. Two ways to hold the tiles, chosen per session by the `tiles` option:

- **`table`** (default): the tiles are on the table. Guessers' tile moves are not
  reported; the only guesser moves are *check* (declare the word), *call reveal*, and
  *burn*. A check is trusted as declared, as the server trusts every physical game.
- **`server`**: no physical copy. The server holds the pool and the build area as text,
  one tile per turn as the rules say. This is the mode AI guessers play in, and the
  mode for playing alone in chat.

A session with any AI guesser is always `server` mode (an AI cannot place a tile it
cannot see).

## 2. Package shape

`packages/word-debauchee`, same shape as the other games:

```
package.json  README.md  LICENSE  PORT-PLAN.md (this file, moved)
rules/rules.md  rules/design-notes.md  rules/words.csv
src/index.ts          Game seam: schemas, views, next_step, choices, rules text
src/types.ts          state and move types
src/data/words.ts     generated from rules/words.csv (scripts/build-words.mjs)
src/data/clues.ts     the 20 + 28 clue cards, copies and answer functions
src/data/tiles.ts     the 144-tile distribution
src/engine/*.ts       deal, clues, build area, reveal, check, scoring, round and game end
src/legalMoves.ts
src/ai/debauchee.ts   word choice, clue choice, reveal choice, judgment answers
src/ai/guesser.ts     candidate solver, synonym choice, tile placement, when to call reveal
src/rulesSections.ts  rules.md as sections for get_rules
src/__tests__/
```

The docs in `docs/word-debauchee` move into the package under `rules/` when the
package is created, so a game's rules stay with the game as everywhere else in the repo.

## 3. State

Per session: players (seats, which are AI and at what difficulty), options, scores,
round number, debauchee rotation and how many times each seat has been debauchee, and
the current round:

- the three dealt word cards and the chosen one (hidden from everyone but the debauchee);
- the four dealt clue cards, the three played and their answers (public once played);
- the row of revealed letters, in reveal order, and the count;
- burned words; checked words and their yes/no;
- `server` mode only: the pool (letter counts) and the build area (rows of letters);
- the guesser turn order, whose turn it is, and the lap position (for the laps timer);
- phase: `choose_word`, `play_clues`, `answer_clues` (human debauchee, judgment cards
  only), `build`, `reveal` (debauchee picks the letter), `round_over`, `game_over`.

`hasHiddenInformation = true`. The debauchee's player view shows the dealt words, the
chosen word, the clue hand and the synonym list. Every other view, and the public view,
shows only what the table can see: the played clues and answers, the revealed letters,
burned and checked words, the build area and pool counts in `server` mode, scores and
turn order. The narrating LLM is told, in the report voice, that it is the table's
scorekeeper and must never read the word aloud before the round ends.

## 4. The round, as moves

| Move | Who | Notes |
|---|---|---|
| `choose_word { word }` | debauchee | one of the three dealt; the other two go under the deck |
| `play_clues { cards: [a, b, c] }` | debauchee | three of the four in hand; the engine checks there is at least one number and one word clue (always true, by construction) |
| `answer_clue { card, text }` | human debauchee | only for judgment cards (*Rhymes with*, *Opposite*, *Goes with*, *Register*); every other card is answered from the card facts by the engine |
| `place { letter, row?, index? }` | guesser, on turn, `server` mode | from the pool into the build area; a new row if `row` is omitted |
| `move { from, to }` | guesser, on turn, `server` mode | within the build area, or back to the pool |
| `call_reveal` | guesser, on turn | ends the turn; the debauchee reveals, then the timer restarts |
| `check { word }` (`table`) / `check { row }` (`server`) | guesser, on turn | "yes" ends the round; "no" is recorded; a burned word is refused as burned |
| `burn { word }` | anyone, any time, not a turn | a guesser said it aloud; the relaying player reports it |
| `timer_out` | anyone, any time, not a turn | `sand` timer only: the sand ran out; the current turn finishes first |
| `reveal { letter }` | debauchee | always asked, never automatic: a letter of the word not yet fully revealed, from the pool, else from the build area; positions are never shown |

Turn order cycles among the guessers and keeps cycling across reveals, as ruled in the
design notes. Nobody may pass.

**Timers.** The `timer` option: `laps` (default; the rules' *Laps* variant: a reveal each
time the turn returns to the first guesser) or `sand` (the table runs the 30-second
timer and reports `timer_out`). With one guesser (the *Two-player duel*) a lap is one
turn, which reveals far too fast, so `laps` takes a `tilesPerReveal` count instead; see
Q2 for the number.

**Round end and scoring** exactly as rules.md: stumped pays the debauchee the word's
length; cracked pays every guesser synonym length minus reveals, minimum 1. The game
ends when every seat has been debauchee once (5–8 players) or twice (2–4), highest total
wins, ties share.

**Variants** are options: `laps` and `duel` are part of the core flow above; the other
three were built in milestone 6:

- `bribe`: "Reveal!" takes an optional `clue` field, `number` or `word` (printed names
  such as "a word clue" accepted). The server draws the top card of that deck, answers
  it like a played clue (a human debauchee answers a judgment clue in their own words
  first, mid-round, while the guessers may still burn words), and the card counts as a
  reveal: the crack payout is cut by letters revealed plus clues bribed. The timer flips
  as after a letter. The bribed cards go back under their decks with the played three.
- `openHand`: no clue deal. `play_clues` takes any three different cards from the whole
  set, at least one a number clue; the server lifts each from its deck. The legal-move
  menu lists one fill-in entry naming every card rather than the 1,320 combinations.
- `house`: the first AI seat is the house, debauchee every round; the others guess every
  round and, since every guesser scores the same, their score is the team's. No setup
  step. The tiles may be the table's own (an AI that only listens needs none); server
  tiles are still forced when an AI seat guesses. Rounds default to a normal game's at
  that table size (Q13). Winners: the house, or every person, or everyone on a tie.

## 4a. Feature inventory (one row per printed rule)

Every rule in `rules/rules.md`, in the book's order, with where the port builds it.
The second, independent enumeration (§14) was diffed against this table.

| # | Section | Rule | Detail | Built in |
|---|---|---|---|---|
| 1 | Head | Players, time | 2–8 players, 20–40 minutes | `round.ts` MIN/MAX_PLAYERS |
| 2 | Head | The pitch | one debauchee, a secret word, three stingy clues; the rest spell a synonym; a letter every 30 seconds; the best debauchee wins | the whole engine |
| 3 | Components | Letter tiles | 144, distribution in the appendix | `tiles.ts`, `tiles.test.ts` |
| 4 | Components | Word cards | 500, one word each with facts and a synonym list | `words.csv` → `words.ts`, `words.test.ts` |
| 5 | Components | Clue cards | 48 in two decks: 20 number, 28 word | `clues.ts`, `clues.test.ts` |
| 6 | Components | Sand timer, score pad | one 30-second timer; a score pad | `timer: sand` reports; `scores` |
| 7 | A word card | The facts | letters, vowels, consonants, syllables, category, type, grade, difficulty | `wordCard.ts` |
| 8 | A word card | The synonym list is the referee | a spelled word scores if and only if it is on the list | `deck.ts` isSynonymOf, `apply.ts` checkWord |
| 9 | A word card | Vowels | A E I O U are vowels; Y is a consonant | `wordCard.ts` isVowel |
| 10 | A word card | Grade | the US school grade the word is usually taught in | `words.csv` grade |
| 11 | A clue card | What a clue card is | names one thing the debauchee must tell the table; number clues answer with a number, word clues do not | `clues.ts` kind |
| 12 | Setup 1 | The pool and the build area | tip all 144 tiles face up; an open space beside them | `freshPool`, `buildArea`; `getPhysicalSetup` |
| 13 | Setup 2 | Three decks | shuffle the word cards; shuffle the number clues and the word clues into two separate decks | `createState` |
| 14 | Setup 3 | First debauchee | whoever most recently got away with something | `choose_first_debauchee` (a human names them; the server draws only for an all-AI table) |
| 15 | Round 1 | Draw three words | the debauchee draws three word cards | `startRound` WORDS_DEALT |
| 16 | Round 1 | Choose one, bury two | secretly chooses one; the other two go under the deck; the chosen card stays hidden | `chooseWord`; `viewLeak.test.ts` |
| 17 | Round 2 | Draw two and two | two number clues and two word clues, looked at in secret | `startRound` CLUES_DEALT_PER_DECK; debauchee view only |
| 18 | Round 2 | Play three | choose three; lay them face up; answer each aloud, truthfully | `playClues`; the server answers fact clues from the card |
| 19 | Round 2 | One of each kind | four cards, three played: at least one number and one word clue | `playClues` refuses otherwise |
| 20 | Round 2 | Bury the fourth | the fourth card goes under its deck | `playClues` |
| 21 | Round 2 | Say nothing else | nothing else may be said about the word, now or later | `answerClue` refuses the word itself; `nextStep` NO_HINTS |
| 22 | Round 2 | Repeat on request | any guesser may ask the debauchee to repeat an answer | the played clues stay in every view |
| 23 | Round 2 | Flip the timer | then the debauchee flips the timer | `beginBuild` |
| 24 | Round 3 | Turn order | clockwise among the guessers from the debauchee's left, cycling until the round ends | `startRound` guessers; `turnIndex` |
| 25 | Round 3 | One action: place | one tile from the pool into the build area | `place` |
| 26 | Round 3 | One action: move | one tile already in the build area, or return it to the pool | `move` |
| 27 | Round 3 | One action: call "Reveal!" | the debauchee immediately reveals a letter and restarts the timer | `callReveal` → `reveal` |
| 28 | Round 3 | No pass | you may not pass | no pass move exists; `legalMoves.ts` |
| 29 | Round 3 | Build anywhere | several candidate words can sit in the build area at once | rows in `buildArea` |
| 30 | Round 3 | Never say the word | any word a guesser says aloud is burned and cannot score this round, even if on the list | `burn`; `checkWord` refuses a burned word |
| 31 | Round 3 | Hint around it | hints like "the opposite of sad" are allowed | nothing to build: talking is the table's |
| 32 | Round 3 | Never suggest a letter | no "starts with G", no pointing at tiles | guidance and next step; not enforceable by the server (§10a) |
| 33 | Round 3 | The debauchee says nothing | listens, smirks, never confirms or denies a guess | the AI debauchee has no talking move; guidance |
| 34 | Round 3 | Check on the completing tile | when your tile completes a word, say "Check!" and point | `check` on `place`/`move`, or right after by the same player |
| 35 | Round 3 | Yes or no only | the debauchee answers only "yes" or "no" | `checkWord` summary |
| 36 | Round 3 | A word reads one way | tiles touching, in one straight line, left to right | a row is a string read left to right |
| 37 | Round 3 | A "no" word may stay | players can keep moving its tiles | nothing removed on "no" |
| 38 | Round 4 | The sand runs out | the current turn finishes, then the debauchee reveals | `timer_out` (sand) / laps counted by the server |
| 39 | Round 4 | What a reveal is | one tile matching a letter of the word, from the pool, face up in a row in front of the debauchee | `reveal` |
| 40 | Round 4 | The debauchee picks the letter | positions are not shown | `reveal.letter`; `revealed` is a list, no positions |
| 41 | Round 4 | Pool empty of that letter | take one from the build area instead | `reveal` falls back to the build area |
| 42 | Round 4 | Resume | flip the timer; play resumes with the next guesser in turn order | `beginBuild` |
| 43 | Round 5 | Round ends: cracked | a check gets "yes" | `checkWord` → `endRound('cracked')` |
| 44 | Round 5 | Round ends: stumped | the debauchee places the last letter of the word | `reveal` → `endRound('stumped')` |
| 45 | Round 5 | Turn the card up | the debauchee reads the word | `endRound` summary; `last_round` in the view |
| 46 | Scoring | Stumped | the debauchee scores the word's letters; guessers nothing | `payouts` |
| 47 | Scoring | Cracked | every guesser scores the synonym's letters minus tiles revealed, minimum 1; the debauchee nothing | `payouts`, MIN_CRACK_PAYOUT |
| 48 | Scoring | The four example rows | GLAD/0 → 4; CHEERFUL/2 → 6; GLAD/4 → 1; never cracked → 5 | `engine.test.ts` scoring table |
| 49 | Scoring | After the round | write the scores, return every tile to the pool, the player to the left is next debauchee | `endRound`, `startRound`, `freshPool` |
| 50 | Winning | Game length | every player debauchee the same number of times: once each with 5–8, twice with 2–4 | `defaultRounds` |
| 51 | Winning | Highest total wins | ties share the win | `winners` |
| 52 | Example | Ann's round | a worked round: GLAD cracked for 4; a slower round, MERRY after three reveals for 2 | `engine.test.ts` |
| 53 | Variants | Laps instead of sand | a reveal each time the turn comes back round to the first guesser | `timer: laps` (default) |
| 54 | Variants | Bribe | on "Reveal!" the guessers may take a clue instead of a letter: the caller draws the top card of either clue deck, the debauchee answers it; counts as a revealed tile | `bribe` option; `callReveal` with `clue` |
| 55 | Variants | Open hand | skip the draw; the debauchee chooses any three clue cards from the whole set, at least one a number clue | `openHand` option; `playClues` |
| 56 | Variants | Two-player duel | one guesser, no turn order, tiles placed freely while the sand runs; four rounds each | `tilesPerReveal` under laps; `rounds` 4 with 2 seats; the sand timer reported |
| 57 | Variants | The House | the computer is debauchee every round; the table guesses as one team; as many rounds as a normal game; highest total wins | `house` option |
| 58 | Appendix | Tile counts | A 13 … Z 2, 144 in all | `TILE_COUNTS`; `tiles.test.ts` |
| 59 | Appendix | Number clues | ten cards, 20 copies: Letters 4, Vowels 3, Consonants 3, Syllables 2, Grade 2, Difficulty 2, Repeats 1, First vowel 1, Shortest synonym 1, Longest synonym 1 | `NUMBER_CLUES`; `clues.test.ts` |
| 60 | Appendix | Word clues | twelve cards, 28 copies: Category 4, Type 4, First letter 2, Last letter 2, Opens with 2, Double letter 2, Half the alphabet 2, Odd or even 2, Rhymes with 2, Opposite 2, Register 2, Goes with 2 | `WORD_CLUES`; `clues.test.ts` |
| 61 | Appendix | Rhymes with | any real word that rhymes and is not on the synonym list, or "nothing rhymes" | `answerClue` refuses a listed synonym |
| 62 | Appendix | Register | formal, everyday or slang | `answerClue` accepts only those three |
| 63 | Appendix | Word card facts | difficulty ●○○/●●○/●●● as defined; twelve categories; four types | `wordCard.ts`; the difficulty rule is Q12 |

## 5. Data

`words.csv` (500 cards) is the source; `scripts/build-words.mjs` generates
`src/data/words.ts` and a test rejects the build if the generated file is stale. Tests
on the data itself, run on every build:

- letters, vowels, consonants recomputed and compared (A E I O U vowels, Y consonant);
- synonyms 3–10 letters, no headword inside a synonym, no duplicates, no duplicate
  headwords;
- four to ten synonyms (the floor was six in the design notes; 137 cards, almost all
  nouns, have four or five, and the floor moved to four by the Q8 ruling);
- difficulty computed from the headword's grade and synonym count (●○○ grade 1–2;
  ●●● grade 5 or more, or fewer than four synonyms; ●●○ otherwise), and the spread
  reported. The design notes' rule counts a word's *synonyms'* grades, and 2,391 of
  the deck's 3,041 synonyms are not cards, so the deck cannot grade them (Q12).

**Four more fields per card** are needed before an AI can be debauchee: *Opposite*,
*Goes with*, *Rhymes with* and *Register* are judgment clues, answered today from the
debauchee's head. Plan: add `opposite`, `goes_with`, `rhymes_with` (or "nothing rhymes")
and `register` columns to words.csv as a generated first pass, flagged like the existing
type, category and grade as "check at the table". A human debauchee may still answer
those cards in their own words. (Q4.)

Clue cards: 20 number clues and 28 word clues with the copy counts in the rules
appendix; each card carries an answer function over the card facts, or `judgment` for
the four above.

## 6. AI debauchee

The game's own idea of the role: give away as little as possible. Three tiers:

- **easy**: random word of the three, plays the first three cards dealt, reveals a random
  letter.
- **medium**: of the three words, keeps the one with the most letters per synonym
  (long words reveal slowly, short synonyms crack fast); buries the gift card
  (*Shortest synonym*, *First letter*, *Last letter*, *Goes with*, then the rest by a
  fixed stinginess order); reveals the word's most common letter first (E, A, …) and
  repeated letters early, since they say the least.
- **hard**: runs the guesser solver (section 7) against itself and keeps the
  *crack chance* low: the share of candidate cards that list the most-shared synonym,
  which is exactly the target a solver-guesser would spell. Word choice: the dealt word
  whose best play gives the lowest chance (longer on ties). Clue choice: the three whose
  answers give the lowest chance (more candidates, then the gift order, on ties). Reveal
  choice: the letter that keeps the chance lowest.

  Built 2026-10-26. The candidate *count* was tried first and rejected: for HAPPY,
  "Letters: 5" leaves 8 cards and "Shortest synonym: 4" leaves 17, so by count the
  gift card looked stingy. By crack chance, the deck says something the design notes
  do not: against a guesser who knows the card list, **Category and Type together
  give away more than Shortest synonym** (HAPPY with Letters, Shortest synonym,
  Category, Type in hand: the hard tier buries Category). Worth a look at the table:
  if human guessers also lean on category plus type, those two cards may want fewer
  copies, or the gift order in the medium tier wants revising.

Judgment answers come from the card's new fields; *Rhymes with* must not be on the
synonym list (checked). The AI debauchee never sees the build area as anything but
public information, which it does not need.

## 7. AI guessers

An AI guesser cannot hear hints and cannot give them. It plays the deck: like a player
who has read the 500 cards, it keeps the set of words consistent with the three clues
and the revealed letters (every revealed letter must be in the word; counts must fit),
and chooses a synonym to spell from the union of the candidates' synonym lists, weighted
by how many candidates list it. It never reads the hidden word or the debauchee's hand.

- **easy**: random candidate, random synonym, one tile a turn, never calls reveal.
- **medium**: the solver above; picks the most-shared synonym that can be spelled from
  the pool; continues a row another guesser started when that row is a prefix of its
  target; calls reveal when the candidate set is larger than a threshold.
- **hard**: as medium, with the expected payout in the choice: a shorter synonym now
  beats a longer one that needs another lap, and reveal is called only when the
  expected pruning is worth the point.

Mixed tables work: human and AI guessers share the build area and turn order. In
`server` mode a human guesser's tile is the suggestion, as the rules intend; AI tiles
are the same.

Built 2026-10-26 (`ai/guesser.ts`, `ai.ts`). As built: every tier checks on the tile
that completes its target, continues a row that already spells a prefix of it, and
re-completes an unchecked shared synonym sitting whole on the table (moving its last
tile into place) so it may check it; burned words and words answered "no" are never
targets. Easy keeps building whatever is already down, else a random synonym of a
random candidate. Medium spells the most-shared synonym and calls "Reveal!" while more
than 40 cards fit. Hard values a target at (share of candidates listing it) × (letters
minus reveals so far and reveals still to come, with the guessers laying one tile each
per lap on the same row), and calls "Reveal!" only when that value, estimated after one
more letter over a sample of candidate cards and priced at one point, beats the value
now. Two first drafts were wrong and the harness caught both: hard priced "now" and
"after" with different payout models and so called a reveal nearly every turn; easy
picked a fresh target every turn and almost never finished a word.

`scripts/harness.mjs` (after `pnpm build`): all-AI rounds per debauchee tier ×
guesser tier. 200 rounds per pairing, laps timer, 2026-10-26:

| debauchee | guessers | stumped, 2 guessers | stumped, 3 guessers | guesser pay per crack (2 / 3) |
|---|---|---|---|---|
| easy | easy / medium / hard | 26 % / 12 % / 31 % | 13 % / 8 % / 24 % | 3.1 / 2.2 / 4.0 · 3.8 / 2.6 / 5.0 |
| medium | easy / medium / hard | 31 % / 20 % / 32 % | 15 % / 14 % / 17 % | 2.6 / 1.7 / 2.9 · 3.3 / 2.1 / 4.1 |
| hard | easy / medium / hard | 74 % / 61 % / 80 % | 63 % / 44 % / 70 % | 2.4 / 1.3 / 3.2 · 2.6 / 1.4 / 4.0 |

What it shows about the AI, not about the game: medium guessers crack the most rounds
and hard guessers the fewest, because hard goes for payout and medium for a crack; hard
guessers take about twice as much per crack. The hard debauchee stumps most tables and,
oddly, prefers ●○○ words: against a guesser who reads the card list, a common word
hides among many similar cards. Reveals per crack run 2.5 to 4.6, far above the design
notes' "0–1 for a ●○○ word", which assumed a 30-second sand timer at a bigger table;
under laps with two or three guessers a 5-letter synonym needs two laps at best.

The variants, 100 rounds per pairing, 2 guessers (`--bribe`, `--open-hand`),
2026-10-26: under **Bribe** the guessers crack far more (hard against hard: 24 %
stumped, against 61–80 % without), since a clue from the deck narrows the card list
more than a letter does, and each costs the same point. Under **Open hand** a hard
debauchee picking from the whole set is nearly uncrackable (96 % stumped against hard
guessers, 77 % against medium) while an easy one is cracked as usual; the kind variant
for new players is kind only when the debauchee is new too. Both are AI behaviour, for
the playtest to weigh.

## 8. MCP surface

- `createSession`: 2–8 players; options `seed`, `tiles` (`table` | `server`), `timer`
  (`laps` | `sand`), `tilesPerReveal`, `rounds` (default by player count),
  `firstDebauchee` (a seat; default random, since "whoever most recently got away with
  something" is the table's call), `bribe`, `openHand`, `house` (Q7).
- `getLegalMoves` per phase and seat; `next_step` names the phase in plain words
  ("Ann is the debauchee and is choosing a word", "Ben's turn to place a tile, two
  tiles until the next reveal").
- `getPlayerView` / `getPublicView` as in section 3; `applyMove` returns the table-facing
  summary ("Check: GLAD — yes. Round over. Ben, Cat and Dev score 4.").
- Choices: a `PlayerChoice` for every decision a human makes (word, three cards,
  judgment answers, the reveal letter) so nothing is decided for the player.
- `get_rules` from `rulesSections.ts` (rules.md split by heading, variants included).
- Report voice: the scorekeeper, dry; smirks allowed, never a hint, never the word.
- Root README row, `examples/serve.mjs`, `scripts/smoke.mjs` entry.

## 9. Tests

- Engine: the scoring table from rules.md line by line; minimum 1; stump on the last
  letter; reveal takes from the build area when the pool is empty of that letter; a
  burned word is refused; a "no" word stays on the table; turn order survives reveals;
  laps and sand both trigger a reveal exactly once; game end by player count; ties share.
- Clue decks: any four cards drawn two and two with three played always include both
  kinds; copy counts match the appendix; every number clue's answer function agrees
  with the sample answers for HAPPY in the appendix.
- Data: section 5.
- AI: determinism by seed; every AI move is legal from `getLegalMoves`; the hard
  debauchee never plays *Shortest synonym* when a stingier hand exists; the guesser
  solver never proposes a word inconsistent with the clues.
- Harness: 200 rounds per difficulty pairing, reporting crack rate, reveals before a
  crack, and payouts by card difficulty, against the design notes' expectations (●○○
  cracked with 0–1 reveals most of the time; ●●● stumps about a third of the time).
  This shows what the AI does, not whether the game is balanced; balance is the
  designer's playtest.
- Smoke through the real server: one `table` game with an AI debauchee, one `server`
  game with AI guessers, both to game over.

## 10. Open questions (Q)

Numbered for the designer; my suggested answer follows each.

- **Q1 — Two ways to hold the tiles** (`table` with the table's own tiles and a trusted
  check; `server` with the pool and build area as text). Suggest: both, `table` the
  default, `server` forced whenever a guesser is AI.
- **Q2 — Timer in digital play.** Suggest: `laps` by default (the rules' own variant),
  `sand` available in `table` mode by reporting `timer_out`; in the duel, 5 tiles per
  reveal, about what 30 seconds allows one person.
- **Q3 — A human debauchee's secret.** Suggest: the word and hand appear only in that
  seat's private view; a table sharing one screen plays *The House* (Q7) instead.
- **Q4 — Judgment clues for the AI debauchee.** Suggest: add `opposite`, `goes_with`,
  `rhymes_with` and `register` to every card as a generated first pass for you to check,
  rather than having the AI redraw those cards.
- **Q5 — Burned words.** Suggest: a `burn WORD` report from whoever is relaying; a
  check on a burned word is refused as "burned", not answered "no".
- **Q6 — Check in `table` mode** is trusted as declared, tiles unseen. Suggest: yes.
- **Q7 — *The House* variant.** The AI is debauchee every round and the humans score as
  one team against it, for a shared screen and for playtesting clue and reveal balance
  fast. Suggest: add it to rules.md as a variant and ship it as the `house` option.
- **Q8 — Synonym floor.** 137 cards have four or five synonyms against the notes' six.
  Suggest: lower the floor to four and let the difficulty rule (●●● under four) stand;
  the test keeps listing anything under four.
- **Q9 — AI guessers read the deck** (the whole card list, never the hidden word).
  Suggest: yes; the deck is the printed card list every player can read.
- **Q10 — First debauchee.** Suggest: random unless `firstDebauchee` is given.
- **Q11 — Variants in v1.** Suggest: all four from rules.md, *Laps* and *Duel* in the
  core, *Bribe* and *Open hand* as the last step before playtest.
- **Q13 — The House, how long** (open). The printed variants don't say. Built, as an
  assumption until you rule: as many rounds as a normal game at that table size (twice
  round with 2–4 seats, once with 5–8), overridable with `rounds`. The AI debauchee
  under Open hand: medium always plays Letters, Vowels, Consonants (the stingiest
  three); hard picks greedily, one card at a time, by crack chance.
- **Q14 — A judgment answer on the synonym list.** Rhymes with may not be a listed
  synonym; Opposite and Goes with are not told. Suggest: no judgment answer may be on the
  list (the server refuses it, as it does a rhyme), and nothing the debauchee says is
  ever burned. Built: only the rhyme is refused today.
- **Q15 — Quoting a clue.** A guesser says "the opposite is sad": is "sad" burned?
  Suggest: no; only a word offered as the target burns. (The table reports burns, so this
  is a ruling for the table, not the server.)
- **Q16 — Spelling the secret word itself.** Suggest: a "no"; the list is the referee.
  Built so.
- **Q17 — The used word card.** Suggest: out of the game for the session, so a word is
  never heard twice. Built so.
- **Q18 — Two players.** Winning says twice each (4 rounds); the duel says four rounds
  each (8). Suggest: 4 by default; the duel sets `rounds: 8`. Built so.
- **Q19 — Inflections.** "Gladly" when GLAD is listed. Suggest: only the exact word said
  is burned. Built so (the table reports the word).
- **Q20 — Checks.** One check per completing tile; after a "no" the same player checks
  again only after another tile. Suggest: yes. Built so with server tiles.
- **Q21 — Open hand with three number clues.** The sentence allows it. Suggest: allow it
  (literal). Built so.
- **Q22 — The House: who goes first, ties.** Suggest: the seat to the house's left, in seat
  order, every round; a tie is a shared win. Built so.
- **Q23 — A vowelless word.** SHY, CRY, SKY, DRY are in the deck. Suggest: First vowel
  answers "none", Vowels 0. Built so.
- **Q24 — Redrawing unknown words.** Suggest: no; choose one of the three. Built so.
- **Q12 — Difficulty rule** (open). The design notes' rule needs every synonym's
  grade and the deck grades only 650 of 3,041 synonyms; with deck grades alone one
  card in 500 is ●○○. Built, as an assumption until you rule: ●○○ for grade 1–2,
  ●●● for grade 5 and up or under four synonyms, ●●○ otherwise. That matches all
  thirteen sample cards in the design notes that are in the deck (TIRED is not) and
  spreads the deck 273 / 156 / 71, against the notes' target of about half, a
  third and the rest. A graded word list for the synonyms would let the printed
  rule stand; say which you want.

## 10a. Risk register and divergence ledger

Every open question above, triaged the way the port-planning runbook asks, and the
deliberate differences between the printed rules and this edition.

| Question | Triage | Where it stands |
|---|---|---|
| Q1 tiles, Q2 timer, Q6 table checks, Q10 first debauchee | must-answer-now (they shape the move set) | ruled 2026-10-26; built |
| Q3 the debauchee's secret, Q5 burned words, Q9 AI reads the deck | default-and-disclose | ruled; built as the defaults |
| Q4 judgment answers on every card | default-and-disclose | generated first pass; to check at the table |
| Q7 The House, Q11 variants | default-and-disclose | ruled; built in milestone 6 |
| Q8 synonym floor of four | parameterize-and-measure | ruled; `words.test.ts` lists cards under four |
| Q12 difficulty rule | parameterize-and-measure | open; built as a stand-in by headword grade; the harness reports by difficulty |
| Q13 rounds under The House | default-and-disclose | open; built as a normal game's count |

Ambiguities the second enumeration and the rules encoding raised are listed in §14 with
their resolutions; those still open are Q14 onward in §10.

**Divergence ledger** (frozen at handoff; the build authored none of its own):

1. The server cannot hear the table, so two printed rules are the table's to keep, not
   the server's: "never suggest a letter" and "say nothing else about the word". The
   server refuses only what it can see (the word itself as a judgment answer, a listed
   synonym as a rhyme) and burns words the table reports.
2. Under `laps` (the digital default) there is no sand: a reveal comes when the turn
   returns to the first guesser, the printed "Laps instead of sand" variant. The sand
   timer is `timer: sand`, reported by the table.
3. With server-held tiles the check must ride on the completing tile or follow at once
   from the same player, since the server cannot see a finger pointing. With the
   table's own tiles a check is trusted as declared (Q6).
4. The debauchee's reveal row shows letters, never positions, as printed; the server
   shows the count too.
5. The 1-point minimum on a crack and the stumped payout are as printed. No other
   number differs from the rulebook.

## 11. Milestones

One commit per piece, in this order:

1. Package scaffold, data pipeline (`words.csv` → `words.ts`), clue and tile data, data
   tests; the docs move into `rules/`.
2. Engine: deal, clues, build area, reveals, checks, burns, both timers, scoring, round
   and game end, views, next_step, rules sections.
3. AI debauchee, three tiers.
4. AI guessers, three tiers, and the harness report.
5. MCP seam, choices, report voice, README, smoke, root README and `serve.mjs`.
6. Bribe, Open hand, The House (if ruled in).
7. Designer playtest; rulings recorded at the top of this file.

## 11a. How the engine does it (milestone 2 notes)

- A "Check!" rides on the tile that completes the word (`check: true` on `place` or
  `move`), or follows as its own move by the same player before anyone else acts.
  With the table's own tiles, `check { word }` is trusted as declared.
- With the table's own tiles the server keeps no guesser turn order: any guesser may
  check or call a reveal, and the table reports the timer (sand or lap) itself. With
  server-held tiles the server counts laps and refuses a reported timer under `laps`.
- A round ends straight into the next deal; the result is in the public view's
  `last_round` and the summary. The three played clue cards go under their decks at
  the round's end, the buried fourth as soon as it is buried.
- Removing a tile from a row closes the gap; an emptied row disappears.
- Answers to the four judgment clues: a human debauchee answers in their own words or
  takes the card's answer; the word itself is refused, and a rhyme on the synonym list
  is refused. An AI debauchee answers from the card.

## 12. Status

2026-10-26: plan written and Q1–Q11 ruled (see the top). Milestone 1 built: package
scaffold, `rules/` (the docs moved here), `words.csv` with the four judgment columns
(a generated first pass: the rhymes were picked by ear, the registers lean
"everyday" with no slang, and ANGRY→hangry, NERVOUS→service are loose), the
`words.csv` → `words.ts` / `words.md` pipeline, clue and tile data, data tests. Q12
open. Milestone 2 built: the engine (deal, clues, build area, reveals, checks, burns,
both timers, scoring, round and game end), legal moves, views, next step and rules
sections, 77 tests. Milestone 3 built: the candidate solver (`ai/solver.ts`) and the
AI debauchee in three tiers (`ai/debauchee.ts`), 89 tests. Milestone 4 built: the AI
guessers in three tiers (`ai/guesser.ts`), the dispatcher (`ai.ts`) and the harness
(`scripts/harness.mjs`), 98 tests. Milestone 5 built: the MCP seam (`index.ts`,
`choices.ts`, `guidance.ts`, `moveGates.ts`), registered in the root README, the serve
example, the smoke, `scripts/dev.ts` and `GAMES.md`; the smoke plays an all-AI game
through the real server. Main was merged in the same day (CLAUDE.md, GAMES.md and the
per-game `src/dev` convention); checked against `building-a-game.md`: the first
debauchee is now a setup step a person at the table answers (the server draws only
for an all-AI table), there is a setup checklist, move gates agree with the legal
moves (locked by test), clue cards are accepted by their printed names, and the zone
table sits at the top of `types.ts`. No `src/dev` hooks yet (like Demon Hunter). 109
tests. Milestone 6 built: the `bribe`, `openHand` and `house` options (§4), in the
engine, the menu, the gates, the next step, the views, the catalog, the rules text and
both AIs (the hard guesser prices a letter against a clue from either deck; the hard
debauchee searches the whole set greedily under Open hand); The House added to
rules.md (Q7); Q13 opened; 119 tests. Next: a game from the human seat through the
real server, then the records the runbooks ask for (§13).

## 13. Against the runbooks (2026-10-26)

Checked after merging main, which moved to `@zekel/dev` 0.1.2 (the runbooks ship
with it: `node_modules/@zekel/dev/docs/README.md` has the order). The tool checks
run today: `pnpm harness` 0 errored games at 2, 3, 5 and 8 players (n=30 each),
`pnpm human-seat-sweep` 35 of 35 runs clean, `pnpm check-summaries` no problems,
`pnpm choice-catalog` generates 15 rows. The gaps are in the records and the
later steps, step by step:

| Step | Record | Have | Missing |
|---|---|---|---|
| Plan | `PORT-PLAN.md` | this file, renamed 2026-10-27: sources (§0), the feature inventory (§4a), the second enumeration (`rules/counter-pass.md`), the rules encoding (`src/dev/verify/encoding.ts`, lint clean), the risk register and divergence ledger (§10a), the review gate (§14) | the designer's answers to Q12–Q24 |
| Build | `PORT-NOTES.md` | the file (2026-10-27); zone table in `types.ts`; data tests; rules sections and move gates; the hooks; printed names; conservation tests; smoke, harness and tests green | — |
| Post-port | `POST-PORT.md` | the file (2026-10-27): the traceability matrix, the view-completeness test, a game walked from the human seat through the real server (two findings, both fixed), the rules checker (`src/dev/verify/`: 48 random games silent, a hunter batch), sweep, summaries, catalog | the designer's answers |
| AI | `AI-NOTES.md` | the file (2026-10-27): easy is now a true random floor; medium beats easy 100 %, hard beats medium 60 % (CI clear of 50 %); every choice point's policy | no strategies or MCTS (by design); the AI never rearranges tiles, burns or reports the timer (recorded gaps) |
| Desync | a `GAMES.md` cell | — | not run (needs Ollama); likely needs `src/dev` desync hooks for how a person says a tile move; the table-tiles mode is the real case |
| Relay | `RELAY-NOTES.md` | — | not run |
| Balance | `BALANCE.md` | `getBalanceAxes`: tiers, timer, players | `src/dev/index.ts` with `analysis.isDeadTurn` (today every turn reads as dead) and `leaderScalar`; sweeps for tiers and timer (the harness reports both unexercised); the file |
| Integration | `INTEGRATION-NOTES.md` | — | `STRATEGY-GUIDE.md`; a LibreChat run; the file |
| Viz (optional) | `VIZ-NOTES.md` | — | nothing started; no `webAssetsDir` |

And, outside the steps: a real game played by a person with a real chat
assistant, with the date and model written down.

In the runbooks' order the next work is: `PORT-NOTES.md` and the plan's missing sections, then the rules
encoding and the second enumeration, then the post-port walk from a human seat
and `POST-PORT.md`, then `AI-NOTES.md` with the `src/dev` hooks, then the three
harness steps and integration.

## 14. Review gate

**The second enumeration** (port-planning runbook §3a, a rulebook-only game):
`rules/counter-pass.md`, 108 rows and 22 silent-or-vague items, written on 2026-10-27
by a fresh model given `rules/rules.md` and nothing else. Diffed against §4a:

- Every mechanical row of the second pass is in §4a, mostly at a coarser grain (one row
  per clue card there against one per deck here; "return a tile" inside "move"; "the
  current turn finishes" inside the sand-timer row). Non-mechanical rows it has and
  §4a lacks: ages 10+, the score pad, the bracketed HAPPY answers. Nothing it found is
  missing from the engine. Agreement was re-read against the page for every row that
  carries a number (counts, copies, scoring).
- Its 22 gaps were merged with the rules encoding's 37 below.

**The rules encoding** (§3b): `src/dev/verify/encoding.ts`, 157 entries (120 rules, 27
silent, 10 vague) and 479 not-applicable cells over 14 zones × 43 event kinds, written
blind from `src/dev/verify/rules-v1.txt` and the types alone. `pnpm verify-lint --
--game=word-debauchee`: no structural problem; 37 recorded gaps.

**Reconciliation.** Every gap from both passes, with where it stands. "Built" means the
engine already does this and the plan discloses it; a Q is a question for the designer.

| Gap | Resolution |
|---|---|
| Who may check, when; is a check free; two checks a turn | built: on the completing tile, by its player, free, one per tile (Q20) |
| A burned word that is checked | ruled Q5: refused as burned, never answered |
| Scope of "burned": quoting a clue; inflections; words the debauchee says | Q15, Q19, Q14 |
| Spelling the secret word itself | Q16 |
| "Nothing else may be said" binds the debauchee | built: read so |
| Sub-runs and crossings; vertical or diagonal words | built: a server row is one word read left to right; a table check is trusted as declared |
| Which build-area tile a reveal takes when the pool is empty | **was a bug**: the engine chose; now the debauchee says which row (`reveal.row`), 2026-10-27 |
| No tile of the letter anywhere | cannot happen: no word in the deck needs more of a letter than the set has (checked) |
| Letter multiplicity; the row is the word's letters exactly | built: one reveal per occurrence, stumped at the word's length |
| Sand running out during or between turns | the table reports it; a reveal already owed is not owed twice |
| Unanswerable judgment clues; First vowel with no vowel | built: the card answers ("it has no opposite", "none"); Q23 |
| Difficulty 1–3 against dots | built: one dot is 1 |
| Where played cards and the used word card go | built: played clues under their decks; the word card out (Q17) |
| Clue deck exhaustion | cannot happen: the cards return each round |
| Two-player length: 4 or 8 rounds | Q18 |
| Bribe: who decides, timer restart, duplicates, a judgment clue, where the card goes | built: the caller; the timer flips; a duplicate still counts; answered aloud (own words if human); under its deck at round end |
| Laps: Reveal! exists, resets the lap | built so |
| Open hand: duplicates; three number clues | built: three different cards; Q21 |
| The House: round count, who goes first, ties, team scoring | Q13, Q22 |
| Duel: no turns while the sand runs | built: `tilesPerReveal` under laps; under sand the table reports |
| Tie-break beyond sharing | built: none; ties share |
| Wrong answers, check mistakes, rule-breach penalties, burn bookkeeping | not the server's: it answers from the card and burns what the table reports |
| Unknown words, redraw | Q24 |
| Multiword or unspellable synonyms | cannot happen: every synonym is one word the tile set spells (checked) |
| "The best debauchee wins" against highest total | built: highest total, as Winning says |
| First debauchee undecidable | built: the table says; the server draws only for an all-AI table |

**The clue deal** (found in the human-seat walk, 2026-10-27, not by either pass): the
engine dealt the four clue cards with the three words, so a debauchee saw their clues
before choosing a word and the hard tier chose by them. The rules draw the clues after
the word is chosen. Fixed: `dealClues` runs on `choose_word`; no tier reads the hand
before then.

**Sign-off.** Coverage of the printed rules: the designer's rulings of 2026-10-26
(Q1–Q11) stand as the review of §1–§10; §4a and the two independent passes agree on
the mechanics. Open for the designer: Q12, Q13 and Q14–Q24 above, batched for one
answer.
