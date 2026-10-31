import * as THREE from 'three';
import type { InteractiveObject, KeyState } from '../types';
import type { SceneContext } from '../scene/sceneSetup';
import type { ViewState } from './viewState';
import { PITCH_LIMIT } from './viewState';

/** FPS 视角灵敏度 */
const LOOK_SPEED = 0.003;
/** 判定为"点击"而非"拖拽"的位移阈值（像素） */
const CLICK_THRESHOLD = 5;

export function createKeyState(): KeyState {
  return { w: false, a: false, s: false, d: false, up: false, down: false, left: false, right: false };
}

/** 键盘监听：仅在第一人称模式下生效（状态通过 getter 取当前活动层） */
export function attachKeyboard(keys: KeyState, getState: () => ViewState): void {
  window.addEventListener('keydown', (e) => {
    if (getState().mode !== 'fps') return;
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = true;
    else if (key === 's') keys.s = true;
    else if (key === 'a') keys.a = true;
    else if (key === 'd') keys.d = true;
    else if (e.key === 'ArrowUp') keys.up = true;
    else if (e.key === 'ArrowDown') keys.down = true;
    else if (e.key === 'ArrowLeft') keys.left = true;
    else if (e.key === 'ArrowRight') keys.right = true;
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w') keys.w = false;
    else if (key === 's') keys.s = false;
    else if (key === 'a') keys.a = false;
    else if (key === 'd') keys.d = false;
    else if (e.key === 'ArrowUp') keys.up = false;
    else if (e.key === 'ArrowDown') keys.down = false;
    else if (e.key === 'ArrowLeft') keys.left = false;
    else if (e.key === 'ArrowRight') keys.right = false;
  });
}

/**
 * 3D 画布上的指针交互：
 * - FPS 模式下拖拽转动视角
 * - 位移小于阈值时视为点击，射线拾取"当前活动层"的门窗并切换开合
 */
export function attachPointerInteraction(
  ctx: SceneContext,
  getState: () => ViewState,
  getInteractables: () => InteractiveObject[],
): void {
  const { camera, renderer } = ctx;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  let isDragging = false;
  let prevX = 0;
  let prevY = 0;
  let movedDist = 0;

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (getState().mode === '2d') return;
    isDragging = true;
    prevX = e.clientX;
    prevY = e.clientY;
    movedDist = 0;
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (getState().mode === '2d' || !isDragging) return;

    const deltaX = e.clientX - prevX;
    const deltaY = e.clientY - prevY;
    movedDist += Math.abs(deltaX) + Math.abs(deltaY);

    if (getState().mode === 'fps') {
      const state = getState();
      state.fpsYaw -= deltaX * LOOK_SPEED;
      state.fpsPitch -= deltaY * LOOK_SPEED;
      state.fpsPitch = THREE.MathUtils.clamp(state.fpsPitch, -PITCH_LIMIT, PITCH_LIMIT);
      euler.set(state.fpsPitch, state.fpsYaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
    }

    prevX = e.clientX;
    prevY = e.clientY;
  });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (getState().mode === '2d') return;
    isDragging = false;

    if (movedDist >= CLICK_THRESHOLD) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // 只命中当前活动层的门窗，避免穿透到隐藏楼层
    const intersects = raycaster.intersectObjects(getInteractables(), true);
    if (intersects.length === 0) return;

    let obj: THREE.Object3D | null = intersects[0].object;
    while (obj && !obj.userData.isInteractive) {
      obj = obj.parent;
    }
    if (obj) {
      const target = obj as InteractiveObject;
      target.userData.isOpen = !target.userData.isOpen;
    }
  });
}
