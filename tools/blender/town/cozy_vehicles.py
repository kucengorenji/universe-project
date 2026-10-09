"""Rounded toy vehicles. Keep the existing metre-scale axles and attachment sockets."""
import math
import bmesh
from mathutils import Vector


def vehicle_builders(ns):
    def box(mat, loc, size, radius=.12):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
        radius = min(radius, min(size) * .46)
        if radius:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=radius,
                            segments=[4, 2, 1][ns['Q']], affect='EDGES')
        ns['_emit'](bm, mat, ns['M'](loc))

    cyl, sphere = ns['cyl'], ns['sphere']

    def lights(L, W, z):
        for sx in (-1, 1):
            cyl('chrome', (sx * W * .32, -L / 2 - .012, z), .19, .045, 20, rx=math.pi / 2)
            cyl('lamp', (sx * W * .32, -L / 2 - .06, z), .145, .018, 20, rx=math.pi / 2)
            box('tail', (sx * W * .32, L / 2 + .018, z), (.25, .045, .16), .06)
        for y in (-L / 2, L / 2):
            box('canvas', (0, y, z - .34), (W * .88, .16, .17), .075)
        if ns['Q'] < 2:
            box('steel_dark', (0, -L / 2 - .025, z - .10), (W * .28, .04, .14), .05)
            box('canvas', (0, L / 2 + .045, z - .21), (.36, .025, .13), .025)

    def loft(mat, profile, width, bevel=.04):
        # Extruded side profile with real wheel-arch cutouts; no body slab through the tyres.
        bm = bmesh.new()
        rows = [[bm.verts.new((x, y, z)) for y, z in profile] for x in (-width / 2, width / 2)]
        bm.faces.new(list(reversed(rows[0])))
        bm.faces.new(rows[1])
        for i in range(len(profile)):
            j = (i + 1) % len(profile)
            bm.faces.new([rows[0][i], rows[0][j], rows[1][j], rows[1][i]])
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        if bevel:
            bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel,
                            segments=[3, 2, 1][ns['Q']], affect='EDGES', clamp_overlap=True)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_area() < 1e-7], context='FACES_ONLY')
        ns['_emit'](bm, mat)

    def car(L, W, top, front, back, belt=.94, sill=.25, pickup=False, axles=None, radius=.34):
        axles = axles or (-L * .31, L * .30)
        profile = [(-L / 2 + .10, sill), (-L / 2, belt - .25),
                   (-L / 2 + .20, belt - .10), (front, belt), (back, belt),
                   (L / 2 - .12, belt - .07), (L / 2, belt - .23), (L / 2 - .10, sill)]
        # Lower edge goes from rear to front, rising around both wheel centres.
        arch = radius + .055
        for centre in sorted(axles, reverse=True):
            profile.append((centre + arch, sill))
            for i in range([12, 8, 6][ns['Q']] + 1):
                angle = math.pi * i / [12, 8, 6][ns['Q']]
                profile.append((centre + arch * math.cos(angle), radius + arch * math.sin(angle)))
            profile.append((centre - arch, sill))
        loft('paint', profile, W, .055)
        # A tapered glasshouse and sloping windshield give each type a readable silhouette.
        rise = top - belt
        rake = min(.38, (back - front) * .21)
        rf, rb = front + rake, back - (rake * .65 if not pickup else .07)
        low, high = W / 2 - .045, W / 2 - .17
        gz = top - .095
        ns['hull']('glass_dark', [(sx * low, y, belt + .015) for sx in (-1, 1) for y in (front, back)] +
                   [(sx * high, y, gz) for sx in (-1, 1) for y in (rf, rb)])
        box('canvas', (0, (rf + rb) / 2, top - .045), (high * 2 + .035, rb - rf + .10, .09), .043)
        # A/C pillars follow the windscreen rake; B pillars split the side windows.
        for sx in (-1, 1):
            count = 7 if L > 8 else 3 if back - front > 3 else 2
            for i in range(count + 1):
                t = i / count
                y0, y1 = front + (back - front) * t, rf + (rb - rf) * t
                ns['poly']('paint', [(sx * (low + .006), y0 - .055, belt),
                                     (sx * (low + .006), y0 + .055, belt),
                                     (sx * (high + .006), y1 + .055, gz),
                                     (sx * (high + .006), y1 - .055, gz)], [(0, 1, 2, 3)])
            if ns['Q'] < 2:
                for i in range(count):
                    y = front + (back - front) * (i + .72) / count
                    box('chrome', (sx * (W / 2 + .01), y, belt - .13), (.025, .17, .035), .012)
                box('paint', (sx * (W / 2 + .09), front + .18, belt + .10), (.18, .17, .105), .044)
                box('steel_dark', (sx * (W / 2 + .007), (front + back) / 2, sill + .04), (.025, back - front, .075), .015)
        for y in (front, back):
            box('paint', (0, y, belt + .026), (low * 2, .075, .055), .02)
        lights(L, W, belt - .08)

    def pickup():
        car(5.3, 1.95, 1.88, -1.05, .59, 1.10, .40, True, (-1.65, 1.7), .42)
        # An open warm wooden load bed rather than another cabin.
        box('wood', (0, 1.62, 1.115), (1.63, 1.95, .06), .02)
        for sx in (-1, 1):
            box('paint', (sx * .9, 1.64, 1.31), (.15, 2.02, .43), .06)
        box('paint', (0, 2.57, 1.31), (1.9, .16, .43), .065)

    def bus():
        car(11, 2.55, 3.55, -5.13, 5.12, 1.36, .45, axles=(-3.5, 3.1), radius=.5)
        # Separate large windows and a friendly cream belt replace the dark slab.
        for sx in (-1, 1):
            box('canvas', (sx * 1.28, 0, 1.24), (.035, 10.2, .19), .016)
            for y in (-3.2, -1.85, -.5, .85, 2.2, 3.55):
                box('paint', (sx * 1.14, y, 2.3), (.065, .14, 1.65), .025)
        box('canvas', (0, -5.18, 3.15), (1.55, .055, .27), .025)

    def cart(w=1.6, length=2.2, centre=.6):
        box('wood', (0, centre, 1.01), (w, length, .21), .08)
        for sx in (-1, 1):
            for z in (1.16, 1.39):
                box('wood_light', (sx * (w / 2 - .055), centre, z), (.14, length, .18), .06)
            for y in (centre - length / 2 + .1, centre + length / 2 - .1):
                box('wood', (sx * (w / 2 - .055), y, 1.26), (.18, .18, .70), .07)
        box('wood_light', (0, centre + length / 2 - .07, 1.30), (w, .16, .48), .065)
        for sx in (-.36, .36):
            box('wood', (sx, -1.10, 1.01), (.12, 2.50, .12), .05)
        box('wood', (0, centre - length / 2 + .22, 1.22), (w * .8, .44, .16), .075)

    def caravan():
        cart(1.9, 3.8, .9)
        # A barrel roof with visible thick edge, cream canvas and sage ribbons.
        seg = [20, 12, 8][ns['Q']]
        outer = [(math.cos(math.pi * i / seg) * .99, 1.18 + math.sin(math.pi * i / seg) * 1.13) for i in range(seg + 1)]
        inner = [(x * .94, z - .07) for x, z in reversed(outer)]
        ns['prism']('canvas', [(x, z) for x, z in outer + inner], 2.86, rz=math.pi / 2, loc=(0, 1.3, 0))
        if ns['Q'] < 2:
            for y in (.04, 1.3, 2.56):
                for i in range(seg):
                    a = math.pi * (i + .5) / seg
                    ns['box']('canvas_green', (math.cos(a), y, 1.18 + math.sin(a) * 1.14), (.045, .085, math.pi * 1.12 / seg), ry=-a, bevel=0)

    def horse():
        sphere('paint', (0, 0, 1.00), .48, (.72, 1.34, .95), sub=3)
        sphere('paint', (0, -.44, 1.38), .28, (.9, .88, 1.55), sub=3)
        sphere('paint', (0, -.68, 1.66), .29, (.94, 1.18, 1.06), sub=3)
        sphere('canvas', (0, -.94, 1.52), .20, (1.02, .92, .7), sub=3)
        for sx in (-1, 1):
            sphere('paint', (sx * .16, -.57, 1.98), .12, (.6, .65, 1.6), sub=2)
            sphere('mane', (sx * .247, -.77, 1.70), .045, (.38, 1, 1.2), sub=2)
            sphere('white', (sx * .259, -.795, 1.72), .012, sub=2)
            for j, y in enumerate((-.30, .38)):
                part = 1 + j * 4 + (2 if sx > 0 else 0)
                box(f'horse_{part}', (sx * .235, y, .62), (.20, .22, .36), .09)
                box(f'horse_{part + 1}', (sx * .235, y, .27), (.16, .18, .34), .075)
                box(f'horse_{part + 1}_hoof', (sx * .235, y - .025, .09), (.23, .29, .18), .08)
        sphere('mane', (0, -.36, 1.60), .22, (.75, .70, 1.7), sub=3)
        sphere('mane', (0, .62, 1.03), .18, (.65, .7, 1.8), sub=2)
        box('harness', (0, -.025, 1.36), (.69, .30, .08), .035)

    def wheel(wood=False):
        ns['_wheel']('wood_dark' if wood else 'rubber', 'wood_light' if wood else 'canvas', 'wood' if wood else 'chrome', 4)

    return {
        'vb_sedan': lambda: car(4.5, 1.85, 1.54, -.70, 1.32, axles=(-1.4, 1.35)),
        'vb_hatch': lambda: car(3.9, 1.78, 1.59, -.64, 1.68, axles=(-1.2, 1.2), radius=.32),
        'vb_suv': lambda: car(4.75, 1.98, 1.94, -.77, 2.02, 1.14, .42, axles=(-1.5, 1.5), radius=.42),
        'vb_van': lambda: car(5, 2, 2.30, -1.70, 2.40, 1.10, .35, axles=(-1.55, 1.6), radius=.36),
        'vb_pickup': pickup, 'vb_bus': bus,
        'vb_sport': lambda: car(4.45, 1.98, 1.24, -.40, 1.08, .73, .18, axles=(-1.35, 1.35)),
        'vb_cart': cart, 'vb_wagon': lambda: cart(1.8, 3.4, .8), 'vb_caravan': caravan,
        'vh_horse': horse, 'vw_road': wheel, 'vw_truck': wheel, 'vw_sport': wheel,
        'vw_wood': lambda: wheel(True),
    }
