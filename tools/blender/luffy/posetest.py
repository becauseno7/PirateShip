import bpy, sys, math
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from posekit import Rig
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.open_mainfile(filepath=args[0])
ao=bpy.data.objects['rig']; rig=Rig(ao)
exec(open(args[1]).read())   # defines POSE
rig.apply(POSE)
import os
if os.environ.get('FALSE'):
    o=bpy.data.objects['luffy']; me=o.data
    gi={g.index:g.name for g in o.vertex_groups}
    import colorsys
    names=sorted(set(gi.values()))
    ca=me.color_attributes.new('dbg','FLOAT_COLOR','POINT')
    for v in me.vertices:
        best=max(v.groups,key=lambda g:g.weight,default=None)
        n=gi[best.group] if best else ''
        HL=os.environ.get('HL')
        if HL:
            hl=HL.split(',')
            ws={gi[g.group]:g.weight for g in v.groups}
            pal=[(1,0,0),(0,1,0),(0,0,1),(1,1,0),(0,1,1)]
            col=[0.5,0.5,0.5]
            for i,b in enumerate(hl):
                w=ws.get(b,0)
                col=[c*(1-w)+pc*w for c,pc in zip(col,pal[i])]
            ca.data[v.index].color=(*col,1); continue
        h=(hash(n)%997)/997.0
        ca.data[v.index].color=(*colorsys.hsv_to_rgb(h,0.8,0.95),1)
    mat=bpy.data.materials.new('dbg'); mat.use_nodes=True; nt=mat.node_tree
    at=nt.nodes.new('ShaderNodeAttribute'); at.attribute_name='dbg'
    nt.links.new(at.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    for i in range(len(me.materials)): me.materials[i]=mat
    print('legend', {n: [round(c,2) for c in colorsys.hsv_to_rgb((hash(n)%997)/997.0,0.8,0.95)] for n in names})
bpy.context.view_layer.update()
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.samples=6
sc.render.resolution_x, sc.render.resolution_y = 500, 700
w=bpy.data.worlds.new('w'); sc.world=w; w.use_nodes=True; w.node_tree.nodes['Background'].inputs[0].default_value=(0.85,0.85,0.88,1)
sun=bpy.data.objects.new('sun', bpy.data.lights.new('sun','SUN')); sc.collection.objects.link(sun); sun.rotation_euler=(0.7,0.1,0.5); sun.data.energy=3
cam=bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam
cam.data.type='ORTHO'; cam.data.ortho_scale=2.5
from PIL import Image
ims=[]
if os.environ.get('FOCUS'):
    cam.data.ortho_scale=0.45; sc.render.resolution_x=sc.render.resolution_y=500
    for bn in os.environ['FOCUS'].split(','):
        pb=ao.pose.bones[bn]; c=ao.matrix_world@((pb.head+pb.tail)/2)
        for name,ang in [('F',-90),('S',0 if bn.endswith('.L') else 180),('B',90),('Q',-45)]:
            a=math.radians(ang)
            cam.location=c+Vector((math.cos(a)*4, math.sin(a)*4, 0)); cam.rotation_euler=(math.pi/2,0,a+math.pi/2)
            f=args[2]+'-'+bn+name+'.png'; sc.render.filepath=f; bpy.ops.render.render(write_still=True); ims.append(Image.open(f))
    W=sum(i.width for i in ims); sheet=Image.new('RGB',(W,ims[0].height)); x=0
    for i in ims: sheet.paste(i,(x,0)); x+=i.width
    sheet.save(args[2]+'.png'); sys.exit(0)
for name,ang in [('front',-90),('side',0),('q34',-45),('back',90)]:
    a=math.radians(ang); c=Vector((0,0,1.0))
    cam.location=c+Vector((math.cos(a)*4, math.sin(a)*4, 0)); cam.rotation_euler=(math.pi/2,0,a+math.pi/2)
    f=args[2]+'-'+name+'.png'; sc.render.filepath=f; bpy.ops.render.render(write_still=True); ims.append(Image.open(f))
cam.data.ortho_scale=0.8
for name,ang in [('headF',-90),('headQ',-40),('headS',0)]:
    a=math.radians(ang); c=Vector((0.0,-0.06,1.68))
    cam.location=c+Vector((math.cos(a)*4, math.sin(a)*4, 0.3)); cam.rotation_euler=(math.pi/2-0.07,0,a+math.pi/2)
    f=args[2]+'-'+name+'.png'; sc.render.filepath=f; bpy.ops.render.render(write_still=True); ims.append(Image.open(f).resize((500,500)))
W=sum(i.width for i in ims); sheet=Image.new('RGB',(W,ims[0].height)); x=0
for i in ims: sheet.paste(i,(x,0)); x+=i.width
sheet.save(args[2]+'.png')
