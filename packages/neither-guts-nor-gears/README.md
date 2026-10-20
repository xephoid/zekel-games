# @zekel/neither-guts-nor-gears

Neither Guts nor Gears, a Zekel Games board game (2–6 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A 2-6 player hex-map game of wizards and robots. Collect the five resources, fight one-hit-kill battles in LIFO initiative passes, claim heroes off culture milestones, hold treaties, and win by Military, Cultural, Economic, or Technological victory. Physical-first: the server is the bookkeeper; the battle strategy deck is table-owned at a physical seat (report what you drew).

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { neitherGutsNorGears } from '@zekel/neither-guts-nor-gears';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(neitherGutsNorGears),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
