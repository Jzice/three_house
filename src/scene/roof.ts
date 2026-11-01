import * as THREE from 'three';
import type { FloorConfig, MaterialMap, RoofConfig } from '../types';
import { createBox } from './builders';

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

  // 屋面板（坐于墙顶，四周悬挑）：底面即 3F 天花板 → 白色乳胶漆；外露面沿用外墙色
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
  group.add(slab);

  // 女儿墙：沿板四周布置
  const t = spec.parapetT;
  const py = baseY + spec.slabT + spec.parapetH / 2;
  group.add(
    createBox({ w, h: spec.parapetH, d: t, x: cx, y: py, z: z0 + t / 2, material: 'wall' }, materials),
  );
  group.add(
    createBox({ w, h: spec.parapetH, d: t, x: cx, y: py, z: z1 - t / 2, material: 'wall' }, materials),
  );
  const sideD = d - 2 * t;
  group.add(
    createBox(
      { w: t, h: spec.parapetH, d: sideD, x: x0 + t / 2, y: py, z: cz, material: 'wall' },
      materials,
    ),
  );
  group.add(
    createBox(
      { w: t, h: spec.parapetH, d: sideD, x: x1 - t / 2, y: py, z: cz, material: 'wall' },
      materials,
    ),
  );

  return group;
}
