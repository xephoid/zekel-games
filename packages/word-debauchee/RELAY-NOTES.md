# Relay notes — Word Debauchee

The relay harness checks that a model's words about an AI turn carry enough for a
person to carry it out on the table (the relay-harness runbook). Runs on 2026-10-27
with `qwen3.8:latest` as relayer and reader on the local Ollama, 2 seats, AI seats at
medium. Raw output in `harness-out/relay-*.txt` (local).

## Scout (no model)

Seed 1: 13 AI batches in a 53-step game. The hardest are the guesser's building turns
(five or six moves each: tiles placed, rows made, a check answered), complexity 19–29;
the debauchee's reveals are simple (one move, complexity 6–7).

## Calibrate (the reader's best, raw JSON in place of words)

The top three batches matched 3 of 3 repetitions each: the round trip can carry them.

## Probe (live words), and what it found

Two round-trip gaps, both class A in the runbook's sense (the words could not carry
the move), both fixed on the game's side of the wire:

1. **A row by its letters.** The summary says "adds X to E, making EX" but `place`,
   `move` and `check` took only a row index, which no words carry; the reader left the
   index unfilled and every later move in the batch failed. Fix: every move that names
   a row accepts the letters it reads (`resolveRow`); the AI guessers send the row that
   way (its number only when two rows read alike), since the harness blanks the AI's
   own move into the reader's template; the AI debauchee keeps a word by its position
   among the three cards (`choose_word.card`), so that move carries no secret either.
2. **The row a tile makes.** A reader (like a person) names the row by what it reads
   after the tile: "adds O to R, making RO" became `row: "RO"`. Fix: `place` and
   `move` accept the row's letters before or after the tile (`resolveRowForTile`).
3. **A clue card with its answer.** On seed 2 the relayer said the played cards as
   "Syllables: 2. Vowels: 2. Half the alphabet: A–M" and the reader sent those as the
   card names. Fix: the printed-name lookup reads the name before the colon.

Each fix is locked by `engine.test.ts`. After them the three probed batches matched
3 of 3 repetitions each.

## Full game

Seed 1, seat 0: **NO RELAY DESYNC**, 13 of 13 batches matched; a person executing only
the prose kept a correct board all game. Leaks: none in any run (the secret word never
appears in a relay; the AI's word choice is relayed as "keeps the first of the three
cards").

Seed 1, seat 1 (the other side of the table): **NO RELAY DESYNC**, 14 of 14 batches.

Seed 2, seat 0: the first run diverged on the third gap above; after the fix, **NO
RELAY DESYNC**, 15 of 15 batches.

## Judgment per probed batch

- Batch 3 (six moves: a word built tile by tile, a check answered "yes", the round
  scored, a new word kept and three clues laid): a person can act on the words.
- Batch 9 (five tiles onto rows named by their letters): the same.
- Batch 1 (a word built and checked "no", a new row, the reveal owed): the same.

## Status

2026-10-27: passed. Seed 1 from both seats and seed 2 are clean after the three
fixes; every fix has a unit test and the full suite passes. Re-run when a summary's
wording or the shape of a move changes.
