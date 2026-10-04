"""Hand-authored animation clips for the Luffy model.

Every clip is a function of time returning a pose for posekit.Rig (see luffy_rig.py). Character space:
+X = Luffy's left, -Y = forward, +Z = up, metres, feet on the ground at z = 0.
Clips are baked at 30 fps. Looping clips start and end on the same pose.
"""
import math

TAU = math.tau


# ---------------------------------------------------------------- easing helpers
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def smooth(a, b, x):
    t = clamp((x - a) / (b - a)) if b != a else (1.0 if x >= b else 0.0)
    return t * t * (3 - 2 * t)


def ease_out(t, p=3):
    t = clamp(t)
    return 1 - (1 - t) ** p


def ease_in(t, p=3):
    return clamp(t) ** p


def back_out(t, s=1.9):
    t = clamp(t) - 1
    return t * t * ((s + 1) * t + s) + 1


def spring(t, freq=3.0, decay=6.0):
    """0 -> 1 with a damped overshoot."""
    if t <= 0:
        return 0.0
    return 1 - math.exp(-decay * t) * math.cos(TAU * freq * t)


def mix(a, b, t):
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a + (b - a) * t


def keys(t, ks):
    """Piecewise interpolation. ks = [(time, value, ease?)...]; ease applies to the segment ending at that key.
    ease: 'lin', 'io' (smooth), 'out', 'in', 'back'."""
    if t <= ks[0][0]:
        return ks[0][1]
    for i in range(1, len(ks)):
        t1 = ks[i][0]
        if t <= t1:
            t0, v0 = ks[i - 1][0], ks[i - 1][1]
            u = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
            e = ks[i][2] if len(ks[i]) > 2 else 'io'
            u = {'lin': u, 'io': u * u * (3 - 2 * u), 'out': ease_out(u), 'in': ease_in(u, 2), 'back': back_out(u),
                 'snap': ease_out(u, 5)}[e]
            return mix(v0, ks[i][1], u)
    return ks[-1][1]


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def norm(v):
    l = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / l for x in v)


# ---------------------------------------------------------------- body landmarks (rest, character space)
ANKLE_Z = 0.125
SH_R_NEUTRAL = (-1.0, 0.17, -0.08)  # the model's right clavicle is raised (hand on hat); this relaxes it
FOOT_FLAT = (0.0, -0.81, -0.58)


def foot_dir(pitch=0.0, yaw=0.0):
    """pitch>0 lifts the toes (heel strike), pitch<0 points them down (toe-off)."""
    c, s = math.cos(pitch), math.sin(pitch)
    y2, z2 = FOOT_FLAT[1] * c + FOOT_FLAT[2] * s, -FOOT_FLAT[1] * s + FOOT_FLAT[2] * c
    cy, sy = math.cos(yaw), math.sin(yaw)
    return (-y2 * sy, y2 * cy, z2)


def coat(t, wind=1.0, stream=0.0, lift=0.0, side=0.0):
    """Coat chains: gentle wind flutter, plus streaming back (running) and lift (falling)."""
    p = {}
    for chain, n, ph in (('coatR', 4, 0.0), ('coatB', 3, 1.3), ('coatL', 3, 2.4)):
        for i in range(1, n + 1):
            k = i / n
            fl = wind * (0.05 + 0.07 * k) * math.sin(TAU * 0.55 * t + ph - i * 0.9) + wind * 0.03 * k * math.sin(TAU * 1.7 * t + ph * 2 - i * 1.4)
            if chain == 'coatR':
                rot = (fl * 0.6 - stream * (0.35 if i == 1 else 0.12) - lift * 0.25, fl * 0.5, -stream * (0.55 if i == 1 else 0.15) + side * 0.2 + fl)
            elif chain == 'coatB':
                rot = (-stream * (0.75 if i == 1 else 0.22) - lift * (0.5 if i == 1 else 0.3) + fl, fl * 0.4, side * 0.15)
            else:
                rot = (-stream * (0.55 if i == 1 else 0.18) - lift * 0.35 + fl * 0.8, -fl * 0.5, stream * (0.25 if i == 1 else 0.05) - side * 0.15)
            p[f'{chain}.{i}'] = {'rot': rot}
    return p


def pose(hip=(0, 0, 0), hiprot=(0, 0, 0), spine=(0, 0, 0), chest=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0),
         footL=None, footR=None, handL=None, handR=None, shL=None, shR=None, coatp=None, root=None):
    """Assemble a pose. foot = (pos, dir[, pole]); hand = dict(target, pole, end, stretch...) in rest chest space."""
    P = {
        'hips': {'loc': hip, 'rot': hiprot},
        'spine': {'rot': spine}, 'chest': {'rot': chest}, 'neck': {'rot': neck}, 'head': {'rot': head},
        'shoulder.R': shR or {'aim': SH_R_NEUTRAL},
        'ik': {},
    }
    if shL:
        P['shoulder.L'] = shL
    if root:
        P['root'] = root
    fl = footL or ((0.11, 0.0, ANKLE_Z), foot_dir(0, 0.1))
    fr = footR or ((-0.11, -0.03, ANKLE_Z), foot_dir(0, -0.08))
    for k, f, s in (('leg.L', fl, 1), ('leg.R', fr, -1)):
        P['ik'][k] = {'target': f[0], 'end': f[1], 'pole': f[2] if len(f) > 2 else (s * 0.12, -1, 0)}
    for k, h, s in (('arm.L', handL, 1), ('arm.R', handR, -1)):
        h = dict(h or relaxed_hand(s))
        h.setdefault('rel', 'chest')
        h.setdefault('pole', (s * 0.35, 1, -0.1))
        P['ik'][k] = h
        P.update(fingers('L' if s > 0 else 'R', h.get('curl', DEFAULTS['curl']), h.get('thumb'), h.get('spread')))
    if coatp:
        P.update(coatp)
    return P


FINGER_GRADE = (('index', 0.82, 0.16), ('middle', 1.0, 0.04), ('ring', 1.1, -0.08), ('pinky', 1.22, -0.2))


def fingers(side, curl, thumb=None, spread=None):
    """curl 0 = open flat hand, ~0.35 = relaxed, 1 = tight fist. Pinky side leads a relaxed curl."""
    out = {}
    thumb = thumb_of(curl) if thumb is None else thumb
    spread = spread_of(curl) if spread is None else spread
    for name, g, sp in FINGER_GRADE:
        c = clamp(curl * (g if curl < 0.95 else 1.0), 0, 1.15)
        out[f'{name}1.{side}'] = {'bend': 1.5 * c, 'splay': sp * spread * (1 if side == 'R' else -1)}
        out[f'{name}2.{side}'] = {'bend': 1.7 * c ** 0.8}
        out[f'{name}3.{side}'] = {'bend': 1.05 * c ** 0.9}
    out[f'thumb1.{side}'] = {'bend': 0.45 * thumb}
    out[f'thumb2.{side}'] = {'bend': 0.75 * thumb}
    out[f'thumb3.{side}'] = {'bend': 0.65 * thumb}
    return out


