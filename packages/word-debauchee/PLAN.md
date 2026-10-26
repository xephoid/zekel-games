# Word Debauchee — MCP port plan

Plan for `@zekel/word-debauchee`, a game module for the zekel MCP server, built from
[rules.md](rules.md), [design-notes.md](design-notes.md) and the 500 cards in
[words.csv](words.csv). The printed rule is the rule; where this plan changes or adds
something for digital play it says so, and every open point is in section 10 for the
designer. Questions are numbered Q1… and rulings get recorded at the top of this file,
dated, as the Demon Hunter plan does.

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
package.json  README.md  LICENSE  PLAN.md (this file, moved)
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

**Variants** are options: `laps` and `duel` are part of the core flow above; `bribe`
(call reveal may take a clue instead of a letter, counted as a reveal) and `openHand`
(the debauchee picks any three cards from the whole set, one of them a number clue) come
after the core, as `bribe: true` and `openHand: true`. See Q7 for *The House*.

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
- **Q12 — Difficulty rule** (open). The design notes' rule needs every synonym's
  grade and the deck grades only 650 of 3,041 synonyms; with deck grades alone one
  card in 500 is ●○○. Built, as an assumption until you rule: ●○○ for grade 1–2,
  ●●● for grade 5 and up or under four synonyms, ●●○ otherwise. That matches all
  thirteen sample cards in the design notes that are in the deck (TIRED is not) and
  spreads the deck 273 / 156 / 71, against the notes' target of about half, a
  third and the rest. A graded word list for the synonyms would let the printed
  rule stand; say which you want.

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
AI debauchee in three tiers (`ai/debauchee.ts`), 89 tests. Not yet on the server: the
MCP seam is milestone 5.
