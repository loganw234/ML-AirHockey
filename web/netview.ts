// Draws the network as an SVG beside the table, live. A line is a weight: its colour is the weight's sign,
// its thickness the weight's size, and its brightness how much it is carrying right now (weight times the
// activation feeding it). A circle is a neuron, coloured by its activation. Click a line to pick a weight,
// a circle to pick a neuron.

import type { Net } from '../src/net.ts';
import { weightIndex } from './layout.ts';

export type Selection =
  | { kind: 'weight'; l: number; j: number; i: number } // connection layer l, from neuron i of layer l to neuron j of layer l + 1
  | { kind: 'neuron'; n: number; j: number }; // neuron j of node layer n (0 is the inputs)

const SVGNS = 'http://www.w3.org/2000/svg';
const W = 640;

interface Colors { pos: [number, number, number]; neg: [number, number, number]; node: [number, number, number] }

function hexToRgb(s: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const u = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

export class NetView {
  readonly svg: SVGSVGElement;
  onSelect: (sel: Selection | null) => void = () => {};
  private net: Net | null = null;
  private inputNames: readonly string[] = [];
  private outputNames: readonly string[] = [];
  private edges: SVGLineElement[][][] = []; // [l][j][i]
  private hits: SVGLineElement[][][] = [];
  private nodes: SVGCircleElement[][] = []; // [n][j]
  private values: SVGTextElement[] = []; // the inputs' current values
  private outValues: SVGTextElement[] = [];
  private colors: Colors = { pos: [0, 0, 0], neg: [0, 0, 0], node: [0, 0, 0] };
  selection: Selection | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.addEventListener('click', (e) => { if (e.target === svg) this.select(null); });
    this.readColors();
  }

  readColors(): void {
    const cs = getComputedStyle(document.documentElement);
    this.colors = {
      pos: hexToRgb(cs.getPropertyValue('--pos')), neg: hexToRgb(cs.getPropertyValue('--neg')), node: hexToRgb(cs.getPropertyValue('--node')),
    };
  }

  nodeName(n: number, j: number): string {
    const L = this.net ? this.net.sizes.length - 1 : 0;
    if (n === 0) return this.inputNames[j] ?? `input ${j}`;
    if (n === L) return this.outputNames[j] ?? `output ${j}`;
    return L === 2 ? `hidden ${j + 1}` : `hidden ${n}.${j + 1}`;
  }

  setNet(net: Net, inputNames: readonly string[], outputNames: readonly string[]): void {
    this.net = net;
    this.inputNames = inputNames;
    this.outputNames = outputNames;
    this.selection = null;
    const sizes = net.sizes;
    const maxN = Math.max(...sizes);
    const gap = 24;
    const H = Math.max(200, (maxN - 1) * gap + 40);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.svg.replaceChildren();
    const left = 150, right = W - 130;
    const colX = (n: number) => left + (n * (right - left)) / (sizes.length - 1);
    const rowY = (n: number, j: number) => H / 2 + (j - (sizes[n] - 1) / 2) * gap;
    const gEdges = this.el('g'), gHits = this.el('g'), gNodes = this.el('g'), gText = this.el('g');
    this.svg.append(gEdges, gHits, gNodes, gText);
    this.edges = []; this.hits = []; this.nodes = []; this.values = []; this.outValues = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      const E: SVGLineElement[][] = [], Hh: SVGLineElement[][] = [];
      for (let j = 0; j < sizes[l + 1]; j++) {
        const er: SVGLineElement[] = [], hr: SVGLineElement[] = [];
        for (let i = 0; i < sizes[l]; i++) {
          const attrs = { x1: colX(l), y1: rowY(l, i), x2: colX(l + 1), y2: rowY(l + 1, j) };
          const e = this.el('line', attrs) as SVGLineElement;
          e.setAttribute('stroke-linecap', 'round');
          const h = this.el('line', { ...attrs, class: 'hit' }) as SVGLineElement;
          const t = this.el('title');
          t.textContent = `${this.nodeName(l, i)} → ${this.nodeName(l + 1, j)}`;
          h.append(t);
          h.addEventListener('click', (ev) => { ev.stopPropagation(); this.select({ kind: 'weight', l, j, i }); });
          gEdges.append(e); gHits.append(h);
          er.push(e); hr.push(h);
        }
        E.push(er); Hh.push(hr);
      }
      this.edges.push(E); this.hits.push(Hh);
    }
    for (let n = 0; n < sizes.length; n++) {
      const row: SVGCircleElement[] = [];
      for (let j = 0; j < sizes[n]; j++) {
        const c = this.el('circle', { cx: colX(n), cy: rowY(n, j), r: 7, class: 'node' }) as SVGCircleElement;
        const t = this.el('title');
        t.textContent = this.nodeName(n, j);
        c.append(t);
        c.addEventListener('click', (ev) => { ev.stopPropagation(); this.select({ kind: 'neuron', n, j }); });
        gNodes.append(c);
        row.push(c);
        if (n === 0) {
          const name = this.el('text', { x: colX(0) - 14, y: rowY(0, j), class: 'label', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
          name.textContent = this.nodeName(0, j);
          const val = this.el('text', { x: 8, y: rowY(0, j), class: 'value', 'dominant-baseline': 'middle' }) as SVGTextElement;
          gText.append(name, val);
          this.values.push(val);
        } else if (n === sizes.length - 1) {
          const name = this.el('text', { x: colX(n) + 14, y: rowY(n, j), class: 'label', 'dominant-baseline': 'middle' });
          name.textContent = this.nodeName(n, j);
          const val = this.el('text', { x: colX(n) + 72, y: rowY(n, j), class: 'value', 'dominant-baseline': 'middle' }) as SVGTextElement;
          gText.append(name, val);
          this.outValues.push(val);
        }
      }
      this.nodes.push(row);
    }
  }

  select(sel: Selection | null): void {
    this.selection = sel;
    this.onSelect(sel);
  }

  // Redraw the live state. `input` is the observation the net last saw; `knocked` holds "n:j" keys of
  // switched-off neurons; `edited` holds genome indices that differ from the loaded genome.
  update(input: Float32Array, knocked: ReadonlySet<string>, edited: ReadonlySet<number>): void {
    const net = this.net;
    if (!net) return;
    const { pos, neg, node } = this.colors;
    const sizes = net.sizes, g = net.genome;
    const sel = this.selection;
    for (let l = 0; l + 1 < sizes.length; l++) {
      const src = l === 0 ? input : net.acts[l - 1];
      for (let j = 0; j < sizes[l + 1]; j++) {
        for (let i = 0; i < sizes[l]; i++) {
          const k = weightIndex(sizes, l, j, i);
          const w = g[k];
          const e = this.edges[l][j][i];
          const carried = Math.min(1, Math.abs(w * src[i]));
          e.setAttribute('stroke', w >= 0 ? `rgb(${pos})` : `rgb(${neg})`);
          e.setAttribute('stroke-width', (0.5 + 2.5 * Math.min(1, Math.abs(w) / 2)).toFixed(2));
          e.setAttribute('stroke-opacity', (0.07 + 0.93 * carried).toFixed(3));
          e.setAttribute('stroke-dasharray', edited.has(k) ? '5 3' : '');
          const isSel = sel !== null && sel.kind === 'weight' && sel.l === l && sel.j === j && sel.i === i;
          this.hits[l][j][i].classList.toggle('selected', isSel);
        }
      }
    }
    for (let n = 0; n < sizes.length; n++) {
      const acts = n === 0 ? input : net.acts[n - 1];
      for (let j = 0; j < sizes[n]; j++) {
        const a = acts[j];
        const c = this.nodes[n][j];
        const off = knocked.has(`${n}:${j}`);
        c.setAttribute('fill', off ? 'none' : mix(node, a >= 0 ? pos : neg, Math.min(1, Math.abs(a))));
        c.classList.toggle('knocked', off);
        c.classList.toggle('selected', sel !== null && sel.kind === 'neuron' && sel.n === n && sel.j === j);
      }
    }
    for (let j = 0; j < this.values.length; j++) this.values[j].textContent = fmt(input[j]);
    const out = net.acts[net.acts.length - 1];
    for (let j = 0; j < this.outValues.length; j++) this.outValues[j].textContent = fmt(out[j]);
  }

  private el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  }
}

function fmt(v: number): string {
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);
}
