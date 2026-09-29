"""NPC body, heads (H01-H04) and faces, chunky-toon.

Body fits (standard / slim / broad / soft) are parameters of the same profile
functions that the garments use, so skin and clothes always agree (the doc's
"morphSync" rule) and every fit shares the one skeleton. Heads are rounded
cubes shaped per head id; facial features are placed by casting rays at the
actual head surface, so they sit flush on any of the four heads.
"""
import math

import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from . import npc_rig as rig
from .kit import PAL, Builder, basis, lerp, mix_hex, round_poly, shade, smoothstep, spline

V = Vector

# --------------------------------------------------------------- look tokens
DEFAULT_LOOK = {
    'skin': 0xDFA579, 'hair': 0x26211F, 'brow': 0x26211F, 'top_a': 0x86A9BD, 'top_b': 0xECE5D6, 'top_c': 0x353735,
    'pants': 0x353735, 'shoe_a': 0x26272A, 'shoe_b': 0xE8E0CC, 'shoe_c': 0xE8E0CC, 'cap': 0x232326,
    'frame': 0x1E1E20, 'beard': 0x26211F, 'lens': 0xDCEBF2, 'tie': 0xD9803A,
}


def set_look(**kv):
    """Set NPC colour tokens (sRGB hex). Derived shades follow the skin and hair colours."""
    look = dict(DEFAULT_LOOK)
    look.update(kv)
    look.setdefault('brow', look['hair'])
    if 'brow' not in kv:
        look['brow'] = look['hair']
    if 'beard' not in kv:
        look['beard'] = look['hair']
    for k, v in look.items():
        PAL[f'npc_{k}'] = v
    PAL['npc_skin_shade'] = shade(look['skin'], 0.80)
    PAL['npc_skin_light'] = shade(look['skin'], 1.10)
    PAL['npc_stubble'] = mix_hex(look['skin'], look['hair'], 0.55)
    PAL['npc_hair_light'] = mix_hex(look['hair'], 0xFFFFFF, 0.10)
    PAL['npc_top_a_dark'] = shade(look['top_a'], 0.82)
    PAL['npc_top_a_light'] = shade(look['top_a'], 1.12)
    PAL['npc_pants_dark'] = shade(look['pants'], 0.80)
    PAL['npc_shoe_a_dark'] = shade(look['shoe_a'], 0.75)
    return look


set_look()


# --------------------------------------------------------------- fits
FITS = {
    'standard': dict(hw=1.00, hd=1.00, arm=1.00, leg=1.00, belly=0.000, hip=1.00, sh=1.00),
    'slim': dict(hw=0.93, hd=0.92, arm=0.92, leg=0.93, belly=-0.004, hip=0.95, sh=0.98),
    'broad': dict(hw=1.04, hd=1.05, arm=1.13, leg=1.07, belly=0.004, hip=1.02, sh=1.11),
    'soft': dict(hw=1.03, hd=1.10, arm=1.08, leg=1.06, belly=0.024, hip=1.10, sh=0.98),
}


def bump(z, c, w):
    return math.exp(-(((z - c) / w) ** 2))


def hermite(keys, x):
    """Cubic Hermite through [(x, y), ...] with finite-difference tangents."""
    n = len(keys)
    if x <= keys[0][0]:
        return keys[0][1]
    if x >= keys[-1][0]:
        return keys[-1][1]
    i = 0
    while not (keys[i][0] <= x <= keys[i + 1][0]):
        i += 1

    def slope(j):
        a, b = max(j - 1, 0), min(j + 1, n - 1)
        return (keys[b][1] - keys[a][1]) / (keys[b][0] - keys[a][0])

    (x0, y0), (x1, y1) = keys[i], keys[i + 1]
    h = x1 - x0
    t = (x - x0) / h
    m0, m1 = slope(i) * h, slope(i + 1) * h
    return (2 * t ** 3 - 3 * t ** 2 + 1) * y0 + (t ** 3 - 2 * t ** 2 + t) * m0 + (-2 * t ** 3 + 3 * t ** 2) * y1 + (t ** 3 - t ** 2) * m1


TORSO_HW = [(0.74, 0.160), (0.86, 0.190), (0.98, 0.184), (1.10, 0.194), (1.20, 0.224), (1.265, 0.242), (1.33, 0.150), (1.40, 0.082)]
TORSO_HD = [(0.74, 0.112), (0.86, 0.124), (0.98, 0.122), (1.10, 0.128), (1.20, 0.142), (1.265, 0.132), (1.33, 0.108), (1.40, 0.082)]
TORSO_CY = [(0.74, 0.006), (0.86, 0.008), (0.98, 0.003), (1.10, -0.002), (1.20, -0.008), (1.265, -0.004), (1.33, 0.0), (1.40, 0.0)]
TORSO_ZS = [0.74, 0.80, 0.86, 0.92, 0.98, 1.04, 1.10, 1.16, 1.20, 1.235, 1.265, 1.29, 1.315, 1.34, 1.37, 1.40]


