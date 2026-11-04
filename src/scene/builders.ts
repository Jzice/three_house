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

/**
 * 一层入户双开大门（深灰仿铜中式门）：
 * 在 2.4×2.6 洞口内自下而上布局——门扇区（0→2.05m）+ 门上格棂亮窗（2.05→2.6m），
 * 横向分为左/右固定窄梃（各 0.25m）+ 中间双开活动门（各 0.95m 宽）。
 * 仅做外观翻新：中间两扇开合角度、点击判定、FPS 通行 id='main' 全部保持既有行为不变。
 */
export function createInteractiveMainDoor(
  spec: DoorSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const doorW = 2.4;
  const halfW = doorW / 2;
  const totalH = FRONT_DOOR_H;
  const doorT = 0.05; // 门扇厚度（真实住宅入户门约 4.5~5cm）
  const leafH = 2.05; // 门扇高（亮窗置于其上）
  const transomH = totalH - leafH; // 亮窗高 0.55
  const sideW = 0.25; // 固定窄梃宽
  const midW = doorW - 2 * sideW; // 中间双开总宽 1.9
  const swingW = midW / 2; // 单扇活动门宽 0.95
  const frontZ = doorT / 2; // 门扇正面（朝室外 +z）

  const container = new THREE.Group();

  // 通用：在组里加一个长方体（不投影、不接收阴影）
  const addBox = (
    group: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ): void => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
  };

  // ---- 门扇正面描线边框（内缩 inset）+ 中部竖条 + 四角简化回纹角饰 ----
  const addLeafTrim = (g: THREE.Object3D, cx: number): void => {
    const lw = swingW - 0.012;
    const inset = 0.12;
    const tT = 0.04;
    const bw = lw - 2 * inset;
    const bh = leafH - 2 * inset;
    // 四周描线
    addBox(g, bw, tT, doorT * 0.4, cx, inset + tT / 2, frontZ, materials.bronze);
    addBox(g, bw, tT, doorT * 0.4, cx, leafH - inset - tT / 2, frontZ, materials.bronze);
    addBox(g, tT, bh, doorT * 0.4, cx - bw / 2 + tT / 2, leafH / 2, frontZ, materials.bronze);
    addBox(g, tT, bh, doorT * 0.4, cx + bw / 2 - tT / 2, leafH / 2, frontZ, materials.bronze);
    // 中部竖向装饰条（双开中缝两侧的整高竖线）
    addBox(g, tT, bh, doorT * 0.4, cx, leafH / 2, frontZ, materials.bronze);
    // 四角简化回纹角饰：每角一横一竖小条
    const cs = 0.16;
    const horX = bw / 2 - cs - tT / 2;
    const corners: Array<[number, number, number, number]> = [
      [cx - horX, inset + cs / 2, 1, 1],
      [cx + horX, inset + cs / 2, -1, 1],
      [cx - horX, leafH - inset - cs / 2, 1, -1],
      [cx + horX, leafH - inset - cs / 2, -1, -1],
    ];
    for (const [mx, my, sx, sy] of corners) {
      addBox(g, cs, tT, doorT * 0.4, mx, my, frontZ, materials.bronze);
      addBox(
        g,
        tT,
        cs,
        doorT * 0.4,
        mx + (sx * (cs / 2 - tT / 2)),
        my + (sy * (cs / 2 - tT / 2)),
        frontZ,
        materials.bronze,
      );
    }
  };

  // ---- 门上格棂亮窗（固定）----
  const transom = new THREE.Group();
  const transomY0 = leafH;
  const tT = 0.04;
  // 玻璃（陷在门扇厚度中部）
  addBox(transom, doorW - 2 * tT, transomH - 2 * tT, 0.04, 0, transomY0 + transomH / 2, 0, materials.glass);
  // 亮窗外框
  addBox(transom, doorW, tT, doorT, 0, transomY0 + tT / 2, frontZ, materials.bronze);
  addBox(transom, doorW, tT, doorT, 0, transomY0 + transomH - tT / 2, frontZ, materials.bronze);
  addBox(transom, tT, transomH, doorT, -halfW + tT / 2, transomY0 + transomH / 2, frontZ, materials.bronze);
  addBox(transom, tT, transomH, doorT, halfW - tT / 2, transomY0 + transomH / 2, frontZ, materials.bronze);
  // 格棂：竖向 3 道 + 横向 2 道
  for (let i = 1; i <= 3; i++) {
    const x = -halfW + (doorW * i) / 4;
    addBox(transom, tT * 0.7, transomH - 2 * tT, doorT * 0.9, x, transomY0 + transomH / 2, frontZ, materials.bronze);
  }
  for (let i = 1; i <= 2; i++) {
    const y = transomY0 + (transomH * i) / 3;
    addBox(transom, doorW - 2 * tT, tT * 0.7, doorT * 0.9, 0, y, frontZ, materials.bronze);
  }
  container.add(transom);

  // ---- 两侧固定窄梃（非交互）----
  for (const s of [-1, 1]) {
    const px = s * (halfW - sideW / 2);
    addBox(container, sideW - 0.012, leafH, doorT, px, leafH / 2, 0, materials.doorDark);
    const inset = 0.08;
    const bw = sideW - 2 * inset - 0.012;
    const bh = leafH - 2 * inset;
    addBox(container, bw, tT, doorT * 0.4, px, inset + tT / 2, frontZ, materials.bronze);
    addBox(container, bw, tT, doorT * 0.4, px, leafH - inset - tT / 2, frontZ, materials.bronze);
    addBox(container, tT, bh, doorT * 0.4, px - bw / 2 + tT / 2, leafH / 2, frontZ, materials.bronze);
    addBox(container, tT, bh, doorT * 0.4, px + bw / 2 - tT / 2, leafH / 2, frontZ, materials.bronze);
  }

  // ---- 中间双开活动门 ----
  const buildSwingLeaf = (centerOffsetX: number): THREE.Group => {
    const g = new THREE.Group();
    const lw = swingW - 0.012;
    addBox(g, lw, leafH, doorT, centerOffsetX, leafH / 2, 0, materials.doorDark);
    addLeafTrim(g, centerOffsetX);
    // 内侧拉手（朝室内 -z）：金色长条，靠近中缝
    const handleX = centerOffsetX - Math.sign(centerOffsetX) * 0.18;
    addBox(g, 0.04, 0.5, 0.06, handleX, leafH * 0.45, -doorT / 2, materials.bronze);
    // 智能锁面板：从中缝拆半，分别装在左右门扇靠中缝一侧，开门时随门扇旋转（避免悬空）
    const innerEdgeX = centerOffsetX - Math.sign(centerOffsetX) * (lw / 2);
    const lockX = innerEdgeX + Math.sign(centerOffsetX) * 0.045;
    addBox(g, 0.09, 0.32, 0.05, lockX, 1.05, frontZ, materials.bronze);
    return g;
  };

  const leftHinge = new THREE.Group();
  leftHinge.position.set(-swingW, 0, 0);
  leftHinge.add(buildSwingLeaf(swingW / 2));
  const rightHinge = new THREE.Group();
  rightHinge.position.set(swingW, 0, 0);
  rightHinge.add(buildSwingLeaf(-swingW / 2));

  const parts: InteractiveObject[] = [
    markInteractive(leftHinge, 'door', (Math.PI / 2) * 0.9),
    markInteractive(rightHinge, 'door', (-Math.PI / 2) * 0.9),
  ];
  // 入户门标识：供第一人称通行判定（门关闭时该门洞不可穿出）
  for (const p of parts) p.userData.id = 'main';

  container.add(leftHinge, rightHinge);
  // 前门门套：深灰仿铜（洞口内口包边 + 外沿套线）
  container.add(createDoorCasing(doorW, totalH, T_EXT, materials.doorDark));
  container.position.set(spec.x, spec.y, spec.z);
  if (floor) {
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (spec.y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
  }

  return { container, parts };
}

