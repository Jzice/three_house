import * as THREE from 'three';
import type { MaterialMap, FloorConfig } from '../types';
import {
  BACK_WALL_INNER,
  FLOORS,
  PLATFORM_FRONT_Z,
  RUN1_START_Z,
  STAIR,
  VOID_GUARD,
} from '../config/houseConfig';
import {
  createHandrailRun,
  createStraightRailTube,
  elbowTrim,
  type HandrailParams,
  type HandrailPost,
  type StraightRailOpts,
} from './handrail';

/**
 * 两段式楼梯（含休息平台与扶手），按楼层配置构建。
 * 第一段自 RUN1_START_Z 上行至休息平台，第二段自平台继续上行至本层顶。
 *
 * 构造方式（每跑为**实体梯段**）：
 * - 梯段实体 = 侧剖面「阶梯顶线 + 斜线底」的挤出体 → **梯底为连续斜面**（非阶梯状背面），
 *   实体本身（背面、侧面、踢面基层）用白色乳胶漆 `paint`；
 * - 每级踏步另贴**薄踏板**（顶面）与**立板**（迎面），面层为白色切割瓷砖 `stair`，
 *   面层厚度 `cladT`（实体阶梯顶线相应下移 cladT，砖缝沿梯段连续）。
 */

/** 缩放并偏移 BoxGeometry 指定面的 UV，使贴图按真实米数连续平铺 */
function faceUv(
  geo: THREE.BoxGeometry,
  face: number,
  scaleU: number,
  scaleV: number,
  offsetU = 0,
  offsetV = 0,
): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // BoxGeometry 面序 [+x,-x,+y,-y,+z,-z]，每面 4 个顶点
  for (let i = 0; i < 4; i++) {
    const k = face * 4 + i;
    uv.setXY(k, uv.getX(k) * scaleU + offsetU, uv.getY(k) * scaleV + offsetV);
  }
}

/**
 * 两段式楼梯（含休息平台与扶手），按楼层配置构建。
 * 第一段自 RUN1_START_Z 上行至休息平台，第二段自平台继续上行至本层顶。
 */
