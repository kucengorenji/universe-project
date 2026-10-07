"""Town revision 1: composed architecture, painted palette, authored three-level LOD.

Builders use the production pack's primitive accumulator. Front is Blender -Y.
Layout metadata stays independent of presentation geometry for saved towns.
"""
import math

BUILDING_VARIANTS = {
    'f_house_small': 3, 'f_house': 3, 'f_house_tall': 2, 'f_townhouse': 2,
    'f_shop': 2, 'f_tavern': 1, 'f_castle': 1, 'f_temple': 1, 'f_tower': 1,
    'm_house': 3, 'm_shop': 2, 'm_apartment': 2, 'm_office': 2,
    'm_tower_a': 1, 'm_tower_b': 1, 'm_spire': 1,
}


def building_builders(ns):
    box, cyl, cone, poly = (ns[k] for k in ('box', 'cyl', 'cone', 'poly'))
    roof, ends, hip = (ns[k] for k in ('gable_roof', 'gable_ends', 'hip_roof'))
    q = lambda: ns['Q']
    B = lambda mat, loc, size: box(mat, loc, size, bevel=0)
    wall_palette = ['plaster_c', 'plaster_b', 'plaster_d', 'plaster']
    roof_palette = [('roof_slate', 'roof_slate_dark'), ('roof_red', 'roof_red_dark'),
                    ('roof_blue', 'roof_blue_dark'), ('roof_brown', 'roof_brown_dark')]

    def panel(x, y, z, w, h, facing=0, frame='stone_light', glass='glass', mullion=True, sill=True):
        """Dark reveals, inset glass and a light outer frame; no coplanar decals."""
        if q() == 2:
            return
        # Local coordinates: width tangent to facade, outward normal toward -Y.
        def piece(mat, dx, normal, dz, sx, depth, sz):
            if facing == 0:
                B(mat, (x + dx, y - normal, z + dz), (sx, depth, sz))
            elif facing == 2:
                B(mat, (x - dx, y + normal, z + dz), (sx, depth, sz))
            elif facing == 1:
                B(mat, (x + normal, y + dx, z + dz), (depth, sx, sz))
            else:
                B(mat, (x - normal, y - dx, z + dz), (depth, sx, sz))
        piece('steel_dark' if glass.startswith('glass_') else 'timber', 0, .035, 0, w + .18, .12, h + .18)
        piece(glass, 0, .108, 0, w - .10, .04, h - .10)
        if q() == 0:
            for dx in (-w / 2, w / 2):
                piece(frame, dx, .14, 0, .12, .15, h + .22)
            for dz in (-h / 2, h / 2):
                piece(frame, 0, .14, dz, w + .22, .15, .12)
            if mullion:
                piece(frame, 0, .145, 0, .07, .13, h)
                piece(frame, 0, .145, -.1, w, .13, .06)
            if sill:
                piece(frame, 0, .23, -h / 2 - .1, w + .32, .36, .12)

    def entrance(x, y, base=0, w=1.2, h=2.35, modern=False):
        if q() == 2:
            return
        panel(x, y, base + h / 2, w, h, frame='concrete_light' if modern else 'stone_light',
              glass='glass_dark' if modern else 'door', mullion=False, sill=False)
        if q() == 0:
            B('steel' if modern else 'iron', (x + w * .27, y - .225, base + h * .45), (.07, .08, .3))
            B('concrete_dark' if modern else 'stone_dark', (x, y - .34, base + .08), (w + .55, .75, .16))

    def cornice(w, d, z, mat='stone_light', depth=.2, cx=0, cy=0):
        B(mat, (cx, cy, z), (w + depth * 2, d + depth * 2, .22 if q() else .28))
        if q() == 0:
            B('stone_dark' if not mat.startswith('concrete') else 'concrete_dark',
              (cx, cy, z - .18), (w + depth, d + depth, .08))

    def roof_services(w, d, z, variant=0):
        # Broad silhouettes stay at LOD1; individual vents/grilles vanish.
        if q() == 2:
            return
        B('concrete_dark', (-w * .18, d * .12, z + .42), (w * .28, d * .3, .85))
        for x in (w * .12, w * .3):
            B('steel_dark', (x, d * .13, z + .28), (1.25, 1.15, .56))
            if q() == 0:
                cyl('steel', (x, d * .13, z + .57), .38, .08, 12)
                for k in range(4):
                    B('steel', (x - .42 + k * .28, d * .13 - .59, z + .28), (.045, .04, .38))
        if q() == 0:
            B('steel_dark', (-w * .27, -d * .26, z + .23), (1.7, 1.45, .32))
            for k in range(3):
                B('glass_blue', (-w * .27 + (k - 1) * .58, -d * .26, z + .41), (.53, 1.35, .07))

    def facade_grid(w, d, z0, floors, fh, bays, mat='concrete_light', glass='glass_blue', side_bays=None):
        if q() == 2:
            # Continuous ribbons are intentionally absent: silhouette carries far LOD.
            return
        for f in range(floors):
            z = z0 + f * fh + fh * .51
            for facing, y in ((0, -d / 2), (2, d / 2)):
                for k in range(bays):
                    x = -w / 2 + w * (k + .5) / bays
                    panel(x, y, z, min(w / bays * .67, 2.55), fh * .53, facing, mat, glass)
            for facing, x in ((1, w / 2), (3, -w / 2)):
                for k in range(side_bays or max(2, round(bays * d / w))):
                    n = side_bays or max(2, round(bays * d / w))
                    y = -d / 2 + d * (k + .5) / n
                    panel(x, y, z, min(d / n * .67, 2.4), fh * .53, facing, mat, glass)

    def balcony(x, y, z, w=2.8, depth=1.0, modern=False):
        if q() == 2:
            return
        B('concrete_light' if modern else 'wood', (x, y - depth / 2, z), (w, depth, .18))
        B('steel_dark' if modern else 'timber', (x, y - depth + .08, z + .55), (w, .1, .1))
        for sx in (-1, 1):
            B('steel_dark' if modern else 'timber', (x + sx * (w / 2 - .08), y - depth / 2, z + .55), (.1, depth, .1))
        if q() == 0:
            for k in range(6):
                B('steel_dark' if modern else 'timber', (x - w / 2 + .13 + k * (w - .26) / 5, y - depth + .08, z + .3), (.065, .07, .55))
            for sx in (-1, 1):
                B('steel_dark' if modern else 'timber', (x + sx * (w / 2 - .08), y - .08, z + .3), (.065, .07, .55))

    def fantasy_house(family, v):
        configs = {
            'f_house_small': (6.2, 5.6, 1), 'f_house': (7.6, 6.6, 2),
            'f_house_tall': (7., 7.4, 3), 'f_townhouse': (6., 9.4, 3),
            'f_shop': (8., 7.4, 2), 'f_tavern': (11.6, 8.6, 2),
        }
        w, d, floors = configs[family]
        fh, base = 2.9, .45
        H = base + floors * fh
        wall = wall_palette[(v + (2 if family == 'f_shop' else 0)) % 4]
        r, rd = roof_palette[(v + (1 if family == 'f_tavern' else 0)) % 4]
        ridge_x = family not in ('f_townhouse', 'f_house_tall') and v != 1
        pitch = (d if ridge_x else w) / 2 * .9
        B('stone_dark', (0, 0, base / 2), (w + .18, d + .18, base))
        # Street level masonry and individually composed upper facade volumes.
        B('stone' if family in ('f_shop', 'f_tavern') else wall, (0, 0, base + fh / 2), (w, d, fh))
        if floors > 1:
            B(wall, (0, -.06, base + fh + (floors - 1) * fh / 2), (w + .16, d + .16, (floors - 1) * fh))
        cornice(w, d, base + fh, 'timber', depth=.16)
        cornice(w + .1, d + .1, H, 'timber', depth=.18)
        ends(wall, (0, 0, H), w + .12, d + .12, pitch, ridge_x)
        roof(r, rd, (0, 0, H), w + .12, d + .12, pitch, over=.38, ridge_x=ridge_x, tiles=q() == 0)
        bays = max(2, int((w - .6) / 2.2))
        dx = -w / 2 + w / bays * (bays // 2 + .5)
        entrance(dx, -d / 2, base, w=1.2)
        if q() < 2:
            for f in range(floors):
                z = base + f * fh + 1.45
                for k in range(bays):
                    x = -w / 2 + w / bays * (k + .5)
                    if f == 0 and k == bays // 2:
                        continue
                    panel(x, -d / 2 - (.08 if f else 0), z, 1.15 if family != 'f_shop' else 1.65, 1.55,
                          frame='timber', glass='glass_lit' if (k + f + v) % 5 == 0 else 'glass')
                    panel(-x, d / 2 + (.08 if f else 0), z, 1.05, 1.4, 2, 'timber')
                for sx, side in ((1, 1), (-1, 3)):
                    for y in (-d * .27, d * .27):
                        panel(sx * (w / 2 + (.08 if f else 0)), y, z, 1.05, 1.45, side, 'timber')
                if q() == 0:
                    for x in (-w / 2 + .04, w / 2 - .04):
                        B('timber', (x, -d / 2 - .15, base + f * fh + fh / 2), (.18, .18, fh))
                    if floors > 1:
                        for x in (-w * .18, w * .18):
                            B('timber', (x, -d / 2 - .15, base + f * fh + fh / 2), (.12, .14, fh))
                        # Diagonal bracing reads at walk camera, removed at LOD1.
                        for sx in (-1, 1):
                            box('timber', (sx * w * .31, -d / 2 - .16, base + f * fh + 1.2),
                                (.12, .14, 1.9), ry=sx * .55, bevel=0)
            # Stone quoins, continuous rain gutter and tapered chimney cap.
            if q() == 0:
                for sx in (-1, 1):
                    for z in (.8, 1.6, 2.4):
                        B('stone_light', (sx * (w / 2 - .08), -d / 2 - .07, z), (.44, .22, .22))
                B('iron', (w / 2 + .15, -d / 2 + .07, H / 2), (.1, .1, H))
            B('brick_dark', (-w * .24, d * .2, H + pitch * .48), (.62, .65, pitch * .66))
            B('stone_dark', (-w * .24, d * .2, H + pitch * .81), (.85, .9, .18))
            if v == 2 or family in ('f_townhouse', 'f_tavern'):
                # A proper dormer volume, window and separate roof.
                B(wall, (-w * .24, -d * .23, H + .65), (1.5, 1.7, 1.25))
                ends(wall, (-w * .24, -d * .23, H + 1.25), 1.5, 1.7, .7, False)
                roof(r, rd, (-w * .24, -d * .23, H + 1.25), 1.5, 1.7, .7, .12, False, False)
                panel(-w * .24, -d * .23 - .85, H + .6, .7, .85, frame='timber')
            if family == 'f_house_small' and v == 1:
                B('stone', (4.4, .6, 1.4), (2.45, 3.8, 2.8))
                roof(r, rd, (4.4, .6, 2.8), 2.45, 3.8, 1.2, .12, False, False)
                panel(4.4, -1.3, 1.6, 1.4, 1.3)
            if family in ('f_shop', 'f_tavern'):
                aw = 5.4 if family == 'f_tavern' else 6.4
                y = -d / 2 - .48
                B('timber', (0, y, 2.75), (aw, 1.0, .12))
                for k in range(6):
                    B('canvas' if k % 2 else ('canvas_green' if family == 'f_tavern' else 'canvas_red'),
                      (-aw / 2 + aw * (k + .5) / 6, y, 2.85), (aw / 6 - .015, 1.05, .12))
                for sx in (-1, 1):
                    B('timber', (sx * (aw / 2 - .12), y - .42, 1.36), (.14, .14, 2.72))
                if q() == 0:
                    B('wood', (-w * .3, y + .14, .85), (1.4, .55, .65))
                    for k in range(3):
                        cyl('pot', (-w * .3 - .4 + k * .4, y + .14, 1.18), .16, .2, 8)
                    B('iron', (w * .38, -d / 2 - .3, 3.6), (.07, .6, .07))
                    B('wood', (w * .38, -d / 2 - .62, 3.1), (.85, .12, .75))
            elif floors > 1 and v == 1:
                balcony(-w * .25, -d / 2 - .08, base + fh + .07, 2.0, .43)

    def modern_house(v):
        # Same entrance and 2-floor contract, distinct villa compositions.
        facade = ['white', 'brick', 'concrete_light'][v]
        B('concrete_dark', (0, 0, .15), (12.4, 10.4, .3))
        B(facade, (-1, .5, 1.9), (9.6, 8.6, 3.2))
        B('concrete_light' if v == 1 else facade, (1, -.3, 5.), (9.6, 8.8, 3.))
        B('brick_dark' if v == 1 else 'steel_dark', (-4.85, .3, 3.4), (.28, 8.1, 6.2))
        B('concrete', (4.6, 1.8, 1.55), (3.2, 6., 2.8))
        B('steel_dark', (4.6, -1.25, 1.5), (2.75, .08, 2.))
        cornice(9.6, 8.6, 3.55, 'concrete_light', .13, -1, .5)
        cornice(9.6, 8.8, 6.6, 'concrete_light', .16, 1, -.3)
        if v == 2:
            # Low shallow pitched roof differentiates this residential family.
            hip('roof_slate', (1, -.3, 6.66), 9.6, 8.8, .45, .1)
        else:
            B('steel_dark', (1, -.3, 6.74), (9.4, 8.6, .18))
        entrance(-5, -3.75, .3, modern=True)
        if q() < 2:
            for x in (-2.2, .6):
                panel(x, -3.8, 1.95, 2.2, 1.6, frame='concrete_light', glass='glass_dark')
            for x in (-2.5, .6, 3.7):
                panel(x, -4.7, 5.03, 2.2, 1.78, frame='concrete_light', glass='glass_blue')
                panel(x, 4.1, 5.03, 2.2, 1.6, 2, 'concrete_light', 'glass_blue')
            for x, side in ((-5.8, 3), (5.8, 1)):
                for y in (-2., 1.2):
                    panel(x, y, 5.03 if x > 0 else 1.95, 1.7, 1.5, side, 'concrete_light', 'glass_dark')
            B('steel_dark', (-5, -4.47, 2.95), (2.15, 1.65, .13))
            B('wood_deck', (1.1, -5.1, 3.7), (6.7, .72, .16))
            balcony(1.1, -4.72, 3.74, 6.7, .69, True)
            if q() == 0:
                for k in range(5):
                    B('wood_deck', (4.6, -1.32, .85 + k * .32), (2.6, .055, .065))
                for x in (-2.3, -1., .3):
                    B('glass_blue', (x, .5, 6.95), (1.15, 2., .1))
                for x in (-3.7, 2.8):
                    B('stone_dark', (x, -5.45, .42), (1.5, .55, .52))
                    B('leaf_b', (x, -5.45, .87), (1.35, .48, .55))

    def modern_shop(v):
        floors, fh = 2 + v, 3.3
        H = floors * fh
        mat = 'brick' if v == 0 else 'concrete_light'
        B('concrete_dark', (0, 0, .16), (13.8, 10., .32))
        B(mat, (0, 0, H / 2), (13.4, 9.6, H))
        # Vertical masonry piers alternate with properly framed shop fronts.
        if q() < 2:
            for x in (-4.8, -1.8, 1.2):
                panel(x, -4.8, 1.55, 2.42, 2.65, frame='steel_dark', glass='glass_teal')
            entrance(4.4, -4.8, .08, 1.6, 2.8, True)
            for f in range(1, floors):
                for x in (-4.7, -1.55, 1.55, 4.7):
                    panel(x, -4.8, f * fh + 1.55, 1.95, 1.75, frame='concrete_light', glass='glass_dark')
                    panel(x, 4.8, f * fh + 1.55, 1.95, 1.75, 2, 'concrete_light', 'glass_dark')
            for x in (-6.35, -3.15, 0, 3.15, 6.35):
                B('concrete_light', (x, -4.89, H / 2), (.25, .22, H))
            B('steel_dark', (0, -5.42, 3.15), (12., 1.12, .16))
            B('accent_green' if v else 'brick_dark', (-1.2, -4.99, 3.72), (9.6, .26, .52))
            if q() == 0:
                for x in (-4.7, -1.5, 1.7):
                    B('wood_deck', (x, -5.92, .55), (1.7, .55, .13))
                    for sx in (-1, 1):
                        B('steel_dark', (x + sx * .6, -5.92, .26), (.07, .4, .5))
        for f in range(1, floors + 1):
            cornice(13.4, 9.6, f * fh, 'concrete_light', .18)
        # Tall parapet with real inset roof, stair bulkhead, service units.
        B('steel_dark', (0, 0, H + .16), (13.1, 9.3, .18))
        for x in (-6.64, 6.64):
            B('concrete_light', (x, 0, H + .52), (.23, 9.6, .8))
        for y in (-4.64, 4.64):
            B('concrete_light', (0, y, H + .52), (13.4, .23, .8))
        roof_services(13., 9., H + .24, v)
        B(mat, (3.8, 2.2, H + 1.32), (3.1, 3., 2.2))
        cornice(3.1, 3., H + 2.5, 'concrete_light', .16, 3.8, 2.2)

    def apartment(v):
        floors, fh = 6 + v * 2, 3.1
        H = floors * fh
        wall = 'brick' if v == 0 else 'concrete_light'
        B('concrete_dark', (0, 0, 1.6), (19.6, 15.6, 3.2))
        B(wall, (0, 0, (H + 3.2) / 2), (19., 15., H - 3.2))
        # Central projecting entrance/stair bay is visible at every LOD.
        B('concrete_light' if v == 0 else 'brick_dark', (0, -.15, H / 2), (3.1, 15.3, H))
        cornice(19., 15., 3.2, 'concrete_light', .18)
        for f in range(2, floors + 1, 2 if q() == 2 else 1):
            cornice(19., 15., f * fh, 'concrete_light', .15)
        if q() < 2:
            facade_grid(19., 15., 3.2, floors - 1, fh, 5, 'concrete_light', 'glass_dark', 4)
            for f in range(1, floors):
                panel(0, -7.8, f * fh + 1.7, 1.65, 1.35, frame='concrete_light', glass='glass_blue')
            for f in range(1, floors):
                for x in (-6.2, 6.2):
                    balcony(x, -7.51, f * fh + .06, 3.0, 1.46, True)
            for x in (-6.3, -3.1, 3.1, 6.3):
                panel(x, -7.8, 1.65, 2.3, 2.45, frame='steel_dark', glass='glass_teal')
            entrance(0, -7.85, .08, 1.95, 2.7, True)
            B('steel_dark', (0, -8.35, 3.), (4.3, 1.25, .15))
        B('steel_dark', (0, 0, H + .2), (18.8, 14.8, .2))
        for y in (-7.38, 7.38):
            B('concrete_light', (0, y, H + .6), (19., .2, .9))
        for x in (-9.38, 9.38):
            B('concrete_light', (x, 0, H + .6), (.2, 15., .9))
        B('concrete', (0, 2.5, H + 1.38), (4.2, 3.8, 2.55))
        roof_services(18., 14., H + .3, v)

    def office(v):
        floors, fh = 10 + v * 3, 3.6
        H = floors * fh
        B('concrete_dark', (0, 0, 2.2), (21.6, 21.6, 4.4))
        B('glass_dark' if v else 'glass_blue', (0, 0, (H + 4.4) / 2), (20.4, 20.4, H - 4.4))
        # Offset crown and stone core break up the former plain glazed cube.
        B('concrete_light', (6.8 if v else -6.8, .3, H / 2), (3., 20.7, H))
        B('concrete', (0, 0, H + 1.6), (15., 15., 3.2))
        cornice(20.4, 20.4, H, 'concrete_light', .15)
        if q() < 2:
            for f in range(2, floors):
                B('concrete_light', (0, 0, f * fh), (20.55, 20.55, .2))
            for x in (-9.6, -6.4, -3.2, 0, 3.2, 6.4, 9.6):
                for y in (-10.24, 10.24):
                    B('steel_dark', (x, y, (H + 4.4) / 2), (.1, .13, H - 4.4))
                for y in (-9.6, -6.4, -3.2, 0, 3.2, 6.4, 9.6):
                    if x in (-9.6, 9.6):
                        B('steel_dark', (x * 10.24 / 9.6, y, (H + 4.4) / 2), (.13, .1, H - 4.4))
            for x in (-6.7, -3.35, 3.35, 6.7):
                panel(x, -10.8, 2.25, 2.5, 3.4, frame='concrete_light', glass='glass_teal')
            entrance(0, -10.8, .06, 2.2, 3.3, True)
            B('steel_dark', (0, -12.15, 4.15), (8., 2.8, .25))
            for x in (-3.5, 3.5):
                B('concrete_light', (x, -13.25, 2.), (.3, .3, 4.))
            if q() == 0:
                for side in (-1, 1):
                    for y in (-8., -4., 0, 4., 8.):
                        B('concrete_light', (side * 10.34, y, H / 2), (.3, .16, H - .5))
        roof_services(14., 14., H + 3.2, v)
        B('steel', (0, 3., H + 4.5), (.35, .35, 3.))

    def tower_a(v):
        B('concrete_dark', (0, 0, 2.5), (30., 30., 5.))
        tiers = [(28., 5., 63.), (23., 63., 91.), (17., 91., 108.5)]
        for idx, (w, z0, z1) in enumerate(tiers):
            B('glass_dark' if idx == 1 else 'glass_blue', (0, 0, (z0 + z1) / 2), (w, w, z1 - z0))
            for sx in (-1, 1):
                for sy in (-1, 1):
                    B('concrete_light', (sx * (w / 2 - .38), sy * (w / 2 - .38), (z0 + z1) / 2), (.76, .76, z1 - z0))
            cornice(w, w, z1, 'concrete_light', .22)
            if q() < 2:
                step = 3.5 if q() == 0 else 7.
                z = z0 + step
                while z < z1 - .4:
                    B('steel_dark', (0, 0, z), (w + .04, w + .04, .14))
                    z += step
                for x in (-w * .25, 0, w * .25):
                    for y in (-w / 2 - .035, w / 2 + .035):
                        B('concrete_light', (x, y, (z0 + z1) / 2), (.18, .12, z1 - z0))
        B('concrete_dark', (0, 0, 113.2), (11., 11., 9.4))
        B('steel', (0, 0, 120.2), (4.5, 4.5, 4.6))
        cyl('steel_dark', (0, 0, 122.5), .35, 13.6, 8)
        if q() < 2:
            entrance(0, -15., .08, 3., 4.2, True)
            B('steel_dark', (0, -15.2, 4.3), (7., .85, .22))
            roof_services(16., 16., 108.8)

    def tower_b(v):
        # Cylindrical art-deco tower with recessed bands, stepped crown and stone ribs.
        cyl('concrete_dark', (0, 0, 0), 14.7, 5., 32)
        cyl('glass_teal', (0, 0, 5.), 13.15, 86., 32)
        for z, r, h in ((91., 10.8, 3.), (94., 8.37, 6.), (100., 6.75, 1.)):
            cyl('concrete_light', (0, 0, z), r, h, 32)
        cone('steel_dark', (0, 0, 101.), 2., 12., 16)
        if q() < 2:
            for k in range(12 if q() == 0 else 8):
                a = math.tau * k / (12 if q() == 0 else 8)
                x, y = math.cos(a) * 13.1, math.sin(a) * 13.1
                cyl('concrete_light', (x, y, 5.), .23, 86., 6)
            for z in range(9, 91, 4 if q() == 0 else 12):
                cyl('steel_dark', (0, 0, z), 13.26, .18, 32)
            entrance(0, -14.7, .08, 3., 4., True)
            B('steel_dark', (0, -14.93, 4.3), (6., .75, .2))
        cyl('steel', (0, 0, 99.8), 7.2, .22, 24)

    def spire(v):
        B('concrete_dark', (0, 0, .2), (22., 22., .4))
        for z, w in ((.7, 17.), (1.1, 14.5), (1.5, 12.)):
            B('concrete_light', (0, 0, z), (w, w, .4))
        for sx in (-1, 1):
            for sy in (-1, 1):
                poly('concrete_light', [(sx * 5.7 - .55, sy * 5.7 - .55, 1.7),
                     (sx * 5.7 + .55, sy * 5.7 - .55, 1.7), (sx * 5.7 + .55, sy * 5.7 + .55, 1.7),
                     (sx * 5.7 - .55, sy * 5.7 + .55, 1.7), (-.5, -.5, 34.), (.5, -.5, 34.),
                     (.5, .5, 34.), (-.5, .5, 34.)],
                     [[0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]])
        cyl('concrete', (0, 0, 34.), 1.65, 28., 16)
        cyl('steel_dark', (0, 0, 61.), 5., 1.2, 24)
        cyl('glass_blue', (0, 0, 62.2), 4.65, 2.5, 24)
        cyl('concrete_light', (0, 0, 64.7), 5.1, .5, 24)
        cone('steel_dark', (0, 0, 65.2), 4.3, 7., 24)
        cone('steel', (0, 0, 72.2), .5, 16., 12)
        if q() < 2:
            for k in range(12):
                a = k * math.tau / 12
                B('concrete_light', (math.cos(a) * 4.67, math.sin(a) * 4.67, 63.4), (.1, .1, 2.6))
            for z in range(36, 60, 4):
                cyl('steel_dark', (0, 0, z), 1.69, .12, 16)

    def castle(v):
        B('stone_dark', (0, 0, .15), (50.8, 50.8, .3))
        # Keep with a steep hall roof and functional stair turrets.
        B('stone_light', (0, 4., 12.), (16., 16., 24.))
        hip('roof_slate', (0, 4., 24.), 16., 16., 6., .25)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * 21., sy * 21.
                cyl('stone', (x, y, 0), 3.8, 15.5, 20)
                cone('roof_blue', (x, y, 15.5), 4.2, 7., 20)
                cyl('stone_light', (x, y, 14.8), 4., .55, 20)
                if q() < 2:
                    for z in (5., 10.):
                        panel(x, y - 3.8, z, .8, 1.9, frame='stone_dark')
        for y in (-21., 21.):
            if y < 0:
                for sx in (-1, 1):
                    B('stone', (sx * 12.55, y, 5.), (16.9, 2.2, 10.))
            else:
                B('stone', (0, y, 5.), (42., 2.2, 10.))
        for x in (-21., 21.):
            B('stone', (x, 0, 5.), (2.2, 42., 10.))
        # Gate remains in the original front opening.
        for sx in (-1, 1):
            B('stone_light', (sx * 3.6, -21.5, 7.), (4., 5., 14.))
            hip('roof_slate', (sx * 3.6, -21.5, 14.), 4., 5., 3., .15)
        B('stone', (0, -21.5, 10.6), (3.2, 5., 6.8))
        entrance(0, -24.05, 0, 3.1, 6.)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * 7.6, 4. + sy * 7.6
                cyl('stone', (x, y, 0), 1.8, 28., 16)
                cone('roof_blue', (x, y, 28.), 2., 6.2, 16)
                cyl('gold', (x, y, 34.2), .08, 1.2, 6)
        if q() < 2:
            for x in (-5., 0, 5.):
                for z in (6., 12., 18.):
                    panel(x, -4., z, 1.2, 2.2, frame='stone_dark')
            for side in (-1, 1):
                for k in range(12 if q() == 0 else 6):
                    c = -18.5 + k * 37. / (11 if q() == 0 else 5)
                    B('stone_light', (c, side * 21., 10.45), (1., 2.25, .9))
                    B('stone_light', (side * 21., c, 10.45), (2.25, 1., .9))
            for z in (6., 12., 18., 23.8):
                cornice(16., 16., z, 'stone', .16, 0, 4.)
            if q() == 0:
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        for z in (4., 8., 12., 16., 20.):
                            B('stone_dark', (sx * 8.02, 4. + sy * 7.7, z), (.14, .6, .3))
                for x in (-5., 5.):
                    B('flag_green', (x, -4.2, 15.), (1.25, .1, 4.5))
                    B('gold', (x, -4.27, 15.5), (.5, .06, .5))

    def temple(v):
        # Original nave/aisle/bell tower arrangement with more coherent masonry.
        B('stone_dark', (0, 1.5, .3), (14., 21., .6))
        B('stone_light', (0, 1.5, 6.1), (9., 20., 11.))
        ends('stone_light', (0, 1.5, 11.6), 9., 20., 5., False)
        roof('roof_slate', 'roof_slate_dark', (0, 1.5, 11.6), 9., 20., 5., .4, False, q() == 0)
        for sx in (-1, 1):
            B('stone', (sx * 6.2, 1.5, 3.8), (3.4, 18., 6.4))
            roof('roof_red', 'roof_red_dark', (sx * 6.2, 1.5, 6.9), 3.4, 18., 1.35, .15, False, False)
            if q() < 2:
                for y in (-5.4, -1.8, 1.8, 5.4, 9.):
                    panel(sx * 7.9, y, 3.9, 1., 2.5, 1 if sx > 0 else 3, 'stone_light')
                    panel(sx * 4.5, y, 9.1, .9, 2.1, 1 if sx > 0 else 3, 'stone')
                    B('stone_light', (sx * 7.95, y + 1.4, 3.6), (.6, .7, 6.))
        cyl('stone_light', (0, 11.5, .6), 4.4, 9., 20)
        cone('roof_slate', (0, 11.5, 9.6), 4.8, 3.5, 20)
        B('stone_light', (0, -9.5, 10.1), (5.4, 5.4, 19.))
        for z in (6.6, 12.6, 19.6):
            cornice(5.4, 5.4, z, 'stone', .12, 0, -9.5)
        cone('roof_blue', (0, -9.5, 19.75), 4.1, 7.85, 4, rz=math.pi / 4)
        cyl('gold', (0, -9.5, 27.4), .08, 1.8, 6)
        B('gold', (0, -9.5, 28.6), (.9, .12, .12))
        entrance(0, -12.2, .6, 2.2, 3.6)
        if q() < 2:
            for side, x, y in ((0, 0, -12.2), (1, 2.7, -9.5), (2, 0, -6.8), (3, -2.7, -9.5)):
                panel(x, y, 16.4, 1.65, 2.6, side, 'stone_dark', 'iron')
            cyl('stone', (0, -12.25, 6.2), 1.25, .15, 20, rx=math.pi / 2)
            cyl('glass_blue', (0, -12.38, 6.2), 1.03, .08, 20, rx=math.pi / 2)
            if q() == 0:
                for z in (2., 4., 8., 10., 14.):
                    for x in (-2.6, 2.6):
                        B('stone', (x, -12.23, z), (.32, .18, .28))

    def tower(v):
        cyl('stone_dark', (0, 0, 0), 4.05, .8, 20)
        cyl('stone_light', (0, 0, .8), 3.6, 15.2, 20)
        cyl('stone', (0, 0, 15.4), 4.05, .75, 20)
        cone('roof_red', (0, 0, 16.1), 4.2, 8.3, 20)
        cyl('gold', (0, 0, 24.4), .07, 1.36, 6)
        entrance(0, -3.6, .2, 1.2, 2.4)
        if q() < 2:
            for side, x, y in ((0, 0, -3.6), (1, 3.6, 0), (2, 0, 3.6), (3, -3.6, 0)):
                for z in (6., 11.):
                    panel(x, y, z, .9, 1.9, side, 'stone_dark')
            for z in (4.4, 9.4, 14.4):
                cyl('stone', (0, 0, z), 3.68, .22, 20)
            if q() == 0:
                for k in range(8):
                    a = k * math.tau / 8
                    B('timber', (math.cos(a) * 3.77, math.sin(a) * 3.77, 15.8), (.2, .2, 1.25))

    families = {'m_house': modern_house, 'm_shop': modern_shop, 'm_apartment': apartment,
                'm_office': office, 'm_tower_a': tower_a, 'm_tower_b': tower_b, 'm_spire': spire,
                'f_castle': castle, 'f_temple': temple, 'f_tower': tower}
    result = {}
    for family, count in BUILDING_VARIANTS.items():
        for v in range(count):
            name = f'{family}_v{v}' if count > 1 else family
            if family in families:
                result[name] = lambda fn=families[family], v=v: fn(v)
            else:
                result[name] = lambda family=family, v=v: fantasy_house(family, v)
    return result
