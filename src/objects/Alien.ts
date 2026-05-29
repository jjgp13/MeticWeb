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
  private fallSpeed: number;
  private homeSpeed: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    bodyKey: string,
    result: number,
    digits: number[],
    ballTexture: string,
    fallSpeed: number,
    homeSpeed: number,
  ) {
    super(scene, x, y, bodyKey);
    this.result = result;
    this.fallSpeed = fallSpeed;
    this.homeSpeed = homeSpeed;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setData("type", "alien");
    this.setFrame(0); // static frame for now; animations come later

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

  /**
   * Fall straight down in a fixed lane (no horizontal movement) so aliens never
   * converge and overlap. Speed ramps up from fallSpeed to homeSpeed once the
   * alien crosses HOME_TRIGGER_Y, adding urgency as it nears the player.
   */
  public advance(delta: number): void {
    const dt = delta / 1000;
    const speed = this.y < ENEMY.HOME_TRIGGER_Y ? this.fallSpeed : this.homeSpeed;
    this.y += speed * dt;

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
