// Plain-language explanations of the network's parts, for the inspector.
//
// What a part does is measured, not guessed: the page keeps the AI's last few seconds of observations,
// and each explanation replays them through a copy of the network with the part changed and a copy
// without, and reports how far, and which way, the AI's aim moved. Only the meanings of the inputs and
// outputs are written by hand, below, one entry per name in src/obs.ts; the `explain` gate holds that.
//
// No DOM here: the front door holds this module.

import { DEFAULT_SIM } from '../src/config.ts';
import type { SimConfig } from '../src/config.ts';
import { makeNet, forward } from '../src/net.ts';
import type { Net } from '../src/net.ts';
import { INPUT_NAMES, OUTPUT_NAMES } from '../src/obs.ts';
import { weightIndex, biasIndex } from './layout.ts';

// The explained network is the top player's; it sees the table from its own end, turned half round from
// the viewer's, so its right is the left of the screen.
export const INPUT_HELP: Readonly<Record<string, string>> = Object.freeze({
  'puck x': "where the puck is across the table, as the AI sees it: −1 at the AI's far left, +1 at its far right (the left of your screen)",
  'puck y': "how far down the table the puck is, from the AI's end: −1 at the AI's own goal, 0 at the centre line, +1 at the bottom goal",
  'puck vx': "how fast the puck is moving sideways: + is toward the AI's right (the left of your screen)",
  'puck vy': "how fast the puck is moving along the table: + is toward the bottom goal, − toward the AI's own",
  'own x': "where the AI's own mallet is across the table: + is the AI's right",
  'own y': "how far forward the AI's mallet is: about −0.94 back at its goal, about −0.06 at the centre line, which it cannot cross",
  'own vx': "how fast the AI's mallet is moving sideways",
  'own vy': "how fast the AI's mallet is moving along the table: + is forward",
  'opp x': "where the bottom player's mallet is across the table, from the AI's side",
  'opp y': "how far up the table the bottom player's mallet is, from the AI's side: near +1 is back at the bottom goal",
});

export const OUTPUT_HELP: Readonly<Record<string, string>> = Object.freeze({
  'target x': "where across the table the AI wants its mallet: −1 at its far left, +1 at its far right (the left of your screen). The mallet heads there at its top speed",
  'target y': "how far forward the AI wants its mallet: −1 back at its goal, +1 up at the centre line",
});

// ---- the observation buffer ---------------------------------------------------------------------------

export class ObsBuffer {
  readonly size: number;
  readonly width: number;
  readonly data: Float32Array;
  count = 0;
  private next = 0;

  constructor(size: number, width: number) {
    this.size = size;
    this.width = width;
    this.data = new Float32Array(size * width);
  }

  push(obs: Float32Array): void {
    this.data.set(obs.subarray(0, this.width), this.next * this.width);
    this.next = (this.next + 1) % this.size;
    if (this.count < this.size) this.count++;
  }

  clear(): void { this.count = 0; this.next = 0; }

  row(k: number, out: Float32Array): Float32Array {
    out.set(this.data.subarray(k * this.width, (k + 1) * this.width));
    return out;
  }
}

// ---- measuring --------------------------------------------------------------------------------------

// The mean change in the two outputs (own frame, output units), and the mean size of the change.
export interface Shift { dx: number; dy: number; size: number; n: number }

export interface Measured { all: Shift; pos: Shift; neg: Shift }

type Source = (row: Float32Array, base: Net) => number;

// Replays the buffer through the network as it is and through a copy changed by `mutate`. When `source`
// is given, the samples are also split by its sign (above +0.05, below -0.05) in the unchanged network.
export function measure(net: Net, buf: ObsBuffer, mutate: (g: Float32Array) => void, source?: Source): Measured {
  const A = makeNet(net.sizes, new Float32Array(net.genome));
  const g = new Float32Array(net.genome);
  mutate(g);
  const B = makeNet(net.sizes, g);
  const acc = { all: [0, 0, 0, 0], pos: [0, 0, 0, 0], neg: [0, 0, 0, 0] };
  const row = new Float32Array(buf.width);
  for (let k = 0; k < buf.count; k++) {
    buf.row(k, row);
    const ya = forward(A, row);
    const a0 = ya[0], a1 = ya[1];
    const s = source ? source(row, A) : 0;
    const yb = forward(B, row);
    const d0 = yb[0] - a0, d1 = yb[1] - a1, size = Math.hypot(d0, d1);
    const add = (t: number[]) => { t[0] += d0; t[1] += d1; t[2] += size; t[3]++; };
    add(acc.all);
    if (source && s > 0.05) add(acc.pos);
    else if (source && s < -0.05) add(acc.neg);
  }
  const mean = (t: number[]): Shift => (t[3] === 0 ? { dx: 0, dy: 0, size: 0, n: 0 } : { dx: t[0] / t[3], dy: t[1] / t[3], size: t[2] / t[3], n: t[3] });
  return { all: mean(acc.all), pos: mean(acc.pos), neg: mean(acc.neg) };
}

