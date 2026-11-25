# mistral-coindropper

# Coin Dozer — Clean Edition (3D)

An original, ad-free **3D** reimplementation of the coin-pusher idle game
*Coins Clicker : Idle Collector* (`com.deadpixel.coinsclickercollector.game`, v1.0.11),
rendered with Three.js (vendored in `js/vendor/`, MIT) and custom 3D physics:
coins are flat discs — same-layer contacts collide as circles in the x–z plane,
stacked coins rest face-to-face in y.

Everything here is original code and original procedurally-built 3D/2D art.
No assets, code, or text were copied from the original APK; the original's
mechanics, tuning numbers and per-level machine layouts were used only as a
design reference (see `re/ANALYSIS.md` for the reverse-engineering notes).

## What's different from the original (the "not adware" part)

The original ships 70+ ad-network activities (AppLovin MAX, IronSource, Bigo,
Smaato, InMobi, Yandex, Moloco, Mintegral, Fyber, Vungle, BidMachine, Pangle,
Facebook Audience Network, AdMob, Unity Ads), requests the `AD_ID` /
`ACCESS_ADSERVICES_*` permissions, bundles Firebase Analytics + AppMetrica +
GameAnalytics + Adjust, forces interstitial "ad breaks" (`AdBreakService`),
gates upgrades/gems behind rewarded video, sells a "Remove Ads" IAP, and
requires internet. See `re/ANALYSIS.md`.

This version:

- **No ads, ever.** No ad SDK, no interstitials, no rewarded video.
- **No tracking.** No analytics, no network requests of any kind — the game
  is a static page and works fully offline.
- **No purchases.** No IAP, no "remove ads" upsell, no shop pressure.
- **No dark patterns.** No forced breaks, no fake timers, no rate-us popups.
- **Your data stays yours.** Progress is saved to `localStorage` on your
  device only; there is a reset button in the HUD.

## How to play

- **Click the machine** to drop a coin at that spot on the platform.
- Drops are limited by **charges** (15 max, refill 1 per 2 s — upgradeable).
- Coins are pushed by the **pusher**, moved by **conveyors**, lifted by
  **air blowers**, pulled by **magnets**, hopped by **launchers**, doubled by
  **x2 gates**, cashed at **$ gates**, teleported by **portals** — and anything
  pushed off the front edge lands in the **collector**.
- Fill the **progress bar** (100 value per stage) to complete the stage and
  unlock the next of **19 stages** with new machine layouts.
- **Coins**: bronze (2, common), silver (5), gold (10). **Gems** (◆) drop
  periodically and buy machine/pusher upgrades. **$ cash** from cash gates buys
  a board **shake**.
- **Combo**: collecting coins in quick succession builds a multiplier.
- **Auto dropper**, **capacity**, **faster refill**, **coin value** and
  **combo** upgrades in the upgrade panel (⬆).
- Earnings continue while you're away (offline progress, capped at 8 h).

## Run it

Serve the folder (ES modules need http, not file://):

```
python3 -m http.server 8000
# then http://localhost:8000
```

No build step, no runtime dependencies (Three.js is vendored), no network.

## Tests

```
node test/run-tests.js       # 14 unit/integration tests (config, economy, 3D disc-stacking physics, save)
node test/smoke.js           # headless full-loop simulation
node test/render3d.test.mjs  # builds the Three.js scene graph for level 19 and checks it
```

## Files

- `js/config.js` — all tuning data: coin table, upgrade tree, world dimensions
- `js/level_layouts.js` — 19 level layouts generated from the APK's extracted 3D machine positions
- `js/engine.js` — 3D disc-coin physics: pusher, stacking, machine zones (pure, node-testable)
- `js/game.js` — game state, economy, combo, save/load, offline earnings
- `js/render.js` — Three.js renderer (original procedural models; receives `THREE` as a param so it stays node-testable)
- `js/vendor/three.module.js` — Three.js r170, MIT (`js/vendor/THREE-LICENSE.md`)
- `js/audio.js` — WebAudio sound effects (generated, no files)
- `js/main.js` — input (raycast picking), HUD, upgrade panel, main loop (ES module)
- `index.html`, `css/style.css`