def relaxed_hand(s, swing=0.0, lift=0.0):
    return {'target': (s * 0.235, -0.02 - swing, 1.0 + lift), 'end': (s * 0.08, -0.15 - swing * 0.5, -1), 'curl': 0.38}


def guard_hand(s, tight=1.0):
    """Loose street-fighter guard: fists forward at belly height, elbows out."""
    return {'target': (s * 0.16, -0.31 * tight, 1.24), 'end': (-s * 0.2, -0.9, 0.35), 'pole': (s * 0.8, 0.5, -0.4), 'curl': 1.0}


# ---------------------------------------------------------------- locomotion
def gait(t, cycle, duty, stride, lift, bob, lean, arm, width=0.11, bounce=0.0, run=True):
    ph = (t / cycle) % 1.0
    out = {}
    feet = {}
    for side, s, p0 in (('L', 1, 0.0), ('R', -1, 0.5)):
        p = (ph + p0) % 1.0
        if p < duty:
            u = p / duty
            y = -stride * 0.55 + stride * u
            z = ANKLE_Z + 0.06 * smooth(0.6, 1.0, u) * (1.3 if run else 0.8)
            pitch = mix(0.25 if not run else 0.1, 0.0, smooth(0, 0.25, u)) - (0.85 if run else 0.6) * smooth(0.55, 1.0, u)
        else:
            u = (p - duty) / (1 - duty)
            e = u * u * (3 - 2 * u)
            y = stride * 0.45 - stride * e
            h = math.sin(math.pi * clamp(u * (1.12 if run else 1.0))) ** (0.8 if run else 1.2)
            back = smooth(0.0, 0.45, u) * (1 - smooth(0.45, 1.0, u))
            z = ANKLE_Z + lift * h + (0.18 * back if run else 0)
            y += (0.18 * back if run else 0)  # heel kicks up behind the runner
            pitch = mix(-0.9 if run else -0.5, 0.25 if not run else 0.12, smooth(0.25, 0.95, u))
        feet[side] = ((s * width, y, z), foot_dir(pitch, s * 0.06), (s * 0.08, -1, 0.0))
    c = math.cos(TAU * ph * 2)
    hz = (-bob * c if run else bob * c) - (0.05 if run else 0.015)
    sway = math.sin(TAU * ph)
    hip = (0.012 * sway * (0 if run else 1), -lean * 0.35, hz)
    hiprot = (lean * 0.3, 0.0, -0.16 * sway * (1.3 if run else 1.0))
    out['hip'] = hip
    out['hiprot'] = hiprot
    out['spine'] = (lean * 0.45, 0.0, 0.1 * sway)
    out['chest'] = (lean * 0.3 + 0.02 * c, -0.03 * sway, 0.16 * sway)
    out['neck'] = (-lean * 0.55, 0.0, -0.1 * sway)
    out['head'] = (-lean * 0.2 + 0.03 * c * (1 if run else 0.5), 0.0, -0.06 * sway)
    out['footL'] = feet['L']
    out['footR'] = feet['R']
    # arms counter the legs; runners pump with bent elbows
    for side, s in (('L', 1), ('R', -1)):
        sw = -s * sway  # left arm forward when the right leg is forward
        if run:
            fwd = sw * arm
            tgt = (s * (0.19 - 0.03 * max(0, fwd)), -0.08 - 0.30 * fwd, 1.17 + 0.16 * max(0, fwd) - 0.05 * max(0, -fwd))
            out['hand' + side] = {'target': tgt, 'end': (-s * 0.2, -0.6 - 0.3 * fwd, 0.5 + 0.4 * max(0, fwd)), 'pole': (s * 0.4, 1, -0.35 + 0.3 * fwd), 'curl': 0.72}
        else:
            out['hand' + side] = {'target': (s * 0.235, -0.02 - 0.17 * sw * arm, 1.0 + 0.04 * abs(sw) * arm), 'end': (s * 0.08, -0.15 - 0.4 * sw * arm, -1),
                                  'curl': 0.36 + 0.08 * max(0, -sw)}
    out['coatp'] = coat(t, 1.0, stream=0.5 if run else 0.15 + 0.0, lift=0.1 * c if run else 0)
    return out


def clip_walk(t):
    g = gait(t, 1.0, 0.6, 0.94, 0.11, 0.022, 0.05, 0.9, width=0.105, run=False)
    return pose(**g)


def clip_run(t):
    g = gait(t, 0.6, 0.27, 1.12, 0.2, 0.045, 0.45, 1.0, width=0.085)
    g['coatp'] = coat(t, 1.4, stream=1.0, lift=0.15 * math.cos(TAU * t / 0.3))
    return pose(**g)


def clip_sprint(t):
    g = gait(t, 0.5, 0.23, 1.25, 0.26, 0.05, 0.7, 1.35, width=0.075)
    g['coatp'] = coat(t, 1.8, stream=1.35, lift=0.2 * math.cos(TAU * t / 0.25))
    g['head'] = add(g['head'], (-0.12, 0, 0))
    return pose(**g)


def clip_idle(t):
    """Easy-going stance: weight on the left leg, loose shoulders, breathing, glancing around."""
    b = math.sin(TAU * t / 3.2)          # breath
    w = math.sin(TAU * t / 6.4)          # slow weight shift
    look = keys(t % 6.4, [(0, 0.0), (1.4, 0.0), (1.9, 0.35, 'out'), (3.2, 0.35), (3.6, -0.12, 'io'), (5.4, -0.12), (6.0, 0.0), (6.4, 0.0)])
    return pose(
        hip=(0.025 + 0.012 * w, 0.0, -0.025 + 0.004 * b), hiprot=(0.02, -0.04 - 0.015 * w, 0.06),
        spine=(0.04 + 0.01 * b, 0.03, -0.03), chest=(-0.015 * b, 0.02, -0.04),
        neck=(0.06, 0.0, look * 0.5), head=(0.02 + 0.015 * b, -0.03, look * 0.5),
        footL=((0.10, 0.0, ANKLE_Z), foot_dir(0, 0.25)),
        footR=((-0.13, -0.07, ANKLE_Z), foot_dir(0, -0.3)),
        handL={'target': (0.215, 0.0, 1.03 + 0.008 * b), 'end': (0.15, -0.2, -1), 'pole': (0.4, 1, -0.2), 'curl': 0.4 + 0.04 * w},
        handR={'target': (-0.22, -0.04, 1.02 + 0.008 * b), 'end': (-0.12, -0.25, -1), 'pole': (-0.4, 1, -0.2), 'curl': 0.34 - 0.04 * w},
        coatp=coat(t, 1.0),
    )


