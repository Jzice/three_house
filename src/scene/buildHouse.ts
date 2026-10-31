import * as THREE from 'three';
import type { BoxSpec, InteractiveObject, MaterialMap } from '../types';
import {
  COLUMNS,
  EXTERIOR_WALLS,
  FLOOR_SLABS,
  INTERIOR_WALLS,
  MAIN_DOOR,
  WINDOWS,
} from '../config/houseConfig';
import { createBox, createInteractiveMainDoor, createInteractiveWindow } from './builders';
import { createStairs } from './stairs';

export interface HouseResult {
  /** 整屋根节点，加入场景即可 */
  root: THREE.Group;
  /** 可点击开合的门窗部件 */
  interactables: InteractiveObject[];
}

/** 依据 houseConfig 的数据描述装配整屋 */
export function buildHouse(materials: MaterialMap): HouseResult {
  const root = new THREE.Group();
  const interactables: InteractiveObject[] = [];

  const addAll = (specs: BoxSpec[]): void => {
    for (const spec of specs) {
      root.add(createBox(spec, materials));
    }
  };

  // 楼板 -> 外墙 -> 内墙 -> 柱
  addAll(FLOOR_SLABS);
  addAll(EXTERIOR_WALLS);
  addAll(INTERIOR_WALLS);
  addAll(COLUMNS);

  // 可交互窗
  for (const spec of WINDOWS) {
    const { container, parts } = createInteractiveWindow(spec, materials);
    root.add(container);
    interactables.push(...parts);
  }

  // 可交互入户门
  const door = createInteractiveMainDoor(MAIN_DOOR, materials);
  root.add(door.container);
  interactables.push(...door.parts);

  // 楼梯
  root.add(createStairs(materials));

  return { root, interactables };
}
