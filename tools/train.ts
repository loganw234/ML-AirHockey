// Phase 0's measurement: train from zero, headless, and time how long the champion takes to beat the
// reference bot in EVAL.bar of matches. Every run appends one line to records/runs.jsonl, written here
// and never by hand, and leaves its checkpoints under out/<run id>/.
//
//   node tools/train.ts [--regime self|mixed] [--workers 6] [--budget 480] [--eval-every 15]
//                       [--seed 1] [--hidden 16] [--pop 96] [--sigma 0.05] [--matches 6]
//                       [--no-stop] [--note "text"]
//
// The training clock counts only generations; evaluation is timed separately and excluded, because in
// the browser it would run beside training rather than inside it. See docs/PHASE0.md.

import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng, hashSeed } from '../src/rng.ts';
import { randomGenome, makeNet } from '../src/net.ts';
import { toCheckpoint } from '../src/checkpoint.ts';
import { REFERENCE_BOT_VERSION } from '../src/bots.ts';
import { TABLE_VERSION } from '../src/config.ts';
import { DEFAULT_EVO, planGeneration, breed, hofInsert } from '../src/evolve.ts';
import type { EvoConfig } from '../src/evolve.ts';
import { EVAL, evalSeeds, emptyTally, addTally, winRate } from '../src/evaluate.ts';
import type { Tally } from '../src/evaluate.ts';
import { NUM_INPUTS, NUM_OUTPUTS } from '../src/obs.ts';

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
if (!hidden.every((n) => Number.isInteger(n) && n > 0)) throw new Error(`ARG-HIDDEN: --hidden takes layer sizes like 16 or 16,16`);
const evo: EvoConfig = {
  ...DEFAULT_EVO,
  sizes: [NUM_INPUTS, ...hidden, NUM_OUTPUTS],
  regime,
  popSize: Number(arg('pop', String(DEFAULT_EVO.popSize))),
  sigma: Number(arg('sigma', String(DEFAULT_EVO.sigma))),
  matchesPerEval: Number(arg('matches', String(DEFAULT_EVO.matchesPerEval))),
};
const workersN = Number(arg('workers', '6'));
const budgetSeconds = Number(arg('budget', '480'));
const evalEvery = Number(arg('eval-every', '15'));
const runSeed = Number(arg('seed', '1')) >>> 0;
const stopAtBar = !flag('no-stop');
const note = arg('note', '');

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
const protocolHash = existsSync(join(ROOT, 'docs/PHASE0.md')) ? sha256(['docs/PHASE0.md']) : null;