/** 两折玻璃推拉门：两扇玻璃各占一半洞口，左右两扇均可点击沿轨道独立滑动（开启时滑至对侧洞口背后） */
export function createSlidingGlassDoor(
  spec: SlidingDoorSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, x, y, z } = spec;
  const h = FRONT_DOOR_H; // 2F 前门（通阳台推拉门）随前门一并加高
  const halfW = w / 2;
  const frameT = 0.04;
  // 内外两轨的 z 向间距，保证两扇可重叠滑动
  const trackGap = 0.06;

  // 竖向金属执手：贴中梃侧、内外两面各一根（细长盒体）
  const handleGeo = new THREE.BoxGeometry(0.02, 0.4, 0.02);
  const addHandles = (leaf: THREE.Group, stileX: number) => {
    for (const hz of [-0.05, 0.05]) {
      const handle = new THREE.Mesh(handleGeo, materials.blackAluminum);
      handle.position.set(stileX, 0, hz);
      leaf.add(handle);
    }
  };

  const buildLeaf = (stileX: number): THREE.Group => {
    const leaf = new THREE.Group();
    const bars: Array<[number, number, number, number]> = [
      [halfW, frameT, 0, h / 2 - frameT / 2],
      [halfW, frameT, 0, -h / 2 + frameT / 2],
      [frameT, h, -halfW / 2 + frameT / 2, 0],
      [frameT, h, halfW / 2 - frameT / 2, 0],
    ];
    for (const [bw, bh, bx, by] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), materials.blackAluminum);
      bar.position.set(bx, by, 0);
      leaf.add(bar);
    }
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(halfW - frameT * 2, h - frameT * 2, 0.03),
      materials.glass,
    );
    leaf.add(glass);
    addHandles(leaf, stileX);
    return leaf;
  };

  const container = new THREE.Group();

  // 右扇（外轨 z=+trackGap/2，初始居右半洞口；中梃在左缘 x=-halfW/2）
  // 开启时整体左滑至左半洞口背后，让出右半洞口；与左扇各自独立可滑。
  const rightLeaf = buildLeaf(-halfW / 2 + frameT / 2);
  rightLeaf.position.set(halfW / 2, h / 2, trackGap / 2);
  const rightPart = markInteractive(rightLeaf, 'door', 0);
  rightPart.userData.slideX = { closed: halfW / 2, open: -halfW / 2 };
  container.add(rightLeaf);

  // 左扇（内轨 z=-trackGap/2，初始居左半洞口；中梃在右缘 x=+halfW/2）
  // 开启时整体右滑至右半洞口背后，让出左半洞口。
  const leftLeaf = buildLeaf(halfW / 2 - frameT / 2);
  leftLeaf.position.set(-halfW / 2, h / 2, -trackGap / 2);
  const leftPart = markInteractive(leftLeaf, 'door', 0);
  leftPart.userData.slideX = { closed: -halfW / 2, open: halfW / 2 };
  container.add(leftLeaf);

  container.position.set(x, y, z);
  // 2F 前门（阳台推拉门）门套：黑色铝合金
  container.add(createDoorCasing(w, h, T_EXT, materials.blackAluminum));
  // 门标识：供第一人称门禁判定（关门时该门洞不可穿出）
  rightPart.userData.id = 'sliding';
  leftPart.userData.id = 'sliding';
  if (floor) {
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
  }

  return { container, parts: [rightPart, leftPart] };
}

