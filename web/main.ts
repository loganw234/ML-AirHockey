// The page: you play the bottom end with your pointer, the opponent plays the top, and if the opponent is a
// network its weights are drawn beside the table, live, and can be changed while it plays.

import { DEFAULT_SIM } from '../src/config.ts';
import { makeRng } from '../src/rng.ts';
import { observe, decodeTarget, INPUT_NAMES, OUTPUT_NAMES, NUM_INPUTS, NUM_OUTPUTS } from '../src/obs.ts';
import { makeNet, randomGenome, forward } from '../src/net.ts';
import type { Net } from '../src/net.ts';
import { fromCheckpoint } from '../src/checkpoint.ts';
import { referenceBot, statueBot, REFERENCE_BOT_VERSION } from '../src/bots.ts';
import type { Policy } from '../src/policy.ts';
import { createLiveMatch } from './live.ts';
import type { LiveMatch, LiveEvent } from './live.ts';
import { TableView, readTheme } from './table.ts';
import { NetView } from './netview.ts';
import type { Selection } from './netview.ts';
import { weightIndex, biasIndex } from './layout.ts';

const cfg = DEFAULT_SIM;
const SIZES = [NUM_INPUTS, 16, NUM_OUTPUTS];
const STEP = 1 / cfg.controlHz;

function byId<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`PAGE-MISSING: no element #${id}`);
  return e as T;
}

const canvas = byId<HTMLCanvasElement>('table');
const svg = document.getElementById('net') as unknown as SVGSVGElement;
const opponentSel = byId<HTMLSelectElement>('opponent');
const rerollBtn = byId<HTMLButtonElement>('reroll');
const fileInput = byId<HTMLInputElement>('file');
const pauseBtn = byId<HTMLButtonElement>('pause');
const newBtn = byId<HTMLButtonElement>('new');
const showTarget = byId<HTMLInputElement>('show-target');
const scoreYou = byId('score-you'), scoreAi = byId('score-ai'), statusEl = byId('status');
const netWrap = byId('net-wrap'), noNet = byId('no-net'), inspector = byId('inspector'), editsEl = byId('edits');
const playSection = byId('play');

const table = new TableView(canvas, cfg);
const view = new NetView(svg);

// ---- the opponent -------------------------------------------------------------------------------------

type Opponent =
  | { kind: 'net'; net: Net; base: Float32Array; label: string }
  | { kind: 'script'; policy: Policy; label: string };

let opponent: Opponent;
let rerolls = 0;
const knocked = new Set<string>(); // "n:j"
const saved = new Map<number, number>(); // genome index -> its value before a knock-out zeroed it
let edited = new Set<number>();

function useNet(net: Net, label: string): void {
  opponent = { kind: 'net', net, base: new Float32Array(net.genome), label };
  knocked.clear(); saved.clear(); edited = new Set();
  view.setNet(net, INPUT_NAMES, OUTPUT_NAMES);
  netWrap.hidden = false; noNet.hidden = true; rerollBtn.hidden = !label.startsWith('Random');
  showInspector(null);
  newMatch();
}

function useScript(policy: Policy, label: string): void {
  opponent = { kind: 'script', policy, label };
  netWrap.hidden = true; noNet.hidden = false; rerollBtn.hidden = true;
  inspector.replaceChildren(); editsEl.replaceChildren();
  newMatch();
}

function randomNet(): void {
  rerolls++;
  const seed = (Date.now() ^ (rerolls * 0x9e3779b9)) >>> 0;
  useNet(makeNet(SIZES, randomGenome(SIZES, makeRng(seed))), 'Random network (generation 0)');
}

interface Listed { file: string; label: string }
let listed: Listed[] = [];

function fillOpponents(): void {
  const opts: [string, string][] = [
    ['random', 'Random network (generation 0)'],
    ...listed.map((c, k): [string, string] => [`ckpt:${k}`, c.label]),
    ['file', 'Load a checkpoint file…'],
    ['ref', `Reference bot (${REFERENCE_BOT_VERSION}, a script)`],
    ['statue', 'Statue (never moves)'],
  ];
  opponentSel.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; }));
}

async function chooseOpponent(v: string): Promise<void> {
  if (v === 'random') randomNet();
  else if (v === 'ref') useScript(referenceBot(cfg), 'Reference bot');
  else if (v === 'statue') useScript(statueBot(cfg), 'Statue');
  else if (v === 'file') fileInput.click();
  else if (v.startsWith('ckpt:')) {
    const c = listed[Number(v.slice(5))];
    try {
      const res = await fetch(`web/checkpoints/${c.file}`);
      const { net } = fromCheckpoint(await res.text());
      useNet(net, c.label);
    } catch (e) { flash(`Could not load it: ${(e as Error).message}`); }
  }
}

