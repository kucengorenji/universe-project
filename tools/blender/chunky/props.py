"""Room furniture, wall decor and loose items in the chunky-toon look (furniture.glb).

Each builder draws one asset into a kit.Builder in Blender space: metres, Z up,
front = -Y (the glTF export turns that into +Z, the direction the game treats as
the front of a piece), origin on the floor at the footprint centre.

Runtime contract (src/modes/town/interior):
  footprints   the floor planner measures the LOD0 bounds, so every piece keeps
               roughly the footprint of the asset it replaces
  hinges       fu_wardrobe_door / fu_fridge_door are one leaf drawn from its hinge
               (x = 0) towards +X, lying in front of y = 0; the room mirrors the
               right-hand wardrobe leaf
  surfaces     loose items are put down around the middle of fu_counter (0.93),
               fu_table (0.77), fu_desk (0.76) and fu_coffee_table (0.43), so
               nothing tall stands within ~0.3 m of those centres
  lights       the room adds its lamp light and bulb glow at y 1.5 (floor lamp)
               and 0.45 above the base (table lamp)
  wall decor   fu_window, fu_wall_shelf, fu_picture_*, fu_clock hang with their
               back on y = 0 and face -Y
"""
import math
import random

from . import kit

PI = math.pi


# ---------------------------------------------------------------- helpers
def bx(b, mat, x0, x1, y0, y1, z0, z1, r=None, **kw):
    """Box from bounds."""
    return b.box(mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), r=r, **kw)


def knob(b, mat, x, y, z, r=0.026):
    """Round knob on a front that faces -Y (y = the front surface)."""
    b.sphere(mat, (x, y - r * 0.45, z), r, scale=(1, 0.75, 1), seg=12)


def leg(b, mat, x, y, z0, z1, r0, r1=None, seg=12):
    b.cyl(mat, (x, y, (z0 + z1) / 2), r0, z1 - z0, seg=seg, r2=r0 if r1 is None else r1, bevel=min(r0, r1 or r0) * 0.35)


def front_prism(b, mat, pts, y0, y1, r=0.0):
    """Polygon drawn in (x, z) extruded along Y from y0 to y1."""
    b.prism(mat, pts, y1 - y0, r=r, loc=(0, (y0 + y1) / 2, 0), rot=(PI / 2, 0, 0))


def rrect(w, h, r, cx=0.0, cy=0.0, steps=4):
    """Rounded rectangle outline (2D)."""
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    return kit.round_poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], r, steps=steps)


def turned_leg(b, mat, x, y, h, r=0.045):
    """Chunky lathe-turned leg from the floor to h."""
    b.lathe(mat, [(0, 0), (r * 0.8, 0), (r, h * 0.04), (r * 0.7, h * 0.14), (r * 0.62, h * 0.3), (r * 1.05, h * 0.62),
                  (r * 0.8, h * 0.8), (r * 1.1, h * 0.86), (r * 1.1, h), (0, h)], loc=(x, y, 0), seg=14)


def flame(b, mat, x, y, z, h, w, seg=12):
    """Teardrop flame standing on (x, y, z)."""
    b.lathe(mat, [(0, 0), (w * 0.8, h * 0.08), (w, h * 0.28), (w * 0.82, h * 0.52), (w * 0.4, h * 0.8), (0, h)],
            loc=(x, y, z), seg=seg)


def drawer_bank(b, body, groove, knob_mat, x0, x1, y, z0, z1, rows=1, cols=1, knobs=True, gap=0.02, r=0.022):
    """Proud drawer/door fronts on a darker groove plate; y = carcass front."""
    bx(b, groove, x0, x1, y - 0.012, y + 0.002, z0, z1, r=0.004)
    w = (x1 - x0 - gap * (cols + 1)) / cols
    h = (z1 - z0 - gap * (rows + 1)) / rows
    for i in range(cols):
        for j in range(rows):
            px0 = x0 + gap + i * (w + gap)
            pz0 = z0 + gap + j * (h + gap)
            bx(b, body, px0, px0 + w, y - 0.034, y - 0.008, pz0, pz0 + h, r=r)
            if knobs:
                knob(b, knob_mat, px0 + w / 2, y - 0.034, pz0 + h * (0.5 if h < 0.3 else 0.78))


# ---------------------------------------------------------------- kitchen
def counter(b, v):
    """Kitchen counter, 1.84 x 0.64, worktop at 0.93. v0 painted cabinets with a sink,
    v1 wooden dresser with a wash bowl and jug."""
    modern = v == 0
    body, dark, top = ('cab_blue', 'cab_blue_dark', 'top_wood') if modern else ('wood_mid', 'wood_dark', 'wood_pale')
    bx(b, dark, -0.86, 0.86, -0.22, 0.28, 0, 0.1, r=0.02)
    bx(b, body, -0.9, 0.9, -0.26, 0.3, 0.08, 0.87, r=0.04)
    for cx in (-0.6, 0.0, 0.6):
        drawer_bank(b, body, dark, 'cab_teal' if modern else 'yellow_dark', cx - 0.3, cx + 0.3, -0.26, 0.62, 0.84)
        drawer_bank(b, body, dark, 'cab_teal' if modern else 'yellow_dark', cx - 0.3, cx + 0.3, -0.26, 0.12, 0.6)
    bx(b, top, -0.92, 0.92, -0.32, 0.32, 0.86, 0.93, r=0.03)
    bx(b, 'top_wood_edge' if modern else 'wood_mid', -0.915, 0.915, -0.318, 0.318, 0.845, 0.87, r=0.012)
    if modern:
        # Sink off to the right, leaving the middle of the worktop free for items
        for (x0, x1, y0, y1) in ((0.26, 0.8, -0.22, -0.17), (0.26, 0.8, 0.13, 0.18), (0.26, 0.31, -0.22, 0.18), (0.75, 0.8, -0.22, 0.18)):
            bx(b, 'steel', x0, x1, y0, y1, 0.92, 0.965, r=0.014)
        bx(b, 'steel_dark', 0.3, 0.76, -0.18, 0.14, 0.92, 0.94, r=0.01)
        b.cyl('iron', (0.53, -0.02, 0.942), 0.03, 0.006, seg=12)
        b.cyl('steel', (0.53, 0.235, 0.955), 0.035, 0.05, seg=14, bevel=0.01)
        b.tube('steel', [(0.53, 0.235, 0.96), (0.53, 0.235, 1.12), (0.53, 0.2, 1.185), (0.53, 0.12, 1.2), (0.53, 0.06, 1.15)],
               0.019, seg=10, round_ends=2)
        for x, c in ((0.44, 'red'), (0.62, 'blue')):
            b.cyl('steel', (x, 0.235, 0.975), 0.012, 0.05, seg=8)
            b.sphere(c, (x, 0.235, 1.005), 0.026, scale=(1, 1, 0.8), seg=10)
        # Red toaster at the left end (ref: kitchen diorama)
        bx(b, 'red', -0.82, -0.52, -0.02, 0.2, 0.93, 1.12, r=0.05)
        bx(b, 'iron', -0.78, -0.56, 0.04, 0.07, 1.1, 1.125, r=0.008)
        bx(b, 'iron', -0.78, -0.56, 0.12, 0.15, 1.1, 1.125, r=0.008)
        bx(b, 'steel_light', -0.84, -0.8, 0.05, 0.12, 1.02, 1.05, r=0.01)
        b.sphere('led_green', (-0.62, -0.022, 0.97), 0.012, seg=8)
    else:
        b.lathe('cream', [(0, 0), (0.1, 0), (0.17, 0.05), (0.2, 0.11), (0.21, 0.12), (0.17, 0.12), (0.15, 0.06), (0, 0.06)],
                loc=(0.52, 0.02, 0.93), seg=20)
        b.torus('cab_blue', (0.52, 0.02, 1.03), 0.195, 0.012, seg=24)
        b.lathe('cab_blue', [(0, 0), (0.07, 0), (0.09, 0.08), (0.085, 0.16), (0.05, 0.22), (0.055, 0.26), (0.045, 0.27), (0, 0.27)],
                loc=(0.55, 0.2, 0.93), seg=16)
        b.torus('cab_blue', (0.63, 0.2, 1.08), 0.05, 0.013, rot=(PI / 2, 0, 0), seg=14)
        # Bread board at the left end
        bx(b, 'wood_mid', -0.84, -0.46, -0.2, 0.12, 0.93, 0.955, r=0.012)
        b.capsule('bread', (-0.75, -0.04, 0.99), (-0.56, -0.04, 0.99), 0.05, seg=12)
        for x in (-0.7, -0.65, -0.6):
            bx(b, 'bread_dark', x - 0.008, x + 0.008, -0.08, 0.0, 1.03, 1.045, r=0.004)


