"""Preview sheet for soldier_faceted.py: the five classes of each faction, front three-quarter.

Run:  Blender -b --factory-startup --python preview_soldiers.py -- <out.png> [back]
Class kits and faction colours mirror src/skirmish/units/soldierLook.js.
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.join(HERE, "preview_soldiers.png")
BACK = len(ARGS) > 1 and ARGS[1] == "back"
sys.argv = sys.argv[:1]
g = {"__name__": "__main__", "__file__": os.path.join(HERE, "soldier_faceted.py")}
exec(open(g["__file__"]).read(), g)
NPC = os.path.join(HERE, "..", "..", "..", "docs", "art-direction", "npc-v1", "blender")
exec(open(os.path.join(NPC, "studio.py")).read(), {"__name__": "studio"})
objs = g["objs"]
sc = bpy.context.scene

KITS = {
    "scout": ("base", "pouches", "pack_small"),
    "shocktrooper": ("base", "mags", "plate", "pack_small"),
    "lancer": ("base", "armor", "tubes"),
    "engineer": ("base", "pouches", "pack_engineer", "tools"),
    "sniper": ("base", "pouches", "goggles", "pack_small"),
}
FACTIONS = {
    "fed": {"M_shirt": "#4F6F8F", "M_shirt_fold": "#3F5A75", "M_pants": "#3D4F63", "M_cap": "#55705A", "M_tie": "#C8A23A"},
    "imp": {"M_shirt": "#45474D", "M_shirt_fold": "#36383D", "M_pants": "#303236", "M_cap": "#4A4D52", "M_tie": "#A8322D"},
}


def srgb(h):
    r, g_, b = [int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g_), f(b), 1.0)


def kit_tag(name):
    rest = name[len("kit_"):]
    for tags in KITS.values():
        for t in sorted(tags, key=len, reverse=True):
            if rest.startswith(t):
                return t
    return rest.split("_")[0]


def dress(faction, cls):
    for name, o in objs.items():
        if o.type != "MESH":
            continue
        if name.startswith("hat_") and name != "hat_strap":
            o.hide_render = not name.startswith(f"hat_{faction}")
        elif name.startswith("kit_"):
            o.hide_render = kit_tag(name) not in KITS[cls]
        elif name.startswith(("glasses_", "beard_", "hair_R04_crown")):
            o.hide_render = True
        elif name.startswith("expr_"):
            pick = {"eyes": "open", "brows": "angry", "mouth": "neutral"}
            feature, variant = name.split("_")[1:3]
            o.hide_render = pick.get(feature) != variant
    for m, hex_ in FACTIONS[faction].items():
        bpy.data.materials[m].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = srgb(hex_)


cam = bpy.data.objects["Cam_C01_back" if BACK else "Cam_C01_three"]
sc.camera = cam
W, H = 340, 560
sc.render.resolution_x, sc.render.resolution_y = W, H
rows = []
for faction in FACTIONS:
    tiles = []
    for cls in KITS:
        dress(faction, cls)
        path = os.path.join(os.path.dirname(OUT), f"_tile_{faction}_{cls}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        tiles.append(np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4))
        bpy.data.images.remove(img)
        os.remove(path)
    rows.append(np.concatenate(tiles, axis=1))
sheet = np.concatenate(rows[::-1], axis=0)  # Blender images start at the bottom row
out = bpy.data.images.new("soldier_sheet", sheet.shape[1], sheet.shape[0], alpha=True)
out.pixels[:] = sheet.ravel()
out.filepath_raw = OUT
out.file_format = "PNG"
out.save()
print("sheet", OUT)
