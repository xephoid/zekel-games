# AI notes — Word Debauchee

The AI record for `@zekel/word-debauchee` (the AI-development runbook's `AI-NOTES.md`),
2026-10-27. The AI lives in `src/ai/`: `solver.ts` (which cards of the deck fit the
clues and letters so far), `debauchee.ts`, `guesser.ts`, and `ai.ts` (one move for any
AI seat). Every seat is the same role in turn, so there are no identities to plan for;
the two halves of the AI are the debauchee's choices and the guessers' building.

## 1. Tier ladder

| Tier | The debauchee | A guesser |
|---|---|---|
| `easy` | a random word of the three; a random valid play of three cards; a random letter to reveal | uniformly random over the legal moves (never a report, never a fill-in): the floor |
| `medium` | the word that reveals slowest against its shortest synonym (`slowness`); bury the most giving card (`GIFT_ORDER`); reveal the commonest letter, a repeated one first (`quietestLetter`) | the synonym most of the fitting cards share, checked on the tile that completes it; "Reveal!" when more than 40 cards still fit and nothing is started |
| `hard` | the word and the three cards that leave a solver-guesser the lowest crack chance (`hardestPlay`; under Open hand a greedy search of the whole set, `hardestOpenPlay`); the letter whose reveal leaves the lowest chance | targets ranked by chance × payout; a reveal (or, under Bribe, a clue from either deck) when its expected value beats building now (`bestReveal`) |

**The stronger tier wins** (`pnpm harness -- --game=word-debauchee --n=200 --players=2
--difficulty=<a>,<b> --no-game-files --quiet`, 2026-10-27, seat rotation on):

| Pairing | Wins | Confidence interval |
|---|---|---|
| easy vs medium | medium 100 % (200 of 200; easy averaged 0.27 points, medium 19.02) | clear of 50 % |
| medium vs hard | hard 60.0 % (ties 12.5 %) | [53.1 %, 66.5 %], clear of 50 % |

So `hard` is a verified-strong heuristic; there is no `mcts` tier (§3).

## 2. Evaluation

The one "who is ahead" number is the score (`getScoreboard().score`), which climbs
during play and is what the balance analysis reads (`src/dev/index.ts` `leaderScalar`).
Within a round the guesser's own number is `crackChance`: the share of the fitting cards
that list the best shared synonym (`solver.ts`); the debauchee minimises it, the hard
guesser multiplies it by the payout.

## 3. Search

No MCTS. The game is a hidden-word race with free talk; a search tree over tile
placements would be large and the point of the game (talking) is not in it. The hard
tiers search what matters: the debauchee over its plays and letters, the guesser over
one reveal ahead (sampling up to 30 fitting cards, 12 for a bribed clue).

## 4. Strategies

None (`parseStrategy` not wired). The paths to victory are two: stump as debauchee
(long word, stingy clues, quiet letters) and crack as guesser (the most-shared synonym,
reveals bought only when they pay). Both are built into the tiers rather than offered
as archetypes, because every seat plays both roles in turn.

## 5. Dead turns

Defined in `src/dev/index.ts`: a turn is dead when the seat made no board progress
(a guesser who only called "Reveal!"); reports (a burned word, the timer, who goes
first) are not turns. Before the hooks existed the generic rule read every turn as dead.

## 6. Setup choices and the AI

The setup choices (who holds the tiles, which timer, the variants, the first debauchee)
are the table's; the AI plays whatever was set. It needs server-held tiles to guess.

## 7. In-game choice points

| Choice | AI policy |
|---|---|
| which word | easy random; medium slowest to reveal; hard lowest crack chance at its best play |
| which three clues | easy random valid play; medium bury the gift; hard lowest crack chance (greedy over the whole set under Open hand) |
| judgment answers | the card's printed answer (the engine answers for an AI seat) |
| which letter to reveal | easy random; medium quietest; hard lowest crack chance after it |
| which build-area tile when the pool has none | the longest row holding it (costs the guessers most) |
| which tile, where | toward the best target: continue its prefix row, else a new row; check on the completing tile; a complete unchecked row is re-completed by a same-row move |
| move a tile | only that re-completion; the AI never rearranges otherwise (an open gap, §9) |
| "Reveal!" | medium by the candidate count; hard by expected value; under Bribe medium takes the kind heard least, hard prices each deck |
| burn, timer | never: both are table reports |

## 8. Determinism

No `Math.random` in the AI; `rng.ts` is seeded (mulberry32) and the seam derives each
move's seed from the session seed and turn. `aiDebauchee.test.ts` and
`aiGuesser.test.ts` check the same seed gives the same move and the same game at every
tier. The only unseeded call is `randomSeed()` for a session created without a seed.

## 9. Mechanic coverage

A medium batch uses: choose_word, play_clues, place, check (on the completing tile),
call_reveal, reveal; under Bribe call_reveal with a clue; under Open hand play_clues
from the set. Never used by the AI: `burn` and `timer_out` (reports a table makes; an
AI table has nothing to report) and `move` beyond re-completing a row. Open AI gaps: an
AI guesser never rearranges tiles or returns one to the pool, and never spells a second
candidate alongside the first.

## 10. Performance

All synchronous. A hard guesser's reveal pricing is the costliest move (up to 30
solver runs for a letter, 12 × a deck's card types for a bribe); the all-AI harness
plays about 100 games of 2 rounds a second at medium. The hard debauchee's Open hand
search is about 60 solver runs per word.

## 11. Balance-ready checklist

- [x] Three tiers, each stronger than the last (§1).
- [ ] `parseStrategy`: none (§4), by design.
- [x] `isDeadTurn` / `isRealTurn` in the dev hooks (§5).
- [x] `leaderScalar` + `getScoreboard` (§2).
- [x] Every setup choice is the table's (§6); every in-game choice has a policy (§7).
- [x] No `Math.random`; determinism tests (§8).
- [ ] The AI never moves a tile except to re-complete a row, never burns, never reports the timer (§9).
- [ ] No MCTS; `hard` is the verified heuristic (§1, §3).

## 12. Sign-off

2026-10-27. Tier check as in §1; harness outputs in `harness-out/tier-*.txt` (local).
`pnpm harness -- --game=word-debauchee --n=30 --players=2,3,5,8`: 0 errored games.
