import * as THREE from 'three';
import type { BoxSpec, MaterialMap, FloorConfig } from '../types';
import {
  BACK_WALL_INNER,
  PLATFORM_FRONT_Z,
  RUN1_START_Z,
  STAIR,
} from '../config/houseConfig';
import { createBox } from './builders';

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
    railHeight, railThickness, postThickness, stepThickness, stepWidth,
    run1X, run1RailX, run2X, run2RailX, platformX, platformZ, platformWidth,
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

  const add = (spec: BoxSpec): void => {
    group.add(createBox(spec, materials));
  };

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

  // 第一段扶手立柱
  for (let i = 1; i <= steps1; i++) {
    const zCenter = run1StartZ - (i - 0.5) * stepD1;
    if (i % 2 !== 1) continue;
    add({
      w: postThickness,
      h: railHeight,
      d: postThickness,
      x: run1RailX,
      y: baseY + stepH1 * i + railHeight / 2,
      z: zCenter,
      material: 'railing',
    });
  }

  // 第一段斜扶手
  const run1RailLength = Math.sqrt(run1Length * run1Length + platformH * platformH);
  const run1Angle = Math.atan2(platformH, run1Length);
  const rail1 = new THREE.Mesh(
    new THREE.BoxGeometry(railThickness, railThickness, run1RailLength),
    materials.railing,
  );
  rail1.position.set(run1RailX, baseY + platformH / 2 + railHeight, (run1StartZ + PLATFORM_FRONT_Z) / 2);
  rail1.rotation.x = run1Angle;
  rail1.castShadow = false;
  group.add(rail1);

  // ---- 休息平台：顶面贴白瓷砖，底面 / 侧面为白色乳胶漆 ----
  const platGeo = new THREE.BoxGeometry(platformWidth, stepThickness, platformDepth);
  faceUv(platGeo, 2, platformWidth / tileSize, platformDepth / tileSize);
  const platform = new THREE.Mesh(platGeo, tileMats(2));
  platform.position.set(platformX, platformY - halfStepT, platformZ);
  platform.castShadow = false;
  platform.receiveShadow = false;
  group.add(platform);

  // 平台转角立柱
  add({
    w: postThickness,
    h: railHeight,
    d: postThickness,
    x: run1RailX,
    y: platformY + railHeight / 2,
    z: PLATFORM_FRONT_Z,
    material: 'railing',
  });
  add({
    w: postThickness,
    h: railHeight,
    d: postThickness,
    x: run2RailX,
    y: platformY + railHeight / 2,
    z: PLATFORM_FRONT_Z,
    material: 'railing',
  });

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

  // 第二段扶手立柱
  for (let i = 1; i <= steps2; i++) {
    const zCenter = PLATFORM_FRONT_Z + (i - 0.5) * stepD2;
    if (i % 2 !== 1 && i !== steps2) continue;
    add({
      w: postThickness,
      h: railHeight,
      d: postThickness,
      x: run2RailX,
      y: platformY + stepH2 * i + railHeight / 2,
      z: zCenter,
      material: 'railing',
    });
  }

  // 第二段斜扶手
  const run2RailLength = Math.sqrt(
    run2Length * run2Length + (wallH - platformH) * (wallH - platformH),
  );
  const run2Angle = Math.atan2(wallH - platformH, run2Length);
  const rail2 = new THREE.Mesh(
    new THREE.BoxGeometry(railThickness, railThickness, run2RailLength),
    materials.railing,
  );
  rail2.position.set(
    run2RailX,
    platformY + (wallH - platformH) / 2 + railHeight,
    PLATFORM_FRONT_Z + run2Length / 2,
  );
  rail2.rotation.x = -run2Angle;
  rail2.castShadow = false;
  group.add(rail2);

  return group;
}

/** 供 2D 平面图与标注使用的楼梯关键标高 */
export const STAIR_MARKERS = {
  backWallInner: BACK_WALL_INNER,
  platformFrontZ: PLATFORM_FRONT_Z,
  run1StartZ: RUN1_START_Z,
};
