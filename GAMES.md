# Games: where each one stands

One row per game in this repo, one column per runbook step. Update a cell
when you run that step. The steps and their order are in `@zekel/dev`'s
runbooks: `node_modules/@zekel/dev/docs/README.md`, also on
[GitHub](https://github.com/xephoid/zekel-mcp/blob/main/packages/dev/docs/README.md).

A mark is what was last written down, not a fresh run. ✅ passed. 🟡 started,
or passed with gaps. ⬜ not done. n/a: the step doesn't apply to this game.

| Game | Package | Plan | Build | Post-port | AI | Desync | Relay | Balance | Notes |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|---|
| 8-bit Demon Hunter | `8-bit-demon-hunter` | ✅ | ✅ | 🟡 | ⬜ | ⬜ | n/a | ⬜ | Solo text detective RPG. Rules complete and played from the human seat through the real server; the riddles and the final fight wait on designer answers (`POST-PORT.md` §13). The AI is a test bot only. Relay doesn't apply: no AI seats. |
| Adventurer Olympics | `adventurer-olympics` | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | n/a | 2–4 players, a race for quest points. Rules checker built. Two quests changed on 2026-09-30; the AI strength numbers were measured before that. Balance doesn't apply: every seat is the same. Next: desync, relay, a real game with people. |
| Cybernoir 2127 | `cybernoir-2127` | ✅ | ✅ | ✅ | ✅ | ⬜ | ⬜ | 🟡 | 2 players, Detective against Hacker, hidden movement. Rules checker built. Desync passed on 2026-08-13 and must be re-run after a server change. Balance measured; designer questions open. |
| Fractured Fist | `fractured-fist` | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 2 players, deck-building fight. Rules checker built. Starting stamina is 7 (Zeke's ruling; the written rules say 10). The plan step came after this game was built. |
| Neither Guts nor Gears | `neither-guts-nor-gears` | ✅ | ⬜ | 🟡 | ✅ | ⬜ | ⬜ | 🟡 | 2–6 players, wizards against robots, four ways to win. Many designer rulings since the build; balance measured with questions for the designer. Not done: the structured next-step facts zekel Live needs, desync, relay. |
| Sweetlands Imperium | `sweetlands-imperium` | ⬜ | ✅ | ✅ | ✅ | 🟡 | ⬜ | ✅ | 2–5 players, area control. Rules checker built. Balance measured and not balanced yet: the Jellybean faction is too strong and the Nomads too weak at 5 players; needs designer changes. No search-based (MCTS) AI level. |
| Word Debauchee | `word-debauchee` | ✅ | 🟡 | ⬜ | 🟡 | ⬜ | ⬜ | ⬜ | 2–8 players, a talking party word game: one player holds a secret word, the rest spell a synonym from tiles. Plan ruled on 2026-10-26 (`PLAN.md`). Built through the MCP seam with AI seats in three tiers; harness clean at 2, 3, 5 and 8 players, human-seat sweep clean. The Bribe, Open hand and House variants are options. Still to do: `PORT-NOTES.md`, a game from the human seat through the real server. No rules checker yet. `PLAN.md` §13 lists every step's gaps. |
| Warble Way Galaxy | `warble-way-galaxy` | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | ✅ | Solo space RPG with a game-master voice and a lore tool. Every step that applies has passed. Relay doesn't apply: no AI seats in real play. |

Not covered by any step: a real game played by a person with a real chat
assistant. Before calling a game finished, play one start to finish and write
down the date and the model used.
