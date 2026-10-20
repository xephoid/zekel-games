# @zekel/sweetlands-imperium

Sweetlands Imperium, a Zekel Games board game (2–5 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A 2-5 player candy-themed area-control game. Factions race to 5 points across a ring of 4 regions, playing colored Intel cards to move leaders, knights, and ambassadors, collect taxes and influence, capture rivals, and storm the castle foe. Played with a PHYSICAL board — the server is bookkeeper for shared state and brain for the AI factions; the shared Intel deck uses report-draw.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { sweetlandsImperium } from '@zekel/sweetlands-imperium';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(sweetlandsImperium),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
