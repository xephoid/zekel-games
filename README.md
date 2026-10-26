# zekel-games

Zekel Games' own board games, as game modules for the [zekel MCP server](https://github.com/xephoid/zekel-mcp). Each game is its own package, so you install only the ones you want.

| Package | Game | Players |
|---|---|---|
| `@zekel/fractured-fist` | Fractured Fist | 2 |
| `@zekel/sweetlands-imperium` | Sweetlands Imperium | 2–5 |
| `@zekel/warble-way-galaxy` | Warble Way Galaxy (a solo story game) | 1 |
| `@zekel/cybernoir-2127` | Cybernoir 2127 | 2 |
| `@zekel/neither-guts-nor-gears` | Neither Guts nor Gears | 2–6 |
| `@zekel/adventurer-olympics` | Adventurer Olympics | 2–4 |
| `@zekel/8-bit-demon-hunter` | 8-bit Demon Hunter (a solo text detective RPG, ported from the video game) | 1 |
| `@zekel/word-debauchee` | Word Debauchee (a talking party word game) | 2–8 |

Each package holds one game's rules, its AI opponents and its tests. A game depends only on `@zekel/game-kit`, the interface every zekel game implements. The rules live here and nowhere else: the server knows none of them.

## Serving the games

Register the games you want on `@zekel/mcp` and start it. `examples/serve.mjs` does this for all eight:

```js
import { registerGame, runServer, SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { fracturedFist } from '@zekel/fractured-fist';

await runServer({
  serverInfo: { name: 'my-games', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
  registerGames: () => registerGame(fracturedFist),
});
```

## Working on the games

Needs Node 22.13 or later and pnpm.

```
pnpm install
pnpm build      # builds every game
pnpm test       # every game's tests
pnpm smoke      # serves all eight and plays each through the real MCP tools
```

## Not done yet

- The screens that draw these games in the Zekel web app still live in that app's repo; they move here later.

## Licence

Licensed under Apache 2.0. See `LICENSE`.