// The effect of raising one weight by delta, split by the sign of what that weight carries.
export function weightRaise(net: Net, buf: ObsBuffer, l: number, j: number, i: number, delta: number, idx = weightIndex): Measured {
  const k = idx(net.sizes, l, j, i);
  const source: Source = l === 0 ? (row) => row[i] : (_row, A) => A.acts[l - 1][i];
  return measure(net, buf, (g) => { g[k] += delta; }, source);
}

export interface NeuronStats { mean: number; std: number; pinned: number; corr: number[] }

// How a neuron (n = 0 for the inputs) behaved over the buffer: its mean, its spread, the share of
// samples it spent pinned near ±1, and its correlation with each input.
export function neuronStats(net: Net, buf: ObsBuffer, n: number, j: number): NeuronStats {
  const A = makeNet(net.sizes, new Float32Array(net.genome));
  const w = buf.width;
  let sa = 0, saa = 0, pinned = 0;
  const sx = new Float64Array(w), sxx = new Float64Array(w), sxa = new Float64Array(w);
  const row = new Float32Array(w);
  for (let k = 0; k < buf.count; k++) {
    buf.row(k, row);
    forward(A, row);
    const a = n === 0 ? row[j] : A.acts[n - 1][j];
    sa += a; saa += a * a;
    if (Math.abs(a) > 0.95) pinned++;
    for (let i = 0; i < w; i++) { sx[i] += row[i]; sxx[i] += row[i] * row[i]; sxa[i] += row[i] * a; }
  }
  const N = Math.max(1, buf.count);
  const mean = sa / N;
  const va = Math.max(0, saa / N - mean * mean);
  const corr: number[] = [];
  for (let i = 0; i < w; i++) {
    const mx = sx[i] / N, vx = Math.max(0, sxx[i] / N - mx * mx);
    const cov = sxa[i] / N - mx * mean;
    corr.push(vx > 1e-12 && va > 1e-12 ? cov / Math.sqrt(vx * va) : 0);
  }
  return { mean, std: Math.sqrt(va), pinned: pinned / N, corr };
}

// ---- words ---------------------------------------------------------------------------------------------

// An output change as a share of the table's width, from the table's own sizes.
function pctX(d: number, cfg: SimConfig): number { return (100 * d * (cfg.halfWidth - cfg.malletRadius)) / (2 * cfg.halfWidth); }
function pctY(d: number, cfg: SimConfig): number { return (100 * d * 0.5 * (cfg.halfLength - 2 * cfg.malletRadius)) / (2 * cfg.halfWidth); }

function howMuch(p: number): string {
  const a = Math.abs(p);
  return a < 0.5 ? 'barely' : a < 3 ? 'a little' : a < 10 ? 'noticeably' : 'a lot';
}

const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;

