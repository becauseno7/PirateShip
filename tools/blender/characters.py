"""Builds the character body parts for the game in Blender and exports public/models/characters.glb.

Run with Blender's Python module (pip install bpy) or Blender itself:
    python tools/blender/characters.py [--preview out_dir]

The torso and limbs are lofted through hand-placed cross-sections (with muscle bulges laid over
them) so their surfaces stay smooth; the hand is sculpted from primitives fused by a voxel
remesh. Parts are modelled for the rig's rest layout (metres, character facing -Y in Blender,
+Z in three.js):
  hips 0.95, spine 1.01, chest 1.33, neck 1.53, head 1.59; shoulders at x=+-0.25, z=1.40;
  elbow 0.29 and wrist 0.57 down the arm; hips at x=+-0.10, z=0.93, knee 0.49, ankle 0.06.
Arms are modelled in an A-pose (ARM_ANGLE out from vertical); the game binds them in that pose.
Only left-side limbs are exported; the game mirrors them for the right side.
"""
import math
import sys

import bpy  # noqa: I001  (bpy must load before bmesh/mathutils)
import bmesh
from mathutils import Matrix, Vector

ARM_ANGLE = 0.3
OUT = 'public/models/characters.glb'


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def link(name, mesh):
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def interp_rings(keys, steps):
    """Catmull-Rom through key rows of floats; returns `steps` rows per span."""
    out = []
    n = len(keys)
    for i in range(n - 1):
        k0, k1, k2, k3 = keys[max(0, i - 1)], keys[i], keys[i + 1], keys[min(n - 1, i + 2)]
        for s in range(steps):
            t = s / steps
            out.append([catmull(a, b, c, d, t) for a, b, c, d in zip(k0, k1, k2, k3)])
    out.append(list(keys[-1]))
    return out


