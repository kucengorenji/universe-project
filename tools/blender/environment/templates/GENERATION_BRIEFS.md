# Brief template untuk generasi

Template ini belum menjalankan tool apa pun. Isi job metadata terlebih dahulu. Model/seed dicatat hanya jika tool mengembalikannya; jangan mengarang seed untuk service yang tidak mengeksposnya.

## Concept sheet model

Use case: stylized-concept.
Asset: {assetId / variantId}.
Input references: {reference ID + path + peran setiap gambar}.
World style: warm painted diorama, grouped readable silhouettes, selective bevels, restrained detail, matte materials, shared toon lighting intent.
Subject: {species / fungsi}, target size {width × height × depth metres}.
Views: isolated front, side, back, three-quarter at matching scale; simple neutral background.
Shape constraints: {dominant masses, asymmetry, negative spaces, silhouette}.
Modularity: {separate moss/plants, root pivot, attachment locations}.
Avoid: text baked onto surface, brand/logo, photoreal microdetail, identical sphere canopy, directional cast shadows as material detail.
Output intent: reference sheet for 3D reconstruction; not final texture or mesh.

## 3D modeling job via Blender MCP

- Inspect active scene, available APIs/add-on and Blender version first.
- Read style guide, job and intended legacy replacement.
- Build in a dedicated collection; save a new versioned source.
- Reference planes are supporting images only. Model unseen sides deliberately.
- Units metre, Blender Z-up/front -Y; verify conversion to Y-up/front +Z.
- Blockout pivot/socket/footprint → silhouette → normals/UV → materials → LOD → candidate export.
- Use shared palette build snapshot; do not hardcode an independent palette.
- Return actual paths, measured bounds and triangle counts, material/UV inventory, tool versions and QA frames.
- Do not mark integrated before consumer and manifest are wired and runtime QA passes.

## Texture tile generation

Use case: stylized-concept.
Asset type: one flat orthographic seamless material tile, {materialSetId}.
Input reference: {ID}, use only its {motif/shape}, not the contact-sheet layout.
Primary request: a single edge-to-edge {material} surface, {physical span in metres}, simple hand-painted shapes, broad low-frequency detail, gentle neutral value variation.
Background: none; material fills entire square.
Lighting: uniform, no baked directional light, no cast shadow, no perspective or vignette.
Color: neutral modulation master; colored illustration preview is a separate deliverable.
Constraints: no border, labels, individual framed samples, watermark or objects placed on top. Match opposite edges.
Validation: generated output is only a candidate; offset/repeat/mip verification and seam cleanup are mandatory.

## Trim sheet generation

Same style; explicit normalized band layout {bands with bounds and repeat axis}. Consistent physical scale, neutral modulation, separators only where actual material seams need them. Document gutter/dilation after packing. Do not assume a generated trim repeats globally in both axes.

## Cutout / water data

For foliage, generate silhouettes on genuine alpha only if needed. Separate colored RGB intent from scalar masks; preserve coverage across mips. For ripple normals, use a controlled height-to-normal/bake pipeline and verify channel convention in shader; an image that looks purple is not proof of a valid normal map.

## Reproducibility

Save exact prompt, original tool output, selected revision, local reference hashes, master edits, generator parameters and export report. Record manual changes too. A repeated generative prompt is not guaranteed to reproduce identical pixels.

