import * as THREE from 'three';
import type {
  BoxSpec,
  DoorSpec,
  FloorConfig,
  HoledWallSpec,
  InteriorDoorSpec,
  InteractiveObject,
  MaterialMap,
  SlidingDoorSpec,
  WindowSpec,
} from '../types';
import { FRONT_DOOR_H, H, T_EXT, T_INT } from '../config/houseConfig';

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

/**
 * 整片带洞墙：外形（矩形）用 THREE.Shape，洞口用 THREE.Path 挖掉，再沿 z 挤出墙厚。
 * 整面墙只有一个网格 → 没有内部接缝：多段墙盒拼接的"对接缝"会漏出亚像素裂缝、
 * "搭接"又会共面 z-fighting，两者在斜视时都表现为窗边/门边的竖向"缝隙"。
 */
export function createHoledWall(
  spec: HoledWallSpec,
  baseY: number,
  materials: MaterialMap,
): THREE.Mesh {
  const hw = spec.w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  shape.lineTo(hw, spec.h);
  shape.lineTo(-hw, spec.h);
  shape.closePath();

  for (const hole of spec.holes) {
    const x0 = hole.cx - hole.w / 2;
    const x1 = hole.cx + hole.w / 2;
    const y0 = hole.y0;
    const y1 = hole.y0 + hole.h;
    const path = new THREE.Path();
    // 洞口与外形反向绕行
    path.moveTo(x0, y0);
    path.lineTo(x0, y1);
    path.lineTo(x1, y1);
    path.lineTo(x1, y0);
    path.closePath();
    shape.holes.push(path);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: spec.d,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, baseY, spec.z - spec.d / 2);

  const mesh = new THREE.Mesh(geo, materials.wall);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
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
    new THREE.BoxGeometry(leafW, FRONT_DOOR_H, doorT),
    materials.copper,
  );
  leftDoorMesh.position.set(leafW / 2, FRONT_DOOR_H / 2, 0);
  leftDoorGrp.add(leftDoorMesh);

  const rightDoorGrp = new THREE.Group();
  rightDoorGrp.position.set(halfW, 0, 0);
  const rightDoorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(leafW, FRONT_DOOR_H, doorT),
    materials.copper,
  );
  rightDoorMesh.position.set(-leafW / 2, FRONT_DOOR_H / 2, 0);
  rightDoorGrp.add(rightDoorMesh);

  const parts: InteractiveObject[] = [
    markInteractive(leftDoorGrp, 'door', (Math.PI / 2) * 0.9),
    markInteractive(rightDoorGrp, 'door', (-Math.PI / 2) * 0.9),
  ];
  // 入户门标识：供第一人称通行判定（门关闭时该门洞不可穿出）
  for (const p of parts) p.userData.id = 'main';

  const container = new THREE.Group();
  container.add(leftDoorGrp, rightDoorGrp);
  // 前门门套：铜色（洞口内口包边 + 外沿套线）
  container.add(createDoorCasing(doorW, FRONT_DOOR_H, T_EXT, materials.copper));
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
  const h = FRONT_DOOR_H; // 2F 前门（通阳台推拉门）随前门一并加高
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
  // 2F 前门（阳台推拉门）门套：铜色
  container.add(createDoorCasing(w, h, T_EXT, materials.copper));
  if (floor) {
    container.position.y = floor.baseY + (y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts: [slidingPart] };
}

/**
 * 窗框料深：比墙厚（T_EXT）多 4mm，框的内外两面各比墙面凸出 2mm。
 * - 框填满整个墙厚 → 窗侧不出现凹槽（凹槽从室内看是一条黑缝、斜看是一条暗线）；
 * - 框面凸出 2mm → 压住墙/框接缝；与墙体错开 2mm 也避免共面 z-fighting。
 */
const FRAME_D = T_EXT + 0.004;

/** 可开启的窗：固定外框 + 一扇绕左侧立边旋转的窗扇 */
export function createInteractiveWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.06;

  const container = new THREE.Group();

  // 外框四边：向外扩 OV 压住墙口，盖住墙/框接缝（内口尺寸不变，玻璃与竖梃不受影响）
  const OV = 0.015;
  const frameBars: Array<[number, number, number, number]> = [
    [w + OV * 2, frameT + OV, 0, h / 2 + (OV - frameT) / 2],
    [w + OV * 2, frameT + OV, 0, -h / 2 + (frameT - OV) / 2],
    [frameT + OV, h + OV * 2, -w / 2 + (frameT - OV) / 2, 0],
    [frameT + OV, h + OV * 2, w / 2 + (OV - frameT) / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, FRAME_D), materials.copper);
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
    const v = new THREE.Mesh(new THREE.BoxGeometry(vT, h, FRAME_D), materials.copper);
    v.position.x = vx;
    windowSash.add(v);
  }

  // 两道横向分隔
  const hOffsets = [sideW / 2, sideW + vT + centerW + vT + sideW / 2];
  for (const hx of hOffsets) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(sideW, hT, FRAME_D), materials.copper);
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