function git(args: string[]): string | null {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60000).toISOString().slice(0, 19);
  return `${local}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

// ---- the worker pool ---------------------------------------------------------------------------------

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

async function evaluate(genome: Float32Array, opponent: 'ref' | 'statue', seeds: number[]): Promise<Tally> {
  const parts = workers.map((w, k) => request<{ tally: Tally }>(w, {
    type: 'eval', sizes: evo.sizes, genome, opponent, seeds: seeds.filter((_, i) => i % workersN === k),
  }));
  return (await Promise.all(parts)).reduce((a, p) => addTally(a, p.tally), emptyTally());
}

// ---- the run -----------------------------------------------------------------------------------------

interface Point { gen: number; trainSeconds: number; vsRef: Tally; vsRefRate: number; vsStatueRate: number; stepsPerSecond: number }

async function main(): Promise<void> {
  const started = new Date();
  const runId = `${started.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z-${regime}-s${runSeed}`;
  const outDir = join(ROOT, 'out', runId);
  mkdirSync(outDir, { recursive: true });
  console.log(`run ${runId}: regime ${regime}, sizes [${evo.sizes}], pop ${evo.popSize}, sigma ${evo.sigma}, ${workersN} workers, budget ${budgetSeconds} s`);

  const len = randomGenome(evo.sizes, makeRng(0)).length;
  const initRng = makeRng(hashSeed(runSeed, 0x1417));
  let pop: Float32Array[] = Array.from({ length: evo.popSize }, () => randomGenome(evo.sizes, initRng));
  const hof: Float32Array[] = [];
  const hofRng = makeRng(hashSeed(runSeed, 0x40f));
  const curve: Point[] = [];
  let trainSeconds = 0, evalSeconds = 0, totalSteps = 0, stepsSinceEval = 0, secondsSinceEval = 0;
  let nextEvalAt = 0, gen = 0;
  let result: Record<string, unknown> = { reached: false };
  const failedConfirms: unknown[] = []; // kept apart from result, so reaching the bar later cannot drop them
  const refSeeds = evalSeeds(EVAL.seedBase, EVAL.matches);
  const statueSeeds = evalSeeds(EVAL.statueSeedBase, EVAL.statueMatches);

  for (; ; gen++) {
    const t0 = performance.now();
    const tasks = planGeneration(evo, runSeed, gen, hof.length);
    const flatPop = new Float32Array(evo.popSize * len);
    pop.forEach((g, i) => flatPop.set(g, i * len));
    const flatHof = new Float32Array(hof.length * len);
    hof.forEach((g, i) => flatHof.set(g, i * len));
    const shares = workers.map((_, k) => tasks.filter((_, i) => i % workersN === k));
    const replies = await Promise.all(workers.map((w, k) => request<{ fitness: Float64Array; steps: number }>(w, {
      type: 'gen', evo, len, pop: flatPop, hof: flatHof,
      individual: shares[k].map((t) => t.individual), oppKind: shares[k].map((t) => t.oppKind),
      oppIndex: shares[k].map((t) => t.oppIndex), seed: shares[k].map((t) => t.seed),
    })));
    const fitness = new Float64Array(evo.popSize);
    replies.forEach((r, k) => {
      shares[k].forEach((t, i) => { fitness[t.individual] += r.fitness[i]; });
      stepsSinceEval += r.steps; totalSteps += r.steps;
    });
    const { next, order } = breed(evo, runSeed, gen, pop, fitness);
    const champion = pop[order[0]];
    hofInsert(hof, champion, evo, hofRng);
    const dt = (performance.now() - t0) / 1000;
    trainSeconds += dt; secondsSinceEval += dt;

    const last = trainSeconds >= budgetSeconds;
    if (trainSeconds >= nextEvalAt || last) {
      const e0 = performance.now();
      const vsRef = await evaluate(champion, 'ref', refSeeds);
      const vsStatue = await evaluate(champion, 'statue', statueSeeds);
      const p: Point = {
        gen, trainSeconds: round(trainSeconds, 2), vsRef, vsRefRate: winRate(vsRef), vsStatueRate: winRate(vsStatue),
        stepsPerSecond: Math.round(stepsSinceEval / secondsSinceEval),
      };
      curve.push(p);
      stepsSinceEval = 0; secondsSinceEval = 0;
      writeFileSync(join(outDir, `gen-${gen}.json`), toCheckpoint(makeNet(evo.sizes, new Float32Array(champion)), gen, { runId, vsRefRate: p.vsRefRate }));
      console.log(`gen ${String(gen).padStart(4)}  train ${p.trainSeconds.toFixed(1).padStart(6)} s  vs ref ${(100 * p.vsRefRate).toFixed(1).padStart(5)}% (${vsRef.wins}-${vsRef.losses}-${vsRef.draws})  vs statue ${(100 * p.vsStatueRate).toFixed(0).padStart(3)}%  ${(p.stepsPerSecond / 1e6).toFixed(2)} M steps/s`);
      let stop = false;
      if (p.vsRefRate >= EVAL.bar && result.reached !== true) {
        const confirm = await evaluate(champion, 'ref', evalSeeds(EVAL.confirmSeedBase, EVAL.confirmMatches));
        const rate = winRate(confirm);
        console.log(`  confirm on ${EVAL.confirmMatches} fresh seeds: ${(100 * rate).toFixed(1)}% (${confirm.wins}-${confirm.losses}-${confirm.draws})`);
        if (rate >= EVAL.bar) {
          result = { reached: true, gen, trainSeconds: p.trainSeconds, confirm, confirmRate: rate };
          stop = stopAtBar;
        } else {
          failedConfirms.push({ gen, trainSeconds: p.trainSeconds, confirm, confirmRate: rate });
        }
      }
      evalSeconds += (performance.now() - e0) / 1000;
      nextEvalAt += evalEvery;
      if (stop) break;
    }
    if (last) break;
    pop = next;
  }

  const finished = new Date();
  const record = {
    runId,
    startedAt: localIso(started),
    finishedAt: localIso(finished),
    git: { commit: git(['rev-parse', 'HEAD']), dirty: (git(['status', '--porcelain']) ?? '') !== '' },
    sourceHash,
    yardstick: { version: REFERENCE_BOT_VERSION, table: TABLE_VERSION, hash: yardstickHash },
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
      generations: gen + 1, trainSeconds: round(trainSeconds, 2), evalSeconds: round(evalSeconds, 2),
      wallSeconds: round((finished.getTime() - started.getTime()) / 1000, 2), steps: totalSteps,
    },
    note,
  };
  mkdirSync(join(ROOT, 'records'), { recursive: true });
  appendFileSync(join(ROOT, 'records', 'runs.jsonl'), JSON.stringify(record) + '\n');
  console.log(result.reached
    ? `REACHED ${(100 * EVAL.bar).toFixed(0)}% at gen ${result.gen}, ${result.trainSeconds} s of training (confirmed ${(100 * (result.confirmRate as number)).toFixed(1)}%)`
    : `NOT REACHED within ${budgetSeconds} s (${gen + 1} generations)`);
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
