import Phaser from "phaser";
import { ENEMY } from "../config/constants";

/**
 * An Alien is a Phaser Container holding:
 *   - the alien body sprite (animated, 2 frames)
 *   - one or more "number ball" sprites whose values sum to `result`
 *
 * Using a Container lets us move the body + balls together as one unit, and
 * attach an arcade-physics body to the container for overlap detection with
 * bullets and the player.
 */
export default class Alien extends Phaser.Physics.Arcade.Sprite {
  /** The number the player must type to target this alien. */
  public readonly result: number;
  private balls: Phaser.GameObjects.Sprite[] = [];
  private homing = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    bodyKey: string,
    result: number,
    digits: number[],
    ballTexture: string,
  ) {
    super(scene, x, y, bodyKey);
    this.result = result;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setData("type", "alien");
    this.play(`${bodyKey}-idle`);

    // Lay the number balls out in a row centered above the alien body.
    const spacing = 16;
    const totalW = (digits.length - 1) * spacing;
    digits.forEach((d, i) => {
      const ball = scene.add.sprite(
        x - totalW / 2 + i * spacing,
        y - 22,
        ballTexture,
        d - 1, // frame N-1 shows number N
      );
      this.balls.push(ball);
    });
  }

  /** Move down, then home toward the player's x once low enough. */
  public advance(playerX: number, delta: number): void {
    const dt = delta / 1000;
    if (this.y < ENEMY.HOME_TRIGGER_Y && !this.homing) {
      this.y += ENEMY.FALL_SPEED * dt;
    } else {
      this.homing = true;
      const dx = playerX - this.x;
      const dy = 1; // always drift down a touch while homing
      const len = Math.hypot(dx, dy) || 1;
      this.x += (dx / len) * ENEMY.HOME_SPEED * dt;
      this.y += (dy / len) * ENEMY.HOME_SPEED * dt;
    }
    // Keep balls glued above the body.
    const spacing = 16;
    const totalW = (this.balls.length - 1) * spacing;
    this.balls.forEach((ball, i) => {
      ball.x = this.x - totalW / 2 + i * spacing;
      ball.y = this.y - 22;
    });
  }

  /** Clean up the alien and its balls together. */
  public kill(): void {
    this.balls.forEach((b) => b.destroy());
    this.balls = [];
    this.destroy();
  }
}
