// Headless training, measured: train from zero over Node worker threads and time how long the champion
// takes to beat the reference bot in EVAL.bar of matches. Every run appends one line to
// records/runs.jsonl, written here and never by hand, and leaves its checkpoints under out/<run id>/.
//
//   node tools/train.ts [--regime self|mixed] [--steady] [--rescore 8] [--rescore-matches 16]
//                       [--hof latest-half|uniform] [--workers 6] [--budget 480] [--eval-every 15]
//                       [--seed 1] [--hidden 16] [--pop 96] [--sigma 0.05] [--matches 6]
//                       [--protocol docs/STEADY.md] [--no-stop] [--note "text"]
//
// The loop itself is src/trainer.ts, shared with the page. The training clock counts only generations;
// evaluation is timed separately and excluded, because in the browser it runs beside training.

import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeNet } from '../src/net.ts';
import { toCheckpoint } from '../src/checkpoint.ts';
import { REFERENCE_BOT_VERSION } from '../src/bots.ts';
import { TABLE_VERSION } from '../src/config.ts';
import { DEFAULT_EVO, STEADY_EVO } from '../src/evolve.ts';
import type { EvoConfig, Task } from '../src/evolve.ts';
import { EVAL, evalSeeds, emptyTally, addTally, winRate } from '../src/evaluate.ts';
import type { Tally } from '../src/evaluate.ts';
import { NUM_INPUTS, NUM_OUTPUTS } from '../src/obs.ts';
import { Trainer, shareTasks, flatten } from '../src/trainer.ts';
import type { Backend } from '../src/trainer.ts';
import type { PlayReply, EvalReply } from '../src/workerCore.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---- arguments ---------------------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const regime = arg('regime', 'self');
if (regime !== 'self' && regime !== 'mixed') throw new Error(`ARG-REGIME: --regime is self or mixed, not ${regime}`);
const hidden = arg('hidden', '16').split(',').map(Number);
if (!hidden.every((n) => Number.isInteger(n) && n > 0)) throw new Error('ARG-HIDDEN: --hidden takes layer sizes like 16 or 16,16');
const base: EvoConfig = { ...DEFAULT_EVO, ...(flag('steady') ? STEADY_EVO : {}) };
const hofSampling = arg('hof', base.hofSampling);
if (hofSampling !== 'latest-half' && hofSampling !== 'uniform') throw new Error(`ARG-HOF: --hof is latest-half or uniform, not ${hofSampling}`);
const evo: EvoConfig = {
  ...base,
  sizes: [NUM_INPUTS, ...hidden, NUM_OUTPUTS],
  regime,
  hofSampling,
  popSize: Number(arg('pop', String(base.popSize))),
  sigma: Number(arg('sigma', String(base.sigma))),
  matchesPerEval: Number(arg('matches', String(base.matchesPerEval))),
  rescoreTop: Number(arg('rescore', String(base.rescoreTop))),
  rescoreMatches: Number(arg('rescore-matches', String(base.rescoreMatches))),
};
const workersN = Number(arg('workers', '6'));
const budgetSeconds = Number(arg('budget', '480'));
const evalEvery = Number(arg('eval-every', '15'));
const runSeed = Number(arg('seed', '1')) >>> 0;
const stopAtBar = !flag('no-stop');
const note = arg('note', '');
const protocol = arg('protocol', 'docs/PHASE0.md');

// ---- provenance --------------------------------------------------------------------------------------

function sha256(paths: string[]): string {
  const h = createHash('sha256');
  for (const p of [...paths].sort()) { h.update(p + '\n'); h.update(readFileSync(join(ROOT, p))); }
  return h.digest('hex');
}
const srcFiles = readdirSync(join(ROOT, 'src')).filter((f) => f.endsWith('.ts')).map((f) => `src/${f}`);
const sourceHash = sha256([...srcFiles, 'tools/train.ts', 'tools/worker.ts']);
// The yardstick is the game itself, the reference bot, and how a match and an evaluation are played.
const yardstickHash = sha256(['src/bots.ts', 'src/config.ts', 'src/evaluate.ts', 'src/match.ts', 'src/obs.ts', 'src/rng.ts', 'src/sim.ts']);
if (!existsSync(join(ROOT, protocol))) throw new Error(`ARG-PROTOCOL: no ${protocol}`);
const protocolHash = sha256([protocol]);

