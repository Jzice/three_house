import * as THREE from 'three';

/**
 * 门窗五金几何工厂：按门窗样式生成把手 / 执手 / 拉手 / 锁扣。
 *
 * 约定（与 builders.ts 一致）：
 * - 返回的 Group 直接挂到「可开启扇」的 Group 下，因此会随门扇旋转 / 推拉一起运动；
 * - 局部 x 沿扇宽、y 沿扇高、z 为扇厚方向，z=0 是扇中心面；
 * - side=+1 表示装在扇的 +z 面、-1 表示 -z 面；外开窗只装 -z 面（室内侧）。
 *
 * 五金全部用复用几何体拼装，无贴图、无外部资源；仅复用 materials.ts 里已有的材质键。
 */

/** 模块级几何缓存：同尺寸五金（每层同类门窗）共用一份 BufferGeometry */
const geoCache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let geo = geoCache.get(key);
  if (!geo) {
    geo = make();
    geoCache.set(key, geo);
  }
  return geo as T;
}

function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  return cached(`b/${w.toFixed(4)}/${h.toFixed(4)}/${d.toFixed(4)}`,
    () => new THREE.BoxGeometry(w, h, d));
}

/** 圆柱轴沿 z（圆底座 / 转轴 / 连接座） */
function cylZ(r: number, len: number): THREE.CylinderGeometry {
  return cached(`cz/${r.toFixed(4)}/${len.toFixed(4)}`, () => {
    const g = new THREE.CylinderGeometry(r, r, len, 12);
    g.rotateX(Math.PI / 2);
    return g;
  });
}

/** 圆柱轴沿 y（竖向长拉手主杆） */
function cylY(r: number, len: number): THREE.CylinderGeometry {
  return cached(`cy/${r.toFixed(4)}/${len.toFixed(4)}`,
    () => new THREE.CylinderGeometry(r, r, len, 12));
}

function ballGeo(r: number): THREE.SphereGeometry {
  return cached(`s/${r.toFixed(4)}`, () => new THREE.SphereGeometry(r, 10, 8));
}

function put(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}

const putBox = (
  parent: THREE.Object3D, mat: THREE.Material,
  w: number, h: number, d: number, x: number, y: number, z: number,
): THREE.Mesh => put(parent, boxGeo(w, h, d), mat, x, y, z);

const putCylZ = (
  parent: THREE.Object3D, mat: THREE.Material,
  r: number, len: number, x: number, y: number, z: number,
): THREE.Mesh => put(parent, cylZ(r, len), mat, x, y, z);

/** 门 / 窗扇面到五金底面的外凸量：让底座正好贴在扇面上，不与门板共面闪烁 */
const FACE_GAP = 0.006;

/** 统一命名五金组，便于浏览器端按 name 统计覆盖情况 / 调试 */
function hardwareGroup(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hardware';
  return group;
}

export interface HandlePlacement {
  /** 安装中心 x（扇局部坐标） */
  x: number;
  /** 安装中心 y（门扇自洞底起算 / 窗扇相对扇中心） */
  y: number;
  /** 扇厚度（米） */
  leafT: number;
}

export interface LeverHandleOptions extends HandlePlacement {
  /** 执手杆伸出方向：+1 朝 +x、-1 朝 -x（应指向扇内、即远离自由边） */
  leverDir: number;
  /** 整体缩放，小窗扇 / 窄门按比例缩小，默认 1 */
  scale?: number;
  /** 是否带长条锁面板（外门 / 入户门） */
  lockPlate?: boolean;
  /** 是否带「有人/无人」指示旋钮（卫生间门，装在 -z 面） */
  indicator?: boolean;
  /** 锁芯 / 旋钮的点缀材质，缺省与主材质相同 */
  accent?: THREE.Material;
}

/**
 * 双面 L 形执手：圆形底座 + 转轴 + 水平执手杆 + 锁芯孔，可选长条锁面板与指示旋钮。
 * 真实住宅平开门执手中心离地 1.0~1.05m，装在远离铰链的自由侧、距边约 6~8cm。
 */
