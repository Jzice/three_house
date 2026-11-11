import * as THREE from 'three';
import {
  LAMP_COLOR,
  LAMP_GEOMETRY,
  type LampSpec,
  type SwitchSpec,
  type LightSwitchHitData,
} from '../config/lightingConfig';

/**
 * 全屋灯具与开关面板的程序化建模。
 *
 * - 全部几何用 Three 内置几何体 / 极坐标自定义 BufferGeometry / Canvas 程序化贴图生成，
 *   不引入任何外部资源（单文件离线发布约束）。
 * - 非发光部件共享模块级材质与几何缓存；**发光材质逐盏独立 clone**，
 *   避免一盏开关把同材质其它灯一起点亮。
 * - 灯具 Group 的原点＝天花板底面（世界 y = floor.baseY + spec.y），几何一律向 -y 悬挂。
 * - 灯具 mesh 不标 `weatherExposed`，避免 weatherFx 换材质后破坏开关状态。
 */

/**
 * 开灯时发光材质的自发光强度。
 * 灯罩距自身点光源仅十余厘米（decay=2），若同时保留乳白基色与高 emissive 会整片饱和成纯白，
 * 丢失褶皱 / 回字光带 / 金环等层次。故开灯时把基色插值压暗，亮度交给不受光照影响的自发光，
 * 点光源继续负责照亮房间，三者互不串扰。
 */
const GLOW_ON = 1.25;
/** 关灯：常态乳白灯罩 */
const SHADE_OFF = new THREE.Color(0xf0e5d2);
/** 开灯：压暗基色，避免被近距点光源打爆；自发光另提供暖白亮度 */
const SHADE_LIT = new THREE.Color(0x6a5a44);
/** 开关指示点开灯时的自发光强度 */
const INDICATOR_ON = 1.6;

// ==========================================================
// 共享材质（非发光部件）
// ==========================================================
const MAT = {
  /** 黑金细框 / 挑臂：哑光深灰金属 */
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2b30, metalness: 0.72, roughness: 0.38 }),
  /** 金铜压边 / 拉丝五金 */
  gold: new THREE.MeshStandardMaterial({ color: 0xc8a45c, metalness: 0.82, roughness: 0.3 }),
  /** 乳白灯体 / 吸顶盘 */
  white: new THREE.MeshStandardMaterial({ color: 0xf6f3ea, metalness: 0.05, roughness: 0.52 }),
  /** 极简黑细边（方形回字灯） */
  edge: new THREE.MeshStandardMaterial({ color: 0x23262a, metalness: 0.45, roughness: 0.4 }),
  /** 花灯枝干与叶片：青绿 */
  green: new THREE.MeshStandardMaterial({ color: 0x4f7c58, metalness: 0.08, roughness: 0.62 }),
  /** 吊扇灯半透弧叶 */
  blade: new THREE.MeshStandardMaterial({
    color: 0xf2f5f7, metalness: 0.05, roughness: 0.3,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false,
  }),
  /**
   * 86 型枪灰面板 / 按键：中深枪灰（哑光 PVD 质感），按键同色系亮一档保留层次。
   * 冷灰蓝低强度自发光让深色面板在夜间仍呈现固有色、可被找到，又不会泛暖褐或刺眼；
   * 强度按线性亮度换算，约为 0.05~0.08，与深色底板的固有亮度相当。
   */
  plate: new THREE.MeshStandardMaterial({
    color: 0x464c55, emissive: 0x8a95a5, emissiveIntensity: 0.22, metalness: 0.25, roughness: 0.58,
  }),
  key: new THREE.MeshStandardMaterial({
    color: 0x585f69, emissive: 0x96a1b2, emissiveIntensity: 0.2, metalness: 0.25, roughness: 0.5,
  }),
  /** 吊杆缠绕布纹（新中式吊灯的黑布缠杆） */
  stemWrap: new THREE.MeshStandardMaterial({
    color: 0x33343a, map: twistTexture(), metalness: 0.2, roughness: 0.72,
  }),
  /** 流苏穗：红棕丝线 */
  tasselRed: new THREE.MeshStandardMaterial({
    color: 0x8a3b2e, metalness: 0.05, roughness: 0.85,
  }),
  /** 射线拾取用的透明放大命中盒 */
  hit: new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
  }),
};

// ==========================================================
// 程序化贴图（Canvas，无外部资源）
// ==========================================================
let woodTexCache: THREE.CanvasTexture | null = null;

/** 原木纹：暖棕底 + 细密波纹年轮 */
function woodTexture(): THREE.CanvasTexture {
  if (woodTexCache) return woodTexCache;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#9a6a3e');
    grad.addColorStop(0.5, '#b78450');
    grad.addColorStop(1, '#8d5f38');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
      const y = i * 5.6 + Math.sin(i * 0.7) * 2.2;
      g.strokeStyle = i % 3 === 0 ? 'rgba(72,42,20,0.24)' : 'rgba(226,182,128,0.16)';
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 256; x += 8) {
        g.lineTo(x, y + Math.sin(x * 0.045 + i * 0.55) * 2.4);
      }
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  woodTexCache = tex;
  return tex;
}

