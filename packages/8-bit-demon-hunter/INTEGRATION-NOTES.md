# Integration notes — 8-bit Demon Hunter

Gate artifact for the zekel repo's `docs/integration-runbook.md`. The game
lives here rather than under `src/games/`, so the bot is run from the zekel
checkout with `--guide=../zekel-games/packages/8-bit-demon-hunter/STRATEGY-GUIDE.md`
and the notes live here. The game has one identity (`world_seed` is its only
balance axis), so one complete game covers the identity requirement.

Setup for every run below: assistant = the LibreChat "Zekel Assistant" agent
(`agent_P0UiKRZO7Zvv54RKvLrna`); player = `kimi-k2.7-code:cloud` through the
Ollama host; server = `zekel-mcp.ngrok.app` running this branch at commit
f849340 (before the loot-wording fix below).

## Runs 1 and 2 — 2026-10-21, aborted (harness)

- Run 1 (transcript `integration-8-bit-demon-hunter-2026-10-21T20-06-35-926Z.jsonl`),
  stopped at exchange 20. From exchange 6 the player model narrated the game
  instead of playing it: whole invented scenes, including a Dave the
  Blacksmith with a bandit-killing task that does not exist. The assistant
  echoed several of those inventions back as if they had happened and only
  sometimes corrected itself against the server. **Harness fix:** the
  assistant's reply now reaches the player inside a frame that ends "type
  your next chat message as Riley", and the player prompt says it is never
  the narrator. **Class C note:** the assistant accepted narration from the
  user as fact (exchanges 8, 10, 13, 14, 16).
- Run 2 (`…T20-14-47-274Z.jsonl`), stopped at exchange 6. The player sent
  "continue" three times in a row, even when the assistant plainly asked what
  to do. The harness was turning an empty parsed reply into a silent
  "continue". **Harness fix:** every raw player reply is recorded in the
  transcript (`player_raw`), an empty one is logged and the player is asked
  once more before the fallback. **Class C note:** on "talk to everyone"
  the assistant stopped after six of ten townsfolk and asked to continue.

## Run 3 — 2026-10-21, cap reached without game over

- Transcript `integration-8-bit-demon-hunter-2026-10-21T20-17-13-…Z.jsonl`
  (session `c92c3a01-51fa-4474-848a-b807425cbea3`); progress log
  `harness-out/integration-dh3.stderr`.
- Result: no game over at the 400-exchange cap (summary
  `integration-8-bit-demon-hunter-2026-10-21T20-17-03-591Z.json`, 15 flags).
  Final server state: level 2, eight deaths, 2 shuckles, three towns visited
  (Farmford, Sheeford, Smithton), 31 clues, 2 bindings, no artifacts. The
  first 340 exchanges never left Farmford: every death was the same shape,
  leaving a clearing at 1 HP and a Dude Bandit striking on the way out, and
  the player farmed one Slime per trip and walked back to sell one Demon
  Powder. Player weakness (class D), addressed in the guide. One narrated
  line at exchange 338 and one empty reply at 90 (both harness guards
  worked); otherwise the player stayed in role, so the frame moved the
  narration onset from exchange 6 to 338 but did not remove it.

### Findings

1. **Loot lines read as amounts gained — class B, fixed.** The engine said
   "You collect Demon Powder (3)" with the running total in brackets; the
   assistant relayed "collected 3" and the player summed totals, then flagged
   "lost" powder after a death that had kept all of it. Flagged at exchanges
   65, 103, 128, 135, 162 and 200. The server log confirmed the counts every
   time. Fix: every pickup now reads "You collect 1 Demon Powder (3 in all)",
   with the Gold and Iron Ore lines matching (commit 96288b5). Not test-locked
   beyond the existing combat tests; the wording is the whole change.
2. **A find task whose target you already met never completes, and nothing
   says so — class A candidate, decision pending.** Emily (Cow) was met at
   server turn 9; Felix's "find someone with a Cow" was accepted at turn 28
   and stayed 0/1. The assistant, with nothing true to say, invented "Emily
   has a Dog, nobody in Farmford has a Cow" (exchange 20) and the player
   believed it for 150 exchanges. A find-item task already completes on
   acceptance when the item is held, so the person case is the odd one out.
   Options: complete on acceptance when a matching met person exists, or
   keep the rule and say "you have already met Emily, who has a Cow: talk to
   them again" on acceptance and on a refused claim. Flagged at exchanges 15
   and 168.
3. **Assistant state drift — class C.** Status lines from the assistant's own
   notes disagreed with the server: 11 shuckles and 4 powder vs 19 and 1
   (exchange 89, corrected when the player asked it to check), XP 5 vs 7
   (exchange 144), shuckles 41 vs 51 (exchange 168), smaller gaps at 186
   and 238, "you still need to claim Felix's reward" after the server had
   paid it and offered no such move (289, 342), and a 2/2 HP wake-up when
   the engine's own combat line said 3/3 (390). The game and the relay were
   right each time. The player caught every one, which is what the gate
   wants from it.
4. **Setup asked for a difficulty — class C / legibility.** The assistant
   offered easy, medium, hard or mcts for a solo game with no opponent; the
   option came from the generic session schema. The clearings question was
   legitimate. Worth a line in the game's session guidance saying there is
   no difficulty to choose.

### Still owed

- A complete game. Next run: the sharper opening in STRATEGY-GUIDE.md, and
  consider a stronger player model (`glm-5.2:cloud` or `kimi-k3:cloud`
  answered the role probe cleanly).
- The checker-check (re-plant a fixed bug and confirm a flag).
- Decision and fix for finding 2, test-locked.
- GAMES.md Integration column in the zekel repo.
