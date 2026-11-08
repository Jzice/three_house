import * as THREE from 'three';
import type { FloorConfig, MaterialMap, RoofConfig } from '../types';

/**
 * 平屋顶：屋面板坐于本层墙顶（板底 = 墙顶），四周按 bounds 悬挑出墙外，
 * 女儿墙沿板四周布置。3F 半层顶：北/东/西挑空 0.5m、南挑空 0.8m，南侧阳台露天。
 */
export function createRoof(
  spec: RoofConfig,
  materials: MaterialMap,
  floor: FloorConfig,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'roof';

  const baseY = floor.baseY + floor.wallH; // 墙顶 = 屋面板底面
  const { x0, x1, z0, z1 } = spec.bounds;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;

  // 屋面板（坐于墙顶，四周悬挑）：底面即 3F 天花板 → 白色乳胶漆；
  // 顶面与四周侧面统一用外墙 wall，与下方外墙共用同一材质实例。
  // 不再做按太阳强度的自发光补偿：常数补光在背光朝向会形成一圈恒定亮边，
  // 各朝向的明暗差交由真实光照体现，随视角自然连续。
  // BoxGeometry 材质序 [+x,-x,+y,-y,+z,-z]
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, spec.slabT, d), [
    materials.wall,
    materials.wall,
    materials.wall,
    materials.paint,
    materials.wall,
    materials.wall,
  ]);
  slab.position.set(cx, baseY + spec.slabT / 2, cz);
  slab.castShadow = false;
  slab.receiveShadow = false;
  // 室外水平顶面：雪天积雪覆盖、雨天湿亮（由 weatherFx 接管材质 + 雪壳）
  slab.userData.weatherExposed = 'roof';
  group.add(slab);

  // 女儿墙：沿板四周布置。四个竖直侧面与压顶全部用外墙 wall，
  // 与屋面板侧面、下方外墙同源；顶面朝上受光更强是正常光影，不再额外补光。
  // BoxGeometry 材质序 [+x,-x,+y,-y,+z,-z]
  const t = spec.parapetT;
  const py = baseY + spec.slabT + spec.parapetH / 2;
  const sideD = d - 2 * t;
  const parapet = (pw: number, pd: number, px: number, pz: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw, spec.parapetH, pd), [
      materials.wall,
      materials.wall,
      materials.wall,
      materials.wall,
      materials.wall,
      materials.wall,
    ]);
    mesh.position.set(px, py, pz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  };
  group.add(parapet(w, t, cx, z0 + t / 2));
  group.add(parapet(w, t, cx, z1 - t / 2));
  group.add(parapet(t, sideD, x0 + t / 2, cz));
  group.add(parapet(t, sideD, x1 - t / 2, cz));

  return group;
}
