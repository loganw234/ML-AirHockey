// The evaluation protocol: how "beats the reference bot in 70% of matches" is measured.
//
// Fixed seeds, never used in training: every evaluation seed is below 2^31, and every training seed has
// its top bit set (evolve.ts), so the two sets are disjoint by construction. The seat alternates with the
// seed's parity, so half of each evaluation is played from each end. A draw is not a win.

import type { Policy } from './policy.ts';
import { playMatch } from './match.ts';
import type { MatchOptions } from './match.ts';

export const EVAL = Object.freeze({
  bar: 0.7, // Logan, 2026-11-26: "70% is a good bar to start"
  matches: 200, // the evaluation at each checkpoint of a run
  confirmMatches: 400, // a fresh set, played once a run first clears the bar
  statueMatches: 100, // a second counter beside the headline: the same model against the statue
  goalsToWin: 3,
  maxSeconds: 60,
  seedBase: 1_000_000,
  confirmSeedBase: 2_000_000,
  statueSeedBase: 3_000_000,
});

export const EVAL_MATCH: Readonly<MatchOptions> = Object.freeze({ goalsToWin: EVAL.goalsToWin, maxSeconds: EVAL.maxSeconds });

export function evalSeeds(base: number, n: number): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) seeds.push(base + i);
  return seeds;
}

export interface Tally {
  wins: number;
  losses: number;
  draws: number;
}

export function emptyTally(): Tally {
  return { wins: 0, losses: 0, draws: 0 };
}

export function addTally(a: Tally, b: Tally): Tally {
  return { wins: a.wins + b.wins, losses: a.losses + b.losses, draws: a.draws + b.draws };
}

export function winRate(t: Tally): number {
  const n = t.wins + t.losses + t.draws;
  return n === 0 ? NaN : t.wins / n;
}

// `pol` against `opp` over the given seeds; an even seed puts `pol` at the bottom (player 0).
// `makePol` and `makeOpp` build a fresh player per match.
export function tally(makePol: () => Policy, makeOpp: () => Policy, seeds: readonly number[], opts: MatchOptions = EVAL_MATCH): Tally {
  const t = emptyTally();
  for (const seed of seeds) {
    const seat: 0 | 1 = (seed & 1) === 0 ? 0 : 1;
    const r = seat === 0 ? playMatch(makePol(), makeOpp(), seed, opts) : playMatch(makeOpp(), makePol(), seed, opts);
    if (r.winner === -1) t.draws++;
    else if (r.winner === seat) t.wins++;
    else t.losses++;
  }
  return t;
}
