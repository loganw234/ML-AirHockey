// The front door: `node tools/check.ts` (or `npm run check`). It answers "does this still hold?".
//
// Each check is a gate and one or more negative controls. A control runs the same gate against a planted
// fault and must FAIL, with the code the fault should produce; a control that passes, or fails for some
// other reason, fails the whole check. Read the verdict line, not the exit code:
//   VERDICT: PASS (<gates> gates, <controls> controls)
// The counts are derived from the list below, so a check cannot be added without being counted.
//
// What these checks cannot see: whether the game is fun or the physics feel right; anything in a browser;
// performance. They hold the simulator's bounds, goals and symmetry, the network against its reference,
// checkpoints, determinism of a match, and that the yardstick can tell a strong player from a weak one.

import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SIM, PHASE0_TABLE } from '../src/config.ts';
import type { SimConfig } from '../src/config.ts';
import { makeRng } from '../src/rng.ts';
import { newState, serve, stepWith, step, stateHash, PHASES, NO_GOAL } from '../src/sim.ts';
import type { State, Phases } from '../src/sim.ts';
import { observe, decodeTarget, NUM_INPUTS, NUM_OUTPUTS, INPUT_NAMES, OUTPUT_NAMES } from '../src/obs.ts';
import { makeNet, randomGenome, forward, netPolicy, genomeLength } from '../src/net.ts';
import type { Net } from '../src/net.ts';
import { referenceForward } from '../src/net_ref.ts';
import { toCheckpoint, fromCheckpoint } from '../src/checkpoint.ts';
import { referenceBot, statueBot } from '../src/bots.ts';
import { playMatch, serveRandom } from '../src/match.ts';
import type { MatchResult } from '../src/match.ts';
import { tally, evalSeeds, winRate, EVAL_MATCH } from '../src/evaluate.ts';
import type { Tally } from '../src/evaluate.ts';
import type { Policy } from '../src/policy.ts';
import { createLiveMatch } from '../web/live.ts';
import { weightIndex, biasIndex, layerOffset } from '../web/layout.ts';
import { build } from './build.ts';
import { ObsBuffer, weightRaise, neuronStats, explainWeight, explainNeuron, explainBias, INPUT_HELP, OUTPUT_HELP } from '../web/explain.ts';
import { Trainer, flatten } from '../src/trainer.ts';
import type { Backend } from '../src/trainer.ts';
import { handle } from '../src/workerCore.ts';
import type { PlayReply, EvalReply } from '../src/workerCore.ts';
import { DEFAULT_EVO, STEADY_EVO } from '../src/evolve.ts';
import type { EvoConfig } from '../src/evolve.ts';

interface Verdict { ok: boolean; code: string; detail: string }
const pass = (detail: string): Verdict => ({ ok: true, code: 'OK', detail });
const fail = (code: string, detail: string): Verdict => ({ ok: false, code, detail });

type Run = () => Verdict | Promise<Verdict>;
interface Control { name: string; expect: string; run: Run }
interface Check { name: string; gate: Run; controls: Control[] }

const SIZES = [NUM_INPUTS, 16, NUM_OUTPUTS];
const EPS = 1e-9;

// ---------------------------------------------------------------------------------------------------
// bounds: in many matches of mixed players, the puck and mallets never leave where they may be.

function boundsGate(ph: Phases, cfg: SimConfig = DEFAULT_SIM): Verdict {
  const rng = makeRng(7);
  const players: (() => Policy)[] = [
    () => referenceBot(cfg),
    () => statueBot(cfg),
    () => netPolicy(makeNet(SIZES, randomGenome(SIZES, rng))),
    () => netPolicy(makeNet(SIZES, randomGenome(SIZES, rng).map((w) => w * 4))),
  ];
  const xMax = cfg.halfWidth - cfg.puckRadius, yMax = cfg.halfLength - cfg.puckRadius;
  const mxMax = cfg.halfWidth - cfg.malletRadius, myFar = cfg.halfLength - cfg.malletRadius, myNear = cfg.malletRadius;
  const o = new Float32Array(NUM_INPUTS), a = new Float32Array(NUM_OUTPUTS), t = new Float64Array(4);
  let steps = 0, goals = 0, sideWall = 0, touches = 0, onArc = 0;
  // How far a body of radius r is outside its corner arc (0 when allowed, or when not in a corner square).
  const rc = cfg.cornerRadius;
  const arcExcess = (x: number, y: number, r: number): number => {
    const ax = cfg.halfWidth - rc, ay = cfg.halfLength - rc;
    if (rc <= r || !(Math.abs(x) > ax && Math.abs(y) > ay)) return 0;
    return Math.hypot(Math.abs(x) - ax, Math.abs(y) - ay) - (rc - r);
  };
  const matches = 40;
  for (let m = 0; m < matches; m++) {
    const p0 = players[m % players.length](), p1 = players[(m >> 2) % players.length]();
    const s = newState(cfg);
    serveRandom(s, cfg, rng() < 0.5 ? 0 : 1, rng);
    for (let k = 0; k < 1800; k++) {
      observe(s, 0, cfg, o); p0(o, a); decodeTarget(cfg, 0, a[0], a[1], t, 0);
      observe(s, 1, cfg, o); p1(o, a); decodeTarget(cfg, 1, a[0], a[1], t, 2);
      const g = stepWith(s, t[0], t[1], t[2], t[3], cfg, ph);
      steps++;
      const vals = [s.px, s.py, s.pvx, s.pvy, s.x0, s.y0, s.x1, s.y1];
      if (!vals.every(Number.isFinite)) return fail('NOT-FINITE', `match ${m} step ${k}: a coordinate is not finite`);
      if (g === NO_GOAL) {
        if (Math.abs(s.px) > xMax + EPS || Math.abs(s.py) > yMax + EPS) {
          return fail('OUT-OF-BOUNDS', `match ${m} step ${k}: puck at (${s.px.toFixed(4)}, ${s.py.toFixed(4)})`);
        }
        if (Math.abs(s.px) >= xMax - 1e-6) sideWall++;
        const ex = arcExcess(s.px, s.py, cfg.puckRadius);
        if (ex > EPS) return fail('OUT-OF-CORNER', `match ${m} step ${k}: puck ${ex.toExponential(2)} outside a corner arc at (${s.px.toFixed(4)}, ${s.py.toFixed(4)})`);
        if (rc > cfg.puckRadius && ex > -1e-6 && Math.abs(s.px) > cfg.halfWidth - rc && Math.abs(s.py) > cfg.halfLength - rc) onArc++;
      }
      if (arcExcess(s.x0, s.y0, cfg.malletRadius) > EPS || arcExcess(s.x1, s.y1, cfg.malletRadius) > EPS) {
        return fail('MALLET-OUT', `match ${m} step ${k}: a mallet is outside a corner arc`);
      }
      if (Math.abs(s.x0) > mxMax + EPS || s.y0 < -myFar - EPS || s.y0 > -myNear + EPS ||
          Math.abs(s.x1) > mxMax + EPS || s.y1 > myFar + EPS || s.y1 < myNear - EPS) {
        return fail('MALLET-OUT', `match ${m} step ${k}: mallets at (${s.x0.toFixed(3)}, ${s.y0.toFixed(3)}) and (${s.x1.toFixed(3)}, ${s.y1.toFixed(3)})`);
      }
      if (Math.hypot(s.pvx, s.pvy) > cfg.puckMaxSpeed + 1e-6) return fail('TOO-FAST', `match ${m} step ${k}: puck speed ${Math.hypot(s.pvx, s.pvy)}`);
      if (g !== NO_GOAL) { goals++; serveRandom(s, cfg, g === 0 ? 1 : 0, rng); }
    }
    touches += s.touches0 + s.touches1;
  }
  // A run in which nothing happened proves nothing.
  if (goals === 0 || touches === 0 || sideWall === 0 || (rc > cfg.puckRadius && onArc === 0)) {
    return fail('VACUOUS', `goals ${goals}, touches ${touches}, side-wall contacts ${sideWall}, steps on a corner arc ${onArc}: the run did not exercise the table`);
  }
  return pass(`${matches} matches, ${steps} steps, ${goals} goals, ${touches} touches, ${sideWall} steps at a side wall, ${onArc} on a corner arc; nothing left the table`);
}

