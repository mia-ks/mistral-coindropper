# Reverse-engineering pipeline (Coins Clicker : Idle Collector, com.deadpixel.coinsclickercollector.game)

The XAPK/APK is **not** committed (copyright). To regenerate all extracted data from your own copy:

1. Place the XAPK as `re/game.xapk` (or an extracted `apk/` + asset bundles the loader expects) and
   `pip install UnityPy androguard`.
2. `python3 re/dump_all.py` / `dump_hier.py` / `dump_world2.py` / `gen_layouts.py` -> `re/dump/levels_final.json`,
   `level_visual.json` (hierarchy-resolved world transforms, per-machine params, camera bounds, colliders).
3. `python3 re/export_meshes.py` -> `re/dump/level_meshes.json`, `meshes_global.json`, `materials.json`
   (real mesh vertices/normals/UVs + textures as data URLs + per-submesh material ids, handedness-mirrored).
4. `python3 re/gen_js2.py` -> `js/level_layouts.js`, `js/meshlib.js`, `test/fixture-levels.json`.

`js/meshlib.js` and the `meshData` in `js/level_layouts.js` are GENERATED from the game's assets.
If you prefer not to distribute the original geometry publicly, gitignore those two generated files
and run step 4 locally; the raw APK stays out of the repo either way.

See `re/ANALYSIS.md` for the full adware/tracking inventory and extracted game rules.
