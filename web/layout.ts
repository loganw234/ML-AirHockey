// Where a weight or a bias sits in a genome, for the explorer. The definition is net.ts's header
// (per layer: weights as rows [out][in], then biases [out]); the `layout` gate holds these two functions
// against the forward pass itself.

// Layer l connects sizes[l] inputs to sizes[l + 1] outputs; j is the output neuron, i the input.
export function layerOffset(sizes: readonly number[], l: number): number {
  let off = 0;
  for (let k = 0; k < l; k++) off += sizes[k] * sizes[k + 1] + sizes[k + 1];
  return off;
}

export function weightIndex(sizes: readonly number[], l: number, j: number, i: number): number {
  return layerOffset(sizes, l) + j * sizes[l] + i;
}

export function biasIndex(sizes: readonly number[], l: number, j: number): number {
  return layerOffset(sizes, l) + sizes[l] * sizes[l + 1] + j;
}
