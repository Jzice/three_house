import * as THREE from 'three';

/**
 * 游戏道具通用几何工厂：倒角盒、圆角片、锥形肢体。
 * 全部返回 Mesh，材质由调用方传入（保持共享材质、便于统一释放）。
 */

const UP = new THREE.Vector3(0, 1, 0);

/** 普通方块 */
export function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

/** 圆柱（默认沿 Y 轴） */
export function cyl(rt: number, rb: number, h: number, mat: THREE.Material, seg = 12): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
}

/** 球 */
export function sphere(r: number, mat: THREE.Material, seg = 14): THREE.Mesh {
  return new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg - 2)), mat);
}

/** 圆环（默认绕 Z 轴） */
export function torus(r: number, tube: number, mat: THREE.Material, arc = Math.PI * 2): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 18, arc), mat);
}

/** 圆角矩形轮廓（中心在原点） */
function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const rr = Math.max(0.0001, Math.min(r, Math.min(w, h) / 2 - 0.0001));
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/**
 * 倒角盒（ExtrudeGeometry）。w/h 为 XY 尺寸，d 为 Z 厚度，
 * r 为圆角半径，bevel 为倒角尺寸（≈0.002~0.006 时观感最自然）。
 */
export function bevelBox(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  r = 0.004,
  bevel = 0.002,
): THREE.Mesh {
  const shape = roundedRectShape(w, h, r);
  const depth = Math.max(0.0008, d - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 3,
    steps: 1,
  });
  geo.center();
  return new THREE.Mesh(geo, mat);
}

/** 薄板（倒角很小，用于护木/枪托/剪刀片） */
export function plate(w: number, h: number, t: number, mat: THREE.Material, r = 0.008): THREE.Mesh {
  return bevelBox(w, h, t, mat, r, Math.min(0.0025, t * 0.4));
}

/**
 * 锥形肢体/杆件：从 from 指向 to，末端半径 rTo、起点半径 rFrom。
 * 用于小臂、枪管、水管等任意朝向的圆杆。
 */
export function limb(
  from: THREE.Vector3,
  to: THREE.Vector3,
  rFrom: number,
  rTo: number,
  mat: THREE.Material,
  seg = 10,
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(rTo, rFrom, Math.max(0.0001, len), seg);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

/** 绑定位置与旋转的便捷函数 */
export function at(
  mesh: THREE.Mesh,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): THREE.Mesh {
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  return mesh;
}
