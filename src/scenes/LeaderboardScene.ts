import Phaser from "phaser";
import { GAME, LEADERBOARD } from "../config/constants";
import { ScoreRow, getTop, isLeaderboardEnabled } from "../services/leaderboard";

interface LeaderboardData {
  /** When true the scene was opened from the menu to browse the board, so it
   * fetches the top scores itself and offers BACK instead of "play again". */
  browse?: boolean;
  playerName?: string;
  score?: number;
  rank?: number;
  top?: ScoreRow[];
  ok?: boolean;
  rowId?: number;
}

/**
 * Global high-score board. Two modes:
 *   - post-run  (from NameEntryScene): highlights the player's submitted run and
 *     shows their world rank; tap/Enter returns to the menu.
 *   - browse    (from MenuScene): fetches and shows the top scores; BACK returns
 *     to the menu.
 */
export default class LeaderboardScene extends Phaser.Scene {
  private result!: {
    browse: boolean;
    playerName: string;
    score: number;
    rank: number;
    top: ScoreRow[];
    ok: boolean;
    rowId?: number;
  };
  private rowObjects: Phaser.GameObjects.Text[] = [];

  constructor() {
    super("LeaderboardScene");
  }

  init(data: LeaderboardData): void {
    this.result = {
      browse: Boolean(data.browse),
      playerName: data.playerName ?? "",
      score: data.score ?? 0,
      rank: data.rank ?? 0,
      top: data.top ?? [],
      ok: Boolean(data.ok),
      rowId: data.rowId,
    };
    this.rowObjects = [];
  }

  create(): void {
    const cx = GAME.WIDTH / 2;

    this.add
      .text(cx, 70, "HIGH SCORES", {
        fontFamily: "monospace",
        fontSize: "30px",
        color: "#ffd166",
      })
      .setOrigin(0.5);

    if (!this.result.browse) {
      if (this.result.ok && this.result.rank > 0) {
        this.add
          .text(cx, 112, `YOUR RANK: #${this.result.rank}`, {
            fontFamily: "monospace",
            fontSize: "18px",
            color: "#4ea1ff",
          })
          .setOrigin(0.5);
      } else if (!this.result.ok) {
        this.add
          .text(cx, 112, "Offline — score not saved", {
            fontFamily: "monospace",
            fontSize: "14px",
            color: "#8893b5",
          })
          .setOrigin(0.5);
      }
    }

    if (this.result.browse) {
      // Browsing from the menu: fetch the board ourselves.
      if (!isLeaderboardEnabled()) {
        this.add
          .text(cx, 200, "Leaderboard unavailable", {
            fontFamily: "monospace",
            fontSize: "16px",
            color: "#8893b5",
          })
          .setOrigin(0.5);
      } else {
        const loading = this.add
          .text(cx, 200, "Loading…", {
            fontFamily: "monospace",
            fontSize: "16px",
            color: "#8893b5",
          })
          .setOrigin(0.5);
        getTop()
          .then((rows) => {
            loading.destroy();
            this.result.top = rows;
            this.renderTable(cx);
          })
          .catch(() => loading.setText("Could not load scores"));
      }
    } else {
      this.renderTable(cx);
    }

    const label = this.result.browse ? "BACK" : "tap or press Enter to continue";
    this.add
      .text(cx, GAME.HEIGHT - 50, label, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#8893b5",
      })
      .setOrigin(0.5);

    // Both modes return to the menu.
    this.input.keyboard?.once("keydown-ENTER", () => this.toMenu());
    this.input.keyboard?.once("keydown-ESC", () => this.toMenu());
    this.input.keyboard?.once("keydown-SPACE", () => this.toMenu());
    // Defer the pointer handler a beat so the tap that opened this scene doesn't
    // immediately dismiss it.
    this.time.delayedCall(250, () => {
      this.input.once("pointerdown", () => this.toMenu());
    });
  }

  private renderTable(cx: number): void {
    this.rowObjects.forEach((o) => o.destroy());
    this.rowObjects = [];

    const rows = this.result.top.slice(0, LEADERBOARD.TOP_N);
    const top = 160;
    const lineH = 24;
    const leftX = cx - 150;
    const rightX = cx + 150;

    if (rows.length === 0) {
      this.rowObjects.push(
        this.add
          .text(cx, top + 40, "No scores yet — be the first!", {
            fontFamily: "monospace",
            fontSize: "16px",
            color: "#8893b5",
          })
          .setOrigin(0.5),
      );
      return;
    }

    // Highlight the player's freshly-submitted run (post-run mode only): by
    // unique row id when we have it, else the first name+score match.
    let highlighted = false;

    rows.forEach((row, i) => {
      const y = top + i * lineH;
      const isPlayer =
        !this.result.browse &&
        !highlighted &&
        this.result.ok &&
        (this.result.rowId != null
          ? row.id === this.result.rowId
          : row.name === this.result.playerName && row.score === this.result.score);
      if (isPlayer) highlighted = true;

      const color = isPlayer ? "#ffd166" : "#ffffff";
      const rankStr = `${i + 1}`.padStart(2, " ");

      this.rowObjects.push(
        this.add.text(leftX, y, `${rankStr}. ${row.name}`, {
          fontFamily: "monospace",
          fontSize: "16px",
          color,
        }),
      );
      this.rowObjects.push(
        this.add
          .text(rightX, y, `${row.score}`, {
            fontFamily: "monospace",
            fontSize: "16px",
            color,
          })
          .setOrigin(1, 0),
      );
    });
  }

  private toMenu(): void {
    this.scene.start("MenuScene");
  }
}