/**
 * 窗框/窗扇型材：单一薄型材（约 7cm 深）靠外墙（局部 +z = 室外法线方向）齐平，
 * 室内侧留深窗台/窗套（reveal）。只呈现一圈框，无重影。
 * 窗框与玻璃覆盖整个洞口，窗洞其余墙厚为实心墙 reveal，不透光。
 */
const FRAME_FD = 0.07;                              // 窗框薄型材深度（真实断桥铝约 60~70 系列）
const SASH_D = 0.06;                                // 可开启窗扇薄型材深度
const FRAME_Z = T_EXT / 2 + 0.015 - FRAME_FD / 2;    // 框/扇局部深度：贴外墙、外表面比墙外凸 2mm

/** 一根窗框料（外框/竖梃/横梃）：单一薄型材，位于外墙侧 FRAME_Z 平面。 */
function addFrameBar(
  group: THREE.Object3D,
  bw: number,
  bh: number,
  bx: number,
  by: number,
  mat: THREE.Material,
): void {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, FRAME_FD), mat);
  bar.position.set(bx, by, FRAME_Z);
  group.add(bar);
}

/** 可开启的窗：固定外框 + 一扇绕左侧立边旋转的窗扇 */
export function createInteractiveWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.04;

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
    addFrameBar(container, bw, bh, bx, by, materials.copper);
  }

  // 窗扇
  const windowSash = new THREE.Group();
  windowSash.position.set(-w / 2 + frameT, 0, FRAME_Z);

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
    const v = new THREE.Mesh(new THREE.BoxGeometry(vT, h, SASH_D), materials.copper);
    v.position.x = vx;
    windowSash.add(v);
  }

  // 两道横向分隔
  const hOffsets = [sideW / 2, sideW + vT + centerW + vT + sideW / 2];
  for (const hx of hOffsets) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(sideW, hT, SASH_D), materials.copper);
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
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
  }

  return { container, parts };
}