def torso_section(z, fit='standard'):
    """(half width, half depth, centre y) of the torso skin at height z."""
    f = FITS[fit]
    hw = hermite(TORSO_HW, z) * f['hw'] * (1 + (f['sh'] - 1) * bump(z, 1.25, 0.10)) * (1 + (f['hip'] - 1) * bump(z, 0.86, 0.12))
    hd = hermite(TORSO_HD, z) * f['hd'] * (1 + f['belly'] * 3.0 * bump(z, 1.0, 0.13))
    cy = hermite(TORSO_CY, z) - f['belly'] * bump(z, 1.0, 0.13)
    return hw, hd, cy


# --------------------------------------------------------------- limbs (shared by skin and garments)
ARM_R = [(0.0, 0.066), (0.22, 0.064), (0.53, 0.055), (0.75, 0.050), (1.0, 0.044)]
LEG_R = [(0.0, 0.106), (0.2, 0.099), (0.5, 0.075), (0.6, 0.068), (1.0, 0.052)]


def arm_pos(s, u):
    """Point on the arm centre line at arclength fraction u (0 shoulder, 0.527 elbow, 1 wrist)."""
    S, E, W, d1, d2 = rig.arm_points(s)
    L = rig.UPPER_ARM + rig.FOREARM
    ue = rig.UPPER_ARM / L
    return S + d1 * (u * L) if u <= ue else E + d2 * ((u - ue) * L)


def leg_pos(s, u):
    H, K, A = rig.leg_points(s)
    L1, L2 = (K - H).length, (A - K).length
    ue = L1 / (L1 + L2)
    L = L1 + L2
    if u <= ue:
        return H + (K - H).normalized() * (u * L)
    return K + (A - K).normalized() * ((u - ue) * L)


def limb_rings(pos_fn, keys, s, us, scale=1.0, off=0.0, flare=None):
    pts, rad = [], []
    for u in us:
        r = hermite(keys, max(0.0, u)) * scale + off
        if flare:
            r += flare(u)
        pts.append(pos_fn(s, u))
        rad.append(r)
    return pts, rad


def limb_tube(b, mat, pos_fn, keys, s, u0, u1, n_rings, scale=1.0, off=0.0, flare=None, seg=14, n=2.0, tag=None, caps=True):
    us = [u0 + (u1 - u0) * i / (n_rings - 1) for i in range(n_rings)]
    pts, rad = limb_rings(pos_fn, keys, s, us, scale, off, flare)
    return b.tube(mat, pts, rad, seg=seg, n=n, tag=tag, caps=caps)


# --------------------------------------------------------------- body
def add_torso(b, fit='standard', mat='npc_skin', off=0.0, zs=None, seg=20, n=2.7, tag='torso', kw=None):
    """Torso skin (or a shell `off` metres outside it) as a lofted tube."""
    zs = zs or TORSO_ZS
    pts, rad = [], []
    for z in zs:
        hw, hd, cy = torso_section(z, fit)
        k = kw(z) if kw else (0.0, 0.0)
        pts.append((0, cy, z))
        rad.append((hw + off + k[0], hd + off + k[1]))
    return b.tube(mat, pts, rad, seg=seg, n=n, axes=((1, 0, 0), (0, 1, 0)), tag=tag)


def add_hand(b, s, mat='npc_skin'):
    side = 'L' if s > 0 else 'R'
    W, a, t, m = rig.hand_frame(s)
    pal = W + a * (rig.PALM * 0.5)
    b.box(mat, pal, (0.100, 0.046, 0.110), r=0.016, rot=basis(t, a), tag=f'hand.{side}')
    b.sphere(mat, W + a * 0.012, 0.031, scale=(1.1, 0.95, 1.0), tag=f'hand.{side}', seg=10)
    for fname, pts in rig.finger_points(s).items():
        base_r = 0.0128 if fname != 'pinky' else 0.0112
        if fname == 'thumb':
            b.sphere(mat, pts[0] + (pts[1] - pts[0]) * 0.1, 0.023, tag=f'fing.thumb.{side}', seg=8)
            base_r = 0.0138
        rad = [base_r, base_r * 0.94, base_r * 0.87, base_r * 0.78]
        b.tube(mat, pts, rad, seg=8, round_ends=2, tag=f'fing.{fname}.{side}')