def clip_idle_hat(t):
    """Fidget: presses the straw hat down on his head with a grin, then relaxes (3.0 s)."""
    base = clip_idle(t)
    k = smooth(0.25, 0.75, t) * (1 - smooth(2.2, 2.85, t))
    press = math.sin(clamp((t - 0.75) / 1.2) * math.pi) * 0.03
    if k > 0:
        # blend in chest space: interpolate between the relaxed target and the hat
        relaxed = (-0.22, -0.04, 1.02)
        base['ik']['arm.R'] = {'target': mix(relaxed, (-0.04, -0.2, 1.84 - press), k), 'end': mix((-0.12, -0.25, -1), (0.5, 0.6, 0.15), k),
                               'pole': mix((-0.4, 1, -0.2), (-0.9, -0.3, -0.3), k), 'rel': 'chest', 'curl': mix(0.34, 0.3, k), 'spread': 0.3 * k}
        base['shoulder.R'] = {'aim': mix(SH_R_NEUTRAL, (-1.0, -0.35, 0.3), k)}
        base.update(fingers('R', mix(0.34, 0.3, k), spread=0.3 * k + spread_of(0.34) * (1 - k)))
        base['head']['rot'] = add(base['head']['rot'], (0.12 * k + press * 2, 0, -0.1 * k))
        base['neck']['rot'] = add(base['neck']['rot'], (0.06 * k, 0, 0))
    return base


# ---------------------------------------------------------------- air
def clip_jump(t):
    k = ease_out(t / 0.25)
    return pose(
        hip=(0, 0.0, 0.02 * k), hiprot=(-0.08 * k, 0, 0.05), spine=(-0.08 * k, 0, 0), chest=(-0.06 * k, 0, 0.05), neck=(0.1, 0, 0), head=(0.06, 0, 0),
        footL=((0.1, -0.22, 0.42), foot_dir(-0.5, 0.1), (0.1, -1, 0.2)),
        footR=((-0.1, 0.18, 0.2), foot_dir(-1.0, -0.1), (-0.1, -1, -0.5)),
        handL={'target': (0.3, 0.1, 1.55 + 0.05 * k), 'end': (0.6, 0.3, 0.6), 'pole': (0.5, 1, -0.5), 'curl': 0.2, 'spread': 0.35},
        handR={'target': (-0.32, -0.12, 1.62 + 0.05 * k), 'end': (-0.6, -0.4, 0.7), 'pole': (-0.5, 1, -0.5), 'curl': 0.65},
        coatp=coat(t, 1.2, stream=0.3, lift=-0.3),
    )


def clip_fall(t):
    f = math.sin(TAU * t / 0.6)
    return pose(
        hip=(0, 0.0, 0.05), hiprot=(0.06, 0, 0.03 * f), spine=(0.05, 0, 0), chest=(0.05, 0.04 * f, 0), neck=(-0.1, 0, 0), head=(-0.05, 0, 0),
        footL=((0.13, -0.12, 0.3 + 0.03 * f), foot_dir(-0.2, 0.2), (0.2, -1, 0)),
        footR=((-0.12, 0.05, 0.22 - 0.03 * f), foot_dir(-0.4, -0.2), (-0.2, -1, 0)),
        handL={'target': (0.42, -0.02, 1.42 + 0.05 * f), 'end': (0.9, 0, 0.3), 'pole': (0.3, 1, -0.6), 'curl': 0.12 + 0.06 * f, 'spread': 0.5},
        handR={'target': (-0.42, -0.06, 1.42 - 0.05 * f), 'end': (-0.9, 0, 0.3), 'pole': (-0.3, 1, -0.6), 'curl': 0.12 - 0.06 * f, 'spread': 0.5},
        coatp=coat(t, 1.6, stream=0.2, lift=1.0),
    )


def clip_land(t):
    k = keys(t, [(0, 1.0), (0.06, 1.0), (0.32, 0.0, 'out')])
    p = clip_idle(t)
    sq = pose(
        hip=(0, -0.04, -0.2), hiprot=(0.35, 0, 0), spine=(0.25, 0, 0), chest=(0.15, 0, 0), neck=(-0.35, 0, 0), head=(-0.15, 0, 0),
        footL=((0.14, 0.02, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.15, -0.08, ANKLE_Z), foot_dir(0, -0.3)),
        handL={'target': (0.3, -0.2, 1.05), 'end': (0.4, -0.5, -0.6), 'pole': (0.5, 1, 0), 'curl': 0.25, 'spread': 0.4},
        handR={'target': (-0.3, -0.24, 1.05), 'end': (-0.4, -0.5, -0.6), 'pole': (-0.5, 1, 0), 'curl': 0.25, 'spread': 0.4},
        coatp=coat(t, 1.0, lift=0.6),
    )
    return blend(p, sq, k)


DEFAULTS = {'stretch': 1.0, 'curl': 0.38, 'abs': 0.0}


def thumb_of(curl):
    return curl if curl > 0.85 else curl ** 1.6


def spread_of(curl):
    return 0.25 * (1 - clamp(curl))


DERIVED = {'thumb': lambda d: thumb_of(d.get('curl', DEFAULTS['curl'])),
           'spread': lambda d: spread_of(d.get('curl', DEFAULTS['curl']))}


def blend(a, b, k):
    """Blend two poses/hand specs; keys missing on one side fall back to their neutral value."""
    if isinstance(a, dict):
        out = {}
        for key in set(a) | set(b):
            if key in a and key in b:
                out[key] = blend(a[key], b[key], k)
            elif key in DEFAULTS:
                out[key] = blend(a.get(key, DEFAULTS[key]), b.get(key, DEFAULTS[key]), k)
            elif key in DERIVED:
                out[key] = blend(a[key] if key in a else DERIVED[key](a), b[key] if key in b else DERIVED[key](b), k)
            else:
                out[key] = a[key] if key in a and (k < 0.5 or key not in b) else b.get(key, a.get(key))
        return out
    if isinstance(a, (tuple, list)):
        return tuple(x + (y - x) * k for x, y in zip(a, b))
    if isinstance(a, bool) or not isinstance(a, (int, float)):
        return a if k < 0.5 else b
    return a + (b - a) * k


# ---------------------------------------------------------------- combat
STANCE = dict(hip=(0.0, 0.0, -0.1), hiprot=(0.14, 0, 0.3), spine=(0.1, 0, -0.12), chest=(0.08, 0, -0.12),
              neck=(-0.2, 0, 0.12), head=(-0.08, 0, 0.12))


def fight_stance(t, bob=True):
    b = math.sin(TAU * t / 0.8) if bob else 0.0
    st = dict(STANCE)
    st['hip'] = (0.0, 0.03, -0.07 + 0.012 * b)
    return pose(**st,
                footL=((0.13, -0.17, ANKLE_Z), foot_dir(0, 0.35)),
                footR=((-0.12, 0.15, ANKLE_Z + 0.02), foot_dir(-0.15, -0.55)),
                handL=guard_hand(1), handR=guard_hand(-1),
                coatp=coat(t, 1.0))


