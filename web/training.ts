// Training in the page: the shared loop (src/trainer.ts) over a pool of Web Workers, measured the way the
// headless runs are. Every few seconds of training the generation's champion plays the reference bot; the
// best so far is kept; and when the best first clears the bar it is confirmed on fresh matches, as in
// docs/PHASE0.md. No DOM here.

import { Trainer, shareTasks, flatten } from '../src/trainer.ts';
import type { Backend } from '../src/trainer.ts';
import type { EvoConfig, Task } from '../src/evolve.ts';
import { EVAL, evalSeeds, emptyTally, addTally, winRate } from '../src/evaluate.ts';
import type { Tally } from '../src/evaluate.ts';
import type { PlayReply, EvalReply, WorkRequest } from '../src/workerCore.ts';

// The page evaluates more often and on fewer matches than the headless protocol, for a livelier chart.
// The best so far is chosen by these same evaluations, so its figure runs a little high; the confirmation
// on fresh seeds is the honest one.
export const PAGE_EVAL = Object.freeze({ everySeconds: 5, matches: 100 });

function request<T>(w: Worker, msg: WorkRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<T>) => resolve(e.data);
    w.onerror = (e: ErrorEvent) => reject(new Error(`WORKER-FAILED: ${e.message}`));
    w.postMessage(msg);
  });
}

export class WorkerPool implements Backend {
  readonly workers: Worker[];

  constructor(n: number) {
    this.workers = Array.from({ length: n }, () => new Worker(new URL('./trainer-worker.js', import.meta.url), { type: 'module' }));
  }

  async play(evo: EvoConfig, len: number, pop: Float32Array[], hof: Float32Array[], tasks: Task[]): Promise<{ fitness: Float64Array; steps: number }> {
    const n = this.workers.length;
    const flatPop = flatten(pop, len), flatHof = flatten(hof, len);
    const shares = shareTasks(tasks, n);
    const replies = await Promise.all(this.workers.map((w, k) => request<PlayReply>(w, {
      type: 'play', evo, len, pop: flatPop, hof: flatHof,
      individual: shares[k].individual, oppKind: shares[k].oppKind, oppIndex: shares[k].oppIndex, seed: shares[k].seed,
    })));
    const fitness = new Float64Array(tasks.length);
    let steps = 0;
    replies.forEach((r, k) => { shares[k].idx.forEach((t, i) => { fitness[t] = r.fitness[i]; }); steps += r.steps; });
    return { fitness, steps };
  }

  async evaluate(sizes: number[], genome: Float32Array, opponent: 'ref' | 'statue', seeds: number[]): Promise<Tally> {
    const n = this.workers.length;
    const parts = this.workers.map((w, k) => request<EvalReply>(w, { type: 'eval', sizes, genome, opponent, seeds: seeds.filter((_, i) => i % n === k) }));
    return (await Promise.all(parts)).reduce((a, p) => addTally(a, p.tally), emptyTally());
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}

export interface TrainPoint { gen: number; seconds: number; rate: number; bestRate: number }
export interface Best { genome: Float32Array; gen: number; rate: number }
export interface Reached { gen: number; seconds: number; confirm: Tally; confirmRate: number }

export class TrainingSession {
  readonly evo: EvoConfig;
  readonly seed: number;
  readonly method: string;
  readonly pool: WorkerPool;
  readonly trainer: Trainer;
  running = false;
  seconds = 0; // training seconds: generations only, as in the headless runs
  stepsPerSecond = 0;
  points: TrainPoint[] = [];
  best: Best | null = null;
  reached: Reached | null = null;
  failedConfirms = 0;
  error = '';
  onUpdate: () => void = () => {};
  onBest: (b: Best) => void = () => {};
  private nextEval = 0;
  private stepsSince = 0;
  private secondsSince = 0;
  private looping = false;

  constructor(evo: EvoConfig, seed: number, workers: number, method: string) {
    this.evo = evo;
    this.seed = seed;
    this.method = method;
    this.pool = new WorkerPool(workers);
    this.trainer = new Trainer(evo, seed, this.pool);
  }

  get gen(): number { return this.trainer.gen; }

  start(): void {
    this.running = true;
    if (!this.looping) void this.loop();
  }

  stop(): void { this.running = false; }

  dispose(): void {
    this.running = false;
    this.pool.terminate();
  }

  private async loop(): Promise<void> {
    this.looping = true;
    try {
      while (this.running) {
        const g = await this.trainer.generation();
        this.seconds += g.seconds;
        this.stepsSince += g.steps; this.secondsSince += g.seconds;
        if (this.seconds >= this.nextEval) {
          await this.evaluate(g.champion, g.gen);
          this.nextEval += PAGE_EVAL.everySeconds;
        }
        // No timer here: waiting for the workers already hands the page back between generations, and a
        // timer would be slowed to about once a second whenever the tab is in the background.
        this.onUpdate();
      }
    } catch (e) {
      this.error = (e as Error).message;
      this.running = false;
      this.onUpdate();
    } finally {
      this.looping = false;
    }
  }

  private async evaluate(champion: Float32Array, gen: number): Promise<void> {
    const t = await this.pool.evaluate(this.evo.sizes, champion, 'ref', evalSeeds(EVAL.seedBase, PAGE_EVAL.matches));
    const rate = winRate(t);
    this.stepsPerSecond = this.secondsSince > 0 ? this.stepsSince / this.secondsSince : 0;
    this.stepsSince = 0; this.secondsSince = 0;
    if (!this.best || rate > this.best.rate) {
      this.best = { genome: new Float32Array(champion), gen, rate };
      this.onBest(this.best);
      if (!this.reached && rate >= EVAL.bar) {
        const confirm = await this.pool.evaluate(this.evo.sizes, champion, 'ref', evalSeeds(EVAL.confirmSeedBase, EVAL.confirmMatches));
        const confirmRate = winRate(confirm);
        if (confirmRate >= EVAL.bar) this.reached = { gen, seconds: this.seconds, confirm, confirmRate };
        else this.failedConfirms++;
      }
    }
    this.points.push({ gen, seconds: this.seconds, rate, bestRate: this.best.rate });
  }
}

export function defaultWorkers(): number {
  const n = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  return Math.max(1, Math.min(8, n - 1));
}
