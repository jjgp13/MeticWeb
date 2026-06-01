import Phaser from "phaser";
import { GAME, LEADERBOARD } from "../config/constants";
import { ScoreRow } from "../services/leaderboard";

interface LeaderboardData {
  playerName: string;
  score: number;
  rank: number;
  top: ScoreRow[];
  ok: boolean;
  rowId?: number;
}

/**
 * Global high-score board shown after initials entry. Renders the top scores,
 * highlights the player's freshly-submitted run, and shows their world rank.
 * Tap or Enter restarts the game.
 */
export default class LeaderboardScene extends Phaser.Scene {
  private result!: LeaderboardData;

  constructor() {
    super("LeaderboardScene");
  }

  init(data: LeaderboardData): void {
    this.result = {
      playerName: data.playerName ?? "",
      score: data.score ?? 0,
      rank: data.rank ?? 0,
      top: data.top ?? [],
      ok: Boolean(data.ok),
      rowId: data.rowId,
    };
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

    this.renderTable(cx);

    this.add
      .text(cx, GAME.HEIGHT - 50, "tap or press Enter to play again", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#8893b5",
      })
      .setOrigin(0.5);

    this.input.once("pointerdown", () => this.restart());
    this.input.keyboard?.once("keydown-ENTER", () => this.restart());
    this.input.keyboard?.once("keydown-SPACE", () => this.restart());
  }

  private renderTable(cx: number): void {
    const rows = this.result.top.slice(0, LEADERBOARD.TOP_N);
    const top = 160;
    const lineH = 24;
    const leftX = cx - 150;
    const rightX = cx + 150;

    if (rows.length === 0) {
      this.add
        .text(cx, top + 40, "No scores yet — be the first!", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#8893b5",
        })
        .setOrigin(0.5);
      return;
    }

    // Highlight the player's freshly-submitted run: by unique row id when we
    // have it, else fall back to the first name+score match.
    let highlighted = false;

    rows.forEach((row, i) => {
      const y = top + i * lineH;
      const isPlayer =
        !highlighted &&
        this.result.ok &&
        (this.result.rowId != null
          ? row.id === this.result.rowId
          : row.name === this.result.playerName && row.score === this.result.score);
      if (isPlayer) highlighted = true;

      const color = isPlayer ? "#ffd166" : "#ffffff";
      const rankStr = `${i + 1}`.padStart(2, " ");

      this.add.text(leftX, y, `${rankStr}. ${row.name}`, {
        fontFamily: "monospace",
        fontSize: "16px",
        color,
      });
      this.add
        .text(rightX, y, `${row.score}`, {
          fontFamily: "monospace",
          fontSize: "16px",
          color,
        })
        .setOrigin(1, 0);
    });
  }

  private restart(): void {
    this.scene.start("GameScene");
  }
}
