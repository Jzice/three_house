import * as THREE from 'three';
import type { InteractiveObject, KeyState } from '../types';
import type { LightSwitchHitData } from '../config/lightingConfig';
import type { SceneContext } from '../scene/sceneSetup';
import type { ViewState } from './viewState';
import { PITCH_LIMIT } from './viewState';

/** FPS 视角灵敏度 */
const LOOK_SPEED = 0.003;
/** 鼠标：判定为"点击"而非"拖拽"的位移阈值（像素） */
const CLICK_THRESHOLD = 5;
/** 触摸：手指比鼠标粗，放宽阈值以区分"轻点门窗"与"轻微滑动" */
const TOUCH_CLICK_THRESHOLD = 12;
/** 鼠标滚轮 -> 前进后退 系数（约 0.3m/格）；向上滚 deltaY<0 = 前进 */
const WHEEL_TO_MOVE = 0.004;
/** 触摸板双指捏合（ctrl+wheel，deltaY 较小）-> 前进后退 系数 */
const PINCH_TO_MOVE = 0.03;
/** 触摸真双指间距变化（像素）-> 前进后退 系数；手指分开 = 前进 */
const PINCH_TOUCH_TO_MOVE = 0.008;

/** 窄屏/移动形态：触屏设备或窄视口（手机、平板、笔记本小屏），用于启用触屏单指转头与触摸板捏合缩放 */
function isCompact(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;
}

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
 * 3D 开关拾取的可选接入：不传该参数时，门窗点击行为与既有版本完全一致。
 * 开关不进 `interactables`，避免被 `updateInteractables()` 按旋转插值、
 * 也避免用门扇的 isOpen 布尔语义去表达双联 / 双控 / 分组。
 */
export interface LightingPick {
  /** 当前可见楼层的开关命中盒（透明放大盒） */
  getHitObjects: () => THREE.Object3D[];
  /** 命中某面板按键后回调照明状态中枢 */
  onToggle: (switchId: string, keyIndex: number) => void;
}

/**
 * 3D 画布上的指针交互：
 * - FPS 模式下拖拽转动视角
 * - 位移小于阈值时视为点击，射线拾取"当前活动层"的门窗并切换开合
 * - 可选接入 3D 开关：门窗与开关合并为一次射线求交，按最近命中分派
 */
