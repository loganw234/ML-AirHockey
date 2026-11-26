// A match played one control step at a time, for the page: the human's pointer or a network chooses each
// step's target, and the page decides when to step. No DOM here, so the front door can hold it.
//
// It plays by the same rules as playMatch in src/match.ts: the serve, the goals, the possession rule.
// Those rules are written in both files, so the `live-equals-batch` gate drives this stepper with the
// same players and seeds as playMatch and requires the same match, state hash included.
//
// A goal or a possession foul leaves a serve pending, so the page can pause on it; call servePending()
// before reading the state for the next step.

import { DEFAULT_SIM } from '../src/config.ts';
import type { SimConfig } from '../src/config.ts';
import { makeRng } from '../src/rng.ts';
import { newState, step, NO_GOAL } from '../src/sim.ts';
import type { State } from '../src/sim.ts';
import { serveRandom } from '../src/match.ts';

export type LiveEvent = 'none' | 'goal0' | 'goal1' | 'foul0' | 'foul1';

export interface LiveMatch {
  readonly s: State;
  readonly cfg: SimConfig;
  goals0: number;
  goals1: number;
  fouls0: number;
  fouls1: number;
  steps: number;
  pending: -1 | 0 | 1; // the player a pending serve goes to, or -1
  servePending(): void;
  step(t0x: number, t0y: number, t1x: number, t1y: number): LiveEvent;
}

export function createLiveMatch(seed: number, cfg: SimConfig = DEFAULT_SIM): LiveMatch {
  const rng = makeRng(seed);
  const s = newState(cfg);
  serveRandom(s, cfg, rng() < 0.5 ? 0 : 1, rng);
  const holdSteps = Math.round(cfg.possessionSeconds * cfg.controlHz);
  let half = -1, held = 0;
  const m: LiveMatch = {
    s, cfg, goals0: 0, goals1: 0, fouls0: 0, fouls1: 0, steps: 0, pending: -1,
    servePending() {
      if (m.pending === -1) return;
      serveRandom(s, cfg, m.pending, rng);
      m.pending = -1;
    },
    step(t0x, t0y, t1x, t1y) {
      if (m.pending !== -1) throw new Error('LIVE-SERVE-PENDING: call servePending() before step()');
      const g = step(s, t0x, t0y, t1x, t1y, cfg);
      m.steps++;
      if (g === NO_GOAL) {
        const h = s.py < 0 ? 0 : 1;
        if (h === half) held++; else { half = h; held = 1; }
        if (held > holdSteps) {
          half = -1; held = 0;
          if (h === 0) { m.fouls0++; m.pending = 1; return 'foul0'; }
          m.fouls1++; m.pending = 0; return 'foul1';
        }
        return 'none';
      }
      half = -1; held = 0;
      if (g === 0) { m.goals0++; m.pending = 1; return 'goal0'; }
      m.goals1++; m.pending = 0; return 'goal1';
    },
  };
  return m;
}
