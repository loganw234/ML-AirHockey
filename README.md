# ML-AirHockey

A small neural network that learns to play air hockey by neuroevolution, meant to be played against and tinkered with in the browser: play any generation, watch it learn from zero, and change its weights while it plays.

It is a toy, on purpose ("less 'scientific bit exact determinism' and more 'ML toy'", [docs/ROADMAP.md](docs/ROADMAP.md)). It keeps a few checks that can fail and a dated record of every training run, so that what it says about itself is something a command can show.

## Status

**Phase 0, the headless spike, measured (2026-11-26).** Grown from random weights and trained only against itself, the model beat the reference bot in 70% of matches after 3.5, 6.0 and 6.75 minutes of training in three runs, on one desktop with six worker threads. The learning curve swings widely on the way. Protocol and results: [docs/PHASE0.md](docs/PHASE0.md).

**The page, begun the same day.** You can play against a ladder of generations from one of those runs and edit the network's weights while it plays. It does not train in the browser yet, and it is not deployed.

## The front door

    node tools/check.ts        # or: npm run check

It runs every gate, then each gate's negative control: the same gate against a planted fault, which must fail. Read the last line. `VERDICT: PASS (14 gates, 18 controls)` means everything held. It took 1.1 to 1.4 s on 2026-11-26 on the desktop it was written on. Nothing is cached, and nothing needs installing: Node 22.18 or later runs the TypeScript directly.

## The page

    node tools/serve.ts        # builds into dist/ and serves it at http://127.0.0.1:8770/
    node tools/build.ts        # just the build: dist/ is the static site GitHub Pages will serve

The top player is a network from the generation ladder, a random network, a checkpoint file, or one of the scripted bots. The bottom is you, with your pointer, or another player to watch: the same network (edits and all), the same network as loaded, a ladder generation, or a bot. The top network is drawn beside the table, live. Click a line to change that weight, or a circle to change a neuron's bias or switch it off, and the play changes at once. Each pick is explained, and the explanation is measured: the page replays the last ten seconds the AI saw through the network with and without the change, and says which way and how far its aim moves. The play settings slow the whole game down, or slow one side's mallet, or make the AI decide less often. Pause and Step move the game on a sixtieth of a second at a time. The ladder is chosen with `node tools/ladder.ts <run id>:<generation> ...`, which copies those checkpoints into `web/checkpoints/` and takes their labels from the run record.

## Training

    node tools/train.ts --regime self --seed 1 --budget 480
    node tools/summarize.ts

Each run appends a line to [records/runs.jsonl](records/runs.jsonl), with the machine, the code's hash, the settings and the learning curve, and leaves its checkpoints in `out/` (not committed).

## Layout

- `src/`: everything the browser will share. `config.ts` (the table), `sim.ts` (physics), `obs.ts` (what a player sees), `net.ts` (the network), `net_ref.ts` (its slow reference), `bots.ts` (the reference bot and the statue), `match.ts`, `evaluate.ts`, `evolve.ts`, `checkpoint.ts`.
- `web/`: the page. `live.ts` (a match one step at a time, held against `playMatch`), `table.ts`, `netview.ts`, `layout.ts` (where a weight sits in the genome, held against the forward pass), `explain.ts` (the measured explanations), `main.ts`, and `checkpoints/` (the ladder).
- `tools/`: Node only. `check.ts` (the front door), `train.ts` and `worker.ts` (the trainer), `summarize.ts`, `ladder.ts`, `build.ts`, `serve.ts`.
- `docs/`: the roadmap with Logan's decisions in Logan's own words, and the Phase 0 protocol and results.

## Licence

MIT, [LICENSE](LICENSE).
