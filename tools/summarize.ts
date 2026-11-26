// Prints the run record (records/runs.jsonl) as a table. The record is the source; this only reads it.
//   node tools/summarize.ts [--curve <run id>]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../records/runs.jsonl', import.meta.url));
if (!existsSync(path)) { console.log('no runs recorded yet (records/runs.jsonl is missing)'); process.exit(0); }
const runs = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

const ci = process.argv.indexOf('--curve');
if (ci >= 0) {
  const id = process.argv[ci + 1];
  const run = runs.find((r) => r.runId === id);
  if (!run) { console.log(`RUN-UNKNOWN: no run ${id} in the record`); process.exitCode = 1; }
  else {
    console.log('gen\ttrain s\tvs ref\tW-L-D\tvs statue\tM steps/s');
    for (const p of run.curve) {
      console.log(`${p.gen}\t${p.trainSeconds}\t${(100 * p.vsRefRate).toFixed(1)}%\t${p.vsRef.wins}-${p.vsRef.losses}-${p.vsRef.draws}\t${(100 * p.vsStatueRate).toFixed(0)}%\t${(p.stepsPerSecond / 1e6).toFixed(2)}`);
    }
  }
} else {
  console.log('run id | regime | hidden | pop | sigma | workers | reached 70% | gens | train s | best vs ref | yardstick | note');
  console.log('---|---|---|---|---|---|---|---|---|---|---|---');
  for (const r of runs) {
    const hidden = r.evo.sizes.slice(1, -1).join(',');
    const best = Math.max(...r.curve.map((p: { vsRefRate: number }) => p.vsRefRate));
    const reached = r.result.reached ? `yes (confirm ${(100 * r.result.confirmRate).toFixed(1)}%)` : 'no';
    const gens = r.result.reached ? r.result.gen : r.totals.generations;
    const secs = r.result.reached ? r.result.trainSeconds : r.totals.trainSeconds;
    console.log(`${r.runId} | ${r.evo.regime} | ${hidden} | ${r.evo.popSize} | ${r.evo.sigma} | ${r.workers} | ${reached} | ${gens} | ${secs} | ${(100 * best).toFixed(1)}% | ${r.yardstick.version} ${r.yardstick.hash.slice(0, 8)} | ${r.note}`);
  }
}
