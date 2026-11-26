// The air-hockey simulator: one puck, two mallets, four walls with a goal mouth in each end wall.
//
// A control step is `cfg.substeps` physics steps. Each physics step runs four phases in order:
// move the mallets toward their targets, move the puck, resolve puck-mallet contact, resolve the walls
// (which is where a goal is detected). The phases are exported so the front door's controls can build a
// step with one phase broken; `step` itself is `stepWith(..., PHASES)`, so there is one composition.
//
// The simulator is symmetric under a half-turn of the table with the players swapped; the `mirror` gate
// in tools/check.ts holds that.

import { DEFAULT_SIM } from './config.ts';
import type { SimConfig } from './config.ts';

export interface State {
  px: number; py: number; pvx: number; pvy: number; // puck
  x0: number; y0: number; vx0: number; vy0: number; // player 0's mallet (bottom)
  x1: number; y1: number; vx1: number; vy1: number; // player 1's mallet (top)
  contact0: boolean; contact1: boolean; // in contact with the puck at the end of the last physics step
  touches0: number; touches1: number; // contacts begun, counted once per contact
}

export const NO_GOAL = -1;
// step() returns NO_GOAL, or the player who scored: 0 when the puck entered the top goal, 1 for the bottom.

export function newState(cfg: SimConfig = DEFAULT_SIM): State {
  const s: State = {
    px: 0, py: 0, pvx: 0, pvy: 0,
    x0: 0, y0: 0, vx0: 0, vy0: 0,
    x1: 0, y1: 0, vx1: 0, vy1: 0,
    contact0: false, contact1: false,
    touches0: 0, touches1: 0,
  };
  serve(s, cfg, 0, 0);
  return s;
}

// Put the puck at rest in `toPlayer`'s half, at across-table position x, and send both mallets home.
// Touch counts are kept: they belong to the match, not to the serve.
export function serve(s: State, cfg: SimConfig, toPlayer: 0 | 1, x: number): void {
  const yServe = cfg.serveOffset * cfg.halfLength;
  const yHome = cfg.homeOffset * cfg.halfLength;
  s.px = x; s.py = toPlayer === 0 ? -yServe : yServe; s.pvx = 0; s.pvy = 0;
  s.x0 = 0; s.y0 = -yHome; s.vx0 = 0; s.vy0 = 0;
  s.x1 = 0; s.y1 = yHome; s.vx1 = 0; s.vy1 = 0;
  s.contact0 = false; s.contact1 = false;
}

export interface Phases {
  moveMallets(s: State, t0x: number, t0y: number, t1x: number, t1y: number, cfg: SimConfig, dt: number): void;
  integratePuck(s: State, cfg: SimConfig, dt: number): void;
  collideMallets(s: State, cfg: SimConfig): void;
  collideWalls(s: State, cfg: SimConfig): number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Each mallet heads for its target, clamped to its own half, at no more than malletMaxSpeed.
function moveMallets(s: State, t0x: number, t0y: number, t1x: number, t1y: number, cfg: SimConfig, dt: number): void {
  const r = cfg.malletRadius;
  const xMax = cfg.halfWidth - r;
  const yFar = cfg.halfLength - r;
  const yNear = r;
  const maxStep = cfg.malletMaxSpeed * dt;

  let tx = clamp(t0x, -xMax, xMax);
  let ty = clamp(t0y, -yFar, -yNear);
  let dx = tx - s.x0;
  let dy = ty - s.y0;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d > maxStep) { const k = maxStep / d; dx *= k; dy *= k; }
  s.x0 += dx; s.y0 += dy; s.vx0 = dx / dt; s.vy0 = dy / dt;

  tx = clamp(t1x, -xMax, xMax);
  ty = clamp(t1y, yNear, yFar);
  dx = tx - s.x1;
  dy = ty - s.y1;
  d = Math.sqrt(dx * dx + dy * dy);
  if (d > maxStep) { const k = maxStep / d; dx *= k; dy *= k; }
  s.x1 += dx; s.y1 += dy; s.vx1 = dx / dt; s.vy1 = dy / dt;
}

function integratePuck(s: State, cfg: SimConfig, dt: number): void {
  const k = 1 - cfg.puckDrag * dt;
  s.pvx *= k; s.pvy *= k;
  s.px += s.pvx * dt; s.py += s.pvy * dt;
}

function clampSpeed(s: State, cfg: SimConfig): void {
  const v2 = s.pvx * s.pvx + s.pvy * s.pvy;
  const m = cfg.puckMaxSpeed;
  if (v2 > m * m) { const k = m / Math.sqrt(v2); s.pvx *= k; s.pvy *= k; }
}

