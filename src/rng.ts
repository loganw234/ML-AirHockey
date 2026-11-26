// Seeded randomness. Everything random in the simulator, the trainer and the evaluator comes from here,
// so a run is repeatable on the same JavaScript engine. Bit-exactness across engines is not a goal.

export type Rng = () => number; // uniform on [0, 1)

// mulberry32: small, fast, good enough for a game.
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal, by Box-Muller.
export function gaussian(rng: Rng): number {
  let u = rng();
  if (u < 1e-300) u = 1e-300;
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Mix integers into one uint32, for deriving seeds from (run, generation, individual, match).
export function hashSeed(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
  }
  return h >>> 0;
}
