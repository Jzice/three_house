import * as THREE from 'three';
import type { BoxSpec, DoorSpec, InteractiveObject, MaterialMap, WindowSpec } from '../types';
import { DOOR_H } from '../config/houseConfig';

/** 由 BoxSpec 生成一个长方体网格 */
export function createBox(spec: BoxSpec, materials: MaterialMap): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(spec.w, spec.h, spec.d),
    materials[spec.material],
  );
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.castShadow = spec.cast ?? true;
  mesh.receiveShadow = spec.receive ?? true;
  return mesh;
}

/** 交互对象上 userData 的通用装配 */
function markInteractive(
  object: THREE.Object3D,
  type: InteractiveObject['userData']['type'],
  openAngle: number,
): InteractiveObject {
  object.userData = {
    isInteractive: true,
    type,
    isOpen: false,
    closedAngle: 0,
    openAngle,
  };
  return object as InteractiveObject;
}

export interface InteractiveBuildResult {
  /** 可直接加入场景的容器 */
  container: THREE.Group;
  /** 需要参与开合动画的部件 */
  parts: InteractiveObject[];
}

/** 入户双开大门：左右两扇各自绕外侧立边旋转 */
export function createInteractiveMainDoor(
  spec: DoorSpec,
  materials: MaterialMap,
): InteractiveBuildResult {
  const doorW = 2.4;
  const halfW = doorW / 2;
  const doorT = 0.1;
  const leafW = halfW - 0.005;

  const leftDoorGrp = new THREE.Group();
  leftDoorGrp.position.set(-halfW, 0, 0);
  const leftDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, DOOR_H, doorT),
    materials.copper,
  );
  leftDoorMesh.position.set(leafW / 2, DOOR_H / 2, 0);
  leftDoorGrp.add(leftDoorMesh);

  const rightDoorGrp = new THREE.Group();
  rightDoorGrp.position.set(halfW, 0, 0);
  const rightDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, DOOR_H, doorT),
    materials.copper,
  );
  rightDoorMesh.position.set(-leafW / 2, DOOR_H / 2, 0);
  rightDoorGrp.add(rightDoorMesh);

  const parts: InteractiveObject[] = [
    markInteractive(leftDoorGrp, 'door', (-Math.PI / 2) * 0.9),
    markInteractive(rightDoorGrp, 'door', (Math.PI / 2) * 0.9),
  ];

  const container = new THREE.Group();
  container.add(leftDoorGrp, rightDoorGrp);
  container.position.set(spec.x, spec.y, spec.z);

  return { container, parts };
}

/** 可开启的窗：固定外框 + 一扇绕左侧立边旋转的窗扇 */
export function createInteractiveWindow(
  spec: WindowSpec,
  materials: MaterialMap,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.15;

  const container = new THREE.Group();

  // 外框四边
  const frameBars: Array<[number, number, number, number]> = [
    [w, frameT, 0, h / 2 - frameT / 2],
    [w, frameT, 0, -h / 2 + frameT / 2],
    [frameT, h, -w / 2 + frameT / 2, 0],
    [frameT, h, w / 2 - frameT / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.15), materials.copper);
    bar.position.set(bx, by, 0);
    container.add(bar);
  }

  // 窗扇
  const windowSash = new THREE.Group();
  windowSash.position.set(-w / 2 + frameT, 0, 0);

  const innerW = w - frameT * 2;
  const innerH = h - frameT * 2;
  const vT = 0.08;
  const hT = 0.1;
  const sideW = 0.4;
  const centerW = 0.54;

  // 两道竖向分隔
  const vOffsets = [sideW + vT / 2, sideW + vT + centerW + vT / 2];
  for (const vx of vOffsets) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(vT, h, 0.15), materials.copper);
    v.position.x = vx;
    windowSash.add(v);
  }

  // 两道横向分隔
  const hOffsets = [sideW / 2, sideW + vT + centerW + vT + sideW / 2];
  for (const hx of hOffsets) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(sideW, hT, 0.15), materials.copper);
    hBar.position.set(hx, 0.3, 0);
    windowSash.add(hBar);
  }

  const glass = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, 0.02), materials.glass);
  glass.position.set(innerW / 2, 0, 0);
  windowSash.add(glass);

  // 朝向决定开启方向
  const openDir = Math.abs(rotY) < 0.1 ? (Math.PI / 2) * 0.9 : (-Math.PI / 2) * 0.9;
  const parts: InteractiveObject[] = [markInteractive(windowSash, 'window', openDir)];

  container.add(windowSash);
  container.position.set(x, y, z);
  container.rotation.y = rotY;

  return { container, parts };
}
