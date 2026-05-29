import Phaser from "phaser";
import {
  BULLET,
  DIFFICULTY,
  ENEMY,
  GAME,
  PLAYER,
  RECOVERY,
  type RecoveryMode,
} from "../config/constants";
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

  // Hit-recovery: which mode is active and when the slow-mo grace window ends.
  private recoveryMode: RecoveryMode = RECOVERY.DEFAULT_MODE;
  private recoveryUntil = 0;
  private recoveryText!: Phaser.GameObjects.Text;

  // Pause: while paused the field is frozen and aliens are hidden so the
  // player can't keep solving sums during the break.
  private paused = false;
  private pauseOverlay: Phaser.GameObjects.GameObject[] = [];

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
    this.recoveryUntil = 0;
    this.paused = false;
    this.pauseOverlay = [];
  }

  update(time: number, delta: number): void {
    if (this.gameOver || this.paused) return;

    this.elapsedMs += delta;
    const diff = difficultyAt(this.elapsedMs);

    // During the post-hit grace window everything in the field moves in slow
    // motion (the difficulty timer itself keeps running).
    const slow =
      time < this.recoveryUntil &&
      (this.recoveryMode === "slowmo" || this.recoveryMode === "slowmo_push")
        ? RECOVERY.SLOW_FACTOR
        : 1;
    const fieldDelta = delta * slow;

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
    this.spawnCountdown -= fieldDelta;
    if (this.spawnCountdown <= 0) {
      this.spawnAlien();
      this.spawnCountdown = diff.spawnInterval;
    }

    // Resolve the current target from the typed number.
    const typedVal = this.typed === "" ? -1 : parseInt(this.typed, 10);
    this.target = this.enemiesInField.get(typedVal) ?? null;

    // Advance every alien; detect ones that reached the player line. The active
    // target FLEES upward: once the player has typed its answer it turns and
    // runs from the player while the ship lines up the shot, so a correct answer
    // is never punished by the ship's travel time.
    this.aliens.getChildren().forEach((obj) => {
      const alien = obj as Alien;
      if (alien === this.target) {
        alien.retreat(fieldDelta, ENEMY.RETREAT_SPEED);
        return;
      }
      alien.advance(fieldDelta);
      if (alien.y >= PLAYER.Y - 6) this.onAlienReachedPlayer(alien);
    });

    // Slide the ship toward the target and fire when lined up.
    if (this.target && this.target.active) {
      this.ship.x = Phaser.Math.Linear(this.ship.x, this.target.x, PLAYER.MOVE_LERP);
      if (
        Math.abs(this.ship.x - this.target.x) < PLAYER.SHOOT_RANGE &&
        time - this.lastFire > PLAYER.FIRE_COOLDOWN
      ) {
        this.fire(time, this.target);
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

    // Don't let the field over-populate — a crowded screen makes a single hit
    // unrecoverable.
    if (this.aliens.getLength() >= diff.maxOnScreen) return;

    // Build a unique result so each typed number maps to exactly one alien.
    // Ball count (>= 2, so it is always a real sum) and digit size scale up.
    let digits: number[] = [];
    let result = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const count = Phaser.Math.Between(DIFFICULTY.MIN_BALLS, diff.maxBalls);
      digits = Array.from({ length: count }, () =>
        Phaser.Math.Between(1, diff.maxDigit),
      );
      result = digits.reduce((s, d) => s + d, 0);
      if (!this.enemiesInField.has(result)) break;
      result = -1;
    }
    if (result === -1) return; // field saturated, skip this tick

    // Pick a lane x that keeps clear of the last spawn AND any alien still near
    // the top, so aliens (and their numbers) never overlap on screen.
    const overlaps = (cx: number) =>
      this.aliens.getChildren().some((o) => {
        const a = o as Alien;
        return a.y < 110 && Math.abs(a.x - cx) < ENEMY.MIN_SPAWN_GAP;
      });
    let x = Phaser.Math.Between(40, GAME.WIDTH - 40);
    let guard = 0;
    while (
      (Math.abs(x - this.lastSpawnX) < ENEMY.MIN_SPAWN_GAP || overlaps(x)) &&
      guard++ < 12
    ) {
      x = Phaser.Math.Between(40, GAME.WIDTH - 40);
    }
    if (overlaps(x)) return; // no clear lane right now — skip to avoid overlap
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
  private fire(time: number, target: Alien | null): void {
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

    // If the locked target sits at/below the muzzle, an upward bullet can't
    // reach it, so resolve the hit point-blank to guarantee the kill.
    if (target && target.active && target.y >= this.ship.y - 24) {
      this.onBulletHit(bullet, target);
    }
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
    if (this.lives <= 0) {
      this.endGame();
      return;
    }
    this.applyRecovery();
  }

  /** Give the player breathing room after a hit, per the active recovery mode. */
  private applyRecovery(): void {
    const now = this.time.now;
    switch (this.recoveryMode) {
      case "slowmo":
        this.recoveryUntil = now + RECOVERY.SLOWMO_MS;
        break;
      case "slowmo_push":
        this.recoveryUntil = now + RECOVERY.SLOWMO_MS;
        this.aliens.getChildren().forEach((o) =>
          (o as Alien).pushBack(RECOVERY.PUSHBACK_PX),
        );
        break;
      case "pushback":
        this.aliens.getChildren().forEach((o) =>
          (o as Alien).pushBack(RECOVERY.PUSHBACK_PX),
        );
        break;
      case "clear":
        this.aliens.getChildren().slice().forEach((o) => {
          const a = o as Alien;
          this.explode(a.x, a.y);
          a.kill();
        });
        this.enemiesInField.clear();
        this.target = null;
        this.setTyped("");
        break;
    }
  }

  private cycleRecoveryMode(): void {
    const modes = RECOVERY.MODES;
    const i = modes.indexOf(this.recoveryMode);
    this.recoveryMode = modes[(i + 1) % modes.length];
    this.recoveryText.setText(`REC: ${this.recoveryMode}`);
  }

  /** Freeze the field and hide aliens so the player can't solve while paused. */
  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;

    if (this.paused) {
      this.aliens.getChildren().forEach((o) => (o as Alien).setVisibleAll(false));
      this.typedText.setVisible(false);

      const dim = this.add
        .rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, 0x05060f, 0.92)
        .setDepth(9)
        .setInteractive();
      dim.on("pointerdown", () => this.togglePause());
      const label = this.add
        .text(GAME.WIDTH / 2, GAME.HEIGHT / 2, "PAUSED\n\ntap / P to resume", {
          fontFamily: "monospace",
          fontSize: "28px",
          color: "#4ea1ff",
          align: "center",
        })
        .setOrigin(0.5)
        .setDepth(10);
      this.pauseOverlay = [dim, label];
    } else {
      this.pauseOverlay.forEach((o) => o.destroy());
      this.pauseOverlay = [];
      this.aliens.getChildren().forEach((o) => (o as Alien).setVisibleAll(true));
      this.typedText.setVisible(true);
    }
  }

  private buildHud(): void {
    // HUD sits above gameplay so aliens entering from the top never obscure it.
    const HUD_DEPTH = 5;
    this.scoreText = this.add
      .text(12, 12, "0000000", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#ffffff",
      })
      .setDepth(HUD_DEPTH);

    // Difficulty ramp indicator: a thin bar that fills as the game speeds up.
    this.add
      .rectangle(12, 44, GAME.WIDTH - 24, 4, 0x1b2340)
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);
    this.diffBar = this.add
      .rectangle(12, 44, 0, 4, 0x4ea1ff)
      .setOrigin(0, 0.5)
      .setDepth(HUD_DEPTH);

    for (let i = 0; i < PLAYER.LIVES; i++) {
      const icon = this.add
        .image(GAME.WIDTH - 18 - i * 26, 22, "life")
        .setScale(1.4)
        .setDepth(HUD_DEPTH);
      this.lifeIcons.push(icon);
    }

    this.typedText = this.add
      .text(GAME.WIDTH / 2, PLAYER.Y + 36, "_", {
        fontFamily: "monospace",
        fontSize: "32px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH);

    // Recovery-mode label (press M to cycle) for comparing hit-recovery feels.
    this.recoveryText = this.add
      .text(12, 56, `REC: ${this.recoveryMode}`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#7a86b8",
      })
      .setDepth(HUD_DEPTH);

    // Pause button (also bound to the P key).
    const pauseBtn = this.add
      .text(GAME.WIDTH / 2, 22, "II", {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5)
      .setDepth(HUD_DEPTH)
      .setInteractive({ useHandCursor: true });
    pauseBtn.on("pointerdown", () => this.togglePause());
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
      if (e.key === "p" || e.key === "P") {
        this.togglePause();
        return;
      }
      if (e.key === "m" || e.key === "M") {
        this.cycleRecoveryMode();
        return;
      }
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
    if (this.paused) return;
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
