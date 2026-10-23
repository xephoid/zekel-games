// Registers each game's extra parts for the tools (its dev hooks, from the
// game's own src/dev/index.ts) with @zekel/dev. Imported once, before any tool
// looks them up: scripts/dev.ts and the test setup do. Read from source, so a
// change to a game's dev hooks needs no build.

import { markDevHooksLoaded, registerDevHooks } from '@zekel/dev';
import { devHooks as adventurerOlympics } from '../packages/adventurer-olympics/src/dev/index.js';
import { devHooks as cybernoir2127 } from '../packages/cybernoir-2127/src/dev/index.js';
import { devHooks as fracturedFist } from '../packages/fractured-fist/src/dev/index.js';
import { devHooks as neitherGutsNorGears } from '../packages/neither-guts-nor-gears/src/dev/index.js';
import { devHooks as sweetlandsImperium } from '../packages/sweetlands-imperium/src/dev/index.js';
import { devHooks as warbleWayGalaxy } from '../packages/warble-way-galaxy/src/dev/index.js';

registerDevHooks('adventurer-olympics', adventurerOlympics);
registerDevHooks('cybernoir-2127', cybernoir2127);
registerDevHooks('fractured-fist', fracturedFist);
registerDevHooks('neither-guts-nor-gears', neitherGutsNorGears);
registerDevHooks('sweetlands-imperium', sweetlandsImperium);
registerDevHooks('warble-way-galaxy', warbleWayGalaxy);
// 8-bit Demon Hunter has no dev hooks yet; the tools use their generic behaviour.
markDevHooksLoaded();