def punch(t, side, hit=0.42, reach=0.62, stretch=1.35, up=0.0):
    """Straight punch with a rubbery overshoot. side=-1 right hand, +1 left."""
    s = side
    wind = smooth(0.0, hit * 0.7, t) * (1 - smooth(hit * 0.7, hit, t))
    ext = keys(t, [(0, 0.0), (hit * 0.75, 0.0), (hit, 1.12, 'snap'), (hit + 0.1, 1.0, 'io'), (0.72, 1.0), (1.0, 0.0, 'io')])
    twist = -s * (0.55 * ext - 0.25 * wind)
    st = dict(STANCE)
    st['hiprot'] = (0.14 + 0.1 * ext, 0, 0.3 + twist * 0.45)
    st['spine'] = (0.1 + 0.08 * ext, 0, -0.12 + twist * 0.35)
    st['chest'] = (0.08 + 0.14 * ext - 0.06 * wind, 0, -0.12 + twist * 0.6)
    st['neck'] = (-0.2 - 0.18 * ext, 0, 0.12 - twist * 0.7)
    st['head'] = (-0.08, 0, 0.12 - twist * 0.3)
    st['hip'] = (0.0, 0.0 - 0.14 * ext + 0.04 * wind, -0.1 - 0.03 * ext)
    g = guard_hand(s)
    strike = {'target': (s * 0.03, -0.32 - reach, 1.38 + up), 'end': (0, -1, 0.02 + up), 'pole': (s * 0.9, 0.2, -0.6), 'abs': 1.0,
              'stretch': mix(1.0, stretch, smooth(hit * 0.8, hit, t) * (1 - smooth(0.62, 0.95, t))), 'curl': 1.05}
    back = {'target': (s * 0.2, 0.08, 1.30), 'end': (-s * 0.3, -0.6, 0.5), 'pole': (s * 0.6, 1, -0.4), 'curl': 1.0}
    hand = blend(blend(g, back, wind), strike, clamp(ext))
    if ext > 1:
        hand['target'] = mix(g['target'], strike['target'], ext)
    other = blend(guard_hand(-s), {'target': (-s * 0.14, -0.2, 1.36), 'end': (s * 0.3, -0.8, 0.4), 'pole': (-s * 0.6, 0.6, -0.5), 'curl': 1.0}, clamp(ext))
    p = pose(**st, footL=((0.13, -0.19 - 0.05 * ext, ANKLE_Z), foot_dir(0, 0.35)),
             footR=((-0.12, 0.17, ANKLE_Z + 0.02 + 0.02 * ext), foot_dir(-0.15 - 0.4 * ext, -0.55)),
             handL=hand if s == 1 else other, handR=hand if s == -1 else other, coatp=coat(t, 1.2, stream=0.2 * ext))
    if s == -1:
        p['ik']['arm.R']['autostretch'] = True
    else:
        p['ik']['arm.L']['autostretch'] = True
    return p


def clip_punchR(t):
    return punch(t / 0.34 if t < 0.34 else 1.0, -1)


def clip_punchL(t):
    return punch(t / 0.34 if t < 0.34 else 1.0, 1, reach=0.58, stretch=1.3, up=0.04)


def clip_kick(t):
    """Gomu Gomu Whip: the right leg chambers, then lashes round at hip height, stretching like rubber (0.48 s, hit at 0.42)."""
    u = clamp(t / 0.48)
    cham = smooth(0.0, 0.3, u) * (1 - smooth(0.34, 0.42, u))
    lash = smooth(0.34, 0.44, u) * (1 - smooth(0.68, 0.95, u))
    a = keys(u, [(0, -1.9), (0.34, -1.9), (0.44, -0.15, 'snap'), (0.66, 0.4, 'out'), (1.0, 0.4)])
    reach = 1.28 * lash
    hipP = (-0.1, 0.0, 0.93)
    d = (math.sin(a), -math.cos(a))
    kickT = (hipP[0] + d[0] * reach, hipP[1] + d[1] * reach, 0.98 + 0.08 * lash)
    chamT = (-0.3, -0.12, 0.62)
    restT = (-0.12, 0.15, ANKLE_Z + 0.02)
    if lash > 0.02:
        tgt = mix(chamT, kickT, smooth(0, 1, lash)); pole = (0, 0.1, 1); fd = (d[0], d[1], -0.2)
    else:
        tgt = mix(restT, chamT, cham); pole = (-0.4, -1, 0.3); fd = foot_dir(-0.6 * cham, -0.5)
    yaw = 0.35 + 0.55 * a * lash - 0.5 * cham
    lean = lash
    p = pose(hip=(0.08 * lean, 0.03, -0.07 + 0.03 * lean), hiprot=(-0.12 * lean, 0.35 * lean, yaw),
             spine=(-0.05 * lean, 0.2 * lean, -0.2 * cham), chest=(0.06, 0.1 * lean, -0.25 * lean - 0.25 * cham),
             neck=(0.0, -0.3 * lean, -0.25 * lean + 0.2 * cham), head=(0, -0.1 * lean, -0.1),
             footL=((0.09, -0.06, ANKLE_Z), foot_dir(0, 0.45 + yaw * 0.6)),
             footR=(tgt, fd, pole),
             handL=blend(guard_hand(1), {'target': (0.45, -0.05, 1.42), 'end': (1, -0.2, 0.3), 'pole': (0.4, 1, -0.4), 'curl': 0.25, 'spread': 0.45}, max(lean, cham * 0.5)),
             handR=blend(guard_hand(-1), {'target': (-0.32, 0.25, 1.3), 'end': (-0.8, 0.6, 0.1), 'pole': (-0.4, 1, -0.3), 'curl': 0.7}, max(lean, cham)),
             coatp=coat(t, 1.4, stream=0.5 * lean, side=0.8 * lean))
    p['ik']['leg.R']['autostretch'] = lash > 0.02
    return p


def clip_uppercut(t):
    u = clamp(t / 0.48)
    crouch = smooth(0.0, 0.3, u) * (1 - smooth(0.3, 0.45, u))
    ext = keys(u, [(0, 0.0), (0.32, 0.0), (0.45, 1.0, 'snap'), (0.7, 1.0), (1.0, 0.0, 'io')])
    p = pose(hip=(0, 0.0, -0.1 - 0.12 * crouch + 0.1 * ext), hiprot=(0.15 * crouch - 0.1 * ext, 0.1 * ext, 0.3 - 0.5 * ext),
             spine=(0.1 * crouch - 0.12 * ext, 0.05 * ext, -0.2 * ext), chest=(0.1 * crouch - 0.15 * ext, 0.1 * ext, -0.3 * ext), neck=(-0.1 * crouch - 0.15 * ext, 0, 0.2 * ext), head=(-0.15 * ext, 0, 0),
             footL=((0.14, -0.17, ANKLE_Z), foot_dir(0, 0.3)),
             footR=((-0.13, 0.15, ANKLE_Z + 0.05 * ext), foot_dir(-0.6 * ext - 0.1, -0.5)),
             handR=blend(blend(guard_hand(-1), {'target': (-0.2, -0.12, 1.08), 'end': (0.2, -0.6, 0.6), 'pole': (-0.6, 0.6, -0.5), 'curl': 1.05}, crouch),
                         {'target': (-0.04, -0.38, 1.92), 'end': (0, -0.3, 1), 'pole': (-1, 0.1, -0.3), 'stretch': 1.25, 'curl': 1.05, 'abs': 1.0}, ext),
             handL=guard_hand(1), coatp=coat(t, 1.2, lift=0.4 * ext))
    return p


