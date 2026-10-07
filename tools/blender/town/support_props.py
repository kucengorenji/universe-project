"""Town support props with readable construction and authored three-level LODs.

The refresh generator supplies the primitive namespace from build_town_space.py.
No Blender scene, materials, files, or cached legacy meshes are changed here.
Coordinates remain metre scale, Blender Z-up, front -Y, origin at the base.
"""
import math


# Match the runtime proxies when an asset did not previously exist in town.glb.
PROXY_BOUNDS = {
    'g_cafe_a': ((-1.35, -1.35, 0), (1.35, 1.35, 2.605)),
    'g_cafe_b': ((-1.35, -1.35, 0), (1.35, 1.35, 2.605)),
    'g_fountain': ((-3.35, -3.35, 0), (3.35, 3.35, 3.15)),
    'g_kiosk': ((-1.24, -0.84124, 0), (1.24, 0.8, 3.125)),
    'g_bus_stop': ((-1.6, -0.75, -0.005), (2.15, 0.75, 2.8)),
    'g_hydrant': ((-0.21, -0.2, 0), (0.21, 0.2, 0.87)),
    'g_bin': ((-0.29, -0.29, 0.005), (0.29, 0.29, 0.91)),
    'f_fence': ((-1, -0.14, 0), (1, 0.14, 1.22)),
}


