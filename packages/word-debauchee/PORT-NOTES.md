# Port notes — Word Debauchee

The build record for `@zekel/word-debauchee` (the port runbook's `PORT-NOTES.md`),
written after the build on 2026-10-26, from the plan ([PORT-PLAN.md](PORT-PLAN.md))
and the code. The plan holds the rulings and the feature inventory; this file holds what
the build settled.

## 1. Scope

- Everything in `rules/rules.md`: the core game, both timers (laps and sand), both ways
  to hold the tiles (the table's own, or the server as text), and all five printed
  variants: Laps (the digital default), Two-player duel (`tilesPerReveal`), Bribe
  (`bribe`), Open hand (`openHand`) and The House (`house`).
- 2 to 8 players, any mix of people and AI seats, except that an AI seat that guesses
  needs server-held tiles (it cannot see the table's).
- Out of scope: nothing printed. The server does not police talking (divergence ledger,
  PORT-PLAN.md §10a).

## 2. Provenance

- Rules: `rules/rules.md` (Zekel Games' own text), pinned verbatim as
  `src/dev/verify/rules-v1.txt`. Design notes: `rules/design-notes.md`.
- Cards: `rules/words.csv` (500 rows); clue cards and tiles from the appendix.
- No reference implementation. Rulings: PORT-PLAN.md top (2026-10-26, Q1–Q11).

## 3. Zone categorization

From the top of `src/types.ts`:

| Zone | Truth held by | Seen by |
|---|---|---|
| Word deck (500 cards) | Server | Nobody (order hidden) |
| The three dealt words | Server | The debauchee only |
| The chosen word, its card | Server | The debauchee only, until the round ends |
| Number and word clue decks | Server | Nobody (order hidden) |
| The clue hand of four | Server | The debauchee only |
| Clues played and answered, bribed clues | Server | Everyone |
| Revealed letters, burned words, checks, scores | Server | Everyone |
| Tiles: pool and build area | The table (`tiles: table`) or the server (`tiles: server`) | Everyone |

There is no shared hidden deck anyone but the server draws from, and no opaque
human-held zone: every hidden thing is dealt by the server to the debauchee's seat and
shown in that seat's private view alone. The one zone the server may not hold is the
tiles, when the table keeps its own; then the server tracks no tile and the guessers'
only reports are a check, a reveal called, a burned word and the timer.

## 4. Data transcription and integrity tests

- `rules/words.csv` → `src/data/words.ts` by `scripts/build-words.mjs`
  (`pnpm --filter @zekel/word-debauchee build:words`); `words.test.ts` fails if the
  generated file is stale, and checks every card: 500 rows, unique words, letters =
  vowels + consonants, the counts match the word, every synonym a plain word, at least
  four synonyms (Q8), categories and types from the printed lists, the judgment
  columns present.
- `src/data/clues.ts`: 48 cards, copies as printed, every card answers itself from the
  card facts (the four judgment clues read the card's generated answer);
  `clues.test.ts` checks the counts and every HAPPY answer in the appendix.
- `src/data/tiles.ts`: 144 tiles as printed; `tiles.test.ts`.

## 5. Divergences

None authored by the build. The five in PORT-PLAN.md §10a (what the server cannot hear;
laps as the default; the check riding on the completing tile with server tiles; letters
without positions; no changed numbers) were set in the plan.

## 6. Build status by layer

| Layer | Where | State |
|---|---|---|
| Engine spine | `src/engine/round.ts`, `apply.ts`, `helpers.ts`, `errors.ts` | done |
| Setup | `choose_first_debauchee` (a person names the first debauchee; the server draws only for an all-AI table); The House skips it | done |
| Phases | setup → choose_word → play_clues → (answer_clues) → build ⇄ reveal → … → game_over | done |
| Actions | 11 move types (`src/engine/moves.ts`); printed clue names accepted; `clue` on "Reveal!" under Bribe | done |
| Scoring and end | `payouts`, `endRound`, `winners` (team scoring under The House) | done |
| Views and legal moves | `src/views.ts` (no leak, `viewLeak.test.ts`), `src/legalMoves.ts` | done |
| MCP wiring | `src/index.ts`: schemas, next step, gates, catalog, rules sections, guidance, physical setup, balance axes, reference data | done |
| AI | `src/ai/`: solver, debauchee and guessers in three tiers | done; see AI-NOTES.md |
| Dev hooks | `src/dev/`: balance analysis, sweeps, desync wording, the rules checker | done |

## 7. Choice catalog

Generated from `src/choices.ts` by `pnpm choice-catalog -- word-debauchee`: 16
decisions, 15 the player's and one the engine's (the round count, fixed by the rules;
an option overrides it). Every move type is covered. POST-PORT.md carries the table.

## 8. Open questions for post-port

Q12 (the difficulty rule) and Q13 (rounds under The House) in PORT-PLAN.md §10; the
items the second enumeration and the rules encoding raised in §14 there.

## 9. Build-check results (2026-10-26)

- `pnpm test`: 1,548 tests across the repo, 119 in this package.
- `pnpm build` (on Windows: `npx tsc -b packages/* && node scripts/copy-assets.mjs`
  from Git Bash) and `pnpm smoke`: an all-AI game to the end through the real server; a
  human seat gets the setup directive.
- `pnpm harness -- --game=word-debauchee --n=30 --players=2,3,5,8`: 0 errored games
  at every count.
- `pnpm human-seat-sweep -- --games=word-debauchee`: 35 of 35 runs clean.
- `pnpm check-summaries -- --game=word-debauchee`: 820 spoken strings, no problems.
- Component limits: `engine.test.ts` checks the 144 tiles are conserved across pool,
  build area and reveals through a round; `variants.test.ts` checks the 48 clue cards
  across the decks and the hand through bribes and Open hand plays.
