import * as THREE from 'three';
import type { BoxSpec, FloorConfig, InteractiveObject, MaterialKey, MaterialMap } from '../types';
import {
  FLOORS,
  getColumns,
  getExteriorWalls,
  getFloorSlabs,
  getInteriorDoors,
  getInteriorWalls,
  getSouthWall,
  getThresholdSegments,
  getWindows,
  MAIN_DOOR,
  SLIDING_DOOR,
  TILE_SIZE,
  WALL_TOP_GUARD,
  BACK_DOOR,
} from '../config/houseConfig';
import {
  createBox,
  createExteriorSwingDoor,
  createHoledWall,
  createInteriorDoor,
  createInteractiveMainDoor,
  createInteractiveWindow,
  createLowerSashWindow,
  createSlidingGlassDoor,
  createSlidingWindow,
} from './builders';
import { createStairs, buildStairHandrail } from './stairs';
import { createBalcony } from './balcony';
import { createRoof } from './roof';
import { createYard } from './yard';

export interface HouseResult {
  /** 整屋根节点，加入场景即可 */
  root: THREE.Group;
  /** 可点击开合的门窗部件 */
  interactables: InteractiveObject[];
  /** 本层天花板组（= 上层楼板 / 屋顶板底面），仅第一人称处于该层时可见 */
  ceiling: THREE.Group;
}

/**
 * 把 BoxSpec 的局部竖向坐标（相对本层完成面的绝对米数）平移到世界坐标。
 * 所有构件的 y/h 都由配置按各层 `floor.wallH` 给出绝对标准尺寸，此处**不再做层间缩放**。
 *
 * 「到顶」构件（外墙 / 内墙 / 门头墙 / 承重柱 / 窗上段）顶面额外让缝 WALL_TOP_GUARD：
 * 其顶面原本恰好等于上层楼板顶面（= 上层 baseY），两片面共面会 z-fighting，
 * 墙脚印以墙色随机渗出到 2F/3F 楼板上，看起来像下层围墙的影子。
 * 让缝后墙顶埋入楼板（或屋面板）体积内被遮住，仅外立面留一道发丝级分隔缝。
 * 窗台、门垛等不到顶的盒子不受影响；楼梯顶步不经此映射，仍与楼板齐平。
 */
function remapBox(spec: BoxSpec, floor: FloorConfig): BoxSpec {
  const yCenter = floor.baseY + spec.y;
  const floorTop = floor.baseY + floor.wallH;
  if (yCenter + spec.h / 2 >= floorTop - 1e-6) {
    const h2 = spec.h - WALL_TOP_GUARD;
    return { ...spec, h: h2, y: floorTop - WALL_TOP_GUARD - h2 / 2 };
  }
  return { ...spec, y: yCenter };
}

/**
 * 楼板 / 天花板网格：顶面用 topMaterial（地砖或外墙色），底面与四周用白色乳胶漆 paint。
 * 地砖贴图相位对齐全局砖缝网格（x≡-4.40、z≡-4.90），与 getFloorSlabs 的多块拆分拼缝一致。
 * 楼板为**世界坐标**（厚度绝对、顶面 = 完成面），故不走 remapBox。
 */
function createSlabMesh(
  spec: BoxSpec,
  materials: MaterialMap,
  topMaterial: MaterialKey = 'floor',
): THREE.Mesh {
  const topMat = materials[topMaterial];
  const mat = topMat.clone();
  // 仅当地砖/墙砖等带贴图材质才重设砖缝相位；纯色材质（如 wall）无 map，直接克隆即可
  if (topMat.map) {
    const tex = (topMat.map as THREE.Texture).clone();
    tex.needsUpdate = true;
    tex.repeat.set(spec.w / TILE_SIZE, spec.d / TILE_SIZE);
    // BoxGeometry 顶面 UV：u 随 +x 增大、v 随 -z 增大（three buildPlane('x','z','y',…)），
    // 故 z 向相位用南沿反推，保证避让梯井的多块楼板拼缝处砖缝对齐。
    const x0 = spec.x - spec.w / 2;
    const z1 = spec.z + spec.d / 2;
    tex.offset.set((x0 + 4.4) / TILE_SIZE, (-4.9 - z1) / TILE_SIZE);
    mat.map = tex;
  }
  // BoxGeometry 材质序 [+x,-x,+y,-y,+z,-z]：顶面 topMaterial，其余（含底面）为白色乳胶漆
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), [
    materials.paint,
    materials.paint,
    mat,
    materials.paint,
    materials.paint,
    materials.paint,
  ]);
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * 门槛 / 门洞补地面网格：过门石是整块实心材料，六面同材质（侧面为断口而非乳胶漆）。
 * 带贴图的材质按构件自身尺寸平铺，不套用楼板的 0.8m 全局砖缝相位——真实过门石本就独立分块；
 * 并给窄条设 repeat 下限，避免木纹 / 矿粒在几厘米宽的门槛上被裁成纯色。
 */
