# Steadier learning: does re-scoring the champion steady the curve?

Written 2026-11-26, before the first run it describes. Every run made under it carries this file's hash as `protocolHash` and `docs/STEADY.md` as `protocol` in `records/runs.jsonl`.

## Why

Phase 0 ([PHASE0.md](PHASE0.md)) reached the bar in every run but found the curve "not monotone, and that is the main finding". The champion's win rate against the reference bot swung by tens of points between checkpoints 45 s apart. The page shows a generation ladder and will show training live, so a later generation being worse is a problem a player sees.

Logan, 2026-11-26: "Then we can begin the in browser training and steadier learning".

## What is compared

Both arms use the shared loop in `src/trainer.ts`, on `table-v2` (rounded corners), against `ref-v1`, with every Phase 0 setting not named here.

- **Baseline:** `DEFAULT_EVO`, Phase 0's method. The champion is the genome with the best fitness from its 6 training matches, and half of all training opponents are the latest champion.
- **Steady:** `STEADY_EVO`, `--steady`. Two changes together:
  - **Re-scoring:** the top 8 genomes by fitness each play 16 more matches against a fixed panel of up to 8 past champions spread evenly across the hall of fame, all on the same seeds, and the best of them on that panel is the champion. The champion is always carried into the next population.
  - **Even opponents:** training opponents are drawn evenly from the hall of fame, not half from the latest champion.

The two changes are tested together, not apart. If steady is better, which change did it is not answered here.

## How it is measured

- **Six runs, one at a time:** seeds 1, 2 and 3 of each arm, `node tools/train.ts [--steady] --seed N --budget 480 --no-stop --protocol docs/STEADY.md`. Each trains for the full 480 s, so every curve has the same length. Runs are ordered baseline 1, steady 1, baseline 2, steady 2, baseline 3, steady 3, so a drift in the machine's load over the hour falls on both arms alike.
- **Evaluation** as in Phase 0: the generation's champion plays 200 matches against the reference bot every 15 s of training, and a first evaluation over 70% is confirmed on 400 fresh seeds. Time to the bar is the training seconds at the first confirmed evaluation. With `--no-stop` training goes on after it.
- **Steadiness, from each run's curve,** printed by `node tools/summarize.ts --steady`:
  - **drops:** the number of times the win rate fell by more than 20 points from one evaluation to the next;
  - **worst drop:** the largest such fall, in points;
  - **held:** after the first evaluation at or over 50%, the share of later evaluations at or over 40%.
- **Cost:** the arms' generations a second and steps a second, from the record. Re-scoring adds 8 × 16 = 128 matches to each generation's 96 × 6 = 576 training matches, about 22% more, which the record will measure.
- **The machine:** the desktop, 6 workers, the TimeSheet checked before each run and a notice booking held for the series. Nothing else heavy runs on it meanwhile. The lead writes code and documents during the runs but runs nothing heavy.

## The decision, fixed now

**Steady becomes the page's default** if, over its three runs against the baseline's three:

1. it has fewer drops in total; and
2. its median time to a confirmed 70% is no more than 1.25 times the baseline's. A run that does not reach the bar counts as slower than any that does.

Otherwise the page keeps the baseline as its default. Either way it offers both, as a setting.

## What a result here does not show

- **Which of the two changes mattered.**
- **That three seeds are the distribution.** As in Phase 0, a median of three is not a rate.
- **Anything about a browser's speed.** The page measures its own.

## Results

Appended below after the runs, each figure with its run id.

### 2026-11-26: the six runs (MEASURED)

All six were made under one code hash (`sourceHash` `73140824…`), one yardstick (`ref-v1` on `table-v2`, `49aae26c…`) and this protocol (`2f2aaea2…`). They ran on the desktop's i5-12400F with 6 workers, one at a time, from 07:50 to 08:39 local, in the planned order, with the TimeSheet free and a notice booking (B0414) held. A 15-second smoke run, `20261126T144938Z-self-steady-s9`, came first and is left out by `summarize.ts --steady`. No run had a failed confirmation.

| run | arm | confirmed 70% at (training s) | confirmed rate | drops > 20 points | worst drop | held ≥ 40% after first ≥ 50% | best | mean of last 5 | M steps/s |
|---|---|---|---|---|---|---|---|---|---|
| `20261126T145011Z-self-s1` | baseline | not reached | | 1 | 53.0 | 0% of 1 | 60% | 30% | 1.87 |
| `20261126T145823Z-self-steady-s1` | steady | not reached | | 4 | 39.0 | 23% of 26 | 69% | 17% | 2.31 |
| `20261126T150629Z-self-s2` | baseline | 180.1 | 88.8% | 10 | 72.0 | 40% of 30 | 88% | 35% | 2.39 |
| `20261126T151437Z-self-steady-s2` | steady | 150.0 | 83.8% | 2 | 42.5 | 91% of 22 | 95% | 43% | 2.19 |
| `20261126T152243Z-self-s3` | baseline | 315.2 | 81.3% | 6 | 45.5 | 71% of 21 | 82% | 69% | 2.16 |
| `20261126T153052Z-self-steady-s3` | steady | 60.0 | 80.0% | 7 | 77.0 | 75% of 28 | 99% | 48% | 2.33 |

**The decision, by the rule fixed above:**
- **Fewer drops:** steady 13 in total (4 + 2 + 7), baseline 17 (1 + 10 + 6). Met.
- **Median time:** steady 150.0 s against the baseline's 315.2 s, 0.48 times, within the 1.25 allowed. A run that did not reach counts as slowest in both arms. Met.
- **Steady is the page's default.**

**What else the curves show** (`node tools/summarize.ts --curve <run id>`):
- **Steady climbs higher and holds longer, but is not steady.** Its best evaluations were 69%, 95% and 99%, against the baseline's 60%, 88% and 82%. Seed 2 stayed between 71% and 95% for 9 evaluations in a row, about two minutes, and was at 60% or over for 17 of its last 23. Both arms still collapse late: steady seed 3 went from 99% to 13% by its last evaluation, and steady seed 2 from 95% to 28%.
- **The drop count rewards a run that never climbs.** Baseline seed 1 had one drop because it stayed below 35% for most of the run. That is the protocol's measure as written, and it is reported as such.
- **On `table-v2`, one seed in each arm failed to reach 70% in 480 s.** In Phase 0, on `table-v1`, all three reached the bar. The reference bot no longer pins itself in the corners, which may make it a harder yardstick. *That is the lead's reading, not measured; the tables are separate yardsticks and are not compared.*
- **Cost.** Steady ran 2.19 to 2.33 million steps a second against the baseline's 1.87 to 2.39, and 3.97 to 4.31 generations a second against 3.73 to 4.76. On these runs re-scoring cost little in throughput. Both arms ran fewer generations a second than Phase 0's 5.7 to 6.4; the cause is not measured.

### What the lead reads in it (BELIEVED, not measured)

- **Late collapses still happen**, so any page that shows training should show the best so far, chosen by evaluation, rather than the latest champion. The page does.
- **A next step for steadiness**, untested: keep the best champion by evaluation as a permanent member of the hall of fame, so the population always has to beat it.
