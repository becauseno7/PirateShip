"""Pose authoring on an arbitrary rest pose.

Character space = armature space: +X = character's left, -Y = forward, +Z = up (metres, feet at 0).
A pose is a dict:
  'root': {'loc': (x,y,z), 'rot': (pitch, roll, yaw)}     # whole-body offset (hips follow)
  'hips': {'loc': (dx,dy,dz), 'rot': (...)}               # pelvis offset from rest + rotation
  bone: {'rot': (rx, ry, rz)}   rotation (radians, about character X/Y/Z) in the parent's posed frame
  bone: {'aim': (x,y,z), 'twist': a}  aim the bone along a character-space direction
  'ik': {'arm.R': {'target': p, 'pole': v, 'hand': dir, 'twist': a, 'stretch': s}, 'leg.L': {...}}
Bones not mentioned keep their rest orientation relative to the parent.
"""
import bpy, math
from mathutils import Vector, Matrix, Quaternion, Euler

LIMBS = {
    'arm.R': ('upperarm.R', 'forearm.R', 'hand.R'),
    'arm.L': ('upperarm.L', 'forearm.L', 'hand.L'),
    'leg.R': ('thigh.R', 'shin.R', 'foot.R'),
    'leg.L': ('thigh.L', 'shin.L', 'foot.L'),
}


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def rot_q(r):
    if r is None:
        return Quaternion()
    return Euler(r, 'XYZ').to_quaternion()


