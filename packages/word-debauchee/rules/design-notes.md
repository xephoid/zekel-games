# Word Debauchee — design notes

Companion to [rules.md](rules.md). This is the *why*: every place the rules differ from
the first draft, the reasoning behind it, and what to watch for at the table.

## What the game is really about

Scoring in the draft looks like a co-op guessing game, but it isn't. Because every guesser
earns the same amount in a cracked round, a player's total is

```
score(i) = (sum of all guesser payouts) − (payout in i's own debauchee round) + (i's stump bonus)
```

The first term is the same for everyone. So the **ranking is decided entirely by each
player's turn as debauchee**: you climb by stumping the table, you fall by the size of the
payout the table takes off you. Guessing well only hurts the current debauchee, and it
helps every other player equally.

That is a coherent "one versus the table" game and the name fits it, so the rules keep
the draft's scoring as is. Guessers are a team with no individual stake, and that is the
intent: a bonus for the player who lays the completing tile was considered and rejected,
because it tempts guessers to hoard the last letter of a teammate's word.

One change: a **minimum of 1** on a cracked round, so a late crack still beats a stump.
Without it, a long secret word revealed four times against a short synonym goes negative
and punishes the guessers for the debauchee's reveals.

Since only the debauchee's round moves the ranking, an equivalent and simpler scoring is
to score the debauchee alone: *stumped = word length, cracked = letters revealed*. It
loses the incentive to spell a long synonym, which is worth keeping unless scorekeeping
proves fiddly at the table.

## Decisions taken (the draft's open questions)

**Q1 — What is a turn?** One action: place one tile, move one tile, or call a reveal.
Turn order keeps cycling across timer flips, so nobody loses a turn when the sand runs
out. One tile per turn is what makes "don't suggest letters" bite: your letter *is* your
suggestion. With 7 guessers and a 30-second timer, each guesser gets one or two tiles per
reveal, which is tight but survivable; the *Laps* variant exists for big tables.

**Q2 — Word source.** Cards, three drawn and one kept. Free choice lets a debauchee pick
a word with no synonyms, and the printed list is what makes judging fair. Three cards
keeps a little agency: the debauchee is being choosy, which is on brand.

**Q3 — "If anyone says the word."** It protects the synonym being built, and more: *any*
word a guesser says aloud is burned for the round. This turns table talk into the game's
heart (hint without saying it or spelling it) and removes the need for a judge of what
counts as "saying it". The secret word needs no protection: it is not on its own synonym
list, so spelling it gets a truthful "no".

**Q4 — Debauchee payoff.** Unchanged: word length if stumped, nothing if cracked. See
above for why this already drives the whole ranking.

**Clue cards.** Kept, as two decks of clue *types*, drawn two and two with three played.
The draw does three things that a fixed list printed on the word card could not:

- It constrains the debauchee. With a free choice from a fixed list, every debauchee
  learns the same three least-helpful clues and the clue step stops being a decision.
  A hand of four makes it a real one: which gift to bury.
- It lets the clue list grow past what fits on a word card. *Rhymes with*, *Opposite*,
  *Goes with* and *Shortest synonym* need the debauchee's judgment or the synonym list,
  and they are the clues that make the table laugh. The word card only has to carry the
  facts that need a referee (category, type, grade, difficulty) and the counts.
- The three cards stay face up all round, so a 30-second table has something to look at
  and the "repeat the clue" question answers itself.

Two decks and a two-and-two draw make the "one clue must be a number" rule enforce
itself: three cards from a hand of two number clues and two word clues always include
one of each. That is also why the number deck is the smaller one, 20 to 28: a number
clue is always in play, so there is less need for variety there.

**Ratios in the clue decks.** The copy counts weight the deck toward the bread-and-butter
clues (*Letters*, *Category*, *Type*) and keep the gifts (*Shortest synonym*, *First
letter*, *Goes with*) rare enough that a debauchee is sometimes forced to play one.

**Checking.** The draft never said how guessers learn they are done. "Check!" plus a
yes/no answer does it without the debauchee saying anything useful, and a "no" is itself
a clue, so wrong guesses cost time but teach something.

**Reveals.** Debauchee's choice of letter, order only, no positions. Revealing positions
would hand the guessers much more per reveal; keeping it to the bare letter keeps the
debauchee in the fight on long words. If the pool lacks the letter, the debauchee raids
the build area, which also stops tile scarcity leaking the word.

**Skipping.** Any guesser may call "Reveal!" instead of acting, on their own turn. The
draft's "the other player" was ambiguous about who decides; tying it to the turn means no
vote and no one can be out-voted on their own action.

**Game length.** Once each as debauchee with 5+ players is 5–8 rounds of up to about
three minutes. With 2–4 players that is too short to average out, so they go twice round.

## Word card data

500 cards is the real work. The facts on each card should be generated, not written by hand:

