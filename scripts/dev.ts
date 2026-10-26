// Runs one of the game-building tools from @zekel/dev on these games:
//   pnpm tool <command> [args]      e.g. pnpm tool ai-harness --game=fractured-fist --n=50 --players=2
// (or the shortcuts in package.json: pnpm harness, pnpm desync-bot, …).
// Commands that play through a server start examples/serve.mjs, which serves
// the BUILT games: run `pnpm build` after changing a game.

import { fileURLToPath } from 'node:url';
import { runDevCommand } from '@zekel/dev';
import type { AnyGame } from '@zekel/mcp';
import { eightBitDemonHunter } from '@zekel/8-bit-demon-hunter';
import { adventurerOlympics } from '@zekel/adventurer-olympics';
import { cybernoir2127 } from '@zekel/cybernoir-2127';
import { fracturedFist } from '@zekel/fractured-fist';
import { neitherGutsNorGears } from '@zekel/neither-guts-nor-gears';
import { sweetlandsImperium } from '@zekel/sweetlands-imperium';
import { warbleWayGalaxy } from '@zekel/warble-way-galaxy';
import './devHooks.js';

const games = [fracturedFist, sweetlandsImperium, warbleWayGalaxy, cybernoir2127, neitherGutsNorGears, adventurerOlympics, eightBitDemonHunter] as unknown as AnyGame[];
const serverPath = fileURLToPath(new URL('../examples/serve.mjs', import.meta.url));

const [name, ...args] = process.argv.slice(2);
// verify-lint looks for src/verify/<game>/encoding.ts by default; here each
// game keeps its encoding in its own package.
const game = args.find((a) => a.startsWith('--game='))?.slice('--game='.length);
if (name === 'verify-lint' && game && !args.some((a) => a.startsWith('--encoding='))) {
  args.push(`--encoding=${fileURLToPath(new URL(`../packages/${game}/src/dev/verify/encoding.ts`, import.meta.url))}`);
}

if (!name) {
  process.stderr.write('usage: pnpm tool <command> [args]\n');
  process.exitCode = 2;
} else {
  await runDevCommand(name, args, { games, serverPath });
}