export function attachPointerInteraction(
  ctx: SceneContext,
  getState: () => ViewState,
  getInteractables: () => InteractiveObject[],
  /** 游戏模式激活时返回 true，此时本函数所有处理早退（输入交给 game 层） */
  isGameActive?: () => boolean,
  /** 可选：3D 开关拾取（不传则门窗行为零变化） */
  lighting?: LightingPick,
): void {
  const { camera, renderer } = ctx;
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  /** 当前落在画布上的所有指针（鼠标 + 触摸），用于多指手势 */
  const pointers = new Map<number, { x: number; y: number }>();

  // 鼠标（单指拖拽转头）状态
  let mouseDragging = false;
  let mousePrevX = 0;
  let mousePrevY = 0;
  let mouseMoved = 0;

  // 触摸单指：用于"轻点门窗"判定
  let touchStart = { x: 0, y: 0 };
  let touchMoved = 0;
  // 触摸双指：两指中心，用于转头；两指间距，用于捏合前进后退
  let twoFingerCenter = { x: 0, y: 0 };
  let twoFingerDist = 0;

  /** 应用视角偏移（鼠标拖拽或双指拖动都会调用） */
  function applyLook(dx: number, dy: number): void {
    if (getState().mode !== 'fps') return;
    const state = getState();
    state.fpsYaw -= dx * LOOK_SPEED;
    state.fpsPitch -= dy * LOOK_SPEED;
    state.fpsPitch = THREE.MathUtils.clamp(state.fpsPitch, -PITCH_LIMIT, PITCH_LIMIT);
    euler.set(state.fpsPitch, state.fpsYaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);
  }

  /** 单指轻点：门窗与 3D 开关合并为一次射线求交，按最近命中分派 */
  function pick(e: PointerEvent): void {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // 只命中当前活动层的门窗与开关，避免穿透到隐藏楼层
    const doors = getInteractables();
    const switches = lighting?.getHitObjects() ?? [];
    const targets: THREE.Object3D[] = switches.length > 0 ? [...doors, ...switches] : doors;
    const intersects = raycaster.intersectObjects(targets, true);
    if (intersects.length === 0) return;

    const first = intersects[0].object;
    // 最近命中若是开关命中盒，沿父链取开关数据并交给状态中枢，不再进入门窗开合逻辑
    let swObj: THREE.Object3D | null = first;
    while (swObj && (swObj.userData as Partial<LightSwitchHitData>).kind !== 'light-switch') {
      swObj = swObj.parent;
    }
    if (swObj) {
      const data = swObj.userData as LightSwitchHitData;
      lighting?.onToggle(data.switchId, data.keyIndex);
      return;
    }

    let obj: THREE.Object3D | null = first;
    while (obj && !obj.userData.isInteractive) {
      obj = obj.parent;
    }
    if (obj) {
      const target = obj as InteractiveObject;
      const ud = target.userData;
      // 多级开合窗扇（窗户小方格）：点击在角度档位间循环（闭合 → 45° → 60° → 90° → 闭合）
      if (ud.openAngles && ud.openAngles.length > 0) {
        ud.openStep = ((ud.openStep ?? 0) + 1) % ud.openAngles.length;
      } else {
        ud.isOpen = !ud.isOpen;
      }
    }
  }

  function centerOf(): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const p of pointers.values()) {
      sx += p.x;
      sy += p.y;
    }
    const n = pointers.size || 1;
    return { x: sx / n, y: sy / n };
  }

  /** 当前两指间距（像素）；不足两指返回 0 */
  function distOf(): number {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  /** 双指抬起后若仍剩一指，把它重置为"单指起点"，避免误判点击或跳变 */
  function resetSingleFromRemainder(): void {
    if (pointers.size === 1) {
      const p = [...pointers.values()][0];
      touchStart = { x: p.x, y: p.y };
      touchMoved = 0;
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (getState().mode === '2d') return;
    if (isGameActive?.()) return; // 游戏模式：输入交给 game 层
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (e.pointerType === 'mouse') {
      // 鼠标：保持原行为——单指拖拽转头
      mouseDragging = true;
      mousePrevX = e.clientX;
      mousePrevY = e.clientY;
      mouseMoved = 0;
    } else {
      // 触摸：单指记录起点；双指起则建立转头基准中心
      if (pointers.size === 1) {
        touchStart = { x: e.clientX, y: e.clientY };
        touchMoved = 0;
      } else if (pointers.size === 2) {
        twoFingerCenter = centerOf();
        twoFingerDist = distOf();
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (getState().mode === '2d' || !pointers.has(e.pointerId)) return;
    if (isGameActive?.()) return;
    const prev = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (e.pointerType === 'mouse') {
      if (!mouseDragging) return;
      const dx = e.clientX - mousePrevX;
      const dy = e.clientY - mousePrevY;
      mouseMoved += Math.abs(dx) + Math.abs(dy);
      if (getState().mode === 'fps') applyLook(dx, dy);
      mousePrevX = e.clientX;
      mousePrevY = e.clientY;
    } else {
      if (pointers.size >= 2) {
        // 双指间距变化 -> 前进/后退（等效 W/S）；手指分开=前进
        const d = distOf();
        const dDelta = d - twoFingerDist;
        twoFingerDist = d;
        if (dDelta !== 0) getState().addFpsForward(dDelta * PINCH_TOUCH_TO_MOVE);
        // 双指中心位移 -> 转视角
        const c = centerOf();
        applyLook(c.x - twoFingerCenter.x, c.y - twoFingerCenter.y);
        twoFingerCenter = c;
      } else {
        // 单指：累计位移用于轻点判定
        const p = pointers.get(e.pointerId)!;
        touchMoved = Math.abs(p.x - touchStart.x) + Math.abs(p.y - touchStart.y);
        // 窄屏/移动形态：单指拖拽也转视角（与双指并存；轻点仍按阈值判定为点击）
        if (isCompact()) applyLook(e.clientX - prev.x, e.clientY - prev.y);
      }
    }
  });

  function endPointer(e: PointerEvent): void {
    if (getState().mode === '2d') {
      pointers.delete(e.pointerId);
      return;
    }
    if (isGameActive?.()) {
      pointers.delete(e.pointerId);
      return;
    }

    if (e.pointerType === 'mouse') {
      const wasDragging = mouseDragging;
      mouseDragging = false;
      pointers.delete(e.pointerId);
      if (wasDragging && mouseMoved < CLICK_THRESHOLD) pick(e);
      return;
    }

    // 触摸：单指抬起且几乎未移动 → 视为点击门窗
    if (pointers.size === 1 && touchMoved < TOUCH_CLICK_THRESHOLD) {
      pick(e);
    }
    pointers.delete(e.pointerId);
    resetSingleFromRemainder();
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => {
    pointers.delete(e.pointerId);
    resetSingleFromRemainder();
  });

  // 第一人称：鼠标滚轮 / 触摸板双指捏合（ctrl+wheel）等效 W/S 前进后退
  // 向上滚 / 捏合放大（deltaY<0）→ 前进；向下滚 / 缩小 → 后退
  canvas.addEventListener('wheel', (e) => {
    const state = getState();
    if (state.mode !== 'fps') return;
    if (isGameActive?.()) return; // 游戏模式：滚轮前进由 game 层处理
    e.preventDefault();
    const k = e.ctrlKey ? PINCH_TO_MOVE : WHEEL_TO_MOVE;
    state.addFpsForward(-e.deltaY * k);
  }, { passive: false });
}