function createThresholdMesh(spec: BoxSpec, materials: MaterialMap): THREE.Mesh {
  const src = materials[spec.material];
  const mat = src.clone();
  if (src.map) {
    const tex = (src.map as THREE.Texture).clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(spec.w / TILE_SIZE, 0.5), Math.max(spec.d / TILE_SIZE, 0.5));
    mat.map = tex;
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mat);
  mesh.name = `threshold-${spec.material}-${spec.x.toFixed(2)}-${spec.z.toFixed(2)}`;
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** 依据 floor 的标高与层高装配该层整屋 */
export function buildHouse(materials: MaterialMap, floor: FloorConfig): HouseResult {
  const root = new THREE.Group();
  root.name = floor.name;
  const interactables: InteractiveObject[] = [];

  const addAll = (specs: BoxSpec[]): void => {
    for (const spec of specs) {
      root.add(createBox(remapBox(spec, floor), materials));
    }
  };

  // 外墙 -> 内墙 -> 柱（均按层重映射；柱仅存在于有楼梯的楼层）
  addAll(getExteriorWalls(floor));
  // 南墙：整片带洞墙（单网格挖洞，避免多段墙盒拼接在窗/门边留下接缝）
  const southWall = getSouthWall(floor);
  if (southWall) root.add(createHoledWall(southWall, floor.baseY, materials));
  addAll(getInteriorWalls(floor));
  if (floor.stair) addAll(getColumns(floor));

  // 楼板：每块按自身尺寸设置 0.8m 瓷砖重复。
  for (const spec of getFloorSlabs(floor)) {
    root.add(createSlabMesh(spec, materials));
  }

  // 门槛 / 过门石 / 门洞补地面：按各门两侧实际地面与高差铺装（世界坐标，不走 remapBox）。
  // 放在楼板之后、门窗之前，外门缺口由补地面实体填实，内门收边条叠在连续楼板之上。
  for (const seg of getThresholdSegments(floor)) {
    root.add(createThresholdMesh(seg.spec, materials));
  }

  // 天花板：本层上方的楼板底面（= 上层楼板 / 屋顶板），仅第一人称处于该层时可见，
  // 使抬头看到真实天花板而非天空。几何与上层楼板完全一致（含楼梯井洞口），单独成组便于独立显隐。
  const ceiling = new THREE.Group();
  ceiling.name = 'ceiling';
  if (floor.index < FLOORS.length - 1) {
    const above = FLOORS[floor.index + 1];
    if (above.roof) {
      // 3F 天花板 = 平屋顶板（底面白色乳胶漆、其余外墙色，与 roof.ts 一致）
      const r = above.roof;
      const { x0, x1, z0, z1 } = r.bounds;
      const roofSlab: BoxSpec = {
        w: x1 - x0,
        h: r.slabT,
        d: z1 - z0,
        x: (x0 + x1) / 2,
        y: above.baseY + r.slabT / 2,
        z: (z0 + z1) / 2,
        material: 'wall',
      };
      ceiling.add(createSlabMesh(roofSlab, materials, 'wall'));
    } else {
      for (const spec of getFloorSlabs(above)) {
        ceiling.add(createSlabMesh(spec, materials));
      }
    }
  }
  root.add(ceiling);

  // 可交互窗（按层抬升 + 竖向缩放；推拉窗走滑动逻辑；大窗走下方小窗格对开）
  for (const spec of getWindows(floor)) {
    const builder =
      spec.style === 'sliding'
        ? createSlidingWindow
        : spec.openSashes === 'lower-sides'
          ? createLowerSashWindow
          : createInteractiveWindow;
    const { container, parts } = builder(spec, materials, floor);
    root.add(container);
    interactables.push(...parts);
  }

  // 可交互入户门：1F 双开铜门；2F 两折玻璃推拉门（通阳台）；3F 无（仅正面墙装饰门）
  if (floor.index === 0 || floor.index === 1) {
    const mainDoor =
      floor.index === 0
        ? createInteractiveMainDoor(MAIN_DOOR, materials, floor)
        : createSlidingGlassDoor(SLIDING_DOOR, materials, floor);
    root.add(mainDoor.container);
    interactables.push(...mainDoor.parts);
  }

  // 1F 北墙后门：矩形金属单开门（1.1m×2m，铰链在东侧、朝室外/院子开），灰色哑光漆 + 门框包边
  if (floor.index === 0) {
    const backDoor = createExteriorSwingDoor(
      BACK_DOOR.w,
      BACK_DOOR.h,
      1, // 铰链在东侧
      -Math.PI / 2 * 0.85, // 负角 = 朝室外（北向，院子）开
      materials,
      'back',
    );
    backDoor.container.position.set(BACK_DOOR.x, floor.baseY, BACK_DOOR.z);
    root.add(backDoor.container);
    interactables.push(...backDoor.parts);
  }

  // 可交互内门（卧室/杂物间=木门，卫生间=磨砂玻璃门）
  for (const spec of getInteriorDoors(floor)) {
    const { container, parts } = createInteriorDoor(spec, materials, floor);
    root.add(container);
    interactables.push(...parts);
  }

  // 楼梯（按层配置；3F 无楼梯）
  if (floor.stair) {
    root.add(createStairs(materials, floor));
  }

  // 阳台（仅部分楼层配置，如 2F 南墙阳台、3F 南侧大阳台）
  if (floor.balcony) {
    root.add(createBalcony(floor.balcony, materials, floor));
  }

  // 平屋顶（如 3F 半层顶）
  if (floor.roof) {
    root.add(createRoof(floor.roof, materials, floor));
  }

  // 院子（如 1F 环绕铺装与围墙）
  if (floor.yard) {
    root.add(createYard(floor.yard, materials));
  }

  // 楼梯扶手按楼层构建，作为该层 root 的子节点：
  // 选中某层时整体显示、其余层隐藏（第三人称"各层整体显示"），扶手在楼层交接处随各自圆管端盖自然封口。
  if (floor.stair || floor.index === 2) {
    root.add(buildStairHandrail(materials, floor));
  }

  return { root, interactables, ceiling };
}