def loft(name, rings, frame, seg=40, bumps=(), exp=2.0):
    """Lofted closed surface.

    rings: rows of (s, out, inn, front, back[, exponent]) where s runs along the part's axis;
    frame(s) -> (centre, u_out, v_front) gives each ring's placement.
    bumps: (s0, theta0, amp, sigma_s, sigma_theta) gaussians added along the surface normal;
    theta 0 points out (u), pi/2 to the front (v).
    """
    bm = bmesh.new()
    rows = []
    for row in rings:
        s, ro, ri, rf, rb = row[:5]
        e = row[5] if len(row) > 5 else exp
        c, u, v = frame(s)
        verts = []
        for k in range(seg):
            th = (k / seg) * math.tau
            cs, sn = math.cos(th), math.sin(th)
            rx = ro if cs >= 0 else ri
            ry = rf if sn >= 0 else rb
            px = math.copysign(abs(cs) ** (2 / e), cs) * rx
            py = math.copysign(abs(sn) ** (2 / e), sn) * ry
            p = c + u * px + v * py
            radial = (u * px + v * py)
            if radial.length > 1e-6:
                nrm = radial.normalized()
                for s0, t0, amp, ss, st in bumps:
                    dt = (th - t0 + math.pi) % math.tau - math.pi
                    p += nrm * amp * math.exp(-((s - s0) / ss) ** 2 - (dt / st) ** 2)
            verts.append(bm.verts.new(p))
        rows.append(verts)
    for a, b in zip(rows, rows[1:]):
        for k in range(seg):
            bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    for row, flip in ((rows[0], True), (rows[-1], False)):
        c = sum((v.co for v in row), Vector()) / seg
        cv = bm.verts.new(c)
        for k in range(seg):
            f = (row[k], row[(k + 1) % seg], cv)
            bm.faces.new(f[::-1] if flip else f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return link(name, me)


def subdivide(ob, levels=1):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me
    for p in me.polygons:
        p.use_smooth = True
    return ob


def torso():
    F = math.pi / 2  # front
    B = -math.pi / 2  # back
    # z, half-width, (same), front depth, back depth, superellipse exponent (boxier at the chest).
    keys = [
        (0.77, 0.07, 0.07, 0.05, 0.06, 2.0),
        (0.8, 0.13, 0.13, 0.085, 0.1, 2.1),
        (0.86, 0.168, 0.168, 0.105, 0.125, 2.2),
        (0.94, 0.178, 0.178, 0.11, 0.12, 2.3),
        (1.02, 0.166, 0.166, 0.108, 0.108, 2.3),
        (1.1, 0.152, 0.152, 0.104, 0.102, 2.3),
        (1.18, 0.158, 0.158, 0.11, 0.108, 2.4),
        (1.27, 0.178, 0.178, 0.122, 0.118, 2.5),
        (1.35, 0.198, 0.198, 0.125, 0.122, 2.6),
        (1.415, 0.212, 0.212, 0.112, 0.118, 2.6),
        (1.46, 0.18, 0.18, 0.088, 0.1, 2.4),
        (1.495, 0.11, 0.11, 0.066, 0.075, 2.2),
        (1.53, 0.064, 0.064, 0.056, 0.06, 2.0),
        (1.62, 0.056, 0.056, 0.052, 0.054, 2.0),
        (1.7, 0.05, 0.05, 0.048, 0.05, 2.0),
    ]
    rings = interp_rings(keys, 4)
    bumps = [
        # Pecs with a sternum groove, abdomen, shoulder blades, spine groove, glutes and their cleft.
        (1.355, F - 0.42, 0.02, 0.045, 0.32), (1.355, F + 0.42, 0.02, 0.045, 0.32),
        (1.33, F, -0.006, 0.06, 0.12),
        (1.13, F, 0.008, 0.07, 0.4),
        (1.34, B - 0.5, 0.01, 0.06, 0.35), (1.34, B + 0.5, 0.01, 0.06, 0.35),
        (1.2, B, -0.008, 0.18, 0.1),
        (0.88, B - 0.55, 0.018, 0.06, 0.45), (0.88, B + 0.55, 0.018, 0.06, 0.45),
        (0.86, B, -0.016, 0.06, 0.1),
        # Trapezius slope.
        (1.475, -0.0, 0.01, 0.03, 0.5), (1.475, math.pi, 0.01, 0.03, 0.5),
    ]
    frame = lambda z: (Vector((0, 0.004, z)), Vector((1, 0, 0)), Vector((0, -1, 0)))
    return loft('torso', rings, frame, seg=48, bumps=bumps)


def arm():
    a = ARM_ANGLE
    S = Vector((0.25, 0, 1.40))
    d = Vector((math.sin(a), 0, -math.cos(a)))
    out = Vector((math.cos(a), 0, math.sin(a)))
    fwd = Vector((0, -1, 0))
    F = math.pi / 2
    # s along the arm, out, in, front, back.
    keys = [
        (-0.075, 0.03, 0.03, 0.03, 0.03),
        (-0.055, 0.058, 0.05, 0.058, 0.058),
        (-0.02, 0.074, 0.06, 0.066, 0.066),
        (0.04, 0.074, 0.058, 0.064, 0.064),
        (0.1, 0.064, 0.054, 0.06, 0.06),
        (0.16, 0.056, 0.05, 0.058, 0.056),
        (0.23, 0.05, 0.047, 0.05, 0.051),
        (0.29, 0.046, 0.045, 0.043, 0.049),
        (0.35, 0.053, 0.048, 0.046, 0.047),
        (0.43, 0.045, 0.041, 0.039, 0.04),
        (0.52, 0.035, 0.033, 0.028, 0.03),
        (0.57, 0.032, 0.031, 0.026, 0.027),
        (0.585, 0.02, 0.02, 0.016, 0.016),
    ]
    rings = interp_rings(keys, 4)
    bumps = [
        (0.15, F, 0.01, 0.05, 0.6),  # biceps
        (0.13, -F, 0.007, 0.06, 0.6),  # triceps
        (0.0, 0.0, 0.006, 0.05, 0.8),  # deltoid
    ]
    frame = lambda s: (S + d * s, out, fwd)
    return loft('arm', rings, frame, seg=24, bumps=bumps)


def leg():
    H = Vector((0.1, 0, 0.93))
    down = Vector((0, 0, -1))
    out = Vector((1, 0, 0))
    fwd = Vector((0, -1, 0))
    F = math.pi / 2
    keys = [
        (-0.1, 0.05, 0.05, 0.05, 0.05),
        (-0.06, 0.092, 0.085, 0.09, 0.095),
        (0.02, 0.1, 0.09, 0.095, 0.1),
        (0.12, 0.096, 0.084, 0.09, 0.09),
        (0.23, 0.084, 0.075, 0.08, 0.074),
        (0.34, 0.069, 0.064, 0.066, 0.063),
        (0.44, 0.059, 0.057, 0.06, 0.055),
        (0.51, 0.057, 0.055, 0.05, 0.062),
        (0.59, 0.056, 0.054, 0.046, 0.066),
        (0.69, 0.046, 0.045, 0.041, 0.05),
        (0.79, 0.038, 0.037, 0.035, 0.038),
        (0.87, 0.037, 0.036, 0.035, 0.036),
        (0.9, 0.02, 0.02, 0.02, 0.02),
    ]
    rings = interp_rings(keys, 4)
    bumps = [
        (0.44, F, 0.008, 0.03, 0.5),  # kneecap
        (0.24, F - 0.4, 0.006, 0.08, 0.5),  # quads
        (0.56, -F + 0.35, 0.008, 0.07, 0.6),  # calf heads
    ]
    frame = lambda s: (H + down * s, out, fwd)
    return loft('leg', rings, frame, seg=24, bumps=bumps)


class Sculpt:
    """Primitives fused with a voxel remesh, for small organic parts like the hand."""

    def __init__(self):
        self.bm = bmesh.new()

    def ellipsoid(self, c, r, along=None, seg=24):
        m = Matrix.Translation(Vector(c))
        if along is not None:
            m = m @ Vector(along).normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = m @ Matrix.Diagonal((r[0], r[1], r[2], 1.0))
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=seg // 2, radius=1.0, matrix=m)

    def sphere(self, c, r):
        self.ellipsoid(c, (r, r, r))

    def limb(self, a, b, ra, rb, seg=16):
        a, b = Vector(a), Vector(b)
        d = b - a
        m = Matrix.Translation((a + b) / 2) @ d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.create_cone(self.bm, cap_ends=True, segments=seg, radius1=ra, radius2=rb, depth=d.length, matrix=m)
        self.sphere(a, ra)
        self.sphere(b, rb)

    def build(self, name, voxel, smooth=4, factor=0.5, tris=1600):
        me = bpy.data.meshes.new(name + '_src')
        self.bm.to_mesh(me)
        self.bm.free()
        ob = link(name + '_src', me)
        rm = ob.modifiers.new('remesh', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = voxel
        sm = ob.modifiers.new('smooth', 'SMOOTH')
        sm.factor = factor
        sm.iterations = smooth
        dec = ob.modifiers.new('dec', 'DECIMATE')
        dg = bpy.context.evaluated_depsgraph_get()
        n = len(ob.evaluated_get(dg).data.polygons) * 2
        dec.ratio = min(1.0, tris / max(1, n))
        dg = bpy.context.evaluated_depsgraph_get()
        mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        bpy.data.objects.remove(ob)
        for p in mesh.polygons:
            p.use_smooth = True
        return link(name, mesh)


def hand():
    """Relaxed fist at the wrist (origin), fingers hanging down (-Z) and curling forward (-Y)."""
    s = Sculpt()
    s.limb((0, 0, 0.012), (0, 0, -0.02), 0.03, 0.034)
    s.ellipsoid((0, 0.002, -0.048), (0.046, 0.022, 0.045))
    s.ellipsoid((-0.02, -0.01, -0.03), (0.022, 0.017, 0.026))  # thenar pad
    lengths = (0.86, 1.0, 0.96, 0.8)
    for i, k in enumerate(lengths):
        x = -0.03 + i * 0.02
        r = 0.0115 - i * 0.0008
        p0 = Vector((x, -0.004, -0.086))
        p1 = p0 + Vector((0, -0.014, -0.03 * k))
        p2 = p1 + Vector((0, -0.026 * k, -0.008))
        p3 = p2 + Vector((0, -0.012 * k, 0.017 * k))
        s.limb(p0, p1, r, r * 0.95, seg=12)
        s.limb(p1, p2, r * 0.95, r * 0.88, seg=12)
        s.limb(p2, p3, r * 0.88, r * 0.8, seg=12)
    t0, t1, t2 = Vector((-0.036, -0.012, -0.03)), Vector((-0.044, -0.034, -0.058)), Vector((-0.024, -0.05, -0.078))
    s.limb(t0, t1, 0.0142, 0.013, seg=12)
    s.limb(t1, t2, 0.013, 0.0112, seg=12)
    return s.build('hand', 0.0022, smooth=4, factor=0.5, tris=1600)


HEADS = {
    # Jaw taper (the rig's face styles), nose and brow strength, cheekbone width.
    'hero': dict(jaw=1.0, nose=1.0, brow=0.8, cheek=0.084),
    'grunt': dict(jaw=0.8, nose=1.15, brow=1.0, cheek=0.088),
    'brute': dict(jaw=0.4, nose=1.5, brow=1.6, cheek=0.095),
    'fem': dict(jaw=1.05, nose=0.7, brow=0.5, cheek=0.08),
}
R_HEAD = 0.19


def head(style):
    """Anime head on the skull pivot: a smooth deformed sphere with a slim jaw, pointed chin,
    soft cheekbones, a small nose and brow, plus sculpted ears. Built in three.js axes
    (+Z = face) and converted to Blender axes on output."""
    p = HEADS[style]
    r, jaw = R_HEAD, p['jaw']
    g = lambda x, s: math.exp(-(x / s) ** 2)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=56, v_segments=36, radius=r)
    # Face-paint UVs from the undeformed sphere, matching the atlas layout the game paints
    # (azimuth window of 1.9 rad around the face, polar angle 0.6..2.22 from the crown).
    uv_of = {}
    for v in bm.verts:
        x, y, z = v.co.x, v.co.z, -v.co.y
        th = math.acos(max(-1.0, min(1.0, y / r)))
        ph = math.atan2(z, -x)
        uv_of[v.index] = ((ph - (math.pi / 2 - 0.95)) / 1.9, 1 - (th - 0.6) / 1.62)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for lp in f.loops:
            lp[uv].uv = uv_of[lp.vert.index]
    for v in bm.verts:
        x, y, z = v.co.x, v.co.z, -v.co.y  # Blender -> three axes
        yn = y / r
        if yn < 0.15:
            k = min(1.0, (0.15 - yn) / 1.15)
            x *= 1 - 0.36 * jaw * k * k
            z *= (1 - 0.32 * k * k) if z < 0 else (1 + 0.05 * k)
            y -= 0.08 * r * k * k * jaw
        if z < 0 and yn > -0.25:
            z *= 1.07
        x *= 0.95
        if z > 0:
            front = min(1.0, z / (r * 0.6))
            n = p['nose']
            z += front * (0.015 * n * g(x, 0.017 * n) * g(y + 0.047, 0.028 * n) + 0.006 * n * g(x, 0.015) * g(y + 0.064, 0.014))
            z += front * 0.005 * p['brow'] * g(y - 0.035, 0.018) * g(x, 0.1)
            z += front * 0.006 * g(y + 0.19, 0.03) * g(x, 0.03)  # chin point
            c = 0.008 * g(abs(x) - p['cheek'], 0.03) * g(y + 0.045, 0.035)
            ln = math.sqrt(x * x + y * y + z * z) or 1
            x, y, z = x + x / ln * c, y + y / ln * c, z + z / ln * c
        v.co = Vector((x, -z, y))
    # Ears: a flattened shell with a rolled rim and a little lobe, just behind the cheek.
    for sx in (-1, 1):
        for c, rad in (((sx * 0.172, 0.014, -0.02), (0.014, 0.03, 0.045)), ((sx * 0.178, 0.012, -0.012), (0.01, 0.026, 0.036)), ((sx * 0.17, 0.0, -0.06), (0.012, 0.016, 0.016))):
            m = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((rad[0], rad[1], rad[2], 1.0))
            bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0, matrix=m)
    me = bpy.data.meshes.new('head_' + style)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    return link('head_' + style, me)


