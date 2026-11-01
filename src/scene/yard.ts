import * as THREE from 'three';
import type { MaterialMap, YardConfig } from '../types';
import { D, W } from '../config/houseConfig';

/**
 * 1F 院子：环绕房屋的卵石铺装 + 实体围墙（无压顶），东面临街留院门（东南角）。
 * 西、北两侧为 2m 高围墙（后院斜边 + 后院西短墙 + 前院西墙），南、东为矮墙。
 * 后院（北侧）为梯形：西北角深 = extendNorth，东北角深 = rearEastDepth，斜围墙连向东北；
 * 各方向外扩独立：extendEast / extendSouth / extendNorth / extendWest（西院，0 表示到房屋西墙为止）。
 * 铺装顶面 = 抬高后的院子台面（离地 paveH，现 0.50m）。
 */
export function createYard(spec: YardConfig, materials: MaterialMap): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yard';

  const xEast = W / 2 + spec.extendEast; // 东边界（东院宽度）
  const xWest = -(W / 2 + (spec.extendWest ?? 0)); // 西边界（西院外扩，默认 0 贴房屋西墙）
  const ySouthZ = D / 2 + spec.extendSouth; // 南（前院）半深
  const yNorthZ = D / 2 + spec.extendNorth; // 北（后院）半深
  const yardW = xEast - xWest;
  const cx = (xEast + xWest) / 2; // 铺装中心 x
  const rearEastZ = -(D / 2 + (spec.rearEastDepth ?? spec.extendNorth)); // 斜边东北端 z
  const rearStraight = spec.rearStraight ?? 0; // 西北角直角段长度（沿北边直行后变斜）
  const diaStartX = xWest + rearStraight; // 斜边起点 x（直角段东端）
  const paveH = spec.paveH; // 铺装面离地高度（抬高后的院子台面，0.50m）
  const t = spec.fenceT;
  const gateHalf = spec.gateW / 2;
  const gz = spec.gateZ ?? 0; // 院门中心 z

  // ---- 院门台阶几何（院门口要让出台阶位置，铺装据此开缺口） ----
  const stepDepth = 0.4; // 每阶进深（x 向）
  const stepCount = 3; // 三阶：1 阶突出院子东边界、2 阶缩进院子内
  const stepSouthZ = ySouthZ - t; // 台阶南边 = 南围墙内皮
  const stepNorthZ = gz - gateHalf; // 台阶北边 = 东围墙门垛（门洞通道北界）
  const stepW = Math.max(0.5, stepSouthZ - stepNorthZ); // 门洞通道净宽（1.6m）
  const stepZ = (stepSouthZ + stepNorthZ) / 2; // 台阶中心 z
  const notchX0 = xEast - (stepCount - 1) * stepDepth; // 铺装缺口西沿（缩进 2 阶的西界）

  // ---- 铺装（顶面卵石碎拼；侧面/裙边与围墙同色）：南条 + 东条 + 西条矩形；后院为梯形（Shape 挤出） ----
  const dSouth = ySouthZ - D / 2; // 南条（前院）深
  const dBack = yNorthZ - D / 2; // 后院西北段深
  const wEast = xEast - W / 2; // 东条宽
  const baseSide = materials.wall; // 平台侧面与围墙同色（浅灰 0xe0e0e0）
  const strips: [number, number, number, number][] = [
    // 南条（前院）：院门口让出 2 阶缩进台阶的位置 → 拆为主块 + 台阶北侧条 + 南围墙基脚条
    [(xWest + notchX0) / 2, (ySouthZ + D / 2) / 2, notchX0 - xWest, dSouth], // 主块（西侧）
    [(notchX0 + xEast) / 2, (D / 2 + stepNorthZ) / 2, xEast - notchX0, stepNorthZ - D / 2], // 台阶北侧条
    [(notchX0 + xEast) / 2, (stepSouthZ + ySouthZ) / 2, xEast - notchX0, ySouthZ - stepSouthZ], // 南围墙基脚条
    [(xEast + W / 2) / 2, 0, wEast, D], // 东条（z 限于房屋南北皮内）
  ];
  // 西条：仅西院有外扩时，沿房屋西山墙铺装（z 限于房屋南北皮内），与前/东条同材质处理，补全西院台面
  if ((spec.extendWest ?? 0) > 0) {
    strips.push([(xWest - W / 2) / 2, 0, spec.extendWest ?? 0, D]);
  }
  // Box 材质顺序 [+x,-x,+y,-y,+z,-z]：仅顶面(+y)用卵石，其余面（含四侧垂直面）用围墙色
  for (const [sx, sz, sw, sd] of strips) {
    const m = materials.paving.clone();
    const st = (materials.paving.map as THREE.Texture).clone();
    st.needsUpdate = true;
    st.repeat.set(sw / 2.5, sd / 2.5);
    m.map = st;
    const pave = new THREE.Mesh(new THREE.BoxGeometry(sw, paveH, sd), [
      baseSide, baseSide, m, baseSide, baseSide, baseSide,
    ]);
    pave.position.set(sx, paveH / 2, sz);
    pave.receiveShadow = true;
    group.add(pave);
  }

  // 后院铺装：西北直角段后变斜（五边形）。世界 (x,z) → 形状 (x, -z)，挤出 paveH
  const shape = new THREE.Shape();
  shape.moveTo(xWest, yNorthZ); // 西北角
  shape.lineTo(xWest + rearStraight, yNorthZ); // 直角段东端
  shape.lineTo(xEast, -rearEastZ); // 斜边东端（东北）
  shape.lineTo(xEast, D / 2);
  shape.lineTo(xWest, D / 2);
  shape.closePath();
  const paveMat = materials.paving.clone();
  const paveTex = (materials.paving.map as THREE.Texture).clone();
  paveTex.needsUpdate = true;
  paveTex.repeat.set(1 / 2.5, 1 / 2.5);
  paveMat.map = paveTex;
  // ExtrudeGeometry 材质顺序 [端盖(顶/底), 侧裙边]：端盖（顶面=地面）用卵石，侧裙边用围墙色（与前/东院一致）
  const trapezoid = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: paveH, bevelEnabled: false }),
    [paveMat, baseSide],
  );
  trapezoid.rotation.x = -Math.PI / 2; // 形状 y → 世界 -z，挤出 → 世界 +y
  trapezoid.receiveShadow = true;
  group.add(trapezoid);

  // 各侧围墙高度：南/东矮墙、西/北 2m
  const hf = spec.fenceH; // 南/东
  const hw = spec.fenceHWest ?? spec.fenceH; // 西
  const hn = spec.fenceHNorth ?? spec.fenceH; // 北

  // ---- 围墙（按高度 h 生成，墙顶随高；无压顶） ----
  const addFence = (w: number, d: number, cx2: number, cz: number, h: number, rotY = 0): void => {
    const wallY = paveH + h / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.wall);
    wall.position.set(cx2, wallY, cz);
    wall.rotation.y = rotY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  };

  addFence(yardW, t, cx, ySouthZ - t / 2, hf); // 南墙（整条，矮）

  // 后院西短墙：z∈[-yNorthZ,-5.12]（北端接斜围墙西端），高 2m
  addFence(t, dBack, xWest + t / 2, -(yNorthZ + D / 2) / 2, hw);

  // 斜围墙：直角段东端 → 东北（高 2m）
  const diaDx = xEast - diaStartX;
  const diaDz = rearEastZ + yNorthZ;
  const diaLen = Math.hypot(diaDx, diaDz);
  addFence(
    diaLen,
    t,
    (diaStartX + xEast) / 2,
    (rearEastZ - yNorthZ) / 2,
    hn,
    -Math.atan2(diaDz, diaDx),
  );

  // 后院西北直角段墙（高 2m，与西、斜围墙成直角）
  if (rearStraight > 0) {
    addFence(rearStraight, t, xWest + rearStraight / 2, -yNorthZ + t / 2, hn);
  }

  // 前院西墙：z∈[D/2, ySouthZ]（房屋西墙以南、接南墙），高 2m，封闭西边界
  // 注：原「前西围墙」条件分支与本节重复（extendWest>0 时均落在西院外皮），已合并
  addFence(t, ySouthZ - t - D / 2, xWest + t / 2, (D / 2 + ySouthZ - t) / 2, hw);

  // 西院中段墙：z∈[-D/2, D/2]（沿房屋西山墙外侧，连通前/后院西墙）；仅西院有外扩时封闭，使西边界连续
  if ((spec.extendWest ?? 0) > 0) {
    addFence(t, D, xWest + t / 2, 0, hw);
  }

  // ---- 东墙单段（斜边东北端 → 东南角院门）+ 压顶（矮） ----
  const segLen = gz - gateHalf - rearEastZ;
  addFence(t, segLen, xEast - t / 2, (gz - gateHalf + rearEastZ) / 2, hf);

  // ---- 院门外踏步：街面（y=0）三级升至铺装面（y=paveH）----
  // 宽度 = 门洞通道净宽（东墙门垛 → 南围墙内皮，1.6m）；南边与南围墙内皮齐平
  // 1 阶突出院子东边界（xEast→xEast+0.4），2 阶缩进院子内（铺装已让出缺口）
  const stepMat = materials.paving.clone();
  const stepTex = (materials.paving.map as THREE.Texture).clone();
  stepTex.needsUpdate = true;
  stepTex.repeat.set(stepDepth / 2.5, stepW / 2.5);
  stepMat.map = stepTex;
  for (let i = 0; i < stepCount; i++) {
    const h = (paveH * (i + 1)) / stepCount; // 踏面标高（逐级抬升至铺装面）
    const xc = xEast + stepDepth * (0.5 - i); // 由外向内逐阶内收
    // Box 材质顺序 [+x,-x,+y,-y,+z,-z]：仅顶面(+y)用卵石，立面保持围墙浅灰
    const s = new THREE.Mesh(new THREE.BoxGeometry(stepDepth, h, stepW), [
      baseSide, baseSide, stepMat, baseSide, baseSide, baseSide,
    ]);
    s.position.set(xc, h / 2, stepZ);
    s.castShadow = true;
    s.receiveShadow = true;
    group.add(s);
  }

  return group;
}