class Rig:
    def __init__(self, ao):
        self.ao = ao
        self.bones = ao.data.bones
        self.order = []  # parent-first
        def walk(b):
            self.order.append(b.name)
            for c in b.children:
                walk(c)
        for b in self.bones:
            if b.parent is None:
                walk(b)
        self.R = {b.name: b.matrix_local.copy() for b in self.bones}
        self.head = {b.name: b.head_local.copy() for b in self.bones}
        self.tail = {b.name: b.tail_local.copy() for b in self.bones}
        self.len = {b.name: b.length for b in self.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in self.bones}
        self.limb_of = {}
        for k, (a, b, c) in LIMBS.items():
            self.limb_of[a] = (k, 0); self.limb_of[b] = (k, 1); self.limb_of[c] = (k, 2)

    def solve(self, pose):
        """Returns {bone: posed armature-space 4x4 matrix}."""
        M, Q, S = {}, {}, {}
        ik = pose.get('ik', {})
        ikjoints = {}
        for name in self.order:
            p = self.parent[name]
            spec = pose.get(name, {})
            Rr = self.R[name].to_quaternion()
            if p is None:
                qacc = rot_q(spec.get('rot'))
                head = self.head[name] + V(spec.get('loc', (0, 0, 0)))
            else:
                qp = Q[p]
                # head follows the parent's posed transform (including stretch of the parent)
                off = self.head[name] - self.head[p]
                Rp = self.R[p].to_3x3()
                local = Rp.inverted() @ off
                local.y *= S[p]
                head = M[p].to_translation() + (qp @ self.R[p].to_quaternion()).to_matrix() @ local
                if name == 'hips':
                    head = head + V(spec.get('loc', (0, 0, 0)))
                qacc = qp @ rot_q(spec.get('rot'))
                if 'bend' in spec or 'splay' in spec:   # about the bone's own rest X (curl) / Z (spread) axes
                    R3 = self.R[name].to_3x3()
                    qacc = qacc @ Quaternion(R3.col[0], spec.get('bend', 0.0)) @ Quaternion(R3.col[2], spec.get('splay', 0.0))
                if 'aim' in spec:
                    qacc = self._aim(qacc, Rr, V(spec['aim']), spec.get('twist', 0.0))
            sy = spec.get('stretch', 1.0)
            if name in self.limb_of:
                k, idx = self.limb_of[name]
                if k in ik:
                    qacc, head, sy = self._ik(name, k, idx, ik[k], qacc, Rr, head, ikjoints, M)
            Q[name] = qacc
            S[name] = sy
            rot = (qacc @ Rr).to_matrix().to_4x4()
            M[name] = Matrix.Translation(head) @ rot @ Matrix.Diagonal((1, sy, 1, 1))
        return M

    def _aim(self, qacc, Rr, d, twist):
        cur = (qacc @ Rr) @ Vector((0, 1, 0))
        d = d.normalized()
        q = cur.rotation_difference(d)
        q = Quaternion(d, twist) @ q
        return q @ qacc

    def _space(self, spec, M):
        rel = spec.get('rel')
        if rel is None:
            return Matrix.Identity(4)
        return M[rel] @ self.R[rel].inverted()

    def _ik(self, name, k, idx, spec, qacc, Rr, head, J, M):
        a, b, c = LIMBS[k]
        st = spec.get('stretch', 1.0)
        X = self._space(spec, M)
        Xr = X.to_quaternion()
        if idx == 0:
            ab = spec.get('abs', 0.0)   # 0 = target in the 'rel' bone's space, 1 = plain character space
            T = (X @ V(spec['target'])).lerp(V(spec['target']), ab)
            d = T - head
            if spec.get('autostretch'):
                st = max(st, d.length / ((self.len[a] + self.len[b]) * 0.97))
            la, lb = self.len[a] * st, self.len[b] * st
            dist = min(d.length, (la + lb) * 0.9995)
            dn = d.normalized()
            pole = (Xr @ V(spec.get('pole', (0, -1, 0)))).lerp(V(spec.get('pole', (0, -1, 0))), ab)
            pole = (pole - dn * pole.dot(dn)).normalized()
            # law of cosines
            cosA = (la * la + dist * dist - lb * lb) / (2 * la * dist)
            A = math.acos(max(-1, min(1, cosA)))
            elbow = head + (dn * math.cos(A) + pole * math.sin(A)) * la
            J[k] = (head.copy(), elbow, head + dn * dist, st)
            qacc = self._aim(qacc, Rr, elbow - head, spec.get('twist', 0.0))
            return qacc, head, st
        if idx == 1:
            sh, el, wr, st = J[k]
            qacc = self._aim(qacc, Rr, wr - el, spec.get('twist2', 0.0))
            return qacc, el, st
        # end bone: optional aim; counter the stretch so the hand/foot keeps its size
        sh, el, wr, st = J[k]
        if 'end' in spec:
            ab = spec.get('abs', 0.0)
            qacc = self._aim(qacc, Rr, (Xr @ V(spec['end'])).lerp(V(spec['end']), ab), spec.get('endtwist', 0.0))
        elif 'endrot' in spec:
            qacc = qacc @ rot_q(spec['endrot'])
        return qacc, wr, 1.0

    def basis(self, M):
        """Pose matrices -> Blender pose-bone basis matrices."""
        out = {}
        for name in self.order:
            p = self.parent[name]
            Rb = self.R[name]
            if p is None:
                out[name] = Rb.inverted() @ M[name]
            else:
                out[name] = (M[p] @ self.R[p].inverted() @ Rb).inverted() @ M[name]
        return out

    def apply(self, pose, frame=None):
        B = self.basis(self.solve(pose))
        for name, mb in B.items():
            pb = self.ao.pose.bones[name]
            pb.rotation_mode = 'QUATERNION'
            loc, rot, sc = mb.decompose()
            pb.location, pb.rotation_quaternion, pb.scale = loc, rot, sc
            if frame is not None:
                pb.keyframe_insert('location', frame=frame)
                pb.keyframe_insert('rotation_quaternion', frame=frame)
                pb.keyframe_insert('scale', frame=frame)


def lerp_pose(a, b, t):
    """Blend two pose dicts (numeric leaves) - used for in-betweens."""
    if isinstance(a, dict):
        out = {}
        for k in set(a) | set(b):
            if k in a and k in b:
                out[k] = lerp_pose(a[k], b[k], t)
            else:
                out[k] = a.get(k, b.get(k))
        return out
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    if isinstance(a, (int, float)):
        return a + (b - a) * t
    return a if t < 0.5 else b