/** 吊杆斜缠布纹：深灰底 + 斜向缠绕亮线（让黑杆呈布缠质感） */
function twistTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#33343a';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(150,150,160,0.22)';
    g.lineWidth = 2;
    for (let i = -64; i < 64; i += 5) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 64, 64);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ==========================================================
// 几何缓存（同类灯复用，减少内存）
// ==========================================================
const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const geo = make();
  geoCache.set(key, geo);
  return geo;
}

/** 逐盏独立的发光材质：关灯为常态乳白，开灯均匀暖白自发光 */
function glowMaterial(spec: LampSpec, map?: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf0e5d2),
    emissive: new THREE.Color(spec.color ?? LAMP_COLOR),
    emissiveIntensity: 0,
    map: map ?? null,
    emissiveMap: map ?? null,
    metalness: 0,
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
}

/** 挂一个 mesh 到父节点；灯具一律不投影、不接收阴影 */
function add(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

/** 圆角矩形 Shape：中心在原点，w 沿 x、d 沿 z（局部 y 对应世界 z） */
function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  const rr = Math.max(0.002, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + d - rr);
  s.quadraticCurveTo(x + w, y + d, x + w - rr, y + d);
  s.lineTo(x + rr, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  s.closePath();
  return s;
}

/** 圆角矩形环（带洞），用于回字光带 / 黑细边 */
function roundedRing(w: number, d: number, r: number, band: number): THREE.Shape {
  const s = roundedRect(w, d, r);
  s.holes.push(roundedRect(w - 2 * band, d - 2 * band, Math.max(0.002, r - band)));
  return s;
}

/** 把 XY 平面的 ShapeGeometry 转成水平朝下的面片（法向 -y，室内抬头可见） */
function flatShape(shape: THREE.Shape, y: number, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
  const m = add(parent, new THREE.ShapeGeometry(shape, 12), mat, 0, y, 0);
  m.rotation.x = Math.PI / 2;
  return m;
}

// ==========================================================
// 六类灯具
// ==========================================================

/** 圆形吸顶灯：超薄圆盘 + 深色细边 + 均匀发光面；damp 为卫生间防潮款 */
function buildCeiling(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): void {
  const cfg = LAMP_GEOMETRY.ceiling;
  const r = spec.radius;
  const body = cached(`ceil-body-${r}`, () => new THREE.CylinderGeometry(r, r, cfg.bodyH, 32));
  add(parent, body, MAT.white, 0, -cfg.bodyH / 2, 0);

  const rim = cached(`ceil-rim-${r}`, () => new THREE.TorusGeometry(r - cfg.rimEdge / 2, cfg.rimEdge / 2, 8, 32));
  const rimMesh = add(parent, rim, MAT.edge, 0, -cfg.bodyH + 0.002, 0);
  rimMesh.rotation.x = Math.PI / 2;

  const panelR = Math.max(0.02, r - cfg.rimEdge * 2);
  const panel = cached(`ceil-panel-${r}`, () => new THREE.CylinderGeometry(panelR, panelR, cfg.panelH, 32));
  const gm = glowMaterial(spec);
  glow.push(gm);
  add(parent, panel, gm, 0, -cfg.bodyH - cfg.panelH / 2, 0);

  if (spec.damp) {
    // 防潮款：外圈再加一道密封胶圈，视觉上与普通款区分
    const seal = cached(`ceil-seal-${r}`, () => new THREE.TorusGeometry(r - 0.006, 0.006, 8, 32));
    const sm = add(parent, seal, MAT.dark, 0, -cfg.bodyH - 0.004, 0);
    sm.rotation.x = Math.PI / 2;
  }
}

/** 祥云卷：由外向内收拢的阿基米德螺旋管（XY 平面，法向 +Z） */
function spiralGeometry(size: number, tube: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * 1.25 * Math.PI * 2 + Math.PI / 2;
    const r = size * (1 - 0.68 * t);
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), N * 2, tube, 5, false);
}

/**
 * 新中式灯笼吊灯：锥斗吸顶盘 + 缠纹吊杆 + 金黑枢纽（含三角撑与底环）
 * + 中心金半圆拱（拱端金帽 + 拱内梅花枝）+ 8 条黑色扁臂（臂端金色祥云双卷）
 * + 8 枚乳白直筒灯笼罩（顶部金领 + 底部金箍）+ 中央白珠金托红流苏。
 * 位置 / 吊高由 spec 控制，几何一律向 -y 悬挂。
 */
