// The network: a small fully connected net with tanh on every layer, weights held in one flat genome.
//
// Genome layout, layer by layer from the input: the weights as rows, one row per output neuron
// ([out][in], row-major), then that layer's biases ([out]). `sizes` lists the neurons per layer,
// inputs first, so [10, 16, 2] has 10*16 + 16 + 16*2 + 2 = 210 numbers.
//
// The reference pass in net_ref.ts reads the same layout independently, and the `net-ref` gate holds
// this file's forward pass against it.

import { gaussian } from './rng.ts';
import type { Rng } from './rng.ts';
import type { Policy } from './policy.ts';

export interface Net {
  sizes: number[];
  genome: Float32Array;
  acts: Float32Array[]; // each layer's output after its last forward pass; the explorer will draw these
}

export function genomeLength(sizes: readonly number[]): number {
  let n = 0;
  for (let l = 0; l + 1 < sizes.length; l++) n += sizes[l] * sizes[l + 1] + sizes[l + 1];
  return n;
}

export function makeNet(sizes: readonly number[], genome?: Float32Array): Net {
  const len = genomeLength(sizes);
  const g = genome ?? new Float32Array(len);
  if (g.length !== len) throw new Error(`NET-LENGTH: sizes [${sizes.join(', ')}] need ${len} numbers, got ${g.length}`);
  const acts: Float32Array[] = [];
  for (let l = 1; l < sizes.length; l++) acts.push(new Float32Array(sizes[l]));
  return { sizes: [...sizes], genome: g, acts };
}

// Weights drawn with spread 1/sqrt(inputs); biases small.
export function randomGenome(sizes: readonly number[], rng: Rng): Float32Array {
  const g = new Float32Array(genomeLength(sizes));
  let p = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l], nout = sizes[l + 1];
    const w = 1 / Math.sqrt(nin);
    for (let k = 0; k < nin * nout; k++) g[p++] = gaussian(rng) * w;
    for (let k = 0; k < nout; k++) g[p++] = gaussian(rng) * 0.1;
  }
  return g;
}

export function forward(net: Net, input: Float32Array): Float32Array {
  const g = net.genome;
  const sizes = net.sizes;
  let x: Float32Array = input;
  let off = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l], nout = sizes[l + 1];
    const y = net.acts[l];
    const bOff = off + nin * nout;
    for (let j = 0; j < nout; j++) {
      let sum = g[bOff + j];
      const row = off + j * nin;
      for (let i = 0; i < nin; i++) sum += g[row + i] * x[i];
      y[j] = Math.tanh(sum);
    }
    off = bOff + nout;
    x = y;
  }
  return x;
}

export function netPolicy(net: Net): Policy {
  return (obs, out) => {
    const y = forward(net, obs);
    out[0] = y[0];
    out[1] = y[1];
  };
}
