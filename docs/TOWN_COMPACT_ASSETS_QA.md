# Town compact + asset refresh — QA

Verified 7 October 2026. Town layout v5 halves city area, reduces individual trees, and replaces the architecture and streetscape assets for both eras. Human, vehicle, building and road widths retain their normal scale. The existing painted materials, lighting, spatial vegetation budgets and adaptive LOD remain active.

## Visual direction and preview

Modern architecture uses composed volumes, framed windows, shopfronts, balconies, cornices and roof equipment. Fantasy retains timber, masonry, pitched roofs, chimneys and dormers. The original procedural models take visual cues from the modern city compositions in [EA's SimCity 4 gallery](https://www.ea.com/de/games/simcity/simcity-4) and the painted 3D environment in [SEGA's Valkyria Chronicles 4 CANVAS reference](https://portal.valkyria.jp/vc4/system/inner.html?page=canvas).

- Asset galleries: [modern](../artifacts/town-refresh/gallery-modern.png), [fantasy](../artifacts/town-refresh/gallery-fantasy.png), [support props](../artifacts/town-refresh/gallery-props.png).
- Runtime: [modern town](../artifacts/town-refresh/after-modern-diorama.png), [fantasy town](../artifacts/town-refresh/after-fantasy-diorama.png), [modern walking](../artifacts/town-refresh/after-modern-walk.png), [modern night](../artifacts/town-refresh/after-modern-night.png), [fantasy walking](../artifacts/town-refresh/after-fantasy-walk.png).

Gallery assets are normalized in size for inspection; towns use the normal world dimensions. The archived before screenshots use different fixtures and are not a matched visual comparison.

## Area and object counts

The linear town projection and city radius use `Math.SQRT1_2`. Across all six deterministic fixtures, `cityR²` is exactly 50% of v4 within floating-point precision. The diorama disc is 49.83–50.06% because its radius rounds to whole meters. The planner removes blocks instead of scaling each model.

These counts use actual runtime parcel footprints, `hexasphere(3, 10)`, terran terrain, variant 0 and density 1. Browser measurements below use a separate, larger world fixture. Individual trees mean trunk assets, excluding flowers, ground cover and forest billboards.

| Seed | Era | Buildings v4 → v5 | Individual trees v4 → v5 | Props v4 → v5 | Colliders v4 → v5 |
|---|---|---:|---:|---:|---:|
| 17 | Fantasy | 292 → 131 | 3,588 → 1,104 | 198 → 77 | 4,275 → 1,507 |
| 17 | Modern | 39 → 14 | 3,566 → 1,067 | 74 → 39 | 3,800 → 1,266 |
| 427 | Fantasy | 212 → 81 | 1,992 → 543 | 109 → 69 | 2,476 → 849 |
| 427 | Modern | 90 → 43 | 4,529 → 1,330 | 210 → 95 | 4,942 → 1,583 |
| 8191 | Fantasy | 548 → 232 | 3,310 → 928 | 219 → 106 | 4,212 → 1,382 |
| 8191 | Modern | 26 → 14 | 3,640 → 1,160 | 61 → 35 | 3,757 → 1,265 |

Individual trees and their colliders decrease by **68.1–72.7%**. Density 0.75 / 1 / 1.3 and variant 7 remain nonempty; primary street topology stays stable while quay connections adapt to occupied lots. Full evidence: [generation-counts.json](../artifacts/town-refresh/generation-counts.json).

## Asset and LOD contracts

`town.glb` contains 107 roots, 112 materials and 178,258 triangles across all LODs; file size is 2,613,964 bytes. All original 99 root IDs remain. The refresh replaces 28 building variants across 16 families and 15 support variants: 84 building meshes plus 45 prop meshes.

| Rebuilt catalogue | LOD0 triangles | LOD1 triangles | LOD2 triangles |
|---|---:|---:|---:|
| Buildings | 94,400 | 24,992 | 3,918 |
| Support props | 14,420 | 3,400 | 1,848 |

Building LOD2 uses **4.15%** of LOD0 geometry. It retains the mass and roof silhouette while near LODs supply facade framing, railings and fittings. Triangle counts describe the catalogue, not the number submitted in every frame.

The validator checks finite coordinates and zero degenerate triangles in all 129 rebuilt meshes. The 64 untouched roots preserve original transforms, materials, accessors and position/index payloads. Rebuilt original roots retain exact `layoutFootprint` metadata; new prop geometry is excluded from parcel inference. The entire runtime table of 69 footprint families matches the old pack, preserving saved layout generation. Refreshed bench and fence assets take precedence over older scenery/environment fallbacks, and legacy facade refinements do not double up on the new models.

Editable source and rebuild instructions: [town generator README](../tools/blender/town/README.md), [town_refresh_assets.blend](../tools/blender/town_refresh_assets.blend), [refresh manifest](../tools/blender/town/refresh_manifest.json).

## Browser performance

Chrome / ANGLE Metal on **Apple M1 Pro**, CSS viewport 1280×800, DPR 2, drawing buffer **2560×1600**, automatic quality. World seed 282657, planet 1, city 0 fantasy / city 1 modern. Each motion sample holds forward input and records real displacement. Adaptive LOD, shadow and vegetation budget factors remained 1 in these samples.

| Scene | Frames | Average FPS | Frame time p95 | Movement | Evidence |
|---|---:|---:|---:|---:|---|
| Modern walk, final runtime | 300 | 60.02 | 17.8 ms | 12.38 m | [JSON](../artifacts/town-refresh/final-modern-walk.json) |
| Modern drive | 300 | 60.10 | 25.3 ms | 83.92 m | [JSON](../artifacts/town-refresh/modern-drive.json) |
| Modern night | 300 | 60.01 | 18.5 ms | — | [JSON](../artifacts/town-refresh/modern-night.json) |
| Fantasy walk | 300 | 60.00 | 24.1 ms | 12.38 m | [JSON](../artifacts/town-refresh/fantasy-walk.json) |
| Fantasy diorama | 240 | 60.00 | 25.3 ms | — | [JSON](../artifacts/town-refresh/fantasy-diorama.json) |

The final walk sample runs after the last bench/fence resolution and footprint fixes: 34 buildings, 641 individual trees, about 490 draw calls and 869k submitted triangles per frame, CPU p95 4.0 ms. Earlier scene samples preceded those small resolution fixes. No renderer exception or browser console error/warning was observed in the final check.

These are short samples after startup/shader warmup, not a long endurance test or a guarantee for every seed and device. Some p95 frames exceed the 16.67 ms target despite averages near 60 FPS. The adaptive quality system remains available when frame pressure rises.

## Save and interaction regressions

- Unprotected saved towns migrate to v5 while retaining the selected variant and density. Existing authored homes or interior records pin their associated original/variant layout to its old version; they receive the new visual assets without moving stored buildings.
- Legacy v1–v4 generator fingerprints remain unchanged. A simulated saved v4 town rendered 387 buildings with exact coordinate/ID preservation and refreshed models; [runtime-regression.json](../artifacts/town-refresh/runtime-regression.json) records this check.
- Entering, changing floors and exiting fantasy and modern interiors succeeded; the recorded modern office reaches floor 1 without an engine error.
- V5 removes decorative trees/props and their colliders from door approach corridors. Regression fixtures cover the previously blocked modern cafe and fantasy lamp approaches without changing building/street IDs or consuming layout RNG.

## Verification and reproduction

`npm test`: **148 passed, 0 failed, 0 skipped**. `npm run build`: passed, 159 modules, 6.24 s. Export integrity checks and the Blender support-prop contract also passed.

For visual inspection on the running local app, use a disposable browser context and import `/tools/qa/town_refresh_browser.js`. `townAssetGallery({ kind: 'modern' | 'fantasy' | 'props', lod: 0 })` opens a catalogue; `window.__townAssetGallery.restore()` returns to the town. `townRefreshProfile({ modern: true, view: 'walk', motion: true, frames: 300 })` records a moving sample. These helpers are QA tools and add no product UI.
