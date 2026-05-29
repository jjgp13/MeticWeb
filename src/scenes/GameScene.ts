import Phaser from "phaser";
import { BULLET, ENEMY, GAME, PLAYER } from "../config/constants";
import { difficultyAt } from "../config/difficulty";
import Alien from "../objects/Alien";

/**
 * GameScene owns the actual gameplay. A Phaser Scene has a lifecycle:
 *   create()  -> build the world once
 *   update(t, dt) -> called every frame (dt = ms since last frame)
 * Arcade Physics "Groups" batch many sprites and give us cheap overlap checks.
 */
export default class GameScene extends Phaser.Scene {
  private ship!: Phaser.Physics.Arcade.Sprite;
  private bullets!: Phaser.Physics.Arcade.Group;
  private aliens!: Phaser.Physics.Arcade.Group;

  /** result -> alien, so a typed number maps directly to its target. */
  private enemiesInField = new Map<number, Alien>();
  private target: Alien | null = null;

  private typed = "";
  private typedText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private score = 0;
  private lives: number = PLAYER.LIVES;
  private lifeIcons: Phaser.GameObjects.Image[] = [];
  private lastSpawnX = -999;
  private lastFire = 0;
  private gameOver = false;

  private starSprites: Phaser.GameObjects.Image[] = [];
  private elapsedMs = 0;
  private spawnCountdown = 0;
  private diffBar!: Phaser.GameObjects.Rectangle;

  constructor() {
    super("GameScene");
  }

  create(): void {
    this.resetState();

    // --- Sparse parallax starfield -----------------------------------------
    // Individual faint stars at random depths read far better than tiling the
    // star texture. Bigger stars drift faster, creating a parallax effect.
    this.starSprites = [];
    for (let i = 0; i < 70; i++) {
      const s = this.add
        .image(
          Phaser.Math.Between(0, GAME.WIDTH),
          Phaser.Math.Between(0, GAME.HEIGHT),
          "star",
        )
        .setScale(Phaser.Math.FloatBetween(0.25, 0.85))
        .setAlpha(Phaser.Math.FloatBetween(0.25, 0.8))
        .setDepth(-1);
      this.starSprites.push(s);
    }

    // --- Groups -------------------------------------------------------------
    this.bullets = this.physics.add.group();
    this.aliens = this.physics.add.group();

    // --- Player ship --------------------------------------------------------
    this.ship = this.physics.add.sprite(GAME.WIDTH / 2, PLAYER.Y, "ship", 0);
    this.ship.setScale(2);

    // Bullet hits alien -> explode + score.
    this.physics.add.overlap(
      this.bullets,
      this.aliens,
      (b, a) => this.onBulletHit(b as Phaser.Physics.Arcade.Sprite, a as Alien),
      undefined,
      this,
    );

    this.buildHud();
    this.buildKeypad();
    this.bindKeyboard();

    // --- Enemy spawner: interval & speeds scale with difficulty (see update).
    this.spawnCountdown = 0; // spawn immediately on the first frame
    this.spawnAlien();
  }

