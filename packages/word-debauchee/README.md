# @zekel/word-debauchee

Word Debauchee, a Zekel Games party word game (2–8 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp).

One player, the debauchee, holds a secret word and gives three stingy clues. Everyone else races to spell a synonym from a pile of letter tiles without ever saying it. Every lap of the table the debauchee lays down one more letter, and the guessers' payout shrinks. The server is the deck of 500 word cards and 48 clue cards, the referee for every "Check!", the scorekeeper, and the AI debauchee or guessers. The tiles can be the table's own (any 144-tile set, the same counts as Bananagrams) or held by the server as text.

`scripts/harness.mjs` plays all-AI rounds and reports crack rates per AI tier (what the AI does, not whether the game is balanced). The rules are in [rules/rules.md](rules/rules.md), the reasoning in [rules/design-notes.md](rules/design-notes.md), the cards in [rules/words.md](rules/words.md) (generated from `rules/words.csv`: edit the CSV, then `pnpm --filter @zekel/word-debauchee build:words`). The port plan and every ruling are in [PORT-PLAN.md](PORT-PLAN.md).

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { wordDebauchee } from '@zekel/word-debauchee';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(wordDebauchee),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
