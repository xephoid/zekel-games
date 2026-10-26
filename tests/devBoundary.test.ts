// A game's tool parts (src/dev/, the `@zekel/<game>/dev` entry point) are for
// the people building the game. Someone who only plays it installs the game
// without @zekel/dev (an optional peer dependency), so nothing outside src/dev
// may load src/dev or @zekel/dev. Tests are not checked.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));
const IMPORT = /(?:import|export)\s+(?:type\s+)?[^'";]*?from\s+['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const isTest = (file: string): boolean => /[/\\]__tests__[/\\]|\.test\.tsx?$/.test(file);

describe('tool parts stay out of the game', () => {
  it("a game's own code never loads its src/dev folder or @zekel/dev", () => {
    const leaks: string[] = [];
    for (const pkg of readdirSync(packagesDir)) {
      const src = path.join(packagesDir, pkg, 'src');
      const dev = path.join(src, 'dev') + path.sep;
      for (const file of tsFiles(src).filter((f) => !isTest(f) && !f.startsWith(dev))) {
        for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
          const spec = (m[1] ?? m[2])!;
          const target = spec.startsWith('.') ? path.resolve(path.dirname(file), spec) + path.sep : null;
          if (spec.startsWith('@zekel/dev') || (target !== null && target.startsWith(dev))) {
            leaks.push(`${path.relative(packagesDir, file)} -> ${spec}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