def stove(b, v):
    """Cooker, 0.7 x 0.61 x 0.93: two glowing rings, a pot, knob strip with LEDs, oven door."""
    bx(b, 'slate_dark', -0.32, 0.32, -0.25, 0.28, 0, 0.06, r=0.02)
    bx(b, 'slate', -0.35, 0.35, -0.27, 0.3, 0.05, 0.86, r=0.05)
    bx(b, 'slate_dark', -0.35, 0.35, -0.3, 0.3, 0.84, 0.93, r=0.028)
    for x in (-0.16, 0.16):
        b.cyl('iron', (x, 0.03, 0.935), 0.12, 0.02, seg=24, bevel=0.006)
        b.torus('ember', (x, 0.03, 0.947), 0.078, 0.011, seg=24, tseg=6)
        b.torus('ember', (x, 0.03, 0.947), 0.036, 0.009, seg=16, tseg=6)
    bx(b, 'slate', -0.35, 0.35, 0.22, 0.3, 0.9, 1.03, r=0.035)
    # Saucepan on the left ring
    b.lathe('orange', [(0, 0), (0.09, 0), (0.1, 0.01), (0.1, 0.1), (0.108, 0.11), (0.095, 0.11), (0.09, 0.09), (0, 0.09)],
            loc=(-0.16, 0.03, 0.945), seg=20)
    b.tube('slate_dark', [(-0.07, 0.03, 1.035), (0.08, 0.03, 1.05)], 0.016, seg=8, round_ends=2)
    # Oven door
    bx(b, 'slate_light', -0.3, 0.3, -0.3, -0.26, 0.12, 0.6, r=0.035)
    bx(b, 'glass_dark', -0.2, 0.2, -0.308, -0.29, 0.24, 0.5, r=0.025)
    bx(b, 'orange_light', -0.16, 0.16, -0.3, -0.29, 0.28, 0.3, r=0.006)
    b.tube('steel_light', [(-0.22, -0.335, 0.63), (0.22, -0.335, 0.63)], 0.017, seg=10, round_ends=2)
    for x in (-0.2, 0.2):
        b.cyl('steel_light', (x, -0.315, 0.63), 0.012, 0.04, rot=(PI / 2, 0, 0), seg=8)
    # Knob strip with a status LED under each knob
    for x in (-0.24, -0.08, 0.08, 0.24):
        b.cyl('cream', (x, -0.31, 0.75), 0.034, 0.035, rot=(PI / 2, 0, 0), seg=16, bevel=0.01)
        bx(b, 'slate_dark', x - 0.006, x + 0.006, -0.332, -0.325, 0.75, 0.778, r=0.003)
        b.sphere('led_green', (x, -0.3, 0.69), 0.011, seg=8)


def fridge(b, v):
    """Fridge carcass, 0.7 x 0.7 x 1.8, open at the front with shelves and food; the door is separate."""
    body, inner = 'red', 'cream'
    for x in (-0.3, 0.3):
        for y in (-0.28, 0.28):
            b.cyl('iron', (x, y, 0.02), 0.03, 0.04, seg=10)
    bx(b, body, -0.35, -0.29, -0.35, 0.35, 0.03, 1.8, r=0.05)
    bx(b, body, 0.29, 0.35, -0.35, 0.35, 0.03, 1.8, r=0.05)
    bx(b, body, -0.35, 0.35, 0.29, 0.35, 0.03, 1.8, r=0.05)
    bx(b, body, -0.35, 0.35, -0.35, 0.35, 0.03, 0.14, r=0.05)
    bx(b, body, -0.35, 0.35, -0.35, 0.35, 1.64, 1.8, r=0.08)
    # Liner and shelves
    bx(b, inner, -0.295, 0.295, 0.26, 0.295, 0.13, 1.65, r=0.004)
    bx(b, inner, -0.295, -0.285, -0.33, 0.29, 0.13, 1.65, r=0.003)
    bx(b, inner, 0.285, 0.295, -0.33, 0.29, 0.13, 1.65, r=0.003)
    bx(b, inner, -0.29, 0.29, -0.33, 0.29, 0.135, 0.15, r=0.003)
    bx(b, inner, -0.29, 0.29, -0.33, 0.29, 1.625, 1.645, r=0.003)
    for z in (0.52, 0.92, 1.3):
        bx(b, 'steel_light', -0.285, 0.285, -0.31, 0.26, z, z + 0.02, r=0.006)
    bx(b, 'cream_dark', -0.285, 0.285, -0.3, 0.26, 0.15, 0.3, r=0.03)
    # Food
    b.lathe('milk', [(0, 0), (0.045, 0), (0.05, 0.02), (0.05, 0.15), (0.03, 0.2), (0.022, 0.22), (0, 0.22)], loc=(-0.18, 0.05, 0.54), seg=14)
    b.cyl('blue', (-0.18, 0.05, 0.775), 0.024, 0.03, seg=12, bevel=0.008)
    b.lathe('milk', [(0, 0), (0.045, 0), (0.05, 0.02), (0.05, 0.15), (0.03, 0.2), (0.022, 0.22), (0, 0.22)], loc=(-0.07, 0.1, 0.54), seg=14)
    b.cyl('red_light', (-0.07, 0.1, 0.775), 0.024, 0.03, seg=12, bevel=0.008)
    b.prism('cheese', [(0, 0), (0.16, 0.05), (0, 0.11)], 0.07, r=0.01, loc=(0.1, 0.0, 0.575))
    for x, y in ((0.12, -0.12), (0.22, -0.02)):
        b.sphere('tomato', (x, y, 0.985), 0.05, scale=(1, 1, 0.85), seg=12)
    b.sphere('lettuce', (-0.12, -0.02, 1.0), 0.08, scale=(1, 1, 0.8), seg=12)
    b.lathe('glass', [(0, 0), (0.05, 0), (0.055, 0.12), (0, 0.12)], loc=(0.15, 0.08, 1.32), seg=14)
    b.cyl('yellow', (0.15, 0.08, 1.455), 0.056, 0.03, seg=14, bevel=0.01)
    b.cyl('slate', (-0.1, 0.0, 1.36), 0.12, 0.08, seg=18, bevel=0.02)


