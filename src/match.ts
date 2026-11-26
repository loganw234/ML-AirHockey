// One match between two players, with no drawing: the trainer, the evaluator and the gates all use this.

import { DEFAULT_SIM } from './config.ts';
import type { SimConfig } from './config.ts';
import { makeRng } from './rng.ts';
import type { Rng } from './rng.ts';
import { newState, serve, step, stateHash, NO_GOAL } from './sim.ts';
import type { State } from './sim.ts';
import { observe, decodeTarget, NUM_INPUTS, NUM_OUTPUTS } from './obs.ts';
import type { Policy } from './policy.ts';

export interface MatchOptions {
  goalsToWin: number;
  maxSeconds: number;
  cfg?: SimConfig;
}

export interface MatchResult {
  goals0: number;
  goals1: number;
  touches0: number;
  touches1: number;
  steps: number;
  fouls0: number; // times player 0 held the puck in its half past possessionSeconds
  fouls1: number;
  winner: -1 | 0 | 1; // -1 is a draw: time ran out with the score level
  hash: number; // the final state's hash, for telling two runs apart
}

// The served puck rests at a random spot across the receiving half.
export function serveRandom(s: State, cfg: SimConfig, toPlayer: 0 | 1, rng: Rng): void {
  const span = cfg.halfWidth - cfg.puckRadius - cfg.malletRadius;
  serve(s, cfg, toPlayer, (rng() * 2 - 1) * span);
}

export function playMatch(p0: Policy, p1: Policy, seed: number, opts: MatchOptions): MatchResult {
  const cfg = opts.cfg ?? DEFAULT_SIM;
  const rng = makeRng(seed);
  const s = newState(cfg);
  const o0 = new Float32Array(NUM_INPUTS), o1 = new Float32Array(NUM_INPUTS);
  const a0 = new Float32Array(NUM_OUTPUTS), a1 = new Float32Array(NUM_OUTPUTS);
  const t = new Float64Array(4);
  serveRandom(s, cfg, rng() < 0.5 ? 0 : 1, rng);
  const maxSteps = Math.round(opts.maxSeconds * cfg.controlHz);
  // The possession rule: a puck that stays in one half too long goes to the other player. Without it a
  // puck at rest in a passive player's half stalls the match for good.
  const holdSteps = Math.round(cfg.possessionSeconds * cfg.controlHz);
  let half = -1, held = 0, fouls0 = 0, fouls1 = 0;
  let g0 = 0, g1 = 0, steps = 0;
  while (steps < maxSteps) {
    observe(s, 0, cfg, o0);
    observe(s, 1, cfg, o1);
    p0(o0, a0);
    p1(o1, a1);
    decodeTarget(cfg, 0, a0[0], a0[1], t, 0);
    decodeTarget(cfg, 1, a1[0], a1[1], t, 2);
    const g = step(s, t[0], t[1], t[2], t[3], cfg);
    steps++;
    if (g === NO_GOAL) {
      const h = s.py < 0 ? 0 : 1;
      if (h === half) held++; else { half = h; held = 1; }
      if (held > holdSteps) {
        if (h === 0) fouls0++; else fouls1++;
        serveRandom(s, cfg, h === 0 ? 1 : 0, rng);
        half = -1; held = 0;
      }
      continue;
    }
    half = -1; held = 0;
    if (g === 0) { g0++; if (g0 >= opts.goalsToWin) break; serveRandom(s, cfg, 1, rng); }
    else { g1++; if (g1 >= opts.goalsToWin) break; serveRandom(s, cfg, 0, rng); }
  }
  const winner = g0 > g1 ? 0 : g1 > g0 ? 1 : -1;
  return { goals0: g0, goals1: g1, touches0: s.touches0, touches1: s.touches1, steps, fouls0, fouls1, winner, hash: stateHash(s) };
}
