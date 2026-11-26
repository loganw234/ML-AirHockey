// The work a training worker does, as one pure function, so a Node worker thread (tools/worker.ts) and a
// browser Web Worker (web/trainer-worker.ts) run the very same code.

import { makeNet, netPolicy } from './net.ts';
import { referenceBot, statueBot } from './bots.ts';
import { playMatch } from './match.ts';
import { matchFitness, seatOf, OPP_PEER, OPP_HOF } from './evolve.ts';
import type { EvoConfig } from './evolve.ts';
import { tally } from './evaluate.ts';
import type { Tally } from './evaluate.ts';
import type { Policy } from './policy.ts';

// Play these matches; each task is one genome of the population against one opponent on one seed.
export interface PlayRequest {
  type: 'play';
  evo: EvoConfig;
  len: number;
  pop: Float32Array; // popSize * len
  hof: Float32Array; // hofCount * len
  individual: number[];
  oppKind: number[];
  oppIndex: number[];
  seed: number[];
}

// Evaluate one genome against a scripted opponent on these seeds.
export interface EvalRequest {
  type: 'eval';
  sizes: number[];
  genome: Float32Array;
  opponent: 'ref' | 'statue';
  seeds: number[];
}

export type WorkRequest = PlayRequest | EvalRequest;
export interface PlayReply { fitness: Float64Array; steps: number } // fitness per task, in the order given
export interface EvalReply { tally: Tally }

export function handle(msg: WorkRequest): PlayReply | EvalReply {
  if (msg.type === 'play') {
    const { evo, len, pop, hof } = msg;
    const opts = { goalsToWin: evo.trainGoalsToWin, maxSeconds: evo.trainMaxSeconds };
    const fitness = new Float64Array(msg.individual.length);
    let steps = 0;
    for (let k = 0; k < msg.individual.length; k++) {
      const i = msg.individual[k];
      const me = netPolicy(makeNet(evo.sizes, pop.subarray(i * len, (i + 1) * len)));
      const j = msg.oppIndex[k];
      let opp: Policy;
      if (msg.oppKind[k] === OPP_PEER) opp = netPolicy(makeNet(evo.sizes, pop.subarray(j * len, (j + 1) * len)));
      else if (msg.oppKind[k] === OPP_HOF) opp = netPolicy(makeNet(evo.sizes, hof.subarray(j * len, (j + 1) * len)));
      else opp = referenceBot();
      const seed = msg.seed[k];
      const seat = seatOf(seed);
      const r = seat === 0 ? playMatch(me, opp, seed, opts) : playMatch(opp, me, seed, opts);
      fitness[k] = matchFitness(r, seat, evo);
      steps += r.steps;
    }
    return { fitness, steps };
  }
  const make = () => netPolicy(makeNet(msg.sizes, new Float32Array(msg.genome)));
  const opp = msg.opponent === 'ref' ? () => referenceBot() : () => statueBot();
  return { tally: tally(make, opp, msg.seeds) };
}
