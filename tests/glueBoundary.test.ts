// A game package has two halves: the rules, which the server loads, and the
// screen (src/glue/, the `@zekel/<game>/glue` entry point), which Zekel
// Universe loads in a browser. They never import each other. The server must
// not need React, and a screen must not reach past the server for a rule: it
// draws what the game's views and listed moves say.
//
// So: a file under src/glue/ imports only files under src/glue/, React, and
// the packages a screen is written against. A file outside src/glue/ never
// imports one inside it, its own game's or another's. Tests are checked like
// the code they sit beside. Imports are read from each file's syntax tree, so
// import() and require() count. One whose path is worked out at run time is
// refused anywhere in a game, since nobody can say where it goes; no game
// has one today. A bundler's import.meta.glob is followed when its patterns
// are plain relative strings that stay inside the folder they start in (a
// screen's tests load their captured views that way); any other glob is
// refused like a run-time import. What this cannot see is code that hides
// the call on purpose (require under another name, eval).

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packagesDir = fileURLToPath(new URL('../packages/', import.meta.url));

/** What a screen may be written against. */
const GLUE_PACKAGES = ['react', 'react-dom', '@zekel/glue-kit', '@zekel/primitives', '@zekel/wire-types', '@zekel/tokens'];
/** What a screen's tests may add to that. */
const GLUE_TEST_PACKAGES = ['vitest', '@testing-library/react', '@testing-library/dom', 'node:fs', 'node:path', 'node:url'];

const isTest = (file: string): boolean => /[/\\]__tests__[/\\]|\.test\.tsx?$/.test(file);
const named = (spec: string, list: string[]): boolean => list.some((p) => spec === p || spec.startsWith(p + '/'));

