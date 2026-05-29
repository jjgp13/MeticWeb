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
        frameWidth: 16,
        frameHeight: 40,
      });
    }

    // --- Ship + bullet: 16x32, 2 frames -------------------------------------
    this.load.spritesheet("ship", `${base}/sprites/SpaceShip.png`, {
      frameWidth: 16,
      frameHeight: 32,
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
    // Idle animations for each alien body.
    for (let i = 1; i <= 13; i++) {
      this.anims.create({
        key: `alien${i}-idle`,
        frames: this.anims.generateFrameNumbers(`alien${i}`, { start: 0, end: 1 }),
        frameRate: 4,
        repeat: -1,
      });
    }

    this.anims.create({
      key: "ship-thrust",
      frames: this.anims.generateFrameNumbers("ship", { start: 0, end: 1 }),
      frameRate: 10,
      repeat: -1,
    });

    this.anims.create({
      key: "bullet-fly",
      frames: this.anims.generateFrameNumbers("bullet", { start: 0, end: 1 }),
      frameRate: 12,
      repeat: -1,
    });

    this.scene.start("GameScene");
  }
}
