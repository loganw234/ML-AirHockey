// Scripted players.
//
// The reference bot is the yardstick: "capable" means beating it in 70% of matches (docs/ROADMAP.md,
// answer 3). It is frozen. A change to how it plays is a new REFERENCE_BOT_VERSION, and runs recorded
// against an older version stay as they were.

import { DEFAULT_SIM } from './config.ts';
import type { SimConfig } from './config.ts';
import { encodeTarget } from './obs.ts';
import type { Policy } from './policy.ts';

export const REFERENCE_BOT_VERSION = 'ref-v1';

// Own frame throughout: the bot's goal is at y = -halfLength.
export function referenceBot(cfg: SimConfig = DEFAULT_SIM): Policy {
  const hw = cfg.halfWidth, hl = cfg.halfLength;
  const R = cfg.puckRadius + cfg.malletRadius;
  return (o, out) => {
    const px = o[0] * hw, py = o[1] * hl;
    const mx = o[4] * hw, my = o[5] * hl;
    const oppX = o[8] * hw;
    let tx: number, ty: number;
    if (py < 0) {
      // The puck is in the bot's half: strike it toward the side of the far goal away from the
      // opponent's mallet.
      const aimX = (oppX >= 0 ? -0.7 : 0.7) * cfg.goalHalfWidth;
      let dx = aimX - px, dy = hl - py;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= d; dy /= d;
      if (py < -hl + 1.2 * R) {
        // Too close to the end wall to get behind: hit it where it is.
        tx = px; ty = py;
      } else if (my < py - 0.25 * R) {
        // Behind the puck: drive through it.
        tx = px - dx * 0.5 * R; ty = py - dy * 0.5 * R;
      } else {
        // Level with or ahead of it: go round the side to get behind.
        const side = mx >= px ? 1 : -1;
        tx = px + side * 1.1 * R; ty = py - 1.5 * R;
      }
    } else {
      // The puck is in the far half: guard the goal, following the puck across.
      tx = Math.max(-cfg.goalHalfWidth, Math.min(cfg.goalHalfWidth, 0.6 * px));
      ty = -hl + 0.25;
    }
    encodeTarget(cfg, tx, ty, out);
  };
}

// Stands at home and never moves: the floor any learner must clear.
export function statueBot(cfg: SimConfig = DEFAULT_SIM): Policy {
  const homeY = -cfg.homeOffset * cfg.halfLength;
  return (_o, out) => encodeTarget(cfg, 0, homeY, out);
}
