import { DIFFICULTY } from "./constants";

export interface DifficultyParams {
  /** Normalized difficulty in [0,1). 0 = easiest, approaches 1 with score/time. */
  d: number;
  fallSpeed: number;
  homeSpeed: number;
  spawnInterval: number;
  maxBalls: number;
  maxDigit: number;
  maxOnScreen: number;
  /** Weighted cognitive-load ceiling on screen; spawns wait above it. */
  threatBudget: number;
  /** Max concurrent "hard" (multi-number) aliens allowed right now. */
  maxHardOnScreen: number;
  /** Max concurrent UNSOLVED aliens (primary spawn gate); score-driven, 1→3. */
  maxUnsolved: number;
}

type Range = { easy: number; hard: number };

/**
 * Score-led difficulty curve with a gentle time floor. See DIFFICULTY in
 * constants.ts for the rationale.
 *
 *   dScore     = score / (score + SCORE_HALF)        // earned via points
 *   dTimeFloor = min(logistic(t), TIME_FLOOR_MAX)    // slow ramp for everyone
 *   d          = max(dScore, dTimeFloor)             // monotonic, never drops
 *
 * Most params lerp on the blended `d`, but `maxUnsolved` uses `dScore` ALONE so
 * the number of simultaneous unsolved sums grows only as the player scores.
 */
export function difficultyAt(elapsedMs: number, score = 0): DifficultyParams {
  const t = elapsedMs / 1000; // seconds
  const dTime = 1 / (1 + Math.exp(-DIFFICULTY.STEEPNESS * (t - DIFFICULTY.MIDPOINT)));
  const dTimeFloor = Math.min(dTime, DIFFICULTY.TIME_FLOOR_MAX);
  const dScore = score / (score + DIFFICULTY.SCORE_HALF); // 0 at score 0, →1
  const d = Math.max(dScore, dTimeFloor);

  const lerp = (r: Range, x: number = d) => r.easy + (r.hard - r.easy) * x;

  return {
    d,
    fallSpeed: lerp(DIFFICULTY.FALL_SPEED),
    homeSpeed: lerp(DIFFICULTY.HOME_SPEED),
    spawnInterval: lerp(DIFFICULTY.SPAWN_INTERVAL),
    maxBalls: Math.round(lerp(DIFFICULTY.MAX_BALLS)),
    maxDigit: Math.round(lerp(DIFFICULTY.MAX_DIGIT)),
    maxOnScreen: Math.round(lerp(DIFFICULTY.MAX_ON_SCREEN)),
    threatBudget: lerp(DIFFICULTY.THREAT_BUDGET),
    // Stay at a single hard enemy until late game, then allow a second.
    maxHardOnScreen: d < DIFFICULTY.SECOND_HARD_AT ? 1 : 2,
    // Score ALONE opens up concurrent unsolved sums (1 → 2 → 3).
    maxUnsolved: Math.round(lerp(DIFFICULTY.MAX_UNSOLVED, dScore)),
  };
}
