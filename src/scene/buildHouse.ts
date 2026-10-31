import * as THREE from 'three';
import type { BoxSpec, FloorConfig, InteractiveObject, MaterialMap } from '../types';
import {
  COLUMNS,
  getExteriorWalls,
  getFloorSlabs,
  getInteriorDoors,
  getInteriorWalls,
  getWindows,
  H,
  MAIN_DOOR,
  SLIDING_DOOR,
  TILE_SIZE,
} from '../config/houseConfig';
import {
  createBox,
  createInteriorDoor,
  createInteractiveMainDoor,
  createInteractiveWindow,
  createSlidingGlassDoor,
} from './builders';
import { createStairs } from './stairs';
import { createBalcony } from './balcony';
import { createRoof } from './roof';

export interface HouseResult {
  /** 整屋根节点，加入场景即可 */
  root: THREE.Group;
  /** 可点击开合的门窗部件 */
  interactables: InteractiveObject[];
}

/**
 * 对 1F 参考坐标系下的 BoxSpec 做竖直重映射：
 * 高度按 wallH/H 缩放，y 按 baseY + (y/H)*wallH 抬升，使同一套户型可复用到任意楼层。
 */
function remapBox(spec: BoxSpec, floor: FloorConfig): BoxSpec {
  const k = floor.wallH / H;
  return {
    ...spec,
    h: spec.h * k,
    y: floor.baseY + (spec.y / H) * floor.wallH,
  };
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
  addAll(getInteriorWalls(floor));
  if (floor.stair) addAll(COLUMNS);

  // 楼板：每块按自身尺寸设置 0.8m 瓷砖重复，并按层重映射标高
  for (const raw of getFloorSlabs(floor)) {
    const spec = remapBox(raw, floor);
    const mat = materials.floor.clone();
    const tex = (materials.floor.map as THREE.Texture).clone();
    tex.needsUpdate = true;
    tex.repeat.set(spec.w / TILE_SIZE, spec.d / TILE_SIZE);
    mat.map = tex;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mat);
    mesh.position.set(spec.x, spec.y, spec.z);
    mesh.castShadow = spec.cast ?? true;
    mesh.receiveShadow = spec.receive ?? true;
    root.add(mesh);
  }

  // 可交互窗（按层抬升 + 竖向缩放）
  for (const spec of getWindows(floor)) {
    const { container, parts } = createInteractiveWindow(spec, materials, floor);
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

  return { root, interactables };
}
