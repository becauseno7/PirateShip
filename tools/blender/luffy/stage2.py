# Stage 2: skeleton + automatic weights. python stage2.py prep.blend rig.blend
import bpy, numpy as np, sys, time
from mathutils import Vector, Matrix
_a=[x for x in sys.argv if not x.startswith('--')]
src, out = _a[-2], _a[-1]
bpy.ops.wm.open_mainfile(filepath=src)
sys.path.insert(0, __file__.rsplit('/',1)[0])
from bones import B, O, S
o=bpy.data.objects['luffy']; bpy.context.view_layer.objects.active=o; o.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
o.data.transform(Matrix.Diagonal((S,S,S,1))@Matrix.Translation(-O))
def T(p): return (Vector(p)-O)*S
arm=bpy.data.armatures.new('rig'); ao=bpy.data.objects.new('rig',arm); bpy.context.scene.collection.objects.link(ao)
bpy.context.view_layer.objects.active=ao; bpy.ops.object.mode_set(mode='EDIT')
for n,h,t,p,d in B:
    e=arm.edit_bones.new(n); e.head=T(h); e.tail=T(t); e.use_deform=d
    if p: e.parent=arm.edit_bones[p]; e.use_connect=(Vector(arm.edit_bones[p].tail)-e.head).length<1e-4
# roll: keep bones' local X pointing to character's right(-X world) consistently
bpy.ops.armature.select_all(action='SELECT'); bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Z')
bpy.ops.object.mode_set(mode='OBJECT')
t=time.time()
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); ao.select_set(True); bpy.context.view_layer.objects.active=ao
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('auto weights',time.time()-t)


def hatfix():
    """The AI mesh fuses the right hand into the straw hat. Snap weights so the head and hand
    are rigid, cut them apart, delete the fused AI hat and model a clean straw hat instead."""
    import numpy as np, bmesh, math
    me=o.data; nv=len(me.vertices)
    P=np.array([v.co[:] for v in me.vertices])/S+np.array(O[:])
    col=np.load(src.replace('.blend','_col.npy')); luma=col@np.array([0.3,0.59,0.11])
    names={g.index:g.name for g in o.vertex_groups}
    dom=[]
    for v in me.vertices:
        g=max(v.groups,key=lambda g:g.weight,default=None); dom.append(names[g.group] if g else '')
    dom=np.array(dom)
    rad=np.linalg.norm(P[:,:2]-np.array([0.06,-0.13]),axis=1)
    vol=(rad<0.195)&(P[:,2]>0.895)
    handv=vol&(dom=='hand.R'); armv=vol&np.isin(dom,['forearm.R','upperarm.R'])
    headv=vol&~handv&~armv
    allg=[g.name for g in o.vertex_groups]
    def snap(idx,name):
        idx=[int(i) for i in idx]
        for nm in allg: o.vertex_groups[nm].remove(idx)
        o.vertex_groups[name].add(idx,1.0,'REPLACE')
    snap(np.nonzero(headv)[0],'head'); snap(np.nonzero(handv)[0],'hand.R')
    redh=(col[:,0]>col[:,1]*1.8)&(col[:,0]>0.25)
    aihat=headv&((luma>0.22)|redh)&(((rad>0.092)&(P[:,2]>0.903))|(P[:,2]>0.943))
    bm=bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    cut=[f for f in bm.faces if any(headv[v.index] for v in f.verts) and any(handv[v.index] or armv[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=cut, context='FACES_ONLY')
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[int(i)] for i in np.nonzero(aihat)[0]], context='VERTS')
    # drop the little islands of AI hat left floating around the new hat
    bm.verts.ensure_lookup_table()
    seen=set(); drop=[]
    for v in bm.verts:
        if v in seen: continue
        comp=[v]; seen.add(v); k=0
        while k<len(comp):
            for e in comp[k].link_edges:
                w=e.other_vert(comp[k])
                if w not in seen: seen.add(w); comp.append(w)
            k+=1
        if len(comp)<150 and sum(c.co.z for c in comp)/len(comp)/S>0.86: drop+=comp
    bmesh.ops.delete(bm, geom=drop, context='VERTS')
    print('hat: dropped island verts',len(drop))
    # close the palm that was fused into the hat
    bnd=[e for e in bm.edges if e.is_boundary and all(v.co.z/S>0.9 for v in e.verts) and any(handv[v.index] if v.index<nv else False for v in e.verts)]
    uvl=bm.loops.layers.uv.active
    vuv={}
    for f in bm.faces:
        for l in f.loops: vuv.setdefault(l.vert, l[uvl].uv.copy())
    res=bmesh.ops.holes_fill(bm, edges=bnd, sides=40)
    bmesh.ops.triangulate(bm, faces=res['faces'])
    for f in bm.faces:
        for l in f.loops:
            if l.vert in vuv and l[uvl].uv.length==0: l[uvl].uv=vuv[l.vert]
    print('hat: cut',len(cut),'deleted AI hat verts',int(aihat.sum()),'palm fills',len(res['faces']))
    bm.to_mesh(me); bm.free()
    build_hat()