def fridge_door(b, v):
    """Fridge door leaf: 0.66 x 1.76, hinge at x = 0, lying in front of y = 0."""
    bx(b, 'red', 0.0, 0.66, -0.085, 0.0, 0.02, 1.78, r=0.05)
    bx(b, 'red_dark', 0.03, 0.63, -0.089, -0.08, 1.27, 1.295, r=0.006)
    bx(b, 'cream', 0.06, 0.6, -0.0, 0.018, 0.2, 1.6, r=0.01)
    for z in (0.5, 0.9):
        bx(b, 'cream_dark', 0.08, 0.58, 0.01, 0.06, z, z + 0.08, r=0.012)
    b.capsule('steel_light', (0.585, -0.125, 0.92), (0.585, -0.125, 1.2), 0.022, seg=10)
    for z in (0.92, 1.2):
        b.cyl('steel_light', (0.585, -0.1, z), 0.014, 0.05, rot=(PI / 2, 0, 0), seg=8)
    b.cyl('cream', (0.2, -0.09, 1.52), 0.045, 0.012, rot=(PI / 2, 0, 0), seg=16, bevel=0.004)
    b.sphere('led_green', (0.2, -0.097, 1.52), 0.012, seg=8)


# ---------------------------------------------------------------- bedroom
def wardrobe(b, v):
    """Wardrobe carcass, 1.26 x 0.64 x 2.06, open front with hanging clothes; doors are separate."""
    body, cap, inner = (('wood_mid', 'wood_dark', 'wood_dark') if v == 0 else ('wood_dark', 'wood_deep', 'wood_deep'))
    for x in (-0.56, 0.56):
        for y in (-0.22, 0.3):
            b.sphere(cap, (x, y, 0.045), 0.05, scale=(1, 1, 0.9), seg=10)
    bx(b, cap, -0.6, 0.6, -0.26, 0.35, 0.07, 0.16, r=0.03)
    bx(b, body, -0.63, -0.57, -0.27, 0.37, 0.12, 1.96, r=0.028)
    bx(b, body, 0.57, 0.63, -0.27, 0.37, 0.12, 1.96, r=0.028)
    bx(b, body, -0.6, 0.6, 0.31, 0.37, 0.12, 1.96, r=0.02)
    bx(b, inner, -0.575, 0.575, 0.28, 0.315, 0.16, 1.9, r=0.004)
    bx(b, body, -0.6, 0.6, -0.27, 0.34, 0.12, 0.18, r=0.015)
    bx(b, body, -0.575, 0.575, -0.22, 0.3, 1.6, 1.64, r=0.01)
    bx(b, cap, -0.655, 0.655, -0.31, 0.4, 1.92, 2.0, r=0.03)
    bx(b, body, -0.62, 0.62, -0.28, 0.38, 1.99, 2.06, r=0.03)
    # Rail, clothes on hangers, hat boxes on the shelf
    b.tube('steel', [(-0.56, 0.04, 1.52), (0.56, 0.04, 1.52)], 0.014, seg=8)
    rng = random.Random(11 + v)
    colours = ['red', 'blue', 'yellow', 'green', 'pink', 'purple_light', 'orange', 'cab_teal']
    rng.shuffle(colours)
    x = -0.48
    for c in colours[:6]:
        w = rng.uniform(0.07, 0.1)
        h = rng.uniform(0.55, 0.85)
        b.torus('steel_dark', (x, 0.04, 1.49), 0.028, 0.006, rot=(PI / 2, 0, PI / 2), seg=10, tseg=4)
        bx(b, 'wood_pale', x - 0.012, x + 0.012, -0.12, 0.2, 1.43, 1.46, r=0.008)
        bx(b, c, x - w / 2, x + w / 2, -0.15, 0.23, 1.44 - h, 1.45, r=0.035)
        x += w + 0.075
    bx(b, 'cream', -0.5, -0.18, -0.12, 0.2, 1.64, 1.82, r=0.04)
    bx(b, 'pink', -0.1, 0.22, -0.12, 0.2, 1.64, 1.78, r=0.04)
    bx(b, 'gingham_a', -0.12, 0.24, -0.14, 0.22, 1.76, 1.8, r=0.02)


def wardrobe_door(b, v):
    """Wardrobe door leaf: 0.58 x 1.86, hinge at x = 0 (towards +X), in front of y = 0."""
    bx(b, 'wood_mid', 0.015, 0.585, -0.07, 0.0, 0.08, 1.92, r=0.024)
    for z0, z1 in ((0.2, 0.92), (1.02, 1.8)):
        bx(b, 'wood_dark', 0.075, 0.525, -0.08, -0.06, z0 - 0.02, z1 + 0.02, r=0.02)
        bx(b, 'wood_pale', 0.09, 0.51, -0.092, -0.07, z0, z1, r=0.028)
    knob(b, 'yellow_dark', 0.535, -0.072, 0.98, 0.03)


def bed(b, v):
    """Single bed, 1.6 x 2.14: posts with ball finials, puffy pillow, turned-down blanket.
    Head at +Y (against the wall), foot at -Y."""
    frame, blanket, stripe = (('wood_pale', 'blanket', 'blue_light') if v == 0 else ('wood_mid', 'red', 'red_light'))
    for x in (-0.74, 0.74):
        b.cyl(frame, (x, 1.02, 0.5), 0.06, 1.0, seg=14, bevel=0.02)
        b.sphere(frame, (x, 1.02, 1.03), 0.075, seg=14)
        b.cyl(frame, (x, -0.98, 0.31), 0.06, 0.62, seg=14, bevel=0.02)
        b.sphere(frame, (x, -0.98, 0.66), 0.075, seg=14)
    front_prism(b, frame, kit.round_poly([(-0.7, 0.3), (0.7, 0.3), (0.7, 0.86), (0.0, 0.98), (-0.7, 0.86)], [0.02, 0.02, 0.2, 0.5, 0.2], steps=5), 0.99, 1.06, r=0.02)
    front_prism(b, 'wood_mid' if v == 0 else 'wood_dark', rrect(0.9, 0.34, 0.1, cy=0.62), 0.975, 0.99, r=0.006)
    front_prism(b, frame, kit.round_poly([(-0.7, 0.26), (0.7, 0.26), (0.7, 0.54), (-0.7, 0.54)], [0.02, 0.02, 0.18, 0.18], steps=5), -1.01, -0.95, r=0.018)
    for x in (-0.74, 0.74):
        bx(b, frame, x - 0.045, x + 0.045, -0.96, 1.0, 0.18, 0.32, r=0.03)
    bx(b, 'white', -0.7, 0.7, -0.95, 0.98, 0.28, 0.48, r=0.07)
    bx(b, blanket, -0.73, 0.73, -0.99, 0.36, 0.33, 0.53, r=0.07)
    bx(b, stripe, -0.735, 0.735, -0.72, -0.6, 0.34, 0.535, r=0.04)
    bx(b, 'white', -0.735, 0.735, 0.24, 0.44, 0.37, 0.56, r=0.07)
    b.sphere('white', (0.0, 0.76, 0.56), 1.0, scale=(0.5, 0.17, 0.1), seg=18)