def add_arm(b, s, fit='standard', mat='npc_skin'):
    side = 'L' if s > 0 else 'R'
    sc = FITS[fit]['arm']
    limb_tube(b, mat, arm_pos, ARM_R, s, -0.05, 1.02, 10, scale=sc, tag=f'arm.{side}', seg=14)
    S = rig.arm_points(s)[0]
    b.sphere(mat, S + V((0.004 * s, 0, 0.004)), 0.070 * sc, scale=(1.0, 0.95, 1.0), tag=f'arm.{side}', seg=12)
    add_hand(b, s, mat)


def add_leg(b, s, fit='standard', mat='npc_skin'):
    side = 'L' if s > 0 else 'R'
    sc = FITS[fit]['leg']
    limb_tube(b, mat, leg_pos, LEG_R, s, -0.03, 1.0, 9, scale=sc, tag=f'leg.{side}', seg=14)
    A, ball, toe = rig.foot_points(s)
    b.box(mat, (A.x, -0.090, 0.046), (0.092, 0.250, 0.080), r=0.022, tag=f'foot.{side}')


def add_body(b, fit='standard', mat='npc_skin', parts=('torso', 'neck', 'arms', 'legs')):
    if 'torso' in parts:
        add_torso(b, fit, mat)
    if 'neck' in parts:
        b.tube(mat, [(0, -0.004, 1.30), (0, -0.008, 1.50)], 0.068, seg=14, tag='neck')
    if 'arms' in parts:
        add_arm(b, 1, fit, mat)
        add_arm(b, -1, fit, mat)
    if 'legs' in parts:
        add_leg(b, 1, fit, mat)
        add_leg(b, -1, fit, mat)


# --------------------------------------------------------------- heads
HEADS = {
    'H01': dict(name='Angular', w=0.250, d=0.262, h=0.345, n=4.4, jaw=0.80, chin=0.022, cheek=0.0),
    'H02': dict(name='Round', w=0.266, d=0.270, h=0.338, n=2.9, jaw=0.93, chin=0.000, cheek=0.010),
    'H03': dict(name='Oval', w=0.240, d=0.258, h=0.368, n=3.2, jaw=0.84, chin=0.009, cheek=0.0),
    'H04': dict(name='Broad-square', w=0.278, d=0.268, h=0.338, n=6.2, jaw=0.96, chin=0.015, cheek=0.004),
}


def frame(n):
    """Basis whose local Y points into the head (-n) and Z up, for blocks sitting on the surface."""
    back = (-V(n)).normalized()
    up = V((0, 0, 1))
    up = (up - back * up.dot(back)).normalized()
    right = back.cross(up)
    return Matrix((right, back, up)).transposed()


class Head:
    N = 12  # cells per cube face

    def __init__(self, hid='H01'):
        self.hid = hid
        self.p = HEADS[hid]
        self.zc = rig.Z_TOP - self.p['h'] / 2
        self.yc = 0.004
        self.bm = self._grid()
        self.bvh = BVHTree.FromBMesh(self.bm)

    def shape(self, p):
        P = self.p
        n = P['n']
        k = (abs(p.x) ** n + abs(p.y) ** n + abs(p.z) ** n) ** (1.0 / n)
        q = p / k
        x, y, z = q.x * P['w'] / 2, q.y * P['d'] / 2, q.z * P['h'] / 2
        t = smoothstep(0.30, -0.95, q.z)
        x *= lerp(1.0, P['jaw'], t)
        y *= lerp(1.0, 0.95, t)
        if q.y < 0:
            cw = smoothstep(-0.50, -1.0, q.z) * max(0.0, 1.0 - q.x * q.x * 2.2)
            y -= P['chin'] * cw
            z -= P['chin'] * 0.6 * cw
        # cheeks fill out a little at eye-to-mouth height
        cb = P['cheek'] * bump(q.z, -0.25, 0.4) * max(0.0, -q.y)
        x *= 1.0 + cb * 4.0
        return V((x, y + self.yc, z + self.zc))

    def _grid(self):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=2.0)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=self.N - 1, use_grid_fill=True)
        for v in bm.verts:
            v.co = self.shape(v.co.copy())
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        return bm

    def copy_bm(self):
        return self.bm.copy()

    def surface(self, x, z, y0=-0.6):
        """Point and outward normal where a ray along +Y at (x, z) meets the front of the head."""
        hit = self.bvh.ray_cast(V((x, y0, z)), V((0, 1, 0)))
        if hit[0] is None:
            return V((x, -self.p['d'] / 2, z)), V((0, -1, 0))
        return hit[0], hit[1].normalized()

    def zrel(self, k):
        """World height at fraction k of the head height above centre (+1 top, -1 chin)."""
        return self.zc + k * self.p['h'] / 2

    def dims(self):
        return dict(w=self.p['w'], d=self.p['d'], h=self.p['h'], zc=self.zc, yc=self.yc)


