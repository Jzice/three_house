import * as THREE from 'three';
import type { BalconyConfig, FloorConfig, MaterialMap } from '../types';
import { D, FLOOR_T, FLOOR_Y, H, T_EXT, TILE_SIZE, W } from '../config/houseConfig';

/**
 * 南墙阳台（挑台）：
 * - 自南墙外表面向外挑出 `width`
 * - 长度与南墙一致，两端再各外延 `sideExtend`
 * - 含挑台板（地砖贴图）与外沿、两端共三面栏杆
 */
export function createBalcony(
  spec: BalconyConfig,
  materials: MaterialMap,
  floor: FloorConfig,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'balcony';

  // 楼面标高：与本层楼板顶面齐平（楼板中心 baseY+(FLOOR_Y/H)*wallH，板厚按 wallH/H 缩放）
  const floorTopY =
    floor.baseY + (FLOOR_Y / H) * floor.wallH + (FLOOR_T * (floor.wallH / H)) / 2;

  const wallOuterZ = D / 2; // 南墙外表面 z = 5.12
  const wallHalfX = W / 2 - T_EXT; // 南墙两端 x = ±4.38
  const frontDepth = spec.frontDepth ?? 0; // 自南墙外皮向内延伸的深度（3F 大阳台）
  const slabX0 = -wallHalfX - spec.sideExtend;
  const slabX1 = wallHalfX + spec.sideExtend;
  const slabW = slabX1 - slabX0;
  const slabD = spec.width + frontDepth;
  const slabZ = wallOuterZ + spec.width / 2 - frontDepth / 2;

  // ---- 挑台板：地砖贴图按自身尺寸设重复 ----
  const mat = materials.floor.clone();
  const tex = (materials.floor.map as THREE.Texture).clone();
  tex.needsUpdate = true;
  tex.repeat.set(slabW / TILE_SIZE, slabD / TILE_SIZE);
  mat.map = tex;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(slabW, spec.slabT, slabD), mat);
  slab.position.set(0, floorTopY - spec.slabT / 2, slabZ);
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // ---- 栏杆：外沿 + 两端（内沿与正面墙相接，不设栏杆） ----
  const zOuter = wallOuterZ + spec.width;
  const zInner = wallOuterZ - frontDepth;
  const segments: [number, number, number, number][] = [
    [slabX0, zOuter, slabX1, zOuter], // 外沿
    [slabX0, zOuter, slabX0, zInner], // 西端
    [slabX1, zOuter, slabX1, zInner], // 东端
  ];

  for (const [x0, z0, x1, z1] of segments) {
    addRail(group, materials, spec, x0, z0, x1, z1, floorTopY + spec.railH); // 上横杆
    addRail(group, materials, spec, x0, z0, x1, z1, floorTopY + spec.railH * 0.55); // 中横杆
  }

  // ---- 立柱：沿各段均分，转角处共用（按坐标去重） ----
  const postKeys = new Set<string>();
  for (const [x0, z0, x1, z1] of segments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / spec.postGap));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      postKeys.add(`${x.toFixed(3)}|${z.toFixed(3)}`);
    }
  }
  for (const key of postKeys) {
    const [xs, zs] = key.split('|');
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(spec.postT, spec.railH, spec.postT),
      materials.railingGray,
    );
    post.position.set(Number(xs), floorTopY + spec.railH / 2, Number(zs));
    post.castShadow = true;
    group.add(post);
  }

  return group;
}

/** 沿一段水平线段铺设一道横杆（截面 railT × railT） */
function addRail(
  group: THREE.Group,
  materials: MaterialMap,
  spec: BalconyConfig,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(len, spec.railT, spec.railT),
    materials.railingGray,
  );
  rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  // 局部 +x 轴旋转到线段方向（绕 Y 轴旋转 θ 后 +x → (cosθ, 0, -sinθ)）
  rail.rotation.y = Math.atan2(-dz, dx);
  rail.castShadow = true;
  group.add(rail);
}
