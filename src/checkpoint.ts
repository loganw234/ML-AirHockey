// Saving and loading a network. A checkpoint names the inputs and outputs it was trained on, so a
// network is never run on an observation it does not know: loading refuses by name instead.

import { INPUT_NAMES, OUTPUT_NAMES, NUM_INPUTS, NUM_OUTPUTS } from './obs.ts';
import { genomeLength, makeNet } from './net.ts';
import type { Net } from './net.ts';

export const CHECKPOINT_FORMAT = 'ml-airhockey/mlp-v1';

export interface Checkpoint {
  format: string;
  sizes: number[];
  inputs: string[];
  outputs: string[];
  generation: number;
  meta: Record<string, unknown>;
  weights: number[];
}

// JSON numbers print a float32's value exactly (it is a double), so a round trip is bit for bit.
export function toCheckpoint(net: Net, generation: number, meta: Record<string, unknown> = {}): string {
  const c: Checkpoint = {
    format: CHECKPOINT_FORMAT,
    sizes: [...net.sizes],
    inputs: [...INPUT_NAMES],
    outputs: [...OUTPUT_NAMES],
    generation,
    meta,
    weights: Array.from(net.genome),
  };
  return JSON.stringify(c);
}

export function fromCheckpoint(json: string): { net: Net; generation: number; meta: Record<string, unknown> } {
  const c = JSON.parse(json) as Partial<Checkpoint>;
  if (c.format !== CHECKPOINT_FORMAT) throw new Error(`CHECKPOINT-FORMAT: expected ${CHECKPOINT_FORMAT}, got ${String(c.format)}`);
  const sizes = c.sizes;
  if (!Array.isArray(sizes) || sizes.length < 2 || !sizes.every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error(`CHECKPOINT-SIZES: not a list of layer sizes: ${JSON.stringify(sizes)}`);
  }
  if (sizes[0] !== NUM_INPUTS || sizes[sizes.length - 1] !== NUM_OUTPUTS) {
    throw new Error(`CHECKPOINT-SIZES: [${sizes.join(', ')}] does not start with ${NUM_INPUTS} inputs and end with ${NUM_OUTPUTS} outputs`);
  }
  if (JSON.stringify(c.inputs) !== JSON.stringify(INPUT_NAMES)) {
    throw new Error(`CHECKPOINT-INPUTS: trained on ${JSON.stringify(c.inputs)}, this build observes ${JSON.stringify(INPUT_NAMES)}`);
  }
  if (JSON.stringify(c.outputs) !== JSON.stringify(OUTPUT_NAMES)) {
    throw new Error(`CHECKPOINT-OUTPUTS: trained on ${JSON.stringify(c.outputs)}, this build answers ${JSON.stringify(OUTPUT_NAMES)}`);
  }
  const w = c.weights;
  const len = genomeLength(sizes);
  if (!Array.isArray(w) || w.length !== len) throw new Error(`CHECKPOINT-LENGTH: expected ${len} weights, got ${Array.isArray(w) ? w.length : 'none'}`);
  if (!w.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('CHECKPOINT-NONFINITE: a weight is not a finite number');
  return { net: makeNet(sizes, Float32Array.from(w)), generation: Number(c.generation ?? 0), meta: c.meta ?? {} };
}
