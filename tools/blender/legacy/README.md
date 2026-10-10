# Legacy runtime assets (moved out of `public/`)

Not loaded by the game and not shipped in `dist/`. Kept because source code and tests still read them:

| File | Why it stays | Read by |
|---|---|---|
| `npc.glb` | NPC v1 template: `chunkyPeople.buildTemplate` is still shared by Skirmish and Valley | `tests/town-v3-assets.test.js` |
| `character.glb` | the old rig that `people/peopleRig.js` builds from | `tests/town-controls.test.js` |
| `interior_atlas.jpg` | floor and wall tiles; interiors have drawn their floors and walls in code since 30 September | nothing |

Moved on 10 October 2026 (M3-E1 part d): `ASSET_FILES` listed them, but no module loaded them (checked: no `ASSETS.npcPack`, `ASSETS.characterPack` or `ASSETS.interiorAtlas` use, no dynamic indexing of the manifest). Together 1.98 MB less in `dist/`. `build_town_space.py` still writes `character.glb` and `interior_atlas.jpg` to `public/` when it is run; move them again or stop exporting them.
