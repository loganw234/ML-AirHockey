# Working on ML-AirHockey

Short, and only what is non-obvious. The README says what the project is; this says what will bite.

The method is Logan's HonestFramework and ParcelRound, applied **light**, by Logan's answer of 2026-11-26 ([docs/ROADMAP.md](docs/ROADMAP.md)): a front door, gates watched to fail, a frozen yardstick, a dated record of runs. No parcel rounds until there are three or more independent pieces.

## Start here: one command

    node tools/check.ts

Read the verdict line, not the exit code: `VERDICT: PASS (<gates> gates, <controls> controls)`. A gate passes on its own `PASS` line; a control passes only on `CONTROL-DETECTED` with the code it was written to produce, so a control that fails for some other reason is `CONTROL-WRONG-REASON` and fails the check. Under a second. No cache.

**Adding a gate:** add an entry to `CHECKS` in `tools/check.ts` with at least one control that plants a realistic fault and names the code it expects. A gate with no control fails as `UNCONTROLLED`. Run the control and watch it fail before you trust the gate.

## Rules that hold the claims

- **The yardstick is frozen.** The reference bot (`src/bots.ts`, `REFERENCE_BOT_VERSION`), the game (`config.ts` with `TABLE_VERSION`, `sim.ts`, `obs.ts`, `match.ts`) and the evaluation (`evaluate.ts`) make up `yardstick.hash` in every run record. Changing how the bot plays bumps its version, and changing the table or the rules bumps `TABLE_VERSION`. Runs against different hashes are not compared. Phase 0 was on `ref-v1` and `table-v1`, the square corners, which `PHASE0_TABLE` replays exactly.
- **The page may change the mallets' speed scales, nothing else of the physics the networks see.** `malletSpeedScale0/1` handicap a side; the observation's scales (`puckMaxSpeed`, `malletMaxSpeed`) stay as trained, or a network would be fed inputs on a different scale.
- **The run record is written by `tools/train.ts` only.** `records/runs.jsonl` is append-only; never edit a line, and never delete a failed run. A figure quoted in a document names the run id it came from.
- **Evaluation seeds are below 2^31; training seeds have the top bit set** (`trainingSeed` in `src/evolve.ts`). Keep them disjoint.
- **The reference forward pass imports nothing** (`src/net_ref.ts`); the `ref-independent` gate holds it.
- **`src/` and `web/` must run in a browser**: no `node:` imports there; the build refuses one by name (`BUILD-NODE-IMPORT`). Node-only code goes in `tools/`. `web/live.ts` and `web/layout.ts` touch no DOM, so the front door can hold them.
- **The page's match rules are written twice** (`src/match.ts` and `web/live.ts`). The `live-equals-batch` gate requires identical matches, state hash included, so change both or the gate fails.
- **An explanation on the page is measured, never written for a particular network.** `web/explain.ts` replays recent observations through the network with and without a change. The hand-written words are only the meanings of the inputs and outputs (`INPUT_HELP`, `OUTPUT_HELP`), one per name in `src/obs.ts`. The `explain` gate fails on a missing or stale one, so a renamed input needs its words too.
- **The ladder's labels come from the record.** Change the ladder with `node tools/ladder.ts`, never by editing `web/checkpoints/index.json`.
- **A checkpoint refuses by name** (`CHECKPOINT-INPUTS` and so on) rather than loading a network onto inputs it was not trained on. If you change `INPUT_NAMES`, old checkpoints stop loading. That is intended.

## The genome layout

Per layer, from the input: weights as rows, one row per output neuron (`[out][in]`, row-major), then the layer's biases. `net.ts`'s header is the definition. The explorer must read it the same way; the `net-ref` gate has a control for the transposed reading.

## Standing rules (proposed, carried from Logan's other projects; see the roadmap)

- Commit and push only on Logan's word, each time.
- Before any run: `python <repos>/TimeSheet/timesheet.py check desktop --short`. A run of ten minutes or more is booked first, in the mildest true mode. Training uses several cores, and other projects take timing measurements on this desktop.
- Don't run CPU-heavy work while a timing run is going: it moves the figures.
- No personal paths in committed files. Delete only what you created. Stop processes by PID.

## Traps

1. **Node runs the TypeScript by stripping the types, not by checking them** (Node 22.18+, measured on 22.19.0, 2026-11-26). There is no type checker in Phase 0: a type error is not caught. Only erasable syntax works: no `enum`, no `namespace`, no constructor parameter properties. Type-only imports must be `import type`, or the run fails at import with a missing export. Imports name the `.ts` extension.
2. **Git Bash on this desktop has `core.autocrlf=true`.** `.gitattributes` pins `eol=lf` for this repository.
3. **The build and the front door print `ExperimentalWarning: stripTypeScriptTypes is an experimental feature`.** That is Node's warning about the function `tools/build.ts` uses to strip types for the browser, and it is harmless.
4. **Opening `web/index.html` directly shows a dead page.** The page loads built JavaScript from `dist/`. Use `node tools/serve.ts`.
