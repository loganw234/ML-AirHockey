// Draws the table on a canvas, human end at the bottom. Colours come from the page's CSS variables, so
// light and dark themes both work.

import type { SimConfig } from '../src/config.ts';
import type { State } from '../src/sim.ts';

export interface Theme {
  felt: string; line: string; wall: string; goal: string; puck: string;
  human: string; ai: string; target: string; text: string;
}

export function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    felt: v('--felt'), line: v('--felt-line'), wall: v('--wall'), goal: v('--goal'), puck: v('--puck'),
    human: v('--human'), ai: v('--ai'), target: v('--target'), text: v('--text'),
  };
}

export interface Overlay {
  aiTarget: [number, number] | null; // where the AI wants its mallet, table coordinates
  humanTarget: [number, number] | null; // the pointer, when a person plays the bottom
  bottomTarget?: [number, number] | null; // where the bottom player wants its mallet, when it is an AI
  banner: string; // a short message across the centre, or ''
}

export class TableView {
  readonly canvas: HTMLCanvasElement;
  readonly cfg: SimConfig;
  private ctx: CanvasRenderingContext2D;
  private scale = 100;
  private cx = 0;
  private cy = 0;
  private margin: number;
  theme: Theme;

  constructor(canvas: HTMLCanvasElement, cfg: SimConfig) {
    this.canvas = canvas;
    this.cfg = cfg;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS-2D: this browser gave no 2D canvas');
    this.ctx = ctx;
    this.margin = cfg.malletRadius * 0.9;
    this.theme = readTheme();
  }

  // Width over height of the drawn table, walls included.
  aspect(): number {
    const m = this.margin;
    return (2 * this.cfg.halfWidth + 2 * m) / (2 * this.cfg.halfLength + 2 * m);
  }

  // Size the canvas to cssWidth pixels across.
  resize(cssWidth: number): void {
    const dpr = window.devicePixelRatio || 1;
    const cssHeight = cssWidth / this.aspect();
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.scale = this.canvas.width / (2 * this.cfg.halfWidth + 2 * this.margin);
    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;
  }

  // A pointer position (client pixels) as table coordinates.
  toTable(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / r.width;
    const px = (clientX - r.left) * dpr, py = (clientY - r.top) * dpr;
    return [(px - this.cx) / this.scale, -(py - this.cy) / this.scale];
  }

  private X(x: number): number { return this.cx + x * this.scale; }
  private Y(y: number): number { return this.cy - y * this.scale; }

  draw(s: State, o: Overlay): void {
    const { ctx, cfg, theme } = this;
    const k = this.scale;
    const hw = cfg.halfWidth, hl = cfg.halfLength, m = this.margin;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Walls, then the playing surface inside them, its corners as round as the simulator's.
    const rc = Math.max(cfg.cornerRadius, 0.004);
    ctx.fillStyle = theme.wall;
    roundRect(ctx, this.X(-hw - m), this.Y(hl + m), (2 * hw + 2 * m) * k, (2 * hl + 2 * m) * k, (rc + m) * k);
    ctx.fill();
    ctx.fillStyle = theme.felt;
    roundRect(ctx, this.X(-hw), this.Y(hl), 2 * hw * k, 2 * hl * k, rc * k);
    ctx.fill();

    // Goal mouths: gaps cut in the end walls.
    ctx.fillStyle = theme.goal;
    const gw = cfg.goalHalfWidth;
    ctx.fillRect(this.X(-gw), this.Y(hl + m), 2 * gw * k, m * k);
    ctx.fillRect(this.X(-gw), this.Y(-hl), 2 * gw * k, m * k);

    // Markings.
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = Math.max(1, 0.006 * k);
    ctx.beginPath(); ctx.moveTo(this.X(-hw), this.Y(0)); ctx.lineTo(this.X(hw), this.Y(0)); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.X(0), this.Y(0), 0.15 * k, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.X(0), this.Y(hl), gw * 1.6 * k, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(this.X(0), this.Y(-hl), gw * 1.6 * k, Math.PI, 2 * Math.PI); ctx.stroke();

    // Where each side is heading.
    if (o.humanTarget) this.ring(o.humanTarget[0], o.humanTarget[1], cfg.malletRadius * 0.5, theme.human, 0.35);
    if (o.aiTarget) this.cross(o.aiTarget[0], o.aiTarget[1], cfg.malletRadius * 0.5, theme.target);
    if (o.bottomTarget) this.cross(o.bottomTarget[0], o.bottomTarget[1], cfg.malletRadius * 0.5, theme.human);

    // Mallets and puck.
    this.mallet(s.x0, s.y0, theme.human);
    this.mallet(s.x1, s.y1, theme.ai);
    ctx.fillStyle = theme.puck;
    ctx.beginPath(); ctx.arc(this.X(s.px), this.Y(s.py), cfg.puckRadius * k, 0, 2 * Math.PI); ctx.fill();

    if (o.banner) {
      ctx.fillStyle = theme.text;
      ctx.font = `600 ${Math.round(0.09 * k)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.banner, this.cx, this.cy - 0.3 * k);
    }
  }

  private mallet(x: number, y: number, color: string): void {
    const { ctx } = this;
    const r = this.cfg.malletRadius * this.scale;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), r * 0.55, 0, 2 * Math.PI); ctx.stroke();
  }

  private ring(x: number, y: number, r: number, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 0.006 * this.scale);
    ctx.beginPath(); ctx.arc(this.X(x), this.Y(y), r * this.scale, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }

  private cross(x: number, y: number, r: number, color: string): void {
    const { ctx } = this;
    const X = this.X(x), Y = this.Y(y), R = r * this.scale;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 0.007 * this.scale);
    ctx.beginPath(); ctx.moveTo(X - R, Y - R); ctx.lineTo(X + R, Y + R); ctx.moveTo(X + R, Y - R); ctx.lineTo(X - R, Y + R); ctx.stroke();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
