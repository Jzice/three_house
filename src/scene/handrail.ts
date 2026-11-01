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
  /** 平台转角圆弧弯头半径（米） */
  elbowR: number;
}

/** 单根立柱的落地位置（踏步面中心） */
export interface HandrailPost {
  x: number;
  z: number;
  /** 立柱落地标高（踏步面或楼板面） */
  baseY: number;
}

/** 一段连续扶手的构造参数 */
export interface HandrailRunOpts {
  /** 顶扶手中心线起点（世界坐标，y 已含立柱落地 y + railHeight） */
  start: THREE.Vector3;
  /** 顶扶手中心线终点 */
  end: THREE.Vector3;
  /** 立柱（落地位置；立柱高度自动取到顶管中心线） */
  posts: HandrailPost[];
  /** 立柱高度基准（= 顶管中心线到落地面的名义高度，用于横杆/圆钮等距） */
  railHeight: number;
  /** 是否在起点/终点加金属球头（与转角弯头衔接的端头可关闭） */
  startBall?: boolean;
  endBall?: boolean;
  /** 是否生成顶扶手圆管（连续贯通模式下由外部统一管替代，可关闭仅保留立柱/横杆/圆钮） */
  topTube?: boolean;
  /** 共享材质字典 */
  materials: MaterialMap;
  /** 扶手造型参数 */
  params: HandrailParams;
}

const UP = new THREE.Vector3(0, 1, 0);
// 模块级临时向量，避免每次摆放 new
const _dir = new THREE.Vector3();
const _dirH = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _q = new THREE.Quaternion();

function alignYToDir(target: THREE.Object3D, dir: THREE.Vector3): void {
  _dir.copy(dir).normalize();
  _q.setFromUnitVectors(UP, _dir);
  target.quaternion.copy(_q);
}

/**
 * 生成一段连续扶手：顶圆管 + 两端金属球头 + 酒红方柱（柱身沿走向两侧不锈钢装饰圆钮，
 * 与横杆穿柱点一一对齐，柱底金属底座）+ 等距不锈钢横杆（水平段水平、斜段随坡度倾斜）。
 *
 * 立柱由调用方逐根给定落地位置（可贴合楼梯踏步面），库内按落地标高反推其在段上的位置，
 * 使柱顶精确顶到顶管斜线；横杆沿段方向与顶管平行、竖直等距偏移。
 * 所有几何按段尺寸共享实例，仅摆放位置/朝向；一次性生成，渲染循环不 new。
 */