export function createLeverHandleSet(mat: THREE.Material, opts: LeverHandleOptions): THREE.Group {
  const g = hardwareGroup();
  const s = opts.scale ?? 1;
  const face = opts.leafT / 2;
  const accent = opts.accent ?? mat;

  for (const zSide of [1, -1]) {
    const sign = zSide;
    // 长条锁面板（先铺在扇面上，圆底座叠在它上面）
    if (opts.lockPlate) {
      putBox(g, mat, 0.038 * s, 0.22 * s, 0.006 * s,
        opts.x, opts.y, sign * (face + 0.003 * s));
    }
    // 圆底座：内表面贴扇面
    putCylZ(g, mat, 0.028 * s, 0.012 * s,
      opts.x, opts.y, sign * (face + FACE_GAP * s));
    // 转轴
    putCylZ(g, mat, 0.010 * s, 0.018 * s,
      opts.x, opts.y, sign * (face + 0.021 * s));
    // 执手杆：从底座中心朝扇内伸出，末端加圆头
    const rodX = opts.x + opts.leverDir * 0.052 * s;
    const rodZ = sign * (face + 0.030 * s);
    putBox(g, mat, 0.105 * s, 0.014 * s, 0.016 * s, rodX, opts.y, rodZ);
    put(g, ballGeo(0.010 * s), mat,
      opts.x + opts.leverDir * 0.105 * s, opts.y, rodZ);
    // 锁芯孔
    putCylZ(g, accent, 0.007 * s, 0.004 * s,
      opts.x, opts.y - 0.075 * s, sign * (face + 0.012 * s));

    // 指示旋钮只装 -z 面（室内侧）：旋钮 + 一字槽
    if (opts.indicator && zSide === -1) {
      const knobZ = -1 * (face + 0.016 * s);
      putCylZ(g, accent, 0.018 * s, 0.014 * s,
        opts.x, opts.y - 0.095 * s, knobZ);
      putBox(g, mat, 0.024 * s, 0.003 * s, 0.003 * s,
        opts.x, opts.y - 0.095 * s, -1 * (face + 0.025 * s));
    }
  }
  return g;
}

export interface PullHandleOptions extends HandlePlacement {
  /** 装在 +z 面还是 -z 面 */
  side: number;
  /** 拉手总长（米），默认 0.40 */
  length?: number;
  /** 主杆半径（米），默认 0.012 */
  radius?: number;
  /** 连接座 / 端盖点缀材质，缺省与主材质相同 */
  accent?: THREE.Material;
}

/**
 * 竖向长拉手（单面）：一根圆管 + 上下两枚连接座 + 端头球。
 * 用于中式双开铜门、黑铝玻璃推拉门；内外两面各调用一次即成双面拉手。
 */
export function createVerticalPullHandle(mat: THREE.Material, opts: PullHandleOptions): THREE.Group {
  const g = hardwareGroup();
  const L = opts.length ?? 0.40;
  const r = opts.radius ?? 0.012;
  const accent = opts.accent ?? mat;
  const sign = opts.side >= 0 ? 1 : -1;
  const face = opts.leafT / 2;
  const rodZ = sign * (face + 0.045);
  const seatZ = sign * (face + 0.0225);

  put(g, cylY(r, L), mat, opts.x, opts.y, rodZ);
  for (const sy of [-1, 1]) {
    const y = opts.y + sy * (L / 2 - 0.018);
    putCylZ(g, accent, 0.011, 0.045, opts.x, y, seatZ);
    put(g, ballGeo(r * 1.15), accent, opts.x, opts.y + sy * (L / 2), rodZ);
  }
  return g;
}

export interface CasementHandleOptions extends HandlePlacement {
  /** 拨杆伸出方向：+1 朝 +x、-1 朝 -x（指向扇内） */
  leverDir: number;
  /** 安装面，默认 -1（室内侧，外开窗人在室内操作） */
  side?: number;
  /** 整体缩放，小窗格按比例缩小，默认 1 */
  scale?: number;
}

/**
 * 平开窗 7 字执手：窄底板 + 转轴 + 一根短拨杆 + 端头球。
 * 装在可开扇自由侧竖梃中部、只朝室内侧（-z），不随固定玻璃移动。
 */
