import * as THREE from 'three';
import type { MaterialMap } from '../types';

/** 扶手造型参数（取自 STAIR 配置，遵循"配置即建模"），由调用方注入 */
export interface HandrailParams {
  /** 立柱截面（扁长方形，米）：垂直栏杆可见宽 */
  postW: number;
  /** 立柱沿栏杆走向的厚度（米）：薄边沿栏杆方向 */
  postD: number;
  /** 立柱底部金属底座边长（米） */
  baseW: number;
  /** 立柱底部金属底座厚度（米） */
  baseH: number;
  /** 顶扶手圆管直径（米） */
  handrailD: number;
  /** 连续钢丝根数（沿扶手高度等距；柱身铆钉数量与之对应） */
  barCount: number;
  /** 柱身半圆铆钉直径（米，不锈钢，位于钢丝穿柱点） */
  knobD: number;
  /** 半圆铆钉平底嵌入柱面的深度（米）：底边被柱体遮住，不露半球空腔 */
  knobEmbed: number;
  /** 转角圆弧半径上限（米），实际半径按相邻直段长度夹取 */
  elbowR: number;
}

/** 单根立柱的落地位置（踏步面中心） */
export interface HandrailPost {
  x: number;
  z: number;
  /** 立柱落地标高（踏步面或楼板面） */
  baseY: number;
}

/** 一段直跑扶手的立柱与半圆铆钉构造参数（顶管 / 连续钢丝另由两个生成器统一生成） */
export interface HandrailRunOpts {
  /** 顶扶手中心线起点（世界坐标，y 为顶管中心标高） */
  start: THREE.Vector3;
  /** 顶扶手中心线终点 */
  end: THREE.Vector3;
  /** 立柱（落地位置；柱顶高度按顶管实轴线反算） */
  posts: HandrailPost[];
  /** 立柱高度基准（= 顶管中心线到落地面的名义高度，用于钢丝/铆钉等距） */
  railHeight: number;
  /** 共享材质字典 */
  materials: MaterialMap;
  /** 扶手造型参数 */
  params: HandrailParams;
}

/**
 * 一条扶手折线的转角几何解算结果：抽出后可在顶管与 4 根钢丝之间共享。
 * 钢丝折线只是顶管折线的整体竖直平移，dirs / lens / 弯头半径与切点完全相同。
 */
export interface RailBends {
  /** 各段单位方向 */
  dirs: THREE.Vector3[];
  /** 各段长度（米） */
  lens: number[];
  /** 各顶点弯头半径（米，0 = 不生成弯头） */
  radii: number[];
  /** 各顶点转角夹角（弧度） */
  thetas: number[];
  /** 各顶点两侧切削量 t = R·tan(θ/2)（米） */
  trims: number[];
}

/** 折线扶手管：每段严格笔直，内部顶点以圆弧转角衔接 */
export interface StraightRailOpts {
  /** 顶扶手中心线折线顶点（世界坐标，含 y） */
  points: THREE.Vector3[];
  /** 转角圆弧半径上限（米） */
  elbowR: number;
  /** 管半径（米） */
  tubeR: number;
  material: THREE.Material;
  /** 首点虚拟前驱方向（单位向量）：使首点也生成转角，用于跨楼层交接处共享弯头 */
  firstDir?: THREE.Vector3;
  /** 首点虚拟前驱段长（米）：转角半径夹取用，保证与相邻楼层段一致 */
  firstLen?: number;
  /** 末点虚拟后继方向（单位向量）：使末点也生成转角 */
  lastDir?: THREE.Vector3;
  /** 末点虚拟后继段长（米） */
  lastLen?: number;
  /** 末点直截量（米，不生成弯头）：仅把末段回退截断，用于楼层交接处封口 */
  lastTrim?: number;
  /**
   * 复用已解算的转角参数（顶管先算、4 根钢丝共用）：
   * 保证细钢丝与顶管在每处弯头完全同心、同切点，不会因管径不同被重新夹取半径。
   */
  bends?: RailBends;
}

/**
 * 计算转角两侧切削量 t = R·tan(θ/2)，供跨楼层交接处共享弯头时预先算出切点。
 * 与 computeRailBends 内部半径夹取逻辑完全一致：半径受两侧直段长度约束，
 * 且保底 R ≥ 1.2·tubeR，否则退化为斜接（返回 0）。
 */