export function createStairs(materials: MaterialMap, floor: FloorConfig): THREE.Group {
  const group = new THREE.Group();
  if (!floor.stair) return group; // 无楼梯的楼层（如 3F）返回空组
  const wallH = floor.wallH;
  // 楼梯起算于**本层楼板完成面**（floor.baseY）：完成面即楼板顶面，
  // 楼梯总升高等于本层墙高，故顶步踏面与上层完成面精确齐平（无门槛、无缝）。
  const baseY = floor.baseY;
  const {
    platformH, platformDepth, run1Length, run2Length, steps1, steps2,
    stepThickness, stepWidth,
    run1X, run2X, platformX, platformZ, platformWidth,
    cladT, soffitDrop, tileSize,
  } = {
    ...STAIR,
    ...floor.stair,
  };

  const stepH1 = platformH / steps1;
  const stepD1 = run1Length / steps1;
  const stepH2 = (wallH - platformH) / steps2;
  const stepD2 = run2Length / steps2;
  const halfStepT = stepThickness / 2;
  // 第一段起步 Z：平台前沿 + 第一段水平长度，保证与平台衔接且随层变化
  const run1StartZ = PLATFORM_FRONT_Z + run1Length;
  const platformY = baseY + platformH;

  /** 六个面中仅指定面用瓷砖（其余为白色乳胶漆） */
  const tileMats = (tileFace: number): THREE.Material[] => {
    const mats: THREE.Material[] = Array(6).fill(materials.paint);
    mats[tileFace] = materials.stair;
    return mats;
  };

  /**
   * 生成一跑梯段：实体梯段（斜底）+ 各级踏板 / 立板。
   * dir = -1 向北（-z）上行，+1 向南（+z）上行。
   */
  const buildFlight = (o: {
    z0: number;
    dir: 1 | -1;
    y0: number;
    yTop: number;
    runLength: number;
    steps: number;
    stepH: number;
    stepD: number;
    x: number;
    width: number;
  }): void => {
    const { z0, dir, y0, yTop, runLength, steps, stepH, stepD, x, width } = o;

    // ---- 梯段实体：侧剖面 = 阶梯顶线（面层下缘）+ 斜线底（梯底连续斜面） ----
    // 斜底相对"鼻沿线"（各踏步鼻端的连线）竖向偏移 dv，保证全程不与踏步相交
    const cosT = runLength / Math.hypot(runLength, yTop - y0);
    const dv = (cladT + soffitDrop) / cosT;
    const shape = new THREE.Shape();
    shape.moveTo(z0, y0 - dv); // 斜底起点（起步端）
    shape.lineTo(z0, y0 + stepH - cladT); // 起步端面
    for (let i = 1; i <= steps; i++) {
      const zNext = z0 + dir * i * stepD;
      shape.lineTo(zNext, y0 + stepH * i - cladT); // 踏面基层
      if (i < steps) shape.lineTo(zNext, y0 + stepH * (i + 1) - cladT); // 踢面基层
    }
    shape.lineTo(z0 + dir * runLength, yTop - dv); // 顶端面落到底
    shape.closePath();

    const bodyGeo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
      curveSegments: 1,
    });
    const body = new THREE.Mesh(bodyGeo, materials.paint);
    // 形状建在 (z, y) 平面并沿 +z 挤出：绕 Y 轴 -90° 后局部 +x → 世界 +z、挤出方向 → 世界 +x
    body.rotation.y = -Math.PI / 2;
    body.position.x = x + width / 2;
    body.castShadow = false;
    body.receiveShadow = false;
    group.add(body);

    // ---- 各级踏板（顶面贴砖）与立板（迎面贴砖） ----
    let vAccum = 0; // 沿梯段累计的砖格相位，保证各级砖缝连续
    for (let i = 1; i <= steps; i++) {
      const zR = z0 + dir * (i - 1) * stepD; // 本级立面所在 z
      const yTread = y0 + stepH * i;

      // 踏板：水平薄板，顶面 = 白切割瓷砖
      const treadGeo = new THREE.BoxGeometry(width, cladT, stepD);
      faceUv(treadGeo, 2, width / tileSize, stepD / tileSize, 0, vAccum);
      const tread = new THREE.Mesh(treadGeo, tileMats(2));
      tread.position.set(x, yTread - cladT / 2, zR + dir * stepD / 2);
      tread.castShadow = false;
      tread.receiveShadow = false;
      group.add(tread);

      // 立板：竖直薄板，迎攀登方向的一面 = 白切割瓷砖
      const riserFace = dir === -1 ? 4 : 5; // 向北上行 → 迎面朝 +z；向南上行 → 迎面朝 -z
      const riserGeo = new THREE.BoxGeometry(width, stepH + cladT, cladT);
      faceUv(riserGeo, riserFace, width / tileSize, (stepH + cladT) / tileSize, 0, vAccum);
      const riser = new THREE.Mesh(riserGeo, tileMats(riserFace));
      riser.position.set(x, y0 + stepH * (i - 0.5) - cladT / 2, zR - dir * cladT / 2);
      riser.castShadow = false;
      riser.receiveShadow = false;
      group.add(riser);

      vAccum += stepD / tileSize;
    }
  };

  // ---- 第一段：起步 -> 休息平台（向北 / -z 上行） ----
  buildFlight({
    z0: run1StartZ,
    dir: -1,
    y0: baseY,
    yTop: platformY,
    runLength: run1Length,
    steps: steps1,
    stepH: stepH1,
    stepD: stepD1,
    x: run1X,
    width: stepWidth,
  });

  // ---- 休息平台：顶面贴白瓷砖，底面 / 侧面为白色乳胶漆 ----
  const platGeo = new THREE.BoxGeometry(platformWidth, stepThickness, platformDepth);
  faceUv(platGeo, 2, platformWidth / tileSize, platformDepth / tileSize);
  const platform = new THREE.Mesh(platGeo, tileMats(2));
  platform.position.set(platformX, platformY - halfStepT, platformZ);
  platform.castShadow = false;
  platform.receiveShadow = false;
  group.add(platform);

  // ---- 第二段：休息平台 -> 本层顶（向南 / +z 上行） ----
  buildFlight({
    z0: PLATFORM_FRONT_Z,
    dir: 1,
    y0: platformY,
    yTop: baseY + wallH,
    runLength: run2Length,
    steps: steps2,
    stepH: stepH2,
    stepD: stepD2,
    x: run2X,
    width: stepWidth,
  });

  return group;
}

/** 供 2D 平面图与标注使用的楼梯关键标高 */
export const STAIR_MARKERS = {
  backWallInner: BACK_WALL_INNER,
  platformFrontZ: PLATFORM_FRONT_Z,
  run1StartZ: RUN1_START_Z,
};

/**
 * 单层楼梯扶手（按楼层构建，挂到该层 root）。
 *
 * - 顶管：本层两跑（含休息平台横移）一条折线，每段为**严格笔直的直管**，转角为圆弧弯头；
 *   立柱截顶等坡斜切，从下方顶住扶手；横杆为 4 根等距**拉丝不锈钢**细管，严格平行扶手轴线。
 * - 3F 额外含楼梯洞口护栏（水平段 + 与 2F 第二跑顶端 D1 衔接的弯头）。
 * - 各层扶手是**独立对象**：末端圆柱自带端盖，天然在"扶手楼层交接处"封口（不裁切立柱），
 *   由第三人称的楼层可见性整体隐藏/显示，不再穿层。
 */
