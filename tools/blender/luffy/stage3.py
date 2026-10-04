# Stage 3: bake the clips into actions and export the GLB. python stage3.py rig.blend out.glb [clip,clip]
import bpy, sys, time, math
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import importlib, posekit, luffy_anims
from posekit import Rig
args=[a for a in sys.argv[1:] if not a.startswith('--')]
src, out = args[-2] if len(args)>=2 and args[-1].endswith('.glb') else args[-3], None
args=sys.argv[sys.argv.index('--')+1:]
src, out = args[0], args[1]
only = args[2].split(',') if len(args)>2 else None
bpy.ops.wm.open_mainfile(filepath=src)
sc=bpy.context.scene; sc.render.fps=30
ao=bpy.data.objects['rig']; rig=Rig(ao)
ao.animation_data_create()
t0=time.time()
for name,(fn,dur,loop) in luffy_anims.CLIPS.items():
    if only and name not in only: continue
    act=bpy.data.actions.new(name); ao.animation_data.action=act
    n=max(1,round(dur*30))
    for f in range(n+1):
        rig.apply(fn(f/30.0), frame=f)
    tr=ao.animation_data.nla_tracks.new(); tr.name=name
    st=tr.strips.new(name,0,act); tr.mute=True
    ao.animation_data.action=None
print('baked',time.time()-t0)
# rest pose for export
for pb in ao.pose.bones:
    pb.location=(0,0,0); pb.rotation_quaternion=(1,0,0,0); pb.scale=(1,1,1)
# material: keep base colour + normal, drop metal/rough; shrink normal map
o=bpy.data.objects['luffy']; o.data.validate(clean_customdata=False)
for m in o.data.materials:
    if not m or not m.node_tree: continue
    bsdf=m.node_tree.nodes.get('Principled BSDF')
    for n in list(m.node_tree.nodes):
        if n.type=='TEX_IMAGE' and n.image and 'metallic' in n.image.name: m.node_tree.nodes.remove(n)
        elif n.type=='SEPARATE_COLOR': m.node_tree.nodes.remove(n)
        elif n.type=='TEX_IMAGE' and n.image and 'normal' in n.image.name and n.image.size[0]>1024: n.image.scale(1024,1024)
    if bsdf:
        bsdf.inputs['Metallic'].default_value=0.0; bsdf.inputs['Roughness'].default_value=0.8
        # the hands multiply their 'shade' vertex colours in Blender; export a plain base colour and let
        # the game apply the colours (the exporter can't bake a multiply node)
        if m.name=='skin':
            for l in list(bsdf.inputs['Base Color'].links): m.node_tree.links.remove(l)
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); ao.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
    export_skins=True, export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_frame_step=1, export_optimize_animation_size=True, export_image_format='JPEG', export_jpeg_quality=86,
    export_def_bones=False, export_vertex_color='NAME', export_vertex_color_name='shade', export_all_vertex_colors=True, export_anim_slide_to_zero=True, export_bake_animation=False, export_reset_pose_bones=True)
print('exported',time.time()-t0)
