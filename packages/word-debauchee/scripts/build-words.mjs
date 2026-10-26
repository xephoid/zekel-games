// Regenerates src/data/words.ts and rules/words.md from rules/words.csv.
// Run from anywhere:  pnpm --filter @zekel/word-debauchee build:words

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderWordsMd, renderWordsTs } from './words-render.mjs';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(pkg, 'rules', 'words.csv'), 'utf8');
writeFileSync(join(pkg, 'src', 'data', 'words.ts'), renderWordsTs(csv));
writeFileSync(join(pkg, 'rules', 'words.md'), renderWordsMd(csv));
process.stderr.write('build-words: src/data/words.ts and rules/words.md written\n');
