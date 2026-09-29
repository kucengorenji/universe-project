"""NPC skeleton (A-pose, 1.75 m) and skin-weight rules.

One skeleton for every module (docs/art-direction/npc-v1): root > hips > spine_01
> spine_02 > chest > neck > head; clavicle > upper_arm > forearm > hand > five
fingers of 3 bones; thigh > shin > foot > toe. Z up, front -Y, character-left +X.

Skin weights are not painted: every mesh vertex carries a region tag ('torso',
'arm.L', 'fing.index.R', ...) and `weights()` blends the bones of that region's
chain by the vertex' distance along it. Skin and garments share the rule, so a
sleeve bends exactly like the arm inside it.
"""
import math

import bpy
from mathutils import Vector

from .kit import smoothstep

V = Vector

# --------------------------------------------------------------- landmarks (m)
Z_ANKLE, Z_KNEE, Z_HIP = 0.100, 0.470, 0.860
Z_SHOULDER, Z_NECK, Z_CHIN, Z_TOP = 1.275, 1.32, 1.405, 1.75
HIP_X, SHOULDER_X = 0.100, 0.232
ARM_TILT = math.radians(30)          # A-pose: arms 30 degrees off the body
UPPER_ARM, FOREARM, PALM = 0.28, 0.25, 0.105
FINGERS = {                           # name: (offset across palm, segment lengths, cumulative curl per joint)
    'index': (0.034, (0.038, 0.030, 0.025), (0.10, 0.32, 0.50)),
    'middle': (0.011, (0.041, 0.032, 0.026), (0.12, 0.34, 0.52)),
    'ring': (-0.011, (0.038, 0.030, 0.024), (0.14, 0.36, 0.54)),
    'pinky': (-0.032, (0.031, 0.024, 0.020), (0.16, 0.38, 0.56)),
}
THUMB = ((0.034, 0.029, 0.025), (0.05, 0.22, 0.40))


def arm_points(s):
    """Shoulder, elbow, wrist for side s (+1 left, -1 right) and the two bone directions."""
    S = V((SHOULDER_X * s, 0.0, Z_SHOULDER))
    d1 = V((math.sin(ARM_TILT) * s, -0.06, -math.cos(ARM_TILT))).normalized()
    E = S + d1 * UPPER_ARM
    d2 = V((0.40 * s, -0.22, -0.89)).normalized()
    return S, E, E + d2 * FOREARM, d1, d2


def hand_frame(s):
    """Wrist, a = down the hand, t = towards the thumb (forward), m = towards the palm (medial)."""
    _, _, W, _, d2 = arm_points(s)
    a = (d2 + V((0, -0.10, 0))).normalized()
    t = (V((0, -1, 0)) - a * a.dot(V((0, -1, 0)))).normalized()
    m = a.cross(t)
    if m.x * s > 0:
        m = -m
    return W, a, t, m


def finger_points(s):
    """{finger: [base, joint1, joint2, tip]} in armature space."""
    W, a, t, m = hand_frame(s)
    base = W + a * PALM
    out = {}
    for name, (off, lens, curl) in FINGERS.items():
        p = base + t * off + m * 0.006
        pts = [p]
        for ln, c in zip(lens, curl):
            d = (a * math.cos(c) + m * math.sin(c)).normalized()
            p = p + d * ln
            pts.append(p)
        out[name] = pts
    p = W + a * 0.028 + t * 0.042 + m * 0.004
    pts = [p]
    for ln, c in zip(*THUMB):
        d = (a * math.cos(c) * 0.55 + t * 0.75 + m * (0.15 + 0.5 * math.sin(c))).normalized()
        p = p + d * ln
        pts.append(p)
    out['thumb'] = pts
    return out


def leg_points(s):
    return V((HIP_X * s, 0.0, 0.865)), V((HIP_X * s, -0.008, Z_KNEE)), V((HIP_X * s, 0.0, Z_ANKLE))


def foot_points(s):
    A = V((HIP_X * s, 0.0, Z_ANKLE))
    return A, V((HIP_X * s, -0.165, 0.050)), V((HIP_X * s, -0.270, 0.032))


def skeleton():
    """{bone: (head, tail, parent)} for the whole rig."""
    B = {}
    B['root'] = (V((0, 0, 0)), V((0, 0, 0.10)), None)
    B['hips'] = (V((0, 0, 0.86)), V((0, 0, 0.95)), 'root')
    B['spine_01'] = (V((0, 0, 0.95)), V((0, 0, 1.06)), 'hips')
    B['spine_02'] = (V((0, 0, 1.06)), V((0, 0, 1.17)), 'spine_01')
    B['chest'] = (V((0, 0, 1.17)), V((0, 0, 1.30)), 'spine_02')
    B['neck'] = (V((0, 0, 1.30)), V((0, 0, 1.38)), 'chest')
    B['head'] = (V((0, 0, 1.38)), V((0, 0, Z_TOP)), 'neck')
    for side, s in (('L', 1), ('R', -1)):
        S, E, W, d1, d2 = arm_points(s)
        B[f'clavicle.{side}'] = (V((0.035 * s, 0.0, 1.255)), S, 'chest')
        B[f'upper_arm.{side}'] = (S, E, f'clavicle.{side}')
        B[f'forearm.{side}'] = (E, W, f'upper_arm.{side}')
        Wp, a, t, m = hand_frame(s)
        B[f'hand.{side}'] = (W, W + a * PALM, f'forearm.{side}')
        for fname, pts in finger_points(s).items():
            parent = f'hand.{side}'
            for k in range(3):
                bone = f'{fname}_0{k + 1}.{side}'
                B[bone] = (pts[k], pts[k + 1], parent)
                parent = bone
        H, K, A = leg_points(s)
        B[f'thigh.{side}'] = (H, K, 'hips')
        B[f'shin.{side}'] = (K, A, f'thigh.{side}')
        A2, ball, toe = foot_points(s)
        B[f'foot.{side}'] = (A2, ball, f'shin.{side}')
        B[f'toe.{side}'] = (ball, toe, f'foot.{side}')
    return B


