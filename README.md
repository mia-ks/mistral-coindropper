# mistral-coindropper

# Coin Dozer — Clean Edition

An original, ad-free reimplementation of the coin-pusher idle game
*Coins Clicker : Idle Collector* (`com.deadpixel.coinsclickercollector.game`, v1.0.11).

Everything here is original code and original vector art drawn on a `<canvas>`.
No assets, code, or text were copied from the original APK; the original's
mechanics and tuning numbers were used only as a design reference (see
`re/ANALYSIS.md` for the reverse-engineering notes).

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

- **Tap/click the machine** to drop a coin where you tapped.
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

Open `index.html` in any modern browser, or serve the folder:

```
python3 -m http.server 8000
# then http://localhost:8000
```

No build step, no dependencies, no network.

## Tests

```
node test/run-tests.js   # 14 unit/integration tests (config, economy, physics, save)
node test/smoke.js       # headless full-loop smoke test with stubbed DOM/canvas
```

## Files

- `js/config.js` — all tuning data: coin table, 19 level layouts, upgrade tree
- `js/engine.js` — 2D physics: coin stacking, pusher, machine zones (pure, node-testable)
- `js/game.js` — game state, economy, combo, save/load, offline earnings
- `js/render.js` — canvas rendering (original vector art)
- `js/audio.js` — WebAudio sound effects (generated, no files)
- `js/main.js` — input, HUD, upgrade panel, main loop
- `index.html`, `css/style.css`
