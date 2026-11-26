// One training loop for every place training runs: tools/train.ts over Node worker threads, and the page
// over Web Workers. Where the matches get played is the Backend's business; the population, the hall of
// fame, the choice of champion and the breeding are all here, once.

import { makeRng, hashSeed } from './rng.ts';
import type { Rng } from './rng.ts';
import { randomGenome } from './net.ts';
import { planGeneration, planRescore, breed, hofInsert } from './evolve.ts';
import type { EvoConfig, Task } from './evolve.ts';
import type { Tally } from './evaluate.ts';

export interface Backend {
  // Play these matches and return each task's fitness, in the order given, and the steps simulated.
  play(evo: EvoConfig, len: number, pop: Float32Array[], hof: Float32Array[], tasks: Task[]): Promise<{ fitness: Float64Array; steps: number }>;
  // One genome against a scripted opponent on these seeds.
  evaluate(sizes: number[], genome: Float32Array, opponent: 'ref' | 'statue', seeds: number[]): Promise<Tally>;
}

export interface Generation {
  gen: number;
  champion: Float32Array; // a copy, safe to keep
  steps: number;
  seconds: number;
  rescored: boolean;
}

const now = (): number => performance.now();

export class Trainer {
  readonly evo: EvoConfig;
  readonly runSeed: number;
  readonly backend: Backend;
  readonly len: number;
  readonly hof: Float32Array[] = [];
  pop: Float32Array[];
  gen = 0;
  private hofRng: Rng;

  constructor(evo: EvoConfig, runSeed: number, backend: Backend) {
    this.evo = evo;
    this.runSeed = runSeed >>> 0;
    this.backend = backend;
    const initRng = makeRng(hashSeed(this.runSeed, 0x1417));
    this.pop = Array.from({ length: evo.popSize }, () => randomGenome(evo.sizes, initRng));
    this.len = this.pop[0].length;
    this.hofRng = makeRng(hashSeed(this.runSeed, 0x40f));
  }

  async generation(): Promise<Generation> {
    const t0 = now();
    const { evo, pop, hof } = this;
    const gen = this.gen;
    const tasks = planGeneration(evo, this.runSeed, gen, hof.length);
    const r = await this.backend.play(evo, this.len, pop, hof, tasks);
    // Summed in task order, so the result does not depend on how the work was split.
    const fitness = new Float64Array(evo.popSize);
    tasks.forEach((t, k) => { fitness[t.individual] += r.fitness[k]; });
    let steps = r.steps;
    const order = pop.map((_, i) => i).sort((a, b) => (fitness[b] - fitness[a]) || (a - b));
    let champ = order[0];
    let rescored = false;
    if (evo.rescoreTop > 0 && hof.length > 0) {
      const top = order.slice(0, Math.min(evo.rescoreTop, pop.length));
      const rt = planRescore(evo, this.runSeed, gen, top, hof.length);
      const rr = await this.backend.play(evo, this.len, pop, hof, rt);
      steps += rr.steps;
      const score = new Map<number, number>();
      rt.forEach((t, k) => score.set(t.individual, (score.get(t.individual) ?? 0) + rr.fitness[k]));
      // The best on the panel; a tie goes to the one ranked higher by fitness.
      champ = top.reduce((best, i) => ((score.get(i) ?? 0) > (score.get(best) ?? 0) ? i : best), top[0]);
      rescored = true;
    }
    const { next } = breed(evo, this.runSeed, gen, pop, fitness, rescored ? champ : -1);
    const champion = new Float32Array(pop[champ]);
    hofInsert(hof, champion, evo, this.hofRng);
    this.pop = next;
    this.gen++;
    return { gen, champion, steps, seconds: (now() - t0) / 1000, rescored };
  }
}

// Splits a list of tasks across n workers, round robin, as the arrays a PlayRequest carries; and puts the
// replies back in task order. Shared by both backends.
export function shareTasks(tasks: Task[], n: number): { idx: number[]; individual: number[]; oppKind: number[]; oppIndex: number[]; seed: number[] }[] {
  const shares = Array.from({ length: n }, () => ({ idx: [] as number[], individual: [] as number[], oppKind: [] as number[], oppIndex: [] as number[], seed: [] as number[] }));
  tasks.forEach((t, k) => {
    const s = shares[k % n];
    s.idx.push(k); s.individual.push(t.individual); s.oppKind.push(t.oppKind); s.oppIndex.push(t.oppIndex); s.seed.push(t.seed);
  });
  return shares;
}

export function flatten(list: Float32Array[], len: number): Float32Array {
  const flat = new Float32Array(list.length * len);
  list.forEach((g, i) => flat.set(g, i * len));
  return flat;
}