// The planted fault: the puck is walled as if the corners were square, on a table whose corners are round.
const squareCorners = (s: State, cfg: SimConfig): number => PHASES.collideWalls(s, { ...cfg, cornerRadius: 0 });

// ---------------------------------------------------------------------------------------------------
// no-pin: the reference bot playing itself almost never holds the puck in its half past the possession
// limit. On Phase 0's square corners it did, 2.83 times a match (docs/PHASE0.md): the puck was pinned.

function noPinGate(cfg: SimConfig): Verdict {
  const opts = { goalsToWin: 3, maxSeconds: 60, cfg };
  let fouls = 0;
  const n = 100;
  for (let k = 0; k < n; k++) {
    const r = playMatch(referenceBot(cfg), referenceBot(cfg), 8_000_000 + k, opts);
    fouls += r.fouls0 + r.fouls1;
  }
  const perSide = fouls / (2 * n);
  if (perSide > 0.2) return fail('PINNED', `the reference bot against itself held the puck past the limit ${perSide.toFixed(2)} times a match (allowed 0.2)`);
  return pass(`the reference bot against itself: ${perSide.toFixed(2)} possession fouls a match over ${n} matches (allowed 0.2)`);
}

// ---------------------------------------------------------------------------------------------------
// speed-limit: each mallet keeps to its own top speed, malletMaxSpeed times its scale, and reaches it.

function speedLimitGate(ph: Phases): Verdict {
  const cfg: SimConfig = { ...DEFAULT_SIM, malletSpeedScale0: 0.5, malletSpeedScale1: 0.25 };
  const lim0 = cfg.malletMaxSpeed * 0.5 / cfg.controlHz, lim1 = cfg.malletMaxSpeed * 0.25 / cfg.controlHz;
  const rng = makeRng(37);
  const o = new Float32Array(NUM_INPUTS), a = new Float32Array(NUM_OUTPUTS), t = new Float64Array(4);
  let top0 = 0, top1 = 0;
  for (let m = 0; m < 10; m++) {
    const p0 = referenceBot(cfg), p1 = referenceBot(cfg);
    const s = newState(cfg);
    serveRandom(s, cfg, m % 2 === 0 ? 0 : 1, rng);
    for (let k = 0; k < 900; k++) {
      const x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1;
      observe(s, 0, cfg, o); p0(o, a); decodeTarget(cfg, 0, a[0], a[1], t, 0);
      observe(s, 1, cfg, o); p1(o, a); decodeTarget(cfg, 1, a[0], a[1], t, 2);
      const g = stepWith(s, t[0], t[1], t[2], t[3], cfg, ph);
      if (g !== NO_GOAL) { serveRandom(s, cfg, g === 0 ? 1 : 0, rng); continue; }
      const d0 = Math.hypot(s.x0 - x0, s.y0 - y0), d1 = Math.hypot(s.x1 - x1, s.y1 - y1);
      if (d0 > lim0 + 1e-12 || d1 > lim1 + 1e-12) {
        return fail('TOO-FAST-MALLET', `match ${m} step ${k}: mallets moved ${d0.toFixed(5)} and ${d1.toFixed(5)} in a step, limits ${lim0.toFixed(5)} and ${lim1.toFixed(5)}`);
      }
      top0 = Math.max(top0, d0); top1 = Math.max(top1, d1);
    }
  }
  if (top0 < 0.95 * lim0 || top1 < 0.95 * lim1) return fail('VACUOUS', `the mallets never neared their limits (${(top0 / lim0).toFixed(2)}, ${(top1 / lim1).toFixed(2)} of them)`);
  return pass(`at scales 0.5 and 0.25 each mallet kept to its own top speed and reached it`);
}

