import * as THREE from 'three';
import type { BalconyConfig, FloorConfig, MaterialMap } from '../types';
import { D, FLOOR_T, FLOOR_Y, H, T_EXT, TILE_SIZE, W } from '../config/houseConfig';

/**
 * 南墙阳台（挑台）：
 * - 自南墙外表面向外挑出 `width`，可经 `frontDepth` 向墙内侧延伸（3F 大阳台）
 * - 长度与南墙一致，两端再各外延 `sideExtend`
 * - 栏杆参考欧式护栏样式：顶部扶手 + 底部横杆 + 密排细栏条 +
 *   间隔加粗立柱（柱头高出扶手、顶端球形饰）
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

  // ---- 栏杆（三面：外沿 + 两端；内沿与墙相接不设） ----
  const topRailY = floorTopY + spec.railH; // 扶手轴线
  const bottomRailY = floorTopY + 0.1; // 底部横杆
  const railT = spec.railT;
  const balT = 0.03; // 细栏条截面
  const balusterGap = 0.13; // 细栏条中心距
  const postT = 0.09; // 间隔立柱截面
  const postSpacing = spec.postGap * 2; // 立柱中心距
  const postH = spec.railH + 0.16; // 立柱高出扶手
  const finialR = 0.06; // 柱顶球形饰半径

  const zOuter = wallOuterZ + spec.width;
  const zInner = wallOuterZ - frontDepth;
  const segments: [number, number, number, number][] = [
    [slabX0, zOuter, slabX1, zOuter], // 外沿
    [slabX0, zOuter, slabX0, zInner], // 西端
    [slabX1, zOuter, slabX1, zInner], // 东端
  ];

  // 立柱位置（按坐标去重，转角共用）：每段端点 + 沿段均分
  const postKeys = new Set<string>();
  for (const [x0, z0, x1, z1] of segments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / postSpacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      postKeys.add(`${px.toFixed(3)}|${pz.toFixed(3)}`);
    }
  }

  for (const [x0, z0, x1, z1] of segments) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;

    // 顶部扶手 + 底部横杆
    addRail(group, materials, x0, z0, x1, z1, topRailY, railT);
    addRail(group, materials, x0, z0, x1, z1, bottomRailY, 0.05);

    // 密排细栏条（位于底杆与扶手之间；端头由立柱/转角覆盖）
    const n = Math.max(1, Math.round(len / balusterGap));
    const barH = topRailY - railT / 2 - bottomRailY;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const bal = new THREE.Mesh(
        new THREE.BoxGeometry(balT, barH, balT),
        materials.railingGray,
      );
      bal.position.set(x0 + (x1 - x0) * t, bottomRailY + barH / 2, z0 + (z1 - z0) * t);
      bal.castShadow = true;
      group.add(bal);
    }
  }

  // 间隔加粗立柱：高出扶手，顶端球形饰
  for (const key of postKeys) {
    const [xs, zs] = key.split('|');
    const px = Number(xs);
    const pz = Number(zs);
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(postT, postH, postT),
      materials.railingGray,
    );
    post.position.set(px, floorTopY + postH / 2, pz);
    post.castShadow = true;
    group.add(post);

    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(finialR, 16, 12),
      materials.railingGray,
    );
    finial.position.set(px, floorTopY + postH + finialR * 0.6, pz);
    finial.castShadow = true;
    group.add(finial);
  }

  return group;
}

/** 沿一段水平线段铺设一道横杆（截面 t × t） */
function addRail(
  group: THREE.Group,
  materials: MaterialMap,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  t: number,
): void {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(len, t, t), materials.railingGray);
  rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  // 局部 +x 轴旋转到线段方向（绕 Y 轴旋转 θ 后 +x → (cosθ, 0, -sinθ)）
  rail.rotation.y = Math.atan2(-dz, dx);
  rail.castShadow = true;
  group.add(rail);
}
