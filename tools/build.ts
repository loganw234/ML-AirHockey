// Builds the static site into dist/ with no dependencies: Node strips the TypeScript types from src/ and
// web/, relative `.ts` imports become `.js`, and the HTML and CSS are copied. dist/ is what GitHub Pages
// serves. The build refuses by name rather than write a site that cannot load:
//   BUILD-NODE-IMPORT   a file the browser loads imports a node: module
//   BUILD-TS-SPECIFIER  an import still names a .ts file after the rewrite
//   BUILD-UNRESOLVED    a relative import names a file the build did not write
//
//   node tools/build.ts [--out dist]

import { stripTypeScriptTypes } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+?)\.ts\2/g;
const ANY_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;

export interface BuildOptions {
  rewrite?: boolean; // false only for the front door's control
  plant?: Record<string, string>; // extra output files, only for the front door's control
}

// Returns the paths written, relative to outDir.
export function build(outDir: string, opts: BuildOptions = {}): string[] {
  const rewrite = opts.rewrite ?? true;
  rmSync(outDir, { recursive: true, force: true });
  const written = new Map<string, string>(); // output path -> its source text
  for (const dir of ['src', 'web']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${f}`;
      if (statSync(join(ROOT, rel)).isDirectory()) continue;
      const text = readFileSync(join(ROOT, rel), 'utf8');
      if (f.endsWith('.ts')) {
        let js = stripTypeScriptTypes(text, { mode: 'strip' });
        if (rewrite) js = js.replace(SPECIFIER, (_m, pre, q, path) => `${pre}${q}${path}.js${q}`);
        written.set(rel.replace(/\.ts$/, '.js'), js);
      } else if (dir === 'web' && (f.endsWith('.css') || f.endsWith('.svg'))) {
        written.set(rel, text);
      } else if (dir === 'web' && f === 'index.html') {
        written.set('index.html', text);
      }
    }
  }
  // The generation ladder, if tools/ladder.ts has made one.
  const ckpt = join(ROOT, 'web/checkpoints');
  if (existsSync(ckpt)) {
    for (const f of readdirSync(ckpt)) if (f.endsWith('.json')) written.set(`web/checkpoints/${f}`, readFileSync(join(ckpt, f), 'utf8'));
  }
  for (const [out, text] of Object.entries(opts.plant ?? {})) written.set(out, text);
  checkModules(written);
  for (const [out, text] of written) {
    const p = join(outDir, out);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  writeFileSync(join(outDir, '.nojekyll'), ''); // GitHub Pages: serve the files as they are
  return [...written.keys()];
}

// Check every module of a build before anything is written: output path -> text.
export function checkModules(written: ReadonlyMap<string, string>): void {
  for (const [out, js] of written) {
    if (!out.endsWith('.js')) continue;
    for (const m of js.matchAll(ANY_SPECIFIER)) {
      const spec = m[2];
      if (spec.startsWith('node:')) throw new Error(`BUILD-NODE-IMPORT: ${out} imports ${spec}; the browser cannot load it`);
      if (!spec.startsWith('.')) continue;
      if (spec.endsWith('.ts')) throw new Error(`BUILD-TS-SPECIFIER: ${out} still imports ${spec}`);
      const target = posix.normalize(posix.join(posix.dirname(out), spec));
      if (!written.has(target)) throw new Error(`BUILD-UNRESOLVED: ${out} imports ${spec}, and the build wrote no ${target}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--out');
  const out = resolve(ROOT, i >= 0 ? process.argv[i + 1] : 'dist');
  const files = build(out);
  if (!existsSync(join(out, 'index.html'))) throw new Error('BUILD-NO-PAGE: web/index.html is missing');
  console.log(`BUILT ${files.length} files into ${out}`);
}
