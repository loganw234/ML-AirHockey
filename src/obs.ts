// What a player sees, and what it can ask for.
//
// Every player sees the table from its own end: its own goal is always at the bottom. For player 1 the
// table is turned half round (x -> -x, y -> -y, and velocities likewise), so one network can play either
// side. Inputs are scaled to roughly [-1, 1].
//
// A player answers with two numbers in [-1, 1]: where in its own half it wants its mallet. The mallet
// heads there at the simulator's speed limit, which is the same rule a human's pointer will follow.

import type { SimConfig } from './config.ts';
import type { State } from './sim.ts';

export const INPUT_NAMES = Object.freeze([
  'puck x', 'puck y', 'puck vx', 'puck vy',
  'own x', 'own y', 'own vx', 'own vy',
  'opp x', 'opp y',
] as const);
export const NUM_INPUTS = INPUT_NAMES.length;

export const OUTPUT_NAMES = Object.freeze(['target x', 'target y'] as const);
export const NUM_OUTPUTS = OUTPUT_NAMES.length;

export function observe(s: State, player: 0 | 1, cfg: SimConfig, out: Float32Array): void {
  const sx = 1 / cfg.halfWidth;
  const sy = 1 / cfg.halfLength;
  const sp = 1 / cfg.puckMaxSpeed;
  const sm = 1 / cfg.malletMaxSpeed;
  const f = player === 0 ? 1 : -1;
  out[0] = f * s.px * sx;
  out[1] = f * s.py * sy;
  out[2] = f * s.pvx * sp;
  out[3] = f * s.pvy * sp;
  if (player === 0) {
    out[4] = s.x0 * sx; out[5] = s.y0 * sy; out[6] = s.vx0 * sm; out[7] = s.vy0 * sm;
    out[8] = s.x1 * sx; out[9] = s.y1 * sy;
  } else {
    out[4] = -s.x1 * sx; out[5] = -s.y1 * sy; out[6] = -s.vx1 * sm; out[7] = -s.vy1 * sm;
    out[8] = -s.x0 * sx; out[9] = -s.y0 * sy;
  }
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

// A player's answer (own frame, each in [-1, 1]) as a target on the table, written to t[at], t[at + 1].
// a0 spans the reachable width; a1 spans the own half from the goal end (-1) to the centre line (+1).
export function decodeTarget(cfg: SimConfig, player: 0 | 1, a0: number, a1: number, t: Float64Array, at: number): void {
  const r = cfg.malletRadius;
  const tx = clamp1(a0) * (cfg.halfWidth - r);
  const ty = -(cfg.halfLength - r) + (clamp1(a1) + 1) * 0.5 * (cfg.halfLength - 2 * r);
  if (player === 0) { t[at] = tx; t[at + 1] = ty; } else { t[at] = -tx; t[at + 1] = -ty; }
}

// The inverse, for scripted players: a target in the own frame (table units) as an answer in [-1, 1].
export function encodeTarget(cfg: SimConfig, tx: number, ty: number, out: Float32Array): void {
  const r = cfg.malletRadius;
  out[0] = clamp1(tx / (cfg.halfWidth - r));
  out[1] = clamp1((ty + (cfg.halfLength - r)) / (0.5 * (cfg.halfLength - 2 * r)) - 1);
}