function buildChandelier(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): void {
  const cfg = LAMP_GEOMETRY.chandelier;
  const armR = spec.radius;
  const scale = armR / cfg.armRadius;
  const shadeR = cfg.shadeR * scale;
  const shadeH = cfg.shadeH * scale;
  const stemTop = -spec.drop;

  // 1) 锥斗形吸顶盘（贴顶宽口、向下收细）+ 粗缠绕吊杆
  const canopy = cached('chand-canopy', () =>
    new THREE.CylinderGeometry(cfg.canopyR, cfg.canopyBottomR, cfg.canopyH, 28));
  add(parent, canopy, MAT.dark, 0, -cfg.canopyH / 2, 0);
  const stem = cached(`chand-stem-${spec.drop}-${cfg.stemR}`, () =>
    new THREE.CylinderGeometry(cfg.stemR, cfg.stemR, spec.drop, 20));
  add(parent, stem, MAT.stemWrap, 0, -spec.drop / 2, 0);

  // 2) 中心枢纽：金色主座 + 深色包环
  const hub = cached('chand-hub', () =>
    new THREE.CylinderGeometry(cfg.hubR, cfg.hubR * 1.15, cfg.hubH, 24));
  add(parent, hub, MAT.gold, 0, stemTop, 0);
  const hubRing = cached('chand-hubring', () =>
    new THREE.TorusGeometry(cfg.hubR * 0.92, cfg.hubH * 0.14, 8, 24));
  const hubRingMesh = add(parent, hubRing, MAT.dark, 0, stemTop + cfg.hubH * 0.1, 0);
  hubRingMesh.rotation.x = Math.PI / 2;

  // 3) 三角撑：4 条金杆由枢纽下沿斜撑到底部环框
  const braceTopY = stemTop - cfg.hubH * 0.5;
  const braceFootY = stemTop - 0.10 * scale;
  const braceFootR = armR * 0.20;
  const braceGeo = cached(`chand-brace-${scale}`, () => new THREE.TubeGeometry(
    new THREE.LineCurve3(
      new THREE.Vector3(cfg.hubR * 0.55, braceTopY, 0),
      new THREE.Vector3(braceFootR, braceFootY, 0),
    ), 1, cfg.braceR * scale, 6, false,
  ));
  for (let i = 0; i < 4; i++) {
    const b = add(parent, braceGeo, MAT.gold, 0, 0, 0);
    b.rotation.y = (i / 4) * Math.PI * 2;
  }
  // 底框：四角落在 45° 方向的方框，撑杆正对边中点（方框比方环更贴合参考图，也不易看成光圈）
  const frameCorners: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    frameCorners.push(new THREE.Vector3(Math.cos(a) * braceFootR, braceFootY, Math.sin(a) * braceFootR));
  }
  const frame = cached(`chand-frame-${braceFootR}`, () => new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(frameCorners, true), 32, cfg.braceR * scale * 0.9, 5, true,
  ));
  add(parent, frame, MAT.gold);

  // 4) 金色半圆拱（XY 平面，正面可见）+ 拱端金帽 + 拱内梅花枝
  const archR = cfg.archR * scale;
  const archBaseY = stemTop - 0.01;
  const arch = cached(`chand-arch-${archR}`, () =>
    new THREE.TorusGeometry(archR, cfg.archTube * scale, 8, 56, Math.PI));
  add(parent, arch, MAT.gold, 0, archBaseY, 0);
  const archCapGeo = cached(`chand-archcap-${scale}`, () =>
    new THREE.CylinderGeometry(cfg.archTube * 1.9, cfg.archTube * 1.9, 0.05 * scale, 12));
  for (const sx of [-1, 1]) {
    const cap = add(parent, archCapGeo, MAT.gold, sx * archR, archBaseY, 0);
    cap.rotation.z = Math.PI / 2;
  }
  const branch = cached(`chand-branch-${archR}`, () => new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-archR * 0.60, archBaseY + archR * 0.28, 0.004),
      new THREE.Vector3(-archR * 0.20, archBaseY + archR * 0.50, 0.004),
      new THREE.Vector3(0.03 * scale, archBaseY + archR * 0.38, 0.004),
      new THREE.Vector3(archR * 0.26, archBaseY + archR * 0.56, 0.004),
      new THREE.Vector3(archR * 0.56, archBaseY + archR * 0.32, 0.004),
    ]), 28, 0.004 * scale, 5, false,
  ));
  add(parent, branch, MAT.gold);
  const blossomGeo = cached(`chand-blossom-${cfg.blossomR * scale}`, () =>
    new THREE.SphereGeometry(cfg.blossomR * scale, 8, 6));
  const blossomSpots: [number, number][] = [
    [-0.52, 0.30], [-0.24, 0.46], [0.04, 0.40], [0.30, 0.52], [0.56, 0.34],
  ];
  for (const [bx, by] of blossomSpots) {
    add(parent, blossomGeo, MAT.gold, archR * bx, archBaseY + archR * by, 0.004);
  }

  // 5) 灯笼罩：乳白直筒微鼓（顶部穹盖收口），罩口金领、罩底金箍
  const shadeProfile = [
    new THREE.Vector2(shadeR * 0.90, 0),
    new THREE.Vector2(shadeR * 1.00, 0.02 * scale),
    new THREE.Vector2(shadeR * 1.00, shadeH * 0.82),
    new THREE.Vector2(shadeR * 0.96, shadeH * 0.93),
    new THREE.Vector2(shadeR * 0.78, shadeH * 0.99),
    new THREE.Vector2(shadeR * 0.42, shadeH * 1.02),
    new THREE.Vector2(0.001, shadeH * 1.03),
  ];
  const shadeGeo = cached(`chand-shade-${shadeR}-${shadeH}`, () =>
    new THREE.LatheGeometry(shadeProfile, 28));
  // 金领：扁圆盘（有上下端面，读作金属箍）
  const collarGeo = cached(`chand-collar-${shadeR}`, () =>
    new THREE.CylinderGeometry(shadeR * 1.04, shadeR * 1.04, cfg.collarH * scale, 28));
  // 金箍：细环（中空，下方能看到罩内暖光）
  const hoopGeo = cached(`chand-hoop-${shadeR}`, () =>
    new THREE.TorusGeometry(shadeR * 1.02, cfg.hoopTube * scale, 8, 28));
  const gm = glowMaterial(spec); // 素白，无墨纹
  glow.push(gm);

  // 6) 扁臂 + 臂端祥云双卷
  const armY = stemTop - 0.005;
  const shadeTopY = stemTop - 0.10 * scale;
  const cordH = armY - shadeTopY;
  const armGeo = cached(`chand-arm-${armR}`, () =>
    new THREE.BoxGeometry(armR, cfg.armH * scale, cfg.armW * scale));
  const cordGeo = cached(`chand-cord-${cordH}`, () =>
    new THREE.CylinderGeometry(0.006 * scale, 0.006 * scale, cordH, 6));
  const curlGeo = cached(`chand-curl-${cfg.curlR * scale}`, () =>
    spiralGeometry(cfg.curlR * scale, cfg.curlTube * scale));
  const tipCapGeo = cached(`chand-tipcap-${scale}`, () =>
    new THREE.CylinderGeometry(cfg.armW * 0.85, cfg.armW * 0.85, 0.03 * scale, 12));

  for (let i = 0; i < cfg.armCount; i++) {
    const th = (i / cfg.armCount) * Math.PI * 2;
    const cx = Math.cos(th);
    const cz = Math.sin(th);

    // 黑色扁臂：自枢纽水平外挑，臂端微微下垂
    const arm = add(parent, armGeo, MAT.dark, cx * armR * 0.5, armY, cz * armR * 0.5);
    arm.rotation.set(0, -th, -0.05);

    // 臂端金帽 + 祥云双卷（卷面朝外，双瓣沿切向并列）
    const tip = new THREE.Group();
    tip.position.set(cx * armR, armY - 0.012 * scale, cz * armR);
    tip.rotation.y = Math.PI / 2 - th;
    parent.add(tip);
    const cap = add(tip, tipCapGeo, MAT.gold, 0, 0, 0);
    cap.rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) {
      add(tip, curlGeo, MAT.gold, sx * cfg.curlR * 0.62, cfg.curlR * 0.9, 0);
    }

    // 短吊链 + 灯笼罩（金领在罩口、金箍在罩底）
    add(parent, cordGeo, MAT.gold, cx * armR, (armY + shadeTopY) / 2, cz * armR);
    add(parent, shadeGeo, gm, cx * armR, shadeTopY - shadeH, cz * armR);
    add(parent, collarGeo, MAT.gold, cx * armR, shadeTopY - cfg.collarH * scale * 0.5, cz * armR);
    const hoop = add(parent, hoopGeo, MAT.gold, cx * armR, shadeTopY - shadeH, cz * armR);
    hoop.rotation.x = Math.PI / 2;
  }

  // 7) 中央流苏：吊绳 + 白珠 + 金托 + 红棕长穗
  const cordTop = stemTop - cfg.hubH * 0.5;
  const cordLen = cfg.cordLen * scale;
  const tasselCord = cached(`chand-tassel-cord-${cordLen}`, () =>
    new THREE.CylinderGeometry(0.005 * scale, 0.005 * scale, cordLen, 6));
  add(parent, tasselCord, MAT.dark, 0, cordTop - cordLen / 2, 0);
  const beadY = cordTop - cordLen - cfg.tasselBeadR * scale;
  const bead = cached(`chand-bead-${cfg.tasselBeadR * scale}`, () =>
    new THREE.SphereGeometry(cfg.tasselBeadR * scale, 14, 12));
  add(parent, bead, MAT.white, 0, beadY, 0);
  const knot = cached(`chand-knot-${scale}`, () =>
    new THREE.TorusGeometry(cfg.tasselR * scale * 0.55, cfg.tasselR * scale * 0.18, 6, 16));
  const knotMesh = add(parent, knot, MAT.gold, 0, beadY - cfg.tasselBeadR * scale, 0);
  knotMesh.rotation.x = Math.PI / 2;
  const tasselH = cfg.tasselH * scale;
  const tassel = cached(`chand-tassel-${tasselH}-${cfg.tasselR * scale}`, () =>
    new THREE.ConeGeometry(cfg.tasselR * scale, tasselH, 14));
  add(parent, tassel, MAT.tasselRed, 0, beadY - cfg.tasselBeadR * scale - tasselH / 2, 0);
}