// Planted fault: player 1's scale is ignored, and it moves at player 0's.
const sharedScale: Phases['moveMallets'] = (s, t0x, t0y, t1x, t1y, cfg, dt) =>
  PHASES.moveMallets(s, t0x, t0y, t1x, t1y, { ...cfg, malletSpeedScale1: cfg.malletSpeedScale0 }, dt);

// The planted fault: the side walls are gone (the end walls and goals are kept).
function noSideWalls(s: State, cfg: SimConfig): number {
  const yMax = cfg.halfLength - cfg.puckRadius;
  if (s.py < -yMax) { if (Math.abs(s.px) < cfg.goalHalfWidth) return 1; s.py = -yMax; if (s.pvy < 0) s.pvy = -s.pvy * cfg.wallRestitution; }
  else if (s.py > yMax) { if (Math.abs(s.px) < cfg.goalHalfWidth) return 0; s.py = yMax; if (s.pvy > 0) s.pvy = -s.pvy * cfg.wallRestitution; }
  return NO_GOAL;
}

// ---------------------------------------------------------------------------------------------------
// goals: a puck sent straight into a goal mouth scores for the right player; one sent at the wall beside
// the mouth bounces back and does not score. Both ends.

function goalsGate(cfg: SimConfig): Verdict {
  const r = cfg.malletRadius;
  const run = (puckX: number, toward: 0 | 1, steps: number): { scorer: number; pvy: number } => {
    const s = newState(cfg);
    const dir = toward === 0 ? -1 : 1; // toward player 0's goal is downward
    s.px = puckX; s.py = 0.5 * dir * cfg.halfLength; s.pvx = 0; s.pvy = 3 * dir;
    // Both mallets parked in the corner by the centre line, away from the puck's path.
    const t0x = -(cfg.halfWidth - r), t0y = -r, t1x = cfg.halfWidth - r, t1y = r;
    s.x0 = t0x; s.y0 = t0y; s.x1 = t1x; s.y1 = t1y;
    for (let k = 0; k < steps; k++) {
      const g = step(s, t0x, t0y, t1x, t1y, cfg);
      if (g !== NO_GOAL) return { scorer: g, pvy: s.pvy };
    }
    return { scorer: NO_GOAL, pvy: s.pvy };
  };
  const into0 = run(0, 0, 60), into1 = run(0, 1, 60);
  if (into0.scorer !== 1) return fail('NO-GOAL', `a puck sent into the bottom goal: scorer ${into0.scorer}, expected 1`);
  if (into1.scorer !== 0) return fail('NO-GOAL', `a puck sent into the top goal: scorer ${into1.scorer}, expected 0`);
  // 25 steps: long enough to reach the wall and come back, short enough not to reach the parked mallet.
  const wall0 = run(0.35, 0, 25), wall1 = run(-0.35, 1, 25);
  if (wall0.scorer !== NO_GOAL || wall1.scorer !== NO_GOAL) return fail('WALL-SCORED', `a puck sent at the end wall beside the mouth scored (${wall0.scorer}, ${wall1.scorer})`);
  if (!(wall0.pvy > 0) || !(wall1.pvy < 0)) return fail('NO-BOUNCE', `a puck sent at the end wall did not come back: vy ${wall0.pvy.toFixed(3)} and ${wall1.pvy.toFixed(3)}`);
  return pass('both goal mouths score for the right player; both end walls beside them bounce the puck back');
}

// ---------------------------------------------------------------------------------------------------
// net-ref: the fast forward pass equals the slow reference, on several shapes, saturated and not.

type Forward = (net: Net, x: Float32Array) => Float32Array;

function netRefGate(fwd: Forward): Verdict {
  const rng = makeRng(11);
  const shapes = [[10, 16, 2], [10, 16, 16, 2], [10, 2], [10, 8, 8, 8, 2]];
  let worst = 0, cases = 0;
  for (const sizes of shapes) {
    for (let n = 0; n < 50; n++) {
      const scale = n % 2 === 0 ? 1 : 3;
      const genome = randomGenome(sizes, rng).map((w) => w * scale);
      const net = makeNet(sizes, genome);
      for (let k = 0; k < 20; k++) {
        const x = new Float32Array(sizes[0]);
        for (let i = 0; i < x.length; i++) x[i] = (rng() * 2 - 1) * 1.5;
        const fast = fwd(net, x);
        const ref = referenceForward(sizes, genome, x);
        for (let j = 0; j < ref.length; j++) worst = Math.max(worst, Math.abs(fast[j] - ref[j]));
        cases++;
      }
    }
  }
  if (!(worst <= 1e-5)) return fail('NET-MISMATCH', `the fast pass differs from the reference by up to ${worst.toExponential(2)} over ${cases} cases`);
  return pass(`${cases} cases over ${shapes.length} shapes; largest difference ${worst.toExponential(2)} (allowed 1e-5)`);
}

// Planted fault: weights read as columns ([in][out]) instead of rows, the trainer-versus-drawer mix-up.
const transposedForward: Forward = (net, input) => {
  const g = net.genome, sizes = net.sizes;
  let x: Float32Array = input, off = 0;
  for (let l = 0; l + 1 < sizes.length; l++) {
    const nin = sizes[l], nout = sizes[l + 1], y = net.acts[l], bOff = off + nin * nout;
    for (let j = 0; j < nout; j++) {
      let sum = g[bOff + j];
      for (let i = 0; i < nin; i++) sum += g[off + i * nout + j] * x[i];
      y[j] = Math.tanh(sum);
    }
    off = bOff + nout; x = y;
  }
  return x;
};

// Planted fault: one weight off by 1e-3, to show the tolerance is tight enough to see a small error.
const nudgedForward: Forward = (net, input) => {
  const g = new Float32Array(net.genome);
  g[0] += 1e-3;
  return forward({ sizes: net.sizes, genome: g, acts: net.acts }, input);
};

// ---------------------------------------------------------------------------------------------------
// ref-independent: the reference pass imports nothing, so it cannot share a bug with what it judges.

