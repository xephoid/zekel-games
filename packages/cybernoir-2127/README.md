# @zekel/cybernoir-2127

Cybernoir 2127, a Zekel Games board game (2 players), as a game module for the [zekel MCP server](https://github.com/xephoid/zekel-mcp): its rules and its AI opponents.

A 2-player hidden-movement deduction game of frame-ups and false leads. The Detective (who committed the crime) races to arrest the framed Hacker before the Hacker assembles 3 pieces of Evidence and clears their name.

## The screen

`@zekel/cybernoir-2127/glue` is the game's screen for Zekel Universe: the glue
module Universe's table loads (`cybernoirGlue`), which lays the game out from
its views with Universe's own parts (the subway map, cards, tracks). It needs
`@zekel/glue-kit`, `@zekel/primitives` and `@zekel/wire-types`, which are
optional peer dependencies: a server that only plays the game needs none of
them. It imports its own stylesheet, so load it through a bundler.

The portraits and faction marks are not in this package. The screen names
them by address (`/art/cybernoir/...`), and the site that shows the screen
serves them; Zekel Universe does, from `apps/web/public/art/cybernoir/`.

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