// "moves its aim a little to its right (about 2% of the table's width) and slightly forward"
export function describeShift(s: Shift, cfg: SimConfig = DEFAULT_SIM): string {
  const px = pctX(s.dx, cfg), py = pctY(s.dy, cfg);
  const xs = px > 0 ? 'to its right, the left of your screen,' : 'to its left, the right of your screen,';
  const ys = py > 0 ? 'forward, toward the centre line,' : 'back, toward its own goal,';
  const big = Math.abs(px) >= Math.abs(py) ? { p: px, w: xs } : { p: py, w: ys };
  const small = Math.abs(px) >= Math.abs(py) ? { p: py, w: ys } : { p: px, w: xs };
  if (Math.abs(big.p) < 0.5) return 'barely moves its aim';
  let text = `moves its aim ${howMuch(big.p)} ${big.w} about ${Math.abs(big.p).toFixed(1)}% of the table's width`;
  if (Math.abs(small.p) >= 0.5 && Math.abs(small.p) >= Math.abs(big.p) / 3) text += `, and ${howMuch(small.p)} ${small.w.replace(/,$/, '')}`;
  return text.replace(/,,/g, ',');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function sizeOf(s: Shift, cfg: SimConfig): number {
  return (100 * s.size * (cfg.halfWidth - cfg.malletRadius)) / (2 * cfg.halfWidth);
}

export interface Names { node: (n: number, j: number) => string }

function seconds(buf: ObsBuffer, cfg: SimConfig): string {
  return (buf.count / cfg.controlHz).toFixed(0);
}

const NEED = 60; // a second of play at the training rate

function tooLittle(buf: ObsBuffer): string[] {
  return buf.count < NEED ? ['Let it play for a few seconds, unpaused, so there is something to measure this on.'] : [];
}

// How the neuron j of node layer n reaches the outputs, read off its weights when the next layer is the
// output layer.
function outgoing(net: Net, n: number, j: number, names: Names): string {
  const last = net.sizes.length - 1;
  if (n + 1 !== last) return `feeds the ${net.sizes[n + 1]} neurons of the next layer`;
  const parts: string[] = [];
  for (let k = 0; k < net.sizes[last]; k++) {
    const w = net.genome[weightIndex(net.sizes, n, k, j)];
    const target = names.node(last, k);
    const dir = target === 'target x' ? (w >= 0 ? "toward the AI's right" : "toward the AI's left") : (w >= 0 ? 'forward' : 'back');
    parts.push(`${target} ${dir} (weight ${fmt(w)})`);
  }
  return `pushes ${parts.join(' and ')} when it is positive, and the other way when it is negative`;
}

export function explainWeight(net: Net, buf: ObsBuffer, l: number, j: number, i: number, names: Names, cfg: SimConfig = DEFAULT_SIM): string[] {
  const src = names.node(l, i), dst = names.node(l + 1, j);
  const w = net.genome[weightIndex(net.sizes, l, j, i)];
  const out: string[] = [];
  out.push(`This weight carries ${src} into ${dst}. It is ${w >= 0 ? 'positive' : 'negative'} (${fmt(w)}), so when ${src} goes up, ${dst} goes ${w >= 0 ? 'up' : 'down'}; the bigger the weight, the harder the push.`);
  if (l + 1 === net.sizes.length - 1) out.push(`${cap(dst)} is an output: ${OUTPUT_HELP[dst] ?? ''}.`);
  else out.push(`${cap(dst)}, in turn, ${outgoing(net, l + 1, j, names)}.`);
  if (buf.count < NEED) return [...out, ...tooLittle(buf)];

  const r = weightRaise(net, buf, l, j, i, 0.5);
  const secs = seconds(buf, cfg);
  const share = (s: Shift) => Math.round((100 * s.n) / buf.count);
  const lines: string[] = [];
  if (share(r.pos) >= 10) lines.push(`when ${src} was positive (${share(r.pos)}% of the time), raising this weight by 0.5 ${describeShift(r.pos, cfg)}`);
  if (share(r.neg) >= 10) lines.push(`when ${src} was negative (${share(r.neg)}% of the time), it ${describeShift(r.neg, cfg)}`);
  if (lines.length) out.push(`Measured on the last ${secs} s of play: ${lines.join('; ')}. Lowering the weight does roughly the opposite.`);
  else out.push(`Measured on the last ${secs} s of play: ${src} was near zero almost all the time, so this weight had little to carry.`);
  // The sentences above start with the source's name, which may be lower case.
  out[0] = cap(out[0]);

  const k = weightIndex(net.sizes, l, j, i);
  const zero = measure(net, buf, (g) => { g[k] = 0; });
  out.push(`Setting it to zero would move the AI's aim by about ${sizeOf(zero.all, cfg).toFixed(1)}% of the table's width on average: ${zeroVerdict(sizeOf(zero.all, cfg))}.`);

  const reasons: string[] = [];
  const srcStats = neuronStats(net, buf, l, i);
  if (Math.abs(srcStats.mean) < 0.05 && srcStats.std < 0.05) reasons.push(`${src} hardly moved from zero`);
  if (l + 1 < net.sizes.length - 1) {
    const dstStats = neuronStats(net, buf, l + 1, j);
    if (dstStats.pinned > 0.8) reasons.push(`${dst} sat pinned near ±1 for ${Math.round(100 * dstStats.pinned)}% of the time, so small changes to what feeds it do not get through (a big change can)`);
  }
  if (reasons.length) out.push(`Why it matters little right now: ${reasons.join('; ')}.`);
  return out;
}

function zeroVerdict(p: number): string {
  return p < 0.5 ? 'it hardly matters to how the AI plays right now' : p < 3 ? 'it plays a small part' : p < 10 ? 'it plays a real part' : 'it is one of the weights the AI leans on';
}

export function explainBias(net: Net, buf: ObsBuffer, n: number, j: number, names: Names, cfg: SimConfig = DEFAULT_SIM): string {
  const name = names.node(n, j);
  const k = biasIndex(net.sizes, n - 1, j);
  if (buf.count < NEED) return `The bias is a constant push on ${name}, the same in every situation: raising it moves ${name} up whatever the AI sees.`;
  const r = measure(net, buf, (g) => { g[k] += 0.5; });
  return `The bias is a constant push on ${name}, the same in every situation. Measured on the last ${seconds(buf, cfg)} s of play, raising it by 0.5 on average ${describeShift(r.all, cfg)}.`;
}

// For the inputs (n = 0), the hidden neurons, and the outputs.
export function explainNeuron(net: Net, buf: ObsBuffer, n: number, j: number, names: Names, knockedOff: boolean, cfg: SimConfig = DEFAULT_SIM): string[] {
  const name = names.node(n, j);
  const last = net.sizes.length - 1;
  const out: string[] = [];
  if (n === 0) {
    out.push(`An input: ${INPUT_HELP[name] ?? name}.`);
    if (buf.count < NEED) return [...out, ...tooLittle(buf)];
    // How much the AI leans on each input: blind it, and see how far the aim moves.
    const reliance = INPUT_NAMES.map((_, i) => sizeOf(measure(net, buf, (g) => {
      for (let jj = 0; jj < net.sizes[1]; jj++) g[weightIndex(net.sizes, 0, jj, i)] = 0;
    }).all, cfg));
    const rank = 1 + reliance.filter((v) => v > reliance[j]).length;
    out.push(knockedOff
      ? 'The AI is blind to it now: its weights out are set to zero.'
      : `Blinding the AI to it would move its aim by about ${reliance[j].toFixed(1)}% of the table's width on average, measured on the last ${seconds(buf, cfg)} s of play: ${rank === 1 ? 'it is the input the AI leans on most' : `it ranks ${ordinal(rank)} of the ${reliance.length} inputs by how much the AI leans on it`}.`);
    return out;
  }
  if (n === last) {
    out.push(`An output: ${OUTPUT_HELP[name] ?? name}.`);
    out.push('Like every neuron it adds up its weighted inputs and its bias, then squashes the sum into the range −1 to +1, which is why it can never ask for a spot off the table.');
    return out;
  }
  out.push('A hidden neuron: it adds up the inputs, each times its weight, adds its bias, and squashes the total into the range −1 to +1. Different hidden neurons end up picking out different situations.');
  out.push(`It ${outgoing(net, n, j, names)}.`); // "It pushes ... when it is positive", or "It feeds ..."
  if (buf.count < NEED) return [...out, ...tooLittle(buf)];
  const st = neuronStats(net, buf, n, j);
  const secs = seconds(buf, cfg);
  if (st.std < 0.05) {
    out.push(`Over the last ${secs} s it hardly changed: it sat at about ${fmt(st.mean)} the whole time${st.pinned > 0.8 ? ', pinned at its limit' : ''}, so it acts like a fixed push rather than a reaction to the game.`);
  } else {
    const top = st.corr.map((c, i) => ({ c, i })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).filter((t) => Math.abs(t.c) >= 0.3).slice(0, 2);
    const follows = top.map((t) => `${names.node(0, t.i)} is ${t.c > 0 ? 'high' : 'low'} (correlation ${fmt(t.c)})`);
    out.push(`Over the last ${secs} s it ranged around ${fmt(st.mean)} (spread ${st.std.toFixed(2)})${st.pinned > 0.2 ? `, pinned near ±1 ${Math.round(100 * st.pinned)}% of the time` : ''}. ${follows.length ? `It ran highest when ${follows.join(' and when ')}. That is what went together in recent play, not a rule it follows.` : 'No single input tracks it closely: it mixes several.'}`);
  }
  if (!knockedOff) {
    const off = measure(net, buf, (g) => { for (let k = 0; k < net.sizes[n + 1]; k++) g[weightIndex(net.sizes, n, k, j)] = 0; });
    out.push(`Switching it off would move the AI's aim by about ${sizeOf(off.all, cfg).toFixed(1)}% of the table's width on average; on balance, switching it off ${describeShift(off.all, cfg)}.`);
  } else {
    out.push('It is switched off now: its weights out are set to zero, so nothing it does reaches the outputs.');
  }
  return out;
}

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
function ordinal(k: number): string {
  if (k < ORDINALS.length) return ORDINALS[k];
  const s = k % 10 === 1 && k % 100 !== 11 ? 'st' : k % 10 === 2 && k % 100 !== 12 ? 'nd' : k % 10 === 3 && k % 100 !== 13 ? 'rd' : 'th';
  return `${k}${s}`;
}