# ---------------------------------------------------------------- living
SOFA = {0: ('cushion_blue', 'blue_dark'), 1: ('red', 'red_dark'), 2: ('yellow', 'yellow_dark')}
ARMCHAIR = {0: ('orange', 'red_dark'), 1: ('cab_teal', 'cab_blue_dark')}


def sofa(b, v):
    """Three-seat sofa, 2.04 x 0.86 x 0.93, fat rolled arms."""
    main, dark = SOFA[v]
    for x in (-0.88, 0.88):
        for y in (-0.28, 0.38):
            leg(b, 'wood_dark', x, y, 0, 0.1, 0.04, 0.03)
    bx(b, dark, -0.98, 0.98, -0.33, 0.46, 0.08, 0.34, r=0.08)
    for x0, x1 in ((-0.84, -0.005), (0.005, 0.84)):
        bx(b, main, x0, x1, -0.375, 0.3, 0.28, 0.5, r=0.09)
    bx(b, main, -0.98, 0.98, 0.2, 0.48, 0.28, 0.93, r=0.14)
    for x0, x1 in ((-0.8, -0.01), (0.01, 0.8)):
        bx(b, main, x0, x1, 0.1, 0.3, 0.46, 0.86, r=0.1)
    for s in (-1, 1):
        bx(b, main, s * 1.02 - 0.1, s * 1.02 + 0.1, -0.375, 0.48, 0.08, 0.62, r=0.08)
        b.capsule(main, (s * 0.92, -0.33, 0.62), (s * 0.92, 0.42, 0.62), 0.1, seg=16)
    bx(b, 'white', 0.45, 0.72, 0.03, 0.14, 0.5, 0.74, r=0.07, rot=None)


def armchair(b, v):
    """Armchair, 0.94 x 0.8 x 0.97."""
    main, dark = ARMCHAIR[v]
    for x in (-0.36, 0.36):
        for y in (-0.26, 0.36):
            leg(b, 'wood_dark', x, y, 0, 0.1, 0.035, 0.028)
    bx(b, dark, -0.42, 0.42, -0.31, 0.43, 0.08, 0.34, r=0.07)
    bx(b, main, -0.3, 0.3, -0.35, 0.3, 0.28, 0.5, r=0.09)
    bx(b, main, -0.44, 0.44, 0.2, 0.45, 0.28, 0.97, r=0.14)
    bx(b, main, -0.28, 0.28, 0.1, 0.28, 0.46, 0.88, r=0.1)
    for s in (-1, 1):
        bx(b, main, s * 0.37 - 0.1, s * 0.37 + 0.1, -0.35, 0.45, 0.08, 0.6, r=0.08)
        b.capsule(main, (s * 0.37, -0.3, 0.6), (s * 0.37, 0.4, 0.6), 0.1, seg=16)


def chair(b, v):
    """Dining chair, 0.45 x 0.45, seat at 0.48, back at +Y. v0 wood, v1 painted red."""
    frame, seat = ('wood_mid', 'wood_pale') if v == 0 else ('red', 'cream')
    for x in (-0.165, 0.165):
        for y in (-0.165, 0.165):
            leg(b, frame, x, y, 0, 0.43, 0.03, 0.024)
    bx(b, seat, -0.225, 0.225, -0.225, 0.2, 0.41, 0.48, r=0.03)
    for x in (-0.17, 0.17):
        b.cyl(frame, (x, 0.19, 0.68), 0.028, 0.5, seg=12, bevel=0.01)
    bx(b, frame, -0.215, 0.215, 0.16, 0.225, 0.78, 0.97, r=0.05)
    bx(b, frame, -0.15, 0.15, 0.17, 0.215, 0.56, 0.63, r=0.025)


def table(b, v):
    """Dining table, 1.4 x 0.85, top at 0.77."""
    top, legs = ('wood_mid', 'wood_dark') if v == 0 else ('wood_pale', 'wood_mid')
    bx(b, top, -0.7, 0.7, -0.425, 0.425, 0.69, 0.77, r=0.04)
    bx(b, legs, -0.6, 0.6, -0.33, 0.33, 0.6, 0.7, r=0.025)
    for x in (-0.57, 0.57):
        for y in (-0.3, 0.3):
            turned_leg(b, legs, x, y, 0.69, r=0.05)


def coffee_table(b, v):
    """Low table, 1.0 x 0.55, top at 0.43, with a shelf holding a magazine."""
    bx(b, 'wood_pale', -0.5, 0.5, -0.275, 0.275, 0.35, 0.425, r=0.035)
    for x in (-0.42, 0.42):
        for y in (-0.2, 0.2):
            leg(b, 'wood_mid', x, y, 0, 0.36, 0.04, 0.032)
    bx(b, 'wood_mid', -0.44, 0.44, -0.22, 0.22, 0.09, 0.12, r=0.012)
    bx(b, 'pink', -0.3, -0.05, -0.12, 0.1, 0.12, 0.135, r=0.006)
    bx(b, 'blue', 0.08, 0.3, -0.1, 0.12, 0.12, 0.16, r=0.01)


