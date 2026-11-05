# build.py - stylized player parts for Curve Kick (Blender 5.2, headless).
#
# Run:
#   "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --python build.py
#
# Output (next to this file): players.glb, contact-sheet.jpg
#
# Conventions
#   - Metres, glTF: Y up, character faces +Z.
#   - Every part is a root object (no hierarchy), location/rotation/scale = identity,
#     geometry written relative to the part's joint (origin = joint).
#   - All geometry is authored directly in glTF space (x, y, z) and converted to
#     Blender space on object creation as (x, -z, y), so the glTF exporter (Y-up)
#     returns exactly (x, y, z).
#   - Smooth shading on every polygon, no materials, no textures.

import bpy
import math
import os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(HERE, "players.glb")
OUT_JPG = os.path.join(HERE, "contact-sheet.jpg")
TAU = 2.0 * math.pi

SKIN = (0.93, 0.75, 0.62)


# ---------------------------------------------------------------- geometry helpers

def centroid(v, fc):
    n = float(len(fc))
    return (sum(v[i][0] for i in fc) / n,
            sum(v[i][1] for i in fc) / n,
            sum(v[i][2] for i in fc) / n)


def orient(v, f, c):
    """Make face winding point away from reference centre c (per shell)."""
    s = 0.0
    for fc in f:
        a, b, d = v[fc[0]], v[fc[1]], v[fc[2]]
        u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        w = (d[0] - a[0], d[1] - a[1], d[2] - a[2])
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        p = centroid(v, fc)
        s += n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2])
    if s < 0:
        return [tuple(reversed(fc)) for fc in f]
    return f


def shell(v, f, c, keep=None):
    """Optional face filter (keep(centroid) -> bool), compact indices, orient."""
    if keep is not None:
        f = [fc for fc in f if keep(centroid(v, fc))]
    used = sorted({i for fc in f for i in fc})
    remap = {o: n for n, o in enumerate(used)}
    v2 = [v[i] for i in used]
    f2 = [tuple(remap[i] for i in fc) for fc in f]
    return v2, orient(v2, f2, c)


