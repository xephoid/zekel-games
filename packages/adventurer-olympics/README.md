# @zekel/adventurer-olympics

Adventurer Olympics, a Zekel Games board game (2–4 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A 2–4 player exploration race: move, explore new hex tiles, recruit companions, fight monsters, and claim quests before the last tile is placed.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { adventurerOlympics } from '@zekel/adventurer-olympics';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(adventurerOlympics),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