def desk(b, v):
    """Office desk, 1.3 x 0.65, top at 0.76: drawer pedestal, beige CRT, desk lamp."""
    bx(b, 'wood_pale', -0.65, 0.65, -0.325, 0.325, 0.7, 0.76, r=0.03)
    bx(b, 'cab_blue', -0.62, -0.2, -0.28, 0.3, 0.03, 0.7, r=0.035)
    drawer_bank(b, 'cab_blue', 'cab_blue_dark', 'yellow', -0.6, -0.22, -0.28, 0.06, 0.68, rows=3)
    for y in (-0.26, 0.26):
        leg(b, 'wood_mid', 0.58, y, 0.0, 0.7, 0.035, 0.03)
    bx(b, 'wood_mid', 0.555, 0.605, -0.26, 0.26, 0.12, 0.17, r=0.015)
    # CRT at the back left, clear of the middle where items are put down
    bx(b, 'pc_beige_dark', -0.54, -0.38, -0.02, 0.2, 0.76, 0.79, r=0.012)
    bx(b, 'pc_beige', -0.63, -0.3, -0.08, 0.26, 0.79, 1.1, r=0.05)
    bx(b, 'pc_beige_dark', -0.61, -0.32, -0.1, -0.07, 0.82, 1.08, r=0.025)
    bx(b, 'screen_blue', -0.59, -0.34, -0.108, -0.095, 0.845, 1.055, r=0.018)
    b.sphere('led_green', (-0.33, -0.1, 0.81), 0.01, seg=8)
    # Desk lamp at the back right
    b.cyl('slate', (0.5, 0.2, 0.775), 0.07, 0.03, seg=16, bevel=0.01)
    b.tube('slate_light', [(0.5, 0.2, 0.79), (0.46, 0.2, 0.96), (0.38, 0.18, 1.04)], 0.014, seg=8, round_ends=1)
    b.sphere('slate', (0.46, 0.2, 0.96), 0.022, seg=10)
    b.lathe('red', [(0, 0.0), (0.03, 0.0), (0.04, 0.03), (0.075, 0.09), (0, 0.09)], loc=(0.36, 0.17, 0.95), seg=16)


def bookshelf(b, v):
    """Bookcase, 1.2 x 0.4 x 2.0 (front -Y): four shelves of books, jars and a pot."""
    frame, back = ('wood_mid', 'wood_dark') if v == 0 else ('wood_dark', 'wood_deep')
    bx(b, frame, -0.6, -0.54, -0.17, 0.225, 0.0, 1.94, r=0.022)
    bx(b, frame, 0.54, 0.6, -0.17, 0.225, 0.0, 1.94, r=0.022)
    bx(b, frame, -0.62, 0.62, -0.19, 0.225, 1.92, 2.0, r=0.028)
    bx(b, frame, -0.56, 0.56, -0.15, 0.2, 0.0, 0.12, r=0.018)
    bx(b, back, -0.55, 0.55, 0.18, 0.215, 0.1, 1.93, r=0.004)
    shelves = (0.12, 0.58, 1.03, 1.48)
    for z in shelves[1:]:
        bx(b, frame, -0.55, 0.55, -0.16, 0.19, z - 0.04, z, r=0.012)
    rng = random.Random(97 + v * 13)
    colours = ['red', 'blue', 'yellow', 'green', 'purple_light', 'orange', 'cab_teal', 'pink', 'cream']
    for si, z in enumerate(shelves):
        x = -0.53
        end = 0.53
        # one ornament per shelf, at a seeded end
        orn_left = rng.random() < 0.5
        if orn_left:
            x = ornament(b, rng, -0.53, z, si + v) + 0.02
        else:
            end = 0.53 - 0.2
        while x < end - 0.04:
            if rng.random() < 0.12 and x < end - 0.2:
                # a small stack lying flat
                for k in range(rng.randint(2, 3)):
                    bx(b, rng.choice(colours), x, x + 0.2, -0.1, 0.14, z + k * 0.045, z + (k + 1) * 0.045 - 0.004, r=0.01)
                x += 0.22
                continue
            w = rng.uniform(0.035, 0.06)
            h = rng.uniform(0.22, 0.34)
            d = rng.uniform(0.19, 0.24)
            c = rng.choice(colours)
            bx(b, c, x, x + w, 0.16 - d, 0.16, z, z + h, r=0.012)
            if rng.random() < 0.4:
                bx(b, 'paper', x + 0.004, x + w - 0.004, 0.16 - d + 0.02, 0.16, z + h * 0.72, z + h * 0.8, r=0.003)
            x += w + 0.004
        if not orn_left:
            ornament(b, rng, 0.53 - 0.18, z, si + v)


def ornament(b, rng, x, z, k):
    """Jar, plant pot or globe on a shelf starting at x; returns its right edge."""
    kind = k % 3
    cx = x + 0.09
    if kind == 0:
        b.lathe('glass', [(0, 0), (0.06, 0), (0.07, 0.03), (0.07, 0.15), (0.05, 0.17), (0, 0.17)], loc=(cx, 0.02, z), seg=16)
        b.cyl(rng.choice(['red', 'yellow', 'green']), (cx, 0.02, z + 0.185), 0.055, 0.035, seg=14, bevel=0.012)
        b.sphere('orange_light', (cx - 0.02, 0.0, z + 0.05), 0.035, seg=10)
    elif kind == 1:
        b.lathe('pot_terracotta', [(0, 0), (0.05, 0), (0.07, 0.1), (0.075, 0.12), (0, 0.12)], loc=(cx, 0.02, z), seg=16)
        for dx, dz, r in ((-0.03, 0.17, 0.06), (0.035, 0.18, 0.055), (0.0, 0.23, 0.06)):
            b.sphere('plant', (cx + dx, 0.02, z + dz), r, seg=10)
    else:
        b.cyl('wood_dark', (cx, 0.02, z + 0.015), 0.05, 0.03, seg=14, bevel=0.01)
        b.cyl('wood_dark', (cx, 0.02, z + 0.06), 0.012, 0.08, seg=8)
        b.sphere('blue_light', (cx, 0.02, z + 0.17), 0.08, seg=14)
        b.sphere('green', (cx + 0.03, -0.035, z + 0.19), 0.045, scale=(1, 0.7, 0.8), seg=10)
    return x + 0.18


def lamp_floor(b, v):
    """Standard lamp, 1.7 m: disc base, pole, fat orange shade over the bulb at 1.5."""
    b.lathe('slate', [(0, 0), (0.2, 0), (0.215, 0.02), (0.2, 0.05), (0.06, 0.075), (0, 0.075)], loc=(0, 0, 0), seg=24)
    b.cyl('steel_dark', (0, 0, 0.72), 0.02, 1.3, seg=10)
    b.cyl('slate', (0, 0, 0.3), 0.032, 0.05, seg=10, bevel=0.012)
    b.lathe('lampshade', [(0, 1.4), (0.235, 1.4), (0.24, 1.42), (0.16, 1.68), (0.15, 1.7), (0, 1.7)], seg=24)
    b.torus('trim_orange_dark', (0, 0, 1.405), 0.235, 0.014, seg=24, tseg=6)
    b.sphere('slate', (0, 0, 1.72), 0.03, seg=10)


def lamp_table(b, v):
    """Table lamp, 0.5 m: teal vase base, orange shade (bulb at 0.45)."""
    b.lathe('cab_teal', [(0, 0), (0.08, 0), (0.1, 0.05), (0.095, 0.14), (0.05, 0.22), (0.04, 0.25), (0, 0.25)], seg=18)
    b.cyl('steel_dark', (0, 0, 0.28), 0.012, 0.08, seg=8)
    b.lathe('lampshade', [(0, 0.3), (0.17, 0.3), (0.172, 0.315), (0.11, 0.49), (0.1, 0.5), (0, 0.5)], seg=20)


