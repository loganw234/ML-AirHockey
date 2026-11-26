// A player, network or scripted: it reads its observation (own frame, see obs.ts) and writes its answer,
// two numbers in [-1, 1]. A policy must not keep state between calls; the `determinism` gate relies on it.
export type Policy = (obs: Float32Array, out: Float32Array) => void;
