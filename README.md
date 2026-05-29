# MeticWeb

Web rewrite of **Metic**, a 2D math-shooter, using **Phaser 3 + TypeScript + Vite**.
Ported from the original Unity project.

## Gameplay

Aliens descend carrying numbered balls. Each alien's target number is the **sum**
of its balls. Type that number (on-screen keypad or your keyboard) and your ship
slides under the matching alien and auto-fires. Let one reach your ship and you
lose a life — lose all three and it's game over.

## Tech

- **[Phaser 3](https://phaser.io/)** — full 2D game engine: WebGL/Canvas renderer,
  arcade physics, input, audio and an asset loader. (Pixi.js, by contrast, is *only*
  a renderer, so Phaser saves us wiring those systems ourselves.)
- **[Vite](https://vitejs.dev/)** — dev server with hot-reload + production bundler.
- **TypeScript** — typed game logic.

## Project layout

```
public/assets/        Game art, audio and fonts (reused from the Unity repo)
  sprites/            16px pixel-art spritesheets
  sounds/             sfx (.wav)
  fonts/              Kenney pixel fonts
src/
  main.ts             Phaser.Game config + scene registration
  config/constants.ts Tunable gameplay/layout values
  scenes/
    BootScene.ts      Preloads assets, builds animations
    GameScene.ts      The core loop (spawn, input, targeting, combat, HUD)
  objects/
    Alien.ts          Alien body + its numbered balls + movement
```

### How assets are imported

Art lives in `public/`, which Vite serves verbatim at the site root, so it is
referenced by URL (`assets/sprites/...`) in `BootScene.preload()` — no `import`
needed. Spritesheets are sliced by frame size:

| Asset                    | Frame      | Notes                          |
| ------------------------ | ---------- | ------------------------------ |
| `Alien1-9.png`           | 16×16, 2f  | idle animation                 |
| `Alien10-13.png`         | 16×40, 2f  | idle animation                 |
| `SpaceShip.png`          | 16×32, 2f  | thruster animation             |
| `bullet.png`             | 16×32, 2f  | bullet animation               |
| `BlueBalls.png` (+R/G/Y) | 16×16 grid | number N = frame N-1; color    |
|                          |            | will map to a math operation   |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build to dist/
```

## Roadmap

1. [x] Core loop (keypad/keyboard input)
2. [ ] Handwriting input mode (canvas strokes + recognizer)
3. [ ] Subtraction / multiplication / division (color-coded balls)
4. [ ] Leaderboard backend (Supabase / Firebase)
5. [ ] PvP multiplayer (Colyseus / WebSockets)