def tv(b, v):
    """Media cabinet with a chunky TV on top; the screen is fu_tv_screen."""
    bx(b, 'wood_mid', -0.8, 0.8, -0.125, 0.32, 0.06, 0.5, r=0.035)
    for x in (-0.72, 0.72):
        leg(b, 'wood_dark', x, 0.1, 0, 0.08, 0.035, 0.03)
    drawer_bank(b, 'cab_blue', 'wood_dark', 'yellow', -0.76, 0.76, -0.125, 0.1, 0.46, cols=3)
    bx(b, 'slate_dark', -0.3, 0.3, 0.1, 0.26, 0.5, 0.54, r=0.015)
    bx(b, 'slate', -0.62, 0.62, 0.07, 0.3, 0.52, 1.27, r=0.07)
    for x0, x1, z0, z1 in ((-0.62, -0.55, 0.52, 1.27), (0.55, 0.62, 0.52, 1.27), (-0.62, 0.62, 1.21, 1.27), (-0.62, 0.62, 0.52, 0.59)):
        bx(b, 'slate_light', x0, x1, 0.035, 0.09, z0, z1, r=0.02)
    b.sphere('led_green', (0.5, 0.03, 0.555), 0.012, seg=8)
    for s in (-1, 1):
        b.tube('steel', [(s * 0.05, 0.2, 1.27), (s * 0.28, 0.2, 1.52)], 0.01, seg=6, round_ends=1)
        b.sphere('red', (s * 0.285, 0.2, 1.53), 0.022, seg=8)
    b.cyl('slate_dark', (0, 0.2, 1.285), 0.06, 0.04, seg=14, bevel=0.012)


def tv_screen(b, v):
    """Screen plate for fu_tv (the room gives it its own material)."""
    bx(b, 'screen_dark', -0.55, 0.55, 0.058, 0.072, 0.59, 1.21, r=0.006)


def radio(b, v):
    """Wooden radio, 0.42 x 0.22 x 0.28, grille, dial and a carry handle."""
    bx(b, 'wood_mid', -0.21, 0.21, -0.1, 0.1, 0.0, 0.22, r=0.06)
    bx(b, 'cream', -0.18, 0.04, -0.115, -0.08, 0.035, 0.185, r=0.025)
    for x in (-0.13, -0.07, -0.01):
        bx(b, 'wood_dark', x - 0.008, x + 0.008, -0.123, -0.11, 0.05, 0.17, r=0.005)
    b.cyl('yellow', (0.12, -0.105, 0.14), 0.035, 0.02, rot=(PI / 2, 0, 0), seg=16, bevel=0.006)
    b.cyl('slate', (0.12, -0.11, 0.065), 0.024, 0.03, rot=(PI / 2, 0, 0), seg=12, bevel=0.008)
    b.tube('slate', [(-0.12, 0, 0.21), (-0.1, 0, 0.27), (0.1, 0, 0.27), (0.12, 0, 0.21)], 0.012, seg=8)


def fireplace(b, v):
    """Brick hearth with an arched firebox, wooden mantel and plaster chimney breast (2.55 m).
    The fire (fu_fire) sits in the opening between y -0.18 and -0.02."""
    bx(b, 'grey_light', -0.9, 0.9, -0.45, 0.36, 0.0, 0.1, r=0.03)
    arch = [(-0.8, 0.1), (-0.38, 0.1), (-0.38, 0.52)]
    for i in range(1, 12):
        a = PI - PI * i / 12
        arch.append((0.38 * math.cos(a), 0.52 + 0.38 * math.sin(a)))
    arch += [(0.38, 0.52), (0.38, 0.1), (0.8, 0.1), (0.8, 1.1), (-0.8, 1.1)]
    front_prism(b, 'clay', arch, -0.38, -0.18, r=0.02)
    for i in range(9):
        a = PI * (i + 0.5) / 9
        b.box('brick_light', (0.45 * math.cos(a), -0.4, 0.52 + 0.45 * math.sin(a)), (0.13, 0.06, 0.1), r=0.02, rot=(0, -a, 0))
    for z in (0.18, 0.34):
        for s in (-1, 1):
            b.box('brick_light', (s * 0.46, -0.4, z), (0.13, 0.06, 0.1), r=0.02)
    bx(b, 'clay', -0.8, -0.42, -0.2, 0.36, 0.1, 1.1, r=0.02)
    bx(b, 'clay', 0.42, 0.8, -0.2, 0.36, 0.1, 1.1, r=0.02)
    bx(b, 'clay', -0.45, 0.45, 0.24, 0.36, 0.1, 1.1, r=0.02)
    bx(b, 'clay', -0.45, 0.45, -0.2, 0.36, 0.96, 1.1, r=0.02)
    bx(b, 'slate_dark', -0.43, 0.43, 0.08, 0.25, 0.1, 0.98, r=0.01)
    bx(b, 'slate_dark', -0.43, -0.39, -0.19, 0.25, 0.1, 0.98, r=0.01)
    bx(b, 'slate_dark', 0.39, 0.43, -0.19, 0.25, 0.1, 0.98, r=0.01)
    bx(b, 'brick_dark', -0.4, 0.4, -0.2, 0.2, 0.1, 0.13, r=0.01)
    bx(b, 'wood_mid', -0.9, 0.9, -0.47, 0.36, 1.1, 1.2, r=0.03)
    b.hull('cream', [(x, y, z) for x in (-0.7, 0.7) for y in (-0.3, 0.36) for z in (1.2,)] +
           [(x, y, 1.75) for x in (-0.42, 0.42) for y in (-0.12, 0.36)], r=0.025)
    bx(b, 'cream', -0.42, 0.42, -0.12, 0.36, 1.7, 2.55, r=0.025)
    bx(b, 'clay', -0.44, 0.44, -0.14, 0.36, 2.02, 2.1, r=0.02)
    # Mantel ornaments
    for x in (-0.66, -0.52):
        b.lathe('yellow_dark', [(0, 0), (0.035, 0), (0.04, 0.01), (0, 0.015)], loc=(x, -0.12, 1.2), seg=12)
        b.cyl('cream', (x, -0.12, 1.28), 0.018, 0.14, seg=10)
        flame(b, 'fire', x, -0.12, 1.35, 0.05, 0.014, seg=8)
    b.lathe('cab_blue', [(0, 0), (0.06, 0), (0.08, 0.06), (0.05, 0.16), (0.055, 0.2), (0, 0.2)], loc=(0.6, -0.1, 1.2), seg=16)
    b.sphere('red', (0.58, -0.1, 1.44), 0.05, seg=10)
    b.sphere('yellow', (0.63, -0.08, 1.46), 0.045, seg=10)


def fire(b, v):
    """Logs and three chunky flames for the fireplace opening."""
    for a, y in ((0.25, -0.09), (-0.25, -0.11)):
        b.cyl('wood_dark', (0, y, 0.165), 0.045, 0.42, rot=(0, PI / 2, a), seg=12, bevel=0.012)
    flame(b, 'ember', 0.0, -0.1, 0.17, 0.4, 0.13)
    flame(b, 'ember', -0.12, -0.08, 0.16, 0.26, 0.09)
    flame(b, 'ember', 0.13, -0.08, 0.16, 0.28, 0.09)
    flame(b, 'fire', 0.0, -0.13, 0.18, 0.28, 0.085)
    flame(b, 'yellow', 0.0, -0.15, 0.18, 0.16, 0.05)