export function elbowTrim(
  dirIn: THREE.Vector3,
  dirOut: THREE.Vector3,
  lenPrev: number,
  lenNext: number,
  elbowR: number,
  tubeR: number,
): number {
  const theta = Math.acos(THREE.MathUtils.clamp(dirIn.dot(dirOut), -1, 1));
  if (theta < MIN_ELBOW_ANGLE || theta > MAX_ELBOW_ANGLE) return 0;
  const tanHalf = Math.tan(theta / 2);
  const r = Math.min(elbowR, lenPrev / (2 * tanHalf), lenNext / (2 * tanHalf));
  if (r < tubeR * 1.2) return 0;
  return r * tanHalf;
}

const UP = new THREE.Vector3(0, 1, 0);
/** 柱顶微插入量（米）：吃掉多边形管壁的弦高，保证顶死不露缝又不冒出扶手 */
const MITER_EMBED = 0.0005;
/** 转角夹角过小视为共线（直接斜接），过大（接近折返）几何退化则跳过 */
const MIN_ELBOW_ANGLE = Math.PI / 180;
const MAX_ELBOW_ANGLE = (Math.PI * 170) / 180;
/** 圆管截面边数：圆柱与圆环共用，保证接缝不错位 */
const TUBE_SEGMENTS = 16;

// 模块级临时向量，避免每次摆放 new
const _dir = new THREE.Vector3();
const _dirH = new THREE.Vector3();
const _knobDir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();

function alignYToDir(target: THREE.Object3D, dir: THREE.Vector3): void {
  _dir.copy(dir).normalize();
  _q.setFromUnitVectors(UP, _dir);
  target.quaternion.copy(_q);
}

/**
 * 立柱几何：方柱，柱顶按扶手坡度斜切。
 * 斜切后顶面与顶管轴线平行、沿柱厚方向等坡升降，柱顶整条母线贴住圆管下缘，
 * 既不留楔形空隙，也绝不会高出扶手表面。
 * @param slopeTan 扶手轴线竖向坡度（上升/水平，局部 +z 为扶手走向）
 */
