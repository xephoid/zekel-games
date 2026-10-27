# Relay notes — Word Debauchee

The relay harness checks that a model's words about an AI turn carry enough for a
person to carry it out on the table (the relay-harness runbook). Runs on 2026-10-27
with `qwen3.8:latest` as relayer and reader on the local Ollama, seed 1, 2 seats,
AI seats at medium. Raw output in `harness-out/relay-*.txt` (local).

## Scout (no model)

13 AI batches in a 53-step game. The hardest are the guesser's building turns (five
or six moves each: tiles placed, rows made, a check answered), complexity 19–29; the
debauchee's reveals are simple (one move, complexity 6–7).

## Calibrate (the reader's best, raw JSON in place of words)

The top three batches (3, 9, 2) matched 3 of 3 repetitions each: the round trip can
carry them.

## Probe (live words)

First probe: batch 2 diverged. The relay text carried every fact (5 of 5) but the
reader rebuilt 1 of 5 moves, with three apply failures. Cause, class A at the round
trip: the summary names a row by its letters ("the AI adds X to E, making EX"), but
`place`, `move` and `check` took only a row index, which no words carry. The fix is
the runbook's standing one: the engine now accepts a row by the letters it reads
(`resolveRow` in `apply.ts`), in every move that names a row, with an ambiguous text
refused by row number. Locked by `engine.test.ts`.

The first full game diverged at step 7 for the same reason (the model's build area
read `["H","R"]` against the table's `["H","ROAM"]`).

Second probe and full game, after the fix: see the lines below.

## Judgment per probed batch

- Batch 3 (six moves: tiles placed in new rows and onto rows, a check answered "no"):
  with rows named by their letters, a person can act on the words.
- Batch 9 (five moves, "adds X to E, making EX"): the same.
- Batch 2 (five moves, two new rows and two additions): the same.

Leaks: none in any run (the secret word never appears in a relay).

## Status

Second run pending in this record: the probe and the full game were rerun after the
fix; their verdicts are appended when they finish.
