// The smallest program that serves these games: register them on @zekel/mcp
// and start it (all seven). Run after `pnpm build`:  node examples/serve.mjs
// (MCP over stdio; set MCP_TRANSPORT=http for HTTP, SESSION_STORE=memory to
// skip MongoDB.) The planned parent repo is this file with a list you choose.

import { registerGame, runServer, SERVER_INSTRUCTIONS, ORCHESTRATED_SERVER_INSTRUCTIONS } from '@zekel/mcp';
import { eightBitDemonHunter } from '@zekel/8-bit-demon-hunter';
import { adventurerOlympics } from '@zekel/adventurer-olympics';
import { cybernoir2127 } from '@zekel/cybernoir-2127';
import { fracturedFist } from '@zekel/fractured-fist';
import { neitherGutsNorGears } from '@zekel/neither-guts-nor-gears';
import { sweetlandsImperium } from '@zekel/sweetlands-imperium';
import { warbleWayGalaxy } from '@zekel/warble-way-galaxy';

await runServer({
  serverInfo: { name: 'zekel-games', version: '0.1.0' },
  instructions: SERVER_INSTRUCTIONS,
  orchestratedInstructions: ORCHESTRATED_SERVER_INSTRUCTIONS,
  registerGames: () => {
    for (const game of [fracturedFist, sweetlandsImperium, warbleWayGalaxy, cybernoir2127, neitherGutsNorGears, adventurerOlympics, eightBitDemonHunter]) {
      registerGame(game);
    }
  },
});
