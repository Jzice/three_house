import * as THREE from 'three';
import type {
  FpsWalkArea,
  InteractiveObject,
  KeyState,
  RailSeg,
  StairHeight,
  StairSurface,
  TouchMove,
  ViewMode,
  WalkRect,
} from '../types';
import type { SceneContext } from '../scene/sceneSetup';
import { VIEW, FLOORS, W, D, getFpsWalkArea, getStairSurface, stairHeightAt, GROUND_Y } from '../config/houseConfig';

/** 单层的视角状态：模式 + 上帝/第一人称相机与朝向 */
export interface ViewState {
  mode: ViewMode;
  tpsPos: THREE.Vector3;
  tpsTarget: THREE.Vector3;
  fpsPos: THREE.Vector3;
  fpsYaw: number;
  fpsPitch: number;
  /** 累加沿视线方向的前进脉冲（米，正=前进）；由滚轮/双指捏合事件驱动，每帧被 updateFpsMovement 消费 */
  addFpsForward(amount: number): void;
}

export interface ViewManager {
  /** 当前活动楼层序号 */
  readonly activeFloor: number;
  setMode(mode: ViewMode): void;
  /** 切换活动楼层（保持当前模式，恢复该层记忆的相机） */
  setActiveFloor(floor: number): void;
  /** 第一人称小地图显隐（仅在该模式下实际生效；非 FPS 时仅记忆状态） */
  setMinimapVisible(visible: boolean): void;
  /** 当前小地图是否可见 */
  getMinimapVisible(): boolean;
  updateFpsMovement(keys: KeyState, touchMove?: TouchMove | null): void;
  /** 记录当前上帝视角相机（每层独立保存，切层/切模式后可恢复） */
  saveTpsView(): void;
  /** 当前活动楼层的模式 */
  getMode(): ViewMode;
  /** 当前活动楼层的视角状态 */
  getState(): ViewState;
  /** 当前 UI 指示楼层（按钮 / 小地图所用：按完成面判定"已到达楼层"，与可见层解耦） */
  getUiFloor(): number;
}

const FPS_SPEED = 0.08;
const FPS_EYE_Y = 1.6;
/** 前进脉冲累加器（米，正=前进）：滚轮 / 双指捏合等离散事件写入，每帧由 updateFpsMovement 消费 */
let fpsMoveImpulse = 0;
/** 俯仰角限位，避免翻转 */
const PITCH_LIMIT = Math.PI / 2 - 0.1;
/** 门窗开合插值系数 */
const OPEN_LERP = 0.15;
/** 眼高跟随脚下标高的平滑时间常数（秒）：台阶高度按此做插值过渡 */
const EYE_SMOOTH_TAU = 0.09;
/** 楼梯面匹配的最大高度差（米）：层间两段楼梯相差约 3m，超过此值视为不在脚下 */
const STAIR_MATCH_LIMIT = 1.0;
/** 第一人称玩家半径（米）：墙体碰撞按此缓冲外扩，贴墙可滑动、不可穿入 */
const PLAYER_R = 0.25;

/** 各层的第一人称可行走范围（房屋内部 + 门洞通道 + 院子） */
const walkAreas: FpsWalkArea[] = FLOORS.map((f) => getFpsWalkArea(f));
/** 各层的楼梯行走面（无楼梯为 null） */
const stairSurfaces: (StairSurface | null)[] = FLOORS.map((f) => getStairSurface(f));
/** 各楼梯段休息台顶面标高（脚高）：baseY + platformH；无楼梯的楼层段为 -Infinity */
const stairLandingY = FLOORS.map((f) => (f.stair ? f.baseY + f.stair.platformH : -Infinity));


