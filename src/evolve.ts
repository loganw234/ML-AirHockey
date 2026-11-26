// Neuroevolution: a population of genomes, each generation scored by playing matches, the best kept as
// they are and the rest replaced by mutated copies of the top few.
//
// Who a genome plays depends on the regime:
// - 'self': past champions only (a hall of fame); in generation 0, other members of the population.
//   The reference bot is never an opponent, so beating it is a test the model was not trained on.
// - 'mixed': as 'self', but each match is against the reference bot with probability refShare.
//   A run in this regime has trained against its own yardstick, and its record says so.
//
// These functions are pure: the work of playing the matches is done by whoever calls them (tools/train.ts
// splits it across worker threads; the browser will use Web Workers).

import { gaussian, hashSeed, makeRng } from './rng.ts';
import type { Rng } from './rng.ts';
import type { MatchResult } from './match.ts';
import { NUM_INPUTS, NUM_OUTPUTS } from './obs.ts';

export interface EvoConfig {
  sizes: number[];
  popSize: number;
  eliteCount: number; // carried over unchanged
  parentPool: number; // children are mutated copies of the top parentPool
  sigma: number; // mutation: every weight gets N(0, sigma^2) added
  matchesPerEval: number; // matches each genome plays per generation
  trainGoalsToWin: number;
  trainMaxSeconds: number;
  touchBonus: number; // fitness per touch of the puck, up to touchCap touches a match
  touchCap: number;
  regime: 'self' | 'mixed';
  refShare: number; // in 'mixed', the chance a match is against the reference bot
  hofSize: number;
  // Which past champion a hall-of-fame match is against: 'latest-half' picks the latest one half the
  // time (Phase 0's way); 'uniform' picks any of them alike.
  hofSampling: 'latest-half' | 'uniform';
  // Steadier champions: when above 0, the top rescoreTop genomes by fitness each play rescoreMatches more
  // matches against a fixed panel of past champions spread across the hall of fame, on the same seeds,
  // and the champion is the best of them on that. 0 names the champion by fitness alone (Phase 0's way).
  rescoreTop: number;
  rescoreMatches: number;
}

export const DEFAULT_EVO: Readonly<EvoConfig> = Object.freeze({
  sizes: [NUM_INPUTS, 16, NUM_OUTPUTS],
  popSize: 96,
  eliteCount: 6,
  parentPool: 24,
  sigma: 0.05,
  matchesPerEval: 6,
  trainGoalsToWin: 2,
  trainMaxSeconds: 15,
  touchBonus: 0.05,
  touchCap: 10,
  regime: 'self' as const,
  refShare: 0.5,
  hofSize: 32,
  hofSampling: 'latest-half' as const,
  rescoreTop: 0,
  rescoreMatches: 16,
});

// The settings "steadier" adds to the defaults (docs/STEADY.md).
export const STEADY_EVO: Readonly<Partial<EvoConfig>> = Object.freeze({ hofSampling: 'uniform' as const, rescoreTop: 8, rescoreMatches: 16 });

export const OPP_PEER = 0, OPP_HOF = 1, OPP_REF = 2;

export interface Task {
  individual: number;
  oppKind: number; // OPP_PEER, OPP_HOF or OPP_REF
  oppIndex: number; // into the population for a peer, into the hall of fame for a champion
  seed: number; // top bit always set: never an evaluation seed
}

export function trainingSeed(runSeed: number, gen: number, individual: number, match: number): number {
  return (hashSeed(runSeed, gen, individual, match) | 0x80000000) >>> 0;
}