/**
 * 大窗（1.8×1.8）：左右下方两枚小窗扇对开（向室外各开 45°），窗框框梁全部固定。
 * 固定件：外框、两根通高竖梃、两道横梃（左右侧列各一）、上部两侧玻璃、中列整块玻璃——开窗后网格完整。
 * 可开启件：左下格 / 右下格各一枚小平开窗扇（玻璃 + 自身一圈细铜边），内嵌在格位内、枢轴在格位外侧竖边，
 * 只带走自己的玻璃与细边，不牵动窗框的框梁。
 * 整扇窗挂一个主控组，点击窗上任意构件即同时开合两扇。
 */
export function createLowerSashWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.06; // 外框料宽
  const vT = 0.05; // 竖梃宽
  const hT = 0.06; // 横梃高
  const centerW = 0.54; // 中列宽
  const sashT = 0.035; // 小窗扇自身细铜边宽
  const sashD = 0.12; // 小窗扇自身细铜边厚（居墙厚中部，开合时仍嵌在洞口内）
  const OPEN_ANGLE = Math.PI / 4; // 小窗扇外开 45°

  const container = new THREE.Group();
  // 主控组：只承载开合状态（自身 rotation 恒为 0），使点击窗上任意构件都能命中
  const toggle = new THREE.Group();
  container.add(toggle);

  const innerW = w - frameT * 2;
  const innerH = h - frameT * 2;
  const sideW = (innerW - 2 * vT - centerW) / 2; // 左右侧列宽
  const xL = -w / 2 + frameT; // 内框左沿
  const xR = w / 2 - frameT; // 内框右沿
  const yT = h / 2 - frameT; // 内框上沿
  const yB = -h / 2 + frameT; // 内框下沿
  const barY = 0.3; // 横梃中心（沿用原实现）
  const barTop = barY + hT / 2;
  const barBot = barY - hT / 2;
  const upMidY = (barTop + yT) / 2; // 上格中心
  const upH = yT - barTop; // 上格高
  const lowMidY = (yB + barBot) / 2; // 下格（小窗格）中心
  const lowH = barBot - yB; // 下格高

  // ---- 固定件 ----
  // 外框四边：向外扩 OV 压住墙口，盖住墙/框接缝（内口尺寸不变，玻璃与竖梃不受影响）
  const OV = 0.015;
  const frameBars: Array<[number, number, number, number]> = [
    [w + OV * 2, frameT + OV, 0, h / 2 + (OV - frameT) / 2],
    [w + OV * 2, frameT + OV, 0, -h / 2 + (frameT - OV) / 2],
    [frameT + OV, h + OV * 2, -w / 2 + (frameT - OV) / 2, 0],
    [frameT + OV, h + OV * 2, w / 2 + (OV - frameT) / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, FRAME_D), materials.copper);
    bar.position.set(bx, by, 0);
    toggle.add(bar);
  }
  // ---- 固定件：两根通高竖梃（开窗后仍在原位，网格不断） ----
  for (const mx of [xL + sideW + vT / 2, xR - sideW - vT / 2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(vT, innerH, FRAME_D), materials.copper);
    m.position.set(mx, 0, 0);
    toggle.add(m);
  }
  // ---- 固定件：左右侧列各一道横梃（开窗后仍在原位） ----
  for (const hx of [xL + sideW / 2, xR - sideW / 2]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(sideW, hT, FRAME_D), materials.copper);
    r.position.set(hx, barY, 0);
    toggle.add(r);
  }
  // 固定玻璃：上部两侧 + 中列整块
  const addGlass = (gw: number, gh: number, gx: number, gy: number): void => {
    const g = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.02), materials.glass);
    g.position.set(gx, gy, 0);
    toggle.add(g);
  };
  addGlass(sideW, upH, xL + sideW / 2, upMidY);
  addGlass(sideW, upH, xR - sideW / 2, upMidY);
  addGlass(centerW, innerH, 0, 0);

  // ---- 可开启件：左右下格小平开窗扇（玻璃 + 自身细铜边；dir=1 左格 / -1 右格） ----
  const buildSash = (pivotX: number, dir: 1 | -1): THREE.Group => {
    const sash = new THREE.Group();
    sash.position.set(pivotX, 0, 0);
    const edge = (ew: number, eh: number, ex: number, ey: number): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, sashD), materials.copper);
      b.position.set(ex, ey, 0);
      sash.add(b);
    };
    // 自身细铜边：铰接侧 / 自由侧 / 上沿 / 下沿
    edge(sashT, lowH, (dir * sashT) / 2, lowMidY);
    edge(sashT, lowH, dir * (sideW - sashT / 2), lowMidY);
    edge(sideW - sashT * 2, sashT, (dir * sideW) / 2, barBot - sashT / 2);
    edge(sideW - sashT * 2, sashT, (dir * sideW) / 2, yB + sashT / 2);
    // 玻璃：只带自己的玻璃，不牵动窗框的框梁
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(sideW - sashT * 2, lowH - sashT * 2, 0.02),
      materials.glass,
    );
    glass.position.set((dir * sideW) / 2, lowMidY, 0);
    sash.add(glass);
    return sash;
  };
  const leftSash = buildSash(xL, 1);
  const rightSash = buildSash(xR, -1);
  toggle.add(leftSash, rightSash);

  // 主控：两扇随开合状态一起转（绕各自外侧竖边，向室外张开）
  const togglePart = markInteractive(toggle, 'window', 0);
  togglePart.userData.sashes = [
    { object: leftSash, openAngle: -OPEN_ANGLE },
    { object: rightSash, openAngle: OPEN_ANGLE },
  ];

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  if (floor) {
    container.position.y = floor.baseY + (y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts: [togglePart] };
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

  // 外框四边（白色塑钢）：向外扩 OV 压住墙口，盖住墙/框接缝
  const OV = 0.015;
  const frameBars: Array<[number, number, number, number]> = [
    [w + OV * 2, frameT + OV, 0, h / 2 + (OV - frameT) / 2],
    [w + OV * 2, frameT + OV, 0, -h / 2 + (frameT - OV) / 2],
    [frameT + OV, h + OV * 2, -halfW + (frameT - OV) / 2, 0],
    [frameT + OV, h + OV * 2, halfW + (OV - frameT) / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, FRAME_D), pvc);
    bar.position.set(bx, by, 0);
    container.add(bar);
  }
  // 中竖梃
  const mullion = new THREE.Mesh(new THREE.BoxGeometry(frameT, h - 2 * frameT, FRAME_D), pvc);
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
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.12), pvc);
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