export function createHandrailRun(o: HandrailRunOpts): THREE.Group {
  const { start, end, posts, railHeight, startBall = true, endBall = true, topTube = true, materials, params } = o;
  const { postW, postD, baseW, baseH, handrailD, barCount, barD, barInset, knobD, knobOut } = params;
  const group = new THREE.Group();

  _dir.subVectors(end, start);
  const len = _dir.length();
  _dir.normalize();

  // 水平走向：装饰圆钮/横杆穿柱的方向（斜段取水平投影）
  _dirH.set(_dir.x, 0, _dir.z);
  if (_dirH.lengthSq() < 1e-8) _dirH.set(1, 0, 0);
  else _dirH.normalize();

  // ---- 顶扶手圆管（沿 start→end；连续贯通模式下由外部统一管替代，此项可关闭） ----
  if (topTube) {
    const topGeo = new THREE.CylinderGeometry(handrailD / 2, handrailD / 2, len, 16);
    const top = new THREE.Mesh(topGeo, materials.railing);
    alignYToDir(top, _dir);
    _mid.addVectors(start, end).multiplyScalar(0.5);
    top.position.copy(_mid);
    top.castShadow = false;
    group.add(top);

    // ---- 端头金属球头 ----
    const ballGeo = new THREE.SphereGeometry(handrailD / 2, 16, 12);
    if (startBall) {
      const ball = new THREE.Mesh(ballGeo, materials.stainless);
      ball.position.copy(start);
      ball.castShadow = false;
      group.add(ball);
    }
    if (endBall) {
      const ball = new THREE.Mesh(ballGeo, materials.stainless);
      ball.position.copy(end);
      ball.castShadow = false;
      group.add(ball);
    }
  }

  // ---- 立柱 + 底座 + 沿走向两侧装饰圆钮 ----
  const baseGeo = new THREE.BoxGeometry(baseW, baseH, baseW);
  const knobGeo = new THREE.SphereGeometry(knobD / 2, 14, 10);
  const knobOffset = postD / 2 + knobOut; // 圆钮沿栏杆走向凸出，半厚 = postD/2
  const stepOffset = railHeight / (barCount + 1); // 相邻横杆的竖直间距
  const topDy = end.y - start.y;
  const runLenH = Math.hypot(end.x - start.x, end.z - start.z); // 段水平投影长度

  for (const post of posts) {
    // 按立柱水平位置反推其在段上的占比，使柱顶精确顶到顶管底面（中心线 - 半径），
    // 立柱底部（post.baseY）为其所在踏步 / 楼板顶面，既不插入踏步也不悬空
    let t = 0;
    if (runLenH > 1e-6) {
      const dx = post.x - start.x;
      const dz = post.z - start.z;
      t = THREE.MathUtils.clamp((dx * _dirH.x + dz * _dirH.z) / runLenH, 0, 1);
    }
    const topY = start.y + topDy * t;
    const h = Math.max(0.05, topY - handrailD / 2 - post.baseY);

    const postMesh = new THREE.Mesh(new THREE.BoxGeometry(postW, h, postD), materials.blackPost);
    postMesh.position.set(post.x, post.baseY + h / 2, post.z);
    postMesh.rotation.y = Math.atan2(_dirH.x, _dirH.z); // 薄边沿栏杆走向
    postMesh.castShadow = false;
    group.add(postMesh);

    const base = new THREE.Mesh(baseGeo, materials.stainless);
    base.position.set(post.x, post.baseY + baseH / 2, post.z);
    base.rotation.y = Math.atan2(_dirH.x, _dirH.z);
    base.castShadow = false;
    group.add(base);

    // 圆钮：沿走向前后两面各一列，高度与横杆穿柱点一一对齐
    for (let j = 1; j <= barCount; j++) {
      const y = topY - stepOffset * j;
      for (const s of [1, -1]) {
        const knob = new THREE.Mesh(knobGeo, materials.stainless);
        knob.position.set(
          post.x + _dirH.x * knobOffset * s,
          y,
          post.z + _dirH.z * knobOffset * s,
        );
        knob.castShadow = false;
        group.add(knob);
      }
    }
  }

  // ---- 不锈钢横杆：沿段方向，与顶管平行、竖直等距，两端缩进 ----
  const barLen = Math.max(0.01, len - 2 * barInset);
  const barGeo = new THREE.CylinderGeometry(barD / 2, barD / 2, barLen, 12);
  for (let j = 1; j <= barCount; j++) {
    _pos.addVectors(start, end).multiplyScalar(0.5);
    _pos.y -= stepOffset * j;
    const bar = new THREE.Mesh(barGeo, materials.stainless);
    alignYToDir(bar, _dir);
    bar.position.copy(_pos);
    bar.castShadow = false;
    group.add(bar);
  }

  return group;
}

/**
 * 整楼连续扶手圆管：沿 waypoints（折线，含各转角）用 centripetal CatmullRom 平滑贯通，
 * 转角处自然平滑弯过（无球头、无分段），形成一根连续 PVC 管。
 */
export function createContinuousHandrailTube(
  waypoints: THREE.Vector3[],
  tubeR: number,
  material: THREE.Material,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(waypoints, false, 'centripetal', 0.5);
  const approxLen = curve.getLength();
  const tubular = Math.max(16, Math.ceil(approxLen / 0.08));
  const geo = new THREE.TubeGeometry(curve, tubular, tubeR, 16, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = false;
  return mesh;
}