/** 花灯：青绿吸顶盘 + 链条 + 6 朵喇叭花罩 + 弯枝与叶片 */
function buildFlower(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): void {
  const cfg = LAMP_GEOMETRY.flower;
  const scale = spec.radius / 0.38;
  const ring = cfg.bloomRing * scale;
  const bloomR = cfg.bloomR * scale;
  const bloomH = cfg.bloomH * scale;
  const bloomY = cfg.bloomY * scale - 0.02;
  const hubY = -spec.drop;

  const canopy = cached('flower-canopy', () => new THREE.CylinderGeometry(cfg.canopyR, cfg.canopyR, cfg.canopyH, 20));
  add(parent, canopy, MAT.green, 0, -cfg.canopyH / 2, 0);
  const chain = cached(`flower-chain-${spec.drop}`, () => new THREE.CylinderGeometry(0.006, 0.006, spec.drop, 8));
  add(parent, chain, MAT.gold, 0, -spec.drop / 2, 0);

  const bloomProfile = [
    new THREE.Vector2(0.012, bloomH),
    new THREE.Vector2(bloomR * 0.30, bloomH * 0.74),
    new THREE.Vector2(bloomR * 0.62, bloomH * 0.32),
    new THREE.Vector2(bloomR, 0),
  ];
  const bloomGeo = cached(`flower-bloom-${bloomR}`, () => new THREE.LatheGeometry(bloomProfile, 20));
  const gm = glowMaterial(spec);
  glow.push(gm);
  const leafGeo = cached('flower-leaf', () => new THREE.SphereGeometry(1, 10, 8));

  for (let i = 0; i < cfg.bloomCount; i++) {
    const th = (i / cfg.bloomCount) * Math.PI * 2;
    const cx = Math.cos(th);
    const cz = Math.sin(th);
    const bx = cx * ring;
    const bz = cz * ring;
    // 弯枝：从中心吊点向外挑到花蒂
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, hubY, 0),
      new THREE.Vector3(bx * 0.45, hubY + 0.06, bz * 0.45),
      new THREE.Vector3(bx, bloomY + bloomH, bz),
    ]);
    add(parent, new THREE.TubeGeometry(curve, 8, 0.007, 6, false), MAT.green);
    add(parent, bloomGeo, gm, bx, bloomY, bz);
    // 叶片
    const leaf = add(parent, leafGeo, MAT.green, bx * 0.72, hubY + 0.05, bz * 0.72);
    leaf.scale.set(cfg.leafLen * 0.55, 0.012, cfg.leafLen * 0.28);
    leaf.rotation.y = th;
  }
  for (let i = 0; i < cfg.leafCount; i++) {
    const th = (i / cfg.leafCount) * Math.PI * 2;
    const leaf = add(parent, leafGeo, MAT.green, Math.cos(th) * 0.10, hubY + 0.02, Math.sin(th) * 0.10);
    leaf.scale.set(cfg.leafLen * 0.42, 0.010, cfg.leafLen * 0.22);
    leaf.rotation.y = th + 0.4;
  }
}

