import Phaser from "phaser";
import { GAME } from "../config/constants";

/**
 * BootScene preloads every asset, builds the shared animations, then hands off
 * to GameScene. Phaser's loader is asynchronous; `preload()` queues files and
 * `create()` runs only after they have all finished downloading.
 */
export default class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    const base = "assets";

    // A tiny loading bar so we are honest about load time (it is ~instant).
    const bar = this.add.rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, 0, 6, 0x4ea1ff);
    this.load.on("progress", (p: number) => bar.setSize(200 * p, 6));

    // --- Aliens: 16px-wide, 2-frame idle animations -------------------------
    for (let i = 1; i <= 9; i++) {
      this.load.spritesheet(`alien${i}`, `${base}/sprites/Alien${i}.png`, {
        frameWidth: 16,
        frameHeight: 16,
      });
    }
    for (let i = 10; i <= 13; i++) {
      this.load.spritesheet(`alien${i}`, `${base}/sprites/Alien${i}.png`, {
        frameWidth: 32,
        frameHeight: 20,
      });
    }

    // --- Ship + bullet ------------------------------------------------------
    // Ship sheet is a 2x2 grid of 16x16 frames; we use a single static frame.
    this.load.spritesheet("ship", `${base}/sprites/SpaceShip.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("bullet", `${base}/sprites/bullet.png`, {
      frameWidth: 16,
      frameHeight: 32,
    });

    // --- Numbered balls: 16x16 grid, number N => frame N-1 ------------------
    this.load.spritesheet("blueBalls", `${base}/sprites/BlueBalls.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("redBalls", `${base}/sprites/RedBalls.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("greenBalls", `${base}/sprites/GreenBalls.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });
    this.load.spritesheet("yellowBalls", `${base}/sprites/YellowBalls.png`, {
      frameWidth: 16,
      frameHeight: 16,
    });

    // --- Misc ---------------------------------------------------------------
    this.load.image("life", `${base}/sprites/SpaceShipLifeIcon.png`);
    this.load.image("star", `${base}/sprites/star.png`);

    // --- Audio --------------------------------------------------------------
    this.load.audio("shoot", `${base}/sounds/Laser_Shoot3.wav`);
    this.load.audio("explode", `${base}/sounds/Explosion.wav`);
    this.load.audio("blip", `${base}/sounds/Blip_Select7.wav`);
    this.load.audio("hurt", `${base}/sounds/Hit_Hurt12.wav`);
  }

  create(): void {
    // Animations are deferred — we use static frames for now. The spritesheets
    // are still sliced correctly so animations can be re-enabled later:
    //   alien1-9: 16x16 (2 frames), alien10-13: 32x20 (2 frames),
    //   ship: 16x16 (2x2 grid), bullet: 16x32 (2 frames).
    this.scene.start("GameScene");
  }
}
