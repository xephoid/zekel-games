# Post-port verification — Word Debauchee

The post-port record for `@zekel/word-debauchee`, 2026-10-27, in the section order of
the post-port runbook (the public example is 8-bit Demon Hunter's). A line is green only
when the code and a test say so; what is not done says so.

## 1. Provenance and sources

`rules/rules.md` (Zekel Games' own rulebook, pinned verbatim as
`src/dev/verify/rules-v1.txt`), `rules/design-notes.md`, `rules/words.csv` (500 cards).
No reference implementation. Rulings: PORT-PLAN.md top (2026-10-26, Q1–Q11); open
questions Q12–Q24 in PORT-PLAN.md §10.

## 2. Zones, view completeness, hidden zones against the move list

**Zones** (from the `types.ts` header, verified against the engine): the word deck,
the three dealt words, the chosen card and the clue hand are server-held and hidden
(the dealt words, the card and the hand shown to the debauchee's seat only); the played
and bribed clues, the revealed letters, the burned words, the checks and the scores are
server-held and public; the tiles are the table's own (`tiles: table`) or server-held
as text (`tiles: server`), public either way. No shared hidden deck is drawn from by
anyone but the server, so there is no report-then-deal flow.

**§1a view completeness:** `src/__tests__/viewCompleteness.test.ts` rebuilds the
table from the public view at every step of all-AI games under every variant (settings,
seats and scores, the played clues with answers, the revealed row, the bribed clues,
burned words, checks, the pool by letter, the build area row by row in the same frame
the moves use, whose turn, turns until the next reveal) and the debauchee's secret from
their view (dealt words, the word, its card, the hand, the letters still to reveal),
and checks a guesser's view carries no secret. Face-up facts are all public; the only
hidden things are the debauchee's by rule.

**§1b hidden zones against the move list:** the one zone the server may not hold is
the table's own tiles. A person at such a table is offered `check` (naming the word),
`call_reveal`, `burn` and `timer_out` (`legalMoves.test.ts`), which is every action the
rules give a guesser that the server could act on; the tile moves are theirs to make
unseen. A human debauchee is offered every word, every play and every letter.

## 3. Mechanics traceability matrix

Rule → status → code → test. The rules are the 63 rows of PORT-PLAN.md §4a; here one
row per group, every status `implemented`.

| Rules (§4a rows) | Code | Test |
|---|---|---|
| Players, components, counts (1–6, 58–60) | `round.ts` MIN/MAX_PLAYERS; `tiles.ts`, `clues.ts`, `words.ts` | `tiles.test.ts`, `clues.test.ts`, `words.test.ts` |
| The card: facts, the list as referee, vowels, grade (7–11) | `wordCard.ts`, `deck.ts` isSynonymOf | `words.test.ts`; `engine.test.ts` checks |
| Setup: pool, decks, first debauchee (12–14) | `round.ts` createState, `apply.ts` chooseFirstDebauchee | `engine.test.ts` setup |
| Three words, keep one, bury two (15–16) | `startRound`, `chooseWord` | `engine.test.ts` setup; `viewLeak.test.ts` |
| Two and two clues after the word; play three, one of each; bury the fourth (17–20) | `dealClues`, `playClues` | `engine.test.ts` setup and clues; the checker's `two-and-two-dealt`, `three-clues-played-one-of-each` |
| Truthful answers; judgment clues in own words; nothing else said (18, 21, 61–62) | `playClues`, `answerClue` | `engine.test.ts` clues; checker `fact-clues-answered-from-the-card` |
| Repeat on request (22) | the played clues stay in every view | `viewCompleteness.test.ts` |
| Turn order clockwise from the left (24) | `startRound` guessers, `endTurn` | checker `guessers-clockwise-from-the-left`, `one-action-then-the-next-guesser` |
| One action: place, move or return, Reveal!; no pass (25–28) | `place`, `moveTile`, `callReveal` | `engine.test.ts` building; checker `place-takes-one-tile-from-the-pool`, `move-keeps-or-returns-one-tile` |
| Build anywhere, several rows (29) | `buildArea` rows | `engine.test.ts` |
| Burned words never score (30) | `burn`, `checkWord` | `engine.test.ts` burns; checker `burned-word-cannot-score` |
| Hints allowed; never a letter; the debauchee silent (31–33) | the table's; guidance and next step | `index.test.ts` guidance |
| Check on the completing tile, yes or no only, one straight line, a "no" word stays (34–37) | `check`, `checkRow`, `checkWord` | `engine.test.ts` checks; checker `check-is-yes-iff-on-the-list` |
| The sand runs out; what a reveal is; the debauchee picks the letter; pool empty; resume (38–42) | `timerOut`, `reveal`, `rowsWith` | `engine.test.ts` reveals and the build-area row; checker `reveal-lays-a-letter-of-the-word` |
| Round ends cracked or stumped; the card turned up (43–45) | `checkWord`, `reveal`, `endRound` | `engine.test.ts`; checker `stumped-when-the-last-letter-is-down` |
| Scoring, the four example rows, after the round (46–49) | `payouts`, `endRound`, `startRound` | `engine.test.ts` scoring table; checker `payouts-as-printed`, `next-round-to-the-left-with-a-fresh-table` |
| Game length; highest total, ties share (50–51) | `defaultRounds`, `winners` | `engine.test.ts`; checker `game-ends-after-the-rounds`, `highest-total-wins-ties-share` |
| Laps, Bribe, Open hand, the duel, The House (53–57) | `settingsFrom`, `callReveal`, `playClues`, `tilesPerReveal`, `house` | `variants.test.ts`; checker `laps-…`, `bribe-…`, `the-house-is-debauchee-every-round` |

## 3a. The rules checker

`src/dev/verify/`: the pinned text, the paper encoding (157 entries, lint clean), the
projection, 27 checking rules each quoting the text (`oracleCitations.test.ts`), and
the adapter. Random-play calibration: `oracle.test.ts` plays 48 random games across
2–5 seats, three kinds of table and the four variant settings with no error and no
disagreement; `pnpm verify-hunt -- --game=word-debauchee --mode=random --games=1000`
(2026-10-27): 1,000 games, no driver error, no disagreement.

**The hunter** (`--mode=hunt --pop=40 --gens=20 --games-per=12`, 9,600 games a run):

1. First run: no disagreement, but 2,367 games hit the 600-move cap. The evolved
   strategy burned a word every turn at a table with its own tiles, where nothing but a
   timer report moves the round on. Burning is always legal and changes nothing after
   the first, so this is the glue's problem, not the engine's: the adapter now offers
   one burn a round.
2. Second run: no disagreement; 5 driver errors, all one thing: the move menu offered
   "Reveal! and take a number clue" after a strategy that bribed every turn had drained
   the number clue deck, and the engine then refused it. **A real bug**, in the menu:
   random play never empties a deck. Fixed in `legalMoves.ts` (no bribe from an empty
   deck) and locked by `variants.test.ts`.
3. Third run: 9,600 games, no driver error, no disagreement. The best surviving
   strategy (answer clues, burn, play clues, move tiles) finds nothing.

## 4. Edge cases

- Deck exhaustion: the word deck loses one card a round (at most 16 of 500); the clue
  decks get every card back each round, so neither runs dry. A bribe from an empty deck
  is refused (cannot happen in practice).
- A letter the pool lacks: the reveal takes it from the build area, and the debauchee
  says which row when more than one has it. No word in the deck needs more of a letter
  than the set holds.
- Empty build area: `move` is withheld with a reason. No legal move: never; a guesser
  can always call "Reveal!".
- Simultaneous end: a "yes" on the tile that also completes a lap ends the round before
  the owed reveal.
- Numeric extremes: `rounds: 1`; 8 seats; a single guesser (laps are `tilesPerReveal`
  tiles); the 1-point floor.

## 5. Design choices

Forced by the physical-first split: the server polices only what it can see (the
divergence ledger, PORT-PLAN.md §10a). Discretionary readings: PORT-PLAN.md §14's table,
each either built as the plain reading or raised as a question.

## 6. Choice catalog

Generated from `src/choices.ts` by `pnpm choice-catalog -- word-debauchee` on
2026-10-27; never hand-written.

| Choice | Owner | How it reaches the player | AI policy | Balance axis |
|---|---|---|---|---|
| Whether the table uses its own tiles or the server holds them as text (`who-holds-the-tiles`) | **player** | `options.tiles` | — | tiles |
| Laps of the table or the 30-second sand timer (and, in a duel, tiles per reveal) (`which-timer`) | **player** | `options.timer` / `options.tilesPerReveal` | — | timer |
| Which printed variants are on: Bribe (a clue instead of a letter on "Reveal!"), Open hand (the debauchee picks any three clue cards), The House (the AI is debauchee every round, the people one team) (`variants`) | **player** | `options.bribe` / `options.openHand` / `options.house` | — | variants |
| Who is the first debauchee (whoever most recently got away with something) (`first-debauchee`) | **player** | `choose_first_debauchee` / `options.firstDebauchee` | — | — |
| How many rounds the game runs (`how-many-rounds`) | engine — The rules fix it: once round the table with 5–8 players, twice with 2–4. An option overrides it. | `options.rounds` | — | — |
| Which of the three dealt word cards to keep (`which-word`) | **player** | `choose_word` | — | — |
| Which three of the four clue cards to play, and so which to bury (Open hand: any three from the whole set, one a number clue) (`which-clues`) | **player** | `play_clues` | — | — |
| How to answer Rhymes with, Opposite, Register or Goes with: in your own words, or with the card's answer (`judgment-answer`) | **player** | `answer_clue` | — | — |
| Which letter of the secret word to lay down when a reveal is owed (`which-letter-to-reveal`) | **player** | `reveal` | — | — |
| Which tile to take from the pool (`which-tile`) | **player** | `place` | — | — |
| Which row, and where in it, the tile goes: a new row or an existing one (`where-to-put-it`) | **player** | `place` | — | — |
| Which tile in the build area to move, where to, or whether to return it to the pool (`move-a-tile`) | **player** | `move` | — | — |
| Whether to call "Check!" on a word you completed (`check`) | **player** | `check` / `place` / `move` | — | — |
| Whether to spend your turn calling "Reveal!" for a letter instead of acting (`call-reveal`) | **player** | `call_reveal` | — | — |
| On "Reveal!", whether to take a letter or the top card of the number or the word clue deck instead (`bribe`) | **player** | `call_reveal` | — | — |
| Reporting a word a guesser said aloud, which then cannot score (`burned-word`) | **player** | `burn` | — | — |
| Reporting that the sand ran out, or that the turn came back round at a table with its own tiles (`timer`) | **player** | `timer_out` | — | — |

The AI policy for each in-game row is AI-NOTES.md §7; the balance axis for the setup
rows is `getBalanceAxes()` (tiers, timer, players, variants).

## 7. Turn-action structure

A round: the debauchee keeps one of three words, draws two and two clues and plays
three (answering any judgment clue in their own words); then the guessers take one
action each in turn (place, move or return a tile, or "Reveal!"), checking on a
completing tile, until a "yes" or the last letter. A reveal is owed every lap (or when
the sand runs out, reported) and the debauchee chooses the letter. Then scores, and the
next debauchee to the left.

## 8. next_step and pending hygiene

Every human-owed step names its move: the first debauchee (setup), the word, the three
clues, each judgment answer, the letter to reveal (with the row when the pool lacks it),
and a guesser's one action. For an AI seat the step says to let the server play it.
`pnpm human-seat-sweep -- --games=word-debauchee`: 35 of 35 runs clean. Every pending
clears: a judgment clue with the card's answer, a reveal with any remaining letter.

**The walk from a human seat** (2026-10-27, me as Zeke against a medium and a hard AI,
three rounds, through the real server over HTTP with sqlite sessions): every step's
directive was right and the move menu offered the right things; the summaries carried
every fact. Two findings, both fixed and tested:

1. The clue hand was dealt with the three words and shown before the word was chosen;
   the rules draw it after. Now `dealClues` runs on `choose_word`.
2. When the pool had no tile of a letter, the engine chose which build-area row to take
   it from; that choice is the debauchee's. Now `reveal` takes a `row`, listed in the
   menu, and is refused without one when several rows hold the letter.

Noted, not a bug: under laps with two guessers a reveal comes every two tiles, so a
crack pays little (RISKY after five reveals paid 1); the design notes assume a sand timer
at a bigger table. For the playtest.

## 9. Logging path

`getScoreboard` (score, rounds as debauchee, stumps, cracks against). Every move's
`state_summary` is written to be spoken: `pnpm check-summaries -- --game=word-debauchee`
checked 820 strings with no problems; `viewLeak.test.ts` keeps the secret out of every
summary and next step.

## 10. Schema

`WordDebaucheeState` gained `settings.bribe`, `settings.openHand`, `settings.house`,
`round.bribed` and `history[].bribes` on 2026-10-26 before any session was saved
outside this branch; a session saved before then would load with those missing. No
migration exists; add defaults on load if such a session turns up.

## 11. Rules ambiguities

PORT-PLAN.md §14 (the reconciliation table) and §10 (Q12–Q24).

## 12. Out of scope

Nothing printed. The server does not hear the table (talk, hints, letters suggested).

## 13. Sign-off

- 2026-10-27: 1,581 tests across the repo pass (152 in this package plus the
  checker's 29); `pnpm build` and `pnpm smoke` pass; harness 0 errored games at 2, 3,
  5 and 8 players; human-seat sweep 35/35; summaries clean; the rules checker silent on
  1,000 random games and a 9,600-game hunter batch after one menu bug it found was
  fixed (§3a).
- Desync (2026-10-27, `qwen3.8:latest` on the local Ollama, 3 seats): NO DESYNC on
  seed 1 from seat 0 and from seat 1, on seed 2 from seat 2 in freeform mode, and on
  seed 3 with the model setting the game up itself; no fabricated confirmation in any
  run. Relay: NO RELAY DESYNC on two seeds and both seats after three round-trip
  fixes (RELAY-NOTES.md). Balance: BALANCE.md.