function git(args: string[]): string | null {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

// ---- the worker pool, as a Backend ---------------------------------------------------------------------

const workers = Array.from({ length: workersN }, () => new Worker(new URL('./worker.ts', import.meta.url)));

function request<T>(w: Worker, msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: T) => { w.off('error', onError); resolve(m); };
    const onError = (e: Error) => { w.off('message', onMessage); reject(e); };
    w.once('message', onMessage);
    w.once('error', onError);
    w.postMessage(msg);
  });
}

const backend: Backend = {
  async play(evo: EvoConfig, len: number, pop: Float32Array[], hof: Float32Array[], tasks: Task[]) {
    const flatPop = flatten(pop, len), flatHof = flatten(hof, len);
    const shares = shareTasks(tasks, workersN);
    const replies = await Promise.all(workers.map((w, k) => request<PlayReply>(w, {
      type: 'play', evo, len, pop: flatPop, hof: flatHof,
      individual: shares[k].individual, oppKind: shares[k].oppKind, oppIndex: shares[k].oppIndex, seed: shares[k].seed,
    })));
    const fitness = new Float64Array(tasks.length);
    let steps = 0;
    replies.forEach((r, k) => { shares[k].idx.forEach((t, i) => { fitness[t] = r.fitness[i]; }); steps += r.steps; });
    return { fitness, steps };
  },
  async evaluate(sizes: number[], genome: Float32Array, opponent: 'ref' | 'statue', seeds: number[]) {
    const parts = workers.map((w, k) => request<EvalReply>(w, { type: 'eval', sizes, genome, opponent, seeds: seeds.filter((_, i) => i % workersN === k) }));
    return (await Promise.all(parts)).reduce((a, p) => addTally(a, p.tally), emptyTally());
  },
};

// ---- the run -----------------------------------------------------------------------------------------

interface Point { gen: number; trainSeconds: number; vsRef: Tally; vsRefRate: number; vsStatueRate: number; stepsPerSecond: number }