def support_builders(ns):
    """Return exact town asset names mapped to no-argument primitive builders.

    Each builder reads ns['Q'] at call time. Existing asset bounds supplied as
    ns['refresh_bounds'][name] are retained at every LOD. The caller owns mesh
    construction/export and revision metadata.
    """
    box, cyl, cone = ns['box'], ns['cyl'], ns['cone']
    poly, sphere = ns['poly'], ns['sphere']
    roof = ns['gable_roof']

    def q():
        return ns['Q']

    def ring(mat, z, outer, inner, height, segments=24, top_outer=None):
        # A real hollow rim: water/openings stay visible instead of being capped.
        n = segments if q() == 0 else max(8, segments // 2) if q() == 1 else 8
        top_outer = outer if top_outer is None else top_outer
        verts = []
        for r, zz in ((outer, z), (top_outer, z + height),
                      (inner, z + height), (inner, z)):
            verts.extend((r * math.cos(i * math.tau / n),
                          r * math.sin(i * math.tau / n), zz) for i in range(n))
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.extend(((i, j, n + j, n + i),
                          (n + i, n + j, 2 * n + j, 2 * n + i),
                          (2 * n + i, 2 * n + j, 3 * n + j, 3 * n + i),
                          (3 * n + i, 3 * n + j, j, i)))
        poly(mat, verts, faces)

    def beam(mat, start, end, width, depth=None):
        # Square-section diagonal braces; local Z follows the endpoint vector.
        dx, dy, dz = (end[k] - start[k] for k in range(3))
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length < 1e-6:
            return
        loc = tuple((start[k] + end[k]) / 2 for k in range(3))
        box(mat, loc, (width, depth or width, length),
            rz=math.atan2(dy, dx), ry=math.acos(dz / length), bevel=0)

    def pipe(mat, start, end, radius, segments=8):
        dx, dy, dz = (end[k] - start[k] for k in range(3))
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        if length > 1e-6:
            cyl(mat, start, radius, length, segments,
                rz=math.atan2(dy, dx), ry=math.acos(dz / length))

    def well():
        ring('stone_dark', 0, 1.43, 1.12, .95)
        cyl('water', (0, 0, .56), 1.115, .035, 24)
        ring('stone_light', .95, 1.55, 1.10, .14)
        if q() == 0:
            # Large staggered dressed stones have genuine mortar breaks.
            for row in range(3):
                for k in range(12):
                    a = (k + (row % 2) * .5) * math.tau / 12
                    box('stone' if (k + row) % 3 else 'stone_light',
                        (math.cos(a) * 1.36, math.sin(a) * 1.36, .17 + row * .30),
                        (.16, .66, .27), rz=a, bevel=.025)
        elif q() == 1:
            ring('stone', .08, 1.45, 1.12, .39, 16)
            ring('stone', .51, 1.45, 1.12, .39, 16)
        for sx in (-1, 1):
            box('timber', (sx * 1.25, 0, 1.6), (.20, .20, 2.4), bevel=.025)
        box('timber', (0, 0, 2.55), (2.8, .16, .16), bevel=0)
        roof('roof_red', 'roof_red_dark', (0, 0, 2.7),
             2.6, 1.6, .9, .25, ridge_x=True, tiles=q() == 0)
        if q() < 2:
            cyl('wood', (-1.06, 0, 2.30), .17, 2.12, 12, ry=math.pi / 2)
            cyl('iron', (0, 0, 1.43), .018, .89, 6)
            ring('wood', 1.10, .24, .18, .33, 12)
        if q() == 0:
            for sx in (-1, 1):
                beam('timber_light', (sx * 1.25, 0, 2.07),
                     (sx * .76, 0, 2.60), .11)
                cyl('iron', (sx * 1.03, 0, 2.30), .185, .065, 10, ry=math.pi / 2)
            beam('iron', (1.16, 0, 2.30), (1.16, 0, 1.96), .055)
            cyl('wood_light', (1.16, 0, 1.96), .06, .18, 8, ry=math.pi / 2)
            # Two straps and an upright bucket handle communicate the mechanism.
            ring('iron', 1.13, .247, .20, .035, 12)
            ring('iron', 1.38, .247, .20, .035, 12)
            beam('iron', (-.20, 0, 1.41), (0, 0, 1.62), .02)
            beam('iron', (.20, 0, 1.41), (0, 0, 1.62), .02)

    def stall(variant):
        colour, stripe = (('canvas_red', 'canvas'), ('canvas_blue', 'canvas'),
                          ('canvas_green', 'canvas_yellow'))[variant]
        box('wood', (0, 0, .50), (3.4, 2, 1), bevel=.035)
        box('wood_light', (0, -.04, 1.02), (3.4, 2, .09), bevel=.025)
        for sx in (-1, 1):
            for sy in (-1, 1):
                box('timber', (sx * 1.6, sy * .95, 1.35), (.14, .14, 2.7), bevel=.02)
        n = 6 if q() == 0 else 2 if q() == 1 else 1
        for k in range(n):
            w = 3.8 / n
            x = -1.9 + w * (k + .5)
            col = colour if k % 2 == 0 else stripe
            box(col, (x, 0, 2.75), (w, 2.6, .10), rx=.18, bevel=0)
            if q() == 0:
                # Short scalloped canvas valance under the front eave.
                poly(col, [(-w/2, -1.30, 2.53), (w/2, -1.30, 2.53),
                           (w/2, -1.30, 2.40), (0, -1.30, 2.34),
                           (-w/2, -1.30, 2.40)], [[4, 3, 2, 1, 0]], loc=(x, 0, 0))
        if q() < 2:
            box('timber_light', (0, -1.01, .20), (3.36, .07, .15), bevel=0)
            box('timber_light', (0, -1.01, .90), (3.36, .07, .12), bevel=0)
        if q() == 0:
            for x in (-1.2, -.4, .4, 1.2):
                box('wood_light', (x, -1.015, .53), (.035, .045, .55), bevel=0)
            for k in range(4):
                x = -1.2 + k * .80
                box('wood_light', (x, -.24, 1.20), (.68, .75, .30), bevel=.02)
                box('wood', (x, -.24, 1.37), (.55, .60, .02), bevel=0)
                for j in range(3):
                    sphere(('canvas_red', 'canvas_yellow', 'leaf')[k % 3],
                           (x - .17 + j * .17, -.39 + (j % 2) * .15, 1.45), .10, sub=1)
            for sx in (-1, 1):
                beam('timber_light', (sx * 1.6, -.95, 2.18),
                     (sx * 1.13, -.95, 2.65), .09)
        elif q() == 1:
            for k in range(3):
                box(('canvas_red', 'canvas_yellow', 'leaf')[k],
                    (-1 + k, -.18, 1.20), (.74, .75, .29), bevel=0)

    def fantasy_lamp():
        cyl('stone_dark', (0, 0, 0), .12, .18, 12)
        cyl('timber', (0, 0, .18), .11, 3.02, 12, r2=.085)
        box('iron', (0, -.30, 3), (.08, .60, .08), bevel=0)
        cone('iron', (0, -.55, 2.95), .30, .30, 4, rz=math.pi / 4)
        box('glass_lit', (0, -.55, 2.70), (.28, .30, .38), bevel=0)
        if q() < 2:
            for z in (2.47, 2.93):
                box('iron', (0, -.55, z), (.36, .36, .045), bevel=0)
            for sx in (-1, 1):
                for sy in (-1, 1):
                    box('iron', (sx * .155, -.55 + sy * .155, 2.70),
                        (.035, .035, .44), bevel=0)
        if q() == 0:
            beam('iron', (0, -.03, 2.72), (0, -.40, 3), .04)
            for z in (.27, 2.90):
                cyl('iron', (0, 0, z), .122 if z < 1 else .10, .06, 12)
            cone('iron', (0, -.55, 2.36), .08, .10, 4, rz=math.pi / 4)

    def modern_lamp():
        cyl('steel_dark', (0, 0, 0), .16, .50, 16)
        cyl('steel', (0, 0, .50), .10, 6, 12, r2=.07)
        box('steel_dark', (0, -.80, 6.35), (.10, 1.70, .10), bevel=.02)
        box('steel_dark', (0, -1.55, 6.25), (.45, .70, .16), bevel=.04)
        box('lamp', (0, -1.55, 6.15), (.36, .60, .06), bevel=0)
        if q() == 0:
            cyl('steel', (0, 0, .02), .157, .06, 16)
            for sx in (-1, 1):
                for sy in (-1, 1):
                    cyl('iron', (sx * .08, sy * .08, .08), .018, .018, 6)
            box('steel_dark', (0, -.093, .67), (.10, .016, .24), bevel=.02)
            beam('steel', (0, 0, 6.02), (0, -.48, 6.35), .055)
            for y in (-1.73, -1.55, -1.37):
                box('white', (0, y, 6.112), (.29, .02, .008), bevel=0)

    def bench():
        seats = 5 if q() == 0 else 2 if q() == 1 else 1
        backs = 4 if q() == 0 else 2 if q() == 1 else 1
        for k in range(seats):
            d = .54 / seats
            box('wood_deck', (0, -.29 + d * (k + .5), .48),
                (1.9, d - (.02 if q() == 0 else 0), .06), bevel=.01)
        for k in range(backs):
            h = .38 / backs
            box('wood_deck', (0, .32, .65 + h * (k + .5)),
                (1.9, .05, h - (.015 if q() == 0 else 0)), rx=-.20, bevel=0)
        for x in (-.8, .8):
            box('steel_dark', (x, 0, .24), (.08, .60, .48), bevel=.025)
            box('steel_dark', (x, .32, .70), (.08, .06, .50), bevel=0)
            if q() == 0:
                box('steel_dark', (x, 0, .03), (.20, .60, .06), bevel=.02)
                box('steel_dark', (x, -.07, .72), (.065, .44, .045), bevel=.015)
                box('steel_dark', (x, -.24, .59), (.045, .045, .24), bevel=0)
                for y in (-.20, .14):
                    cyl('iron', (x, y, .51), .012, .008, 6)

    def cafe(variant):
        colour = 'canvas_red' if variant == 0 else 'canvas_green'
        cyl('steel_dark', (0, 0, 0), .25, .04, 16)
        cyl('steel_dark', (0, 0, .04), .035, 2.44, 12)
        cyl('wood_deck', (0, 0, .715), .42, .05, 24)
        if q() < 2:
            ring('timber', .72, .425, .395, .04, 24)
        for s in (-1, 1):
            box('wood_deck', (s * .72, 0, .46), (.42, .42, .05), bevel=.015)
            box('wood_deck', (s * .92, 0, .70), (.05, .42, .46), bevel=.02)
            for sy in (-1, 1):
                box('steel_dark', (s * .72, sy * .17, .23), (.04, .04, .46), bevel=0)
            if q() == 0:
                # Real back/seat seams and lower chair bracing, not surface noise.
                for y in (-.12, 0, .12):
                    box('timber_light', (s * .953, y, .70), (.016, .018, .40), bevel=0)
                box('steel_dark', (s * .72, 0, .18), (.035, .36, .035), bevel=0)
                for sy in (-1, 1):
                    beam('steel_dark', (s * .72, sy * .17, .45),
                         (s * .90, sy * .17, .80), .03)
        n = 16 if q() == 0 else 8 if q() == 1 else 4
        # Two sloping facets per fabric panel give the parasol a supported profile.
        for k in range(n):
            a, b = k * math.tau / n, (k + 1) * math.tau / n
            verts = [(0, 0, 2.605),
                     (.57 * math.cos(a), .57 * math.sin(a), 2.49),
                     (.57 * math.cos(b), .57 * math.sin(b), 2.49),
                     (1.35 * math.cos(a), 1.35 * math.sin(a), 2.13),
                     (1.35 * math.cos(b), 1.35 * math.sin(b), 2.13)]
            poly(colour if k % 2 == 0 or q() == 2 else 'canvas', verts,
                 [[0, 1, 2], [1, 3, 4, 2]])
            if q() == 0:
                poly(colour if k % 2 == 0 else 'canvas',
                     [verts[3], verts[4],
                      (verts[4][0], verts[4][1], 2.065),
                      (verts[3][0], verts[3][1], 2.065)], [[0, 1, 2, 3]])
                if k % 2 == 0:
                    beam('steel', (0, 0, 2.57),
                         (1.28 * math.cos(a), 1.28 * math.sin(a), 2.115), .018)
        if q() == 0:
            for s in (-1, 1):
                cyl('white', (s * .17, 0, .767), .105, .014, 12)
                cyl('canvas', (s * .17, 0, .781), .035, .07, 8)

    def fountain():
        cyl('stone_dark', (0, 0, 0), 3.35, .14, 32)
        ring('stone', .14, 3.29, 2.85, .41, 32, top_outer=3.20)
        ring('stone_light', .52, 3.22, 2.85, .08, 32)
        cyl('water', (0, 0, .515), 2.848, .055, 32)
        cyl('stone', (0, 0, .30), .55, 1.60, 16, r2=.40)
        cyl('stone_light', (0, 0, 1.90), .46, .09, 16)
        cyl('stone', (0, 0, 1.925), .35, .27, 24, r2=1.16)
        ring('stone_light', 2.19, 1.20, 1.02, .085, 24)
        cyl('water', (0, 0, 2.255), 1.015, .035, 24)
        cone('water', (0, 0, 2.29), .085, .86, 12)
        if q() == 0:
            for k in range(16):
                a = k * math.tau / 16
                box('stone_dark', (3.255 * math.cos(a), 3.255 * math.sin(a), .35),
                    (.015, .035, .32), rz=a, bevel=0)
            for k in range(4):
                a = k * math.tau / 4 + math.pi / 4
                points = [(math.cos(a) * r, math.sin(a) * r, z)
                          for r, z in ((1.05, 2.26), (1.24, 2.17),
                                       (1.40, 1.84), (1.50, 1.27), (1.53, .58))]
                for start, end in zip(points, points[1:]):
                    pipe('water', start, end, .025, 6)
        elif q() == 1:
            for s in (-1, 1):
                pipe('water', (s * 1.10, 0, 2.22), (s * 1.47, 0, .58), .022, 6)

    def kiosk():
        box('wood_deck', (0, 0, .55), (2.40, 1.60, 1.10), bevel=.03)
        if q() < 2:
            box('timber', (0, -.805, .55), (2.16, .035, .81), bevel=0)
            box('canvas_green', (0, -.83, .55), (1.90, .015, .58), bevel=0)
            box('wood_light', (0, -.05, 1.13), (2.30, 1.40, .10), bevel=.025)
        box('wood_deck', (0, .70, 1.70), (2.40, .20, 1.20), bevel=.025)
        if q() < 2:
            box('glass_dark', (0, .588, 1.72), (1.65, .024, .83), bevel=0)
        for sx in (-1, 1):
            box('timber', (sx * 1.10, -.75, 1.80), (.08, .08, 1.30), bevel=0)
        stripes = 4 if q() == 0 else 2 if q() == 1 else 1
        for k in range(stripes):
            w = 2.48 / stripes
            box('canvas_red' if k % 2 == 0 else 'canvas',
                (-1.24 + w * (k + .5), -.25, 2.45), (w, 1.20, .08),
                rx=-.25, bevel=0)
        box('timber', (0, .62, 2.95), (2, .05, .35), bevel=.02)
        if q() < 2:
            box('canvas', (0, .585, 2.95), (1.84, .018, .23), bevel=0)
        if q() == 0:
            for x in (-.94, 0, .94):
                box('wood_light', (x, -.848, .55), (.025, .018, .59), bevel=0)
            for z in (1.38, 2.07):
                box('wood_light', (0, .57, z), (1.73, .025, .045), bevel=0)
            box('wood_light', (0, .566, 1.72), (.04, .025, .70), bevel=0)
            box('steel_dark', (.67, .36, 1.38), (.37, .38, .42), bevel=.025)
            box('steel', (.67, .155, 1.33), (.27, .035, .17), bevel=0)
            for x in (-.25, -.02):
                cyl('white', (x, -.38, 1.19), .065, .11, 8)
            box('steel_dark', (-.74, -.77, 1.48), (.36, .035, .50), bevel=.01)
            for k in range(3):
                box('canvas', (-.74, -.795, 1.62 - k * .10), (.25, .01, .015), bevel=0)

    def bus_stop():
        box('steel_dark', (0, 0, 2.45), (3.20, 1.50, .10), bevel=.035)
        if q() < 2:
            box('steel', (0, -.705, 2.39), (3.16, .06, .08), bevel=0)
        for x in (-1.55, 1.55):
            box('steel_dark', (x, .68, 1.22), (.08, .08, 2.45), bevel=.02)
        panels = 3 if q() == 0 else 1
        for k in range(panels):
            w = 3 / panels
            box('glass_teal', (-1.50 + w * (k + .5), .68, 1.35),
                (w - (.025 if q() == 0 else 0), .055, 1.90), bevel=0)
        box('glass_teal', (-1.50, .10, 1.35), (.055, 1.20, 1.90), bevel=0)
        box('wood_deck', (.30, .42, .48), (2, .40, .08), bevel=.02)
        if q() < 2:
            for x in (-.40, 1):
                box('steel_dark', (x, .42, .24), (.065, .29, .48), bevel=0)
        cyl('steel_dark', (1.90, -.60, 0), .05, 2.60, 12)
        box('accent_green', (1.90, -.60, 2.55), (.50, .05, .50), bevel=.02)
        if q() == 0:
            for x in (-.50, .50):
                box('steel', (x, .642, 1.35), (.035, .025, 1.90), bevel=0)
            box('steel', (-1.50, -.50, 1.35), (.065, .07, 2.05), bevel=0)
            box('steel_dark', (-.99, .636, 1.54), (.66, .035, .98), bevel=.01)
            box('canvas', (-.99, .61, 1.54), (.57, .018, .87), bevel=0)
            box('accent_green', (-1.10, .592, 1.54), (.018, .012, .58), bevel=0)
            for z in (1.34, 1.54, 1.74):
                box('accent_yellow', (-1.10, .581, z), (.045, .014, .045), bevel=0)
                box('steel_dark', (-.92, .581, z), (.19, .014, .014), bevel=0)
            box('white', (1.90, -.633, 2.57), (.32, .018, .19), bevel=0)
            for k in range(2):
                box('steel_dark', (1.82 + k * .16, -.647, 2.46), (.05, .01, .05), bevel=0)

    def hydrant():
        cyl('accent_red', (0, 0, 0), .20, .09, 16)
        cyl('accent_red', (0, 0, .09), .155, .61, 16, r2=.16)
        # Low-poly domed cap, with a physically separate horizontal outlet.
        n = 12 if q() == 0 else 8 if q() == 1 else 4
        verts = []
        for radius, z in ((.17, .70), (.147, .785), (.085, .847)):
            verts.extend((radius * math.cos(k * math.tau / n),
                          radius * math.sin(k * math.tau / n), z) for k in range(n))
        verts.append((0, 0, .87))
        faces = []
        for row in range(2):
            for k in range(n):
                j = (k + 1) % n
                faces.append((row*n+k, row*n+j, (row+1)*n+j, (row+1)*n+k))
        for k in range(n):
            faces.append((2*n+k, 2*n+(k+1) % n, 3*n))
        poly('accent_red', verts, faces)
        cyl('accent_red', (-.21, 0, .45), .07, .42, 12, ry=math.pi / 2)
        if q() < 2:
            for s in (-1, 1):
                cyl('steel_dark', (s * .195, 0, .45), .085, .015, 8,
                    ry=s * math.pi / 2)
        if q() == 0:
            ring('steel_dark', .67, .171, .145, .025, 16)
            for k in range(4):
                a = k * math.tau / 4 + math.pi / 4
                cyl('steel_dark', (.151 * math.cos(a), .151 * math.sin(a), .09),
                    .013, .012, 6)
            box('steel_dark', (0, -.155, .28), (.065, .02, .10), bevel=.008)

    def bin_prop():
        cyl('steel_dark', (0, 0, .005), .23, .065, 16)
        ring('steel_dark', .065, .23, .19, .79, 24, top_outer=.26)
        ring('steel', .85, .29, .21, .06, 24)
        cyl('rubber', (0, 0, .70), .19, .012, 16)
        if q() == 0:
            for k in range(12):
                a = k * math.tau / 12
                box('steel', (.244 * math.cos(a), .244 * math.sin(a), .46),
                    (.023, .055, .67), rz=a, bevel=.008)
            box('steel_dark', (0, -.265, .73), (.20, .025, .075), bevel=.015)
            box('accent_green', (0, -.255, .53), (.14, .018, .14), bevel=.01)

    def fence():
        for s in (-1, 1):
            box('timber', (s * .88, 0, .55), (.24, .24, 1.10), bevel=.03)
            cone('wood_light', (s * .88, 0, 1.10), .17, .12, 4, rz=math.pi / 4)
        for z in (.32, .83):
            box('timber_light', (0, .065, z), (1.76, .12, .115), bevel=.015)
        n = 7 if q() == 0 else 4 if q() == 1 else 2
        for k in range(n):
            x = -.72 + 1.44 * k / max(1, n-1)
            box('wood', (x, -.065, .57), (.105, .10, .82), bevel=.018)
            poly('wood_light', [(x-.0525, -.115, .98), (x+.0525, -.115, .98),
                                (x, -.115, 1.055), (x-.0525, -.015, .98),
                                (x+.0525, -.015, .98), (x, -.015, 1.055)],
                 [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]])
            if q() == 0:
                for z in (.32, .83):
                    box('iron', (x, -.12, z), (.025, .012, .025), bevel=0)

    def bounded(name, builder):
        def build():
            parts = ns['PARTS']
            start = len(parts)
            builder()
            bounds = ns.get('refresh_bounds', {}).get(name, PROXY_BOUNDS.get(name))
            if not bounds:
                return
            if isinstance(bounds, dict):
                if 'min' in bounds:
                    lo, hi = bounds['min'], bounds['max']
                else:
                    lo = (bounds['minX'], bounds['minY'], bounds['minZ'])
                    hi = (bounds['maxX'], bounds['maxY'], bounds['maxZ'])
            else:
                lo, hi = bounds
            points = [v for verts, _, _ in parts[start:] for v in verts]
            old_lo = [min(v[k] for v in points) for k in range(3)]
            old_hi = [max(v[k] for v in points) for k in range(3)]
            scale = [(hi[k] - lo[k]) / (old_hi[k] - old_lo[k])
                     if old_hi[k] - old_lo[k] > 1e-7 else 1 for k in range(3)]
            for i in range(start, len(parts)):
                verts, faces, mat = parts[i]
                parts[i] = ([tuple(lo[k] + (v[k] - old_lo[k]) * scale[k]
                                  for k in range(3)) for v in verts], faces, mat)
        return build

    builders = {
        'f_well': well,
        'f_market_stall_v0': lambda: stall(0),
        'f_market_stall_v1': lambda: stall(1),
        'f_market_stall_v2': lambda: stall(2),
        'f_lamp': fantasy_lamp,
        'm_lamp': modern_lamp,
        'm_bench': bench,
        'g_cafe_a': lambda: cafe(0),
        'g_cafe_b': lambda: cafe(1),
        'g_fountain': fountain,
        'g_kiosk': kiosk,
        'g_bus_stop': bus_stop,
        'g_hydrant': hydrant,
        'g_bin': bin_prop,
        'f_fence': fence,
    }
    return {name: bounded(name, builder) for name, builder in builders.items()}