def straw_image(n=512):
    import numpy as np
    rng=np.random.default_rng(7)
    y,x=np.mgrid[0:n,0:n]
    row=(y//10)%2
    weave=0.5+0.5*np.sin((x+row*8)*np.pi/8)
    base=np.array([0.87,0.76,0.52])
    img=base[None,None,:]*(0.86+0.14*weave[...,None])
    img*=1-0.10*((y%10)<1)[...,None]
    fleck=rng.random((n//4,n//4))<0.05
    fleck=np.kron(fleck,np.ones((4,4)))[:n,:n]
    img=img*(1-0.32*fleck[...,None])
    img*= (0.94+0.06*rng.random((n,n)))[...,None]
    im=bpy.data.images.new('straw',n,n)
    rgba=np.concatenate([np.clip(img,0,1),np.ones((n,n,1))],-1)
    im.pixels.foreach_set(rgba.astype(np.float32).ravel())
    im.pack()
    return im

def build_hat():
    import bmesh, math
    from mathutils import Vector as Vec, Matrix as Mat
    # profile (r, h) in the hat frame: crown dome, band, crown base, brim top, rim, brim underside
    prof=[(0.0,0.097),(0.03,0.096),(0.052,0.092),(0.066,0.084),(0.073,0.07),(0.076,0.05),(0.078,0.031),
          (0.079,0.007),(0.086,0.004),(0.11,0.0),(0.135,-0.004),(0.155,-0.009),(0.166,-0.015),(0.168,-0.02),
          (0.158,-0.016),(0.135,-0.010),(0.11,-0.006),(0.086,-0.003),(0.074,-0.002),(0.0,-0.002)]
    prof=[(r*0.84 if r>0.08 else r*0.9, h*0.86) for r,h in prof]
    band=(5,7)  # profile segments [5,7) are the hat band
    seg=48
    ctr=Vec((0.063,-0.125,0.935)); nrm=Vec((0,0.06,1)).normalized()
    rot=Vec((0,0,1)).rotation_difference(nrm).to_matrix()
    bm=bmesh.new(); uvl=bm.loops.layers.uv.new('UVMap')
    rings=[]
    for (r,h) in prof:
        ring=[]
        for k in range(seg):
            a=2*math.pi*k/seg
            p=ctr+rot@Vec((r*math.cos(a), r*math.sin(a), h))
            ring.append(bm.verts.new(((p-O)*S)))
        rings.append(ring)
    L=[0.0]
    for i in range(1,len(prof)): L.append(L[-1]+math.dist(prof[i],prof[i-1]))
    for i in range(len(prof)-1):
        for k in range(seg):
            k2=(k+1)%seg
            f=bm.faces.new((rings[i][k],rings[i][k2],rings[i+1][k2],rings[i+1][k]))
            f.material_index=2 if band[0]<=i<band[1] else 1
            f.smooth=True
            for l,(kk,ii) in zip(f.loops,((k,i),(k+1,i),(k+1,i+1),(k,i+1))):
                l[uvl].uv=(kk/seg*6, L[ii]*12)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    hm=bpy.data.meshes.new('hat'); bm.to_mesh(hm); bm.free()
    straw=bpy.data.materials.new('straw'); straw.use_nodes=True
    tx=straw.node_tree.nodes.new('ShaderNodeTexImage'); tx.image=straw_image()
    bsdf=straw.node_tree.nodes['Principled BSDF']; straw.node_tree.links.new(tx.outputs['Color'],bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value=0.85
    bandm=bpy.data.materials.new('hatband'); bandm.use_nodes=True
    bandm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(0.48,0.03,0.03,1)
    bandm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=0.7
    main=o.data.materials[0]
    hm.materials.append(main); hm.materials.append(straw); hm.materials.append(bandm)
    while len(o.data.materials)<3: o.data.materials.append(straw if len(o.data.materials)==1 else bandm)
    ho=bpy.data.objects.new('hat',hm); bpy.context.scene.collection.objects.link(ho)
    vg=ho.vertex_groups.new(name='head'); vg.add(list(range(len(hm.vertices))),1.0,'REPLACE')
    bpy.ops.object.select_all(action='DESELECT'); ho.select_set(True); o.select_set(True)
    bpy.context.view_layer.objects.active=o; bpy.ops.object.join()
    print('hat built', len(hm.polygons) if hm.name in bpy.data.meshes else '')


def garment_fix():
    """Garments the hanging left hand touched (sash, shorts) must not follow the arm; the sash mostly
    hangs from the hips instead of swinging with the thigh."""
    import numpy as np, colorsys
    me=o.data
    P=np.array([v.co[:] for v in me.vertices])/S+np.array(O[:])
    col=np.load(src.replace('.blend','_col.npy'))
    hsv=np.array([colorsys.rgb_to_hsv(*c) for c in col])
    purple=(hsv[:,0]>0.68)&(hsv[:,0]<0.88)&(hsv[:,1]>0.3)
    def segd(a,b):
        a=np.array(a); b=np.array(b); ab=b-a; t=np.clip(((P-a)@ab)/(ab@ab),0,1); return np.linalg.norm(P-(a+t[:,None]*ab),axis=1)
    dl=np.minimum(segd((0.158,-0.06,0.615),(0.163,-0.04,0.495)),segd((0.163,-0.04,0.495),(0.165,-0.03,0.42)))
    skin=(hsv[:,0]>0.025)&(hsv[:,0]<0.13)&(hsv[:,1]>0.2)&(hsv[:,1]<0.53)&(hsv[:,2]>0.55)
    strip=purple|((P[:,2]<0.64)&~(skin&(dl<0.036)))
    gi={g.name:g.index for g in o.vertex_groups}
    armg={gi[n] for n in ('upperarm.L','forearm.L','hand.L')}
    nfix=0
    for v in me.vertices:
        if not strip[v.index]: continue
        ws={g.group:g.weight for g in v.groups}
        a=sum(w for k,w in ws.items() if k in armg)
        if purple[v.index]:
            for leg in ('thigh.L','thigh.R'):
                k=gi[leg]
                if k in ws: a+=ws[k]*0.65; ws[k]*=0.35
        if a<=1e-4: continue
        for k in armg:
            if k in ws: o.vertex_groups[[n for n,i in gi.items() if i==k][0]].remove([v.index]); ws.pop(k)
        for leg in ('thigh.L','thigh.R'):
            if gi[leg] in ws: o.vertex_groups[leg].add([v.index],ws[gi[leg]],'REPLACE')
        tgt='hips' if P[v.index,2]<0.6 else 'spine'
        o.vertex_groups[tgt].add([v.index],ws.get(gi[tgt],0)+a,'REPLACE'); nfix+=1
    print('garment fix verts',nfix)


def left_arm_transplant(twist=float(__import__('os').environ.get('LTWIST','0'))):
    """The AI left forearm is a mitten melted into the sash: any pose drags a sheet of hip with it.
    Replace it with a mirror of the clean right forearm/hand, re-expressed in the left bones' frames."""
    import bmesh, math
    me=o.data
    bm=bmesh.new(); bm.from_mesh(me)
    dl=bm.verts.layers.deform.verify(); uvl=bm.loops.layers.uv.active
    gi={g.name:g.index for g in o.vertex_groups}; ig={i:n for n,i in gi.items()}
    fR={gi['forearm.R'],gi['hand.R']}; fL={gi['forearm.L'],gi['hand.L']}
    # 1. melt the old left mitten back into the hip: weights, UVs and shape from the nearest garment
    from mathutils import kdtree
    oldset={v for v in bm.verts if sum(w for k,w in v[dl].items() if k in fL)>0.4}
    keep=[v for v in bm.verts if v not in oldset and sum(w for k,w in v[dl].items() if k in fL|{gi['upperarm.L']})<0.05]
    kd=kdtree.KDTree(len(keep))
    for i,v in enumerate(keep): kd.insert(v.co,i)
    kd.balance()
    vuv={}
    for f in bm.faces:
        for l in f.loops: vuv.setdefault(l.vert, l[uvl].uv.copy())
    near={}
    for v in oldset:
        q=keep[kd.find(v.co)[1]]; near[v]=q
    for v,q in near.items():
        d=v[dl]; d.clear()
        for k,w in q[dl].items(): d[k]=w
        v.co=q.co+(v.co-q.co)*0.25
    # paint the melted lump plain shorts-orange (nearest orange texel to the lump)
    import colorsys
    img=[n.image for n in o.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE' and 'normal' not in n.image.name and 'metal' not in n.image.name][0]
    IW,IH=img.size; px=np.empty(IW*IH*4,np.float32); img.pixels.foreach_get(px); px=px.reshape(IH,IW,4)
    cen=sum((v.co for v in oldset),Vector())/len(oldset)
    best=None
    for v in sorted(keep,key=lambda q:(q.co-cen).length)[:400]:
        uv=vuv.get(v)
        if uv is None: continue
        c=px[int(min(max(uv.y,0),0.999)*IH),int(min(max(uv.x,0),0.999)*IW),:3]
        h,sa,va=colorsys.rgb_to_hsv(*c)
        if 0.04<h<0.11 and sa>0.55 and va>0.6: best=uv; break
    print('left arm: lump colour uv',best)
    for f in bm.faces:
        for l in f.loops:
            if l.vert in near: l[uvl].uv=best if best is not None else vuv[near[l.vert]]
    for v in bm.verts:
        d=v[dl]; a=sum(d.get(k,0) for k in fL)
        if a<=0: continue
        for k in fL:
            if k in d: del d[k]
        tgt=gi['upperarm.L'] if v.co.z/S>0.6 else gi['hips']
        d[tgt]=d.get(tgt,0)+a
    print('left arm: melted',len(oldset),'mitten verts into the hip')
    # 2. mirror the right forearm/hand into the left bones' frames
    RB={n:ao.data.bones[n].matrix_local for n in ('upperarm.R','forearm.R','hand.R','upperarm.L','forearm.L','hand.L')}
    Mx=Matrix.Diagonal((-1,1,1,1)); Tw=Matrix.Rotation(twist,4,'Y')
    X={}
    for side in ('upperarm','forearm','hand'):
        X[gi[side+'.R']]=RB[side+'.L']@Tw@Mx@RB[side+'.R'].inverted()
    src_v={v for v in bm.verts if sum(w for k,w in v[dl].items() if k in fR)>0.3}
    faces=[f for f in bm.faces if all(v in src_v for v in f.verts)]
    used={v for f in faces for v in f.verts}
    nmap={}
    for v in used:
        d=v[dl]; tot=sum(w for k,w in d.items() if k in X)
        co=Vector((0,0,0))
        for k,w in d.items():
            if k in X: co+=(X[k]@v.co)*(w/tot)
        nv=bm.verts.new(co); nmap[v]=nv
        nd=nv[dl]
        for k,w in d.items():
            n=ig[k]; n2=n[:-2]+'.L' if n.endswith('.R') else n
            nd[gi[n2]]=w
    newf=[]
    for f in faces:
        try: nf=bm.faces.new([nmap[v] for v in f.verts], f)
        except ValueError: continue
        for l,l0 in zip(nf.loops,f.loops): l[uvl].uv=l0[uvl].uv
        newf.append(nf)
    bmesh.ops.reverse_faces(bm, faces=newf)
    print('left arm: transplanted',len(nmap),'verts',len(newf),'faces')
    bm.to_mesh(me); bm.free(); me.validate()

if '--noheal' not in sys.argv:
    garment_fix()
    hatfix()
    left_arm_transplant()
    if '--nohands' not in sys.argv:
        import hands, os
        hands.build(o, ao, S, float(os.environ.get('HTW_R','0')), float(os.environ.get('HTW_L','0')))
# report vertices with no weights
me=o.data; zero=sum(1 for v in me.vertices if not any(g.weight>0.01 for g in v.groups))
print('unweighted verts',zero,'of',len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=out)