- letters, vowels, consonants and syllables are computed;
- grade comes from a graded word list (any of the public Dale-Chall, Fry or Dolch
  derived lists for 1–6, a vocabulary-by-grade list above that);
- difficulty is a rule: ●○○ if the word is grade ≤ 3 and has at least five grade ≤ 3
  synonyms; ●●● if the word is grade ≥ 7 or has fewer than four synonyms; ●●○ otherwise;
- the synonym list is a thesaurus pull, trimmed to single words of 3–10 letters, no
  inflections of the headword, no hyphens or accents, 6–10 entries.

A spread that plays well: about half ●○○, a third ●●○, the rest ●●●, and no category
over 15 % of the deck. Adjectives and verbs synonymise more readily than nouns; expect
them to dominate.

### Sample cards

| Word | L | V | C | Syl | Category | Type | Grade | Diff | Synonyms |
|---|---|---|---|---|---|---|---|---|---|
| HAPPY | 5 | 1 | 4 | 2 | Feelings | Adj | 1 | ● | glad, merry, jolly, joyful, cheerful, content, pleased, upbeat |
| BIG | 3 | 1 | 2 | 1 | Size & Amount | Adj | 1 | ● | large, huge, giant, vast, great, massive, enormous, jumbo |
| FAST | 4 | 1 | 3 | 1 | Qualities | Adj | 1 | ● | quick, rapid, swift, speedy, brisk, hasty, fleet |
| GRAB | 4 | 1 | 3 | 1 | Actions | Verb | 1 | ● | take, seize, snatch, clutch, grasp, grip, nab, catch |
| HOUSE | 5 | 3 | 2 | 1 | Places | Noun | 1 | ● | home, dwelling, abode, residence, lodging, cottage, quarters |
| SHOUT | 5 | 2 | 3 | 1 | Speech | Verb | 2 | ● | yell, scream, bellow, holler, roar, cry, bawl, call |
| ANGRY | 5 | 1 | 4 | 2 | Feelings | Adj | 2 | ● | mad, cross, furious, irate, livid, upset, fuming, heated |
| SMART | 5 | 1 | 4 | 1 | Qualities | Adj | 2 | ● | clever, bright, brainy, wise, sharp, keen, astute |
| BRAVE | 5 | 2 | 3 | 1 | Qualities | Adj | 2 | ● | bold, daring, fearless, heroic, valiant, gutsy, plucky |
| TIRED | 5 | 2 | 3 | 2 | Body | Adj | 2 | ● | sleepy, weary, drowsy, beat, exhausted, worn, spent, drained |
| STROLL | 6 | 1 | 5 | 1 | Actions | Verb | 3 | ●● | walk, amble, wander, saunter, ramble, mosey, roam |
| ENORMOUS | 8 | 4 | 4 | 3 | Size & Amount | Adj | 4 | ●● | huge, vast, giant, immense, massive, gigantic, colossal, mammoth |
| OBSOLETE | 8 | 4 | 4 | 3 | Qualities | Adj | 8 | ●●● | outdated, dated, old, antique, archaic, extinct, defunct, antiquated |
| MELANCHOLY | 10 | 3 | 7 | 4 | Feelings | Adj | 7 | ●●● | sad, gloomy, glum, blue, down, mournful, downcast, dejected, somber |

## Balance to watch

Rough expectations, to check against the first playtests:

- A ●○○ word should be cracked with 0–1 reveals most of the time (guesser payout 3–6).
- A ●●● word should stump the table maybe a third of the time (debauchee payout 8–10).
  If stumps are rare, the debauchee's role is boring; raise the stump payout to word
  length + 2 or shorten the timer to 20 seconds.
- A debauchee who always picks ●●● words should not be strictly right. Long words also
  reveal slowly, so the trade-off is built in, but check it.

## Playtest checklist

1. Is 30 seconds too short with 6–7 guessers taking one-tile turns? Try the *Laps* variant
   at the same table and ask which they'd keep.
2. Do guessers slack off because nobody gets individual credit for a crack? Watch for
   players who stop placing tiles once a teammate has a word going.
3. Do guessers call "Reveal!" early and often? That is fine if it feels like a gamble; it
   is a problem if it is always correct.
4. Does the debauchee ever feel like they have a decision after the clues are read? If
   not, try letting them choose the *position* of each revealed tile as well.
5. Do the printed synonym lists feel too generous or too stingy? Note every "that should
   have counted" and "that's not a synonym".
6. Does "any spoken word is burned" produce fun hinting or paralysed silence?

## Not decided yet

- **Timer length** for 7–8 players (30 s vs 45 s vs *Laps*). Playtest.
- **Clue hand size.** Two and two is the smallest hand that makes the number rule
  automatic. Three and three gives the debauchee more room to hide; try it if guessers
  are cracking ●●● words too easily.
- **Clue copy counts.** The 20/28 split and the per-card copies in the rules appendix
  are a first guess. Track which clues get buried most often across a few games.
