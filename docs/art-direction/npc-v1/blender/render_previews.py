"""Preview renders for c01_faceted.py: turnaround stills and an expression sheet.

Run:  Blender -b --factory-startup --python render_previews.py -- <out_dir>
"""
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else HERE
sys.argv = sys.argv[:1]  # the builder must not export
g = {"__name__": "__main__"}
exec(open(os.path.join(HERE, "c01_faceted.py")).read(), g)
exec(open(os.path.join(HERE, "studio.py")).read(), {"__name__": "studio"})
EXPR, objs = g["EXPR"], g["objs"]
sc = bpy.context.scene


def show(**pick):
    """Show one variant per feature (like the game does)."""
    for feature, variants in EXPR.items():
        for v in variants:
            for name, o in objs.items():
                if name.startswith(f"expr_{feature}_{v}"):
                    o.hide_render = v != pick.get(feature, variants[0])


def beard(on):
    for name, o in objs.items():
        if name.startswith("beard_"):
            o.hide_render = not on
    # the game pushes the mouth onto the beard when it is worn
    for name, o in objs.items():
        if name.startswith("expr_mouth_"):
            o.location.y = -0.016 if on else 0.0


def render(cam, path, res=(600, 800)):
    sc.camera = bpy.data.objects[cam]
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# head close-up camera on the new proportions
t = bpy.data.objects.new("Head_target", None)
sc.collection.objects.link(t)
t.location = (0, 0, 1.585)
hc = bpy.data.objects["Cam_C01_head"]
hc.location = (0.42, -1.25, 1.64)
hc.constraints[0].target = t

show()
beard(True)
for view in ("three", "front", "side", "back", "head"):
    render(f"Cam_C01_{view}", os.path.join(OUT, f"preview_c01_faceted_{view}.png"))

# expression sheet (beard off so the mouth reads)
PRESETS = [
    ("neutral", dict(eyes="open", brows="neutral", mouth="neutral")),
    ("smile", dict(eyes="squint", brows="raised", mouth="smile")),
    ("laugh", dict(eyes="squint", brows="raised", mouth="grin")),
    ("curious", dict(eyes="wide", brows="raised", mouth="open")),
    ("worried", dict(eyes="wide", brows="worried", mouth="frown")),
    ("focused", dict(eyes="open", brows="angry", mouth="neutral")),
    ("blink", dict(eyes="closed", brows="neutral", mouth="neutral")),
    ("angry", dict(eyes="open", brows="angry", mouth="frown")),
]
beard(False)
hc.location = (0.16, -0.95, 1.60)
tiles = []
W, H = 360, 360
for name, pick in PRESETS:
    show(**pick)
    path = os.path.join(OUT, f"_expr_{name}.png")
    render("Cam_C01_head", path, (W, H))
    img = bpy.data.images.load(path)
    tiles.append(np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4))
    bpy.data.images.remove(img)
    os.remove(path)
cols = 4
rows = (len(tiles) + cols - 1) // cols
sheet = np.ones((rows * H, cols * W, 4), dtype=np.float32)
for i, tile in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = tile  # Blender images start at the bottom row
out = bpy.data.images.new("expr_sheet", cols * W, rows * H, alpha=True)
out.pixels[:] = sheet.ravel()
out.filepath_raw = os.path.join(OUT, "preview_c01_expressions.png")
out.file_format = "PNG"
out.save()
print("expressions:", ", ".join(n for n, _ in PRESETS))