opponentSel.addEventListener('change', () => { void chooseOpponent(opponentSel.value); });
rerollBtn.addEventListener('click', randomNet);
fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  try {
    const { net, generation } = fromCheckpoint(await f.text());
    useNet(net, `${f.name} (generation ${generation})`);
  } catch (e) { flash(`Refused: ${(e as Error).message}`); }
  fileInput.value = '';
});

// ---- editing the weights --------------------------------------------------------------------------------

function recountEdits(): void {
  if (opponent.kind !== 'net') return;
  const { net, base } = opponent;
  edited = new Set();
  for (let k = 0; k < base.length; k++) if (net.genome[k] !== base[k] && !saved.has(k)) edited.add(k);
  const parts: string[] = [];
  if (edited.size) parts.push(`${edited.size} weight${edited.size === 1 ? '' : 's'} changed`);
  if (knocked.size) parts.push(`${knocked.size} neuron${knocked.size === 1 ? '' : 's'} switched off`);
  editsEl.replaceChildren();
  if (parts.length) {
    const p = document.createElement('p');
    p.textContent = `${parts.join(', ')}. `;
    const b = document.createElement('button');
    b.textContent = 'Undo all';
    b.addEventListener('click', () => {
      if (opponent.kind !== 'net') return;
      opponent.net.genome.set(opponent.base); knocked.clear(); saved.clear();
      recountEdits(); showInspector(view.selection);
    });
    p.append(b);
    editsEl.append(p);
  }
}

function toggleKnock(n: number, j: number): void {
  if (opponent.kind !== 'net') return;
  const { net } = opponent;
  const key = `${n}:${j}`;
  for (let jj = 0; jj < net.sizes[n + 1]; jj++) {
    const k = weightIndex(net.sizes, n, jj, j);
    if (knocked.has(key)) { net.genome[k] = saved.get(k) ?? net.genome[k]; saved.delete(k); }
    else { saved.set(k, net.genome[k]); net.genome[k] = 0; }
  }
  if (knocked.has(key)) knocked.delete(key); else knocked.add(key);
  recountEdits();
  showInspector(view.selection);
}

let liveValue: HTMLElement | null = null; // the inspector's live activation, updated each frame
let liveNeuron: { n: number; j: number } | null = null;

function slider(label: string, value: number, base: number, onInput: (v: number) => void, disabled = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const range = document.createElement('input');
  range.type = 'range'; range.min = '-4'; range.max = '4'; range.step = '0.01'; range.value = String(value); range.disabled = disabled;
  const num = document.createElement('input');
  num.type = 'number'; num.step = '0.01'; num.value = value.toFixed(3); num.disabled = disabled;
  const set = (v: number) => { if (!Number.isFinite(v)) return; range.value = String(v); num.value = v.toFixed(3); onInput(v); };
  range.addEventListener('input', () => set(Number(range.value)));
  num.addEventListener('change', () => set(Number(num.value)));
  const zero = document.createElement('button'); zero.textContent = 'Zero'; zero.disabled = disabled; zero.addEventListener('click', () => set(0));
  const restore = document.createElement('button'); restore.textContent = 'Restore'; restore.disabled = disabled; restore.addEventListener('click', () => set(base));
  const lab = document.createElement('label'); lab.textContent = label;
  const row = document.createElement('div'); row.className = 'row'; row.append(range, num);
  const btns = document.createElement('div'); btns.className = 'row'; btns.append(zero, restore);
  const note = document.createElement('p'); note.className = 'muted'; note.textContent = `loaded value ${base.toFixed(3)}`;
  wrap.append(lab, row, btns, note);
  return wrap;
}

function showInspector(sel: Selection | null): void {
  liveValue = null; liveNeuron = null;
  inspector.replaceChildren();
  if (opponent.kind !== 'net') return;
  const { net, base } = opponent;
  if (!sel) {
    const p = document.createElement('p'); p.className = 'hint';
    p.textContent = 'Click a line to pick a weight, or a circle to pick a neuron. Changes take effect at once, while it plays.';
    inspector.append(p);
    return;
  }
  const h = document.createElement('h3');
  if (sel.kind === 'weight') {
    const k = weightIndex(net.sizes, sel.l, sel.j, sel.i);
    h.textContent = `Weight: ${view.nodeName(sel.l, sel.i)} → ${view.nodeName(sel.l + 1, sel.j)}`;
    inspector.append(h);
    const off = saved.has(k);
    inspector.append(slider('value', net.genome[k], base[k], (v) => { net.genome[k] = v; recountEdits(); }, off));
    if (off) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Its source neuron is switched off; switch it back on to change this weight.'; inspector.append(p); }
  } else {
    const last = net.sizes.length - 1;
    h.textContent = `Neuron: ${view.nodeName(sel.n, sel.j)}`;
    inspector.append(h);
    const act = document.createElement('p'); act.className = 'live';
    inspector.append(act);
    liveValue = act; liveNeuron = { n: sel.n, j: sel.j };
    if (sel.n > 0) {
      const k = biasIndex(net.sizes, sel.n - 1, sel.j);
      inspector.append(slider('bias', net.genome[k], base[k], (v) => { net.genome[k] = v; recountEdits(); }));
    }
    if (sel.n < last) {
      const on = !knocked.has(`${sel.n}:${sel.j}`);
      const b = document.createElement('button');
      b.textContent = on ? (sel.n === 0 ? 'Blind it to this input' : 'Switch this neuron off') : 'Switch it back on';
      b.addEventListener('click', () => toggleKnock(sel.n, sel.j));
      inspector.append(b);
    }
  }
}

