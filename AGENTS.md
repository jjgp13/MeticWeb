# AGENTS.md — MeticWeb

Project context and working agreement for any AI agent (or human) picking up
**MeticWeb**. Read this first; it is the source of truth for architecture and
design decisions.

> **Self-updating rule (IMPORTANT):** Whenever a **game design or architectural
> decision** is made or changed in a session, you MUST update this file in the
> same change:
> 1. Append a dated entry to the **Decision Log** at the bottom.
> 2. Update any affected section above (Gameplay, Difficulty, Assets, Roadmap…).
> 3. Commit the `AGENTS.md` update alongside the code change.
> Keep entries terse (1–3 lines). This keeps context portable across machines
> and sessions.

---

## What MeticWeb is

A web rewrite of **Metic**, a 2D math-shooter originally built in Unity
(`https://github.com/jjgp13/Metic`). Aliens descend carrying numbered balls; the
player types the **sum** of an alien's balls (on-screen keypad or keyboard) and
the ship slides under the matching alien and auto-fires. Reaching the player
line costs a life; lose all 3 → game over.

The web rewrite was chosen over staying in Unity to get: instant browser load,
mobile reach, native handwriting input, easy WebSocket PvP, and a fast feedback
loop. See the Decision Log.

## Tech stack

- **Phaser 3** — full 2D engine (WebGL/Canvas renderer + arcade physics + input
  + audio + asset loader + scenes). Chosen over raw PixiJS, which is *only* a
  renderer.
- **Vite** — dev server (HMR) + production bundler.
- **TypeScript** — strict mode.
- Node.js LTS required. `npm install` → `npm run dev` (port 5173) → `npm run build`.

## Project layout

```
public/assets/        Game art/audio/fonts (reused verbatim from the Unity repo)
  sprites/  sounds/  fonts/
src/
  main.ts             Phaser.Game config + scene registration
  config/
    constants.ts      All tunable gameplay/layout values
    difficulty.ts     Logistic difficulty curve
  scenes/
    BootScene.ts      Preloads assets; defers animations (static frames for now)
    GameScene.ts      The core loop: spawn, input, targeting, combat, HUD
  objects/
    Alien.ts          Alien body sprite + its number balls + lane-fall movement
```

### How assets are imported

Art lives in `public/`, which Vite serves verbatim at the site root, so it is
referenced by **URL string** (`assets/sprites/...`) in `BootScene.preload()` —
no JS `import`. Spritesheets are sliced by frame size. **Verified layouts**
(important — these were wrong initially):

| Asset                    | Frame size | Frames | Notes                              |
| ------------------------ | ---------- | ------ | ---------------------------------- |
| `Alien1-9.png`           | 16×16      | 2      | idle animation (use frame 0 now)   |
| `Alien10-13.png`         | 32×20      | 2 (vertical) | idle animation (frame 0 now)  |
| `SpaceShip.png`          | 16×16      | 4 (2×2 grid) | use frame 0                  |
| `bullet.png`             | 16×32      | 2      | use frame 0                        |
| `BlueBalls.png` (+Red/Green/Yellow) | 16×16 | 16-cell grid | **number N = frame N-1** |
| `SpaceShipLifeIcon.png`  | 16×16      | 1      | HUD life icon                      |
| `star.png`               | 16×16      | 1      | starfield particle                 |

Ball **color encodes the math operation** (future): Blue=sum, Red=subtraction,
Green=multiplication, Yellow=division.

## Gameplay rules (current)

- Each alien carries **≥ 2 number balls** (a sum needs two numbers); `result` =
  sum of the balls. `enemiesInField: Map<result, Alien>` keeps results unique so
  a typed number maps to exactly one target.
- Aliens fall in **fixed vertical lanes** (no horizontal homing) so sprites and
  numbers never overlap. Spawns reject a lane too close to an existing alien
  (min gap `ENEMY.MIN_SPAWN_GAP`); if no clear lane, the spawn is skipped.
- Ship is input-driven only: it lerps horizontally to the targeted alien's x and
  auto-fires when lined up (`PLAYER.SHOOT_RANGE`, `FIRE_COOLDOWN`).
- Input: on-screen keypad **and** physical keyboard (0–9, Backspace, Esc).
  Max 2 typed digits.
- HUD (score, lives, difficulty bar, typed display) draws above gameplay
  (`depth 5`) so entering aliens never obscure it.
- High score persisted in `localStorage` (`metic-highscore`).

## Difficulty design

Difficulty is a normalized value `d(t) ∈ [0,1)` from a **logistic (sigmoid)**
curve of elapsed time — chosen for a gentle warm-up, smooth mid-game ramp, and a
plateau (hard but never impossible):

```
d(t) = 1 / (1 + e^(-k · (t - t0)))
```

`t` = seconds, `t0` = `DIFFICULTY.MIDPOINT` (50s, where d=0.5), `k` =
`DIFFICULTY.STEEPNESS` (0.055). Every concrete parameter is then
`easy + (hard - easy)·d`:

| Parameter      | easy | hard |
| -------------- | ---- | ---- |
| Fall speed     | 28   | 110 px/s |
| Home speed     | 45   | 150 px/s (speed-up below `HOME_TRIGGER_Y`) |
| Spawn interval | 2200 | 650 ms |
| Max balls      | 2    | 3    |
| Max digit      | 3    | 9    |

`MIN_BALLS` is fixed at 2. All knobs live in `src/config/constants.ts`; the
curve is in `src/config/difficulty.ts`.

## Roadmap

1. [x] Core loop (keypad/keyboard input)
2. [x] Static sprites + logistic difficulty ramp + parallax starfield
3. [x] ≥2-number sums + no-overlap lanes
4. [ ] **Handwriting input** — draw a digit on a canvas overlay; recognize it as
       the typed number (alongside the keypad). Next up.
5. [ ] Other operations (subtraction/multiplication/division) via color-coded balls
6. [ ] Sprite animations + richer explosion/background VFX
7. [ ] Leaderboard backend (Supabase or Firebase) + world leaderboard
8. [ ] PvP multiplayer (Colyseus / WebSockets)

## Conventions

- Keep all tunables in `config/constants.ts`; avoid magic numbers in scenes.
- Comment only non-obvious intent (per repo style).
- Verify changes: `npx tsc --noEmit` and `npm run build` must pass.
- Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## Decision Log

Newest first. Format: `YYYY-MM-DD — decision — rationale`.

- **2026-05-28 — Add self-updating AGENTS.md.** Capture architecture, difficulty,
  asset layouts, and roadmap so context is portable across machines/sessions.
- **2026-05-28 — Aliens carry ≥2 balls and fall in fixed lanes.** A sum needs two
  numbers; lane-based falling (no homing) stops aliens/numbers from overlapping
  and becoming unreadable. Spawns skip if no clear lane.
- **2026-05-28 — Logistic difficulty ramp.** Sigmoid `d(t)` gives a warm-up, a
  smooth ramp, and a plateau; drives speed, spawn rate, ball count and digit size.
- **2026-05-28 — Static sprites, animations deferred.** Initial frame slicing was
  on the wrong axis; verified real layouts and show single frames for now.
- **2026-05-28 — Replace tiled background with sparse parallax starfield.** Tiling
  `star.png` looked like an ugly diamond grid.
- **2026-05-28 — Adopt Phaser 3 + Vite + TS; rewrite from Unity.** Better web load
  time, mobile support, native handwriting/WebSocket paths, fast iteration.
