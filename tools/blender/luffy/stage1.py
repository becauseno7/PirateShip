# Stage 1: import the AI-generated Luffy, weld seams, decimate, shrink textures, save prep.blend
# python stage1.py -- source.glb prep.blend   (also writes prep_col.npy: per-vertex texture colour)
import bpy, bmesh, time, sys
SRC, OUT = sys.argv[-2], sys.argv[-1]
t=time.time()
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=SRC)
o=[o for o in bpy.data.objects if o.type=='MESH'][0]
o.name='luffy'
bm=bmesh.new(); bm.from_mesh(o.data)
n0=len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
print('welded',n0,'->',len(bm.verts), time.time()-t)
bm.to_mesh(o.data); bm.free()
# components after welding
bm=bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
seen=bytearray(len(bm.verts)); comps=[]
for v in bm.verts:
    if seen[v.index]: continue
    st=[v]; seen[v.index]=1; n=0
    while st:
        a=st.pop(); n+=1
        for e in a.link_edges:
            b=e.other_vert(a)
            if not seen[b.index]: seen[b.index]=1; st.append(b)
    comps.append(n)
comps.sort(reverse=True); print('components',len(comps),comps[:15]); bm.free()
bpy.context.view_layer.objects.active=o; o.select_set(True)
m=o.modifiers.new('dec','DECIMATE'); m.ratio=52000/len(o.data.polygons); m.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier='dec')
print('faces',len(o.data.polygons),'verts',len(o.data.vertices), time.time()-t)
for img in bpy.data.images:
    if img.size[0]==4096:
        img.scale(2048,2048)
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('saved', time.time()-t)
# per-vertex texture colour, used by stage2 to tell skin, sash and coat apart
import numpy as np
me=o.data
img=[i for i in bpy.data.images if i.name=='texture_pbr_20250901'][0]
W,H=img.size; px=np.empty(W*H*4,np.float32); img.pixels.foreach_get(px); px=px.reshape(H,W,4)
nl=len(me.loops); uv=np.empty(nl*2,np.float32); me.uv_layers[0].data.foreach_get('uv',uv); uv=uv.reshape(-1,2)
lv=np.empty(nl,np.int32); me.loops.foreach_get('vertex_index',lv)
xs=np.clip((uv[:,0]%1)*W,0,W-1).astype(int); ys=np.clip((uv[:,1]%1)*H,0,H-1).astype(int)
nv=len(me.vertices); col=np.zeros((nv,3)); cnt=np.zeros(nv)
np.add.at(col,lv,px[ys,xs,:3]); np.add.at(cnt,lv,1); col/=np.maximum(cnt,1)[:,None]
np.save(OUT.replace('.blend','_col.npy'),col)
