# Phase 0: how fast does it learn?

Written 2026-11-26, before the first measured run. Every run's record (`records/runs.jsonl`) carries this file's hash as `protocolHash`, so a run can be matched to the protocol it was made under. One smoke run of 20 s, `20261126T134827Z-self-s1`, was made before this file existed, to test the plumbing; it is in the record with a note saying so, and it is not a measurement.

## The question

Logan, 2026-11-26: "if it can reach capable skill in less than 5 minutes of high speed training then its fine to let players watch it learn from 0". And: "70% is a good bar to start".

So: **from random weights, how many generations, and how many seconds of training on this desktop, until the champion beats the reference bot (`ref-v1`) in at least 70% of matches?**

## How it is measured

- **The model:** a network of 10 inputs, 16 hidden units and 2 outputs (210 weights), unless a run's record says otherwise.
- **Training:** neuroevolution, `src/evolve.ts`, with the settings in each record's `evo` field. The primary regime is `self`: genomes play only past champions, and **never the reference bot**, so beating it is a test the model was not trained on. The regime `mixed`, in which half the training matches are against the reference bot, is reported separately and always labelled: a model trained against its own yardstick has passed an easier test.
- **The yardstick:** `ref-v1`, a scripted player (`src/bots.ts`). It is frozen from the first measured run. A change to it, to the game or to how a match is scored changes `yardstick.hash` in the record; such a change is a new version, and runs against the old one are not compared with runs against the new.
- **The evaluation** (`src/evaluate.ts`): the generation's champion plays 200 matches against the reference bot on fixed seeds that training never uses, alternating ends; a match is first to 3 goals or 60 s, and a draw is not a win. It is evaluated after generation 0 and then every 15 s of training. **A run reaches the bar** when an evaluation is at or over 70% **and** a second evaluation on 400 fresh seeds is too; a first evaluation over the bar that the second does not confirm is recorded as a failed confirmation and training goes on.
- **A second counter:** at each evaluation the champion also plays 100 matches against a statue that never moves, so that a run going nowhere can be told from a run learning slowly.
- **The clock:** training seconds count generations only. Evaluation is timed separately and left out, because in the browser it would run beside training. The record carries both, and the whole wall clock.
- **The machine:** this desktop (the record names its CPU and Node version), 6 worker threads unless the record says otherwise, one run at a time, each run under ten minutes, the TimeSheet checked before each.

## The runs planned

1. Three runs of the `self` regime with the default settings, seeds 1, 2 and 3, each with a budget of 480 s of training.
2. Whatever the first three show is worth trying next (other settings, the `mixed` regime, fewer workers to stand in for a slower machine), each recorded, and named here afterwards with its run id.

Every run is kept in the record, including those that fail.

## What a result here does not show

- **That it can beat a person.** The reference bot is a yardstick, not a human. What 70% looks like to a player is for Phase 1, which Logan's answer anticipates ("we can see what that actually looks like later").
- **How fast it is in a visitor's browser.** Node and Chrome share an engine, but a visitor's machine has fewer or slower cores, and other browsers differ. A run with fewer workers is an ESTIMATE of a slower machine, not a measurement of one; the browser is measured in Phase 1.
- **That three seeds are the distribution.** They show whether it learns at all and roughly how fast. A median of three is not a rate.

## Results

Appended below after the runs, each figure with its run id. `node tools/summarize.ts` prints the table from the record.

### 2026-11-26: the three planned runs (MEASURED)

All three under one code hash (`sourceHash` `0acf8d9b…`), one yardstick (`ref-v1`, `69be5873…`) and this protocol (`2ed6f71c…`), on the desktop's i5-12400F with 6 workers, Node v22.19.0, one run at a time between 06:49 and 07:06 local, with the TimeSheet free and a notice booking (B0413) held. Nothing else heavy ran; the lead wrote files during the runs.

| run | reached 70% at generation | training seconds | confirmed on 400 fresh seeds | failed confirmations before it |
|---|---|---|---|---|
| `20261126T134933Z-self-s1` | 2058 | 360.1 | 70.5% (282-98-20) | none |
| `20261126T135538Z-self-s2` | 2080 | 405.0 | 75.3% (301-22-77) | 2: generation 1403 at 270.1 s, 56.8% (227-87-86); generation 2007 at 390.1 s, 66.0% (264-58-78) |
| `20261126T140230Z-self-s3` | 1141 | 210.1 | 75.5% (302-61-37) | none |

- **Every run reached the bar, trained only against itself.** On this desktop: 3.5, 6.0 and 6.75 minutes of training. Two of three were over Logan's five minutes.
- **The throughput** was 2.3 to 2.7 million control steps a second over 6 workers, about 0.4 million a worker, and 5.7 to 6.4 generations a second.
- **The curve is not monotone, and that is the main finding.** The champion's win rate against the reference bot swings widely between checkpoints 45 s apart: run 2 went 60.0% at 45 s, 2.0% at 90 s, 50.0% at 135 s; run 1 went 68.5% at 225 s, 38.5% at 270 s, 18.0% at 315 s, 73.5% at 360 s. The second counter swings too: run 2's champion at generation 740 won 0% against the statue. Full curves: `node tools/summarize.ts --curve <run id>`.
- **A first evaluation over the bar is not enough.** Run 2 cleared 70% on 200 matches twice before a 400-match confirmation agreed.
- **The record lost those two failed confirmations, and the lead's trainer was why.** `tools/train.ts` replaced its result object when a run reached the bar, which dropped the failures recorded before it. Run 2's line in `records/runs.jsonl` therefore has none, and the two in the table above are read from the run's console log, kept as `records/logs/20261126T135538Z-self-s2.log` with the other runs' logs. The record is append-only, so that line stays as written. The trainer was fixed the same day, after these runs: failed confirmations are now kept apart from the result and always written.

### What the lead reads in it (BELIEVED, not measured)

- The swings are self-play cycling plus a noisy choice of champion. The champion is the best of 96 on 6 short matches each, and half of all opponents are the latest champion, so the population chases whatever beats the last strategy. Not yet tested; each of these would test it: more matches per genome, re-scoring the top few before naming a champion, opponents drawn more evenly from the hall of fame.
- **For the page this matters more than the time.** A "generation 100 versus generation 1000" ladder of raw champions would sometimes have the later one worse, and a "watch it learn" view would show it getting worse for a minute at a time.
- **A visitor's browser will be slower** than six workers here. At about 0.4 million steps a second a worker, a four-worker laptop would take about 1.5 times as long, putting these three runs at 5 to 10 minutes. That is an ESTIMATE from this desktop's per-worker rate, and unmeasured in any browser.