// The mallet is treated as infinitely heavy: the puck bounces off it, the mallet is not pushed back.
function collideOne(s: State, mx: number, my: number, mvx: number, mvy: number, cfg: SimConfig): boolean {
  const R = cfg.puckRadius + cfg.malletRadius;
  const dx = s.px - mx;
  const dy = s.py - my;
  const d2 = dx * dx + dy * dy;
  if (d2 >= R * R) return false;
  let nx: number, ny: number;
  const d = Math.sqrt(d2);
  if (d < 1e-12) { nx = 0; ny = my < 0 ? 1 : -1; } // dead centre: push toward the other half
  else { nx = dx / d; ny = dy / d; }
  s.px = mx + nx * R; s.py = my + ny * R;
  const vn = (s.pvx - mvx) * nx + (s.pvy - mvy) * ny;
  if (vn < 0) {
    const j = (1 + cfg.malletRestitution) * vn;
    s.pvx -= j * nx; s.pvy -= j * ny;
  }
  return true;
}

// The mallet on the puck's side of the centre line is resolved first, so the order is symmetric
// under the half-turn.
function collideMallets(s: State, cfg: SimConfig): void {
  const zeroFirst = s.py < 0 || (s.py === 0 && s.px <= 0);
  let c0: boolean, c1: boolean;
  if (zeroFirst) {
    c0 = collideOne(s, s.x0, s.y0, s.vx0, s.vy0, cfg);
    c1 = collideOne(s, s.x1, s.y1, s.vx1, s.vy1, cfg);
  } else {
    c1 = collideOne(s, s.x1, s.y1, s.vx1, s.vy1, cfg);
    c0 = collideOne(s, s.x0, s.y0, s.vx0, s.vy0, cfg);
  }
  if (c0 && !s.contact0) s.touches0++;
  if (c1 && !s.contact1) s.touches1++;
  s.contact0 = c0; s.contact1 = c1;
  clampSpeed(s, cfg);
}

function collideWalls(s: State, cfg: SimConfig): number {
  const r = cfg.puckRadius;
  const xMax = cfg.halfWidth - r;
  const yMax = cfg.halfLength - r;
  const e = cfg.wallRestitution;
  if (s.px < -xMax) { s.px = -xMax; if (s.pvx < 0) s.pvx = -s.pvx * e; }
  else if (s.px > xMax) { s.px = xMax; if (s.pvx > 0) s.pvx = -s.pvx * e; }
  if (s.py < -yMax) {
    if (Math.abs(s.px) < cfg.goalHalfWidth) return 1;
    s.py = -yMax; if (s.pvy < 0) s.pvy = -s.pvy * e;
  } else if (s.py > yMax) {
    if (Math.abs(s.px) < cfg.goalHalfWidth) return 0;
    s.py = yMax; if (s.pvy > 0) s.pvy = -s.pvy * e;
  }
  return NO_GOAL;
}

export const PHASES: Readonly<Phases> = Object.freeze({ moveMallets, integratePuck, collideMallets, collideWalls });

// One control step with the given phases. Returns NO_GOAL or the player who scored; on a goal the step
// stops at once and the caller serves.
export function stepWith(
  s: State, t0x: number, t0y: number, t1x: number, t1y: number, cfg: SimConfig, ph: Phases,
): number {
  const dt = 1 / (cfg.controlHz * cfg.substeps);
  for (let k = 0; k < cfg.substeps; k++) {
    ph.moveMallets(s, t0x, t0y, t1x, t1y, cfg, dt);
    ph.integratePuck(s, cfg, dt);
    ph.collideMallets(s, cfg);
    const g = ph.collideWalls(s, cfg);
    if (g !== NO_GOAL) return g;
  }
  return NO_GOAL;
}

export function step(s: State, t0x: number, t0y: number, t1x: number, t1y: number, cfg: SimConfig = DEFAULT_SIM): number {
  return stepWith(s, t0x, t0y, t1x, t1y, cfg, PHASES);
}

// A hash of the whole state's bytes, for telling two runs apart.
const hashBuf = new Float64Array(12);
const hashWords = new Uint32Array(hashBuf.buffer);
export function stateHash(s: State): number {
  hashBuf[0] = s.px; hashBuf[1] = s.py; hashBuf[2] = s.pvx; hashBuf[3] = s.pvy;
  hashBuf[4] = s.x0; hashBuf[5] = s.y0; hashBuf[6] = s.vx0; hashBuf[7] = s.vy0;
  hashBuf[8] = s.x1; hashBuf[9] = s.y1; hashBuf[10] = s.vx1; hashBuf[11] = s.vy1;
  let h = 0x811c9dc5;
  for (let i = 0; i < hashWords.length; i++) { h ^= hashWords[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= s.touches0 * 31 + s.touches1;
  return h >>> 0;
}