def clip_stretch(t):
    """Gomu Gomu no Pistol (0.55 s): the arm winds far behind, then shoots out and snaps back.
    In the game the forward stretch is driven to the real target from 0.2 normalised time."""
    u = clamp(t / 0.55)
    wind = smooth(0.0, 0.17, u)
    fire = smooth(0.18, 0.24, u)
    snap = smooth(0.62, 0.8, u)
    reach = keys(u, [(0, 0.0), (0.18, 0.0), (0.26, 1.15, 'snap'), (0.34, 1.0), (0.62, 1.0), (0.78, -0.08, 'in'), (0.9, 0.0, 'out'), (1.0, 0.0)])
    back = {'target': (-0.3, 0.66, 1.36), 'end': (-0.15, 1, 0.05), 'pole': (-0.7, 0.1, -1), 'stretch': 1.0 + 0.9 * wind, 'curl': 1.05, 'abs': 1.0}
    out = {'target': (-0.04, -0.35 - 1.7 * max(0, reach), 1.42), 'end': (0, -1, 0.02), 'pole': (-1, 0.3, -0.3), 'autostretch': True, 'curl': 1.05, 'abs': 1.0}
    rest = guard_hand(-1)
    if u < 0.18:
        hand = blend(rest, back, wind)
    elif u < 0.62:
        hand = out
    else:
        hand = blend(out, rest, snap)
        hand['autostretch'] = True
    tw = 0.5 * wind * (1 - fire) - 0.45 * fire * (1 - snap)
    p = pose(hip=(0, 0.05 * wind - 0.08 * fire, -0.1), hiprot=(0.08, 0, 0.32 + tw), spine=(0.06, 0, -0.1 + tw * 0.4), chest=(0.1 - 0.06 * wind, 0, -0.1 + tw * 0.8),
             neck=(-0.1, 0, 0.1 - tw * 0.8), head=(-0.06, 0, 0.1 - tw * 0.3),
             footL=((0.14, -0.22, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.14, 0.2, ANKLE_Z + 0.02), foot_dir(-0.2 - 0.4 * fire, -0.6)),
             handR=hand,
             handL=blend(guard_hand(1), {'target': (0.12, -0.5, 1.45), 'end': (0, -1, 0.1), 'pole': (0.8, 0.4, -0.4), 'curl': 0.1, 'spread': 0.3}, wind * (1 - fire * 0.7)),
             coatp=coat(t, 1.3, stream=0.5 * fire * (1 - snap), side=-0.4 * wind))
    return p


def clip_gatling(t):
    """Gomu Gomu no Gatling (1.1 s): planted wide stance, both arms blurring with stretched jabs."""
    u = clamp(t / 1.1)
    k = smooth(0.0, 0.08, u) * (1 - smooth(0.85, 1.0, u))
    n = int(max(0, (u - 0.08) / 0.048))
    on = 0.08 <= u < 0.85
    a = (u - 0.08) / 0.048 % 1.0
    jit = [(-0.1, 0.05), (0.12, -0.08), (0.0, 0.14), (-0.15, -0.1), (0.08, 0.1), (0.15, 0.02), (-0.05, -0.15)]
    hands = {}
    for s, off in ((-1, 0), (1, 1)):
        active = on and (n % 2 == off)
        e = math.sin(math.pi * a) if active else 0.0
        jx, jz = jit[(n + off * 3) % len(jit)]
        strike = {'target': (s * 0.06 + jx, -0.42 - 1.0 * e, 1.38 + jz), 'end': (jx, -1, jz), 'pole': (s * 0.9, 0.2, -0.4), 'autostretch': True, 'curl': 1.05, 'abs': 1.0}
        hands[s] = blend(guard_hand(s, 1.1), strike, k if active else 0) if active else blend(guard_hand(s), {'target': (s * 0.16, -0.1, 1.38), 'end': (-s * 0.3, -0.7, 0.4), 'pole': (s * 0.7, 0.8, -0.4), 'curl': 1.0}, k)
    shake = math.sin(TAU * u * 1.1 / 0.096) * 0.06 * k
    p = pose(hip=(0, -0.04 * k, -0.16 * k), hiprot=(0.1 * k, 0, shake), spine=(0.12 * k, 0, -shake * 0.5), chest=(0.06 * k, 0, -shake),
             neck=(-0.18 * k, 0, shake * 0.6), head=(-0.08 * k, 0, 0),
             footL=((0.22, -0.18, ANKLE_Z), foot_dir(0, 0.45)), footR=((-0.22, 0.12, ANKLE_Z), foot_dir(0, -0.45)),
             handL=hands[1], handR=hands[-1], coatp=coat(t, 2.0, stream=0.5 * k, lift=0.2 * math.sin(TAU * u * 6)))
    return p


def clip_dash(t):
    u = clamp(t / 0.25)
    k = keys(u, [(0, 0.0), (0.25, 1.0, 'snap'), (0.8, 1.0), (1.0, 0.7)])
    return pose(hip=(0, -0.1 * k, -0.22 * k), hiprot=(0.5 * k, 0, 0), spine=(0.25 * k, 0, 0), chest=(0.15 * k, 0, 0), neck=(-0.5 * k, 0, 0), head=(-0.3 * k, 0, 0),
                footL=((0.12, -0.45 * k, ANKLE_Z + 0.08 * k), foot_dir(0.1, 0.1), (0.1, -1, 0)),
                footR=((-0.1, 0.45 * k, ANKLE_Z + 0.25 * k), foot_dir(-1.1 * k, -0.1), (-0.1, -1, -0.3)),
                handL=blend(relaxed_hand(1), {'target': (0.3, 0.42, 1.12), 'end': (0.3, 1, -0.2), 'pole': (0.3, -0.2, -1), 'curl': 0.15, 'spread': 0.2}, k),
                handR=blend(relaxed_hand(-1), {'target': (-0.3, 0.42, 1.12), 'end': (-0.3, 1, -0.2), 'pole': (-0.3, -0.2, -1), 'curl': 0.15, 'spread': 0.2}, k),
                coatp=coat(t, 2.0, stream=1.5 * k))