export function planGeneration(evo: EvoConfig, runSeed: number, gen: number, hofCount: number): Task[] {
  const rng = makeRng(hashSeed(runSeed, gen, 0x0a11));
  const tasks: Task[] = [];
  for (let i = 0; i < evo.popSize; i++) {
    for (let m = 0; m < evo.matchesPerEval; m++) {
      let oppKind: number, oppIndex: number;
      if (evo.regime === 'mixed' && rng() < evo.refShare) { oppKind = OPP_REF; oppIndex = 0; }
      else if (hofCount === 0) {
        oppKind = OPP_PEER;
        oppIndex = Math.floor(rng() * (evo.popSize - 1));
        if (oppIndex >= i) oppIndex++;
      } else {
        oppKind = OPP_HOF;
        oppIndex = evo.hofSampling === 'uniform' ? Math.floor(rng() * hofCount) : rng() < 0.5 ? hofCount - 1 : Math.floor(rng() * hofCount);
      }
      tasks.push({ individual: i, oppKind, oppIndex, seed: trainingSeed(runSeed, gen, i, m) });
    }
  }
  return tasks;
}

// Re-scoring the top genomes: every one plays the same matches, against a panel of up to eight past
// champions spread evenly across the hall of fame, on the same seeds, so they are compared like for like.
export function planRescore(evo: EvoConfig, runSeed: number, gen: number, top: readonly number[], hofCount: number): Task[] {
  const panel: number[] = [];
  const P = Math.min(8, hofCount);
  for (let p = 0; p < P; p++) panel.push(Math.floor((p * hofCount) / P));
  const tasks: Task[] = [];
  for (const i of top) {
    for (let m = 0; m < evo.rescoreMatches; m++) {
      tasks.push({ individual: i, oppKind: OPP_HOF, oppIndex: panel[m % P], seed: (hashSeed(runSeed, gen, 0x5c0e, m) | 0x80000000) >>> 0 });
    }
  }
  return tasks;
}

// The genome's seat is the seed's parity, as in evaluation.
export function seatOf(seed: number): 0 | 1 {
  return (seed & 1) === 0 ? 0 : 1;
}

export function matchFitness(r: MatchResult, seat: 0 | 1, evo: EvoConfig): number {
  const mine = seat === 0 ? r.goals0 : r.goals1;
  const theirs = seat === 0 ? r.goals1 : r.goals0;
  const touches = seat === 0 ? r.touches0 : r.touches1;
  return mine - theirs + evo.touchBonus * Math.min(touches, evo.touchCap);
}

// Rank by fitness (ties by index, so a run repeats), keep the elites, fill the rest with mutants. A genome
// named in `keep` (a re-scored champion) is carried over as an elite even if its fitness did not rank it
// among them.
export function breed(evo: EvoConfig, runSeed: number, gen: number, pop: Float32Array[], fitness: ArrayLike<number>, keep = -1): { next: Float32Array[]; order: number[] } {
  const order = pop.map((_, i) => i).sort((a, b) => (fitness[b] - fitness[a]) || (a - b));
  const rng = makeRng(hashSeed(runSeed, gen, 0xb4ee));
  const next: Float32Array[] = [];
  const elites = order.slice(0, Math.min(evo.eliteCount, pop.length));
  if (keep >= 0 && !elites.includes(keep) && elites.length > 0) elites[elites.length - 1] = keep;
  for (const k of elites) next.push(new Float32Array(pop[k]));
  const pool = Math.min(evo.parentPool, pop.length);
  while (next.length < evo.popSize) {
    const parent = pop[order[Math.floor(rng() * pool)]];
    const child = new Float32Array(parent.length);
    for (let k = 0; k < parent.length; k++) child[k] = parent[k] + evo.sigma * gaussian(rng);
    next.push(child);
  }
  return { next, order };
}

// Every generation's champion joins the hall of fame; once it is full, a random member of its older half
// makes way, so old strategies stay among the opponents.
export function hofInsert(hof: Float32Array[], champion: Float32Array, evo: EvoConfig, rng: Rng): void {
  if (hof.length < evo.hofSize) { hof.push(new Float32Array(champion)); return; }
  const k = Math.floor(rng() * Math.floor(hof.length / 2));
  hof.splice(k, 1);
  hof.push(new Float32Array(champion));
}
