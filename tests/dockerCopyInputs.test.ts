// scripts/docker-copy-inputs.sh copies only the files named in
// docker-build-files.txt into the image. These run it against small throwaway
// build folders: bad lists and paths reached through a link must stop it
// before anything is copied; good lists must copy exactly the named files.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../scripts/docker-copy-inputs.sh');
// The copy itself uses GNU tar (as in the build's Debian image); macOS's tar
// lacks --verbatim-files-from. The refusals happen before tar runs.
const GNU_TAR = (() => {
  try { return execFileSync('tar', ['--version'], { encoding: 'utf8' }).includes('GNU tar'); } catch { return false; }
})();

let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

/** A build folder with the given files (path -> text) and a list naming `list`. */
function context(files: Record<string, string>, list: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'docker-copy-'));
  dirs.push(root);
  const ctx = join(root, 'ctx');
  mkdirSync(ctx);
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(ctx, p, '..'), { recursive: true });
    writeFileSync(join(ctx, p), text);
  }
  writeFileSync(join(ctx, 'docker-build-files.txt'), ['# list', ...list].join('\n') + '\n');
  return { root, ctx, dest: join(root, 'dest') };
}

function run(ctx: string, dest: string) {
  return spawnSync('sh', [SCRIPT, ctx, dest], { encoding: 'utf8' });
}

function copied(dest: string): string[] {
  if (!existsSync(dest)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(relative(dest, p));
    }
  };
  walk(dest);
  return out.sort();
}

/** Refused with a message, and nothing copied (dest not even made). */
function expectRefused(c: { ctx: string; dest: string }, message: RegExp) {
  const r = run(c.ctx, c.dest);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(message);
  expect(existsSync(c.dest)).toBe(false);
}

describe('docker-copy-inputs.sh refuses links on the way to a listed file', () => {
  it('a parent folder swapped for a link to another folder in the build folder', () => {
    const c = context({ 'g/src/real/board.ts': 'tracked', 'g/src/private/board.ts': 'UNTRACKED' }, ['g/src/viz/board.ts']);
    symlinkSync('private', join(c.ctx, 'g/src/viz'));
    expectRefused(c, /g\/src\/viz is a link/);
  });

  it('a link higher up the path (two folders above the file)', () => {
    const c = context({ 'alt/src/viz/board.ts': 'UNTRACKED' }, ['g/src/viz/board.ts']);
    mkdirSync(join(c.ctx, 'g'));
    symlinkSync('../alt/src', join(c.ctx, 'g/src'));
    expectRefused(c, /g\/src is a link/);
  });

  it('a link at the top of the path', () => {
    const c = context({ 'other/src/a.ts': 'UNTRACKED' }, ['g/src/a.ts']);
    symlinkSync('other', join(c.ctx, 'g'));
    expectRefused(c, /names g\/src\/a\.ts, but g is a link/);
  });

  it('a folder link that points outside the build folder', () => {
    const c = context({}, ['g/etc/hosts']);
    mkdirSync(join(c.ctx, 'g'));
    symlinkSync('/etc', join(c.ctx, 'g/etc'));
    expectRefused(c, /g\/etc is a link/);
  });

  it('the listed file itself is a link', () => {
    const c = context({ 'g/src/private.ts': 'UNTRACKED' }, ['g/src/a.ts']);
    symlinkSync('private.ts', join(c.ctx, 'g/src/a.ts'));
    expectRefused(c, /g\/src\/a\.ts is a link/);
  });

  it('a later bad entry stops the copy of earlier good ones too', () => {
    const c = context({ 'g/src/a.ts': 'ok', 'g/x/private/b.ts': 'UNTRACKED' }, ['g/src/a.ts', 'g/y/b.ts']);
    symlinkSync('x/private', join(c.ctx, 'g/y'));
    expectRefused(c, /g\/y is a link/);
  });
});

describe('docker-copy-inputs.sh refuses bad lists', () => {
  const bad: Array<[string, string, RegExp]> = [
    ['a missing file', 'g/src/nope.ts', /missing or not a plain file/],
    ['a folder', 'g/src', /missing or not a plain file/],
    ['a ".." part', 'g/../g/src/a.ts', /not a plain relative path/],
    ['a "." part', 'g/./src/a.ts', /not a plain relative path/],
    ['an empty part', 'g//src/a.ts', /not a plain relative path/],
    ['a trailing "/"', 'g/src/', /not a plain relative path/],
    ['an absolute path', '/etc/hosts', /not a plain relative path/],
    ['a space', 'g/src/a b.ts', /not a plain relative path/],
  ];
  for (const [name, entry, message] of bad) {
    it(name, () => expectRefused(context({ 'g/src/a.ts': 'ok', 'g/src/a b.ts': 'x' }, [entry]), message));
  }

  it('an empty list', () => expectRefused(context({ 'g/src/a.ts': 'ok' }, []), /lists no files/));
});

describe.skipIf(!GNU_TAR)('docker-copy-inputs.sh copies good lists (needs GNU tar)', () => {
  it('copies exactly the listed plain files, nested folders included', () => {
    const c = context(
      { 'package.json': '{}', 'g/src/a.ts': 'a', 'g/src/viz/board.ts': 'b', 'g/src/lore/x.md': 'x', 'g/src/extra.md': 'UNTRACKED' },
      ['package.json', 'g/src/a.ts', 'g/src/viz/board.ts', 'g/src/lore/x.md'],
    );
    const r = run(c.ctx, c.dest);
    expect(r.status).toBe(0);
    expect(copied(c.dest)).toEqual(['g/src/a.ts', 'g/src/lore/x.md', 'g/src/viz/board.ts', 'package.json']);
  });

  it('ignores links that no listed path goes through', () => {
    const c = context({ 'g/src/a.ts': 'a', 'g/private/s.md': 'UNTRACKED' }, ['g/src/a.ts']);
    symlinkSync('../private', join(c.ctx, 'g/src/side'));
    symlinkSync('/etc', join(c.ctx, 'g/etc'));
    const r = run(c.ctx, c.dest);
    expect(r.status).toBe(0);
    expect(copied(c.dest)).toEqual(['g/src/a.ts']);
  });
});
