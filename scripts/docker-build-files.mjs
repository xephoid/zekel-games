// The list of files the Docker image is built from: docker-build-files.txt.
//
// Docker cannot tell which files git tracks, so the Dockerfile copies only
// the files named in that list (see the Dockerfile). This script makes the
// list from `git ls-files`, so an untracked file can never be on it.
//
//   node scripts/docker-build-files.mjs          rewrite the list
//   node scripts/docker-build-files.mjs --check  fail if the list is out of date
//
// `pnpm docker-files` runs the first form. `pnpm test` runs the check
// (tests/dockerBuildFiles.test.ts), so adding, renaming or removing a game's
// source file without updating the list fails the tests.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LIST_PATH = join(ROOT, 'docker-build-files.txt');

const HEADER = [
  '# Files the Docker image is built from. Made by scripts/docker-build-files.mjs',
  '# from `git ls-files`: do not edit by hand, run `pnpm docker-files`.',
];

// The workspace files the install and build need, by exact path.
const TOP_LEVEL = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'scripts/copy-assets.mjs',
  'examples/serve.mjs',
]);

// Only plain relative paths: no spaces or quotes; no empty, `.` or `..`
// parts; no leading or trailing `/`. (scripts/docker-copy-inputs.sh checks
// the same in the build.)
export const SAFE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)(?!.*\/$)[A-Za-z0-9_@+-][A-Za-z0-9._@+/-]*$/;

/** True for a tracked file the image needs. */
export function isBuildInput(path) {
  if (TOP_LEVEL.has(path)) return true;
  const m = /^packages\/[^/]+\/(.+)$/.exec(path);
  if (!m) return false;
  const rest = m[1];
  if (rest === 'package.json' || rest === 'tsconfig.json') return true;
  if (!rest.startsWith('src/')) return false;
  const parts = rest.split('/');
  // Tests are not built (each tsconfig excludes them) and not copied as assets.
  if (parts.includes('__tests__') || /\.test\.tsx?$/.test(rest)) return false;
  // Hidden files and folders stay out, as in .dockerignore.
  if (parts.some((p) => p.startsWith('.'))) return false;
  return true;
}

export function trackedFiles(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/** The list's text, made from git's tracked files. Throws on an unsafe path. */
export function buildList(files = trackedFiles()) {
  const picked = files.filter(isBuildInput).sort();
  const bad = picked.filter((p) => !SAFE_PATH.test(p));
  if (bad.length) throw new Error(`docker-build-files: unsafe path(s): ${bad.join(', ')}`);
  return [...HEADER, ...picked].join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const want = buildList();
  if (process.argv.includes('--check')) {
    let have = '';
    try { have = readFileSync(LIST_PATH, 'utf8'); } catch {}
    if (have !== want) {
      process.stderr.write('docker-build-files.txt is out of date: run `pnpm docker-files`.\n');
      process.exit(1);
    }
    process.stderr.write('docker-build-files.txt is up to date.\n');
  } else {
    writeFileSync(LIST_PATH, want);
    process.stderr.write(`docker-build-files.txt: ${want.split('\n').length - HEADER.length - 1} file(s)\n`);
  }
}
