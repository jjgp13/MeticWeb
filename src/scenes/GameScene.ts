import Phaser from "phaser";
import {
  BULLET,
  DIFFICULTY,
  ENEMY,
  GAME,
  PLAYER,
  RANKS,
  RECOVERY,
  SCORE,
  STORAGE,
} from "../config/constants";
import { difficultyAt } from "../config/difficulty";
import { isLeaderboardEnabled } from "../services/leaderboard";
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
  /** Once we fire on a target it stays locked (and fleeing) until destroyed,
   * independent of the typed string, so a committed kill never turns back. */
  private lockedTarget: Alien | null = null;
  /** The in-flight bullet aimed at lockedTarget; prevents firing a second
   * bullet while one is already on its way (re-fires only if it misses). */
  private lockedBullet: Phaser.Physics.Arcade.Sprite | null = null;

  private typed = "";
  private typedText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private score = 0;
  private lives: number = PLAYER.LIVES;
  private lifeIcons: Phaser.GameObjects.Image[] = [];

  // Skill scoring: streak of kills without a hit + per-run mastery tracking.
  private combo = 0;
  private comboText!: Phaser.GameObjects.Text;
  private killsThisRun = 0;
  private bestComboThisRun = 0;
  private fastestSolveMs = Infinity;
  private lastSpawnX = -999;
  private lastFire = 0;
  private gameOver = false;
  /** Guards the single transition out of the game-over screen. */
  private proceeding = false;
  /** Whether this run beat the stored personal best (drives name-entry copy). */
  private newHighScore = false;

  private starSprites: Phaser.GameObjects.Image[] = [];
  private elapsedMs = 0;
  private spawnCountdown = 0;
  private diffBar!: Phaser.GameObjects.Rectangle;

  // Hit-recovery: a short slow-motion grace window after a hit.
  private recoveryUntil = 0;

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
    this.lockedTarget = null;
    this.lockedBullet = null;
    this.typed = "";
    this.score = 0;
    this.lives = PLAYER.LIVES;
    this.lifeIcons = [];
    this.combo = 0;
    this.killsThisRun = 0;
    this.bestComboThisRun = 0;
    this.fastestSolveMs = Infinity;
    this.lastSpawnX = -999;
    this.lastFire = 0;
    this.elapsedMs = 0;
    this.spawnCountdown = 0;
    this.gameOver = false;
    this.proceeding = false;
    this.newHighScore = false;
    this.recoveryUntil = 0;
    this.paused = false;
    this.pauseOverlay = [];
  }

  update(time: number, delta: number): void {
    if (this.gameOver || this.paused) return;

    this.elapsedMs += delta;
    const diff = difficultyAt(this.elapsedMs, this.score);

    // During the post-hit grace window everything in the field moves in slow
    // motion (the difficulty timer itself keeps running).
    const slow = time < this.recoveryUntil ? RECOVERY.SLOW_FACTOR : 1;
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

    // Spawn pacing's PRIMARY gate is the number of UNSOLVED aliens (ones the
    // player still has to do mental math for): start at 1 and open up only as
    // the player earns points. The weighted threat budget is a secondary net so
    // the screen never floods and a hit stays recoverable. Recheck soon instead
    // of waiting a full interval so deferred spawns don't pile up and burst.
    this.spawnCountdown -= fieldDelta;
    if (this.spawnCountdown <= 0) {
      if (
        this.unsolvedOnScreen() < diff.maxUnsolved &&
        this.currentThreat() < diff.threatBudget
      ) {
        this.spawnAlien();
        this.spawnCountdown = diff.spawnInterval;
      } else {
        this.spawnCountdown = ENEMY.SPAWN_RETRY_MS;
      }
    }

    // Resolve the current target. A locked target (already fired upon) stays
    // committed until it is destroyed; otherwise the typed number picks one.
    if (this.lockedTarget && this.lockedTarget.active) {
      this.target = this.lockedTarget;
    } else {
      this.lockedTarget = null;
      const typedVal = this.typed === "" ? -1 : parseInt(this.typed, 10);
      this.target = this.enemiesInField.get(typedVal) ?? null;
    }

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

    // A locked (already-answered) target that flees clear off the top counts as
    // destroyed: resolve it so it can't leave a stale lock blocking targeting.
    if (this.lockedTarget && this.lockedTarget.active && this.lockedTarget.y < -24) {
      if (this.lockedBullet) this.lockedBullet.destroy();
      this.killAlien(this.lockedTarget);
    }

    // Slide the ship toward the target and fire when lined up. Don't fire again
    // while a bullet is already in flight toward this locked target — only
    // re-fire if that shot missed (its bullet was recycled off-screen).
    if (this.target && this.target.active) {
      this.ship.x = Phaser.Math.Linear(this.ship.x, this.target.x, PLAYER.MOVE_LERP);
      const shotInFlight =
        this.lockedTarget === this.target &&
        this.lockedBullet !== null &&
        this.lockedBullet.active;
      if (
        !shotInFlight &&
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
  /**
   * Weighted cognitive load currently on screen. Already-answered (locked,
   * fleeing) aliens are excluded: they are committed kills, no longer a mental
   * burden, so they shouldn't suppress new spawns.
   */
  private currentThreat(): number {
    let threat = 0;
    this.aliens.getChildren().forEach((o) => {
      const a = o as Alien;
      if (a === this.lockedTarget) return;
      threat += ENEMY.THREAT_BY_BALLS[a.ballCount] ?? 1;
    });
    return threat;
  }

  /** Count of UNSOLVED aliens — every live alien except the already-answered
   * (locked, fleeing) target. Drives the primary spawn gate. */
  private unsolvedOnScreen(): number {
    let n = 0;
    this.aliens.getChildren().forEach((o) => {
      if ((o as Alien) !== this.lockedTarget) n++;
    });
    return n;
  }

  /** Count of live "hard" (multi-number) aliens, excluding the locked target. */
  private hardAliensOnScreen(): number {
    let n = 0;
    this.aliens.getChildren().forEach((o) => {
      const a = o as Alien;
      if (a === this.lockedTarget) return;
      if (a.ballCount >= ENEMY.HARD_BALL_THRESHOLD) n++;
    });
    return n;
  }

  private spawnAlien(): void {
    if (this.gameOver) return;

    const diff = difficultyAt(this.elapsedMs, this.score);

    // Don't let the field over-populate — a crowded screen makes a single hit
    // unrecoverable.
    if (this.aliens.getLength() >= diff.maxOnScreen) return;

    // Build a unique result so each typed number maps to exactly one alien.
    // Ball count (>= 2, so it is always a real sum) and digit size scale up, but
    // cap concurrent "hard" (multi-number) enemies so the player never has to
    // juggle two slow multi-number sums at once.
    const maxBallsAllowed =
      this.hardAliensOnScreen() >= diff.maxHardOnScreen
        ? Math.max(DIFFICULTY.MIN_BALLS, ENEMY.HARD_BALL_THRESHOLD - 1)
        : diff.maxBalls;
    let digits: number[] = [];
    let result = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const count = Phaser.Math.Between(DIFFICULTY.MIN_BALLS, maxBallsAllowed);
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
    // Personality: fewer balls (easier sum) => faster; more balls => slower.
    const speedScale = ENEMY.SPEED_BY_BALLS[digits.length] ?? 1;
    const alien = new Alien(this, {
      x,
      y: -20,
      bodyKey,
      result,
      digits,
      ballTexture: "blueBalls",
      fallSpeed: diff.fallSpeed * speedScale,
      homeSpeed: diff.homeSpeed * speedScale,
    });
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
    // Clear the typed answer once we have committed to a shot, but keep the
    // target LOCKED so it keeps fleeing until a bullet actually destroys it.
    this.setTyped("");
    if (target && target.active) {
      this.lockedTarget = target;
      this.lockedBullet = bullet;
    }

    // If the locked target sits at/below the muzzle, an upward bullet can't
    // reach it, so resolve the hit point-blank to guarantee the kill.
    if (target && target.active && target.y >= this.ship.y - 24) {
      this.onBulletHit(bullet, target);
    }
  }

  private onBulletHit(bullet: Phaser.Physics.Arcade.Sprite, alien: Alien): void {
    if (!alien.active) return;
    bullet.destroy();
    this.killAlien(alien);
  }

  /** Award and clean up a destroyed alien. Shared by bullet hits and by a
   * locked (already-answered) target that flees off the top of the screen. */
  private killAlien(alien: Alien): void {
    if (!alien.active) return;

    const solveMs = this.time.now - alien.spawnedAt;

    // Extend the streak first so this kill is scored with its own multiplier.
    this.combo += 1;
    this.killsThisRun += 1;
    this.bestComboThisRun = Math.max(this.bestComboThisRun, this.combo);
    this.fastestSolveMs = Math.min(this.fastestSolveMs, solveMs);
    this.updateComboText();

    const points = this.computeScore(alien.ballCount, solveMs);

    this.explode(alien.x, alien.y);
    this.addScore(points, alien.x, alien.y);

    this.enemiesInField.delete(alien.result);
    if (this.lockedTarget === alien) {
      this.lockedTarget = null;
      this.lockedBullet = null;
    }
    alien.kill();
  }

  /** points = BASE * ballCountBonus * speedBonus * difficultyMult * comboMult. */
  private computeScore(ballCount: number, solveMs: number): number {
    const ballBonus = SCORE.BALL_COUNT_BONUS[ballCount] ?? 1;

    const span = SCORE.SLOW_MS - SCORE.FAST_MS;
    const t = Phaser.Math.Clamp((solveMs - SCORE.FAST_MS) / span, 0, 1);
    const speedBonus = SCORE.FAST_MULT + (SCORE.SLOW_MULT - SCORE.FAST_MULT) * t;

    const difficultyMult = 1 + difficultyAt(this.elapsedMs, this.score).d;
    const comboMult = Math.min(SCORE.COMBO_MAX, 1 + (this.combo - 1) * SCORE.COMBO_STEP);

    return Math.round(SCORE.BASE * ballBonus * speedBonus * difficultyMult * comboMult);
  }

  private updateComboText(): void {
    if (this.combo >= 2) {
      const mult = Math.min(SCORE.COMBO_MAX, 1 + (this.combo - 1) * SCORE.COMBO_STEP);
      this.comboText.setText(`x${mult.toFixed(2)}  (${this.combo} streak)`);
    } else {
      this.comboText.setText("");
    }
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
    this.combo = 0; // a hit breaks the streak
    this.updateComboText();
    const icon = this.lifeIcons[this.lives];
    if (icon) icon.setAlpha(0.15);
    this.cameras.main.shake(150, 0.01);
    if (this.lives <= 0) {
      this.endGame();
      return;
    }
    // Slow-motion grace window so the player can recover after a hit.
    this.recoveryUntil = this.time.now + RECOVERY.SLOWMO_MS;
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

    // Combo / streak multiplier indicator.
    this.comboText = this.add
      .text(12, 56, "", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffd166",
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
      if (e.key >= "0" && e.key <= "9") this.handleInput(e.key);
      else if (e.key === "Backspace") this.handleInput("<");
      else if (e.key === "Escape") this.handleInput("C");
      else if (e.key === "Enter" && this.gameOver) this.proceedAfterGameOver();
    });
  }

  private handleInput(key: string): void {
    if (this.gameOver) {
      this.proceedAfterGameOver();
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

    // Merge this run into the persistent mastery stats.
    const num = (k: string) => Number(localStorage.getItem(k) ?? 0);
    const priorHigh = num(STORAGE.HIGHSCORE);
    this.newHighScore = this.score > 0 && this.score >= priorHigh;
    const best = Math.max(this.score, priorHigh);
    const bestCombo = Math.max(this.bestComboThisRun, num(STORAGE.BEST_COMBO));
    const totalKills = num(STORAGE.TOTAL_KILLS) + this.killsThisRun;
    const priorFastest = num(STORAGE.FASTEST_MS); // 0 = none recorded yet
    const fastest =
      this.fastestSolveMs === Infinity
        ? priorFastest
        : priorFastest === 0
          ? this.fastestSolveMs
          : Math.min(priorFastest, this.fastestSolveMs);

    localStorage.setItem(STORAGE.HIGHSCORE, String(best));
    localStorage.setItem(STORAGE.BEST_COMBO, String(bestCombo));
    localStorage.setItem(STORAGE.TOTAL_KILLS, String(totalKills));
    localStorage.setItem(STORAGE.FASTEST_MS, String(fastest));

    const rank = RANKS.reduce((acc, r) => (best >= r.min ? r.name : acc), RANKS[0].name);
    const fastestStr = fastest > 0 ? `${(fastest / 1000).toFixed(2)}s` : "—";

    this.add
      .rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, 0x05060f, 0.8)
      .setDepth(10);
    this.add
      .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 110, "GAME OVER", {
        fontFamily: "monospace",
        fontSize: "40px",
        color: "#ef476f",
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 - 60, `Rank: ${rank}`, {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#ffd166",
      })
      .setOrigin(0.5)
      .setDepth(11);
    this.add
      .text(
        GAME.WIDTH / 2,
        GAME.HEIGHT / 2 + 10,
        `Score: ${this.score}    Best: ${best}\n` +
          `Best combo: ${bestCombo}    Kills: ${totalKills}\n` +
          `Fastest solve: ${fastestStr}`,
        { fontFamily: "monospace", fontSize: "16px", color: "#ffffff", align: "center", lineSpacing: 8 },
      )
      .setOrigin(0.5)
      .setDepth(11);
    const continueText = isLeaderboardEnabled()
      ? "tap / Enter to enter initials"
      : "tap / Enter to play again";
    this.add
      .text(GAME.WIDTH / 2, GAME.HEIGHT / 2 + 80, continueText, {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5)
      .setDepth(11);

    this.input.once("pointerdown", () => this.proceedAfterGameOver());
  }

  /** Single, idempotent exit from game-over: leaderboard flow or plain restart. */
  private proceedAfterGameOver(): void {
    if (this.proceeding) return;
    this.proceeding = true;
    if (isLeaderboardEnabled()) {
      this.scene.start("NameEntryScene", {
        score: this.score,
        personalBest: this.newHighScore,
      });
    } else {
      this.scene.restart();
    }
  }
}