function walk(dir: string, links: string[], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) links.push(p);
    else if (st.isDirectory()) walk(p, links, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Where a glob pattern stops being a plain path. */
const WILD = /[*?{[(]/;

function importsIn(text: string, fileName = 'x.tsx'): { specs: string[]; globs: string[]; computed: number } {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const specs: string[] = [];
  const globs: string[] = [];
  let computed = 0;
  const str = (n: ts.Node | undefined) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
  const noteGlob = (n: ts.Node | undefined) => {
    const parts = n && ts.isArrayLiteralExpression(n) ? [...n.elements] : [n];
    for (const part of parts) {
      const pattern = str(part);
      if (pattern === null) computed++;
      else if (pattern.startsWith('!')) continue; // takes files away, adds none
      else if (!pattern.startsWith('.')) computed++; // from the project root or an alias: not followed here
      // The bundler joins the whole pattern before it looks, so a ".." after a
      // wildcard climbs out of the folder the pattern seems to start in.
      else if (WILD.test(pattern) && pattern.slice(pattern.search(WILD)).includes('..')) computed++;
      else globs.push(pattern);
    }
  };
  const isGlob = (n: ts.Node) => ts.isPropertyAccessExpression(n) && ts.isMetaProperty(n.expression) && n.name.text.startsWith('glob');
  const note = (n: ts.Node | undefined) => {
    if (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) specs.push(n.text);
    else computed++;
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) note(n.moduleSpecifier);
    else if (ts.isExportDeclaration(n)) { if (n.moduleSpecifier) note(n.moduleSpecifier); }
    else if (ts.isImportEqualsDeclaration(n)) { if (ts.isExternalModuleReference(n.moduleReference)) note(n.moduleReference.expression); }
    else if (ts.isImportTypeNode(n)) note(ts.isLiteralTypeNode(n.argument) ? n.argument.literal : undefined);
    else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
      note(n.arguments.length === 1 ? n.arguments[0] : undefined);
    } else if (ts.isCallExpression(n) && isGlob(n.expression)) noteGlob(n.arguments[0]);
    else if (isGlob(n) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) computed++; // glob passed around, not called
    ts.forEachChild(n, visit);
  };
  visit(tree);
  return { specs, globs, computed };
}

/** The folder a glob pattern starts looking from: everything before its
 *  first wildcard, back to the last slash. importsIn has already refused a
 *  pattern that climbs with ".." after that point. */
function globBase(file: string, pattern: string): string {
  const fixed = WILD.test(pattern) ? pattern.slice(0, pattern.search(WILD)) : pattern;
  return path.resolve(path.dirname(file), fixed.slice(0, fixed.lastIndexOf('/') + 1));
}

describe('the scanner the wall is checked with', () => {
  it('sees every way a file can name another', () => {
    const text = [
      "import a from './a.js'; import { b } from './b.js';",
      "export { c } from './c.js';",
      "import './d.css';",
      "const e = await import('./e.js');",
      "const g = require('./g.js');",
      "type I = import('./i.js').I;",
    ].join('\n');
    expect(importsIn(text, 'x.ts')).toEqual({ specs: ['./a.js', './b.js', './c.js', './d.css', './e.js', './g.js', './i.js'], globs: [], computed: 0 });
  });

  it('counts an import it cannot follow, and is not fooled by strings or comments', () => {
    expect(importsIn('const m = await import(where);').computed).toBe(1);
    expect(importsIn("const a = '/*'; import(where); const b = '*/';").computed).toBe(1);
    expect(importsIn("// import(where)\nconst s = 'require(x)';")).toEqual({ specs: [], globs: [], computed: 0 });
  });

  it("reads a glob's patterns, and refuses one it cannot follow", () => {
    expect(importsIn("const a = import.meta.glob<X>('./fixtures/ngg/*.json', { eager: true, import: 'default' });")).toEqual({ specs: [], globs: ['./fixtures/ngg/*.json'], computed: 0 });
    expect(importsIn("const a = import.meta.glob(['./a/*.ts', '!./a/skip.ts']);").globs).toEqual(['./a/*.ts']);
    expect(importsIn('const a = import.meta.glob(pattern);').computed).toBe(1);
    expect(importsIn("const a = import.meta.glob('/packages/x/src/**');").computed).toBe(1);
    expect(importsIn("const a = import.meta.glob('./*/../../engine/*.ts');").computed).toBe(1);
    expect(importsIn("const g = import.meta.glob; g('../*.ts');").computed).toBe(1);
    const file = path.join(packagesDir, 'x', 'src', 'glue', '__tests__', 'a.test.ts');
    expect(globBase(file, './fixtures/ngg/*.json')).toBe(path.join(packagesDir, 'x', 'src', 'glue', '__tests__', 'fixtures', 'ngg'));
    expect(globBase(file, '../../*.ts')).toBe(path.join(packagesDir, 'x', 'src'));
  });
});

describe('a game\'s rules and its screen never import each other', () => {
  const links: string[] = [];
  const games = readdirSync(packagesDir).map((pkg) => {
    const src = path.join(packagesDir, pkg, 'src');
    const glue = path.join(src, 'glue');
    return { pkg, src, glue, files: walk(src, links) };
  });
  const inGlue = (g: { glue: string }, p: string) => p === g.glue || p.startsWith(g.glue + path.sep);
  /** Inside any game's screen, not only the importing game's. */
  const inAnyGlue = (p: string) => games.some((g) => inGlue(g, p));

  it('finds at least one game with a screen', () => {
    expect(games.filter((g) => g.files.some((f) => inGlue(g, f))).length).toBeGreaterThan(0);
  });

  it('has no symbolic links under any src/', () => {
    expect(links.map((l) => path.relative(packagesDir, l))).toEqual([]);
  });

  it('a screen imports only its own files, React and the drawing packages', () => {
    const leaks: string[] = [];
    for (const g of games) {
      for (const file of g.files.filter((f) => inGlue(g, f))) {
        const { specs, globs, computed } = importsIn(readFileSync(file, 'utf8'), file);
        const where = path.relative(packagesDir, file);
        if (computed > 0) leaks.push(`${where} -> an import worked out at run time`);
        // A screen's glob looks only inside the screen's own folder.
        for (const pattern of globs) if (!inGlue(g, globBase(file, pattern))) leaks.push(`${where} -> glob ${pattern}`);
        for (const spec of specs) {
          if (spec.startsWith('.')) {
            if (!inGlue(g, path.resolve(path.dirname(file), spec))) leaks.push(`${where} -> ${spec}`);
          } else if (!named(spec, GLUE_PACKAGES) && !(isTest(file) && named(spec, GLUE_TEST_PACKAGES))) {
            leaks.push(`${where} -> ${spec}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('nothing outside a screen imports it, or React, or the drawing packages', () => {
    const reaches: string[] = [];
    for (const g of games) {
      for (const file of g.files.filter((f) => !inGlue(g, f))) {
        const { specs, globs, computed } = importsIn(readFileSync(file, 'utf8'), file);
        const where = path.relative(packagesDir, file);
        // Outside a screen, a glob may not look inside one, or from a folder that holds one.
        for (const pattern of globs) {
          const base = globBase(file, pattern);
          if (games.some((x) => inGlue(x, base) || x.glue.startsWith(base + path.sep))) reaches.push(`${where} -> glob ${pattern}`);
        }
        for (const spec of specs) {
          if (spec.startsWith('.')) {
            if (inAnyGlue(path.resolve(path.dirname(file), spec))) reaches.push(`${where} -> ${spec}`);
          } else if (named(spec, GLUE_PACKAGES) || /^@zekel\/[^/]+\/glue(\/|$)/.test(spec)) {
            reaches.push(`${where} -> ${spec}`);
          }
        }
        if (computed > 0) reaches.push(`${where} -> an import worked out at run time`);
      }
    }
    expect(reaches).toEqual([]);
  });
});
