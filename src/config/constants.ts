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

  // Personality: speed scales INVERSELY with how many numbers an alien carries.
  // A 2-number sum is quick to solve, so those aliens dart in faster; 3+ numbers
  // are harder, so they lumber. Keyed by ball count (falls back to 1).
  SPEED_BY_BALLS: { 2: 1.25, 3: 0.85, 4: 0.6 } as Record<number, number>,

  // Spawn pacing is gated by the board's CURRENT cognitive load, not a blind
  // clock. Each alien contributes its THREAT_BY_BALLS weight; new spawns are
  // withheld while the live total is at/above the difficulty-scaled budget, so
  // the screen never floods and a hit stays recoverable.
  THREAT_BY_BALLS: { 2: 1, 3: 2, 4: 3 } as Record<number, number>,
  // Aliens carrying this many balls (or more) are "hard" — slow, multi-number
  // sums. Their concurrent count is capped so two never appear at once early on.
  HARD_BALL_THRESHOLD: 3,
  // While the board is at its threat ceiling, recheck this often (ms) instead of
  // waiting a full spawn interval, so deferred spawns don't pile up and burst.
  SPAWN_RETRY_MS: 350,
} as const;

/**
 * Skill-based scoring. Points reward harder sums, faster solving, later game and
 * uninterrupted streaks:
 *
 *   points = BASE * ballCountBonus * speedBonus * difficultyMult * comboMult
 *
 * - ballCountBonus: harder (more-number) sums pay more.
 * - speedBonus: solving within FAST_MS pays FAST_MULT, decaying to SLOW_MULT by
 *   SLOW_MS (measured from when the alien spawned).
 * - difficultyMult: 1 + d, so late-game kills are worth up to ~2x.
 * - comboMult: consecutive kills without losing a life raise the multiplier by
 *   COMBO_STEP each, capped at COMBO_MAX; a hit resets the streak.
 */
export const SCORE = {
  BASE: 50,
  BALL_COUNT_BONUS: { 2: 1.0, 3: 1.6, 4: 2.4 } as Record<number, number>,
  FAST_MS: 1500, // solved at/under this -> full speed bonus
  SLOW_MS: 6000, // solved at/over this -> no speed bonus
  FAST_MULT: 2.0,
  SLOW_MULT: 1.0,
  COMBO_STEP: 0.25, // multiplier gained per consecutive kill
  COMBO_MAX: 4.0,
} as const;

/** Mastery ranks shown on game over, keyed by best-score thresholds. */
export const RANKS: ReadonlyArray<{ min: number; name: string }> = [
  { min: 0, name: "Rookie" },
  { min: 2000, name: "Cadet" },
  { min: 6000, name: "Pilot" },
  { min: 15000, name: "Ace" },
  { min: 30000, name: "Commander" },
  { min: 60000, name: "Legend" },
];

/** localStorage keys for the high score and persistent mastery stats. */
export const STORAGE = {
  HIGHSCORE: "metic-highscore",
  BEST_COMBO: "metic-best-combo",
  TOTAL_KILLS: "metic-total-kills",
  FASTEST_MS: "metic-fastest-ms",
  LAST_NAME: "metic-last-name", // remembers the player's last arcade initials
  LAST_LEN: "metic-last-len", // remembers the chosen initials length
} as const;

/** Arcade global leaderboard (Supabase-backed). */
export const LEADERBOARD = {
  // Players choose how many initials to register, from MIN to MAX.
  NAME_LEN_MIN: 3,
  NAME_LEN_MAX: 6,
  NAME_LEN_DEFAULT: 5, // pre-selected length (classic arcade default)
  // Characters selectable per initials slot, in cycle order.
  CHARSET: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
  TOP_N: 20, // rows fetched/shown on the leaderboard screen
  MAX_SCORE: 1000000, // must match the Supabase score_range CHECK constraint
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
  // single hit becomes unrecoverable. This is an absolute safety net; the threat
  // budget below is the primary pacing gate and usually binds first.
  MAX_ON_SCREEN: { easy: 4, hard: 8 },

  // Weighted cognitive-load ceiling on screen (see ENEMY.THREAT_BY_BALLS). New
  // spawns are held while live threat is at/above this, keeping mental load
  // bounded. Already-answered (locked, fleeing) aliens don't count.
  THREAT_BUDGET: { easy: 3, hard: 8 },

  // Difficulty at which a SECOND concurrent "hard" (multi-number) enemy is
  // allowed. Below this only one hard enemy can be on screen, so the player
  // never juggles two slow multi-number sums until very late game.
  SECOND_HARD_AT: 0.85,

  // Progression is SCORE-LED (the player earns difficulty), with a gentle
  // time-based floor so a struggling/idle player still sees a slow ramp.
  //   dScore = score / (score + SCORE_HALF)   (0 at start, 0.5 at SCORE_HALF)
  //   dTimeFloor = min(logistic(t), TIME_FLOOR_MAX)
  //   d = max(dScore, dTimeFloor)
  SCORE_HALF: 6000, // points at which score-driven difficulty reaches 0.5
  TIME_FLOOR_MAX: 0.4, // most the time floor alone can raise difficulty

  // Concurrent UNSOLVED aliens the player must juggle (not yet answered). This
  // is the primary spawn gate and is driven by score ALONE (dScore), so the
  // board opens up only as the player earns points: 1 → 2 → 3.
  MAX_UNSOLVED: { easy: 1, hard: 3 },

  // A sum needs at least two numbers, so always >= 2 balls.
  MIN_BALLS: 2,
  MAX_BALLS: { easy: 2, hard: 3 },
  MAX_DIGIT: { easy: 3, hard: 9 },
} as const;

/**
 * Hit-recovery: after losing a life on a crowded screen the player needs a
 * moment to recover. The whole field FREEZES for FREEZE_MS so there is time to
 * read and answer the next sum, then resumes at POST_HIT_FACTOR of normal speed
 * for the rest of the run (the difficulty curve keeps ramping underneath, so
 * absolute speed still climbs over time). The slowdown is flat, not stacking.
 */
export const RECOVERY = {
  FREEZE_MS: 3000, // field is completely frozen for this long after a hit
  POST_HIT_FACTOR: 0.8, // field speed multiplier once movement resumes
} as const;

/** Number ball colors map to future math operations (sum/sub/mul/div). */
export const BALL_COLOR = {
  SUM: "blueBalls",
  SUB: "redBalls",
  MUL: "greenBalls",
  DIV: "yellowBalls",
} as const;
