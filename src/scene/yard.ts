import * as THREE from 'three';
import type { MaterialMap, YardConfig } from '../types';
import { D, W } from '../config/houseConfig';

/**
 * 1F 院子：环绕房屋的卵石铺装 + 实体围墙（无压顶），东面临街留院门（东南角）。
 * 西、北两侧与东墙北端加高段为 2m 高围墙（北侧直角段 + 斜段 + 东墙加高段合成一块共角棱柱），南、东其余段为矮墙。
 * 后院（北侧）为梯形：西北角深 = extendNorth，东北角深 = rearEastDepth，斜围墙连向东北；
 * 各方向外扩独立：extendEast / extendSouth / extendNorth / extendWest（西院，0 表示到房屋西墙为止）。
 * 铺装顶面 = 院子台面（离地 paveH，现 0.50m），与 1F 完成面 `FIRST_FLOOR_Y` 齐平，
 * 因此两扇外门门洞处地面连续、无竖立断面。
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
  const paveH = spec.paveH; // 铺装面离地高度（院子台面 0.50m，与 1F 完成面齐平）
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
    // 院子铺装（顶面）：雪天积雪覆盖、雨天积水湿亮
    pave.userData.weatherExposed = 'yard';
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
  // 后院梯形铺装（顶面）：雪天积雪覆盖、雨天积水湿亮
  trapezoid.userData.weatherExposed = 'yard';
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
    // 院子围墙（室外立面）：雪天被雪染白
    wall.userData.weatherExposed = 'wall';
    group.add(wall);
  };

  addFence(yardW, t, cx, ySouthZ - t / 2, hf); // 南墙（整条，矮）

  // 后院西短墙：z∈[-yNorthZ,-5.12]（北端接斜围墙西端），高 2m
  addFence(t, dBack, xWest + t / 2, -(yNorthZ + D / 2) / 2, hw);

  // ---- 北侧 2m 高连续围墙：西北直角段 + 斜段 + 东墙北端加高段，合成一块共角棱柱 ----
  // 斜段外皮与后院铺装斜边共线，墙身整段落在台面内：原先墙中心线压在斜边上，院外侧
  // 半个墙厚整段悬空、两端旋转角点还越出院角，即"下端突出院子地基"的来源。
  // 两端按外皮/内皮与相邻墙求交做斜切共角（miter），三段合成单一多边形棱柱，
  // 因此接头处不再有楔形缝、重叠竖带或越界的悬空三角。
  const diaAx = diaStartX; // 斜段外皮西端 = 直角段外皮东端
  const diaAz = -yNorthZ;
  const diaBx = xEast; // 斜段外皮东端 = 东墙外皮北端
  const diaBz = rearEastZ;
  const diaDx = diaBx - diaAx;
  const diaDz = diaBz - diaAz;
  const diaLen = Math.hypot(diaDx, diaDz) || 1;
  const ux = diaDx / diaLen;
  const uz = diaDz / diaLen;
  const nx = -uz; // 指向院内的单位法向
  const nz = ux;
  const inAx = diaAx + t * nx; // 斜段内皮线 = 外皮线向院内平移一个墙厚
  const inAz = diaAz + t * nz;
  const northInnerZ = diaAz + t; // 直角段内皮线 z
  const eastInnerX = xEast - t; // 东墙内皮线 x
  // 西北共角点：斜段内皮线 ∩ 直角段内皮线
  const westMiterX = Math.abs(uz) > 1e-6 ? inAx + ((northInnerZ - inAz) / uz) * ux : diaAx;
  // 东北共角点：斜段内皮线 ∩ 东墙内皮线
  const eastMiterZ = Math.abs(ux) > 1e-6 ? inAz + ((eastInnerX - inAx) / ux) * uz : diaBz;
  const eastWallLen = gz - gateHalf - diaBz; // 东墙北端 → 院门北界总长
  const eastHighLen = Math.min(Math.max(t, spec.eastHighLen ?? 0.9), eastWallLen);
  const eastHighEndZ = diaBz + eastHighLen;

  // Shape 平面坐标 (x, -z)，挤出 hn 后绕 x 轴 -90° → 挤出方向为世界 +y，底面落在 paveH
  const highWallShape = new THREE.Shape();
  highWallShape.moveTo(xWest, yNorthZ); // 西北角外皮
  highWallShape.lineTo(diaAx, yNorthZ); // 直角段外皮东端 A
  highWallShape.lineTo(diaBx, -diaBz); // 斜段外皮东端 B
  highWallShape.lineTo(diaBx, -eastHighEndZ); // 东墙加高段外皮南端
  highWallShape.lineTo(eastInnerX, -eastHighEndZ); // 东墙加高段内皮南端
  highWallShape.lineTo(eastInnerX, -eastMiterZ); // 东北共角点（内皮）
  highWallShape.lineTo(westMiterX, -northInnerZ); // 西北共角点（内皮）
  highWallShape.lineTo(xWest, -northInnerZ); // 西北角内皮
  highWallShape.closePath();
  const highWall = new THREE.Mesh(
    new THREE.ExtrudeGeometry(highWallShape, { depth: hn, bevelEnabled: false }),
    materials.wall,
  );
  highWall.rotation.x = -Math.PI / 2;
  highWall.position.y = paveH;
  highWall.castShadow = true;
  highWall.receiveShadow = true;
  // 院子围墙（室外立面）：雪天被雪染白
  highWall.userData.weatherExposed = 'wall';
  group.add(highWall);

  // 前院西墙：z∈[D/2, ySouthZ]（房屋西墙以南、接南墙），高 2m，封闭西边界
  // 注：原「前西围墙」条件分支与本节重复（extendWest>0 时均落在西院外皮），已合并
  addFence(t, ySouthZ - t - D / 2, xWest + t / 2, (D / 2 + ySouthZ - t) / 2, hw);

  // 西院中段墙：z∈[-D/2, D/2]（沿房屋西山墙外侧，连通前/后院西墙）；仅西院有外扩时封闭，使西边界连续
  if ((spec.extendWest ?? 0) > 0) {
    addFence(t, D, xWest + t / 2, 0, hw);
  }

  // ---- 东墙剩余矮墙段（接 2m 加高段南端 → 院门北界）----
  // 北端加高段与斜墙等高共角形成连续转角；此处才降回 0.5m 矮墙，墙头台阶落在东墙自身上，
  // 不再出现在斜墙与东墙的接头处。
  const eastLowLen = gz - gateHalf - eastHighEndZ;
  if (eastLowLen > 0) {
    addFence(t, eastLowLen, xEast - t / 2, (eastHighEndZ + gz - gateHalf) / 2, hf);
  }

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
    // 院门台阶（顶面）：纳入院子积雪/湿亮范围
    s.userData.weatherExposed = 'yard';
    group.add(s);
  }

  // 1F 完成面与院面同为 0.50m，两扇外门门洞处地面连续：铺装侧裙边被室内楼板
  // 与过门石遮住，不需要任何收口贴片 / 台阶 / 坡度。

  return group;
}