view.onSelect = showInspector;

// ---- the match ---------------------------------------------------------------------------------------

let match: LiveMatch;
let paused = false;
let hold = 0; // seconds left of the pause after a goal or a foul
let banner = '';
let human: [number, number] = [0, -cfg.homeOffset * cfg.halfLength];
const obs = new Float32Array(NUM_INPUTS), act = new Float32Array(NUM_OUTPUTS), tgt = new Float64Array(4);

function newMatch(): void {
  match = createLiveMatch((Math.random() * 2 ** 31) >>> 0, cfg);
  hold = 0; banner = '';
  updateScore();
}

function updateScore(): void {
  scoreYou.textContent = String(match.goals0);
  scoreAi.textContent = String(match.goals1);
}

let flashTimer = 0;
function flash(text: string): void {
  statusEl.textContent = text;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => { statusEl.textContent = ''; }, 2500);
}

const BANNERS: Record<LiveEvent, string> = { none: '', goal0: 'Your goal', goal1: 'AI goal', foul0: 'Held too long', foul1: 'AI held too long' };

function aiAnswer(): void {
  observe(match.s, 1, cfg, obs);
  if (opponent.kind === 'net') { const y = forward(opponent.net, obs); act[0] = y[0]; act[1] = y[1]; }
  else opponent.policy(obs, act);
  decodeTarget(cfg, 1, act[0], act[1], tgt, 2);
}

function tick(): void {
  if (hold > 0) { hold -= STEP; if (hold <= 0) banner = ''; return; }
  match.servePending();
  aiAnswer();
  const ev = match.step(human[0], human[1], tgt[2], tgt[3]);
  if (ev !== 'none') {
    banner = BANNERS[ev];
    hold = ev.startsWith('goal') ? 1.0 : 0.5;
    updateScore();
  }
}

canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); human = table.toTable(e.clientX, e.clientY); });
canvas.addEventListener('pointermove', (e) => { human = table.toTable(e.clientX, e.clientY); });
pauseBtn.addEventListener('click', () => { paused = !paused; pauseBtn.textContent = paused ? 'Resume' : 'Pause'; });
newBtn.addEventListener('click', newMatch);

let last = performance.now(), acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) { acc += dt; while (acc >= STEP) { acc -= STEP; tick(); } }
  else aiAnswer(); // keep the drawing live while paused, so an edit shows at once
  table.draw(match.s, {
    aiTarget: showTarget.checked ? [tgt[2], tgt[3]] : null,
    humanTarget: human,
    banner: paused ? 'Paused' : banner,
  });
  if (opponent.kind === 'net') {
    view.update(obs, knocked, edited);
    if (liveValue && liveNeuron) {
      const a = liveNeuron.n === 0 ? obs[liveNeuron.j] : opponent.net.acts[liveNeuron.n - 1][liveNeuron.j];
      liveValue.textContent = `activation now ${a >= 0 ? '+' : '−'}${Math.abs(a).toFixed(3)}`;
    }
  }
  requestAnimationFrame(frame);
}

// ---- layout and start --------------------------------------------------------------------------------

function fit(): void {
  const narrow = window.innerWidth < 820;
  const avail = narrow ? playSection.clientWidth : 460;
  const byHeight = (window.innerHeight - 215) * table.aspect(); // header, score bar and controls
  table.resize(Math.max(220, Math.min(avail, byHeight)));
}
window.addEventListener('resize', fit);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { table.theme = readTheme(); view.readColors(); });

async function start(): Promise<void> {
  try {
    const res = await fetch('web/checkpoints/index.json');
    if (res.ok) listed = await res.json();
  } catch { listed = []; }
  fillOpponents();
  if (listed.length) { opponentSel.value = `ckpt:${listed.length - 1}`; await chooseOpponent(opponentSel.value); }
  else { opponentSel.value = 'random'; randomNet(); }
  fit();
  requestAnimationFrame(frame);
}

void start();
