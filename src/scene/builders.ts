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
import { DOOR_INNER_H, FRONT_DOOR_H, T_EXT, T_INT } from '../config/houseConfig';
import {
  createCasementHandle,
  createLeverHandleSet,
  createSlidingLatch,
  createSlidingLatchStrike,
  createVerticalPullHandle,
} from './hardware';

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
  // 门扇 / 固定窄梃的单件让缝：相邻两件合成一条 4mm 竖缝（真实双开门中缝 3~5mm）
  const leafGap = 0.004;

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
    const lw = swingW - leafGap;
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
    addBox(container, sideW - leafGap, leafH, doorT, px, leafH / 2, 0, materials.doorDark);
    const inset = 0.08;
    const bw = sideW - 2 * inset - leafGap;
    const bh = leafH - 2 * inset;
    addBox(container, bw, tT, doorT * 0.4, px, inset + tT / 2, frontZ, materials.bronze);
    addBox(container, bw, tT, doorT * 0.4, px, leafH - inset - tT / 2, frontZ, materials.bronze);
    addBox(container, tT, bh, doorT * 0.4, px - bw / 2 + tT / 2, leafH / 2, frontZ, materials.bronze);
    addBox(container, tT, bh, doorT * 0.4, px + bw / 2 - tT / 2, leafH / 2, frontZ, materials.bronze);
  }

  // ---- 中间双开活动门 ----
  const buildSwingLeaf = (centerOffsetX: number): THREE.Group => {
    const g = new THREE.Group();
    const lw = swingW - leafGap;
    addBox(g, lw, leafH, doorT, centerOffsetX, leafH / 2, 0, materials.doorDark);
    addLeafTrim(g, centerOffsetX);
    // 内外双面竖向长拉手：装在门扇自由边（中缝侧，距边 0.08m），中心离地 1.05m；
    // 相对铰链的力臂接近整扇宽度，开门省力；与铰链侧的智能锁面板水平错开，互不遮挡
    const handleX = Math.sign(centerOffsetX) * (swingW - 0.08);
    for (const side of [-1, 1]) {
      g.add(createVerticalPullHandle(materials.bronze, {
        x: handleX, y: 1.05, leafT: doorT, side, length: 0.45,
        accent: materials.doorDark,
      }));
    }
    // 智能锁面板：两扇各半、随门扇旋转（避免悬空）；当前位于铰链侧（距铰链约 0.05m），
    // 与自由侧拉手水平错开、互不遮挡
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
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

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

  // 竖向长拉手：贴中梃侧、内外两面各一根（圆管 + 上下连接座），中心离地 1.10m。
  // 扇局部 y 以扇中心为 0，故换算成相对扇中心的偏移。
  const handleY = 1.10 - h / 2;
  const addHandles = (leaf: THREE.Group, stileX: number) => {
    for (const side of [-1, 1]) {
      leaf.add(createVerticalPullHandle(materials.stainlessBrushed, {
        x: stileX, y: handleY, leafT: 0.05, side, length: 0.36,
        accent: materials.blackAluminum,
      }));
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
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

  return { container, parts: [rightPart, leftPart] };
}

/**
 * 窗框/窗扇型材：单一薄型材（约 7cm 深）靠外墙（局部 +z = 室外法线方向）齐平，
 * 室内侧留深窗台/窗套（reveal）。只呈现一圈框，无重影。
 * 窗框与玻璃覆盖整个洞口，窗洞其余墙厚为实心墙 reveal，不透光。
 *
 * 材质（v0.5.35 起）：`createInteractiveWindow` / `createLowerSashWindow` /
 * `createTwoRowSashWindow` 的框料（外框、竖/横梃、窗扇细边）统一用 `metalDoor`
 * （与 1F 北墙后门同款中灰哑光漆金属），平开执手用 `stainlessBrushed`
 * （与后门把手同源）；玻璃仍为 `glass`，3F 正面推拉窗另用白色塑钢 `pvc`。
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
    addFrameBar(container, bw, bh, bx, by, materials.metalDoor);
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
  // 自由侧扇框：与竖梃同款、随窗扇转动。执手必须落在这根框料上，不能压在玻璃上。
  const edgeT = vT;
  const panelW = innerW - edgeT;
  const rightSideW = sideW - edgeT;

  // 两道竖向分隔
  const vOffsets = [sideW + vT / 2, sideW + vT + centerW + vT / 2];
  for (const vx of vOffsets) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(vT, h, SASH_D), materials.metalDoor);
    v.position.x = vx;
    windowSash.add(v);
  }
  // 自由侧扇框（贴在玻璃右缘，铰链仍在左缘）
  const freeEdge = new THREE.Mesh(new THREE.BoxGeometry(edgeT, h, SASH_D), materials.metalDoor);
  freeEdge.position.x = innerW - edgeT / 2;
  windowSash.add(freeEdge);

  // 两道横向分隔：右列横梃收到自由侧扇框内缘，避免与扇框共面闪烁
  const hBars: Array<[number, number]> = [
    [sideW / 2, sideW],
    [sideW + vT + centerW + vT + rightSideW / 2, rightSideW],
  ];
  for (const [hx, bw] of hBars) {
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(bw, hT, SASH_D), materials.metalDoor);
    hBar.position.set(hx, 0.3, 0);
    windowSash.add(hBar);
  }

  const glass = new THREE.Mesh(new THREE.BoxGeometry(panelW, innerH, 0.02), materials.glass);
  glass.position.set(panelW / 2, 0, 0);
  windowSash.add(glass);

  // 平开窗 7 字执手：装在自由侧扇框中心、只朝室内侧（-z），拨杆悬在玻璃前方
  windowSash.add(createCasementHandle(materials.stainlessBrushed, {
    x: innerW - edgeT / 2, y: 0, leafT: SASH_D, leverDir: -1,
  }));

  // 朝向决定开启方向
  const openDir = Math.abs(rotY) < 0.1 ? (Math.PI / 2) * 0.9 : (-Math.PI / 2) * 0.9;
  const parts: InteractiveObject[] = [markInteractive(windowSash, 'window', openDir)];

  container.add(windowSash);
  container.position.set(x, y, z);
  container.rotation.y = rotY;
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

  return { container, parts };
}

/**
 * 大窗（1.8×1.8）：仅左右两列的下格可开，其余为固定玻璃；两枚小平开窗扇各自绕外缘竖边向室外开。
 * 固定件：外框、两根通高竖梃、两道横梃（左右侧列各一）、上部两侧玻璃、中列整块玻璃——固定不动。
 * 可开启件：左下格 / 右下格各一枚小平开窗扇（玻璃 + 自身一圈细金属边），扇体自铰链向格内延伸，
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
  const sashT = 0.025; // 小窗扇自身细金属边宽
  const sashD = SASH_D; // 小窗扇自身细金属边厚（薄型材，居中嵌于洞口，开合时仍嵌在洞口内）
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
    addFrameBar(frame, bw, bh, bx, by, materials.metalDoor);
  }
  // 两根通高竖梃（左右侧列与中列的分隔；开窗后仍在原位，网格不断）
  for (const mx of [xL + sideW + vT / 2, xR - sideW - vT / 2]) {
    addFrameBar(frame, vT, innerH, mx, 0, materials.metalDoor);
  }
  // 左右侧列各一道横梃（将侧列分为上下两格；中列为整块，不分隔）
  for (const hx of [xL + sideW / 2, xR - sideW / 2]) {
    addFrameBar(frame, sideW, hT, hx, barY, materials.metalDoor);
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
      const b = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, sashD), materials.metalDoor);
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
    // 下格小平开窗执手：底板落在自由侧细金属边中心（宽 0.025m），拨杆朝格内悬在玻璃前方
    sash.add(createCasementHandle(materials.stainlessBrushed, {
      x: dir * (pw - sashT / 2), y: 0, leafT: sashD,
      leverDir: -dir, scale: 0.85,
    }));
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
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

  return { container, parts };
}

/**
 * 楼梯间后墙窗（1.1m 宽）：上下 2 行、上行固定亮窗；下行按 1:1 等分左右两格，
 * 左半为一枚可平开扇、右半为固定玻璃，替代原「3 列」大窗。
 * - 固定件：外框四边 + 一根通长中横梃（分出上/下两行）+ 上行整块固定玻璃 + 下行右格固定玻璃；
 * - 可开启件：下行左格一枚平开窗（玻璃 + 自身一圈细金属边），铰链在窗口左外缘、向室外开，
 *   点击按 0°→45°→60°→90° 循环，与 createLowerSashWindow 的多级开合档位一致。
 * 下行 1:1 分界处有一根固定竖中框（与中横梃同款、挂在 frame 上），开扇打开后仍留在原位；
 * 右格不再单独造细金属边（曾因 frame 组与 FRAME_Z 错层产生"浮空窗页"），
 * 其四边由外框右立边 / 中横梃 / 外框下边 / 分界竖中框围合。
 */
export function createTwoRowSashWindow(
  spec: WindowSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const { w, h, x, y, z, rotY } = spec;
  const frameT = 0.04;   // 外框料宽
  const hT = 0.04;       // 中横梃高
  const sashT = 0.025;   // 下行窗扇自身细金属边宽
  const sashD = SASH_D;  // 下行窗扇自身细金属边厚
  const deg = (d: number): number => THREE.MathUtils.degToRad(d);

  const innerW = w - frameT * 2;
  const innerH = h - frameT * 2;
  const xL = -w / 2 + frameT;  // 内框左沿
  const xR = w / 2 - frameT;   // 内框右沿
  const yT = h / 2 - frameT;   // 内框上沿
  const yB = -h / 2 + frameT;  // 内框下沿
  // 下行（可开）占 57%、上行（固定）占 43%
  const barY = yB + innerH * 0.57;
  const barTop = barY + hT / 2;
  const barBot = barY - hT / 2;

  const container = new THREE.Group();
  const frame = new THREE.Group(); // 固定框（点击不响应、不参与开合）
  container.add(frame);

  // 外框四边：向外扩 OV 压住墙口，盖住墙/框接缝（内口尺寸不变）
  const OV = 0.015;
  const frameBars: Array<[number, number, number, number]> = [
    [w + OV * 2, frameT + OV, 0, h / 2 + (OV - frameT) / 2],
    [w + OV * 2, frameT + OV, 0, -h / 2 + (frameT - OV) / 2],
    [frameT + OV, h + OV * 2, -w / 2 + (frameT - OV) / 2, 0],
    [frameT + OV, h + OV * 2, w / 2 + (OV - frameT) / 2, 0],
  ];
  for (const [bw, bh, bx, by] of frameBars) {
    addFrameBar(frame, bw, bh, bx, by, materials.metalDoor);
  }
  // 中横梃：通长，把洞口分成上下两行（开窗后仍在原位，网格不断）
  addFrameBar(frame, innerW, hT, 0, barY, materials.metalDoor);

  // 上行固定玻璃
  const upperGlass = new THREE.Mesh(
    new THREE.BoxGeometry(innerW - 0.012, yT - barTop - 0.012, 0.02),
    materials.glass,
  );
  upperGlass.position.set(0, (yT + barTop) / 2, FRAME_Z);
  frame.add(upperGlass);

  // 下行 1:1 等分：左半平开窗（铰链在窗口左外缘、向室外 +z 摆出）、右半固定玻璃
  const ph = barBot - yB;
  const boundary = xL + (xR - xL) * 0.50; // 1:1 分界竖线（局部 x，落在窗中心），开扇占左半
  const addEdge = (
    grp: THREE.Group, ew: number, eh: number, ex: number, ey: number,
  ): void => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(ew, eh, sashD), materials.metalDoor);
    b.position.set(ex, ey, 0);
    grp.add(b);
  };
  const lc = yB + ph / 2; // 下行中心 y（局部）

  // —— 1:1 分界处固定竖中框（与中横梃同款：frameT 宽 / FRAME_FD 深）——
  // 挂在 frame 上、位于 FRAME_Z 平面，不随开扇转动：开扇打开后仍在原位、网格不断。
  // 左右两块玻璃各让出半个框宽，避免闭合时开扇自由侧边与中框共面闪烁。
  const mullionHalf = frameT / 2;
  addFrameBar(frame, frameT, ph, boundary, lc, materials.metalDoor);

  // —— 右半固定玻璃（非交互）——
  // 固定格不再单独造细金属边：那些边条曾落在局部 z=0，而玻璃/外框/中横梃在 FRAME_Z 平面，
  // 错层约 0.10m 会在斜视时形成一片"浮空窗页"。玻璃四边由外框右立边 / 中横梃 /
  // 外框下边 / 分界竖中框围合。
  const fixedX0 = boundary + mullionHalf;
  const fixedW = xR - fixedX0;
  const fixedGlass = new THREE.Mesh(
    new THREE.BoxGeometry(fixedW, ph, 0.02),
    materials.glass,
  );
  fixedGlass.position.set(fixedX0 + fixedW / 2, lc, FRAME_Z);
  frame.add(fixedGlass);

  // —— 左半平开窗（铰链在窗口左外缘 xL，扇体向右延伸，向室外 +z 摆出）——
  const pw = boundary - mullionHalf - xL;
  const sash = new THREE.Group();
  sash.position.set(xL, lc, FRAME_Z); // 铰链位于窗口左外缘
  addEdge(sash, sashT, ph, sashT / 2, 0);                       // 铰接侧边（左外缘）
  addEdge(sash, sashT, ph, pw - sashT / 2, 0);                  // 自由侧边
  addEdge(sash, pw - sashT * 2, sashT, pw / 2, ph / 2 - sashT / 2);  // 上沿
  addEdge(sash, pw - sashT * 2, sashT, pw / 2, -ph / 2 + sashT / 2); // 下沿
  const sashGlass = new THREE.Mesh(
    new THREE.BoxGeometry(pw - sashT * 2, ph - sashT * 2, 0.02),
    materials.glass,
  );
  sashGlass.position.set(pw / 2, 0, 0);
  sash.add(sashGlass);
  // 下行平开扇执手：底板落在自由侧细金属边中心（宽 0.025m）、室内侧；扇格较小故缩至 0.75
  sash.add(createCasementHandle(materials.stainlessBrushed, {
    x: pw - sashT / 2, y: 0, leafT: sashD,
    leverDir: -1, scale: 0.75,
  }));

  const part = markInteractive(sash, 'window', 0);
  part.userData.openAngles = [0, deg(45), deg(60), deg(90)];
  part.userData.openStep = 0;
  // 铰链在窗口左外缘：负角使扇体绕外缘向局部 +z（室外）摆出，与 3 列窗左下格一致
  part.userData.hingeSign = -1;
  container.add(sash);

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

  return { container, parts: [part] };
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
  // 月牙锁锁体：内轨扇右缘（自由边）室内侧，拨扣朝交接处伸出
  leftLeaf.add(createSlidingLatch(pvc, {
    x: leafW / 2 - 0.022, y: 0, leafT: 0.05,
    accent: materials.stainlessBrushed, leverDir: 1,
  }));
  const leftPart = markInteractive(leftLeaf, 'window', 0);
  leftPart.userData.slideX = { closed: -halfLeaf, open: halfLeaf };
  container.add(leftLeaf);

  // 右扇（外轨）：闭合居中 +halfLeaf，开启左滑到左扇位置（-halfLeaf），让出右半洞口
  const rightLeaf = buildLeaf();
  rightLeaf.position.set(halfLeaf, 0, trackOuterZ);
  // 月牙锁扣座：外轨扇左缘（自由边）室内侧，与内轨扇锁体配对
  rightLeaf.add(createSlidingLatchStrike(pvc, {
    x: -leafW / 2 + 0.022, y: 0, leafT: 0.05,
    accent: materials.stainlessBrushed, leverDir: -1,
  }));
  const rightPart = markInteractive(rightLeaf, 'window', 0);
  rightPart.userData.slideX = { closed: halfLeaf, open: -halfLeaf };
  container.add(rightLeaf);

  container.position.set(x, y, z);
  container.rotation.y = rotY;
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

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

/**
 * 卫生间门扇：哑光灰漆金属边框（bathDoorMetal，与 1F 后门同色）+ 上 48% 磨砂玻璃 / 下 52% 实心金属板。
 * - 四边框（上/下/铰链侧/自由侧）、4.8:5.2 分界细横边、下半 52% 金属板统一为 bathDoorMetal（细喷砂颗粒）；
 * - 上半 48% 保持 frostedGlass 磨砂玻璃；
 * - 分界按内框净空 y∈[ft, h-ft]（=2.02m）划分：上 48% / 下 52%，分界中心 y=1.0904m；
 *   细横边宽 0.02m（为四边框 0.04m 的一半）、厚同边框 fd，正反两面压住上下两板接缝；
 *   两板各让出半个横边后，玻璃实际高 0.9596m、下板实际高 1.0404m。
 * - **自由侧竖框加宽为 0.10m「锁边料」**：双面执手（含锁芯 / 指示旋钮）装在这根通高
 *   金属框料上，与玻璃 / 下板分区无关，始终不压玻璃；玻璃与下板因此相应缩窄并整体偏移。
 *   hingeSide 为铰链侧（1 / -1），自由侧方向取反。
 */
function createFramedGlassLeaf(
  w: number, h: number, t: number, materials: MaterialMap, hingeSide: 1 | -1,
): THREE.Group {
  const g = new THREE.Group();
  const ft = 0.04; // 铰链侧 / 上下边框宽
  const lockW = 0.10; // 自由侧加宽锁边料（承托双面执手）
  const freeDir = -hingeSide; // leaf 局部 x 指向自由边的方向
  const fd = t + 0.01; // 边框略厚于内嵌板，正反两面都压住板边
  const frameMat = materials.bathDoorMetal; // 与后门同色的哑光灰漆金属 + 细喷砂颗粒：四边框 / 分界横边 / 下半板
  const glassMat = materials.frostedGlass; // 上半磨砂玻璃

  // 四边框：上下通宽居中；铰链侧 ft 宽、自由侧 lockW 宽，分别贴在各自门边
  const bars: Array<[number, number, number, number]> = [
    [w, ft, 0, h - ft / 2],
    [w, ft, 0, ft / 2],
    [ft, h - 2 * ft, -freeDir * (w / 2 - ft / 2), h / 2],
    [lockW, h - 2 * ft, freeDir * (w / 2 - lockW / 2), h / 2],
  ];
  for (const [bw, bh, bx, by] of bars) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, fd), frameMat);
    bar.position.set(bx, by, 0);
    bar.castShadow = false;
    bar.receiveShadow = false;
    g.add(bar);
  }

  // 4.8:5.2 分界（按内框净空）：上 48% 磨砂玻璃、下 52% 哑光灰漆金属板
  const panelW = w - ft - lockW; // 内嵌板净宽，夹在铰链侧框与自由侧锁边料之间
  const panelCx = (freeDir * (ft - lockW)) / 2; // 非对称边框导致内嵌板中心偏移
  const innerH = h - 2 * ft; // 内嵌板净高
  const ySplit = ft + innerH * 0.52; // 分界中心 y（下段占 52%）
  const railT = 0.02; // 分界细横边宽（四边框的一半）

  // 下半 52%：实心哑光灰漆金属板（略薄，嵌在边框内），上缘让出半个细横边
  const lowerH = ySplit - railT / 2 - ft;
  const lower = new THREE.Mesh(new THREE.BoxGeometry(panelW, lowerH, t), frameMat);
  lower.position.set(panelCx, ft + lowerH / 2, 0);
  lower.castShadow = false;
  lower.receiveShadow = false;
  g.add(lower);

  // 上半 48%：磨砂玻璃，下缘让出半个细横边
  const upperBot = ySplit + railT / 2;
  const upperH = h - ft - upperBot;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(panelW, upperH, t), glassMat);
  glass.position.set(panelCx, upperBot + upperH / 2, 0);
  glass.castShadow = false;
  glass.receiveShadow = false;
  g.add(glass);

  // 分界细横边：与边框同厚 fd，正反两面压住上下两板接缝
  const rail = new THREE.Mesh(new THREE.BoxGeometry(panelW, railT, fd), frameMat);
  rail.position.set(panelCx, ySplit, 0);
  rail.castShadow = false;
  rail.receiveShadow = false;
  g.add(rail);

  return g;
}

