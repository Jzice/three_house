import * as THREE from 'three';
import type { InteractiveObject, KeyState, ViewMode } from '../types';
import type { SceneContext } from '../scene/sceneSetup';
import { VIEW } from '../config/houseConfig';

export interface ViewState {
  mode: ViewMode;
  tpsPos: THREE.Vector3;
  tpsTarget: THREE.Vector3;
  fpsPos: THREE.Vector3;
  fpsYaw: number;
  fpsPitch: number;
}

export interface ViewManager {
  readonly state: ViewState;
  setMode(mode: ViewMode): void;
  updateFpsMovement(keys: KeyState): void;
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

export function createViewState(): ViewState {
  return {
    mode: 'tps',
    tpsPos: new THREE.Vector3(...VIEW.tpsPos),
    tpsTarget: new THREE.Vector3(...VIEW.tpsTarget),
    fpsPos: new THREE.Vector3(...VIEW.fpsPos),
    fpsYaw: 0,
    fpsPitch: 0,
  };
}

/**
 * 视角管理器：负责三种模式下的相机、控制器与画布可见性切换。
 * @param onEnter2D 进入 2D 模式时需要重绘平面图
 */
export function createViewManager(
  ctx: SceneContext,
  canvas2D: HTMLCanvasElement,
  onEnter2D: () => void,
): ViewManager {
  const state = createViewState();
  const { camera, controls, renderer } = ctx;

  function setMode(mode: ViewMode): void {
    state.mode = mode;

    if (mode === 'tps') {
      controls.enabled = true;
      canvas2D.style.display = 'none';
      renderer.domElement.style.display = 'block';
      camera.position.copy(state.tpsPos);
      controls.target.copy(state.tpsTarget);
      controls.update();
    } else if (mode === 'fps') {
      controls.enabled = false;
      canvas2D.style.display = 'none';
      renderer.domElement.style.display = 'block';
      camera.position.copy(state.fpsPos);
      state.fpsYaw = 0;
      state.fpsPitch = 0;
      tmpEuler.set(0, 0, 0, 'YXZ');
      camera.quaternion.setFromEuler(tmpEuler);
    } else {
      controls.enabled = false;
      canvas2D.style.display = 'block';
      renderer.domElement.style.display = 'none';
      onEnter2D();
    }
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
    camera.position.y = FPS_EYE_Y;
  }

  return { state, setMode, updateFpsMovement };
}

/** 门窗开合动画：向目标角度插值 */
export function updateInteractables(interactables: InteractiveObject[]): void {
  for (const obj of interactables) {
    const target = obj.userData.isOpen ? obj.userData.openAngle : obj.userData.closedAngle;
    obj.rotation.y = THREE.MathUtils.lerp(obj.rotation.y, target, OPEN_LERP);
  }
}

export { PITCH_LIMIT };
