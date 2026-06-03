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
    NameEntryScene.ts Arcade 5-char initials entry shown at game over
    LeaderboardScene.ts Global top-N board + the player's world rank
  services/
    leaderboard.ts    Supabase-backed global high scores (submit/getTop/getRank)
  objects/
    Alien.ts          Alien body + number balls; movement driven by `behavior`.
                      Constructed from a single `AlienConfig` object so new
                      per-personality fields (speed, behavior, color) slot in.
  env.d.ts            Types for Vite `import.meta.env` (Supabase env vars)
```

### Global leaderboard & publishing

- **Backend: Supabase** (hosted Postgres). The browser uses `supabase-js`
  directly with the **anon public key** (safe — Row-Level Security + CHECK
  constraints guard the `scores` table). No server to host.
- `scores(id, name varchar(5), score int 0..1_000_000, created_at)`; RLS allows
  anon `SELECT` of all rows and anon `INSERT` only when `name ~ '^[A-Z0-9]{1,5}$'`
  and score is in range. `get_rank(s int)` RPC = `count(*)+1 WHERE score > s`
  (competition ranking; ties share a rank).
- Credentials come from Vite env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (baked in at build, public by design). `isLeaderboardEnabled()` is true only
  when both are present, so the game **builds and runs locally without them** —
  game over just restarts instead of routing to name entry.
- Game-over flow (when enabled): GAME OVER overlay → `NameEntryScene` →
  `submitScore` → `LeaderboardScene` → restart `GameScene`. All three restart
  triggers route through one idempotent `proceedAfterGameOver()`.
- **Hosting: GitHub Pages** via `.github/workflows/deploy.yml` (build on push to
  `main`, deploy `dist`). Supabase env injected from repo **secrets**. Vite
  `base: "./"` keeps asset paths relative so the project subpath works.
- **Mobile:** Phaser `Scale.FIT`+`CENTER_BOTH` (portrait), pointer-based keypad,
  and `index.html` hardening (`viewport-fit=cover` + safe-area insets,
  `touch-action:none`, `overscroll-behavior:none`, no text selection).


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
  a typed number maps to exactly one target. **Personality:** speed scales
  inversely with ball count (`ENEMY.SPEED_BY_BALLS`) — 2-number aliens dart in,
  3+ lumber.
- **Scoring** rewards skill (`SCORE` in constants):
  `BASE × ballCountBonus × speedBonus × difficultyMult × comboMult`, where speed
  bonus decays from solving fast→slow, difficulty = `1 + d`, and the combo
  multiplier grows with an unbroken kill streak (a hit resets it).
- **Mastery stats** persist in `localStorage` (`STORAGE.*`): high score, best
  combo, total kills, fastest solve; a rank (`RANKS`) is shown on game over.
- Aliens fall in **fixed vertical lanes** (no horizontal homing) so sprites and
  numbers never overlap. Spawns reject a lane too close to an existing alien
  (min gap `ENEMY.MIN_SPAWN_GAP`); if no clear lane, the spawn is skipped.
- Ship is input-driven only: it lerps horizontally to the targeted alien's x and
  auto-fires when lined up (`PLAYER.SHOOT_RANGE`, `FIRE_COOLDOWN`). The **active
  target flees upward** while locked (`ENEMY.RETREAT_SPEED`): once its answer is
  typed it runs from the player and cannot cost a life, so a correct answer is
  never punished by the ship's travel time. The target stays **locked
  (`lockedTarget`) until a bullet destroys it** — independent of the typed
  string — so a committed kill keeps fleeing instead of turning back. If a
  fleeing target is at/below the muzzle the shot resolves point-blank.
- **Spawn pacing is board-state-aware, not a blind clock.** Each alien has a
  cognitive-load weight (`ENEMY.THREAT_BY_BALLS`: 2-ball=1, 3-ball=2, 4-ball=3);
  new spawns are withheld while the live total is at/above the difficulty-scaled
  `threatBudget` (3→8), rechecking every `ENEMY.SPAWN_RETRY_MS` (350ms) so the
  screen never floods and a hit stays recoverable. Already-answered (locked,
  fleeing) aliens don't count toward the budget.
- **Concurrent "hard" enemies are capped.** Aliens with
  `≥ ENEMY.HARD_BALL_THRESHOLD` (3) balls are slow multi-number sums; only one
  may be on screen until late game (`DIFFICULTY.SECOND_HARD_AT` = d≥0.85, then
  two), so the player never juggles two multi-number sums at once. When the cap
  is hit the spawn is forced to an easy 2-ball enemy.
- Field is also capped at `maxOnScreen` aliens (difficulty-scaled, 4→8) as an
  absolute safety net; the threat budget is the primary gate and usually binds
  first. Spawns are skipped when no clear lane exists.
- Input: on-screen keypad **and** physical keyboard (0–9, Backspace, Esc).
  Max 2 typed digits.
- HUD (score, lives, difficulty bar, typed display) draws above gameplay
  (`depth 5`) so entering aliens never obscure it.
- High score persisted in `localStorage` (`metic-highscore`).
- **Pause** (`P` key or on-screen `II` button): freezes the field, difficulty
  timer, spawning and firing, and **hides all aliens + their number balls** (and
  the typed display) behind an overlay so the player can't solve sums on a break.
  Tap the overlay or press `P` to resume.
- **Hit recovery**: on losing a life (but not the last) a short slow-motion grace
  window (`RECOVERY.SLOWMO_MS` at `SLOW_FACTOR`) slows the whole field so the
  player can read and answer the next sum and recover.

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
| Max on screen  | 4    | 8    |
| Max balls      | 2    | 3    |
| Max digit      | 3    | 9    |

`MIN_BALLS` is fixed at 2. All knobs live in `src/config/constants.ts`; the
curve is in `src/config/difficulty.ts`.

## Roadmap

1. [x] Core loop (keypad/keyboard input)
2. [x] Static sprites + logistic difficulty ramp + parallax starfield
3. [x] ≥2-number sums + no-overlap lanes
4. [x] Pause (hides field) + slow-mo hit recovery
5. [x] Fair targeting: locked target flees upward; concurrent-alien cap
6. [x] Enemy personality by ball count + skill-based scoring + mastery ranks
7. [ ] **Drifter bonus enemy** — non-lethal alien that crosses horizontally
       (`behavior: "wander"`); spot & solve it for bonus points, no life cost.
       Next up.
8. [ ] **Handwriting input** — draw a digit on a canvas overlay; recognize it as
       the typed number (alongside the keypad).
9. [ ] Other operations (subtraction/multiplication/division) via color-coded balls
10. [ ] Sprite animations + richer explosion/background VFX
11. [x] Leaderboard backend (Supabase) + world leaderboard — 5-char initials at
       game over, world rank, top-N board. **Needs Supabase creds + Pages setup.**
12. [ ] Publish on GitHub Pages (workflow added; enable Pages = "GitHub Actions"
       and add repo secrets `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