/**
 * 大窗（1.8×1.8）：仅左右两列的下格可开，其余为固定玻璃；两枚小平开窗扇各自绕外缘竖边向室外开。
 * 固定件：外框、两根通高竖梃、两道横梃（左右侧列各一）、上部两侧玻璃、中列整块玻璃——固定不动。
 * 可开启件：左下格 / 右下格各一枚小平开窗扇（玻璃 + 自身一圈细铜边），扇体自铰链向格内延伸，
 * 枢轴分别在左列左缘 / 右列右缘（即各自外缘）；沿局部 +z（室外法线）朝室外开，不牵动窗框框梁。
 */
export function createLowerSashWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.04; // 外框料宽
  const vT = 0.035; // 竖梃宽
  const hT = 0.04; // 横梃高
  const centerW = 0.54; // 中列宽
  const sashT = 0.025; // 小窗扇自身细铜边宽
  const sashD = SASH_D; // 小窗扇自身细铜边厚（薄型材，居中嵌于洞口，开合时仍嵌在洞口内）
  const deg = (d: number): number => THREE.MathUtils.degToRad(d);

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

  const container = new THREE.Group();
  const frame = new THREE.Group(); // 固定框（不参与开合，点击不响应）
  container.add(frame);

  // 外框四边：向外扩 OV 压住墙口，盖住墙/框接缝（内口尺寸不变，玻璃与竖梃不受影响）
  const OV = 0.015;
  const frameBars: Array<[number, number, number, number]> = [
    [w + OV * 2, frameT + OV, 0, h / 2 + (OV - frameT) / 2],
    [w + OV * 2, frameT + OV, 0, -h / 2 + (frameT - OV) / 2],
    [frameT + OV, h + OV * 2, -w / 2 + (frameT - OV) / 2, 0],
    [frameT + OV, h + OV * 2, w / 2 + (OV - frameT) / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    addFrameBar(frame, bw, bh, bx, by, materials.copper);
  }
  // 两根通高竖梃（左右侧列与中列的分隔；开窗后仍在原位，网格不断）
  for (const mx of [xL + sideW + vT / 2, xR - sideW - vT / 2]) {
    addFrameBar(frame, vT, innerH, mx, 0, materials.copper);
  }
  // 左右侧列各一道横梃（将侧列分为上下两格；中列为整块，不分隔）
  for (const hx of [xL + sideW / 2, xR - sideW / 2]) {
    addFrameBar(frame, sideW, hT, hx, barY, materials.copper);
  }

  // 固定玻璃（上左 / 中列整块 / 上右）：不参与开合，仅作采光
  const addFixedGlass = (
    cellLeft: number, cellRight: number, cellTop: number, cellBot: number,
  ): void => {
    const gw = cellRight - cellLeft - 0.012;
    const gh = cellTop - cellBot - 0.012;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, 0.02), materials.glass);
    glass.position.set((cellLeft + cellRight) / 2, (cellTop + cellBot) / 2, FRAME_Z);
    frame.add(glass);
  };
  addFixedGlass(xL, xL + sideW, yT, barTop); // 左上
  addFixedGlass(xL + sideW + vT, xR - sideW - vT, yT, yB); // 中列整块
  addFixedGlass(xR - sideW, xR, yT, barTop); // 右上

  // 可开启窗扇：仅左右两列的下格；铰链位于各自外缘（左扇左缘 / 右扇右缘），只朝室外开。
  // hingeOnLeft=true → 枢轴在格左缘、扇体向格内(+x)延伸；false → 枢轴在格右缘、扇体向格内(-x)延伸。
  const buildSash = (
    cellLeft: number, cellRight: number, cellTop: number, cellBot: number, hingeOnLeft: boolean,
  ): InteractiveObject => {
    const pw = cellRight - cellLeft;
    const ph = cellTop - cellBot;
    const dir = hingeOnLeft ? 1 : -1; // 扇体自铰链向格内延伸的方向
    const pivotX = hingeOnLeft ? cellLeft : cellRight;
    const sash = new THREE.Group();
    sash.position.set(pivotX, (cellTop + cellBot) / 2, FRAME_Z);
    const edge = (ew: number, eh: number, ex: number, ey: number): void => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, sashD), materials.copper);
      b.position.set(ex, ey, 0);
      sash.add(b);
    };
    edge(sashT, ph, (dir * sashT) / 2, 0); // 铰接侧边
    edge(sashT, ph, dir * (pw - sashT / 2), 0); // 自由侧边
    edge(pw - sashT * 2, sashT, (dir * pw) / 2, ph / 2 - sashT / 2); // 上沿
    edge(pw - sashT * 2, sashT, (dir * pw) / 2, -ph / 2 + sashT / 2); // 下沿
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(pw - sashT * 2, ph - sashT * 2, 0.02),
      materials.glass,
    );
    glass.position.set((dir * pw) / 2, 0, 0);
    sash.add(glass);
    const part = markInteractive(sash, 'window', 0);
    part.userData.openAngles = [0, deg(45), deg(60), deg(90)];
    part.userData.openStep = 0;
    // 左铰扇取负角、右铰扇取正角 → 两者均绕外缘向室外(+z)开
    part.userData.hingeSign = hingeOnLeft ? -1 : 1;
    container.add(sash);
    return part;
  };

  const parts: InteractiveObject[] = [];
  parts.push(buildSash(xL, xL + sideW, barBot, yB, true)); // 左下格（铰链在外缘左）
  parts.push(buildSash(xR - sideW, xR, barBot, yB, false)); // 右下格（铰链在外缘右）

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  if (floor) {
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
  }

  return { container, parts };
}

