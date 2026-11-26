# Roadmap

The lead's file. It holds Logan's decisions in Logan's own words, with their dates, and the phases. The lead's readings sit beside those words and are marked as the lead's.

## Logan's words, as given

**2026-11-26, the goal:**

> This project aims to host a small ML model via browser which plays air hockey against the human player. Ideally it will be more a tool to explore and tweak the model at runtime simply to experiment. Depending on how long generations take, I was considering training off of real human games gathered by visitors to the site hosting it, along with generational checkpoints (so players could play against gen0 compared to gen100 for example). Or otherwise high speed simulated training to bring the quality of the model to competency rapidly from 0 as the player watches. It really depends how quickly the model can be trained, if it can reach capable skill in less than 5 minutes of high speed training then its fine to let players watch it learn from 0. The ability to tweak individual weights at runtime to see the effects on the model would be an interesting feature, as well as visually showing the weights along with the game space.
>
> This project is less 'scientific bit exact determinism' and more 'ML toy'

**2026-11-26, Logan's answers to the lead's six questions** (the questions are in the session; each answer is quoted, then the lead's reading):

1. "Neuroevolution first". *The lead's reading:* evolve the network's weights; reinforcement learning by gradient only if evolution stalls.
2. "Headless". *The lead's reading:* Phase 0 is a headless spike that measures generations and minutes to beat a fixed reference bot, before any interface.
3. "70% is a good bar to start, we can see what that actually looks like later". *The lead's reading:* "capable" means the trained model wins at least 70% of matches against the reference bot, for now.
4. "Github pages (no human replay capturing yet)". *The lead's reading:* a static site on GitHub Pages, training in the visitor's browser, no server; recording visitors' games is not part of the plan.
5. "Light". *The lead's reading:* a front door, a handful of gates each watched to fail, the fixed reference bot as the yardstick, and a dated record of training runs; no parcel rounds until there are three or more independent pieces.
6. "Yes and go ahead and delete the folder, it was initially going to be this project folder but ML fit better than AI in my mind." *The lead's reading:* git in this folder, a public GitHub repository under MIT; the empty sibling folder `AIr-hockey` was removed on 2026-11-26. Creating the GitHub repository and each push still go to Logan first.

**2026-11-26, after playing the first page:**

> Commit changes, a couple minor tweaks next. The ref-v1 model frequently gets stuck with the puck in the corner (see attached)
> Along with that, would it be possible to add a few variables to tweak how the model plays? For example maximum move speed, an overall speed selection to play slower in general etc. Just things to generally make it easier to observe whats going on

*The lead's reading and what was done:* the first commit was made (`fbb99d6`, local, not pushed). The stuck puck was a trap in the table, not only in the bot. Square corners let a puck be pinned against both walls where no mallet could free it. ref-v1 held the puck past the possession limit 2.83 times a match against itself, every time in a corner (MEASURED, 200 matches). The table now has rounded corners (`table-v2`), on which the same bot, unchanged, held it 0.00 times. See [PHASE0.md](PHASE0.md), "The table changed". The page gained play settings: game speed, each side's top speed, how often the AI decides, and a Step button while paused.

**2026-11-26, the same day:**

> One final pass for a couple features, an AI v AI mode, allowing the user to watch the model against itself. The other being a bit more explanation of what each weight roughly does, along with what altering it should do

*What was done:*
- **A bottom-player choice:** you; the top network itself, sharing every edit; the top network as loaded, without the edits; any ladder generation; or a scripted bot.
- **Explanations for each pick in the inspector, measured rather than written by hand.** The page keeps the top player's last ten seconds of observations and replays them through the network with and without the change. For a weight it reports which way and how far the aim moves, split by the sign of what the weight carries, and what setting it to zero would do. For a neuron, what it tracks and what switching it off would do. For an input, how much the AI leans on it.
- **A "How to read the network" guide.**
- **The `explain` gate** holds the measurement against a network with one known path. Only the meanings of the inputs and outputs are hand-written, and the gate requires one for every name.

**2026-11-26, the same day:**

> Commit and push to remote. Go ahead and create a repo description for github as well. Then we can begin the in browser training and steadier learning

*What was done:* committed as `3e39900`. The public repository `loganw234/ML-AirHockey` was created on GitHub, MIT, with the description below, and pushed. `git ls-remote origin` then showed `refs/heads/main` at `3e39900`, the same as the local `HEAD`.

> A 210-weight neural network that learns air hockey by neuroevolution. Play it in the browser, watch it play itself, and change its weights while it plays, with each weight's effect measured and explained.

Then:
- **One training loop for Node and the page** (`src/trainer.ts`, `src/workerCore.ts`).
- **The steadier-learning comparison**, under a protocol written before its runs: [STEADY.md](STEADY.md).
- **Training in the page.**

*Results, the same day:*
- **The steady method won by the rule fixed before its runs:** 13 drops against 17, and a median of 150 s to a confirmed 70% against 315 s. It is the page's default. It is steadier, not steady: late collapses remain ([STEADY.md](STEADY.md)).
- **In the browser, once:** the page reached the bar after 4:25 of training, confirmed at 92% on 400 fresh matches ([PHASE0.md](PHASE0.md), "once in a browser").

## Standing rules (proposed by the lead, carried from Logan's other projects; not yet confirmed for this one)

- Commit and push only on Logan's word.
- Before any run on the desktop, `python <repos>/TimeSheet/timesheet.py check desktop --short`; a run of ten minutes or more is booked there first, in the mildest true mode.
- No personal paths in committed files.
- Delete only what you created; stop a process by its PID, never by name.
- The yardstick, meaning the reference bot together with the table and rules, is frozen: a change to either is a new version (`REFERENCE_BOT_VERSION`, `TABLE_VERSION`), and runs against the old one stay as they were.

## Phases

- **Phase 0, the headless spike (2026-11-26).** A simulator, a small network, a reference bot, an evolutionary trainer, and the measurement: how many generations, and how many minutes on this desktop, until the champion beats the reference bot in 70% of matches. Its protocol is [PHASE0.md](PHASE0.md).
- **Phase 0, measured (2026-11-26):** 3.5, 6.0 and 6.75 minutes of training to 70% in three runs on the desktop; the curve swings widely. Details in [PHASE0.md](PHASE0.md), results section.
- **Phase 1, begun 2026-11-26, while Phase 0's runs went, at Logan's suggestion ("are we able to work on the visual portion somewhat?").** Done so far: play against a ladder of four generations from run `20261126T140230Z-self-s3`, a random network or the scripted bots, with the network drawn live beside the table and every weight, bias and neuron editable while it plays. Not yet: training in the browser, the deploy to GitHub Pages.
- **Phase 1, the playable page (as first planned).** The same code in the browser on GitHub Pages: play against any generation, watch training from zero if Phase 0 says it is fast enough, and a ladder of shipped checkpoints if it is not.
- **Phase 2, the explorer (not begun).** The network drawn beside the table with live activations; drag a weight or switch off a neuron and see the play change; an overlay of where the model would move for each puck position.
- **Later, not planned:** learning from recorded human games (held by answer 4).