  private resetState(): void {
    this.enemiesInField.clear();
    this.target = null;
    this.typed = "";
    this.score = 0;
    this.lives = PLAYER.LIVES;
    this.lifeIcons = [];
    this.lastSpawnX = -999;
    this.lastFire = 0;
    this.elapsedMs = 0;
    this.spawnCountdown = 0;
    this.gameOver = false;
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.elapsedMs += delta;
    const diff = difficultyAt(this.elapsedMs);

    // Drift stars downward with parallax; wrap back to the top.
    for (const s of this.starSprites) {
      s.y += (0.15 + s.scaleX * 0.9) * (delta / 16.67);
      if (s.y > GAME.HEIGHT) {
        s.y = 0;
        s.x = Phaser.Math.Between(0, GAME.WIDTH);
      }
    }
    this.diffBar.setSize(diff.d * (GAME.WIDTH - 24), 4); // show ramp progress

    // Spawn on a difficulty-scaled interval (faster over time).
    this.spawnCountdown -= delta;
    if (this.spawnCountdown <= 0) {
      this.spawnAlien();
      this.spawnCountdown = diff.spawnInterval;
    }

    // Resolve the current target from the typed number.
    const typedVal = this.typed === "" ? -1 : parseInt(this.typed, 10);
    this.target = this.enemiesInField.get(typedVal) ?? null;

    // Advance every alien; detect ones that reached the player line.
    this.aliens.getChildren().forEach((obj) => {
      const alien = obj as Alien;
      alien.advance(this.ship.x, delta);
      if (alien.y >= PLAYER.Y - 6) this.onAlienReachedPlayer(alien);
    });

    // Slide the ship toward the target and fire when lined up.
    if (this.target && this.target.active) {
      this.ship.x = Phaser.Math.Linear(this.ship.x, this.target.x, PLAYER.MOVE_LERP);
      if (
        Math.abs(this.ship.x - this.target.x) < PLAYER.SHOOT_RANGE &&
        time - this.lastFire > PLAYER.FIRE_COOLDOWN
      ) {
        this.fire(time);
      }
    }

    // Recycle bullets that fly off the top.
    this.bullets.getChildren().forEach((obj) => {
      const b = obj as Phaser.Physics.Arcade.Sprite;
      if (b.y < -20) b.destroy();
    });
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  private spawnAlien(): void {
    if (this.gameOver) return;

    const diff = difficultyAt(this.elapsedMs);

    // Build a unique result so each typed number maps to exactly one alien.
    // Ball count and digit size both scale with difficulty.
    let digits: number[] = [];
    let result = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const count = Phaser.Math.Between(1, diff.maxBalls);
      digits = Array.from({ length: count }, () =>
        Phaser.Math.Between(1, diff.maxDigit),
      );
      result = digits.reduce((s, d) => s + d, 0);
      if (!this.enemiesInField.has(result)) break;
      result = -1;
    }
    if (result === -1) return; // field saturated, skip this tick

    // Pick a spawn x that is not too close to the previous one.
    let x = Phaser.Math.Between(40, GAME.WIDTH - 40);
    let guard = 0;
    while (Math.abs(x - this.lastSpawnX) < ENEMY.MIN_SPAWN_GAP && guard++ < 8) {
      x = Phaser.Math.Between(40, GAME.WIDTH - 40);
    }
    this.lastSpawnX = x;

    const bodyKey = `alien${Phaser.Math.Between(1, 13)}`;
    const alien = new Alien(
      this,
      x,
      -20,
      bodyKey,
      result,
      digits,
      "blueBalls",
      diff.fallSpeed,
      diff.homeSpeed,
    );
    alien.setScale(1.5);
    this.aliens.add(alien);
    this.enemiesInField.set(result, alien);
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------
  private fire(time: number): void {
    this.lastFire = time;
    const bullet = this.bullets.create(
      this.ship.x,
      this.ship.y - 24,
      "bullet",
    ) as Phaser.Physics.Arcade.Sprite;
    bullet.setFrame(0); // static frame for now
    bullet.setVelocityY(-BULLET.SPEED);
    this.sound.play("shoot", { volume: 0.4 });
    // Clear the typed answer once we have committed to a shot.
    this.setTyped("");
  }

  private onBulletHit(bullet: Phaser.Physics.Arcade.Sprite, alien: Alien): void {
    if (!alien.active) return;
    const points = alien.result // higher sums are worth a touch more
      ? Math.max(ENEMY.BASE_POINTS, alien.result * 10)
      : ENEMY.BASE_POINTS;

    this.explode(alien.x, alien.y);
    this.addScore(points, alien.x, alien.y);

    this.enemiesInField.delete(alien.result);
    alien.kill();
    bullet.destroy();
  }

  private onAlienReachedPlayer(alien: Alien): void {
    this.enemiesInField.delete(alien.result);
    this.explode(alien.x, alien.y);
    alien.kill();
    this.loseLife();
  }

  private explode(x: number, y: number): void {
    this.sound.play("explode", { volume: 0.5 });
    const emitter = this.add.particles(x, y, "star", {
      speed: { min: 60, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 2, end: 0 },
      lifespan: 500,
      quantity: 16,
      tint: [0xffd166, 0xef476f, 0x4ea1ff],
    });
    emitter.explode(16);
    this.time.delayedCall(550, () => emitter.destroy());
  }

  // ---------------------------------------------------------------------------
  // Score & lives HUD
  // ---------------------------------------------------------------------------
  private addScore(points: number, x: number, y: number): void {
    this.score += points;
    this.scoreText.setText(this.score.toString().padStart(7, "0"));

    const pop = this.add
      .text(x, y, `+${points}`, { fontFamily: "monospace", fontSize: "16px", color: "#ffd166" })
      .setOrigin(0.5);
    this.tweens.add({
      targets: pop,
      y: y - 40,
      alpha: 0,
      duration: 700,
      onComplete: () => pop.destroy(),
    });
  }

  private loseLife(): void {
    this.sound.play("hurt", { volume: 0.5 });
    this.lives = Math.max(0, this.lives - 1);
    const icon = this.lifeIcons[this.lives];
    if (icon) icon.setAlpha(0.15);
    this.cameras.main.shake(150, 0.01);
    if (this.lives <= 0) this.endGame();
  }

  private buildHud(): void {
    this.scoreText = this.add.text(12, 12, "0000000", {
      fontFamily: "monospace",
      fontSize: "20px",
      color: "#ffffff",
    });

    // Difficulty ramp indicator: a thin bar that fills as the game speeds up.
    this.add
      .rectangle(12, 44, GAME.WIDTH - 24, 4, 0x1b2340)
      .setOrigin(0, 0.5);
    this.diffBar = this.add
      .rectangle(12, 44, 0, 4, 0x4ea1ff)
      .setOrigin(0, 0.5);

    for (let i = 0; i < PLAYER.LIVES; i++) {
      const icon = this.add
        .image(GAME.WIDTH - 18 - i * 26, 22, "life")
        .setScale(1.4);
      this.lifeIcons.push(icon);
    }

    this.typedText = this.add
      .text(GAME.WIDTH / 2, PLAYER.Y + 36, "_", {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5);
  }

  // ---------------------------------------------------------------------------
  // Input: on-screen keypad + physical keyboard
  // ---------------------------------------------------------------------------
  private buildKeypad(): void {
    const labels = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "<"];
    const cols = 3;
    const cellW = 120;
    const cellH = 42;
    const startX = GAME.WIDTH / 2 - cellW;
    const startY = PLAYER.Y + 70;

    labels.forEach((label, i) => {
      const cx = startX + (i % cols) * cellW;
      const cy = startY + Math.floor(i / cols) * cellH;

      const btn = this.add
        .rectangle(cx, cy, cellW - 8, cellH - 6, 0x1b2340)
        .setStrokeStyle(2, 0x4ea1ff)
        .setInteractive({ useHandCursor: true });
      this.add
        .text(cx, cy, label, { fontFamily: "monospace", fontSize: "22px", color: "#ffffff" })
        .setOrigin(0.5);

      btn.on("pointerdown", () => {
        btn.setFillStyle(0x33406e);
        this.handleInput(label);
      });
      btn.on("pointerup", () => btn.setFillStyle(0x1b2340));
      btn.on("pointerout", () => btn.setFillStyle(0x1b2340));
    });
  }

  private bindKeyboard(): void {
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") this.handleInput(e.key);
      else if (e.key === "Backspace") this.handleInput("<");
      else if (e.key === "Escape") this.handleInput("C");
      else if (e.key === "Enter" && this.gameOver) this.scene.restart();
    });
  }

  private handleInput(key: string): void {
    if (this.gameOver) {
      this.scene.restart();
      return;
    }
    this.sound.play("blip", { volume: 0.3 });
    if (key === "C") this.setTyped("");
    else if (key === "<") this.setTyped(this.typed.slice(0, -1));
    else if (this.typed.length < 2) this.setTyped(this.typed + key);
  }

  private setTyped(value: string): void {
    this.typed = value;
    this.typedText.setText(value === "" ? "_" : value);
  }

  // ---------------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------------
  private endGame(): void {
    this.gameOver = true;

    const best = Math.max(this.score, Number(localStorage.getItem("metic-highscore") ?? 0));
    localStorage.setItem("metic-highscore", String(best));

    this.add
      .rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, 0x05060f, 0.8)
      .setDepth(10);
    this.add
      .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 60, "GAME OVER", {
        fontFamily: "monospace",
        fontSize: "40px",
        color: "#ef476f",
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(
        GAME.WIDTH / 2,
        GAME.HEIGHT / 2,
        `Score: ${this.score}\nBest:  ${best}`,
        { fontFamily: "monospace", fontSize: "22px", color: "#ffffff", align: "center" },
      )
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 + 80, "tap / Enter to play again", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5)
      .setDepth(11);

    this.input.once("pointerdown", () => this.scene.restart());
  }
}
