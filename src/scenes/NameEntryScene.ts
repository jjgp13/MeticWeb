import Phaser from "phaser";
import { GAME, LEADERBOARD, STORAGE } from "../config/constants";
import { submitScore } from "../services/leaderboard";

interface NameEntryData {
  score: number;
  /** Whether this run is a new personal best (drives the headline). */
  personalBest?: boolean;
}

/**
 * Classic arcade initials entry. The player first picks how many initials to use
 * (3–6) with a length selector, then sets each slot to A–Z / 0–9 via touch
 * arrows, the on-screen keypad of letters, or the physical keyboard. On confirm
 * it submits to the global leaderboard and hands off to the board.
 */
export default class NameEntryScene extends Phaser.Scene {
  private score = 0;
  private personalBest = false;

  /** Char index per slot, kept at NAME_LEN_MAX so values survive length changes. */
  private slotIdx: number[] = [];
  private nameLen: number = LEADERBOARD.NAME_LEN_DEFAULT;
  private slotText: Phaser.GameObjects.Text[] = [];
  private slotObjects: Phaser.GameObjects.GameObject[] = [];
  private current = 0;
  private highlight!: Phaser.GameObjects.Rectangle;
  private lenLabel!: Phaser.GameObjects.Text;
  private submitting = false;
  private status!: Phaser.GameObjects.Text;

  private readonly slotsRowY = 330;
  private readonly slotSpacing = 64;

  constructor() {
    super("NameEntryScene");
  }

  init(data: NameEntryData): void {
    this.score = data.score ?? 0;
    this.personalBest = Boolean(data.personalBest);
    this.slotIdx = this.defaultInitials();
    this.nameLen = this.defaultLength();
    this.slotText = [];
    this.slotObjects = [];
    this.current = 0;
    this.submitting = false;
  }