function createPostGeometry(w: number, h: number, d: number, slopeTan: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (Math.abs(slopeTan) > 1e-4) {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const top = h / 2;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > top - 1e-6) pos.setY(i, top + slopeTan * pos.getZ(i));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * 生成一段直跑扶手的立柱与柱身半圆铆钉（顶管 / 连续钢丝由
 * createStraightRailTube / createRailWires 统一生成）：
 * 柱底金属底座 + 黑漆斜切顶扁柱（柱身前后两面各一列银白半圆铆钉，
 * 与 4 根钢丝穿柱点一一对齐，凸出方向沿栏杆走向）。
 *
 * 柱顶高度按**顶管实轴线**反算（中心线 − 管半径/cosθ），而非弦线插值，
 * 因此即使扶手斜段带坡度，柱顶也精确贴住圆管下缘。
 */
export function createHandrailRun(o: HandrailRunOpts): THREE.Group {
  const { start, end, posts, railHeight, materials, params } = o;
  const { postW, postD, baseW, baseH, handrailD, barCount, knobD, knobEmbed } = params;
  const group = new THREE.Group();

  _dir.subVectors(end, start);
  const len = _dir.length();
  _dir.normalize();

  // 水平走向：半圆铆钉的凸出方向（斜段取水平投影）
  // 注意 runLenH 必须是**水平投影长度**（米），不能用单位向量的水平分量
  const runLenH = Math.hypot(end.x - start.x, end.z - start.z);
  _dirH.set(_dir.x, 0, _dir.z);
  if (runLenH < 1e-8) _dirH.set(1, 0, 0);
  else _dirH.normalize();

  const topDy = end.y - start.y;
  // 斜段把"沿轴"的半径投影到竖向：柱顶需再上抬 r/cosθ 才贴到圆管下缘
  const cosT = Math.max(0.2, runLenH / len);
  // 局部 +z（扶手走向）上的竖向坡度，用于柱顶等坡斜切
  const slopeTan = topDy / Math.max(1e-6, runLenH);

  const baseGeo = new THREE.BoxGeometry(baseW, baseH, baseW);
  // 半球铆钉：SphereGeometry 上半球（赤平面落在球心），旋转后凸面朝柱外
  const knobGeo = new THREE.SphereGeometry(knobD / 2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const knobOffset = postD / 2 - knobEmbed; // 平底略嵌入柱面，底边不露半球空腔
  const stepOffset = railHeight / (barCount + 1); // 相邻钢丝的竖直间距
  const yaw = Math.atan2(_dirH.x, _dirH.z);

  for (const post of posts) {
    // 按立柱水平位置反推其在段上的占比，求顶管轴线在该柱位的标高
    let t = 0;
    if (runLenH > 1e-6) {
      const dx = post.x - start.x;
      const dz = post.z - start.z;
      t = THREE.MathUtils.clamp((dx * _dirH.x + dz * _dirH.z) / runLenH, 0, 1);
    }
    const axisY = start.y + topDy * t;
    // 柱顶标高 = 轴线 − 管半径/cosθ + 微插入：柱身始终在扶手下方
    const topY = axisY - handrailD / 2 / cosT + MITER_EMBED;
    const h = Math.max(0.05, topY - post.baseY);

    const postMesh = new THREE.Mesh(createPostGeometry(postW, h, postD, slopeTan), materials.blackPost);
    postMesh.position.set(post.x, post.baseY + h / 2, post.z);
    postMesh.rotation.y = yaw; // 薄边沿栏杆走向
    postMesh.castShadow = false;
    group.add(postMesh);

    const base = new THREE.Mesh(baseGeo, materials.stainless);
    base.position.set(post.x, post.baseY + baseH / 2, post.z);
    base.rotation.y = yaw;
    base.castShadow = false;
    group.add(base);

    // 半圆铆钉：沿走向前后两面各一列，高度与钢丝穿柱点一一对齐
    for (let j = 1; j <= barCount; j++) {
      const y = axisY - stepOffset * j;
      for (const s of [1, -1]) {
        const knob = new THREE.Mesh(knobGeo, materials.railWire);
        knob.position.set(post.x + _dirH.x * knobOffset * s, y, post.z + _dirH.z * knobOffset * s);
        // 半球默认凸向 +Y：把 +Y 旋到 ±_dirH，使平底贴柱面、凸面朝柱外
        _knobDir.copy(_dirH).multiplyScalar(s);
        knob.quaternion.setFromUnitVectors(UP, _knobDir);
        knob.castShadow = false;
        group.add(knob);
      }
    }
  }

  return group;
}

/**
 * 解算一条扶手折线的直段方向、长度与各顶点弯头半径 / 切点。
 * 顶管调用一次，再把结果传给 4 根钢丝复用，确保转角处严格同心。
 */
export function computeRailBends(o: StraightRailOpts): RailBends {
  const { points, elbowR, tubeR } = o;
  const n = points.length;
  const dirs: THREE.Vector3[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const v = new THREE.Vector3().subVectors(points[i + 1], points[i]);
    lens.push(v.length());
    dirs.push(v.clone().normalize());
  }

  // 每个内部顶点的圆弧半径与两侧切削量（端点无转角，切削量为 0）
  const radii = new Array<number>(n).fill(0);
  const thetas = new Array<number>(n).fill(0);
  const trims = new Array<number>(n).fill(0);
  if (n < 2) return { dirs, lens, radii, thetas, trims };
  for (let i = 1; i < n - 1; i++) {
    const dIn = dirs[i - 1];
    const dOut = dirs[i];
    const theta = Math.acos(THREE.MathUtils.clamp(dIn.dot(dOut), -1, 1));
    thetas[i] = theta;
    if (theta < MIN_ELBOW_ANGLE || theta > MAX_ELBOW_ANGLE) continue;
    const tanHalf = Math.tan(theta / 2);
    // 半径受两侧直段长度约束：两侧切削量之和不超过该段长度（各占一半）
    const r = Math.min(elbowR, lens[i - 1] / (2 * tanHalf), lens[i] / (2 * tanHalf));
    if (r < tubeR * 1.2) continue; // 半径过小则退化为斜接，避免圆环自穿
    radii[i] = r;
    trims[i] = r * tanHalf;
  }

  // ---- 端点转角（跨楼层交接处共享弯头）：用虚拟前驱/后继段长夹取半径 ----
  // 首点：虚拟前驱 dir 从相邻楼层段来，段长 firstLen，保证与对方段算出同一切点
  if (o.firstDir && o.firstLen !== undefined && radii[0] === 0) {
    const dIn = o.firstDir.clone().normalize();
    const dOut = dirs[0];
    const theta = Math.acos(THREE.MathUtils.clamp(dIn.dot(dOut), -1, 1));
    thetas[0] = theta;
    if (theta >= MIN_ELBOW_ANGLE && theta <= MAX_ELBOW_ANGLE) {
      const tanHalf = Math.tan(theta / 2);
      const r = Math.min(elbowR, o.firstLen / (2 * tanHalf), lens[0] / (2 * tanHalf));
      if (r >= tubeR * 1.2) { radii[0] = r; trims[0] = r * tanHalf; }
    }
  }
  // 末点：优先虚拟后继转角（共享弯头），否则显式直截（楼层封口）
  if (radii[n - 1] === 0) {
    if (o.lastDir && o.lastLen !== undefined) {
      const dIn = dirs[n - 2];
      const dOut = o.lastDir.clone().normalize();
      const theta = Math.acos(THREE.MathUtils.clamp(dIn.dot(dOut), -1, 1));
      thetas[n - 1] = theta;
      if (theta >= MIN_ELBOW_ANGLE && theta <= MAX_ELBOW_ANGLE) {
        const tanHalf = Math.tan(theta / 2);
        const r = Math.min(elbowR, lens[n - 2] / (2 * tanHalf), o.lastLen / (2 * tanHalf));
        if (r >= tubeR * 1.2) { radii[n - 1] = r; trims[n - 1] = r * tanHalf; }
      }
    } else if (o.lastTrim !== undefined) {
      trims[n - 1] = o.lastTrim;
    }
  }

  return { dirs, lens, radii, thetas, trims };
}

/**
 * 整楼扶手圆管：按折线逐段生成**直圆柱**（自带端盖），内部顶点处用**圆弧转角**衔接。
 *
 * - 直段轴心严格等于折线方向 → 斜段自然平行梯段坡度，不再被平滑算法带弯；
 * - 转角半径按相邻两段长度夹取（本项目休息平台横移仅 0.16m，需收敛到 0.08）；
 * - 圆柱端盖与圆环端截面同径同面，接缝无缝且无 z-fighting；
 * - 各层扶手作为独立对象挂到对应楼层 root，末端圆柱自带端盖即天然在楼层交接处封口。
 */
export function createStraightRailTube(o: StraightRailOpts): THREE.Group {
  const { points, tubeR, material } = o;
  const group = new THREE.Group();
  const n = points.length;
  if (n < 2) return group;

  // 顶管自行解算；4 根钢丝复用顶管的 bends（折线只改 y 与管半径），
  // 从而共用同一套弯头半径 / 切点，转角处严格同心。
  const { dirs, radii, thetas, trims } = o.bends ?? computeRailBends(o);

  // ---- 直段：圆柱（自带端盖），严格沿折线方向 ----
  for (let i = 0; i < n - 1; i++) {
    const S = points[i].clone().addScaledVector(dirs[i], trims[i]);
    const E = points[i + 1].clone().addScaledVector(dirs[i], -trims[i + 1]);
    const len = S.distanceTo(E);
    if (len < 1e-4) continue; // 两侧圆弧相切，直段收敛为 0
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, len, TUBE_SEGMENTS, 1, false), material);
    alignYToDir(mesh, dirs[i]);
    mesh.position.addVectors(S, E).multiplyScalar(0.5);
    mesh.castShadow = false;
    group.add(mesh);
  }

  // ---- 转角：圆弧弯头（含首末点虚拟前驱/后继转角，用于跨楼层共享弯头） ----
  for (let i = 0; i < n; i++) {
    const R = radii[i];
    if (R <= 0) continue;
    // 端点用虚拟前驱/后继方向，内部顶点用相邻折线方向
    let dIn: THREE.Vector3, dOut: THREE.Vector3;
    if (i === 0 && o.firstDir) { dIn = o.firstDir.clone().normalize(); dOut = dirs[0]; }
    else if (i === n - 1 && o.lastDir) { dIn = dirs[n - 2]; dOut = o.lastDir.clone().normalize(); }
    else if (i > 0 && i < n - 1) { dIn = dirs[i - 1]; dOut = dirs[i]; }
    else continue; // 端点无虚拟邻居：不生成转角
    const theta = thetas[i];
    const sinT = Math.sin(theta);
    if (sinT < 1e-6) continue;
    const cosT = Math.cos(theta);
    // e1 为局部 +X（弧起点方向），e2 = dIn 为局部 +Y，保证弧的起止切向与两侧直段一致
    _e1.copy(dIn).multiplyScalar(cosT).sub(dOut).multiplyScalar(1 / sinT);
    _e2.copy(dIn);
    _e3.crossVectors(_e1, _e2);
    const center = points[i].clone().addScaledVector(dIn, -trims[i]).addScaledVector(_e1, -R);
    const tubular = Math.max(6, Math.ceil(theta / (Math.PI / 18)));
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(R, tubeR, TUBE_SEGMENTS, tubular, theta), material);
    _m.makeBasis(_e1, _e2, _e3);
    mesh.quaternion.setFromRotationMatrix(_m);
    mesh.position.copy(center);
    mesh.castShadow = false;
    group.add(mesh);
  }

  return group;
}