/**
 * 门套：洞口内口包边（沿墙厚收住墙体切口）+ 外沿套线（洞口外沿、两侧墙面各凸出一圈）。
 * 局部坐标：x 为洞口宽方向（洞口居中）、y 自洞口底起、z 为墙厚方向（墙心在 z=0）。
 * 内口包边微内收 2mm 盖住墙体切口，既遮住毛边又不与门扇边缘打架。
 */
export function createDoorCasing(
  openW: number,
  openH: number,
  wallT: number,
  mat: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  const lineT = 0.02; // 内口包边板厚
  const casingW = 0.08; // 外沿套线宽
  const protrude = 0.015; // 套线每侧凸出墙面的高度
  const EPS = 0.002; // 内口包边微内收量（避免与墙体切口共面）

  // ---- 内口包边：两侧竖边 + 上沿 ----
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(lineT, openH, wallT), mat);
    p.position.set(sx * (openW / 2 - EPS + lineT / 2), openH / 2, 0);
    group.add(p);
  }
  const headLine = new THREE.Mesh(new THREE.BoxGeometry(openW, lineT, wallT), mat);
  headLine.position.set(0, openH - EPS + lineT / 2, 0);
  group.add(headLine);

  // ---- 外沿套线：U 形断面沿墙厚挤出（贯通墙厚，并在两侧墙面各凸出 protrude） ----
  const s = new THREE.Shape();
  const ow = openW / 2 + casingW;
  const oh = openH + casingW;
  const iw = openW / 2;
  s.moveTo(-ow, 0);
  s.lineTo(-ow, oh);
  s.lineTo(ow, oh);
  s.lineTo(ow, 0);
  s.lineTo(iw, 0);
  s.lineTo(iw, openH);
  s.lineTo(-iw, openH);
  s.lineTo(-iw, 0);
  s.closePath();
  const depth = wallT + protrude * 2;
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  group.add(new THREE.Mesh(geo, mat));

  for (const child of group.children) {
    const m = child as THREE.Mesh;
    m.castShadow = false;
    m.receiveShadow = false;
  }
  return group;
}

