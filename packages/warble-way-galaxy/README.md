# @zekel/warble-way-galaxy

Warble Way Galaxy, a Zekel Games board game (1 player), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A solo sci-fi tabletop RPG (Season 1): build a character and crew, fly missions between habitats, survive hazards, pirates and ancient ruins. The player rolls their own dice and draws their own cards; the server is the strict rules engine and the LLM client is the game master, grounding its story in the get_lore repository.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { warbleWayGalaxy } from '@zekel/warble-way-galaxy';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(warbleWayGalaxy),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
