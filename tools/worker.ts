// A worker thread for tools/train.ts: plays the matches it is handed and sends back the numbers.
// The browser will do the same job in a Web Worker with the same src/ code.

import { parentPort } from 'node:worker_threads';
import { makeNet, netPolicy } from '../src/net.ts';
import { referenceBot, statueBot } from '../src/bots.ts';
import { playMatch } from '../src/match.ts';
import { matchFitness, seatOf, OPP_PEER, OPP_HOF } from '../src/evolve.ts';
import type { EvoConfig } from '../src/evolve.ts';
import { tally } from '../src/evaluate.ts';
import type { Policy } from '../src/policy.ts';

interface GenMessage {
  type: 'gen';
  evo: EvoConfig;
  len: number;
  pop: Float32Array; // popSize * len
  hof: Float32Array; // hofCount * len
  individual: number[];
  oppKind: number[];
  oppIndex: number[];
  seed: number[];
}

interface EvalMessage {
  type: 'eval';
  sizes: number[];
  genome: Float32Array;
  opponent: 'ref' | 'statue';
  seeds: number[];
}

const port = parentPort;
if (!port) throw new Error('WORKER-ONLY: tools/worker.ts runs as a worker thread of tools/train.ts');

port.on('message', (msg: GenMessage | EvalMessage) => {
  if (msg.type === 'gen') {
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
    port.postMessage({ fitness, steps });
  } else {
    const make = () => netPolicy(makeNet(msg.sizes, new Float32Array(msg.genome)));
    const opp = msg.opponent === 'ref' ? () => referenceBot() : () => statueBot();
    port.postMessage({ tally: tally(make, opp, msg.seeds) });
  }
});