def clip_castR(t):
    """One-handed blast: the palm thrusts out from a coiled stance (0.5 s, release at 0.35)."""
    u = clamp(t / 0.5)
    coil = smooth(0, 0.3, u) * (1 - smooth(0.3, 0.4, u))
    ext = keys(u, [(0, 0), (0.3, 0), (0.4, 1.0, 'snap'), (0.75, 1.0), (1.0, 0.0)])
    tw = 0.45 * coil - 0.5 * ext
    return pose(hip=(0, 0.04 * coil - 0.06 * ext, -0.1), hiprot=(0.1, 0, 0.3 + tw), spine=(0.06, 0, tw * 0.4), chest=(0.06, 0, tw * 0.7), neck=(-0.08, 0, -tw * 0.8), head=(-0.05, 0, -tw * 0.3),
                footL=((0.15, -0.2, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.14, 0.18, ANKLE_Z + 0.02), foot_dir(-0.2 - 0.3 * ext, -0.5)),
                handR=blend(blend(guard_hand(-1), {'target': (-0.3, 0.2, 1.25), 'end': (-0.2, 0.3, 1), 'pole': (-0.5, 0.6, -0.6), 'curl': 0.55}, coil),
                            {'target': (-0.05, -0.82, 1.42), 'end': (0, 0.0, 1), 'pole': (-1, 0.3, -0.4), 'stretch': 1.15, 'curl': 0.0, 'spread': 0.4, 'thumb': 0.0, 'abs': 1.0}, ext),
                handL=blend(guard_hand(1), {'target': (0.2, -0.05, 1.2), 'end': (-0.2, -0.6, 0.3), 'pole': (0.7, 0.8, -0.3), 'curl': 1.0}, ext),
                coatp=coat(t, 1.3, stream=0.5 * ext))


def clip_cast(t):
    """Both palms slam to the ground (0.75 s, impact at 0.45)."""
    u = clamp(t / 0.75)
    up = smooth(0, 0.3, u) * (1 - smooth(0.3, 0.45, u))
    dn = keys(u, [(0, 0), (0.32, 0), (0.45, 1.0, 'snap'), (0.8, 1.0), (1.0, 0.0)])
    p = pose(hip=(0, 0.05 * dn, 0.03 * up - 0.42 * dn), hiprot=(-0.1 * up + 0.6 * dn, 0, 0), spine=(-0.1 * up + 0.4 * dn, 0, 0), chest=(-0.1 * up + 0.2 * dn, 0, 0),
             neck=(0.1 * up - 0.5 * dn, 0, 0), head=(-0.2 * dn, 0, 0),
             footL=((0.22, -0.05, ANKLE_Z), foot_dir(0, 0.5)), footR=((-0.22, 0.15, ANKLE_Z + 0.05 * dn), foot_dir(-0.5 * dn, -0.5)),
             handL=blend(blend(relaxed_hand(1), {'target': (0.18, -0.15, 1.85), 'end': (0, 0, 1), 'pole': (0.5, 0.5, 0.2), 'curl': 1.0}, up),
                         {'target': (0.16, -0.62, 0.5), 'end': (0, -0.3, -1), 'pole': (0.8, 0.5, 0.3), 'curl': 0.0, 'spread': 0.55, 'thumb': 0.0}, dn),
             handR=blend(blend(relaxed_hand(-1), {'target': (-0.18, -0.15, 1.85), 'end': (0, 0, 1), 'pole': (-0.5, 0.5, 0.2), 'curl': 1.0}, up),
                         {'target': (-0.16, -0.62, 0.5), 'end': (0, -0.3, -1), 'pole': (-0.8, 0.5, 0.3), 'curl': 0.0, 'spread': 0.55, 'thumb': 0.0}, dn),
             coatp=coat(t, 1.5, lift=0.8 * dn))
    return p


def clip_castUp(t, dur=0.7):
    """Fist to the sky - used for storms and the long ultimate build-ups (time-stretched in game)."""
    u = clamp(t / dur)
    up = keys(u, [(0, 0), (0.25, -0.15), (0.4, 1.0, 'back'), (0.85, 1.0), (1.0, 0.0)])
    tr = math.sin(TAU * t * 9) * 0.015 * clamp(up)
    return pose(hip=(0, 0, -0.12 + 0.08 * up), hiprot=(0.05 - 0.15 * up, 0.05 * up, 0.2), spine=(-0.1 * up, 0.08 * up + tr, -0.1), chest=(-0.15 * up, 0.08 * up, -0.1 + tr),
                neck=(-0.35 * up, 0, 0.1), head=(-0.15 * up, 0, 0),
                footL=((0.17, -0.12, ANKLE_Z), foot_dir(0, 0.35)), footR=((-0.17, 0.1, ANKLE_Z), foot_dir(0, -0.4)),
                handR=blend(guard_hand(-1), {'target': (-0.25, -0.12, 2.05), 'end': (0, -0.1, 1), 'pole': (-1, 0.3, 0.2), 'stretch': 1.1, 'curl': 1.05}, clamp(up)),
                handL=blend(guard_hand(1), {'target': (0.22, -0.18, 1.18), 'end': (-0.3, -0.7, 0.4), 'pole': (0.7, 0.8, -0.4), 'curl': 1.0}, clamp(up)),
                coatp=coat(t, 1.5 + up, lift=0.6 * clamp(up), stream=0.3 * up))


def clip_slam(t):
    """Gomu Gomu Hammer: leaps with both fists overhead and smashes down (0.8 s, impact at 0.55)."""
    u = clamp(t / 0.8)
    air = keys(u, [(0, 0), (0.1, -0.12), (0.3, 0.55, 'out'), (0.48, 0.45), (0.55, 0.0, 'in'), (1.0, 0.0)])
    raise_ = smooth(0.05, 0.3, u) * (1 - smooth(0.45, 0.55, u))
    hit = keys(u, [(0, 0), (0.48, 0), (0.55, 1.0, 'snap'), (0.85, 1.0), (1.0, 0)])
    hz = air - 0.35 * hit
    p = pose(hip=(0, -0.05 * hit, hz), hiprot=(-0.25 * raise_ + 0.65 * hit, 0, 0), spine=(-0.2 * raise_ + 0.35 * hit, 0, 0), chest=(-0.2 * raise_ + 0.2 * hit, 0, 0),
             neck=(0.15 * raise_ - 0.5 * hit, 0, 0), head=(-0.2 * hit, 0, 0),
             footL=((0.15, -0.1, ANKLE_Z + max(0, air) * 0.8), foot_dir(-0.4 * raise_, 0.3)),
             footR=((-0.15, 0.1, ANKLE_Z + max(0, air) * 0.7), foot_dir(-0.5 * raise_, -0.3)),
             handL=blend(blend(guard_hand(1), {'target': (0.06, 0.05, 2.0), 'end': (0, 0.3, 1), 'pole': (0.5, -0.3, 0.6), 'stretch': 1.2, 'curl': 1.05}, raise_),
                         {'target': (0.07, -0.7, 0.55), 'end': (0, -0.2, -1), 'pole': (0.7, 0.5, 0.4), 'stretch': 1.15, 'curl': 1.05}, hit),
             handR=blend(blend(guard_hand(-1), {'target': (-0.06, 0.05, 2.0), 'end': (0, 0.3, 1), 'pole': (-0.5, -0.3, 0.6), 'stretch': 1.2, 'curl': 1.05}, raise_),
                         {'target': (-0.07, -0.7, 0.55), 'end': (0, -0.2, -1), 'pole': (-0.7, 0.5, 0.4), 'stretch': 1.15, 'curl': 1.05}, hit),
             coatp=coat(t, 1.6, lift=0.8 * raise_ - 0.6 * hit))
    return p


