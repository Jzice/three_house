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
 * 第一段自 RUN1_START_Z 下行至休息平台，第二段自平台继续上行至本层顶。
 */
export function createStairs(materials: MaterialMap, floor: FloorConfig): THREE.Group {
  const group = new THREE.Group();
  if (!floor.stair) return group; // 无楼梯的楼层（如 3F）返回空组
  const baseY = floor.baseY;
  const wallH = floor.wallH;
  const { platformH, platformDepth, run1Length, run2Length, steps1, steps2, railHeight, railThickness, postThickness, stepThickness, stepWidth, run1X, run1RailX, run2X, run2RailX, platformX, platformZ, platformWidth } = {
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

  const add = (spec: BoxSpec): void => {
    group.add(createBox(spec, materials));
  };

  // ---- 第一段：起步 -> 休息平台 ----
  for (let i = 1; i <= steps1; i++) {
    const zCenter = run1StartZ - (i - 0.5) * stepD1;
    add({
      w: stepWidth,
      // 台阶向下延伸到上一级踏面（通高踏步块），消除台阶之间的立缝
      h: stepH1,
      d: stepD1,
      x: run1X,
      y: baseY + stepH1 * (i - 0.5),
      z: zCenter,
      material: 'stair',
    });

    if (i % 2 === 1) {
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

  // 平台转角立柱 + 平台板
  add({
    w: postThickness,
    h: railHeight,
    d: postThickness,
    x: run1RailX,
    y: baseY + platformH + railHeight / 2,
    z: PLATFORM_FRONT_Z,
    material: 'railing',
  });
  add({
    w: platformWidth,
    h: stepThickness,
    d: platformDepth,
    x: platformX,
    y: baseY + platformH - halfStepT,
    z: platformZ,
    material: 'stair',
  });
  add({
    w: postThickness,
    h: railHeight,
    d: postThickness,
    x: run2RailX,
    y: baseY + platformH + railHeight / 2,
    z: PLATFORM_FRONT_Z,
    material: 'railing',
  });

  // ---- 第二段：休息平台 -> 本层顶 ----
  for (let i = 1; i <= steps2; i++) {
    const zCenter = PLATFORM_FRONT_Z + (i - 0.5) * stepD2;
    add({
      w: stepWidth,
      h: stepH2, // 同样通高到上一级踏面，消除立缝
      d: stepD2,
      x: run2X,
      y: baseY + platformH + stepH2 * (i - 0.5),
      z: zCenter,
      material: 'stair',
    });

    if (i % 2 === 1 || i === steps2) {
      add({
        w: postThickness,
        h: railHeight,
        d: postThickness,
        x: run2RailX,
        y: baseY + platformH + stepH2 * i + railHeight / 2,
        z: zCenter,
        material: 'railing',
      });
    }
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
    baseY + platformH + (wallH - platformH) / 2 + railHeight,
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
