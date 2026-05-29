/**
 * Central tuning + layout constants.
 * The world is a fixed virtual resolution that Phaser scales to fit any screen.
 */
export const GAME = {
  WIDTH: 480,
  HEIGHT: 720,
  BG_COLOR: "#05060f",
} as const;

export const PLAYER = {
  Y: 430, // fixed vertical line the ship rides on (keypad sits below it)
  MOVE_LERP: 0.22, // how snappily the ship slides toward a target (0..1)
  SHOOT_RANGE: 6, // px tolerance to consider "lined up" and fire
  LIVES: 3,
  FIRE_COOLDOWN: 250, // ms between shots
} as const;

export const BULLET = {
  SPEED: 700, // px/sec upward
} as const;

export const ENEMY = {
  HOME_TRIGGER_Y: 220, // y after which an alien speeds up toward the player
  MIN_SPAWN_GAP: 84, // px min horizontal distance between alien lanes
  BASE_POINTS: 50, // base score per ball
  RETREAT_SPEED: 150, // px/sec a locked (correctly-answered) alien flees upward
} as const;

/**
 * Difficulty ramp.
 *
 * Difficulty is a normalized value d(t) in [0,1) driven by a LOGISTIC (sigmoid)
 * curve of elapsed time. A sigmoid gives exactly the feel we want:
 *   - a gentle warm-up at the start (curve is nearly flat early),
 *   - a smooth acceleration through the middle,
 *   - a plateau near 1 so the game stays hard but never becomes impossible.
 *
 *   d(t) = 1 / (1 + e^(-k * (t - t0)))
 *
 * where t = seconds elapsed, t0 = MIDPOINT (where d = 0.5), and k = STEEPNESS
 * (larger k = sharper ramp). Every concrete parameter below is then linearly
 * interpolated between its `easy` and `hard` value using d.
 */
export const DIFFICULTY = {
  MIDPOINT: 50, // seconds until difficulty reaches the halfway point
  STEEPNESS: 0.055, // logistic k; controls how sharp the ramp is

  // px/sec — how fast aliens fall, then home toward the player.
  FALL_SPEED: { easy: 28, hard: 110 },
  HOME_SPEED: { easy: 45, hard: 150 },

  // ms between spawns (easy = slow/sparse, hard = fast/dense).
  SPAWN_INTERVAL: { easy: 2200, hard: 650 },

  // Hard cap on aliens alive at once, so the field never gets so crowded that a
  // single hit becomes unrecoverable.
  MAX_ON_SCREEN: { easy: 4, hard: 8 },

  // A sum needs at least two numbers, so always >= 2 balls.
  MIN_BALLS: 2,
  MAX_BALLS: { easy: 2, hard: 3 },
  MAX_DIGIT: { easy: 3, hard: 9 },
} as const;

/**
 * Hit-recovery: after losing a life on a crowded screen the player needs a
 * moment to recover or the run death-spirals. Several modes are implemented so
 * their feel can be compared live in-game (press M to cycle, see HUD label):
 *   - slowmo:      briefly slow every alien + spawning to give reaction time.
 *   - slowmo_push: slow-mo AND shove all aliens back up the screen.
 *   - pushback:    only shove all aliens back up (no slow-mo).
 *   - clear:       wipe the whole board on every hit (most forgiving).
 */
export const RECOVERY = {
  MODES: ["slowmo", "slowmo_push", "pushback", "clear"] as const,
  DEFAULT_MODE: "slowmo",
  SLOWMO_MS: 3000, // duration of the slow-motion grace window
  SLOW_FACTOR: 0.4, // alien speed + spawn multiplier during the grace window
  PUSHBACK_PX: 90, // how far aliens are shoved back up on a hit
} as const;

export type RecoveryMode = (typeof RECOVERY.MODES)[number];

/** Number ball colors map to future math operations (sum/sub/mul/div). */
export const BALL_COLOR = {
  SUM: "blueBalls",
  SUB: "redBalls",
  MUL: "greenBalls",
  DIV: "yellowBalls",
} as const;