def rug(b, v):
    """Rug, 2.0 x 1.4, 3 cm pile: border, field and a centre motif."""
    base, field, motif = ('red', 'cream', 'red_light') if v == 0 else ('blue', 'yellow', 'blue_light')
    b.prism(base, rrect(2.0, 1.4, 0.14), 0.016, r=0.005, loc=(0, 0, 0.008))
    b.prism(field, rrect(1.66, 1.06, 0.1), 0.008, r=0.003, loc=(0, 0, 0.018))
    if v == 0:
        b.prism(motif, [(0, -0.36), (0.55, 0), (0, 0.36), (-0.55, 0)], 0.008, r=0.003, loc=(0, 0, 0.023))
        b.prism(base, [(0, -0.16), (0.24, 0), (0, 0.16), (-0.24, 0)], 0.008, r=0.003, loc=(0, 0, 0.027))
    else:
        for y in (-0.33, 0.0, 0.33):
            b.prism(motif, rrect(1.4, 0.12, 0.05, cy=y), 0.008, r=0.003, loc=(0, 0, 0.023))


def plant(b, v):
    """Pot plant, ~1.13 m: v0 round topiary, v1 big-leaf plant."""
    b.lathe('pot_terracotta', [(0, 0), (0.12, 0), (0.14, 0.02), (0.17, 0.3), (0.2, 0.31), (0.2, 0.37), (0.17, 0.38),
                               (0.165, 0.35), (0, 0.35)], seg=20)
    b.cyl('coffee', (0, 0, 0.355), 0.16, 0.02, seg=18)
    if v == 0:
        b.cyl('wood_dark', (0, 0, 0.5), 0.025, 0.3, seg=8)
        rng = random.Random(5)
        for i in range(9):
            a = i * 2.4
            r = 0.14 + 0.02 * (i % 3)
            b.sphere('plant' if i % 3 else 'plant_dark', (math.cos(a) * 0.13, math.sin(a) * 0.13, 0.82 + (i % 3 - 1) * 0.1 + rng.uniform(-0.03, 0.03)), r, seg=12)
        b.sphere('plant', (0, 0, 0.97), 0.17, seg=14)
    else:
        for i in range(7):
            a = i * TAU7
            tilt = 0.55 + 0.1 * (i % 2)
            h = 0.72 + 0.08 * ((i * 3) % 4)
            tip = (math.cos(a) * 0.28, math.sin(a) * 0.28, h)
            b.tube('plant_dark', [(0, 0, 0.36), (tip[0] * 0.4, tip[1] * 0.4, h * 0.8), tip], 0.012, seg=6)
            b.sphere('plant' if i % 2 else 'green', (tip[0] * 1.15, tip[1] * 1.15, h + 0.06), 1.0, scale=(0.08, 0.15, 0.03),
                     rot=(tilt, 0, a + PI / 2), seg=12)


TAU7 = math.tau / 7


# ---------------------------------------------------------------- wall decor
def window(b, v):
    """Chunky frame for a 1.2 x 1.2 window opening centred on the origin, gingham curtains and a sill."""
    fr, dk = 'trim_orange', 'trim_orange_dark'
    for x0, x1, z0, z1 in ((-0.68, -0.6, -0.68, 0.68), (0.6, 0.68, -0.68, 0.68), (-0.68, 0.68, 0.6, 0.68), (-0.68, 0.68, -0.68, -0.6)):
        bx(b, fr, x0, x1, -0.07, 0.0, z0, z1, r=0.025)
    bx(b, fr, -0.025, 0.025, -0.05, 0.0, -0.6, 0.6, r=0.012)
    bx(b, fr, -0.6, 0.6, -0.05, 0.0, -0.025, 0.025, r=0.012)
    bx(b, dk, -0.76, 0.76, -0.16, 0.0, -0.76, -0.66, r=0.03)
    for x in (-0.5, 0.45):
        b.lathe('pot_terracotta', [(0, 0), (0.045, 0), (0.06, 0.08), (0.065, 0.09), (0, 0.09)], loc=(x, -0.09, -0.66), seg=12)
        b.sphere('plant' if x < 0 else 'pink', (x, -0.09, -0.52), 0.06, seg=10)
    b.tube('wood_dark', [(-0.86, -0.12, 0.78), (0.86, -0.12, 0.78)], 0.018, seg=8, round_ends=1)
    # Curtains: gathered stripes, tied back
    for s in (-1, 1):
        for i in range(4):
            x = s * (0.64 + i * 0.055)
            c = 'gingham_a' if i % 2 == 0 else 'gingham_b'
            b.tube(c, [(x, -0.13, 0.76), (x - s * 0.01, -0.14, 0.2), (x + s * 0.04, -0.13, -0.3), (x + s * 0.06, -0.12, -0.58)],
                   [(0.03, 0.022), (0.028, 0.02), (0.034, 0.022), (0.04, 0.024)], seg=8, round_ends=1)
        b.torus('trim_orange_dark', (s * 0.72, -0.14, -0.05), 0.1, 0.014, rot=(PI / 2, 0, 0), seg=16, tseg=6)
    for i in range(9):
        x = -0.72 + i * 0.18
        b.sphere('gingham_a' if i % 2 == 0 else 'gingham_b', (x, -0.12, 0.72), 1.0, scale=(0.1, 0.05, 0.08), seg=10)


def wall_shelf(b, v):
    """Wall shelf, 0.9 m, two brackets, jars with coloured lids and a mug."""
    bx(b, 'top_wood', -0.45, 0.45, -0.2, 0.0, -0.035, 0.0, r=0.015)
    for x in (-0.33, 0.33):
        b.prism('wood_mid', [(0, 0), (0, -0.17), (-0.16, 0)], 0.035, r=0.008, loc=(x, 0, -0.035), rot=(PI / 2, 0, PI / 2))
    lids = ['red', 'yellow', 'green', 'blue']
    for i, x in enumerate((-0.34, -0.2, -0.06)):
        h = (0.14, 0.18, 0.12)[i]
        b.lathe('glass', [(0, 0), (0.05, 0), (0.055, 0.02), (0.055, h), (0, h)], loc=(x, -0.1, 0.0), seg=14)
        b.lathe(['orange_light', 'bread', 'lettuce'][i], [(0, 0), (0.048, 0), (0.048, h * 0.6), (0, h * 0.6)], loc=(x, -0.1, 0.005), seg=12)
        b.cyl(lids[i], (x, -0.1, h + 0.015), 0.058, 0.03, seg=14, bevel=0.01)
    b.lathe('white', [(0, 0), (0.045, 0), (0.048, 0.1), (0, 0.1)], loc=(0.12, -0.1, 0.0), seg=14)
    b.torus('white', (0.172, -0.1, 0.05), 0.025, 0.009, rot=(PI / 2, 0, 0), seg=12, tseg=6)
    b.lathe('pot_terracotta', [(0, 0), (0.05, 0), (0.065, 0.1), (0, 0.1)], loc=(0.32, -0.1, 0.0), seg=14)
    for dx, dz in ((-0.03, 0.14), (0.03, 0.15), (0.0, 0.19)):
        b.sphere('plant', (0.32 + dx, -0.1, dz), 0.05, seg=10)


