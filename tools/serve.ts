// A local preview of the site: builds into dist/, serves it on 127.0.0.1 only, and rebuilds whenever the
// page itself is requested, so a reload picks up edits.
//   node tools/serve.ts [--port 8770]

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const i = process.argv.indexOf('--port');
const PORT = i >= 0 ? Number(process.argv[i + 1]) : 8770;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

let lastError = '';
function rebuild(): void {
  try { build(DIST); lastError = ''; } catch (e) { lastError = (e as Error).message; console.error(lastError); }
}
rebuild();

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '/index.html') { rebuild(); path = '/index.html'; }
  if (lastError) { res.writeHead(500, { 'content-type': 'text/plain' }); res.end(lastError); return; }
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`SERVING dist/ at http://127.0.0.1:${PORT}/`));
