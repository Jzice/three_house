import * as THREE from 'three';
import type {
  BoxSpec,
  DoorSpec,
  FloorConfig,
  InteriorDoorSpec,
  InteractiveObject,
  MaterialMap,
  SlidingDoorSpec,
  WindowSpec,
} from '../types';
import { DOOR_H, H } from '../config/houseConfig';

/** 由 BoxSpec 生成一个长方体网格 */
export function createBox(spec: BoxSpec, materials: MaterialMap): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(spec.w, spec.h, spec.d),
    materials[spec.material],
  );
  mesh.position.set(spec.x, spec.y, spec.z);
  // 室内构件默认不投/不接收阴影（见需求“去掉室内影子”），
  // 仍可在 BoxSpec 显式 cast/receive:true 覆盖（如需要室外投影的构件）。
  mesh.castShadow = spec.cast ?? false;
  mesh.receiveShadow = spec.receive ?? false;
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
  floor?: FloorConfig,
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
  if (floor) {
    container.position.y = floor.baseY + (spec.y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts };
}

/** 两折玻璃推拉门：两扇玻璃各占一半洞口，点击后活动扇沿轨道滑至固定扇后方 */
export function createSlidingGlassDoor(
  spec: SlidingDoorSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, x, y, z } = spec;
  const h = DOOR_H;
  const halfW = w / 2;
  const frameT = 0.07;
  // 内外两轨的 z 向间距，保证两扇可重叠滑动
  const trackGap = 0.06;

  const buildLeaf = (): THREE.Group => {
    const leaf = new THREE.Group();
    const bars: Array<[number, number, number, number]> = [
      [halfW, frameT, 0, h / 2 - frameT / 2],
      [halfW, frameT, 0, -h / 2 + frameT / 2],
      [frameT, h, -halfW / 2 + frameT / 2, 0],
      [frameT, h, halfW / 2 - frameT / 2, 0],
    ];
    for (const [bw, bh, bx, by] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), materials.copper);
      bar.position.set(bx, by, 0);
      leaf.add(bar);
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(halfW - frameT * 2, h - frameT * 2, 0.03),
      materials.glass,
    );
    leaf.add(glass);
    return leaf;
  };

  const container = new THREE.Group();

  // 固定扇（外轨，右半）
  const fixed = buildLeaf();
  fixed.position.set(halfW / 2, h / 2, trackGap / 2);
  container.add(fixed);

  // 活动扇（内轨，左半；开启时滑到固定扇正后方，让出左半洞口）
  const sliding = buildLeaf();
  sliding.position.set(-halfW / 2, h / 2, -trackGap / 2);
  const slidingPart = markInteractive(sliding, 'door', 0);
  slidingPart.userData.slideX = { closed: -halfW / 2, open: halfW / 2 };
  container.add(sliding);

  container.position.set(x, y, z);
  if (floor) {
    container.position.y = floor.baseY + (y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts: [slidingPart] };
}

/** 可开启的窗：固定外框 + 一扇绕左侧立边旋转的窗扇 */
export function createInteractiveWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.06;

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
  // 细边框：中梃 0.05、横梃 0.06，中间玻璃宽 0.54，两侧扇等分剩余宽度
  const vT = 0.05;
  const hT = 0.06;
  const centerW = 0.54;
  const sideW = (innerW - 2 * vT - centerW) / 2;

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
  if (floor) {
    container.position.y = floor.baseY + (y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts };
}

/** 左右推拉窗：白色塑钢外框 + 中竖梃 + 两扇可推拉玻璃扇（左扇左滑、右扇右滑）。
 *  闭合时两扇于中梃处相接覆盖整窗，开启时各向外侧滑移半个窗宽，完全错开露出洞口。 */
export function createSlidingWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const halfW = w / 2;
  const frameT = 0.06;
  const leafW = halfW - frameT; // 每扇宽
  const leafH = h - 2 * frameT;
  const halfLeaf = leafW / 2;
  const travel = halfW; // 每扇滑移半个窗宽
  const pvc = materials.pvc;

  const container = new THREE.Group();

  // 外框四边（白色塑钢）
  const frameBars: Array<[number, number, number, number]> = [
    [w, frameT, 0, h / 2 - frameT / 2],
    [w, frameT, 0, -h / 2 + frameT / 2],
    [frameT, h, -halfW + frameT / 2, 0],
    [frameT, h, halfW - frameT / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.1), pvc);
    bar.position.set(bx, by, 0);
    container.add(bar);
  }
  // 中竖梃
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(frameT, h - 2 * frameT, 0.1), pvc);
  mullion.position.set(0, 0, 0);
  container.add(mullion);

  const buildLeaf = (): THREE.Group => {
    const leaf = new THREE.Group();
    const bars: Array<[number, number, number, number]> = [
      [leafW, frameT, 0, leafH / 2 - frameT / 2],
      [leafW, frameT, 0, -leafH / 2 + frameT / 2],
      [frameT, leafH, -leafW / 2 + frameT / 2, 0],
      [frameT, leafH, leafW / 2 - frameT / 2, 0],
    ];
    for (const [bw, bh, bx, by] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), pvc);
      bar.position.set(bx, by, 0);
      leaf.add(bar);
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(leafW - 2 * frameT, leafH - 2 * frameT, 0.03),
      materials.glass,
    );
    leaf.add(glass);
    return leaf;
  };

  // 左扇：闭合居中 -halfLeaf，开启向左滑 travel
  const leftLeaf = buildLeaf();
  leftLeaf.position.set(-halfLeaf, 0, 0);
  const leftPart = markInteractive(leftLeaf, 'window', 0);
  leftPart.userData.slideX = { closed: -halfLeaf, open: -halfLeaf - travel };
  container.add(leftLeaf);

  // 右扇：闭合居中 +halfLeaf，开启向右滑 travel
  const rightLeaf = buildLeaf();
  rightLeaf.position.set(halfLeaf, 0, 0);
  const rightPart = markInteractive(rightLeaf, 'window', 0);
  rightPart.userData.slideX = { closed: halfLeaf, open: halfLeaf + travel };
  container.add(rightLeaf);

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  if (floor) {
    container.position.y = floor.baseY + (y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts: [leftPart, rightPart] };
}

/** 单扇内门：绕一侧立边旋转开合，材质由 spec.materialKey 指定（wood / frostedGlass） */
export function createInteriorDoor(
  spec: InteriorDoorSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const w = spec.w;
  const h = spec.h ?? 2.1;
  const t = 0.06;

  // 铰链放在门洞一侧立边，门扇向房间内开启
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2, 0, 0);
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, t),
    materials[spec.materialKey],
  );
  leaf.position.set(w / 2, h / 2, 0);
  leaf.castShadow = false;
  leaf.receiveShadow = false;
  hinge.add(leaf);

  const defaultOpen = spec.openAngle ?? (Math.PI / 2) * 0.85;
  const parts: InteractiveObject[] = [markInteractive(hinge, 'door', defaultOpen)];
  // 房门默认打开：初始即处于开启角度，点击可关上
  parts[0].userData.isOpen = true;
  hinge.rotation.y = defaultOpen;

  const container = new THREE.Group();
  container.add(hinge);
  container.position.set(spec.x, spec.y, spec.z);
  container.rotation.y = spec.rotY;
  if (floor) {
    container.position.y = floor.baseY + (spec.y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts };
}