DEFORM_ORDER = list(skeleton().keys())


def build_armature(name='NPC_Rig', collection=None):
    data = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, data)
    (collection or bpy.context.scene.collection).objects.link(obj)
    prev = bpy.context.view_layer.objects.active
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for bone, (h, t, parent) in skeleton().items():
        eb = data.edit_bones.new(bone)
        eb.head, eb.tail = h, t
        eb.roll = 0.0
        if parent:
            eb.parent = data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    data.display_type = 'OCTAHEDRAL'
    obj.show_in_front = True
    if prev is not None:
        bpy.context.view_layer.objects.active = prev
    return obj


# --------------------------------------------------------------- weights
def chains():
    """Region tag -> chain definition used by `weights`."""
    C = {
        'torso': dict(pts=[V((0, 0, 0.86)), V((0, 0, 0.95)), V((0, 0, 1.06)), V((0, 0, 1.17)), V((0, 0, 1.30)), V((0, 0, 1.44))],
                      bones=['hips', 'spine_01', 'spine_02', 'chest', 'neck'], half=0.045),
        'neck': dict(pts=[V((0, 0, 1.30)), V((0, 0, 1.38)), V((0, 0, 1.56))], bones=['neck', 'head'], half=0.03),
    }
    for side, s in (('L', 1), ('R', -1)):
        S, E, W, d1, d2 = arm_points(s)
        Wp, a, t, m = hand_frame(s)
        C[f'arm.{side}'] = dict(pts=[S, E, W], bones=[f'upper_arm.{side}', f'forearm.{side}'], half=0.05,
                                parent=f'clavicle.{side}', pblend=0.08, pmax=0.42)
        C[f'hand.{side}'] = dict(pts=[W, W + a * PALM], bones=[f'hand.{side}'], half=0.01, parent=f'forearm.{side}', pblend=0.04, pmax=0.5)
        for fname, pts in finger_points(s).items():
            C[f'fing.{fname}.{side}'] = dict(pts=pts, bones=[f'{fname}_0{k}.{side}' for k in (1, 2, 3)], half=0.007,
                                            parent=f'hand.{side}' if fname != 'thumb' else f'hand.{side}', pblend=0.014, pmax=0.5)
        H, K, A = leg_points(s)
        C[f'leg.{side}'] = dict(pts=[H, K, A], bones=[f'thigh.{side}', f'shin.{side}'], half=0.06, parent='hips', pblend=0.10, pmax=0.5)
        A2, ball, toe = foot_points(s)
        C[f'foot.{side}'] = dict(pts=[A2, ball, toe], bones=[f'foot.{side}', f'toe.{side}'], half=0.035,
                                 parent=f'shin.{side}', pblend=0.05, pmax=0.4)
    C['head'] = dict(pts=[V((0, 0, 1.38)), V((0, 0, 1.75))], bones=['head'], half=0.01)
    return C


_CHAINS = None


def weights(tag, p):
    """{bone: weight} for a vertex at p (armature space) in region `tag`."""
    global _CHAINS
    if _CHAINS is None:
        _CHAINS = chains()
    ch = _CHAINS.get(tag) or _CHAINS['head']
    pts, bones, half = ch['pts'], ch['bones'], ch['half']
    cum = [0.0]
    for i in range(len(pts) - 1):
        cum.append(cum[-1] + (pts[i + 1] - pts[i]).length)
    best = (1e9, 0, 0.0)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L2 = ab.length_squared
        t = max(0.0, min(1.0, (p - a).dot(ab) / L2)) if L2 else 0.0
        d = (p - (a + ab * t)).length
        if d < best[0]:
            best = (d, i, t)
    _, i, t = best
    u = cum[i] + t * (cum[i + 1] - cum[i])
    edges = cum[1:-1]
    S = [1.0] + [smoothstep(e - half, e + half, u) for e in edges] + [0.0]
    w = {bone: max(0.0, S[k] - S[k + 1]) for k, bone in enumerate(bones)}
    parent = ch.get('parent')
    if parent:
        pw = ch['pmax'] * (1.0 - smoothstep(0.0, ch['pblend'], u))
        if pw > 1e-3:
            for k in w:
                w[k] *= 1.0 - pw
            w[parent] = w.get(parent, 0.0) + pw
    # torso: shoulders follow the clavicles a little
    if tag == 'torso' and p.z > 1.12:
        k = 0.5 * smoothstep(0.14, 0.23, abs(p.x)) * smoothstep(1.12, 1.24, p.z)
        if k > 1e-3:
            side = 'L' if p.x > 0 else 'R'
            for b in w:
                w[b] *= 1.0 - k
            w[f'clavicle.{side}'] = w.get(f'clavicle.{side}', 0.0) + k
    top = sorted(((b, x) for b, x in w.items() if x > 1e-3), key=lambda kv: -kv[1])[:4]
    tot = sum(x for _, x in top) or 1.0
    return {b: x / tot for b, x in top}
