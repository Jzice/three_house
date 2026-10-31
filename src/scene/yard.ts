import * as THREE from 'three';
import type { MaterialMap, YardConfig } from '../types';
import { D, W } from '../config/houseConfig';

/**
 * 1F 院子：环绕房屋的卵石铺装 + 实体围墙（带压顶），东面临街留院门（东南角）。
 * 西、北两侧为 2m 高围墙（后院斜边 + 后院西短墙 + 前院西墙），南、东为矮墙。
 * 后院（北侧）为梯形：西北角深 = extend，东北角深 = rearEastDepth，斜围墙连向东北；
 * 西边界到房屋西墙为止（extendWest=0 时由房屋西墙充当，西围墙补其前后两段）。
 * 铺装顶面 = 1F 室内地坪（离地 0.30m）。
 */
export function createYard(spec: YardConfig, materials: MaterialMap): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yard';

  const xEast = W / 2 + spec.extend; // 东边界 7.62
  const xWest = -(W / 2 + (spec.extendWest ?? spec.extend)); // 西边界（0 时 -4.62 贴房屋西墙）
  const ydZ = D / 2 + spec.extend; // 南北半深 8.12
  const yardW = xEast - xWest;
  const cx = (xEast + xWest) / 2; // 铺装中心 x
  const rearEastZ = -(D / 2 + (spec.rearEastDepth ?? spec.extend)); // 斜边东北端 z = -5.62
  const rearStraight = spec.rearStraight ?? 0; // 西北角直角段长度（沿北边直行后变斜）
  const diaStartX = xWest + rearStraight; // 斜边起点 x（直角段东端）
  const paveH = spec.paveH; // 铺装面离地高度（= 1F 室内地坪 0.30）
  const t = spec.fenceT;
  const capT = spec.capT;
  const capOver = 0.06; // 压顶单侧外挑
  const gateHalf = spec.gateW / 2;

  // ---- 铺装（卵石碎拼）：南条 + 东条矩形；后院为梯形（Shape 挤出） ----
  const dNorth = ydZ - D / 2; // 南条深 3.0
  const wEast = xEast - W / 2; // 东条宽 3.0
  const strips: [number, number, number, number][] = [
    [cx, (ydZ + D / 2) / 2, yardW, dNorth], // 南条
    [(xEast + W / 2) / 2, 0, wEast, D], // 东条（z 限于房屋南北皮内）
  ];
  for (const [sx, sz, sw, sd] of strips) {
    const m = materials.paving.clone();
    const st = (materials.paving.map as THREE.Texture).clone();
    st.needsUpdate = true;
    st.repeat.set(sw / 2.5, sd / 2.5);
    m.map = st;
    const pave = new THREE.Mesh(new THREE.BoxGeometry(sw, paveH, sd), m);
    pave.position.set(sx, paveH / 2, sz);
    pave.receiveShadow = true;
    group.add(pave);
  }

  // 后院铺装：西北直角段 2m 后变斜（五边形）。世界 (x,z) → 形状 (x, -z)，挤出 paveH
  const shape = new THREE.Shape();
  shape.moveTo(xWest, ydZ); // 西北角
  shape.lineTo(xWest + rearStraight, ydZ); // 直角段东端
  shape.lineTo(xEast, -rearEastZ); // 斜边东端（东北）
  shape.lineTo(xEast, D / 2);
  shape.lineTo(xWest, D / 2);
  shape.closePath();
  const paveMat = materials.paving.clone();
  const paveTex = (materials.paving.map as THREE.Texture).clone();
  paveTex.needsUpdate = true;
  paveTex.repeat.set(1 / 2.5, 1 / 2.5);
  paveMat.map = paveTex;
  const trapezoid = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: paveH, bevelEnabled: false }),
    paveMat,
  );
  trapezoid.rotation.x = -Math.PI / 2; // 形状 y → 世界 -z，挤出 → 世界 +y
  trapezoid.receiveShadow = true;
  group.add(trapezoid);

  // 各侧围墙高度：南/东矮墙、西/北 2m
  const hf = spec.fenceH; // 南/东
  const hw = spec.fenceHWest ?? spec.fenceH; // 西
  const hn = spec.fenceHNorth ?? spec.fenceH; // 北

  // ---- 围墙 + 压顶（按高度 h 生成，墙顶/压顶随高） ----
  const addFence = (w: number, d: number, cx2: number, cz: number, h: number, rotY = 0): void => {
    const wallY = paveH + h / 2;
    const capY = paveH + h + capT / 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.wall);
    wall.position.set(cx2, wallY, cz);
    wall.rotation.y = rotY;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w + 2 * capOver, capT, d + 2 * capOver),
      materials.wall,
    );
    cap.position.set(cx2, capY, cz);
    cap.rotation.y = rotY;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  };

  addFence(yardW, t, cx, ydZ - t / 2, hf); // 南墙（整条，矮）

  // 后院西短墙：z∈[-8.12,-5.12]（北端接斜围墙西端），高 2m
  addFence(t, dNorth, xWest + t / 2, -(ydZ + D / 2) / 2, hw);

  // 斜围墙：直角段东端 (-2.62,-8.12) → 东北 (7.62,-5.62)，高 2m
  const diaDx = xEast - diaStartX;
  const diaDz = rearEastZ + ydZ;
  const diaLen = Math.hypot(diaDx, diaDz);
  addFence(
    diaLen,
    t,
    (diaStartX + xEast) / 2,
    (rearEastZ - ydZ) / 2,
    hn,
    -Math.atan2(diaDz, diaDx),
  );

  // 后院西北直角段墙：(-4.62,-8.12) → (-2.62,-8.12)，高 2m（与西、斜围墙成直角）
  if (rearStraight > 0) {
    addFence(rearStraight, t, xWest + rearStraight / 2, -ydZ + t / 2, hn);
  }

  // 前西围墙（仅当西侧有外延时；extendWest=0 时由房屋西墙充当）
  if ((spec.extendWest ?? spec.extend) > 0) {
    addFence(t, ydZ - t - D / 2, xWest + t / 2, (ydZ - t + D / 2) / 2, hw);
  }

  // 前院西墙：z∈[5.12,7.88]（房屋西墙以南、接南墙），高 2m，封闭西边界
  addFence(t, ydZ - t - D / 2, xWest + t / 2, (D / 2 + ydZ - t) / 2, hw);

  // ---- 东墙单段（斜边东北端 → 东南角院门）+ 压顶（矮） ----
  const gz = spec.gateZ ?? 0; // 院门中心 z
  const segLen = gz - gateHalf - rearEastZ;
  addFence(t, segLen, xEast - t / 2, (gz - gateHalf + rearEastZ) / 2, hf);

  // ---- 院门外踏步：街面（y=0）两级台阶升至铺装面（y=0.30），逐层向院门内收 ----
  const addStep = (xc: number, yBot: number, yTop: number): void => {
    const h = yTop - yBot;
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, h, spec.gateW + 0.4),
      materials.wall,
    );
    s.position.set(xc, yBot + h / 2, gz);
    s.castShadow = true;
    s.receiveShadow = true;
    group.add(s);
  };
  addStep(xEast + capOver + 0.6, 0, paveH / 2); // 外阶（街面 → 0.15m）
  addStep(xEast + capOver + 0.2, paveH / 2, paveH); // 内阶（0.15m → 铺装面 0.30m）

  return group;
}
