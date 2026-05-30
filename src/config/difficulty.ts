import { DIFFICULTY } from "./constants";

export interface DifficultyParams {
  /** Normalized difficulty in [0,1). 0 = easiest, approaches 1 over time. */
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
}

type Range = { easy: number; hard: number };

/**
 * Logistic difficulty curve. See DIFFICULTY in constants.ts for the rationale.
 *
 *   d(t) = 1 / (1 + e^(-k * (t - t0)))
 */
export function difficultyAt(elapsedMs: number): DifficultyParams {
  const t = elapsedMs / 1000; // seconds
  const d = 1 / (1 + Math.exp(-DIFFICULTY.STEEPNESS * (t - DIFFICULTY.MIDPOINT)));

  const lerp = (r: Range) => r.easy + (r.hard - r.easy) * d;

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
  };
}
