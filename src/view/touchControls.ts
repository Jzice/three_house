import type { TouchMove } from '../types';

/** 摇杆最大拖动半径（像素）， knob 与输出向量都按此归一化 */
const JOYSTICK_RADIUS = 56;

export interface TouchControls {
  /** 当前设备是否具备触屏能力（决定是否启用摇杆） */
  readonly isTouch: boolean;
  /** 读取当前归一化移动向量 {x,y} ∈ [-1,1]，静止时为 {0,0} */
  getMove(): TouchMove;
  /** 摇杆是否正被操作（用于状态判断/调试） */
  isActive(): boolean;
}

/**
 * 虚拟摇杆（左下角）：单指按住 base 拖动，输出方向 + 力度的归一化向量。
 * 仅当设备具备触屏能力时才真正启用；桌面端返回 isTouch=false，getMove 恒为 {0,0}。
 *
 * 摇杆是独立的 DOM 元素，其指针事件不冒泡到 3D 画布，因此：
 * - 单指按住摇杆 = 移动（本模块负责）
 * - 单指落在画布 = 点击门窗（由 interaction 处理）
 * - 双指落在画布 = 转头（由 interaction 处理）
 */
export function createTouchControls(): TouchControls {
  const isTouch =
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0;

  const base = document.getElementById('joystick-base') as HTMLDivElement | null;
  const knob = document.getElementById('joystick-knob') as HTMLDivElement | null;

  // 缺少 DOM 或不支持触屏：返回空实现，绝不报错
  if (!isTouch || !base || !knob) {
    return { isTouch: false, getMove: () => ({ x: 0, y: 0 }), isActive: () => false };
  }

  const move: TouchMove = { x: 0, y: 0 };
  let activeId: number | null = null;
  let centerX = 0;
  let centerY = 0;
  const knobEl = knob;

  function setKnob(dx: number, dy: number): void {
    knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function update(px: number, py: number): void {
    let dx = px - centerX;
    let dy = py - centerY;
    const dist = Math.hypot(dx, dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    setKnob(dx, dy);
    // 归一化：-1..1；约定上推（dy<0）前进，右推（dx>0）右移
    move.x = dx / JOYSTICK_RADIUS;
    move.y = dy / JOYSTICK_RADIUS;
  }

  function reset(): void {
    activeId = null;
    move.x = 0;
    move.y = 0;
    setKnob(0, 0);
  }

  base.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    const rect = base.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    base.setPointerCapture(e.pointerId);
    e.stopPropagation();
    update(e.clientX, e.clientY);
  });

  base.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId) return;
    update(e.clientX, e.clientY);
  });

  base.addEventListener('pointerup', (e) => {
    if (e.pointerId !== activeId) return;
    reset();
  });

  base.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== activeId) return;
    reset();
  });

  return {
    isTouch: true,
    getMove: () => ({ x: move.x, y: move.y }),
    isActive: () => activeId !== null,
  };
}