/** 点是否落在矩形区域内 */
function inRect(r: WalkRect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** 俯视 2D 中，点 (px,pz) 到线段 (r.x0,r.z0)-(r.x1,r.z1) 的最短距离 */
function pointSegDist2D(px: number, pz: number, r: RailSeg): number {
  const dx = r.x1 - r.x0;
  const dz = r.z1 - r.z0;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return Math.hypot(px - r.x0, pz - r.z0);
  let t = ((px - r.x0) * dx + (pz - r.z0) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = r.x0 + t * dx;
  const cz = r.z0 + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * 点是否在院子斜围墙的内侧（半平面判定）：
 * 直线 A→B 的叉积 > 0 表示位于西南侧，即院内。
 */
function insideSlope(s: { ax: number; az: number; bx: number; bz: number }, x: number, z: number): boolean {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  return dx * (z - s.az) - dz * (x - s.ax) > 0;
}

// 复用临时向量，避免每帧分配
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * 上帝视角：当前活动层可见整体体量（活动层及其以下各层）的竖向顶标高（自地面 0 起算）。
 * 第三人称显示整体楼栋，机位据此把整栋框入画面中部。
 */
function visibleMassTop(index: number): number {
  const f = FLOORS[index];
  if (f.wallH > 0) return f.baseY + f.wallH; // 楼层：至墙顶
  const r = f.roof; // 屋顶层：屋面板顶 + 女儿墙顶
  return f.baseY + (r?.slabT ?? 0) + (r?.parapetH ?? 0);
}

/**
 * 上帝视角机位（按可见整体体量自适应）：
 * - 目标点取体量竖向中心 → 建筑落在屏幕正中；
 * - 机位沿固定水平方位 + 固定俯角，体量更高时自动后拉，保证整栋入画。
 */
function computeTpsFrame(index: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const top = visibleMassTop(index);
  const targetY = top / 2; // 体量竖向中心 → 屏幕中心
  const [dx, dz] = VIEW.tpsPos;
  const d0 = Math.hypot(dx, dz); // 水平距离基准
  const hx = dx / d0;
  const hz = dz / d0; // 目标点→相机的水平单位向量
  // 楼体足迹相对目标点的水平半尺寸：b 沿视线方向（近端深度）、a 垂直视线方向（宽度）
  const b = Math.abs((W / 2) * hx) + Math.abs((D / 2) * hz);
  const a = Math.abs((W / 2) * hz) + Math.abs((D / 2) * hx);
  const th = THREE.MathUtils.degToRad(VIEW.tpsAngle);
  const tau = Math.tan(THREE.MathUtils.degToRad(VIEW.fov) / 2);
  const m = VIEW.tpsMargin;
  const half = top / 2; // 体量竖向半高
  // 竖向入画：近端底角不得超出画面
  const needV = (m / tau) * (b * Math.sin(th) + half * Math.cos(th)) + b * Math.cos(th) - half * Math.sin(th);
  // 横向入画：按最小宽高比保守求解
  const needH = b * Math.cos(th) + half * Math.sin(th) + (m * a) / (tau * VIEW.tpsMinAspect);
  const L = Math.max(needV, needH, d0 / Math.cos(th)); // 不比基准机位更近
  return {
    target: new THREE.Vector3(VIEW.tpsTarget[0], targetY, VIEW.tpsTarget[1]),
    pos: new THREE.Vector3(
      VIEW.tpsTarget[0] + hx * L * Math.cos(th),
      targetY + L * Math.sin(th),
      VIEW.tpsTarget[1] + hz * L * Math.cos(th),
    ),
  };
}

/** 生成某层的初始视角状态（上帝视角机位按可见整体体量自适应） */
function createFloorState(index: number): ViewState {
  const f = FLOORS[index];
  const { pos, target } = computeTpsFrame(index);
  return {
    mode: 'tps',
    tpsPos: pos,
    tpsTarget: target,
    fpsPos: new THREE.Vector3(VIEW.fpsPos[0], f.baseY + FPS_EYE_Y, VIEW.fpsPos[2]),
    fpsYaw: 0,
    fpsPitch: 0,
    addFpsForward: (amount: number) => {
      // 仅第一人称下累加；本方法挂在由 getState() 返回的活动层 state 上，mode 即当前模式
      if (floorStates[index] && floorStates[index].mode === 'fps') fpsMoveImpulse += amount;
    },
  };
}

const floorStates: ViewState[] = FLOORS.map((_, i) => createFloorState(i));

/**
 * 视角管理器：负责三种模式下的相机、控制器与画布可见性切换，
 * 并为每一层分别保存模式与相机状态（切换楼层后互不干扰）。
 * @param onEnter2D 进入 2D 模式时需要重绘平面图
 * @param setFloorVisible 由外部控制各楼层 3D 组的可见性
 * @param isDoorOpen 查询某层指定 id 的门是否开启（用于第一人称能否穿出该门洞）
 * @param onAutoFloor 第一人称走楼梯自动切层时通知外部同步 UI（按钮高亮 / 小地图重绘）
 */
export function createViewManager(
  ctx: SceneContext,
  canvas2D: HTMLCanvasElement,
  onEnter2D: () => void,
  setFloorVisible: (floor: number, visible: boolean, ceilingVisible: boolean) => void,
  isDoorOpen?: (floor: number, id: string) => boolean,
  onAutoFloor?: (floor: number) => void,
): ViewManager {
  const { camera, controls, renderer } = ctx;
  let activeFloor = 0;
  /** 第一人称小地图是否可见（按钮切换；仅 FPS 模式下实际显示） */
  let minimapVisible = true;
  /** 第一人称脚下标高（当前所踩踏面/完成面的绝对高度） */
  let groundY = FLOORS[0].baseY;
  /** 第一人称所属楼层（人在哪一层：楼梯半层归属下层楼层；离开楼梯后保持） */
  let levelFloor = 0;
  /** 第一人称 UI 指示楼层（按钮 / 小地图）：按完成面判定"已到达楼层"，与可见层（休息台即切上层）解耦 */
  let uiFloor = 0;
  /** 上一帧移动更新的时刻（用于眼高插值的帧率无关平滑） */
  let lastMoveTime = performance.now();

  /**
   * 可见性：
   * - 2D：全隐藏。
   * - 上帝视角：**显示活动层及其以下各层**（整体楼栋预览，与改前一致）；
   *   楼梯扶手按楼层各自成组，随楼层可见性整体显隐，在楼层交接处自然封口。
   * - 第一人称：显示**完整楼栋**（含上方各层墙体、楼板与屋顶），使楼梯井四周可见 2F 实墙遮挡、
   *   顶端由屋顶板封顶，不再透出天空；同时上层真实楼板即充当天花板。
   * 天花板（= 上层楼板底面的替身）仅在该层「上方楼层被隐藏」时显示，避免与上层真实楼板重复渲染/闪烁。
   */
  function applyVisibility(): void {
    const mode = floorStates[activeFloor].mode;
    const N = floorStates.length;
    // 各层主组可见性：上帝视角显示活动层及其以下；第一人称全显示
    const mainVisible = floorStates.map((_, i) =>
      mode === '2d' ? false : mode === 'fps' ? true : i <= activeFloor,
    );
    // 天花板替身：仅第一人称且“上层（i+1）不可见”时显示（上层可见时其楼板自身即天花板）
    const ceilingVisible = floorStates.map(
      (_, i) => mode === 'fps' && i < N - 1 && !mainVisible[i + 1],
    );
    floorStates.forEach((_, i) => {
      setFloorVisible(i, mainVisible[i], ceilingVisible[i]);
    });
  }

  function setMode(mode: ViewMode): void {
    const st = floorStates[activeFloor];
    st.mode = mode;

    if (mode === 'tps') {
      controls.enabled = true;
      canvas2D.style.display = 'none';
      canvas2D.classList.remove('minimap');
      renderer.domElement.style.display = 'block';
      camera.position.copy(st.tpsPos);
      controls.target.copy(st.tpsTarget);
      controls.update();
    } else if (mode === 'fps') {
      controls.enabled = false;
      // 第一人称：2D 图纸以小地图常驻右下角，随楼层切换（尺寸由 draw 按 getMode 决定）
      canvas2D.style.display = minimapVisible ? 'block' : 'none';
      canvas2D.classList.toggle('minimap', minimapVisible);
      renderer.domElement.style.display = 'block';
      // 进入第一人称重置为标准视野，触摸板捏合缩放从默认 FOV 起算
      camera.fov = VIEW.fov;
      camera.updateProjectionMatrix();
      camera.position.copy(st.fpsPos);
      // 脚下标高按当前位置重算（可能正站在楼梯上），眼高随之对齐，并重置平滑计时
      levelFloor = activeFloor;
      uiFloor = activeFloor;
      groundY = resolveGround(
        walkAreas[activeFloor],
        camera.position.x,
        camera.position.z,
        FLOORS[activeFloor].baseY,
      ).step;
      camera.position.y = groundY + FPS_EYE_Y;
      lastMoveTime = performance.now();
      st.fpsYaw = 0;
      st.fpsPitch = 0;
      tmpEuler.set(0, 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
    } else {
      controls.enabled = false;
      canvas2D.style.display = 'block';
      canvas2D.classList.remove('minimap');
      renderer.domElement.style.display = 'none';
      onEnter2D();
    }
    applyVisibility();
  }

  /** 切换活动楼层：保持当前视角模式（相机状态仍按层记忆），恢复该层对应相机 */
  function setActiveFloor(floor: number): void {
    if (floor === activeFloor) return;
    const mode = floorStates[activeFloor].mode;
    activeFloor = floor;
    uiFloor = floor;
    const st = floorStates[activeFloor];
    st.mode = mode;

    if (mode === 'tps') {
      camera.position.copy(st.tpsPos);
      controls.target.copy(st.tpsTarget);
      controls.update();
    } else if (mode === 'fps') {
      camera.position.copy(st.fpsPos);
      // 脚下标高按当前位置重算（可能正站在楼梯上），眼高随之对齐
      levelFloor = activeFloor;
      groundY = resolveGround(
        walkAreas[activeFloor],
        camera.position.x,
        camera.position.z,
        FLOORS[activeFloor].baseY,
      ).step;
      camera.position.y = groundY + FPS_EYE_Y;
      lastMoveTime = performance.now();
      st.fpsYaw = 0;
      st.fpsPitch = 0;
      tmpEuler.set(0, 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
    }
    // 2D 模式无需相机，平面图由外部在切层后重绘
    applyVisibility();
  }

  function setMinimapVisible(visible: boolean): void {
    minimapVisible = visible;
    if (floorStates[activeFloor].mode === 'fps') {
      canvas2D.style.display = visible ? 'block' : 'none';
      canvas2D.classList.toggle('minimap', visible);
    }
  }

  function getMinimapVisible(): boolean {
    return minimapVisible;
  }

  /**
   * 第一人称可行走判定：屋内 / 门洞通道 / 院子(含阳台) / 院外有界地面，且不被墙/柱/关门阻挡。
   * 门洞通道需对应门处于开启状态才可**进入**；已在门洞内时（门在脚下被关上的情形）仍可自由挪动，避免卡死。
   * 墙体/承重柱（area.solids）恒阻挡（按玩家半径外扩）；门洞缺口（area.gaps）仅关门时阻挡，开门放行。
   * @param fromInside 本次移动前人是否位于屋内（屋内 → 门洞需开门；门洞/院内 → 门洞可通行）
   */
  function isWalkable(area: FpsWalkArea, x: number, z: number, fromInside: boolean): boolean {
    if (area.freeRoam) return true; // 上层完全放开：穿墙/悬空均可
    // 栏杆障碍：在任一栏杆线段的缓冲带内一律不可行走（无论是否落在屋内矩形）
    for (const r of area.rails) {
      if (pointSegDist2D(x, z, r) < r.half) return false;
    }
    // 允许区域：屋内 / 门洞通道 / 院子(含阳台) / 院外有界地面
    const regionOk =
      inRect(area.inside, x, z) ||
      area.doors.some((d) => {
        if (!inRect(d, x, z)) return false;
        if (d.id && fromInside && !isDoorOpenNow(d.id)) return false; // 门未开 → 不可穿出
        return true;
      }) ||
      area.yard.some((r) => inRect(r, x, z) && (!area.slope || insideSlope(area.slope, x, z))) ||
      (area.outside != null && inRect(area.outside, x, z));
    if (!regionOk) return false;
    // 墙体/承重柱：玩家半径外扩后命中即阻挡（贴墙可滑动、不可穿入）
    for (const s of area.solids) {
      if (x >= s.x0 - PLAYER_R && x <= s.x1 + PLAYER_R && z >= s.z0 - PLAYER_R && z <= s.z1 + PLAYER_R) return false;
    }
    // 门洞缺口：仅关门时阻挡（开门放行；同时修复"门外可穿关门"的既有 bug）
    for (const g of area.gaps) {
      if (isDoorOpenNow(g.id)) continue;
      if (x >= g.x0 - PLAYER_R && x <= g.x1 + PLAYER_R && z >= g.z0 - PLAYER_R && z <= g.z1 + PLAYER_R) return false;
    }
    return true;
  }

  /** 当前层指定 id 的门是否处于开启状态（未接入查询时视为可通行） */
  function isDoorOpenNow(id: string): boolean {
    if (!isDoorOpen) return true;
    return isDoorOpen(activeFloor, id);
  }

  /**
   * 求脚下高度：优先取活动层及其相邻层楼梯面上的高度。
   * 同一 (x,z) 可能同时存在上下两层楼梯（两跑上下叠放），按与当前脚下高度的接近程度取舍
   * （层间差约 3m，超过阈值即视为不在脚下这一段）。
   * 不在楼梯上则取平层：屋外按院子铺装台面；屋内按**所属楼层**（粘性记忆，离开楼梯后仍保持）的完成面。
   */
  function resolveGround(area: FpsWalkArea, x: number, z: number, current: number): StairHeight {
    let best: StairHeight | null = null;
    let bestDiff = Infinity;
    for (const f of [activeFloor - 1, activeFloor, activeFloor + 1]) {
      if (f < 0 || f >= FLOORS.length) continue;
      const s = stairSurfaces[f];
      if (!s) continue;
      const hit = stairHeightAt(s, x, z);
      if (!hit) continue;
      const diff = Math.abs(hit.step - current);
      if (diff > STAIR_MATCH_LIMIT) continue;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = hit;
      }
    }
    if (best) {
      // 在楼梯上：所属楼层由脚下标高决定（爬到上段顶端即进入上一层；半层平台归属下层）
      levelFloor = floorForHeight(best.step);
      return best;
    }
    if (!inRect(area.inside, x, z)) {
      // 院外有界地面按自然地面标高；院子/阳台按各自 yardTopY（上层阳台 = 楼层 baseY）
      const onOutside =
        area.outside != null && inRect(area.outside, x, z) && !area.yard.some((r) => inRect(r, x, z));
      const gy = onOutside ? GROUND_Y : area.yardTopY;
      return { step: gy, cont: gy };
    }
    const level = FLOORS[levelFloor].baseY;
    return { step: level, cont: level };
  }

  /**
   * 由脚下标高推出人当前属于哪一层：取标高不超过该值的最高层。
   * 楼梯自本层完成面升至上层完成面，故到达上层完成面即归入上层。
   */
  function floorForHeight(h: number): number {
    let f = 0;
    for (let i = 0; i < FLOORS.length; i++) {
      if (h >= FLOORS[i].baseY - 0.02) f = i;
    }
    return f;
  }

  /**
   * 由脚下标高推出第一人称"应处于的活动层"——用于上下楼自动切层（可见层）。
   * 落在第 g 段楼梯（FLOORS[g].baseY ≤ 脚高 < FLOORS[g+1].baseY）时，
   * 脚高越过该段休息台即归上层（g+1），否则归下层（g）；休息台本身归上层。
   * 平层 / 高于所有楼梯段时按完成面就近归入（floorForHeight）。
   */
  function activeFloorForFoot(foot: number): number {
    for (let g = 0; g < FLOORS.length - 1; g++) {
      const land = stairLandingY[g];
      if (land <= -Infinity) continue; // 该段无楼梯（如 3F→屋顶），跳过
      if (foot < FLOORS[g + 1].baseY) {
        return foot >= land ? g + 1 : g;
      }
    }
    return floorForHeight(foot);
  }

  /** 自动切层（上下楼）：保持相机位置与朝向，仅切换活动层并通知外部同步 UI */
  function autoSwitchFloor(floor: number): void {
    if (floor === activeFloor) return;
    const prev = floorStates[activeFloor];
    activeFloor = floor;
    levelFloor = floor;
    const st = floorStates[floor];
    st.mode = prev.mode;
    // 新层的位置即当前位置；旧层位置保持"上次真正待在旧层时"的记录（此刻人已在楼梯/新层上）
    st.fpsPos.copy(camera.position);
    applyVisibility();
  }

  function updateFpsMovement(keys: KeyState, touchMove?: TouchMove | null): void {
    tmpForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpForward.y = 0;
    tmpForward.normalize();

    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmpRight.y = 0;
    tmpRight.normalize();

    // 键盘分量（WASD/方向键）+ 触屏摇杆向量（上推前进、右推右移），支持同时输入
    const fwd =
      (keys.w || keys.up ? 1 : 0) - (keys.s || keys.down ? 1 : 0) +
      (touchMove ? -touchMove.y : 0);
    const strafe =
      (keys.d || keys.right ? 1 : 0) - (keys.a || keys.left ? 1 : 0) +
      (touchMove ? touchMove.x : 0);

    const area = walkAreas[activeFloor];
    const fromInside = inRect(area.inside, camera.position.x, camera.position.z);
    // 分轴推进：x、z 各自判定，落在可行走区域内才生效（贴墙时可沿墙滑动）
    if (fwd !== 0) {
      const step = fwd * FPS_SPEED;
      const nx = camera.position.x + tmpForward.x * step;
      if (isWalkable(area, nx, camera.position.z, fromInside)) camera.position.x = nx;
      const nz = camera.position.z + tmpForward.z * step;
      if (isWalkable(area, camera.position.x, nz, fromInside)) camera.position.z = nz;
    }
    if (strafe !== 0) {
      const step = strafe * FPS_SPEED;
      const nx = camera.position.x + tmpRight.x * step;
      if (isWalkable(area, nx, camera.position.z, fromInside)) camera.position.x = nx;
      const nz = camera.position.z + tmpRight.z * step;
      if (isWalkable(area, camera.position.x, nz, fromInside)) camera.position.z = nz;
    }

    // 滚轮 / 双指捏合写入的前进脉冲：沿视线方向一次性位移（正=前进），复用可行走判定
    if (fpsMoveImpulse !== 0) {
      const nx = camera.position.x + tmpForward.x * fpsMoveImpulse;
      if (isWalkable(area, nx, camera.position.z, fromInside)) camera.position.x = nx;
      const nz = camera.position.z + tmpForward.z * fpsMoveImpulse;
      if (isWalkable(area, camera.position.x, nz, fromInside)) camera.position.z = nz;
      fpsMoveImpulse = 0;
    }

    // 眼高：跟随脚下标高（平层为完成面、楼梯为踏步面），按时间常数做插值过渡
    const now = performance.now();
    const dt = Math.min((now - lastMoveTime) / 1000, 0.1);
    lastMoveTime = now;
    const ground = resolveGround(area, camera.position.x, camera.position.z, groundY);
    groundY = ground.step;
    const targetEye = ground.step + FPS_EYE_Y;
    const alpha = 1 - Math.exp(-dt / EYE_SMOOTH_TAU);
    camera.position.y += (targetEye - camera.position.y) * alpha;

    // 上下楼：可见层按"越过中段休息台即进入上层"加载（1F→2F 脚高 2.5m、2F→3F 5.3m），
    // 使上层图层在上梯口之前就加载，避免透过楼梯洞口看到空房间；下楼对称。
    // UI 指示（按钮 / 小地图）则按"已到达楼层"（完成面）走，休息台上仍显示下层。
    const layer = activeFloorForFoot(ground.step);
    if (layer !== activeFloor) autoSwitchFloor(layer);
    const ui = floorForHeight(ground.step);
    if (ui !== uiFloor) {
      uiFloor = ui;
      if (onAutoFloor) onAutoFloor(ui);
    }

    // 记录本层第一人称位置（切模式/切层后可恢复原处）
    floorStates[activeFloor].fpsPos.copy(camera.position);
  }

  /** 记录当前上帝视角相机（每层独立保存，切层/切模式后可恢复） */
  function saveTpsView(): void {
    const st = floorStates[activeFloor];
    if (st.mode !== 'tps') return;
    st.tpsPos.copy(camera.position);
    st.tpsTarget.copy(controls.target);
  }

  return {
    get activeFloor() {
      return activeFloor;
    },
    setMode,
    setActiveFloor,
    setMinimapVisible,
    getMinimapVisible,
    updateFpsMovement,
    saveTpsView,
    getMode: () => floorStates[activeFloor].mode,
    getState: () => floorStates[activeFloor],
    getUiFloor: () => uiFloor,
  };
}

/** 门窗开合动画：旋转门向目标角度插值；推拉门（slideX）向目标位移插值；成组窗扇按各自角度插值 */
export function updateInteractables(interactables: InteractiveObject[]): void {
  for (const obj of interactables) {
    // 多级开合窗扇（窗户小方格独立开合）：按 openStep 取角度，方向由 hingeSign 决定
    const angles = obj.userData.openAngles;
    if (angles && angles.length > 0) {
      const step = obj.userData.openStep ?? 0;
      const sign = obj.userData.hingeSign ?? 1;
      const targetAngle = angles[step] * sign;
      obj.rotation.y = THREE.MathUtils.lerp(obj.rotation.y, targetAngle, OPEN_LERP);
      continue;
    }
    // 成组开启的窗（左右下格小窗格）：主控开合带动子扇绕各自枢轴转动
    const sashes = obj.userData.sashes;
    if (sashes) {
      const open = obj.userData.isOpen;
      for (const s of sashes) {
        s.object.rotation.y = THREE.MathUtils.lerp(
          s.object.rotation.y,
          open ? s.openAngle : 0,
          OPEN_LERP,
        );
      }
      continue;
    }
    const slide = obj.userData.slideX;
    if (slide) {
      const targetX = obj.userData.isOpen ? slide.open : slide.closed;
      obj.position.x = THREE.MathUtils.lerp(obj.position.x, targetX, OPEN_LERP);
      continue;
    }
    const target = obj.userData.isOpen ? obj.userData.openAngle : obj.userData.closedAngle;
    obj.rotation.y = THREE.MathUtils.lerp(obj.rotation.y, target, OPEN_LERP);
  }
}

export { PITCH_LIMIT };