/** 磨砂玻璃门扇：白色塑钢边框（pvc）包裹磨砂玻璃面板 */
function createFramedGlassLeaf(w: number, h: number, t: number, materials: MaterialMap): THREE.Group {
  const g = new THREE.Group();
  const ft = 0.04; // 边框宽
  const fd = t + 0.01; // 边框略厚于玻璃，正反两面都压住玻璃边
  const frameMat = materials.pvc;
  const glassMat = materials.frostedGlass;

  // 四边框（上、下、左、右）；竖梃夹在上、下沿之间，避免角部重叠打架
  const bars: Array<[number, number, number, number]> = [
    [w, ft, 0, h - ft / 2],
    [w, ft, 0, ft / 2],
    [ft, h - 2 * ft, -w / 2 + ft / 2, h / 2],
    [ft, h - 2 * ft, w / 2 - ft / 2, h / 2],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, fd), frameMat);
    bar.position.set(bx, by, 0);
    bar.castShadow = false;
    bar.receiveShadow = false;
    g.add(bar);
  }
  // 磨砂玻璃面板（略薄，嵌在边框内）
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * ft, h - 2 * ft, t), glassMat);
  glass.position.set(0, h / 2, 0);
  glass.castShadow = false;
  glass.receiveShadow = false;
  g.add(glass);
  return g;
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

  // 铰链放在门洞一侧立边（hingeSide：-1 负 x 侧 / +1 正 x 侧），门扇朝房间内开启
  const side = spec.hingeSide ?? -1;
  const hingeX = side * (w / 2);
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, 0, 0);

  let leaf: THREE.Object3D;
  if (spec.materialKey === 'frostedGlass') {
    // 磨砂玻璃门：白色边框 + 磨砂玻璃
    leaf = createFramedGlassLeaf(w, h, t, materials);
  } else {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), materials[spec.materialKey]);
    panel.position.set(0, h / 2, 0);
    panel.castShadow = false;
    panel.receiveShadow = false;
    leaf = panel;
  }
  leaf.position.x += -hingeX; // 门扇中心落在洞口中心（洞口从铰链向另一侧延展）
  hinge.add(leaf);

  const defaultOpen = spec.openAngle ?? (Math.PI / 2) * 0.85;
  const parts: InteractiveObject[] = [markInteractive(hinge, 'door', defaultOpen)];
  // 房门默认打开：初始即处于开启角度，点击可关上
  parts[0].userData.isOpen = true;
  hinge.rotation.y = defaultOpen;

  const container = new THREE.Group();
  container.add(hinge);
  // 房间门门套：木色（洞口内口包边 + 外沿套线）
  container.add(createDoorCasing(w, h, T_INT, materials.wood));
  container.position.set(spec.x, spec.y, spec.z);
  container.rotation.y = spec.rotY;
  if (floor) {
    container.position.y = floor.baseY + (spec.y / H) * floor.wallH;
    container.scale.y = floor.wallH / H;
  }

  return { container, parts };
}

/**
 * 室外单扇平开门（如 1F 北墙后门）：金属面板 + 四周门框包边，灰色哑光漆（`metalDoor`）。
 * - 铰链在门洞一侧立边：hingeSide +1 = 东侧 / -1 = 西侧；
 * - 开门角 openAngle：负角 = 朝室外（本地 -z）开，正角 = 朝室内（+z）开（与内门约定一致）；
 * - 洞口套线（门框包边）用同款金属。
 * 容器局部坐标：x 为门宽方向（洞口居中）、y 自洞口底起、z 为墙厚方向（墙心在 z=0）。
 */
export function createExteriorSwingDoor(
  w: number,
  h: number,
  hingeSide: 1 | -1,
  openAngle: number,
  materials: MaterialMap,
  id?: string,
): InteractiveBuildResult {
  const t = 0.05;
  const side = hingeSide;
  const hingeX = side * (w / 2);
  const hinge = new THREE.Group();
  hinge.position.set(hingeX, 0, 0);

  const leaf = new THREE.Group();
  // 金属门扇面板
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), materials.metalDoor);
  panel.position.set(0, h / 2, 0);
  panel.castShadow = false;
  panel.receiveShadow = false;
  leaf.add(panel);

  // 门扇四周门框包边（薄金属条，略厚于面板，正反两面压住边）
  const ft = 0.05;
  const fd = t + 0.02;
  const bars: Array<[number, number, number, number]> = [
    [w, ft, 0, h - ft / 2],
    [w, ft, 0, ft / 2],
    [ft, h - 2 * ft, -w / 2 + ft / 2, h / 2],
    [ft, h - 2 * ft, w / 2 - ft / 2, h / 2],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, fd), materials.metalDoor);
    bar.position.set(bx, by, 0);
    bar.castShadow = false;
    bar.receiveShadow = false;
    leaf.add(bar);
  }

  leaf.position.x += -hingeX; // 门扇中心落洞口中心（自铰链向另一侧延展）
  hinge.add(leaf);

  const parts: InteractiveObject[] = [markInteractive(hinge, 'door', openAngle)];
  // 默认开启，展示朝外开的朝向（点击可关上）
  parts[0].userData.isOpen = true;
  // 门标识：供第一人称通行判定（门关闭时该门洞不可穿出）
  if (id) parts[0].userData.id = id;
  hinge.rotation.y = openAngle;

  const container = new THREE.Group();
  container.add(hinge);
  // 洞口门框包边（套线）
  container.add(createDoorCasing(w, h, T_EXT, materials.metalDoor));
  return { container, parts };
}
