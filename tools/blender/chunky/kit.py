"""Chunky-toon modelling kit: bmesh primitives with generous bevels, palette
materials, per-face colour overrides and glTF export.

Everything is bmesh (no viewport operators except the glTF exporter), so the
same code runs through the Blender MCP and `blender --background`.

Conventions
  metres, Z up, front = -Y, character-left = +X
  primitives take `loc` = centre of their bounds, or the centre of their bottom
  face with anchor='b'; `rot` is an Euler (radians, XYZ) applied about `loc`
  materials are palette tokens (palette.py); a mesh built in 'mat' mode gets one
  Blender material per token, in 'vcol' mode a single material reads the `Col`
  corner colour attribute (what the game's people rig expects)
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from . import palette

TAU = math.tau
ROOT = os.environ.get('GLOBE_ROOT', '/Users/mikelrisyad/Developer/globe')

PAL = {}
PAL.update(palette.ROOM)
PAL.update({f'npc_{k}': v for k, v in palette.NPC.items()})


# ---------------------------------------------------------------- colour
def lin(h):
    """sRGB hex -> linear RGB floats."""
    out = []
    for shift in (16, 8, 0):
        c = ((h >> shift) & 255) / 255
        out.append(((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92)
    return tuple(out)


def shade(h, k):
    """Multiply an sRGB hex colour by k in linear light (k < 1 darker)."""
    r, g, b = (min(1.0, c * k) for c in lin(h))
    f = lambda c: 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
    return (round(f(r) * 255) << 16) | (round(f(g) * 255) << 8) | round(f(b) * 255)


def mix_hex(a, b, t):
    ca, cb = [(a >> s) & 255 for s in (16, 8, 0)], [(b >> s) & 255 for s in (16, 8, 0)]
    return sum(round(x + (y - x) * t) << s for x, y, s in zip(ca, cb, (16, 8, 0)))


# ---------------------------------------------------------------- materials
def material(key, vcol=False):
    """Blender material M_<key> (created or refreshed from the palette)."""
    name = 'M_npc' if vcol else f'M_{key}'
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    if vcol:
        node = nt.nodes.get('Col') or nt.nodes.new('ShaderNodeVertexColor')
        node.name = 'Col'
        node.layer_name = 'Col'
        if not bsdf.inputs['Base Color'].links:
            nt.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.62
        return m
    c = lin(PAL[key])
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = palette.ROUGHNESS.get(key, 0.55)
    m.diffuse_color = (*c, 1)
    if key in palette.EMISSIVE:
        bsdf.inputs['Emission Color'].default_value = (*c, 1)
        bsdf.inputs['Emission Strength'].default_value = palette.EMISSIVE[key]
    if key in palette.ALPHA:
        bsdf.inputs['Alpha'].default_value = palette.ALPHA[key]
        m.surface_render_method = 'BLENDED'
    return m


# ---------------------------------------------------------------- 2D / path helpers
def sgnpow(x, p):
    return math.copysign(abs(x) ** p, x) if x else 0.0


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))) if b != a else float(x >= a)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def round_poly(pts, radii, steps=3, closed=True):
    """Fillet the corners of a 2D polyline/polygon with quadratic arcs.

    radii: one value or one per point. Open polylines keep their end points."""
    n = len(pts)
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * n
    P = [Vector((p[0], p[1])) for p in pts]
    out = []
    for i in range(n):
        if not closed and i in (0, n - 1):
            out.append(tuple(P[i]))
            continue
        p, a, b = P[i], P[i - 1], P[(i + 1) % n]
        la, lb = (a - p).length, (b - p).length
        d = min(radii[i], la * 0.5, lb * 0.5)
        if d < 1e-6:
            out.append(tuple(p))
            continue
        s, e = p + (a - p).normalized() * d, p + (b - p).normalized() * d
        for k in range(steps + 1):
            t = k / steps
            q = s * (1 - t) ** 2 + p * (2 * t * (1 - t)) + e * t * t
            out.append((q.x, q.y))
    return out


def spline(points, per=6):
    """Catmull-Rom through 3D points -> denser list of Vectors."""
    P = [Vector(p) for p in points]
    if len(P) < 3:
        return P
    out = []
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return out


def _rot_matrix(rot):
    """None, an Euler triple (radians), or a 3x3 basis Matrix (columns = local X, Y, Z)."""
    if rot is None:
        return Matrix.Identity(4)
    if isinstance(rot, Matrix):
        return rot.to_4x4()
    return Euler(rot, 'XYZ').to_matrix().to_4x4()


def basis(x_axis, z_axis):
    """Right-handed 3x3 basis with the given local X and Z (Y = Z x X)."""
    z = Vector(z_axis).normalized()
    x = (Vector(x_axis) - z * Vector(x_axis).dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def place(loc, rot=None, anchor='c', height=0.0):
    m = Matrix.Translation(Vector(loc)) @ _rot_matrix(rot)
    if anchor == 'b':
        m = m @ Matrix.Translation((0, 0, height / 2))
    return m


# ---------------------------------------------------------------- builder
class Builder:
    """Collects primitives into one bmesh, remembering a palette token and a region tag per face/vertex."""

    def __init__(self, lod=0, sharp_deg=48.0):
        self.bm = bmesh.new()
        self.lod = lod
        self.sharp = math.radians(sharp_deg)
        self.mat_l = self.bm.faces.layers.int.new('mat')
        self.ovr_l = self.bm.faces.layers.int.new('ovr')
        self.tag_l = self.bm.verts.layers.int.new('tag')
        self.names = []
        self._name_ix = {}
        self.tags = ['']
        self._tag_ix = {'': 0}

    # -- bookkeeping
    def _mat(self, key):
        if key not in self._name_ix:
            if key not in PAL:
                raise KeyError(f'unknown palette token {key!r}')
            self._name_ix[key] = len(self.names)
            self.names.append(key)
        return self._name_ix[key]

    def _tag(self, tag):
        tag = tag or ''
        if tag not in self._tag_ix:
            self._tag_ix[tag] = len(self.tags)
            self.tags.append(tag)
        return self._tag_ix[tag]

    def seg(self, n):
        return n if self.lod == 0 else max(6, n // 2) if self.lod == 1 else max(4, n // 3)

    def bsegs(self, r):
        """Bevel segments for radius r at this level of detail (0 = hard edge)."""
        if self.lod >= 2 or r <= 5e-4:
            return 0
        if self.lod == 1:
            return 1
        return 3 if r >= 0.02 else 2

    def _absorb(self, tmp, key, matrix, tag, closed=True):
        if closed and tmp.faces:
            bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        if matrix.determinant() < 0 and tmp.faces:
            bmesh.ops.reverse_faces(tmp, faces=tmp.faces)
        bmesh.ops.transform(tmp, matrix=matrix, verts=tmp.verts)
        mid, tid = self._mat(key), self._tag(tag)
        vmap = {}
        verts = []
        for v in tmp.verts:
            nv = self.bm.verts.new(v.co)
            nv[self.tag_l] = tid
            vmap[v] = nv
            verts.append(nv)
        faces = []
        for f in tmp.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf[self.mat_l] = mid
            nf[self.ovr_l] = 0
            faces.append(nf)
        tmp.free()
        self.last_verts, self.last_faces = verts, faces
        return faces

    # -- primitives
    def box(self, mat, loc, size, r=None, rot=None, anchor='c', tag=None, edge_filter=None):
        sx, sy, sz = size
        if r is None:
            r = min(0.05, min(size) * 0.22)
        r = min(r, min(size) * 0.49)
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0)
        bmesh.ops.scale(tmp, vec=Vector(size), verts=tmp.verts)
        n = self.bsegs(r)
        if n:
            edges = [e for e in tmp.edges if edge_filter is None or edge_filter(e)]
            if edges:
                bmesh.ops.bevel(tmp, geom=edges, offset=r, offset_type='OFFSET', segments=n, profile=0.5, affect='EDGES')
        return self._absorb(tmp, mat, place(loc, rot, anchor, sz), tag)

    def cyl(self, mat, loc, r, h, seg=18, r2=None, bevel=None, rot=None, anchor='c', cap=True, tag=None):
        seg = self.seg(seg)
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        if bevel and cap and self.bsegs(bevel):
            rim = [e for e in tmp.edges if all(abs(abs(v.co.z) - h / 2) < 1e-6 for v in e.verts)]
            bmesh.ops.bevel(tmp, geom=rim, offset=min(bevel, h * 0.49, (r if r2 is None else min(r, r2)) * 0.95),
                            segments=self.bsegs(bevel), profile=0.5, affect='EDGES')
        return self._absorb(tmp, mat, place(loc, rot, anchor, h), tag)

    def sphere(self, mat, loc, r, scale=(1, 1, 1), rot=None, seg=14, tag=None):
        seg = max(6, self.seg(seg))
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=seg, v_segments=max(4, seg // 2), radius=r)
        bmesh.ops.scale(tmp, vec=Vector(scale), verts=tmp.verts)
        return self._absorb(tmp, mat, place(loc, rot), tag)

    def torus(self, mat, loc, R, r, seg=28, tseg=8, rot=None, tag=None):
        seg, tseg = self.seg(seg), max(4, self.seg(tseg))
        tmp = bmesh.new()
        ring = []
        for i in range(seg):
            a = TAU * i / seg
            row = []
            for j in range(tseg):
                b = TAU * j / tseg
                d = R + r * math.cos(b)
                row.append(tmp.verts.new((d * math.cos(a), d * math.sin(a), r * math.sin(b))))
            ring.append(row)
        for i in range(seg):
            for j in range(tseg):
                tmp.faces.new([ring[i][j], ring[(i + 1) % seg][j], ring[(i + 1) % seg][(j + 1) % tseg], ring[i][(j + 1) % tseg]])
        return self._absorb(tmp, mat, place(loc, rot), tag)

    def lathe(self, mat, profile, loc=(0, 0, 0), seg=20, rot=None, scale=(1, 1, 1), cap=True, tag=None, phase=0.0):
        """Revolve [(radius, z), ...] (bottom to top) about the local Z axis; z=0 sits at `loc`."""
        seg = self.seg(seg)
        tmp = bmesh.new()
        rows = []
        for r, z in profile:
            if r <= 1e-6:
                rows.append(tmp.verts.new((0, 0, z)))
            else:
                rows.append([tmp.verts.new((r * math.cos(TAU * k / seg + phase), r * math.sin(TAU * k / seg + phase), z)) for k in range(seg)])
        for j in range(len(rows) - 1):
            a, b = rows[j], rows[j + 1]
            if isinstance(a, list) and isinstance(b, list):
                for k in range(seg):
                    tmp.faces.new([a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]])
            elif isinstance(a, list):
                for k in range(seg):
                    tmp.faces.new([a[k], a[(k + 1) % seg], b])
            elif isinstance(b, list):
                for k in range(seg):
                    tmp.faces.new([a, b[(k + 1) % seg], b[k]])
        if cap:
            if isinstance(rows[0], list):
                tmp.faces.new(rows[0][::-1])
            if isinstance(rows[-1], list):
                tmp.faces.new(rows[-1])
        m = place(loc, rot) @ Matrix.Diagonal(Vector((*scale, 1)))
        return self._absorb(tmp, mat, m, tag)

    def tube(self, mat, pts, radii, seg=12, n=2.0, caps=True, round_ends=0, axes=None, rot=None, loc=(0, 0, 0), tag=None, phase=0.0):
        """Superellipse swept along a polyline. radii: number or per-point number/(rx, ry).

        axes=(N, B) pins the section axes (torso lofts); otherwise frames are parallel-transported.
        round_ends: rings of a hemispherical cap at each end (capsules, fingers)."""
        P = [Vector(p) for p in pts]
        m = len(P)
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * m
        R = [(r, r) if not isinstance(r, (list, tuple)) else (r[0], r[1]) for r in radii]
        seg = self.seg(seg)
        T = []
        for i in range(m):
            d = P[min(i + 1, m - 1)] - P[max(i - 1, 0)]
            T.append(d.normalized() if d.length > 1e-9 else Vector((0, 0, 1)))
        if axes is None:
            up = Vector((0, 0, 1)) if abs(T[0].z) < 0.95 else Vector((1, 0, 0))
            Ns = [(up - T[0] * up.dot(T[0])).normalized()]
            for i in range(1, m):
                v = Ns[-1] - T[i] * Ns[-1].dot(T[i])
                Ns.append(v.normalized() if v.length > 1e-6 else Ns[-1])
            Bs = [T[i].cross(Ns[i]) for i in range(m)]
        else:
            Ns, Bs = [Vector(axes[0])] * m, [Vector(axes[1])] * m
        sgn = -1.0 if Ns[0].cross(Bs[0]).dot(T[0]) < 0 else 1.0
        e = 2.0 / n
        tmp = bmesh.new()

        def ring(c, N, B, rx, ry):
            out = []
            for k in range(seg):
                a = sgn * TAU * k / seg + phase
                ca, sa = math.cos(a), math.sin(a)
                x, y = (ca, sa) if n == 2.0 else (sgnpow(ca, e), sgnpow(sa, e))
                out.append(tmp.verts.new(c + N * (x * rx) + B * (y * ry)))
            return out

        rings = []
        poles = [None, None]
        if round_ends:
            r0 = (R[0][0] + R[0][1]) / 2
            for k in range(round_ends, 0, -1):
                th = (math.pi / 2) * k / (round_ends + 1)
                rings.append(ring(P[0] - T[0] * (r0 * math.sin(th)), Ns[0], Bs[0], R[0][0] * math.cos(th), R[0][1] * math.cos(th)))
            poles[0] = tmp.verts.new(P[0] - T[0] * r0)
        for i in range(m):
            rings.append(ring(P[i], Ns[i], Bs[i], R[i][0], R[i][1]))
        if round_ends:
            r1 = (R[-1][0] + R[-1][1]) / 2
            for k in range(1, round_ends + 1):
                th = (math.pi / 2) * k / (round_ends + 1)
                rings.append(ring(P[-1] + T[-1] * (r1 * math.sin(th)), Ns[-1], Bs[-1], R[-1][0] * math.cos(th), R[-1][1] * math.cos(th)))
            poles[1] = tmp.verts.new(P[-1] + T[-1] * r1)
        for j in range(len(rings) - 1):
            a, b = rings[j], rings[j + 1]
            for k in range(seg):
                tmp.faces.new([a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]])
        if poles[0] is not None:
            for k in range(seg):
                tmp.faces.new([poles[0], rings[0][(k + 1) % seg], rings[0][k]])
        elif caps:
            tmp.faces.new(rings[0][::-1])
        if poles[1] is not None:
            for k in range(seg):
                tmp.faces.new([poles[1], rings[-1][k], rings[-1][(k + 1) % seg]])
        elif caps:
            tmp.faces.new(rings[-1])
        return self._absorb(tmp, mat, place(loc, rot), tag, closed=bool(caps or round_ends))

    def capsule(self, mat, a, b, r, seg=10, tag=None, n=2.0):
        return self.tube(mat, [a, b], r, seg=seg, round_ends=2 if self.lod == 0 else 1, n=n, tag=tag)

    def prism(self, mat, pts, h, r=0.0, loc=(0, 0, 0), rot=None, anchor='c', tag=None, side_only=False):
        """Extrude a 2D polygon [(x, y), ...] by h along Z, optionally bevelled."""
        tmp = bmesh.new()
        vs = [tmp.verts.new((x, y, -h / 2)) for x, y in pts]
        f = tmp.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(tmp, geom=[f])
        top = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
        bmesh.ops.translate(tmp, vec=Vector((0, 0, h)), verts=top)
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
        n = self.bsegs(r)
        if n:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=min(r, h * 0.49), segments=n, profile=0.5, affect='EDGES')
        return self._absorb(tmp, mat, place(loc, rot, anchor, h), tag)

    def hull(self, mat, points, r=0.0, loc=(0, 0, 0), rot=None, tag=None):
        tmp = bmesh.new()
        vs = [tmp.verts.new(p) for p in points]
        res = bmesh.ops.convex_hull(tmp, input=vs)
        for g in res.get('geom_interior', []) + res.get('geom_unused', []):
            if isinstance(g, bmesh.types.BMVert) and g.is_valid and not g.link_faces:
                tmp.verts.remove(g)
        bmesh.ops.dissolve_limit(tmp, angle_limit=math.radians(1.5), verts=tmp.verts, edges=tmp.edges)
        n = self.bsegs(r)
        if n:
            bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=r, segments=n, profile=0.5, affect='EDGES')
        return self._absorb(tmp, mat, place(loc, rot), tag)

    def patch(self, mat, fn, nu, nv, closed_u=False, flip=False, loc=(0, 0, 0), rot=None, tag=None):
        """Quad surface from fn(u, v) -> point, u, v in [0, 1]. Open unless closed_u wraps u."""
        tmp = bmesh.new()
        cols = nu if closed_u else nu + 1
        grid = [[tmp.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(cols)]
        for i in range(nu if not closed_u else nu):
            i2 = (i + 1) % cols
            for j in range(nv):
                q = [grid[i][j], grid[i2][j], grid[i2][j + 1], grid[i][j + 1]]
                tmp.faces.new(q[::-1] if flip else q)
        return self._absorb(tmp, mat, place(loc, rot), tag, closed=False)

    # -- post-processing
    def paint(self, faces, fn):
        """Per-face colour override: fn(face_center) -> sRGB hex or None."""
        for f in faces:
            if f.is_valid:
                c = fn(f.calc_center_median())
                if c is not None:
                    f[self.ovr_l] = int(c) + 1

    def map_verts(self, fn, tag=None):
        tid = self._tag_ix.get(tag)
        for v in self.bm.verts:
            if tag is None or v[self.tag_l] == tid:
                p = fn(v.co.copy())
                if p is not None:
                    v.co = p

    def delete_faces(self, pred):
        dead = [f for f in self.bm.faces if pred(f)]
        bmesh.ops.delete(self.bm, geom=dead, context='FACES_ONLY')
        loose = [v for v in self.bm.verts if not v.link_faces]
        bmesh.ops.delete(self.bm, geom=loose, context='VERTS')

    def stats(self):
        return {'verts': len(self.bm.verts), 'tris': sum(len(f.verts) - 2 for f in self.bm.faces)}

    # -- output
    def face_hex(self, f):
        o = f[self.ovr_l]
        return o - 1 if o else PAL[self.names[f[self.mat_l]]]

    def to_object(self, name, collection, mode='mat', parent=None):
        """Bake into a mesh object. Consumes the builder."""
        bm = self.bm
        bm.verts.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < self.sharp
            else:
                e.smooth = True
        me = bpy.data.meshes.new(name)
        if mode == 'vcol':
            # FLOAT_COLOR: values stay linear (a byte layer would be read as sRGB and converted twice)
            layer = bm.loops.layers.float_color.get('Col') or bm.loops.layers.float_color.new('Col')
            for f in bm.faces:
                c = lin(self.face_hex(f))
                for loop in f.loops:
                    loop[layer] = (c[0], c[1], c[2], 1.0)
            me.materials.append(material('', vcol=True))
        else:
            used = sorted({f[self.mat_l] for f in bm.faces})
            slot = {mid: i for i, mid in enumerate(used)}
            for f in bm.faces:
                f.material_index = slot[f[self.mat_l]]
            for mid in used:
                me.materials.append(material(self.names[mid]))
        bm.to_mesh(me)
        for attr in ('mat', 'ovr'):
            if attr in me.attributes:
                me.attributes.remove(me.attributes[attr])
        if mode == 'vcol':
            # the converted layer is FLOAT_COLOR; make it the render/export colour
            ca = me.color_attributes.get('Col')
            if ca:
                me.color_attributes.active_color = ca
                me.color_attributes.render_color_index = list(me.color_attributes).index(ca)
        me.update()
        obj = bpy.data.objects.new(name, me)
        collection.objects.link(obj)
        if parent is not None:
            obj.parent = parent
        return obj


# ---------------------------------------------------------------- scene helpers
def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c


def clear_collection(c, purge=True):
    for o in list(c.objects):
        me = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o, do_unlink=True)
        if purge and me is not None and me.users == 0:
            bpy.data.meshes.remove(me)
    for child in list(c.children):
        clear_collection(child, purge)
        bpy.data.collections.remove(child)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def export_glb(path, objects, skins=False, animations=False, morph=False, vcol=False, normals=True, apply=False, anim_mode='ACTIONS'):
    """glTF binary of the given objects (and nothing else)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=apply, export_texcoords=False,
              export_normals=normals, export_materials='EXPORT', export_vertex_color='ACTIVE' if vcol else 'NONE',
              export_skins=skins, export_animations=animations, export_morph=morph, export_yup=True)
    if animations:
        kw.update(export_animation_mode=anim_mode, export_force_sampling=True)
    bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)


def save_library(path, datablocks):
    """Write only the given datablocks (scenes, collections...) to a new .blend."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.data.libraries.write(path, set(datablocks), fake_user=True, compress=True)
    return os.path.getsize(path)