function independentGate(text: string): Verdict {
  if (/^\s*import\s/m.test(text) || /\brequire\s*\(/.test(text) || /\bimport\s*\(/.test(text)) {
    return fail('REF-IMPORTS', 'src/net_ref.ts imports something; the reference must stand alone');
  }
  return pass('src/net_ref.ts imports nothing');
}

const netRefText = readFileSync(fileURLToPath(new URL('../src/net_ref.ts', import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------------------------------
// checkpoint: a save and a load give back the same bits; a checkpoint that does not fit is refused by name.

function checkpointGate(save: (net: Net) => string): Verdict {
  const rng = makeRng(13);
  for (const sizes of [[NUM_INPUTS, 16, NUM_OUTPUTS], [NUM_INPUTS, 16, 16, NUM_OUTPUTS]]) {
    for (let n = 0; n < 20; n++) {
      const net = makeNet(sizes, randomGenome(sizes, rng).map((w) => w * (1 + rng() * 10)));
      const back = fromCheckpoint(save(net)).net;
      const a = new Uint32Array(net.genome.buffer), b = new Uint32Array(back.genome.buffer);
      if (a.length !== b.length || a.some((v, i) => v !== b[i])) return fail('ROUNDTRIP-MISMATCH', `sizes [${sizes}] net ${n}: the weights came back changed`);
    }
  }
  const good = JSON.parse(toCheckpoint(makeNet(SIZES, randomGenome(SIZES, rng)), 0));
  const refusals: [string, unknown][] = [
    ['CHECKPOINT-FORMAT', { ...good, format: 'something-else' }],
    ['CHECKPOINT-SIZES', { ...good, sizes: [9, 16, 2] }],
    ['CHECKPOINT-INPUTS', { ...good, inputs: [...good.inputs].reverse() }],
    ['CHECKPOINT-LENGTH', { ...good, weights: good.weights.slice(1) }],
    ['CHECKPOINT-NONFINITE', { ...good, weights: [null, ...good.weights.slice(1)] }],
  ];
  for (const [code, bad] of refusals) {
    let msg = '';
    try { fromCheckpoint(JSON.stringify(bad)); } catch (e) { msg = (e as Error).message; }
    if (!msg.startsWith(code)) return fail('NOT-REFUSED', `expected a refusal ${code}, got ${msg ? `"${msg}"` : 'none'}`);
  }
  return pass(`40 round trips bit for bit; ${refusals.length} bad checkpoints refused, each by its own name`);
}

// Planted fault: weights written with four decimals.
const lossySave = (net: Net): string => {
  const c = JSON.parse(toCheckpoint(net, 0));
  c.weights = c.weights.map((w: number) => Number(w.toFixed(4)));
  return JSON.stringify(c);
};

// ---------------------------------------------------------------------------------------------------
// mirror: a game and its half-turn (table rotated, players swapped) stay exact mirror images, step for
// step, with networks choosing the moves from their observations. Holds the simulator and obs.ts together.

type Observe = (s: State, player: 0 | 1, cfg: SimConfig, out: Float32Array) => void;

function rotate(s: State): State {
  return {
    px: -s.px, py: -s.py, pvx: -s.pvx, pvy: -s.pvy,
    x0: -s.x1, y0: -s.y1, vx0: -s.vx1, vy0: -s.vy1,
    x1: -s.x0, y1: -s.y0, vx1: -s.vx0, vy1: -s.vy0,
    contact0: s.contact1, contact1: s.contact0, touches0: s.touches1, touches1: s.touches0,
  };
}

function sameState(a: State, b: State): boolean {
  return a.px === b.px && a.py === b.py && a.pvx === b.pvx && a.pvy === b.pvy &&
    a.x0 === b.x0 && a.y0 === b.y0 && a.vx0 === b.vx0 && a.vy0 === b.vy0 &&
    a.x1 === b.x1 && a.y1 === b.y1 && a.vx1 === b.vx1 && a.vy1 === b.vy1 &&
    a.contact0 === b.contact0 && a.contact1 === b.contact1 && a.touches0 === b.touches0 && a.touches1 === b.touches1;
}

function mirrorGate(obs: Observe, cfg: SimConfig = DEFAULT_SIM): Verdict {
  const rng = makeRng(17);
  let steps = 0, goals = 0, touches = 0;
  for (let game = 0; game < 30; game++) {
    const A = makeNet(SIZES, randomGenome(SIZES, rng).map((w) => w * 2));
    const B = makeNet(SIZES, randomGenome(SIZES, rng).map((w) => w * 2));
    const s = newState(cfg);
    serve(s, cfg, game % 2 === 0 ? 0 : 1, (rng() * 2 - 1) * 0.3);
    const m = rotate(s);
    const oS = new Float32Array(NUM_INPUTS), oM = new Float32Array(NUM_INPUTS), tS = new Float64Array(4), tM = new Float64Array(4);
    for (let k = 0; k < 600; k++) {
      // In s, A is player 0 and B player 1; in the mirror m, B is player 0 and A player 1.
      obs(s, 0, cfg, oS); obs(m, 1, cfg, oM);
      if (oS.some((v, i) => v !== oM[i])) return fail('MIRROR-BROKEN', `game ${game} step ${k}: A's two views differ`);
      let y = forward(A, oS); decodeTarget(cfg, 0, y[0], y[1], tS, 0);
      y = forward(A, oM); decodeTarget(cfg, 1, y[0], y[1], tM, 2);
      obs(s, 1, cfg, oS); obs(m, 0, cfg, oM);
      if (oS.some((v, i) => v !== oM[i])) return fail('MIRROR-BROKEN', `game ${game} step ${k}: B's two views differ`);
      y = forward(B, oS); decodeTarget(cfg, 1, y[0], y[1], tS, 2);
      y = forward(B, oM); decodeTarget(cfg, 0, y[0], y[1], tM, 0);
      const gS = step(s, tS[0], tS[1], tS[2], tS[3], cfg);
      const gM = step(m, tM[0], tM[1], tM[2], tM[3], cfg);
      steps++;
      if (gS !== (gM === NO_GOAL ? NO_GOAL : 1 - gM)) return fail('MIRROR-BROKEN', `game ${game} step ${k}: goals differ (${gS} and ${gM})`);
      if (!sameState(rotate(s), m)) return fail('MIRROR-BROKEN', `game ${game} step ${k}: the states are no longer mirror images`);
      if (gS !== NO_GOAL) {
        goals++;
        const x = (rng() * 2 - 1) * 0.3, to: 0 | 1 = gS === 0 ? 1 : 0;
        serve(s, cfg, to, x); serve(m, cfg, to === 0 ? 1 : 0, -x);
      }
    }
    touches += s.touches0 + s.touches1;
  }
  if (touches === 0) return fail('VACUOUS', 'no mallet touched the puck: the collisions were never mirrored');
  return pass(`30 games, ${steps} steps, ${goals} goals, ${touches} touches: every step an exact mirror image`);
}

// Planted fault: player 1 is not told the puck's x velocity is turned round.
const badObserve: Observe = (s, player, cfg, out) => {
  observe(s, player, cfg, out);
  if (player === 1) out[2] = -out[2];
};

// ---------------------------------------------------------------------------------------------------
// yardstick: the evaluation can tell a strong player from a weak one, and calls a mirror match even.

type TallyFn = (makePol: () => Policy, makeOpp: () => Policy, seeds: readonly number[]) => Tally;

function yardstickGate(count: TallyFn): Verdict {
  const ref = () => referenceBot(), statue = () => statueBot();
  const vsStatue = count(ref, statue, evalSeeds(5_000_000, 100));
  if (!(winRate(vsStatue) >= 0.9)) return fail('YARDSTICK-BLIND', `the reference bot beat the statue in only ${fmt(vsStatue)}`);
  const vsRef = count(ref, ref, evalSeeds(5_100_000, 200));
  const n = vsRef.wins + vsRef.losses + vsRef.draws;
  if (Math.abs(vsRef.wins - vsRef.losses) > 0.2 * n) return fail('YARDSTICK-LOPSIDED', `the reference bot against itself: ${fmt(vsRef)}`);
  return pass(`reference bot vs statue ${fmt(vsStatue)}; reference bot vs itself ${fmt(vsRef)}`);
}

function fmt(t: Tally): string {
  return `${t.wins}-${t.losses}-${t.draws} (W-L-D), ${(100 * winRate(t)).toFixed(1)}% wins`;
}

// Planted fault: the seat is forgotten, so a win from the top end is counted as a loss.
const seatBlindTally: TallyFn = (makePol, makeOpp, seeds) => {
  const t = { wins: 0, losses: 0, draws: 0 };
  for (const seed of seeds) {
    const seat = seed & 1;
    const r: MatchResult = seat === 0 ? playMatch(makePol(), makeOpp(), seed, EVAL_MATCH) : playMatch(makeOpp(), makePol(), seed, EVAL_MATCH);
    if (r.winner === -1) t.draws++; else if (r.winner === 0) t.wins++; else t.losses++;
  }
  return t;
};

// ---------------------------------------------------------------------------------------------------
// determinism: the same seed gives the same match; a different seed gives a different one.

function determinismGate(make: () => Policy): Verdict {
  const opts = { goalsToWin: 3, maxSeconds: 30 };
  const a = playMatch(make(), referenceBot(), 42, opts);
  const b = playMatch(make(), referenceBot(), 42, opts);
  if (JSON.stringify(a) !== JSON.stringify(b)) return fail('NONDETERMINISTIC', `seed 42 twice: hashes ${a.hash} and ${b.hash}`);
  const c = playMatch(make(), referenceBot(), 43, opts);
  if (c.hash === a.hash) return fail('SEED-IGNORED', 'seeds 42 and 43 gave the same match');
  return pass(`seed 42 twice gave hash ${a.hash} both times (${a.steps} steps); seed 43 gave ${c.hash}`);
}

const fixedNet = (() => { const g = randomGenome(SIZES, makeRng(19)); return () => netPolicy(makeNet(SIZES, new Float32Array(g))); })();

// Planted fault: a player that jitters with Math.random, the unseeded randomness this gate exists to catch.
const jitteryNet = (): Policy => {
  const p = fixedNet();
  return (o, out) => { p(o, out); out[0] += (Math.random() - 0.5) * 1e-3; };
};

// ---------------------------------------------------------------------------------------------------
// layout: the explorer's reading of the genome (web/layout.ts) names the weight the forward pass uses.

type WeightIndex = (sizes: readonly number[], l: number, j: number, i: number) => number;

function layoutGate(wIdx: WeightIndex): Verdict {
  let probes = 0;
  for (const sizes of [[10, 16, 2], [10, 8, 8, 2], [10, 2]]) {
    const len = genomeLength(sizes);
    const seen = new Uint8Array(len);
    const mark = (k: number, what: string): Verdict | null => {
      if (!(k >= 0 && k < len) || seen[k]) return fail('LAYOUT-OVERLAP', `sizes [${sizes}]: ${what} maps to index ${k}, used twice or out of range`);
      seen[k] = 1; return null;
    };
    for (let l = 0; l + 1 < sizes.length; l++) {
      for (let j = 0; j < sizes[l + 1]; j++) {
        for (let i = 0; i < sizes[l]; i++) { const v = mark(wIdx(sizes, l, j, i), `weight ${l}/${j}/${i}`); if (v) return v; }
        const v = mark(biasIndex(sizes, l, j), `bias ${l}/${j}`); if (v) return v;
      }
    }
    if (seen.some((v) => v === 0)) return fail('LAYOUT-GAP', `sizes [${sizes}]: some genome index is named by no weight or bias`);
    // Drive each connection alone through the real forward pass and see it arrive where it says.
    for (let l = 0; l + 1 < sizes.length; l++) {
      for (let j = 0; j < sizes[l + 1]; j++) {
        for (let i = 0; i < sizes[l]; i++) {
          const g = new Float32Array(len);
          if (l > 0) g[biasIndex(sizes, l - 1, i)] = 1; // neuron i of the layer before is then tanh(1)
          g[wIdx(sizes, l, j, i)] = 1;
          const x = new Float32Array(sizes[0]);
          if (l === 0) x[i] = 0.5;
          const net = makeNet(sizes, g);
          forward(net, x);
          const inVal = l === 0 ? 0.5 : Math.tanh(1);
          for (let jj = 0; jj < sizes[l + 1]; jj++) {
            const want = jj === j ? Math.tanh(inVal) : 0;
            if (Math.abs(net.acts[l][jj] - want) > 1e-6) return fail('LAYOUT-WRONG', `sizes [${sizes}]: the weight named ${l}/${j}/${i} drove neuron ${jj} of layer ${l + 1}`);
          }
          probes++;
        }
      }
    }
  }
  return pass(`${probes} connections each driven alone through the forward pass, arriving where web/layout.ts says`);
}

// Planted fault: the explorer reads weights as columns.
const transposedIndex: WeightIndex = (sizes, l, j, i) => layerOffset(sizes, l) + i * sizes[l + 1] + j;

// ---------------------------------------------------------------------------------------------------
// live-equals-batch: the page's stepper (web/live.ts) plays the same match as playMatch, for the same
// players and seed, state hash included. The rules are written in both; this holds them together.

function liveGate(liveCfg: SimConfig): Verdict {
  const cfg = DEFAULT_SIM;
  const gA = randomGenome(SIZES, makeRng(29)), gB = randomGenome(SIZES, makeRng(31));
  const net = (g: Float32Array) => () => netPolicy(makeNet(SIZES, new Float32Array(g)));
  const ref = () => referenceBot(), statue = () => statueBot();
  const pairs: [() => Policy, () => Policy][] = [[ref, statue], [statue, ref], [ref, ref], [net(gA), ref], [net(gA), net(gB)]];
  const opts = { goalsToWin: 3, maxSeconds: 40 };
  const maxSteps = Math.round(opts.maxSeconds * cfg.controlHz);
  let fouls = 0, goals = 0, matches = 0;
  const o = new Float32Array(NUM_INPUTS), a = new Float32Array(NUM_OUTPUTS), t = new Float64Array(4);
  for (let n = 0; n < 40; n++) {
    const [m0, m1] = pairs[n % pairs.length];
    const seed = 7_000_000 + n;
    const batch = playMatch(m0(), m1(), seed, opts);
    const p0 = m0(), p1 = m1();
    const live = createLiveMatch(seed, liveCfg);
    let won = false;
    while (live.steps < maxSteps) {
      live.servePending();
      observe(live.s, 0, cfg, o); p0(o, a); decodeTarget(cfg, 0, a[0], a[1], t, 0);
      observe(live.s, 1, cfg, o); p1(o, a); decodeTarget(cfg, 1, a[0], a[1], t, 2);
      live.step(t[0], t[1], t[2], t[3]);
      if (live.goals0 >= opts.goalsToWin || live.goals1 >= opts.goalsToWin) { won = true; break; }
    }
    if (!won) live.servePending(); // playMatch serves at once after a non-winning goal or a foul
    const same = live.goals0 === batch.goals0 && live.goals1 === batch.goals1 && live.steps === batch.steps &&
      live.fouls0 === batch.fouls0 && live.fouls1 === batch.fouls1 &&
      live.s.touches0 === batch.touches0 && live.s.touches1 === batch.touches1 && stateHash(live.s) === batch.hash;
    if (!same) {
      return fail('LIVE-DIVERGES', `seed ${seed}: live ${live.goals0}-${live.goals1} in ${live.steps} steps, fouls ${live.fouls0}/${live.fouls1}; batch ${batch.goals0}-${batch.goals1} in ${batch.steps}, fouls ${batch.fouls0}/${batch.fouls1}`);
    }
    fouls += batch.fouls0 + batch.fouls1; goals += batch.goals0 + batch.goals1; matches++;
  }
  if (fouls === 0 || goals === 0) return fail('VACUOUS', `fouls ${fouls}, goals ${goals}: the rules written twice were not both exercised`);
  return pass(`${matches} matches identical to playMatch, state hash included; ${goals} goals and ${fouls} possession fouls among them`);
}

// ---------------------------------------------------------------------------------------------------
// explain: the inspector's explanations (web/explain.ts) find a known path through a network, and see
// nothing where there is none. Every input and output name has its words, and no text says NaN.

function explainGate(idx: WeightIndex): Verdict {
  const names = (list: readonly string[]) => list as readonly string[];
  const missing = [...names(INPUT_NAMES).filter((n) => !INPUT_HELP[n]), ...names(OUTPUT_NAMES).filter((n) => !OUTPUT_HELP[n])];
  const stale = [...Object.keys(INPUT_HELP).filter((n) => !names(INPUT_NAMES).includes(n)), ...Object.keys(OUTPUT_HELP).filter((n) => !names(OUTPUT_NAMES).includes(n))];
  if (missing.length) return fail('EXPLAIN-MISSING', `no words for ${missing.join(', ')}`);
  if (stale.length) return fail('EXPLAIN-STALE', `words for names the network no longer has: ${stale.join(', ')}`);
  // One path only: puck x (input 0) -> hidden 1 -> target x (output 0).
  const sizes = [NUM_INPUTS, 4, NUM_OUTPUTS];
  const g = new Float32Array(genomeLength(sizes));
  g[weightIndex(sizes, 0, 1, 0)] = 1.5;
  g[weightIndex(sizes, 1, 0, 1)] = 1.5;
  const net = makeNet(sizes, g);
  const buf = new ObsBuffer(300, NUM_INPUTS);
  const rng = makeRng(41);
  const row = new Float32Array(NUM_INPUTS);
  for (let k = 0; k < 300; k++) { row.fill(0); row[0] = rng() * 2 - 1; row[3] = rng() * 2 - 1; buf.push(row); }
  const on = weightRaise(net, buf, 0, 1, 0, 0.5, idx);
  if (!(on.pos.dx > 0.01 && on.neg.dx < -0.01) || Math.abs(on.pos.dy) > 1e-6 || Math.abs(on.neg.dy) > 1e-6) {
    return fail('EXPLAIN-WRONG', `raising the weight on the only path moved target x by ${on.pos.dx.toFixed(4)} (puck x positive) and ${on.neg.dx.toFixed(4)} (negative), target y by ${on.pos.dy.toFixed(4)}`);
  }
  const offPath = weightRaise(net, buf, 0, 2, 3, 0.5, idx); // input 3 into hidden 2, which reaches no output
  if (offPath.all.size > 1e-9) return fail('EXPLAIN-WRONG', `a weight on no path moved the aim by ${offPath.all.size}`);
  const st = neuronStats(net, buf, 1, 1);
  if (!(st.corr[0] > 0.95) || Math.abs(st.corr[3]) > 0.2) return fail('EXPLAIN-WRONG', `hidden 2 should follow puck x alone; correlations ${st.corr[0].toFixed(2)} and ${st.corr[3].toFixed(2)}`);
  // Every explanation of this network reads as words.
  const nodeName = (n: number, j: number) => (n === 0 ? INPUT_NAMES[j] : n === sizes.length - 1 ? OUTPUT_NAMES[j] : `hidden ${j + 1}`);
  const texts: string[] = [];
  for (let l = 0; l + 1 < sizes.length; l++) for (let j = 0; j < sizes[l + 1]; j++) for (let i = 0; i < sizes[l]; i++) texts.push(...explainWeight(net, buf, l, j, i, { node: nodeName }));
  for (let n = 0; n < sizes.length; n++) for (let j = 0; j < sizes[n]; j++) {
    texts.push(...explainNeuron(net, buf, n, j, { node: nodeName }, false));
    if (n > 0) texts.push(explainBias(net, buf, n, j, { node: nodeName }));
  }
  const bad = texts.find((t) => /NaN|undefined|Infinity/.test(t));
  if (bad) return fail('EXPLAIN-GARBLED', `an explanation reads: ${bad}`);
  return pass(`a one-path network's weight moves target x the right way on each side and nothing else; ${texts.length} explanations, none garbled`);
}

// ---------------------------------------------------------------------------------------------------
// trainer: the shared training loop (src/trainer.ts) is repeatable, seed for seed, in both of its modes;
// "steady" re-scores from its second generation on; and the champion always survives into the next
// population.

function inProcess(noise: boolean): Backend {
  return {
    async play(evo, len, pop, hof, tasks) {
      const r = handle({
        type: 'play', evo, len, pop: flatten(pop, len), hof: flatten(hof, len),
        individual: tasks.map((t) => t.individual), oppKind: tasks.map((t) => t.oppKind), oppIndex: tasks.map((t) => t.oppIndex), seed: tasks.map((t) => t.seed),
      }) as PlayReply;
      if (noise) for (let k = 0; k < r.fitness.length; k++) r.fitness[k] += Math.random() * 0.01;
      return r;
    },
    async evaluate(sizes, genome, opponent, seeds) {
      return (handle({ type: 'eval', sizes, genome, opponent, seeds }) as EvalReply).tally;
    },
  };
}

async function trainerGate(backend: () => Backend): Promise<Verdict> {
  const small: EvoConfig = { ...DEFAULT_EVO, sizes: [NUM_INPUTS, 4, NUM_OUTPUTS], popSize: 12, eliteCount: 2, parentPool: 4, matchesPerEval: 2, trainMaxSeconds: 4 };
  const modes: [string, EvoConfig][] = [['default', small], ['steady', { ...small, ...STEADY_EVO, rescoreTop: 4, rescoreMatches: 3 }]];
  const gens = 4;
  for (const [mode, evo] of modes) {
    const runs: string[][] = [];
    for (let rep = 0; rep < 2; rep++) {
      const t = new Trainer(evo, 5, backend());
      const champs: string[] = [];
      for (let g = 0; g < gens; g++) {
        const out = await t.generation();
        if (mode === 'steady' && g > 0 && !out.rescored) return fail('TRAINER-INERT', `steady did not re-score at generation ${g}`);
        if (mode === 'default' && out.rescored) return fail('TRAINER-INERT', 'the default mode re-scored');
        const bits = (a: Float32Array) => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length)).join(',');
        const c = bits(out.champion);
        if (!t.pop.some((g2) => bits(g2) === c)) return fail('CHAMPION-LOST', `${mode}: generation ${g}'s champion is not in the next population`);
        champs.push(c);
      }
      runs.push(champs);
    }
    if (runs[0].some((c, g) => c !== runs[1][g])) return fail('TRAINER-NONDETERMINISTIC', `${mode}: the same seed gave different champions`);
  }
  return pass(`${gens} generations in each mode, twice: the same champions both times, re-scoring only in steady, every champion carried over`);
}

// ---------------------------------------------------------------------------------------------------
// build: the site builds, and every import in it resolves to a file the build wrote.

function buildGate(opts: { rewrite?: boolean; plant?: Record<string, string> }): Verdict {
  const dir = join(tmpdir(), `ml-airhockey-check-${process.pid}`);
  try {
    const files = build(dir, opts);
    // web/trainer-worker.js is loaded by URL, not imported, so the import check cannot see it: name it here.
    for (const need of ['index.html', 'web/main.js', 'src/sim.js', 'web/trainer-worker.js']) {
      if (!files.includes(need)) return fail('BUILD-INCOMPLETE', `the build wrote no ${need}`);
    }
    return pass(`${files.length} files built; every relative import resolves and none names node: or .ts`);
  } catch (e) {
    const msg = (e as Error).message;
    return fail(msg.split(':')[0], msg);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------

const CHECKS: Check[] = [
  {
    name: 'bounds', gate: () => boundsGate(PHASES), controls: [
      { name: 'no-side-walls', expect: 'OUT-OF-BOUNDS', run: () => boundsGate({ ...PHASES, collideWalls: noSideWalls }) },
      { name: 'square-corners', expect: 'OUT-OF-CORNER', run: () => boundsGate({ ...PHASES, collideWalls: squareCorners }) },
    ],
  },
  { name: 'no-pin', gate: () => noPinGate(DEFAULT_SIM), controls: [{ name: 'phase0-square-table', expect: 'PINNED', run: () => noPinGate(PHASE0_TABLE) }] },
  { name: 'speed-limit', gate: () => speedLimitGate(PHASES), controls: [{ name: 'scale-shared', expect: 'TOO-FAST-MALLET', run: () => speedLimitGate({ ...PHASES, moveMallets: sharedScale }) }] },
  {
    name: 'goals', gate: () => goalsGate(DEFAULT_SIM), controls: [
      { name: 'no-goal-mouth', expect: 'NO-GOAL', run: () => goalsGate({ ...DEFAULT_SIM, goalHalfWidth: 0 }) },
      { name: 'wall-sign-flipped', expect: 'NO-BOUNCE', run: () => goalsGate({ ...DEFAULT_SIM, wallRestitution: -DEFAULT_SIM.wallRestitution }) },
    ],
  },
  {
    name: 'net-ref', gate: () => netRefGate(forward), controls: [
      { name: 'transposed-weights', expect: 'NET-MISMATCH', run: () => netRefGate(transposedForward) },
      { name: 'one-weight-nudged', expect: 'NET-MISMATCH', run: () => netRefGate(nudgedForward) },
    ],
  },
  { name: 'ref-independent', gate: () => independentGate(netRefText), controls: [{ name: 'planted-import', expect: 'REF-IMPORTS', run: () => independentGate(`import { forward } from './net.ts';\n${netRefText}`) }] },
  { name: 'checkpoint', gate: () => checkpointGate((n) => toCheckpoint(n, 0)), controls: [{ name: 'lossy-save', expect: 'ROUNDTRIP-MISMATCH', run: () => checkpointGate(lossySave) }] },
  { name: 'mirror', gate: () => mirrorGate(observe), controls: [{ name: 'vx-not-turned', expect: 'MIRROR-BROKEN', run: () => mirrorGate(badObserve) }] },
  { name: 'yardstick', gate: () => yardstickGate(tally), controls: [{ name: 'seat-forgotten', expect: 'YARDSTICK-BLIND', run: () => yardstickGate(seatBlindTally) }] },
  { name: 'determinism', gate: () => determinismGate(fixedNet), controls: [{ name: 'unseeded-jitter', expect: 'NONDETERMINISTIC', run: () => determinismGate(jitteryNet) }] },
  { name: 'layout', gate: () => layoutGate(weightIndex), controls: [{ name: 'transposed-index', expect: 'LAYOUT-WRONG', run: () => layoutGate(transposedIndex) }] },
  { name: 'explain', gate: () => explainGate(weightIndex), controls: [{ name: 'transposed-index', expect: 'EXPLAIN-WRONG', run: () => explainGate(transposedIndex) }] },
  { name: 'trainer', gate: () => trainerGate(() => inProcess(false)), controls: [{ name: 'unseeded-fitness', expect: 'TRAINER-NONDETERMINISTIC', run: () => trainerGate(() => inProcess(true)) }] },
  { name: 'live-equals-batch', gate: () => liveGate(DEFAULT_SIM), controls: [{ name: 'possession-drift', expect: 'LIVE-DIVERGES', run: () => liveGate({ ...DEFAULT_SIM, possessionSeconds: DEFAULT_SIM.possessionSeconds + 1 }) }] },
  {
    name: 'build', gate: () => buildGate({}), controls: [
      { name: 'no-rewrite', expect: 'BUILD-TS-SPECIFIER', run: () => buildGate({ rewrite: false }) },
      { name: 'node-import', expect: 'BUILD-NODE-IMPORT', run: () => buildGate({ plant: { 'src/planted.js': "import { readFileSync } from 'node:fs';\n" } }) },
    ],
  },
];

async function safely(f: Run): Promise<Verdict> {
  try { return await f(); } catch (e) { return fail('THREW', (e as Error).stack ?? String(e)); }
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    for (const c of CHECKS) console.log(`${c.name}: controls ${c.controls.map((k) => k.name).join(', ')}`);
    return;
  }
  const t0 = performance.now();
  let failures = 0, controls = 0;
  for (const c of CHECKS) {
    const t = performance.now();
    if (c.controls.length === 0) { console.log(`FAIL  ${c.name}: UNCONTROLLED, a gate with no negative control`); failures++; continue; }
    const v = await safely(c.gate);
    const secs = ((performance.now() - t) / 1000).toFixed(1);
    if (v.ok) console.log(`PASS  ${c.name}: ${v.detail} [${secs} s]`);
    else { console.log(`FAIL  ${c.name}: ${v.code} ${v.detail}`); failures++; }
    for (const k of c.controls) {
      controls++;
      const r = await safely(k.run);
      if (r.ok) { console.log(`CONTROL-NOT-DETECTED  ${c.name}/${k.name}: the gate passed with the fault planted: ${r.detail}`); failures++; }
      else if (r.code !== k.expect) { console.log(`CONTROL-WRONG-REASON  ${c.name}/${k.name}: expected ${k.expect}, got ${r.code} ${r.detail}`); failures++; }
      else console.log(`CONTROL-DETECTED  ${c.name}/${k.name}: ${r.code} ${r.detail}`);
    }
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  if (failures === 0) console.log(`VERDICT: PASS (${CHECKS.length} gates, ${controls} controls) in ${secs} s`);
  else console.log(`VERDICT: FAIL (${failures} of ${CHECKS.length} gates and ${controls} controls) in ${secs} s`);
  process.exitCode = failures === 0 ? 0 : 1;
}

void main();
