// Devil fruit models: swirl-patterned fruit with a curled stem, used on the
// selection pedestal and in the eating cutscene.
import * as THREE from 'three';
import { FRUITS, FruitId } from './data';

function swirlTexture(c1: number, c2: number) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d')!;
  const a = '#' + c1.toString(16).padStart(6, '0');
  const b = '#' + c2.toString(16).padStart(6, '0');
  g.fillStyle = a;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = b;
  g.lineWidth = 5;
  g.lineCap = 'round';
  // Rows of spiral swirls, the classic devil-fruit pattern.
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = col * 44 + (row % 2) * 22 + 10, cy = 22 + row * 42;
      g.beginPath();
      for (let t = 0; t < Math.PI * 4.2; t += 0.15) {
        const r = 2 + t * 1.4;
        const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
        if (t === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function makeFruit(id: FruitId) {
  const d = FRUITS[id];
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ map: swirlTexture(d.color, d.color2), roughness: 0.35, metalness: 0.05, emissive: d.color, emissiveIntensity: 0.25 });
  // Slightly lobed body.
  const geo = new THREE.SphereGeometry(0.5, 32, 24);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const lobe = 1 + Math.sin(a * 5) * 0.05 * (1 - Math.abs(v.y) * 1.6);
    v.x *= lobe; v.z *= lobe;
    if (v.y > 0.38) v.y -= (v.y - 0.38) * 0.6;
    pos.setXYZ(i, v.x, v.y * 1.08, v.z);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  group.add(body);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3a5a1a, roughness: 0.8 });
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0.02, 0.62, 0), new THREE.Vector3(0.14, 0.72, 0), new THREE.Vector3(0.2, 0.62, 0.02)]);
  const stem = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 6), stemMat);
  group.add(stem);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.12, 0.1, 0, 0.32);
  leafShape.quadraticCurveTo(-0.12, 0.1, 0, 0);
  const leaf = new THREE.Mesh(new THREE.ShapeGeometry(leafShape), new THREE.MeshStandardMaterial({ color: 0x4f9a2a, side: THREE.DoubleSide, roughness: 0.7 }));
  leaf.position.set(0.02, 0.6, 0);
  leaf.rotation.set(0.3, 0, -1.1);
  group.add(leaf);
  // Soft aura shell.
  const aura = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
  aura.name = 'aura';
  group.add(aura);
  return group;
}
