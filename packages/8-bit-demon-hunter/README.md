# @zekel/8-bit-demon-hunter

8-bit Demon Hunter, a Zekel Games solo text detective RPG (1 player), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its world.

Ported from the video game. There is no physical copy: the server tracks every zone and rolls every die, and the player view is the table. Somewhere in the world a demon hides among its people. Question townsfolk, follow clues, fight and level up, and make your accusation. The identity of the demon and its minions never appears in any player view.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { eightBitDemonHunter } from '@zekel/8-bit-demon-hunter';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(eightBitDemonHunter),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