13. [ ] PvP multiplayer (Colyseus / WebSockets)

## Conventions

- Keep all tunables in `config/constants.ts`; avoid magic numbers in scenes.
- Comment only non-obvious intent (per repo style).
- Verify changes: `npx tsc --noEmit` and `npm run build` must pass.
- Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

---

## Decision Log

Newest first. Format: `YYYY-MM-DD — decision — rationale`.

- **2026-05-29 — Arcade global leaderboard on Supabase + GitHub Pages.** Game
  over → 5-char initials entry → submit → world rank + top-N board. Browser uses
  `supabase-js` with the public anon key (RLS + CHECK constraints protect the
  `scores` table; score capped at 1,000,000). Frontend degrades gracefully when
  creds are absent. Hosting via a Pages Action; `index.html` hardened for mobile.
- **2026-05-29 — Board-aware spawn pacing + hard-enemy cap.** Spawns are gated by
  a weighted cognitive-load budget (`THREAT_BY_BALLS`/`threatBudget`) instead of a
  blind timer, and at most one multi-number "hard" enemy appears until late game
  (`SECOND_HARD_AT`). Fixes difficulty spikes/flooding once 2- and 3-number
  enemies mixed; load now stays bounded and recoverable.
- **2026-05-29 — Lock the fired target until destroyed.** Clearing the typed
  answer on fire used to drop the target, so a committed alien stopped fleeing
  and advanced again mid-flight. A persistent `lockedTarget` keeps it retreating
  until the bullet actually hits it.

- **2026-05-29 — Enemy personality by ball count + skill-based scoring + mastery
  stats.** Speed scales inversely with ball count (easy 2-number sums dart in,
  hard 3+ lumber). Score = `BASE × ballCount × speed × difficulty × combo` so
  fast, hard, late, streak play pays more. Persistent mastery (best combo, kills,
  fastest solve) yields a rank on game over — progression feedback without
  altering difficulty. (Drifter bonus enemy + handwriting still to come.)

- **2026-05-29 — Keep only slow-mo recovery; refactor Alien for personalities.**
  Slow-mo was the chosen recovery feel, so the pushback/clear/slowmo_push modes
  and the M toggle were removed. `Alien` now takes an `AlienConfig` object and a
  `behavior` field (`descend` today) with a `ballCount` getter, so enemy
  personalities and new types can be added without reworking the scene.

- **2026-05-29 — Locked target flees upward instead of freezing.** A correctly
  answered alien now turns and runs from the player (`RETREAT_SPEED`) rather than
  stopping in place — reads as "running away" and still gives the ship time to
  line up the shot fairly.
- **2026-05-28 — Freeze the locked target + cap on-screen aliens.** A correct
  answer was unfairly punished because the target kept falling while the ship
  slid over; now the target freezes (and can't cost a life) once typed, the ship
  slides faster (`MOVE_LERP` 0.12→0.22), and the field is capped (4→8) so it
  can't over-populate into an unrecoverable state. Point-blank shot resolves a
  target frozen at the muzzle.

- **2026-05-28 — Pause hides the field.** A pause (P / button) freezes everything
  and hides aliens + numbers so the player can rest without solving sums on break.
- **2026-05-28 — Hit-recovery grace, mode-switchable for playtesting.** Losing a
  life on a crowded screen death-spirals; give breathing room. Four modes
  (slowmo / slowmo_push / pushback / clear) are cyclable at runtime via `M` so the
  best feel can be chosen by playing; default `slowmo`.

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
