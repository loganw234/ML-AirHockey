// Puts a ladder of checkpoints on the page: copies the chosen generations of recorded runs from out/ into
// web/checkpoints/, and writes web/checkpoints/index.json, whose labels are read from records/runs.jsonl
// rather than typed, so a figure on the page is the record's.
//   node tools/ladder.ts <run id>:<generation> [<run id>:<generation> ...]
// The listed order is the menu's order; the page opens on the last.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromCheckpoint } from '../src/checkpoint.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const runs = readFileSync(join(ROOT, 'records/runs.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const picks = process.argv.slice(2);
if (picks.length === 0) throw new Error('LADDER-EMPTY: name at least one <run id>:<generation>');

const outDir = join(ROOT, 'web/checkpoints');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const entries: { file: string; label: string; run: string; gen: number; vsRefRate: number; confirmRate: number | null }[] = [];
for (const pick of picks) {
  const [run, g] = pick.split(':');
  const gen = Number(g);
  const rec = runs.find((r) => r.runId === run);
  if (!rec) throw new Error(`LADDER-RUN: no run ${run} in records/runs.jsonl`);
  const point = rec.curve.find((p: { gen: number }) => p.gen === gen);
  if (!point) throw new Error(`LADDER-GEN: run ${run} recorded no evaluation at generation ${gen}`);
  const src = join(ROOT, 'out', run, `gen-${gen}.json`);
  if (!existsSync(src)) throw new Error(`LADDER-FILE: ${src} is missing; checkpoints live only on the machine that trained them`);
  fromCheckpoint(readFileSync(src, 'utf8')); // refuses by name if it does not fit this build
  const file = `${run}-gen-${gen}.json`;
  copyFileSync(src, join(outDir, file));
  const confirmRate = rec.result.reached && rec.result.gen === gen ? rec.result.confirmRate : null;
  const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
  // Records made before the table had a version were all on table-v1, the square-cornered table.
  const yard = `${rec.yardstick.version}, ${rec.yardstick.table ?? 'table-v1'}`;
  const label = `Generation ${gen} (${Math.round(point.trainSeconds)} s of training): beat the reference bot ${confirmRate !== null ? `${pct(confirmRate)}, confirmed` : pct(point.vsRefRate)} (${yard})`;
  entries.push({ file, label, run, gen, vsRefRate: point.vsRefRate, confirmRate });
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(entries, null, 2) + '\n');
for (const e of entries) console.log(`${e.file}: ${e.label}`);
console.log(`LADDER ${entries.length} checkpoints in web/checkpoints/`);