async function main(): Promise<void> {
  const started = new Date();
  const tag = evo.rescoreTop > 0 || evo.hofSampling === 'uniform' ? `${regime}-steady` : regime;
  const runId = `${started.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${tag}-s${runSeed}`;
  const outDir = join(ROOT, 'out', runId);
  mkdirSync(outDir, { recursive: true });
  console.log(`run ${runId}: regime ${regime}, sizes [${evo.sizes}], pop ${evo.popSize}, sigma ${evo.sigma}, hof ${evo.hofSampling}, rescore ${evo.rescoreTop}x${evo.rescoreMatches}, ${workersN} workers, budget ${budgetSeconds} s, ${TABLE_VERSION}`);

  const trainer = new Trainer(evo, runSeed, backend);
  const curve: Point[] = [];
  const failedConfirms: unknown[] = []; // kept apart from result, so reaching the bar later cannot drop them
  let result: Record<string, unknown> = { reached: false };
  let trainSeconds = 0, evalSeconds = 0, totalSteps = 0, stepsSinceEval = 0, secondsSinceEval = 0, nextEvalAt = 0;
  const refSeeds = evalSeeds(EVAL.seedBase, EVAL.matches);
  const statueSeeds = evalSeeds(EVAL.statueSeedBase, EVAL.statueMatches);

  for (; ;) {
    const g = await trainer.generation();
    trainSeconds += g.seconds; secondsSinceEval += g.seconds;
    stepsSinceEval += g.steps; totalSteps += g.steps;
    const last = trainSeconds >= budgetSeconds;
    let stop = false;
    if (trainSeconds >= nextEvalAt || last) {
      const e0 = performance.now();
      const vsRef = await backend.evaluate(evo.sizes, g.champion, 'ref', refSeeds);
      const vsStatue = await backend.evaluate(evo.sizes, g.champion, 'statue', statueSeeds);
      const p: Point = {
        gen: g.gen, trainSeconds: round(trainSeconds, 2), vsRef, vsRefRate: winRate(vsRef), vsStatueRate: winRate(vsStatue),
        stepsPerSecond: Math.round(stepsSinceEval / secondsSinceEval),
      };
      curve.push(p);
      stepsSinceEval = 0; secondsSinceEval = 0;
      writeFileSync(join(outDir, `gen-${g.gen}.json`), toCheckpoint(makeNet(evo.sizes, g.champion), g.gen, { runId, vsRefRate: p.vsRefRate }));
      console.log(`gen ${String(g.gen).padStart(4)}  train ${p.trainSeconds.toFixed(1).padStart(6)} s  vs ref ${(100 * p.vsRefRate).toFixed(1).padStart(5)}% (${vsRef.wins}-${vsRef.losses}-${vsRef.draws})  vs statue ${(100 * p.vsStatueRate).toFixed(0).padStart(3)}%  ${(p.stepsPerSecond / 1e6).toFixed(2)} M steps/s`);
      if (p.vsRefRate >= EVAL.bar && result.reached !== true) {
        const confirm = await backend.evaluate(evo.sizes, g.champion, 'ref', evalSeeds(EVAL.confirmSeedBase, EVAL.confirmMatches));
        const rate = winRate(confirm);
        console.log(`  confirm on ${EVAL.confirmMatches} fresh seeds: ${(100 * rate).toFixed(1)}% (${confirm.wins}-${confirm.losses}-${confirm.draws})`);
        if (rate >= EVAL.bar) { result = { reached: true, gen: g.gen, trainSeconds: p.trainSeconds, confirm, confirmRate: rate }; stop = stopAtBar; }
        else failedConfirms.push({ gen: g.gen, trainSeconds: p.trainSeconds, confirm, confirmRate: rate });
      }
      evalSeconds += (performance.now() - e0) / 1000;
      nextEvalAt += evalEvery;
    }
    if (stop || last) break;
  }

  const finished = new Date();
  const record = {
    runId,
    startedAt: localIso(started),
    finishedAt: localIso(finished),
    git: { commit: git(['rev-parse', 'HEAD']), dirty: (git(['status', '--porcelain']) ?? '') !== '' },
    sourceHash,
    yardstick: { version: REFERENCE_BOT_VERSION, table: TABLE_VERSION, hash: yardstickHash },
    protocol,
    protocolHash,
    machine: { platform: platform(), release: release(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, node: process.version },
    workers: workersN,
    seed: runSeed,
    evo,
    eval: EVAL,
    budgetSeconds,
    evalEverySeconds: evalEvery,
    stopAtBar,
    curve,
    result: { ...result, failedConfirms },
    totals: {
      generations: trainer.gen, trainSeconds: round(trainSeconds, 2), evalSeconds: round(evalSeconds, 2),
      wallSeconds: round((finished.getTime() - started.getTime()) / 1000, 2), steps: totalSteps,
    },
    note,
  };
  mkdirSync(join(ROOT, 'records'), { recursive: true });
  appendFileSync(join(ROOT, 'records', 'runs.jsonl'), JSON.stringify(record) + '\n');
  console.log(result.reached
    ? `REACHED ${(100 * EVAL.bar).toFixed(0)}% at gen ${result.gen}, ${result.trainSeconds} s of training (confirmed ${(100 * (result.confirmRate as number)).toFixed(1)}%)`
    : `NOT REACHED within ${budgetSeconds} s (${trainer.gen} generations)`);
  console.log(`recorded in records/runs.jsonl as ${runId}; checkpoints in out/${runId}/`);
  await Promise.all(workers.map((w) => w.terminate()));
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

main().catch(async (e) => {
  console.error(e);
  await Promise.all(workers.map((w) => w.terminate()));
  process.exitCode = 1;
});