/** 单扇内门：绕一侧立边旋转开合，材质由 spec.materialKey 指定（wood / frostedGlass） */
export function createInteriorDoor(
  spec: InteriorDoorSpec,
  materials: MaterialMap,
  floor?: FloorConfig,
): InteractiveBuildResult {
  const w = spec.w;
  const h = spec.h ?? DOOR_INNER_H;
  const t = 0.045; // 门扇厚度（真实住宅内门约 4~4.5cm）
  const isBath = spec.materialKey === 'frostedGlass';

  // 铰链放在门洞一侧立边（hingeSide：-1 负 x 侧 / +1 正 x 侧），门扇朝房间内开启
  const side = spec.hingeSide ?? -1;
  const hingeX = side * (w / 2);
  const defaultOpen = spec.openAngle ?? (Math.PI / 2) * 0.85;
  // 开门侧（局部 ±z）：门扇朝哪侧开，合页轴就落在哪侧墙皮；
  // 门扇关闭时与该面墙皮齐平（不再嵌在墙厚正中），开门 90° 后平贴墙面。
  const openSign = Math.sign(side * defaultOpen) || side;
  const outerHalf = isBath ? (t + 0.01) / 2 : t / 2; // 门扇（含卫生间门框）外皮半厚
  const hingeZ = openSign * (T_INT / 2); // 合页轴移到开门侧墙皮
  const leafZ = -openSign * outerHalf;   // 门扇相对合页内收半个门厚 → 关门时外皮贴墙皮

  const hinge = new THREE.Group();
  hinge.position.set(hingeX, 0, hingeZ);

  let leaf: THREE.Object3D;
  if (spec.materialKey === 'frostedGlass') {
    // 卫生间门：哑光灰漆金属边框（与后门同色）+ 上 48% 磨砂玻璃 / 下 52% 金属板（门套由 frameMaterial 指定）
    leaf = createFramedGlassLeaf(w, h, t, materials, side);
  } else {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), materials[spec.materialKey]);
    panel.position.set(0, h / 2, 0);
    panel.castShadow = false;
    panel.receiveShadow = false;
    leaf = panel;
  }
  leaf.position.x += -hingeX; // 门扇中心落在洞口中心（洞口从铰链向另一侧延展）
  leaf.position.z = leafZ;    // 门扇沿墙厚偏移到开门侧，关门时与那面墙皮齐平
  hinge.add(leaf);

  // 双面 L 形执手：中心离地 1.05m，拨杆朝门扇内伸。
  // 卫生间门自由侧是 0.10m 加宽锁边料，底座装在其中心（距边 0.05m），始终落在金属框料上；
  // 实心门板维持距边 0.07m。卫生间门另加指示旋钮，灰色金属门带长条锁面板。
  const handleInset = isBath ? 0.05 : 0.07;
  hinge.add(createLeverHandleSet(materials.stainlessBrushed, {
    x: -side * (w - handleInset), y: 1.05, leafT: t,
    leverDir: side,
    lockPlate: spec.materialKey === 'metalDoor',
    indicator: isBath,
    accent: isBath ? materials.bathDoorMetal : undefined,
    scale: w < 0.8 ? 0.9 : 1,
  }));

  const parts: InteractiveObject[] = [markInteractive(hinge, 'door', defaultOpen)];
  // 房门默认打开：初始即处于开启角度，点击可关上
  parts[0].userData.isOpen = true;
  // 门标识：供第一人称门禁判定（关门时该门洞不可穿出）
  if (spec.id) parts[0].userData.id = spec.id;
  hinge.rotation.y = defaultOpen;

  const container = new THREE.Group();
  container.add(hinge);
  // 房间门门套：默认木色，可由 frameMaterial 指定（如 3F 正面门统一灰色金属）
  container.add(createDoorCasing(w, h, T_INT, materials[spec.frameMaterial ?? 'wood']));
  container.position.set(spec.x, spec.y, spec.z);
  container.rotation.y = spec.rotY;
  // 竖向尺寸均为绝对米数：只把局部原点平移到本层完成面，不再按层高缩放
  if (floor) container.position.y = floor.baseY + spec.y;

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

  // 外门双面执手 + 长条锁面板：自由侧距边 7cm、中心离地 1.05m
  hinge.add(createLeverHandleSet(materials.stainlessBrushed, {
    x: -side * (w - 0.07), y: 1.05, leafT: t,
    leverDir: side, lockPlate: true,
  }));

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