/** 连续钢丝生成参数：与顶管共用同一份折线与转角解算结果 */
export interface RailWireOpts {
  /** 顶管的完整折线参数（须已带 bends） */
  top: StraightRailOpts;
  /** 钢丝根数 */
  barCount: number;
  /** 钢丝直径（米） */
  barD: number;
  /** 立柱高度基准（米）：竖距 = railHeight / (barCount + 1) */
  railHeight: number;
  /** 银白细微拉丝不锈钢材质 */
  material: THREE.Material;
  /** 端头保护铆钉直径（米，整球球头）；为 0 则不生成 */
  wireCapD: number;
  /** 首端是否封头：仅整栋楼真实外露端置 true（1F 起步端 / 3F 洞口护栏西端） */
  capStart?: boolean;
  /** 末端是否封头：楼层交接端一律 false，避免打断共享弯头的连续观感 */
  capEnd?: boolean;
}

/**
 * 求钢丝折线的两个真实端面中心：端面不是折线顶点，而是**弯头切点**。
 * 首点带共享弯头时端面在虚拟前驱方向的切点，末点带弯头时在虚拟后继方向的切点；
 * 无弯头（含 lastTrim 直截）则按相邻直段方向与 trims 回退。
 */
function railWireEnds(o: StraightRailOpts, bends: RailBends): { head: THREE.Vector3; tail: THREE.Vector3 } {
  const { points, firstDir, lastDir } = o;
  const n = points.length;
  const { dirs, radii, trims } = bends;
  const head = radii[0] > 0 && firstDir
    ? points[0].clone().addScaledVector(firstDir.clone().normalize(), -trims[0])
    : points[0].clone().addScaledVector(dirs[0], trims[0]);
  const tail = radii[n - 1] > 0 && lastDir
    ? points[n - 1].clone().addScaledVector(lastDir.clone().normalize(), trims[n - 1])
    : points[n - 1].clone().addScaledVector(dirs[n - 2], -trims[n - 1]);
  return { head, tail };
}