def clip_hit(t):
    u = clamp(t / 0.5)
    k = keys(u, [(0, 0), (0.12, 1.0, 'snap'), (0.4, 0.75), (1.0, 0.0, 'io')])
    return pose(hip=(0, 0.1 * k, -0.06 * k), hiprot=(-0.25 * k, 0.05 * k, 0.1 * k), spine=(-0.25 * k, 0, 0.05 * k), chest=(-0.3 * k, -0.08 * k, 0.1 * k),
                neck=(-0.2 * k, 0, -0.1 * k), head=(-0.35 * k, 0.1 * k, -0.15 * k),
                footL=((0.12, -0.05, ANKLE_Z), foot_dir(0, 0.2)), footR=((-0.13, 0.12 + 0.12 * k, ANKLE_Z), foot_dir(-0.2 * k, -0.3)),
                handL=blend(relaxed_hand(1), {'target': (0.4, 0.05, 1.45), 'end': (0.8, 0.2, 0.3), 'pole': (0.4, 1, -0.5), 'curl': 0.1, 'spread': 0.55}, k),
                handR=blend(relaxed_hand(-1), {'target': (-0.42, 0.0, 1.4), 'end': (-0.8, 0.2, 0.3), 'pole': (-0.4, 1, -0.5), 'curl': 0.1, 'spread': 0.55}, k),
                coatp=coat(t, 1.5, stream=-0.5 * k, lift=0.3 * k))


def clip_dead(t):
    """Knocked flat on his back, limbs splayed (holds the last frame)."""
    u = clamp(t / 1.1)
    k = keys(u, [(0, 0), (0.15, 0.2, 'out'), (0.65, 1.0, 'in'), (0.75, 0.93, 'out'), (0.85, 1.0, 'in'), (1.0, 1.0)])
    rot = -1.45 * k
    return pose(root={'rot': (rot, 0, 0), 'loc': (0, 0.35 * k, 0.12 * k)},
                hip=(0, 0, -0.1 * k), hiprot=(0, 0, 0.1 * k), spine=(-0.1 * k, 0, 0), chest=(-0.1 * k, 0, 0), neck=(0.25 * k, 0, 0.5 * k), head=(0.1 * k, 0, 0.3 * k),
                footL=((0.2 * k + 0.11, -0.25 * k, ANKLE_Z + 0.85 * k), foot_dir(-0.3, 0.6 * k)),
                footR=((-0.25 * k - 0.11, -0.4 * k, ANKLE_Z + 0.75 * k), foot_dir(0.2, -0.6 * k)),
                handL=blend(relaxed_hand(1), {'target': (0.62, 0.05, 1.55), 'end': (1, 0, 0.5), 'pole': (0.2, 1, 0), 'curl': 0.5}, k),
                handR=blend(relaxed_hand(-1), {'target': (-0.6, 0.1, 1.7), 'end': (-1, 0, 0.6), 'pole': (-0.2, 1, 0), 'curl': 0.45}, k),
                coatp=coat(t * (1 - k), 1.0 - 0.8 * k, lift=-0.6 * k))


def clip_stun(t):
    c, s = math.cos(TAU * t / 1.2), math.sin(TAU * t / 1.2)
    return pose(hip=(0.03 * c, 0.03 * s, -0.04), hiprot=(0.06 * s, 0.06 * c, 0), spine=(0.08, 0.05 * c, 0), chest=(0.06 * s, 0.08 * c, 0),
                neck=(0.25 + 0.1 * s, 0.15 * c, 0.1 * s), head=(0.15 * s, 0.2 * c, 0),
                footL=((0.13, 0.0, ANKLE_Z), foot_dir(0, 0.4)), footR=((-0.15, -0.05, ANKLE_Z), foot_dir(0, -0.5)),
                handL={'target': (0.3 + 0.03 * c, -0.05, 1.0), 'end': (0.3, -0.1, -1), 'pole': (0.4, 1, 0), 'curl': 0.48},
                handR={'target': (-0.3 + 0.03 * c, -0.05, 1.0), 'end': (-0.3, -0.1, -1), 'pole': (-0.4, 1, 0), 'curl': 0.48},
                coatp=coat(t, 1.0))


def clip_kneel(t):
    """Down on one knee, panting (looping 2 s)."""
    b = math.sin(TAU * t / 1.0)
    return pose(hip=(0, 0.05, -0.45), hiprot=(0.35 + 0.03 * b, 0, 0.1), spine=(0.25 + 0.03 * b, 0, 0), chest=(0.15 + 0.04 * b, 0, 0),
                neck=(0.2, 0, 0), head=(0.15 + 0.03 * b, 0, 0),
                footL=((0.14, -0.3, ANKLE_Z), foot_dir(0, 0.2), (0.2, -1, 0)),
                footR=((-0.12, 0.42, 0.1), foot_dir(-1.3, -0.1), (-0.1, -1, -0.6)),
                handL={'target': (0.2, -0.38, 0.75), 'end': (0, -0.6, -0.8), 'pole': (0.6, 1, 0), 'curl': 0.55},
                handR={'target': (-0.24, -0.3, 0.42), 'end': (0, -0.3, -1), 'pole': (-0.5, 1, 0), 'curl': 0.08, 'spread': 0.45, 'thumb': 0.05},
                coatp=coat(t, 0.7, lift=-0.2))


def clip_powerup(t, dur=1.4):
    """Gear-up: crouches and trembles with fists clenched, then explodes upright, arms flung wide."""
    u = clamp(t / dur)
    cr = smooth(0, 0.2, u) * (1 - smooth(0.62, 0.7, u))
    burst = keys(u, [(0, 0), (0.62, 0), (0.72, 1.12, 'snap'), (0.8, 1.0), (1.0, 1.0)])
    tr = math.sin(TAU * t * 14) * 0.02 * cr
    return pose(hip=(tr, 0, -0.22 * cr + 0.0 * burst), hiprot=(0.3 * cr - 0.12 * burst, 0, 0), spine=(0.2 * cr - 0.1 * burst + tr, 0, 0), chest=(0.15 * cr - 0.18 * burst, 0, tr * 2),
                neck=(0.25 * cr - 0.35 * burst, 0, 0), head=(0.1 * cr - 0.2 * burst, 0, 0),
                footL=((0.2, -0.05, ANKLE_Z), foot_dir(0, 0.5)), footR=((-0.2, 0.05, ANKLE_Z), foot_dir(0, -0.5)),
                handL=blend(blend(relaxed_hand(1), {'target': (0.2, -0.22, 1.05), 'end': (-0.2, -0.5, -0.6), 'pole': (0.7, 0.8, 0), 'curl': 1.1}, cr),
                            {'target': (0.55, -0.15, 1.62), 'end': (1, -0.2, 0.5), 'pole': (0.3, 1, -0.6), 'curl': 0.05, 'spread': 0.7, 'thumb': 0.0}, clamp(burst)),
                handR=blend(blend(relaxed_hand(-1), {'target': (-0.2, -0.22, 1.05), 'end': (0.2, -0.5, -0.6), 'pole': (-0.7, 0.8, 0), 'curl': 1.1}, cr),
                            {'target': (-0.55, -0.15, 1.62), 'end': (-1, -0.2, 0.5), 'pole': (-0.3, 1, -0.6), 'curl': 0.05, 'spread': 0.7, 'thumb': 0.0}, clamp(burst)),
                coatp=coat(t, 1.0 + 2 * burst, lift=0.9 * clamp(burst), stream=-0.3 * cr))


