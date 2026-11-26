// The training chart: win rate against the reference bot over seconds of training. Dots are each
// evaluation of the generation's champion; the line is the best so far; the dashed line is the bar.

import type { TrainPoint, Reached } from './training.ts';

const NS = 'http://www.w3.org/2000/svg';
const W = 600, H = 180, L = 40, R = 12, T = 10, B = 28;

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function clock(s: number): string {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function drawChart(svg: SVGSVGElement, points: readonly TrainPoint[], bar: number, reached: Reached | null): void {
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const last = points.length ? points[points.length - 1].seconds : 0;
  const span = Math.max(60, Math.ceil(last / 60) * 60);
  const x = (s: number) => L + (s / span) * (W - L - R);
  const y = (r: number) => T + (1 - r) * (H - T - B);
  const parts: SVGElement[] = [];
  for (const r of [0, 0.5, 1]) {
    parts.push(el('line', { x1: L, x2: W - R, y1: y(r), y2: y(r), class: 'grid' }));
    parts.push(el('text', { x: L - 6, y: y(r), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, `${Math.round(r * 100)}%`));
  }
  parts.push(el('line', { x1: L, x2: W - R, y1: y(bar), y2: y(bar), class: 'bar' }));
  parts.push(el('text', { x: W - R, y: y(bar) - 5, class: 'axis', 'text-anchor': 'end' }, `${Math.round(bar * 100)}% bar`));
  const step = span <= 120 ? 30 : span <= 600 ? 60 : 120;
  for (let s = 0; s <= span; s += step) {
    parts.push(el('text', { x: x(s), y: H - 8, class: 'axis', 'text-anchor': 'middle' }, clock(s)));
  }
  for (const p of points) parts.push(el('circle', { cx: x(p.seconds), cy: y(p.rate), r: 2.5, class: 'dot' }));
  if (points.length) {
    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.seconds).toFixed(1)},${y(p.bestRate).toFixed(1)}`).join(' ');
    parts.push(el('path', { d, class: 'best' }));
  }
  if (reached) {
    parts.push(el('line', { x1: x(reached.seconds), x2: x(reached.seconds), y1: T, y2: H - B, class: 'reached' }));
  }
  svg.replaceChildren(...parts);
}
