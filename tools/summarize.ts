// Prints the run record (records/runs.jsonl) as a table. The record is the source; this only reads it.
//   node tools/summarize.ts [--curve <run id>]

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../records/runs.jsonl', import.meta.url));
if (!existsSync(path)) { console.log('no runs recorded yet (records/runs.jsonl is missing)'); process.exit(0); }
const runs = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));

const ci = process.argv.indexOf('--curve');
if (process.argv.includes('--steady')) {
  // docs/STEADY.md's measures, from each run made under that protocol.
  console.log('run id | arm | reached 70% at (train s) | drops > 20 points | worst drop | held >= 40% after first >= 50% | gens/s | M steps/s');
  console.log('---|---|---|---|---|---|---|---');
  // Only runs made as the protocol says: the full 480 s, not stopping at the bar. That leaves out smoke runs.
  for (const r of runs.filter((x) => x.protocol === 'docs/STEADY.md' && x.budgetSeconds === 480 && x.stopAtBar === false)) {
    const rates: number[] = r.curve.map((p: { vsRefRate: number }) => 100 * p.vsRefRate);
    let drops = 0, worst = 0;
    for (let k = 1; k < rates.length; k++) { const d = rates[k - 1] - rates[k]; if (d > 20) drops++; worst = Math.max(worst, d); }
    const first50 = rates.findIndex((v) => v >= 50);
    const after = first50 >= 0 ? rates.slice(first50 + 1) : [];
    const held = after.length ? `${Math.round((100 * after.filter((v) => v >= 40).length) / after.length)}% of ${after.length}` : 'never reached 50%';
    const arm = r.evo.rescoreTop > 0 ? 'steady' : 'baseline';
    const reached = r.result.reached ? String(r.result.trainSeconds) : 'not reached';
    console.log(`${r.runId} | ${arm} | ${reached} | ${drops} | ${worst.toFixed(1)} | ${held} | ${(r.totals.generations / r.totals.trainSeconds).toFixed(2)} | ${(r.totals.steps / r.totals.trainSeconds / 1e6).toFixed(2)}`);
  }
} else if (ci >= 0) {
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