/** 左右推拉窗：白色塑钢外框 + 中竖梃 + 两扇可推拉玻璃扇（内外双轨、交错推拉）。
 *  闭合时两扇于中梃处相接覆盖整窗；开启时左扇右滑、右扇左滑至对侧半洞，
 *  两扇前后叠放、始终留在窗框内，露出半个洞口（与 2F 阳台推拉门一致）。 */
export function createSlidingWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const halfW = w / 2;
  const frameT = 0.04;
  const leafW = halfW - frameT; // 每扇宽
  const leafH = h - 2 * frameT;
  const halfLeaf = leafW / 2;
  // 内外双轨：两扇 z 向错开一个扇框深度（0.05m），交错重叠时框料不互穿、不共面闪烁
  const TRACK_GAP = 0.05;
  // 外轨略低于窗框外表面（避开与中竖梃共面），内轨再向室内退一个轨道间距
  const trackOuterZ = FRAME_Z - 0.01;
  const trackInnerZ = trackOuterZ - TRACK_GAP;
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
    addFrameBar(container, bw, bh, bx, by, pvc);
  }
  // 中竖梃
  addFrameBar(container, frameT, h - 2 * frameT, 0, 0, pvc);

  const buildLeaf = (): THREE.Group => {
    const leaf = new THREE.Group();
    const bars: Array<[number, number, number, number]> = [
      [leafW, frameT, 0, leafH / 2 - frameT / 2],
      [leafW, frameT, 0, -leafH / 2 + frameT / 2],
      [frameT, leafH, -leafW / 2 + frameT / 2, 0],
      [frameT, leafH, leafW / 2 - frameT / 2, 0],
    ];
    for (const [bw, bh, bx, by] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.05), pvc);
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

  // 左扇（内轨）：闭合居中 -halfLeaf，开启右滑到右扇背后（+halfLeaf），让出左半洞口
  const leftLeaf = buildLeaf();
  leftLeaf.position.set(-halfLeaf, 0, trackInnerZ);
  const leftPart = markInteractive(leftLeaf, 'window', 0);
  leftPart.userData.slideX = { closed: -halfLeaf, open: halfLeaf };
  container.add(leftLeaf);

  // 右扇（外轨）：闭合居中 +halfLeaf，开启左滑到左扇位置（-halfLeaf），让出右半洞口
  const rightLeaf = buildLeaf();
  rightLeaf.position.set(halfLeaf, 0, trackOuterZ);
  const rightPart = markInteractive(rightLeaf, 'window', 0);
  rightPart.userData.slideX = { closed: halfLeaf, open: -halfLeaf };
  container.add(rightLeaf);

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  if (floor) {
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
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
  const t = 0.045; // 门扇厚度（真实住宅内门约 4~4.5cm）

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
  // 门标识：供第一人称门禁判定（关门时该门洞不可穿出）
  if (spec.id) parts[0].userData.id = spec.id;
  hinge.rotation.y = defaultOpen;

  const container = new THREE.Group();
  container.add(hinge);
  // 房间门门套：木色（洞口内口包边 + 外沿套线）
  container.add(createDoorCasing(w, h, T_INT, materials.wood));
  container.position.set(spec.x, spec.y, spec.z);
  container.rotation.y = spec.rotY;
  if (floor) {
    container.position.y = spec.absolute ? floor.baseY + spec.y : floor.baseY + (spec.y / H) * floor.wallH;
    container.scale.y = spec.absolute ? 1 : floor.wallH / H;
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
  const t = 0.045; // 门扇厚度（真实住宅外开门约 4.5cm）
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
  const ft = 0.045;
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
