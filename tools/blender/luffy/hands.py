"""Clean stylised hands with finger bones, replacing the AI claws (imported by stage2)."""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector, Matrix

FINGERS = [  # name, lateral offset (x palm width/2), lengths (prox, mid, dist), radius
    ('index', 0.70, (0.040, 0.026, 0.022), 0.0108),
    ('middle', 0.23, (0.044, 0.029, 0.024), 0.0112),
    ('ring', -0.23, (0.041, 0.027, 0.022), 0.0106),
    ('pinky', -0.68, (0.032, 0.021, 0.019), 0.0094),
]
PALM_W, PALM_L, PALM_T = 0.088, 0.084, 0.034


def skin_colour(o):
    """Average the forearm skin of the AI texture so the new hands match it."""
    me = o.data
    mat = me.materials[0]
    img = [n.image for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and 'normal' not in n.image.name and 'metal' not in n.image.name][0]
    W, H = img.size
    px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
    gi = {g.name: g.index for g in o.vertex_groups}
    want = {gi['forearm.R'], gi['forearm.L']}
    uv = me.uv_layers.active.data
    cols = []
    for poly in me.polygons:
        if poly.material_index != 0: continue
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            if any(g.group in want and g.weight > 0.8 for g in v.groups):
                u, w = uv[li].uv
                c = px[int(np.clip(w, 0, 0.999) * H), int(np.clip(u, 0, 0.999) * W), :3]
                cols.append(c)
    cols = np.array(cols)
    import colorsys
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in cols])
    sk = cols[(hsv[:, 0] > 0.02) & (hsv[:, 0] < 0.12) & (hsv[:, 1] > 0.2) & (hsv[:, 1] < 0.6) & (hsv[:, 2] > 0.6)]
    c = np.median(sk, axis=0)
    print('hands: skin sample', len(sk), c)
    return c


def shape(bm, centre, ax, side, nrm, half_len, r_a, r_b, square=1.0, flat=1.0, segs=14, rings=10):
    """Capsule/rounded box along ax: half_len between cap centres, radius r_a (start) -> r_b (end)."""
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    vs = res['verts']
    for v in vs:
        x, y, z = v.co
        if square != 1.0:
            x = math.copysign(abs(x) ** square, x); y = math.copysign(abs(y) ** square, y)
        s = (z + 1) / 2
        r = r_a + (r_b - r_a) * s
        axial = math.copysign(half_len, z) + z * r
        v.co = centre + ax * axial + side * (x * r) + nrm * (y * r * flat)
    return vs


