import Phaser from "phaser";
import { ENEMY } from "../config/constants";

/** How an alien moves through the field. New personalities slot in here. */
export type AlienBehavior = "descend";

/**
 * Everything needed to spawn one alien. Passing a single config object (instead
 * of a long positional argument list) keeps call sites readable and makes it
 * trivial to add per-personality fields (speed, behavior, ball color, …).
 */
export interface AlienConfig {
  x: number;
  y: number;
  bodyKey: string;
  /** The number the player must type to target this alien (sum of the balls). */
  result: number;
  /** The individual numbers the alien carries; their count drives personality. */
  digits: number[];
  ballTexture: string;
  fallSpeed: number;
  homeSpeed: number;
  behavior?: AlienBehavior;
}

const BALL_SPACING = 16; // px between adjacent number balls
const BALL_OFFSET_Y = 22; // px the ball row sits above the body

/**
 * An Alien is a sprite (the body) plus a row of "number ball" sprites whose
 * values sum to `result`. The balls are kept glued above the body every frame.
 * Movement is driven by `behavior` so different enemy personalities can be added
 * without touching the scene.
 */
export default class Alien extends Phaser.Physics.Arcade.Sprite {
  /** The number the player must type to target this alien. */
  public readonly result: number;
  /** How many numbers this alien carries (2 = easy sum, 3 = harder, …). */
  public readonly ballCount: number;
  public readonly behavior: AlienBehavior;
  /** Scene time (ms) when spawned, used for the score's speed bonus. */
  public readonly spawnedAt: number;

  private balls: Phaser.GameObjects.Sprite[] = [];
  private fallSpeed: number;
  private homeSpeed: number;

  constructor(scene: Phaser.Scene, config: AlienConfig) {
    super(scene, config.x, config.y, config.bodyKey);
    this.result = config.result;
    this.ballCount = config.digits.length;
    this.behavior = config.behavior ?? "descend";
    this.spawnedAt = scene.time.now;
    this.fallSpeed = config.fallSpeed;
    this.homeSpeed = config.homeSpeed;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setData("type", "alien");
    this.setFrame(0); // static frame for now; animations come later

    // Lay the number balls out in a row centered above the alien body.
    config.digits.forEach((d) => {
      const ball = scene.add.sprite(config.x, config.y, config.ballTexture, d - 1); // frame N-1 shows number N
      this.balls.push(ball);
    });
    this.syncBalls();
  }

  /** Keep the number balls centered above the body. */
  private syncBalls(): void {
    const totalW = (this.balls.length - 1) * BALL_SPACING;
    this.balls.forEach((ball, i) => {
      ball.x = this.x - totalW / 2 + i * BALL_SPACING;
      ball.y = this.y - BALL_OFFSET_Y;
    });
  }

  /**
   * Move one frame according to the alien's behavior. "descend" falls straight
   * down in a fixed lane (no horizontal movement) so aliens never converge and
   * overlap; speed ramps from fallSpeed to homeSpeed past HOME_TRIGGER_Y, adding
   * urgency as it nears the player.
   */
  public advance(delta: number): void {
    const dt = delta / 1000;
    switch (this.behavior) {
      case "descend": {
        const speed = this.y < ENEMY.HOME_TRIGGER_Y ? this.fallSpeed : this.homeSpeed;
        this.y += speed * dt;
        break;
      }
    }
    this.syncBalls();
  }

  /** Flee straight up (used while locked: the player answered correctly). */
  public retreat(delta: number, speed: number): void {
    const dt = delta / 1000;
    this.y = Math.max(8, this.y - speed * dt);
    this.syncBalls();
  }

  /** Show/hide the body and its number balls together (used while paused). */
  public setVisibleAll(visible: boolean): void {
    this.setVisible(visible);
    this.balls.forEach((b) => b.setVisible(visible));
  }

  /** Clean up the alien and its balls together. */
  public kill(): void {
    this.balls.forEach((b) => b.destroy());
    this.balls = [];
    this.destroy();
  }
}
