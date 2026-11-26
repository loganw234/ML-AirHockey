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

## Standing rules (proposed by the lead, carried from Logan's other projects; not yet confirmed for this one)

- Commit and push only on Logan's word.
- Before any run on the desktop, `python <repos>/TimeSheet/timesheet.py check desktop --short`; a run of ten minutes or more is booked there first, in the mildest true mode.
- No personal paths in committed files.
- Delete only what you created; stop a process by its PID, never by name.
- The reference bot is the yardstick and is frozen: a change to it is a new version, and runs against the old one stay as they were.

## Phases

- **Phase 0, the headless spike (2026-11-26).** A simulator, a small network, a reference bot, an evolutionary trainer, and the measurement: how many generations, and how many minutes on this desktop, until the champion beats the reference bot in 70% of matches. Its protocol is [PHASE0.md](PHASE0.md).
- **Phase 0, measured (2026-11-26):** 3.5, 6.0 and 6.75 minutes of training to 70% in three runs on the desktop; the curve swings widely. Details in [PHASE0.md](PHASE0.md), results section.
- **Phase 1, begun 2026-11-26, while Phase 0's runs went, at Logan's suggestion ("are we able to work on the visual portion somewhat?").** Done so far: play against a ladder of four generations from run `20261126T140230Z-self-s3`, a random network or the scripted bots, with the network drawn live beside the table and every weight, bias and neuron editable while it plays. Not yet: training in the browser, the deploy to GitHub Pages.
- **Phase 1, the playable page (as first planned).** The same code in the browser on GitHub Pages: play against any generation, watch training from zero if Phase 0 says it is fast enough, and a ladder of shipped checkpoints if it is not.
- **Phase 2, the explorer (not begun).** The network drawn beside the table with live activations; drag a weight or switch off a neuron and see the play change; an overlay of where the model would move for each puck position.
- **Later, not planned:** learning from recorded human games (held by answer 4).