def clip_victory(t):
    """Fist pumped skyward, the other hand pinning his hat, shoulders shaking with laughter (2.2 s)."""
    u = clamp(t / 2.2)
    up = keys(u, [(0, 0), (0.12, -0.1), (0.25, 1.0, 'back'), (1.0, 1.0)])
    laugh = math.sin(TAU * t * 5.5) * smooth(0.3, 0.4, u) * (1 - smooth(0.9, 1.0, u))
    k = clamp(up)
    return pose(hip=(0, 0.0, -0.04 + 0.01 * laugh), hiprot=(-0.08 * k, 0, 0.1), spine=(-0.12 * k + 0.03 * laugh, 0, 0), chest=(-0.15 * k + 0.04 * laugh, 0, 0.1),
                neck=(-0.3 * k, 0, -0.1), head=(-0.25 * k + 0.05 * laugh, 0, -0.05),
                footL=((0.14, -0.05, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.14, 0.03, ANKLE_Z), foot_dir(0, -0.3)),
                handL=blend(relaxed_hand(1), {'target': (0.3, -0.15, 2.08), 'end': (0, -0.15, 1), 'pole': (1, 0.3, 0.1), 'stretch': 1.1, 'curl': 1.05}, k),
                handR=blend(relaxed_hand(-1), {'target': (-0.05, -0.17, 1.84 + 0.01 * laugh), 'end': (0.5, 0.6, 0.15), 'pole': (-0.9, -0.3, -0.3), 'curl': 0.3, 'spread': 0.3}, k),
                shR={'aim': mix(SH_R_NEUTRAL, (-1.0, -0.35, 0.3), k)},
                coatp=coat(t, 1.4))


def clip_eat(t):
    """Eats the devil fruit: lifts it with both hands, bites, chews, shudders at the taste (2.2 s)."""
    u = clamp(t / 2.2)
    lift = smooth(0.05, 0.25, u) * (1 - smooth(0.75, 0.95, u))
    bite = [smooth(0.3, 0.36, u) * (1 - smooth(0.36, 0.45, u)), smooth(0.48, 0.54, u) * (1 - smooth(0.54, 0.62, u))]
    chew = math.sin(TAU * t * 4) * smooth(0.62, 0.66, u) * (1 - smooth(0.78, 0.8, u))
    shiver = math.sin(TAU * t * 16) * smooth(0.78, 0.82, u) * (1 - smooth(0.92, 1.0, u))
    b = max(bite)
    return pose(hip=(0, 0, -0.04), hiprot=(0.05 * b, 0, 0), spine=(0.08 * b, 0, 0), chest=(0.06 * b + 0.04 * shiver, 0, 0.05 * shiver),
                neck=(0.25 * b + 0.05 * chew, 0, 0), head=(0.15 * b + 0.03 * chew - 0.2 * shiver * 0.3, 0.06 * shiver, 0),
                footL=((0.13, -0.03, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.13, 0.0, ANKLE_Z), foot_dir(0, -0.3)),
                handL=blend(relaxed_hand(1), {'target': (0.05, -0.24, 1.55 + 0.03 * b), 'end': (-0.6, -0.4, 0.5), 'pole': (0.7, 0.4, -0.6), 'curl': 0.6, 'spread': 0.25}, lift),
                handR=blend(relaxed_hand(-1), {'target': (-0.05, -0.24, 1.55 + 0.03 * b), 'end': (0.6, -0.4, 0.5), 'pole': (-0.7, 0.4, -0.6), 'curl': 0.6, 'spread': 0.25}, lift),
                coatp=coat(t, 1.0))


def clip_steer(t):
    """Hands on the ship's wheel, braced."""
    b = math.sin(TAU * t / 2.0)
    return pose(hip=(0, 0.02, -0.05), hiprot=(0.12, 0, 0), spine=(0.1, 0, 0), chest=(0.05 + 0.01 * b, 0, 0), neck=(-0.12, 0, 0), head=(-0.04, 0, 0),
                footL=((0.17, -0.1, ANKLE_Z), foot_dir(0, 0.3)), footR=((-0.17, 0.12, ANKLE_Z), foot_dir(0, -0.3)),
                handL={'target': (0.2, -0.45, 1.35), 'end': (-0.1, -0.5, 0.85), 'pole': (0.8, 0.5, -0.4), 'curl': 0.85},
                handR={'target': (-0.2, -0.45, 1.35), 'end': (0.1, -0.5, 0.85), 'pole': (-0.8, 0.5, -0.4), 'curl': 0.85},
                coatp=coat(t, 1.6, stream=0.5))


# name: (function, duration seconds, loop)
CLIPS = {
    'idle': (clip_idle, 6.4, True),
    'idleHat': (clip_idle_hat, 3.0, False),
    'walk': (clip_walk, 1.0, True),
    'run': (clip_run, 0.6, True),
    'sprint': (clip_sprint, 0.5, True),
    'jump': (clip_jump, 0.5, False),
    'fall': (clip_fall, 0.6, True),
    'land': (clip_land, 0.4, False),
    'stance': (fight_stance, 0.8, True),
    'punchR': (clip_punchR, 0.34, False),
    'punchL': (clip_punchL, 0.34, False),
    'kick': (clip_kick, 0.48, False),
    'uppercut': (clip_uppercut, 0.48, False),
    'stretch': (clip_stretch, 0.55, False),
    'gatling': (clip_gatling, 1.1, False),
    'dash': (clip_dash, 0.25, False),
    'castR': (clip_castR, 0.5, False),
    'cast': (clip_cast, 0.75, False),
    'castUp': (clip_castUp, 0.7, False),
    'slam': (clip_slam, 0.8, False),
    'powerup': (clip_powerup, 1.4, False),
    'hit': (clip_hit, 0.5, False),
    'dead': (clip_dead, 1.1, False),
    'stun': (clip_stun, 1.2, True),
    'kneel': (clip_kneel, 2.0, True),
    'victory': (clip_victory, 2.2, False),
    'eat': (clip_eat, 2.2, False),
    'steer': (clip_steer, 2.0, True),
}