/**
 * 4 根连续钢丝：把顶管折线按竖距整体下移，逐根复用 createStraightRailTube 生成
 * 「笔直直管 + 圆弧弯头」。因此休息平台横移、跨楼层共享弯头、3F 洞口护栏东端
 * 下弯处都与顶扶手同样连续弯过，不再逐跑断开、不再两端缩进。
 *
 * 钢丝复用顶管的 bends（同一套 dirs / 弯头半径 / 切点），折线只是整体竖直平移，
 * 故每个转角处严格同心；末点 lastTrim 封口也与顶管一致，仅显单层时切口齐平。
 *
 * 端头保护：仅在调用方标记的真实外露端加整球球头铆钉，球心落在按切点解算出的
 * 实际端面上，内半嵌住 9mm 钢丝断面、外半成圆头；楼层交接端一律不封。
 */
export function createRailWires(o: RailWireOpts): THREE.Group {
  const group = new THREE.Group();
  const step = o.railHeight / (o.barCount + 1);
  const bends = o.top.bends ?? computeRailBends(o.top);
  const capped = (o.capStart || o.capEnd) && o.wireCapD > 0;
  const capTargets: Array<{ on: boolean | undefined; at: THREE.Vector3 }> | null = capped
    ? (() => {
        const ends = railWireEnds(o.top, bends);
        return [{ on: o.capStart, at: ends.head }, { on: o.capEnd, at: ends.tail }];
      })()
    : null;
  const capGeo = capTargets ? new THREE.SphereGeometry(o.wireCapD / 2, 16, 12) : null;

  for (let j = 1; j <= o.barCount; j++) {
    const dy = step * j;
    const points = o.top.points.map((p) => new THREE.Vector3(p.x, p.y - dy, p.z));
    group.add(createStraightRailTube({
      ...o.top,
      points,
      tubeR: o.barD / 2,
      material: o.material,
      bends,
    }));
    if (capGeo && capTargets) {
      for (const t of capTargets) {
        if (!t.on) continue;
        const cap = new THREE.Mesh(capGeo, o.material);
        cap.position.set(t.at.x, t.at.y - dy, t.at.z);
        cap.castShadow = false;
        group.add(cap);
      }
    }
  }
  return group;
}
