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
  MOVE_LERP: 0.12, // how snappily the ship slides toward a target (0..1)
  SHOOT_RANGE: 6, // px tolerance to consider "lined up" and fire
  LIVES: 3,
  FIRE_COOLDOWN: 250, // ms between shots
} as const;

export const BULLET = {
  SPEED: 700, // px/sec upward
} as const;

export const ENEMY = {
  SPAWN_INTERVAL: 1600, // ms between spawns
  MIN_BALLS: 1,
  MAX_BALLS: 3,
  FALL_SPEED: 45, // px/sec downward phase
  HOME_SPEED: 70, // px/sec once homing toward the player
  HOME_TRIGGER_Y: 120, // y after which an alien starts homing
  MIN_SPAWN_GAP: 64, // px min horizontal distance between consecutive spawns
  BASE_POINTS: 50, // points = ballCount * BASE_POINTS
} as const;

/** Number ball colors map to future math operations (sum/sub/mul/div). */
export const BALL_COLOR = {
  SUM: "blueBalls",
  SUB: "redBalls",
  MUL: "greenBalls",
  DIV: "yellowBalls",
} as const;