export function buildStairHandrail(materials: MaterialMap, floor: FloorConfig): THREE.Group {
  const group = new THREE.Group();
  group.name = `handrail-${floor.index}`;
  const rh = STAIR.railHeight;
  const pfz = PLATFORM_FRONT_Z;
  const params: HandrailParams = {
    postW: STAIR.postW,
    postD: STAIR.postD,
    baseW: STAIR.baseW,
    baseH: STAIR.baseH,
    handrailD: STAIR.handrailD,
    barCount: STAIR.barCount,
    barD: STAIR.barD,
    barInset: STAIR.barInset,
    knobD: STAIR.knobD,
    knobOut: STAIR.knobOut,
    elbowR: STAIR.elbowR,
  };

  // ---- 跨楼层交接点（扶手中心线，含栏杆高 rh）：把整楼连续折线在楼层处拆成共享弯头的显示组 ----
  // 1F 第二跑 c0->d0 与 2F 第一跑 a1 之间、2F 第二跑 c1->d1 与 3F 洞口护栏 gEast->d1 之间，
  // 用同一弯头圆弧接通；弯头归上层组，下层组末段按同一切点直截，两层同显时无缝、仅显下层时平整封口。
  const f1 = FLOORS[0];
  const f2 = FLOORS[1];
  const f3 = FLOORS[2];
  const tubeR = STAIR.handrailD / 2;
  const c0 = new THREE.Vector3(STAIR.run2RailX, f1.baseY + f1.stair!.platformH + rh, pfz);
  const d0 = new THREE.Vector3(STAIR.run2RailX, f1.baseY + f1.wallH + rh, pfz + f1.stair!.run2Length);
  const a1 = new THREE.Vector3(STAIR.run1RailX, f2.baseY + rh, pfz + f2.stair!.run1Length);
  const dirRun2ToD0 = new THREE.Vector3().subVectors(d0, c0).normalize();
  const lenRun2ToD0 = d0.distanceTo(c0);
  const dirJog = new THREE.Vector3().subVectors(a1, d0).normalize();
  const lenJog = a1.distanceTo(d0);
  const tJogD0 = elbowTrim(dirRun2ToD0, dirJog, lenRun2ToD0, lenJog, STAIR.elbowR, tubeR);
  const c1 = new THREE.Vector3(STAIR.run2RailX, f2.baseY + f2.stair!.platformH + rh, pfz);
  const d1 = new THREE.Vector3(STAIR.run2RailX, f2.baseY + f2.wallH + rh, pfz + f2.stair!.run2Length);
  // 护栏水平段立在 3F 完成面上（与 d1 = 2F 墙顶 = 3F 完成面同高），整段水平
  const gWest = new THREE.Vector3(VOID_GUARD.x0, f3.baseY + rh, VOID_GUARD.z);
  const gEast = new THREE.Vector3(VOID_GUARD.x1, f3.baseY + rh, VOID_GUARD.z);
  const dirRun2ToD1 = new THREE.Vector3().subVectors(d1, c1).normalize();
  const lenRun2ToD1 = d1.distanceTo(c1);
  // 3F 护栏在 d1 处弯头的虚拟后继方向：越过 d1 顺楼梯向下（= -dirRun2ToD1）。
  // 弯头占住 d1 两侧，楼梯侧切点在 d1 - dirRun2ToD1·t，与 2F 末段 lastTrim 封口点重合；
  // 若误传 +dirRun2ToD1，弧会扫过 d1 冲上空中成"回头钩"，与 2F 段脱开。
  const dirD1Down = dirRun2ToD1.clone().negate();
  // 弯头在 d1 处的出侧方向 = 护栏离开方向（d1→gEast）。2F 侧封口与 3F 弯头必须用同一夹角：
  // 若误传 gEast→d1（驶入方向），θ 变 98.7°（正确 81.3°），tGuard 多切 3.9cm，弯折处露出缺口。
  const dirGuard = new THREE.Vector3().subVectors(gEast, d1).normalize();
  const lenGuard = d1.distanceTo(gEast);
  // 2F 第二跑顶在 d1 处封口（弯头归 3F 护栏组），与 3F 护栏 d1 弯头算出同一切点
  const tGuard = elbowTrim(dirRun2ToD1, dirGuard, lenRun2ToD1, lenGuard, STAIR.elbowR, tubeR);

  // 一段直跑立柱：落在各踏面中部（平整踏面），首根上移到第 1 级（k 从 1 起），末根落在顶步；
  // 底部标高 = 该级踏面顶面（+微小抬升避免共面闪烁），柱顶由 createHandrailRun 按轴线反算
  const flightPosts = (
    x: number, z0: number, dir: 1 | -1, stepD: number, y0: number, stepH: number,
    n: number, steps: number,
  ): HandrailPost[] => {
    const out: HandrailPost[] = [];
    const EPS = 0.003;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 1 : i / (n - 1);
      const k = Math.min(steps, Math.max(1, Math.round(1 + (steps - 1) * frac)));
      out.push({
        x,
        z: z0 + dir * (k - 0.5) * stepD, // 踏面中部，立柱立于平整踏面上
        baseY: y0 + stepH * k + EPS,     // 该级踏面顶面标高
      });
    }
    return out;
  };

  // ---- 有楼梯的楼层：两跑 + 休息平台 ----
  if (floor.stair) {
    const fs = floor.stair;
    const baseY = floor.baseY;
    const platformY = baseY + fs.platformH;
    const run1StartZ = pfz + fs.run1Length;
    const stepH1 = fs.platformH / fs.steps1;
    const stepD1 = fs.run1Length / fs.steps1;
    const stepH2 = (floor.wallH - fs.platformH) / fs.steps2;
    const stepD2 = fs.run2Length / fs.steps2;

    const a = new THREE.Vector3(STAIR.run1RailX, baseY + rh, run1StartZ);
    const b = new THREE.Vector3(STAIR.run1RailX, platformY + rh, pfz);
    const c = new THREE.Vector3(STAIR.run2RailX, platformY + rh, pfz);
    const d = new THREE.Vector3(STAIR.run2RailX, baseY + floor.wallH + rh, pfz + fs.run2Length);

    const railPoints: THREE.Vector3[] = [a, b, c, d];
    const railOpts: StraightRailOpts = {
      points: railPoints,
      elbowR: STAIR.elbowR,
      tubeR: STAIR.handrailD / 2,
      material: materials.railing,
    };
    if (floor.index === 0) {
      railOpts.lastTrim = tJogD0; // 1F 第二跑顶在楼层交接处封口（弯头归 2F 组）
    } else if (floor.index === 1) {
      railPoints.unshift(d0); // 复用 1F 第二跑顶作 2F 起点，含 0.16m 梯口横移
      railOpts.firstDir = dirRun2ToD0; // 共享 D0 弯头（首点虚拟前驱 = 1F 第二跑方向）
      railOpts.firstLen = lenRun2ToD0;
      railOpts.lastTrim = tGuard; // 2F 第二跑顶在洞口护栏交接处封口（弯头归 3F 组）
    }
    group.add(createStraightRailTube(railOpts));

    const n1 = floor.index === 0 ? 7 : 4; // 1F run1=7，其余直跑=4
    group.add(
      createHandrailRun({
        start: a,
        end: b,
        posts: flightPosts(STAIR.run1RailX, run1StartZ, -1, stepD1, baseY, stepH1, n1, fs.steps1),
        railHeight: rh,
        materials,
        params,
      }),
    );
    group.add(
      createHandrailRun({
        start: c,
        end: d,
        posts: flightPosts(STAIR.run2RailX, pfz, 1, stepD2, platformY, stepH2, 4, fs.steps2),
        railHeight: rh,
        materials,
        params,
      }),
    );
  }

  // ---- 3F 楼梯洞口护栏：水平段向西，东端用圆弧弯头接到 2F 第二跑顶端 D1 ----
  if (floor.index === 2) {
    const vg = VOID_GUARD;

    group.add(
      createStraightRailTube({
        points: [gWest, gEast, d1],
        elbowR: STAIR.elbowR,
        tubeR: STAIR.handrailD / 2,
        material: materials.railing,
        lastDir: dirD1Down, // 东端弯头顺楼梯向下回弯，与 2F 末段封口点严丝合缝（弯头归 3F 组）
        lastLen: lenRun2ToD1,
      }),
    );

    group.add(
      createHandrailRun({
        start: gWest,
        end: gEast,
        // 立柱内收（与管端 -4.35 / -3.5 脱开、各外伸约 10~15cm，管端贴墙/贴梯口转角）：
        // 西柱 -4.2（柱心距墙内皮 0.18m、底座西缘距墙 0.13m），东柱 -3.6，间距 0.6m，分布不再稀疏也不贴墙。
        posts: [
          { x: -4.2, z: vg.z, baseY: floor.baseY },
          { x: -3.6, z: vg.z, baseY: floor.baseY },
        ],
        railHeight: rh,
        materials,
        params,
      }),
    );
  }

  return group;
}