  create(): void {
    const cx = GAME.WIDTH / 2;

    this.add
      .text(cx, 90, this.personalBest ? "NEW HIGH SCORE!" : "GAME OVER", {
        fontFamily: "monospace",
        fontSize: "34px",
        color: this.personalBest ? "#ffd166" : "#ef476f",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 140, `Score: ${this.score}`, {
        fontFamily: "monospace",
        fontSize: "20px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.add
      .text(cx, 200, "ENTER YOUR INITIALS", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#4ea1ff",
      })
      .setOrigin(0.5);

    this.buildLengthSelector(cx, 250);

    // Highlight bar under the active slot; repositioned as slots rebuild.
    this.highlight = this.add
      .rectangle(cx, this.slotsRowY + 26, 44, 4, 0xffd166)
      .setOrigin(0.5)
      .setDepth(1);

    this.buildSlots();

    // Confirm button.
    const btn = this.add
      .rectangle(cx, 430, 200, 48, 0x1b2340)
      .setStrokeStyle(2, 0x4ea1ff)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(cx, 430, "CONFIRM", { fontFamily: "monospace", fontSize: "22px", color: "#ffd166" })
      .setOrigin(0.5);
    btn.on("pointerdown", () => this.confirm());

    this.add
      .text(cx, 500, "tap ▲▼ or type · ← → to move · Enter", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#8893b5",
      })
      .setOrigin(0.5);

    this.status = this.add
      .text(cx, 560, "", { fontFamily: "monospace", fontSize: "16px", color: "#ffd166" })
      .setOrigin(0.5);

    this.bindKeyboard();
  }

  // ---------------------------------------------------------------------------
  private buildLengthSelector(cx: number, y: number): void {
    const dec = this.add
      .text(cx - 80, y, "◄", { fontFamily: "monospace", fontSize: "24px", color: "#4ea1ff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    dec.on("pointerdown", () => this.changeLength(-1));

    this.lenLabel = this.add
      .text(cx, y, `LENGTH: ${this.nameLen}`, {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    const inc = this.add
      .text(cx + 80, y, "►", { fontFamily: "monospace", fontSize: "24px", color: "#4ea1ff" })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    inc.on("pointerdown", () => this.changeLength(+1));
  }

  private changeLength(dir: number): void {
    if (this.submitting) return;
    const next = Phaser.Math.Clamp(
      this.nameLen + dir,
      LEADERBOARD.NAME_LEN_MIN,
      LEADERBOARD.NAME_LEN_MAX,
    );
    if (next === this.nameLen) return;
    this.nameLen = next;
    this.lenLabel.setText(`LENGTH: ${this.nameLen}`);
    if (this.current >= this.nameLen) this.current = this.nameLen - 1;
    this.buildSlots();
  }

  /** (Re)build the initials slot row for the current length. */
  private buildSlots(): void {
    this.slotObjects.forEach((o) => o.destroy());
    this.slotObjects = [];
    this.slotText = [];

    const cx = GAME.WIDTH / 2;
    const startX = cx - ((this.nameLen - 1) * this.slotSpacing) / 2;
    const rowY = this.slotsRowY;

    for (let i = 0; i < this.nameLen; i++) {
      const x = startX + i * this.slotSpacing;

      const up = this.add
        .text(x, rowY - 44, "▲", { fontFamily: "monospace", fontSize: "22px", color: "#4ea1ff" })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      up.on("pointerdown", () => {
        this.selectSlot(i);
        this.cycle(i, +1);
      });

      const letter = this.add
        .text(x, rowY, this.charAt(i), {
          fontFamily: "monospace",
          fontSize: "40px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      letter.on("pointerdown", () => this.selectSlot(i));
      this.slotText.push(letter);

      const down = this.add
        .text(x, rowY + 44, "▼", { fontFamily: "monospace", fontSize: "22px", color: "#4ea1ff" })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      down.on("pointerdown", () => {
        this.selectSlot(i);
        this.cycle(i, -1);
      });

      this.slotObjects.push(up, letter, down);
    }

    this.selectSlot(this.current);
  }

  private defaultInitials(): number[] {
    let stored = "";
    try {
      stored = (localStorage.getItem(STORAGE.LAST_NAME) ?? "").toUpperCase();
    } catch {
      stored = "";
    }
    const idx: number[] = [];
    for (let i = 0; i < LEADERBOARD.NAME_LEN_MAX; i++) {
      const c = stored[i] ?? "A";
      const at = LEADERBOARD.CHARSET.indexOf(c);
      idx.push(at >= 0 ? at : 0);
    }
    return idx;
  }

  private defaultLength(): number {
    let len: number = LEADERBOARD.NAME_LEN_DEFAULT;
    try {
      const stored = Number(localStorage.getItem(STORAGE.LAST_LEN));
      if (Number.isFinite(stored) && stored > 0) len = stored;
    } catch {
      // ignore storage failures
    }
    return Phaser.Math.Clamp(len, LEADERBOARD.NAME_LEN_MIN, LEADERBOARD.NAME_LEN_MAX);
  }

  private charAt(slot: number): string {
    return LEADERBOARD.CHARSET[this.slotIdx[slot]];
  }

  private nameString(): string {
    let s = "";
    for (let i = 0; i < this.nameLen; i++) s += this.charAt(i);
    return s;
  }

  private cycle(slot: number, dir: number): void {
    if (this.submitting) return;
    const n = LEADERBOARD.CHARSET.length;
    this.slotIdx[slot] = (this.slotIdx[slot] + dir + n) % n;
    this.slotText[slot].setText(this.charAt(slot));
  }

  private setChar(slot: number, ch: string): void {
    const at = LEADERBOARD.CHARSET.indexOf(ch.toUpperCase());
    if (at < 0) return;
    this.slotIdx[slot] = at;
    this.slotText[slot].setText(this.charAt(slot));
  }

  private selectSlot(slot: number): void {
    this.current = Phaser.Math.Clamp(slot, 0, this.nameLen - 1);
    this.highlight.x = this.slotText[this.current].x;
  }

  private bindKeyboard(): void {
    this.input.keyboard?.on("keydown", (e: KeyboardEvent) => {
      if (this.submitting) return;
      if (e.key === "ArrowLeft") this.selectSlot(this.current - 1);
      else if (e.key === "ArrowRight") this.selectSlot(this.current + 1);
      else if (e.key === "ArrowUp") this.cycle(this.current, +1);
      else if (e.key === "ArrowDown") this.cycle(this.current, -1);
      else if (e.key === "Backspace") this.selectSlot(this.current - 1);
      else if (e.key === "Enter") this.confirm();
      else if (/^[a-zA-Z0-9]$/.test(e.key)) {
        this.setChar(this.current, e.key);
        if (this.current < this.nameLen - 1) this.selectSlot(this.current + 1);
      }
    });
  }

  private confirm(): void {
    if (this.submitting) return;
    this.submitting = true;
    const name = this.nameString();
    try {
      localStorage.setItem(STORAGE.LAST_NAME, name);
      localStorage.setItem(STORAGE.LAST_LEN, String(this.nameLen));
    } catch {
      // Ignore storage failures (private mode / quota); not essential.
    }
    this.status.setText("Submitting…");

    submitScore(name, this.score)
      .then((result) => {
        this.scene.start("LeaderboardScene", {
          playerName: name,
          score: this.score,
          rank: result.rank,
          top: result.top,
          ok: result.ok,
          rowId: result.rowId,
        });
      })
      .catch(() => {
        this.scene.start("LeaderboardScene", {
          playerName: name,
          score: this.score,
          rank: 0,
          top: [],
          ok: false,
        });
      });
  }
}
