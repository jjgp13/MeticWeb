import Phaser from "phaser";
import { GAME, PLAYER } from "../config/constants";

/**
 * Static rules screen reached from the menu. Explains the core loop, controls
 * and scoring, then returns to the menu.
 */
export default class HowToPlayScene extends Phaser.Scene {
  constructor() {
    super("HowToPlayScene");
  }

  create(): void {
    const cx = GAME.WIDTH / 2;

    this.add
      .text(cx, 60, "HOW TO PLAY", {
        fontFamily: "monospace",
        fontSize: "30px",
        color: "#ffd166",
      })
      .setOrigin(0.5);

    const sections: { heading: string; body: string }[] = [
      {
        heading: "GOAL",
        body: "Aliens descend carrying numbered balls.\nStop them before they reach your ship.",
      },
      {
        heading: "HOW TO SHOOT",
        body:
          "Each alien's balls form a SUM. Type that\n" +
          "sum on the keypad or keyboard. Your ship\n" +
          "slides under the matching alien and fires.",
      },
      {
        heading: "STAY ALIVE",
        body:
          `You have ${PLAYER.LIVES} lives. An alien that reaches your\n` +
          "line costs one. Lose all of them and it's\n" +
          "game over.",
      },
      {
        heading: "SCORE BIG",
        body:
          "Solve fast and keep a kill streak for combo\n" +
          "bonuses. Harder sums and later waves pay\n" +
          "more. The board fills with tougher aliens as\n" +
          "your score climbs.",
      },
      {
        heading: "CONTROLS",
        body: "0-9 type · Backspace delete · Esc clear · P pause",
      },
    ];

    let y = 120;
    for (const s of sections) {
      this.add.text(40, y, s.heading, {
        fontFamily: "monospace",
        fontSize: "17px",
        color: "#4ea1ff",
      });
      y += 26;
      this.add.text(40, y, s.body, {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
        lineSpacing: 4,
      });
      y += s.body.split("\n").length * 20 + 16;
    }

    this.makeBackButton(cx, GAME.HEIGHT - 50);
  }

  private makeBackButton(x: number, y: number): void {
    const back = () => this.scene.start("MenuScene");
    const bg = this.add
      .rectangle(x, y, 200, 46, 0x1b2340)
      .setStrokeStyle(2, 0x4ea1ff)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, "BACK", { fontFamily: "monospace", fontSize: "20px", color: "#ffd166" })
      .setOrigin(0.5);
    bg.on("pointerdown", back);
    this.input.keyboard?.once("keydown-ESC", back);
    this.input.keyboard?.once("keydown-ENTER", back);
  }
}