/** 吊扇灯的扇叶机构句柄：转子 + 每片扇叶的水平旋叠铰轴 */
interface FanRig {
  rotor: THREE.Group;
  folds: THREE.Group[];
  /** 扇叶基准高度（相对灯具原点） */
  bladeY: number;
}

/** 吊扇灯：白色圆盘灯体 + 细金边 + 4 片半透弧叶（贴近灯体、可水平旋叠收拢） */
function buildCeilingFan(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): FanRig {
  const cfg = LAMP_GEOMETRY.ceilingFan;
  const r = spec.radius;
  const topY = -spec.drop;
  // 扇叶平面下移到圆盘灯体上表面之上 0.08m，不再贴天花板
  const bladeY = topY + cfg.bladeAboveBody;

  const canopy = cached('fan-canopy', () => new THREE.CylinderGeometry(cfg.canopyR, cfg.canopyR, cfg.canopyH, 20));
  add(parent, canopy, MAT.white, 0, -cfg.canopyH / 2, 0);
  const stem = cached(`fan-stem-${spec.drop}`, () => new THREE.CylinderGeometry(cfg.stemR, cfg.stemR, spec.drop, 12));
  add(parent, stem, MAT.white, 0, -spec.drop / 2, 0);

  const body = cached(`fan-body-${r}`, () => new THREE.CylinderGeometry(r, r, cfg.bodyH, 40));
  add(parent, body, MAT.white, 0, topY - cfg.bodyH / 2, 0);
  const rim = cached(`fan-rim-${r}`, () => new THREE.TorusGeometry(r - cfg.rimR, cfg.rimR, 8, 40));
  const rimMesh = add(parent, rim, MAT.gold, 0, topY - cfg.bodyH + 0.002, 0);
  rimMesh.rotation.x = Math.PI / 2;

  const gm = glowMaterial(spec);
  glow.push(gm);
  const disc = cached(`fan-disc-${r}`, () => new THREE.CircleGeometry(r - 0.018, 40));
  const discMesh = add(parent, disc, gm, 0, topY - cfg.bodyH - 0.003, 0);
  discMesh.rotation.x = Math.PI / 2;

  // 转子：根部小轮毂 + 4 组「径向 pivot → 水平旋叠铰轴 → 叶片」
  const rotor = new THREE.Group();
  rotor.name = `fan-rotor-${spec.id}`;
  parent.add(rotor);
  const hub = cached(`fan-hub-${cfg.hubR}`, () =>
    new THREE.CylinderGeometry(cfg.hubR, cfg.hubR, cfg.hubH, 20));
  // 轮毂略低于扇叶平面，收拢的叶片不会与它穿插
  add(rotor, hub, MAT.white, 0, bladeY - cfg.hubH, 0);

  const bladeLen = cfg.bladeLen * (r / cfg.bodyR);
  const bladeGeo = cached(`fan-blade-${bladeLen}`, () => {
    const g = new THREE.PlaneGeometry(bladeLen, cfg.bladeW, 10, 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getX(i) + bladeLen / 2) / bladeLen;
      pos.setZ(i, Math.sin(t * Math.PI) * 0.012 + t * 0.018);
    }
    g.computeVertexNormals();
    return g;
  });
  const folds: THREE.Group[] = [];
  for (let i = 0; i < cfg.bladeCount; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / cfg.bladeCount) * Math.PI * 2;
    rotor.add(pivot);
    // 铰轴落在叶片根部：绕自身 y 轴回旋即可把整片叶子平叠到灯体正上方
    const fold = new THREE.Group();
    fold.position.set(r * 0.55, bladeY, 0);
    fold.rotation.y = cfg.foldAngle; // 初始收拢态，由状态中枢下发目标态
    pivot.add(fold);
    const blade = add(fold, bladeGeo, MAT.blade, bladeLen / 2, 0, 0);
    blade.rotation.x = -Math.PI / 2;
    folds.push(fold);
  }
  return { rotor, folds, bladeY };
}

