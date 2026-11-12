# @zekel/fractured-fist

Fractured Fist, a Zekel Games board game (2 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A two-player deck-building combat game played with PHYSICAL cards in front of the human — server tracks shared state + AI opponent only; human manages their own hand/deck on a real table. Channel spirit, play techniques, queue damage and defense, reduce your opponent's stamina to zero. Agent reports moves plainly in game terms.

## The screen

`@zekel/fractured-fist/glue` is the game's screen for Zekel Universe: the glue
module Universe's table loads (`fracturedFistGlue`). It needs `@zekel/glue-kit`, `@zekel/primitives`, `@zekel/tokens`, `@zekel/wire-types`, `react`, `react-dom`, which are
optional peer dependencies: a server that only plays the game needs none of
them. It imports its own stylesheets, so load it through a bundler.

## Use

Register it on [`@zekel/mcp`](https://www.npmjs.com/package/@zekel/mcp):

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { fracturedFist } from '@zekel/fractured-fist';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(fracturedFist),
});
```

It needs `@zekel/game-kit` installed alongside it (a peer dependency), so one copy is shared by the server and every game.

Source: https://github.com/xephoid/zekel-games. Licensed under Apache 2.0.