def picture(b, v):
    """Framed picture, 0.56 x 0.44: v0 hills and sun, v1 a flower pot."""
    bx(b, 'wood_mid' if v == 0 else 'trim_orange', -0.28, 0.28, -0.05, 0.0, -0.22, 0.22, r=0.03)
    bx(b, 'blue_light' if v == 0 else 'cream', -0.22, 0.22, -0.06, -0.045, -0.16, 0.16, r=0.006)
    if v == 0:
        front_prism(b, 'green', [(-0.22, -0.16), (0.22, -0.16), (0.22, -0.02), (0.1, 0.04), (-0.04, -0.03), (-0.22, 0.02)], -0.066, -0.058, r=0.002)
        front_prism(b, 'green_dark', [(-0.22, -0.16), (0.22, -0.16), (0.22, -0.1), (0.0, -0.06), (-0.22, -0.11)], -0.07, -0.062, r=0.002)
        b.cyl('yellow', (-0.12, -0.064, 0.08), 0.045, 0.008, rot=(PI / 2, 0, 0), seg=16)
    else:
        front_prism(b, 'pot_terracotta', [(-0.07, -0.14), (0.07, -0.14), (0.09, -0.04), (-0.09, -0.04)], -0.066, -0.058, r=0.002)
        front_prism(b, 'green', [(-0.008, -0.04), (0.008, -0.04), (0.008, 0.06), (-0.008, 0.06)], -0.064, -0.058)
        for i in range(6):
            a = i * math.tau / 6
            b.cyl('pink', (0.045 * math.cos(a), -0.066, 0.08 + 0.045 * math.sin(a)), 0.03, 0.008, rot=(PI / 2, 0, 0), seg=12)
        b.cyl('yellow', (0, -0.07, 0.08), 0.025, 0.008, rot=(PI / 2, 0, 0), seg=12)


def clock(b, v):
    """Round wall clock, 0.36 across."""
    b.cyl('blue', (0, -0.035, 0), 0.18, 0.07, rot=(PI / 2, 0, 0), seg=28, bevel=0.025)
    b.cyl('white', (0, -0.07, 0), 0.14, 0.012, rot=(PI / 2, 0, 0), seg=24, bevel=0.004)
    for i in range(12):
        a = i * math.tau / 12
        b.sphere('slate', (0.115 * math.cos(a), -0.078, 0.115 * math.sin(a)), 0.01 if i % 3 else 0.016, seg=6)
    bx(b, 'slate', -0.008, 0.008, -0.085, -0.077, -0.005, 0.08, r=0.004)
    b.box('red', (0.04, -0.086, 0.025), (0.1, 0.008, 0.014), r=0.004, rot=(0, -0.55, 0))
    b.sphere('slate', (0, -0.086, 0), 0.016, seg=8)


# ---------------------------------------------------------------- loose items
def apple(b, v):
    b.sphere('apple', (0, 0, 0.048), 0.048, scale=(1, 1, 0.92), seg=14)
    b.cyl('wood_dark', (0, 0, 0.098), 0.006, 0.03, seg=6)
    b.sphere('plant', (0.018, 0, 0.1), 1.0, scale=(0.024, 0.01, 0.008), rot=(0, -0.4, 0), seg=8)


BOOK = {0: 'red', 1: 'blue', 2: 'green'}


def book(b, v):
    c = BOOK[v]
    bx(b, c, -0.08, 0.08, -0.11, 0.11, 0.0, 0.011, r=0.005)
    bx(b, c, -0.08, 0.08, -0.11, 0.11, 0.029, 0.04, r=0.005)
    bx(b, c, -0.08, -0.064, -0.11, 0.11, 0.0, 0.04, r=0.007)
    bx(b, 'paper', -0.072, 0.074, -0.104, 0.104, 0.009, 0.031, r=0.003)
    bx(b, 'yellow', -0.03, 0.05, -0.05, 0.05, 0.039, 0.041, r=0.002)


def cup(b, v):
    b.lathe('white', [(0, 0), (0.04, 0), (0.044, 0.006), (0.045, 0.086), (0.041, 0.09), (0.036, 0.086), (0.035, 0.02), (0, 0.02)], seg=18)
    b.cyl('coffee', (0, 0, 0.07), 0.036, 0.004, seg=16)
    b.torus('white', (0.048, 0, 0.047), 0.022, 0.008, rot=(PI / 2, 0, 0), seg=12, tseg=6)


def candle(b, v):
    b.lathe('yellow_dark', [(0, 0), (0.03, 0), (0.032, 0.008), (0.012, 0.014), (0, 0.014)], seg=14)
    b.cyl('cream', (0, 0, 0.078), 0.016, 0.13, seg=12, bevel=0.004)
    b.cyl('black', (0, 0, 0.148), 0.002, 0.012, seg=4)
    flame(b, 'fire', 0, 0, 0.148, 0.034, 0.011, seg=8)


# ---------------------------------------------------------------- catalogue
# asset name -> (builder, variants). Variants export as <name>_v<i>; a single
# variant exports under the bare name, as the room code expects.
ASSETS = {
    'fu_bed': (bed, 2), 'fu_sofa': (sofa, 3), 'fu_armchair': (armchair, 2), 'fu_chair': (chair, 2),
    'fu_table': (table, 2), 'fu_coffee_table': (coffee_table, 1), 'fu_wardrobe': (wardrobe, 2),
    'fu_wardrobe_door': (wardrobe_door, 1), 'fu_fridge': (fridge, 1), 'fu_fridge_door': (fridge_door, 1),
    'fu_counter': (counter, 2), 'fu_stove': (stove, 1), 'fu_tv': (tv, 1), 'fu_tv_screen': (tv_screen, 1),
    'fu_radio': (radio, 1), 'fu_lamp_floor': (lamp_floor, 1), 'fu_lamp_table': (lamp_table, 1),
    'fu_fireplace': (fireplace, 1), 'fu_fire': (fire, 1), 'fu_bookshelf': (bookshelf, 2), 'fu_rug': (rug, 2),
    'fu_plant': (plant, 2), 'fu_desk': (desk, 1),
    'fu_window': (window, 1), 'fu_wall_shelf': (wall_shelf, 1), 'fu_picture': (picture, 2), 'fu_clock': (clock, 1),
    'it_apple': (apple, 1), 'it_book': (book, 3), 'it_cup': (cup, 1), 'it_candle': (candle, 1),
}


def names():
    """[(export name, builder, variant)] in catalogue order."""
    out = []
    for name, (fn, n) in ASSETS.items():
        for v in range(n):
            out.append((f'{name}_v{v}' if n > 1 else name, fn, v))
    return out
