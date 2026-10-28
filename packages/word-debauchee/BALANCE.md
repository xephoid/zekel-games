# Balance — Word Debauchee

The dated verdict the balance runbook asks for. The raw findings are local
(`harness-out/balance-*.txt`, kept out of git).

**Verdict, 2026-10-27:** balanced across seats under good play, as the rules make it:
every seat is the debauchee the same number of times, so no seat and no first player has
an edge at 2, 3, 5 or 8 players, under the base rules, Bribe or Open hand. Ties are
common at 5–8 seats because every guesser scores the same in a cracked round. The one
imbalance is **The House**: how the house fares against the table depends on the AI
tier and the table size far more than on anything else, which is a question for the
designer (Q13) rather than a bug.

## The runs

`pnpm harness -- --game=word-debauchee --n=100 --players=2,3,5,8 --difficulty=<tier>
--game-options=<variant> --no-game-files --quiet`, seed 1, seat rotation on; eight runs:
hard and medium × base, `{"bribe":true}`, `{"openHand":true}`, `{"house":true}`.
Laps timer, server-held tiles (the sand timer is reported by a table and cannot be
simulated: the `timer` axis was not varied). No errored game in any run.

## Seats (the §2 outcome metric)

Win rate by seat, 95 % intervals (Wilson), n = 100 per cell. Every interval overlaps
every other in its row; none excludes the even share.

| Run | 2 seats | 3 seats | 5 seats | 8 seats |
|---|---|---|---|---|
| hard, base | 57 / 56 (ties 13 %) | 38 / 43 / 34 | 36 / 36 / 26 / 24 / 26 | 25 / 15 / 24 / 21 / 17 / 21 / 17 / 22 |
| medium, base | 54 / 54 | 31 / 38 / 40 | 30 / 33 / 37 / 40 / 26 | 29 / 22 / 29 / 26 / 26 / 22 / 17 / 21 |
| hard, Bribe | 62 / 62 (ties 24 %) | 38 / 36 / 34 | 27 / 24 / 26 / 29 / 26 | 23 / 17 / 19 / 13 / 13 / 20 / 19 / 22 |
| medium, Bribe | 53 / 58 | 32 / 43 / 38 | 31 / 37 / 32 / 36 / 24 | 32 / 22 / 26 / 21 / 26 / 21 / 20 / 34 |
| hard, Open hand | 71 / 42 | 43 / 38 / 42 | 36 / 28 / 30 / 31 / 30 | 18 / 24 / 18 / 24 / 18 / 16 / 21 / 28 |
| medium, Open hand | 58 / 57 | 38 / 40 / 38 | 30 / 36 / 46 / 40 / 34 | 33 / 35 / 40 / 28 / 33 / 31 / 29 / 41 |

Average score per seat is level too (8 seats, hard base: 20.2 to 21.4). The 2-seat
Open hand hard cell (71 / 42) is the one row worth a second look at n = 200; with
seat rotation both seats hold both roles equally, so it reads as noise.

## The House (seat 0 is the house, the rest the table)

| Tier | 2 seats | 3 seats | 5 seats | 8 seats |
|---|---|---|---|---|
| hard house | house 67 %, table 37 % | house 100 %, table 1 % | house 63 %, table 40 % | house 32 %, table 72 % |
| medium house | house 4 %, table 96 % | house 46 %, table 59 % | house 8 %, table 96 % | house 0 %, table 100 % |

A hard AI debauchee under laps stumps one or two guessers nearly every round (the
guessers lay one tile each per lap and a reveal comes every lap), and loses to seven.
A medium house loses to any table. So The House has no single balance: the table
size and the tier set it. For the designer, with Q13: whether the house should get a
different reveal pace by table size, or the tier should be the knob.

## Variants against the base (hard, 8 seats, average score per seat)

| Base | Bribe | Open hand |
|---|---|---|
| 20.5 | 32.1 | 10.2 |

Bribe hands the guessers more cracks (a clue narrows the card list more than a letter);
Open hand lets a hard debauchee pick three cards that hide the word (PORT-PLAN.md §7:
96 % stumped against hard guessers at two guessers). Both are AI behaviour under laps,
not verdicts on the printed game.

## Strategy diversity, feature lift, timing (§0, §3, §4)

No strategies are built (AI-NOTES.md §4), so there is no meta to read. The lift
tables show no clue card or action with a significant lift beyond "a reveal happened"
(a symptom of a slow round, not a cause). The §4 timing metrics need a `--trace` run
with `leaderScalar`, which the dev hooks now supply; not run this pass.

## Game shape (§5)

Ties: 8–13 % at 2–3 seats, 38–59 % at 5–8 (base). Dead turns (a guesser's turn that
only bought a reveal): hard 42 % at 2 seats, 12–14 % at 3–8; medium 1–4 %. The hard
guesser buys reveals freely at a small table because a letter is cheap against a
9-letter word.

## Not measured, and known AI gaps

The sand timer (`timer: sand`) and the duel's `tilesPerReveal` were not varied: both
are table-reported. The AI never rearranges tiles, burns or reports the timer
(AI-NOTES.md §9). Rules questions for the designer are in PORT-PLAN.md §10.

Re-run this when `src/ai/` or the rules change (`BALANCE.md` is the dated verdict the
status table reads).