export function createCasementHandle(mat: THREE.Material, opts: CasementHandleOptions): THREE.Group {
  const g = hardwareGroup();
  const s = opts.scale ?? 1;
  const sign = (opts.side ?? -1) >= 0 ? 1 : -1;
  const face = opts.leafT / 2;

  putBox(g, mat, 0.024 * s, 0.070 * s, 0.010 * s,
    opts.x, opts.y, sign * (face + 0.005 * s));
  putCylZ(g, mat, 0.010 * s, 0.016 * s,
    opts.x, opts.y, sign * (face + 0.016 * s));
  const rodZ = sign * (face + 0.028 * s);
  putBox(g, mat, 0.090 * s, 0.012 * s, 0.012 * s,
    opts.x + opts.leverDir * 0.045 * s, opts.y, rodZ);
  put(g, ballGeo(0.010 * s), mat,
    opts.x + opts.leverDir * 0.090 * s, opts.y, rodZ);
  return g;
}

export interface SlidingLatchOptions extends HandlePlacement {
  /** 安装面，默认 -1（室内侧） */
  side?: number;
  /** 凹槽 / 拨扣点缀材质，缺省与主材质相同 */
  accent?: THREE.Material;
  /** 拨扣伸出的方向：+1 朝 +x、-1 朝 -x */
  leverDir?: number;
}

/** 推拉窗扣手槽：扇自由边竖梃室内侧的一条细长凹槽（用银灰细条表示，不真的挖洞） */
function addFingerPull(g: THREE.Group, mat: THREE.Material, opts: SlidingLatchOptions, sign: number): void {
  const face = opts.leafT / 2;
  // 与锁体 / 扣座保持同一 x（始终落在 0.04m 宽的立边内），改用 y 方向错开 0.11m，
  // 既不压到玻璃，也不与锁体底板共面闪烁。
  putBox(g, mat, 0.014, 0.130, 0.004,
    opts.x, opts.y + 0.11, sign * (face + 0.004));
}

/**
 * 推拉窗月牙锁（锁体）：装在内轨扇自由边的室内侧，底板 + 转轴 + 斜置拨扣 + 扣手槽。
 * 真实塑钢推拉窗不使用杠杆执手，靠旋转月牙扣锁住两扇交接处。
 */
export function createSlidingLatch(mat: THREE.Material, opts: SlidingLatchOptions): THREE.Group {
  const g = hardwareGroup();
  const sign = (opts.side ?? -1) >= 0 ? 1 : -1;
  const face = opts.leafT / 2;
  const accent = opts.accent ?? mat;
  const dir = opts.leverDir ?? 1;

  addFingerPull(g, accent, opts, sign);
  putBox(g, mat, 0.026, 0.075, 0.008,
    opts.x, opts.y, sign * (face + 0.005));
  putCylZ(g, mat, 0.011, 0.016,
    opts.x, opts.y, sign * (face + 0.016));
  // 斜置月牙拨扣：绕 z 旋转 25° 模拟旋扣打开的形态
  const catchMesh = putBox(g, accent, 0.055, 0.012, 0.010,
    opts.x + dir * 0.020, opts.y + 0.008, sign * (face + 0.028));
  catchMesh.rotation.z = dir * THREE.MathUtils.degToRad(25);
  return g;
}

/** 推拉窗月牙锁扣座：装在外轨扇自由边室内侧，与锁体配对；同样带一条扣手槽 */
export function createSlidingLatchStrike(mat: THREE.Material, opts: SlidingLatchOptions): THREE.Group {
  const g = hardwareGroup();
  const sign = (opts.side ?? -1) >= 0 ? 1 : -1;
  const face = opts.leafT / 2;
  const accent = opts.accent ?? mat;
  const dir = opts.leverDir ?? 1;

  addFingerPull(g, accent, opts, sign);
  putBox(g, mat, 0.020, 0.045, 0.012,
    opts.x, opts.y, sign * (face + 0.020));
  putCylZ(g, accent, 0.008, 0.006,
    opts.x + dir * 0.010, opts.y, sign * (face + 0.028));
  return g;
}
