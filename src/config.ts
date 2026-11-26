// The table and its physics: the one place these numbers live.
//
// Coordinates: x runs across the table in [-halfWidth, halfWidth], y along it in [-halfLength, halfLength].
// Player 0 is at the bottom and defends the goal at y = -halfLength; player 1 is at the top.
// Units are table units and seconds.

export interface SimConfig {
  halfWidth: number;
  halfLength: number;
  goalHalfWidth: number; // the goal mouth is |x| < goalHalfWidth in each end wall
  cornerRadius: number; // the table's corners are rounded to this radius; 0 is square, as in Phase 0
  puckRadius: number;
  malletRadius: number;
  controlHz: number; // how often each player chooses a target
  substeps: number; // physics steps per control step
  malletMaxSpeed: number; // a mallet moves toward its target at most this fast
  malletSpeedScale0: number; // player 0's top speed is malletMaxSpeed times this; 1 in training, a handicap on the page
  malletSpeedScale1: number; // the same for player 1
  puckMaxSpeed: number;
  wallRestitution: number;
  malletRestitution: number;
  puckDrag: number; // per second: speed falls by this fraction each second, roughly
  serveOffset: number; // a served puck rests this far into the receiving half, as a fraction of halfLength
  homeOffset: number; // a mallet's home is this far into its own half, as a fraction of halfLength
  possessionSeconds: number; // a puck left in one half this long is served to the other player (match.ts)
}

export const DEFAULT_SIM: Readonly<SimConfig> = Object.freeze({
  halfWidth: 0.5,
  halfLength: 1.0,
  goalHalfWidth: 0.16,
  cornerRadius: 0.12,
  puckRadius: 0.035,
  malletRadius: 0.06,
  controlHz: 60,
  substeps: 4,
  malletMaxSpeed: 3.0,
  malletSpeedScale0: 1,
  malletSpeedScale1: 1,
  puckMaxSpeed: 5.0,
  wallRestitution: 0.9,
  malletRestitution: 0.9,
  puckDrag: 0.2,
  serveOffset: 0.4,
  homeOffset: 0.8,
  possessionSeconds: 7,
});

// The table Phase 0 was measured on (docs/PHASE0.md): square corners, where a puck could be pinned for
// good. Kept so those runs can be played again; with cornerRadius 0 the simulator takes exactly the path
// it took then.
export const PHASE0_TABLE: Readonly<SimConfig> = Object.freeze({ ...DEFAULT_SIM, cornerRadius: 0 });

// Names the game's rules as a whole, for the run record: change it when the table or the rules change.
export const TABLE_VERSION = 'table-v2';