def lathe(rings, seg=24, cx=0.0, cz=0.0, caps=(True, True)):
    """rings: list of (y, rx, rz) ordered bottom -> top. Zero radius = single point."""
    v = []
    ids = []
    for (y, rx, rz) in rings:
        if rx < 1e-7 and rz < 1e-7:
            v.append((cx, y, cz))
            ids.append([len(v) - 1])
        else:
            row = []
            for j in range(seg):
                a = TAU * j / seg
                v.append((cx + rx * math.cos(a), y, cz + rz * math.sin(a)))
                row.append(len(v) - 1)
            ids.append(row)
    f = []
    for i in range(len(ids) - 1):
        A, B = ids[i], ids[i + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            f += [(A[0], B[(j + 1) % seg], B[j]) for j in range(seg)]
        elif len(B) == 1:
            f += [(A[j], A[(j + 1) % seg], B[0]) for j in range(seg)]
        else:
            f += [(A[j], A[(j + 1) % seg], B[(j + 1) % seg], B[j]) for j in range(seg)]
    if caps[0] and len(ids[0]) > 1:
        v.append((cx, rings[0][0], cz))
        c = len(v) - 1
        f += [(c, ids[0][(j + 1) % seg], ids[0][j]) for j in range(seg)]
    if caps[1] and len(ids[-1]) > 1:
        v.append((cx, rings[-1][0], cz))
        c = len(v) - 1
        f += [(c, ids[-1][j], ids[-1][(j + 1) % seg]) for j in range(seg)]
    return v, f


def lathe_part(rings, seg=24, caps=(True, True)):
    v, f = lathe(rings, seg, 0.0, 0.0, caps)
    mid = sum(r[0] for r in rings) / len(rings)
    return shell(v, f, (0.0, mid, 0.0))


def ellipsoid(cx, cy, cz, rx, ry, rz, seg=16, nlat=8, keep=None):
    rings = []
    for i in range(nlat + 1):
        ph = -math.pi / 2 + math.pi * i / nlat
        rings.append((cy + ry * math.sin(ph), rx * math.cos(ph), rz * math.cos(ph)))
    v, f = lathe(rings, seg, cx, cz, (False, False))
    return shell(v, f, (cx, cy, cz), keep)


def torus(cy, rx_major, rz_major, r_tube, seg=28, tube=10):
    v = []
    f = []
    for i in range(seg):
        a = TAU * i / seg
        ca, sa = math.cos(a), math.sin(a)
        for j in range(tube):
            b = TAU * j / tube
            rad = r_tube * math.cos(b)
            up = r_tube * math.sin(b)
            v.append((rx_major * ca + rad * ca, cy + up, rz_major * sa + rad * sa))
    for i in range(seg):
        for j in range(tube):
            i2 = (i + 1) % seg
            j2 = (j + 1) % tube
            f.append((i * tube + j, i2 * tube + j, i2 * tube + j2, i * tube + j2))
    return shell(v, f, (0.0, cy, 0.0))


def merge(*shells):
    V = []
    F = []
    for v, f in shells:
        o = len(V)
        V += v
        F += [tuple(i + o for i in fc) for fc in f]
    return V, F


def tris(part):
    v, f = part
    return sum(len(fc) - 2 for fc in f)


# ---------------------------------------------------------------- parts (joint-local)

def p_pelvis_shorts():
    # shorts: closed top at waist, open leg holes at the bottom, flared hem
    return lathe_part([
        (-0.10, 0.222, 0.187),
        (-0.08, 0.215, 0.181),
        (-0.03, 0.205, 0.175),
        (0.02, 0.200, 0.170),
        (0.07, 0.190, 0.160),
    ], 24, (False, True))


SHIRT_PROFILE = [  # (y, radius at waist-scale); x is x1.12, z is x0.7
    (-0.02, 0.170), (0.0, 0.180), (0.08, 0.190), (0.20, 0.205), (0.32, 0.220),
    (0.45, 0.235), (0.50, 0.210), (0.54, 0.150), (0.585, 0.093), (0.60, 0.075),
]


def p_chest_shirt():
    rings = [(y, r * 1.12, r * 0.7) for (y, r) in SHIRT_PROFILE]
    return lathe_part(rings, 24, (True, True))


def p_collar():
    # ring on the shirt surface at y=0.585 (ellipse matching the torso section)
    return torus(0.585, 0.104, 0.065, 0.016, seg=28, tube=10)


def p_head_skin():
    neck = lathe_part([(-0.08, 0.055, 0.055), (0.0, 0.055, 0.055), (0.06, 0.050, 0.050)], 20)
    skull = ellipsoid(0.0, 0.10, 0.0, 0.133, 0.148, 0.140, seg=24, nlat=12)
    return merge(neck, skull)


def p_ear(side):
    return ellipsoid(0.14 * side, 0.10, 0.0, 0.030, 0.040, 0.025, seg=12, nlat=6)


HAIR_R = (0.145, 0.160, 0.152)  # skull + 1.2 cm shell


def hair_skull(keep=None):
    return ellipsoid(0.0, 0.10, 0.0, HAIR_R[0], HAIR_R[1], HAIR_R[2], seg=24, nlat=14, keep=keep)


def keep_short(c):
    # fringe line on the front at y=0.185 (forehead stays open), full cover at back
    return c[1] >= 0.185 if c[2] > 0.02 else c[1] >= 0.0


def p_hair_short():
    return hair_skull(keep_short)


def p_hair_long():
    short = hair_skull(keep_short)
    drape = ellipsoid(0.0, -0.04, -0.04, 0.135, 0.130, 0.110, seg=24, nlat=14,
                      keep=lambda c: c[2] <= -0.02)
    return merge(short, drape)


def p_hair_cap_back():
    return hair_skull(lambda c: c[2] <= 0.02 and c[1] >= 0.12)


def p_hair_bun():
    cap = hair_skull(lambda c: c[2] <= 0.02 and c[1] >= 0.12)
    bun = ellipsoid(0.0, 0.22, -0.10, 0.060, 0.060, 0.060, seg=16, nlat=8)
    return merge(cap, bun)


def p_thigh():
    return lathe_part([
        (-0.40, 0.065, 0.062), (-0.35, 0.070, 0.067), (-0.25, 0.080, 0.076),
        (-0.10, 0.095, 0.090), (0.0, 0.100, 0.095), (0.03, 0.088, 0.084),
    ], 24)


def p_sock():
    return lathe_part([
        (-0.40, 0.046, 0.046), (-0.30, 0.058, 0.058), (-0.20, 0.070, 0.070),
        (-0.08, 0.078, 0.078), (0.0, 0.075, 0.075),
    ], 24)


def p_knee():
    return ellipsoid(0.0, 0.0, 0.0, 0.060, 0.050, 0.060, seg=16, nlat=8)


def p_boot():
    # ankle = origin; foot points +Z: heel z~-0.06, toe z~+0.20, width 0.12, height 0.10
    return merge(
        ellipsoid(0.0, -0.05, 0.07, 0.060, 0.050, 0.130, seg=16, nlat=8),
        ellipsoid(0.0, -0.05, 0.00, 0.055, 0.050, 0.060, seg=16, nlat=8),
    )


def p_sole():
    # white sole under the upper, bottom at y=-0.10 (ground), top at -0.065
    return ellipsoid(0.0, -0.0825, 0.07, 0.070, 0.0175, 0.140, seg=16, nlat=6)


def p_sleeve():
    return lathe_part([
        (-0.17, 0.076, 0.076), (-0.05, 0.085, 0.085), (0.0, 0.082, 0.082),
        (0.05, 0.078, 0.078), (0.09, 0.050, 0.050),
    ], 24, (False, True))


def p_arm_upper():
    return lathe_part([
        (-0.30, 0.052, 0.052), (-0.20, 0.059, 0.059), (-0.10, 0.064, 0.064),
        (0.0, 0.066, 0.066), (0.012, 0.062, 0.062), (0.03, 0.040, 0.040),
    ], 24)


def p_arm_fore():
    return lathe_part([
        (-0.25, 0.040, 0.040), (-0.20, 0.043, 0.043), (-0.10, 0.050, 0.050),
        (-0.02, 0.054, 0.054), (0.0, 0.055, 0.055), (0.03, 0.040, 0.040),
    ], 24)


def hand_shells(k=1.0):
    # mitten: palm + 4 fused fingers + thumb; k=1.5 for goalkeeper glove
    palm = ellipsoid(0.0, -0.27, 0.0, 0.042 * k, 0.035 * k, 0.025 * k, seg=16, nlat=8)
    fingers = [ellipsoid(x, -0.325, 0.0, 0.0095 * k, 0.025 * k, 0.012 * k, seg=10, nlat=5)
               for x in (-0.03, -0.01, 0.01, 0.03)]
    thumb = ellipsoid(0.045, -0.27, 0.01, 0.012 * k, 0.025 * k, 0.015 * k, seg=10, nlat=5)
    return merge(palm, *fingers, thumb)


def p_hand():
    return hand_shells(1.0)


def p_glove():
    return hand_shells(1.5)


# ---------------------------------------------------------------- build

def build_part_table():
    P = {}
    P["pelvis_shorts"] = p_pelvis_shorts()
    P["chest_shirt"] = p_chest_shirt()
    P["collar"] = p_collar()
    P["head_skin"] = p_head_skin()
    P["ear_L"] = p_ear(-1)
    P["ear_R"] = p_ear(1)
    P["hair_short"] = p_hair_short()
    P["hair_long"] = p_hair_long()
    P["hair_cap_back"] = p_hair_cap_back()
    P["hair_bun"] = p_hair_bun()
    for s in ("L", "R"):
        P["thigh_" + s] = p_thigh()
        P["sock_" + s] = p_sock()
        P["knee_" + s] = p_knee()
        P["boot_" + s] = p_boot()
        P["sole_" + s] = p_sole()
        P["sleeve_" + s] = p_sleeve()
        P["arm_upper_" + s] = p_arm_upper()
        P["arm_fore_" + s] = p_arm_fore()
        P["hand_" + s] = p_hand()
        P["glove_" + s] = p_glove()
    return P


def report_budget(P):
    base_names = ["pelvis_shorts", "chest_shirt", "collar", "head_skin", "ear_L", "ear_R"]
    for s in ("L", "R"):
        base_names += ["thigh_" + s, "sock_" + s, "knee_" + s, "boot_" + s, "sole_" + s,
                       "sleeve_" + s, "arm_upper_" + s, "arm_fore_" + s]
    base = sum(tris(P[n]) for n in base_names)
    hair = max(tris(P[n]) for n in ("hair_short", "hair_long", "hair_cap_back", "hair_bun"))
    hands = max(tris(P["hand_L"]) + tris(P["hand_R"]), tris(P["glove_L"]) + tris(P["glove_R"]))
    print("TRIS per person: base=%d hair(max)=%d hands(max)=%d TOTAL=%d (budget 12000)"
          % (base, hair, hands, base + hair + hands))
    for n in sorted(P):
        print("  %-14s %5d tris" % (n, tris(P[n])))


def make_object(name, v, f):
    me = bpy.data.meshes.new(name)
    # glTF (x, y, z) -> Blender (x, -z, y); exporter with Y-up maps back to (x, y, z)
    me.from_pydata([(x, -z, y) for (x, y, z) in v], [], f)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def color_of(name):
    if name in ("pelvis_shorts", "sole_L", "sole_R"):
        return (0.95, 0.95, 0.95, 1.0)
    if name in ("chest_shirt", "sleeve_L", "sleeve_R"):
        return (0.10, 0.35, 0.90, 1.0)
    if name == "collar":
        return (0.05, 0.20, 0.60, 1.0)
    if name.startswith("sock"):
        return (0.90, 0.10, 0.10, 1.0)
    if name.startswith("boot"):
        return (0.05, 0.05, 0.05, 1.0)
    if name.startswith("hair"):
        return (0.35, 0.20, 0.08, 1.0)
    if name.startswith("glove"):
        return (0.90, 0.60, 0.10, 1.0)
    return SKIN + (1.0,)


def joint_of(name):
    """Joint position in the figure (glTF, metres) for the contact-sheet pose."""
    s = -1.0 if name.endswith("_L") else 1.0
    if name == "pelvis_shorts":
        return (0.0, 0.92, 0.0)
    if name in ("chest_shirt", "collar"):
        return (0.0, 0.96, 0.0)
    if name.startswith(("head_skin", "hair_", "ear_")):
        return (0.0, 1.62, 0.0)
    if name.startswith("thigh"):
        return (0.11 * s, 0.92, 0.0)
    if name.startswith(("sock", "knee")):
        return (0.11 * s, 0.50, 0.0)
    if name.startswith(("boot", "sole")):
        return (0.11 * s, 0.10, 0.0)
    if name.startswith(("sleeve", "arm_upper")):
        return (0.25 * s, 1.43, 0.0)
    if name.startswith(("arm_fore", "hand", "glove")):
        return (0.25 * s, 1.13, 0.0)
    return (0.0, 0.0, 0.0)


def render_contact_sheet(scene):
    # Figure A: front (x=0). Figure B: same figure turned 90 deg around Y (x=+1.6), side view.
    # the unposed originals (location 0) must not appear in the sheet
    for ob in list(scene.collection.objects):
        scene.collection.objects.unlink(ob)
    pose_names = ["pelvis_shorts", "chest_shirt", "collar", "head_skin", "ear_L", "ear_R",
                  "hair_short", "thigh_L", "thigh_R", "sock_L", "sock_R", "knee_L", "knee_R",
                  "boot_L", "boot_R", "sole_L", "sole_R", "sleeve_L", "sleeve_R",
                  "arm_upper_L", "arm_upper_R", "arm_fore_L", "arm_fore_R", "hand_L", "hand_R"]
    for fig, (rot_deg, dx) in enumerate([(0.0, 0.0), (90.0, 1.6)]):
        th = math.radians(rot_deg)
        for name in pose_names:
            src = bpy.data.objects[name]
            cp = bpy.data.objects.new(name + "_pose%d" % fig, src.data)
            scene.collection.objects.link(cp)
            x, y, z = joint_of(name)
            bx, by, bz = x, -z, y  # glTF -> Blender
            rx = bx * math.cos(th) - by * math.sin(th)
            ry = bx * math.sin(th) + by * math.cos(th)
            cp.location = (rx + dx, ry, bz)
            cp.rotation_euler = (0.0, 0.0, th)
            cp.color = color_of(name)

    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 3.0
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    cam.location = (0.8, -10.0, 0.95)  # front, looking along +Y (Blender) = -Z (glTF)
    cam.rotation_euler = Vector((0.0, 1.0, 0.0)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    eng = None
    for item in scene.render.bl_rna.properties["engine"].enum_items:
        if "WORKBENCH" in item.identifier:
            eng = item.identifier
    scene.render.engine = eng or "BLENDER_WORKBENCH"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 90
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.background_type = "WORLD"
    world = bpy.data.worlds.new("sheet_world")
    world.color = (1.0, 1.0, 1.0)
    scene.world = world
    scene.render.filepath = OUT_JPG
    bpy.ops.render.render(write_still=True)
    print("contact sheet ->", OUT_JPG)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    P = build_part_table()
    report_budget(P)

    for name in sorted(P):
        make_object(name, P[name][0], P[name][1])

    try:
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True,
                                  export_materials="NONE")
    except TypeError as e:
        print("export retry without export_materials:", e)
        bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", export_yup=True)
    print("GLB ->", OUT_GLB, os.path.getsize(OUT_GLB), "bytes")

    render_contact_sheet(scene)


if __name__ == "__main__":
    main()