def preview(out_dir, objs):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.device = 'CPU'
    scene.render.resolution_x, scene.render.resolution_y = 640, 800
    mat = bpy.data.materials.new('clay')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.85, 0.62, 0.48, 1)
    for o in objs:
        o.data.materials.append(mat)
    a = ARM_ANGLE
    wrist = Vector((0.25 + math.sin(a) * 0.57, 0, 1.40 - math.cos(a) * 0.57))
    for o in list(objs):
        if o.name == 'hand':
            o.location = wrist
            o.rotation_euler = (0, -a, 0)
        if o.name in ('arm', 'leg', 'hand'):
            c = link(o.name + '_r', o.data)
            c.location = (-o.location.x, o.location.y, o.location.z)
            c.rotation_euler = (0, a if o.name == 'hand' else 0, 0)
            c.scale.x = -1
    for o in objs:
        if o.name.startswith('head_'):
            o.location = (0, 0, 1.59 + 0.155 * 1.12)
            o.scale = (1.12, 1.12, 1.12 * 1.06)
            o.hide_render = o.name != 'head_hero'
    sun = link('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (0.9, 0.3, 0.6)
    world = bpy.data.worlds.new('w')
    world.color = (0.5, 0.55, 0.6)
    scene.world = world
    cam = link('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.0
    scene.camera = cam
    hz = 1.59 + 0.155 * 1.12
    views = (
        ('front', (0, -4, 0.95), (math.pi / 2, 0, 0), 2.0), ('side', (4, 0, 0.95), (math.pi / 2, 0, math.pi / 2), 2.0),
        ('back', (0, 4, 0.95), (math.pi / 2, 0, math.pi), 2.0), ('face', (0, -4, hz - 0.05), (math.pi / 2, 0, 0), 0.6),
        ('face34', (2.6, -3.1, hz - 0.05), (math.pi / 2, 0, math.radians(40)), 0.6), ('faceside', (4, 0, hz - 0.05), (math.pi / 2, 0, math.pi / 2), 0.6),
    )
    for nm, loc, rot, sc in views:
        cam.location, cam.rotation_euler = loc, rot
        cam.data.ortho_scale = sc
        scene.render.filepath = f'{out_dir}/body-{nm}.png'
        bpy.ops.render.render(write_still=True)


def main():
    reset()
    objs = [torso(), arm(), leg(), hand()] + [head(k) for k in HEADS]
    for o in objs:
        print(o.name, len(o.data.vertices), 'verts', len(o.data.polygons), 'faces', [round(v, 3) for v in o.dimensions])
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True,
                              export_normals=True, export_materials='NONE', export_yup=True)
    if '--preview' in sys.argv:
        preview(sys.argv[sys.argv.index('--preview') + 1], objs)


main()
