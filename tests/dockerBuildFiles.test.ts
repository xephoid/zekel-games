// The Docker image is built only from the files in docker-build-files.txt
// (see the Dockerfile). This keeps that list equal to what git tracks, so a
// committed game file is never left out of the image and an untracked one is
// never put in.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script with no type declarations
import { buildList, isBuildInput, LIST_PATH, SAFE_PATH } from '../scripts/docker-build-files.mjs';

describe('docker-build-files.txt', () => {
  it('matches the tracked files (run `pnpm docker-files` if this fails)', () => {
    expect(readFileSync(LIST_PATH, 'utf8')).toBe(buildList());
  });

  it('keeps tests, hidden files and other folders out', () => {
    expect(isBuildInput('packages/g/src/engine.ts')).toBe(true);
    expect(isBuildInput('packages/g/src/lore/a.md')).toBe(true);
    expect(isBuildInput('packages/g/package.json')).toBe(true);
    expect(isBuildInput('packages/g/src/__tests__/a.test.ts')).toBe(false);
    expect(isBuildInput('packages/g/src/a.test.ts')).toBe(false);
    expect(isBuildInput('packages/g/src/.env')).toBe(false);
    expect(isBuildInput('packages/g/src/.x/a.ts')).toBe(false);
    expect(isBuildInput('packages/g/rules/rules.md')).toBe(false);
    expect(isBuildInput('README.md')).toBe(false);
  });

  it('accepts only plain relative paths', () => {
    expect(SAFE_PATH.test('packages/g/src/lore/a-b_c.md')).toBe(true);
    for (const p of ['/etc/passwd', '../x', 'a/../b', 'a b', 'a\nb', "a'b"]) {
      expect(SAFE_PATH.test(p)).toBe(false);
    }
  });
});