/**
 * 贝壳褶皱吸顶灯：原木纹圆背板 + 极坐标自定义 BufferGeometry 的放射褶罩
 * （外缘半径按 cos(petalCount·θ) 起伏成花瓣边、罩面按 sin(foldCount·θ) 细密褶皱）+ 中心金环与铆点。
 */
function buildShell(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): void {
  const cfg = LAMP_GEOMETRY.shell;
  const r = spec.radius;
  const backR = r * (cfg.backR / cfg.shadeR);
  const wood = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: woodTexture(), metalness: 0.04, roughness: 0.62,
  });
  const back = cached(`shell-back-${backR}`, () => new THREE.CylinderGeometry(backR, backR, cfg.backH, 48));
  add(parent, back, wood, 0, -cfg.backH / 2, 0);

  const NR = 14;
  const NT = 160;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NR; i++) {
    const t = i / NR;
    for (let j = 0; j <= NT; j++) {
      const th = (j / NT) * Math.PI * 2;
      const petal = 1 + cfg.petalAmp * Math.cos(cfg.petalCount * th) * t * t * t;
      const fold = Math.sin(cfg.foldCount * th) * t;
      const rr = r * t * petal;
      const y = -cfg.backH - cfg.shadeDrop * t + cfg.foldAmp * fold;
      pos.push(Math.cos(th) * rr, y, Math.sin(th) * rr);
      uv.push(j / NT, t);
    }
  }
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NT; j++) {
      const a = i * (NT + 1) + j;
      const b = a + 1;
      const c = a + NT + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const shadeGeo = cached(`shell-shade-${r}`, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
  const gm = glowMaterial(spec);
  glow.push(gm);
  add(parent, shadeGeo, gm);

  const ring = cached(`shell-ring-${r}`, () => new THREE.TorusGeometry(cfg.ringR, cfg.ringTube, 8, 24));
  const ringMesh = add(parent, ring, MAT.gold, 0, -cfg.backH - 0.004, 0);
  ringMesh.rotation.x = Math.PI / 2;
  const capGeo = cached('shell-cap', () => new THREE.CircleGeometry(cfg.ringR * 0.72, 20));
  const cap = add(parent, capGeo, MAT.white, 0, -cfg.backH - 0.006, 0);
  cap.rotation.x = Math.PI / 2;
  const studGeo = cached('shell-stud', () => new THREE.SphereGeometry(0.005, 6, 6));
  for (let i = 0; i < cfg.studCount; i++) {
    const th = (i / cfg.studCount) * Math.PI * 2;
    add(parent, studGeo, MAT.gold,
      Math.cos(th) * (cfg.ringR + 0.014), -cfg.backH - 0.006, Math.sin(th) * (cfg.ringR + 0.014));
  }
}

/** 方形回字吸顶灯：圆角矩形细黑框 + 双层回字暖白光带 + 中央乳白发光面板 */
function buildRectPanel(spec: LampSpec, glow: THREE.MeshStandardMaterial[], parent: THREE.Group): void {
  const cfg = LAMP_GEOMETRY.rectPanel;
  const w = spec.w ?? 1.0;
  const d = spec.d ?? 0.6;
  const base = cached(`rect-base-${w}-${d}`, () => new THREE.BoxGeometry(w, cfg.frameH, d));
  add(parent, base, MAT.white, 0, -cfg.frameH / 2, 0);

  const gm = glowMaterial(spec);
  glow.push(gm);
  const y0 = -cfg.frameH - 0.002;
  // 外圈细黑边
  flatShape(roundedRing(w, d, cfg.cornerR, cfg.frameEdge), y0, MAT.edge, parent);
  // 外圈回字光带
  const ow = w - 2 * cfg.outerInset;
  const od = d - 2 * cfg.outerInset;
  flatShape(roundedRing(ow, od, cfg.cornerR - cfg.outerInset, cfg.bandW), y0 - 0.002, gm, parent);
  // 内圈回字光带（旋转 180° 的错位感由尺寸缩放体现，保持同心更贴近参考图）
  const iw = ow * cfg.innerScale;
  const id = od * cfg.innerScale;
  flatShape(roundedRing(iw, id, cfg.cornerR * cfg.innerScale, cfg.bandW * 0.85), y0 - 0.004, gm, parent);
  // 中央乳白发光面板
  const pw = iw - 2 * cfg.bandW;
  const pd = id - 2 * cfg.bandW;
  flatShape(roundedRect(pw, pd, cfg.cornerR * cfg.innerScale - cfg.bandW), y0 - 0.006, gm, parent);
}

// ==========================================================
// 对外句柄
// ==========================================================
export interface LampHandle {
  spec: LampSpec;
  group: THREE.Group;
  /** 逐盏独立的发光材质（开灯时同时提亮） */
  glow: THREE.MeshStandardMaterial[];
  /** 局部照明点光源（不投影，可见性由状态中枢限流） */
  light: THREE.PointLight;
  /** t∈[0,1]：自发光与点光源强度插值 */
  setGlow(t: number): void;
  /** 吊扇目标态：仅 ceilingFan 有效，其余灯具为空操作 */
  setFanTarget(on: boolean): void;
  /** 每帧推进扇叶水平旋叠 / 自转：仅 ceilingFan 有效 */
  update(dt: number): void;
}

export interface SwitchHandle {
  spec: SwitchSpec;
  group: THREE.Group;
  /** 可射线拾取的透明放大命中盒 */
  hitObjects: THREE.Object3D[];
  /** 按键视觉状态（微倾 + 暖色指示） */
  setKeyOn(index: number, on: boolean): void;
}

/** 创建一盏灯：Group 原点位于天花板底（世界坐标），几何向下悬挂 */
export function createLamp(spec: LampSpec, floorBaseY: number): LampHandle {
  const group = new THREE.Group();
  group.name = `lamp-${spec.id}`;
  group.position.set(spec.x, floorBaseY + spec.y, spec.z);

  const glow: THREE.MeshStandardMaterial[] = [];
  let fanRig: FanRig | null = null;
  switch (spec.kind) {
    case 'chandelier':
      buildChandelier(spec, glow, group);
      break;
    case 'flower':
      buildFlower(spec, glow, group);
      break;
    case 'ceilingFan':
      fanRig = buildCeilingFan(spec, glow, group);
      break;
    case 'shell':
      buildShell(spec, glow, group);
      break;
    case 'rectPanel':
      buildRectPanel(spec, glow, group);
      break;
    default:
      buildCeiling(spec, glow, group);
      break;
  }

  const light = new THREE.PointLight(spec.color ?? LAMP_COLOR, 0, spec.distance ?? 4.5, 2);
  // 光源置于灯罩下方约 0.55m：decay=2 时若贴着灯罩（0.12m）会形成刺眼的中心白斑并抹平造型，
  // 下移后照度分布柔和，仍能照亮地面 / 墙面。
  light.position.set(0, -(spec.drop + 0.55), 0);
  light.castShadow = false;
  light.visible = false;
  group.add(light);

  // 吊扇 engage∈[0,1] 同时驱动「扇叶水平旋叠角」与「转速」：
  // 开 → 边旋转边甩开叶片，关 → 边减速边旋叠收回，与灯体发光完全独立。
  let fanTarget = 0;
  let engage = 0;
  let spinAngle = 0;
  let fanInitialized = false;

  function applyFan(): void {
    if (!fanRig) return;
    const fanCfg = LAMP_GEOMETRY.ceilingFan;
    fanRig.rotor.rotation.y = spinAngle;
    const foldAngle = (1 - engage) * fanCfg.foldAngle;
    for (let i = 0; i < fanRig.folds.length; i++) {
      const f = fanRig.folds[i];
      f.rotation.y = foldAngle;
      // 收拢时四片叶子错开层叠避免共面闪烁；完全展开时归位同一平面
      f.position.y = fanRig.bladeY + (1 - engage) * i * fanCfg.stackGap;
    }
  }

  const peak = spec.intensity ?? 1.2;
  return {
    spec,
    group,
    glow,
    light,
    setGlow(t: number): void {
      const k = t < 0 ? 0 : t > 1 ? 1 : t;
      for (const m of glow) {
        m.color.lerpColors(SHADE_OFF, SHADE_LIT, k);
        m.emissiveIntensity = k * GLOW_ON;
      }
      light.intensity = k * peak;
    },
    setFanTarget(on: boolean): void {
      if (!fanRig) return;
      fanTarget = on ? 1 : 0;
      // 首帧前由状态中枢恢复持久化状态：直接吸附，避免刷新时误播一次展开动画
      if (!fanInitialized) {
        engage = fanTarget;
        fanInitialized = true;
        applyFan();
      }
    },
    update(dt: number): void {
      if (!fanRig) return;
      const fanCfg = LAMP_GEOMETRY.ceilingFan;
      const step = Math.min(Math.max(dt, 0), 0.1);
      if (engage !== fanTarget) {
        // 帧率无关的一阶趋近：约 1.2s 完成展开 / 收拢与起停转
        engage += (fanTarget - engage) * (1 - Math.exp(-step / fanCfg.foldTau));
        if (Math.abs(fanTarget - engage) < 0.002) engage = fanTarget;
        applyFan();
      }
      if (engage > 0) {
        spinAngle = (spinAngle + Math.PI * 2 * fanCfg.spinRps * engage * step) % (Math.PI * 2);
        fanRig.rotor.rotation.y = spinAngle;
      }
    },
  };
}

/** 创建 86 型开关面板：贴墙内表面、各按键独立命中与状态指示；3 键起切换加宽三联板 */
export function createSwitch(spec: SwitchSpec, floorBaseY: number): SwitchHandle {
  const cfg = LAMP_GEOMETRY.switch;
  const group = new THREE.Group();
  group.name = `switch-${spec.id}`;
  group.position.set(spec.x, floorBaseY + spec.y, spec.z);
  group.rotation.y = spec.rotY;

  const n = Math.max(1, spec.keys.length);
  // 三联及以上用加宽的 86 系列面板，保证每键仍是 30mm 标准宽、命中盒足够宽
  const plateW = n >= 3 ? cfg.plateW3 : cfg.plateW;
  const plate = cached(`sw-plate-${plateW}`, () => new THREE.BoxGeometry(plateW, cfg.plateH, cfg.plateT));
  add(group, plate, MAT.plate);

  const cell = (plateW - 0.010) / n;
  const keyW = Math.min(cfg.keyW, cell - 0.006);
  const hitObjects: THREE.Object3D[] = [];
  const keyMeshes: THREE.Mesh[] = [];
  const indicators: THREE.MeshStandardMaterial[] = [];

  for (let i = 0; i < n; i++) {
    const kx = -plateW / 2 + 0.005 + (i + 0.5) * cell;
    const key = add(group, new THREE.BoxGeometry(keyW, cfg.keyH, cfg.keyT), MAT.key,
      kx, 0, cfg.plateT / 2 + cfg.keyT / 2);
    keyMeshes.push(key);

    const indMat = new THREE.MeshStandardMaterial({
      color: 0xfff2d6, emissive: new THREE.Color(LAMP_COLOR), emissiveIntensity: 0, roughness: 0.4,
    });
    indicators.push(indMat);
    add(group, new THREE.SphereGeometry(0.0032, 8, 6), indMat,
      kx, -cfg.keyH / 2 + 0.009, cfg.plateT / 2 + cfg.keyT + 0.002);

    const hit = add(group,
      new THREE.BoxGeometry(cell, cfg.hitH, cfg.hitT), MAT.hit,
      kx, 0, cfg.plateT / 2 + cfg.hitT / 2);
    const data: LightSwitchHitData = { kind: 'light-switch', switchId: spec.id, keyIndex: i };
    hit.userData = { ...data };
    hitObjects.push(hit);
  }

  return {
    spec,
    group,
    hitObjects,
    setKeyOn(index: number, on: boolean): void {
      const m = indicators[index];
      const key = keyMeshes[index];
      if (m) m.emissiveIntensity = on ? INDICATOR_ON : 0;
      if (key) key.rotation.x = on ? -0.06 : 0;
    },
  };
}