def add_head(b, head, mat='npc_skin'):
    """The bare head shell (tag 'head')."""
    return b._absorb(head.copy_bm(), mat, Matrix.Identity(4), 'head')


def block(b, mat, head, x, z, size, protrude=0.0, r=None, tag=None, tilt=0.0, dx=0.0, dz=0.0):
    """A rounded block whose front face sits `protrude` above the head surface at (x, z)."""
    P, n = head.surface(x, z)
    fr = frame(n)
    if tilt:
        fr = fr @ Matrix.Rotation(tilt, 3, 'Y')
    depth = size[1]
    centre = P + n * (protrude - depth / 2) + fr @ V((dx, 0, dz))
    return b.box(mat, centre, size, r=r, rot=fr, tag=tag)


def add_face(b, head, expr='neutral'):
    """Ears, brow ridge, brows, eyes, nose, mouth and cheek pads on `head`."""
    P = head.p
    w, h = P['w'], P['h']
    kx, kz = w / 0.25, h / 0.345
    k = (kx + kz) / 2
    ex = w * 0.236
    ez = head.zrel(0.03)
    skin = 'npc_skin'
    # ears
    for s, side in ((1, 'L'), (-1, 'R')):
        ear = V((s * (w / 2 * 0.99), head.yc + 0.010, head.zrel(-0.10)))
        b.box(skin, ear, (0.019 * k, 0.032 * k, 0.060 * k), r=0.008, rot=(0, 0, -s * 0.30), tag='head')
        b.box('npc_skin_shade', ear + V((s * 0.007, -0.002, 0.0)), (0.009 * k, 0.022 * k, 0.038 * k), r=0.0035, rot=(0, 0, -s * 0.30), tag='head')
    # heavy brow ridge (skin)
    block(b, skin, head, 0.0, head.zrel(0.20), (w * 0.64, 0.034 * k, 0.034 * k), protrude=0.007, r=0.013, tag='head')
    # eyes: white block, dark pupil, small highlight
    for s, side in ((1, 'L'), (-1, 'R')):
        block(b, 'npc_eye_white', head, s * ex, ez, (0.058 * kx, 0.014, 0.044 * kz), protrude=0.0025, r=0.013, tag=f'eye.{side}')
        block(b, 'npc_pupil', head, s * (ex - 0.003), ez - 0.002, (0.029 * kx, 0.010, 0.033 * kz), protrude=0.0058, r=0.012, tag=f'pupil.{side}')
        block(b, 'npc_eye_white', head, s * (ex - 0.003) + 0.007 * kx, ez + 0.007 * kz, (0.009, 0.006, 0.009), protrude=0.0090, r=0.0035, tag=f'pupil.{side}')
        # lash line: hidden inside the head until a blink
        block(b, 'npc_pupil', head, s * ex, ez - 0.010 * kz, (0.006, 0.004, 0.004), protrude=-0.006, r=0.0015, tag=f'lash.{side}')
    # brows
    for s, side in ((1, 'L'), (-1, 'R')):
        block(b, 'npc_brow', head, s * (ex + 0.002), head.zrel(0.19) + 0.004, (0.074 * kx, 0.020, 0.020 * kz), protrude=0.012, r=0.0075,
              tag=f'brow.{side}', tilt=s * 0.10)
    # nose: a faceted wedge
    nz = head.zrel(-0.12)
    Pn, nn = head.surface(0.0, nz)
    fr = frame(nn)
    pts = [(-0.012, 0.006, 0.046), (0.012, 0.006, 0.046), (-0.010, -0.013, 0.019), (0.010, -0.013, 0.019),
           (-0.017, -0.036, -0.016), (0.017, -0.036, -0.016), (-0.028, -0.007, -0.030), (0.028, -0.007, -0.030),
           (-0.023, 0.014, -0.025), (0.023, 0.014, -0.025)]
    pts = [(x * kx, y * k, z * kz) for x, y, z in pts]
    b.hull(skin, pts, r=0.0055, loc=Pn + nn * 0.002, rot=fr, tag='head')
    # mouth: an arc that follows the surface; smile / frown are shape keys
    mz = head.zrel(-0.52)
    path = []
    for i in range(9):
        x = (i / 8 - 0.5) * 0.080 * kx
        Pm, nm = head.surface(x, mz)
        path.append(Pm + nm * 0.0018)
    b.tube('npc_mouth', path, 0.0056, seg=8, round_ends=1, tag='mouth')
    # an open-mouth shape, squashed flat inside the head until jawOpen
    Po, no = head.surface(0.0, mz - 0.002)
    b.box('npc_mouth', Po - no * 0.006, (0.044 * kx, 0.004, 0.003), r=0.0012, rot=frame(no), tag='mouth_open')
