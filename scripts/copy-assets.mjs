// tsc copies only compiled code. Copy every other file a game reads at run
// time (e.g. Warble Way Galaxy's lore/*.md) from src/ into dist/, keeping its
// path, for every package. Tests are not copied.
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let copied = 0;
for (const pkg of readdirSync(join(root, 'packages'))) {
  const src = join(root, 'packages', pkg, 'src');
  const dist = join(root, 'packages', pkg, 'dist');
  if (!existsSync(src)) continue;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p);
      } else if (!/\.tsx?$/.test(name)) {
        cpSync(p, join(dist, relative(src, p)));
        copied++;
      }
    }
  };
  walk(src);
}
process.stderr.write(`copy-assets: ${copied} file(s)\n`);
