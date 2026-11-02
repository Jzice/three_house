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
  /** 横杆根数（不锈钢圆管，沿扶手高度等距） */
  barCount: number;
  /** 横杆直径（米） */
  barD: number;
  /** 横杆两端缩进量（米，缩至首末立柱内侧） */
  barInset: number;
  /** 柱身装饰圆钮直径（米，不锈钢，包裹横杆穿柱点） */
  knobD: number;
  /** 装饰圆钮球心距柱面的凸出量（米） */
  knobOut: number;
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

/** 一段直跑扶手的立柱与横杆构造参数（顶管由 createStraightRailTube 统一生成） */
export interface HandrailRunOpts {
  /** 顶扶手中心线起点（世界坐标，y 为顶管中心标高） */
  start: THREE.Vector3;
  /** 顶扶手中心线终点 */
  end: THREE.Vector3;
  /** 立柱（落地位置；柱顶高度按顶管实轴线反算） */
  posts: HandrailPost[];
  /** 立柱高度基准（= 顶管中心线到落地面的名义高度，用于横杆/圆钮等距） */
  railHeight: number;
  /** 共享材质字典 */
  materials: MaterialMap;
  /** 扶手造型参数 */
  params: HandrailParams;
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
}

/**
 * 计算转角两侧切削量 t = R·tan(θ/2)，供跨楼层交接处共享弯头时预先算出切点。
 * 与 createStraightRailTube 内部半径夹取逻辑完全一致：半径受两侧直段长度约束，
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
const _pos = new THREE.Vector3();
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
 * 生成一段直跑扶手的立柱与横杆（顶管由 createStraightRailTube 统一生成）：
 * 柱底金属底座 + 黑漆斜切顶扁柱（柱身两侧不锈钢圆钮，与横杆穿柱点一一对齐）
 * + 等距拉丝不锈钢横杆（严格平行扶手轴线）。
 *
 * 柱顶高度按**顶管实轴线**反算（中心线 − 管半径/cosθ），而非弦线插值，
 * 因此即使扶手斜段带坡度，柱顶也精确贴住圆管下缘。
 */
export function createHandrailRun(o: HandrailRunOpts): THREE.Group {
  const { start, end, posts, railHeight, materials, params } = o;
  const { postW, postD, baseW, baseH, handrailD, barCount, barD, barInset, knobD, knobOut } = params;
  const group = new THREE.Group();

  _dir.subVectors(end, start);
  const len = _dir.length();
  _dir.normalize();

  // 水平走向：装饰圆钮/横杆穿柱的方向（斜段取水平投影）
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
  const knobGeo = new THREE.SphereGeometry(knobD / 2, 14, 10);
  const knobOffset = postD / 2 + knobOut; // 圆钮沿栏杆走向凸出，半厚 = postD/2
  const stepOffset = railHeight / (barCount + 1); // 相邻横杆的竖直间距
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

    // 圆钮：沿走向前后两面各一列，高度与横杆穿柱点一一对齐
    for (let j = 1; j <= barCount; j++) {
      const y = axisY - stepOffset * j;
      for (const s of [1, -1]) {
        const knob = new THREE.Mesh(knobGeo, materials.stainless);
        knob.position.set(post.x + _dirH.x * knobOffset * s, y, post.z + _dirH.z * knobOffset * s);
        knob.castShadow = false;
        group.add(knob);
      }
    }
  }

  // ---- 拉丝不锈钢横杆：沿段方向、与顶管严格平行，竖直等距，两端缩进 ----
  const barLen = Math.max(0.01, len - 2 * barInset);
  const barGeo = new THREE.CylinderGeometry(barD / 2, barD / 2, barLen, 12);
  for (let j = 1; j <= barCount; j++) {
    _pos.addVectors(start, end).multiplyScalar(0.5);
    _pos.y -= stepOffset * j;
    const bar = new THREE.Mesh(barGeo, materials.stainlessBrushed);
    alignYToDir(bar, _dir);
    bar.position.copy(_pos);
    bar.castShadow = false;
    group.add(bar);
  }

  return group;
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
  const { points, elbowR, tubeR, material } = o;
  const group = new THREE.Group();
  const n = points.length;
  if (n < 2) return group;

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
  if (o.firstDir && o.firstLen !== undefined && n >= 2 && radii[0] === 0) {
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
  if (n >= 2 && radii[n - 1] === 0) {
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
