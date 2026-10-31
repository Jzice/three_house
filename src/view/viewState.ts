import * as THREE from 'three';
import type { InteractiveObject, KeyState, ViewMode } from '../types';
import type { SceneContext } from '../scene/sceneSetup';
import { VIEW, FLOORS } from '../config/houseConfig';

/** 单层的视角状态：模式 + 上帝/第一人称相机与朝向 */
export interface ViewState {
  mode: ViewMode;
  tpsPos: THREE.Vector3;
  tpsTarget: THREE.Vector3;
  fpsPos: THREE.Vector3;
  fpsYaw: number;
  fpsPitch: number;
}

export interface ViewManager {
  /** 当前活动楼层序号 */
  readonly activeFloor: number;
  setMode(mode: ViewMode): void;
  /** 切换活动楼层（保持当前模式，恢复该层记忆的相机） */
  setActiveFloor(floor: number): void;
  updateFpsMovement(keys: KeyState): void;
  /** 记录当前上帝视角相机（每层独立保存，切层/切模式后可恢复） */
  saveTpsView(): void;
  /** 当前活动楼层的模式 */
  getMode(): ViewMode;
  /** 当前活动楼层的视角状态 */
  getState(): ViewState;
}

const FPS_SPEED = 0.08;
const FPS_EYE_Y = 1.6;
const FPS_LIMIT_X = 4.3;
const FPS_LIMIT_Z = 4.8;
/** 俯仰角限位，避免翻转 */
const PITCH_LIMIT = Math.PI / 2 - 0.1;
/** 门窗开合插值系数 */
const OPEN_LERP = 0.15;

// 复用临时向量，避免每帧分配
const tmpForward = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/** 生成某层的初始视角状态（相机标高随楼层抬升） */
function createFloorState(index: number): ViewState {
  const f = FLOORS[index];
  return {
    mode: 'tps',
    tpsPos: new THREE.Vector3(VIEW.tpsPos[0], f.baseY + VIEW.tpsPos[1], VIEW.tpsPos[2]),
    tpsTarget: new THREE.Vector3(VIEW.tpsTarget[0], f.baseY + VIEW.tpsTarget[1], VIEW.tpsTarget[2]),
    fpsPos: new THREE.Vector3(VIEW.fpsPos[0], f.baseY + FPS_EYE_Y, VIEW.fpsPos[2]),
    fpsYaw: 0,
    fpsPitch: 0,
  };
}

const floorStates: ViewState[] = FLOORS.map((_, i) => createFloorState(i));

/**
 * 视角管理器：负责三种模式下的相机、控制器与画布可见性切换，
 * 并为每一层分别保存模式与相机状态（切换楼层后互不干扰）。
 * @param onEnter2D 进入 2D 模式时需要重绘平面图
 * @param setFloorVisible 由外部控制各楼层 3D 组的可见性
 */
export function createViewManager(
  ctx: SceneContext,
  canvas2D: HTMLCanvasElement,
  onEnter2D: () => void,
  setFloorVisible: (floor: number, visible: boolean) => void,
): ViewManager {
  const { camera, controls, renderer } = ctx;
  let activeFloor = 0;

  /** 上帝视角显示活动层及其以下各层（点 1F 只见 1F，点 2F 见 1F+2F）；第一人称仅活动层；2D 全隐藏 */
  function applyVisibility(): void {
    const mode = floorStates[activeFloor].mode;
    floorStates.forEach((_, i) => {
      const visible = mode === 'tps' ? i <= activeFloor : mode !== '2d' && i === activeFloor;
      setFloorVisible(i, visible);
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
      canvas2D.style.display = 'block';
      canvas2D.classList.add('minimap');
      renderer.domElement.style.display = 'block';
      camera.position.copy(st.fpsPos);
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
    const st = floorStates[activeFloor];
    st.mode = mode;

    if (mode === 'tps') {
      camera.position.copy(st.tpsPos);
      controls.target.copy(st.tpsTarget);
      controls.update();
    } else if (mode === 'fps') {
      camera.position.copy(st.fpsPos);
      st.fpsYaw = 0;
      st.fpsPitch = 0;
      tmpEuler.set(0, 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
    }
    // 2D 模式无需相机，平面图由外部在切层后重绘
    applyVisibility();
  }

  function updateFpsMovement(keys: KeyState): void {
    tmpForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpForward.y = 0;
    tmpForward.normalize();

    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmpRight.y = 0;
    tmpRight.normalize();

    if (keys.w || keys.up) camera.position.addScaledVector(tmpForward, FPS_SPEED);
    if (keys.s || keys.down) camera.position.addScaledVector(tmpForward, -FPS_SPEED);
    if (keys.a || keys.left) camera.position.addScaledVector(tmpRight, -FPS_SPEED);
    if (keys.d || keys.right) camera.position.addScaledVector(tmpRight, FPS_SPEED);

    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -FPS_LIMIT_X, FPS_LIMIT_X);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -FPS_LIMIT_Z, FPS_LIMIT_Z);
    // 锁定在当前楼层眼高（用楼层按钮上下楼，而非真实爬楼梯）
    camera.position.y = FLOORS[activeFloor].baseY + FPS_EYE_Y;
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
    updateFpsMovement,
    saveTpsView,
    getMode: () => floorStates[activeFloor].mode,
    getState: () => floorStates[activeFloor],
  };
}

/** 门窗开合动画：旋转门向目标角度插值；推拉门（slideX）向目标位移插值 */
export function updateInteractables(interactables: InteractiveObject[]): void {
  for (const obj of interactables) {
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