def build(o, ao, S, twist_R=0.0, twist_L=0.0):
    me = o.data
    gi = {g.name: g.index for g in o.vertex_groups}
    skin = skin_colour(o)
    skin = np.clip(skin * np.array([1.0, 1.06, 0.98]), 0, 1)
    lin = [c ** 2.2 for c in skin]
    mat = bpy.data.materials.new('skin'); mat.use_nodes = True
    bs = mat.node_tree.nodes['Principled BSDF']
    bs.inputs['Base Color'].default_value = (*lin, 1); bs.inputs['Roughness'].default_value = 0.62
    me.materials.append(mat); mi = len(me.materials) - 1

    bm = bmesh.new(); bm.from_mesh(me)
    dl = bm.verts.layers.deform.verify()
    # Heat weights gave the AI forearms mostly to the hand bones. Re-weight each forearm by its
    # position along the bone, then drop only what lies past the wrist (the AI claw).
    kill = []
    for side in ('R', 'L'):
        fb = ao.data.bones['forearm.' + side]
        E, Wr = fb.head_local, fb.tail_local; ax = Wr - E; L2 = ax.dot(ax)
        up, fo, ha = gi['upperarm.' + side], gi['forearm.' + side], gi['hand.' + side]
        for v in bm.verts:
            d = v[dl]
            if d.get(fo, 0) + d.get(ha, 0) < 0.3: continue
            sp = (v.co - E).dot(ax) / L2
            if sp > 1.03 or (sp > 0.97 and d.get(ha, 0) > 0.5):
                kill.append(v); continue
            if sp > 0.4:   # the AI forearm is a few dark shards: tuck them inside the new forearm
                c = E + ax * sp; r = v.co - c
                if r.length > 0.012: v.co = c + r * (0.012 / r.length)
            A = d.get(up, 0) + d.get(fo, 0) + d.get(ha, 0)
            fu = min(1, max(0, (0.12 - sp) / 0.24)); fu = fu * fu * (3 - 2 * fu)
            fh = min(1, max(0, (sp - 0.86) / 0.14)) * 0.35
            for kk in (up, fo, ha):
                if kk in d: del d[kk]
            if fu > 0: d[up] = A * fu
            if fh > 0: d[ha] = A * (1 - fu) * fh
            d[fo] = A * (1 - fu) * (1 - fh)
    kill = list(set(kill))
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    print('hands: removed AI hand verts', len(kill))

    newbones = []  # (name, head, tail, parent, zaxis)
    groups = {}    # bone -> list of (bmvert, weight)
    for side, guess, tw in (('R', Vector((0, 0, -1)), twist_R), ('L', Vector((-1, 0, 0)), twist_L)):
        hb = ao.data.bones['hand.' + side]
        W = hb.head_local.copy(); v = (hb.tail_local - hb.head_local).normalized()
        n = (guess - v * guess.dot(v)).normalized()
        n = Matrix.Rotation(tw, 3, v) @ n
        t = v.cross(n) if side == 'R' else n.cross(v)   # thumb side
        k = v.cross(n)                                    # finger curl axis (+bend curls into the palm)

        def add(vs, bone, w=1.0):
            groups.setdefault(bone, []).extend((x, w) for x in vs)
        # forearm: the AI sleeve ends well short of the wrist, so model the bare forearm
        fb = ao.data.bones['forearm.' + side]
        E, Wr = fb.head_local, fb.tail_local; fax = (Wr - E).normalized(); FL = (Wr - E).length
        a0, a1 = E + fax * (FL * 0.22), Wr + fax * 0.004
        fn = (n - fax * n.dot(fax)).normalized(); ft = fax.cross(fn)
        vs = shape(bm, (a0 + a1) / 2, fax, ft, fn, (a1 - a0).length / 2, 0.033, 0.0245, square=1.0, flat=0.86, segs=16, rings=14)
        for x in vs:
            sp = (x.co - E).dot(fax) / FL
            # a little forearm muscle near the elbow
            c = E + fax * (sp * FL); r = x.co - c
            bulge = 1 + 0.12 * math.exp(-((sp - 0.42) / 0.18) ** 2)
            x.co = c + r * bulge
            hw = min(1, max(0, (sp - 0.82) / 0.18)) * 0.4
            groups.setdefault('forearm.' + side, []).append((x, 1 - hw))
            if hw > 0: groups.setdefault('hand.' + side, []).append((x, hw))
        pc = W + v * (PALM_L / 2 - 0.012) + n * 0.002
        vs = shape(bm, pc, v, t, n, PALM_L / 2 - PALM_T / 2, PALM_T / 2, PALM_T / 2 * 0.92, square=0.55, flat=1.0, segs=18, rings=12)
        # widen the palm: shape() is round across, so scale along t
        for x in vs:
            d = x.co - pc
            x.co = pc + v * d.dot(v) + n * d.dot(n) + t * (d.dot(t) * (PALM_W / PALM_T))
        add(vs, 'hand.' + side)
        for fname, lat, lens, rad in FINGERS:
            base = W + v * (PALM_L - 0.016 - (0.006 if fname == 'pinky' else 0) - (0.002 if fname in ('index', 'ring') else 0)) + t * (lat * PALM_W / 2) + n * 0.001
            d = (v + t * lat * 0.06).normalized()
            p = base; par = 'hand.' + side
            for i, L in enumerate(lens):
                bn = f'{fname}{i + 1}.{side}'
                q = p + d * L
                r0 = rad * (1 - 0.08 * i); r1 = rad * (1 - 0.08 * (i + 1)) * (0.92 if i == 2 else 1)
                vs = shape(bm, (p + q) / 2, d, t, n, L / 2, r0, r1, square=0.85, flat=0.86, segs=12, rings=8)
                add(vs, bn)
                newbones.append((bn, p.copy(), q.copy(), par, k.cross(d).normalized()))
                par = bn; p = q
        # thumb: from the heel of the palm, angled out and toward the palm side
        tb = W + v * 0.018 + t * (PALM_W / 2 - 0.008) + n * 0.006
        td = (v * 0.62 + t * 0.62 + n * 0.42).normalized()
        m = (n * 0.55 - t * 0.75 + v * 0.25).normalized()
        kt = td.cross(m).normalized()
        p = tb; par = 'hand.' + side
        for i, (L, rad) in enumerate(((0.036, 0.0142), (0.030, 0.0128), (0.025, 0.0118))):
            bn = f'thumb{i + 1}.{side}'
            q = p + td * L
            vs = shape(bm, (p + q) / 2, td, kt, td.cross(kt), L / 2, rad, rad * 0.94, square=0.85, flat=0.88, segs=12, rings=8)
            add(vs, bn)
            newbones.append((bn, p.copy(), q.copy(), par, kt.cross(td).normalized()))
            par = bn; p = q
            td = (td + m * 0.18).normalized()

    newv = {x for lst in groups.values() for x, _ in lst}
    for f in bm.faces:
        if all(x in newv for x in f.verts):
            f.material_index = mi; f.smooth = True
    bm.verts.index_update()
    gidx={bn:[(x.index,w) for x,w in lst] for bn,lst in groups.items()}
    bm.to_mesh(me); bm.free()
    # bones
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode='EDIT')
    eb = ao.data.edit_bones
    for bn, h, tl, par, z in newbones:
        e = eb.new(bn); e.head = h; e.tail = tl; e.parent = eb[par]; e.use_deform = True
        e.align_roll(z)   # local X = curl axis
    bpy.ops.object.mode_set(mode='OBJECT')
    # weights (bmesh verts were remapped by to_mesh: new verts keep their indices order)
    for bn, lst in gidx.items():
        g = o.vertex_groups.get(bn) or o.vertex_groups.new(name=bn)
        for i, w in lst: g.add([i], w, 'REPLACE')
    print('hands: built', len(newv), 'verts,', len(newbones), 'finger bones')
