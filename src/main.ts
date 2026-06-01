import Phaser from "phaser";
import { GAME } from "./config/constants";
import BootScene from "./scenes/BootScene";
import GameScene from "./scenes/GameScene";
import NameEntryScene from "./scenes/NameEntryScene";
import LeaderboardScene from "./scenes/LeaderboardScene";

/**
 * Phaser entry point.
 *
 * A Phaser.Game is the root object: it owns the renderer (WebGL, falling back
 * to Canvas), the main loop, the input/audio managers, and a stack of Scenes.
 * We register two scenes here and Phaser runs them in order.
 */
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO, // WebGL if available, else Canvas
  parent: "game",
  width: GAME.WIDTH,
  height: GAME.HEIGHT,
  backgroundColor: GAME.BG_COLOR,
  pixelArt: true, // crisp scaling for our 16px pixel-art sprites
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT, // letterbox to fit the screen, keep aspect ratio
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: { debug: false },
  },
  scene: [BootScene, GameScene, NameEntryScene, LeaderboardScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
