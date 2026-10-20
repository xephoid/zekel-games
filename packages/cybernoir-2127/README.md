# @zekel/cybernoir-2127

Cybernoir 2127, a Zekel Games board game (2 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A 2-player hidden-movement deduction game of frame-ups and false leads. The Detective (who committed the crime) races to arrest the framed Hacker before the Hacker assembles 3 pieces of Evidence and clears their name.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { cybernoir2127 } from '@zekel/cybernoir-2127';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(cybernoir2127),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
