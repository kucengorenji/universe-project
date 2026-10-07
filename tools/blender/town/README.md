# Town architecture refresh

Revision 1 replaces all 16 building families, 28 variants and their 84 LOD
meshes. Fantasy retains pitched roofs, masonry, timber framing and working
street entrances. Modern uses composed volumes, recessed framed windows,
storefronts, balconies, cornices, stepped crowns and roof service equipment.
The restrained material palette is compatible with the runtime painted style.

`buildings.py` contains the editable architectural formulas;
`support_props.py` contains 15 streetscape variants. The complete editable
catalogue is `../town_refresh_assets.blend`. Exported runtime geometry is
`../../../public/models/town.glb`.

From the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/build_town_refresh.py
node --test tests/town-refresh-assets.test.js
python3 tools/blender/town/validate_refresh.py /private/tmp/town-before-refresh.glb public/models/town.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/town/test_support_props.py
```

The generator stages the GLB before atomically replacing town.glb. It never
exports space, character, furniture or the interior atlas. On first use it
copies the current town pack to `/private/tmp/town-before-refresh.glb`; set
`TOWN_REFRESH_BASELINE` to an explicit backup path for another checkout.
`GLOBE_ROOT` selects a different repository location.

Untouched original assets are merged from their original buffers. Verification
compares their node transforms, material definitions, accessor metadata and
position/index binary hashes, then checks all 129 rebuilt meshes for finite
positions and nondegenerate exported triangles. The original 99 roots remain present; revision 1
adds eight support props, resulting in 107 roots.

`legacy_layout_bounds.json` records the original runtime parcel contract.
Rebuilt holders export this exact object as `layoutFootprint`, independently of
new visual geometry. All new building details stay inside that envelope.
Front stays Blender -Y / runtime +Z, the base stays grounded, and existing
entrance X/Z coordinates stay on the legacy facade. One vertical fit derived
from LOD0 is shared by all levels so removing small details cannot expand the
remaining building body.

LOD0 keeps facade framing, reveals, mullions, railings and small roof equipment.
LOD1 removes small fittings and retains readable major facade features. LOD2
keeps the composed mass and roof silhouette. Building triangles across all 28
variants are 94,400 / 24,992 / 3,918: the distant catalogue uses 4.2% of near
geometry. `refresh_manifest.json` contains counts per asset and the preservation
summary. Runtime performance and visual QA are separate from this asset audit.
